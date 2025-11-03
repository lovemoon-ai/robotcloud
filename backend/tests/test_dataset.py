from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient


def _upload_dataset(client: APIClient, token: str) -> int:
    upload_file = SimpleUploadedFile("parking.zip", b"content", content_type="application/zip")
    data = {"name": "parking", "description": "desc", "visibility": "public", "file": upload_file}
    resp = client.post(
        "/api/v1/dataset/upload",
        data=data,
        format="multipart",
        HTTP_AUTHORIZATION=f"Bearer {token}",
    )
    assert resp.status_code == 200
    return resp.json()["data"]["dataset_id"]


def test_dataset_crud(client: APIClient, create_user_token) -> None:
    token = create_user_token("13900000000", "passwd")
    dataset_id = _upload_dataset(client, token)

    list_resp = client.get(
        "/api/v1/dataset/list",
        {"visibility": "public", "page": 1, "size": 10},
    )
    assert list_resp.status_code == 200
    payload = list_resp.json()["data"]
    assert payload["total"] == 1
    assert payload["items"][0]["dataset_id"] == dataset_id

    detail_resp = client.get(f"/api/v1/dataset/{dataset_id}")
    assert detail_resp.status_code == 200
    assert detail_resp.json()["data"]["name"] == "parking"

    stats_resp = client.get(f"/api/v1/dataset/{dataset_id}/stats")
    assert stats_resp.status_code == 200
    assert stats_resp.json()["data"]["total_samples"] == 100

    preview_resp = client.get(f"/api/v1/dataset/{dataset_id}/preview")
    assert preview_resp.status_code == 200
    assert len(preview_resp.json()["data"]["preview"]) == 2
