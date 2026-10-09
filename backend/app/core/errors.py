"""One error envelope for the whole API: {"error": {"code": ..., "message": ...}}."""
from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class AppError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def not_found(what: str = "Resource") -> AppError:
    return AppError("NOT_FOUND", f"{what} not found", 404)


def forbidden(message: str = "You are not allowed to do that") -> AppError:
    return AppError("FORBIDDEN", message, 403)


def validation(message: str) -> AppError:
    return AppError("VALIDATION", message, 422)


def envelope(code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message}}


async def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(envelope(exc.code, exc.message), status_code=exc.status)


async def validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0] if exc.errors() else {}
    loc = ".".join(str(p) for p in first.get("loc", []) if p != "body")
    msg = first.get("msg", "Invalid request")
    return JSONResponse(envelope("VALIDATION", f"{loc}: {msg}" if loc else msg), status_code=422)


_HTTP_CODES = {401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 413: "PAYLOAD_TOO_LARGE"}


async def http_error_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    code = _HTTP_CODES.get(exc.status_code, "ERROR")
    return JSONResponse(envelope(code, str(exc.detail)), status_code=exc.status_code)
