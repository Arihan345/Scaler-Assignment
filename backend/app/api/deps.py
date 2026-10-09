from fastapi import Depends, Header
from sqlalchemy.orm import Session

from app.db.engine import get_db
from app.db.models import Session as SessionRow, User
from app.services import auth_service


def bearer_token(authorization: str | None = Header(default=None)) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return None


def auth_ctx(token: str | None = Depends(bearer_token), db: Session = Depends(get_db)) -> tuple[User, SessionRow]:
    return auth_service.authenticate(db, token)


def current_user(ctx: tuple[User, SessionRow] = Depends(auth_ctx)) -> User:
    return ctx[0]
