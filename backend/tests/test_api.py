"""End-to-end automated tests for DATAFIX AI backend."""

from __future__ import annotations

import io
import json
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.database import Base, get_db
from app.main import app

SAMPLE_CSV_PATH = Path(__file__).resolve().parent / "messy_sample.csv"


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Provide an isolated TestClient with temporary SQLite DB, uploads, and exports."""
    db_file = tmp_path / "test_datafix.db"
    test_engine = create_engine(
        f"sqlite:///{db_file.as_posix()}",
        connect_args={"check_same_thread": False},
        future=True,
    )
    TestingSessionLocal = sessionmaker(
        autocommit=False, autoflush=False, bind=test_engine, future=True
    )
    Base.metadata.create_all(bind=test_engine)

    uploads_dir = tmp_path / "uploads"
    exports_dir = tmp_path / "exports"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    exports_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(settings, "UPLOAD_DIR", uploads_dir)
    monkeypatch.setattr(settings, "EXPORT_DIR", exports_dir)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()
    test_engine.dispose()


def test_health_and_cors(client: TestClient):
    resp = client.get("/health", headers={"Origin": "http://localhost:5174"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert resp.headers.get("access-control-allow-origin") == "http://localhost:5174"


def test_upload_validation_errors(client: TestClient):
    # Unsupported extension
    resp = client.post(
        "/api/upload",
        files={"file": ("notes.txt", b"hello world", "text/plain")},
    )
    assert resp.status_code == 400

    # Empty CSV
    resp_empty = client.post(
        "/api/upload",
        files={"file": ("empty.csv", b"", "text/csv")},
    )
    assert resp_empty.status_code == 400


def test_xlsx_upload_support(client: TestClient):
    df = pd.DataFrame(
        {
            "id": [1, 2],
            "name": ["Alice", "Bob"],
            "status": ["Active", "active"],
        }
    )
    buf = io.BytesIO()
    df.to_excel(buf, index=False, engine="openpyxl")
    buf.seek(0)

    resp = client.post(
        "/api/upload",
        files={
            "file": (
                "sample.xlsx",
                buf.getvalue(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["dataset"]["file_extension"] == ".xlsx"
    assert data["dataset"]["row_count"] == 2
    assert data["dataset"]["column_count"] == 3


def test_full_end_to_end_workflow(client: TestClient):
    # 1. Upload messy CSV
    original_bytes = SAMPLE_CSV_PATH.read_bytes()
    upload_resp = client.post(
        "/api/upload",
        files={"file": ("messy_sample.csv", original_bytes, "text/csv")},
    )
    assert upload_resp.status_code == 201
    upload_data = upload_resp.json()
    dataset_id = upload_data["dataset"]["dataset_id"]

    assert upload_data["dataset"]["row_count"] == 10
    assert upload_data["dataset"]["column_count"] == 8
    assert upload_data["profile"]["duplicate_row_count"] == 1
    assert upload_data["profile"]["total_missing_cells"] == 2
    assert len(upload_data["preview_rows"]) == 10

    # 2. List datasets & get dataset detail
    list_resp = client.get("/api/datasets")
    assert list_resp.status_code == 200
    assert any(d["dataset_id"] == dataset_id for d in list_resp.json())

    detail_resp = client.get(f"/api/datasets/{dataset_id}?limit=5&offset=0")
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert len(detail["preview_rows"]) == 5
    assert detail["has_analysis"] is False

    # 3. Analyze dataset
    analyze_resp = client.post(f"/api/analyze/{dataset_id}")
    assert analyze_resp.status_code == 200
    analysis = analyze_resp.json()
    assert analysis["total_issues"] > 0

    detected_types = set(analysis["issues_by_type"].keys())
    assert "missing_value" in detected_types
    assert "duplicate_record" in detected_types
    assert "invalid_format" in detected_types
    assert "inconsistent_category" in detected_types
    assert "statistical_anomaly" in detected_types

    # GET analysis matches
    get_analysis_resp = client.get(f"/api/analysis/{dataset_id}")
    assert get_analysis_resp.status_code == 200
    assert get_analysis_resp.json()["analysis_id"] == analysis["analysis_id"]

    # 4. List repair suggestions
    repairs_resp = client.get(f"/api/repairs/{dataset_id}")
    assert repairs_resp.status_code == 200
    repairs_data = repairs_resp.json()
    repairs = repairs_data["repairs"]
    assert len(repairs) == analysis["total_issues"]

    # Verify missing values NEVER silently invent values and have confidence=None
    missing_repairs = [r for r in repairs if r["issue_type"] == "missing_value"]
    assert len(missing_repairs) == 2
    for mr in missing_repairs:
        assert mr["after_value"] is None
        assert mr["confidence"] is None
        assert mr["can_auto_apply"] is False

    # Approving a missing value without custom_value must fail with 400
    fail_approve = client.post(f"/api/repairs/{missing_repairs[0]['repair_id']}/approve")
    assert fail_approve.status_code == 400

    # Approving a missing value WITH explicit custom_value (no mandatory justification) succeeds
    custom_approve = client.post(
        f"/api/repairs/{missing_repairs[0]['repair_id']}/approve",
        json={"custom_value": "david@example.com"},
    )
    assert custom_approve.status_code == 200
    assert custom_approve.json()["repair"]["status"] == "approved"
    assert custom_approve.json()["repair"]["applied_value"] == "david@example.com"
    assert custom_approve.json()["repair"]["approval_type"] == "manual_override"

    # 5. Approve auto-applicable repairs (duplicate, inconsistent categories, fixable formats)
    auto_repairs = [r for r in repairs if r["can_auto_apply"]]
    assert len(auto_repairs) >= 5
    for rep in auto_repairs:
        assert rep["confidence"] is not None
        resp = client.post(f"/api/repairs/{rep['repair_id']}/approve")
        assert resp.status_code == 200
        assert resp.json()["repair"]["status"] == "approved"

    # Duplicate row removal should reduce row count from 10 to 9
    after_detail = client.get(f"/api/datasets/{dataset_id}").json()
    assert after_detail["row_count"] == 9

    # 6. Reject a statistical anomaly suggestion
    anomaly_repairs = [r for r in repairs if r["issue_type"] == "statistical_anomaly"]
    assert len(anomaly_repairs) >= 1
    reject_resp = client.post(
        f"/api/repairs/{anomaly_repairs[0]['repair_id']}/reject",
        json={"reason": "Will verify with HR before modifying."},
    )
    assert reject_resp.status_code == 200
    assert reject_resp.json()["repair"]["status"] == "rejected"
    assert reject_resp.json()["repair"]["rejection_reason"] == "Will verify with HR before modifying."

    # 7. Undo the duplicate row removal and verify row count returns to 10
    dup_repair = next(r for r in repairs if r["repair_action"] == "drop_duplicate_row")
    undo_resp = client.post(f"/api/repairs/{dup_repair['repair_id']}/undo")
    assert undo_resp.status_code == 200
    assert undo_resp.json()["repair"]["status"] == "undone"
    assert undo_resp.json()["current_row_count"] == 10

    # Re-approve duplicate removal so final exported dataset is deduplicated
    reapprove_resp = client.post(f"/api/repairs/{dup_repair['repair_id']}/approve")
    assert reapprove_resp.status_code == 200
    assert reapprove_resp.json()["current_row_count"] == 9

    # 8. Validation report
    report_resp = client.get(f"/api/reports/{dataset_id}")
    assert report_resp.status_code == 200
    report = report_resp.json()
    val = report["validation"]

    assert val["before_row_count"] == 10
    assert val["after_row_count"] == 9
    assert val["after_issue_count"] < val["before_issue_count"]
    assert val["issues_resolved"] > 0
    assert val["after_quality_score"] > val["before_quality_score"]
    assert val["all_integrity_checks_passed"] is True
    assert len(report["modification_history"]) >= 4

    # Verify original uploaded file was never modified
    original_saved = settings.UPLOAD_DIR / dataset_id / "original.csv"
    assert original_saved.read_bytes() == original_bytes

    # 9. Export CSV and JSON
    csv_export = client.get(f"/api/export/{dataset_id}?format=csv")
    assert csv_export.status_code == 200
    assert "text/csv" in csv_export.headers["content-type"]
    exported_df = pd.read_csv(io.StringIO(csv_export.text))
    assert len(exported_df) == 9

    json_export = client.get(f"/api/export/{dataset_id}?format=json")
    assert json_export.status_code == 200
    exported_records = json.loads(json_export.text)
    assert isinstance(exported_records, list)
    assert len(exported_records) == 9

    # Verify specific repaired values in exported records
    carol = next(r for r in exported_records if str(r["employee_id"]) == "1003")
    assert carol["full_name"] == "Carol White"
    assert carol["email"] == "carol@example.com"
    assert carol["status"] == "Active"
    assert carol["salary"] == "72000"
    assert carol["join_date"] == "2024-04-01"

    david = next(r for r in exported_records if str(r["employee_id"]) == "1004")
    assert david["email"] == "david@example.com"
    assert david["status"] == "Active"


def test_not_found_and_invalid_export_format(client: TestClient):
    assert client.get("/api/datasets/ds_nonexistent").status_code == 404
    assert client.post("/api/analyze/ds_nonexistent").status_code == 404
    assert client.get("/api/analysis/ds_nonexistent").status_code == 404
    assert client.get("/api/repairs/ds_nonexistent").status_code == 404
    assert client.post("/api/repairs/rep_nonexistent/approve").status_code == 404
    assert client.post("/api/repairs/rep_nonexistent/reject").status_code == 404
    assert client.post("/api/repairs/rep_nonexistent/undo").status_code == 404
    assert client.get("/api/reports/ds_nonexistent").status_code == 404

    upload_resp = client.post(
        "/api/upload",
        files={"file": ("tiny.csv", b"a,b\n1,2\n", "text/csv")},
    )
    ds_id = upload_resp.json()["dataset"]["dataset_id"]
    assert client.get(f"/api/export/{ds_id}?format=xml").status_code == 400


def test_sequential_uploads_export_active_dataset_and_repair_safety(client: TestClient):
    """Regression test for ISSUE 1 (wrong dataset exported) & ISSUE 2 (strict repair safety)."""
    # Upload Dataset 1: 12 rows, Order IDs 1001-1012
    rows_1 = ["order_id,customer,email,region,amount,order_date,status"]
    for i in range(1, 13):
        rows_1.append(f"{1000 + i},Cust {i},cust{i}@example.com,North,2500.0,2026-01-{i:02d},Active")
    csv_1 = ("\n".join(rows_1) + "\n").encode("utf-8")

    up1 = client.post("/api/upload", files={"file": ("orders_12.csv", csv_1, "text/csv")})
    assert up1.status_code == 201
    ds1_id = up1.json()["dataset"]["dataset_id"]
    assert up1.json()["dataset"]["row_count"] == 12

    # Upload Dataset 2: 32 rows, Order IDs 2001-2032, with missing email, missing amount, negative amount
    rows_2 = ["order_id,customer,email,region,amount,order_date,status"]
    for i in range(1, 33):
        email = "" if i == 4 else f"user{i}@example.com"
        amount = "" if i == 7 else ("-450.0" if i == 12 else "2500.0")
        region = " south " if i == 5 else "South"
        rows_2.append(f"{2000 + i},Buyer {i},{email},{region},{amount},2026-02-{(i % 28) + 1:02d},Active")
    csv_2 = ("\n".join(rows_2) + "\n").encode("utf-8")

    up2 = client.post("/api/upload", files={"file": ("orders_32.csv", csv_2, "text/csv")})
    assert up2.status_code == 201
    ds2_id = up2.json()["dataset"]["dataset_id"]
    assert ds2_id != ds1_id
    assert up2.json()["dataset"]["row_count"] == 32
    assert up2.json()["dataset"]["column_count"] == 7

    # Analyze Dataset 2
    ana2 = client.post(f"/api/analyze/{ds2_id}")
    assert ana2.status_code == 200

    repairs2 = client.get(f"/api/repairs/{ds2_id}").json()["repairs"]
    # Valid decimal amounts like "2500.0" must NOT be flagged as invalid_format
    assert not any(
        r["column_name"] == "amount" and r["issue_type"] == "invalid_format"
        for r in repairs2
    )
    # Missing email, missing amount, and negative amount must all be human_review_required with can_auto_apply=False
    for r in repairs2:
        if r["column_name"] in ("email", "amount"):
            assert r["can_auto_apply"] is False
            assert r["after_value"] is None
            assert r["confidence"] is None
            assert r["repair_method"] == "human_review_required"

    # Approve ONLY the deterministic region whitespace/case normalization
    region_repairs = [r for r in repairs2 if r["can_auto_apply"]]
    assert len(region_repairs) == 1
    assert client.post(f"/api/repairs/{region_repairs[0]['repair_id']}/approve").status_code == 200

    # Export Dataset 2 and verify headers, exact row count, column count, Order IDs 2001-2032, and untouched uncertain values
    exp2 = client.get(f"/api/export/{ds2_id}?format=csv")
    assert exp2.status_code == 200
    assert exp2.headers.get("x-dataset-id") == ds2_id
    assert exp2.headers.get("x-row-count") == "32"
    assert exp2.headers.get("x-column-count") == "7"
    assert "no-store" in (exp2.headers.get("cache-control") or "")

    df_exp = pd.read_csv(io.StringIO(exp2.text), dtype=str, keep_default_na=False)
    assert len(df_exp) == 32
    assert len(df_exp.columns) == 7
    assert df_exp["order_id"].iloc[0] == "2001"
    assert df_exp["order_id"].iloc[-1] == "2032"
    # Verify missing email was NOT invented, missing amount was NOT replaced with 100, and -450.0 was NOT flipped to +450
    assert df_exp.loc[df_exp["order_id"] == "2004", "email"].iloc[0] == ""
    assert df_exp.loc[df_exp["order_id"] == "2007", "amount"].iloc[0] == ""
    assert df_exp.loc[df_exp["order_id"] == "2012", "amount"].iloc[0] == "-450.0"
    assert df_exp.loc[df_exp["order_id"] == "2005", "region"].iloc[0] == "South"

    # Verify report provenance breakdown distinguishes deterministic vs manual vs unresolved
    rep2 = client.get(f"/api/reports/{ds2_id}").json()
    assert rep2["provenance_breakdown"]["deterministic_applied"] == 1
    assert rep2["provenance_breakdown"]["manually_approved"] == 0
    assert rep2["provenance_breakdown"]["unresolved_pending"] >= 3


