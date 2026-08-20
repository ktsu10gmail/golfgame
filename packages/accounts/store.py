"""SQLite-backed player accounts for the self-hosted golf game."""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import math
import re
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .learning import (
    build_player_learning_summary,
    extract_round_observations,
    observation_database_values,
)
from packages.gps.on_course_stats import build_on_course_club_stats


class AccountError(ValueError):
    """A player-facing account or round validation error."""


FEEDBACK_CATEGORIES = {"bug", "suggestion", "feature", "course_map", "ai_caddie", "other"}
FEEDBACK_STATUSES = {"received", "under_review", "planned", "implemented", "closed"}
FEEDBACK_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat(timespec="microseconds")


def _normalize_name(name: Any) -> tuple[str, str]:
    display = " ".join(str(name or "").strip().split())
    if not 2 <= len(display) <= 40:
        raise AccountError("player name must be between 2 and 40 characters")
    if any(ord(character) < 32 for character in display):
        raise AccountError("player name contains unsupported characters")
    return display, display.casefold()


def _validate_pin(pin: Any) -> str:
    value = str(pin or "")
    if not 4 <= len(value) <= 64:
        raise AccountError("PIN must be between 4 and 64 characters")
    return value


def _hash_pin(pin: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), salt, 240_000)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _round_is_complete(round_save: dict[str, Any]) -> bool:
    holes = round_save.get("round_state", {}).get("holes")
    return bool(isinstance(holes, list) and len(holes) == 18 and all(
        isinstance(hole, dict) and isinstance(hole.get("score"), int)
        for hole in holes
    ))


def _validate_round_save(round_save: Any) -> dict[str, Any]:
    if not isinstance(round_save, dict):
        raise AccountError("round save must be an object")
    if round_save.get("version") != "golf-round-save-v1":
        raise AccountError("unsupported round save version")
    course_id = round_save.get("course_id")
    round_state = round_save.get("round_state")
    if not isinstance(course_id, str) or not course_id:
        raise AccountError("round course is missing")
    if not isinstance(round_state, dict) or round_state.get("course_id") != course_id:
        raise AccountError("round state does not match its course")
    holes = round_state.get("holes")
    if not isinstance(holes, list) or len(holes) != 18:
        raise AccountError("round state must contain 18 holes")
    current_hole = round_save.get("current_hole_index")
    if not isinstance(current_hole, int) or not 0 <= current_hole <= 17:
        raise AccountError("current hole is invalid")
    return round_save


def _validated_round_summary(round_save: dict[str, Any]) -> dict[str, Any]:
    summary = round_save.get("round_summary")
    if summary is None:
        summary = {}
    if not isinstance(summary, dict):
        raise AccountError("round summary must be an object")
    holes = round_save["round_state"]["holes"]
    completed_scores = [hole.get("score") for hole in holes if isinstance(hole.get("score"), int)]
    total_strokes = sum(completed_scores)
    complete = len(completed_scores) == 18
    course_name = " ".join(str(summary.get("course_name") or round_save["course_id"]).strip().split())[:100]
    tee = " ".join(str(round_save["round_state"].get("tee") or summary.get("tee") or "White").strip().split())[:30]
    total_par = summary.get("total_par")
    if total_par is not None and (isinstance(total_par, bool) or not isinstance(total_par, int) or not 0 <= total_par <= 100):
        raise AccountError("round total par is invalid")
    if complete and total_par is not None and total_par < 45:
        raise AccountError("completed round total par is invalid")
    strategy_score = summary.get("strategy_score")
    execution_score = summary.get("execution_score")
    scored_shots = summary.get("scored_shots")
    for label, value in (("strategy score", strategy_score), ("execution score", execution_score)):
        if value is not None and (isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 100):
            raise AccountError(f"round {label} is invalid")
    if scored_shots is not None and (isinstance(scored_shots, bool) or not isinstance(scored_shots, int) or not 0 <= scored_shots <= 500):
        raise AccountError("round scored shot count is invalid")
    return {
        "course_name": course_name or round_save["course_id"],
        "tee": tee or "White",
        "holes_completed": len(completed_scores),
        "total_strokes": total_strokes,
        "total_par": total_par if complete else None,
        "score_to_par": total_strokes - total_par if complete and total_par is not None else None,
        "strategy_score": strategy_score,
        "execution_score": execution_score,
        "scored_shots": scored_shots,
    }


def _round_fingerprint(player_id: int, round_save: dict[str, Any]) -> str:
    canonical_state = json.dumps(round_save["round_state"], sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(f"{player_id}:".encode("utf-8") + canonical_state.encode("utf-8")).hexdigest()


def _validate_gps_fix(value: Any, label: str) -> None:
    if not isinstance(value, dict):
        raise AccountError(f"{label} is invalid")
    for key, lower, upper in (("lat", -90, 90), ("lng", -180, 180)):
        coordinate = value.get(key)
        if isinstance(coordinate, bool) or not isinstance(coordinate, (int, float)) or not math.isfinite(coordinate) or not lower <= coordinate <= upper:
            raise AccountError(f"{label} has an invalid {key}")
    course_point = value.get("course_point")
    if course_point is not None and (
        not isinstance(course_point, list) or len(course_point) != 2
        or any(isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(item) for item in course_point)
    ):
        raise AccountError(f"{label} has an invalid course point")


def _validate_gps_round(gps_round: Any) -> dict[str, Any]:
    if not isinstance(gps_round, dict) or gps_round.get("version") != "on-course-gps-round-v1":
        raise AccountError("unsupported on-course GPS round")
    round_id = gps_round.get("round_id")
    if not isinstance(round_id, str) or not re.fullmatch(r"[A-Za-z0-9._:-]{8,100}", round_id):
        raise AccountError("GPS round ID is invalid")
    course_id = gps_round.get("course_id")
    if not isinstance(course_id, str) or not 1 <= len(course_id) <= 100:
        raise AccountError("GPS round course is missing")
    revision = gps_round.get("revision")
    if isinstance(revision, bool) or not isinstance(revision, int) or not 0 <= revision <= 1_000_000_000:
        raise AccountError("GPS round revision is invalid")
    started_at = gps_round.get("started_at")
    if not isinstance(started_at, str) or not 10 <= len(started_at) <= 50:
        raise AccountError("GPS round start time is invalid")
    holes = gps_round.get("holes")
    if not isinstance(holes, list) or len(holes) != 18:
        raise AccountError("GPS round must contain 18 holes")
    for index, hole in enumerate(holes):
        if not isinstance(hole, dict) or hole.get("hole_number") != index + 1:
            raise AccountError("GPS round contains an invalid hole")
        tee = hole.get("tee")
        if tee is not None:
            _validate_gps_fix(tee, f"Hole {index + 1} tee")
        shots = hole.get("shots")
        if not isinstance(shots, list) or len(shots) > 30:
            raise AccountError(f"Hole {index + 1} shots are invalid")
        for shot_index, shot in enumerate(shots):
            if not isinstance(shot, dict):
                raise AccountError(f"Hole {index + 1} shot is invalid")
            _validate_gps_fix(shot.get("start"), f"Hole {index + 1} shot {shot_index + 1} start")
            _validate_gps_fix(shot.get("end"), f"Hole {index + 1} shot {shot_index + 1} end")
            shot_distance = shot.get("distance_yards")
            if isinstance(shot_distance, bool) or not isinstance(shot_distance, (int, float)) or not math.isfinite(shot_distance) or not 0 <= shot_distance <= 1_000:
                raise AccountError(f"Hole {index + 1} shot distance is invalid")
        putts = hole.get("putts")
        if isinstance(putts, bool) or not isinstance(putts, int) or not 0 <= putts <= 30:
            raise AccountError(f"Hole {index + 1} putt count is invalid")
        if not isinstance(hole.get("final_stroke"), bool) or not isinstance(hole.get("finished"), bool):
            raise AccountError(f"Hole {index + 1} completion state is invalid")
    return gps_round


def _gps_round_score(gps_round: dict[str, Any]) -> int:
    return sum(
        len(hole["shots"]) + hole["putts"] + int(hole["final_stroke"])
        for hole in gps_round["holes"]
    )


def _validate_player_profile(profile: Any) -> dict[str, Any]:
    if not isinstance(profile, dict):
        raise AccountError("player profile must be an object")
    profile_id = profile.get("id")
    name = profile.get("name")
    clubs = profile.get("clubs")
    if not isinstance(profile_id, str) or not 1 <= len(profile_id.strip()) <= 80:
        raise AccountError("player profile ID is invalid")
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 40:
        raise AccountError("player profile name is invalid")
    if not isinstance(clubs, list) or not 2 <= len(clubs) <= 20:
        raise AccountError("player profile must contain between 2 and 20 clubs")
    for club in clubs:
        if not isinstance(club, dict):
            raise AccountError("player profile contains an invalid club")
        club_name = club.get("name")
        carry = club.get("carry")
        accuracy = club.get("accuracy")
        if not isinstance(club_name, str) or not 1 <= len(club_name.strip()) <= 30:
            raise AccountError("player profile contains an invalid club name")
        if isinstance(carry, bool) or not isinstance(carry, (int, float)) or not 0 <= carry <= 350:
            raise AccountError(f"{club_name} carry must be between 0 and 350")
        if isinstance(accuracy, bool) or not isinstance(accuracy, (int, float)) or not 0 <= accuracy <= 100:
            raise AccountError(f"{club_name} accuracy must be between 0 and 100")
    rates = profile.get("puttingMakeRates")
    if rates is not None:
        if not isinstance(rates, dict):
            raise AccountError("putting statistics are invalid")
        for distance in ("3", "6", "10"):
            value = rates.get(distance, rates.get(int(distance)))
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 100:
                raise AccountError(f"{distance}-foot putting percentage must be between 0 and 100")
    return profile


def _feedback_text(value: Any, label: str, minimum: int, maximum: int) -> str:
    text = " ".join(str(value or "").strip().split())
    if not minimum <= len(text) <= maximum:
        raise AccountError(f"{label} must be between {minimum} and {maximum} characters")
    if any(ord(character) < 32 for character in text):
        raise AccountError(f"{label} contains unsupported characters")
    return text


def _validate_feedback_attachment(value: Any) -> dict[str, Any] | None:
    if value in (None, ""):
        return None
    if not isinstance(value, dict):
        raise AccountError("feedback screenshot is invalid")
    mime_type = str(value.get("mime_type") or "").lower()
    if mime_type not in FEEDBACK_IMAGE_TYPES:
        raise AccountError("feedback screenshot must be JPEG, PNG, or WebP")
    name = _feedback_text(value.get("name") or "screenshot", "screenshot name", 1, 100)
    encoded = value.get("data")
    if not isinstance(encoded, str):
        raise AccountError("feedback screenshot data is missing")
    try:
        data = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as error:
        raise AccountError("feedback screenshot data is invalid") from error
    if not 1 <= len(data) <= 1_500_000:
        raise AccountError("feedback screenshot must be smaller than 1.5 MB")
    return {"name": name, "mime_type": mime_type, "data": data}


class PlayerStore:
    """Persist accounts, sessions, and each player's latest round per course."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _initialize(self) -> None:
        with self._connect() as database:
            database.executescript("""
                CREATE TABLE IF NOT EXISTS players (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    display_name TEXT NOT NULL,
                    normalized_name TEXT NOT NULL UNIQUE,
                    pin_salt BLOB NOT NULL,
                    pin_hash BLOB NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
                    expires_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS player_rounds (
                    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
                    course_id TEXT NOT NULL,
                    round_json TEXT NOT NULL,
                    is_complete INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (player_id, course_id)
                );
                CREATE INDEX IF NOT EXISTS player_rounds_resume
                    ON player_rounds(player_id, is_complete, updated_at DESC);
                CREATE TABLE IF NOT EXISTS gps_rounds (
                    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
                    round_id TEXT NOT NULL,
                    course_id TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    completed_at TEXT,
                    revision INTEGER NOT NULL,
                    is_complete INTEGER NOT NULL DEFAULT 0,
                    total_strokes INTEGER NOT NULL DEFAULT 0,
                    round_json TEXT NOT NULL,
                    PRIMARY KEY (player_id, round_id)
                );
                CREATE INDEX IF NOT EXISTS gps_rounds_resume
                    ON gps_rounds(player_id, is_complete, updated_at DESC);
                CREATE INDEX IF NOT EXISTS gps_rounds_history
                    ON gps_rounds(player_id, completed_at DESC);
                CREATE TABLE IF NOT EXISTS player_profiles (
                    player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
                    profile_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS completed_rounds (
                    id TEXT PRIMARY KEY,
                    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
                    fingerprint TEXT NOT NULL,
                    course_id TEXT NOT NULL,
                    course_name TEXT NOT NULL,
                    tee TEXT NOT NULL,
                    completed_at TEXT NOT NULL,
                    total_strokes INTEGER NOT NULL,
                    total_par INTEGER,
                    score_to_par INTEGER,
                    strategy_score INTEGER,
                    execution_score INTEGER,
                    scored_shots INTEGER,
                    round_json TEXT NOT NULL,
                    UNIQUE(player_id, fingerprint)
                );
                CREATE INDEX IF NOT EXISTS completed_rounds_history
                    ON completed_rounds(player_id, completed_at DESC);
                CREATE TABLE IF NOT EXISTS player_shot_observations (
                    id TEXT PRIMARY KEY,
                    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
                    completed_round_id TEXT NOT NULL REFERENCES completed_rounds(id) ON DELETE CASCADE,
                    course_id TEXT,
                    hole_number INTEGER NOT NULL,
                    stroke_number INTEGER NOT NULL,
                    engine_version TEXT,
                    shot_type TEXT,
                    distance_yards REAL,
                    distance_band TEXT,
                    start_lie TEXT,
                    stance TEXT,
                    slope TEXT,
                    elevation_feet REAL,
                    club TEXT,
                    power_percent INTEGER NOT NULL,
                    intended_surface TEXT,
                    player_adjustment TEXT,
                    decision_score INTEGER NOT NULL,
                    decision_label TEXT,
                    decision_reasons_json TEXT NOT NULL,
                    execution_score INTEGER NOT NULL,
                    execution_label TEXT,
                    result_surface TEXT,
                    remaining_yards REAL,
                    penalty_strokes INTEGER NOT NULL DEFAULT 0,
                    sidehill_compensation TEXT,
                    strategy_choice TEXT
                );
                CREATE INDEX IF NOT EXISTS player_shot_observations_player
                    ON player_shot_observations(player_id, completed_round_id);
                CREATE INDEX IF NOT EXISTS player_shot_observations_conditions
                    ON player_shot_observations(player_id, shot_type, distance_band, start_lie);
                CREATE TABLE IF NOT EXISTS game_ratings (
                    player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
                    stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),
                    comment TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS feedback_items (
                    id TEXT PRIMARY KEY,
                    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
                    category TEXT NOT NULL,
                    title TEXT NOT NULL,
                    body TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'received',
                    context_json TEXT NOT NULL DEFAULT '{}',
                    has_unread INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS feedback_items_player
                    ON feedback_items(player_id, updated_at DESC);
                CREATE INDEX IF NOT EXISTS feedback_items_developer
                    ON feedback_items(status, category, updated_at DESC);
                CREATE TABLE IF NOT EXISTS feedback_messages (
                    id TEXT PRIMARY KEY,
                    feedback_id TEXT NOT NULL REFERENCES feedback_items(id) ON DELETE CASCADE,
                    sender_role TEXT NOT NULL,
                    sender_name TEXT NOT NULL,
                    body TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS feedback_messages_thread
                    ON feedback_messages(feedback_id, created_at ASC);
                CREATE TABLE IF NOT EXISTS feedback_attachments (
                    id TEXT PRIMARY KEY,
                    feedback_id TEXT NOT NULL REFERENCES feedback_items(id) ON DELETE CASCADE,
                    file_name TEXT NOT NULL,
                    mime_type TEXT NOT NULL,
                    file_data BLOB NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS feedback_attachments_item
                    ON feedback_attachments(feedback_id);
            """)
            columns = {row["name"] for row in database.execute("PRAGMA table_info(players)")}
            if "supabase_user_id" not in columns:
                database.execute("ALTER TABLE players ADD COLUMN supabase_user_id TEXT")
                database.execute("CREATE UNIQUE INDEX IF NOT EXISTS players_supabase_user ON players(supabase_user_id)")
            if "email" not in columns:
                database.execute("ALTER TABLE players ADD COLUMN email TEXT")

    def create_player(self, name: Any, pin: Any) -> dict[str, Any]:
        display_name, normalized_name = _normalize_name(name)
        validated_pin = _validate_pin(pin)
        salt = secrets.token_bytes(16)
        try:
            with self._connect() as database:
                cursor = database.execute(
                    "INSERT INTO players(display_name, normalized_name, pin_salt, pin_hash, created_at) VALUES (?, ?, ?, ?, ?)",
                    (display_name, normalized_name, salt, _hash_pin(validated_pin, salt), _iso(_utc_now())),
                )
                player_id = cursor.lastrowid
        except sqlite3.IntegrityError as error:
            raise AccountError("that player name is already in use") from error
        return {"id": player_id, "name": display_name}

    def upsert_supabase_player(self, external_id: str, email: str, display_name: str) -> dict[str, Any]:
        if not isinstance(external_id, str) or not external_id.strip():
            raise AccountError("Supabase user ID is missing")
        clean_name = " ".join(str(display_name or "Player").strip().split())[:40] or "Player"
        clean_email = str(email or "").strip().lower()
        normalized_name = f"supabase:{external_id}"
        filler = secrets.token_bytes(32)
        with self._connect() as database:
            database.execute("""
                INSERT INTO players(
                    display_name, normalized_name, pin_salt, pin_hash, created_at,
                    supabase_user_id, email
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(supabase_user_id) DO UPDATE SET
                    display_name = excluded.display_name,
                    email = excluded.email
            """, (
                clean_name, normalized_name, filler[:16], filler[16:], _iso(_utc_now()),
                external_id, clean_email,
            ))
            row = database.execute(
                "SELECT id, display_name, email FROM players WHERE supabase_user_id = ?",
                (external_id,),
            ).fetchone()
        return {"id": row["id"], "name": row["display_name"], "email": row["email"] or ""}

    def authenticate(self, name: Any, pin: Any) -> dict[str, Any] | None:
        _, normalized_name = _normalize_name(name)
        validated_pin = _validate_pin(pin)
        with self._connect() as database:
            row = database.execute(
                "SELECT id, display_name, pin_salt, pin_hash FROM players WHERE normalized_name = ?",
                (normalized_name,),
            ).fetchone()
        if row is None or not hmac.compare_digest(_hash_pin(validated_pin, row["pin_salt"]), row["pin_hash"]):
            return None
        return {"id": row["id"], "name": row["display_name"]}

    def create_session(self, player_id: int, days: int = 30) -> str:
        token = secrets.token_urlsafe(32)
        now = _utc_now()
        with self._connect() as database:
            database.execute("DELETE FROM sessions WHERE expires_at <= ?", (_iso(now),))
            database.execute(
                "INSERT INTO sessions(token_hash, player_id, expires_at) VALUES (?, ?, ?)",
                (_token_hash(token), player_id, _iso(now + timedelta(days=days))),
            )
        return token

    def player_for_session(self, token: str | None) -> dict[str, Any] | None:
        if not token:
            return None
        now = _iso(_utc_now())
        with self._connect() as database:
            row = database.execute("""
                SELECT players.id, players.display_name
                FROM sessions JOIN players ON players.id = sessions.player_id
                WHERE sessions.token_hash = ? AND sessions.expires_at > ?
            """, (_token_hash(token), now)).fetchone()
        return None if row is None else {"id": row["id"], "name": row["display_name"]}

    def delete_session(self, token: str | None) -> None:
        if not token:
            return
        with self._connect() as database:
            database.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))

    def save_round(self, player_id: int, round_save: Any) -> dict[str, Any]:
        validated = _validate_round_save(round_save)
        summary = _validated_round_summary(validated)
        updated_at = _iso(_utc_now())
        complete = _round_is_complete(validated)
        archived_round_id = None
        newly_archived = False
        with self._connect() as database:
            if complete:
                fingerprint = _round_fingerprint(player_id, validated)
                archived_round_id = fingerprint[:24]
                existing = database.execute(
                    "SELECT id FROM completed_rounds WHERE player_id = ? AND fingerprint = ?",
                    (player_id, fingerprint),
                ).fetchone()
                newly_archived = existing is None
                database.execute("""
                    INSERT INTO completed_rounds(
                        id, player_id, fingerprint, course_id, course_name, tee,
                        completed_at, total_strokes, total_par, score_to_par,
                        strategy_score, execution_score, scored_shots, round_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(player_id, fingerprint) DO UPDATE SET
                        course_name = excluded.course_name,
                        tee = excluded.tee,
                        total_strokes = excluded.total_strokes,
                        total_par = excluded.total_par,
                        score_to_par = excluded.score_to_par,
                        strategy_score = excluded.strategy_score,
                        execution_score = excluded.execution_score,
                        scored_shots = excluded.scored_shots,
                        round_json = excluded.round_json
                """, (
                    archived_round_id, player_id, fingerprint, validated["course_id"],
                    summary["course_name"], summary["tee"], updated_at,
                    summary["total_strokes"], summary["total_par"], summary["score_to_par"],
                    summary["strategy_score"], summary["execution_score"],
                    summary["scored_shots"], json.dumps(validated, separators=(",", ":")),
                ))
                observations = extract_round_observations(archived_round_id, validated)
                database.execute(
                    "DELETE FROM player_shot_observations WHERE completed_round_id = ?",
                    (archived_round_id,),
                )
                for observation in observations:
                    values = observation_database_values(observation)
                    database.execute("""
                        INSERT INTO player_shot_observations(
                            id, player_id, completed_round_id, course_id, hole_number,
                            stroke_number, engine_version, shot_type, distance_yards,
                            distance_band, start_lie, stance, slope, elevation_feet,
                            club, power_percent, intended_surface, player_adjustment,
                            decision_score, decision_label, decision_reasons_json,
                            execution_score, execution_label, result_surface,
                            remaining_yards, penalty_strokes, sidehill_compensation,
                            strategy_choice
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (values[0], player_id, *values[1:]))
            database.execute("""
                INSERT INTO player_rounds(player_id, course_id, round_json, is_complete, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(player_id, course_id) DO UPDATE SET
                    round_json = excluded.round_json,
                    is_complete = excluded.is_complete,
                    updated_at = excluded.updated_at
            """, (
                player_id,
                validated["course_id"],
                json.dumps(validated, separators=(",", ":")),
                int(complete),
                updated_at,
            ))
        return {
            "saved": True,
            "complete": complete,
            "updated_at": updated_at,
            "archived_round_id": archived_round_id,
            "newly_archived": newly_archived,
        }

    def active_round(self, player_id: int) -> dict[str, Any] | None:
        with self._connect() as database:
            row = database.execute("""
                SELECT round_json FROM player_rounds
                WHERE player_id = ? AND is_complete = 0
                ORDER BY updated_at DESC LIMIT 1
            """, (player_id,)).fetchone()
        return None if row is None else json.loads(row["round_json"])

    def save_gps_round(self, player_id: int, gps_round: Any) -> dict[str, Any]:
        validated = _validate_gps_round(gps_round)
        revision = validated["revision"]
        complete = all(hole["finished"] for hole in validated["holes"])
        synced_at = _iso(_utc_now())
        with self._connect() as database:
            existing = database.execute(
                "SELECT revision, round_json FROM gps_rounds WHERE player_id = ? AND round_id = ?",
                (player_id, validated["round_id"]),
            ).fetchone()
            if existing is not None and revision < existing["revision"]:
                return {
                    "saved": False,
                    "conflict": True,
                    "round_id": validated["round_id"],
                    "server_revision": existing["revision"],
                    "round": json.loads(existing["round_json"]),
                }
            database.execute("""
                INSERT INTO gps_rounds(
                    player_id, round_id, course_id, started_at, updated_at,
                    completed_at, revision, is_complete, total_strokes, round_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(player_id, round_id) DO UPDATE SET
                    course_id = excluded.course_id,
                    started_at = excluded.started_at,
                    updated_at = excluded.updated_at,
                    completed_at = excluded.completed_at,
                    revision = excluded.revision,
                    is_complete = excluded.is_complete,
                    total_strokes = excluded.total_strokes,
                    round_json = excluded.round_json
            """, (
                player_id, validated["round_id"], validated["course_id"],
                validated["started_at"], synced_at, synced_at if complete else None,
                revision, int(complete), _gps_round_score(validated),
                json.dumps(validated, separators=(",", ":")),
            ))
        return {
            "saved": True,
            "conflict": False,
            "round_id": validated["round_id"],
            "revision": revision,
            "complete": complete,
            "synced_at": synced_at,
        }

    def gps_round(self, player_id: int, round_id: str) -> dict[str, Any] | None:
        if not isinstance(round_id, str) or not re.fullmatch(r"[A-Za-z0-9._:-]{8,100}", round_id):
            raise AccountError("GPS round ID is invalid")
        with self._connect() as database:
            row = database.execute(
                "SELECT round_json FROM gps_rounds WHERE player_id = ? AND round_id = ?",
                (player_id, round_id),
            ).fetchone()
        return None if row is None else json.loads(row["round_json"])

    def active_gps_round(self, player_id: int, course_id: str | None = None) -> dict[str, Any] | None:
        parameters: list[Any] = [player_id]
        course_filter = ""
        if course_id is not None:
            if not isinstance(course_id, str) or not 1 <= len(course_id) <= 100:
                raise AccountError("GPS round course is invalid")
            course_filter = " AND course_id = ?"
            parameters.append(course_id)
        with self._connect() as database:
            row = database.execute(f"""
                SELECT round_json FROM gps_rounds
                WHERE player_id = ? AND is_complete = 0{course_filter}
                ORDER BY updated_at DESC LIMIT 1
            """, parameters).fetchone()
        return None if row is None else json.loads(row["round_json"])

    def gps_round_history(self, player_id: int, limit: int = 50) -> list[dict[str, Any]]:
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100:
            raise AccountError("GPS round history limit must be between 1 and 100")
        with self._connect() as database:
            rows = database.execute("""
                SELECT round_id, course_id, started_at, updated_at, completed_at,
                       revision, is_complete, total_strokes
                FROM gps_rounds WHERE player_id = ?
                ORDER BY updated_at DESC LIMIT ?
            """, (player_id, limit)).fetchall()
        return [dict(row) for row in rows]

    def on_course_club_stats(self, player_id: int) -> dict[str, Any]:
        """Return accumulated, profile-relative club evidence from GPS rounds."""
        with self._connect() as database:
            profile_row = database.execute(
                "SELECT profile_json FROM player_profiles WHERE player_id = ?",
                (player_id,),
            ).fetchone()
            round_rows = database.execute(
                "SELECT round_json FROM gps_rounds WHERE player_id = ? ORDER BY updated_at ASC",
                (player_id,),
            ).fetchall()
        profile = None if profile_row is None else json.loads(profile_row["profile_json"])
        return build_on_course_club_stats(
            (json.loads(row["round_json"]) for row in round_rows),
            profile,
        )

    def completed_round_history(self, player_id: int, limit: int = 50) -> list[dict[str, Any]]:
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100:
            raise AccountError("round history limit must be between 1 and 100")
        with self._connect() as database:
            rows = database.execute("""
                SELECT id, course_id, course_name, tee, completed_at,
                       total_strokes, total_par, score_to_par, strategy_score,
                       execution_score, scored_shots
                FROM completed_rounds
                WHERE player_id = ?
                ORDER BY completed_at DESC, id DESC
                LIMIT ?
            """, (player_id, limit)).fetchall()
        return [dict(row) for row in rows]

    def leaderboard(self, limit: int = 10) -> list[dict[str, Any]]:
        """Return each player's best scored round, ordered by course management."""
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 10:
            raise AccountError("leaderboard limit must be between 1 and 10")
        with self._connect() as database:
            rows = database.execute("""
                WITH player_best AS (
                    SELECT players.display_name AS player_name,
                           completed_rounds.player_id,
                           completed_rounds.course_id,
                           completed_rounds.course_name,
                           completed_rounds.tee,
                           completed_rounds.completed_at,
                           completed_rounds.total_strokes,
                           completed_rounds.total_par,
                           completed_rounds.score_to_par,
                           completed_rounds.strategy_score,
                           ROW_NUMBER() OVER (
                               PARTITION BY completed_rounds.player_id
                               ORDER BY completed_rounds.strategy_score DESC,
                                        completed_rounds.total_strokes ASC,
                                        completed_rounds.completed_at DESC,
                                        completed_rounds.id DESC
                           ) AS player_round_rank
                    FROM completed_rounds
                    JOIN players ON players.id = completed_rounds.player_id
                    WHERE completed_rounds.strategy_score IS NOT NULL
                )
                SELECT player_name, course_id, course_name, tee, completed_at,
                       total_strokes, total_par, score_to_par, strategy_score
                FROM player_best
                WHERE player_round_rank = 1
                ORDER BY strategy_score DESC, total_strokes ASC,
                         completed_at DESC, player_name COLLATE NOCASE ASC
                LIMIT ?
            """, (limit,)).fetchall()
        return [dict(row) for row in rows]

    def player_learning(self, player_id: int) -> dict[str, Any]:
        with self._connect() as database:
            completed_rounds = database.execute(
                "SELECT COUNT(*) AS count FROM completed_rounds WHERE player_id = ?",
                (player_id,),
            ).fetchone()["count"]
            recent_rounds = database.execute("""
                SELECT id, course_name, tee, completed_at, strategy_score,
                       scored_shots
                FROM completed_rounds
                WHERE player_id = ? AND strategy_score IS NOT NULL
                ORDER BY completed_at DESC, id DESC
                LIMIT 6
            """, (player_id,)).fetchall()
            rows = database.execute("""
                SELECT completed_round_id AS round_id, course_id, hole_number,
                       stroke_number, engine_version, shot_type, distance_yards,
                       distance_band, start_lie, stance, slope, elevation_feet,
                       club, power_percent, intended_surface, player_adjustment,
                       decision_score, decision_label, decision_reasons_json,
                       execution_score, execution_label, result_surface,
                       remaining_yards, penalty_strokes, sidehill_compensation,
                       strategy_choice
                FROM player_shot_observations
                WHERE player_id = ?
                ORDER BY completed_round_id, hole_number, stroke_number
            """, (player_id,)).fetchall()
        observations = []
        for row in rows:
            observation = dict(row)
            try:
                observation["decision_reasons"] = json.loads(observation.pop("decision_reasons_json"))
            except (TypeError, ValueError, json.JSONDecodeError):
                observation["decision_reasons"] = []
            observations.append(observation)
        return build_player_learning_summary(
            observations,
            completed_rounds,
            recent_rounds=(dict(row) for row in recent_rounds),
        )

    def save_profile(self, player_id: int, profile: Any) -> dict[str, Any]:
        validated = _validate_player_profile(profile)
        updated_at = _iso(_utc_now())
        with self._connect() as database:
            database.execute("""
                INSERT INTO player_profiles(player_id, profile_json, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(player_id) DO UPDATE SET
                    profile_json = excluded.profile_json,
                    updated_at = excluded.updated_at
            """, (
                player_id,
                json.dumps(validated, separators=(",", ":")),
                updated_at,
            ))
        return {"saved": True, "profile": validated, "updated_at": updated_at}

    def player_profile(self, player_id: int) -> dict[str, Any] | None:
        with self._connect() as database:
            row = database.execute(
                "SELECT profile_json FROM player_profiles WHERE player_id = ?",
                (player_id,),
            ).fetchone()
        return None if row is None else json.loads(row["profile_json"])

    @staticmethod
    def _feedback_payload(database: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
        item = dict(row)
        try:
            item["context"] = json.loads(item.pop("context_json"))
        except (TypeError, ValueError, json.JSONDecodeError):
            item["context"] = {}
        item["has_unread"] = bool(item.get("has_unread"))
        item["messages"] = [dict(message) for message in database.execute("""
            SELECT id, sender_role, sender_name, body, created_at
            FROM feedback_messages WHERE feedback_id = ?
            ORDER BY created_at ASC, id ASC
        """, (item["id"],)).fetchall()]
        item["attachments"] = [dict(attachment) for attachment in database.execute("""
            SELECT id, file_name, mime_type, created_at
            FROM feedback_attachments WHERE feedback_id = ?
            ORDER BY created_at ASC, id ASC
        """, (item["id"],)).fetchall()]
        return item

    def save_game_rating(self, player_id: int, stars: Any, comment: Any = "") -> dict[str, Any]:
        if isinstance(stars, bool) or not isinstance(stars, int) or not 1 <= stars <= 5:
            raise AccountError("game rating must be between 1 and 5 stars")
        clean_comment = " ".join(str(comment or "").strip().split())
        if len(clean_comment) > 500:
            raise AccountError("rating comment must be 500 characters or fewer")
        updated_at = _iso(_utc_now())
        with self._connect() as database:
            database.execute("""
                INSERT INTO game_ratings(player_id, stars, comment, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(player_id) DO UPDATE SET
                    stars = excluded.stars,
                    comment = excluded.comment,
                    updated_at = excluded.updated_at
            """, (player_id, stars, clean_comment, updated_at))
        return {"saved": True, "rating": {"stars": stars, "comment": clean_comment, "updated_at": updated_at}}

    def create_feedback(
        self,
        player_id: int,
        category: Any,
        title: Any,
        body: Any,
        context: Any = None,
        attachment: Any = None,
    ) -> dict[str, Any]:
        clean_category = str(category or "").strip().lower()
        if clean_category not in FEEDBACK_CATEGORIES:
            raise AccountError("feedback category is invalid")
        clean_title = _feedback_text(title, "feedback title", 3, 100)
        clean_body = _feedback_text(body, "feedback message", 5, 4_000)
        clean_context = context if isinstance(context, dict) else {}
        context_json = json.dumps(clean_context, separators=(",", ":"))
        if len(context_json.encode("utf-8")) > 16_000:
            raise AccountError("feedback context is too large")
        clean_attachment = _validate_feedback_attachment(attachment)
        feedback_id = f"fb-{secrets.token_urlsafe(12)}"
        created_at = _iso(_utc_now())
        with self._connect() as database:
            database.execute("""
                INSERT INTO feedback_items(
                    id, player_id, category, title, body, status, context_json,
                    has_unread, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'received', ?, 0, ?, ?)
            """, (
                feedback_id, player_id, clean_category, clean_title, clean_body,
                context_json, created_at, created_at,
            ))
            if clean_attachment:
                database.execute("""
                    INSERT INTO feedback_attachments(
                        id, feedback_id, file_name, mime_type, file_data, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                """, (
                    f"att-{secrets.token_urlsafe(12)}", feedback_id,
                    clean_attachment["name"], clean_attachment["mime_type"],
                    clean_attachment["data"], created_at,
                ))
            row = database.execute(
                "SELECT * FROM feedback_items WHERE id = ?",
                (feedback_id,),
            ).fetchone()
            return self._feedback_payload(database, row)

    def player_feedback(self, player_id: int) -> dict[str, Any]:
        with self._connect() as database:
            rating = database.execute(
                "SELECT stars, comment, updated_at FROM game_ratings WHERE player_id = ?",
                (player_id,),
            ).fetchone()
            rows = database.execute("""
                SELECT * FROM feedback_items WHERE player_id = ?
                ORDER BY updated_at DESC, created_at DESC
            """, (player_id,)).fetchall()
            items = [self._feedback_payload(database, row) for row in rows]
        return {
            "rating": None if rating is None else dict(rating),
            "items": items,
            "unread_count": sum(item["has_unread"] for item in items),
        }

    def reply_to_feedback(self, player_id: int, feedback_id: Any, body: Any, player_name: str) -> dict[str, Any]:
        clean_id = str(feedback_id or "")
        clean_body = _feedback_text(body, "reply", 2, 4_000)
        created_at = _iso(_utc_now())
        with self._connect() as database:
            item = database.execute(
                "SELECT id FROM feedback_items WHERE id = ? AND player_id = ?",
                (clean_id, player_id),
            ).fetchone()
            if item is None:
                raise AccountError("feedback item was not found")
            database.execute("""
                INSERT INTO feedback_messages(id, feedback_id, sender_role, sender_name, body, created_at)
                VALUES (?, ?, 'player', ?, ?, ?)
            """, (f"msg-{secrets.token_urlsafe(12)}", clean_id, player_name[:40], clean_body, created_at))
            database.execute(
                "UPDATE feedback_items SET updated_at = ?, has_unread = 0 WHERE id = ?",
                (created_at, clean_id),
            )
        return {"saved": True, "updated_at": created_at}

    def mark_feedback_read(self, player_id: int) -> dict[str, Any]:
        with self._connect() as database:
            cursor = database.execute(
                "UPDATE feedback_items SET has_unread = 0 WHERE player_id = ? AND has_unread = 1",
                (player_id,),
            )
        return {"saved": True, "read": cursor.rowcount}

    def developer_feedback(self, limit: int = 100, status: str | None = None, category: str | None = None) -> dict[str, Any]:
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 200:
            raise AccountError("feedback limit must be between 1 and 200")
        filters = []
        parameters: list[Any] = []
        if status:
            if status not in FEEDBACK_STATUSES:
                raise AccountError("feedback status is invalid")
            filters.append("feedback_items.status = ?")
            parameters.append(status)
        if category:
            if category not in FEEDBACK_CATEGORIES:
                raise AccountError("feedback category is invalid")
            filters.append("feedback_items.category = ?")
            parameters.append(category)
        where = f"WHERE {' AND '.join(filters)}" if filters else ""
        parameters.append(limit)
        with self._connect() as database:
            rows = database.execute(f"""
                SELECT feedback_items.*, players.display_name AS player_name,
                       COALESCE(players.email, '') AS player_email
                FROM feedback_items JOIN players ON players.id = feedback_items.player_id
                {where}
                ORDER BY feedback_items.updated_at DESC, feedback_items.created_at DESC
                LIMIT ?
            """, parameters).fetchall()
            items = [self._feedback_payload(database, row) for row in rows]
            rating = database.execute(
                "SELECT COUNT(*) AS count, ROUND(AVG(stars), 2) AS average FROM game_ratings"
            ).fetchone()
        return {"items": items, "rating_summary": dict(rating)}

    def update_feedback_as_developer(
        self,
        feedback_id: Any,
        developer_name: str,
        status: Any = None,
        reply: Any = None,
    ) -> dict[str, Any]:
        clean_id = str(feedback_id or "")
        clean_status = None if status in (None, "") else str(status).strip().lower()
        if clean_status is not None and clean_status not in FEEDBACK_STATUSES:
            raise AccountError("feedback status is invalid")
        clean_reply = None if reply in (None, "") else _feedback_text(reply, "developer reply", 2, 4_000)
        if clean_status is None and clean_reply is None:
            raise AccountError("choose a status or enter a reply")
        updated_at = _iso(_utc_now())
        with self._connect() as database:
            item = database.execute("SELECT id FROM feedback_items WHERE id = ?", (clean_id,)).fetchone()
            if item is None:
                raise AccountError("feedback item was not found")
            if clean_reply:
                database.execute("""
                    INSERT INTO feedback_messages(id, feedback_id, sender_role, sender_name, body, created_at)
                    VALUES (?, ?, 'developer', ?, ?, ?)
                """, (f"msg-{secrets.token_urlsafe(12)}", clean_id, developer_name[:40], clean_reply, updated_at))
            database.execute("""
                UPDATE feedback_items
                SET status = COALESCE(?, status), updated_at = ?, has_unread = 1
                WHERE id = ?
            """, (clean_status, updated_at, clean_id))
        return {"saved": True, "updated_at": updated_at}

    def feedback_attachment(self, attachment_id: str, player_id: int | None = None) -> dict[str, Any] | None:
        parameters: list[Any] = [attachment_id]
        owner_filter = ""
        if player_id is not None:
            owner_filter = " AND feedback_items.player_id = ?"
            parameters.append(player_id)
        with self._connect() as database:
            row = database.execute(f"""
                SELECT feedback_attachments.file_name, feedback_attachments.mime_type,
                       feedback_attachments.file_data
                FROM feedback_attachments
                JOIN feedback_items ON feedback_items.id = feedback_attachments.feedback_id
                WHERE feedback_attachments.id = ?{owner_filter}
            """, parameters).fetchone()
        return None if row is None else dict(row)
