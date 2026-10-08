"""Searchable U.S. course directory and player-owned course preferences."""

from __future__ import annotations

import csv
import hashlib
import re
import secrets
import sqlite3
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


MAX_PREFERRED_COURSES = 25
EXPECTED_COLUMNS = {"Course Name", "Country", "State", "City", "Type"}


class CoursePreferenceError(ValueError):
    """A safe validation or directory error for course preferences."""


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def _clean(value: Any, limit: int) -> str:
    return " ".join(str(value or "").strip().split())[:limit]


def _normalize(value: Any) -> str:
    folded = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode()
    return " ".join(re.sub(r"[^a-z0-9]+", " ", folded.casefold()).split())


def _directory_id(name: str, state: str, city: str) -> str:
    identity = "|".join((_normalize(name), state.casefold(), _normalize(city)))
    return f"course_{hashlib.sha256(identity.encode()).hexdigest()[:24]}"


class CoursePreferenceService:
    def __init__(self, database_path: str | Path, directory_csv: str | Path):
        self.database_path = Path(database_path)
        self.directory_csv = Path(directory_csv)
        self._initialize()
        self.import_directory()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _initialize(self) -> None:
        with self._connect() as database:
            database.executescript("""
                CREATE TABLE IF NOT EXISTS course_directory_entries (
                    id TEXT PRIMARY KEY,
                    source TEXT NOT NULL,
                    source_key TEXT NOT NULL,
                    course_name TEXT NOT NULL,
                    normalized_name TEXT NOT NULL,
                    country TEXT NOT NULL,
                    state TEXT NOT NULL,
                    city TEXT NOT NULL,
                    course_type TEXT NOT NULL,
                    search_text TEXT NOT NULL,
                    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
                    imported_at TEXT NOT NULL,
                    UNIQUE(source, source_key)
                );
                CREATE INDEX IF NOT EXISTS course_directory_name_search
                    ON course_directory_entries(active, normalized_name, state);
                CREATE VIRTUAL TABLE IF NOT EXISTS course_directory_fts
                    USING fts5(
                        search_text,
                        content='course_directory_entries',
                        content_rowid='rowid',
                        tokenize='trigram'
                    );
                CREATE TRIGGER IF NOT EXISTS course_directory_fts_insert
                    AFTER INSERT ON course_directory_entries BEGIN
                        INSERT INTO course_directory_fts(rowid, search_text)
                        VALUES (new.rowid, new.search_text);
                    END;
                CREATE TRIGGER IF NOT EXISTS course_directory_fts_delete
                    AFTER DELETE ON course_directory_entries BEGIN
                        INSERT INTO course_directory_fts(
                            course_directory_fts, rowid, search_text
                        ) VALUES ('delete', old.rowid, old.search_text);
                    END;
                CREATE TRIGGER IF NOT EXISTS course_directory_fts_update
                    AFTER UPDATE OF search_text ON course_directory_entries BEGIN
                        INSERT INTO course_directory_fts(
                            course_directory_fts, rowid, search_text
                        ) VALUES ('delete', old.rowid, old.search_text);
                        INSERT INTO course_directory_fts(rowid, search_text)
                        VALUES (new.rowid, new.search_text);
                    END;
                CREATE TABLE IF NOT EXISTS course_directory_index_state (
                    version INTEGER PRIMARY KEY,
                    indexed_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS course_directory_imports (
                    source TEXT PRIMARY KEY,
                    content_hash TEXT NOT NULL,
                    imported_at TEXT NOT NULL,
                    source_rows INTEGER NOT NULL,
                    directory_rows INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS player_course_preferences (
                    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
                    directory_course_id TEXT NOT NULL
                        REFERENCES course_directory_entries(id) ON DELETE RESTRICT,
                    added_at TEXT NOT NULL,
                    PRIMARY KEY(player_id, directory_course_id)
                );
                CREATE INDEX IF NOT EXISTS player_course_preferences_course
                    ON player_course_preferences(directory_course_id, added_at);
                CREATE TABLE IF NOT EXISTS course_requests (
                    id TEXT PRIMARY KEY,
                    requester_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
                    directory_course_id TEXT NOT NULL
                        REFERENCES course_directory_entries(id) ON DELETE RESTRICT,
                    requester_context TEXT NOT NULL
                        CHECK(requester_context IN ('PLAYER', 'COACH')),
                    requested_at TEXT NOT NULL,
                    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
                    withdrawn_at TEXT,
                    UNIQUE(requester_id, directory_course_id, requester_context)
                );
                CREATE INDEX IF NOT EXISTS course_requests_active_course
                    ON course_requests(directory_course_id, active, requested_at);
                CREATE TABLE IF NOT EXISTS course_production_items (
                    id TEXT PRIMARY KEY,
                    directory_course_id TEXT NOT NULL UNIQUE
                        REFERENCES course_directory_entries(id) ON DELETE RESTRICT,
                    status TEXT NOT NULL DEFAULT 'REQUESTED'
                        CHECK(status IN ('REQUESTED', 'IN_PROGRESS', 'READY')),
                    first_requested_at TEXT NOT NULL,
                    started_at TEXT,
                    started_by INTEGER REFERENCES players(id) ON DELETE SET NULL,
                    last_activity_at TEXT NOT NULL,
                    last_error TEXT,
                    installed_at TEXT,
                    installed_by INTEGER REFERENCES players(id) ON DELETE SET NULL
                );
                CREATE INDEX IF NOT EXISTS course_production_fifo
                    ON course_production_items(status, first_requested_at, directory_course_id);
                CREATE TABLE IF NOT EXISTS installed_course_mappings (
                    directory_course_id TEXT NOT NULL
                        REFERENCES course_directory_entries(id) ON DELETE RESTRICT,
                    installed_course_id TEXT NOT NULL,
                    production_item_id TEXT NOT NULL
                        REFERENCES course_production_items(id) ON DELETE RESTRICT,
                    installed_version TEXT NOT NULL,
                    installed_at TEXT NOT NULL,
                    installed_by INTEGER REFERENCES players(id) ON DELETE SET NULL,
                    PRIMARY KEY(directory_course_id, installed_course_id)
                );
                CREATE TABLE IF NOT EXISTS course_request_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at TEXT NOT NULL
                );
            """)
            indexed = database.execute(
                "SELECT 1 FROM course_directory_index_state WHERE version = 1"
            ).fetchone()
            if indexed is None:
                database.execute(
                    "INSERT INTO course_directory_fts(course_directory_fts) VALUES ('rebuild')"
                )
                database.execute(
                    "INSERT INTO course_directory_index_state(version, indexed_at) VALUES (1, ?)",
                    (_utc_now(),),
                )
            request_migration = database.execute(
                "SELECT 1 FROM course_request_migrations WHERE version = 1"
            ).fetchone()
            if request_migration is None:
                stamp = _utc_now()
                preferences = database.execute("""
                    SELECT player_id, directory_course_id, added_at
                    FROM player_course_preferences
                """).fetchall()
                for preference in preferences:
                    request_id = "request_" + hashlib.sha256(
                        f"{preference['player_id']}|{preference['directory_course_id']}|PLAYER".encode()
                    ).hexdigest()[:24]
                    database.execute("""
                        INSERT OR IGNORE INTO course_requests(
                            id, requester_id, directory_course_id, requester_context,
                            requested_at, active
                        ) VALUES (?, ?, ?, 'PLAYER', ?, 1)
                    """, (
                        request_id, preference["player_id"],
                        preference["directory_course_id"], preference["added_at"],
                    ))
                    database.execute("""
                        INSERT INTO course_production_items(
                            id, directory_course_id, status, first_requested_at,
                            last_activity_at
                        ) VALUES (?, ?, 'REQUESTED', ?, ?)
                        ON CONFLICT(directory_course_id) DO NOTHING
                    """, (
                        f"production_{secrets.token_hex(12)}",
                        preference["directory_course_id"], preference["added_at"], stamp,
                    ))
                database.execute(
                    "INSERT INTO course_request_migrations(version, applied_at) VALUES (1, ?)",
                    (stamp,),
                )

    def import_directory(self) -> dict[str, int | bool]:
        if not self.directory_csv.is_file():
            raise CoursePreferenceError("the U.S. course directory file is not installed")
        content_hash = hashlib.sha256(self.directory_csv.read_bytes()).hexdigest()
        with self._connect() as database:
            previous = database.execute(
                "SELECT content_hash, source_rows, directory_rows FROM course_directory_imports WHERE source = ?",
                ("golf_intelligence_csv",),
            ).fetchone()
        if previous and previous["content_hash"] == content_hash:
            return {"changed": False, "source_rows": previous["source_rows"],
                    "directory_rows": previous["directory_rows"]}

        grouped: dict[str, dict[str, Any]] = {}
        source_rows = 0
        with self.directory_csv.open(encoding="utf-8-sig", newline="") as source:
            reader = csv.DictReader(source)
            if set(reader.fieldnames or ()) != EXPECTED_COLUMNS:
                raise CoursePreferenceError("the U.S. course directory columns are invalid")
            for raw in reader:
                source_rows += 1
                name = _clean(raw.get("Course Name"), 160)
                country = _clean(raw.get("Country"), 2).upper()
                state = _clean(raw.get("State"), 2).upper()
                city = _clean(raw.get("City"), 100)
                course_type = _clean(raw.get("Type"), 80)
                if not name or country != "US" or not re.fullmatch(r"[A-Z]{2}", state):
                    continue
                course_id = _directory_id(name, state, city)
                item = grouped.setdefault(course_id, {
                    "id": course_id, "name": name, "country": country,
                    "state": state, "city": city, "types": set(),
                })
                if course_type:
                    item["types"].add(course_type)

        stamp = _utc_now()
        with self._connect() as database:
            database.execute("BEGIN IMMEDIATE")
            database.execute(
                "UPDATE course_directory_entries SET active = 0 WHERE source = ?",
                ("golf_intelligence_csv",),
            )
            for item in grouped.values():
                type_values = sorted(item["types"])
                course_type = type_values[0] if len(type_values) == 1 else (
                    "Mixed listing" if type_values else ""
                )
                source_key = "|".join((_normalize(item["name"]), item["state"], _normalize(item["city"])))
                search_text = " ".join(filter(None, (
                    _normalize(item["name"]), _normalize(item["city"]), item["state"].casefold(),
                )))
                database.execute("""
                    INSERT INTO course_directory_entries(
                        id, source, source_key, course_name, normalized_name,
                        country, state, city, course_type, search_text, active, imported_at
                    ) VALUES (?, 'golf_intelligence_csv', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
                    ON CONFLICT(source, source_key) DO UPDATE SET
                        course_name = excluded.course_name,
                        normalized_name = excluded.normalized_name,
                        country = excluded.country,
                        state = excluded.state,
                        city = excluded.city,
                        course_type = excluded.course_type,
                        search_text = excluded.search_text,
                        active = 1,
                        imported_at = excluded.imported_at
                """, (
                    item["id"], source_key, item["name"], _normalize(item["name"]),
                    item["country"], item["state"], item["city"], course_type,
                    search_text, stamp,
                ))
            database.execute("""
                INSERT INTO course_directory_imports(
                    source, content_hash, imported_at, source_rows, directory_rows
                ) VALUES ('golf_intelligence_csv', ?, ?, ?, ?)
                ON CONFLICT(source) DO UPDATE SET
                    content_hash = excluded.content_hash,
                    imported_at = excluded.imported_at,
                    source_rows = excluded.source_rows,
                    directory_rows = excluded.directory_rows
            """, (content_hash, stamp, source_rows, len(grouped)))
        return {"changed": True, "source_rows": source_rows, "directory_rows": len(grouped)}

    @staticmethod
    def _payload(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"], "name": row["course_name"], "country": row["country"],
            "state": row["state"], "city": row["city"], "type": row["course_type"],
        }

    def search(self, query: Any, *, state: Any = None, limit: Any = 12) -> dict[str, Any]:
        normalized = _normalize(query)
        if not 2 <= len(normalized) <= 100:
            raise CoursePreferenceError("enter at least two characters of the course name")
        requested_state = _clean(state, 2).upper()
        if requested_state and not re.fullmatch(r"[A-Z]{2}", requested_state):
            raise CoursePreferenceError("course state must be a two-letter abbreviation")
        try:
            page_size = max(1, min(int(limit), 20))
        except (TypeError, ValueError) as error:
            raise CoursePreferenceError("course search limit is invalid") from error
        # FTS5's trigram tokenizer accelerates arbitrary substrings of three or
        # more characters. Keep a bounded LIKE fallback for two-character input.
        use_full_text = len(normalized) >= 3
        clauses = ["d.active = 1"]
        parameters: list[Any] = []
        if use_full_text:
            clauses.append("course_directory_fts MATCH ?")
            parameters.append(f'"{normalized}"')
            source = """
                course_directory_fts
                JOIN course_directory_entries d ON d.rowid = course_directory_fts.rowid
            """
        else:
            clauses.append("d.search_text LIKE ?")
            parameters.append(f"%{normalized}%")
            source = "course_directory_entries d"
        if requested_state:
            clauses.append("d.state = ?")
            parameters.append(requested_state)
        parameters.extend([normalized, f"{normalized}%", page_size])
        with self._connect() as database:
            rows = database.execute(f"""
                SELECT d.id, d.course_name, d.country, d.state, d.city, d.course_type
                FROM {source}
                WHERE {' AND '.join(clauses)}
                ORDER BY CASE
                    WHEN d.normalized_name = ? THEN 0
                    WHEN d.normalized_name LIKE ? THEN 1
                    ELSE 2
                END, d.course_name, d.state, d.city
                LIMIT ?
            """, parameters).fetchall()
        return {"items": [self._payload(row) for row in rows], "query": str(query).strip(),
                "limit": page_size}

    def preferred_courses(self, player_id: int) -> list[dict[str, Any]]:
        with self._connect() as database:
            rows = database.execute("""
                SELECT d.id, d.course_name, d.country, d.state, d.city, d.course_type,
                       p.added_at, d.active,
                       EXISTS(
                           SELECT 1 FROM installed_course_mappings m
                           WHERE m.directory_course_id = d.id
                       ) AS available_for_play
                FROM player_course_preferences p
                JOIN course_directory_entries d ON d.id = p.directory_course_id
                WHERE p.player_id = ?
                ORDER BY d.course_name, d.state, d.city
            """, (player_id,)).fetchall()
        items = []
        for row in rows:
            item = self._payload(row)
            item.update({
                "added_at": row["added_at"],
                "directory_active": bool(row["active"]),
                "available_for_play": bool(row["available_for_play"]),
            })
            items.append(item)
        return items

    def add_preference(
        self,
        player_id: int,
        course_id: Any,
        requester_context: Any = "PLAYER",
    ) -> list[dict[str, Any]]:
        clean_id = _clean(course_id, 80)
        context = _clean(requester_context, 12).upper()
        if not re.fullmatch(r"course_[a-f0-9]{24}", clean_id):
            raise CoursePreferenceError("select a course from the search results")
        if context not in {"PLAYER", "COACH"}:
            raise CoursePreferenceError("course request context must be Player or Coach")
        stamp = _utc_now()
        with self._connect() as database:
            database.execute("BEGIN IMMEDIATE")
            course = database.execute(
                "SELECT 1 FROM course_directory_entries WHERE id = ? AND active = 1",
                (clean_id,),
            ).fetchone()
            if course is None:
                raise CoursePreferenceError("that course is no longer available in the directory")
            existing = database.execute("""
                SELECT 1 FROM player_course_preferences
                WHERE player_id = ? AND directory_course_id = ?
            """, (player_id, clean_id)).fetchone()
            count = database.execute(
                "SELECT COUNT(*) FROM player_course_preferences WHERE player_id = ?",
                (player_id,),
            ).fetchone()[0]
            if existing is None and count >= MAX_PREFERRED_COURSES:
                raise CoursePreferenceError(f"choose no more than {MAX_PREFERRED_COURSES} preferred courses")
            database.execute("""
                INSERT OR IGNORE INTO player_course_preferences(
                    player_id, directory_course_id, added_at
                ) VALUES (?, ?, ?)
            """, (player_id, clean_id, stamp))
            request_id = f"request_{hashlib.sha256(f'{player_id}|{clean_id}|{context}'.encode()).hexdigest()[:24]}"
            database.execute("""
                INSERT INTO course_requests(
                    id, requester_id, directory_course_id, requester_context,
                    requested_at, active, withdrawn_at
                ) VALUES (?, ?, ?, ?, ?, 1, NULL)
                ON CONFLICT(requester_id, directory_course_id, requester_context)
                DO UPDATE SET active = 1, withdrawn_at = NULL
            """, (request_id, player_id, clean_id, context, stamp))
            production_id = f"production_{secrets.token_hex(12)}"
            database.execute("""
                INSERT INTO course_production_items(
                    id, directory_course_id, status, first_requested_at,
                    last_activity_at
                ) VALUES (?, ?, 'REQUESTED', ?, ?)
                ON CONFLICT(directory_course_id) DO NOTHING
            """, (production_id, clean_id, stamp, stamp))
        return self.preferred_courses(player_id)

    def remove_preference(
        self,
        player_id: int,
        course_id: Any,
        requester_context: Any = "PLAYER",
    ) -> list[dict[str, Any]]:
        clean_id = _clean(course_id, 80)
        context = _clean(requester_context, 12).upper()
        if context not in {"PLAYER", "COACH"}:
            raise CoursePreferenceError("course request context must be Player or Coach")
        with self._connect() as database:
            database.execute("""
                DELETE FROM player_course_preferences
                WHERE player_id = ? AND directory_course_id = ?
            """, (player_id, clean_id))
            database.execute("""
                UPDATE course_requests
                SET active = 0, withdrawn_at = ?
                WHERE requester_id = ? AND directory_course_id = ?
                  AND requester_context = ? AND active = 1
            """, (_utc_now(), player_id, clean_id, context))
        return self.preferred_courses(player_id)

    def production_queue(self, limit: Any = 100) -> list[dict[str, Any]]:
        try:
            page_size = max(1, min(int(limit), 100))
        except (TypeError, ValueError) as error:
            raise CoursePreferenceError("course queue limit is invalid") from error
        with self._connect() as database:
            rows = database.execute("""
                SELECT p.id AS production_item_id, p.directory_course_id,
                       p.status, p.first_requested_at, p.started_at,
                       p.last_activity_at, p.last_error,
                       d.course_name, d.country, d.state, d.city, d.course_type,
                       COUNT(DISTINCT CASE
                           WHEN r.active = 1 AND r.requester_context = 'COACH' THEN r.id
                       END) AS coach_request_count,
                       COUNT(DISTINCT CASE
                           WHEN r.active = 1 AND r.requester_context = 'PLAYER' THEN r.id
                       END) AS player_request_count,
                       starter.display_name AS started_by_name,
                       GROUP_CONCAT(m.installed_course_id) AS installed_course_ids
                FROM course_production_items p
                JOIN course_directory_entries d ON d.id = p.directory_course_id
                LEFT JOIN course_requests r ON r.directory_course_id = p.directory_course_id
                LEFT JOIN players starter ON starter.id = p.started_by
                LEFT JOIN installed_course_mappings m
                    ON m.directory_course_id = p.directory_course_id
                GROUP BY p.id
                HAVING p.status != 'REQUESTED'
                    OR COUNT(DISTINCT CASE WHEN r.active = 1 THEN r.id END) > 0
                ORDER BY p.first_requested_at, p.directory_course_id
                LIMIT ?
            """, (page_size,)).fetchall()
        return [{
            "production_item_id": row["production_item_id"],
            "directory_course_id": row["directory_course_id"],
            "course_name": row["course_name"],
            "country_code": row["country"],
            "state_code": row["state"],
            "city": row["city"],
            "type": row["course_type"],
            "first_requested_at": row["first_requested_at"],
            "coach_request_count": row["coach_request_count"],
            "player_request_count": row["player_request_count"],
            "total_request_count": row["coach_request_count"] + row["player_request_count"],
            "status": row["status"],
            "started_at": row["started_at"],
            "started_by_name": row["started_by_name"],
            "last_activity_at": row["last_activity_at"],
            "last_error": row["last_error"],
            "installed_course_ids": (
                sorted(set(row["installed_course_ids"].split(",")))
                if row["installed_course_ids"] else []
            ),
        } for row in rows]

    def production_item(self, production_item_id: Any) -> dict[str, Any]:
        clean_id = _clean(production_item_id, 80)
        items = [
            item for item in self.production_queue(100)
            if item["production_item_id"] == clean_id
        ]
        if not items:
            raise CoursePreferenceError("course production item was not found")
        return items[0]

    def validate_install_context(
        self,
        production_item_id: Any,
        directory_course_id: Any,
        operator_id: int,
    ) -> dict[str, str]:
        production_id = _clean(production_item_id, 80)
        directory_id = _clean(directory_course_id, 80)
        with self._connect() as database:
            row = database.execute("""
                SELECT id, directory_course_id, status, started_by
                FROM course_production_items
                WHERE id = ? AND directory_course_id = ?
            """, (production_id, directory_id)).fetchone()
        if row is None:
            raise CoursePreferenceError("course production identity could not be verified")
        if row["status"] != "IN_PROGRESS":
            raise CoursePreferenceError("course production is not ready to install")
        if row["started_by"] != operator_id:
            raise CoursePreferenceError("only the operator building this course can install it")
        return {
            "production_item_id": row["id"],
            "directory_course_id": row["directory_course_id"],
        }

    def claim_production_item(self, production_item_id: Any, operator_id: int) -> dict[str, Any]:
        clean_id = _clean(production_item_id, 80)
        stamp = _utc_now()
        with self._connect() as database:
            cursor = database.execute("""
                UPDATE course_production_items
                SET status = 'IN_PROGRESS', started_at = ?, started_by = ?,
                    last_activity_at = ?, last_error = NULL
                WHERE id = ? AND status = 'REQUESTED'
                  AND EXISTS(
                      SELECT 1 FROM course_requests r
                      WHERE r.directory_course_id = course_production_items.directory_course_id
                        AND r.active = 1
                  )
            """, (stamp, operator_id, stamp, clean_id))
            if cursor.rowcount != 1:
                raise CoursePreferenceError("this course request is no longer available to claim")
        return self.production_item(clean_id)

    def release_production_item(self, production_item_id: Any, operator_id: int) -> dict[str, Any]:
        clean_id = _clean(production_item_id, 80)
        with self._connect() as database:
            cursor = database.execute("""
                UPDATE course_production_items
                SET status = 'REQUESTED', started_at = NULL, started_by = NULL,
                    last_activity_at = ?, last_error = NULL
                WHERE id = ? AND status = 'IN_PROGRESS'
                  AND (started_by = ? OR started_by IS NULL)
            """, (_utc_now(), clean_id, operator_id))
            if cursor.rowcount != 1:
                raise CoursePreferenceError("only the operator building this course can release it")
        return self.production_item(clean_id)

    def complete_production_item(
        self,
        production_item_id: Any,
        directory_course_id: Any,
        installed_courses: list[dict[str, Any]],
        operator_id: int,
    ) -> dict[str, Any]:
        production_id = _clean(production_item_id, 80)
        directory_id = _clean(directory_course_id, 80)
        if not installed_courses:
            raise CoursePreferenceError("no installed courses were supplied for verification")
        stamp = _utc_now()
        with self._connect() as database:
            item = database.execute("""
                SELECT status, started_by FROM course_production_items
                WHERE id = ? AND directory_course_id = ?
            """, (production_id, directory_id)).fetchone()
            if item is None or item["status"] != "IN_PROGRESS":
                raise CoursePreferenceError("course production is not ready to complete")
            if item["started_by"] != operator_id:
                raise CoursePreferenceError("only the operator building this course can complete it")
            database.execute(
                "DELETE FROM installed_course_mappings WHERE directory_course_id = ?",
                (directory_id,),
            )
            for installed in installed_courses:
                course_id = _clean(installed.get("course_id"), 80)
                version = _clean(installed.get("installed_version"), 100)
                if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,62}", course_id) or not version:
                    raise CoursePreferenceError("installed course verification is invalid")
                database.execute("""
                    INSERT INTO installed_course_mappings(
                        directory_course_id, installed_course_id, production_item_id,
                        installed_version, installed_at, installed_by
                    ) VALUES (?, ?, ?, ?, ?, ?)
                """, (directory_id, course_id, production_id, version, stamp, operator_id))
            database.execute("""
                UPDATE course_production_items
                SET status = 'READY', installed_at = ?, installed_by = ?,
                    last_activity_at = ?, last_error = NULL
                WHERE id = ?
            """, (stamp, operator_id, stamp, production_id))
        return self.production_item(production_id)
