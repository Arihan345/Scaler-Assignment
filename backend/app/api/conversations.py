from fastapi import APIRouter, BackgroundTasks, Depends, File, Query, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.db.engine import get_db
from app.db.models import User
from app.realtime.connection_manager import manager
from app.realtime.dispatcher import publish
from app.schemas.requests import (
    AddMembers, ConversationPatch, DirectCreate, GroupCreate, MySettingsPatch, RoleBody,
)
from app.services import conversation_service as cs
from app.services import media

router = APIRouter(prefix="/conversations", tags=["conversations"])


def _detail(db: Session, user: User, conversation_id: str) -> dict:
    return cs.get_detail(db, user.id, conversation_id, manager.online_ids())


@router.get("")
def list_conversations(
    q: str | None = None,
    filter: str | None = Query(default=None),
    archived: bool = False,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    return cs.list_conversations(
        db, user.id, q=q, unread_only=(filter == "unread"), archived=archived, online_ids=manager.online_ids()
    )


@router.post("/direct")
def direct(body: DirectCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    conv, _ = cs.get_or_create_direct(db, user, body.user_id)  # idempotent: returns the existing chat
    return _detail(db, user, conv.id)


@router.post("/groups", status_code=201)
def create_group(
    body: GroupCreate, background: BackgroundTasks, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    conv, events = cs.create_group(db, user, body.title, body.member_ids)
    background.add_task(publish, events)
    return _detail(db, user, conv.id)


@router.get("/{conversation_id}")
def get_conversation(conversation_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _detail(db, user, conversation_id)


@router.patch("/{conversation_id}")
def patch_conversation(
    conversation_id: str, body: ConversationPatch, background: BackgroundTasks,
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    provided = body.model_fields_set
    events = cs.update_conversation(
        db, user, conversation_id,
        title=body.title if "title" in provided else None,
        disappearing_seconds=body.disappearing_seconds if "disappearing_seconds" in provided else None,
    )
    background.add_task(publish, events)
    return _detail(db, user, conversation_id)


@router.patch("/{conversation_id}/me")
def patch_my_settings(
    conversation_id: str, body: MySettingsPatch, background: BackgroundTasks,
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    fields = {k: getattr(body, k) for k in body.model_fields_set}
    events = cs.update_my_settings(db, user, conversation_id, fields)
    background.add_task(publish, events)
    return _detail(db, user, conversation_id)


@router.post("/{conversation_id}/avatar")
def upload_group_avatar(
    conversation_id: str, background: BackgroundTasks, file: UploadFile = File(...),
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    events = cs.set_group_avatar(db, user, conversation_id, media.save_avatar(file))
    background.add_task(publish, events)
    return _detail(db, user, conversation_id)


@router.post("/{conversation_id}/members")
def add_members(
    conversation_id: str, body: AddMembers, background: BackgroundTasks,
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    background.add_task(publish, cs.add_members(db, user, conversation_id, body.user_ids))
    return _detail(db, user, conversation_id)


@router.delete("/{conversation_id}/members/{user_id}")
def remove_member(
    conversation_id: str, user_id: str, background: BackgroundTasks,
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    events = cs.remove_member(db, user, conversation_id, user_id)
    background.add_task(publish, events)
    return {"ok": True}


@router.post("/{conversation_id}/members/{user_id}/role")
def set_role(
    conversation_id: str, user_id: str, body: RoleBody, background: BackgroundTasks,
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    background.add_task(publish, cs.set_role(db, user, conversation_id, user_id, body.role))
    return _detail(db, user, conversation_id)


@router.post("/{conversation_id}/leave")
def leave(
    conversation_id: str, background: BackgroundTasks,
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    background.add_task(publish, cs.leave(db, user, conversation_id))
    return {"ok": True}
