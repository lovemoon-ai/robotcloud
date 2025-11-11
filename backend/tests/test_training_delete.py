from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from robotcloud_backend.sms import InMemorySmsGateway


def _setup_user_and_dataset(client: APIClient, sms_gateway: InMemorySmsGateway, create_invitation, phone: str) -> tuple[str, int]:
    invitation_code = create_invitation()
    register_resp = client.post(
        "/api/v1/auth/register_invite",
        {"phone": phone, "password": "trainpw", "invitation_code": invitation_code},
        format="json",
    )
    assert register_resp.status_code == 200

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


def test_delete_training_task(client: APIClient, sms_gateway: InMemorySmsGateway, create_invitation) -> None:
    token, dataset_id = _setup_user_and_dataset(client, sms_gateway, create_invitation, "13900000009")

    create_resp = client.post(
        "/api/v1/training/create",
        {"dataset_id": dataset_id, "model_type": "yolov8", "params": {"epochs": 10}},
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert create_resp.status_code == 200
    task_id = create_resp.json()["data"]["task_id"]

    # Ensure it is listed
    list_resp = client.get(
        "/api/v1/training/list",
        {"page": 1, "size": 10},
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert list_resp.status_code == 200
    assert list_resp.json()["data"]["total"] == 1

    # Delete the task
    delete_resp = client.post(
        f"/api/v1/training/{task_id}/delete",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert delete_resp.status_code == 200
    assert delete_resp.json()["data"]["deleted"] is True

    # It should no longer appear in list
    list_resp2 = client.get(
        "/api/v1/training/list",
        {"page": 1, "size": 10},
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert list_resp2.status_code == 200
    assert list_resp2.json()["data"]["total"] == 0

