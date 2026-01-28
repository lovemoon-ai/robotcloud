from rest_framework.test import APIClient


from robotcloud_backend.sms import InMemorySmsGateway


def test_auth_flow(client: APIClient, sms_gateway: InMemorySmsGateway, create_invitation) -> None:
    invitation_code = create_invitation()
    send_resp = client.post("/api/v1/auth/send_code", {"phone": "13800000000"}, format="json")
    assert send_resp.status_code == 200
    code = sms_gateway.get_code("13800000000")

    register_resp = client.post(
        "/api/v1/auth/register",
        {
            "phone": "13800000000",
            "password": "123456",
            "code": code,
            "invitation_code": invitation_code,
        },
        format="json",
    )
    assert register_resp.status_code == 200
    user_id = register_resp.json()["data"]["user_id"]
    assert user_id > 1

    login_resp = client.post(
        "/api/v1/auth/login",
        {"phone": "13800000000", "password": "123456"},
        format="json",
    )
    assert login_resp.status_code == 200
    token = login_resp.json()["data"]["token"]

    verify_resp = client.get(
        "/api/v1/auth/verify_token",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert verify_resp.status_code == 200
    payload = verify_resp.json()["data"]
    assert payload["user_id"] == user_id
    assert payload["role"] == "free"


def test_login_unknown_phone_triggers_error(client: APIClient) -> None:
    response = client.post(
        "/api/v1/auth/login",
        {"phone": "13900000000", "password": "secret123"},
        format="json",
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Phone not registered"


def test_send_code_rejects_invalid_phone(client: APIClient) -> None:
    response = client.post("/api/v1/auth/send_code", {"phone": "12345"}, format="json")
    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid phone number"


def test_send_code_uses_gateway(client: APIClient, sms_gateway: InMemorySmsGateway) -> None:
    response = client.post("/api/v1/auth/send_code", {"phone": "13900000001"}, format="json")
    assert response.status_code == 200
    assert sms_gateway.get_code("13900000001").isdigit()


def test_register_requires_valid_invitation(client: APIClient, sms_gateway: InMemorySmsGateway) -> None:
    send_resp = client.post("/api/v1/auth/send_code", {"phone": "13800000002"}, format="json")
    assert send_resp.status_code == 200
    code = sms_gateway.get_code("13800000002")
    register_resp = client.post(
        "/api/v1/auth/register",
        {
            "phone": "13800000002",
            "password": "123456",
            "code": code,
            "invitation_code": "INVALID",
        },
        format="json",
    )
    assert register_resp.status_code == 400
    assert register_resp.json()["detail"] == "Invalid invitation code"


def test_register_with_invitation_without_sms(client: APIClient, create_invitation) -> None:
    invitation_code = create_invitation(code="INV-TEST01")
    register_resp = client.post(
        "/api/v1/auth/register_invite",
        {"phone": "13800000005", "password": "pw123456", "invitation_code": invitation_code},
        format="json",
    )
    assert register_resp.status_code == 200
    login_resp = client.post(
        "/api/v1/auth/login",
        {"phone": "13800000005", "password": "pw123456"},
        format="json",
    )
    assert login_resp.status_code == 200


def test_login_with_code_new_user(client: APIClient, sms_gateway: InMemorySmsGateway) -> None:
    """Test login with SMS code for a new user (auto-registration)."""
    send_resp = client.post("/api/v1/auth/send_code", {"phone": "13800000010"}, format="json")
    assert send_resp.status_code == 200
    code = sms_gateway.get_code("13800000010")

    login_resp = client.post(
        "/api/v1/auth/login_code",
        {"phone": "13800000010", "code": code},
        format="json",
    )
    assert login_resp.status_code == 200
    data = login_resp.json()["data"]
    assert data["token"]
    assert data["phone"] == "13800000010"
    assert data["role"] == "free"


def test_login_with_code_existing_user(client: APIClient, sms_gateway: InMemorySmsGateway, create_invitation) -> None:
    """Test login with SMS code for an existing user."""
    invitation_code = create_invitation(code="INV-TEST02")
    client.post(
        "/api/v1/auth/register_invite",
        {"phone": "13800000011", "password": "pw123456", "invitation_code": invitation_code},
        format="json",
    )

    send_resp = client.post("/api/v1/auth/send_code", {"phone": "13800000011"}, format="json")
    assert send_resp.status_code == 200
    code = sms_gateway.get_code("13800000011")

    login_resp = client.post(
        "/api/v1/auth/login_code",
        {"phone": "13800000011", "code": code},
        format="json",
    )
    assert login_resp.status_code == 200
    data = login_resp.json()["data"]
    assert data["token"]
    assert data["phone"] == "13800000011"


def test_login_with_code_invalid_code(client: APIClient, sms_gateway: InMemorySmsGateway) -> None:
    """Test login with invalid SMS code."""
    send_resp = client.post("/api/v1/auth/send_code", {"phone": "13800000012"}, format="json")
    assert send_resp.status_code == 200

    login_resp = client.post(
        "/api/v1/auth/login_code",
        {"phone": "13800000012", "code": "999999"},
        format="json",
    )
    assert login_resp.status_code == 400
    assert login_resp.json()["detail"] == "Invalid verification code"


def test_login_with_code_and_invitation(client: APIClient, sms_gateway: InMemorySmsGateway, create_invitation) -> None:
    """Test login with SMS code and invitation code for new user."""
    invitation_code = create_invitation(code="INV-TEST03")
    send_resp = client.post("/api/v1/auth/send_code", {"phone": "13800000013"}, format="json")
    assert send_resp.status_code == 200
    code = sms_gateway.get_code("13800000013")

    login_resp = client.post(
        "/api/v1/auth/login_code",
        {"phone": "13800000013", "code": code, "invitation_code": invitation_code},
        format="json",
    )
    assert login_resp.status_code == 200
    data = login_resp.json()["data"]
    assert data["token"]
    assert data["phone"] == "13800000013"
