"""Tests for the Model API endpoints."""
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from robotcloud_backend.api.models import TrainTask
from robotcloud_backend.sms import InMemorySmsGateway


def _setup_user_and_dataset(client: APIClient, sms_gateway: InMemorySmsGateway, phone: str) -> tuple[str, int]:
    """Create a user and upload a dataset, returning (token, dataset_id)."""
    send_resp = client.post("/api/v1/auth/send_code", {"phone": phone}, format="json")
    assert send_resp.status_code == 200
    code = sms_gateway.get_code(phone)
    client.post(
        "/api/v1/auth/register",
        {
            "phone": phone,
            "password": "modelpw",
            "code": code,
        },
        format="json",
    )
    login_resp = client.post(
        "/api/v1/auth/login",
        {"phone": phone, "password": "modelpw"},
        format="json",
    )
    token = login_resp.json()["data"]["token"]

    upload_file = SimpleUploadedFile("model_test.zip", b"content", content_type="application/zip")
    data = {"name": "model_dataset", "description": "desc", "visibility": "private", "file": upload_file}
    dataset_resp = client.post(
        "/api/v1/dataset/upload",
        data=data,
        format="multipart",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    dataset_id = dataset_resp.json()["data"]["dataset_id"]
    return token, dataset_id


def _create_completed_training(client: APIClient, token: str, dataset_id: int) -> int:
    """Create a training task and mark it as completed, returning task_id."""
    create_resp = client.post(
        "/api/v1/training/create",
        {"dataset_id": dataset_id, "model_type": "ACT", "params": {"learning_rate": 0.001, "steps": 5000}},
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert create_resp.status_code == 200
    task_id = create_resp.json()["data"]["task_id"]

    # Mark the task as completed directly in the database
    task = TrainTask.objects.get(id=task_id)
    task.status = "completed"
    task.model_path = f"/storage/models/{task_id}.pt"
    task.save(update_fields=["status", "model_path"])

    return task_id


def test_list_models_empty(client: APIClient, sms_gateway: InMemorySmsGateway) -> None:
    """Test listing models when no completed training tasks exist."""
    token, _ = _setup_user_and_dataset(client, sms_gateway, "13900000101")

    resp = client.get(
        "/api/v1/model/list",
        {"page": 1, "size": 10},
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["total"] == 0
    assert data["items"] == []


def test_list_models_with_completed_tasks(client: APIClient, sms_gateway: InMemorySmsGateway) -> None:
    """Test listing models returns only completed training tasks."""
    token, dataset_id = _setup_user_and_dataset(client, sms_gateway, "13900000102")

    # Create a queued task (should not appear in models)
    client.post(
        "/api/v1/training/create",
        {"dataset_id": dataset_id, "model_type": "DiffusionPolicy", "params": {}},
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )

    # Create a completed task (should appear in models)
    model_id = _create_completed_training(client, token, dataset_id)

    resp = client.get(
        "/api/v1/model/list",
        {"page": 1, "size": 10},
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["total"] == 1
    assert len(data["items"]) == 1

    model = data["items"][0]
    assert model["model_id"] == model_id
    assert model["model_type"] == "ACT"
    assert model["dataset_id"] == dataset_id
    assert model["dataset_name"] == "model_dataset"
    assert model["name"] == "ACT-model_dataset"
    assert model["model_path"].endswith(f"{model_id}.pt")
    assert "created_at" in model


def test_get_model_detail(client: APIClient, sms_gateway: InMemorySmsGateway) -> None:
    """Test getting a single model's details."""
    token, dataset_id = _setup_user_and_dataset(client, sms_gateway, "13900000103")
    model_id = _create_completed_training(client, token, dataset_id)

    resp = client.get(
        f"/api/v1/model/{model_id}",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert resp.status_code == 200
    model = resp.json()["data"]
    assert model["model_id"] == model_id
    assert model["model_type"] == "ACT"
    assert model["dataset_id"] == dataset_id
    assert model["dataset_name"] == "model_dataset"
    assert model["name"] == "ACT-model_dataset"
    assert model["model_path"].endswith(f"{model_id}.pt")
    assert "params" in model
    assert model["params"]["learning_rate"] == 0.001
    assert model["params"]["steps"] == 5000


def test_get_model_not_found(client: APIClient, sms_gateway: InMemorySmsGateway) -> None:
    """Test getting a non-existent model returns an error."""
    token, _ = _setup_user_and_dataset(client, sms_gateway, "13900000104")

    resp = client.get(
        "/api/v1/model/99999",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert resp.status_code == 400
    assert "not found" in resp.json()["detail"].lower()


def test_get_model_not_completed(client: APIClient, sms_gateway: InMemorySmsGateway) -> None:
    """Test that queued/running tasks are not accessible as models."""
    token, dataset_id = _setup_user_and_dataset(client, sms_gateway, "13900000105")

    # Create a queued task
    create_resp = client.post(
        "/api/v1/training/create",
        {"dataset_id": dataset_id, "model_type": "ACT", "params": {}},
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    task_id = create_resp.json()["data"]["task_id"]

    # Try to get it as a model (should fail)
    resp = client.get(
        f"/api/v1/model/{task_id}",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert resp.status_code == 400
    assert "not found" in resp.json()["detail"].lower()


def test_model_requires_auth(client: APIClient) -> None:
    """Test that model endpoints require authentication."""
    list_resp = client.get("/api/v1/model/list")
    assert list_resp.status_code == 400

    detail_resp = client.get("/api/v1/model/1")
    assert detail_resp.status_code == 400
