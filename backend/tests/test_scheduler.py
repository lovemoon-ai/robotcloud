from __future__ import annotations

from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from robotcloud_backend.api.models import Dataset, WorkerNode
from robotcloud_backend.api.scheduler import (
    SchedulerService,
    _normalize_policy_name,
    _so101_policy_default_params,
)
from robotcloud_backend.sms import InMemorySmsGateway


def test_scheduler_normalizes_lerobot_060_training_models() -> None:
    cases = {
        "ACT": "act",
        "dp": "diffusion",
        "DiffusionPolicy": "diffusion",
        "VQBeT": "vqbet",
        "MultiTaskDiT": "multi_task_dit",
        "TDMPC": "tdmpc",
        "Pi0": "pi0",
        "Pi0Fast": "pi0_fast",
        "Pi0.5": "pi05",
        "GR00T_N1.7": "groot",
        "SmolVLA": "smolvla",
        "XVLA": "xvla",
        "EO1": "eo1",
        "MolmoAct2": "molmoact2",
        "WALL-OSS": "wall_x",
        "EVO1": "evo1",
        "VLA-JEPA": "vla_jepa",
        "LingBot-VA": "lingbot_va",
        "FastWAM": "fastwam",
    }

    for model_type, policy_type in cases.items():
        assert _normalize_policy_name(model_type) == policy_type


def test_scheduler_defines_so101_policy_defaults() -> None:
    fastwam_defaults = _so101_policy_default_params("fastwam")
    assert fastwam_defaults["policy.action_dim"] == 6
    assert fastwam_defaults["policy.proprio_dim"] == 6
    assert fastwam_defaults["policy.image_size"] == [224, 448]

    fastwam_defaults["policy.action_dim"] = 7
    assert _so101_policy_default_params("fastwam")["policy.action_dim"] == 6

    assert _so101_policy_default_params("vla_jepa")["policy.enable_world_model"] is False
    assert _so101_policy_default_params("evo1")["policy.max_views"] == 3


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


def _mark_dataset_as_so101(dataset_id: int, *, include_wrist: bool = True, include_task: bool = True) -> None:
    cameras = ["observation.images.head"]
    if include_wrist:
        cameras.append("observation.images.wrist")
    Dataset.objects.filter(id=dataset_id).update(
        metadata={
            "lerobot_info_present": True,
            "lerobot_camera_keys": cameras,
            "lerobot_features": [*cameras, "observation.state", "action", "task_index"],
            "lerobot_has_task": include_task,
            "lerobot_task_count": 1 if include_task else 0,
        }
    )


def test_scheduler_dispatches_so101_defaults_to_agent(
    client: APIClient, sms_gateway: InMemorySmsGateway, monkeypatch
) -> None:
    token, dataset_id = _setup_user_and_dataset(client, sms_gateway, "13800000012")
    _mark_dataset_as_so101(dataset_id)
    dataset = Dataset.objects.get(id=dataset_id)
    dataset.storage_backend = Dataset.STORAGE_BACKEND_AGENT
    dataset.storage_node = "gpu-node-fastwam"
    dataset.storage_path = "/srv/robotcloud/agent_datasets/dataset_fastwam/train.zip"
    dataset.save(update_fields=["storage_backend", "storage_node", "storage_path"])

    register_resp = client.post(
        "/api/v1/internal/agent/register",
        {
            "node_name": "gpu-node-fastwam",
            "ip": "10.0.0.20",
            "gpu_total": 1,
            "version": "1.0.0",
            "port": 5000,
        },
        format="json",
    )
    assert register_resp.status_code == 200
    agent_token = register_resp.json()["data"]["token"]

    create_resp = client.post(
        "/api/v1/training/create",
        {
            "dataset_id": dataset_id,
            "model_type": "FastWAM",
            "params": {"steps": 12, "batch_size": 1},
        },
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert create_resp.status_code == 200

    def _fake_dispatch(url, json=None, headers=None, timeout=None):
        assert url == "http://10.0.0.20:5000/api/v1/agent/run"
        assert headers and headers.get("X-Agent-Token") == agent_token
        assert json["dataset_path"] == "/srv/robotcloud/agent_datasets/dataset_fastwam/train.zip"
        params = json["params"]
        assert params["policy.type"] == "fastwam"
        assert params["steps"] == 12
        assert params["batch_size"] == 1
        assert params["policy.action_dim"] == 6
        assert params["policy.proprio_dim"] == 6
        assert params["policy.image_size"] == [224, 448]

        class _Response:
            def raise_for_status(self) -> None:
                return None

            def json(self) -> dict:
                return {"status": "accepted"}

        return _Response()

    monkeypatch.setattr("robotcloud_backend.api.scheduler.requests.post", _fake_dispatch)

    scheduler = SchedulerService(loop_interval=0.01)
    assert scheduler.perform_scheduling_cycle() == 1


def test_training_rejects_so101_model_without_required_wrist_camera(
    client: APIClient, sms_gateway: InMemorySmsGateway
) -> None:
    token, dataset_id = _setup_user_and_dataset(client, sms_gateway, "13800000013")
    _mark_dataset_as_so101(dataset_id, include_wrist=False)

    create_resp = client.post(
        "/api/v1/training/create",
        {"dataset_id": dataset_id, "model_type": "MultiTaskDiT", "params": {}},
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )

    assert create_resp.status_code == 400
    assert "observation.images.wrist" in create_resp.json()["message"]


def test_training_rejects_task_model_without_lerobot_tasks(
    client: APIClient, sms_gateway: InMemorySmsGateway
) -> None:
    token, dataset_id = _setup_user_and_dataset(client, sms_gateway, "13800000014")
    _mark_dataset_as_so101(dataset_id, include_task=False)

    create_resp = client.post(
        "/api/v1/training/create",
        {"dataset_id": dataset_id, "model_type": "MolmoAct2", "params": {}},
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )

    assert create_resp.status_code == 400
    assert "meta/tasks.parquet" in create_resp.json()["message"]


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


def test_scheduler_routes_agent_stored_dataset_to_storage_node(
    client: APIClient, sms_gateway: InMemorySmsGateway, monkeypatch
) -> None:
    token, dataset_id = _setup_user_and_dataset(client, sms_gateway, "13800000003")
    dataset = Dataset.objects.get(id=dataset_id)
    dataset.storage_backend = Dataset.STORAGE_BACKEND_AGENT
    dataset.storage_node = "gpu-node-2"
    dataset.storage_path = "/srv/robotcloud/agent_datasets/dataset_1/train.zip"
    dataset.save(update_fields=["storage_backend", "storage_node", "storage_path"])

    register_1 = client.post(
        "/api/v1/internal/agent/register",
        {"node_name": "gpu-node-1", "ip": "10.0.0.11", "gpu_total": 4, "version": "1.0.0", "port": 5000},
        format="json",
    )
    register_2 = client.post(
        "/api/v1/internal/agent/register",
        {"node_name": "gpu-node-2", "ip": "10.0.0.12", "gpu_total": 1, "version": "1.0.0", "port": 5000},
        format="json",
    )
    assert register_1.status_code == 200
    assert register_2.status_code == 200
    agent_token_2 = register_2.json()["data"]["token"]

    create_resp = client.post(
        "/api/v1/training/create",
        {"dataset_id": dataset_id, "model_type": "yolov8", "params": {"epochs": 2}},
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert create_resp.status_code == 200

    def _fake_dispatch(url, json=None, headers=None, timeout=None, **kwargs):
        assert "/api/v1/agent/upload" not in url
        assert url == "http://10.0.0.12:5000/api/v1/agent/run"
        assert headers and headers.get("X-Agent-Token") == agent_token_2
        assert json["dataset_path"] == "/srv/robotcloud/agent_datasets/dataset_1/train.zip"

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
        f"/api/v1/training/{create_resp.json()['data']['task_id']}/status",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert status_resp.status_code == 200
    assert status_resp.json()["data"]["assigned_node"] == "gpu-node-2"
