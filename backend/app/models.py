"""SQLAlchemy ORM models for datasets, analysis results, repairs, and audit history."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.utils.helpers import utc_now


class Dataset(Base):
    """Stores metadata and storage paths for an uploaded dataset."""

    __tablename__ = "datasets"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, index=True)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_extension: Mapped[str] = mapped_column(String(16), nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    original_file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    working_file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    row_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    column_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    columns_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    profile_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="uploaded")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    analyses: Mapped[list[AnalysisResult]] = relationship(
        "AnalysisResult", back_populates="dataset", cascade="all, delete-orphan"
    )
    repairs: Mapped[list[RepairSuggestion]] = relationship(
        "RepairSuggestion", back_populates="dataset", cascade="all, delete-orphan"
    )
    audit_logs: Mapped[list[AuditLog]] = relationship(
        "AuditLog", back_populates="dataset", cascade="all, delete-orphan"
    )


class AnalysisResult(Base):
    """Stores the results of a deterministic quality analysis run."""

    __tablename__ = "analysis_results"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, index=True)
    dataset_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    total_issues: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    issues_by_type_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    issues_by_severity_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    quality_score: Mapped[float] = mapped_column(Float, nullable=False, default=100.0)
    issues_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    profile_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    dataset: Mapped[Dataset] = relationship("Dataset", back_populates="analyses")
    repairs: Mapped[list[RepairSuggestion]] = relationship(
        "RepairSuggestion", back_populates="analysis", cascade="all, delete-orphan"
    )


class RepairSuggestion(Base):
    """Stores an individual repair suggestion and its human-in-the-loop decision state."""

    __tablename__ = "repair_suggestions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, index=True)
    dataset_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    analysis_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("analysis_results.id", ondelete="CASCADE"), nullable=False, index=True
    )
    issue_type: Mapped[str] = mapped_column(String(64), nullable=False)
    repair_action: Mapped[str] = mapped_column(String(64), nullable=False)
    safety_category: Mapped[str] = mapped_column(String(64), nullable=False, default="human_review_required")
    repair_method: Mapped[str] = mapped_column(String(64), nullable=False, default="human_review_required")
    approval_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    row_index: Mapped[int] = mapped_column(Integer, nullable=False)
    record_identifier: Mapped[str | None] = mapped_column(String(255), nullable=True)
    column_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    before_value_json: Mapped[str] = mapped_column(Text, nullable=False, default="null")
    after_value_json: Mapped[str] = mapped_column(Text, nullable=False, default="null")
    applied_value_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    explanation: Mapped[str] = mapped_column(Text, nullable=False)
    uncertainty_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    justification: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    can_auto_apply: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    dataset: Mapped[Dataset] = relationship("Dataset", back_populates="repairs")
    analysis: Mapped[AnalysisResult] = relationship("AnalysisResult", back_populates="repairs")


class AuditLog(Base):
    """Immutable modification and event history for a dataset."""

    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, index=True)
    dataset_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    repair_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    details_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    dataset: Mapped[Dataset] = relationship("Dataset", back_populates="audit_logs")
