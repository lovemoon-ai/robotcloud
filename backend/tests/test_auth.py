from fastapi.testclient import TestClient


def test_auth_flow(client: TestClient) -> None:
    send_resp = client.post("/api/v1/auth/send_code", json={"phone": "13800000000"})
    assert send_resp.status_code == 200
    code = send_resp.json()["data"]["code"]

    register_resp = client.post(
        "/api/v1/auth/register",
        json={"phone": "13800000000", "password": "123456", "code": code},
    )
    assert register_resp.status_code == 200
    user_id = register_resp.json()["data"]["user_id"]
    assert user_id > 1

    login_resp = client.post(
        "/api/v1/auth/login", json={"phone": "13800000000", "password": "123456"}
    )
    assert login_resp.status_code == 200
    token = login_resp.json()["data"]["token"]

    verify_resp = client.get("/api/v1/auth/verify_token", headers={"Authorization": f"Bearer {token}"})
    assert verify_resp.status_code == 200
    payload = verify_resp.json()["data"]
    assert payload["user_id"] == user_id
    assert payload["role"] == "free"
