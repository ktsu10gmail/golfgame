"""SQLite cache and audit ledger for external course imports."""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _iso(value: datetime) -> str:
    return value.astimezone(UTC).isoformat()


class CourseImportStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS external_course_cache (
                    provider TEXT NOT NULL,
                    external_id TEXT NOT NULL,
                    fetched_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    response_hash TEXT NOT NULL,
                    normalized_json TEXT NOT NULL,
                    PRIMARY KEY (provider, external_id)
                );
                CREATE TABLE IF NOT EXISTS course_import_jobs (
                    id TEXT PRIMARY KEY,
                    provider TEXT NOT NULL,
                    external_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    requested_by TEXT,
                    started_at TEXT NOT NULL,
                    completed_at TEXT,
                    credit_cost_estimate INTEGER NOT NULL DEFAULT 0,
                    cache_hit INTEGER NOT NULL DEFAULT 0,
                    error_message TEXT,
                    normalized_json TEXT
                );
                CREATE INDEX IF NOT EXISTS course_import_jobs_external
                ON course_import_jobs(provider, external_id, started_at DESC);
                """
            )

    def cached_course(self, provider: str, external_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                """SELECT * FROM external_course_cache
                   WHERE provider = ? AND external_id = ?""",
                (provider, external_id),
            ).fetchone()
        if row is None or datetime.fromisoformat(row["expires_at"]) <= _utc_now():
            return None
        return {
            "project": json.loads(row["normalized_json"]),
            "fetched_at": row["fetched_at"],
            "expires_at": row["expires_at"],
            "response_hash": row["response_hash"],
        }

    def cache_status(self, provider: str, external_id: str) -> dict[str, Any]:
        cached = self.cached_course(provider, external_id)
        return {
            "available": cached is not None,
            "expires_at": cached["expires_at"] if cached else None,
        }

    def save_cached_course(
        self,
        provider: str,
        external_id: str,
        *,
        fetched_at: datetime,
        expires_at: datetime,
        response_hash: str,
        project: dict[str, Any],
    ) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO external_course_cache
                    (provider, external_id, fetched_at, expires_at, response_hash, normalized_json)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(provider, external_id) DO UPDATE SET
                    fetched_at = excluded.fetched_at,
                    expires_at = excluded.expires_at,
                    response_hash = excluded.response_hash,
                    normalized_json = excluded.normalized_json
                """,
                (
                    provider,
                    external_id,
                    _iso(fetched_at),
                    _iso(expires_at),
                    response_hash,
                    json.dumps(project, separators=(",", ":")),
                ),
            )

    def create_job(
        self,
        job_id: str,
        provider: str,
        external_id: str,
        requested_by: str | None,
        *,
        credit_cost_estimate: int,
        cache_hit: bool,
    ) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO course_import_jobs
                    (id, provider, external_id, status, requested_by, started_at,
                     credit_cost_estimate, cache_hit)
                VALUES (?, ?, ?, 'FETCHING', ?, ?, ?, ?)
                """,
                (
                    job_id,
                    provider,
                    external_id,
                    requested_by,
                    _iso(_utc_now()),
                    credit_cost_estimate,
                    int(cache_hit),
                ),
            )

    def finish_job(
        self,
        job_id: str,
        status: str,
        *,
        project: dict[str, Any] | None = None,
        error_message: str | None = None,
    ) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE course_import_jobs
                SET status = ?, completed_at = ?, normalized_json = ?, error_message = ?
                WHERE id = ?
                """,
                (
                    status,
                    _iso(_utc_now()),
                    json.dumps(project, separators=(",", ":")) if project is not None else None,
                    error_message,
                    job_id,
                ),
            )

    def import_job(self, job_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM course_import_jobs WHERE id = ?",
                (job_id,),
            ).fetchone()
        if row is None:
            return None
        result = dict(row)
        result["cache_hit"] = bool(result["cache_hit"])
        result["project"] = json.loads(result.pop("normalized_json")) if result["normalized_json"] else None
        return result
