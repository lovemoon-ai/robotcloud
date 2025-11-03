from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from robotcloud_backend.sms import InMemorySmsGateway


def _prepare_dataset(client: APIClient, sms_gateway: InMemorySmsGateway, create_invitation) -> tuple[str, int]:
    send_resp = client.post("/api/v1/auth/send_code", {"phone": "13900000002"}, format="json")
    assert send_resp.status_code == 200
    code = sms_gateway.get_code("13900000002")
    invitation_code = create_invitation()
    client.post(
        "/api/v1/auth/register",
        {
            "phone": "13900000002",
            "password": "inferpw",
            "code": code,
            "invitation_code": invitation_code,
        },
        format="json",
    )
    login_resp = client.post(
        "/api/v1/auth/login",
        {"phone": "13900000002", "password": "inferpw"},
        format="json",
    )
    token = login_resp.json()["data"]["token"]

    upload_file = SimpleUploadedFile("infer.zip", b"content", content_type="application/zip")
    data = {"name": "infer", "description": "desc", "visibility": "private", "file": upload_file}
    dataset_resp = client.post(
        "/api/v1/dataset/upload",
        data=data,
        format="multipart",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    dataset_id = dataset_resp.json()["data"]["dataset_id"]
    return token, dataset_id


def test_inference_flow(client: APIClient, sms_gateway: InMemorySmsGateway, create_invitation) -> None:
    token, dataset_id = _prepare_dataset(client, sms_gateway, create_invitation)

    create_resp = client.post(
        "/api/v1/inference/create",
        {"model_id": 1, "dataset_id": dataset_id},
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert create_resp.status_code == 200
    task_id = create_resp.json()["data"]["task_id"]

    result_resp = client.get(
        f"/api/v1/inference/{task_id}/result",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert result_resp.status_code == 200
    result = result_resp.json()["data"]
    assert result["task_id"] == task_id
    assert result["status"] == "completed"
    assert result["results"][0]["sample_id"] == "00001"
