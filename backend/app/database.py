from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional


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
class InvitationCode:
    code: str
    used: bool
    created_at: datetime
    used_at: Optional[datetime]
    note: Optional[str]
    assigned_user_id: Optional[int]
    assigned_phone: Optional[str]


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
    invitation_codes: Dict[str, InvitationCode] = field(default_factory=dict)
    invitation_store_path: Path = field(
        default_factory=lambda: Path(
            os.environ.get(
                "INVITATION_STORE_PATH",
                Path(__file__).resolve().parent / "invitation_codes.json",
            )
        )
    )

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
        self._load_invitation_codes()

    def create_admin(self) -> None:
        self._user_id_seq += 1
        admin = User(
            id=self._user_id_seq,
            phone="19900000000",
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

    # -------------------- Invitation Codes --------------------
    def list_invitation_codes(self) -> List[InvitationCode]:
        return list(self.invitation_codes.values())

    def get_invitation_code(self, code: str) -> Optional[InvitationCode]:
        return self.invitation_codes.get(code)

    def add_invitation_code(self, code: str, note: Optional[str] = None) -> InvitationCode:
        if not code:
            raise ValueError("Invitation code required")
        if code in self.invitation_codes:
            raise ValueError("Invitation code already exists")
        invitation = InvitationCode(
            code=code,
            used=False,
            created_at=datetime.utcnow(),
            used_at=None,
            note=note,
            assigned_user_id=None,
            assigned_phone=None,
        )
        self.invitation_codes[code] = invitation
        self._save_invitation_codes()
        return invitation

    def generate_invitation_code(self, prefix: str = "INV", length: int = 8, note: Optional[str] = None) -> InvitationCode:
        if length <= 0:
            raise ValueError("Length must be positive")
        import secrets
        import string

        alphabet = string.ascii_uppercase + string.digits
        while True:
            random_part = "".join(secrets.choice(alphabet) for _ in range(length))
            code = f"{prefix}-{random_part}" if prefix else random_part
            if code not in self.invitation_codes:
                break
        return self.add_invitation_code(code, note)

    def update_invitation_code(self, code: str, note: Optional[str] = None) -> InvitationCode:
        invitation = self.invitation_codes.get(code)
        if invitation is None:
            raise ValueError("Invitation code not found")
        invitation.note = note
        self._save_invitation_codes()
        return invitation

    def delete_invitation_code(self, code: str) -> None:
        if code not in self.invitation_codes:
            raise ValueError("Invitation code not found")
        del self.invitation_codes[code]
        self._save_invitation_codes()

    def mark_invitation_used(self, code: str, user_id: int, phone: str) -> None:
        invitation = self.invitation_codes.get(code)
        if invitation is None:
            raise ValueError("Invitation code not found")
        if invitation.used:
            raise ValueError("Invitation code already used")
        invitation.used = True
        invitation.used_at = datetime.utcnow()
        invitation.assigned_user_id = user_id
        invitation.assigned_phone = phone
        self._save_invitation_codes()

    def _load_invitation_codes(self) -> None:
        if not self.invitation_store_path.exists():
            return
        try:
            raw = json.loads(self.invitation_store_path.read_text())
        except json.JSONDecodeError:
            raw = []
        for item in raw:
            created_at = datetime.fromisoformat(item["created_at"])
            used_at_raw = item.get("used_at")
            used_at = datetime.fromisoformat(used_at_raw) if used_at_raw else None
            invitation = InvitationCode(
                code=item["code"],
                used=item.get("used", False),
                created_at=created_at,
                used_at=used_at,
                note=item.get("note"),
                assigned_user_id=item.get("assigned_user_id"),
                assigned_phone=item.get("assigned_phone"),
            )
            self.invitation_codes[invitation.code] = invitation

    def _save_invitation_codes(self) -> None:
        data = []
        for invitation in self.invitation_codes.values():
            data.append({
                "code": invitation.code,
                "used": invitation.used,
                "created_at": invitation.created_at.isoformat(),
                "used_at": invitation.used_at.isoformat() if invitation.used_at else None,
                "note": invitation.note,
                "assigned_user_id": invitation.assigned_user_id,
                "assigned_phone": invitation.assigned_phone,
            })
        self.invitation_store_path.parent.mkdir(parents=True, exist_ok=True)
        self.invitation_store_path.write_text(json.dumps(data, indent=2))


def create_database() -> InMemoryDatabase:
    return InMemoryDatabase()
