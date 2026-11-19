"""Validation service comparing dataset state before and after repairs."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.models import Dataset, RepairSuggestion
from app.services.detector import detect_issues
from app.services.file_processor import load_dataframe
from app.services.profiler import profile_dataframe


def validate_dataset(db: Session, dataset: Dataset) -> tuple[dict[str, Any], dict[str, Any]]:
    """
    Compare original dataset vs current working dataset.

    Returns:
        (validation_comparison_dict, current_profile_dict)
    """
    original_df = load_dataframe(dataset.original_file_path, dataset.file_extension)
    working_df = load_dataframe(dataset.working_file_path, ".csv")

    before_profile = profile_dataframe(original_df)
    after_profile = profile_dataframe(working_df)

    before_detection = detect_issues(original_df, before_profile)
    after_detection = detect_issues(working_df, after_profile)

    approved_drops = (
        db.query(RepairSuggestion)
        .filter(
            RepairSuggestion.dataset_id == dataset.id,
            RepairSuggestion.status == "approved",
            RepairSuggestion.repair_action == "drop_duplicate_row",
        )
        .count()
    )

    original_exists = Path(dataset.original_file_path).exists()
    columns_match = list(original_df.columns) == list(working_df.columns)
    non_empty = len(working_df) > 0
    no_row_growth = len(working_df) <= len(original_df)
    expected_rows = len(original_df) - approved_drops
    row_drop_exact = len(working_df) == expected_rows

    integrity_checks = [
        {
            "name": "original_file_preserved",
            "passed": original_exists,
            "details": (
                "Original uploaded file is intact on disk."
                if original_exists
                else "Original uploaded file is missing."
            ),
        },
        {
            "name": "schema_columns_preserved",
            "passed": columns_match,
            "details": (
                f"All {len(original_df.columns)} columns and their order match the original schema."
                if columns_match
                else f"Schema mismatch: original={list(original_df.columns)}, working={list(working_df.columns)}."
            ),
        },
        {
            "name": "non_empty_dataset",
            "passed": non_empty,
            "details": (
                f"Working dataset contains {len(working_df)} rows."
                if non_empty
                else "Working dataset has 0 rows."
            ),
        },
        {
            "name": "no_unintended_row_growth",
            "passed": no_row_growth,
            "details": f"Row count went from {len(original_df)} to {len(working_df)}.",
        },
        {
            "name": "approved_row_removals_reconciled",
            "passed": row_drop_exact,
            "details": (
                f"Expected {expected_rows} rows after {approved_drops} approved duplicate removal(s); "
                f"actual is {len(working_df)}."
            ),
        },
    ]

    before_issues = int(before_detection["total_issues"])
    after_issues = int(after_detection["total_issues"])
    before_score = float(before_detection["quality_score"])
    after_score = float(after_detection["quality_score"])

    validation = {
        "before_row_count": int(len(original_df)),
        "after_row_count": int(len(working_df)),
        "before_column_count": int(len(original_df.columns)),
        "after_column_count": int(len(working_df.columns)),
        "before_issue_count": before_issues,
        "after_issue_count": after_issues,
        "issues_resolved": before_issues - after_issues,
        "before_issues_by_type": before_detection["issues_by_type"],
        "after_issues_by_type": after_detection["issues_by_type"],
        "before_quality_score": before_score,
        "after_quality_score": after_score,
        "quality_score_delta": round(after_score - before_score, 2),
        "integrity_checks": integrity_checks,
        "all_integrity_checks_passed": all(check["passed"] for check in integrity_checks),
    }

    return validation, after_profile
