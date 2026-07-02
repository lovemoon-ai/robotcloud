from django.test import override_settings
from rest_framework.test import APIClient


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


def test_dev_mode_payment_amount(client: APIClient, create_user_token, auth_header) -> None:
    """Test that dev mode uses 0.01 RMB (1 cent) for payment."""
    from django.conf import settings
    token = create_user_token("13800000022", "dev_amount")

    create_resp = client.post(
        "/api/v1/payment/create",
        {"target_role": "plus", "provider": "alipay"},
        format="json",
        **auth_header(token),
    )
    assert create_resp.status_code == 200
    payment = create_resp.json()["data"]
    # In dev mode (DEBUG=True), amount should be 1 cent
    # In test mode (DEBUG may be False), amount should be normal price
    if settings.DEBUG:
        assert payment["amount_cents"] == 1
    else:
        assert payment["amount_cents"] == 60000  # Plus price: 600 RMB


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
