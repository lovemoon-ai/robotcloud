from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List, Tuple

import pytest

from gpu_agent.agent import TrainingJob


class _StubAgent:
    def __init__(self) -> None:
        self.logger = logging.getLogger("robotcloud.test.gpu_agent")
        self._notifications: List[Tuple[int, str, float, Dict[str, Any]]] = []
        self.finished: List[int] = []

    def notify_status(self, task_id: int, status: str, progress: float, metrics: Dict[str, Any]) -> None:
        self._notifications.append((task_id, status, progress, metrics))

    def finish_job(self, task_id: int) -> None:
        self.finished.append(task_id)

    @property
    def notifications(self) -> List[Tuple[int, str, float, Dict[str, Any]]]:
        return list(self._notifications)


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def test_training_job_builds_command_with_dataset_arg(tmp_path: Path) -> None:
    agent = _StubAgent()
    log_dir = tmp_path / "logs"
    dataset_path = "/mnt/datasets/session123"
    params = {"dataset_arg": "--dataset", "epochs": 5, "extra_args": ["--foo", "bar"]}
    job = TrainingJob(
        agent=agent,
        task_id=7,
        gpus=[0],
        params=params,
        dataset_path=dataset_path,
        cmd="lerobot --policy act",
        log_dir=log_dir,
        work_dir=_repo_root(),
    )

    command = job._build_command()  # accessing helper for deterministic assertion

    assert command[0] == str(_repo_root() / "scripts" / "lerobot.sh")
    assert any(tok == "--epochs=5" for tok in command)
    assert any(tok == f"--dataset={dataset_path}" for tok in command)
    assert command[-2:] == ["--foo", "bar"]


def test_training_job_parses_progress_from_logs(tmp_path: Path) -> None:
    agent = _StubAgent()
    job = TrainingJob(
        agent=agent,
        task_id=9,
        gpus=[0],
        params={},
        dataset_path="/tmp/data",
        cmd="python train.py",
        log_dir=tmp_path / "logs",
        work_dir=_repo_root(),
    )

    job._handle_output_line('{"progress": 0.1, "metrics": {"loss": 0.5}}')
    job._handle_output_line("Epoch 2/10 loss=0.32")
    job._handle_output_line("progress=0.95")

    notifications = agent.notifications
    assert len(notifications) == 3
    assert notifications[0][1] == "running"
    assert pytest.approx(notifications[0][2], rel=1e-6) == 0.1
    assert pytest.approx(notifications[1][2], rel=1e-6) == 0.2
    assert pytest.approx(notifications[1][3]["loss"], rel=1e-6) == 0.32
    assert pytest.approx(notifications[-1][2], rel=1e-6) == 0.95
