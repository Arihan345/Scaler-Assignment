from sqlalchemy import func, select

from app.core.config import settings
from app.db import engine, seed
from app.db.models import Conversation, Message, User


def test_seed_runs_once_and_is_usable(env, client):
    engine.configure(settings.database_url)
    assert seed.seed_if_empty() is True
    assert seed.seed_if_empty() is False  # idempotent
    with engine.session_scope() as db:
        assert db.execute(select(func.count()).select_from(User)).scalar_one() == 8
        assert db.execute(select(func.count()).select_from(Message)).scalar_one() >= 300
        assert db.execute(select(func.count()).select_from(Conversation).where(Conversation.type == "GROUP")).scalar_one() == 2
    r = client.post("/api/auth/verify-otp", json={"identifier": "+919810000001", "otp": "123456"}).json()
    assert r["is_new_user"] is False  # demo accounts are already onboarded
    items = client.get("/api/conversations", headers={"Authorization": f"Bearer {r['token']}"}).json()
    assert len(items) == 4 and any(i["unread_count"] > 0 for i in items)
