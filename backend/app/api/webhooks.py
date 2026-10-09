import logging

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.db.engine import get_db
from app.db.models import User
from app.realtime.dispatcher import publish
from app.schemas.requests import InboundCreate, InboundPost, WebhookCreate, WebhookPatch
from app.services import inbound_service, webhook_service

log = logging.getLogger("signal.webhooks")
router = APIRouter(tags=["webhooks"])


# ---- outbound -------------------------------------------------------------------------------

@router.get("/webhooks")
def list_webhooks(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return webhook_service.list_endpoints(db, user)


@router.post("/webhooks", status_code=201)
def create_webhook(body: WebhookCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return webhook_service.create_endpoint(db, user, body.url, body.events, body.conversation_id)


@router.patch("/webhooks/{webhook_id}")
def patch_webhook(webhook_id: str, body: WebhookPatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return webhook_service.update_endpoint(
        db, user, webhook_id, url=body.url, events=body.events, is_active=body.is_active
    )


@router.delete("/webhooks/{webhook_id}")
def delete_webhook(webhook_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    webhook_service.delete_endpoint(db, user, webhook_id)
    return {"ok": True}


@router.get("/webhooks/{webhook_id}/deliveries")
def deliveries(webhook_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return webhook_service.list_deliveries(db, user, webhook_id)


@router.post("/webhooks/{webhook_id}/test")
def test_webhook(webhook_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    webhook_service.send_test(db, user, webhook_id)
    return {"ok": True}


# ---- inbound --------------------------------------------------------------------------------

@router.post("/conversations/{conversation_id}/inbound-hooks", status_code=201)
def create_inbound(
    conversation_id: str, body: InboundCreate, background: BackgroundTasks,
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    dto, events = inbound_service.create(db, user, conversation_id, body.name)
    background.add_task(publish, events)
    return dto


@router.get("/conversations/{conversation_id}/inbound-hooks")
def list_inbound(conversation_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return inbound_service.list_for_conversation(db, user, conversation_id)


@router.delete("/inbound-hooks/{hook_id}")
def delete_inbound(
    hook_id: str, background: BackgroundTasks, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    background.add_task(publish, inbound_service.delete(db, user, hook_id))
    return {"ok": True}


@router.post("/hooks/in/{token}", status_code=201)
def receive_inbound(token: str, body: InboundPost, background: BackgroundTasks, db: Session = Depends(get_db)):
    """Public, token-authenticated: the secret URL is the credential."""
    background.add_task(publish, inbound_service.post(db, token, body.text))
    return {"ok": True}


# ---- demo helper ----------------------------------------------------------------------------

@router.post("/dev/webhook-echo")
async def webhook_echo(request: Request):
    """Point an outbound webhook here to watch deliveries succeed without any external service."""
    try:
        payload = await request.json()
    except Exception:
        payload = None
    log.info("webhook-echo event=%s", (payload or {}).get("event") if isinstance(payload, dict) else None)
    return {"ok": True, "received_event": (payload or {}).get("event") if isinstance(payload, dict) else None}
