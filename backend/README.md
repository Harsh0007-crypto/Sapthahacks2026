# DATAFIX AI — Backend API

Autonomous Data Quality & Repair Engine backend built with **FastAPI**, **Pandas**, **NumPy**, **SQLite**, **SQLAlchemy**, **OpenPyXL**, and **Pydantic**.

## Features

- **Safe File Ingestion**: Accepts `.csv`, `.xlsx`, and `.xls` files with extension and size validation. Preserves the original uploaded file intact while maintaining a separate working copy.
- **Deterministic Data Profiling**: Row/column counts, semantic type inference (`integer`, `float`, `date`, `email`, `boolean`, `categorical`, `string`), missing-value percentages, column statistics, duplicate counts, and record previews.
- **Deterministic Issue Detection**: Detects missing values, exact duplicate records, invalid formats (emails, dates, numeric formatting, whitespace), inconsistent categorical spellings, and statistical anomalies (IQR fences, Z-score, and domain checks).
- **Human-in-the-Loop Repair Engine**:
  - Generates transparent suggestions with `before_value`, `after_value`, and `explanation`.
  - Attaches `confidence` only when supported by a deterministic method (`null` for human-review flags).
  - Never silently invents missing values or overwrites outliers without explicit user input.
  - Supports explicit approval (with optional `custom_value`), rejection (with optional `reason`), and deterministic undo via replay from the immutable original file.
- **Validation, Audit History & Export**: Compares before/after issue counts and quality scores, runs schema/data integrity checks, maintains an immutable SQLite audit log, and exports cleaned datasets as CSV or JSON.

## Project Structure

```text
backend/
├── app/
│   ├── main.py
│   ├── config.py
│   ├── database.py
│   ├── models.py
│   ├── schemas.py
│   ├── routes/
│   │   ├── upload.py
│   │   ├── analysis.py
│   │   ├── repairs.py
│   │   └── reports.py
│   ├── services/
│   │   ├── file_processor.py
│   │   ├── profiler.py
│   │   ├── detector.py
│   │   ├── repair_engine.py
│   │   ├── validator.py
│   │   └── report_generator.py
│   └── utils/
│       └── helpers.py
├── uploads/
├── exports/
├── tests/
│   ├── messy_sample.csv
│   └── test_api.py
├── requirements.txt
├── .env.example
└── README.md
```

## Setup & Run

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Interactive OpenAPI docs: `http://127.0.0.1:8000/docs`

CORS is preconfigured for the Vite frontend at `http://localhost:5174` (and `http://127.0.0.1:5174`).

## Running Tests

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -v
```

## API Endpoints

### Health
- `GET /health`
  - Response `200`: `{ "status": "ok", "app_name": "DATAFIX AI API", "version": "1.0.0", "database": "connected" }`

### Datasets & Upload
- `POST /api/upload`
  - Request: `multipart/form-data` with field `file` (`.csv`, `.xlsx`, `.xls`)
  - Response `201`: `{ "message": "...", "dataset": DatasetSummary, "profile": DatasetProfile, "preview_rows": [...] }`
- `GET /api/datasets`
  - Response `200`: `DatasetSummary[]`
- `GET /api/datasets/{dataset_id}?limit=50&offset=0`
  - Response `200`: `DatasetDetailResponse` (metadata, current profile, paginated `preview_rows`, analysis/repair counts)

### Analysis
- `POST /api/analyze/{dataset_id}`
  - Runs deterministic issue detection and generates pending repair suggestions.
  - Response `200`: `AnalysisResponse` (`analysis_id`, `total_issues`, `quality_score`, `issues_by_type`, `issues_by_severity`, `issues`, `profile`, `repair_suggestions_count`)
- `GET /api/analysis/{dataset_id}`
  - Returns the latest `AnalysisResponse` for the dataset.

### Repairs
- `GET /api/repairs/{dataset_id}?status=&issue_type=`
  - Response `200`: `{ "dataset_id": "...", "total": 12, "counts_by_status": {...}, "repairs": RepairSuggestionSchema[] }`
- `POST /api/repairs/{repair_id}/approve`
  - Optional JSON body: `{ "custom_value": "explicit_value" }` (required for `flag_for_review` items such as missing values or statistical anomalies).
  - Response `200`: `RepairDecisionResponse` (`message`, `repair`, `current_row_count`, `current_issue_count`)
- `POST /api/repairs/{repair_id}/reject`
  - Optional JSON body: `{ "reason": "optional note" }`
  - Response `200`: `RepairDecisionResponse`
- `POST /api/repairs/{repair_id}/undo`
  - Reverts an approved or rejected repair and deterministically rebuilds the working dataset from the original file.
  - Response `200`: `RepairDecisionResponse`

### Reports & Export
- `GET /api/reports/{dataset_id}`
  - Response `200`: `ReportResponse` (`repair_summary`, `validation` with before/after issue counts, quality score delta, and `integrity_checks`, `current_profile`, `modification_history`)
- `GET /api/export/{dataset_id}?format=csv|json`
  - Response `200`: File download (`text/csv` or `application/json`) of the current repaired working dataset.
