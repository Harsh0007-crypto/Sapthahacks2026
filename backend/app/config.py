"""Application configuration for DATAFIX AI backend."""

from __future__ import annotations

import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

DEFAULT_LOCAL_ORIGINS = (
    "http://localhost:5174,http://127.0.0.1:5174,"
    "http://localhost:5173,http://127.0.0.1:5173,"
    "http://localhost:4173,http://127.0.0.1:4173"
)
DEFAULT_LOCAL_ORIGIN_REGEX = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"
_UNRESTRICTED_REGEX_VALUES = {".*", "^.*$", "^.+$", ".+"}


def resolve_storage_dir(env_var: str, default_subpath: str) -> Path:
    """Resolve a storage directory supporting both relative local paths and absolute persistent disk paths."""
    raw = (os.getenv(env_var) or "").strip()
    if not raw:
        return BASE_DIR / default_subpath
    candidate = Path(raw)
    if candidate.is_absolute():
        return candidate
    return (BASE_DIR / candidate).resolve()


def parse_allowed_origins(raw: str) -> list[str]:
    """Parse comma-separated CORS origins, trimming whitespace and trailing slashes, rejecting wildcards."""
    origins: list[str] = []
    seen: set[str] = set()
    for part in (raw or "").split(","):
        cleaned = part.strip().rstrip("/")
        if not cleaned or cleaned == "*":
            continue
        if cleaned not in seen:
            seen.add(cleaned)
            origins.append(cleaned)
    return origins


def resolve_allowed_origin_regex(
    env_value: str | None,
    origins: list[str],
    origins_explicitly_set: bool,
) -> str | None:
    """Resolve optional CORS origin regex. An explicit empty value disables regex matching."""
    if env_value is not None:
        cleaned = env_value.strip()
        if not cleaned or cleaned in _UNRESTRICTED_REGEX_VALUES:
            return None
        return cleaned

    # If production origins were configured without setting ALLOWED_ORIGIN_REGEX,
    # disable localhost regex matching automatically.
    if origins_explicitly_set and origins and not any(
        "localhost" in origin or "127.0.0.1" in origin for origin in origins
    ):
        return None
    return DEFAULT_LOCAL_ORIGIN_REGEX


class Settings:
    """Centralized settings loaded from environment variables with safe defaults."""

    APP_NAME: str = os.getenv("APP_NAME", "DATAFIX AI API")
    APP_VERSION: str = os.getenv("APP_VERSION", "1.0.0")
    APP_DESCRIPTION: str = (
        "Autonomous Data Quality & Repair Engine — deterministic profiling, "
        "issue detection, human-in-the-loop repair management, validation, and export."
    )

    DATABASE_URL: str = (
        os.getenv("DATABASE_URL") or ""
    ).strip() or f"sqlite:///{(BASE_DIR / 'datafix.db').as_posix()}"

    MAX_UPLOAD_SIZE_MB: int = int(os.getenv("MAX_UPLOAD_SIZE_MB", "25"))
    MAX_UPLOAD_SIZE_BYTES: int = MAX_UPLOAD_SIZE_MB * 1024 * 1024

    ALLOWED_EXTENSIONS: set[str] = {".csv", ".xlsx", ".xls"}

    UPLOAD_DIR: Path = resolve_storage_dir("UPLOAD_DIR", "uploads")
    EXPORT_DIR: Path = resolve_storage_dir("EXPORT_DIR", "exports")

    PREVIEW_ROW_LIMIT: int = int(os.getenv("PREVIEW_ROW_LIMIT", "50"))

    _origins_explicit: bool = "ALLOWED_ORIGINS" in os.environ
    _raw_origins: str = os.getenv("ALLOWED_ORIGINS", DEFAULT_LOCAL_ORIGINS)
    ALLOWED_ORIGINS: list[str] = parse_allowed_origins(_raw_origins)
    ALLOWED_ORIGIN_REGEX: str | None = resolve_allowed_origin_regex(
        os.environ.get("ALLOWED_ORIGIN_REGEX"),
        ALLOWED_ORIGINS,
        _origins_explicit,
    )


settings = Settings()

# Ensure storage directories exist on import
settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
settings.EXPORT_DIR.mkdir(parents=True, exist_ok=True)
