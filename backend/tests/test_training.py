from fastapi.testclient import TestClient


def _setup_user_and_dataset(client: TestClient, phone: str) -> tuple[str, int]:
    send_resp = client.post("/api/v1/auth/send_code", json={"phone": phone})
    code = send_resp.json()["data"]["code"]
    client.post(
        "/api/v1/auth/register",
        json={"phone": phone, "password": "trainpw", "code": code},
    )
    login_resp = client.post(
        "/api/v1/auth/login", json={"phone": phone, "password": "trainpw"}
    )
    token = login_resp.json()["data"]["token"]

    files = {"file": ("train.zip", b"content", "application/zip")}
    data = {"name": "train", "description": "desc", "visibility": "private"}
    dataset_resp = client.post(
        "/api/v1/dataset/upload",
        headers={"Authorization": f"Bearer {token}"},
        files=files,
        data=data,
    )
    dataset_id = dataset_resp.json()["data"]["dataset_id"]
    return token, dataset_id


def test_training_lifecycle(client: TestClient) -> None:
    token, dataset_id = _setup_user_and_dataset(client, "13900000001")

    create_resp = client.post(
        "/api/v1/training/create",
        headers={"Authorization": f"Bearer {token}"},
        json={"dataset_id": dataset_id, "model_type": "yolov8", "params": {"epochs": 10}},
    )
    assert create_resp.status_code == 200
    task_id = create_resp.json()["data"]["task_id"]

    list_resp = client.get(
        "/api/v1/training/list",
        headers={"Authorization": f"Bearer {token}"},
        params={"page": 1, "size": 10},
    )
    assert list_resp.status_code == 200
    data = list_resp.json()["data"]
    assert data["total"] == 1
    assert data["items"][0]["task_id"] == task_id

    status_resp = client.get(
        f"/api/v1/training/{task_id}/status",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert status_resp.status_code == 200
    assert status_resp.json()["data"]["task_id"] == task_id

    stop_resp = client.post(
        f"/api/v1/training/{task_id}/stop",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert stop_resp.status_code == 200
    assert stop_resp.json()["data"]["status"] == "failed"

    download_resp = client.get(
        f"/api/v1/training/{task_id}/download",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert download_resp.status_code == 200
    assert download_resp.json()["data"]["model_path"].endswith(f"{task_id}.pt")
