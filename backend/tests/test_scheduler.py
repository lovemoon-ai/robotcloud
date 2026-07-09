from __future__ import annotations

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APIClient

from robotcloud_backend.api.models import Dataset, InferenceTask, TrainTask, User, WorkerNode
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


@override_settings(AUTH_NO_LIMITS_WHITELIST_PHONES="13800000008")
def test_scheduler_no_limits_user_bypasses_training_concurrency_cap(
    client: APIClient, sms_gateway: InMemorySmsGateway, monkeypatch
) -> None:
    token, dataset_id = _setup_user_and_dataset(client, sms_gateway, "13800000008")

    register_resp = client.post(
        "/api/v1/internal/agent/register",
        {"node_name": "gpu-node-4", "ip": "10.0.0.14", "gpu_total": 4, "version": "1.0.0", "port": 5000},
        format="json",
    )
    assert register_resp.status_code == 200
    agent_token = register_resp.json()["data"]["token"]

    task_ids: list[int] = []
    for _ in range(4):
        create_resp = client.post(
            "/api/v1/training/create",
            {"dataset_id": dataset_id, "model_type": "yolov8", "params": {"epochs": 2}},
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        assert create_resp.status_code == 200
        task_ids.append(create_resp.json()["data"]["task_id"])

    dispatched_task_ids: list[int] = []

    def _fake_dispatch(url, json=None, headers=None, timeout=None, **kwargs):
        assert url == "http://10.0.0.14:5000/api/v1/agent/run"
        assert headers and headers.get("X-Agent-Token") == agent_token
        dispatched_task_ids.append(json["task_id"])

        class _Response:
            def raise_for_status(self) -> None:
                return None

            def json(self) -> dict:
                return {"status": "accepted"}

        return _Response()

    monkeypatch.setattr("robotcloud_backend.api.scheduler.requests.post", _fake_dispatch)

    scheduler = SchedulerService(loop_interval=0.01)
    assigned = scheduler.perform_scheduling_cycle()

    assert assigned == 4
    assert set(dispatched_task_ids) == set(task_ids)
    assert TrainTask.objects.filter(id__in=task_ids, status="running").count() == 4


def test_scheduler_applies_safe_pi05_defaults(
    client: APIClient, sms_gateway: InMemorySmsGateway, monkeypatch
) -> None:
    token, dataset_id = _setup_user_and_dataset(client, sms_gateway, "13800000004")
    dataset = Dataset.objects.get(id=dataset_id)
    dataset.storage_backend = Dataset.STORAGE_BACKEND_AGENT
    dataset.storage_node = "h20"
    dataset.storage_path = "/srv/robotcloud/agent_datasets/dataset_6/train.zip"
    dataset.save(update_fields=["storage_backend", "storage_node", "storage_path"])

    register_resp = client.post(
        "/api/v1/internal/agent/register",
        {"node_name": "h20", "ip": "10.0.0.20", "gpu_total": 1, "version": "1.0.0", "port": 6154},
        format="json",
    )
    assert register_resp.status_code == 200
    agent_token = register_resp.json()["data"]["token"]

    create_resp = client.post(
        "/api/v1/training/create",
        {
            "dataset_id": dataset_id,
            "model_type": "Pi0.5",
            "params": {
                "steps": 5000,
                "batch_size": 32,
                "learning_rate": 0.001,
                "policy.type": "pi05",
            },
        },
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert create_resp.status_code == 200

    dispatched: dict = {}

    def _fake_dispatch(url, json=None, headers=None, timeout=None, **kwargs):
        assert url == "http://10.0.0.20:6154/api/v1/agent/run"
        assert headers and headers.get("X-Agent-Token") == agent_token
        dispatched.update(json or {})

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

    params = dispatched["params"]
    assert "policy.type" not in params
    assert params["policy.path"] == "lerobot/pi05_base"
    assert params["policy.dtype"] == "bfloat16"
    assert params["policy.train_expert_only"] is True
    assert params["policy.gradient_checkpointing"] is True
    assert params["rename_map"] == {
        "observation.images.front": "observation.images.base_0_rgb",
        "observation.images.side": "observation.images.left_wrist_0_rgb",
    }
    assert params["batch_size"] == 16
    assert params["learning_rate"] == 2.5e-5


def test_scheduler_dispatches_inference_on_direct_h20_port(
    client: APIClient, sms_gateway: InMemorySmsGateway, monkeypatch
) -> None:
    token, dataset_id = _setup_user_and_dataset(client, sms_gateway, "13800000005")
    user = User.objects.get(phone="13800000005")
    user.role = User.ROLE_PLUS
    user.save(update_fields=["role"])
    dataset = Dataset.objects.get(id=dataset_id)
    train_task = TrainTask.objects.create(
        dataset=dataset,
        user=user,
        model_type="Pi0.5",
        params={},
        status="completed",
        progress=1.0,
        logs_url="",
        checkpoint_path="/srv/checkpoints/pi05",
    )
    register_resp = client.post(
        "/api/v1/internal/agent/register",
        {"node_name": "h20", "ip": "h20.conductor-ai.top", "gpu_total": 1, "version": "1.0.0", "port": 5160},
        format="json",
    )
    assert register_resp.status_code == 200
    agent_token = register_resp.json()["data"]["token"]
    create_resp = client.post(
        "/api/v1/inference/create",
        {"model_id": train_task.id},
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert create_resp.status_code == 200
    dispatched: dict = {}

    def _fake_dispatch(url, json=None, headers=None, timeout=None, **kwargs):
        assert url == "http://h20.conductor-ai.top:5160/api/v1/agent/infer"
        assert headers and headers.get("X-Agent-Token") == agent_token
        dispatched.update(json or {})

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
    assert dispatched["cmd"] == "lerobot-infer"
    assert dispatched["params"] == {"host": "0.0.0.0", "port": 5161}
    assert dispatched["checkpoint_path"] == "/srv/checkpoints/pi05"


def test_scheduler_dispatches_inference_while_training_uses_same_gpu(
    client: APIClient, sms_gateway: InMemorySmsGateway, monkeypatch
) -> None:
    token, dataset_id = _setup_user_and_dataset(client, sms_gateway, "13800000006")
    user = User.objects.get(phone="13800000006")
    user.role = User.ROLE_PLUS
    user.save(update_fields=["role"])
    dataset = Dataset.objects.get(id=dataset_id)
    model_task = TrainTask.objects.create(
        dataset=dataset,
        user=user,
        model_type="Pi0.5",
        params={},
        status="completed",
        progress=1.0,
        logs_url="",
        checkpoint_path="/srv/checkpoints/pi05",
        assigned_node="h20",
        assigned_gpus="[0]",
    )
    TrainTask.objects.create(
        dataset=dataset,
        user=user,
        model_type="Pi0.5",
        params={},
        status="running",
        progress=0.5,
        logs_url="",
        assigned_node="h20",
        assigned_gpus="[0]",
    )
    register_resp = client.post(
        "/api/v1/internal/agent/register",
        {"node_name": "h20", "ip": "10.0.0.20", "gpu_total": 1, "version": "1.0.0", "port": 5160},
        format="json",
    )
    assert register_resp.status_code == 200
    agent_token = register_resp.json()["data"]["token"]
    create_resp = client.post(
        "/api/v1/inference/create",
        {"model_id": model_task.id},
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert create_resp.status_code == 200
    inference_task_id = create_resp.json()["data"]["task_id"]
    dispatched: dict = {}

    def _fake_dispatch(url, json=None, headers=None, timeout=None, **kwargs):
        assert url == "http://10.0.0.20:5160/api/v1/agent/infer"
        assert headers and headers.get("X-Agent-Token") == agent_token
        dispatched.update(json or {})

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
    assert dispatched["task_id"] == inference_task_id
    task = InferenceTask.objects.get(id=inference_task_id)
    assert task.status == "running"
    assert task.assigned_node == "h20"
    assert task.assigned_gpus == "[0]"


def test_scheduler_dispatches_training_while_inference_uses_same_gpu(
    client: APIClient, sms_gateway: InMemorySmsGateway, monkeypatch
) -> None:
    token, dataset_id = _setup_user_and_dataset(client, sms_gateway, "13800000007")
    user = User.objects.get(phone="13800000007")
    dataset = Dataset.objects.get(id=dataset_id)
    dataset.storage_backend = Dataset.STORAGE_BACKEND_AGENT
    dataset.storage_node = "h20"
    dataset.storage_path = "/srv/robotcloud/agent_datasets/dataset_7/train.zip"
    dataset.save(update_fields=["storage_backend", "storage_node", "storage_path"])
    InferenceTask.objects.create(
        model_id=999,
        dataset=dataset,
        user=user,
        status="running",
        progress=0.5,
        assigned_node="h20",
        assigned_gpus="[0]",
        checkpoint_path="/srv/checkpoints/pi05",
    )
    register_resp = client.post(
        "/api/v1/internal/agent/register",
        {"node_name": "h20", "ip": "10.0.0.20", "gpu_total": 1, "version": "1.0.0", "port": 5160},
        format="json",
    )
    assert register_resp.status_code == 200
    agent_token = register_resp.json()["data"]["token"]
    create_resp = client.post(
        "/api/v1/training/create",
        {"dataset_id": dataset_id, "model_type": "Pi0.5", "params": {"steps": 100}},
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert create_resp.status_code == 200
    train_task_id = create_resp.json()["data"]["task_id"]
    dispatched: dict = {}

    def _fake_dispatch(url, json=None, headers=None, timeout=None, **kwargs):
        assert url == "http://10.0.0.20:5160/api/v1/agent/run"
        assert headers and headers.get("X-Agent-Token") == agent_token
        dispatched.update(json or {})

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
    assert dispatched["task_id"] == train_task_id
    task = TrainTask.objects.get(id=train_task_id)
    assert task.status == "running"
    assert task.assigned_node == "h20"
    assert task.assigned_gpus == "[0]"
