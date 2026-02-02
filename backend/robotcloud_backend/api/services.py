from __future__ import annotations

import hashlib
import json
import re
import secrets
from datetime import timedelta
from pathlib import Path
from typing import Any, Dict, Iterable, Optional
from urllib.parse import quote
from zipfile import BadZipFile, ZipFile

from django.conf import settings
from django.core.cache import caches
from django.db import transaction
from django.utils import timezone

import requests

from .models import (
    AdminLog,
    Dataset,
    Device,
    InferenceTask,
    Payment,
    SimulationTask,
    TrainTask,
    User,
    WorkerNode,
)
from ..sms import SmsGateway
from ..payment.alipay import get_alipay


TOKEN_TIMEOUT_SECONDS = 7 * 24 * 60 * 60  # 7 days
VERIFICATION_CODE_TIMEOUT_SECONDS = 5 * 60  # 5 minutes


class RobotCloudService:
    """Domain service that encapsulates RobotCloud business logic."""

    # Only Plus plan is available: 200 RMB/month (20000 cents)
    PLAN_PRICING = {
        User.ROLE_PLUS: {"amount_cents": 20000, "currency": "CNY", "description": "RobotCloud Plus Subscription - 1 month"},
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

    def _generate_payment_id(self) -> str:
        while True:
            candidate = secrets.token_hex(12)
            if not Payment.objects.filter(payment_id=candidate).exists():
                return candidate

    def _normalize_gpu_payload(self, payload: Any) -> int:
        if isinstance(payload, int):
            return max(payload, 0)
        if isinstance(payload, (list, tuple)):
            return max(len(payload), 0)
        return 0

    def _release_worker_slot(self, task: TrainTask) -> None:
        if not task.assigned_node:
            return
        try:
            node = WorkerNode.objects.get(node_name=task.assigned_node)
        except WorkerNode.DoesNotExist:
            return
        if node.gpu_busy > 0:
            node.gpu_busy -= 1
        node.gpu_free = max(node.gpu_total - node.gpu_busy, 0)
        node.save(update_fields=["gpu_busy", "gpu_free", "updated_at"])

    def _release_inference_slot(self, task: InferenceTask) -> None:
        if not task.assigned_node:
            return
        try:
            node = WorkerNode.objects.get(node_name=task.assigned_node)
        except WorkerNode.DoesNotExist:
            return
        if node.gpu_busy > 0:
            node.gpu_busy -= 1
        node.gpu_free = max(node.gpu_total - node.gpu_busy, 0)
        node.save(update_fields=["gpu_busy", "gpu_free", "updated_at"])

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

    def login_with_code(self, phone: str, code: str) -> Dict[str, Any]:
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

        token = secrets.token_urlsafe(16)
        self.token_cache.set(token, user.id, TOKEN_TIMEOUT_SECONDS)
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



    def login(self, phone: str, password: str) -> Dict[str, Any]:
        self._ensure_phone(phone)
        user = self._get_user_by_phone(phone)
        if user.password_hash != self._hash_password(password):
            raise ValueError("Incorrect password")
        token = secrets.token_urlsafe(16)
        self.token_cache.set(token, user.id, TOKEN_TIMEOUT_SECONDS)
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
                return_url = f"{base}/plans?payment_id={payment_id}"
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

    def mock_payment_callback(self, payment_id: str, status_value: str) -> Dict[str, Any]:
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
        if alipay.is_configured() and data.get("sign") and not alipay.verify_notify(data):
            return False

        if not out_trade_no:
            return False

        if trade_status not in {"TRADE_SUCCESS", "TRADE_FINISHED"}:
            return True

        try:
            payment = Payment.objects.get(payment_id=out_trade_no)
        except Payment.DoesNotExist:
            return False

        if payment.status == Payment.STATUS_SUCCEEDED:
            return True

        total_amount = data.get("total_amount", "0")
        try:
            total_cents = int(float(total_amount) * 100)
        except (ValueError, TypeError):
            total_cents = 0

        if total_cents > 0 and total_cents != payment.amount_cents:
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
        dataset.status = Dataset.STATUS_READY
        dataset.metadata = metadata
        dataset.save(update_fields=["storage_path", "status", "metadata"])
        return self._response(
            {
                "dataset_id": dataset.id,
                "status": dataset.status,
                "file_name": metadata["file_name"],
                "file_size": metadata["file_size"],
                "total_files": metadata["total_files"],
            }
        )

    def list_datasets(self, visibility: Optional[str], page: int, size: int) -> Dict[str, Any]:
        queryset = Dataset.objects.all().order_by("-created_at")
        if visibility:
            queryset = queryset.filter(visibility=visibility)
        total = queryset.count()
        start = (page - 1) * size
        items = [self._dataset_to_dict(d) for d in queryset[start : start + size]]
        return self._response({"items": items, "total": total})

    def get_dataset(self, dataset_id: int) -> Dict[str, Any]:
        dataset = self._get_dataset(dataset_id)
        return self._response(self._dataset_to_dict(dataset))

    def dataset_stats(self, dataset_id: int) -> Dict[str, Any]:
        dataset = self._get_dataset(dataset_id)
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

    def dataset_preview(self, dataset_id: int) -> Dict[str, Any]:
        dataset = self._get_dataset(dataset_id)
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
        # Delete the storage file if it exists
        if dataset.storage_path:
            storage_file = self.dataset_root / dataset.storage_path
            if storage_file.exists():
                storage_file.unlink()
        dataset.delete()
        return self._response({"deleted": True})

    # -------------------- Training Module --------------------
    def create_training_task(
        self,
        token: str,
        dataset_id: int,
        model_type: str,
        params: Dict[str, Any],
    ) -> Dict[str, Any]:
        if not model_type:
            raise ValueError("Model type required")
        user = self._get_user_by_token(token)
        dataset = self._get_dataset(dataset_id)
        with transaction.atomic():
            task = TrainTask.objects.create(
                dataset=dataset,
                user=user,
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
    def register_agent(self, node_name: str, ip: str, gpu_total: int, version: str, api_port: int) -> Dict[str, Any]:
        if not node_name:
            raise ValueError("Node name required")
        if not ip:
            raise ValueError("Agent IP required")
        if gpu_total <= 0:
            raise ValueError("GPU total must be positive")
        if api_port <= 0:
            raise ValueError("Agent port must be positive")
        now = timezone.now()
        with transaction.atomic():
            node, created = WorkerNode.objects.select_for_update().get_or_create(
                node_name=node_name,
                defaults={
                    "ip": ip,
                    "gpu_total": gpu_total,
                    "gpu_busy": 0,
                    "gpu_free": gpu_total,
                    "version": version or "",
                    "auth_token": self._generate_agent_token(),
                    "status": WorkerNode.STATUS_ONLINE,
                    "last_heartbeat": now,
                    "api_port": api_port,
                },
            )
            if not created:
                node.ip = ip
                node.gpu_total = gpu_total
                node.gpu_busy = min(node.gpu_busy, gpu_total)
                node.gpu_free = max(gpu_total - node.gpu_busy, 0)
                node.version = version or ""
                node.status = WorkerNode.STATUS_ONLINE
                node.last_heartbeat = now
                node.api_port = api_port
                node.save(
                    update_fields=[
                        "ip",
                        "gpu_total",
                        "gpu_busy",
                        "gpu_free",
                        "version",
                        "status",
                        "last_heartbeat",
                        "api_port",
                        "updated_at",
                    ]
                )
            token = node.auth_token
        return self._response({"agent_id": node.node_name, "token": token, "gpu_total": node.gpu_total, "api_port": node.api_port})

    def agent_heartbeat(
        self,
        token: str,
        gpu_total: int,
        gpu_free: Any,
        gpu_busy: Any,
        version: Optional[str] = None,
    ) -> Dict[str, Any]:
        node = self._get_worker_by_token(token)
        now = timezone.now()
        if gpu_total > 0:
            node.gpu_total = gpu_total
        free_count = self._normalize_gpu_payload(gpu_free)
        busy_count = self._normalize_gpu_payload(gpu_busy)
        if busy_count > node.gpu_total:
            busy_count = node.gpu_total
        if free_count > node.gpu_total:
            free_count = node.gpu_total
        node.gpu_busy = busy_count
        node.gpu_free = max(node.gpu_total - busy_count, 0) if free_count == 0 else free_count
        node.last_heartbeat = now
        node.status = WorkerNode.STATUS_ONLINE
        if version is not None:
            node.version = version
        node.save(
            update_fields=["gpu_total", "gpu_busy", "gpu_free", "last_heartbeat", "status", "version", "updated_at"]
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
        if model_id is None:
            raise ValueError("model_id required")
        dataset = self._get_dataset(dataset_id) if dataset_id is not None else None
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
        items = [self._inference_to_dict(t) for t in queryset[start : start + size]]
        return self._response({"items": items, "total": total})

    def inference_result(self, token: str, task_id: int) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        task = self._get_inference_task(task_id, user)
        return self._response(
            {
                "task_id": task.id,
                "status": task.status,
                "checkpoint_path": task.checkpoint_path,
                "server_host": task.server_host,
                "server_port": task.server_port,
                "result_path": task.result_path,
                "error_message": task.error_message,
            }
        )

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
        task.delete()
        return self._response({"deleted": True})

    def _model_to_dict(self, task: TrainTask, include_params: bool = False) -> Dict[str, Any]:
        """Convert a completed TrainTask to a model dict."""
        dataset = task.dataset
        result = {
            "model_id": task.id,
            "name": f"{task.model_type}-{dataset.name}" if dataset else f"{task.model_type}-{task.id}",
            "model_type": task.model_type,
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
        return User.objects.create(
            phone=phone,
            password_hash=self._hash_password(password),
            role=User.ROLE_FREE,
            expire_at=now + timedelta(days=30),
        )

    def _create_user_without_password(self, phone: str) -> User:
        """Create a user without password (for SMS code login)."""
        now = timezone.now()
        return User.objects.create(
            phone=phone,
            password_hash="",
            role=User.ROLE_FREE,
            expire_at=now + timedelta(days=30),
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
        return hashlib.sha256(password.encode("utf-8")).hexdigest()

    def _get_user_by_phone(self, phone: str) -> User:
        try:
            return User.objects.get(phone=phone)
        except User.DoesNotExist as exc:
            raise ValueError("Phone not registered") from exc

    def _verification_key(self, phone: str) -> str:
        return f"verification:{phone}"

    def _get_user_by_token(self, token: str) -> User:
        if not token:
            raise ValueError("Token required")
        user_id = self.token_cache.get(token)
        if not user_id:
            raise ValueError("Invalid token")
        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist as exc:
            raise ValueError("User not found") from exc
        # Check subscription expiration and auto-downgrade
        self._check_subscription_expiration(user)
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

    def _get_simulation_task(self, task_id: int, user: User) -> SimulationTask:
        try:
            return user.simulation_tasks.get(id=task_id)
        except SimulationTask.DoesNotExist as exc:
            raise ValueError("Simulation task not found") from exc

    def _dataset_to_dict(self, dataset: Dataset) -> Dict[str, Any]:
        metadata = dataset.metadata or {}
        return {
            "dataset_id": dataset.id,
            "name": dataset.name,
            "description": dataset.description,
            "owner_id": dataset.owner_id,
            "visibility": dataset.visibility,
            "status": dataset.status,
            "storage_path": dataset.storage_path,
            "file_name": metadata.get("file_name"),
            "file_size": metadata.get("file_size"),
            "total_files": metadata.get("total_files"),
            "preview_available": bool(metadata.get("preview")),
            "created_at": dataset.created_at.isoformat(),
        }

    def _training_to_dict(self, task: TrainTask) -> Dict[str, Any]:
        return {
            "task_id": task.id,
            "dataset_id": task.dataset_id,
            "model_type": task.model_type,
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

    def _inference_to_dict(self, task: InferenceTask) -> Dict[str, Any]:
        return {
            "task_id": task.id,
            "model_id": task.model_id,
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
