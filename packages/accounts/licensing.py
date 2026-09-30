"""Server-authoritative Jetta licensing and play authorization."""

from __future__ import annotations

import hashlib
import json
import math
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
COACH_INVITATION_CREATE_LIMIT = 20
COACH_INVITATION_RESEND_LIMIT = 5
COACH_INVITATION_RESEND_COOLDOWN_SECONDS = 60
CONTINUATION_OFFER_CODE = "STUDENT_CONTINUATION"
CONTINUATION_OFFER_VERSION = "STUDENT_CONTINUATION_USD_2026_01"
NOTIFICATION_TYPES = {
    "COACH_GRACE_DAILY",
    "STUDENT_GRACE_STARTED",
    "COACH_GRACE_EXPIRED",
    "STUDENT_SPONSORSHIP_ENDED",
}


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


def _normalize_email(value: Any) -> str | None:
    email = str(value or "").strip().lower()
    if not email:
        return None
    if len(email) > 254 or email.count("@") != 1 or any(character.isspace() for character in email):
        raise LicenseError("enter a valid student email address")
    local, domain = email.split("@", 1)
    if not local or "." not in domain or domain.startswith(".") or domain.endswith("."):
        raise LicenseError("enter a valid student email address")
    return email


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
                CREATE TABLE IF NOT EXISTS subscription_grace_cycles (
                    id TEXT PRIMARY KEY,
                    subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
                    started_at TEXT NOT NULL,
                    deadline_snapshot_at TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'RESTORED', 'EXPIRED')),
                    closed_at TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE UNIQUE INDEX IF NOT EXISTS one_active_grace_cycle_per_subscription
                    ON subscription_grace_cycles(subscription_id) WHERE status = 'ACTIVE';
                CREATE INDEX IF NOT EXISTS grace_cycles_subscription_history
                    ON subscription_grace_cycles(subscription_id, started_at DESC);
                CREATE TABLE IF NOT EXISTS license_notifications (
                    id TEXT PRIMARY KEY,
                    subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
                    grace_cycle_id TEXT NOT NULL REFERENCES subscription_grace_cycles(id) ON DELETE RESTRICT,
                    recipient_player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
                    recipient_email TEXT,
                    notification_type TEXT NOT NULL CHECK(notification_type IN (
                        'COACH_GRACE_DAILY', 'STUDENT_GRACE_STARTED',
                        'COACH_GRACE_EXPIRED', 'STUDENT_SPONSORSHIP_ENDED'
                    )),
                    window_key TEXT NOT NULL,
                    window_number INTEGER,
                    due_at TEXT NOT NULL,
                    window_ends_at TEXT,
                    status TEXT NOT NULL CHECK(status IN (
                        'PENDING', 'CLAIMED', 'FAILED', 'SENT',
                        'MISSED', 'CANCELLED', 'NO_ADDRESS'
                    )),
                    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
                    next_attempt_at TEXT,
                    claimed_at TEXT,
                    claim_token TEXT,
                    last_attempt_at TEXT,
                    sent_at TEXT,
                    provider TEXT,
                    provider_message_id TEXT,
                    provider_request_id TEXT,
                    last_error_code TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(grace_cycle_id, notification_type, recipient_player_id, window_key)
                );
                CREATE INDEX IF NOT EXISTS license_notifications_due
                    ON license_notifications(status, due_at, next_attempt_at);
                CREATE INDEX IF NOT EXISTS license_notifications_cycle
                    ON license_notifications(grace_cycle_id, created_at);
                CREATE TABLE IF NOT EXISTS continuation_eligibilities (
                    id TEXT PRIMARY KEY,
                    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
                    offer_code TEXT NOT NULL CHECK(offer_code = 'STUDENT_CONTINUATION'),
                    offer_version TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('ELIGIBLE', 'REVOKED')),
                    qualified_at TEXT NOT NULL,
                    source_relationship_id TEXT REFERENCES coach_student_relationships(id) ON DELETE RESTRICT,
                    source_seat_assignment_id TEXT REFERENCES coach_seat_assignments(id) ON DELETE RESTRICT,
                    source_grant_id TEXT REFERENCES entitlement_grants(id) ON DELETE RESTRICT,
                    source_coach_subscription_id TEXT REFERENCES subscriptions(id) ON DELETE RESTRICT,
                    revoked_at TEXT,
                    revoked_by_player_id INTEGER REFERENCES players(id) ON DELETE RESTRICT,
                    correction_reason TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(player_id, offer_code)
                );
                CREATE INDEX IF NOT EXISTS continuation_eligibility_status
                    ON continuation_eligibilities(status, qualified_at);
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
            if database.execute(
                "SELECT 1 FROM license_schema_migrations WHERE version = 2"
            ).fetchone() is None:
                self._migrate_phase_a(database, stamp)
                database.execute(
                    "INSERT INTO license_schema_migrations(version, applied_at) VALUES (2, ?)",
                    (stamp,),
                )

    def _migrate_phase_a(self, database: sqlite3.Connection, stamp: str) -> None:
        """Backfill Phase A evidence without sending retroactive student notices."""
        now = _parse_time(stamp) or _utc_now()
        rows = database.execute("""
            SELECT * FROM subscriptions
            WHERE plan = 'COACH' AND status = 'PAST_DUE' AND grace_ends_at IS NOT NULL
        """).fetchall()
        for subscription in rows:
            deadline = _parse_time(subscription["grace_ends_at"])
            if deadline is None or deadline <= now:
                continue
            started = deadline - timedelta(days=self.coach_grace_days)
            cycle = self._start_grace_cycle(
                database, subscription, started, deadline, queue_student_start=False,
            )
            self._mark_elapsed_windows_missed(database, cycle["id"], now)

        grants = database.execute("""
            SELECT g.*, a.relationship_id
            FROM entitlement_grants g
            LEFT JOIN coach_seat_assignments a ON a.id = g.seat_assignment_id
            WHERE g.grant_type = 'COACH_SPONSORED'
            ORDER BY g.player_id, g.starts_at, g.created_at, g.id
        """).fetchall()
        seen: set[int] = set()
        for grant in grants:
            if grant["player_id"] in seen:
                continue
            seen.add(grant["player_id"])
            self._grant_continuation_eligibility(
                database, grant["player_id"], grant, grant["starts_at"],
                relationship_id=grant["relationship_id"], source="SCHEMA_V2_BACKFILL",
            )

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

    @staticmethod
    def _days_remaining(deadline: str | None, now: datetime | None = None) -> int | None:
        parsed = _parse_time(deadline)
        if parsed is None:
            return None
        remaining = (parsed - (now or _utc_now())).total_seconds()
        return max(0, math.ceil(remaining / 86400))

    @staticmethod
    def _active_grace_cycle(
        database: sqlite3.Connection, subscription_id: str
    ) -> sqlite3.Row | None:
        return database.execute("""
            SELECT * FROM subscription_grace_cycles
            WHERE subscription_id = ? AND status = 'ACTIVE'
            ORDER BY started_at DESC LIMIT 1
        """, (subscription_id,)).fetchone()

    def _queue_notification(
        self,
        database: sqlite3.Connection,
        *,
        subscription_id: str,
        grace_cycle_id: str,
        recipient_player_id: int,
        notification_type: str,
        window_key: str,
        due_at: datetime,
        window_ends_at: datetime | None,
        window_number: int | None = None,
    ) -> None:
        if notification_type not in NOTIFICATION_TYPES:
            raise LicenseError("notification type is invalid")
        player = database.execute(
            "SELECT email FROM players WHERE id = ?", (recipient_player_id,)
        ).fetchone()
        email = str(player["email"] or "").strip().lower() if player else ""
        status = "PENDING" if email and "@" in email else "NO_ADDRESS"
        stamp = _iso(_utc_now())
        database.execute("""
            INSERT OR IGNORE INTO license_notifications(
                id, subscription_id, grace_cycle_id, recipient_player_id,
                recipient_email, notification_type, window_key, window_number,
                due_at, window_ends_at, status, last_error_code, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            _new_id("notice"), subscription_id, grace_cycle_id, recipient_player_id,
            email or None, notification_type, window_key, window_number,
            _iso(due_at), _iso(window_ends_at) if window_ends_at else None,
            status, "NO_ADDRESS" if status == "NO_ADDRESS" else None, stamp, stamp,
        ))

    def _start_grace_cycle(
        self,
        database: sqlite3.Connection,
        subscription: sqlite3.Row,
        started_at: datetime,
        grace_ends_at: datetime,
        *,
        queue_student_start: bool = True,
    ) -> sqlite3.Row:
        existing = self._active_grace_cycle(database, subscription["id"])
        if existing is not None:
            return existing
        stamp = _iso(_utc_now())
        cycle_id = _new_id("grace")
        database.execute("""
            INSERT INTO subscription_grace_cycles(
                id, subscription_id, started_at, deadline_snapshot_at,
                status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)
        """, (
            cycle_id, subscription["id"], _iso(started_at), _iso(grace_ends_at),
            stamp, stamp,
        ))
        duration = max(0.0, (grace_ends_at - started_at).total_seconds())
        window_count = min(30, max(1, math.ceil(duration / 86400)))
        for number in range(1, window_count + 1):
            due = started_at + timedelta(days=number - 1)
            window_end = min(started_at + timedelta(days=number), grace_ends_at)
            self._queue_notification(
                database,
                subscription_id=subscription["id"], grace_cycle_id=cycle_id,
                recipient_player_id=subscription["holder_player_id"],
                notification_type="COACH_GRACE_DAILY",
                window_key=f"day-{number:02d}", window_number=number,
                due_at=due, window_ends_at=window_end,
            )
        if queue_student_start:
            students = database.execute("""
                SELECT DISTINCT player_id FROM coach_seat_assignments
                WHERE coach_subscription_id = ? AND status = 'ACTIVE'
            """, (subscription["id"],)).fetchall()
            for student in students:
                self._queue_notification(
                    database,
                    subscription_id=subscription["id"], grace_cycle_id=cycle_id,
                    recipient_player_id=student["player_id"],
                    notification_type="STUDENT_GRACE_STARTED",
                    window_key="grace-start", due_at=started_at,
                    window_ends_at=min(started_at + timedelta(days=1), grace_ends_at),
                )
        self._audit(
            database, "COACH_GRACE_STARTED", subject=subscription["holder_player_id"],
            entity_type="grace_cycle", entity_id=cycle_id,
            detail={"subscription_id": subscription["id"], "started_at": _iso(started_at),
                    "grace_ends_at": _iso(grace_ends_at),
                    "billing_provider": subscription["billing_provider"]},
        )
        return database.execute(
            "SELECT * FROM subscription_grace_cycles WHERE id = ?", (cycle_id,)
        ).fetchone()

    def _close_grace_cycle(
        self,
        database: sqlite3.Connection,
        subscription: sqlite3.Row,
        status: str,
        closed_at: datetime,
    ) -> sqlite3.Row | None:
        cycle = self._active_grace_cycle(database, subscription["id"])
        if cycle is None:
            return None
        stamp = _iso(closed_at)
        database.execute("""
            UPDATE subscription_grace_cycles
            SET status = ?, closed_at = ?, updated_at = ?
            WHERE id = ? AND status = 'ACTIVE'
        """, (status, stamp, stamp, cycle["id"]))
        if status == "RESTORED":
            database.execute("""
                UPDATE license_notifications
                SET status = 'CANCELLED', claim_token = NULL, claimed_at = NULL,
                    updated_at = ?
                WHERE grace_cycle_id = ? AND status IN ('PENDING', 'FAILED', 'CLAIMED')
            """, (stamp, cycle["id"]))
        return cycle

    def _grant_continuation_eligibility(
        self,
        database: sqlite3.Connection,
        player_id: int,
        grant: sqlite3.Row | dict[str, Any],
        qualified_at: str,
        *,
        relationship_id: str | None = None,
        source: str = "SPONSORED_GRANT",
    ) -> bool:
        existing = database.execute("""
            SELECT id FROM continuation_eligibilities
            WHERE player_id = ? AND offer_code = ?
        """, (player_id, CONTINUATION_OFFER_CODE)).fetchone()
        if existing is not None:
            return False
        eligibility_id = _new_id("eligibility")
        stamp = _iso(_utc_now())
        database.execute("""
            INSERT INTO continuation_eligibilities(
                id, player_id, offer_code, offer_version, status, qualified_at,
                source_relationship_id, source_seat_assignment_id, source_grant_id,
                source_coach_subscription_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'ELIGIBLE', ?, ?, ?, ?, ?, ?, ?)
        """, (
            eligibility_id, player_id, CONTINUATION_OFFER_CODE,
            CONTINUATION_OFFER_VERSION, qualified_at, relationship_id,
            grant["seat_assignment_id"], grant["id"], grant["subscription_id"],
            stamp, stamp,
        ))
        self._audit(
            database, "CONTINUATION_ELIGIBILITY_GRANTED", subject=player_id,
            entity_type="continuation_eligibility", entity_id=eligibility_id,
            detail={"offer_code": CONTINUATION_OFFER_CODE,
                    "offer_version": CONTINUATION_OFFER_VERSION,
                    "source": source, "source_grant_id": grant["id"]},
        )
        return True

    def _mark_elapsed_windows_missed(
        self, database: sqlite3.Connection, grace_cycle_id: str | None, now: datetime
    ) -> int:
        stamp = _iso(now)
        clauses = ["status IN ('PENDING', 'FAILED')", "window_ends_at IS NOT NULL",
                   "window_ends_at <= ?"]
        parameters: list[Any] = [stamp]
        if grace_cycle_id:
            clauses.append("grace_cycle_id = ?")
            parameters.append(grace_cycle_id)
        cursor = database.execute(f"""
            UPDATE license_notifications SET status = 'MISSED', updated_at = ?
            WHERE {' AND '.join(clauses)}
        """, [stamp, *parameters])
        return cursor.rowcount

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
        self.reconcile_subscription_lifecycle()
        with self._connect() as database:
            grants = self._valid_grants(database, player_id)
            coach = database.execute("""
                SELECT r.id AS relationship_id, r.coach_id, p.display_name AS coach_name,
                       r.started_at, a.id AS seat_id, a.status AS seat_status,
                       a.released_at, s.id AS coach_subscription_id,
                       s.status AS coach_subscription_status, s.grace_ends_at
                FROM coach_student_relationships r
                JOIN players p ON p.id = r.coach_id
                LEFT JOIN coach_seat_assignments a ON a.id = (
                    SELECT id FROM coach_seat_assignments
                    WHERE relationship_id = r.id ORDER BY assigned_at DESC LIMIT 1
                )
                LEFT JOIN subscriptions s ON s.id = a.coach_subscription_id
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
            eligibility = database.execute("""
                SELECT id, offer_code, offer_version, status, qualified_at,
                       revoked_at, correction_reason
                FROM continuation_eligibilities
                WHERE player_id = ? AND offer_code = ?
            """, (player_id, CONTINUATION_OFFER_CODE)).fetchone()
        coach_context = dict(coach) if coach else None
        coach_payload = ({
            "relationship_id": coach_context["relationship_id"],
            "coach_id": coach_context["coach_id"],
            "coach_name": coach_context["coach_name"],
            "started_at": coach_context["started_at"],
        } if coach_context else None)
        sponsorship = None
        if coach_context:
            seat_status = coach_context.get("seat_status")
            subscription_status = coach_context.get("coach_subscription_status")
            if seat_status == "ACTIVE" and subscription_status == "PAST_DUE":
                status = "GRACE"
            elif seat_status == "ACTIVE" and subscription_status == "ACTIVE":
                status = "ACTIVE"
            elif seat_status in {"RELEASED", "CANCELLED"}:
                status = "ENDED"
            else:
                status = "UNSPONSORED"
            sponsorship = {
                "status": status,
                "coach_name": coach_context["coach_name"],
                "grace_ends_at": coach_context.get("grace_ends_at") if status == "GRACE" else None,
            }
        continuation = {
            "eligible": bool(eligibility and eligibility["status"] == "ELIGIBLE"),
            "status": eligibility["status"] if eligibility else "NOT_ELIGIBLE",
            "activation_available": False,
        }
        if eligibility and eligibility["status"] == "ELIGIBLE":
            continuation.update({
                "offer_code": CONTINUATION_OFFER_CODE,
                "offer_version": eligibility["offer_version"],
                "qualified_at": eligibility["qualified_at"],
                "display_monthly_usd": 9,
                "display_annual_usd": 49,
            })
        return {
            "play_access": "ACTIVE" if grants else "HISTORICAL_ONLY",
            "can_start_new_play": bool(grants) or self.enforcement != "enforced",
            "enforcement": self.enforcement,
            "grants": grants,
            "roles": self.roles(player_id),
            "current_coach": coach_payload,
            "coach_sponsorship": sponsorship,
            "continuation": continuation,
            "pending_invitations": [dict(row) for row in invitations],
        }

    def entitlement_diagnostic(self, player_id: int) -> dict[str, Any]:
        """Explain entitlement and runtime policy without authorizing activity."""
        self.reconcile_subscription_lifecycle()
        with self._connect() as database:
            player = database.execute(
                "SELECT id FROM players WHERE id = ?", (player_id,)
            ).fetchone()
            if player is None:
                raise LicenseError("player account was not found")
            valid_grants = self._valid_grants(database, player_id)
            relationship = database.execute("""
                SELECT r.id, r.coach_id, p.display_name AS coach_name, r.status,
                       r.started_at, s.id AS seat_id, s.status AS seat_status,
                       s.released_at
                FROM coach_student_relationships r
                JOIN players p ON p.id = r.coach_id
                LEFT JOIN coach_seat_assignments s ON s.id = (
                    SELECT id FROM coach_seat_assignments
                    WHERE relationship_id = r.id ORDER BY assigned_at DESC LIMIT 1
                )
                WHERE r.player_id = ? AND r.status = 'ACTIVE'
            """, (player_id,)).fetchone()
            grant_history = database.execute("""
                SELECT g.grant_type, g.status AS grant_status, g.expires_at,
                       g.ended_at, s.plan, s.billing_provider,
                       s.status AS subscription_status, s.current_period_end,
                       s.grace_ends_at, a.status AS seat_status
                FROM entitlement_grants g
                JOIN subscriptions s ON s.id = g.subscription_id
                LEFT JOIN coach_seat_assignments a ON a.id = g.seat_assignment_id
                WHERE g.player_id = ?
                ORDER BY g.created_at DESC LIMIT 25
            """, (player_id,)).fetchall()
        entitled = bool(valid_grants)
        runtime_allowed = entitled or self.enforcement != "enforced"
        if entitled:
            entitlement_reason = "At least one valid entitlement grant permits new play."
        else:
            entitlement_reason = "No valid entitlement grant permits new play."
        if runtime_allowed and not entitled:
            runtime_reason = f"Allowed by {self.enforcement}-mode policy."
        elif runtime_allowed:
            runtime_reason = "Allowed by a valid entitlement grant."
        else:
            runtime_reason = "Denied because enforcement is active and no valid grant exists."
        return {
            "entitlement_decision": "ALLOWED" if entitled else "DENIED",
            "entitlement_reason": entitlement_reason,
            "enforcement_mode": self.enforcement.upper(),
            "runtime_result": "ALLOWED" if runtime_allowed else "DENIED",
            "runtime_reason": runtime_reason,
            "valid_grants": valid_grants,
            "current_coach_relationship": dict(relationship) if relationship else None,
            "grant_history": [dict(row) for row in grant_history],
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
        self.reconcile_subscription_lifecycle()
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

    def transition_subscription(
        self,
        subscription_id: str,
        requested_status: str,
        *,
        effective_at: datetime | None = None,
    ) -> dict[str, Any]:
        """Normalize provider events into Jetta subscription state.

        A Coach cancellation, expiration, or payment failure begins the same
        configurable grace period. Individual plans do not receive Coach grace.
        """
        requested = str(requested_status).upper()
        if requested not in {"ACTIVE", "PAST_DUE", "CANCELLED", "EXPIRED"}:
            raise LicenseError("subscription status is invalid")
        now = effective_at or _utc_now()
        stamp = _iso(now)
        with self._connect() as database:
            database.execute("BEGIN IMMEDIATE")
            row = database.execute(
                "SELECT * FROM subscriptions WHERE id = ?", (subscription_id,)
            ).fetchone()
            if row is None:
                raise LicenseError("subscription was not found")
            previous_status = row["status"]
            status = requested
            grace_ends_at = row["grace_ends_at"]
            if requested == "ACTIVE":
                if previous_status == "PAST_DUE":
                    cycle = self._close_grace_cycle(database, row, "RESTORED", now)
                    if cycle:
                        self._audit(
                            database, "COACH_GRACE_RESTORED",
                            subject=row["holder_player_id"], entity_type="grace_cycle",
                            entity_id=cycle["id"],
                            detail={"subscription_id": subscription_id, "restored_at": stamp},
                        )
                grace_ends_at = None
            elif row["plan"] == "COACH":
                existing_grace = _parse_time(row["grace_ends_at"])
                if previous_status == "PAST_DUE" and existing_grace is not None:
                    if existing_grace <= now:
                        self._expire_coach_grace(database, row, now)
                        status = "EXPIRED"
                        grace_ends_at = row["grace_ends_at"]
                    else:
                        status = "PAST_DUE"
                        grace_ends_at = row["grace_ends_at"]
                else:
                    status = "PAST_DUE"
                    grace_deadline = now + timedelta(days=self.coach_grace_days)
                    grace_ends_at = _iso(grace_deadline)
                    database.execute("""
                        UPDATE subscriptions
                        SET status = 'PAST_DUE', grace_ends_at = ?, updated_at = ? WHERE id = ?
                    """, (grace_ends_at, stamp, subscription_id))
                    refreshed = database.execute(
                        "SELECT * FROM subscriptions WHERE id = ?", (subscription_id,)
                    ).fetchone()
                    self._start_grace_cycle(database, refreshed, now, grace_deadline)
            if not (row["plan"] == "COACH" and status == "EXPIRED"):
                database.execute("""
                    UPDATE subscriptions
                    SET status = ?, grace_ends_at = ?, updated_at = ? WHERE id = ?
                """, (status, grace_ends_at, stamp, subscription_id))
            self._audit(database, "SUBSCRIPTION_STATUS_CHANGED",
                        subject=row["holder_player_id"], entity_type="subscription",
                        entity_id=subscription_id,
                        detail={"requested_status": requested, "previous_status": previous_status,
                                "status": status,
                                "grace_ends_at": grace_ends_at})
        return {"id": subscription_id, "status": status, "grace_ends_at": grace_ends_at}

    def reconcile_subscription_lifecycle(self, at: datetime | None = None) -> int:
        """Apply period expiration and elapsed Coach grace without deleting history."""
        now = at or _utc_now()
        stamp = _iso(now)
        changed = 0
        with self._connect() as database:
            database.execute("BEGIN IMMEDIATE")
            rows = database.execute("""
                SELECT * FROM subscriptions WHERE status IN ('ACTIVE', 'PAST_DUE')
            """).fetchall()
            for row in rows:
                period_end = _parse_time(row["current_period_end"])
                grace_end = _parse_time(row["grace_ends_at"])
                if row["status"] == "ACTIVE" and period_end is not None and period_end <= now:
                    if row["plan"] == "COACH":
                        deadline = period_end + timedelta(days=self.coach_grace_days)
                        database.execute("""
                            UPDATE subscriptions SET status = 'PAST_DUE', grace_ends_at = ?,
                                updated_at = ? WHERE id = ? AND status = 'ACTIVE'
                        """, (_iso(deadline), stamp, row["id"]))
                        refreshed = database.execute(
                            "SELECT * FROM subscriptions WHERE id = ?", (row["id"],)
                        ).fetchone()
                        self._start_grace_cycle(database, refreshed, period_end, deadline)
                        changed += 1
                        if deadline <= now:
                            self._expire_coach_grace(database, refreshed, now)
                    else:
                        database.execute("""
                            UPDATE subscriptions SET status = 'EXPIRED', updated_at = ?
                            WHERE id = ? AND status = 'ACTIVE'
                        """, (stamp, row["id"]))
                        database.execute("""
                            UPDATE entitlement_grants SET status = 'ENDED', ended_at = ?
                            WHERE subscription_id = ? AND status = 'ACTIVE'
                        """, (stamp, row["id"]))
                        self._audit(database, "SUBSCRIPTION_LIFECYCLE_RECONCILED",
                                    subject=row["holder_player_id"], entity_type="subscription",
                                    entity_id=row["id"], detail={"status": "EXPIRED"})
                        changed += 1
                elif row["status"] == "PAST_DUE" and grace_end is not None and grace_end <= now:
                    self._expire_coach_grace(database, row, now)
                    changed += 1
            self._mark_elapsed_windows_missed(database, None, now)
        return changed

    def _expire_coach_grace(
        self, database: sqlite3.Connection, subscription: sqlite3.Row, now: datetime
    ) -> None:
        """Expire one Coach grace cycle after a protected state recheck."""
        current = database.execute(
            "SELECT * FROM subscriptions WHERE id = ?", (subscription["id"],)
        ).fetchone()
        deadline = _parse_time(current["grace_ends_at"]) if current else None
        if current is None or current["status"] != "PAST_DUE" or deadline is None or deadline > now:
            return
        cycle = self._active_grace_cycle(database, current["id"])
        if cycle is None:
            cycle = self._start_grace_cycle(
                database, current, deadline - timedelta(days=self.coach_grace_days), deadline,
                queue_student_start=False,
            )
        seats = database.execute("""
            SELECT a.id, a.player_id FROM coach_seat_assignments a
            WHERE a.coach_subscription_id = ? AND a.status = 'ACTIVE'
        """, (current["id"],)).fetchall()
        self._queue_notification(
            database, subscription_id=current["id"], grace_cycle_id=cycle["id"],
            recipient_player_id=current["holder_player_id"],
            notification_type="COACH_GRACE_EXPIRED", window_key="grace-expired",
            due_at=now, window_ends_at=now + timedelta(days=1),
        )
        for seat in seats:
            self._queue_notification(
                database, subscription_id=current["id"], grace_cycle_id=cycle["id"],
                recipient_player_id=seat["player_id"],
                notification_type="STUDENT_SPONSORSHIP_ENDED",
                window_key="grace-expired", due_at=now,
                window_ends_at=now + timedelta(days=1),
            )
        stamp = _iso(now)
        database.execute("""
            UPDATE subscriptions SET status = 'EXPIRED', updated_at = ?
            WHERE id = ? AND status = 'PAST_DUE'
        """, (stamp, current["id"]))
        self._close_grace_cycle(database, current, "EXPIRED", now)
        database.execute("""
            UPDATE license_notifications SET status = 'CANCELLED', updated_at = ?
            WHERE grace_cycle_id = ? AND notification_type IN (
                'COACH_GRACE_DAILY', 'STUDENT_GRACE_STARTED'
            ) AND status IN ('PENDING', 'FAILED', 'CLAIMED')
        """, (stamp, cycle["id"]))
        for seat in seats:
            database.execute("""
                UPDATE coach_seat_assignments SET status = 'RELEASED', released_at = ?
                WHERE id = ? AND status = 'ACTIVE'
            """, (stamp, seat["id"]))
            database.execute("""
                UPDATE entitlement_grants SET status = 'ENDED', ended_at = ?
                WHERE seat_assignment_id = ? AND status = 'ACTIVE'
            """, (stamp, seat["id"]))
            self._audit(
                database, "COACH_SEAT_RELEASED_AFTER_GRACE", subject=seat["player_id"],
                entity_type="coach_seat", entity_id=seat["id"],
                detail={"subscription_id": current["id"]},
            )
        database.execute("""
            UPDATE entitlement_grants SET status = 'ENDED', ended_at = ?
            WHERE subscription_id = ? AND grant_type = 'COACH_SELF' AND status = 'ACTIVE'
        """, (stamp, current["id"]))
        self._audit(
            database, "COACH_GRACE_EXPIRED", subject=current["holder_player_id"],
            entity_type="grace_cycle", entity_id=cycle["id"],
            detail={"subscription_id": current["id"],
                    "grace_ends_at": current["grace_ends_at"], "expired_at": stamp},
        )

    def claim_due_notifications(
        self,
        *,
        at: datetime | None = None,
        limit: int = 50,
        worker_id: str | None = None,
        claim_minutes: int = 15,
    ) -> list[dict[str, Any]]:
        now = at or _utc_now()
        stamp = _iso(now)
        stale = _iso(now - timedelta(minutes=max(1, claim_minutes)))
        batch = max(1, min(int(limit), 100))
        claimed: list[dict[str, Any]] = []
        with self._connect() as database:
            database.execute("BEGIN IMMEDIATE")
            self._mark_elapsed_windows_missed(database, None, now)
            database.execute("""
                UPDATE license_notifications
                SET status = 'FAILED', claim_token = NULL, claimed_at = NULL,
                    next_attempt_at = ?, last_error_code = 'STALE_CLAIM', updated_at = ?
                WHERE status = 'CLAIMED' AND claimed_at < ? AND attempt_count < 3
                  AND (window_ends_at IS NULL OR window_ends_at > ?)
            """, (stamp, stamp, stale, stamp))
            database.execute("""
                UPDATE license_notifications
                SET status = 'MISSED', claim_token = NULL, claimed_at = NULL, updated_at = ?
                WHERE status = 'CLAIMED' AND claimed_at < ? AND attempt_count >= 3
            """, (stamp, stale))
            candidates = database.execute("""
                SELECT n.*, p.display_name AS recipient_name,
                       s.holder_player_id AS coach_player_id,
                       coach.display_name AS coach_name,
                       s.billing_provider, s.status AS subscription_status,
                       s.grace_ends_at, c.status AS cycle_status
                FROM license_notifications n
                JOIN players p ON p.id = n.recipient_player_id
                JOIN subscriptions s ON s.id = n.subscription_id
                JOIN players coach ON coach.id = s.holder_player_id
                JOIN subscription_grace_cycles c ON c.id = n.grace_cycle_id
                WHERE n.status IN ('PENDING', 'FAILED')
                  AND n.attempt_count < 3
                  AND n.due_at <= ?
                  AND (n.next_attempt_at IS NULL OR n.next_attempt_at <= ?)
                  AND (n.window_ends_at IS NULL OR n.window_ends_at > ?)
                  AND (
                    (n.notification_type IN ('COACH_GRACE_DAILY', 'STUDENT_GRACE_STARTED')
                     AND s.status = 'PAST_DUE' AND c.status = 'ACTIVE')
                    OR
                    (n.notification_type IN ('COACH_GRACE_EXPIRED', 'STUDENT_SPONSORSHIP_ENDED')
                     AND s.status = 'EXPIRED' AND c.status = 'EXPIRED')
                  )
                ORDER BY n.due_at, n.id LIMIT ?
            """, (stamp, stamp, stamp, batch)).fetchall()
            for row in candidates:
                if not row["recipient_email"]:
                    database.execute("""
                        UPDATE license_notifications SET status = 'NO_ADDRESS',
                            last_error_code = 'NO_ADDRESS', updated_at = ? WHERE id = ?
                    """, (stamp, row["id"]))
                    continue
                token = f"{worker_id or 'worker'}-{secrets.token_urlsafe(18)}"
                changed = database.execute("""
                    UPDATE license_notifications
                    SET status = 'CLAIMED', claim_token = ?, claimed_at = ?,
                        last_attempt_at = ?, attempt_count = attempt_count + 1,
                        updated_at = ?
                    WHERE id = ? AND status IN ('PENDING', 'FAILED') AND attempt_count < 3
                """, (token, stamp, stamp, stamp, row["id"])).rowcount
                if changed:
                    item = dict(row)
                    item["claim_token"] = token
                    item["attempt_count"] = row["attempt_count"] + 1
                    item["days_remaining"] = self._days_remaining(row["grace_ends_at"], now)
                    claimed.append(item)
        return claimed

    def notification_claim_is_current(self, notification_id: str, claim_token: str) -> bool:
        with self._connect() as database:
            row = database.execute("""
                SELECT n.notification_type, n.status, n.claim_token,
                       s.status AS subscription_status, c.status AS cycle_status
                FROM license_notifications n
                JOIN subscriptions s ON s.id = n.subscription_id
                JOIN subscription_grace_cycles c ON c.id = n.grace_cycle_id
                WHERE n.id = ?
            """, (notification_id,)).fetchone()
        if row is None or row["status"] != "CLAIMED" or row["claim_token"] != claim_token:
            return False
        if row["notification_type"] in {"COACH_GRACE_DAILY", "STUDENT_GRACE_STARTED"}:
            return row["subscription_status"] == "PAST_DUE" and row["cycle_status"] == "ACTIVE"
        return row["subscription_status"] == "EXPIRED" and row["cycle_status"] == "EXPIRED"

    def cancel_notification_claim(self, notification_id: str, claim_token: str) -> None:
        with self._connect() as database:
            database.execute("""
                UPDATE license_notifications SET status = 'CANCELLED', claim_token = NULL,
                    claimed_at = NULL, updated_at = ?
                WHERE id = ? AND status = 'CLAIMED' AND claim_token = ?
            """, (_iso(_utc_now()), notification_id, claim_token))

    def complete_notification(
        self, notification_id: str, claim_token: str, delivery: dict[str, Any],
        *, at: datetime | None = None,
    ) -> None:
        now = at or _utc_now()
        stamp = _iso(now)
        with self._connect() as database:
            database.execute("BEGIN IMMEDIATE")
            row = database.execute("""
                SELECT * FROM license_notifications
                WHERE id = ? AND status = 'CLAIMED' AND claim_token = ?
            """, (notification_id, claim_token)).fetchone()
            if row is None:
                raise LicenseError("notification claim is no longer active")
            database.execute("""
                UPDATE license_notifications SET status = 'SENT', sent_at = ?,
                    provider = ?, provider_message_id = ?, provider_request_id = ?,
                    claim_token = NULL, claimed_at = NULL, last_error_code = NULL,
                    updated_at = ? WHERE id = ?
            """, (
                stamp, str(delivery.get("provider") or "SMTP2GO"),
                delivery.get("message_id"), delivery.get("request_id"), stamp,
                notification_id,
            ))
            event = (
                "COACH_GRACE_NOTIFICATION_SENT"
                if row["notification_type"] == "COACH_GRACE_DAILY"
                else "STUDENT_GRACE_NOTIFICATION_SENT"
                if row["notification_type"] == "STUDENT_GRACE_STARTED"
                else "STUDENT_SPONSORSHIP_ENDED_NOTIFICATION_SENT"
                if row["notification_type"] == "STUDENT_SPONSORSHIP_ENDED"
                else "COACH_GRACE_EXPIRATION_NOTIFICATION_SENT"
            )
            self._audit(
                database, event, subject=row["recipient_player_id"],
                entity_type="license_notification", entity_id=notification_id,
                detail={"grace_cycle_id": row["grace_cycle_id"],
                        "window_key": row["window_key"],
                        "provider_message_id": delivery.get("message_id")},
            )

    def fail_notification(
        self,
        notification_id: str,
        claim_token: str,
        error_code: str,
        *,
        at: datetime | None = None,
    ) -> None:
        now = at or _utc_now()
        stamp = _iso(now)
        clean_error = str(error_code or "DELIVERY_FAILED").upper()[:80]
        with self._connect() as database:
            database.execute("BEGIN IMMEDIATE")
            row = database.execute("""
                SELECT * FROM license_notifications
                WHERE id = ? AND status = 'CLAIMED' AND claim_token = ?
            """, (notification_id, claim_token)).fetchone()
            if row is None:
                raise LicenseError("notification claim is no longer active")
            window_end = _parse_time(row["window_ends_at"])
            if row["attempt_count"] >= 3 or (window_end is not None and window_end <= now):
                status, retry_at = "MISSED", None
            else:
                delay = timedelta(minutes=15) if row["attempt_count"] == 1 else timedelta(hours=1)
                candidate = now + delay
                if window_end is not None and candidate >= window_end:
                    status, retry_at = "MISSED", None
                else:
                    status, retry_at = "FAILED", _iso(candidate)
            database.execute("""
                UPDATE license_notifications SET status = ?, next_attempt_at = ?,
                    claim_token = NULL, claimed_at = NULL, last_error_code = ?,
                    updated_at = ? WHERE id = ?
            """, (status, retry_at, clean_error, stamp, notification_id))
            event = (
                "COACH_GRACE_NOTIFICATION_FAILED"
                if row["notification_type"] == "COACH_GRACE_DAILY"
                else "LICENSE_NOTIFICATION_FAILED"
            )
            self._audit(
                database, event, subject=row["recipient_player_id"],
                entity_type="license_notification", entity_id=notification_id,
                detail={"grace_cycle_id": row["grace_cycle_id"],
                        "window_key": row["window_key"], "error_code": clean_error,
                        "attempt": row["attempt_count"], "next_status": status},
            )

    def continuation_eligibility(self, player_id: int) -> dict[str, Any] | None:
        with self._connect() as database:
            row = database.execute("""
                SELECT * FROM continuation_eligibilities
                WHERE player_id = ? AND offer_code = ?
            """, (player_id, CONTINUATION_OFFER_CODE)).fetchone()
        return dict(row) if row else None

    def correct_continuation_eligibility(
        self, admin_id: int, player_id: int, status: str, reason: str
    ) -> dict[str, Any]:
        try:
            player_id = int(player_id)
        except (TypeError, ValueError) as error:
            raise LicenseError("player ID is invalid") from error
        if player_id < 1:
            raise LicenseError("player ID is invalid")
        normalized = str(status).upper()
        clean_reason = " ".join(str(reason or "").strip().split())
        if normalized not in {"ELIGIBLE", "REVOKED"}:
            raise LicenseError("eligibility status must be ELIGIBLE or REVOKED")
        if not 10 <= len(clean_reason) <= 500:
            raise LicenseError("correction reason must be between 10 and 500 characters")
        stamp = _iso(_utc_now())
        with self._connect() as database:
            database.execute("BEGIN IMMEDIATE")
            if database.execute("SELECT 1 FROM players WHERE id = ?", (player_id,)).fetchone() is None:
                raise LicenseError("player account was not found")
            row = database.execute("""
                SELECT * FROM continuation_eligibilities
                WHERE player_id = ? AND offer_code = ?
            """, (player_id, CONTINUATION_OFFER_CODE)).fetchone()
            if row is None:
                if normalized == "REVOKED":
                    raise LicenseError("continuation eligibility was not found")
                eligibility_id = _new_id("eligibility")
                database.execute("""
                    INSERT INTO continuation_eligibilities(
                        id, player_id, offer_code, offer_version, status, qualified_at,
                        correction_reason, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, 'ELIGIBLE', ?, ?, ?, ?)
                """, (eligibility_id, player_id, CONTINUATION_OFFER_CODE,
                      CONTINUATION_OFFER_VERSION, stamp, clean_reason, stamp, stamp))
                event = "CONTINUATION_ELIGIBILITY_GRANTED"
            else:
                eligibility_id = row["id"]
                database.execute("""
                    UPDATE continuation_eligibilities SET status = ?, revoked_at = ?,
                        revoked_by_player_id = ?, correction_reason = ?, updated_at = ?
                    WHERE id = ?
                """, (
                    normalized, stamp if normalized == "REVOKED" else None,
                    admin_id if normalized == "REVOKED" else None,
                    clean_reason, stamp, eligibility_id,
                ))
                event = (
                    "CONTINUATION_ELIGIBILITY_REVOKED"
                    if normalized == "REVOKED" else "CONTINUATION_ELIGIBILITY_RESTORED"
                )
            self._audit(
                database, event, actor=admin_id, subject=player_id,
                entity_type="continuation_eligibility", entity_id=eligibility_id,
                detail={"reason": clean_reason, "status": normalized,
                        "offer_version": CONTINUATION_OFFER_VERSION},
            )
            result = database.execute(
                "SELECT * FROM continuation_eligibilities WHERE id = ?", (eligibility_id,)
            ).fetchone()
        return dict(result)

    def notification_history(
        self, subscription_id: str, *, limit: int = 100
    ) -> list[dict[str, Any]]:
        with self._connect() as database:
            rows = database.execute("""
                SELECT id, subscription_id, grace_cycle_id, recipient_player_id,
                       recipient_email, notification_type, window_key, window_number,
                       due_at, window_ends_at, status, attempt_count, last_attempt_at,
                       sent_at, provider, provider_message_id, provider_request_id,
                       last_error_code, created_at, updated_at
                FROM license_notifications WHERE subscription_id = ?
                ORDER BY created_at DESC LIMIT ?
            """, (subscription_id, max(1, min(int(limit), 100)))).fetchall()
        return [dict(row) for row in rows]

    def _active_seat_count(self, database: sqlite3.Connection, subscription_id: str) -> int:
        return int(database.execute("""
            SELECT COUNT(*) FROM coach_seat_assignments
            WHERE coach_subscription_id = ? AND status = 'ACTIVE'
        """, (subscription_id,)).fetchone()[0])

    def create_coach_invitation(
        self, coach_id: int, *, player_id: int | None = None, email: str | None = None
    ) -> dict[str, Any]:
        clean_email = _normalize_email(email)
        if player_id is None and clean_email is None:
            raise LicenseError("choose an existing player or enter an email address")
        stamp = _iso(_utc_now())
        with self._connect() as database:
            database.execute("BEGIN IMMEDIATE")
            subscription = self._coach_subscription(database, coach_id, require_active=True)
            created_since = _iso(_utc_now() - timedelta(hours=1))
            recent_creations = database.execute("""
                SELECT COUNT(*) FROM license_audit_events
                WHERE actor_player_id = ? AND event_type = 'COACH_INVITATION_CREATED'
                  AND created_at >= ?
            """, (coach_id, created_since)).fetchone()[0]
            if recent_creations >= COACH_INVITATION_CREATE_LIMIT:
                raise LicenseError("too many Coach invitations were created; try again later")
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

    def claim_coach_invitation(self, player_id: int, token: Any) -> dict[str, Any]:
        try:
            token_hash = _hash_code(token)
        except LicenseError as error:
            raise LicenseError("Coach invitation link is invalid or no longer available") from error
        stamp = _iso(_utc_now())
        with self._connect() as database:
            database.execute("BEGIN IMMEDIATE")
            invitation = database.execute("""
                SELECT i.*, p.display_name AS coach_name
                FROM coach_invitations i
                JOIN players p ON p.id = i.coach_id
                WHERE i.token_hash = ? AND i.status = 'PENDING'
            """, (token_hash,)).fetchone()
            player = database.execute(
                "SELECT email FROM players WHERE id = ?", (player_id,)
            ).fetchone()
            if invitation is None or player is None or not self._invitation_matches_player(
                invitation, player_id, player["email"]
            ):
                raise LicenseError("Coach invitation link is invalid or belongs to another account")
            relationship_id = invitation["relationship_id"]
            if invitation["invited_player_id"] is None:
                relationship_id = relationship_id or _new_id("relationship")
                database.execute("""
                    INSERT INTO coach_student_relationships(
                        id, coach_id, player_id, status, created_at
                    ) VALUES (?, ?, ?, 'INVITED', ?)
                """, (relationship_id, invitation["coach_id"], player_id,
                      invitation["created_at"]))
                database.execute("""
                    UPDATE coach_invitations
                    SET invited_player_id = ?, relationship_id = ? WHERE id = ?
                """, (player_id, relationship_id, invitation["id"]))
            self._audit(
                database, "COACH_INVITATION_CLAIMED", actor=player_id, subject=player_id,
                entity_type="coach_invitation", entity_id=invitation["id"],
                detail={"coach_id": invitation["coach_id"]},
            )
        return {
            "id": invitation["id"],
            "coach_id": invitation["coach_id"],
            "coach_name": invitation["coach_name"],
            "claimed_at": stamp,
            "access": self.access_summary(player_id),
        }

    def prepare_coach_invitation_resend(
        self, coach_id: int, invitation_id: str
    ) -> dict[str, Any]:
        now = _utc_now()
        stamp = _iso(now)
        with self._connect() as database:
            database.execute("BEGIN IMMEDIATE")
            invitation = database.execute("""
                SELECT i.*, p.display_name AS coach_name
                FROM coach_invitations i
                JOIN players p ON p.id = i.coach_id
                WHERE i.id = ? AND i.coach_id = ? AND i.status = 'PENDING'
            """, (invitation_id, coach_id)).fetchone()
            if invitation is None:
                raise LicenseError("pending Coach invitation was not found")
            if not invitation["invited_email"]:
                raise LicenseError("this invitation has no email address")
            latest = database.execute("""
                SELECT created_at FROM license_audit_events
                WHERE actor_player_id = ? AND entity_id = ?
                  AND event_type = 'COACH_INVITATION_RESENT'
                ORDER BY created_at DESC LIMIT 1
            """, (coach_id, invitation_id)).fetchone()
            latest_at = _parse_time(latest["created_at"]) if latest else None
            if latest_at and (now - latest_at).total_seconds() < COACH_INVITATION_RESEND_COOLDOWN_SECONDS:
                raise LicenseError("wait one minute before resending this invitation")
            day_start = _iso(now - timedelta(hours=24))
            resend_count = database.execute("""
                SELECT COUNT(*) FROM license_audit_events
                WHERE actor_player_id = ? AND entity_id = ?
                  AND event_type = 'COACH_INVITATION_RESENT' AND created_at >= ?
            """, (coach_id, invitation_id, day_start)).fetchone()[0]
            if resend_count >= COACH_INVITATION_RESEND_LIMIT:
                raise LicenseError("this invitation has reached its daily resend limit")
            raw_token = f"JINV-{secrets.token_urlsafe(24)}"
            canonical = _canonical_code(raw_token)
            previous_token_hash = invitation["token_hash"]
            previous_token_hint = invitation["token_hint"]
            database.execute("""
                UPDATE coach_invitations SET token_hash = ?, token_hint = ? WHERE id = ?
            """, (_hash_code(raw_token), canonical[-6:], invitation_id))
            self._audit(
                database, "COACH_INVITATION_RESENT", actor=coach_id,
                subject=invitation["invited_player_id"], entity_type="coach_invitation",
                entity_id=invitation_id,
            )
        return {
            "id": invitation_id,
            "token": raw_token,
            "email": invitation["invited_email"],
            "coach_name": invitation["coach_name"],
            "created_at": invitation["created_at"],
            "resent_at": stamp,
            "_previous_token_hash": previous_token_hash,
            "_previous_token_hint": previous_token_hint,
        }

    def restore_coach_invitation_token(
        self, coach_id: int, invitation_id: str, attempted_token: Any,
        previous_token_hash: str, previous_token_hint: str,
    ) -> None:
        """Restore the last usable link when a rotated resend was not delivered."""
        attempted_hash = _hash_code(attempted_token)
        with self._connect() as database:
            database.execute("BEGIN IMMEDIATE")
            invitation = database.execute("""
                SELECT token_hash FROM coach_invitations
                WHERE id = ? AND coach_id = ? AND status = 'PENDING'
            """, (invitation_id, coach_id)).fetchone()
            if invitation is None or invitation["token_hash"] != attempted_hash:
                return
            database.execute("""
                UPDATE coach_invitations SET token_hash = ?, token_hint = ? WHERE id = ?
            """, (previous_token_hash, previous_token_hint, invitation_id))

    def record_coach_invitation_delivery(
        self,
        coach_id: int,
        invitation_id: str,
        status: str,
        *,
        provider_message_id: str | None = None,
    ) -> None:
        normalized = str(status or "").strip().upper()
        if normalized not in {"SENT", "FAILED", "NOT_CONFIGURED", "NO_ADDRESS"}:
            raise LicenseError("Coach invitation delivery status is invalid")
        with self._connect() as database:
            invitation = database.execute(
                "SELECT id FROM coach_invitations WHERE id = ? AND coach_id = ?",
                (invitation_id, coach_id),
            ).fetchone()
            if invitation is None:
                raise LicenseError("Coach invitation was not found")
            self._audit(
                database,
                f"COACH_INVITATION_EMAIL_{normalized}",
                actor=coach_id,
                entity_type="coach_invitation",
                entity_id=invitation_id,
                detail={
                    "provider": "SMTP2GO",
                    "provider_message_id": provider_message_id,
                },
            )

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
        grant_id = _new_id("grant")
        database.execute("""
            INSERT INTO entitlement_grants(
                id, player_id, grant_type, subscription_id, sponsoring_coach_id,
                seat_assignment_id, status, starts_at, created_at
            ) VALUES (?, ?, 'COACH_SPONSORED', ?, ?, ?, 'ACTIVE', ?, ?)
        """, (grant_id, player_id, subscription["id"], coach_id, seat_id, stamp, stamp))
        grant = database.execute(
            "SELECT * FROM entitlement_grants WHERE id = ?", (grant_id,)
        ).fetchone()
        self._grant_continuation_eligibility(
            database, player_id, grant, stamp, relationship_id=relationship_id,
        )
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
            self._audit(database, "COACH_INVITATION_DECLINED", actor=player_id,
                        subject=player_id, entity_type="coach_invitation",
                        entity_id=invitation_id)

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
            self._audit(database, "COACH_INVITATION_CANCELLED", actor=coach_id,
                        subject=invitation["invited_player_id"],
                        entity_type="coach_invitation", entity_id=invitation_id)

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
        self.reconcile_subscription_lifecycle()
        with self._connect() as database:
            subscription = database.execute("""
                SELECT *, status AS subscription_status FROM subscriptions
                WHERE holder_player_id = ? AND plan = 'COACH'
                ORDER BY created_at DESC LIMIT 1
            """, (coach_id,)).fetchone()
            if subscription is None:
                raise LicenseError("a Jetta Coach subscription is required")
            grace_cycle = self._active_grace_cycle(database, subscription["id"])
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
                SELECT id, invited_player_id, invited_email, created_at
                FROM coach_invitations
                WHERE coach_id = ? AND status = 'PENDING'
                ORDER BY created_at DESC LIMIT 100
            """, (coach_id,)).fetchall()
            students = []
            for row in rows:
                item = dict(row)
                item["grants"] = [
                    grant["type"] for grant in self._valid_grants(database, row["player_id"])
                ]
                students.append(item)
            pending_invitations = []
            for row in pending:
                item = dict(row)
                delivery = database.execute("""
                    SELECT event_type, created_at FROM license_audit_events
                    WHERE entity_type = 'coach_invitation' AND entity_id = ?
                      AND event_type IN (
                        'COACH_INVITATION_EMAIL_SENT',
                        'COACH_INVITATION_EMAIL_FAILED',
                        'COACH_INVITATION_EMAIL_NOT_CONFIGURED',
                        'COACH_INVITATION_EMAIL_NO_ADDRESS'
                      )
                    ORDER BY created_at DESC LIMIT 1
                """, (row["id"],)).fetchone()
                item["email_status"] = (
                    delivery["event_type"].removeprefix("COACH_INVITATION_EMAIL_")
                    if delivery else "NOT_ATTEMPTED"
                )
                item["email_attempted_at"] = delivery["created_at"] if delivery else None
                pending_invitations.append(item)
        sponsored = sum(1 for item in students if item["seat_status"] == "ACTIVE")
        grace = None
        if grace_cycle is not None and subscription["subscription_status"] == "PAST_DUE":
            grace = {
                "status": "ACTIVE", "cycle_id": grace_cycle["id"],
                "started_at": grace_cycle["started_at"],
                "ends_at": subscription["grace_ends_at"],
                "days_remaining": self._days_remaining(subscription["grace_ends_at"]),
            }
        restoration = {
            "kind": subscription["billing_provider"],
            "label": (
                "Enter a new eligible Jetta Access Code or contact Jetta support"
                if subscription["billing_provider"] == "ACCESS_CODE"
                else "Contact Jetta support to restore Coach access"
            ),
            "url": None,
        }
        return {"subscription_id": subscription["id"],
                "subscription_status": subscription["subscription_status"],
                "grace_ends_at": subscription["grace_ends_at"], "grace": grace,
                "restoration": restoration, "students": students,
                "pending_invitations": pending_invitations,
                "sponsored_students": sponsored,
                "seat_capacity": self.coach_seat_capacity,
                "seats_available": self.coach_seat_capacity - sponsored}

    def coach_relationship_context(self, coach_id: int, player_id: int) -> dict[str, Any]:
        with self._connect() as database:
            row = database.execute("""
                SELECT id, coach_id, player_id, started_at
                FROM coach_student_relationships
                WHERE coach_id = ? AND player_id = ? AND status = 'ACTIVE'
            """, (coach_id, player_id)).fetchone()
        if row is None:
            raise LicenseError("active coaching relationship was not found")
        return dict(row)

    def coach_can_view_round(self, coach_id: int, player_id: int, round_id: str) -> bool:
        try:
            relationship = self.coach_relationship_context(coach_id, player_id)
        except LicenseError:
            return False
        with self._connect() as database:
            row = database.execute("""
                SELECT completed_at FROM completed_rounds WHERE id = ? AND player_id = ?
            """, (round_id, player_id)).fetchone()
        completed_at = _parse_time(row["completed_at"]) if row else None
        started_at = _parse_time(relationship["started_at"])
        return bool(completed_at and started_at and completed_at >= started_at)

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
