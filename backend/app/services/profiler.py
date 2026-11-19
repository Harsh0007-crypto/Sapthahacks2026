"""Deterministic data profiling service using Pandas and NumPy."""

from __future__ import annotations

import re
from typing import Any

import numpy as np
import pandas as pd

from app.utils.helpers import is_missing, to_json_safe

EMAIL_PATTERN = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")
PHONE_ALLOWED_PATTERN = re.compile(r"^[+\d\s().\-]{7,25}$")
NUMERIC_CLEAN_PATTERN = re.compile(r"^[\$\€\£\s]*([+-]?\d{1,3}(?:,\d{3})*(?:\.\d+)?|[+-]?\d+(?:\.\d+)?)\s*%?$")
BOOLEAN_VALUES = {"true", "false", "yes", "no", "0", "1", "y", "n"}

DATE_NAME_HINTS = ("date", "dob", "birth", "created", "updated", "joined", "timestamp", "time")
EMAIL_NAME_HINTS = ("email", "e-mail", "mail")
PHONE_NAME_HINTS = ("phone", "mobile", "tel", "contact_number", "cell")
NUMERIC_NAME_HINTS = (
    "age", "price", "salary", "amount", "cost", "total", "score",
    "qty", "quantity", "count", "revenue", "income", "balance", "rate", "rating",
)


def is_valid_phone(raw: str) -> bool:
    """Return True if raw looks like a valid phone number (7-15 digits, safe punctuation)."""
    text = raw.strip()
    if not PHONE_ALLOWED_PATTERN.match(text):
        return False
    digits = re.sub(r"\D", "", text)
    return 7 <= len(digits) <= 15


def try_parse_numeric(raw: str) -> float | None:
    """Attempt to parse a numeric string, stripping currency symbols and commas."""
    text = raw.strip()
    if not text:
        return None
    cleaned = text.replace(",", "").replace("$", "").replace("€", "").replace("£", "").strip()
    if cleaned.endswith("%"):
        cleaned = cleaned[:-1].strip()
    try:
        val = float(cleaned)
        if np.isnan(val) or np.isinf(val):
            return None
        return val
    except ValueError:
        return None


def try_parse_date(raw: str) -> pd.Timestamp | None:
    """Attempt to parse a date string safely without misclassifying plain numbers."""
    text = raw.strip()
    if not text:
        return None
    # Reject pure numbers (e.g. "25", "1000") so numeric columns are not mistaken for dates
    if re.fullmatch(r"[+-]?\d+(\.\d+)?", text):
        return None
    try:
        parsed = pd.to_datetime(text, errors="raise", format="mixed")
        if pd.isna(parsed):
            return None
        return parsed
    except Exception:
        return None


def infer_column_type(col_name: str, series: pd.Series) -> str:
    """Deterministically infer semantic column type from column name and values."""
    non_null = [str(v).strip() for v in series if not is_missing(v)]
    if not non_null:
        return "empty"

    lower_name = col_name.lower()
    total = len(non_null)

    # Check email
    email_hits = sum(1 for v in non_null if "@" in v)
    if any(hint in lower_name for hint in EMAIL_NAME_HINTS) or (email_hits / total >= 0.5):
        return "email"

    # Check phone
    phone_hits = sum(1 for v in non_null if is_valid_phone(v))
    if any(hint in lower_name for hint in PHONE_NAME_HINTS) and phone_hits / total >= 0.4:
        return "phone"

    # Check boolean
    bool_hits = sum(1 for v in non_null if v.lower() in BOOLEAN_VALUES)
    if bool_hits / total >= 0.9 and len({v.lower() for v in non_null}) <= 2:
        return "boolean"

    # Check numeric
    numeric_vals = [try_parse_numeric(v) for v in non_null]
    numeric_hits = sum(1 for v in numeric_vals if v is not None)
    if numeric_hits / total >= 0.6 or (
        any(hint in lower_name for hint in NUMERIC_NAME_HINTS) and numeric_hits / total >= 0.4
    ):
        non_none_nums = [v for v in numeric_vals if v is not None]
        if non_none_nums and all(float(v).is_integer() for v in non_none_nums):
            return "integer"
        return "float"

    # Check date
    date_hits = sum(1 for v in non_null if try_parse_date(v) is not None)
    if date_hits / total >= 0.6 or (
        any(hint in lower_name for hint in DATE_NAME_HINTS) and date_hits / total >= 0.4
    ):
        return "date"

    # Categorical vs free text: require genuine repetition across rows
    unique_norm = {v.lower() for v in non_null}
    if len(unique_norm) <= 20 and len(unique_norm) < total and (len(unique_norm) / total <= 0.6):
        return "categorical"

    return "string"


def profile_dataframe(df: pd.DataFrame) -> dict[str, Any]:
    """Compute a complete deterministic profile for a DataFrame."""
    row_count = int(len(df))
    column_count = int(len(df.columns))
    total_cells = row_count * column_count

    total_missing_cells = 0
    columns_profile: list[dict[str, Any]] = []

    for col in df.columns:
        series = df[col]
        missing_mask = series.apply(is_missing)
        missing_count = int(missing_mask.sum())
        non_null_count = row_count - missing_count
        total_missing_cells += missing_count
        missing_pct = round((missing_count / row_count) * 100.0, 2) if row_count > 0 else 0.0

        non_null_values = [str(v) for v in series[~missing_mask]]
        unique_count = len(set(non_null_values))
        sample_values = [to_json_safe(v) for v in non_null_values[:5]]

        inferred_type = infer_column_type(str(col), series)
        stats: dict[str, Any] | None = None

        if inferred_type in ("integer", "float"):
            parsed_nums = [try_parse_numeric(v) for v in non_null_values]
            valid_nums = [n for n in parsed_nums if n is not None]
            if valid_nums:
                arr = np.array(valid_nums, dtype=float)
                stats = {
                    "min": round(float(np.min(arr)), 4),
                    "max": round(float(np.max(arr)), 4),
                    "mean": round(float(np.mean(arr)), 4),
                    "median": round(float(np.median(arr)), 4),
                    "std": round(float(np.std(arr, ddof=0)), 4),
                    "q1": round(float(np.percentile(arr, 25)), 4),
                    "q3": round(float(np.percentile(arr, 75)), 4),
                }
        elif inferred_type in ("categorical", "boolean"):
            stripped_vals = [v.strip() for v in non_null_values if v.strip()]
            value_counts = pd.Series(stripped_vals).value_counts().head(25).to_dict()
            # Deduplicate case-insensitively while preserving most frequent canonical spelling
            seen_lower: set[str] = set()
            allowed_values: list[str] = []
            for label in value_counts.keys():
                key = str(label).lower()
                if key not in seen_lower:
                    seen_lower.add(key)
                    allowed_values.append(str(label))
            stats = {
                "top_values": {str(k): int(v) for k, v in value_counts.items()},
                "allowed_values": allowed_values,
            }
        elif inferred_type == "date":
            parsed_dates = [try_parse_date(v) for v in non_null_values]
            valid_dates = [d for d in parsed_dates if d is not None]
            if valid_dates:
                stats = {
                    "min_date": min(valid_dates).date().isoformat(),
                    "max_date": max(valid_dates).date().isoformat(),
                    "parseable_count": len(valid_dates),
                }

        columns_profile.append(
            {
                "name": str(col),
                "inferred_type": inferred_type,
                "pandas_dtype": str(series.dtype),
                "non_null_count": non_null_count,
                "missing_count": missing_count,
                "missing_percentage": missing_pct,
                "unique_count": unique_count,
                "sample_values": sample_values,
                "stats": stats,
            }
        )

    # Count exact duplicate rows (after stripping cell whitespace)
    stripped_df = df.apply(lambda col: col.map(lambda x: str(x).strip()))
    duplicate_row_count = int(stripped_df.duplicated(keep="first").sum())

    overall_missing_pct = (
        round((total_missing_cells / total_cells) * 100.0, 2) if total_cells > 0 else 0.0
    )

    return {
        "row_count": row_count,
        "column_count": column_count,
        "total_cells": total_cells,
        "total_missing_cells": total_missing_cells,
        "missing_percentage": overall_missing_pct,
        "duplicate_row_count": duplicate_row_count,
        "columns": columns_profile,
    }
