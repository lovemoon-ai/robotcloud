from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta
from typing import Any, Dict, Optional

from django.core.cache import caches
from django.db import transaction
from django.utils import timezone

from .models import (
    AdminLog,
    Dataset,
    Device,
    InvitationCode,
    InferenceTask,
    SimulationTask,
    TrainTask,
    User,
)
from ..sms import SmsGateway


TOKEN_TIMEOUT_SECONDS = 7 * 24 * 60 * 60  # 7 days
VERIFICATION_CODE_TIMEOUT_SECONDS = 5 * 60  # 5 minutes


class RobotCloudService:
    """Domain service that encapsulates RobotCloud business logic."""

    def __init__(self, sms_gateway: Optional[SmsGateway] = None) -> None:
        self.sms_gateway = sms_gateway
        self.token_cache = caches["tokens"]
        self.verification_cache = caches["default"]

    # -------------------- Auth Module --------------------
    def send_code(self, phone: str) -> Dict[str, Any]:
        self._ensure_phone(phone)
        code = f"{secrets.randbelow(10000):04d}"
        self.verification_cache.set(self._verification_key(phone), code, VERIFICATION_CODE_TIMEOUT_SECONDS)
        if self.sms_gateway:
            self.sms_gateway.send_verification_code(phone, code)
        return self._response({"sent": True})

    def register(self, phone: str, password: str, code: str, invitation_code: str) -> Dict[str, Any]:
        self._ensure_phone(phone)
        self._ensure_password(password)
        if not code:
            raise ValueError("Verification code required")
        invitation = self._get_invitation(invitation_code)
        stored_code = self.verification_cache.get(self._verification_key(phone))
        if stored_code != code:
            raise ValueError("Invalid verification code")
        if User.objects.filter(phone=phone).exists():
            raise ValueError("Phone already registered")

        with transaction.atomic():
            user = self._create_user(phone, password)
            self._mark_invitation_used(invitation, user, phone)
            self.verification_cache.delete(self._verification_key(phone))
        return self._response({"user_id": user.id})

    def register_with_invitation(self, phone: str, password: str, invitation_code: str) -> Dict[str, Any]:
        self._ensure_phone(phone)
        self._ensure_password(password)
        invitation = self._get_invitation(invitation_code)
        if User.objects.filter(phone=phone).exists():
            raise ValueError("Phone already registered")

        with transaction.atomic():
            user = self._create_user(phone, password)
            self._mark_invitation_used(invitation, user, phone)
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

    def upgrade(self, token: str, target_role: str, payment_id: str) -> Dict[str, Any]:
        if target_role not in {User.ROLE_FREE, User.ROLE_PLUS, User.ROLE_PRO}:
            raise ValueError("Invalid target role")
        if not payment_id:
            raise ValueError("Payment id required")
        user = self._get_user_by_token(token)
        allowed = [User.ROLE_FREE, User.ROLE_PLUS, User.ROLE_PRO]
        if allowed.index(target_role) < allowed.index(user.role):
            raise ValueError("Cannot downgrade role")
        user.role = target_role
        user.expire_at = (user.expire_at or timezone.now()) + timedelta(days=365)
        user.save(update_fields=["role", "expire_at"])
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
        name: str,
        description: str,
        visibility: str,
        storage_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        if visibility not in {Dataset.VISIBILITY_PRIVATE, Dataset.VISIBILITY_PUBLIC}:
            raise ValueError("Invalid visibility")
        if not name:
            raise ValueError("Dataset name required")
        user = self._get_user_by_token(token)
        dataset = Dataset.objects.create(
            name=name,
            description=description or "",
            owner=user,
            storage_path=storage_path or f"/storage/datasets/{name}",
            visibility=visibility,
            status=Dataset.STATUS_PROCESSING,
        )
        return self._response({"dataset_id": dataset.id, "status": dataset.status})

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
        return self._response({"dataset_id": dataset.id, "status": dataset.status, "total_samples": 100})

    def dataset_preview(self, dataset_id: int) -> Dict[str, Any]:
        dataset = self._get_dataset(dataset_id)
        return self._response(
            {
                "dataset_id": dataset.id,
                "preview": [
                    {"type": "image", "url": f"/preview/{dataset.id}/sample1.png"},
                    {"type": "pointcloud", "url": f"/preview/{dataset.id}/sample1.pcd"},
                ],
            }
        )

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
        task = TrainTask.objects.create(
            dataset=dataset,
            user=user,
            model_type=model_type,
            params=params or {},
            status="queued",
            progress=0.0,
            logs_url="",
        )
        task.logs_url = f"/storage/train_logs/{task.id}.log"
        task.save(update_fields=["logs_url"])
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
        task.status = "failed"
        task.progress = 0.0
        task.save(update_fields=["status", "progress"])
        return self._response({"task_id": task.id, "status": task.status})

    def download_model(self, token: str, task_id: int) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        task = self._get_train_task(task_id, user)
        if not task.model_path:
            task.model_path = f"/storage/models/{task.id}.pt"
            task.save(update_fields=["model_path"])
        return self._response({"task_id": task.id, "model_path": task.model_path})

    # -------------------- Inference Module --------------------
    def create_inference_task(self, token: str, model_id: int, dataset_id: int) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        dataset = self._get_dataset(dataset_id)
        task = InferenceTask.objects.create(
            model_id=model_id,
            dataset=dataset,
            user=user,
            status="queued",
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
        if task.status == "queued":
            task.status = "completed"
            task.result_path = f"/storage/results/{task.id}.json"
            task.save(update_fields=["status", "result_path"])
        return self._response(
            {
                "task_id": task.id,
                "status": task.status,
                "results": [
                    {"sample_id": "00001", "output_url": f"/storage/results/{task.id}_00001.png"},
                ],
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

    # -------------------- Invitation utilities --------------------
    def add_invitation_code(self, code: str, note: Optional[str] = None) -> InvitationCode:
        if not code:
            raise ValueError("Invitation code required")
        invitation, created = InvitationCode.objects.get_or_create(code=code, defaults={"note": note})
        if not created:
            raise ValueError("Invitation code already exists")
        if note and invitation.note != note:
            invitation.note = note
            invitation.save(update_fields=["note"])
        return invitation

    def generate_invitation_code(self, prefix: str = "INV", length: int = 8, note: Optional[str] = None) -> InvitationCode:
        code = f"{prefix}-{secrets.token_hex(length // 2).upper()}"
        return self.add_invitation_code(code, note)

    def list_invitation_codes(self) -> Dict[str, Any]:
        items = [
            {
                "code": inv.code,
                "used": inv.used,
                "used_at": inv.used_at.isoformat() if inv.used_at else None,
                "assigned_user_id": inv.assigned_user_id,
                "assigned_phone": inv.assigned_phone,
                "note": inv.note,
            }
            for inv in InvitationCode.objects.all().order_by("code")
        ]
        return self._response({"items": items, "total": len(items)})

    # -------------------- Internal helpers --------------------
    def _create_user(self, phone: str, password: str) -> User:
        now = timezone.now()
        return User.objects.create(
            phone=phone,
            password_hash=self._hash_password(password),
            role=User.ROLE_FREE,
            expire_at=now + timedelta(days=30),
        )

    def _mark_invitation_used(self, invitation: InvitationCode, user: User, phone: str) -> None:
        invitation.used = True
        invitation.used_at = timezone.now()
        invitation.assigned_user = user
        invitation.assigned_phone = phone
        invitation.save(update_fields=["used", "used_at", "assigned_user", "assigned_phone"])

    def _get_invitation(self, code: str) -> InvitationCode:
        if not code:
            raise ValueError("Invalid invitation code")
        try:
            invitation = InvitationCode.objects.get(code=code)
        except InvitationCode.DoesNotExist as exc:
            raise ValueError("Invalid invitation code") from exc
        if invitation.used:
            raise ValueError("Invitation code already used")
        return invitation

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
            return User.objects.get(id=user_id)
        except User.DoesNotExist as exc:
            raise ValueError("User not found") from exc

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
        return {
            "dataset_id": dataset.id,
            "name": dataset.name,
            "description": dataset.description,
            "owner_id": dataset.owner_id,
            "visibility": dataset.visibility,
            "status": dataset.status,
            "created_at": dataset.created_at.isoformat(),
        }

    def _training_to_dict(self, task: TrainTask) -> Dict[str, Any]:
        return {
            "task_id": task.id,
            "dataset_id": task.dataset_id,
            "model_type": task.model_type,
            "status": task.status,
            "progress": task.progress,
            "logs_url": task.logs_url,
        }

    def _inference_to_dict(self, task: InferenceTask) -> Dict[str, Any]:
        return {
            "task_id": task.id,
            "model_id": task.model_id,
            "dataset_id": task.dataset_id,
            "status": task.status,
            "result_path": task.result_path,
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

    def _user_to_dict(self, user: User) -> Dict[str, Any]:
        return {
            "user_id": user.id,
            "phone": user.phone,
            "role": user.role,
            "created_at": user.created_at.isoformat(),
        }

    def _response(self, data: Any) -> Dict[str, Any]:
        return {"code": 0, "message": "success", "data": data}
