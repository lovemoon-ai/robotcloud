from app.main import RobotCloudAPI


def _prepare_user_dataset(api: RobotCloudAPI):
    code = api.send_code("13900000002")["data"]["code"]
    api.register("13900000002", "inferpw", code)
    token = api.login("13900000002", "inferpw")["data"]["token"]
    dataset_id = api.upload_dataset(token, "infer", "desc", "private", "/d/infer.zip")["data"]["dataset_id"]
    return token, dataset_id


def test_inference_flow(api: RobotCloudAPI) -> None:
    token, dataset_id = _prepare_user_dataset(api)
    create_resp = api.create_inference_task(token, model_id=1, dataset_id=dataset_id)
    task_id = create_resp["data"]["task_id"]

    result = api.inference_result(token, task_id)["data"]
    assert result["status"] == "completed"
    assert result["results"][0]["sample_id"] == "00001"
