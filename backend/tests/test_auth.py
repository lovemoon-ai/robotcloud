from fastapi.testclient import TestClient


from app.sms import InMemorySmsGateway


def test_auth_flow(client: TestClient, sms_gateway: InMemorySmsGateway, create_invitation) -> None:
    invitation_code = create_invitation()
    send_resp = client.post("/api/v1/auth/send_code", json={"phone": "13800000000"})
    assert send_resp.status_code == 200
    code = sms_gateway.get_code("13800000000")

    register_resp = client.post(
        "/api/v1/auth/register",
        json={
            "phone": "13800000000",
            "password": "123456",
            "code": code,
            "invitation_code": invitation_code,
        },
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


def test_login_unknown_phone_triggers_error(client: TestClient) -> None:
    response = client.post("/api/v1/auth/login", json={"phone": "13900000000", "password": "secret123"})
    assert response.status_code == 400
    assert response.json()["detail"] == "Phone not registered"


def test_send_code_rejects_invalid_phone(client: TestClient) -> None:
    response = client.post("/api/v1/auth/send_code", json={"phone": "12345"})
    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid phone number"


def test_send_code_uses_gateway(client: TestClient, sms_gateway: InMemorySmsGateway) -> None:
    response = client.post("/api/v1/auth/send_code", json={"phone": "13900000001"})
    assert response.status_code == 200
    assert sms_gateway.get_code("13900000001").isdigit()


def test_register_requires_valid_invitation(client: TestClient, sms_gateway: InMemorySmsGateway) -> None:
    send_resp = client.post("/api/v1/auth/send_code", json={"phone": "13800000002"})
    assert send_resp.status_code == 200
    code = sms_gateway.get_code("13800000002")
    register_resp = client.post(
        "/api/v1/auth/register",
        json={
            "phone": "13800000002",
            "password": "123456",
            "code": code,
            "invitation_code": "INVALID",
        },
    )
    assert register_resp.status_code == 400
    assert register_resp.json()["detail"] == "Invalid invitation code"


def test_register_with_invitation_without_sms(client: TestClient, create_invitation) -> None:
    invitation_code = create_invitation(code="INV-TEST01")
    register_resp = client.post(
        "/api/v1/auth/register_invite",
        json={"phone": "13800000005", "password": "pw123456", "invitation_code": invitation_code},
    )
    assert register_resp.status_code == 200
    login_resp = client.post(
        "/api/v1/auth/login", json={"phone": "13800000005", "password": "pw123456"}
    )
    assert login_resp.status_code == 200
