"""SQLite database setup and session management using SQLAlchemy."""

from __future__ import annotations

from collections.abc import Generator
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings


class Base(DeclarativeBase):
    """SQLAlchemy declarative base for all ORM models."""


def ensure_sqlite_parent_dir(database_url: str) -> Path | None:
    """Create parent directories for file-backed SQLite URLs (including persistent mount paths)."""
    if not database_url.startswith("sqlite"):
        return None
    parsed = make_url(database_url)
    db_target = parsed.database
    if not db_target or db_target == ":memory:" or db_target.startswith("file:"):
        return None
    db_path = Path(db_target)
    if db_path.parent:
        db_path.parent.mkdir(parents=True, exist_ok=True)
    return db_path


def _make_engine(database_url: str | None = None):
    url = database_url or settings.DATABASE_URL
    ensure_sqlite_parent_dir(url)
    connect_args: dict[str, Any] = {}
    if url.startswith("sqlite"):
        connect_args["check_same_thread"] = False
        connect_args["timeout"] = 30
    eng = create_engine(url, connect_args=connect_args, future=True)

    if url.startswith("sqlite"):
        @event.listens_for(eng, "connect")
        def _set_sqlite_pragma(dbapi_connection: Any, _: Any) -> None:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA busy_timeout=30000")
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.close()

    return eng


engine = _make_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)


def init_db() -> None:
    """Create all database tables and apply lightweight SQLite column migrations."""
    import app.models  # noqa: F401 - ensure ORM models are registered on Base.metadata

    Base.metadata.create_all(bind=engine)

    # Lightweight additive column migration for existing SQLite databases
    if settings.DATABASE_URL.startswith("sqlite"):
        required_repair_columns = {
            "safety_category": "VARCHAR(64) NOT NULL DEFAULT 'human_review_required'",
            "repair_method": "VARCHAR(64) NOT NULL DEFAULT 'human_review_required'",
            "approval_type": "VARCHAR(64)",
            "record_identifier": "VARCHAR(255)",
            "uncertainty_note": "TEXT",
            "justification": "TEXT",
        }
        with engine.begin() as conn:
            existing_cols = {
                row[1]
                for row in conn.exec_driver_sql("PRAGMA table_info(repair_suggestions)").fetchall()
            }
            for col_name, col_ddl in required_repair_columns.items():
                if col_name not in existing_cols:
                    conn.exec_driver_sql(
                        f"ALTER TABLE repair_suggestions ADD COLUMN {col_name} {col_ddl}"
                    )
            # Backfill safety_category for any pre-migration rows where can_auto_apply=1
            conn.exec_driver_sql(
                "UPDATE repair_suggestions SET safety_category = 'safe_auto_repair' "
                "WHERE can_auto_apply = 1 AND safety_category != 'safe_auto_repair'"
            )


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency yielding a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
