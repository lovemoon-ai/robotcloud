from __future__ import annotations

import hashlib
import io
import json
import logging
import tarfile
import threading
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Tuple

import pytest
import requests

from gpu_agent.agent import Agent, AgentHTTPRequestHandler, AgentHTTPServer, TrainingJob
from gpu_agent.config import AgentConfig


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


class _BackendResponse:
    def __init__(self, data: Dict[str, Any], status_code: int = 200) -> None:
        self._data = data
        self.status_code = status_code
        self.ok = 200 <= status_code < 300
        self.text = str(data)

    def json(self) -> Dict[str, Any]:
        return self._data


class _BackendSession:
    def __init__(self) -> None:
        self.complete_payload: Dict[str, Any] | None = None

    def post(
        self,
        url: str,
        json: Dict[str, Any] | None = None,  # noqa: A002
        headers: Dict[str, str] | None = None,
        timeout: int | None = None,
    ) -> _BackendResponse:
        if url.endswith("/internal/dataset/upload/verify"):
            return _BackendResponse(
                {
                    "code": 0,
                    "data": {
                        "dataset_id": json["dataset_id"] if json else 0,
                        "node_name": "gpu-node-1",
                        "file_name": "episodes.zip",
                        "owner_id": 1,
                    },
                }
            )
        if url.endswith("/internal/dataset/upload/complete"):
            self.complete_payload = json or {}
            return _BackendResponse(
                {
                    "code": 0,
                    "data": {
                        "dataset_id": json["dataset_id"] if json else 0,
                        "status": "ready",
                        "file_name": "episodes.zip",
                        "file_size": json["file_size"] if json else 0,
                        "total_files": 1,
                        "storage_node": "gpu-node-1",
                    },
                }
            )
        raise AssertionError(f"Unexpected backend URL: {url}")


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _agent_config(tmp_path: Path) -> AgentConfig:
    return AgentConfig(
        backend_base_url="http://backend.example.test/api/v1",
        node_name="gpu-node-1",
        report_ip="127.0.0.1",
        listen_host="127.0.0.1",
        api_port=0,
        public_base_url="http://127.0.0.1",
        upload_enabled=True,
        upload_allowed_origins=(),
        gpu_total=1,
        heartbeat_interval=30,
        version="test",
        step_delay=0.1,
        log_dir=tmp_path / "logs",
        work_dir=tmp_path,
        dataset_cache_dir=tmp_path / "storage" / "datasets_cache",
    )


def test_agent_dataset_inspection_extracts_lerobot_metadata(tmp_path: Path) -> None:
    archive_path = tmp_path / "so101.zip"
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr(
            "dataset/meta/info.json",
            json.dumps(
                {
                    "total_tasks": 1,
                    "features": {
                        "observation.images.head": {"dtype": "video"},
                        "observation.images.wrist": {"dtype": "video"},
                        "observation.state": {"dtype": "float32", "shape": [6]},
                        "action": {"dtype": "float32", "shape": [6]},
                    },
                }
            ).encode("utf-8"),
        )
        archive.writestr("dataset/meta/tasks.parquet", b"PAR1")

    agent = Agent(_agent_config(tmp_path), session=_BackendSession())  # type: ignore[arg-type]
    metadata = agent.inspect_dataset_file(archive_path)

    assert metadata["lerobot_camera_keys"] == [
        "observation.images.head",
        "observation.images.wrist",
    ]
    assert metadata["lerobot_has_task"] is True
    assert metadata["lerobot_task_count"] == 1


def test_agent_resumable_dataset_upload(tmp_path: Path) -> None:
    backend_session = _BackendSession()
    agent = Agent(_agent_config(tmp_path), session=backend_session)  # type: ignore[arg-type]
    agent.agent_token = "agent-token"
    server = AgentHTTPServer(("127.0.0.1", 0), AgentHTTPRequestHandler, agent)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_address[1]}"
    headers = {
        "Authorization": "Bearer upload-token",
        "X-Dataset-Id": "42",
        "X-Filename": "episodes.zip",
    }
    payload = b"abcdefg"

    try:
        status_resp = requests.get(
            f"{base_url}/api/v1/agent/datasets/upload/status",
            headers=headers,
            timeout=5,
        )
        assert status_resp.status_code == 200
        assert status_resp.json()["uploaded_bytes"] == 0

        first = requests.put(
            f"{base_url}/api/v1/agent/datasets/upload/chunk",
            data=payload[:3],
            headers={**headers, "Content-Range": "bytes 0-2/7", "Content-Type": "application/zip"},
            timeout=5,
        )
        assert first.status_code == 200
        assert first.json()["uploaded_bytes"] == 3

        status_resp = requests.get(
            f"{base_url}/api/v1/agent/datasets/upload/status",
            headers=headers,
            timeout=5,
        )
        assert status_resp.status_code == 200
        assert status_resp.json()["uploaded_bytes"] == 3

        second = requests.put(
            f"{base_url}/api/v1/agent/datasets/upload/chunk",
            data=payload[3:],
            headers={**headers, "Content-Range": "bytes 3-6/7", "Content-Type": "application/zip"},
            timeout=5,
        )
        assert second.status_code == 200
        assert second.json()["uploaded_bytes"] == 7

        complete = requests.post(
            f"{base_url}/api/v1/agent/datasets/upload/complete",
            headers={**headers, "X-File-Size": "7"},
            timeout=5,
        )
        assert complete.status_code == 200
        assert complete.json()["status"] == "ready"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

    final_path = tmp_path / "storage" / "agent_datasets" / "dataset_42" / "episodes.zip"
    assert final_path.read_bytes() == payload
    assert backend_session.complete_payload is not None
    assert backend_session.complete_payload["storage_path"] == str(final_path)
    assert backend_session.complete_payload["content_md5"] == hashlib.md5(payload).hexdigest()
    assert backend_session.complete_payload["file_size"] == len(payload)


def test_agent_cancel_resumable_dataset_upload_removes_upload_dir(tmp_path: Path) -> None:
    agent = Agent(_agent_config(tmp_path), session=_BackendSession())  # type: ignore[arg-type]
    agent.agent_token = "agent-token"
    upload_dir = agent.dataset_upload_dir(42)
    upload_dir.mkdir(parents=True)
    (upload_dir / "episodes.zip.part").write_bytes(b"partial")
    server = AgentHTTPServer(("127.0.0.1", 0), AgentHTTPRequestHandler, agent)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_address[1]}"

    try:
        resp = requests.post(
            f"{base_url}/api/v1/agent/datasets/upload/cancel",
            json={"dataset_id": 42},
            headers={"X-Agent-Token": "agent-token"},
            timeout=5,
        )
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

    assert resp.status_code == 200
    assert resp.json()["removed"] == [str(upload_dir)]
    assert not upload_dir.exists()


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

    assert command[0] == str(_repo_root() / "scripts" / "lerobot-train.sh")
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


def test_training_job_parses_lerobot_step_logs(tmp_path: Path) -> None:
    agent = _StubAgent()
    job = TrainingJob(
        agent=agent,
        task_id=12,
        gpus=[0],
        params={"steps": 5000},
        dataset_path="/tmp/data",
        cmd="python train.py",
        log_dir=tmp_path / "logs",
        work_dir=_repo_root(),
    )

    job._handle_output_line(
        "INFO 2026-07-02 21:12:20 ot_train.py:351 step:200 smpl:3K ep:21 "
        "epch:0.71 loss:6.010 grdn:113.250 lr:1.0e-05 updt_s:0.171 data_s:0.020"
    )
    job._handle_output_line(
        "INFO 2026-07-02 21:13:59 ot_train.py:351 step:1K smpl:16K ep:106 "
        "epch:3.55 loss:1.638 grdn:46.851 lr:1.0e-05 updt_s:0.105 data_s:0.011"
    )
    job._handle_output_line(
        "INFO 2026-07-02 21:14:30 ot_train.py:351 step:6K smpl:16K ep:106 "
        "epch:3.55 loss:1.100 grdn:40.000 lr:1.0e-05 updt_s:0.105 data_s:0.011"
    )

    notifications = agent.notifications
    assert len(notifications) == 3
    assert notifications[0][1] == "running"
    assert pytest.approx(notifications[0][2], rel=1e-6) == 0.04
    assert notifications[0][3]["current_step"] == 200
    assert notifications[0][3]["total_steps"] == 5000
    assert pytest.approx(notifications[0][3]["loss"], rel=1e-6) == 6.01
    assert pytest.approx(notifications[0][3]["lr"], rel=1e-6) == 1.0e-05
    assert pytest.approx(notifications[1][2], rel=1e-6) == 0.2
    assert notifications[1][3]["current_step"] == 1000
    assert pytest.approx(notifications[1][3]["loss"], rel=1e-6) == 1.638
    assert notifications[2][2] == 1.0
    assert notifications[2][3]["current_step"] == 6000


def test_training_job_rejects_zip_path_traversal(tmp_path: Path) -> None:
    agent = _StubAgent()
    archive_path = tmp_path / "bad.zip"
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr("../escape.txt", b"bad")

    job = TrainingJob(
        agent=agent,
        task_id=10,
        gpus=[0],
        params={},
        dataset_path="",
        cmd="python train.py",
        log_dir=tmp_path / "logs",
        work_dir=_repo_root(),
    )

    assert job._extract_archive(archive_path) is None
    assert not (tmp_path / "escape.txt").exists()


def test_training_job_rejects_tar_path_traversal(tmp_path: Path) -> None:
    agent = _StubAgent()
    archive_path = tmp_path / "bad.tar"
    payload = b"bad"
    with tarfile.open(archive_path, "w") as archive:
        member = tarfile.TarInfo("../escape.txt")
        member.size = len(payload)
        archive.addfile(member, io.BytesIO(payload))

    job = TrainingJob(
        agent=agent,
        task_id=11,
        gpus=[0],
        params={},
        dataset_path="",
        cmd="python train.py",
        log_dir=tmp_path / "logs",
        work_dir=_repo_root(),
    )

    assert job._extract_archive(archive_path) is None
    assert not (tmp_path / "escape.txt").exists()
