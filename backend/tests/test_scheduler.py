from __future__ import annotations

from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from robotcloud_backend.api.models import WorkerNode
from robotcloud_backend.api.scheduler import SchedulerService
from robotcloud_backend.sms import InMemorySmsGateway


def _setup_user_and_dataset(
    client: APIClient,
    sms_gateway: InMemorySmsGateway,
    phone: str,
) -> tuple[str, int]:
    send_resp = client.post("/api/v1/auth/send_code", {"phone": phone}, format="json")
    assert send_resp.status_code == 200
    code = sms_gateway.get_code(phone)
    client.post(
        "/api/v1/auth/register",
        {
            "phone": phone,
            "password": "trainpw",
            "code": code,
        },
        format="json",
    )
    login_resp = client.post(
        "/api/v1/auth/login",
        {"phone": phone, "password": "trainpw"},
        format="json",
    )
    token = login_resp.json()["data"]["token"]

    upload_file = SimpleUploadedFile("train.zip", b"content", content_type="application/zip")
    data = {"name": "train", "description": "desc", "visibility": "private", "file": upload_file}
    dataset_resp = client.post(
        "/api/v1/dataset/upload",
        data=data,
        format="multipart",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    dataset_id = dataset_resp.json()["data"]["dataset_id"]
    return token, dataset_id


def test_scheduler_assigns_and_updates_training_task(
    client: APIClient, sms_gateway: InMemorySmsGateway, monkeypatch
) -> None:
    token, dataset_id = _setup_user_and_dataset(client, sms_gateway, "13800000002")

    register_resp = client.post(
        "/api/v1/internal/agent/register",
        {"node_name": "gpu-node-1", "ip": "10.0.0.10", "gpu_total": 2, "version": "1.0.0", "port": 5000},
        format="json",
    )
    assert register_resp.status_code == 200
    agent_token = register_resp.json()["data"]["token"]

    create_resp = client.post(
        "/api/v1/training/create",
        {"dataset_id": dataset_id, "model_type": "yolov8", "params": {"epochs": 2}},
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert create_resp.status_code == 200
    task_id = create_resp.json()["data"]["task_id"]

    def _fake_dispatch(url, json=None, headers=None, timeout=None):
        assert url == "http://10.0.0.10:5000/api/v1/agent/run"
        assert headers and headers.get("X-Agent-Token") == agent_token

        class _Response:
            def raise_for_status(self) -> None:
                return None

            def json(self) -> dict:
                return {"status": "accepted"}

        return _Response()

    monkeypatch.setattr("robotcloud_backend.api.scheduler.requests.post", _fake_dispatch)

    scheduler = SchedulerService(loop_interval=0.01)
    assigned = scheduler.perform_scheduling_cycle()
    assert assigned == 1

    status_resp = client.get(
        f"/api/v1/training/{task_id}/status",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert status_resp.status_code == 200
    status_data = status_resp.json()["data"]
    assert status_data["status"] == "running"
    assert status_data["assigned_node"] == "gpu-node-1"
    assert status_data["assigned_gpus"] == [0]

    update_resp = client.post(
        "/api/v1/internal/training/update",
        {
            "task_id": task_id,
            "status": "completed",
            "progress": 1.0,
            "metrics": {"loss": 0.12},
        },
        format="json",
        HTTP_X_AGENT_TOKEN=agent_token,
    )
    assert update_resp.status_code == 200
    update_data = update_resp.json()["data"]
    assert update_data["status"] == "completed"
    assert update_data["progress"] == 1.0

    final_resp = client.get(
        f"/api/v1/training/{task_id}/status",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert final_resp.status_code == 200
    final_data = final_resp.json()["data"]
    assert final_data["status"] == "completed"
    assert final_data["progress"] == 1.0

    node = WorkerNode.objects.get(node_name="gpu-node-1")
    assert node.gpu_busy == 0
    assert node.status == WorkerNode.STATUS_ONLINE
