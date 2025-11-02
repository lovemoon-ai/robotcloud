from app.main import RobotCloudAPI


def _create_user(api: RobotCloudAPI):
    code = api.send_code("13900000003")["data"]["code"]
    api.register("13900000003", "simpw", code)
    token = api.login("13900000003", "simpw")["data"]["token"]
    return token


def test_simulation_and_device(api: RobotCloudAPI) -> None:
    token = _create_user(api)
    task_resp = api.create_simulation_task(
        token,
        scene_file="warehouse.usd",
        model_id=1,
        robot_type="S100",
        training_mode="reinforcement",
    )
    task_id = task_resp["data"]["task_id"]

    status_resp = api.simulation_status(token, task_id)["data"]
    assert status_resp["status"] == "running"

    device_resp = api.bind_device(token, "S100-00012", model_id=1)["data"]
    assert device_resp["sn"] == "S100-00012"
