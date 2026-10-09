"""App factory. One uvicorn worker only: the connection manager and WS tickets live in memory
(the documented scale-out path is Redis pub/sub)."""
import asyncio
import logging
import os
import re
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api import auth, conversations, messages, stories, users, webhooks, ws
from app.core.config import settings
from app.core.errors import AppError, app_error_handler, http_error_handler, validation_handler
from app.db import engine, seed
from app.tasks import expiry_sweeper, webhook_worker

log = logging.getLogger("signal")


class _RedactTicket(logging.Filter):
    """Never let a WebSocket ticket reach the logs."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.args = tuple(re.sub(r"ticket=[^&\s\"']+", "ticket=REDACTED", str(a)) if isinstance(a, str) else a for a in (record.args or ()))
        if isinstance(record.msg, str):
            record.msg = re.sub(r"ticket=[^&\s\"']+", "ticket=REDACTED", record.msg)
        return True


def create_app() -> FastAPI:
    for name in ("uvicorn.access", "uvicorn.error", "uvicorn"):
        logging.getLogger(name).addFilter(_RedactTicket())

    os.makedirs(os.path.join(settings.upload_dir, "avatars"), exist_ok=True)
    os.makedirs(os.path.join(settings.upload_dir, "attachments"), exist_ok=True)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        engine.configure(settings.database_url)
        engine.create_all()
        if settings.seed_on_empty and seed.seed_if_empty():
            log.info("database was empty: seeded demo data")
        tasks = []
        if settings.run_background_tasks:
            tasks = [asyncio.create_task(expiry_sweeper.run()), asyncio.create_task(webhook_worker.run())]
        yield
        for t in tasks:
            t.cancel()
        for t in tasks:
            try:
                await t
            except asyncio.CancelledError:
                pass

    app = FastAPI(title="Signal Clone API", version="1.0.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"], allow_headers=["*"],
        allow_credentials=False,  # bearer token in a header, no cookies
    )
    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(RequestValidationError, validation_handler)
    app.add_exception_handler(StarletteHTTPException, http_error_handler)

    for router in (auth.router, users.router, conversations.router, messages.router, stories.router, webhooks.router):
        app.include_router(router, prefix="/api")
    app.include_router(ws.router)

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    app.mount("/media/avatars", StaticFiles(directory=os.path.join(settings.upload_dir, "avatars")), name="avatars")
    return app


app = create_app()
