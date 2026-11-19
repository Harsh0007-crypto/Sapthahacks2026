"""Repair suggestion listing, approval, rejection, and undo endpoints."""

from __future__ import annotations

from collections import Counter

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Dataset, RepairSuggestion
from app.schemas import (
    AutoCleanRequest,
    AutoCleanResponse,
    RepairApproveRequest,
    RepairDecisionResponse,
    RepairRejectRequest,
    RepairsListResponse,
)
from app.services.detector import detect_issues
from app.services.repair_engine import (
    approve_repair,
    reject_repair,
    run_autonomous_cleaning,
    serialize_repair,
    undo_repair,
)

router = APIRouter(prefix="/api", tags=["Repairs"])


@router.post("/clean/{dataset_id}", response_model=AutoCleanResponse)
def auto_clean_dataset(
    dataset_id: str,
    payload: AutoCleanRequest | None = Body(default=None),
    db: Session = Depends(get_db),
) -> AutoCleanResponse:
    """
    Run one-click autonomous cleaning: detect issues, classify by repair safety,
    automatically apply safe deterministic repairs, keep uncertain issues in manual review,
    preserve unresolved values, validate changes, and return the updated quality report.
    """
    remove_duplicates = payload.remove_duplicates if payload is not None else True
    result = run_autonomous_cleaning(db, dataset_id, remove_duplicates=remove_duplicates)
    return AutoCleanResponse(**result)


@router.get("/repairs/{dataset_id}", response_model=RepairsListResponse)
def list_repairs(
    dataset_id: str,
    status: str | None = Query(
        default=None,
        description="Optional filter by status: pending, approved, rejected, undone",
    ),
    issue_type: str | None = Query(
        default=None,
        description="Optional filter by issue_type",
    ),
    db: Session = Depends(get_db),
) -> RepairsListResponse:
    """List repair suggestions for a dataset with optional status and issue_type filters."""
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' not found.")

    all_repairs = (
        db.query(RepairSuggestion)
        .filter(RepairSuggestion.dataset_id == dataset_id)
        .order_by(RepairSuggestion.row_index.asc(), RepairSuggestion.created_at.asc())
        .all()
    )
    status_counts = Counter(r.status for r in all_repairs)
    counts_by_status = {
        "pending": status_counts.get("pending", 0),
        "approved": status_counts.get("approved", 0),
        "rejected": status_counts.get("rejected", 0),
        "undone": status_counts.get("undone", 0),
    }

    filtered = all_repairs
    if status:
        filtered = [r for r in filtered if r.status == status.strip().lower()]
    if issue_type:
        filtered = [r for r in filtered if r.issue_type == issue_type.strip().lower()]

    return RepairsListResponse(
        dataset_id=dataset_id,
        total=len(filtered),
        counts_by_status=counts_by_status,
        repairs=[serialize_repair(r) for r in filtered],
    )


@router.post("/repairs/{repair_id}/approve", response_model=RepairDecisionResponse)
def approve_repair_endpoint(
    repair_id: str,
    payload: RepairApproveRequest | None = Body(default=None),
    db: Session = Depends(get_db),
) -> RepairDecisionResponse:
    """Explicitly approve and apply a repair suggestion to the working dataset."""
    custom_value = payload.custom_value if payload is not None else None
    justification = payload.justification if payload is not None else None
    repair, working_df = approve_repair(
        db, repair_id, custom_value=custom_value, justification=justification
    )
    current_detection = detect_issues(working_df)

    return RepairDecisionResponse(
        message="Repair approved and applied to working dataset.",
        repair=serialize_repair(repair),
        current_row_count=int(len(working_df)),
        current_issue_count=int(current_detection["total_issues"]),
    )


@router.post("/repairs/{repair_id}/reject", response_model=RepairDecisionResponse)
def reject_repair_endpoint(
    repair_id: str,
    payload: RepairRejectRequest | None = Body(default=None),
    db: Session = Depends(get_db),
) -> RepairDecisionResponse:
    """Explicitly reject a repair suggestion without applying it."""
    reason = payload.reason if payload is not None else None
    repair, working_df = reject_repair(db, repair_id, reason=reason)
    current_detection = detect_issues(working_df)

    return RepairDecisionResponse(
        message="Repair suggestion rejected.",
        repair=serialize_repair(repair),
        current_row_count=int(len(working_df)),
        current_issue_count=int(current_detection["total_issues"]),
    )


@router.post("/repairs/{repair_id}/undo", response_model=RepairDecisionResponse)
def undo_repair_endpoint(
    repair_id: str,
    db: Session = Depends(get_db),
) -> RepairDecisionResponse:
    """Undo a previously approved or rejected repair and rebuild the working dataset."""
    repair, working_df = undo_repair(db, repair_id)
    current_detection = detect_issues(working_df)

    return RepairDecisionResponse(
        message="Repair decision undone and working dataset restored.",
        repair=serialize_repair(repair),
        current_row_count=int(len(working_df)),
        current_issue_count=int(current_detection["total_issues"]),
    )
