from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APIClient

from robotcloud_backend.sms import InMemorySmsGateway
from robotcloud_backend.api.models import Dataset, TrainTask, User


def _prepare_dataset(
    client: APIClient,
    sms_gateway: InMemorySmsGateway,
    phone: str = "13900000002",
) -> tuple[str, int]:
    send_resp = client.post("/api/v1/auth/send_code", {"phone": phone}, format="json")
    assert send_resp.status_code == 200
    code = sms_gateway.get_code(phone)
    client.post(
        "/api/v1/auth/register",
        {
            "phone": phone,
            "password": "inferpw",
            "code": code,
        },
        format="json",
    )
    login_resp = client.post(
        "/api/v1/auth/login",
        {"phone": phone, "password": "inferpw"},
        format="json",
    )
    token = login_resp.json()["data"]["token"]

    upload_file = SimpleUploadedFile("infer.zip", b"content", content_type="application/zip")
    data = {"name": "infer", "description": "desc", "visibility": "private", "file": upload_file}
    dataset_resp = client.post(
        "/api/v1/dataset/upload",
        data=data,
        format="multipart",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    dataset_id = dataset_resp.json()["data"]["dataset_id"]
    return token, dataset_id


def test_inference_flow(client: APIClient, sms_gateway: InMemorySmsGateway) -> None:
    token, dataset_id = _prepare_dataset(client, sms_gateway)
    user = User.objects.get(phone="13900000002")
    user.role = User.ROLE_PLUS
    user.save(update_fields=["role"])
    dataset = Dataset.objects.get(id=dataset_id)
    train_task = TrainTask.objects.create(
        dataset=dataset,
        user=user,
        model_type="ACT",
        params={},
        status="completed",
        progress=1.0,
        logs_url="",
        checkpoint_path="/tmp/checkpoints/task_1",
    )

    create_resp = client.post(
        "/api/v1/inference/create",
        {"model_id": train_task.id},
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert create_resp.status_code == 200
    task_id = create_resp.json()["data"]["task_id"]

    result_resp = client.get(
        f"/api/v1/inference/{task_id}/result",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert result_resp.status_code == 200
    result = result_resp.json()["data"]
    assert result["task_id"] == task_id
    assert result["model_type"] == "act"
    assert result["status"] in {"queued", "running", "completed", "failed"}
    assert result["checkpoint_path"] == "/tmp/checkpoints/task_1"

    list_resp = client.get(
        "/api/v1/inference/list",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert list_resp.status_code == 200
    listed = list_resp.json()["data"]["items"][0]
    assert listed["task_id"] == task_id
    assert listed["model_type"] == "act"

    close_resp = client.post(
        f"/api/v1/inference/{task_id}/close",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert close_resp.status_code == 200
    assert close_resp.json()["data"]["status"] == "completed"

    result_after_close = client.get(
        f"/api/v1/inference/{task_id}/result",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert result_after_close.status_code == 200
    assert result_after_close.json()["data"]["status"] == "completed"

    delete_resp = client.post(
        f"/api/v1/inference/{task_id}/delete",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert delete_resp.status_code == 200
    assert delete_resp.json()["data"]["deleted"] is True


def test_inference_queue_limit(client: APIClient, sms_gateway: InMemorySmsGateway) -> None:
    token, dataset_id = _prepare_dataset(client, sms_gateway)
    user = User.objects.get(phone="13900000002")
    user.role = User.ROLE_PLUS
    user.save(update_fields=["role"])
    dataset = Dataset.objects.get(id=dataset_id)
    train_task = TrainTask.objects.create(
        dataset=dataset,
        user=user,
        model_type="ACT",
        params={},
        status="completed",
        progress=1.0,
        logs_url="",
        checkpoint_path="/tmp/checkpoints/task_1",
    )
    for _ in range(3):
        resp = client.post(
            "/api/v1/inference/create",
            {"model_id": train_task.id},
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        assert resp.status_code == 200

    overflow_resp = client.post(
        "/api/v1/inference/create",
        {"model_id": train_task.id},
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert overflow_resp.status_code == 400
    assert "limit" in overflow_resp.json().get("message", "").lower()


@override_settings(AUTH_NO_LIMITS_WHITELIST_PHONES="13900000009")
def test_no_limits_whitelist_bypasses_inference_queue_limit(
    client: APIClient, sms_gateway: InMemorySmsGateway
) -> None:
    token, dataset_id = _prepare_dataset(client, sms_gateway, "13900000009")
    user = User.objects.get(phone="13900000009")
    assert user.role == User.ROLE_PLUS
    dataset = Dataset.objects.get(id=dataset_id)
    train_task = TrainTask.objects.create(
        dataset=dataset,
        user=user,
        model_type="ACT",
        params={},
        status="completed",
        progress=1.0,
        logs_url="",
        checkpoint_path="/tmp/checkpoints/task_1",
    )

    for _ in range(4):
        resp = client.post(
            "/api/v1/inference/create",
            {"model_id": train_task.id},
            format="json",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )
        assert resp.status_code == 200


def test_free_user_cannot_create_inference(client: APIClient, sms_gateway: InMemorySmsGateway) -> None:
    token, dataset_id = _prepare_dataset(client, sms_gateway)
    user = User.objects.get(phone="13900000002")
    dataset = Dataset.objects.get(id=dataset_id)
    train_task = TrainTask.objects.create(
        dataset=dataset,
        user=user,
        model_type="ACT",
        params={},
        status="completed",
        progress=1.0,
        logs_url="",
        checkpoint_path="/tmp/checkpoints/task_1",
    )

    create_resp = client.post(
        "/api/v1/inference/create",
        {"model_id": train_task.id},
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert create_resp.status_code == 403
    assert "free" in create_resp.json()["message"].lower()
