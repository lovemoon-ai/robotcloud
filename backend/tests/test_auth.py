from app.main import RobotCloudAPI


def test_auth_flow(api: RobotCloudAPI) -> None:
    send_resp = api.send_code("13800000000")
    code = send_resp["data"]["code"]

    register_resp = api.register("13800000000", "123456", code)
    user_id = register_resp["data"]["user_id"]
    assert user_id > 0

    login_resp = api.login("13800000000", "123456")
    token = login_resp["data"]["token"]
    assert token

    verify_resp = api.verify_token(token)
    payload = verify_resp["data"]
    assert payload["user_id"] == user_id
    assert payload["role"] == "free"
