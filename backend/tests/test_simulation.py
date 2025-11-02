from fastapi.testclient import TestClient


def _user_token(client: TestClient) -> str:
    send_resp = client.post("/api/v1/auth/send_code", json={"phone": "13900000003"})
    code = send_resp.json()["data"]["code"]
    client.post(
        "/api/v1/auth/register",
        json={"phone": "13900000003", "password": "simpw", "code": code},
    )
    login_resp = client.post(
        "/api/v1/auth/login", json={"phone": "13900000003", "password": "simpw"}
    )
    return login_resp.json()["data"]["token"]


def test_simulation_flow(client: TestClient) -> None:
    token = _user_token(client)

    create_resp = client.post(
        "/api/v1/sim/create",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "scene_file": "warehouse.usd",
            "model_id": 1,
            "robot_type": "S100",
            "training_mode": "reinforcement",
        },
    )
    assert create_resp.status_code == 200
    task_id = create_resp.json()["data"]["task_id"]

    status_resp = client.get(
        f"/api/v1/sim/{task_id}/status",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert status_resp.status_code == 200
    assert status_resp.json()["data"]["status"] in {"queued", "running"}

    bind_resp = client.post(
        "/api/v1/sim/bind_device",
        headers={"Authorization": f"Bearer {token}"},
        json={"device_sn": "S100-00012", "model_id": 1},
    )
    assert bind_resp.status_code == 200
    assert bind_resp.json()["data"]["device_id"] > 0
