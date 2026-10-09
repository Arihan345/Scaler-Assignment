from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.db.engine import get_db
from app.db.models import User
from app.realtime.connection_manager import manager
from app.schemas.requests import ContactCreate, PrivacyPatch, ProfilePatch
from app.services import auth_service, link_preview, media, serializers, user_service

router = APIRouter(tags=["users"])


@router.get("/users/me")
def me(user: User = Depends(current_user)):
    return {**serializers.user_dto(user), "privacy": serializers.privacy_dto(user), "onboarded": user.onboarded_at is not None}


@router.patch("/users/me/privacy")
def patch_privacy(body: PrivacyPatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    user_service.update_privacy(db, user, body.model_dump(exclude_none=True))
    return {**serializers.user_dto(user), "privacy": serializers.privacy_dto(user), "onboarded": user.onboarded_at is not None}


@router.get("/blocks")
def blocks(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return user_service.list_blocked(db, user)


@router.post("/blocks/{target_id}", status_code=201)
def block(target_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    user_service.block_user(db, user, target_id)
    return {"ok": True}


@router.delete("/blocks/{target_id}")
def unblock(target_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    user_service.unblock_user(db, user, target_id)
    return {"ok": True}


@router.patch("/users/me")
def patch_me(body: ProfilePatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    user = auth_service.update_profile(db, user, body.display_name, body.about)
    return {**serializers.user_dto(user), "onboarded": user.onboarded_at is not None}


@router.post("/users/me/avatar")
def upload_avatar(file: UploadFile = File(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    user.avatar_url = media.save_avatar(file)
    db.commit()
    return {**serializers.user_dto(user), "onboarded": user.onboarded_at is not None}


@router.get("/users/search")
def search(q: str = "", user: User = Depends(current_user), db: Session = Depends(get_db)):
    return user_service.search_users(db, user, q, manager.online_ids())


@router.get("/contacts")
def contacts(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return user_service.list_contacts(db, user, manager.online_ids())


@router.post("/contacts", status_code=201)
def add_contact(body: ContactCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return user_service.add_contact(db, user, user_id=body.user_id, identifier=body.identifier)


@router.delete("/contacts/{contact_id}")
def remove_contact(contact_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    user_service.remove_contact(db, user, contact_id)
    return {"ok": True}


@router.get("/link-preview")
def preview(url: str, user: User = Depends(current_user)):
    return {"preview": link_preview.get_preview(url)}
