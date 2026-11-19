"""Stable local launcher for DATAFIX AI FastAPI backend on 127.0.0.1:8000.

Key stability guarantees:
- Always binds explicitly to IPv4 127.0.0.1:8000 (avoids localhost IPv4/IPv6 mismatch).
- Fails fast with a clear message if port 8000 is already occupied.
- Restricts auto-reload strictly to `app/` so uploads, exports, and SQLite writes
  never trigger Uvicorn reloads or drop active frontend connections.
"""

from __future__ import annotations

import os
import socket
import sys
from pathlib import Path

import uvicorn

HOST = os.getenv("BACKEND_HOST", "127.0.0.1")
PORT = int(os.getenv("BACKEND_PORT", "8000"))
BASE_DIR = Path(__file__).resolve().parent


def ensure_port_available(host: str, port: int) -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((host, port))
        except OSError as exc:
            print(
                f"ERROR: Port {port} on {host} is already in use ({exc}). "
                "Stop the existing process before starting DATAFIX backend.",
                file=sys.stderr,
            )
            sys.exit(1)


def main() -> None:
    reload_enabled = os.getenv("BACKEND_RELOAD", "true").lower() in ("1", "true", "yes")
    ensure_port_available(HOST, PORT)

    uvicorn.run(
        "app.main:app",
        host=HOST,
        port=PORT,
        reload=reload_enabled,
        reload_dirs=[str(BASE_DIR / "app")] if reload_enabled else None,
        reload_excludes=["*.db", "*.db-*", "uploads/*", "exports/*", "tests/*"],
    )


if __name__ == "__main__":
    main()
