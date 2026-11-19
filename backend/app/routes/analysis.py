"""Data quality analysis endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AnalysisResult, AuditLog, Dataset, RepairSuggestion
from app.schemas import AnalysisResponse
from app.services.detector import detect_issues
from app.services.file_processor import load_dataframe
from app.services.profiler import profile_dataframe
from app.services.repair_engine import build_repair_suggestions
from app.utils.helpers import dumps_safe, loads_safe, utc_now

router = APIRouter(prefix="/api", tags=["Analysis"])


def _strip_issue_meta(issues: list[dict]) -> list[dict]:
    """Return public issue dicts without internal repair-builder metadata."""
    cleaned = []
    for item in issues:
        entry = {k: v for k, v in item.items() if k != "meta"}
        cleaned.append(entry)
    return cleaned


@router.post("/analyze/{dataset_id}", response_model=AnalysisResponse)
def analyze_dataset(dataset_id: str, db: Session = Depends(get_db)) -> AnalysisResponse:
    """
    Run deterministic profiling, issue detection, and repair suggestion generation
    on the dataset. Existing pending/undone suggestions from prior runs are replaced.
    """
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' not found.")

    # Always detect against the original immutable dataset when generating fresh
    # row-indexed repair suggestions so repair row indices align with deterministic replay.
    original_df = load_dataframe(dataset.original_file_path, dataset.file_extension)
    profile = profile_dataframe(original_df)
    detection = detect_issues(original_df, profile)

    analysis_id = f"ana_{uuid.uuid4().hex[:12]}"
    public_issues = _strip_issue_meta(detection["issues"])

    analysis = AnalysisResult(
        id=analysis_id,
        dataset_id=dataset_id,
        total_issues=detection["total_issues"],
        issues_by_type_json=dumps_safe(detection["issues_by_type"]),
        issues_by_severity_json=dumps_safe(detection["issues_by_severity"]),
        quality_score=detection["quality_score"],
        issues_json=dumps_safe(public_issues),
        profile_json=dumps_safe(profile),
    )
    db.add(analysis)

    # Clear previous unapplied suggestions if re-analyzing, keeping audit history intact
    db.query(RepairSuggestion).filter(
        RepairSuggestion.dataset_id == dataset_id,
        RepairSuggestion.status.in_(["pending", "undone"]),
    ).delete(synchronize_session=False)

    # Only create suggestions for issues that don't already have an approved/rejected decision
    existing_decided = (
        db.query(RepairSuggestion)
        .filter(
            RepairSuggestion.dataset_id == dataset_id,
            RepairSuggestion.status.in_(["approved", "rejected"]),
        )
        .all()
    )
    decided_keys = {
        (r.issue_type, r.row_index, r.column_name) for r in existing_decided
    }

    suggestions = [
        s
        for s in build_repair_suggestions(dataset_id, analysis_id, detection["issues"], df=original_df)
        if (s.issue_type, s.row_index, s.column_name) not in decided_keys
    ]
    for suggestion in suggestions:
        db.add(suggestion)

    if dataset.status == "uploaded":
        dataset.status = "analyzed"
    dataset.updated_at = utc_now()
    db.add(dataset)

    audit = AuditLog(
        id=f"aud_{uuid.uuid4().hex[:12]}",
        dataset_id=dataset_id,
        repair_id=None,
        action="dataset_analyzed",
        details_json=dumps_safe(
            {
                "analysis_id": analysis_id,
                "total_issues": detection["total_issues"],
                "quality_score": detection["quality_score"],
                "issues_by_type": detection["issues_by_type"],
                "new_repair_suggestions": len(suggestions),
            }
        ),
    )
    db.add(audit)
    db.commit()
    db.refresh(analysis)

    total_repairs = (
        db.query(RepairSuggestion).filter(RepairSuggestion.dataset_id == dataset_id).count()
    )

    return AnalysisResponse(
        analysis_id=analysis.id,
        dataset_id=dataset_id,
        total_issues=analysis.total_issues,
        quality_score=analysis.quality_score,
        issues_by_type=detection["issues_by_type"],
        issues_by_severity=detection["issues_by_severity"],
        issues=public_issues,
        profile=profile,
        repair_suggestions_count=total_repairs,
        created_at=analysis.created_at,
    )


@router.get("/analysis/{dataset_id}", response_model=AnalysisResponse)
def get_analysis(dataset_id: str, db: Session = Depends(get_db)) -> AnalysisResponse:
    """Retrieve the most recent analysis result for a dataset."""
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' not found.")

    analysis = (
        db.query(AnalysisResult)
        .filter(AnalysisResult.dataset_id == dataset_id)
        .order_by(AnalysisResult.created_at.desc())
        .first()
    )
    if not analysis:
        raise HTTPException(
            status_code=404,
            detail=f"No analysis found for dataset '{dataset_id}'. Call POST /api/analyze/{dataset_id} first.",
        )

    total_repairs = (
        db.query(RepairSuggestion).filter(RepairSuggestion.dataset_id == dataset_id).count()
    )

    return AnalysisResponse(
        analysis_id=analysis.id,
        dataset_id=dataset_id,
        total_issues=analysis.total_issues,
        quality_score=analysis.quality_score,
        issues_by_type=loads_safe(analysis.issues_by_type_json, default={}),
        issues_by_severity=loads_safe(analysis.issues_by_severity_json, default={}),
        issues=loads_safe(analysis.issues_json, default=[]),
        profile=loads_safe(analysis.profile_json, default={}),
        repair_suggestions_count=total_repairs,
        created_at=analysis.created_at,
    )
