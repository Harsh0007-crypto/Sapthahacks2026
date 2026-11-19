"""Shared helper functions for JSON safety, value formatting, and filename sanitization."""

from __future__ import annotations

import json
import math
import re
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


def utc_now() -> datetime:
    """Return current UTC datetime."""
    return datetime.now(timezone.utc)


def sanitize_filename(filename: str) -> str:
    """Return a safe base filename without directory traversal characters."""
    name = Path(filename).name
    name = re.sub(r"[^A-Za-z0-9._\- ]+", "_", name).strip()
    return name or "uploaded_dataset"


def is_missing(value: Any) -> bool:
    """Return True if a scalar value should be treated as missing/null."""
    if value is None:
        return True
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return True
    if isinstance(value, (np.floating,)) and (np.isnan(value) or np.isinf(value)):
        return True
    try:
        if pd.isna(value):
            return True
    except (TypeError, ValueError):
        pass
    if isinstance(value, str) and value.strip() == "":
        return True
    return False


def to_json_safe(value: Any) -> Any:
    """Recursively convert pandas/numpy/datetime scalars into JSON-serializable Python values."""
    if value is None:
        return None
    if isinstance(value, dict):
        return {str(k): to_json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_json_safe(v) for v in value]
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    if isinstance(value, (int, np.integer)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        fval = float(value)
        if math.isnan(fval) or math.isinf(fval):
            return None
        return fval
    if isinstance(value, (pd.Timestamp, datetime, date)):
        return value.isoformat()
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return str(value) if not isinstance(value, str) else value


def dumps_safe(data: Any) -> str:
    """Serialize any Python/pandas/numpy structure to a JSON string."""
    return json.dumps(to_json_safe(data), ensure_ascii=False)


def loads_safe(raw: str | None, default: Any = None) -> Any:
    """Safely deserialize a JSON string, returning default on None or invalid JSON."""
    if raw is None:
        return default
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return default


def dataframe_to_records(df: pd.DataFrame, limit: int | None = None, offset: int = 0) -> list[dict[str, Any]]:
    """Convert a DataFrame slice to a list of JSON-safe dictionaries."""
    sliced = df.iloc[offset : offset + limit] if limit is not None else df.iloc[offset:]
    records: list[dict[str, Any]] = []
    for _, row in sliced.iterrows():
        records.append({str(col): to_json_safe(row[col]) for col in df.columns})
    return records
