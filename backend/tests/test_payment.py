from urllib.parse import urlencode

from django.test import override_settings
from rest_framework.test import APIClient

from robotcloud_backend.payment.alipay import AlipayClient


@override_settings(DEBUG=True)
def test_payment_flow_and_upgrade_guardrails(client: APIClient, create_user_token, auth_header) -> None:
    """Test Plus plan payment flow and upgrade - only Plus plan is available."""
    token = create_user_token("13800000002", "abcdef")

    # Create payment for Plus (only Plus is available)
    create_resp = client.post(
        "/api/v1/payment/create",
        {"target_role": "plus", "provider": "alipay"},
        format="json",
        **auth_header(token),
    )
    assert create_resp.status_code == 200
    payment = create_resp.json()["data"]
    assert payment["status"] == "pending"
    payment_id = payment["payment_id"]
    assert payment["provider"] == "alipay"

    # Cannot upgrade while payment is pending
    pending_upgrade = client.post(
        "/api/v1/user/upgrade",
        {"target_role": "plus", "payment_id": payment_id},
        format="json",
        **auth_header(token),
    )
    assert pending_upgrade.status_code == 400

    # Simulate provider callback to mark success
    callback_resp = client.post(
        "/api/v1/payment/callback/mock",
        {"payment_id": payment_id, "status": "succeeded"},
        format="json",
        **auth_header(token),
    )
    assert callback_resp.status_code == 200
    assert callback_resp.json()["data"]["status"] == "succeeded"

    # Fetch status via authenticated endpoint
    status_resp = client.get(f"/api/v1/payment/{payment_id}", **auth_header(token))
    assert status_resp.status_code == 200
    assert status_resp.json()["data"]["status"] == "succeeded"

    # Upgrade now succeeds and stamps expire_at (30 days subscription)
    upgrade_resp = client.post(
        "/api/v1/user/upgrade",
        {"target_role": "plus", "payment_id": payment_id},
        format="json",
        **auth_header(token),
    )
    assert upgrade_resp.status_code == 200
    upgrade_data = upgrade_resp.json()["data"]
    assert upgrade_data["role"] == "plus"
    assert upgrade_data["expire_at"] is not None


def test_mock_payment_callback_requires_owner_token(client: APIClient, create_user_token, auth_header) -> None:
    token = create_user_token("13800000024", "mock_auth")
    create_resp = client.post(
        "/api/v1/payment/create",
        {"target_role": "plus", "provider": "alipay"},
        format="json",
        **auth_header(token),
    )
    assert create_resp.status_code == 200
    payment_id = create_resp.json()["data"]["payment_id"]

    callback_resp = client.post(
        "/api/v1/payment/callback/mock",
        {"payment_id": payment_id, "status": "succeeded"},
        format="json",
    )
    assert callback_resp.status_code == 400
    assert "authorization" in callback_resp.json()["message"].lower()


@override_settings(DEBUG=False)
def test_mock_payment_callback_disabled_outside_debug(client: APIClient, create_user_token, auth_header) -> None:
    token = create_user_token("13800000025", "mock_disabled")
    create_resp = client.post(
        "/api/v1/payment/create",
        {"target_role": "plus", "provider": "alipay"},
        format="json",
        **auth_header(token),
    )
    assert create_resp.status_code == 200
    payment_id = create_resp.json()["data"]["payment_id"]

    callback_resp = client.post(
        "/api/v1/payment/callback/mock",
        {"payment_id": payment_id, "status": "succeeded"},
        format="json",
        **auth_header(token),
    )
    assert callback_resp.status_code == 403
    assert "disabled" in callback_resp.json()["message"].lower()


def test_pro_plan_not_available(client: APIClient, create_user_token, auth_header) -> None:
    """Test that Pro plan is not available - only Plus is supported."""
    token = create_user_token("13800000003", "pro_test")

    # Attempt to create payment for Pro should fail
    create_resp = client.post(
        "/api/v1/payment/create",
        {"target_role": "pro", "provider": "alipay"},
        format="json",
        **auth_header(token),
    )
    assert create_resp.status_code == 400
    assert "only plus" in create_resp.json()["detail"].lower() or "unsupported" in create_resp.json()["detail"].lower()


def test_wechat_not_supported(client: APIClient, create_user_token, auth_header) -> None:
    """Test that WeChat Pay is not supported - only Alipay is supported."""
    token = create_user_token("13800000004", "wechat_test")

    # Attempt to use WeChat Pay should fail
    create_resp = client.post(
        "/api/v1/payment/create",
        {"target_role": "plus", "provider": "wechat"},
        format="json",
        **auth_header(token),
    )
    assert create_resp.status_code == 400
    assert "alipay" in create_resp.json()["detail"].lower()


def test_alipay_verify_notify_removes_signature_before_sdk_verify(monkeypatch) -> None:
    seen = {}

    class FakeAlipaySdk:
        def verify(self, data, signature) -> bool:
            seen["data"] = dict(data)
            seen["signature"] = signature
            data.pop("sign_type", None)
            return signature == "valid-sign" and "sign" not in data

    client = AlipayClient(app_id="app", private_key="private", public_key="public")
    monkeypatch.setattr(client, "_get_sdk", lambda: FakeAlipaySdk())
    payload = {
        "out_trade_no": "payment-id",
        "trade_status": "TRADE_SUCCESS",
        "total_amount": "1000.00",
        "sign": "valid-sign",
        "sign_type": "RSA2",
    }

    assert client.verify_notify(payload) is True
    assert seen["signature"] == "valid-sign"
    assert "sign" not in seen["data"]
    assert seen["data"]["sign_type"] == "RSA2"
    assert payload["sign"] == "valid-sign"
    assert payload["sign_type"] == "RSA2"


def test_alipay_payment_flow(client: APIClient, create_user_token, auth_header) -> None:
    """Test Alipay payment creation and query."""
    token = create_user_token("13800000020", "alipay_test")

    # Create payment with Alipay provider
    create_resp = client.post(
        "/api/v1/payment/create",
        {"target_role": "plus", "provider": "alipay"},
        format="json",
        **auth_header(token),
    )
    assert create_resp.status_code == 200
    payment = create_resp.json()["data"]
    assert payment["status"] == "pending"
    assert payment["provider"] == "alipay"
    payment_id = payment["payment_id"]

    # Query Alipay status (should still be pending without real Alipay)
    query_resp = client.get(f"/api/v1/payment/alipay/query/{payment_id}", **auth_header(token))
    assert query_resp.status_code == 200
    assert query_resp.json()["data"]["status"] == "pending"


@override_settings(DEBUG=True, ALIPAY_APP_ID="", ALIPAY_PRIVATE_KEY="", ALIPAY_PUBLIC_KEY="")
def test_alipay_notify_callback(client: APIClient, create_user_token, auth_header) -> None:
    """Test Alipay async notification callback."""
    token = create_user_token("13800000021", "alipay_notify")

    # Create payment
    create_resp = client.post(
        "/api/v1/payment/create",
        {"target_role": "plus", "provider": "alipay"},
        format="json",
        **auth_header(token),
    )
    assert create_resp.status_code == 200
    payment = create_resp.json()["data"]
    payment_id = payment["payment_id"]
    amount_cents = payment["amount_cents"]
    amount_yuan = amount_cents / 100

    # Simulate Alipay notify callback
    notify_resp = client.post(
        "/api/v1/payment/alipay/notify",
        {
            "out_trade_no": payment_id,
            "trade_status": "TRADE_SUCCESS",
            "total_amount": f"{amount_yuan:.2f}",
        },
        format="json",
    )
    assert notify_resp.status_code == 200
    assert notify_resp.content == b"success"

    # Verify payment status is now succeeded
    status_resp = client.get(f"/api/v1/payment/{payment_id}", **auth_header(token))
    assert status_resp.status_code == 200
    assert status_resp.json()["data"]["status"] == "succeeded"


@override_settings(DEBUG=True, ALIPAY_APP_ID="", ALIPAY_PRIVATE_KEY="", ALIPAY_PUBLIC_KEY="")
def test_alipay_notify_accepts_form_encoded_callback(client: APIClient, create_user_token, auth_header) -> None:
    token = create_user_token("13800000027", "alipay_form_notify")

    create_resp = client.post(
        "/api/v1/payment/create",
        {"target_role": "plus", "provider": "alipay"},
        format="json",
        **auth_header(token),
    )
    assert create_resp.status_code == 200
    payment = create_resp.json()["data"]

    notify_resp = client.post(
        "/api/v1/payment/alipay/notify",
        urlencode(
            {
                "out_trade_no": payment["payment_id"],
                "trade_status": "TRADE_SUCCESS",
                "total_amount": f"{payment['amount_cents'] / 100:.2f}",
            }
        ),
        content_type="application/x-www-form-urlencoded",
    )
    assert notify_resp.status_code == 200
    assert notify_resp.content == b"success"

    status_resp = client.get(f"/api/v1/payment/{payment['payment_id']}", **auth_header(token))
    assert status_resp.status_code == 200
    assert status_resp.json()["data"]["status"] == "succeeded"


@override_settings(DEBUG=False)
def test_alipay_notify_accepts_signed_form_callback_when_configured(
    client: APIClient,
    create_user_token,
    auth_header,
    monkeypatch,
) -> None:
    class ConfiguredAlipay:
        def is_configured(self) -> bool:
            return True

        def create_page_pay(self, **kwargs) -> str:
            return "https://alipay.example.test/checkout"

        def verify_notify(self, data) -> bool:
            return data.get("sign") == "valid-sign"

    monkeypatch.setattr("robotcloud_backend.api.services.get_alipay", lambda: ConfiguredAlipay())
    token = create_user_token("13800000028", "alipay_signed_form_notify")

    create_resp = client.post(
        "/api/v1/payment/create",
        {"target_role": "plus", "provider": "alipay"},
        format="json",
        **auth_header(token),
    )
    assert create_resp.status_code == 200
    payment = create_resp.json()["data"]

    notify_resp = client.post(
        "/api/v1/payment/alipay/notify",
        urlencode(
            {
                "out_trade_no": payment["payment_id"],
                "trade_status": "TRADE_SUCCESS",
                "total_amount": f"{payment['amount_cents'] / 100:.2f}",
                "sign": "valid-sign",
                "sign_type": "RSA2",
            }
        ),
        content_type="application/x-www-form-urlencoded",
    )
    assert notify_resp.status_code == 200
    assert notify_resp.content == b"success"

    status_resp = client.get(f"/api/v1/payment/{payment['payment_id']}", **auth_header(token))
    assert status_resp.status_code == 200
    assert status_resp.json()["data"]["status"] == "succeeded"

    profile_resp = client.get("/api/v1/user/profile", **auth_header(token))
    assert profile_resp.status_code == 200
    assert profile_resp.json()["data"]["role"] == "plus"


@override_settings(DEBUG=True, ALIPAY_APP_ID="app", ALIPAY_PRIVATE_KEY="private", ALIPAY_PUBLIC_KEY="public")
def test_alipay_notify_rejects_unsigned_when_configured(client: APIClient, create_user_token, auth_header) -> None:
    token = create_user_token("13800000026", "alipay_unsigned")

    create_resp = client.post(
        "/api/v1/payment/create",
        {"target_role": "plus", "provider": "alipay"},
        format="json",
        **auth_header(token),
    )
    assert create_resp.status_code == 200
    payment = create_resp.json()["data"]

    notify_resp = client.post(
        "/api/v1/payment/alipay/notify",
        {
            "out_trade_no": payment["payment_id"],
            "trade_status": "TRADE_SUCCESS",
            "total_amount": f"{payment['amount_cents'] / 100:.2f}",
        },
        format="json",
    )
    assert notify_resp.status_code == 200
    assert notify_resp.content == b"failure"

    status_resp = client.get(f"/api/v1/payment/{payment['payment_id']}", **auth_header(token))
    assert status_resp.status_code == 200
    assert status_resp.json()["data"]["status"] == "pending"


def test_payment_amount_defaults_to_1000_rmb(client: APIClient, create_user_token, auth_header) -> None:
    token = create_user_token("13800000022", "dev_amount")

    create_resp = client.post(
        "/api/v1/payment/create",
        {"target_role": "plus", "provider": "alipay"},
        format="json",
        **auth_header(token),
    )
    assert create_resp.status_code == 200
    payment = create_resp.json()["data"]
    assert payment["amount_cents"] == 100000


@override_settings(DEBUG=True, PAYMENT_DEV_AMOUNT_CENTS=1)
def test_debug_payment_amount_can_use_sandbox_cent_amount(client: APIClient, create_user_token, auth_header) -> None:
    token = create_user_token("13800000028", "debug_amount")

    create_resp = client.post(
        "/api/v1/payment/create",
        {"target_role": "plus", "provider": "alipay"},
        format="json",
        **auth_header(token),
    )
    assert create_resp.status_code == 200
    assert create_resp.json()["data"]["amount_cents"] == 1


@override_settings(DEBUG=False)
def test_plus_payment_uses_1000_rmb_amount(client: APIClient, create_user_token, auth_header) -> None:
    token = create_user_token("13800000027", "prod_amount")

    create_resp = client.post(
        "/api/v1/payment/create",
        {"target_role": "plus", "provider": "alipay"},
        format="json",
        **auth_header(token),
    )
    assert create_resp.status_code == 200
    assert create_resp.json()["data"]["amount_cents"] == 100000


@override_settings(DEBUG=True)
def test_plus_user_cannot_upgrade_again(client: APIClient, create_user_token, auth_header) -> None:
    """Test that Plus users cannot create another payment."""
    # Create user and upgrade to Plus
    token = create_user_token("13800000023", "plus_user")
    
    # First upgrade to Plus
    create_resp = client.post(
        "/api/v1/payment/create",
        {"target_role": "plus", "provider": "alipay"},
        format="json",
        **auth_header(token),
    )
    assert create_resp.status_code == 200
    payment_id = create_resp.json()["data"]["payment_id"]
    
    # Mark as succeeded
    client.post(
        "/api/v1/payment/callback/mock",
        {"payment_id": payment_id, "status": "succeeded"},
        format="json",
        **auth_header(token),
    )
    
    # Apply upgrade
    client.post(
        "/api/v1/user/upgrade",
        {"target_role": "plus", "payment_id": payment_id},
        format="json",
        **auth_header(token),
    )
    
    # Try to create another payment - should fail
    create_resp2 = client.post(
        "/api/v1/payment/create",
        {"target_role": "plus", "provider": "alipay"},
        format="json",
        **auth_header(token),
    )
    assert create_resp2.status_code == 400
    assert "only available for free" in create_resp2.json()["detail"].lower()
