import os

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Query, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.core.config import settings
from app.core.errors import forbidden, not_found, validation
from app.core.ids import new_id
from app.core.time import now_iso
from app.db.engine import get_db
from app.db.models import Attachment, Message, User
from app.realtime.dispatcher import publish
from app.schemas.requests import AckBody, EditBody, ReactionBody, SendMessage
from app.services import media, message_service
from app.services.membership import get_membership, require_active_member

router = APIRouter(tags=["messages"])


@router.get("/conversations/{conversation_id}/messages")
def list_messages(
    conversation_id: str,
    before_seq: int | None = None,
    after_seq: int | None = None,
    around_seq: int | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    return message_service.list_messages(
        db, user, conversation_id, before_seq=before_seq, after_seq=after_seq, around_seq=around_seq, limit=limit
    )


@router.post("/conversations/{conversation_id}/messages")
def send_message(
    conversation_id: str, body: SendMessage, response: Response, background: BackgroundTasks,
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    msg, created, events = message_service.send_message(
        db, user, conversation_id, body=body.body, client_message_id=body.client_message_id,
        reply_to_id=body.reply_to_id, attachment_ids=body.attachment_ids, mentions=body.mentions,
        forward_from_id=body.forward_from_id,
    )
    response.status_code = 201 if created else 200  # a deduplicated retry returns the original with 200
    background.add_task(publish, events)
    return message_service.dto_for_viewer(db, msg, user)


@router.post("/conversations/{conversation_id}/read")
def mark_read(
    conversation_id: str, body: AckBody, background: BackgroundTasks,
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    background.add_task(publish, message_service.mark_read(db, user, conversation_id, body.up_to_seq))
    return {"ok": True}


@router.post("/conversations/{conversation_id}/delivered")
def mark_delivered(
    conversation_id: str, body: AckBody, background: BackgroundTasks,
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    background.add_task(publish, message_service.mark_delivered(db, user, conversation_id, body.up_to_seq))
    return {"ok": True}


@router.get("/conversations/{conversation_id}/search")
def search_messages(
    conversation_id: str, q: str = "", user: User = Depends(current_user), db: Session = Depends(get_db)
):
    return {"messages": message_service.search_messages(db, user, conversation_id, q)}


@router.get("/conversations/{conversation_id}/media")
def conversation_media(
    conversation_id: str, kind: str = "media", user: User = Depends(current_user), db: Session = Depends(get_db)
):
    return {"items": message_service.list_media(db, user, conversation_id, kind)}


@router.get("/conversations/{conversation_id}/pinned")
def pinned_messages(conversation_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return {"messages": message_service.list_pinned(db, user, conversation_id)}


@router.put("/messages/{message_id}/pin")
def pin_message(message_id: int, background: BackgroundTasks, user: User = Depends(current_user), db: Session = Depends(get_db)):
    background.add_task(publish, message_service.set_pinned(db, user, message_id, True))
    return {"ok": True}


@router.delete("/messages/{message_id}/pin")
def unpin_message(message_id: int, background: BackgroundTasks, user: User = Depends(current_user), db: Session = Depends(get_db)):
    background.add_task(publish, message_service.set_pinned(db, user, message_id, False))
    return {"ok": True}


@router.patch("/messages/{message_id}")
def edit_message(
    message_id: int, body: EditBody, background: BackgroundTasks,
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    events = message_service.edit_message(db, user, message_id, body.body)
    background.add_task(publish, events)
    return events[0].payload


@router.post("/messages/{message_id}/hide")
def hide_message(message_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    message_service.hide_message(db, user, message_id)
    return {"ok": True}


@router.put("/messages/{message_id}/reaction")
def put_reaction(
    message_id: int, body: ReactionBody, background: BackgroundTasks,
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    background.add_task(publish, message_service.set_reaction(db, user, message_id, body.emoji))
    return {"ok": True}


@router.delete("/messages/{message_id}/reaction")
def delete_reaction(
    message_id: int, background: BackgroundTasks, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    background.add_task(publish, message_service.remove_reaction(db, user, message_id))
    return {"ok": True}


@router.delete("/messages/{message_id}")
def delete_message(
    message_id: int, background: BackgroundTasks, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    events, paths = message_service.delete_message(db, user, message_id)
    message_service.unlink_files(paths)
    background.add_task(publish, events)
    return {"ok": True}


@router.get("/messages/{message_id}/receipts")
def message_receipts(message_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return {"recipients": message_service.get_receipts(db, user, message_id)}


# ------------------------------------------------------------ attachments (two-step: upload, then bind on send)

@router.post("/attachments", status_code=201)
def upload_attachment(
    conversation_id: str = Form(...), file: UploadFile = File(...),
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    require_active_member(db, user.id, conversation_id)
    mime = media.base_mime(file.content_type)
    ext = media.ATTACHMENT_EXT.get(mime)
    if ext is None:
        raise validation("Unsupported file type (images, voice notes, PDF and plain text are allowed)")
    data = media.read_limited(file, settings.max_upload_bytes)
    att_id = new_id()
    folder = os.path.join(settings.upload_dir, "attachments")
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f"{att_id}{ext}")
    with open(path, "wb") as fh:
        fh.write(data)
    name = os.path.basename(file.filename or f"file{ext}")[:120]
    db.add(
        Attachment(
            id=att_id, uploader_id=user.id, conversation_id=conversation_id, file_name=name,
            mime_type=mime, size_bytes=len(data), storage_path=path, created_at=now_iso(),
        )
    )
    db.commit()
    return {"attachment_id": att_id, "file_name": name, "mime_type": mime, "size_bytes": len(data)}


@router.get("/attachments/{attachment_id}")
def get_attachment(attachment_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    att = db.get(Attachment, attachment_id)
    if att is None:
        raise not_found("Attachment")
    member = get_membership(db, user.id, att.conversation_id)
    if member is None:
        raise forbidden("You can't access this file")
    if att.message_id is None:
        if att.uploader_id != user.id:
            raise forbidden("You can't access this file")
    else:
        msg = db.get(Message, att.message_id)
        if msg is None or msg.seq <= member.joined_seq or (member.left_seq is not None and msg.seq > member.left_seq):
            raise forbidden("You can't access this file")
    if not os.path.exists(att.storage_path):
        raise not_found("File")
    return FileResponse(
        att.storage_path, media_type=att.mime_type, filename=att.file_name,
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600"},
        content_disposition_type="inline" if (att.mime_type or "").startswith(("image/", "audio/")) else "attachment",
    )
