"""Comprehensive automated regression & E2E test suite for DATAFIX AI Autonomous Repair Engine."""

from __future__ import annotations

import io
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.database import Base, get_db
from app.main import app
from tests.fixtures_generator import COLUMNS, generate_110_record_fixture


@pytest.fixture()
def fixture_110(tmp_path: Path):
    """Generate a reproducible 110-record messy dataset with ground-truth expectations."""
    return generate_110_record_fixture(tmp_path / "messy_110_records.csv")


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Isolated FastAPI TestClient with temporary SQLite DB, uploads, and exports."""
    db_file = tmp_path / "test_autonomous.db"
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


def _upload_fixture(client: TestClient, fixture_meta: dict) -> tuple[str, bytes]:
    raw_bytes = fixture_meta["path"].read_bytes()
    resp = client.post(
        "/api/upload",
        files={"file": ("messy_110_records.csv", raw_bytes, "text/csv")},
    )
    assert resp.status_code == 201
    return resp.json()["dataset"]["dataset_id"], raw_bytes


def test_detection_all_categories_and_accuracy_on_110_records(client: TestClient, fixture_110: dict):
    """Detection: verify all categories, 110x7 dimensions, 0 false positives on clean rows, and exact accuracy."""
    ds_id, _ = _upload_fixture(client, fixture_110)

    detail = client.get(f"/api/datasets/{ds_id}").json()
    assert detail["row_count"] == 110
    assert detail["column_count"] == 7
    assert detail["columns"] == COLUMNS

    ana = client.post(f"/api/analyze/{ds_id}")
    assert ana.status_code == 200
    data = ana.json()

    # All 5 supported issue types detected
    by_type = data["issues_by_type"]
    assert by_type.get("missing_value", 0) == 6
    assert by_type.get("duplicate_record", 0) == 2
    assert by_type.get("invalid_format", 0) == 14  # 3 ws + 3 dates + 2 fixable email + 2 num + 2 bad email + 2 unresolved
    assert by_type.get("inconsistent_category", 0) == 6  # 3 region + 3 status
    assert by_type.get("statistical_anomaly", 0) == 2  # -450 and 950000

    # Zero false positives on the 80 valid clean baseline rows
    flagged_clean_rows = [
        iss for iss in data["issues"] if iss["row_index"] in fixture_110["clean_row_indices"]
    ]
    assert flagged_clean_rows == []

    # Ground-truth precision & recall calculation
    expected_keys = {
        (g["row_index"], g["column_name"], g["issue_type"])
        for g in fixture_110["ground_truth"]
    }
    detected_keys = {
        (i["row_index"], i["column_name"], i["issue_type"])
        for i in data["issues"]
    }
    true_positives = len(expected_keys & detected_keys)
    false_positives = len(detected_keys - expected_keys)
    false_negatives = len(expected_keys - detected_keys)

    assert true_positives == 30
    assert false_positives == 0
    assert false_negatives == 0


def test_autonomous_cleaning_safe_only_and_preserves_uncertain(client: TestClient, fixture_110: dict):
    """Automatic repairs: safe repairs applied automatically; uncertain/missing/negative values preserved."""
    ds_id, _ = _upload_fixture(client, fixture_110)

    clean_resp = client.post(f"/api/clean/{ds_id}", json={"remove_duplicates": True})
    assert clean_resp.status_code == 200
    res = clean_resp.json()

    assert res["safe_repairs_applied"] == fixture_110["expected_safe_auto"] == 18
    assert res["manual_review_count"] == fixture_110["expected_human_review"] == 11
    assert res["unresolved_count"] == fixture_110["expected_unresolved"] == 1
    assert res["after_quality_score"] > res["before_quality_score"]
    assert res["after_issue_count"] < res["before_issue_count"]

    repairs = client.get(f"/api/repairs/{ds_id}").json()["repairs"]
    for r in repairs:
        if r["safety_category"] == "safe_auto_repair":
            assert r["status"] == "approved"
            assert r["approval_type"] == "auto_applied"
            assert r["confidence"] is not None
        else:
            assert r["status"] == "pending"
            assert r["applied_value"] is None
            assert r["confidence"] is None


def test_autonomous_cleaning_preserves_row_count_when_dedup_disabled(client: TestClient, fixture_110: dict):
    """Data integrity: row count is preserved when duplicate removal is not authorized."""
    ds_id, _ = _upload_fixture(client, fixture_110)

    clean_resp = client.post(f"/api/clean/{ds_id}", json={"remove_duplicates": False})
    assert clean_resp.status_code == 200
    res = clean_resp.json()

    assert res["safe_repairs_applied"] == 16  # 18 - 2 duplicates
    assert res["validation"]["after_row_count"] == 110


def test_manual_review_edit_approve_reject_and_undo(client: TestClient, fixture_110: dict):
    """Manual review & undo: optional justification does not block approval; reject and undo work."""
    ds_id, _ = _upload_fixture(client, fixture_110)
    client.post(f"/api/clean/{ds_id}", json={"remove_duplicates": True})

    repairs = client.get(f"/api/repairs/{ds_id}").json()["repairs"]

    # Find missing email at row 100
    missing_email = next(
        r for r in repairs if r["row_index"] == 100 and r["column_name"] == "email"
    )
    assert missing_email["safety_category"] == "human_review_required"

    # Approving without a replacement value must fail
    assert client.post(f"/api/repairs/{missing_email['repair_id']}/approve").status_code == 400

    # Approving with replacement value alone (no justification) succeeds
    ok = client.post(
        f"/api/repairs/{missing_email['repair_id']}/approve",
        json={"custom_value": "verified100@example.com"},
    )
    assert ok.status_code == 200
    assert ok.json()["repair"]["applied_value"] == "verified100@example.com"
    assert ok.json()["repair"]["approval_type"] == "manual_override"

    # Reject negative amount at row 106 (valid refund)
    neg_amt = next(
        r for r in repairs if r["row_index"] == 106 and r["column_name"] == "amount"
    )
    rej = client.post(f"/api/repairs/{neg_amt['repair_id']}/reject")
    assert rej.status_code == 200
    assert rej.json()["repair"]["status"] == "rejected"

    # Undo an auto-applied repair (row 83 region "north" -> "North") and confirm restoration
    auto_region = next(
        r for r in repairs if r["row_index"] == 83 and r["column_name"] == "region"
    )
    undo = client.post(f"/api/repairs/{auto_region['repair_id']}/undo")
    assert undo.status_code == 200
    assert undo.json()["repair"]["status"] == "undone"

    exp = client.get(f"/api/export/{ds_id}?format=csv")
    df_exp = pd.read_csv(io.StringIO(exp.text), dtype=str, keep_default_na=False)
    # Row 83 had order_id 3084 -> restored back to "north"
    assert df_exp.loc[df_exp["order_id"] == "3084", "region"].iloc[0] == "north"
    # Row 100 (order_id 3101) has manual override
    assert df_exp.loc[df_exp["order_id"] == "3101", "email"].iloc[0] == "verified100@example.com"
    # Row 106 (order_id 3107) still has -450
    assert df_exp.loc[df_exp["order_id"] == "3107", "amount"].iloc[0] == "-450"


def test_full_autonomous_e2e_110_records_and_export_verification(client: TestClient, fixture_110: dict):
    """
    Complete automated 13-step E2E workflow without manual intervention:
    Upload 110 rows -> Analyze -> Auto-Clean -> Verify safe applied & uncertain untouched ->
    Verify original immutable -> Validate -> Report -> Export CSV -> Reopen with Pandas -> Compare all rows.
    """
    # 1-2. Upload 110-row messy CSV
    ds_id, original_bytes = _upload_fixture(client, fixture_110)

    # 3. Run analysis
    ana_resp = client.post(f"/api/analyze/{ds_id}")
    assert ana_resp.status_code == 200
    assert ana_resp.json()["total_issues"] == 30

    # 4. Execute automatic cleaning
    clean_resp = client.post(f"/api/clean/{ds_id}", json={"remove_duplicates": True})
    assert clean_resp.status_code == 200
    clean = clean_resp.json()

    # 5-6. Verify safe repairs applied & uncertain/unresolved kept untouched
    assert clean["safe_repairs_applied"] == 18
    assert clean["manual_review_count"] == 11
    assert clean["unresolved_count"] == 1

    # 7. Verify original dataset on disk is byte-for-byte unchanged
    original_saved = settings.UPLOAD_DIR / ds_id / "original.csv"
    assert original_saved.read_bytes() == original_bytes

    # 8-9. Validation & quality report
    report_resp = client.get(f"/api/reports/{ds_id}")
    assert report_resp.status_code == 200
    report = report_resp.json()
    val = report["validation"]
    assert val["before_row_count"] == 110
    assert val["after_row_count"] == 108  # 2 exact duplicates removed
    assert val["before_column_count"] == 7
    assert val["after_column_count"] == 7
    assert val["before_issue_count"] == 30
    assert val["after_issue_count"] == 12  # 10 manual review + 2 unresolved
    assert val["issues_resolved"] == 18
    assert val["after_quality_score"] > val["before_quality_score"]
    assert val["all_integrity_checks_passed"] is True
    assert report["provenance_breakdown"]["auto_applied"] == 18
    assert report["provenance_breakdown"]["manual_review_pending"] == 11
    assert report["provenance_breakdown"]["unresolved"] == 1

    # 10. Export cleaned CSV
    exp_resp = client.get(f"/api/export/{ds_id}?format=csv")
    assert exp_resp.status_code == 200
    assert exp_resp.headers.get("x-dataset-id") == ds_id
    assert exp_resp.headers.get("x-row-count") == "108"
    assert exp_resp.headers.get("x-column-count") == "7"

    # 11. Reopen exported CSV using Pandas
    exported_df = pd.read_csv(io.StringIO(exp_resp.text), dtype=str, keep_default_na=False)
    original_df = pd.read_csv(io.BytesIO(original_bytes), dtype=str, keep_default_na=False)

    # 12-13. Verify row count, columns, schema, untouched valid rows, repaired values, and audit history
    assert len(exported_df) == 108
    assert list(exported_df.columns) == COLUMNS

    # All 80 valid baseline records (rows 0..79) must be 100% identical to original
    for i in range(80):
        for col in COLUMNS:
            assert exported_df.at[i, col] == original_df.at[i, col]

    # Verify every safe formatting repair was applied accurately
    by_oid = exported_df.set_index("order_id")
    assert by_oid.at["3081", "customer_name"] == "Customer 3081"
    assert by_oid.at["3082", "customer_name"] == "Customer 3082"
    assert by_oid.at["3083", "customer_name"] == "Customer 3083"
    assert by_oid.at["3084", "region"] == "North"
    assert by_oid.at["3085", "region"] == "South"
    assert by_oid.at["3086", "region"] == "East"
    assert by_oid.at["3087", "status"] == "Completed"
    assert by_oid.at["3088", "status"] == "Pending"
    assert by_oid.at["3089", "status"] == "Pending"
    assert by_oid.at["3090", "order_date"] == "2026-03-15"
    assert by_oid.at["3091", "order_date"] == "2026-04-10"
    assert by_oid.at["3092", "order_date"] == "2026-05-20"
    assert by_oid.at["3093", "email"] == "user3093@example.com"
    assert by_oid.at["3094", "email"] == "user3094@example.com"
    assert by_oid.at["3095", "amount"] == "2450"
    assert by_oid.at["3096", "amount"] == "3100"

    # Verify NO uncertain or unresolved values were silently invented or altered
    assert by_oid.at["3099", "customer_name"] == ""
    assert by_oid.at["3100", "customer_name"] == ""
    assert by_oid.at["3101", "email"] == ""
    assert by_oid.at["3102", "email"] == ""
    assert by_oid.at["3103", "amount"] == ""
    assert by_oid.at["3104", "amount"] == ""
    assert by_oid.at["3105", "email"] == "bad-email-104"
    assert by_oid.at["3106", "email"] == "user105@invalid"
    assert by_oid.at["3107", "amount"] == "-450"
    assert by_oid.at["3108", "amount"] == "950000"
    assert by_oid.at["3109", "order_date"] == "not-a-real-date"
    assert by_oid.at["3110", "amount"] == "CORRUPT_AMT"

    # Verify audit history contains upload, analysis, 18 auto_repair_applied, auto_clean_completed, and dataset_exported
    final_report = client.get(f"/api/reports/{ds_id}").json()
    actions = [h["action"] for h in final_report["modification_history"]]
    assert "dataset_uploaded" in actions
    assert "dataset_analyzed" in actions
    assert actions.count("auto_repair_applied") == 18
    assert "auto_clean_completed" in actions
    assert "dataset_exported" in actions


def test_part8_integrity_regression_invalid_date_negative_amount_and_manual_email(client: TestClient):
    """
    Regression tests for Part 7 & Part 8:
      - 31/31/2026 never becomes 12/01/2026 automatically; marked Needs Your Attention.
      - -450 never becomes 450 automatically; marked Needs Your Attention.
      - Missing email & invalid email (kabirrao.example.test) are never invented/replaced automatically.
      - Basic email validation blocks malformed manual emails and saves valid manual emails into exported CSV.
      - Undo restores exact original values; display_status always matches saved data.
    """
    csv_text = "\n".join(
        [
            "order_id,customer_name,email,region,amount,order_date",
            "1001,Asha,asha@example.com,North,1500,2026-01-10",
            "1002,Ravi,ravi@example.com,South,2200,2026-01-12",
            "1003,Meera,meera@example.com,East,1800,2026-01-15",
            "1004,Kabir,kabirrao.example.test,south,2100,31/31/2026",
            "1005,Neha,,North,-450,2026-01-20",
        ]
    ) + "\n"

    up = client.post(
        "/api/upload",
        files={"file": ("regression.csv", csv_text.encode("utf-8"), "text/csv")},
    )
    assert up.status_code == 201
    ds_id = up.json()["dataset"]["dataset_id"]

    # Run automatic cleaning
    cln = client.post(f"/api/clean/{ds_id}", json={"remove_duplicates": True})
    assert cln.status_code == 200

    repairs = client.get(f"/api/repairs/{ds_id}").json()["repairs"]

    # Safe formatting fix (south -> South) is Fixed Automatically
    region_rep = next(r for r in repairs if r["column_name"] == "region")
    assert region_rep["status"] == "approved"
    assert region_rep["display_status"] == "Fixed Automatically"

    # Invalid date 31/31/2026 is NOT changed automatically and shows Needs Your Attention
    date_rep = next(r for r in repairs if r["column_name"] == "order_date")
    assert date_rep["before_value"] == "31/31/2026"
    assert date_rep["applied_value"] is None
    assert date_rep["status"] == "pending"
    assert date_rep["display_status"] == "Needs Your Attention"

    # Invalid manual date is rejected with 400
    assert (
        client.post(
            f"/api/repairs/{date_rep['repair_id']}/approve",
            json={"custom_value": "99/99/2026"},
        ).status_code
        == 400
    )

    # Negative amount -450 is NOT converted to 450 automatically and shows Needs Your Attention
    neg_rep = next(r for r in repairs if r["column_name"] == "amount")
    assert neg_rep["before_value"] == "-450"
    assert neg_rep["applied_value"] is None
    assert neg_rep["status"] == "pending"
    assert neg_rep["display_status"] == "Needs Your Attention"

    # Invalid email kabirrao.example.test & missing email are NOT replaced automatically
    inv_email = next(
        r for r in repairs if r["column_name"] == "email" and r["issue_type"] == "invalid_format"
    )
    miss_email = next(
        r for r in repairs if r["column_name"] == "email" and r["issue_type"] == "missing_value"
    )
    assert inv_email["display_status"] == "Needs Your Attention"
    assert miss_email["display_status"] == "Needs Your Attention"

    # Malformed manual email is rejected with 400
    bad_email_resp = client.post(
        f"/api/repairs/{inv_email['repair_id']}/approve",
        json={"custom_value": "still-not-an-email"},
    )
    assert bad_email_resp.status_code == 400

    # Valid manual email succeeds and shows Fixed Manually (NEVER Fixed Automatically)
    ok_email_resp = client.post(
        f"/api/repairs/{inv_email['repair_id']}/approve",
        json={"custom_value": "kabirrao@example.com"},
    )
    assert ok_email_resp.status_code == 200
    assert ok_email_resp.json()["repair"]["display_status"] == "Fixed Manually"
    assert ok_email_resp.json()["repair"]["applied_value"] == "kabirrao@example.com"

    # Export CSV and verify exact values
    exp = client.get(f"/api/export/{ds_id}?format=csv")
    df = pd.read_csv(io.StringIO(exp.text), dtype=str, keep_default_na=False).set_index("order_id")
    assert df.at["1004", "region"] == "South"
    assert df.at["1004", "email"] == "kabirrao@example.com"
    assert df.at["1004", "order_date"] == "31/31/2026"
    assert df.at["1005", "email"] == ""
    assert df.at["1005", "amount"] == "-450"

    # Undo manual email correction and verify exact original value is restored
    undo = client.post(f"/api/repairs/{inv_email['repair_id']}/undo")
    assert undo.status_code == 200
    assert undo.json()["repair"]["display_status"] == "Undone"

    exp_after_undo = client.get(f"/api/export/{ds_id}?format=csv")
    df_undo = pd.read_csv(io.StringIO(exp_after_undo.text), dtype=str, keep_default_na=False).set_index("order_id")
    assert df_undo.at["1004", "email"] == "kabirrao.example.test"


def test_universal_manual_corrections_all_data_types(client: TestClient):
    """Verify schema-aware manual corrections across text, email, phone, numeric, date, category, and boolean columns."""
    csv_text = "\n".join(
        [
            "order_id,customer_name,email,phone,amount,order_date,status,is_vip",
            "5001,Asha,asha@example.com,+1-555-0101,120.50,2026-01-10,Active,Yes",
            "5002,Ravi,ravi@example.com,+1-555-0102,240.00,2026-01-11,Active,No",
            "5003,Meera,meera@example.com,+1-555-0103,180.75,2026-01-12,Inactive,Yes",
            "5004,Kabir,kabir@example.com,+1-555-0104,310.00,2026-01-13,Active,No",
            "5005,,bad-email,,not-a-number,31/31/2026,,",
        ]
    ) + "\n"

    up = client.post(
        "/api/upload",
        files={"file": ("all_types.csv", csv_text.encode("utf-8"), "text/csv")},
    )
    assert up.status_code == 201
    ds_id = up.json()["dataset"]["dataset_id"]

    # Verify profile inferred types & allowed_values for dropdowns
    cols = {c["name"]: c for c in up.json()["profile"]["columns"]}
    assert cols["email"]["inferred_type"] == "email"
    assert cols["phone"]["inferred_type"] == "phone"
    assert cols["order_date"]["inferred_type"] == "date"
    assert cols["is_vip"]["inferred_type"] == "boolean"
    assert set(cols["status"]["stats"]["allowed_values"]) == {"Active", "Inactive"}

    client.post(f"/api/analyze/{ds_id}")
    repairs = client.get(f"/api/repairs/{ds_id}").json()["repairs"]

    by_col = {r["column_name"]: r for r in repairs if r["row_index"] == 4}

    # 1. Text (customer_name)
    r_name = client.post(
        f"/api/repairs/{by_col['customer_name']['repair_id']}/approve",
        json={"custom_value": "Neha Kapoor"},
    )
    assert r_name.status_code == 200
    assert r_name.json()["repair"]["display_status"] == "Fixed Manually"

    # 2. Email validation
    assert (
        client.post(
            f"/api/repairs/{by_col['email']['repair_id']}/approve",
            json={"custom_value": "nope"},
        ).status_code
        == 400
    )
    assert (
        client.post(
            f"/api/repairs/{by_col['email']['repair_id']}/approve",
            json={"custom_value": "neha@example.com"},
        ).status_code
        == 200
    )

    # 3. Phone validation
    assert (
        client.post(
            f"/api/repairs/{by_col['phone']['repair_id']}/approve",
            json={"custom_value": "123"},
        ).status_code
        == 400
    )
    assert (
        client.post(
            f"/api/repairs/{by_col['phone']['repair_id']}/approve",
            json={"custom_value": "+1-555-0199"},
        ).status_code
        == 200
    )

    # 4. Numeric validation
    assert (
        client.post(
            f"/api/repairs/{by_col['amount']['repair_id']}/approve",
            json={"custom_value": "abc"},
        ).status_code
        == 400
    )
    assert (
        client.post(
            f"/api/repairs/{by_col['amount']['repair_id']}/approve",
            json={"custom_value": "425.50"},
        ).status_code
        == 200
    )

    # 5. Date validation
    assert (
        client.post(
            f"/api/repairs/{by_col['order_date']['repair_id']}/approve",
            json={"custom_value": "31/31/2026"},
        ).status_code
        == 400
    )
    assert (
        client.post(
            f"/api/repairs/{by_col['order_date']['repair_id']}/approve",
            json={"custom_value": "2026-01-14"},
        ).status_code
        == 200
    )

    # 6. Category / Status
    assert (
        client.post(
            f"/api/repairs/{by_col['status']['repair_id']}/approve",
            json={"custom_value": "Active"},
        ).status_code
        == 200
    )

    # 7. Boolean validation
    assert (
        client.post(
            f"/api/repairs/{by_col['is_vip']['repair_id']}/approve",
            json={"custom_value": "maybe"},
        ).status_code
        == 400
    )
    assert (
        client.post(
            f"/api/repairs/{by_col['is_vip']['repair_id']}/approve",
            json={"custom_value": "Yes"},
        ).status_code
        == 200
    )

    # Verify exported CSV contains every manually saved correction
    exp = client.get(f"/api/export/{ds_id}?format=csv")
    df = pd.read_csv(io.StringIO(exp.text), dtype=str, keep_default_na=False).set_index("order_id")
    assert df.at["5005", "customer_name"] == "Neha Kapoor"
    assert df.at["5005", "email"] == "neha@example.com"
    assert df.at["5005", "phone"] == "+1-555-0199"
    assert df.at["5005", "amount"] == "425.50"
    assert df.at["5005", "order_date"] == "2026-01-14"
    assert df.at["5005", "status"] == "Active"
    assert df.at["5005", "is_vip"] == "Yes"

    # Undo boolean and confirm original empty value is restored
    assert client.post(f"/api/repairs/{by_col['is_vip']['repair_id']}/undo").status_code == 200
    exp2 = client.get(f"/api/export/{ds_id}?format=csv")
    df2 = pd.read_csv(io.StringIO(exp2.text), dtype=str, keep_default_na=False).set_index("order_id")
    assert df2.at["5005", "is_vip"] == ""


