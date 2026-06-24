from django.core.files.uploadedfile import SimpleUploadedFile
from django.contrib.auth.hashers import make_password
from rest_framework.test import APIClient

from robotcloud_backend.api.models import User
from robotcloud_backend.sms import InMemorySmsGateway


def _create_user_with_dataset(
    client: APIClient,
    sms_gateway: InMemorySmsGateway,
) -> int:
    send_resp = client.post("/api/v1/auth/send_code", {"phone": "13900000004"}, format="json")
    assert send_resp.status_code == 200
    code = sms_gateway.get_code("13900000004")
    client.post(
        "/api/v1/auth/register",
        {
            "phone": "13900000004",
            "password": "adminpw",
            "code": code,
        },
        format="json",
    )
    login_resp = client.post(
        "/api/v1/auth/login",
        {"phone": "13900000004", "password": "adminpw"},
        format="json",
    )
    token = login_resp.json()["data"]["token"]

    upload_file = SimpleUploadedFile("admin.zip", b"content", content_type="application/zip")
    data = {"name": "admin_ds", "description": "desc", "visibility": "public", "file": upload_file}
    upload_resp = client.post(
        "/api/v1/dataset/upload",
        data=data,
        format="multipart",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    return upload_resp.json()["data"]["dataset_id"]


def _admin_token(client: APIClient) -> str:
    User.objects.update_or_create(
        phone="19900000000",
        defaults={"password_hash": make_password("admin"), "role": User.ROLE_ADMIN},
    )
    login_resp = client.post(
        "/api/v1/auth/login",
        {"phone": "19900000000", "password": "admin"},
        format="json",
    )
    return login_resp.json()["data"]["token"]


def test_admin_endpoints(client: APIClient, sms_gateway: InMemorySmsGateway) -> None:
    dataset_id = _create_user_with_dataset(client, sms_gateway)
    admin_token = _admin_token(client)

    users_resp = client.get(
        "/api/v1/admin/users",
        {"page": 1},
        HTTP_AUTHORIZATION=f"Bearer {admin_token}",
    )
    assert users_resp.status_code == 200
    assert users_resp.json()["data"]["total"] >= 1

    review_resp = client.post(
        f"/api/v1/admin/dataset/{dataset_id}/review",
        {"status": "approved"},
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {admin_token}",
    )
    assert review_resp.status_code == 200
    assert review_resp.json()["data"]["status"] == "approved"

    overview_resp = client.get(
        "/api/v1/admin/overview",
        HTTP_AUTHORIZATION=f"Bearer {admin_token}",
    )
    assert overview_resp.status_code == 200
    overview = overview_resp.json()["data"]
    assert overview["users"] >= 1
    assert overview["datasets"] >= 1
