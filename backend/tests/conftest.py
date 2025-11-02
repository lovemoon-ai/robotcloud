import sys
from pathlib import Path
from typing import Callable, Dict

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.main import create_app  # noqa: E402


@pytest.fixture
def client() -> TestClient:
    app = create_app()
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def auth_header() -> Callable[[str], Dict[str, str]]:
    def _builder(token: str) -> Dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    return _builder


@pytest.fixture
def create_user_token(client: TestClient) -> Callable[[str, str], str]:
    def _create(phone: str = "13800000000", password: str = "123456") -> str:
        send_resp = client.post("/api/v1/auth/send_code", json={"phone": phone})
        assert send_resp.status_code == 200
        code = send_resp.json()["data"]["code"]

        register_resp = client.post(
            "/api/v1/auth/register",
            json={"phone": phone, "password": password, "code": code},
        )
        assert register_resp.status_code == 200

        login_resp = client.post(
            "/api/v1/auth/login", json={"phone": phone, "password": password}
        )
        assert login_resp.status_code == 200
        return login_resp.json()["data"]["token"]

    return _create
