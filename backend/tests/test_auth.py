from django.core.cache import caches
from django.test import override_settings
from rest_framework.test import APIClient


from robotcloud_backend.api.models import User, UserSession
from robotcloud_backend.sms import InMemorySmsGateway


def register_user(client: APIClient, sms_gateway: InMemorySmsGateway, phone: str, password: str) -> None:
    send_resp = client.post("/api/v1/auth/send_code", {"phone": phone}, format="json")
    assert send_resp.status_code == 200
    code = sms_gateway.get_code(phone)

    register_resp = client.post(
        "/api/v1/auth/register",
        {
            "phone": phone,
            "password": password,
            "code": code,
        },
        format="json",
    )
    assert register_resp.status_code == 200


def test_auth_flow(client: APIClient, sms_gateway: InMemorySmsGateway) -> None:
    send_resp = client.post("/api/v1/auth/send_code", {"phone": "13800000000"}, format="json")
    assert send_resp.status_code == 200
    code = sms_gateway.get_code("13800000000")

    register_resp = client.post(
        "/api/v1/auth/register",
        {
            "phone": "13800000000",
            "password": "123456",
            "code": code,
        },
        format="json",
    )
    assert register_resp.status_code == 200
    user_id = register_resp.json()["data"]["user_id"]
    assert user_id >= 1

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


def test_login_with_code_existing_user(client: APIClient, sms_gateway: InMemorySmsGateway) -> None:
    """Test login with SMS code for an existing user."""
    # First register the user
    client.post("/api/v1/auth/send_code", {"phone": "13800000011"}, format="json")
    code = sms_gateway.get_code("13800000011")
    client.post(
        "/api/v1/auth/register",
        {"phone": "13800000011", "password": "pw123456", "code": code},
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


@override_settings(AUTH_PLUS_WHITELIST_PHONES="13800000036")
def test_register_plus_whitelist_user_defaults_to_plus(client: APIClient, sms_gateway: InMemorySmsGateway) -> None:
    phone = "13800000036"
    password = "pw123456"

    register_user(client, sms_gateway, phone, password)

    user = User.objects.get(phone=phone)
    assert user.role == User.ROLE_PLUS
    assert user.expire_at is None

    login_resp = client.post(
        "/api/v1/auth/login",
        {"phone": phone, "password": password},
        format="json",
    )
    assert login_resp.status_code == 200
    data = login_resp.json()["data"]
    assert data["role"] == User.ROLE_PLUS
    assert data["expire_at"] is None


def test_plus_whitelist_promotes_existing_free_user_on_login(
    client: APIClient, sms_gateway: InMemorySmsGateway
) -> None:
    phone = "13800000037"
    password = "pw123456"
    register_user(client, sms_gateway, phone, password)
    assert User.objects.get(phone=phone).role == User.ROLE_FREE

    with override_settings(AUTH_PLUS_WHITELIST_PHONES=phone):
        login_resp = client.post(
            "/api/v1/auth/login",
            {"phone": phone, "password": password},
            format="json",
        )

    assert login_resp.status_code == 200
    assert login_resp.json()["data"]["role"] == User.ROLE_PLUS
    user = User.objects.get(phone=phone)
    assert user.role == User.ROLE_PLUS
    assert user.expire_at is None


def test_no_limits_whitelist_promotes_existing_free_user_on_login(
    client: APIClient, sms_gateway: InMemorySmsGateway
) -> None:
    phone = "13800000040"
    password = "pw123456"
    register_user(client, sms_gateway, phone, password)
    assert User.objects.get(phone=phone).role == User.ROLE_FREE

    with override_settings(AUTH_NO_LIMITS_WHITELIST_PHONES=phone):
        login_resp = client.post(
            "/api/v1/auth/login",
            {"phone": phone, "password": password},
            format="json",
        )

    assert login_resp.status_code == 200
    assert login_resp.json()["data"]["role"] == User.ROLE_PLUS
    user = User.objects.get(phone=phone)
    assert user.role == User.ROLE_PLUS
    assert user.expire_at is None


@override_settings(AUTH_PLUS_WHITELIST_PHONES="13800000038,13800000039")
def test_plus_whitelist_does_not_downgrade_higher_roles(client: APIClient, sms_gateway: InMemorySmsGateway) -> None:
    admin_phone = "13800000038"
    pro_phone = "13800000039"
    password = "pw123456"
    register_user(client, sms_gateway, admin_phone, password)
    register_user(client, sms_gateway, pro_phone, password)
    User.objects.filter(phone=admin_phone).update(role=User.ROLE_ADMIN, expire_at=None)
    User.objects.filter(phone=pro_phone).update(role=User.ROLE_PRO, expire_at=None)

    admin_login = client.post(
        "/api/v1/auth/login",
        {"phone": admin_phone, "password": password},
        format="json",
    )
    pro_login = client.post(
        "/api/v1/auth/login",
        {"phone": pro_phone, "password": password},
        format="json",
    )

    assert admin_login.status_code == 200
    assert admin_login.json()["data"]["role"] == User.ROLE_ADMIN
    assert pro_login.status_code == 200
    assert pro_login.json()["data"]["role"] == User.ROLE_PRO


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


def test_login_limits_one_session_per_device_type(client: APIClient, sms_gateway: InMemorySmsGateway) -> None:
    phone = "13800000030"
    password = "pw123456"
    register_user(client, sms_gateway, phone, password)

    mobile_login = client.post(
        "/api/v1/auth/login",
        {"phone": phone, "password": password, "device_id": "phone-1", "device_type": "mobile"},
        format="json",
    )
    assert mobile_login.status_code == 200
    old_mobile_token = mobile_login.json()["data"]["token"]

    desktop_login = client.post(
        "/api/v1/auth/login",
        {"phone": phone, "password": password, "device_id": "desktop-1", "device_type": "desktop"},
        format="json",
    )
    assert desktop_login.status_code == 200

    second_mobile = client.post(
        "/api/v1/auth/login",
        {"phone": phone, "password": password, "device_id": "phone-2", "device_type": "mobile"},
        format="json",
    )
    assert second_mobile.status_code == 400
    assert "device limit" in second_mobile.json()["detail"].lower()

    second_desktop = client.post(
        "/api/v1/auth/login",
        {"phone": phone, "password": password, "device_id": "desktop-2", "device_type": "desktop"},
        format="json",
    )
    assert second_desktop.status_code == 400
    assert "device limit" in second_desktop.json()["detail"].lower()

    refreshed_mobile = client.post(
        "/api/v1/auth/login",
        {"phone": phone, "password": password, "device_id": "phone-1", "device_type": "mobile"},
        format="json",
    )
    assert refreshed_mobile.status_code == 200
    new_mobile_token = refreshed_mobile.json()["data"]["token"]

    revoked_resp = client.get(
        "/api/v1/auth/verify_token",
        HTTP_AUTHORIZATION=f"Bearer {old_mobile_token}",
    )
    assert revoked_resp.status_code == 400
    assert revoked_resp.json()["detail"] == "Session revoked"

    verify_resp = client.get(
        "/api/v1/auth/verify_token",
        HTTP_AUTHORIZATION=f"Bearer {new_mobile_token}",
    )
    assert verify_resp.status_code == 200


def test_logout_releases_device_slot(client: APIClient, sms_gateway: InMemorySmsGateway) -> None:
    phone = "13800000032"
    password = "pw123456"
    register_user(client, sms_gateway, phone, password)

    first_login = client.post(
        "/api/v1/auth/login",
        {"phone": phone, "password": password, "device_id": "phone-1", "device_type": "mobile"},
        format="json",
    )
    assert first_login.status_code == 200
    token = first_login.json()["data"]["token"]

    logout_resp = client.post("/api/v1/auth/logout", HTTP_AUTHORIZATION=f"Bearer {token}")
    assert logout_resp.status_code == 200
    assert logout_resp.json()["data"]["logged_out"] is True

    second_login = client.post(
        "/api/v1/auth/login",
        {"phone": phone, "password": password, "device_id": "phone-2", "device_type": "mobile"},
        format="json",
    )
    assert second_login.status_code == 200

    old_token_resp = client.get("/api/v1/auth/verify_token", HTTP_AUTHORIZATION=f"Bearer {token}")
    assert old_token_resp.status_code == 400
    assert old_token_resp.json()["detail"] == "Invalid token"


def test_login_can_replace_existing_device_type(client: APIClient, sms_gateway: InMemorySmsGateway) -> None:
    phone = "13800000033"
    password = "pw123456"
    register_user(client, sms_gateway, phone, password)

    first_login = client.post(
        "/api/v1/auth/login",
        {"phone": phone, "password": password, "device_id": "desktop-1", "device_type": "desktop"},
        format="json",
    )
    assert first_login.status_code == 200
    old_token = first_login.json()["data"]["token"]

    blocked_login = client.post(
        "/api/v1/auth/login",
        {"phone": phone, "password": password, "device_id": "desktop-2", "device_type": "desktop"},
        format="json",
    )
    assert blocked_login.status_code == 400
    assert "device limit" in blocked_login.json()["detail"].lower()

    replacement_login = client.post(
        "/api/v1/auth/login",
        {
            "phone": phone,
            "password": password,
            "device_id": "desktop-2",
            "device_type": "desktop",
            "replace_existing_device": True,
        },
        format="json",
    )
    assert replacement_login.status_code == 200

    revoked_resp = client.get("/api/v1/auth/verify_token", HTTP_AUTHORIZATION=f"Bearer {old_token}")
    assert revoked_resp.status_code == 400
    assert revoked_resp.json()["detail"] == "Session revoked"


def test_legacy_token_cache_entries_are_rejected(client: APIClient, sms_gateway: InMemorySmsGateway) -> None:
    phone = "13800000034"
    password = "pw123456"
    register_user(client, sms_gateway, phone, password)
    user = User.objects.get(phone=phone)
    caches["tokens"].set("legacy-token", user.id, 60)

    response = client.get("/api/v1/auth/verify_token", HTTP_AUTHORIZATION="Bearer legacy-token")
    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid token"
    assert caches["tokens"].get("legacy-token") is None


def _login(client: APIClient, sms_gateway: InMemorySmsGateway, phone: str, password: str) -> str:
    register_user(client, sms_gateway, phone, password)
    login_resp = client.post(
        "/api/v1/auth/login",
        {"phone": phone, "password": password},
        format="json",
    )
    assert login_resp.status_code == 200
    return login_resp.json()["data"]["token"]


def test_token_survives_token_cache_loss(client: APIClient, sms_gateway: InMemorySmsGateway) -> None:
    """A backend restart wipes the in-memory token cache; the token must still
    work by being recovered from the persisted UserSession row (no re-login)."""
    phone = "13800000041"
    token = _login(client, sms_gateway, phone, "pw123456")

    # Simulate the backend restart / redeploy: token cache is gone.
    caches["tokens"].clear()
    assert caches["tokens"].get(token) is None

    response = client.get("/api/v1/auth/verify_token", HTTP_AUTHORIZATION=f"Bearer {token}")
    assert response.status_code == 200
    assert response.json()["data"]["user_id"] == User.objects.get(phone=phone).id
    # Cache is repopulated from the DB so subsequent calls hit the fast path.
    assert caches["tokens"].get(token) is not None


def test_recovery_respects_revoked_session(client: APIClient, sms_gateway: InMemorySmsGateway) -> None:
    """A revoked session must NOT be recoverable after a cache loss."""
    phone = "13800000042"
    token = _login(client, sms_gateway, phone, "pw123456")

    session = UserSession.objects.get(user__phone=phone, status=UserSession.STATUS_ACTIVE)
    session.status = UserSession.STATUS_REVOKED
    session.save(update_fields=["status"])
    caches["tokens"].clear()

    response = client.get("/api/v1/auth/verify_token", HTTP_AUTHORIZATION=f"Bearer {token}")
    assert response.status_code == 400


def test_logout_after_cache_loss_revokes_session(client: APIClient, sms_gateway: InMemorySmsGateway) -> None:
    """Logout must still revoke the DB session when the cache entry is gone,
    otherwise the token would be recoverable right after logout."""
    phone = "13800000043"
    token = _login(client, sms_gateway, phone, "pw123456")

    caches["tokens"].clear()
    logout_resp = client.post("/api/v1/auth/logout", HTTP_AUTHORIZATION=f"Bearer {token}")
    assert logout_resp.status_code == 200

    session = UserSession.objects.get(user__phone=phone)
    assert session.status == UserSession.STATUS_REVOKED

    # Even after clearing the cache again, a logged-out token must not recover.
    caches["tokens"].clear()
    response = client.get("/api/v1/auth/verify_token", HTTP_AUTHORIZATION=f"Bearer {token}")
    assert response.status_code == 400


@override_settings(AUTH_SINGLE_DEVICE_BYPASS_PHONES="13800000031")
def test_single_device_limit_bypass_phone_whitelist(client: APIClient, sms_gateway: InMemorySmsGateway) -> None:
    phone = "13800000031"
    password = "pw123456"
    register_user(client, sms_gateway, phone, password)

    first_mobile = client.post(
        "/api/v1/auth/login",
        {"phone": phone, "password": password, "device_id": "phone-1", "device_type": "mobile"},
        format="json",
    )
    assert first_mobile.status_code == 200

    second_mobile = client.post(
        "/api/v1/auth/login",
        {"phone": phone, "password": password, "device_id": "phone-2", "device_type": "mobile"},
        format="json",
    )
    assert second_mobile.status_code == 200

    active_mobile_sessions = UserSession.objects.filter(
        user__phone=phone,
        device_type=UserSession.DEVICE_MOBILE,
        status=UserSession.STATUS_ACTIVE,
    ).count()
    assert active_mobile_sessions == 2


def test_removed_bypass_whitelist_converges_active_sessions(client: APIClient, sms_gateway: InMemorySmsGateway) -> None:
    phone = "13800000035"
    password = "pw123456"
    register_user(client, sms_gateway, phone, password)

    with override_settings(AUTH_SINGLE_DEVICE_BYPASS_PHONES=phone):
        first_login = client.post(
            "/api/v1/auth/login",
            {"phone": phone, "password": password, "device_id": "phone-1", "device_type": "mobile"},
            format="json",
        )
        assert first_login.status_code == 200
        first_token = first_login.json()["data"]["token"]
        second_login = client.post(
            "/api/v1/auth/login",
            {"phone": phone, "password": password, "device_id": "phone-2", "device_type": "mobile"},
            format="json",
        )
        assert second_login.status_code == 200
        second_token = second_login.json()["data"]["token"]

    verify_second = client.get("/api/v1/auth/verify_token", HTTP_AUTHORIZATION=f"Bearer {second_token}")
    assert verify_second.status_code == 200

    active_mobile_sessions = UserSession.objects.filter(
        user__phone=phone,
        device_type=UserSession.DEVICE_MOBILE,
        status=UserSession.STATUS_ACTIVE,
    ).count()
    assert active_mobile_sessions == 1

    verify_first = client.get("/api/v1/auth/verify_token", HTTP_AUTHORIZATION=f"Bearer {first_token}")
    assert verify_first.status_code == 400
    assert verify_first.json()["detail"] == "Session revoked"
