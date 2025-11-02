from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile

from .database import (
    AdminLog,
    Dataset,
    Device,
    InMemoryDatabase,
    InferenceTask,
    SimulationTask,
    TrainTask,
    User,
    create_database,
)


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


class RobotCloudAPI:
    def __init__(self, db: Optional[InMemoryDatabase] = None) -> None:
        self.db = db or create_database()

    # -------------------- Auth Module --------------------
    def send_code(self, phone: str) -> Dict[str, Any]:
        if not phone:
            raise ValueError("Phone required")
        code = f"{secrets.randbelow(10000):04d}"
        self.db.verification_codes[phone] = code
        return self._response({"code": code})

    def register(self, phone: str, password: str, code: str) -> Dict[str, Any]:
        if not phone or not password or not code:
            raise ValueError("Missing fields")
        if self.db.verification_codes.get(phone) != code:
            raise ValueError("Invalid verification code")
        if any(user.phone == phone for user in self.db.users.values()):
            raise ValueError("Phone already registered")
        user_id = self.db.next_user_id()
        now = datetime.utcnow()
        user = User(
            id=user_id,
            phone=phone,
            password_hash=hash_password(password),
            role="free",
            expire_at=now + timedelta(days=30),
            created_at=now,
        )
        self.db.users[user_id] = user
        self.db.verification_codes.pop(phone, None)
        return self._response({"user_id": user_id})

    def login(self, phone: str, password: str) -> Dict[str, Any]:
        if not phone or not password:
            raise ValueError("Missing credentials")
        user = next((u for u in self.db.users.values() if u.phone == phone), None)
        if user is None or user.password_hash != hash_password(password):
            raise ValueError("Invalid phone or password")
        token = secrets.token_urlsafe(16)
        self.db.tokens[token] = user.id
        return self._response({"token": token, "role": user.role})

    def verify_token(self, token: str) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        return self._response({
            "user_id": user.id,
            "phone": user.phone,
            "role": user.role,
        })

    # -------------------- User Module --------------------
    def profile(self, token: str) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        return self._response({
            "user_id": user.id,
            "phone": user.phone,
            "role": user.role,
            "expire_at": user.expire_at.isoformat() if user.expire_at else None,
            "created_at": user.created_at.isoformat(),
        })

    def upgrade(self, token: str, target_role: str, payment_id: str) -> Dict[str, Any]:
        if target_role not in {"free", "plus", "pro"}:
            raise ValueError("Invalid target role")
        if not payment_id:
            raise ValueError("Payment id required")
        user = self._get_user_by_token(token)
        allowed = ["free", "plus", "pro"]
        if allowed.index(target_role) < allowed.index(user.role):
            raise ValueError("Cannot downgrade role")
        user.role = target_role
        user.expire_at = (user.expire_at or datetime.utcnow()) + timedelta(days=365)
        return self._response({"role": user.role, "expire_at": user.expire_at.isoformat()})

    def usage(self, token: str) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        train_tasks = [t for t in self.db.train_tasks.values() if t.user_id == user.id]
        inference_tasks = [t for t in self.db.inference_tasks.values() if t.user_id == user.id]
        return self._response({
            "training": len(train_tasks),
            "inference": len(inference_tasks),
        })

    # -------------------- Dataset Module --------------------
    def upload_dataset(
        self,
        token: str,
        name: str,
        description: str,
        visibility: str,
        storage_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        if visibility not in {"private", "public"}:
            raise ValueError("Invalid visibility")
        user = self._get_user_by_token(token)
        dataset_id = self.db.next_dataset_id()
        now = datetime.utcnow()
        dataset = Dataset(
            id=dataset_id,
            name=name,
            description=description,
            owner_id=user.id,
            storage_path=storage_path or f"/storage/datasets/{dataset_id}/{name}",
            visibility=visibility,
            status="processing",
            created_at=now,
        )
        self.db.datasets[dataset_id] = dataset
        return self._response({"dataset_id": dataset_id, "status": dataset.status})

    def list_datasets(self, visibility: Optional[str], page: int, size: int) -> Dict[str, Any]:
        datasets = list(self.db.datasets.values())
        if visibility:
            datasets = [d for d in datasets if d.visibility == visibility]
        start = (page - 1) * size
        end = start + size
        return self._response({
            "items": [self._dataset_to_dict(d) for d in datasets[start:end]],
            "total": len(datasets),
        })

    def get_dataset(self, dataset_id: int) -> Dict[str, Any]:
        dataset = self._get_dataset(dataset_id)
        return self._response(self._dataset_to_dict(dataset))

    def dataset_stats(self, dataset_id: int) -> Dict[str, Any]:
        dataset = self._get_dataset(dataset_id)
        return self._response({
            "dataset_id": dataset.id,
            "status": dataset.status,
            "total_samples": 100,
        })

    def dataset_preview(self, dataset_id: int) -> Dict[str, Any]:
        dataset = self._get_dataset(dataset_id)
        return self._response({
            "dataset_id": dataset.id,
            "preview": [
                {"type": "image", "url": f"/preview/{dataset.id}/sample1.png"},
                {"type": "pointcloud", "url": f"/preview/{dataset.id}/sample1.pcd"},
            ],
        })

    # -------------------- Training Module --------------------
    def create_training_task(
        self,
        token: str,
        dataset_id: int,
        model_type: str,
        params: Dict[str, Any],
    ) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        dataset = self._get_dataset(dataset_id)
        task_id = self.db.next_train_task_id()
        task = TrainTask(
            id=task_id,
            dataset_id=dataset.id,
            user_id=user.id,
            model_type=model_type,
            params=params,
            status="queued",
            progress=0.0,
            logs_url=f"/storage/train_logs/{task_id}.log",
            model_path=None,
            created_at=datetime.utcnow(),
        )
        self.db.train_tasks[task_id] = task
        return self._response({"task_id": task_id, "status": task.status})

    def list_training_tasks(self, token: str, page: int, size: int) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        tasks = [t for t in self.db.train_tasks.values() if t.user_id == user.id]
        start = (page - 1) * size
        end = start + size
        return self._response({
            "items": [self._training_to_dict(t) for t in tasks[start:end]],
            "total": len(tasks),
        })

    def training_status(self, token: str, task_id: int) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        task = self._get_train_task(task_id, user.id)
        return self._response(self._training_to_dict(task))

    def stop_training(self, token: str, task_id: int) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        task = self._get_train_task(task_id, user.id)
        task.status = "failed"
        task.progress = 0.0
        return self._response({"task_id": task.id, "status": task.status})

    def download_model(self, token: str, task_id: int) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        task = self._get_train_task(task_id, user.id)
        if not task.model_path:
            task.model_path = f"/storage/models/{task.id}.pt"
        return self._response({"task_id": task.id, "model_path": task.model_path})

    # -------------------- Inference Module --------------------
    def create_inference_task(self, token: str, model_id: int, dataset_id: int) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        task_id = self.db.next_inference_task_id()
        task = InferenceTask(
            id=task_id,
            model_id=model_id,
            dataset_id=dataset_id,
            user_id=user.id,
            status="queued",
            result_path=None,
            created_at=datetime.utcnow(),
        )
        self.db.inference_tasks[task_id] = task
        return self._response({"task_id": task_id, "status": task.status})

    def inference_result(self, token: str, task_id: int) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        task = self._get_inference_task(task_id, user.id)
        if task.status == "queued":
            task.status = "completed"
            task.result_path = f"/storage/results/{task.id}.json"
        return self._response({
            "task_id": task.id,
            "status": task.status,
            "results": [
                {"sample_id": "00001", "output_url": f"/storage/results/{task.id}_00001.png"}
            ],
        })

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
        task_id = self.db.next_simulation_task_id()
        task = SimulationTask(
            id=task_id,
            user_id=user.id,
            scene_file=scene_file,
            model_id=model_id,
            robot_type=robot_type,
            training_mode=training_mode,
            status="queued",
            created_at=datetime.utcnow(),
        )
        self.db.simulation_tasks[task_id] = task
        return self._response({"task_id": task_id, "status": task.status})

    def simulation_status(self, token: str, task_id: int) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        task = self._get_simulation_task(task_id, user.id)
        if task.status == "queued":
            task.status = "running"
        return self._response({"task_id": task.id, "status": task.status})

    def bind_device(self, token: str, device_sn: str, model_id: int) -> Dict[str, Any]:
        user = self._get_user_by_token(token)
        if not device_sn:
            raise ValueError("Device SN required")
        device_id = self.db.next_device_id()
        device = Device(
            id=device_id,
            sn=device_sn,
            user_id=user.id,
            model_id=model_id,
            bind_time=datetime.utcnow(),
        )
        self.db.devices[device_id] = device
        return self._response({"device_id": device_id, "sn": device.sn})

    # -------------------- Admin Module --------------------
    def admin_users(self, token: str, page: int, role: Optional[str]) -> Dict[str, Any]:
        admin = self._get_user_by_token(token)
        if admin.role != "admin":
            raise PermissionError("Admin privileges required")
        users = list(self.db.users.values())
        if role:
            users = [u for u in users if u.role == role]
        start = (page - 1) * 20
        end = start + 20
        return self._response({
            "items": [self._user_to_dict(u) for u in users[start:end]],
            "total": len(users),
        })

    def admin_review_dataset(self, token: str, dataset_id: int, status_value: str) -> Dict[str, Any]:
        admin = self._get_user_by_token(token)
        if admin.role != "admin":
            raise PermissionError("Admin privileges required")
        dataset = self._get_dataset(dataset_id)
        dataset.status = status_value
        log_id = self.db.next_admin_log_id()
        log = AdminLog(
            id=log_id,
            admin_id=admin.id,
            action="dataset_review",
            target_type="dataset",
            target_id=dataset.id,
            created_at=datetime.utcnow(),
        )
        self.db.admin_logs[log_id] = log
        return self._response({"dataset_id": dataset.id, "status": dataset.status})

    def admin_overview(self, token: str) -> Dict[str, Any]:
        admin = self._get_user_by_token(token)
        if admin.role != "admin":
            raise PermissionError("Admin privileges required")
        return self._response({
            "users": len(self.db.users),
            "datasets": len(self.db.datasets),
            "train_tasks": len(self.db.train_tasks),
            "inference_tasks": len(self.db.inference_tasks),
            "simulation_tasks": len(self.db.simulation_tasks),
        })

    # -------------------- Internal helpers --------------------
    def _response(self, data: Any) -> Dict[str, Any]:
        return {"code": 0, "message": "success", "data": data}

    def _get_user_by_token(self, token: str) -> User:
        if not token:
            raise ValueError("Token required")
        user_id = self.db.tokens.get(token)
        if user_id is None:
            raise ValueError("Invalid token")
        user = self.db.users.get(user_id)
        if user is None:
            raise ValueError("User not found")
        return user

    def _get_dataset(self, dataset_id: int) -> Dataset:
        dataset = self.db.datasets.get(dataset_id)
        if dataset is None:
            raise ValueError("Dataset not found")
        return dataset

    def _get_train_task(self, task_id: int, user_id: int) -> TrainTask:
        task = self.db.train_tasks.get(task_id)
        if task is None or task.user_id != user_id:
            raise ValueError("Training task not found")
        return task

    def _get_inference_task(self, task_id: int, user_id: int) -> InferenceTask:
        task = self.db.inference_tasks.get(task_id)
        if task is None or task.user_id != user_id:
            raise ValueError("Inference task not found")
        return task

    def _get_simulation_task(self, task_id: int, user_id: int) -> SimulationTask:
        task = self.db.simulation_tasks.get(task_id)
        if task is None or task.user_id != user_id:
            raise ValueError("Simulation task not found")
        return task

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

    def _user_to_dict(self, user: User) -> Dict[str, Any]:
        return {
            "user_id": user.id,
            "phone": user.phone,
            "role": user.role,
            "created_at": user.created_at.isoformat(),
        }


def _execute(action: Callable[[], Dict[str, Any]]) -> Dict[str, Any]:
    try:
        return action()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


def _extract_token(authorization: str = Header(...)) -> str:
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Invalid Authorization header")
    return token


def create_app(api: Optional[RobotCloudAPI] = None) -> FastAPI:
    fastapi_app = FastAPI(title="RobotCloud API", version="1.0.0")
    service = api or RobotCloudAPI()

    def get_api() -> RobotCloudAPI:
        return service

    @fastapi_app.post("/api/v1/auth/send_code")
    def send_code(phone: str, api: RobotCloudAPI = Depends(get_api)) -> Dict[str, Any]:
        return _execute(lambda: api.send_code(phone))

    @fastapi_app.post("/api/v1/auth/register")
    def register(
        phone: str,
        password: str,
        code: str,
        api: RobotCloudAPI = Depends(get_api),
    ) -> Dict[str, Any]:
        return _execute(lambda: api.register(phone, password, code))

    @fastapi_app.post("/api/v1/auth/login")
    def login(phone: str, password: str, api: RobotCloudAPI = Depends(get_api)) -> Dict[str, Any]:
        return _execute(lambda: api.login(phone, password))

    @fastapi_app.get("/api/v1/auth/verify_token")
    def verify_token(token: str = Depends(_extract_token), api: RobotCloudAPI = Depends(get_api)) -> Dict[str, Any]:
        return _execute(lambda: api.verify_token(token))

    @fastapi_app.get("/api/v1/user/profile")
    def profile(token: str = Depends(_extract_token), api: RobotCloudAPI = Depends(get_api)) -> Dict[str, Any]:
        return _execute(lambda: api.profile(token))

    @fastapi_app.post("/api/v1/user/upgrade")
    def upgrade(
        target_role: str,
        payment_id: str,
        token: str = Depends(_extract_token),
        api: RobotCloudAPI = Depends(get_api),
    ) -> Dict[str, Any]:
        return _execute(lambda: api.upgrade(token, target_role, payment_id))

    @fastapi_app.get("/api/v1/user/usage")
    def usage(token: str = Depends(_extract_token), api: RobotCloudAPI = Depends(get_api)) -> Dict[str, Any]:
        return _execute(lambda: api.usage(token))

    @fastapi_app.post("/api/v1/dataset/upload")
    def upload_dataset(
        token: str = Depends(_extract_token),
        file: UploadFile = File(...),
        name: str = Form(...),
        description: str = Form(""),
        visibility: str = Form("private"),
        api: RobotCloudAPI = Depends(get_api),
    ) -> Dict[str, Any]:
        storage_path = f"/storage/datasets/{file.filename}"
        return _execute(lambda: api.upload_dataset(token, name, description, visibility, storage_path))

    @fastapi_app.get("/api/v1/dataset/list")
    def list_datasets(
        visibility: Optional[str] = None,
        page: int = 1,
        size: int = 20,
        api: RobotCloudAPI = Depends(get_api),
    ) -> Dict[str, Any]:
        return _execute(lambda: api.list_datasets(visibility, page, size))

    @fastapi_app.get("/api/v1/dataset/{dataset_id}")
    def dataset_detail(dataset_id: int, api: RobotCloudAPI = Depends(get_api)) -> Dict[str, Any]:
        return _execute(lambda: api.get_dataset(dataset_id))

    @fastapi_app.get("/api/v1/dataset/{dataset_id}/stats")
    def dataset_stats(dataset_id: int, api: RobotCloudAPI = Depends(get_api)) -> Dict[str, Any]:
        return _execute(lambda: api.dataset_stats(dataset_id))

    @fastapi_app.get("/api/v1/dataset/{dataset_id}/preview")
    def dataset_preview(dataset_id: int, api: RobotCloudAPI = Depends(get_api)) -> Dict[str, Any]:
        return _execute(lambda: api.dataset_preview(dataset_id))

    @fastapi_app.post("/api/v1/training/create")
    def create_training(
        dataset_id: int,
        model_type: str,
        params: Dict[str, Any],
        token: str = Depends(_extract_token),
        api: RobotCloudAPI = Depends(get_api),
    ) -> Dict[str, Any]:
        return _execute(lambda: api.create_training_task(token, dataset_id, model_type, params))

    @fastapi_app.get("/api/v1/training/list")
    def list_training(
        token: str = Depends(_extract_token),
        page: int = 1,
        size: int = 20,
        api: RobotCloudAPI = Depends(get_api),
    ) -> Dict[str, Any]:
        return _execute(lambda: api.list_training_tasks(token, page, size))

    @fastapi_app.get("/api/v1/training/{task_id}/status")
    def training_status(
        task_id: int,
        token: str = Depends(_extract_token),
        api: RobotCloudAPI = Depends(get_api),
    ) -> Dict[str, Any]:
        return _execute(lambda: api.training_status(token, task_id))

    @fastapi_app.post("/api/v1/training/{task_id}/stop")
    def stop_training(
        task_id: int,
        token: str = Depends(_extract_token),
        api: RobotCloudAPI = Depends(get_api),
    ) -> Dict[str, Any]:
        return _execute(lambda: api.stop_training(token, task_id))

    @fastapi_app.get("/api/v1/training/{task_id}/download")
    def download_training_model(
        task_id: int,
        token: str = Depends(_extract_token),
        api: RobotCloudAPI = Depends(get_api),
    ) -> Dict[str, Any]:
        return _execute(lambda: api.download_model(token, task_id))

    @fastapi_app.post("/api/v1/inference/create")
    def create_inference(
        model_id: int,
        dataset_id: int,
        token: str = Depends(_extract_token),
        api: RobotCloudAPI = Depends(get_api),
    ) -> Dict[str, Any]:
        return _execute(lambda: api.create_inference_task(token, model_id, dataset_id))

    @fastapi_app.get("/api/v1/inference/{task_id}/result")
    def inference_result(
        task_id: int,
        token: str = Depends(_extract_token),
        api: RobotCloudAPI = Depends(get_api),
    ) -> Dict[str, Any]:
        return _execute(lambda: api.inference_result(token, task_id))

    @fastapi_app.post("/api/v1/sim/create")
    def create_simulation(
        scene_file: str,
        model_id: int,
        robot_type: str,
        training_mode: str,
        token: str = Depends(_extract_token),
        api: RobotCloudAPI = Depends(get_api),
    ) -> Dict[str, Any]:
        return _execute(
            lambda: api.create_simulation_task(
                token,
                scene_file,
                model_id,
                robot_type,
                training_mode,
            )
        )

    @fastapi_app.get("/api/v1/sim/{task_id}/status")
    def simulation_status(
        task_id: int,
        token: str = Depends(_extract_token),
        api: RobotCloudAPI = Depends(get_api),
    ) -> Dict[str, Any]:
        return _execute(lambda: api.simulation_status(token, task_id))

    @fastapi_app.post("/api/v1/sim/bind_device")
    def bind_device(
        device_sn: str,
        model_id: int,
        token: str = Depends(_extract_token),
        api: RobotCloudAPI = Depends(get_api),
    ) -> Dict[str, Any]:
        return _execute(lambda: api.bind_device(token, device_sn, model_id))

    @fastapi_app.get("/api/v1/admin/users")
    def admin_users(
        token: str = Depends(_extract_token),
        page: int = 1,
        role: Optional[str] = None,
        api: RobotCloudAPI = Depends(get_api),
    ) -> Dict[str, Any]:
        return _execute(lambda: api.admin_users(token, page, role))

    @fastapi_app.post("/api/v1/admin/dataset/{dataset_id}/review")
    def admin_review_dataset(
        dataset_id: int,
        status: str,
        token: str = Depends(_extract_token),
        api: RobotCloudAPI = Depends(get_api),
    ) -> Dict[str, Any]:
        return _execute(lambda: api.admin_review_dataset(token, dataset_id, status))

    @fastapi_app.get("/api/v1/admin/overview")
    def admin_overview(token: str = Depends(_extract_token), api: RobotCloudAPI = Depends(get_api)) -> Dict[str, Any]:
        return _execute(lambda: api.admin_overview(token))

    return fastapi_app


def main() -> None:
    raise RuntimeError("This module is intended to be used as a library.")


app = create_app()
