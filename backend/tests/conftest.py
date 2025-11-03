import os
from typing import Callable, Dict

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "robotcloud_backend.settings")
os.environ.setdefault("USE_SQLITE_FOR_TESTS", "1")
os.environ.setdefault("USE_IN_MEMORY_CACHE", "1")

import django

django.setup()

import pytest
from django.core.cache import caches
from rest_framework.test import APIClient

from robotcloud_backend.api import views  # noqa: E402
from robotcloud_backend.api.services import RobotCloudService  # noqa: E402
from robotcloud_backend.sms import InMemorySmsGateway  # noqa: E402


pytestmark = pytest.mark.django_db


def get_service() -> RobotCloudService:
    return views.get_service()


@pytest.fixture
def sms_gateway() -> InMemorySmsGateway:
    gateway = InMemorySmsGateway()
    views.set_sms_gateway_for_tests(gateway)
    caches["default"].clear()
    caches["tokens"].clear()
    views.reset_service_cache()
    return gateway


@pytest.fixture
def client(db, sms_gateway: InMemorySmsGateway) -> APIClient:
    return APIClient()


@pytest.fixture
def create_invitation(db, sms_gateway: InMemorySmsGateway) -> Callable[..., str]:
    service = get_service()

    def _create(code: str | None = None, note: str | None = None) -> str:
        actual_code = code or f"INV-{os.urandom(4).hex().upper()}"
        service.add_invitation_code(actual_code, note)
        return actual_code

    return _create


@pytest.fixture
def auth_header() -> Callable[[str], Dict[str, str]]:
    def _builder(token: str) -> Dict[str, str]:
        return {"HTTP_AUTHORIZATION": f"Bearer {token}"}

    return _builder


@pytest.fixture
def create_user_token(
    db,
    client: APIClient,
    sms_gateway: InMemorySmsGateway,
    create_invitation: Callable[..., str],
) -> Callable[[str, str], str]:
    def _create(phone: str = "13800000000", password: str = "123456") -> str:
        invitation_code = create_invitation()
        register_resp = client.post(
            "/api/v1/auth/register_invite",
            {"phone": phone, "password": password, "invitation_code": invitation_code},
            format="json",
        )
        assert register_resp.status_code == 200

        login_resp = client.post(
            "/api/v1/auth/login",
            {"phone": phone, "password": password},
            format="json",
        )
        assert login_resp.status_code == 200
        return login_resp.json()["data"]["token"]

    return _create
