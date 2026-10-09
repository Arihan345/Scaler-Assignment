import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.config import settings  # noqa: E402
from app.db import engine  # noqa: E402


@pytest.fixture()
def env(tmp_path):
    settings.database_url = f"sqlite:///{tmp_path}/test.db"
    settings.upload_dir = str(tmp_path / "uploads")
    settings.seed_on_empty = False
    settings.run_background_tasks = False
    settings.env = "dev"
    settings.fixed_otp = "123456"
    return tmp_path


@pytest.fixture()
def client(env):
    from app.main import create_app

    with TestClient(create_app()) as c:
        yield c


@pytest.fixture()
def db(env):
    """A bare configured database + session for service-level tests."""
    engine.configure(settings.database_url)
    engine.create_all()
    session = engine.new_session()
    yield session
    session.close()
