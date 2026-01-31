import io
import zipfile

from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient


def _create_zip_upload() -> SimpleUploadedFile:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("images/0001.png", b"\x89PNG")
        archive.writestr("pointclouds/0001.pcd", b"PCD")
        archive.writestr("metadata/info.json", b"{}")
    buffer.seek(0)
    return SimpleUploadedFile("parking.zip", buffer.read(), content_type="application/zip")


def _upload_dataset(client: APIClient, token: str) -> dict:
    upload_file = _create_zip_upload()
    data = {"name": "parking", "description": "desc", "visibility": "public", "file": upload_file}
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
    assert list_resp.status_code == 200
    payload = list_resp.json()["data"]
    assert payload["total"] == 1
    first_item = payload["items"][0]
    assert first_item["dataset_id"] == dataset_id
    assert first_item["total_files"] == 3
    assert first_item["preview_available"] is True

    detail_resp = client.get(f"/api/v1/dataset/{dataset_id}")
    assert detail_resp.status_code == 200
    detail_payload = detail_resp.json()["data"]
    assert detail_payload["name"] == "parking"
    assert detail_payload["total_files"] == 3

    stats_resp = client.get(f"/api/v1/dataset/{dataset_id}/stats")
    assert stats_resp.status_code == 200
    stats_payload = stats_resp.json()["data"]
    assert stats_payload["total_files"] == 3
    # Expect each category counted once based on the test archive contents
    assert stats_payload["by_type"]["image"] == 1
    assert stats_payload["by_type"]["pointcloud"] == 1
    assert stats_payload["by_type"]["metadata"] == 1

    preview_resp = client.get(f"/api/v1/dataset/{dataset_id}/preview")
    assert preview_resp.status_code == 200
    preview_payload = preview_resp.json()["data"]["preview"]
    assert len(preview_payload) == 3
    assert preview_payload[0]["type"] == "image"
    assert preview_payload[0]["url"].endswith("images%2F0001.png")


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
    list_resp = client.get("/api/v1/dataset/list", {"page": 1, "size": 10})
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
