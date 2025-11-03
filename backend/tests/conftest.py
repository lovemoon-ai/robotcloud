import os
import sys
import uuid
from pathlib import Path
from typing import Callable, Dict

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.main import create_app  # noqa: E402
from app.sms import InMemorySmsGateway  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def invitation_store_path(tmp_path_factory: pytest.TempPathFactory) -> Path:
    path = tmp_path_factory.mktemp("invitation_store") / "codes.json"
    os.environ["INVITATION_STORE_PATH"] = str(path)
    return path


@pytest.fixture
def sms_gateway() -> InMemorySmsGateway:
    return InMemorySmsGateway()


@pytest.fixture
def client(sms_gateway: InMemorySmsGateway) -> TestClient:
    app = create_app(sms_gateway=sms_gateway)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def create_invitation(client: TestClient) -> Callable[..., str]:
    service = client.app.state.service

    def _create(code: str | None = None, note: str | None = None) -> str:
        actual_code = code or f"INV-{uuid.uuid4().hex[:8].upper()}"
        service.db.add_invitation_code(actual_code, note)
        return actual_code

    return _create


@pytest.fixture
def auth_header() -> Callable[[str], Dict[str, str]]:
    def _builder(token: str) -> Dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    return _builder


@pytest.fixture
def create_user_token(
    client: TestClient,
    sms_gateway: InMemorySmsGateway,
    create_invitation: Callable[..., str],
) -> Callable[[str, str], str]:
    def _create(phone: str = "13800000000", password: str = "123456") -> str:
        invitation_code = create_invitation()
        register_resp = client.post(
            "/api/v1/auth/register_invite",
            json={"phone": phone, "password": password, "invitation_code": invitation_code},
        )
        assert register_resp.status_code == 200

        login_resp = client.post(
            "/api/v1/auth/login", json={"phone": phone, "password": password}
        )
        assert login_resp.status_code == 200
        return login_resp.json()["data"]["token"]

    return _create
