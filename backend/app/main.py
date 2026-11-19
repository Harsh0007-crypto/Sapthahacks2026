"""FastAPI application entry point for DATAFIX AI."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.config import settings
from app.database import SessionLocal, init_db
from app.routes.analysis import router as analysis_router
from app.routes.repairs import router as repairs_router
from app.routes.reports import router as reports_router
from app.routes.upload import router as upload_router
from app.schemas import ErrorResponse, HealthResponse

logger = logging.getLogger("datafix.api")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Initialize SQLite schema and storage folders on startup."""
    settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    settings.EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    init_db()
    yield


app = FastAPI(
    title=settings.APP_NAME,
    description=settings.APP_DESCRIPTION,
    version=settings.APP_VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_origin_regex=settings.ALLOWED_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-Dataset-Id", "X-Row-Count", "X-Column-Count"],
)


@app.exception_handler(HTTPException)
async def http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
    """Return structured JSON for HTTP exceptions."""
    payload = ErrorResponse(
        status_code=exc.status_code,
        error_code="HTTP_ERROR",
        detail=exc.detail,
    )
    return JSONResponse(status_code=exc.status_code, content=payload.model_dump())


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    _: Request, exc: RequestValidationError
) -> JSONResponse:
    """Return structured JSON for request validation failures."""
    payload = ErrorResponse(
        status_code=422,
        error_code="VALIDATION_ERROR",
        detail=exc.errors(),
    )
    return JSONResponse(status_code=422, content=payload.model_dump())


@app.exception_handler(Exception)
async def unhandled_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    """Return a safe 500 response for unexpected server errors."""
    logger.exception("Unhandled server error: %s", exc)
    payload = ErrorResponse(
        status_code=500,
        error_code="INTERNAL_SERVER_ERROR",
        detail="An unexpected internal error occurred.",
    )
    return JSONResponse(status_code=500, content=payload.model_dump())


@app.get("/health", response_model=HealthResponse, tags=["Health"])
def health_check() -> JSONResponse:
    """Verify API and SQLite database connectivity (HTTP 200 healthy, HTTP 503 degraded)."""
    db_status = "connected"
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
    except Exception:
        logger.exception("Health check database connectivity probe failed.")
        db_status = "error"

    healthy = db_status == "connected"
    payload = HealthResponse(
        status="ok" if healthy else "degraded",
        app_name=settings.APP_NAME,
        version=settings.APP_VERSION,
        database=db_status,
    )
    return JSONResponse(
        status_code=200 if healthy else 503,
        content=payload.model_dump(),
    )


app.include_router(upload_router)
app.include_router(analysis_router)
app.include_router(repairs_router)
app.include_router(reports_router)
