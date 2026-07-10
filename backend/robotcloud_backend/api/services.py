from __future__ import annotations

import hashlib
import json
import logging
import re
import secrets
from datetime import timedelta
from pathlib import Path
from typing import Any, Dict, Iterable, Optional
from urllib.parse import quote
from zipfile import BadZipFile, ZipFile

import requests
from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.core.cache import caches
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .models import (
    AdminLog,
    Dataset,
    Device,
    InferenceTask,
    Payment,
    SimulationTask,
    TrainTask,
    User,
    UserSession,
    WorkerNode,
)
from .limits import phone_defaults_to_plus, user_has_no_limits
from ..sms import SmsGateway
from ..payment.alipay import get_alipay


logger = logging.getLogger("robotcloud.api.services")
TOKEN_TIMEOUT_SECONDS = 7 * 24 * 60 * 60  # 7 days
VERIFICATION_CODE_TIMEOUT_SECONDS = 5 * 60  # 5 minutes
DEFAULT_DATASET_UPLOAD_SESSION_TIMEOUT_SECONDS = 2 * 60 * 60  # 2 hours
DEFAULT_DATASET_UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024
DEVICE_LIMIT_MESSAGE = "Device limit reached for this device type"


def _canonical_model_type(model_type: str) -> str:
    key = re.sub(r"[\s_-]+", "", str(model_type or "").strip().lower())
    if key == "act":
        return "act"
    if key in {"diffusionpolicy", "diffusion", "dp"}:
        return "diffusion"
    if key == "smolvla":
        return "smolvla"
    if key == "pi0":
        return "pi0"
    if key in {"pi0.5", "pi05"}:
        return "pi05"
    if "gr00t" in key or "groot" in key:
        return "groot"
    return key


class RobotCloudService:
    """Domain service that encapsulates RobotCloud business logic."""

    # Only Plus plan is available: 1000 RMB/month (100000 cents)
    PLAN_PRICING = {
        User.ROLE_PLUS: {
            "amount_cents": int(getattr(settings, "PLUS_PRICE_CENTS", 100000)),
            "currency": "CNY",
            "description": "RobotCloud Plus Subscription - 1 month",
        },
    }
    TRAINING_PRIORITY_BY_ROLE = {
        User.ROLE_PRO: 100,
        User.ROLE_PLUS: 50,
        User.ROLE_FREE: 10,
        User.ROLE_ADMIN: 100,
    }
    TRAINING_CONCURRENCY_BY_ROLE = {
        User.ROLE_PRO: 4,
        User.ROLE_PLUS: 3,
        User.ROLE_FREE: 2,
        User.ROLE_ADMIN: 4,
    }

    def __init__(self, sms_gateway: Optional[SmsGateway] = None) -> None:
        self.sms_gateway = sms_gateway
        self.token_cache = caches["tokens"]
        self.verification_cache = caches["default"]
        self.dataset_upload_session_timeout = max(
            int(getattr(settings, "DATASET_UPLOAD_SESSION_TIMEOUT_SECONDS", DEFAULT_DATASET_UPLOAD_SESSION_TIMEOUT_SECONDS)),
            60,
        )
        self.dataset_upload_chunk_size = max(
            int(getattr(settings, "DATASET_UPLOAD_CHUNK_SIZE", DEFAULT_DATASET_UPLOAD_CHUNK_SIZE)),
            1024 * 1024,
        )
        dataset_root = getattr(settings, "DATASET_STORAGE_DIR", None)
        if dataset_root is None:
            dataset_root = Path.cwd() / "datasets"
        self.dataset_root = Path(dataset_root)
        self.dataset_root.mkdir(parents=True, exist_ok=True)

    # -------------------- Internal helpers --------------------
    def _priority_for_role(self, role: str) -> int:
        return self.TRAINING_PRIORITY_BY_ROLE.get(role, 10)

    def _max_concurrent_for_role(self, role: str) -> int:
        return self.TRAINING_CONCURRENCY_BY_ROLE.get(role, 2)

    def _refresh_queue_positions(self) -> None:
        queued_tasks = list(TrainTask.objects.filter(status="queued").order_by("-priority", "created_at"))
        for index, task in enumerate(queued_tasks, start=1):
            if task.queue_position != index:
                TrainTask.objects.filter(pk=task.pk).update(queue_position=index)

    def _get_worker_by_token(self, token: str) -> WorkerNode:
        if not token:
            raise ValueError("Agent token required")
        try:
            return WorkerNode.objects.get(auth_token=token)
        except WorkerNode.DoesNotExist as exc:
            raise ValueError("Invalid agent token") from exc

    def _generate_agent_token(self) -> str:
        while True:
            candidate = secrets.token_hex(16)
            if not WorkerNode.objects.filter(auth_token=candidate).exists():
                return candidate

    def _generate_dataset_upload_token(self) -> str:
        return secrets.token_urlsafe(32)

    def _hash_upload_token(self, token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def _generate_payment_id(self) -> str:
        while True:
            candidate = secrets.token_hex(12)
            if not Payment.objects.filter(payment_id=candidate).exists():
                return candidate

    def _hash_token(self, token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def _normalize_device_type(self, device_type: Any) -> str:
        candidate = str(device_type or "").strip().lower()
        if not candidate:
            return UserSession.DEVICE_BROWSER
        if candidate in {UserSession.DEVICE_BROWSER, "web", "browser"}:
            return UserSession.DEVICE_BROWSER
        if candidate in {UserSession.DEVICE_MOBILE, "phone", "tablet"}:
            return UserSession.DEVICE_MOBILE
        if candidate in {UserSession.DEVICE_DESKTOP, "pc", "desktop-app", "tauri"}:
            return UserSession.DEVICE_DESKTOP
        raise ValueError("Invalid device type")

    def _normalize_device_id(self, device_id: Any) -> str:
        candidate = str(device_id or "").strip()
        if not candidate:
            return "legacy"
        if len(candidate) > 128:
            raise ValueError("Device id is too long")
        return candidate

    def _single_device_bypass_phones(self) -> set[str]:
        values = getattr(settings, "AUTH_SINGLE_DEVICE_BYPASS_PHONES", [])
        if isinstance(values, str):
            values = values.split(",")
        return {str(item).strip() for item in values if str(item).strip()}

    def _bypasses_single_device_limit(self, user: User) -> bool:
        return user.phone in self._single_device_bypass_phones()

    def _is_plus_whitelisted(self, phone: str) -> bool:
        return phone_defaults_to_plus(phone)

    def _has_no_limits(self, user: User) -> bool:
        return user_has_no_limits(user)

    def _apply_plus_whitelist(self, user: User) -> User:
        if not self._is_plus_whitelisted(user.phone):
            return user
        if user.role in {User.ROLE_ADMIN, User.ROLE_PRO}:
            return user

        update_fields: list[str] = []
        if user.role != User.ROLE_PLUS:
            user.role = User.ROLE_PLUS
            update_fields.append("role")
        if user.expire_at is not None:
            user.expire_at = None
            update_fields.append("expire_at")
        if update_fields:
            user.save(update_fields=update_fields)
        return user

    def _revoke_user_sessions(self, queryset, reason: str, now=None) -> int:
        revoked_at = now or timezone.now()
        return queryset.update(
            status=UserSession.STATUS_REVOKED,
            revoked_at=revoked_at,
            revoke_reason=reason,
        )

    def _expire_user_sessions(self, user: User, now=None) -> None:
        expired_at = now or timezone.now()
        UserSession.objects.filter(
            user=user,
            status=UserSession.STATUS_ACTIVE,
            expires_at__lte=expired_at,
        ).update(status=UserSession.STATUS_EXPIRED, revoked_at=expired_at, revoke_reason="expired")

    def _enforce_current_single_device_limit(self, user: User, session: UserSession, now=None) -> None:
        if self._bypasses_single_device_limit(user):
            return
        active_duplicates = UserSession.objects.filter(
            user=user,
            device_type=session.device_type,
            status=UserSession.STATUS_ACTIVE,
        ).exclude(id=session.id)
        self._revoke_user_sessions(active_duplicates, "limit_enforced", now)

    def _start_user_session(
        self,
        user: User,
        device_id: Any = "",
        device_type: Any = "",
        user_agent: str = "",
        replace_existing_device: bool = False,
    ) -> str:
        normalized_device_type = self._normalize_device_type(device_type)
        normalized_device_id = self._normalize_device_id(device_id)
        token = secrets.token_urlsafe(16)
        now = timezone.now()
        expires_at = now + timedelta(seconds=TOKEN_TIMEOUT_SECONDS)

        with transaction.atomic():
            User.objects.select_for_update().get(pk=user.pk)
            self._expire_user_sessions(user, now)
            active_sessions = UserSession.objects.select_for_update().filter(
                user=user,
                device_type=normalized_device_type,
                status=UserSession.STATUS_ACTIVE,
            )
            if not self._bypasses_single_device_limit(user):
                conflict = active_sessions.exclude(device_id=normalized_device_id).first()
                if conflict:
                    if not replace_existing_device:
                        raise ValueError(DEVICE_LIMIT_MESSAGE)
                    self._revoke_user_sessions(active_sessions.exclude(device_id=normalized_device_id), "replaced", now)
                self._revoke_user_sessions(active_sessions.filter(device_id=normalized_device_id), "relogin", now)

            session = UserSession.objects.create(
                user=user,
                device_type=normalized_device_type,
                device_id=normalized_device_id,
                token_hash=self._hash_token(token),
                user_agent=(user_agent or "")[:1000],
                status=UserSession.STATUS_ACTIVE,
                last_seen_at=now,
                expires_at=expires_at,
            )

        self.token_cache.set(token, {"user_id": user.id, "session_id": session.id}, TOKEN_TIMEOUT_SECONDS)
        return token

    def _normalize_gpu_payload(self, payload: Any) -> int:
        if isinstance(payload, int):
            return max(payload, 0)
        if isinstance(payload, (list, tuple)):
            return max(len(payload), 0)
        return 0

    def _normalize_gpu_slot_total(self, gpu_total: int, gpu_slot_total: Any = None) -> int:
        try:
            slot_total = int(gpu_slot_total)
        except (TypeError, ValueError):
            slot_total = gpu_total
        return max(slot_total, gpu_total, 1)

    def _refresh_worker_usage(self, node: WorkerNode) -> None:
        physical_gpu_indices: set[int] = set()
        slot_busy = 0
        for task in TrainTask.objects.filter(assigned_node=node.node_name, status="running"):
            gpus = self._parse_assigned_gpus(task.assigned_gpus) or [0]
            physical_gpu_indices.update(gpus)
            slot_busy += max(len(gpus), 1)
        for task in InferenceTask.objects.filter(assigned_node=node.node_name, status="running"):
            gpus = self._parse_assigned_gpus(task.assigned_gpus) or [0]
            physical_gpu_indices.update(gpus)
            slot_busy += max(len(gpus), 1)

        node.gpu_slot_total = self._normalize_gpu_slot_total(node.gpu_total, node.gpu_slot_total)
        node.gpu_busy = min(len(physical_gpu_indices), node.gpu_total)
        node.gpu_free = max(node.gpu_total - node.gpu_busy, 0)
        node.gpu_slot_busy = min(slot_busy, node.gpu_slot_total)
        node.gpu_slot_free = max(node.gpu_slot_total - node.gpu_slot_busy, 0)
        node.save(update_fields=["gpu_busy", "gpu_free", "gpu_slot_total", "gpu_slot_busy", "gpu_slot_free", "updated_at"])

    def _release_worker_slot(self, task: TrainTask) -> None:
        if not task.assigned_node:
            return
        try:
            node = WorkerNode.objects.get(node_name=task.assigned_node)
        except WorkerNode.DoesNotExist:
            return
        self._refresh_worker_usage(node)

    def _release_inference_slot(self, task: InferenceTask) -> None:
        if not task.assigned_node:
            return
        try:
            node = WorkerNode.objects.get(node_name=task.assigned_node)
        except WorkerNode.DoesNotExist:
            return
        self._refresh_worker_usage(node)

    def _parse_assigned_gpus(self, value: Optional[str]) -> list[int]:
        if not value:
            return []
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return []
        if not isinstance(parsed, list):
            return []
        result: list[int] = []
        for item in parsed:
            try:
                result.append(int(item))
            except (TypeError, ValueError):
                continue
        return result

    def _sanitize_filename(self, original: str, fallback: str) -> str:
        candidate = (original or "").strip().replace("\\", "/").split("/")[-1]
        candidate = re.sub(r"[^A-Za-z0-9._-]+", "_", candidate)
        candidate = candidate.strip("._")
        if candidate:
            return candidate
        fallback_name = fallback.strip().replace(" ", "_")
        return re.sub(r"[^A-Za-z0-9._-]+", "_", fallback_name) or "dataset"

    def _md5_of_file(self, file_path: Path) -> str:
        md5 = hashlib.md5()
        with file_path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                if not chunk:
                    break
                md5.update(chunk)
        return md5.hexdigest()

    def _normalize_public_base_url(self, value: str) -> str:
        candidate = (value or "").strip().rstrip("/")
        if not candidate:
            return ""
        if not candidate.startswith(("http://", "https://")):
            raise ValueError("Agent public base URL must start with http:// or https://")
        return candidate

    def _active_agent_queryset(self):
        return WorkerNode.objects.filter(status=WorkerNode.STATUS_ONLINE, gpu_total__gt=0).order_by("node_name")

    def _upload_capable_agent_queryset(self):
        return self._active_agent_queryset().filter(upload_enabled=True).exclude(public_base_url="")

    def _agent_to_dict(self, node: WorkerNode, default_node: str = "") -> Dict[str, Any]:
        return {
            "node_name": node.node_name,
            "ip": node.ip,
            "api_port": node.api_port,
            "gpu_total": node.gpu_total,
            "gpu_free": node.gpu_free,
            "gpu_busy": node.gpu_busy,
            "gpu_slot_total": node.gpu_slot_total or node.gpu_total,
            "gpu_slot_free": node.gpu_slot_free if node.gpu_slot_total else node.gpu_free,
            "gpu_slot_busy": node.gpu_slot_busy if node.gpu_slot_total else node.gpu_busy,
            "status": node.status,
            "version": node.version,
            "public_base_url": node.public_base_url,
            "upload_enabled": node.upload_enabled,
            "can_upload": bool(node.upload_enabled and node.public_base_url),
            "is_default": bool(default_node and node.node_name == default_node),
            "last_heartbeat": node.last_heartbeat.isoformat() if node.last_heartbeat else None,
        }

    def _select_upload_agent(self, node_name: str = "") -> WorkerNode:
        queryset = self._upload_capable_agent_queryset()
        requested = (node_name or "").strip()
        if requested:
            node = queryset.filter(node_name=requested).first()
            if not node:
                raise ValueError("Selected GPU agent is not available for upload")
            return node
        node = queryset.first()
        if not node:
            raise ValueError("No active GPU agent is available for upload")
        return node

    def _parse_upload_expires_at(self, raw: Any):
        if not isinstance(raw, str) or not raw:
            return None
        parsed = parse_datetime(raw)
        if parsed is None:
            return None
        if timezone.is_naive(parsed):
            parsed = timezone.make_aware(parsed)
        return parsed

    def _get_dataset_upload_session(self, dataset: Dataset, upload_token: str) -> Dict[str, Any]:
        metadata = dataset.metadata if isinstance(dataset.metadata, dict) else {}
        session = metadata.get("upload_session")
        if not isinstance(session, dict):
            raise ValueError("Upload session not found")
        expected_hash = session.get("token_hash")
        if not isinstance(expected_hash, str) or not expected_hash:
            raise ValueError("Upload session is invalid")
        actual_hash = self._hash_upload_token(upload_token or "")
        if not secrets.compare_digest(expected_hash, actual_hash):
            raise ValueError("Invalid upload token")
        expires_at = self._parse_upload_expires_at(session.get("expires_at"))
        if expires_at is None or timezone.now() > expires_at:
            dataset.status = Dataset.STATUS_FAILED
            metadata.pop("upload_session", None)
            dataset.metadata = metadata
            dataset.save(update_fields=["status", "metadata"])
            raise ValueError("Upload session expired")
        return session

    def _delete_agent_dataset_upload_session(self, dataset: Dataset) -> None:
        metadata = dataset.metadata if isinstance(dataset.metadata, dict) else {}
        session = metadata.get("upload_session")
        if not isinstance(session, dict):
            return
        node_name = str(session.get("node_name") or dataset.storage_node or "").strip()
        if not node_name:
            return
        node = WorkerNode.objects.filter(node_name=node_name).first()
        if not node:
            return
        url = f"http://{node.ip}:{node.api_port}/api/v1/agent/datasets/upload/cancel"
        headers = {"Content-Type": "application/json", "X-Agent-Token": node.auth_token}
        try:
            requests.post(url, json={"dataset_id": dataset.id}, headers=headers, timeout=5)
        except Exception:
            pass

    def _write_dataset_file(self, dataset: Dataset, uploaded_file: Any) -> Path:
        dataset_dir = self.dataset_root / f"user_{dataset.owner_id}" / f"dataset_{dataset.id}"
        dataset_dir.mkdir(parents=True, exist_ok=True)
        original_name = getattr(uploaded_file, "name", "")
        suffix = Path(original_name).suffix if original_name else ""
        fallback = f"dataset_{dataset.id}{suffix or '.bin'}"
        filename = self._sanitize_filename(original_name, fallback)
        file_path = dataset_dir / filename
        try:
            chunks: Iterable[bytes]
            if hasattr(uploaded_file, "chunks"):
                chunks = uploaded_file.chunks()
            else:
                data = uploaded_file.read()
                if isinstance(data, str):
                    data = data.encode()
                chunks = [data]
            with file_path.open("wb") as destination:
                for chunk in chunks:
                    if chunk:
                        destination.write(chunk)
        except OSError as exc:
            raise ValueError("Failed to persist dataset file") from exc
        return file_path

    def _relative_storage_path(self, file_path: Path) -> Path:
        try:
            return file_path.relative_to(self.dataset_root)
        except ValueError:
            return file_path

    def _dataset_file_path(self, dataset: Dataset) -> Path:
        storage_path = Path(dataset.storage_path or "")
        if not storage_path:
            return self.dataset_root / f"user_{dataset.owner_id}" / f"dataset_{dataset.id}"
        if storage_path.is_absolute():
            return storage_path
        return self.dataset_root / storage_path

    def _classify_file(self, name: str) -> str:
        suffix = Path(name).suffix.lower()
        if suffix in {".jpg", ".jpeg", ".png", ".bmp", ".gif", ".webp"}:
            return "image"
        if suffix in {".mp4", ".avi", ".mov", ".mkv", ".webm"}:
            return "video"
        if suffix in {".pcd", ".ply", ".las", ".bag"}:
            return "pointcloud"
        if suffix in {".json", ".yaml", ".yml", ".xml", ".csv", ".txt"}:
            return "metadata"
        return "file"

    def _compute_dataset_metadata(self, dataset: Dataset, file_path: Path) -> Dict[str, Any]:
        file_size = file_path.stat().st_size if file_path.exists() else 0
        total_files = 0
        by_type: Dict[str, int] = {}
        preview_entries: list[Dict[str, str]] = []
        if file_path.suffix.lower() == ".zip" and file_path.exists():
            try:
                with ZipFile(file_path) as archive:
                    members = [item for item in archive.infolist() if not item.is_dir()]
            except BadZipFile:
                members = []
            for member in members:
                name = member.filename
                file_type = self._classify_file(name)
                by_type[file_type] = by_type.get(file_type, 0) + 1
                if len(preview_entries) < 5:
                    preview_entries.append({"name": name, "type": file_type})
            total_files = len(members)
        if total_files == 0:
            name = file_path.name
            file_type = self._classify_file(name)
            by_type[file_type] = by_type.get(file_type, 0) + 1
            preview_entries = [{"name": name, "type": file_type}]
            total_files = 1
        return {
            "file_name": file_path.name,
            "file_size": file_size,
            "total_files": total_files,
            "by_type": by_type,
            "preview": preview_entries,
        }

    def _ensure_dataset_metadata(self, dataset: Dataset, force: bool = False) -> Dict[str, Any]:
        metadata = dataset.metadata or {}
        if not metadata or force:
            if dataset.storage_backend == Dataset.STORAGE_BACKEND_AGENT:
                raise ValueError("Dataset metadata unavailable on backend")
            file_path = self._dataset_file_path(dataset)
            if not file_path.exists():
                raise ValueError("Dataset file missing")
            metadata = self._compute_dataset_metadata(dataset, file_path)
            dataset.metadata = metadata
            dataset.save(update_fields=["metadata"])
        return metadata

    def _build_preview_payload(self, dataset: Dataset, metadata: Dict[str, Any]) -> list[Dict[str, Any]]:
        preview_entries = metadata.get("preview") or []
        if not isinstance(preview_entries, list):
            preview_entries = []
        payload = []
        for entry in preview_entries[:5]:
            name = entry.get("name") if isinstance(entry, dict) else None
            if not name:
                continue
            file_type = entry.get("type") if isinstance(entry, dict) else None
            if not file_type:
                file_type = self._classify_file(name)
            url = f"/datasets/{dataset.id}/files/{quote(name, safe='')}"
            payload.append({"name": name, "type": file_type, "url": url})
        return payload

    # -------------------- Auth Module --------------------
    def send_code(self, phone: str) -> Dict[str, Any]:
        self._ensure_phone(phone)
        dev_code = getattr(settings, "AUTH_DEV_CODE", "")
        if dev_code:
            code = dev_code
        else:
            code = f"{secrets.randbelow(1000000):06d}"
        self.verification_cache.set(self._verification_key(phone), code, VERIFICATION_CODE_TIMEOUT_SECONDS)
        if self.sms_gateway:
            self.sms_gateway.send_verification_code(phone, code)
        return self._response({"sent": True, "code": code if dev_code else None})

    def login_with_code(
        self,
        phone: str,
        code: str,
        device_id: Any = "",
        device_type: Any = "",
        user_agent: str = "",
        replace_existing_device: bool = False,
    ) -> Dict[str, Any]:
        """Login or register with SMS verification code."""
        self._ensure_phone(phone)
        if not code:
            raise ValueError("Verification code required")

        dev_code = getattr(settings, "AUTH_DEV_CODE", "")
        stored_code = self.verification_cache.get(self._verification_key(phone))

        if dev_code and code == dev_code:
            pass
        elif stored_code != code:
            raise ValueError("Invalid verification code")

        user = User.objects.filter(phone=phone).first()
        if not user:
            with transaction.atomic():
                user = self._create_user_without_password(phone)
            self.verification_cache.delete(self._verification_key(phone))
        user = self._apply_plus_whitelist(user)

        token = self._start_user_session(user, device_id, device_type, user_agent, replace_existing_device)
        return self._response(
            {
                "token": token,
                "user_id": user.id,
                "phone": user.phone,
                "role": user.role,
                "expire_at": user.expire_at.isoformat() if user.expire_at else None,
                "registered": user is not None,
            }
        )

    def register(self, phone: str, password: str, code: str) -> Dict[str, Any]:
        self._ensure_phone(phone)
        self._ensure_password(password)
        if not code:
            raise ValueError("Verification code required")
        stored_code = self.verification_cache.get(self._verification_key(phone))
        if stored_code != code:
            raise ValueError("Invalid verification code")
        if User.objects.filter(phone=phone).exists():
            raise ValueError("Phone already registered")

        with transaction.atomic():
            user = self._create_user(phone, password)
            self.verification_cache.delete(self._verification_key(phone))
        return self._response({"user_id": user.id})

    def login(
        self,
        phone: str,
        password: str,
        device_id: Any = "",
        device_type: Any = "",
        user_agent: str = "",
        replace_existing_device: bool = False,
    ) -> Dict[str, Any]:
        self._ensure_phone(phone)
        user = self._get_user_by_phone(phone)
        if not self._verify_password(user, password):
            raise ValueError("Incorrect password")
        user = self._apply_plus_whitelist(user)
        token = self._start_user_session(user, device_id, device_type, user_agent, replace_existing_device)
        return self._response(
            {
                "token": token,
                "user_id": user.id,
                "phone": user.phone,
                "role": user.role,
                "expire_at": user.expire_at.isoformat() if user.expire_at else None,
            }
        )

    def verify_token(self, token: str) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        return self._response({"user_id": user.id, "phone": user.phone, "role": user.role})

    def logout(self, token: str) -> Dict[str, Any]:
        if not token:
            raise ValueError("Token required")
        cached = self.token_cache.get(token)
        now = timezone.now()
        session_id = cached.get("session_id") if isinstance(cached, dict) else None
        if session_id is None:
            # Cache miss (e.g. after a restart): find the session in the DB so
            # logout still revokes it and it cannot be recovered afterwards.
            session = self._find_active_session_by_token(token, now)
            if session is not None:
                session_id = session.id
        if session_id:
            self._revoke_user_sessions(
                UserSession.objects.filter(id=session_id, status=UserSession.STATUS_ACTIVE),
                "logout",
                now,
            )
        self.token_cache.delete(token)
        return self._response({"logged_out": True})

    # -------------------- User Module --------------------
    def profile(self, token: str) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        return self._response(
            {
                "user_id": user.id,
                "phone": user.phone,
                "role": user.role,
                "expire_at": user.expire_at.isoformat() if user.expire_at else None,
                "created_at": user.created_at.isoformat(),
            }
        )

    def create_payment(self, token: str, target_role: str, provider: str | None = None, base_url: str | None = None) -> Dict[str, Any]:
        # Only Plus plan is supported
        if target_role != User.ROLE_PLUS:
            raise ValueError("Only Plus plan is available")
        if target_role not in self.PLAN_PRICING:
            raise ValueError("Unsupported target role")
        user = self._get_user_by_token(token)
        # Only allow upgrade from Free to Plus
        if user.role != User.ROLE_FREE:
            raise ValueError("Upgrade is only available for Free users")
        plan = self.PLAN_PRICING[target_role]
        # Only Alipay is supported
        normalized_provider = (provider or "alipay").lower()
        if normalized_provider != "alipay":
            raise ValueError("Only Alipay is supported")

        is_dev = getattr(settings, "DEBUG", False)
        dev_amount = getattr(settings, "PAYMENT_DEV_AMOUNT_CENTS", 1)
        amount_cents = dev_amount if is_dev else plan["amount_cents"]
        amount_yuan = amount_cents / 100

        payment_id = self._generate_payment_id()
        pay_code = f"PAY-{normalized_provider}-{secrets.token_hex(6)}"

        checkout_url = None
        if normalized_provider == "alipay":
            alipay = get_alipay()
            if alipay.is_configured():
                base = base_url or "http://localhost:8000"
                notify_url = f"{base}/api/v1/payment/alipay/notify"
                return_url = f"{base}/plans/?payment_id={payment_id}"
                checkout_url = alipay.create_page_pay(
                    out_trade_no=payment_id,
                    total_amount=f"{amount_yuan:.2f}",
                    subject=plan.get("description", f"RobotCloud {target_role} Plan"),
                    return_url=return_url,
                    notify_url=notify_url,
                )

        if not checkout_url:
            checkout_url = f"https://pay.robotcloud.local/{normalized_provider}/{pay_code}"

        payment = Payment.objects.create(
            payment_id=payment_id,
            user=user,
            target_role=target_role,
            amount_cents=amount_cents,
            currency=plan["currency"],
            provider=normalized_provider,
            description=plan.get("description", ""),
            metadata={
                "display_amount": amount_cents,
                "currency": plan["currency"],
                "pay_code": pay_code,
                "checkout_url": checkout_url,
            },
        )
        payload = self._payment_to_dict(payment)
        return self._response(payload)

    def payment_status(self, token: str, payment_id: str) -> Dict[str, Any]:
        if not payment_id:
            raise ValueError("Payment id required")
        user = self._get_user_by_token(token)
        try:
            payment = Payment.objects.get(payment_id=payment_id, user=user)
        except Payment.DoesNotExist:
            raise ValueError("Payment not found")
        return self._response(self._payment_to_dict(payment))

    def mock_payment_callback(self, token: str, payment_id: str, status_value: str) -> Dict[str, Any]:
        actor = self._get_user_by_token(token)
        if not getattr(settings, "DEBUG", False):
            raise PermissionError("Mock payment callback is disabled")
        if not payment_id:
            raise ValueError("Payment id required")
        if status_value not in {
            Payment.STATUS_SUCCEEDED,
            Payment.STATUS_FAILED,
            Payment.STATUS_CANCELED,
        }:
            raise ValueError("Invalid payment status")
        try:
            payment = Payment.objects.get(payment_id=payment_id)
        except Payment.DoesNotExist:
            raise ValueError("Payment not found")
        if payment.user_id != actor.id and actor.role != User.ROLE_ADMIN:
            raise PermissionError("Payment does not belong to user")
        if payment.status == Payment.STATUS_SUCCEEDED:
            return self._response(self._payment_to_dict(payment))

        # Update payment status and auto-apply upgrade if succeeded
        with transaction.atomic():
            payment.status = status_value
            if status_value == Payment.STATUS_SUCCEEDED:
                payment.applied_at = timezone.now()
            payment.save(update_fields=["status", "applied_at", "updated_at"])

            # Auto upgrade user role if payment succeeded
            if status_value == Payment.STATUS_SUCCEEDED:
                user = payment.user
                if user.role == User.ROLE_FREE and payment.target_role == User.ROLE_PLUS:
                    user.role = payment.target_role
                    user.expire_at = timezone.now() + timedelta(days=30)
                    user.save(update_fields=["role", "expire_at"])

        return self._response(self._payment_to_dict(payment))

    def alipay_notify(self, data: Dict[str, str]) -> bool:
        """Handle Alipay async notification callback."""
        out_trade_no = data.get("out_trade_no", "")
        trade_status = data.get("trade_status", "")

        alipay = get_alipay()
        if alipay.is_configured():
            if not data.get("sign") or not alipay.verify_notify(data):
                logger.warning("Rejected Alipay notify: invalid signature for out_trade_no=%s", out_trade_no)
                return False
        elif not getattr(settings, "DEBUG", False):
            logger.warning("Rejected Alipay notify: Alipay is not configured")
            return False

        if not out_trade_no:
            logger.warning("Rejected Alipay notify: missing out_trade_no")
            return False

        if trade_status not in {"TRADE_SUCCESS", "TRADE_FINISHED"}:
            return True

        try:
            payment = Payment.objects.get(payment_id=out_trade_no)
        except Payment.DoesNotExist:
            logger.warning("Rejected Alipay notify: payment not found for out_trade_no=%s", out_trade_no)
            return False

        if payment.status == Payment.STATUS_SUCCEEDED:
            return True

        total_amount = data.get("total_amount", "0")
        try:
            total_cents = int(float(total_amount) * 100)
        except (ValueError, TypeError):
            total_cents = 0

        if total_cents > 0 and total_cents != payment.amount_cents:
            logger.warning(
                "Rejected Alipay notify: amount mismatch for out_trade_no=%s expected=%s actual=%s",
                out_trade_no,
                payment.amount_cents,
                total_cents,
            )
            return False

        # Update payment status and auto-apply upgrade
        with transaction.atomic():
            payment.status = Payment.STATUS_SUCCEEDED
            payment.applied_at = timezone.now()
            payment.save(update_fields=["status", "applied_at", "updated_at"])

            # Auto upgrade user role
            user = payment.user
            if user.role == User.ROLE_FREE and payment.target_role == User.ROLE_PLUS:
                user.role = payment.target_role
                user.expire_at = timezone.now() + timedelta(days=30)
                user.save(update_fields=["role", "expire_at"])

        return True

    def alipay_query(self, token: str, payment_id: str) -> Dict[str, Any]:
        """Query Alipay order status and update local payment record."""
        if not payment_id:
            raise ValueError("Payment id required")
        user = self._get_user_by_token(token)
        try:
            payment = Payment.objects.get(payment_id=payment_id, user=user)
        except Payment.DoesNotExist:
            raise ValueError("Payment not found")

        if payment.status == Payment.STATUS_SUCCEEDED:
            # Payment already succeeded, ensure user role is upgraded
            if user.role == User.ROLE_FREE and payment.target_role == User.ROLE_PLUS:
                with transaction.atomic():
                    user.role = payment.target_role
                    user.expire_at = timezone.now() + timedelta(days=30)
                    user.save(update_fields=["role", "expire_at"])
                    if not payment.applied_at:
                        payment.applied_at = timezone.now()
                        payment.save(update_fields=["applied_at", "updated_at"])
            return self._response(self._payment_to_dict(payment))

        alipay = get_alipay()
        if alipay.is_configured():
            result = alipay.query_order(payment_id)
            if result:
                trade_status = result.get("trade_status", "")
                if trade_status in {"TRADE_SUCCESS", "TRADE_FINISHED"}:
                    # Update payment status and auto-apply upgrade (same as alipay_notify)
                    with transaction.atomic():
                        payment.status = Payment.STATUS_SUCCEEDED
                        payment.applied_at = timezone.now()
                        payment.save(update_fields=["status", "applied_at", "updated_at"])

                        # Auto upgrade user role
                        if user.role == User.ROLE_FREE and payment.target_role == User.ROLE_PLUS:
                            user.role = payment.target_role
                            user.expire_at = timezone.now() + timedelta(days=30)
                            user.save(update_fields=["role", "expire_at"])

        return self._response(self._payment_to_dict(payment))

    def upgrade(self, token: str, target_role: str, payment_id: str) -> Dict[str, Any]:
        # Only Plus plan is supported
        if target_role != User.ROLE_PLUS:
            raise ValueError("Only Plus plan is available")
        user = self._get_user_by_token(token)
        if not payment_id:
            raise ValueError("Payment id required")
        try:
            payment = Payment.objects.get(payment_id=payment_id)
        except Payment.DoesNotExist:
            raise ValueError("Payment not found")
        if payment.user_id != user.id:
            raise PermissionError("Payment does not belong to user")
        if payment.status != Payment.STATUS_SUCCEEDED:
            raise ValueError("Payment not completed")
        if payment.target_role != target_role:
            raise ValueError("Payment does not match target role")
        # Allow idempotent upgrade if user is already on target role
        if user.role != User.ROLE_FREE:
            if user.role == target_role:
                if not payment.applied_at:
                    payment.applied_at = timezone.now()
                    payment.save(update_fields=["applied_at", "updated_at"])
                return self._response(
                    {"role": user.role, "expire_at": user.expire_at.isoformat() if user.expire_at else None}
                )
            raise ValueError("Upgrade is only available for Free users")
        if payment.applied_at:
            if user.role != target_role:
                user.role = target_role
                user.expire_at = timezone.now() + timedelta(days=30)
                user.save(update_fields=["role", "expire_at"])
            return self._response({"role": user.role, "expire_at": user.expire_at.isoformat() if user.expire_at else None})
        # Activate Plus subscription for 30 days
        user.role = target_role
        user.expire_at = timezone.now() + timedelta(days=30)
        with transaction.atomic():
            user.save(update_fields=["role", "expire_at"])
            payment.applied_at = timezone.now()
            payment.save(update_fields=["applied_at", "updated_at"])
        return self._response({"role": user.role, "expire_at": user.expire_at.isoformat()})

    def usage(self, token: str) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        training_count = user.train_tasks.count()
        inference_count = user.inference_tasks.count()
        return self._response({"training": training_count, "inference": inference_count})

    def user_settings(self, token: str) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        return self._response({"default_agent_node": user.default_agent_node})

    def update_user_settings(self, token: str, default_agent_node: str) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        node_name = (default_agent_node or "").strip()
        if node_name:
            self._select_upload_agent(node_name)
        user.default_agent_node = node_name
        user.save(update_fields=["default_agent_node"])
        return self._response({"default_agent_node": user.default_agent_node})

    def list_active_agents(self, token: str) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        items = [self._agent_to_dict(node, user.default_agent_node) for node in self._active_agent_queryset()]
        return self._response({"items": items, "total": len(items), "default_agent_node": user.default_agent_node})

    # -------------------- Dataset Module --------------------
    def upload_dataset(
        self,
        token: str,
        uploaded_file: Any,
        name: str,
        description: str,
        visibility: str,
    ) -> Dict[str, Any]:
        if visibility not in {Dataset.VISIBILITY_PRIVATE, Dataset.VISIBILITY_PUBLIC}:
            raise ValueError("Invalid visibility")
        if not name:
            raise ValueError("Dataset name required")
        if uploaded_file is None:
            raise ValueError("Dataset file required")
        user = self._get_user_by_token(token)
        dataset = Dataset.objects.create(
            name=name,
            description=description or "",
            owner=user,
            storage_path="",
            storage_backend=Dataset.STORAGE_BACKEND_LOCAL,
            storage_node="",
            visibility=visibility,
            status=Dataset.STATUS_PROCESSING,
            metadata={},
        )
        try:
            file_path = self._write_dataset_file(dataset, uploaded_file)
        except ValueError:
            dataset.delete()
            raise
        metadata = self._compute_dataset_metadata(dataset, file_path)
        dataset.storage_path = str(self._relative_storage_path(file_path))
        dataset.content_md5 = self._md5_of_file(file_path)
        dataset.file_size = int(metadata.get("file_size") or 0)
        dataset.original_filename = str(metadata.get("file_name") or "")
        dataset.status = Dataset.STATUS_READY
        dataset.metadata = metadata
        dataset.save(
            update_fields=[
                "storage_path",
                "content_md5",
                "file_size",
                "original_filename",
                "status",
                "metadata",
            ]
        )
        return self._response(
            {
                "dataset_id": dataset.id,
                "status": dataset.status,
                "file_name": metadata["file_name"],
                "file_size": metadata["file_size"],
                "total_files": metadata["total_files"],
            }
        )

    def create_dataset_upload_session(
        self,
        token: str,
        name: str,
        description: str,
        visibility: str,
        filename: str,
        target_node: str = "",
    ) -> Dict[str, Any]:
        if visibility not in {Dataset.VISIBILITY_PRIVATE, Dataset.VISIBILITY_PUBLIC}:
            raise ValueError("Invalid visibility")
        if not name:
            raise ValueError("Dataset name required")
        if not filename:
            raise ValueError("Dataset filename required")
        user = self._get_user_by_token(token)
        requested_node = (target_node or "").strip()
        if not requested_node and user.default_agent_node:
            node = self._upload_capable_agent_queryset().filter(node_name=user.default_agent_node).first()
            if not node:
                node = self._select_upload_agent("")
        else:
            node = self._select_upload_agent(requested_node)
        safe_filename = self._sanitize_filename(filename, f"dataset_{secrets.token_hex(4)}.zip")
        upload_token = self._generate_dataset_upload_token()
        expires_at = timezone.now() + timedelta(seconds=self.dataset_upload_session_timeout)
        metadata = {
            "upload_session": {
                "token_hash": self._hash_upload_token(upload_token),
                "node_name": node.node_name,
                "filename": safe_filename,
                "expires_at": expires_at.isoformat(),
                "owner_id": user.id,
            },
            "file_name": safe_filename,
            "file_size": 0,
            "total_files": 0,
            "by_type": {},
            "preview": [],
        }
        dataset = Dataset.objects.create(
            name=name,
            description=description or "",
            owner=user,
            storage_path="",
            storage_backend=Dataset.STORAGE_BACKEND_AGENT,
            storage_node=node.node_name,
            visibility=visibility,
            status=Dataset.STATUS_PROCESSING,
            metadata=metadata,
            original_filename=safe_filename,
        )
        upload_url = f"{node.public_base_url.rstrip('/')}/api/v1/agent/datasets/upload"
        return self._response(
            {
                "dataset_id": dataset.id,
                "status": dataset.status,
                "upload_url": upload_url,
                "upload_token": upload_token,
                "expires_at": expires_at.isoformat(),
                "expires_in": self.dataset_upload_session_timeout,
                "chunk_size": self.dataset_upload_chunk_size,
                "node_name": node.node_name,
                "file_name": safe_filename,
            }
        )

    def verify_dataset_upload(self, token: str, dataset_id: int, upload_token: str) -> Dict[str, Any]:
        node = self._get_worker_by_token(token)
        dataset = self._get_dataset(dataset_id)
        if dataset.storage_backend != Dataset.STORAGE_BACKEND_AGENT:
            raise ValueError("Dataset is not configured for agent upload")
        session = self._get_dataset_upload_session(dataset, upload_token)
        if session.get("node_name") != node.node_name or dataset.storage_node != node.node_name:
            raise ValueError("Upload session belongs to a different agent")
        return self._response(
            {
                "dataset_id": dataset.id,
                "node_name": node.node_name,
                "file_name": session.get("filename") or dataset.original_filename,
                "owner_id": dataset.owner_id,
            }
        )

    def _completed_dataset_upload_response(self, dataset: Dataset) -> Dict[str, Any]:
        metadata = dataset.metadata if isinstance(dataset.metadata, dict) else {}
        file_name = str(metadata.get("file_name") or dataset.original_filename or "")
        try:
            metadata_file_size = int(metadata.get("file_size") or 0)
        except (TypeError, ValueError):
            metadata_file_size = 0
        try:
            total_files = int(metadata.get("total_files") or 1)
        except (TypeError, ValueError):
            total_files = 1
        return self._response(
            {
                "dataset_id": dataset.id,
                "status": dataset.status,
                "file_name": file_name,
                "file_size": dataset.file_size or metadata_file_size,
                "total_files": total_files,
                "storage_node": dataset.storage_node,
            }
        )

    def complete_dataset_upload(
        self,
        token: str,
        dataset_id: int,
        upload_token: str,
        storage_path: str,
        content_md5: str,
        file_size: int,
        metadata: Dict[str, Any],
    ) -> Dict[str, Any]:
        node = self._get_worker_by_token(token)
        dataset = self._get_dataset(dataset_id)
        if dataset.storage_backend != Dataset.STORAGE_BACKEND_AGENT:
            raise ValueError("Dataset is not configured for agent upload")
        clean_content_md5 = (content_md5 or "").strip().lower()[:32]
        try:
            requested_size = max(int(file_size), 0)
        except (TypeError, ValueError):
            requested_size = 0
        if dataset.status == Dataset.STATUS_READY:
            if dataset.storage_node != node.node_name:
                raise ValueError("Upload session belongs to a different agent")
            if storage_path and dataset.storage_path and storage_path != dataset.storage_path:
                raise ValueError("Dataset upload already completed with a different storage path")
            if requested_size and dataset.file_size and requested_size != dataset.file_size:
                raise ValueError("Dataset upload already completed with a different file size")
            if clean_content_md5 and dataset.content_md5 and clean_content_md5 != dataset.content_md5:
                raise ValueError("Dataset upload already completed with a different md5")
            return self._completed_dataset_upload_response(dataset)
        session = self._get_dataset_upload_session(dataset, upload_token)
        if session.get("node_name") != node.node_name or dataset.storage_node != node.node_name:
            raise ValueError("Upload session belongs to a different agent")
        if not storage_path:
            raise ValueError("storage_path required")
        clean_metadata = metadata if isinstance(metadata, dict) else {}
        file_name = str(clean_metadata.get("file_name") or session.get("filename") or dataset.original_filename)
        if requested_size:
            normalized_size = requested_size
        else:
            try:
                normalized_size = int(clean_metadata.get("file_size") or 0)
            except (TypeError, ValueError):
                normalized_size = 0
        clean_metadata["file_name"] = file_name
        clean_metadata["file_size"] = normalized_size
        clean_metadata["total_files"] = int(clean_metadata.get("total_files") or 1)
        if not isinstance(clean_metadata.get("by_type"), dict):
            clean_metadata["by_type"] = {}
        if not isinstance(clean_metadata.get("preview"), list):
            clean_metadata["preview"] = []
        dataset.storage_path = storage_path
        dataset.content_md5 = (content_md5 or "").strip().lower()[:32]
        dataset.file_size = normalized_size
        dataset.original_filename = file_name
        dataset.metadata = clean_metadata
        dataset.status = Dataset.STATUS_READY
        dataset.save(
            update_fields=[
                "storage_path",
                "content_md5",
                "file_size",
                "original_filename",
                "metadata",
                "status",
            ]
        )
        return self._completed_dataset_upload_response(dataset)

    def list_datasets(self, token: str, visibility: Optional[str], page: int, size: int) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        from django.db.models import Q
        # Show public datasets and user's own private datasets
        queryset = Dataset.objects.filter(
            Q(visibility=Dataset.VISIBILITY_PUBLIC) | Q(owner=user)
        ).order_by("-created_at")
        if visibility:
            queryset = queryset.filter(visibility=visibility)
        total = queryset.count()
        start = (page - 1) * size
        items = [self._dataset_to_dict(d) for d in queryset[start : start + size]]
        return self._response({"items": items, "total": total})

    def get_dataset(self, token: str, dataset_id: int) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        dataset = self._get_dataset_for_user(user, dataset_id)
        return self._response(self._dataset_to_dict(dataset))

    def dataset_stats(self, token: str, dataset_id: int) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        dataset = self._get_dataset_for_user(user, dataset_id)
        metadata = self._ensure_dataset_metadata(dataset)
        return self._response(
            {
                "dataset_id": dataset.id,
                "status": dataset.status,
                "file_size": metadata.get("file_size", 0),
                "total_files": metadata.get("total_files", 0),
                "by_type": metadata.get("by_type", {}),
            }
        )

    def dataset_preview(self, token: str, dataset_id: int) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        dataset = self._get_dataset_for_user(user, dataset_id)
        if dataset.status != Dataset.STATUS_READY:
            return self._response({"dataset_id": dataset.id, "preview": []})
        metadata = self._ensure_dataset_metadata(dataset)
        preview = self._build_preview_payload(dataset, metadata)
        return self._response({"dataset_id": dataset.id, "preview": preview})

    def delete_dataset(self, token: str, dataset_id: int) -> Dict[str, Any]:
        """Delete a dataset that belongs to the current user.

        Only datasets with no associated training tasks can be deleted.
        This removes the database record and the storage file.
        """
        user = self._get_user_by_token(token)
        dataset = self._get_dataset(dataset_id)
        if dataset.owner_id != user.id:
            raise PermissionError("You do not own this dataset")
        # Check if there are any training tasks using this dataset
        if dataset.train_tasks.exists():
            raise ValueError("Cannot delete dataset with associated training tasks")
        if dataset.storage_path and dataset.storage_backend == Dataset.STORAGE_BACKEND_LOCAL:
            storage_file = self._dataset_file_path(dataset)
            if storage_file.exists() and storage_file.is_file():
                storage_file.unlink()
        elif dataset.storage_path and dataset.storage_backend == Dataset.STORAGE_BACKEND_AGENT and dataset.storage_node:
            node = WorkerNode.objects.filter(node_name=dataset.storage_node).first()
            if node:
                url = f"http://{node.ip}:{node.api_port}/api/v1/agent/delete_model"
                headers = {"Content-Type": "application/json", "X-Agent-Token": node.auth_token}
                try:
                    requests.post(url, json={"paths": [dataset.storage_path]}, headers=headers, timeout=5)
                except Exception:
                    pass
        elif dataset.storage_backend == Dataset.STORAGE_BACKEND_AGENT:
            self._delete_agent_dataset_upload_session(dataset)
        dataset.delete()
        return self._response({"deleted": True})

    # -------------------- Training Module --------------------
    def create_training_task(
        self,
        token: str,
        dataset_id: int,
        model_type: str,
        params: Dict[str, Any],
        job_name: str = "",
    ) -> Dict[str, Any]:
        if not model_type:
            raise ValueError("Model type required")
        model_type = _canonical_model_type(model_type)
        job_name = str(job_name or "").strip()[:128]
        user = self._get_user_by_token(token)
        if not self._has_no_limits(user):
            completed_models = user.train_tasks.filter(status="completed").count()
            if completed_models >= 5:
                raise ValueError("Saved model limit reached (5)")
        dataset = self._get_dataset_for_user(user, dataset_id)
        if dataset.status != Dataset.STATUS_READY:
            raise ValueError("Dataset is not ready")
        with transaction.atomic():
            task = TrainTask.objects.create(
                dataset=dataset,
                user=user,
                job_name=job_name,
                model_type=model_type,
                params=params or {},
                status="queued",
                progress=0.0,
                logs_url="",
                priority=self._priority_for_role(user.role),
                queue_position=0,
            )
            task.logs_url = f"/storage/train_logs/{task.id}.log"
            task.save(update_fields=["logs_url"])
            self._refresh_queue_positions()
        return self._response({"task_id": task.id, "status": task.status})

    def list_training_tasks(self, token: str, page: int, size: int) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        queryset = user.train_tasks.all().order_by("-created_at")
        total = queryset.count()
        start = (page - 1) * size
        items = [self._training_to_dict(t) for t in queryset[start : start + size]]
        return self._response({"items": items, "total": total})

    def training_status(self, token: str, task_id: int) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        task = self._get_train_task(task_id, user)
        return self._response(self._training_to_dict(task))

    def stop_training(self, token: str, task_id: int) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        task = self._get_train_task(task_id, user)
        previous_status = task.status
        task.status = "failed"
        task.progress = 0.0
        task.save(update_fields=["status", "progress"])
        if previous_status == "running":
            self._release_worker_slot(task)
        self._refresh_queue_positions()
        return self._response({"task_id": task.id, "status": task.status})

    def download_model(self, token: str, task_id: int) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        task = self._get_train_task(task_id, user)
        if not task.model_path:
            task.model_path = f"/storage/models/{task.id}.pt"
            task.save(update_fields=["model_path"])
        return self._response({"task_id": task.id, "model_path": task.model_path})

    def training_logs(self, token: str, task_id: int, offset: int, limit: int) -> Dict[str, Any]:
        """Proxy log chunks from the assigned agent.

        Returns a JSON payload containing:
          - content: string chunk
          - next_offset: next byte offset to continue reading from
          - complete: whether the job finished and EOF was reached
        """
        user = self._get_user_by_token(token)
        task = self._get_train_task(task_id, user)
        if not task.assigned_node:
            # Not yet assigned; no logs available
            return self._response({"content": "", "next_offset": max(offset, 0), "complete": False})
        try:
            node = WorkerNode.objects.get(node_name=task.assigned_node)
        except WorkerNode.DoesNotExist:
            return self._response({"content": "", "next_offset": max(offset, 0), "complete": False})

        url = f"http://{node.ip}:{node.api_port}/api/v1/agent/logs"
        headers = {"X-Agent-Token": node.auth_token, "Content-Type": "application/json"}
        params = {"task_id": task_id, "offset": max(offset, 0), "limit": max(limit, 1)}
        try:
            response = requests.get(url, headers=headers, params=params, timeout=5)
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, dict):
                raise ValueError("Invalid agent response")
            content = str(data.get("content", ""))
            next_offset = int(data.get("next_offset", params["offset"]))
            complete = bool(data.get("complete", False))
            return self._response({"content": content, "next_offset": next_offset, "complete": complete})
        except Exception:
            # Graceful fallback to avoid breaking the UI if agent is offline
            return self._response({"content": "", "next_offset": max(offset, 0), "complete": False})

    def delete_training_task(self, token: str, task_id: int) -> Dict[str, Any]:
        """Delete a training task that belongs to the current user.

        Only non-running tasks can be deleted. Users should stop a running task first.
        This removes the database record and refreshes queue positions for remaining
        queued tasks.
        """
        user = self._get_user_by_token(token)
        task = self._get_train_task(task_id, user)
        if task.status == "running":
            raise ValueError("Cannot delete a running task; please stop it first")
        with transaction.atomic():
            task.delete()
            self._refresh_queue_positions()
        return self._response({"deleted": True})

    # -------------------- Scheduler Internal Module --------------------
    def register_agent(
        self,
        node_name: str,
        ip: str,
        gpu_total: int,
        version: str,
        api_port: int,
        public_base_url: str = "",
        upload_enabled: bool = True,
        gpu_slot_total: Optional[int] = None,
    ) -> Dict[str, Any]:
        if not node_name:
            raise ValueError("Node name required")
        if not ip:
            raise ValueError("Agent IP required")
        if gpu_total <= 0:
            raise ValueError("GPU total must be positive")
        if api_port <= 0:
            raise ValueError("Agent port must be positive")
        public_base_url = self._normalize_public_base_url(public_base_url)
        slot_total = self._normalize_gpu_slot_total(gpu_total, gpu_slot_total)
        now = timezone.now()
        with transaction.atomic():
            node, created = WorkerNode.objects.select_for_update().get_or_create(
                node_name=node_name,
                defaults={
                    "ip": ip,
                    "gpu_total": gpu_total,
                    "gpu_busy": 0,
                    "gpu_free": gpu_total,
                    "gpu_slot_total": slot_total,
                    "gpu_slot_busy": 0,
                    "gpu_slot_free": slot_total,
                    "version": version or "",
                    "auth_token": self._generate_agent_token(),
                    "status": WorkerNode.STATUS_ONLINE,
                    "last_heartbeat": now,
                    "api_port": api_port,
                    "public_base_url": public_base_url,
                    "upload_enabled": bool(upload_enabled),
                },
            )
            if not created:
                node.ip = ip
                node.gpu_total = gpu_total
                node.gpu_busy = min(node.gpu_busy, gpu_total)
                node.gpu_free = max(gpu_total - node.gpu_busy, 0)
                node.gpu_slot_total = slot_total
                node.gpu_slot_busy = min(node.gpu_slot_busy, slot_total)
                node.gpu_slot_free = max(slot_total - node.gpu_slot_busy, 0)
                node.version = version or ""
                node.status = WorkerNode.STATUS_ONLINE
                node.last_heartbeat = now
                node.api_port = api_port
                node.public_base_url = public_base_url
                node.upload_enabled = bool(upload_enabled)
                node.save(
                    update_fields=[
                        "ip",
                        "gpu_total",
                        "gpu_busy",
                        "gpu_free",
                        "gpu_slot_total",
                        "gpu_slot_busy",
                        "gpu_slot_free",
                        "version",
                        "status",
                        "last_heartbeat",
                        "api_port",
                        "public_base_url",
                        "upload_enabled",
                        "updated_at",
                    ]
                )
            token = node.auth_token
        return self._response(
            {
                "agent_id": node.node_name,
                "token": token,
                "gpu_total": node.gpu_total,
                "gpu_slot_total": node.gpu_slot_total,
                "api_port": node.api_port,
                "public_base_url": node.public_base_url,
                "upload_enabled": node.upload_enabled,
            }
        )

    def agent_heartbeat(
        self,
        token: str,
        gpu_total: int,
        gpu_free: Any,
        gpu_busy: Any,
        version: Optional[str] = None,
        gpu_slot_total: Any = None,
        gpu_slot_free: Any = None,
        gpu_slot_busy: Any = None,
    ) -> Dict[str, Any]:
        node = self._get_worker_by_token(token)
        now = timezone.now()
        if gpu_total > 0:
            node.gpu_total = gpu_total
        node.gpu_slot_total = self._normalize_gpu_slot_total(node.gpu_total, gpu_slot_total or node.gpu_slot_total)
        free_count = self._normalize_gpu_payload(gpu_free)
        busy_count = self._normalize_gpu_payload(gpu_busy)
        if busy_count > node.gpu_total:
            busy_count = node.gpu_total
        if free_count > node.gpu_total:
            free_count = node.gpu_total
        slot_free_count = self._normalize_gpu_payload(gpu_slot_free)
        slot_busy_count = busy_count if gpu_slot_busy is None else self._normalize_gpu_payload(gpu_slot_busy)
        if slot_busy_count > node.gpu_slot_total:
            slot_busy_count = node.gpu_slot_total
        if slot_free_count > node.gpu_slot_total:
            slot_free_count = node.gpu_slot_total
        node.gpu_busy = busy_count
        node.gpu_free = max(node.gpu_total - busy_count, 0) if free_count == 0 else free_count
        node.gpu_slot_busy = slot_busy_count
        node.gpu_slot_free = max(node.gpu_slot_total - slot_busy_count, 0) if slot_free_count == 0 else slot_free_count
        node.last_heartbeat = now
        node.status = WorkerNode.STATUS_ONLINE
        if version is not None:
            node.version = version
        node.save(
            update_fields=[
                "gpu_total",
                "gpu_busy",
                "gpu_free",
                "gpu_slot_total",
                "gpu_slot_busy",
                "gpu_slot_free",
                "last_heartbeat",
                "status",
                "version",
                "updated_at",
            ]
        )
        return self._response({"status": "ok", "node": node.node_name})

    def agent_update_training(
        self,
        token: str,
        task_id: int,
        status_value: str,
        progress_value: Optional[float],
        metrics: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        if status_value not in {"queued", "running", "completed", "failed"}:
            raise ValueError("Invalid training status")
        node = self._get_worker_by_token(token)
        try:
            task = TrainTask.objects.get(id=task_id)
        except TrainTask.DoesNotExist as exc:
            raise ValueError("Training task not found") from exc
        if task.assigned_node and task.assigned_node != node.node_name:
            raise ValueError("Task assigned to different node")
        previous_status = task.status
        update_fields = []
        task.status = status_value
        update_fields.append("status")
        if progress_value is not None:
            task.progress = max(0.0, min(1.0, float(progress_value)))
            update_fields.append("progress")
        if metrics:
            params = task.params or {}
            metrics_payload = params.get("metrics", {})
            if not isinstance(metrics_payload, dict):
                metrics_payload = {}
            metrics_payload.update(metrics)
            params["metrics"] = metrics_payload
            task.params = params
            update_fields.append("params")
            checkpoint_path = metrics.get("checkpoint_path") if isinstance(metrics, dict) else None
            if checkpoint_path and isinstance(checkpoint_path, str):
                task.checkpoint_path = checkpoint_path
                update_fields.append("checkpoint_path")
            output_dir = metrics.get("output_dir") if isinstance(metrics, dict) else None
            if not task.checkpoint_path and isinstance(output_dir, str) and output_dir:
                task.checkpoint_path = str(Path(output_dir) / "checkpoints" / "last" / "pretrained_model")
                update_fields.append("checkpoint_path")
        task.save(update_fields=update_fields)
        if previous_status == "running" and status_value in {"completed", "failed"}:
            self._release_worker_slot(task)
        node.last_heartbeat = timezone.now()
        node.status = WorkerNode.STATUS_ONLINE
        node.save(update_fields=["last_heartbeat", "status", "updated_at"])
        self._refresh_queue_positions()
        return self._response({"task_id": task.id, "status": task.status, "progress": task.progress})

    def agent_update_inference(
        self,
        token: str,
        task_id: int,
        status_value: str,
        progress_value: Optional[float],
        server_host: Optional[str] = None,
        server_port: Optional[int] = None,
        error_message: Optional[str] = None,
    ) -> Dict[str, Any]:
        if status_value not in {"queued", "running", "completed", "failed"}:
            raise ValueError("Invalid inference status")
        node = self._get_worker_by_token(token)
        try:
            task = InferenceTask.objects.get(id=task_id)
        except InferenceTask.DoesNotExist as exc:
            raise ValueError("Inference task not found") from exc
        if task.assigned_node and task.assigned_node != node.node_name:
            raise ValueError("Task assigned to different node")
        previous_status = task.status
        update_fields = []
        task.status = status_value
        update_fields.append("status")
        if progress_value is not None:
            task.progress = max(0.0, min(1.0, float(progress_value)))
            update_fields.append("progress")
        if server_host:
            task.server_host = server_host
            update_fields.append("server_host")
        if server_port is not None:
            task.server_port = int(server_port)
            update_fields.append("server_port")
        if error_message:
            task.error_message = error_message
            update_fields.append("error_message")
        if status_value == "running" and task.started_at is None:
            task.started_at = timezone.now()
            update_fields.append("started_at")
        if status_value in {"completed", "failed"}:
            task.finished_at = timezone.now()
            update_fields.append("finished_at")
        task.save(update_fields=update_fields)
        if previous_status == "running" and status_value in {"completed", "failed"}:
            self._release_inference_slot(task)
        node.last_heartbeat = timezone.now()
        node.status = WorkerNode.STATUS_ONLINE
        node.save(update_fields=["last_heartbeat", "status", "updated_at"])
        return self._response({"task_id": task.id, "status": task.status, "progress": task.progress})

    # -------------------- Inference Module --------------------
    def create_inference_task(self, token: str, model_id: int, dataset_id: Optional[int]) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        has_no_limits = self._has_no_limits(user)
        if user.role == User.ROLE_FREE and not has_no_limits:
            raise PermissionError("Inference is not available for free users")
        if model_id is None:
            raise ValueError("model_id required")
        if not has_no_limits:
            queued_count = user.inference_tasks.filter(status="queued").count()
            if queued_count >= 3:
                raise ValueError("Queued inference task limit reached (3)")
        dataset = self._get_dataset_for_user(user, dataset_id) if dataset_id is not None else None
        train_task = self._get_train_task(int(model_id), user)
        if train_task.status != "completed":
            raise ValueError("Training task is not completed")
        if not train_task.checkpoint_path:
            raise ValueError("Training task checkpoint not available")
        task = InferenceTask.objects.create(
            model_id=train_task.id,
            dataset=dataset,
            user=user,
            status="queued",
            checkpoint_path=train_task.checkpoint_path,
        )
        return self._response({"task_id": task.id, "status": task.status})

    def list_inference_tasks(self, token: str, page: int, size: int) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        queryset = user.inference_tasks.all().order_by("-created_at")
        total = queryset.count()
        start = (page - 1) * size
        tasks = list(queryset[start : start + size])
        model_types = self._inference_model_types(user, tasks)
        items = [self._inference_to_dict(task, model_types.get(task.model_id)) for task in tasks]
        return self._response({"items": items, "total": total})

    def inference_result(self, token: str, task_id: int) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        task = self._get_inference_task(task_id, user)
        return self._response(
            {
                "task_id": task.id,
                "model_type": self._inference_model_type(task),
                "status": task.status,
                "checkpoint_path": task.checkpoint_path,
                "server_host": task.server_host,
                "server_port": task.server_port,
                "result_path": task.result_path,
                "error_message": task.error_message,
            }
        )

    def inference_logs(self, token: str, task_id: int, offset: int, limit: int) -> Dict[str, Any]:
        """Proxy inference log chunks from the assigned agent."""
        user = self._get_user_by_token(token)
        task = self._get_inference_task(task_id, user)
        if not task.assigned_node:
            return self._response({"content": "", "next_offset": max(offset, 0), "complete": False})
        try:
            node = WorkerNode.objects.get(node_name=task.assigned_node)
        except WorkerNode.DoesNotExist:
            return self._response({"content": "", "next_offset": max(offset, 0), "complete": False})

        url = f"http://{node.ip}:{node.api_port}/api/v1/agent/inference_logs"
        headers = {"X-Agent-Token": node.auth_token, "Content-Type": "application/json"}
        params = {"task_id": task_id, "offset": max(offset, 0), "limit": max(limit, 1)}
        try:
            response = requests.get(url, headers=headers, params=params, timeout=5)
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, dict):
                raise ValueError("Invalid agent response")
            content = str(data.get("content", ""))
            next_offset = int(data.get("next_offset", params["offset"]))
            complete = bool(data.get("complete", False))
            return self._response({"content": content, "next_offset": next_offset, "complete": complete})
        except Exception:
            return self._response({"content": "", "next_offset": max(offset, 0), "complete": False})

    def close_inference_task(self, token: str, task_id: int) -> Dict[str, Any]:
        """Stop a running inference task and mark it completed."""
        user = self._get_user_by_token(token)
        task = self._get_inference_task(task_id, user)
        if task.status in {"completed", "failed"}:
            return self._response({"task_id": task.id, "status": task.status})
        stopped = False
        if task.assigned_node:
            stopped = self._stop_inference_on_agent(task)
        previous_status = task.status
        task.status = "completed"
        task.progress = 1.0
        task.finished_at = timezone.now()
        task.error_message = ""
        task.save(update_fields=["status", "progress", "finished_at", "error_message"])
        if previous_status == "running":
            self._release_inference_slot(task)
        return self._response({"task_id": task.id, "status": task.status, "stopped": stopped})

    def delete_inference_task(self, token: str, task_id: int) -> Dict[str, Any]:
        """Delete an inference task that belongs to the current user."""
        user = self._get_user_by_token(token)
        task = self._get_inference_task(task_id, user)
        if task.status in {"queued", "running"} and task.assigned_node:
            self._stop_inference_on_agent(task)
        task.delete()
        return self._response({"deleted": True})

    # -------------------- Simulation Module --------------------
    def create_simulation_task(
        self,
        token: str,
        scene_file: str,
        model_id: int,
        robot_type: str,
        training_mode: str,
    ) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        task = SimulationTask.objects.create(
            user=user,
            scene_file=scene_file,
            model_id=model_id,
            robot_type=robot_type,
            training_mode=training_mode,
            status="queued",
        )
        return self._response({"task_id": task.id, "status": task.status})

    def list_simulation_tasks(self, token: str, page: int, size: int) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        queryset = user.simulation_tasks.all().order_by("-created_at")
        total = queryset.count()
        start = (page - 1) * size
        items = [self._simulation_to_dict(t) for t in queryset[start : start + size]]
        return self._response({"items": items, "total": total})

    def simulation_status(self, token: str, task_id: int) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        task = self._get_simulation_task(task_id, user)
        if task.status == "queued":
            task.status = "running"
            task.save(update_fields=["status"])
        return self._response({"task_id": task.id, "status": task.status})

    def bind_device(self, token: str, device_sn: str, model_id: int) -> Dict[str, Any]:
        if not device_sn:
            raise ValueError("Device SN required")
        user = self._get_user_by_token(token)
        device = Device.objects.create(user=user, sn=device_sn, model_id=model_id)
        return self._response({"device_id": device.id, "sn": device.sn})

    # -------------------- Admin Module --------------------
    def admin_users(self, token: str, page: int, role: Optional[str]) -> Dict[str, Any]:
        admin = self._get_user_by_token(token)
        if admin.role != User.ROLE_ADMIN:
            raise PermissionError("Admin privileges required")
        queryset = User.objects.all().order_by("id")
        if role:
            queryset = queryset.filter(role=role)
        total = queryset.count()
        start = (page - 1) * 20
        items = [self._user_to_dict(u) for u in queryset[start : start + 20]]
        return self._response({"items": items, "total": total})

    def admin_review_dataset(self, token: str, dataset_id: int, status_value: str) -> Dict[str, Any]:
        admin = self._get_user_by_token(token)
        if admin.role != User.ROLE_ADMIN:
            raise PermissionError("Admin privileges required")
        dataset = self._get_dataset(dataset_id)
        dataset.status = status_value
        dataset.save(update_fields=["status"])
        AdminLog.objects.create(
            admin=admin,
            action="dataset_review",
            target_type="dataset",
            target_id=dataset.id,
        )
        return self._response({"dataset_id": dataset.id, "status": dataset.status})

    def admin_overview(self, token: str) -> Dict[str, Any]:
        admin = self._get_user_by_token(token)
        if admin.role != User.ROLE_ADMIN:
            raise PermissionError("Admin privileges required")
        return self._response(
            {
                "users": User.objects.count(),
                "datasets": Dataset.objects.count(),
                "train_tasks": TrainTask.objects.count(),
                "inference_tasks": InferenceTask.objects.count(),
                "simulation_tasks": SimulationTask.objects.count(),
            }
        )

    # -------------------- Model Module --------------------
    def list_models(self, token: str, page: int, size: int) -> Dict[str, Any]:
        """List completed training tasks as available models."""
        user = self._get_user_by_token(token)
        queryset = user.train_tasks.filter(status="completed").order_by("-created_at")
        total = queryset.count()
        start = (page - 1) * size
        items = [self._model_to_dict(t) for t in queryset[start : start + size]]
        return self._response({"items": items, "total": total})

    def get_model(self, token: str, model_id: int) -> Dict[str, Any]:
        """Get a single model (completed training task) by ID."""
        user = self._get_user_by_token(token)
        try:
            task = user.train_tasks.get(id=model_id, status="completed")
        except TrainTask.DoesNotExist as exc:
            raise ValueError("Model not found") from exc
        return self._response(self._model_to_dict(task, include_params=True))

    def delete_model(self, token: str, model_id: int) -> Dict[str, Any]:
        """Delete a completed training task that backs a model."""
        user = self._get_user_by_token(token)
        try:
            task = user.train_tasks.get(id=model_id, status="completed")
        except TrainTask.DoesNotExist as exc:
            raise ValueError("Model not found") from exc
        if task.assigned_node:
            node = WorkerNode.objects.filter(node_name=task.assigned_node).first()
            if node:
                paths: list[str] = []
                if task.checkpoint_path:
                    paths.append(task.checkpoint_path)
                if task.model_path:
                    paths.append(task.model_path)
                output_dir = None
                if isinstance(task.params, dict):
                    output_dir = task.params.get("output_dir")
                if isinstance(output_dir, str) and output_dir:
                    paths.append(output_dir)
                if paths:
                    url = f"http://{node.ip}:{node.api_port}/api/v1/agent/delete_model"
                    headers = {"Content-Type": "application/json", "X-Agent-Token": node.auth_token}
                    try:
                        response = requests.post(url, json={"paths": paths}, headers=headers, timeout=10)
                        response.raise_for_status()
                    except Exception as exc:
                        raise ValueError(f"Failed to delete model on agent: {exc}") from exc
        task.delete()
        return self._response({"deleted": True})

    def _model_to_dict(self, task: TrainTask, include_params: bool = False) -> Dict[str, Any]:
        """Convert a completed TrainTask to a model dict."""
        dataset = task.dataset
        result = {
            "model_id": task.id,
            "name": task.job_name
            or (
                f"{_canonical_model_type(task.model_type)}-{dataset.name}"
                if dataset
                else f"{_canonical_model_type(task.model_type)}-{task.id}"
            ),
            "model_type": _canonical_model_type(task.model_type),
            "dataset_id": task.dataset_id,
            "dataset_name": dataset.name if dataset else None,
            "model_path": task.model_path,
            "checkpoint_path": task.checkpoint_path,
            "created_at": task.created_at.isoformat(),
        }
        if include_params:
            result["params"] = task.params or {}
        return result

    # -------------------- Dashboard Module --------------------
    def dashboard_summary(self, token: str) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        train_tasks = list(user.train_tasks.all())
        inference_tasks = list(user.inference_tasks.all())
        datasets = list(user.datasets.all())
        active_training = sum(1 for t in train_tasks if t.status in {"queued", "running"})
        active_inference = sum(1 for t in inference_tasks if t.status in {"queued", "running"})
        gpu_hours = round(len(train_tasks) * 1.5 + len(inference_tasks) * 0.5, 1)
        return self._response(
            {
                "active_jobs": active_training + active_inference,
                "datasets": len(datasets),
                "tier": user.role,
                "gpu_hours": gpu_hours,
            }
        )

    # -------------------- Internal helpers --------------------
    def _create_user(self, phone: str, password: str) -> User:
        now = timezone.now()
        role = User.ROLE_PLUS if self._is_plus_whitelisted(phone) else User.ROLE_FREE
        return User.objects.create(
            phone=phone,
            password_hash=self._hash_password(password),
            role=role,
            expire_at=None if role == User.ROLE_PLUS else now + timedelta(days=30),
        )

    def _create_user_without_password(self, phone: str) -> User:
        """Create a user without password (for SMS code login)."""
        now = timezone.now()
        role = User.ROLE_PLUS if self._is_plus_whitelisted(phone) else User.ROLE_FREE
        return User.objects.create(
            phone=phone,
            password_hash="",
            role=role,
            expire_at=None if role == User.ROLE_PLUS else now + timedelta(days=30),
        )

    def _ensure_phone(self, phone: str) -> None:
        if not phone:
            raise ValueError("Phone required")
        if not phone.isdigit() or len(phone) != 11 or not phone.startswith("1"):
            raise ValueError("Invalid phone number")

    def _ensure_password(self, password: str) -> None:
        if not password:
            raise ValueError("Password required")

    def _hash_password(self, password: str) -> str:
        return make_password(password)

    def _legacy_hash_password(self, password: str) -> str:
        return hashlib.sha256(password.encode("utf-8")).hexdigest()

    def _verify_password(self, user: User, password: str) -> bool:
        stored = user.password_hash or ""
        if stored == self._legacy_hash_password(password):
            user.password_hash = self._hash_password(password)
            user.save(update_fields=["password_hash"])
            return True
        try:
            return check_password(password, stored)
        except ValueError:
            return False

    def _get_user_by_phone(self, phone: str) -> User:
        try:
            return User.objects.get(phone=phone)
        except User.DoesNotExist as exc:
            raise ValueError("Phone not registered") from exc

    def _verification_key(self, phone: str) -> str:
        return f"verification:{phone}"

    def _find_active_session_by_token(self, token: str, now: Any = None) -> Any:
        """Look up a still-valid UserSession purely from the database.

        The plaintext token lives only in the token cache and the client; the
        database keeps its SHA-256 (``token_hash``). This lets us recover a
        session after the in-memory token cache is lost (e.g. a backend
        restart / redeploy) so users are not forced to log in again.
        """
        now = now or timezone.now()
        return (
            UserSession.objects.filter(
                token_hash=self._hash_token(token),
                status=UserSession.STATUS_ACTIVE,
                expires_at__gt=now,
            )
            .order_by("-last_seen_at")
            .first()
        )

    def _recover_token_cache(self, token: str) -> Any:
        """Rebuild the token->session cache entry from the database on a miss.

        Returns the cache-shaped dict ({"user_id", "session_id"}) and
        repopulates the token cache with the session's remaining TTL, or None
        when no valid session exists.
        """
        now = timezone.now()
        session = self._find_active_session_by_token(token, now)
        if session is None:
            return None
        remaining = int((session.expires_at - now).total_seconds())
        if remaining <= 0:
            return None
        entry = {"user_id": session.user_id, "session_id": session.id}
        self.token_cache.set(token, entry, remaining)
        return entry

    def _get_user_by_token(self, token: str) -> User:
        if not token:
            raise ValueError("Token required")
        cached = self.token_cache.get(token)
        if cached is None:
            cached = self._recover_token_cache(token)
        if cached is not None and not isinstance(cached, dict):
            self.token_cache.delete(token)
            raise ValueError("Invalid token")
        user_id = cached.get("user_id") if isinstance(cached, dict) else None
        if not user_id:
            raise ValueError("Invalid token")
        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist as exc:
            raise ValueError("User not found") from exc
        if isinstance(cached, dict):
            session_id = cached.get("session_id")
            if session_id:
                try:
                    session = UserSession.objects.get(id=session_id, user=user)
                except UserSession.DoesNotExist as exc:
                    self.token_cache.delete(token)
                    raise ValueError("Invalid token") from exc
                now = timezone.now()
                if session.expires_at <= now:
                    session.status = UserSession.STATUS_EXPIRED
                    session.revoked_at = now
                    session.revoke_reason = "expired"
                    session.save(update_fields=["status", "revoked_at", "revoke_reason"])
                    self.token_cache.delete(token)
                    raise ValueError("Invalid token")
                if session.status != UserSession.STATUS_ACTIVE:
                    self.token_cache.delete(token)
                    raise ValueError("Session revoked")
                if not secrets.compare_digest(session.token_hash, self._hash_token(token)):
                    self.token_cache.delete(token)
                    raise ValueError("Invalid token")
                self._enforce_current_single_device_limit(user, session, now)
                UserSession.objects.filter(pk=session.pk).update(last_seen_at=now)
        # Check subscription expiration and auto-downgrade
        self._check_subscription_expiration(user)
        user = self._apply_plus_whitelist(user)
        return user

    def _check_subscription_expiration(self, user: User) -> None:
        """Check if user's subscription has expired and downgrade to free if so."""
        if user.role in (User.ROLE_PLUS, User.ROLE_PRO) and user.expire_at:
            if timezone.now() > user.expire_at:
                user.role = User.ROLE_FREE
                user.expire_at = None
                user.save(update_fields=["role", "expire_at"])

    def _get_dataset(self, dataset_id: int) -> Dataset:
        try:
            return Dataset.objects.get(id=dataset_id)
        except Dataset.DoesNotExist as exc:
            raise ValueError("Dataset not found") from exc

    def _get_dataset_for_user(self, user: User, dataset_id: int) -> Dataset:
        dataset = self._get_dataset(dataset_id)
        if (
            dataset.visibility != Dataset.VISIBILITY_PUBLIC
            and dataset.owner_id != user.id
            and user.role != User.ROLE_ADMIN
        ):
            raise PermissionError("Dataset is not accessible")
        return dataset

    def _get_train_task(self, task_id: int, user: User) -> TrainTask:
        try:
            return user.train_tasks.get(id=task_id)
        except TrainTask.DoesNotExist as exc:
            raise ValueError("Training task not found") from exc

    def _get_inference_task(self, task_id: int, user: User) -> InferenceTask:
        try:
            return user.inference_tasks.get(id=task_id)
        except InferenceTask.DoesNotExist as exc:
            raise ValueError("Inference task not found") from exc

    def _stop_inference_on_agent(self, task: InferenceTask) -> bool:
        if not task.assigned_node:
            return False
        try:
            node = WorkerNode.objects.get(node_name=task.assigned_node)
        except WorkerNode.DoesNotExist as exc:
            raise ValueError("Assigned agent not found") from exc
        url = f"http://{node.ip}:{node.api_port}/api/v1/agent/inference/stop"
        headers = {
            "Content-Type": "application/json",
            "X-Agent-Token": node.auth_token,
        }
        try:
            response = requests.post(url, json={"task_id": task.id}, headers=headers, timeout=5)
            response.raise_for_status()
        except Exception as exc:  # pragma: no cover - network issues
            raise ValueError("Failed to stop inference task on agent") from exc
        return True

    def _get_simulation_task(self, task_id: int, user: User) -> SimulationTask:
        try:
            return user.simulation_tasks.get(id=task_id)
        except SimulationTask.DoesNotExist as exc:
            raise ValueError("Simulation task not found") from exc

    def _dataset_to_dict(self, dataset: Dataset) -> Dict[str, Any]:
        metadata = dataset.metadata or {}
        file_name = metadata.get("file_name") or dataset.original_filename or None
        file_size = metadata.get("file_size")
        if file_size is None and dataset.file_size:
            file_size = dataset.file_size
        return {
            "dataset_id": dataset.id,
            "name": dataset.name,
            "description": dataset.description,
            "owner_id": dataset.owner_id,
            "visibility": dataset.visibility,
            "status": dataset.status,
            "storage_path": dataset.storage_path,
            "storage_backend": dataset.storage_backend,
            "storage_node": dataset.storage_node,
            "file_name": file_name,
            "file_size": file_size,
            "total_files": metadata.get("total_files"),
            "preview_available": bool(metadata.get("preview")),
            "created_at": dataset.created_at.isoformat(),
        }

    def _training_to_dict(self, task: TrainTask) -> Dict[str, Any]:
        return {
            "task_id": task.id,
            "dataset_id": task.dataset_id,
            "job_name": task.job_name,
            "model_type": _canonical_model_type(task.model_type),
            "status": task.status,
            "progress": task.progress,
            "checkpoint_path": task.checkpoint_path,
            # Prefer API-driven log viewing to support remote agents
            "logs_url": f"/api/v1/training/{task.id}/logs",
            "assigned_node": task.assigned_node,
            "assigned_gpus": self._parse_assigned_gpus(task.assigned_gpus),
            "priority": task.priority,
            "queue_position": task.queue_position,
            "retry_count": task.retry_count,
            "created_at": task.created_at.isoformat(),
        }

    def _inference_to_dict(self, task: InferenceTask, model_type: Optional[str]) -> Dict[str, Any]:
        return {
            "task_id": task.id,
            "model_id": task.model_id,
            "model_type": model_type,
            "dataset_id": task.dataset_id,
            "status": task.status,
            "progress": task.progress,
            "assigned_node": task.assigned_node,
            "assigned_gpus": self._parse_assigned_gpus(task.assigned_gpus),
            "server_host": task.server_host,
            "server_port": task.server_port,
            "checkpoint_path": task.checkpoint_path,
            "result_path": task.result_path,
            "error_message": task.error_message,
            "started_at": task.started_at.isoformat() if task.started_at else None,
            "finished_at": task.finished_at.isoformat() if task.finished_at else None,
            "created_at": task.created_at.isoformat(),
        }

    def _inference_model_type(self, task: InferenceTask) -> Optional[str]:
        model_type = (
            TrainTask.objects.filter(id=task.model_id, user=task.user)
            .values_list("model_type", flat=True)
            .first()
        )
        return _canonical_model_type(model_type) if model_type else None

    def _inference_model_types(self, user: User, tasks: Iterable[InferenceTask]) -> Dict[int, str]:
        model_ids = {task.model_id for task in tasks}
        if not model_ids:
            return {}
        return {
            model_id: _canonical_model_type(model_type)
            for model_id, model_type in TrainTask.objects.filter(id__in=model_ids, user=user).values_list(
                "id",
                "model_type",
            )
            if model_type
        }

    def _simulation_to_dict(self, task: SimulationTask) -> Dict[str, Any]:
        return {
            "task_id": task.id,
            "scene_file": task.scene_file,
            "model_id": task.model_id,
            "robot_type": task.robot_type,
            "training_mode": task.training_mode,
            "status": task.status,
            "created_at": task.created_at.isoformat(),
        }

    def _payment_to_dict(self, payment: Payment) -> Dict[str, Any]:
        return {
            "payment_id": payment.payment_id,
            "target_role": payment.target_role,
            "amount_cents": payment.amount_cents,
            "currency": payment.currency,
            "provider": payment.provider,
            "status": payment.status,
            "pay_code": payment.metadata.get("pay_code") if isinstance(payment.metadata, dict) else None,
            "applied_at": payment.applied_at.isoformat() if payment.applied_at else None,
            "created_at": payment.created_at.isoformat(),
            "checkout_url": payment.metadata.get("checkout_url") if isinstance(payment.metadata, dict) else None,
        }

    def _user_to_dict(self, user: User) -> Dict[str, Any]:
        return {
            "user_id": user.id,
            "phone": user.phone,
            "role": user.role,
            "created_at": user.created_at.isoformat(),
        }

    def _response(self, data: Any) -> Dict[str, Any]:
        return {"code": 0, "message": "success", "data": data}
