from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient


def test_profile(client: APIClient, create_user_token, auth_header) -> None:
    token = create_user_token()
    profile_resp = client.get("/api/v1/user/profile", **auth_header(token))
    assert profile_resp.status_code == 200
    profile = profile_resp.json()["data"]
    assert profile["phone"] == "13800000000"
    assert profile["role"] == "free"


def test_upgrade_and_usage(client: APIClient, create_user_token, auth_header) -> None:
    token = create_user_token("13800000001", "abcdef")
    payment_resp = client.post(
        "/api/v1/payment/create",
        {"target_role": "plus"},
        format="json",
        **auth_header(token),
    )
    assert payment_resp.status_code == 200
    payment_id = payment_resp.json()["data"]["payment_id"]
    callback_resp = client.post(
        "/api/v1/payment/callback/mock",
        {"payment_id": payment_id, "status": "succeeded"},
        format="json",
    )
    assert callback_resp.status_code == 200
    upgrade_resp = client.post(
        "/api/v1/user/upgrade",
        {"target_role": "plus", "payment_id": payment_id},
        format="json",
        **auth_header(token),
    )
    assert upgrade_resp.status_code == 200
    assert upgrade_resp.json()["data"]["role"] == "plus"

    upload_file = SimpleUploadedFile("sample.zip", b"data", content_type="application/zip")
    data = {
        "name": "sample",
        "description": "desc",
        "visibility": "private",
        "file": upload_file,
    }
    upload_resp = client.post(
        "/api/v1/dataset/upload",
        data=data,
        format="multipart",
        **auth_header(token),
    )
    assert upload_resp.status_code == 200
    dataset_id = upload_resp.json()["data"]["dataset_id"]

    train_resp = client.post(
        "/api/v1/training/create",
        {"dataset_id": dataset_id, "model_type": "yolov8", "params": {"epochs": 1}},
        format="json",
        **auth_header(token),
    )
    assert train_resp.status_code == 200

    infer_resp = client.post(
        "/api/v1/inference/create",
        {"model_id": 1, "dataset_id": dataset_id},
        format="json",
        **auth_header(token),
    )
    assert infer_resp.status_code == 200

    usage_resp = client.get("/api/v1/user/usage", **auth_header(token))
    assert usage_resp.status_code == 200
    usage = usage_resp.json()["data"]
    assert usage["training"] == 1
    assert usage["inference"] == 1
