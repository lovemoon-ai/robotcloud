from fastapi.testclient import TestClient


def _create_user_with_dataset(client: TestClient) -> int:
    send_resp = client.post("/api/v1/auth/send_code", json={"phone": "13900000004"})
    code = send_resp.json()["data"]["code"]
    client.post(
        "/api/v1/auth/register",
        json={"phone": "13900000004", "password": "adminpw", "code": code},
    )
    login_resp = client.post(
        "/api/v1/auth/login", json={"phone": "13900000004", "password": "adminpw"}
    )
    token = login_resp.json()["data"]["token"]

    files = {"file": ("admin.zip", b"content", "application/zip")}
    data = {"name": "admin_ds", "description": "desc", "visibility": "public"}
    upload_resp = client.post(
        "/api/v1/dataset/upload",
        headers={"Authorization": f"Bearer {token}"},
        files=files,
        data=data,
    )
    return upload_resp.json()["data"]["dataset_id"]


def _admin_token(client: TestClient) -> str:
    login_resp = client.post(
        "/api/v1/auth/login", json={"phone": "00000000000", "password": "admin"}
    )
    return login_resp.json()["data"]["token"]


def test_admin_endpoints(client: TestClient) -> None:
    dataset_id = _create_user_with_dataset(client)
    admin_token = _admin_token(client)
    headers = {"Authorization": f"Bearer {admin_token}"}

    users_resp = client.get("/api/v1/admin/users", headers=headers, params={"page": 1})
    assert users_resp.status_code == 200
    assert users_resp.json()["data"]["total"] >= 1

    review_resp = client.post(
        f"/api/v1/admin/dataset/{dataset_id}/review",
        headers=headers,
        json={"status": "approved"},
    )
    assert review_resp.status_code == 200
    assert review_resp.json()["data"]["status"] == "approved"

    overview_resp = client.get("/api/v1/admin/overview", headers=headers)
    assert overview_resp.status_code == 200
    overview = overview_resp.json()["data"]
    assert overview["users"] >= 1
    assert overview["datasets"] >= 1
