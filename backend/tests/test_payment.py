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
