from rest_framework.test import APIClient


def test_payment_flow_and_upgrade_guardrails(client: APIClient, create_user_token, auth_header) -> None:
    token = create_user_token("13800000002", "abcdef")

    # Create payment for Pro
    create_resp = client.post(
        "/api/v1/payment/create",
        {"target_role": "pro", "provider": "wechat"},
        format="json",
        **auth_header(token),
    )
    assert create_resp.status_code == 200
    payment = create_resp.json()["data"]
    assert payment["status"] == "pending"
    payment_id = payment["payment_id"]
    assert payment["provider"] == "wechat"
    assert payment["pay_code"].startswith("PAY-wechat-")

    # Cannot upgrade while payment is pending
    pending_upgrade = client.post(
        "/api/v1/user/upgrade",
        {"target_role": "pro", "payment_id": payment_id},
        format="json",
        **auth_header(token),
    )
    assert pending_upgrade.status_code == 400

    # Simulate provider callback to mark success
    callback_resp = client.post(
        "/api/v1/payment/callback/mock",
        {"payment_id": payment_id, "status": "succeeded"},
        format="json",
    )
    assert callback_resp.status_code == 200
    assert callback_resp.json()["data"]["status"] == "succeeded"

    # Fetch status via authenticated endpoint
    status_resp = client.get(f"/api/v1/payment/{payment_id}", **auth_header(token))
    assert status_resp.status_code == 200
    assert status_resp.json()["data"]["status"] == "succeeded"

    # Upgrade now succeeds and stamps expire_at
    upgrade_resp = client.post(
        "/api/v1/user/upgrade",
        {"target_role": "pro", "payment_id": payment_id},
        format="json",
        **auth_header(token),
    )
    assert upgrade_resp.status_code == 200
    upgrade_data = upgrade_resp.json()["data"]
    assert upgrade_data["role"] == "pro"
    assert upgrade_data["expire_at"] is not None


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
        assert payment["amount_cents"] == 9900  # Normal Plus price
