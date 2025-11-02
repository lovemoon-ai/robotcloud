from app.main import RobotCloudAPI


def _create_user_and_token(api: RobotCloudAPI, phone: str = "13900000000") -> str:
    code = api.send_code(phone)["data"]["code"]
    api.register(phone, "passwd", code)
    return api.login(phone, "passwd")["data"]["token"]


def test_dataset_crud(api: RobotCloudAPI) -> None:
    token = _create_user_and_token(api)
    upload_resp = api.upload_dataset(token, "parking", "desc", "public", "/data/parking.zip")
    dataset_id = upload_resp["data"]["dataset_id"]

    list_resp = api.list_datasets("public", page=1, size=10)
    assert list_resp["data"]["total"] == 1
    assert list_resp["data"]["items"][0]["dataset_id"] == dataset_id

    detail = api.get_dataset(dataset_id)["data"]
    assert detail["name"] == "parking"

    stats = api.dataset_stats(dataset_id)["data"]
    assert stats["total_samples"] == 100

    preview = api.dataset_preview(dataset_id)["data"]
    assert len(preview["preview"]) == 2
