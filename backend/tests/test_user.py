from app.main import RobotCloudAPI


def _create_user(api: RobotCloudAPI) -> str:
    code = api.send_code("13800000001")["data"]["code"]
    api.register("13800000001", "abcdef", code)
    return api.login("13800000001", "abcdef")["data"]["token"]


def test_profile(api: RobotCloudAPI) -> None:
    token = _create_user(api)
    profile = api.profile(token)["data"]
    assert profile["phone"] == "13800000001"
    assert profile["role"] == "free"


def test_upgrade_and_usage(api: RobotCloudAPI) -> None:
    token = _create_user(api)
    upgraded = api.upgrade(token, "plus", "pay_123")
    assert upgraded["data"]["role"] == "plus"

    dataset_resp = api.upload_dataset(token, "sample", "desc", "private", "/tmp/sample.zip")
    dataset_id = dataset_resp["data"]["dataset_id"]
    api.create_training_task(token, dataset_id, "yolov8", {"epochs": 1})
    api.create_inference_task(token, 1, dataset_id)

    usage = api.usage(token)["data"]
    assert usage["training"] == 1
    assert usage["inference"] == 1
