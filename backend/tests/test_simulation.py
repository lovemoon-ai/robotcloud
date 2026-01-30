from rest_framework.test import APIClient

from robotcloud_backend.sms import InMemorySmsGateway


def _user_token(client: APIClient, sms_gateway: InMemorySmsGateway) -> str:
    send_resp = client.post("/api/v1/auth/send_code", {"phone": "13900000003"}, format="json")
    assert send_resp.status_code == 200
    code = sms_gateway.get_code("13900000003")
    client.post(
        "/api/v1/auth/register",
        {
            "phone": "13900000003",
            "password": "simpw",
            "code": code,
        },
        format="json",
    )
    login_resp = client.post(
        "/api/v1/auth/login",
        {"phone": "13900000003", "password": "simpw"},
        format="json",
    )
    return login_resp.json()["data"]["token"]


def test_simulation_flow(client: APIClient, sms_gateway: InMemorySmsGateway) -> None:
    token = _user_token(client, sms_gateway)

    create_resp = client.post(
        "/api/v1/sim/create",
        {
            "scene_file": "warehouse.usd",
            "model_id": 1,
            "robot_type": "S100",
            "training_mode": "reinforcement",
        },
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert create_resp.status_code == 200
    task_id = create_resp.json()["data"]["task_id"]

    status_resp = client.get(
        f"/api/v1/sim/{task_id}/status",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert status_resp.status_code == 200
    assert status_resp.json()["data"]["status"] in {"queued", "running"}

    bind_resp = client.post(
        "/api/v1/sim/bind_device",
        {"device_sn": "S100-00012", "model_id": 1},
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert bind_resp.status_code == 200
    assert bind_resp.json()["data"]["device_id"] > 0
