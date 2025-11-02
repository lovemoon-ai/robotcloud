from app.main import RobotCloudAPI


def _setup_user_and_dataset(api: RobotCloudAPI):
    code = api.send_code("13900000001")["data"]["code"]
    api.register("13900000001", "trainpw", code)
    token = api.login("13900000001", "trainpw")["data"]["token"]
    dataset_id = api.upload_dataset(token, "train", "desc", "private", "/d/train.zip")["data"]["dataset_id"]
    return token, dataset_id


def test_training_lifecycle(api: RobotCloudAPI) -> None:
    token, dataset_id = _setup_user_and_dataset(api)
    create_resp = api.create_training_task(token, dataset_id, "yolov8", {"epochs": 10})
    task_id = create_resp["data"]["task_id"]

    list_resp = api.list_training_tasks(token, page=1, size=10)["data"]
    assert list_resp["total"] == 1
    assert list_resp["items"][0]["task_id"] == task_id

    status_resp = api.training_status(token, task_id)["data"]
    assert status_resp["task_id"] == task_id

    stop_resp = api.stop_training(token, task_id)["data"]
    assert stop_resp["status"] == "failed"

    download_resp = api.download_model(token, task_id)["data"]
    assert download_resp["model_path"].endswith(f"{task_id}.pt")
