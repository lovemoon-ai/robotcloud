import pytest

from app.main import RobotCloudAPI


def _create_regular_user(api: RobotCloudAPI) -> str:
    code = api.send_code("13900000004")["data"]["code"]
    api.register("13900000004", "adminpw", code)
    return api.login("13900000004", "adminpw")["data"]["token"]


def _admin_token(api: RobotCloudAPI) -> str:
    return api.login("00000000000", "admin")["data"]["token"]


def test_admin_operations(api: RobotCloudAPI) -> None:
    user_token = _create_regular_user(api)
    dataset_id = api.upload_dataset(user_token, "review", "desc", "public", "/d/review.zip")["data"]["dataset_id"]

    admin_token = _admin_token(api)
    users_resp = api.admin_users(admin_token, page=1, role=None)["data"]
    assert users_resp["total"] >= 2  # admin + regular user

    review_resp = api.admin_review_dataset(admin_token, dataset_id, "approved")["data"]
    assert review_resp["status"] == "approved"

    overview = api.admin_overview(admin_token)["data"]
    assert overview["datasets"] == 1
    assert overview["users"] >= 2


def test_admin_permission_required(api: RobotCloudAPI) -> None:
    user_token = _create_regular_user(api)
    with pytest.raises(PermissionError):
        api.admin_users(user_token, page=1, role=None)
