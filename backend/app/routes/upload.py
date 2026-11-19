"""Upload and dataset inspection endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import AnalysisResult, AuditLog, Dataset, RepairSuggestion
from app.schemas import DatasetDetailResponse, DatasetSummary, UploadResponse
from app.services.file_processor import load_dataframe, process_uploaded_file
from app.services.profiler import profile_dataframe
from app.utils.helpers import dataframe_to_records, dumps_safe, loads_safe

router = APIRouter(prefix="/api", tags=["Datasets & Upload"])


def _dataset_to_summary(dataset: Dataset) -> DatasetSummary:
    return DatasetSummary(
        dataset_id=dataset.id,
        original_filename=dataset.original_filename,
        file_extension=dataset.file_extension,
        file_size_bytes=dataset.file_size_bytes,
        row_count=dataset.row_count,
        column_count=dataset.column_count,
        columns=loads_safe(dataset.columns_json, default=[]),
        status=dataset.status,
        created_at=dataset.created_at,
        updated_at=dataset.updated_at,
    )


@router.post("/upload", response_model=UploadResponse, status_code=201)
async def upload_dataset(
    file: UploadFile = File(..., description="CSV, XLSX, or XLS dataset file"),
    db: Session = Depends(get_db),
) -> UploadResponse:
    """Upload a dataset file, preserve the original copy, profile it, and persist metadata."""
    (
        dataset_id,
        safe_name,
        ext,
        file_size,
        original_path,
        working_path,
        df,
    ) = await process_uploaded_file(file)

    profile = profile_dataframe(df)
    columns = [str(c) for c in df.columns]

    dataset = Dataset(
        id=dataset_id,
        original_filename=safe_name,
        file_extension=ext,
        file_size_bytes=file_size,
        original_file_path=str(original_path),
        working_file_path=str(working_path),
        row_count=profile["row_count"],
        column_count=profile["column_count"],
        columns_json=dumps_safe(columns),
        profile_json=dumps_safe(profile),
        status="uploaded",
    )
    db.add(dataset)

    audit = AuditLog(
        id=f"aud_{uuid.uuid4().hex[:12]}",
        dataset_id=dataset_id,
        repair_id=None,
        action="dataset_uploaded",
        details_json=dumps_safe(
            {
                "original_filename": safe_name,
                "file_extension": ext,
                "file_size_bytes": file_size,
                "row_count": profile["row_count"],
                "column_count": profile["column_count"],
            }
        ),
    )
    db.add(audit)
    db.commit()
    db.refresh(dataset)

    preview_rows = dataframe_to_records(df, limit=settings.PREVIEW_ROW_LIMIT, offset=0)

    return UploadResponse(
        message="Dataset uploaded and profiled successfully.",
        dataset=_dataset_to_summary(dataset),
        profile=profile,
        preview_rows=preview_rows,
    )


@router.get("/datasets", response_model=list[DatasetSummary])
def list_datasets(db: Session = Depends(get_db)) -> list[DatasetSummary]:
    """List all uploaded datasets ordered from newest to oldest."""
    datasets = db.query(Dataset).order_by(Dataset.created_at.desc()).all()
    return [_dataset_to_summary(ds) for ds in datasets]


@router.get("/datasets/{dataset_id}", response_model=DatasetDetailResponse)
def get_dataset(
    dataset_id: str,
    limit: int = Query(default=50, ge=1, le=500, description="Number of preview rows to return"),
    offset: int = Query(default=0, ge=0, description="Row offset for preview pagination"),
    db: Session = Depends(get_db),
) -> DatasetDetailResponse:
    """Retrieve metadata, current profile, and paginated record preview for a dataset."""
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' not found.")

    df = load_dataframe(dataset.working_file_path, ".csv")
    profile = loads_safe(dataset.profile_json) or profile_dataframe(df)
    preview_rows = dataframe_to_records(df, limit=limit, offset=offset)

    has_analysis = (
        db.query(AnalysisResult).filter(AnalysisResult.dataset_id == dataset_id).first() is not None
    )
    approved_count = (
        db.query(RepairSuggestion)
        .filter(RepairSuggestion.dataset_id == dataset_id, RepairSuggestion.status == "approved")
        .count()
    )
    pending_count = (
        db.query(RepairSuggestion)
        .filter(RepairSuggestion.dataset_id == dataset_id, RepairSuggestion.status == "pending")
        .count()
    )

    summary = _dataset_to_summary(dataset)
    return DatasetDetailResponse(
        **summary.model_dump(),
        profile=profile,
        preview_rows=preview_rows,
        preview_limit=limit,
        preview_offset=offset,
        has_analysis=has_analysis,
        approved_repairs_count=approved_count,
        pending_repairs_count=pending_count,
    )
