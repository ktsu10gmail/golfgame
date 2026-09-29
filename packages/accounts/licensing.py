"""Server-authoritative Jetta licensing and play authorization."""

from __future__ import annotations

import hashlib
import json
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


class LicenseError(ValueError):
    """A licensing error safe to show to an authenticated user."""


class PlayAccessDenied(LicenseError):
    """The player may use historical features but cannot start new play."""


ROLES = {"PLAYER", "COACH", "ADMIN"}
PLANS = {"INDIVIDUAL", "COACH"}
ACTIVITY_KINDS = {"ROUND", "GPS", "ACADEMY", "THREE_HOLE_MATCH", "EIGHTEEN_HOLE_MATCH"}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat(timespec="microseconds")


def _parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return result if result.tzinfo else result.replace(tzinfo=timezone.utc)


def _new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(18)}"


def _canonical_code(value: Any) -> str:
    return "".join(character for character in str(value or "").upper() if character.isalnum())


def _hash_code(value: Any) -> str:
    canonical = _canonical_code(value)
    if len(canonical) < 20:
        raise LicenseError("access code is invalid")
    return hashlib.sha256(canonical.encode("ascii")).hexdigest()


class LicenseService:
    """Owns roles, subscriptions, grants, Coach seats, and play-start decisions."""

    def __init__(
        self,
        path: str | Path,
        *,
        enforcement: str = "shadow",
        coach_seat_capacity: int = 10,
        coach_grace_days: int = 30,
    ):
        self.path = Path(path)
        self.enforcement = str(enforcement).strip().lower()
        if self.enforcement not in {"off", "shadow", "enforced"}:
            raise ValueError("license enforcement must be off, shadow, or enforced")
        self.coach_seat_capacity = max(1, int(coach_seat_capacity))
        self.coach_grace_days = max(0, int(coach_grace_days))
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        database = sqlite3.connect(self.path, timeout=10)
        database.row_factory = sqlite3.Row
        database.execute("PRAGMA foreign_keys = ON")
        return database

    def _initialize(self) -> None:
        with self._connect() as database:
            database.executescript("""
                CREATE TABLE IF NOT EXISTS license_schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS player_roles (
                    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
                    role TEXT NOT NULL CHECK(role IN ('PLAYER', 'COACH', 'ADMIN')),
                    granted_at TEXT NOT NULL,
                    granted_by_player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
                    PRIMARY KEY(player_id, role)
                );
                CREATE TABLE IF NOT EXISTS subscriptions (
                    id TEXT PRIMARY KEY,
                    holder_player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
                    plan TEXT NOT NULL CHECK(plan IN ('INDIVIDUAL', 'COACH')),
                    billing_provider TEXT NOT NULL CHECK(billing_provider IN ('ACCESS_CODE', 'STRIPE')),
                    provider_customer_id TEXT,
                    provider_subscription_id TEXT,
                    status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED')),
                    starts_at TEXT NOT NULL,
                    current_period_end TEXT,
                    grace_ends_at TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS subscriptions_holder
                    ON subscriptions(holder_player_id, status);
                CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_provider_id
                    ON subscriptions(billing_provider, provider_subscription_id)
                    WHERE provider_subscription_id IS NOT NULL;
                CREATE TABLE IF NOT EXISTS access_codes (
                    id TEXT PRIMARY KEY,
                    code_hash TEXT NOT NULL UNIQUE,
                    code_hint TEXT NOT NULL,
                    plan TEXT NOT NULL CHECK(plan IN ('INDIVIDUAL', 'COACH')),
                    duration_days INTEGER NOT NULL CHECK(duration_days > 0),
                    redeem_by TEXT,
                    max_redemptions INTEGER NOT NULL CHECK(max_redemptions > 0),
                    redemption_count INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'REVOKED', 'EXHAUSTED', 'EXPIRED')),
                    created_by_player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
                    created_at TEXT NOT NULL,
                    revoked_at TEXT
                );
                CREATE TABLE IF NOT EXISTS access_code_redemptions (
                    id TEXT PRIMARY KEY,
                    access_code_id TEXT NOT NULL REFERENCES access_codes(id) ON DELETE RESTRICT,
                    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
                    subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
                    redeemed_at TEXT NOT NULL,
                    UNIQUE(access_code_id, player_id)
                );
                CREATE TABLE IF NOT EXISTS access_code_attempts (
                    id TEXT PRIMARY KEY,
                    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
                    remote_key_hash TEXT NOT NULL,
                    succeeded INTEGER NOT NULL CHECK(succeeded IN (0, 1)),
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS access_code_attempts_recent
                    ON access_code_attempts(player_id, remote_key_hash, created_at DESC);
                CREATE TABLE IF NOT EXISTS billing_events (
                    id TEXT PRIMARY KEY,
                    billing_provider TEXT NOT NULL CHECK(billing_provider IN ('ACCESS_CODE', 'STRIPE')),
                    provider_event_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    processing_status TEXT NOT NULL,
                    received_at TEXT NOT NULL,
                    processed_at TEXT,
                    UNIQUE(billing_provider, provider_event_id)
                );
                CREATE TABLE IF NOT EXISTS coach_student_relationships (
                    id TEXT PRIMARY KEY,
                    coach_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
                    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
                    status TEXT NOT NULL CHECK(status IN ('INVITED', 'ACTIVE', 'ENDED')),
                    started_at TEXT,
                    ended_at TEXT,
                    created_at TEXT NOT NULL,
                    CHECK(coach_id <> player_id)
                );
                CREATE UNIQUE INDEX IF NOT EXISTS one_active_coach_per_player
                    ON coach_student_relationships(player_id) WHERE status = 'ACTIVE';
                CREATE INDEX IF NOT EXISTS coach_relationship_roster
                    ON coach_student_relationships(coach_id, status);
                CREATE TABLE IF NOT EXISTS coach_invitations (
                    id TEXT PRIMARY KEY,
                    relationship_id TEXT REFERENCES coach_student_relationships(id) ON DELETE RESTRICT,
                    coach_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
                    invited_player_id INTEGER REFERENCES players(id) ON DELETE RESTRICT,
                    invited_email TEXT,
                    token_hash TEXT NOT NULL UNIQUE,
                    token_hint TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED')),
                    created_at TEXT NOT NULL,
                    responded_at TEXT,
                    CHECK(invited_player_id IS NOT NULL OR invited_email IS NOT NULL)
                );
                CREATE INDEX IF NOT EXISTS coach_invitations_recipient
                    ON coach_invitations(invited_player_id, invited_email, status);
                CREATE TABLE IF NOT EXISTS coach_seat_assignments (
                    id TEXT PRIMARY KEY,
                    coach_subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
                    coach_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
                    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
                    relationship_id TEXT NOT NULL REFERENCES coach_student_relationships(id) ON DELETE RESTRICT,
                    status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'RELEASED', 'CANCELLED')),
                    assigned_at TEXT NOT NULL,
                    released_at TEXT
                );
                CREATE UNIQUE INDEX IF NOT EXISTS one_active_seat_per_relationship
                    ON coach_seat_assignments(relationship_id) WHERE status = 'ACTIVE';
                CREATE INDEX IF NOT EXISTS coach_subscription_seats
                    ON coach_seat_assignments(coach_subscription_id, status);
                CREATE TABLE IF NOT EXISTS entitlement_grants (
                    id TEXT PRIMARY KEY,
                    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
                    grant_type TEXT NOT NULL CHECK(grant_type IN ('SELF_PAID', 'PROMOTIONAL', 'COACH_SELF', 'COACH_SPONSORED')),
                    subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
                    sponsoring_coach_id INTEGER REFERENCES players(id) ON DELETE RESTRICT,
                    seat_assignment_id TEXT REFERENCES coach_seat_assignments(id) ON DELETE RESTRICT,
                    status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'ENDED')),
                    starts_at TEXT NOT NULL,
                    expires_at TEXT,
                    ended_at TEXT,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS entitlement_grants_player
                    ON entitlement_grants(player_id, status);
                CREATE TABLE IF NOT EXISTS play_activities (
                    id TEXT PRIMARY KEY,
                    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
                    activity_kind TEXT NOT NULL CHECK(activity_kind IN ('ROUND', 'GPS', 'ACADEMY', 'THREE_HOLE_MATCH', 'EIGHTEEN_HOLE_MATCH')),
                    client_activity_id TEXT NOT NULL,
                    entitlement_grant_id TEXT REFERENCES entitlement_grants(id) ON DELETE RESTRICT,
                    authorization_source TEXT NOT NULL,
                    entitlement_snapshot_json TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    completed_at TEXT,
                    UNIQUE(player_id, activity_kind, client_activity_id)
                );
                CREATE INDEX IF NOT EXISTS play_activities_player
                    ON play_activities(player_id, started_at DESC);
                CREATE TABLE IF NOT EXISTS license_audit_events (
                    id TEXT PRIMARY KEY,
                    actor_player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
                    subject_player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
                    event_type TEXT NOT NULL,
                    entity_type TEXT,
                    entity_id TEXT,
                    detail_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS license_audit_subject
                    ON license_audit_events(subject_player_id, created_at DESC);
            """)
            stamp = _iso(_utc_now())
            database.execute(
                "INSERT OR IGNORE INTO license_schema_migrations(version, applied_at) VALUES (1, ?)",
                (stamp,),
            )
            database.execute("""
                INSERT OR IGNORE INTO player_roles(player_id, role, granted_at)
                SELECT id, 'PLAYER', ? FROM players
            """, (stamp,))

    @staticmethod
    def _audit(
        database: sqlite3.Connection,
        event_type: str,
        *,
        actor: int | None = None,
        subject: int | None = None,
        entity_type: str | None = None,
        entity_id: str | None = None,
        detail: dict[str, Any] | None = None,
    ) -> None:
        database.execute("""
            INSERT INTO license_audit_events(
                id, actor_player_id, subject_player_id, event_type, entity_type,
                entity_id, detail_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            _new_id("audit"), actor, subject, event_type, entity_type, entity_id,
            json.dumps(detail or {}, separators=(",", ":"), sort_keys=True), _iso(_utc_now()),
        ))

    def ensure_role(self, player_id: int, role: str, granted_by: int | None = None) -> None:
        normalized = str(role).upper()
        if normalized not in ROLES:
            raise LicenseError("role is invalid")
        with self._connect() as database:
            database.execute("""
                INSERT OR IGNORE INTO player_roles(player_id, role, granted_at, granted_by_player_id)
                VALUES (?, ?, ?, ?)
            """, (player_id, normalized, _iso(_utc_now()), granted_by))

    def roles(self, player_id: int) -> list[str]:
        with self._connect() as database:
            rows = database.execute(
                "SELECT role FROM player_roles WHERE player_id = ? ORDER BY role", (player_id,)
            ).fetchall()
        return [row["role"] for row in rows] or ["PLAYER"]

    @staticmethod
    def _subscription_valid(row: sqlite3.Row, now: datetime, coach_grant: bool) -> bool:
        if row["subscription_status"] == "ACTIVE":
            period_end = _parse_time(row["current_period_end"])
            return period_end is None or period_end > now
        if coach_grant and row["subscription_status"] == "PAST_DUE":
            grace_end = _parse_time(row["grace_ends_at"])
            return grace_end is not None and grace_end > now
        return False

    def _valid_grants(
        self, database: sqlite3.Connection, player_id: int, at: datetime | None = None
    ) -> list[dict[str, Any]]:
        now = at or _utc_now()
        rows = database.execute("""
            SELECT g.*, s.plan, s.billing_provider,
                   s.status AS subscription_status, s.current_period_end, s.grace_ends_at,
                   a.status AS seat_status
            FROM entitlement_grants g
            JOIN subscriptions s ON s.id = g.subscription_id
            LEFT JOIN coach_seat_assignments a ON a.id = g.seat_assignment_id
            WHERE g.player_id = ? AND g.status = 'ACTIVE'
            ORDER BY g.created_at
        """, (player_id,)).fetchall()
        valid = []
        for row in rows:
            coach_grant = row["grant_type"] in {"COACH_SELF", "COACH_SPONSORED"}
            if not self._subscription_valid(row, now, coach_grant):
                continue
            expires_at = _parse_time(row["expires_at"])
            if expires_at is not None and expires_at <= now:
                continue
            if row["grant_type"] == "COACH_SPONSORED" and row["seat_status"] != "ACTIVE":
                continue
            valid.append({
                "id": row["id"],
                "type": row["grant_type"],
                "subscription_id": row["subscription_id"],
                "sponsoring_coach_id": row["sponsoring_coach_id"],
                "expires_at": row["expires_at"] or row["current_period_end"],
                "billing_provider": row["billing_provider"],
            })
        return valid

    def access_summary(self, player_id: int) -> dict[str, Any]:
        with self._connect() as database:
            grants = self._valid_grants(database, player_id)
            coach = database.execute("""
                SELECT r.id AS relationship_id, r.coach_id, p.display_name AS coach_name,
                       r.started_at
                FROM coach_student_relationships r
                JOIN players p ON p.id = r.coach_id
                WHERE r.player_id = ? AND r.status = 'ACTIVE'
            """, (player_id,)).fetchone()
            invitations = database.execute("""
                SELECT i.id, i.coach_id, p.display_name AS coach_name, i.created_at
                FROM coach_invitations i
                JOIN players p ON p.id = i.coach_id
                LEFT JOIN players invited ON invited.id = ?
                WHERE i.status = 'PENDING' AND (
                    i.invited_player_id = ? OR
                    (i.invited_player_id IS NULL AND lower(i.invited_email) = lower(invited.email))
                ) ORDER BY i.created_at DESC
            """, (player_id, player_id)).fetchall()
        return {
            "play_access": "ACTIVE" if grants else "HISTORICAL_ONLY",
            "can_start_new_play": bool(grants) or self.enforcement != "enforced",
            "enforcement": self.enforcement,
            "grants": grants,
            "roles": self.roles(player_id),
            "current_coach": dict(coach) if coach else None,
            "pending_invitations": [dict(row) for row in invitations],
        }

    def create_access_code(
        self,
        actor_player_id: int,
        *,
        plan: str = "INDIVIDUAL",
        duration_days: int = 90,
        max_redemptions: int = 1,
        redeem_by: str | None = None,
    ) -> dict[str, Any]:
        normalized_plan = str(plan).upper()
        if normalized_plan not in PLANS:
            raise LicenseError("access-code plan is invalid")
        duration = int(duration_days)
        maximum = int(max_redemptions)
        if not 1 <= duration <= 3650:
            raise LicenseError("access-code duration must be between 1 and 3650 days")
        if not 1 <= maximum <= 10_000:
            raise LicenseError("maximum redemptions must be between 1 and 10000")
        if redeem_by is not None and _parse_time(redeem_by) is None:
            raise LicenseError("redemption deadline is invalid")
        raw_code = f"JETTA-{secrets.token_urlsafe(24).upper()}"
        canonical = _canonical_code(raw_code)
        code_id = _new_id("code")
        stamp = _iso(_utc_now())
        with self._connect() as database:
            database.execute("""
                INSERT INTO access_codes(
                    id, code_hash, code_hint, plan, duration_days, redeem_by,
                    max_redemptions, status, created_by_player_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
            """, (
                code_id, _hash_code(raw_code), canonical[-6:], normalized_plan,
                duration, redeem_by, maximum, actor_player_id, stamp,
            ))
            self._audit(database, "ACCESS_CODE_CREATED", actor=actor_player_id,
                        entity_type="access_code", entity_id=code_id,
                        detail={"plan": normalized_plan, "duration_days": duration,
                                "max_redemptions": maximum})
        return {"id": code_id, "code": raw_code, "code_hint": canonical[-6:],
                "plan": normalized_plan, "duration_days": duration,
                "max_redemptions": maximum, "redeem_by": redeem_by}

    def list_access_codes(self, limit: int = 100) -> list[dict[str, Any]]:
        with self._connect() as database:
            rows = database.execute("""
                SELECT id, code_hint, plan, duration_days, redeem_by, max_redemptions,
                       redemption_count, status, created_by_player_id, created_at, revoked_at
                FROM access_codes ORDER BY created_at DESC LIMIT ?
            """, (max(1, min(int(limit), 500)),)).fetchall()
        return [dict(row) for row in rows]

    def revoke_access_code(self, actor_player_id: int, code_id: str) -> None:
        with self._connect() as database:
            changed = database.execute("""
                UPDATE access_codes SET status = 'REVOKED', revoked_at = ?
                WHERE id = ? AND status = 'ACTIVE'
            """, (_iso(_utc_now()), code_id)).rowcount
            if changed != 1:
                raise LicenseError("active access code was not found")
            self._audit(database, "ACCESS_CODE_REVOKED", actor=actor_player_id,
                        entity_type="access_code", entity_id=code_id)

    def check_redemption_rate(self, player_id: int, remote_key: str) -> None:
        cutoff = _iso(_utc_now() - timedelta(minutes=15))
        remote_hash = hashlib.sha256(str(remote_key).encode("utf-8")).hexdigest()
        with self._connect() as database:
            failures = database.execute("""
                SELECT COUNT(*) FROM access_code_attempts
                WHERE player_id = ? AND remote_key_hash = ? AND succeeded = 0 AND created_at > ?
            """, (player_id, remote_hash, cutoff)).fetchone()[0]
        if failures >= 8:
            raise LicenseError("too many unsuccessful access-code attempts; try again later")

    def record_redemption_attempt(self, player_id: int, remote_key: str, succeeded: bool) -> None:
        remote_hash = hashlib.sha256(str(remote_key).encode("utf-8")).hexdigest()
        with self._connect() as database:
            database.execute("""
                INSERT INTO access_code_attempts(
                    id, player_id, remote_key_hash, succeeded, created_at
                ) VALUES (?, ?, ?, ?, ?)
            """, (_new_id("attempt"), player_id, remote_hash, int(succeeded), _iso(_utc_now())))

    def redeem_access_code(self, player_id: int, value: Any) -> dict[str, Any]:
        digest = _hash_code(value)
        now = _utc_now()
        stamp = _iso(now)
        with self._connect() as database:
            database.execute("BEGIN IMMEDIATE")
            code = database.execute(
                "SELECT * FROM access_codes WHERE code_hash = ?", (digest,)
            ).fetchone()
            if code is None:
                raise LicenseError("access code is invalid")
            if database.execute("""
                SELECT 1 FROM access_code_redemptions
                WHERE access_code_id = ? AND player_id = ?
            """, (code["id"], player_id)).fetchone():
                raise LicenseError("this access code was already redeemed by this player")
            deadline = _parse_time(code["redeem_by"])
            if code["status"] != "ACTIVE":
                raise LicenseError("access code is no longer available")
            if deadline is not None and deadline <= now:
                database.execute(
                    "UPDATE access_codes SET status = 'EXPIRED' WHERE id = ?", (code["id"],)
                )
                raise LicenseError("access code has expired")
            if code["redemption_count"] >= code["max_redemptions"]:
                database.execute(
                    "UPDATE access_codes SET status = 'EXHAUSTED' WHERE id = ?", (code["id"],)
                )
                raise LicenseError("access code has already been fully redeemed")
            subscription_id = _new_id("sub")
            expires_at = _iso(now + timedelta(days=code["duration_days"]))
            database.execute("""
                INSERT INTO subscriptions(
                    id, holder_player_id, plan, billing_provider, status, starts_at,
                    current_period_end, created_at, updated_at
                ) VALUES (?, ?, ?, 'ACCESS_CODE', 'ACTIVE', ?, ?, ?, ?)
            """, (subscription_id, player_id, code["plan"], stamp, expires_at, stamp, stamp))
            grant_type = "PROMOTIONAL" if code["plan"] == "INDIVIDUAL" else "COACH_SELF"
            grant_id = _new_id("grant")
            database.execute("""
                INSERT INTO entitlement_grants(
                    id, player_id, grant_type, subscription_id, status,
                    starts_at, expires_at, created_at
                ) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?)
            """, (grant_id, player_id, grant_type, subscription_id, stamp, expires_at, stamp))
            if code["plan"] == "COACH":
                database.execute("""
                    INSERT OR IGNORE INTO player_roles(player_id, role, granted_at)
                    VALUES (?, 'COACH', ?)
                """, (player_id, stamp))
            redemption_count = code["redemption_count"] + 1
            next_status = "EXHAUSTED" if redemption_count >= code["max_redemptions"] else "ACTIVE"
            database.execute("""
                UPDATE access_codes SET redemption_count = ?, status = ? WHERE id = ?
            """, (redemption_count, next_status, code["id"]))
            database.execute("""
                INSERT INTO access_code_redemptions(
                    id, access_code_id, player_id, subscription_id, redeemed_at
                ) VALUES (?, ?, ?, ?, ?)
            """, (_new_id("redemption"), code["id"], player_id, subscription_id, stamp))
            self._audit(database, "ACCESS_CODE_REDEEMED", actor=player_id, subject=player_id,
                        entity_type="subscription", entity_id=subscription_id,
                        detail={"access_code_id": code["id"], "plan": code["plan"]})
        return {"subscription_id": subscription_id, "grant_type": grant_type,
                "plan": code["plan"], "expires_at": expires_at,
                "access": self.access_summary(player_id)}

    def authorize_new_activity(
        self, player_id: int, activity_kind: str, client_activity_id: Any
    ) -> dict[str, Any]:
        kind = str(activity_kind).upper()
        client_id = str(client_activity_id or "").strip()
        if kind not in ACTIVITY_KINDS:
            raise LicenseError("play activity type is invalid")
        if not 8 <= len(client_id) <= 120:
            raise LicenseError("play activity identifier is invalid")
        with self._connect() as database:
            database.execute("BEGIN IMMEDIATE")
            existing = database.execute("""
                SELECT * FROM play_activities
                WHERE player_id = ? AND activity_kind = ? AND client_activity_id = ?
            """, (player_id, kind, client_id)).fetchone()
            if existing is not None:
                return self._activity_payload(existing)
            grants = self._valid_grants(database, player_id)
            if not grants and self.enforcement == "enforced":
                self._audit(database, "PLAY_START_DENIED", actor=player_id, subject=player_id,
                            detail={"activity_kind": kind, "client_activity_id": client_id})
                raise PlayAccessDenied("Jetta access is required to start new play")
            selected = grants[0] if grants else None
            source = selected["type"] if selected else f"{self.enforcement.upper()}_ALLOW"
            activity_id = _new_id("activity")
            snapshot = {"grant": selected, "authorized_at": _iso(_utc_now()),
                        "enforcement": self.enforcement}
            database.execute("""
                INSERT INTO play_activities(
                    id, player_id, activity_kind, client_activity_id,
                    entitlement_grant_id, authorization_source,
                    entitlement_snapshot_json, started_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                activity_id, player_id, kind, client_id,
                selected["id"] if selected else None, source,
                json.dumps(snapshot, separators=(",", ":"), sort_keys=True), _iso(_utc_now()),
            ))
            row = database.execute(
                "SELECT * FROM play_activities WHERE id = ?", (activity_id,)
            ).fetchone()
            self._audit(database, "PLAY_STARTED", actor=player_id, subject=player_id,
                        entity_type="play_activity", entity_id=activity_id,
                        detail={"activity_kind": kind, "authorization_source": source})
        return self._activity_payload(row)

    @staticmethod
    def _activity_payload(row: sqlite3.Row) -> dict[str, Any]:
        return {"id": row["id"], "activity_kind": row["activity_kind"],
                "client_activity_id": row["client_activity_id"],
                "authorization_source": row["authorization_source"],
                "started_at": row["started_at"], "completed_at": row["completed_at"]}

    def validate_activity(self, player_id: int, activity_id: Any, activity_kind: str) -> bool:
        if not activity_id:
            return self.enforcement != "enforced"
        with self._connect() as database:
            row = database.execute("""
                SELECT 1 FROM play_activities
                WHERE id = ? AND player_id = ? AND activity_kind = ?
            """, (str(activity_id), player_id, str(activity_kind).upper())).fetchone()
        return row is not None

    def _coach_subscription(
        self, database: sqlite3.Connection, coach_id: int, *, require_active: bool = False
    ) -> sqlite3.Row:
        now = _utc_now()
        rows = database.execute("""
            SELECT *, status AS subscription_status FROM subscriptions
            WHERE holder_player_id = ? AND plan = 'COACH'
            ORDER BY created_at DESC
        """, (coach_id,)).fetchall()
        for row in rows:
            if require_active and row["status"] != "ACTIVE":
                continue
            if self._subscription_valid(row, now, True):
                return row
        raise LicenseError("an active Jetta Coach subscription is required")

    def _active_seat_count(self, database: sqlite3.Connection, subscription_id: str) -> int:
        return int(database.execute("""
            SELECT COUNT(*) FROM coach_seat_assignments
            WHERE coach_subscription_id = ? AND status = 'ACTIVE'
        """, (subscription_id,)).fetchone()[0])

    def create_coach_invitation(
        self, coach_id: int, *, player_id: int | None = None, email: str | None = None
    ) -> dict[str, Any]:
        clean_email = str(email or "").strip().lower() or None
        if player_id is None and clean_email is None:
            raise LicenseError("choose an existing player or enter an email address")
        stamp = _iso(_utc_now())
        with self._connect() as database:
            database.execute("BEGIN IMMEDIATE")
            subscription = self._coach_subscription(database, coach_id, require_active=True)
            if self._active_seat_count(database, subscription["id"]) >= self.coach_seat_capacity:
                raise LicenseError("all sponsored student seats are currently occupied")
            if player_id is not None:
                if player_id == coach_id:
                    raise LicenseError("a Coach cannot invite their own player account")
                target = database.execute(
                    "SELECT id, email FROM players WHERE id = ?", (player_id,)
                ).fetchone()
                if target is None:
                    raise LicenseError("player was not found")
                clean_email = clean_email or str(target["email"] or "").strip().lower() or None
                duplicate = database.execute("""
                    SELECT 1 FROM coach_invitations
                    WHERE coach_id = ? AND invited_player_id = ? AND status = 'PENDING'
                """, (coach_id, player_id)).fetchone()
            else:
                duplicate = database.execute("""
                    SELECT 1 FROM coach_invitations
                    WHERE coach_id = ? AND lower(invited_email) = ? AND status = 'PENDING'
                """, (coach_id, clean_email)).fetchone()
            if duplicate:
                raise LicenseError("a pending invitation already exists for this player")
            relationship_id = None
            if player_id is not None:
                relationship_id = _new_id("relationship")
                database.execute("""
                    INSERT INTO coach_student_relationships(
                        id, coach_id, player_id, status, created_at
                    ) VALUES (?, ?, ?, 'INVITED', ?)
                """, (relationship_id, coach_id, player_id, stamp))
            raw_token = f"JINV-{secrets.token_urlsafe(24)}"
            invitation_id = _new_id("invitation")
            canonical = _canonical_code(raw_token)
            database.execute("""
                INSERT INTO coach_invitations(
                    id, relationship_id, coach_id, invited_player_id, invited_email,
                    token_hash, token_hint, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
            """, (invitation_id, relationship_id, coach_id, player_id, clean_email,
                  _hash_code(raw_token), canonical[-6:], stamp))
            self._audit(database, "COACH_INVITATION_CREATED", actor=coach_id,
                        subject=player_id, entity_type="coach_invitation", entity_id=invitation_id)
        return {"id": invitation_id, "token": raw_token, "token_hint": canonical[-6:],
                "player_id": player_id, "email": clean_email, "created_at": stamp}

    @staticmethod
    def _invitation_matches_player(
        invitation: sqlite3.Row, player_id: int, player_email: str | None
    ) -> bool:
        if invitation["invited_player_id"] is not None:
            return invitation["invited_player_id"] == player_id
        return bool(player_email and str(invitation["invited_email"] or "").casefold()
                    == player_email.casefold())

    def _assign_seat(
        self,
        database: sqlite3.Connection,
        subscription: sqlite3.Row,
        coach_id: int,
        player_id: int,
        relationship_id: str,
        stamp: str,
    ) -> str:
        if self._active_seat_count(database, subscription["id"]) >= self.coach_seat_capacity:
            raise LicenseError("all sponsored student seats are currently occupied")
        seat_id = _new_id("seat")
        database.execute("""
            INSERT INTO coach_seat_assignments(
                id, coach_subscription_id, coach_id, player_id, relationship_id,
                status, assigned_at
            ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?)
        """, (seat_id, subscription["id"], coach_id, player_id, relationship_id, stamp))
        database.execute("""
            INSERT INTO entitlement_grants(
                id, player_id, grant_type, subscription_id, sponsoring_coach_id,
                seat_assignment_id, status, starts_at, created_at
            ) VALUES (?, ?, 'COACH_SPONSORED', ?, ?, ?, 'ACTIVE', ?, ?)
        """, (_new_id("grant"), player_id, subscription["id"], coach_id, seat_id, stamp, stamp))
        return seat_id

    def accept_coach_invitation(self, player_id: int, invitation_id: str) -> dict[str, Any]:
        stamp = _iso(_utc_now())
        with self._connect() as database:
            database.execute("BEGIN IMMEDIATE")
            invitation = database.execute(
                "SELECT * FROM coach_invitations WHERE id = ?", (invitation_id,)
            ).fetchone()
            player = database.execute(
                "SELECT email FROM players WHERE id = ?", (player_id,)
            ).fetchone()
            if invitation is None or invitation["status"] != "PENDING":
                raise LicenseError("pending Coach invitation was not found")
            if player is None or not self._invitation_matches_player(
                invitation, player_id, player["email"]
            ):
                raise LicenseError("this Coach invitation belongs to another player")
            if database.execute("""
                SELECT 1 FROM coach_student_relationships
                WHERE player_id = ? AND status = 'ACTIVE'
            """, (player_id,)).fetchone():
                raise LicenseError("end the current Coach relationship before accepting another")
            relationship_id = invitation["relationship_id"] or _new_id("relationship")
            if invitation["relationship_id"]:
                database.execute("""
                    UPDATE coach_student_relationships
                    SET status = 'ACTIVE', started_at = ? WHERE id = ?
                """, (stamp, relationship_id))
            else:
                database.execute("""
                    INSERT INTO coach_student_relationships(
                        id, coach_id, player_id, status, started_at, created_at
                    ) VALUES (?, ?, ?, 'ACTIVE', ?, ?)
                """, (relationship_id, invitation["coach_id"], player_id,
                      stamp, invitation["created_at"]))
                database.execute(
                    "UPDATE coach_invitations SET relationship_id = ? WHERE id = ?",
                    (relationship_id, invitation_id),
                )
            database.execute("""
                UPDATE coach_invitations SET status = 'ACCEPTED', responded_at = ? WHERE id = ?
            """, (stamp, invitation_id))
            sponsored = False
            seat_id = None
            try:
                subscription = self._coach_subscription(database, invitation["coach_id"])
            except LicenseError:
                subscription = None
            if subscription is not None and (
                self._active_seat_count(database, subscription["id"])
                < self.coach_seat_capacity
            ):
                seat_id = self._assign_seat(
                    database, subscription, invitation["coach_id"], player_id,
                    relationship_id, stamp,
                )
                sponsored = True
            self._audit(database, "COACH_INVITATION_ACCEPTED", actor=player_id,
                        subject=player_id, entity_type="coach_relationship",
                        entity_id=relationship_id,
                        detail={"coach_id": invitation["coach_id"], "sponsored": sponsored})
        return {"relationship_id": relationship_id, "sponsored": sponsored,
                "seat_id": seat_id, "access": self.access_summary(player_id)}

    def decline_coach_invitation(self, player_id: int, invitation_id: str) -> None:
        stamp = _iso(_utc_now())
        with self._connect() as database:
            database.execute("BEGIN IMMEDIATE")
            invitation = database.execute(
                "SELECT * FROM coach_invitations WHERE id = ?", (invitation_id,)
            ).fetchone()
            player = database.execute(
                "SELECT email FROM players WHERE id = ?", (player_id,)
            ).fetchone()
            if invitation is None or invitation["status"] != "PENDING" or player is None \
                    or not self._invitation_matches_player(invitation, player_id, player["email"]):
                raise LicenseError("pending Coach invitation was not found")
            database.execute("""
                UPDATE coach_invitations SET status = 'DECLINED', responded_at = ? WHERE id = ?
            """, (stamp, invitation_id))
            if invitation["relationship_id"]:
                database.execute("""
                    UPDATE coach_student_relationships
                    SET status = 'ENDED', ended_at = ? WHERE id = ? AND status = 'INVITED'
                """, (stamp, invitation["relationship_id"]))

    def cancel_coach_invitation(self, coach_id: int, invitation_id: str) -> None:
        stamp = _iso(_utc_now())
        with self._connect() as database:
            database.execute("BEGIN IMMEDIATE")
            invitation = database.execute("""
                SELECT * FROM coach_invitations
                WHERE id = ? AND coach_id = ? AND status = 'PENDING'
            """, (invitation_id, coach_id)).fetchone()
            if invitation is None:
                raise LicenseError("pending Coach invitation was not found")
            database.execute("""
                UPDATE coach_invitations SET status = 'CANCELLED', responded_at = ? WHERE id = ?
            """, (stamp, invitation_id))
            if invitation["relationship_id"]:
                database.execute("""
                    UPDATE coach_student_relationships
                    SET status = 'ENDED', ended_at = ? WHERE id = ? AND status = 'INVITED'
                """, (stamp, invitation["relationship_id"]))

    def assign_sponsorship(self, coach_id: int, relationship_id: str) -> dict[str, Any]:
        stamp = _iso(_utc_now())
        with self._connect() as database:
            database.execute("BEGIN IMMEDIATE")
            relationship = database.execute("""
                SELECT * FROM coach_student_relationships
                WHERE id = ? AND coach_id = ? AND status = 'ACTIVE'
            """, (relationship_id, coach_id)).fetchone()
            if relationship is None:
                raise LicenseError("active coaching relationship was not found")
            subscription = self._coach_subscription(database, coach_id, require_active=True)
            seat_id = self._assign_seat(database, subscription, coach_id,
                                        relationship["player_id"], relationship_id, stamp)
            self._audit(database, "COACH_SEAT_ASSIGNED", actor=coach_id,
                        subject=relationship["player_id"], entity_type="coach_seat",
                        entity_id=seat_id)
        return {"relationship_id": relationship_id, "seat_id": seat_id}

    def release_sponsorship(self, coach_id: int, relationship_id: str) -> dict[str, Any]:
        stamp = _iso(_utc_now())
        with self._connect() as database:
            database.execute("BEGIN IMMEDIATE")
            seat = database.execute("""
                SELECT * FROM coach_seat_assignments
                WHERE relationship_id = ? AND coach_id = ? AND status = 'ACTIVE'
            """, (relationship_id, coach_id)).fetchone()
            if seat is None:
                raise LicenseError("active sponsored seat was not found")
            database.execute("""
                UPDATE coach_seat_assignments
                SET status = 'RELEASED', released_at = ? WHERE id = ?
            """, (stamp, seat["id"]))
            database.execute("""
                UPDATE entitlement_grants SET status = 'ENDED', ended_at = ?
                WHERE seat_assignment_id = ? AND status = 'ACTIVE'
            """, (stamp, seat["id"]))
            self._audit(database, "COACH_SEAT_RELEASED", actor=coach_id,
                        subject=seat["player_id"], entity_type="coach_seat", entity_id=seat["id"])
        return {"relationship_id": relationship_id, "seat_id": seat["id"], "released": True}

    def end_coach_relationship(self, actor_player_id: int, relationship_id: str) -> dict[str, Any]:
        stamp = _iso(_utc_now())
        with self._connect() as database:
            database.execute("BEGIN IMMEDIATE")
            relationship = database.execute("""
                SELECT * FROM coach_student_relationships
                WHERE id = ? AND status = 'ACTIVE' AND (coach_id = ? OR player_id = ?)
            """, (relationship_id, actor_player_id, actor_player_id)).fetchone()
            if relationship is None:
                raise LicenseError("active coaching relationship was not found")
            seats = database.execute("""
                SELECT id FROM coach_seat_assignments
                WHERE relationship_id = ? AND status = 'ACTIVE'
            """, (relationship_id,)).fetchall()
            for seat in seats:
                database.execute("""
                    UPDATE coach_seat_assignments
                    SET status = 'RELEASED', released_at = ? WHERE id = ?
                """, (stamp, seat["id"]))
                database.execute("""
                    UPDATE entitlement_grants SET status = 'ENDED', ended_at = ?
                    WHERE seat_assignment_id = ? AND status = 'ACTIVE'
                """, (stamp, seat["id"]))
            database.execute("""
                UPDATE coach_student_relationships SET status = 'ENDED', ended_at = ? WHERE id = ?
            """, (stamp, relationship_id))
            self._audit(database, "COACH_RELATIONSHIP_ENDED", actor=actor_player_id,
                        subject=relationship["player_id"], entity_type="coach_relationship",
                        entity_id=relationship_id)
        return {"relationship_id": relationship_id, "ended": True}

    def coach_dashboard(self, coach_id: int) -> dict[str, Any]:
        with self._connect() as database:
            subscription = self._coach_subscription(database, coach_id)
            rows = database.execute("""
                SELECT r.id AS relationship_id, r.player_id,
                       r.status AS relationship_status, r.started_at,
                       p.display_name AS player_name, p.email,
                       s.id AS seat_id, s.status AS seat_status
                FROM coach_student_relationships r
                JOIN players p ON p.id = r.player_id
                LEFT JOIN coach_seat_assignments s
                    ON s.relationship_id = r.id AND s.status = 'ACTIVE'
                WHERE r.coach_id = ? AND r.status = 'ACTIVE'
                ORDER BY lower(p.display_name)
            """, (coach_id,)).fetchall()
            pending = database.execute("""
                SELECT id, invited_player_id, invited_email, token_hint, created_at
                FROM coach_invitations
                WHERE coach_id = ? AND status = 'PENDING' ORDER BY created_at DESC
            """, (coach_id,)).fetchall()
            students = []
            for row in rows:
                item = dict(row)
                item["grants"] = [
                    grant["type"] for grant in self._valid_grants(database, row["player_id"])
                ]
                students.append(item)
        sponsored = sum(1 for item in students if item["seat_status"] == "ACTIVE")
        return {"subscription_id": subscription["id"], "students": students,
                "pending_invitations": [dict(row) for row in pending],
                "sponsored_students": sponsored,
                "seat_capacity": self.coach_seat_capacity,
                "seats_available": self.coach_seat_capacity - sponsored}

    def record_billing_event(
        self, provider: str, provider_event_id: str, event_type: str, *, processed: bool = False
    ) -> bool:
        """Reserve the idempotent event seam used by the future Stripe adapter."""
        normalized = str(provider).upper()
        if normalized not in {"ACCESS_CODE", "STRIPE"}:
            raise LicenseError("billing provider is invalid")
        stamp = _iso(_utc_now())
        with self._connect() as database:
            cursor = database.execute("""
                INSERT OR IGNORE INTO billing_events(
                    id, billing_provider, provider_event_id, event_type,
                    processing_status, received_at, processed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (_new_id("billing"), normalized, str(provider_event_id), str(event_type),
                  "PROCESSED" if processed else "RECEIVED", stamp, stamp if processed else None))
        return cursor.rowcount == 1
