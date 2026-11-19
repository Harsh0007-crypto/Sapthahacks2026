"""Report generation and dataset export service (CSV & JSON)."""

from __future__ import annotations

import json
import uuid
from collections import Counter
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.config import settings
from app.models import AuditLog, Dataset, RepairSuggestion
from app.services.file_processor import load_dataframe
from app.services.repair_engine import rebuild_working_dataset
from app.services.validator import validate_dataset
from app.utils.helpers import dataframe_to_records, dumps_safe, loads_safe, utc_now


def generate_dataset_report(db: Session, dataset: Dataset) -> dict[str, Any]:
    """Build a comprehensive validation report and modification history for a dataset."""
    validation, current_profile = validate_dataset(db, dataset)

    repairs = (
        db.query(RepairSuggestion)
        .filter(RepairSuggestion.dataset_id == dataset.id)
        .all()
    )
    status_counts = Counter(r.status for r in repairs)
    repair_summary = {
        "total": len(repairs),
        "pending": status_counts.get("pending", 0),
        "approved": status_counts.get("approved", 0),
        "rejected": status_counts.get("rejected", 0),
        "undone": status_counts.get("undone", 0),
    }

    deterministic_applied = sum(
        1
        for r in repairs
        if r.status == "approved"
        and (
            r.approval_type in ("deterministic_approved", "auto_applied")
            or (r.approval_type is None and r.can_auto_apply)
        )
    )
    auto_applied = sum(
        1 for r in repairs if r.status == "approved" and r.approval_type == "auto_applied"
    )
    manually_approved = sum(
        1
        for r in repairs
        if r.status == "approved"
        and (
            r.approval_type == "manual_override"
            or (r.approval_type is None and not r.can_auto_apply)
        )
    )
    manual_review_pending = sum(
        1
        for r in repairs
        if r.status in ("pending", "undone") and r.safety_category == "human_review_required"
    )
    unresolved_count = sum(
        1
        for r in repairs
        if r.status in ("pending", "undone") and r.safety_category == "unresolved"
    )
    provenance_breakdown = {
        "deterministic_applied": deterministic_applied,
        "auto_applied": auto_applied,
        "manually_approved": manually_approved,
        "rejected": status_counts.get("rejected", 0),
        "manual_review_pending": manual_review_pending,
        "unresolved": unresolved_count,
        "unresolved_pending": status_counts.get("pending", 0),
        "undone": status_counts.get("undone", 0),
    }

    audit_logs = (
        db.query(AuditLog)
        .filter(AuditLog.dataset_id == dataset.id)
        .order_by(AuditLog.created_at.asc())
        .all()
    )
    history = [
        {
            "audit_id": entry.id,
            "dataset_id": entry.dataset_id,
            "repair_id": entry.repair_id,
            "action": entry.action,
            "details": loads_safe(entry.details_json, default={}),
            "created_at": entry.created_at,
        }
        for entry in audit_logs
    ]

    return {
        "dataset_id": dataset.id,
        "original_filename": dataset.original_filename,
        "status": dataset.status,
        "generated_at": utc_now(),
        "repair_summary": repair_summary,
        "provenance_breakdown": provenance_breakdown,
        "validation": validation,
        "current_profile": current_profile,
        "modification_history": history,
    }


def export_working_dataset(
    db: Session, dataset: Dataset, export_format: str
) -> tuple[Path, str, str, int, int]:
    """
    Validate data integrity and export the complete current working dataset
    for THIS exact dataset_id to CSV or JSON under exports/.

    Returns:
        (export_path, media_type, download_filename, row_count, column_count)
    """
    fmt = export_format.strip().lower()
    if fmt not in ("csv", "json"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported export format '{export_format}'. Supported formats: csv, json.",
        )

    # Deterministically rebuild working copy from this dataset's immutable original file
    # and only this dataset's approved repairs so stale or mismatched files cannot be exported.
    df = rebuild_working_dataset(db, dataset)
    db.flush()

    validation, _ = validate_dataset(db, dataset)
    if not validation["all_integrity_checks_passed"]:
        failed = [c["name"] for c in validation["integrity_checks"] if not c["passed"]]
        raise HTTPException(
            status_code=409,
            detail=f"Pre-export data integrity validation failed: {', '.join(failed)}.",
        )

    stem = Path(dataset.original_filename).stem
    settings.EXPORT_DIR.mkdir(parents=True, exist_ok=True)

    if fmt == "csv":
        export_filename = f"{dataset.id}_{stem}_cleaned.csv"
        export_path = settings.EXPORT_DIR / export_filename
        df.to_csv(export_path, index=False, encoding="utf-8")
        media_type = "text/csv; charset=utf-8"
    else:
        export_filename = f"{dataset.id}_{stem}_cleaned.json"
        export_path = settings.EXPORT_DIR / export_filename
        records = dataframe_to_records(df)
        export_path.write_text(json.dumps(records, indent=2, ensure_ascii=False), encoding="utf-8")
        media_type = "application/json; charset=utf-8"

    row_count = int(len(df))
    column_count = int(len(df.columns))

    audit = AuditLog(
        id=f"aud_{uuid.uuid4().hex[:12]}",
        dataset_id=dataset.id,
        repair_id=None,
        action="dataset_exported",
        details_json=dumps_safe(
            {
                "dataset_id": dataset.id,
                "format": fmt,
                "export_filename": export_filename,
                "row_count": row_count,
                "column_count": column_count,
                "integrity_checks_passed": True,
            }
        ),
    )
    db.add(audit)
    db.commit()

    return export_path, media_type, export_filename, row_count, column_count
