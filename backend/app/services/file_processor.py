"""File upload validation, safe persistence, and DataFrame loading for CSV/XLSX/XLS."""

from __future__ import annotations

import uuid
from pathlib import Path

import pandas as pd
from fastapi import HTTPException, UploadFile

from app.config import settings
from app.utils.helpers import sanitize_filename


def generate_dataset_id() -> str:
    """Generate a unique, URL-safe dataset identifier."""
    return f"ds_{uuid.uuid4().hex[:12]}"


def validate_upload_metadata(filename: str | None, content_size: int) -> tuple[str, str]:
    """Validate uploaded filename, extension, and file size."""
    if not filename:
        raise HTTPException(status_code=400, detail="Uploaded file must have a filename.")

    safe_name = sanitize_filename(filename)
    ext = Path(safe_name).suffix.lower()
    if ext not in settings.ALLOWED_EXTENSIONS:
        allowed = ", ".join(sorted(settings.ALLOWED_EXTENSIONS))
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext or 'none'}'. Allowed types: {allowed}.",
        )

    if content_size <= 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    if content_size > settings.MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds maximum allowed size of {settings.MAX_UPLOAD_SIZE_MB} MB.",
        )

    return safe_name, ext


def load_dataframe(file_path: str | Path, file_extension: str | None = None) -> pd.DataFrame:
    """Safely load a CSV, XLSX, or XLS file into a DataFrame preserving raw cell strings."""
    path = Path(file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Dataset file not found on disk: {path.name}")

    ext = (file_extension or path.suffix).lower()

    try:
        if ext == ".csv":
            try:
                df = pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8-sig")
            except UnicodeDecodeError:
                df = pd.read_csv(path, dtype=str, keep_default_na=False, encoding="latin-1")
        elif ext == ".xlsx":
            df = pd.read_excel(path, engine="openpyxl", dtype=str, keep_default_na=False)
        elif ext == ".xls":
            df = pd.read_excel(path, engine="xlrd", dtype=str, keep_default_na=False)
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported file format: {ext}")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to parse uploaded file '{path.name}': {exc}",
        ) from exc

    # Normalize column names to stripped strings and ensure non-empty column list
    if df.columns.empty:
        raise HTTPException(status_code=400, detail="Uploaded file contains no columns.")

    df.columns = [str(col).strip() for col in df.columns]
    # Replace any pandas NaN/None with empty string so raw-string representation is uniform
    df = df.fillna("")
    return df


def save_working_dataframe(df: pd.DataFrame, working_path: str | Path) -> None:
    """Persist the working DataFrame to UTF-8 CSV without touching the original file."""
    path = Path(working_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False, encoding="utf-8")


async def process_uploaded_file(
    upload: UploadFile,
) -> tuple[str, str, str, int, Path, Path, pd.DataFrame]:
    """
    Validate and persist an uploaded file, preserving the original copy intact
    and creating an initial working CSV copy.

    Returns:
        (dataset_id, safe_filename, ext, file_size, original_path, working_path, df)
    """
    raw_bytes = await upload.read()
    file_size = len(raw_bytes)
    safe_name, ext = validate_upload_metadata(upload.filename, file_size)

    dataset_id = generate_dataset_id()
    dataset_dir = settings.UPLOAD_DIR / dataset_id
    dataset_dir.mkdir(parents=True, exist_ok=True)

    original_path = dataset_dir / f"original{ext}"
    working_path = dataset_dir / "working.csv"

    original_path.write_bytes(raw_bytes)

    try:
        df = load_dataframe(original_path, ext)
    except HTTPException:
        # Clean up invalid upload artifacts
        if original_path.exists():
            original_path.unlink(missing_ok=True)
        try:
            dataset_dir.rmdir()
        except OSError:
            pass
        raise

    if len(df) == 0:
        if original_path.exists():
            original_path.unlink(missing_ok=True)
        try:
            dataset_dir.rmdir()
        except OSError:
            pass
        raise HTTPException(status_code=400, detail="Uploaded dataset contains zero data rows.")

    save_working_dataframe(df, working_path)
    return dataset_id, safe_name, ext, file_size, original_path, working_path, df
