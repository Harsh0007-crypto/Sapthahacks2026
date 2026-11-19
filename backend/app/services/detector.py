"""Deterministic data quality issue detection service."""

from __future__ import annotations

import re
import uuid
from collections import Counter, defaultdict
from typing import Any

import numpy as np
import pandas as pd

from app.services.profiler import (
    EMAIL_PATTERN,
    infer_column_type,
    profile_dataframe,
    try_parse_date,
    try_parse_numeric,
)
from app.utils.helpers import is_missing, to_json_safe

ISO_DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
PLAIN_INT_PATTERN = re.compile(r"^[+-]?\d+$")
PLAIN_FLOAT_PATTERN = re.compile(r"^[+-]?\d+(\.\d+)?$")
NON_NEGATIVE_HINTS = (
    "age", "price", "salary", "amount", "cost", "total", "qty",
    "quantity", "count", "revenue", "income", "score", "rating",
)


def _normalize_category_key(value: str) -> str:
    """Normalize a categorical label for grouping casing/whitespace/separator variants."""
    cleaned = re.sub(r"[\s_\-]+", " ", value.strip().lower())
    cleaned = re.sub(r"[^\w\s]", "", cleaned)
    return cleaned.strip()


def _choose_canonical_label(raw_values: list[str]) -> str:
    """Choose the most frequent stripped spelling as the canonical label."""
    stripped = [v.strip() for v in raw_values]
    counts = Counter(stripped)
    # Sort by highest frequency, then prefer Title Case / clean casing deterministically
    canonical = sorted(
        counts.items(),
        key=lambda item: (-item[1], item[0] != item[0].title(), item[0]),
    )[0][0]
    return canonical


def compute_quality_score(df: pd.DataFrame, issues: list[dict[str, Any]]) -> float:
    """Compute a deterministic 0-100 data quality score from detected issues."""
    total_cells = max(len(df) * max(len(df.columns), 1), 1)
    severity_weights = {"high": 2.0, "medium": 1.2, "low": 0.5}
    weighted_penalty = sum(severity_weights.get(i.get("severity", "medium"), 1.0) for i in issues)
    penalty_ratio = (weighted_penalty / total_cells) * 100.0
    score = max(0.0, min(100.0, 100.0 - penalty_ratio))
    return round(score, 2)


def detect_issues(df: pd.DataFrame, profile: dict[str, Any] | None = None) -> dict[str, Any]:
    """
    Run deterministic validation rules across all rows and columns.

    Detects:
      - missing_value
      - duplicate_record
      - invalid_format
      - inconsistent_category
      - statistical_anomaly
    """
    if profile is None:
        profile = profile_dataframe(df)

    issues: list[dict[str, Any]] = []
    column_types = {col["name"]: col["inferred_type"] for col in profile["columns"]}

    # Track cells already flagged for higher-priority issues to avoid noisy duplicates
    flagged_cells: set[tuple[int, str, str]] = set()

    def add_issue(
        issue_type: str,
        severity: str,
        row_index: int,
        column_name: str | None,
        value: Any,
        description: str,
        rule: str,
        meta: dict[str, Any] | None = None,
    ) -> None:
        key = (row_index, column_name or "__ROW__", issue_type)
        if key in flagged_cells:
            return
        flagged_cells.add(key)
        issue = {
            "issue_id": f"iss_{uuid.uuid4().hex[:10]}",
            "issue_type": issue_type,
            "severity": severity,
            "row_index": int(row_index),
            "column_name": column_name,
            "value": to_json_safe(value),
            "description": description,
            "rule": rule,
        }
        if meta:
            issue["meta"] = meta
        issues.append(issue)

    # 1. Duplicate records (exact match after outer whitespace trim)
    stripped_df = df.apply(lambda c: c.map(lambda x: str(x).strip()))
    dup_mask = stripped_df.duplicated(keep="first")
    for idx in df.index[dup_mask]:
        row_dict = {str(c): to_json_safe(df.at[idx, c]) for c in df.columns}
        add_issue(
            issue_type="duplicate_record",
            severity="high",
            row_index=int(idx),
            column_name=None,
            value=row_dict,
            description=f"Row {int(idx)} is an exact duplicate of an earlier record.",
            rule="exact_duplicate_row",
        )

    # 2. Column-level checks
    for col in df.columns:
        col_str = str(col)
        series = df[col]
        inferred_type = column_types.get(col_str) or infer_column_type(col_str, series)

        # 2a. Missing values
        for idx, raw_val in series.items():
            if is_missing(raw_val):
                add_issue(
                    issue_type="missing_value",
                    severity="high",
                    row_index=int(idx),
                    column_name=col_str,
                    value=None,
                    description=f"Missing value in column '{col_str}' at row {int(idx)}.",
                    rule="non_null_check",
                )

        # 2b. Invalid formats by inferred semantic type
        if inferred_type == "email":
            for idx, raw_val in series.items():
                if is_missing(raw_val):
                    continue
                val_str = str(raw_val)
                stripped = val_str.strip()
                lowered = stripped.lower()
                if not EMAIL_PATTERN.match(stripped):
                    add_issue(
                        issue_type="invalid_format",
                        severity="high",
                        row_index=int(idx),
                        column_name=col_str,
                        value=val_str,
                        description=f"Invalid email address '{val_str}' in column '{col_str}' at row {int(idx)}.",
                        rule="email_regex_validation",
                        meta={"fixable": False},
                    )
                elif val_str != lowered:
                    add_issue(
                        issue_type="invalid_format",
                        severity="low",
                        row_index=int(idx),
                        column_name=col_str,
                        value=val_str,
                        description=(
                            f"Email '{val_str}' in column '{col_str}' has non-canonical "
                            f"casing or whitespace (expected '{lowered}')."
                        ),
                        rule="email_canonical_format",
                        meta={"fixable": True, "suggested": lowered},
                    )

        elif inferred_type == "date":
            for idx, raw_val in series.items():
                if is_missing(raw_val):
                    continue
                val_str = str(raw_val)
                stripped = val_str.strip()
                parsed = try_parse_date(stripped)
                if parsed is None:
                    add_issue(
                        issue_type="invalid_format",
                        severity="high",
                        row_index=int(idx),
                        column_name=col_str,
                        value=val_str,
                        description=f"Unparseable date '{val_str}' in column '{col_str}' at row {int(idx)}.",
                        rule="date_parse_validation",
                        meta={"fixable": False},
                    )
                else:
                    iso_str = parsed.date().isoformat()
                    if val_str != iso_str or not ISO_DATE_PATTERN.match(val_str):
                        add_issue(
                            issue_type="invalid_format",
                            severity="medium",
                            row_index=int(idx),
                            column_name=col_str,
                            value=val_str,
                            description=(
                                f"Non-ISO date format '{val_str}' in column '{col_str}' at row {int(idx)} "
                                f"(standard ISO format: '{iso_str}')."
                            ),
                            rule="iso_date_standardization",
                            meta={"fixable": True, "suggested": iso_str},
                        )

        elif inferred_type in ("integer", "float"):
            numeric_entries: list[tuple[int, float]] = []
            for idx, raw_val in series.items():
                if is_missing(raw_val):
                    continue
                val_str = str(raw_val)
                parsed_num = try_parse_numeric(val_str)
                if parsed_num is None:
                    add_issue(
                        issue_type="invalid_format",
                        severity="high",
                        row_index=int(idx),
                        column_name=col_str,
                        value=val_str,
                        description=(
                            f"Non-numeric value '{val_str}' in numeric column '{col_str}' at row {int(idx)}."
                        ),
                        rule="numeric_parse_validation",
                        meta={"fixable": False},
                    )
                else:
                    numeric_entries.append((int(idx), parsed_num))
                    # Only flag values with formatting noise (currency symbols, commas, %, outer spaces);
                    # valid plain numbers like "2500.0" or "-450.0" are NOT invalid formats.
                    if not PLAIN_FLOAT_PATTERN.match(val_str):
                        formatted = (
                            str(int(parsed_num))
                            if inferred_type == "integer" and float(parsed_num).is_integer()
                            else f"{parsed_num:g}"
                        )
                        if val_str != formatted:
                            add_issue(
                                issue_type="invalid_format",
                                severity="medium",
                                row_index=int(idx),
                                column_name=col_str,
                                value=val_str,
                                description=(
                                    f"Formatted numeric string '{val_str}' in column '{col_str}' at row {int(idx)} "
                                    f"can be normalized to '{formatted}'."
                                ),
                                rule="numeric_format_standardization",
                                meta={"fixable": True, "suggested": formatted},
                            )

            # 2d. Statistical anomalies for numeric columns
            lower_col = col_str.lower()
            is_non_negative_col = any(hint in lower_col for hint in NON_NEGATIVE_HINTS)

            if numeric_entries:
                values_arr = np.array([v for _, v in numeric_entries], dtype=float)
                q1 = float(np.percentile(values_arr, 25))
                q3 = float(np.percentile(values_arr, 75))
                iqr = q3 - q1
                mean = float(np.mean(values_arr))
                std = float(np.std(values_arr, ddof=0))
                lower_bound = q1 - 1.5 * iqr
                upper_bound = q3 + 1.5 * iqr

                for row_idx, num_val in numeric_entries:
                    reasons: list[str] = []
                    rule_name = "iqr_outlier_detection"

                    if is_non_negative_col and num_val < 0:
                        reasons.append(
                            f"negative value ({num_val:g}) in column '{col_str}' — may be a valid refund/credit or entry error; requires human review"
                        )
                        rule_name = "domain_negative_value_review"
                    elif "age" in lower_col and num_val > 120:
                        reasons.append(f"implausible age value ({num_val:g} > 120)")
                        rule_name = "domain_age_range_check"

                    if len(numeric_entries) >= 5:
                        if iqr > 0 and (num_val < lower_bound or num_val > upper_bound):
                            reasons.append(
                                f"outside IQR fence [{lower_bound:.2f}, {upper_bound:.2f}] "
                                f"(Q1={q1:.2f}, Q3={q3:.2f}, IQR={iqr:.2f})"
                            )
                        elif std > 0:
                            z_score = abs((num_val - mean) / std)
                            if z_score > 3.0:
                                reasons.append(f"Z-score {z_score:.2f} exceeds 3.0 (mean={mean:.2f}, std={std:.2f})")
                                rule_name = "zscore_outlier_detection"

                    if reasons:
                        add_issue(
                            issue_type="statistical_anomaly",
                            severity="high" if ("negative" in reasons[0] or "implausible" in reasons[0]) else "medium",
                            row_index=row_idx,
                            column_name=col_str,
                            value=df.at[row_idx, col],
                            description=(
                                f"Statistical anomaly '{df.at[row_idx, col]}' in column '{col_str}' "
                                f"at row {row_idx}: {'; '.join(reasons)}."
                            ),
                            rule=rule_name,
                            meta={
                                "q1": round(q1, 4),
                                "q3": round(q3, 4),
                                "iqr": round(iqr, 4),
                                "mean": round(mean, 4),
                                "std": round(std, 4),
                            },
                        )

        elif inferred_type in ("categorical", "boolean"):
            # 2c. Inconsistent categorical values (casing, whitespace, separator variants)
            groups: dict[str, list[tuple[int, str]]] = defaultdict(list)
            for idx, raw_val in series.items():
                if is_missing(raw_val):
                    continue
                val_str = str(raw_val)
                norm_key = _normalize_category_key(val_str)
                groups[norm_key].append((int(idx), val_str))

            for norm_key, entries in groups.items():
                distinct_raw = {raw for _, raw in entries}
                if len(distinct_raw) > 1:
                    canonical = _choose_canonical_label([raw for _, raw in entries])
                    for row_idx, raw_val in entries:
                        if raw_val != canonical:
                            add_issue(
                                issue_type="inconsistent_category",
                                severity="medium",
                                row_index=row_idx,
                                column_name=col_str,
                                value=raw_val,
                                description=(
                                    f"Inconsistent category '{raw_val}' in column '{col_str}' at row {row_idx} "
                                    f"(canonical form: '{canonical}')."
                                ),
                                rule="categorical_normalization",
                                meta={"fixable": True, "suggested": canonical, "variants": sorted(distinct_raw)},
                            )
                else:
                    for row_idx, raw_val in entries:
                        trimmed = raw_val.strip()
                        if raw_val != trimmed:
                            add_issue(
                                issue_type="invalid_format",
                                severity="low",
                                row_index=row_idx,
                                column_name=col_str,
                                value=raw_val,
                                description=(
                                    f"Leading/trailing whitespace in column '{col_str}' at row {row_idx}."
                                ),
                                rule="whitespace_trim",
                                meta={"fixable": True, "suggested": trimmed},
                            )

        elif inferred_type == "string":
            # Check leading/trailing whitespace in string columns
            for idx, raw_val in series.items():
                if is_missing(raw_val):
                    continue
                val_str = str(raw_val)
                trimmed = val_str.strip()
                if val_str != trimmed:
                    add_issue(
                        issue_type="invalid_format",
                        severity="low",
                        row_index=int(idx),
                        column_name=col_str,
                        value=val_str,
                        description=(
                            f"Leading/trailing whitespace in column '{col_str}' at row {int(idx)}."
                        ),
                        rule="whitespace_trim",
                        meta={"fixable": True, "suggested": trimmed},
                    )

    issues_by_type: dict[str, int] = dict(Counter(i["issue_type"] for i in issues))
    issues_by_severity: dict[str, int] = dict(Counter(i["severity"] for i in issues))
    quality_score = compute_quality_score(df, issues)

    return {
        "total_issues": len(issues),
        "quality_score": quality_score,
        "issues_by_type": issues_by_type,
        "issues_by_severity": issues_by_severity,
        "issues": issues,
        "profile": profile,
    }
