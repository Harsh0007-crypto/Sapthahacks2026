"""Validation report and dataset export endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Dataset
from app.schemas import ReportResponse
from app.services.report_generator import export_working_dataset, generate_dataset_report

router = APIRouter(prefix="/api", tags=["Reports & Export"])


@router.get("/reports/{dataset_id}", response_model=ReportResponse)
def get_report(dataset_id: str, db: Session = Depends(get_db)) -> ReportResponse:
    """Generate a before/after validation report, integrity checks, and modification history."""
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' not found.")

    report = generate_dataset_report(db, dataset)
    return ReportResponse(**report)


@router.get("/export/{dataset_id}")
def export_dataset(
    dataset_id: str,
    format: str = Query(default="csv", description="Export format: 'csv' or 'json'"),
    db: Session = Depends(get_db),
) -> FileResponse:
    """Validate integrity and export the complete working dataset as CSV or JSON."""
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' not found.")

    (
        export_path,
        media_type,
        download_filename,
        row_count,
        column_count,
    ) = export_working_dataset(db, dataset, format)
    return FileResponse(
        path=str(export_path),
        media_type=media_type,
        filename=download_filename,
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "X-Dataset-Id": dataset.id,
            "X-Row-Count": str(row_count),
            "X-Column-Count": str(column_count),
        },
    )
