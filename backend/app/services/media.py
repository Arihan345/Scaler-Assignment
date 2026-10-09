"""File storage helpers (avatars are public-by-unguessable-name; attachments are served via an authorized route)."""
import os

from fastapi import UploadFile

from app.core.config import settings
from app.core.errors import AppError, validation
from app.core.ids import new_id

IMAGE_EXT = {"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp"}
AUDIO_EXT = {"audio/webm": ".webm", "audio/ogg": ".ogg", "audio/mp4": ".m4a", "audio/mpeg": ".mp3", "audio/wav": ".wav"}  # voice notes
ATTACHMENT_EXT = {**IMAGE_EXT, **AUDIO_EXT, "application/pdf": ".pdf", "text/plain": ".txt"}


def base_mime(content_type: str | None) -> str:
    """'audio/webm;codecs=opus' -> 'audio/webm' (MediaRecorder adds codec parameters)."""
    return (content_type or "").split(";")[0].strip().lower()


def read_limited(file: UploadFile, limit: int) -> bytes:
    data = file.file.read(limit + 1)
    if len(data) > limit:
        raise AppError("PAYLOAD_TOO_LARGE", f"File is larger than {limit // (1024 * 1024)} MB", 413)
    if not data:
        raise validation("File is empty")
    return data


def save_avatar(file: UploadFile) -> str:
    ext = IMAGE_EXT.get(file.content_type or "")
    if ext is None:
        raise validation("Avatar must be a PNG, JPEG, GIF or WebP image")
    data = read_limited(file, settings.max_avatar_bytes)
    name = f"{new_id()}{ext}"
    folder = os.path.join(settings.upload_dir, "avatars")
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, name), "wb") as fh:
        fh.write(data)
    return f"/media/avatars/{name}"
