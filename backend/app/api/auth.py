from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.deps import auth_ctx, current_user
from app.db.engine import get_db
from app.db.models import Session as SessionRow, User
from app.realtime import tickets
from app.schemas.requests import OtpRequest, VerifyOtp
from app.services import auth_service, serializers

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/request-otp")
def request_otp(body: OtpRequest):
    return auth_service.request_otp(body.identifier)


@router.post("/verify-otp")
def verify_otp(body: VerifyOtp, request: Request, db: Session = Depends(get_db)):
    res = auth_service.verify_otp(db, body.identifier, body.otp, body.device_label or request.headers.get("user-agent"))
    return {"token": res["token"], "user": serializers.user_dto(res["user"]), "is_new_user": res["is_new_user"]}


@router.post("/logout")
def logout(ctx: tuple[User, SessionRow] = Depends(auth_ctx), db: Session = Depends(get_db)):
    auth_service.logout(db, ctx[1])
    return {"ok": True}


@router.post("/ws-ticket")
def ws_ticket(user: User = Depends(current_user)):
    return {"ticket": tickets.issue(user.id), "expires_in": int(tickets.TTL_SECONDS)}
