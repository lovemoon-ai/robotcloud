import io
import zipfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APIClient

from robotcloud_backend.api.models import Dataset


def _create_zip_upload() -> SimpleUploadedFile:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("images/0001.png", b"\x89PNG")
        archive.writestr("pointclouds/0001.pcd", b"PCD")
        archive.writestr("metadata/info.json", b"{}")
    buffer.seek(0)
    return SimpleUploadedFile("parking.zip", buffer.read(), content_type="application/zip")


def _upload_dataset(client: APIClient, token: str, visibility: str = "public") -> dict:
    upload_file = _create_zip_upload()
    data = {"name": "parking", "description": "desc", "visibility": visibility, "file": upload_file}
    resp = client.post(
        "/api/v1/dataset/upload",
        data=data,
        format="multipart",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert resp.status_code == 200
    return resp.json()["data"]


def test_dataset_crud(client: APIClient, create_user_token) -> None:
    token = create_user_token("13900000000", "passwd")
    upload_payload = _upload_dataset(client, token)
    dataset_id = upload_payload["dataset_id"]
    assert upload_payload["status"] == "ready"
    assert upload_payload["total_files"] == 3
    assert upload_payload["file_size"] > 0

    list_resp = client.get(
        "/api/v1/dataset/list",
        {"visibility": "public", "page": 1, "size": 10},
    )
    assert list_resp.status_code == 400
    assert "authorization" in list_resp.json()["message"].lower()

    list_resp = client.get(
        "/api/v1/dataset/list",
        {"visibility": "public", "page": 1, "size": 10},
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert list_resp.status_code == 200
    payload = list_resp.json()["data"]
    assert payload["total"] == 1
    first_item = payload["items"][0]
    assert first_item["dataset_id"] == dataset_id
    assert first_item["total_files"] == 3
    assert first_item["preview_available"] is True

    detail_resp = client.get(f"/api/v1/dataset/{dataset_id}")
    assert detail_resp.status_code == 400
    assert "authorization" in detail_resp.json()["message"].lower()

    detail_resp = client.get(f"/api/v1/dataset/{dataset_id}", HTTP_AUTHORIZATION=f"Bearer {token}")
    assert detail_resp.status_code == 200
    detail_payload = detail_resp.json()["data"]
    assert detail_payload["name"] == "parking"
    assert detail_payload["total_files"] == 3

    stats_resp = client.get(f"/api/v1/dataset/{dataset_id}/stats")
    assert stats_resp.status_code == 400
    assert "authorization" in stats_resp.json()["message"].lower()

    stats_resp = client.get(f"/api/v1/dataset/{dataset_id}/stats", HTTP_AUTHORIZATION=f"Bearer {token}")
    assert stats_resp.status_code == 200
    stats_payload = stats_resp.json()["data"]
    assert stats_payload["total_files"] == 3
    # Expect each category counted once based on the test archive contents
    assert stats_payload["by_type"]["image"] == 1
    assert stats_payload["by_type"]["pointcloud"] == 1
    assert stats_payload["by_type"]["metadata"] == 1

    preview_resp = client.get(f"/api/v1/dataset/{dataset_id}/preview")
    assert preview_resp.status_code == 400
    assert "authorization" in preview_resp.json()["message"].lower()

    preview_resp = client.get(f"/api/v1/dataset/{dataset_id}/preview", HTTP_AUTHORIZATION=f"Bearer {token}")
    assert preview_resp.status_code == 200
    preview_payload = preview_resp.json()["data"]["preview"]
    assert len(preview_payload) == 3
    assert preview_payload[0]["type"] == "image"
    assert preview_payload[0]["url"].endswith("images%2F0001.png")


def test_private_dataset_is_not_visible_to_other_users(client: APIClient, create_user_token) -> None:
    owner_token = create_user_token("13900000004", "passwd")
    other_token = create_user_token("13900000005", "passwd")
    upload_payload = _upload_dataset(client, owner_token, visibility="private")
    dataset_id = upload_payload["dataset_id"]

    detail_resp = client.get(f"/api/v1/dataset/{dataset_id}", HTTP_AUTHORIZATION=f"Bearer {other_token}")
    assert detail_resp.status_code == 403
    assert "not accessible" in detail_resp.json()["message"].lower()

    train_resp = client.post(
        "/api/v1/training/create",
        {"dataset_id": dataset_id, "model_type": "detector", "params": {}},
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {other_token}",
    )
    assert train_resp.status_code == 403
    assert "not accessible" in train_resp.json()["message"].lower()


def test_dataset_delete(client: APIClient, create_user_token) -> None:
    """Test deleting a dataset."""
    token = create_user_token("13900000001", "passwd")
    upload_payload = _upload_dataset(client, token)
    dataset_id = upload_payload["dataset_id"]

    # Delete the dataset
    delete_resp = client.post(
        f"/api/v1/dataset/{dataset_id}/delete",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert delete_resp.status_code == 200
    assert delete_resp.json()["data"]["deleted"] is True

    # Verify dataset is gone from list
    list_resp = client.get(
        "/api/v1/dataset/list",
        {"page": 1, "size": 10},
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert list_resp.status_code == 200
    items = list_resp.json()["data"]["items"]
    assert all(item["dataset_id"] != dataset_id for item in items)


def test_dataset_delete_not_owner(client: APIClient, create_user_token) -> None:
    """Test that a user cannot delete another user's dataset."""
    token1 = create_user_token("13900000002", "passwd")
    token2 = create_user_token("13900000003", "passwd")

    # User 1 uploads a dataset
    upload_payload = _upload_dataset(client, token1)
    dataset_id = upload_payload["dataset_id"]

    # User 2 tries to delete it
    delete_resp = client.post(
        f"/api/v1/dataset/{dataset_id}/delete",
        HTTP_AUTHORIZATION=f"Bearer {token2}",
    )
    assert delete_resp.status_code == 403
    assert "do not own" in delete_resp.json()["detail"]


@override_settings(DATASET_UPLOAD_SESSION_TIMEOUT_SECONDS=3600, DATASET_UPLOAD_CHUNK_SIZE=2 * 1024 * 1024)
def test_agent_direct_dataset_upload_session_and_completion(client: APIClient, create_user_token) -> None:
    token = create_user_token("13900000006", "passwd")
    register_resp = client.post(
        "/api/v1/internal/agent/register",
        {
            "node_name": "gpu-node-1",
            "ip": "10.0.0.10",
            "gpu_total": 2,
            "version": "1.0.0",
            "port": 5000,
            "public_base_url": "https://agent.example.test",
            "upload_enabled": True,
        },
        format="json",
    )
    assert register_resp.status_code == 200
    agent_token = register_resp.json()["data"]["token"]

    agents_resp = client.get("/api/v1/agents/active", HTTP_AUTHORIZATION=f"Bearer {token}")
    assert agents_resp.status_code == 200
    assert agents_resp.json()["data"]["items"][0]["can_upload"] is True

    settings_resp = client.post(
        "/api/v1/user/settings",
        {"default_agent_node": "gpu-node-1"},
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert settings_resp.status_code == 200
    assert settings_resp.json()["data"]["default_agent_node"] == "gpu-node-1"

    session_resp = client.post(
        "/api/v1/dataset/upload_session",
        {
            "name": "direct",
            "description": "agent upload",
            "visibility": "private",
            "filename": "episodes.zip",
            "target_node": "gpu-node-1",
        },
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert session_resp.status_code == 200
    session = session_resp.json()["data"]
    assert session["upload_url"] == "https://agent.example.test/api/v1/agent/datasets/upload"
    assert session["node_name"] == "gpu-node-1"
    assert session["expires_in"] == 3600
    assert session["chunk_size"] == 2 * 1024 * 1024
    assert session["upload_token"]

    verify_resp = client.post(
        "/api/v1/internal/dataset/upload/verify",
        {"dataset_id": session["dataset_id"], "upload_token": session["upload_token"]},
        format="json",
        HTTP_X_AGENT_TOKEN=agent_token,
    )
    assert verify_resp.status_code == 200
    assert verify_resp.json()["data"]["file_name"] == "episodes.zip"

    complete_resp = client.post(
        "/api/v1/internal/dataset/upload/complete",
        {
            "dataset_id": session["dataset_id"],
            "upload_token": session["upload_token"],
            "storage_path": "/srv/robotcloud/agent_datasets/dataset_1/episodes.zip",
            "content_md5": "0" * 32,
            "file_size": 2048,
            "metadata": {
                "file_name": "episodes.zip",
                "file_size": 2048,
                "total_files": 3,
                "by_type": {"metadata": 1, "video": 2},
                "preview": [{"name": "meta/info.json", "type": "metadata"}],
            },
        },
        format="json",
        HTTP_X_AGENT_TOKEN=agent_token,
    )
    assert complete_resp.status_code == 200
    complete = complete_resp.json()["data"]
    assert complete["status"] == "ready"
    assert complete["storage_node"] == "gpu-node-1"
    assert "upload_session" not in Dataset.objects.get(id=session["dataset_id"]).metadata

    repeat_complete_resp = client.post(
        "/api/v1/internal/dataset/upload/complete",
        {
            "dataset_id": session["dataset_id"],
            "upload_token": session["upload_token"],
            "storage_path": "/srv/robotcloud/agent_datasets/dataset_1/episodes.zip",
            "content_md5": "0" * 32,
            "file_size": 2048,
            "metadata": {"file_name": "episodes.zip", "file_size": 2048, "total_files": 3},
        },
        format="json",
        HTTP_X_AGENT_TOKEN=agent_token,
    )
    assert repeat_complete_resp.status_code == 200
    repeat_complete = repeat_complete_resp.json()["data"]
    assert repeat_complete["status"] == "ready"
    assert repeat_complete["file_size"] == 2048

    detail_resp = client.get(
        f"/api/v1/dataset/{session['dataset_id']}",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert detail_resp.status_code == 200
    detail = detail_resp.json()["data"]
    assert detail["storage_backend"] == "agent"
    assert detail["storage_node"] == "gpu-node-1"
    assert detail["file_size"] == 2048
    assert detail["total_files"] == 3


@override_settings(DATASET_UPLOAD_SESSION_TIMEOUT_SECONDS=3600)
def test_delete_pending_agent_upload_cleans_agent_upload_dir(client: APIClient, create_user_token, monkeypatch) -> None:
    token = create_user_token("13900000007", "passwd")
    register_resp = client.post(
        "/api/v1/internal/agent/register",
        {
            "node_name": "gpu-node-cleanup",
            "ip": "10.0.0.11",
            "gpu_total": 2,
            "version": "1.0.0",
            "port": 5001,
            "public_base_url": "https://agent-cleanup.example.test",
            "upload_enabled": True,
        },
        format="json",
    )
    assert register_resp.status_code == 200
    agent_token = register_resp.json()["data"]["token"]
    cleanup_calls = []

    def fake_agent_cleanup(url, json=None, headers=None, timeout=None):  # noqa: ANN001
        cleanup_calls.append({"url": url, "json": json, "headers": headers, "timeout": timeout})

        class Response:
            status_code = 200

        return Response()

    monkeypatch.setattr("robotcloud_backend.api.services.requests.post", fake_agent_cleanup)

    session_resp = client.post(
        "/api/v1/dataset/upload_session",
        {
            "name": "pending",
            "description": "agent upload",
            "visibility": "private",
            "filename": "episodes.zip",
            "target_node": "gpu-node-cleanup",
        },
        format="json",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert session_resp.status_code == 200
    dataset_id = session_resp.json()["data"]["dataset_id"]

    delete_resp = client.post(f"/api/v1/dataset/{dataset_id}/delete", HTTP_AUTHORIZATION=f"Bearer {token}")

    assert delete_resp.status_code == 200
    assert cleanup_calls == [
        {
            "url": "http://10.0.0.11:5001/api/v1/agent/datasets/upload/cancel",
            "json": {"dataset_id": dataset_id},
            "headers": {"Content-Type": "application/json", "X-Agent-Token": agent_token},
            "timeout": 5,
        }
    ]
    assert not Dataset.objects.filter(id=dataset_id).exists()
