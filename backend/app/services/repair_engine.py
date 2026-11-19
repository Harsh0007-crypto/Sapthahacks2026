"""Human-in-the-loop repair suggestion engine with deterministic replay and undo."""

from __future__ import annotations

import uuid
from typing import Any

import pandas as pd
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import AuditLog, Dataset, RepairSuggestion
from app.services.file_processor import load_dataframe, save_working_dataframe
from app.services.profiler import (
    BOOLEAN_VALUES,
    EMAIL_PATTERN,
    is_valid_phone,
    profile_dataframe,
    try_parse_date,
    try_parse_numeric,
)
from app.utils.helpers import dumps_safe, loads_safe, to_json_safe, utc_now


def _extract_record_identifier(df: pd.DataFrame | None, row_index: int) -> str:
    """Extract a stable human-readable record identifier (e.g. order_id=2001) when available."""
    if df is not None and row_index in df.index:
        id_col = next(
            (
                str(c)
                for c in df.columns
                if str(c).lower() == "id" or str(c).lower().endswith("_id")
            ),
            None,
        )
        if id_col is not None:
            raw = str(df.at[row_index, id_col]).strip()
            if raw:
                return f"{id_col}={raw}"
    return f"row_index={row_index}"


def build_repair_suggestions(
    dataset_id: str,
    analysis_id: str,
    issues: list[dict[str, Any]],
    df: pd.DataFrame | None = None,
) -> list[RepairSuggestion]:
    """
    Convert detected issues into explicit, transparent repair suggestions.

    Strict safety rules:
      - Never invent missing emails, phone numbers, names, dates, or financial values.
      - Never convert negative financial amounts to positive automatically.
      - Never replace missing numeric values with arbitrary defaults.
      - Include confidence ONLY when supported by a deterministic rule.
      - All suggestions start as 'pending' and require explicit approval.
    """
    suggestions: list[RepairSuggestion] = []

    for issue in issues:
        issue_type = issue["issue_type"]
        row_index = int(issue["row_index"])
        record_identifier = _extract_record_identifier(df, row_index)
        column_name = issue.get("column_name")
        before_val = issue.get("value")
        rule = issue.get("rule", "")
        meta = issue.get("meta") or {}

        repair_action = "flag_for_review"
        safety_category = "human_review_required"
        repair_method = "human_review_required"
        after_val: Any = None
        confidence: float | None = None
        uncertainty_note: str | None = None
        can_auto_apply = False
        explanation = issue["description"]

        if issue_type == "duplicate_record":
            repair_action = "drop_duplicate_row"
            safety_category = "safe_auto_repair"
            repair_method = "deterministic_deduplication"
            after_val = None
            confidence = 1.0
            uncertainty_note = "Exact row match after outer whitespace normalization; first occurrence is preserved."
            can_auto_apply = True
            explanation = (
                f"Remove exact duplicate row ({record_identifier}) at index {row_index}. "
                "The first occurrence is preserved in the dataset."
            )

        elif issue_type == "inconsistent_category" and meta.get("fixable"):
            repair_action = "standardize_category"
            safety_category = "safe_auto_repair"
            repair_method = "deterministic_formatting"
            after_val = meta["suggested"]
            confidence = 0.92
            uncertainty_note = "Deterministic case/whitespace normalization to the majority spelling in this column."
            can_auto_apply = True
            explanation = (
                f"Standardize '{before_val}' to canonical category '{after_val}' "
                f"in column '{column_name}' based on case/whitespace grouping."
            )

        elif issue_type == "invalid_format" and meta.get("fixable"):
            suggested = meta["suggested"]
            safety_category = "safe_auto_repair"
            repair_method = "deterministic_formatting"
            if rule == "iso_date_standardization":
                repair_action = "standardize_date"
                confidence = 0.90
                uncertainty_note = "Deterministic ISO-8601 date formatting; calendar date value unchanged."
                explanation = (
                    f"Standardize date '{before_val}' to ISO-8601 format '{suggested}' "
                    f"in column '{column_name}'."
                )
            elif rule == "email_canonical_format":
                repair_action = "standardize_email"
                confidence = 0.95
                uncertainty_note = "Deterministic trim and lowercase normalization of a valid email address."
                explanation = (
                    f"Trim and lowercase email '{before_val}' to '{suggested}' "
                    f"in column '{column_name}'."
                )
            elif rule == "numeric_format_standardization":
                repair_action = "standardize_numeric"
                confidence = 0.95
                uncertainty_note = "Deterministic removal of currency/comma/whitespace formatting; numeric sign and value preserved."
                explanation = (
                    f"Strip formatting characters from '{before_val}' to plain numeric string "
                    f"'{suggested}' in column '{column_name}'."
                )
            elif rule == "whitespace_trim":
                repair_action = "trim_whitespace"
                confidence = 0.98
                uncertainty_note = "Deterministic removal of leading/trailing whitespace only."
                explanation = (
                    f"Remove leading/trailing whitespace from '{before_val}' -> '{suggested}' "
                    f"in column '{column_name}'."
                )
            else:
                repair_action = "standardize_value"
                confidence = 0.90
                uncertainty_note = "Deterministic format normalization."
            after_val = suggested
            can_auto_apply = True

        elif issue_type == "missing_value":
            repair_action = "flag_for_review"
            safety_category = "human_review_required"
            repair_method = "human_review_required"
            after_val = None
            confidence = None
            uncertainty_note = (
                "Missing value cannot be safely inferred. Never invent missing emails, "
                "phone numbers, names, or financial amounts."
            )
            can_auto_apply = False
            explanation = (
                f"Missing value detected in column '{column_name}' ({record_identifier}). "
                "No replacement value was invented; enter a replacement value to apply a manual repair "
                "or reject to preserve as missing."
            )

        elif issue_type == "invalid_format" and not meta.get("fixable"):
            repair_action = "flag_for_review"
            if rule == "email_regex_validation":
                safety_category = "human_review_required"
                repair_method = "human_review_required"
                uncertainty_note = (
                    "This email address doesn't look valid. Please check it and enter the correct email."
                )
            elif rule == "date_parse_validation":
                safety_category = "human_review_required"
                repair_method = "human_review_required"
                uncertainty_note = (
                    "This date doesn't look valid. DataFix never invents dates — please check it and enter the correct date."
                )
            else:
                safety_category = "unresolved"
                repair_method = "unresolved"
                uncertainty_note = (
                    "This value could not be fixed automatically. Original value preserved."
                )
            after_val = None
            confidence = None
            can_auto_apply = False
            explanation = (
                f"{issue['description']} Original value preserved until you enter a correction."
            )

        elif issue_type == "statistical_anomaly":
            repair_action = "flag_for_review"
            safety_category = "human_review_required"
            repair_method = "human_review_required"
            after_val = None
            confidence = None
            uncertainty_note = (
                "Statistical outliers and negative financial values may be legitimate (e.g., refunds/credits). "
                "Never auto-convert negative values to positive or overwrite without user approval."
            )
            can_auto_apply = False
            explanation = (
                f"{issue['description']} Flagged for human review rather than automatically modified; "
                "enter a replacement value to override or reject if legitimate."
            )

        suggestions.append(
            RepairSuggestion(
                id=f"rep_{uuid.uuid4().hex[:12]}",
                dataset_id=dataset_id,
                analysis_id=analysis_id,
                issue_type=issue_type,
                repair_action=repair_action,
                safety_category=safety_category,
                repair_method=repair_method,
                approval_type=None,
                row_index=row_index,
                record_identifier=record_identifier,
                column_name=column_name,
                before_value_json=dumps_safe(before_val),
                after_value_json=dumps_safe(after_val),
                applied_value_json=None,
                explanation=explanation,
                uncertainty_note=uncertainty_note,
                justification=None,
                confidence=confidence,
                can_auto_apply=can_auto_apply,
                status="pending",
            )
        )

    return suggestions


def rebuild_working_dataset(db: Session, dataset: Dataset) -> pd.DataFrame:
    """
    Deterministically rebuild the working dataset from the immutable original file
    plus all currently approved repairs. This guarantees exact undo semantics and
    zero row-index drift.
    """
    df = load_dataframe(dataset.original_file_path, dataset.file_extension).copy()

    approved_repairs = (
        db.query(RepairSuggestion)
        .filter(
            RepairSuggestion.dataset_id == dataset.id,
            RepairSuggestion.status == "approved",
        )
        .order_by(RepairSuggestion.applied_at.asc(), RepairSuggestion.created_at.asc())
        .all()
    )

    rows_to_drop: set[int] = set()

    # Step 1: Apply cell-level repairs using original DataFrame index
    for rep in approved_repairs:
        if rep.repair_action == "drop_duplicate_row":
            if rep.row_index in df.index:
                rows_to_drop.add(rep.row_index)
            continue

        if rep.column_name and rep.column_name in df.columns and rep.row_index in df.index:
            applied_val = loads_safe(rep.applied_value_json)
            df.at[rep.row_index, rep.column_name] = "" if applied_val is None else str(applied_val)

    # Step 2: Drop approved duplicate rows
    if rows_to_drop:
        df = df.drop(index=sorted(rows_to_drop)).reset_index(drop=True)

    # Persist working copy and refresh dataset metadata
    save_working_dataframe(df, dataset.working_file_path)
    updated_profile = profile_dataframe(df)
    dataset.row_count = int(len(df))
    dataset.column_count = int(len(df.columns))
    dataset.profile_json = dumps_safe(updated_profile)
    dataset.status = "repaired" if approved_repairs else "analyzed"
    dataset.updated_at = utc_now()
    db.add(dataset)

    return df


def approve_repair(
    db: Session,
    repair_id: str,
    custom_value: Any | None = None,
    justification: str | None = None,
) -> tuple[RepairSuggestion, pd.DataFrame]:
    """Explicitly approve and apply a repair suggestion with full provenance."""
    repair = db.query(RepairSuggestion).filter(RepairSuggestion.id == repair_id).first()
    if not repair:
        raise HTTPException(status_code=404, detail=f"Repair suggestion '{repair_id}' not found.")

    if repair.status == "approved":
        raise HTTPException(status_code=400, detail="Repair suggestion is already approved.")

    dataset = db.query(Dataset).filter(Dataset.id == repair.dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Associated dataset not found.")

    clean_justification = justification.strip() if isinstance(justification, str) and justification.strip() else None

    if repair.repair_action == "drop_duplicate_row":
        value_to_apply = None
        approval_type = "deterministic_approved"
    elif custom_value is not None and str(custom_value).strip() != "":
        cleaned_custom = str(custom_value).strip()
        col_lower = (repair.column_name or "").lower()

        # Look up actual inferred column type from the dataset profile
        profile_data = loads_safe(dataset.profile_json, default={}) or {}
        col_profile = next(
            (c for c in profile_data.get("columns", []) if c.get("name") == repair.column_name),
            None,
        )
        inferred_type = (col_profile or {}).get("inferred_type", "")

        # Schema-aware validation for every data type
        if inferred_type == "email" or "email" in col_lower or "mail" in col_lower:
            if not EMAIL_PATTERN.match(cleaned_custom):
                raise HTTPException(
                    status_code=400,
                    detail="That doesn't look like a valid email address. Please enter an address like name@example.com.",
                )
        elif inferred_type == "phone" or any(h in col_lower for h in ("phone", "mobile", "tel")):
            if not is_valid_phone(cleaned_custom):
                raise HTTPException(
                    status_code=400,
                    detail="That doesn't look like a valid phone number. Please enter 7 to 15 digits.",
                )
        elif inferred_type == "date" or any(h in col_lower for h in ("date", "dob", "birth")):
            if try_parse_date(cleaned_custom) is None:
                raise HTTPException(
                    status_code=400,
                    detail="That date doesn't look valid. Please enter a real date (for example: 2026-03-15).",
                )
        elif inferred_type == "integer":
            parsed_num = try_parse_numeric(cleaned_custom)
            if parsed_num is None or not float(parsed_num).is_integer():
                raise HTTPException(
                    status_code=400,
                    detail=f"Please enter a whole number for '{repair.column_name}'.",
                )
        elif inferred_type == "float":
            if try_parse_numeric(cleaned_custom) is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"Please enter a valid number for '{repair.column_name}'.",
                )
        elif inferred_type == "boolean":
            if cleaned_custom.lower() not in BOOLEAN_VALUES:
                raise HTTPException(
                    status_code=400,
                    detail=f"Please choose Yes or No for '{repair.column_name}'.",
                )

        value_to_apply = cleaned_custom
        approval_type = "manual_override"
        repair.repair_method = "manual_override"
    elif repair.can_auto_apply:
        value_to_apply = loads_safe(repair.after_value_json)
        approval_type = "deterministic_approved"
    else:
        raise HTTPException(
            status_code=400,
            detail=(
                "This issue requires manual review and has no automatic replacement value. "
                "Enter an explicit 'custom_value' to apply a repair, or reject to preserve the original value."
            ),
        )

    now = utc_now()
    repair.status = "approved"
    repair.approval_type = approval_type
    repair.applied_value_json = dumps_safe(value_to_apply)
    repair.justification = clean_justification
    repair.rejection_reason = None
    repair.applied_at = now
    repair.updated_at = now
    db.add(repair)
    db.flush()

    working_df = rebuild_working_dataset(db, dataset)

    audit = AuditLog(
        id=f"aud_{uuid.uuid4().hex[:12]}",
        dataset_id=dataset.id,
        repair_id=repair.id,
        action="repair_approved",
        details_json=dumps_safe(
            {
                "dataset_id": dataset.id,
                "record_identifier": repair.record_identifier,
                "row_index": repair.row_index,
                "column_name": repair.column_name,
                "issue_type": repair.issue_type,
                "repair_action": repair.repair_action,
                "repair_method": repair.repair_method,
                "approval_type": approval_type,
                "before_value": loads_safe(repair.before_value_json),
                "proposed_value": loads_safe(repair.after_value_json),
                "applied_value": to_json_safe(value_to_apply),
                "confidence": repair.confidence,
                "justification": clean_justification,
                "used_custom_value": approval_type == "manual_override",
            }
        ),
    )
    db.add(audit)
    db.commit()
    db.refresh(repair)
    return repair, working_df


def reject_repair(
    db: Session,
    repair_id: str,
    reason: str | None = None,
) -> tuple[RepairSuggestion, pd.DataFrame]:
    """Explicitly reject a repair suggestion (rebuilding working copy if it was previously approved)."""
    repair = db.query(RepairSuggestion).filter(RepairSuggestion.id == repair_id).first()
    if not repair:
        raise HTTPException(status_code=404, detail=f"Repair suggestion '{repair_id}' not found.")

    if repair.status == "rejected":
        raise HTTPException(status_code=400, detail="Repair suggestion is already rejected.")

    dataset = db.query(Dataset).filter(Dataset.id == repair.dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Associated dataset not found.")

    was_approved = repair.status == "approved"
    now = utc_now()
    repair.status = "rejected"
    repair.rejection_reason = reason
    repair.applied_value_json = None
    repair.applied_at = None
    repair.updated_at = now
    db.add(repair)
    db.flush()

    if was_approved:
        working_df = rebuild_working_dataset(db, dataset)
    else:
        working_df = load_dataframe(dataset.working_file_path, ".csv")

    audit = AuditLog(
        id=f"aud_{uuid.uuid4().hex[:12]}",
        dataset_id=dataset.id,
        repair_id=repair.id,
        action="repair_rejected",
        details_json=dumps_safe(
            {
                "repair_action": repair.repair_action,
                "issue_type": repair.issue_type,
                "row_index": repair.row_index,
                "column_name": repair.column_name,
                "reason": reason,
            }
        ),
    )
    db.add(audit)
    db.commit()
    db.refresh(repair)
    return repair, working_df


def undo_repair(db: Session, repair_id: str) -> tuple[RepairSuggestion, pd.DataFrame]:
    """Undo a previously approved or rejected repair, restoring dataset state deterministically."""
    repair = db.query(RepairSuggestion).filter(RepairSuggestion.id == repair_id).first()
    if not repair:
        raise HTTPException(status_code=404, detail=f"Repair suggestion '{repair_id}' not found.")

    if repair.status in ("pending", "undone"):
        raise HTTPException(
            status_code=400,
            detail=f"Repair suggestion cannot be undone from status '{repair.status}'.",
        )

    dataset = db.query(Dataset).filter(Dataset.id == repair.dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Associated dataset not found.")

    previous_status = repair.status
    previous_applied_val = loads_safe(repair.applied_value_json)
    now = utc_now()
    repair.status = "undone"
    repair.approval_type = None
    repair.applied_value_json = None
    repair.applied_at = None
    repair.rejection_reason = None
    repair.justification = None
    if not repair.can_auto_apply and repair.repair_method == "manual_override":
        repair.repair_method = "human_review_required"
    repair.updated_at = now
    db.add(repair)
    db.flush()

    working_df = rebuild_working_dataset(db, dataset)

    audit = AuditLog(
        id=f"aud_{uuid.uuid4().hex[:12]}",
        dataset_id=dataset.id,
        repair_id=repair.id,
        action="repair_undone",
        details_json=dumps_safe(
            {
                "previous_status": previous_status,
                "repair_action": repair.repair_action,
                "issue_type": repair.issue_type,
                "row_index": repair.row_index,
                "column_name": repair.column_name,
                "reverted_value": previous_applied_val,
                "restored_value": loads_safe(repair.before_value_json),
            }
        ),
    )
    db.add(audit)
    db.commit()
    db.refresh(repair)
    return repair, working_df


def compute_display_status(repair: RepairSuggestion) -> str:
    """Single source of truth for human-readable repair status."""
    if repair.status == "approved":
        if repair.approval_type in ("auto_applied", "deterministic_approved") and repair.can_auto_apply:
            return "Fixed Automatically"
        return "Fixed Manually"
    if repair.status == "rejected":
        return "Rejected"
    if repair.status == "undone":
        return "Undone"
    category = repair.safety_category or (
        "safe_auto_repair" if repair.can_auto_apply else "human_review_required"
    )
    if category == "human_review_required":
        return "Needs Your Attention"
    return "Not Fixed Yet"


def serialize_repair(repair: RepairSuggestion) -> dict[str, Any]:
    """Serialize a RepairSuggestion ORM instance into API response dict."""
    inferred_category = repair.safety_category
    if not inferred_category:
        inferred_category = "safe_auto_repair" if repair.can_auto_apply else "human_review_required"
    return {
        "repair_id": repair.id,
        "dataset_id": repair.dataset_id,
        "analysis_id": repair.analysis_id,
        "issue_type": repair.issue_type,
        "repair_action": repair.repair_action,
        "safety_category": inferred_category,
        "repair_method": repair.repair_method or "human_review_required",
        "approval_type": repair.approval_type,
        "row_index": repair.row_index,
        "record_identifier": repair.record_identifier or f"row_index={repair.row_index}",
        "column_name": repair.column_name,
        "before_value": loads_safe(repair.before_value_json),
        "after_value": loads_safe(repair.after_value_json),
        "applied_value": loads_safe(repair.applied_value_json),
        "explanation": repair.explanation,
        "uncertainty_note": repair.uncertainty_note,
        "justification": repair.justification,
        "confidence": repair.confidence,
        "can_auto_apply": repair.can_auto_apply,
        "status": repair.status,
        "display_status": compute_display_status(repair),
        "rejection_reason": repair.rejection_reason,
        "applied_at": repair.applied_at,
        "created_at": repair.created_at,
        "updated_at": repair.updated_at,
    }


def run_autonomous_cleaning(
    db: Session,
    dataset_id: str,
    remove_duplicates: bool = True,
) -> dict[str, Any]:
    """
    Execute one-click autonomous cleaning:
      1. Ensure deterministic analysis & 3-tier classification exist for the dataset.
      2. Automatically apply ONLY safe_auto_repair suggestions (respecting remove_duplicates).
      3. Preserve human_review_required and unresolved items untouched.
      4. Rebuild working dataset from the immutable original upload.
      5. Validate changes, generate the updated report, and log every modification.
    """
    from app.models import AnalysisResult
    from app.services.detector import detect_issues
    from app.services.report_generator import generate_dataset_report

    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' not found.")

    latest_analysis = (
        db.query(AnalysisResult)
        .filter(AnalysisResult.dataset_id == dataset_id)
        .order_by(AnalysisResult.created_at.desc())
        .first()
    )

    if not latest_analysis:
        original_df = load_dataframe(dataset.original_file_path, dataset.file_extension)
        profile = profile_dataframe(original_df)
        detection = detect_issues(original_df, profile)
        analysis_id = f"ana_{uuid.uuid4().hex[:12]}"
        public_issues = [{k: v for k, v in item.items() if k != "meta"} for item in detection["issues"]]
        latest_analysis = AnalysisResult(
            id=analysis_id,
            dataset_id=dataset_id,
            total_issues=detection["total_issues"],
            issues_by_type_json=dumps_safe(detection["issues_by_type"]),
            issues_by_severity_json=dumps_safe(detection["issues_by_severity"]),
            quality_score=detection["quality_score"],
            issues_json=dumps_safe(public_issues),
            profile_json=dumps_safe(profile),
        )
        db.add(latest_analysis)
        suggestions = build_repair_suggestions(dataset_id, analysis_id, detection["issues"], df=original_df)
        for s in suggestions:
            db.add(s)
        db.flush()

    all_repairs = (
        db.query(RepairSuggestion)
        .filter(RepairSuggestion.dataset_id == dataset_id)
        .order_by(RepairSuggestion.row_index.asc(), RepairSuggestion.created_at.asc())
        .all()
    )

    applied_count = 0
    now = utc_now()
    for rep in all_repairs:
        if rep.status not in ("pending", "undone"):
            continue
        if rep.safety_category != "safe_auto_repair" or not rep.can_auto_apply:
            continue
        if rep.repair_action == "drop_duplicate_row" and not remove_duplicates:
            continue

        value_to_apply = None if rep.repair_action == "drop_duplicate_row" else loads_safe(rep.after_value_json)
        rep.status = "approved"
        rep.approval_type = "auto_applied"
        rep.applied_value_json = dumps_safe(value_to_apply)
        rep.rejection_reason = None
        rep.applied_at = now
        rep.updated_at = now
        db.add(rep)

        db.add(
            AuditLog(
                id=f"aud_{uuid.uuid4().hex[:12]}",
                dataset_id=dataset.id,
                repair_id=rep.id,
                action="auto_repair_applied",
                details_json=dumps_safe(
                    {
                        "dataset_id": dataset.id,
                        "record_identifier": rep.record_identifier,
                        "row_index": rep.row_index,
                        "column_name": rep.column_name,
                        "issue_type": rep.issue_type,
                        "repair_action": rep.repair_action,
                        "safety_category": rep.safety_category,
                        "repair_method": rep.repair_method,
                        "approval_type": "auto_applied",
                        "before_value": loads_safe(rep.before_value_json),
                        "applied_value": to_json_safe(value_to_apply),
                        "confidence": rep.confidence,
                    }
                ),
            )
        )
        applied_count += 1

    db.flush()
    rebuild_working_dataset(db, dataset)
    db.flush()

    manual_review_count = sum(
        1 for r in all_repairs if r.status in ("pending", "undone") and r.safety_category == "human_review_required"
    )
    unresolved_count = sum(
        1 for r in all_repairs if r.status in ("pending", "undone") and r.safety_category == "unresolved"
    )

    report = generate_dataset_report(db, dataset)
    validation = report["validation"]

    db.add(
        AuditLog(
            id=f"aud_{uuid.uuid4().hex[:12]}",
            dataset_id=dataset.id,
            repair_id=None,
            action="auto_clean_completed",
            details_json=dumps_safe(
                {
                    "dataset_id": dataset.id,
                    "safe_repairs_applied": applied_count,
                    "manual_review_count": manual_review_count,
                    "unresolved_count": unresolved_count,
                    "remove_duplicates": remove_duplicates,
                    "before_quality_score": validation["before_quality_score"],
                    "after_quality_score": validation["after_quality_score"],
                    "before_issue_count": validation["before_issue_count"],
                    "after_issue_count": validation["after_issue_count"],
                }
            ),
        )
    )
    db.commit()

    # Re-read report so the auto_clean_completed audit event is included in modification_history
    final_report = generate_dataset_report(db, dataset)

    return {
        "dataset_id": dataset.id,
        "message": (
            f"Automatic cleaning complete: {applied_count} safe repair(s) applied, "
            f"{manual_review_count} queued for human review, {unresolved_count} unresolved."
        ),
        "safe_repairs_applied": applied_count,
        "manual_review_count": manual_review_count,
        "unresolved_count": unresolved_count,
        "before_quality_score": final_report["validation"]["before_quality_score"],
        "after_quality_score": final_report["validation"]["after_quality_score"],
        "before_issue_count": final_report["validation"]["before_issue_count"],
        "after_issue_count": final_report["validation"]["after_issue_count"],
        "validation": final_report["validation"],
        "report": final_report,
    }
