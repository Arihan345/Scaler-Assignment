import os

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.core.config import settings
from app.core.errors import validation
from app.core.ids import new_id
from app.db.engine import get_db
from app.db.models import User
from app.schemas.requests import StoryCreate
from app.services import media, story_service

router = APIRouter(prefix="/stories", tags=["stories"])


@router.get("")
def list_stories(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return story_service.list_stories(db, user)


@router.post("", status_code=201)
def create_text_story(body: StoryCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = story_service.create_text(db, user, body.body, body.bg)
    return story_service._dto(s, True)


@router.post("/image", status_code=201)
def create_image_story(
    file: UploadFile = File(...), caption: str | None = Form(default=None),
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    mime = media.base_mime(file.content_type)
    ext = media.IMAGE_EXT.get(mime)
    if ext is None:
        raise validation("Stories support PNG, JPEG, GIF or WebP images")
    data = media.read_limited(file, settings.max_upload_bytes)
    folder = os.path.join(settings.upload_dir, "stories")
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f"{new_id()}{ext}")
    with open(path, "wb") as fh:
        fh.write(data)
    s = story_service.create_image(db, user, path, mime, caption)
    return story_service._dto(s, True)


@router.get("/{story_id}/media")
def story_media(story_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = story_service.get_story(db, user, story_id)
    if not s.file_path or not os.path.exists(s.file_path):
        from app.core.errors import not_found
        raise not_found("Story media")
    return FileResponse(s.file_path, media_type=s.mime_type, headers={"Cache-Control": "private, max-age=3600"})


@router.post("/{story_id}/view")
def view_story(story_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    story_service.mark_viewed(db, user, story_id)
    return {"ok": True}


@router.get("/{story_id}/views")
def story_views(story_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return {"views": story_service.list_views(db, user, story_id)}


@router.delete("/{story_id}")
def delete_story(story_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    story_service.delete_story(db, user, story_id)
    return {"ok": True}
