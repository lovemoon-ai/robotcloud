from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from robotcloud_backend.sms import InMemorySmsGateway


def _setup_user_and_dataset(client: APIClient, sms_gateway: InMemorySmsGateway, phone: str) -> tuple[str, int]:
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


def test_training_lifecycle(client: APIClient, sms_gateway: InMemorySmsGateway) -> None:
    token, dataset_id = _setup_user_and_dataset(client, sms_gateway, "13900000001")

    create_resp = client.post(
        "/api/v1/training/create",
        {"dataset_id": dataset_id, "model_type": "yolov8", "params": {"epochs": 10}},
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert create_resp.status_code == 200
    task_id = create_resp.json()["data"]["task_id"]

    list_resp = client.get(
        "/api/v1/training/list",
        {"page": 1, "size": 10},
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert list_resp.status_code == 200
    data = list_resp.json()["data"]
    assert data["total"] == 1
    assert data["items"][0]["task_id"] == task_id

    status_resp = client.get(
        f"/api/v1/training/{task_id}/status",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert status_resp.status_code == 200
    status_data = status_resp.json()["data"]
    assert status_data["task_id"] == task_id
    assert status_data["assigned_node"] is None
    assert status_data["assigned_gpus"] == []
    assert status_data["priority"] == 10
    assert status_data["queue_position"] == 1

    stop_resp = client.post(
        f"/api/v1/training/{task_id}/stop",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert stop_resp.status_code == 200
    assert stop_resp.json()["data"]["status"] == "failed"

    download_resp = client.get(
        f"/api/v1/training/{task_id}/download",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert download_resp.status_code == 200
    assert download_resp.json()["data"]["model_path"].endswith(f"{task_id}.pt")
