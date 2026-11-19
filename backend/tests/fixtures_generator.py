"""Deterministic 110-record messy dataset generator with exact ground-truth expectations."""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

FIXTURE_CSV_PATH = Path(__file__).resolve().parent / "messy_110_records.csv"

COLUMNS = [
    "order_id",
    "customer_name",
    "email",
    "region",
    "status",
    "amount",
    "order_date",
]

REGIONS = ["North", "South", "East", "West"]
STATUSES = ["Completed", "Pending"]


def generate_110_record_fixture(output_path: Path = FIXTURE_CSV_PATH) -> dict[str, Any]:
    """
    Generate a reproducible 110-row messy CSV covering all quality categories
    and return exact ground-truth defect metadata for accuracy calculation.
    """
    rows: list[dict[str, str]] = []
    ground_truth: list[dict[str, Any]] = []

    # 80 clean valid baseline records (rows 0..79, order_id 3001..3080)
    for i in range(80):
        order_id = str(3001 + i)
        month = "01" if i < 28 else ("02" if i < 56 else "03")
        day = (i % 28) + 1
        rows.append(
            {
                "order_id": order_id,
                "customer_name": f"Customer {order_id}",
                "email": f"customer{order_id}@example.com",
                "region": REGIONS[i % 4],
                "status": STATUSES[i % 2],
                "amount": str(1500 + (i % 10) * 250),
                "order_date": f"2026-{month}-{day:02d}",
            }
        )

    def add_row(idx: int, overrides: dict[str, str], truth: dict[str, Any]) -> None:
        order_id = str(3001 + idx)
        base = {
            "order_id": order_id,
            "customer_name": f"Customer {order_id}",
            "email": f"customer{order_id}@example.com",
            "region": REGIONS[idx % 4],
            "status": STATUSES[idx % 2],
            "amount": "2500",
            "order_date": "2026-03-10",
        }
        base.update(overrides)
        rows.append(base)
        ground_truth.append({"row_index": idx, **truth})

    # --- SAFE AUTO-REPAIRS (18 total) ---
    # 3 whitespace on customer_name (rows 80, 81, 82)
    for idx in (80, 81, 82):
        oid = str(3001 + idx)
        add_row(
            idx,
            {"customer_name": f"  Customer {oid}  "},
            {
                "column_name": "customer_name",
                "issue_type": "invalid_format",
                "safety_category": "safe_auto_repair",
                "expected_after": f"Customer {oid}",
            },
        )

    # 3 inconsistent category on region (rows 83, 84, 85)
    for idx, raw_region, expected in (
        (83, "north", "North"),
        (84, " SOUTH ", "South"),
        (85, "EAST", "East"),
    ):
        add_row(
            idx,
            {"region": raw_region},
            {
                "column_name": "region",
                "issue_type": "inconsistent_category",
                "safety_category": "safe_auto_repair",
                "expected_after": expected,
            },
        )

    # 3 inconsistent category on status (rows 86, 87, 88)
    for idx, raw_status, expected in (
        (86, "completed", "Completed"),
        (87, "PENDING", "Pending"),
        (88, " pending ", "Pending"),
    ):
        add_row(
            idx,
            {"status": raw_status},
            {
                "column_name": "status",
                "issue_type": "inconsistent_category",
                "safety_category": "safe_auto_repair",
                "expected_after": expected,
            },
        )

    # 3 non-ISO equivalent date formats (rows 89, 90, 91)
    for idx, raw_date, expected in (
        (89, "03/15/2026", "2026-03-15"),
        (90, "2026/04/10", "2026-04-10"),
        (91, "May 20, 2026", "2026-05-20"),
    ):
        add_row(
            idx,
            {"order_date": raw_date},
            {
                "column_name": "order_date",
                "issue_type": "invalid_format",
                "safety_category": "safe_auto_repair",
                "expected_after": expected,
            },
        )

    # 2 fixable uppercase/whitespace emails (rows 92, 93)
    for idx, raw_email, expected in (
        (92, " USER3093@EXAMPLE.COM ", "user3093@example.com"),
        (93, "User3094@Example.com", "user3094@example.com"),
    ):
        add_row(
            idx,
            {"email": raw_email},
            {
                "column_name": "email",
                "issue_type": "invalid_format",
                "safety_category": "safe_auto_repair",
                "expected_after": expected,
            },
        )

    # 2 formatted numeric amounts (rows 94, 95)
    for idx, raw_amt, expected in (
        (94, "$2,450", "2450"),
        (95, " 3,100 ", "3100"),
    ):
        add_row(
            idx,
            {"amount": raw_amt},
            {
                "column_name": "amount",
                "issue_type": "invalid_format",
                "safety_category": "safe_auto_repair",
                "expected_after": expected,
            },
        )

    # 2 exact duplicate rows of row 0 and row 1 (rows 96, 97)
    rows.append(dict(rows[0]))
    ground_truth.append(
        {
            "row_index": 96,
            "column_name": None,
            "issue_type": "duplicate_record",
            "safety_category": "safe_auto_repair",
            "expected_after": None,
        }
    )
    rows.append(dict(rows[1]))
    ground_truth.append(
        {
            "row_index": 97,
            "column_name": None,
            "issue_type": "duplicate_record",
            "safety_category": "safe_auto_repair",
            "expected_after": None,
        }
    )

    # --- HUMAN REVIEW REQUIRED (10 total) ---
    # 2 missing customer_name (rows 98, 99)
    for idx in (98, 99):
        add_row(
            idx,
            {"customer_name": ""},
            {
                "column_name": "customer_name",
                "issue_type": "missing_value",
                "safety_category": "human_review_required",
                "expected_after": "",
            },
        )

    # 2 missing email (rows 100, 101)
    for idx in (100, 101):
        add_row(
            idx,
            {"email": ""},
            {
                "column_name": "email",
                "issue_type": "missing_value",
                "safety_category": "human_review_required",
                "expected_after": "",
            },
        )

    # 2 missing amount (rows 102, 103)
    for idx in (102, 103):
        add_row(
            idx,
            {"amount": ""},
            {
                "column_name": "amount",
                "issue_type": "missing_value",
                "safety_category": "human_review_required",
                "expected_after": "",
            },
        )

    # 2 malformed emails (rows 104, 105)
    for idx, bad_email in ((104, "bad-email-104"), (105, "user105@invalid")):
        add_row(
            idx,
            {"email": bad_email},
            {
                "column_name": "email",
                "issue_type": "invalid_format",
                "safety_category": "human_review_required",
                "expected_after": bad_email,
            },
        )

    # 1 negative financial value (row 106)
    add_row(
        106,
        {"amount": "-450"},
        {
            "column_name": "amount",
            "issue_type": "statistical_anomaly",
            "safety_category": "human_review_required",
            "expected_after": "-450",
        },
    )

    # 1 extreme financial outlier (row 107)
    add_row(
        107,
        {"amount": "950000"},
        {
            "column_name": "amount",
            "issue_type": "statistical_anomaly",
            "safety_category": "human_review_required",
            "expected_after": "950000",
        },
    )

    # 1 unparseable date (row 108) -> Needs Your Attention (manual date input)
    add_row(
        108,
        {"order_date": "not-a-real-date"},
        {
            "column_name": "order_date",
            "issue_type": "invalid_format",
            "safety_category": "human_review_required",
            "expected_after": "not-a-real-date",
        },
    )

    # 1 corrupt non-numeric amount (row 109)
    add_row(
        109,
        {"amount": "CORRUPT_AMT"},
        {
            "column_name": "amount",
            "issue_type": "invalid_format",
            "safety_category": "unresolved",
            "expected_after": "CORRUPT_AMT",
        },
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)

    return {
        "path": output_path,
        "total_rows": len(rows),
        "total_columns": len(COLUMNS),
        "clean_row_indices": set(range(80)),
        "ground_truth": ground_truth,
        "expected_safe_auto": sum(1 for g in ground_truth if g["safety_category"] == "safe_auto_repair"),
        "expected_human_review": sum(1 for g in ground_truth if g["safety_category"] == "human_review_required"),
        "expected_unresolved": sum(1 for g in ground_truth if g["safety_category"] == "unresolved"),
    }


if __name__ == "__main__":
    meta = generate_110_record_fixture()
    print(
        f"Generated {meta['path']} ({meta['total_rows']} rows x {meta['total_columns']} cols): "
        f"{meta['expected_safe_auto']} safe_auto, {meta['expected_human_review']} human_review, "
        f"{meta['expected_unresolved']} unresolved."
    )
