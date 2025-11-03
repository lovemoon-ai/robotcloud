from fastapi.testclient import TestClient

from app.sms import InMemorySmsGateway


def _prepare_dataset(client: TestClient, sms_gateway: InMemorySmsGateway, create_invitation) -> tuple[str, int]:
    send_resp = client.post("/api/v1/auth/send_code", json={"phone": "13900000002"})
    assert send_resp.status_code == 200
    code = sms_gateway.get_code("13900000002")
    invitation_code = create_invitation()
    client.post(
        "/api/v1/auth/register",
        json={
            "phone": "13900000002",
            "password": "inferpw",
            "code": code,
            "invitation_code": invitation_code,
        },
    )
    login_resp = client.post(
        "/api/v1/auth/login", json={"phone": "13900000002", "password": "inferpw"}
    )
    token = login_resp.json()["data"]["token"]

    files = {"file": ("infer.zip", b"content", "application/zip")}
    data = {"name": "infer", "description": "desc", "visibility": "private"}
    dataset_resp = client.post(
        "/api/v1/dataset/upload",
        headers={"Authorization": f"Bearer {token}"},
        files=files,
        data=data,
    )
    dataset_id = dataset_resp.json()["data"]["dataset_id"]
    return token, dataset_id


def test_inference_flow(client: TestClient, sms_gateway: InMemorySmsGateway, create_invitation) -> None:
    token, dataset_id = _prepare_dataset(client, sms_gateway, create_invitation)

    create_resp = client.post(
        "/api/v1/inference/create",
        headers={"Authorization": f"Bearer {token}"},
        json={"model_id": 1, "dataset_id": dataset_id},
    )
    assert create_resp.status_code == 200
    task_id = create_resp.json()["data"]["task_id"]

    result_resp = client.get(
        f"/api/v1/inference/{task_id}/result",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert result_resp.status_code == 200
    result = result_resp.json()["data"]
    assert result["task_id"] == task_id
    assert result["status"] == "completed"
    assert result["results"][0]["sample_id"] == "00001"
