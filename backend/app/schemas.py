"""Pydantic request and response schemas for DATAFIX AI API."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ErrorResponse(BaseModel):
    status_code: int
    error_code: str
    detail: Any


class HealthResponse(BaseModel):
    status: str = "ok"
    app_name: str
    version: str
    database: str = "connected"


class ColumnProfile(BaseModel):
    name: str
    inferred_type: str
    pandas_dtype: str
    non_null_count: int
    missing_count: int
    missing_percentage: float
    unique_count: int
    sample_values: list[Any] = Field(default_factory=list)
    stats: dict[str, Any] | None = None


class DatasetProfile(BaseModel):
    row_count: int
    column_count: int
    total_cells: int
    total_missing_cells: int
    missing_percentage: float
    duplicate_row_count: int
    columns: list[ColumnProfile]


class DatasetSummary(BaseModel):
    dataset_id: str
    original_filename: str
    file_extension: str
    file_size_bytes: int
    row_count: int
    column_count: int
    columns: list[str]
    status: str
    created_at: datetime
    updated_at: datetime


class DatasetDetailResponse(DatasetSummary):
    profile: DatasetProfile
    preview_rows: list[dict[str, Any]]
    preview_limit: int
    preview_offset: int
    has_analysis: bool
    approved_repairs_count: int
    pending_repairs_count: int


class UploadResponse(BaseModel):
    message: str
    dataset: DatasetSummary
    profile: DatasetProfile
    preview_rows: list[dict[str, Any]]


class DetectedIssue(BaseModel):
    issue_id: str
    issue_type: str
    severity: str
    row_index: int
    column_name: str | None = None
    value: Any = None
    description: str
    rule: str


class AnalysisResponse(BaseModel):
    analysis_id: str
    dataset_id: str
    total_issues: int
    quality_score: float
    issues_by_type: dict[str, int]
    issues_by_severity: dict[str, int]
    issues: list[DetectedIssue]
    profile: DatasetProfile
    repair_suggestions_count: int
    created_at: datetime


class RepairSuggestionSchema(BaseModel):
    repair_id: str
    dataset_id: str
    analysis_id: str
    issue_type: str
    repair_action: str
    safety_category: str
    repair_method: str
    approval_type: str | None = None
    row_index: int
    record_identifier: str | None = None
    column_name: str | None = None
    before_value: Any = None
    after_value: Any = None
    applied_value: Any = None
    explanation: str
    uncertainty_note: str | None = None
    justification: str | None = None
    confidence: float | None = None
    can_auto_apply: bool
    status: str
    display_status: str = "Not Fixed Yet"
    rejection_reason: str | None = None
    applied_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class RepairsListResponse(BaseModel):
    dataset_id: str
    total: int
    counts_by_status: dict[str, int]
    repairs: list[RepairSuggestionSchema]


class RepairApproveRequest(BaseModel):
    custom_value: Any | None = Field(
        default=None,
        description=(
            "Optional explicit replacement value supplied by the user. "
            "Required when approving flagged issues that do not have an automatic replacement "
            "(such as missing values or statistical anomalies)."
        ),
    )
    justification: str | None = Field(
        default=None,
        description="Optional note or explanation for a manual replacement value.",
    )


class RepairRejectRequest(BaseModel):
    reason: str | None = Field(default=None, description="Optional reason for rejecting the repair.")


class RepairDecisionResponse(BaseModel):
    message: str
    repair: RepairSuggestionSchema
    current_row_count: int
    current_issue_count: int


class IntegrityCheck(BaseModel):
    name: str
    passed: bool
    details: str


class ValidationComparison(BaseModel):
    before_row_count: int
    after_row_count: int
    before_column_count: int
    after_column_count: int
    before_issue_count: int
    after_issue_count: int
    issues_resolved: int
    before_issues_by_type: dict[str, int]
    after_issues_by_type: dict[str, int]
    before_quality_score: float
    after_quality_score: float
    quality_score_delta: float
    integrity_checks: list[IntegrityCheck]
    all_integrity_checks_passed: bool


class AuditLogEntry(BaseModel):
    audit_id: str
    dataset_id: str
    repair_id: str | None = None
    action: str
    details: dict[str, Any]
    created_at: datetime


class ReportResponse(BaseModel):
    dataset_id: str
    original_filename: str
    status: str
    generated_at: datetime
    repair_summary: dict[str, int]
    provenance_breakdown: dict[str, int] = Field(default_factory=dict)
    validation: ValidationComparison
    current_profile: DatasetProfile
    modification_history: list[AuditLogEntry]


class AutoCleanRequest(BaseModel):
    remove_duplicates: bool = Field(
        default=True,
        description="Whether exact duplicate rows may be removed automatically during autonomous cleaning.",
    )


class AutoCleanResponse(BaseModel):
    dataset_id: str
    message: str
    safe_repairs_applied: int
    manual_review_count: int
    unresolved_count: int
    before_quality_score: float
    after_quality_score: float
    before_issue_count: int
    after_issue_count: int
    validation: ValidationComparison
    report: ReportResponse
