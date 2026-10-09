"""SQLite engine, per-connection pragmas, and the write-lock helper."""
import os
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.db.models import Base


class _State:
    engine = None
    SessionLocal: sessionmaker | None = None


_state = _State()


def _set_pragmas(dbapi_conn, _record) -> None:
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA foreign_keys=ON")   # SQLite ships with FK enforcement OFF
    cur.execute("PRAGMA journal_mode=WAL")  # readers don't block the writer
    cur.execute("PRAGMA busy_timeout=5000")  # wait up to 5s instead of "database is locked"
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.close()


def configure(url: str) -> None:
    if url.startswith("sqlite:///") and ":memory:" not in url:
        path = url[len("sqlite:///"):]
        parent = os.path.dirname(os.path.abspath(path))
        os.makedirs(parent, exist_ok=True)
    if _state.engine is not None:
        _state.engine.dispose()
    engine = create_engine(url, connect_args={"check_same_thread": False})
    event.listen(engine, "connect", _set_pragmas)
    _state.engine = engine
    _state.SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def create_all() -> None:
    Base.metadata.create_all(_state.engine)
    _add_missing_columns()


# create_all never alters existing tables, so columns added after a database was first created are patched in here.
_ADDED_COLUMNS = [("messages", "edited_at", "TEXT")]


def _add_missing_columns() -> None:
    with _state.engine.begin() as conn:
        for table, column, ddl in _ADDED_COLUMNS:
            cols = {row[1] for row in conn.exec_driver_sql(f"PRAGMA table_info({table})")}
            if column not in cols:
                conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")


def get_engine():
    return _state.engine


def new_session() -> Session:
    assert _state.SessionLocal is not None, "database not configured"
    return _state.SessionLocal()


def get_db() -> Iterator[Session]:
    db = new_session()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    db = new_session()
    try:
        yield db
    finally:
        db.close()


def begin_write(db: Session) -> None:
    """Take SQLite's write lock up front (BEGIN IMMEDIATE).

    Check-then-write sequences (membership check -> seq allocation -> insert) must be atomic, and
    pysqlite only opens a transaction lazily at the first INSERT/UPDATE. Taking the lock first means
    two concurrent senders are serialized and can never be handed the same seq.
    """
    raw = db.connection().connection.driver_connection
    if not raw.in_transaction:
        raw.execute("BEGIN IMMEDIATE")
