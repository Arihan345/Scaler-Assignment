"""Stories: 24-hour text/photo posts shown to the author's contacts and direct-chat partners."""
import os

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.core.errors import forbidden, not_found, validation
from app.core.ids import direct_key, new_id
from app.core.time import add_seconds, now_iso
from app.db.engine import begin_write
from app.db.models import Block, Contact, Conversation, Story, StoryView, User
from app.services import serializers, user_service

TTL_SECONDS = 24 * 3600
BG_COLORS = {"#2c6bed", "#8e44ad", "#d35400", "#16a085", "#c0392b", "#2c3e50"}


def _can_see(db: Session, viewer_id: str, author_id: str) -> bool:
    if viewer_id == author_id:
        return True
    if user_service.is_blocked_between(db, viewer_id, author_id):
        return False
    if db.get(Contact, (viewer_id, author_id)) is not None or db.get(Contact, (author_id, viewer_id)) is not None:
        return True
    conv = db.execute(select(Conversation).where(Conversation.direct_key == direct_key(viewer_id, author_id))).scalar_one_or_none()
    return conv is not None and conv.last_seq > 0


def _dto(s: Story, viewed: bool) -> dict:
    return {
        "id": s.id, "kind": s.kind, "body": s.body, "bg": s.bg, "created_at": s.created_at, "expires_at": s.expires_at,
        "viewed": viewed, "has_media": bool(s.file_path),
    }


def create_text(db: Session, me: User, body: str, bg: str | None) -> Story:
    body = (body or "").strip()
    if not body:
        raise validation("Story text is empty")
    if len(body) > 280:
        raise validation("Story text can be at most 280 characters")
    return _create(db, me, "TEXT", body=body, bg=bg if bg in BG_COLORS else "#2c6bed")


def create_image(db: Session, me: User, path: str, mime: str, caption: str | None) -> Story:
    return _create(db, me, "IMAGE", body=(caption or "").strip()[:280] or None, file_path=path, mime_type=mime)


def _create(db: Session, me: User, kind: str, **kw) -> Story:
    begin_write(db)
    now = now_iso()
    s = Story(id=new_id(), user_id=me.id, kind=kind, created_at=now, expires_at=add_seconds(now, TTL_SECONDS), **kw)
    db.add(s)
    db.commit()
    return s


def list_stories(db: Session, me: User) -> dict:
    now = now_iso()
    rows = list(db.execute(select(Story).where(Story.expires_at > now).order_by(Story.created_at.asc())).scalars())
    seen = {r.story_id for r in db.execute(select(StoryView).where(StoryView.viewer_id == me.id)).scalars()}
    visible_authors: dict[str, bool] = {}
    mine, groups = [], {}
    view_counts = {}
    for sid, n in db.execute(
        select(StoryView.story_id, StoryView.viewer_id).where(StoryView.shared == 1)
    ).all():
        view_counts[sid] = view_counts.get(sid, 0) + 1
    for s in rows:
        if s.user_id == me.id:
            d = _dto(s, True)
            d["view_count"] = view_counts.get(s.id, 0)
            mine.append(d)
            continue
        ok = visible_authors.get(s.user_id)
        if ok is None:
            ok = visible_authors[s.user_id] = _can_see(db, me.id, s.user_id)
        if ok:
            groups.setdefault(s.user_id, []).append(_dto(s, s.id in seen))
    users = {u.id: u for u in db.execute(select(User).where(User.id.in_(list(groups) or [""]))).scalars()}
    others = [
        {"user": serializers.user_dto(users[uid]), "stories": ss, "all_viewed": all(x["viewed"] for x in ss)}
        for uid, ss in groups.items() if uid in users
    ]
    others.sort(key=lambda g: (g["all_viewed"], tuple(-ord(c) for c in g["stories"][-1]["created_at"])))
    return {"mine": mine, "others": others}


def get_story(db: Session, me: User, story_id: str) -> Story:
    s = db.get(Story, story_id)
    if s is None or s.expires_at <= now_iso() or not _can_see(db, me.id, s.user_id):
        raise not_found("Story")
    return s


def mark_viewed(db: Session, me: User, story_id: str) -> None:
    s = get_story(db, me, story_id)
    if s.user_id == me.id or db.get(StoryView, (story_id, me.id)) is not None:
        return
    db.add(StoryView(story_id=story_id, viewer_id=me.id, viewed_at=now_iso(), shared=1 if me.read_receipts else 0))
    db.commit()


def list_views(db: Session, me: User, story_id: str) -> list[dict]:
    s = db.get(Story, story_id)
    if s is None:
        raise not_found("Story")
    if s.user_id != me.id:
        raise forbidden("Only the author can see who viewed a story")
    out = []
    for v in db.execute(select(StoryView).where(StoryView.story_id == story_id, StoryView.shared == 1).order_by(StoryView.viewed_at)).scalars():
        u = db.get(User, v.viewer_id)
        if u:
            out.append({"user": serializers.user_dto(u), "viewed_at": v.viewed_at})
    return out


def delete_story(db: Session, me: User, story_id: str) -> None:
    s = db.get(Story, story_id)
    if s is None:
        raise not_found("Story")
    if s.user_id != me.id:
        raise forbidden("You can only delete your own stories")
    path = s.file_path
    db.execute(delete(StoryView).where(StoryView.story_id == story_id))
    db.delete(s)
    db.commit()
    if path and os.path.exists(path):
        os.remove(path)
