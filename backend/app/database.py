from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, Optional


@dataclass
class User:
    id: int
    phone: str
    password_hash: str
    role: str
    expire_at: Optional[datetime]
    created_at: datetime


@dataclass
class Dataset:
    id: int
    name: str
    description: str
    owner_id: int
    storage_path: str
    visibility: str
    status: str
    created_at: datetime


@dataclass
class TrainTask:
    id: int
    dataset_id: int
    user_id: int
    model_type: str
    params: Dict[str, object]
    status: str
    progress: float
    logs_url: str
    model_path: Optional[str]
    created_at: datetime


@dataclass
class InferenceTask:
    id: int
    model_id: int
    dataset_id: int
    user_id: int
    status: str
    result_path: Optional[str]
    created_at: datetime


@dataclass
class SimulationTask:
    id: int
    user_id: int
    scene_file: str
    model_id: int
    robot_type: str
    training_mode: str
    status: str
    created_at: datetime


@dataclass
class Device:
    id: int
    sn: str
    user_id: int
    model_id: Optional[int]
    bind_time: datetime


@dataclass
class AdminLog:
    id: int
    admin_id: int
    action: str
    target_type: str
    target_id: int
    created_at: datetime


@dataclass
class InMemoryDatabase:
    users: Dict[int, User] = field(default_factory=dict)
    datasets: Dict[int, Dataset] = field(default_factory=dict)
    train_tasks: Dict[int, TrainTask] = field(default_factory=dict)
    inference_tasks: Dict[int, InferenceTask] = field(default_factory=dict)
    simulation_tasks: Dict[int, SimulationTask] = field(default_factory=dict)
    devices: Dict[int, Device] = field(default_factory=dict)
    admin_logs: Dict[int, AdminLog] = field(default_factory=dict)
    tokens: Dict[str, int] = field(default_factory=dict)
    verification_codes: Dict[str, str] = field(default_factory=dict)

    _user_id_seq: int = 0
    _dataset_id_seq: int = 0
    _train_task_id_seq: int = 0
    _inference_task_id_seq: int = 0
    _simulation_task_id_seq: int = 0
    _device_id_seq: int = 0
    _admin_log_id_seq: int = 0

    def __post_init__(self) -> None:
        if not self.users:
            self.create_admin()

    def create_admin(self) -> None:
        self._user_id_seq += 1
        admin = User(
            id=self._user_id_seq,
            phone="00000000000",
            password_hash=hashlib.sha256("admin".encode()).hexdigest(),
            role="admin",
            expire_at=None,
            created_at=datetime.utcnow(),
        )
        self.users[admin.id] = admin

    def next_user_id(self) -> int:
        self._user_id_seq += 1
        return self._user_id_seq

    def next_dataset_id(self) -> int:
        self._dataset_id_seq += 1
        return self._dataset_id_seq

    def next_train_task_id(self) -> int:
        self._train_task_id_seq += 1
        return self._train_task_id_seq

    def next_inference_task_id(self) -> int:
        self._inference_task_id_seq += 1
        return self._inference_task_id_seq

    def next_simulation_task_id(self) -> int:
        self._simulation_task_id_seq += 1
        return self._simulation_task_id_seq

    def next_device_id(self) -> int:
        self._device_id_seq += 1
        return self._device_id_seq

    def next_admin_log_id(self) -> int:
        self._admin_log_id_seq += 1
        return self._admin_log_id_seq


def create_database() -> InMemoryDatabase:
    return InMemoryDatabase()
