from fastapi.testclient import TestClient


def test_profile(client: TestClient, create_user_token, auth_header) -> None:
    token = create_user_token()
    profile_resp = client.get("/api/v1/user/profile", headers=auth_header(token))
    assert profile_resp.status_code == 200
    profile = profile_resp.json()["data"]
    assert profile["phone"] == "13800000000"
    assert profile["role"] == "free"


def test_upgrade_and_usage(client: TestClient, create_user_token, auth_header) -> None:
    token = create_user_token("13800000001", "abcdef")
    upgrade_resp = client.post(
        "/api/v1/user/upgrade",
        headers=auth_header(token),
        json={"target_role": "plus", "payment_id": "pay_123"},
    )
    assert upgrade_resp.status_code == 200
    assert upgrade_resp.json()["data"]["role"] == "plus"

    files = {"file": ("sample.zip", b"data", "application/zip")}
    data = {"name": "sample", "description": "desc", "visibility": "private"}
    upload_resp = client.post(
        "/api/v1/dataset/upload",
        headers=auth_header(token),
        files=files,
        data=data,
    )
    assert upload_resp.status_code == 200
    dataset_id = upload_resp.json()["data"]["dataset_id"]

    train_resp = client.post(
        "/api/v1/training/create",
        headers=auth_header(token),
        json={"dataset_id": dataset_id, "model_type": "yolov8", "params": {"epochs": 1}},
    )
    assert train_resp.status_code == 200

    infer_resp = client.post(
        "/api/v1/inference/create",
        headers=auth_header(token),
        json={"model_id": 1, "dataset_id": dataset_id},
    )
    assert infer_resp.status_code == 200

    usage_resp = client.get("/api/v1/user/usage", headers=auth_header(token))
    assert usage_resp.status_code == 200
    usage = usage_resp.json()["data"]
    assert usage["training"] == 1
    assert usage["inference"] == 1
