"""All timestamps are fixed-width ISO-8601 UTC strings, so string comparison == time comparison."""
from datetime import datetime, timedelta, timezone

FMT = "%Y-%m-%dT%H:%M:%S.%fZ"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def to_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime(FMT)


def now_iso() -> str:
    return to_iso(utcnow())


def parse_iso(value: str) -> datetime:
    return datetime.strptime(value, FMT).replace(tzinfo=timezone.utc)


def add_seconds(iso: str, seconds: float) -> str:
    return to_iso(parse_iso(iso) + timedelta(seconds=seconds))
