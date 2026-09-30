"""Bounded, read-only Back Office queries over Jetta account data."""

from __future__ import annotations

import base64
import binascii
import json
import sqlite3
from pathlib import Path
from typing import Any

from .licensing import LicenseError, LicenseService


DEFAULT_LIMIT = 25
MAX_LIMIT = 100


def _limit(value: Any, default: int = DEFAULT_LIMIT) -> int:
    if value in (None, ""):
        return default
    try:
        parsed = int(value)
    except (TypeError, ValueError) as error:
        raise LicenseError("limit must be a whole number") from error
    if parsed < 1 or parsed > MAX_LIMIT:
        raise LicenseError(f"limit must be between 1 and {MAX_LIMIT}")
    return parsed


def _player_id(value: Any, label: str = "player") -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as error:
        raise LicenseError(f"{label} ID is invalid") from error
    if parsed < 1:
        raise LicenseError(f"{label} ID is invalid")
    return parsed


def _encode_cursor(sort_value: str, row_id: Any) -> str:
    raw = json.dumps([sort_value, row_id], separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _decode_cursor(value: Any) -> tuple[str, Any] | None:
    if value in (None, ""):
        return None
    try:
        raw = str(value)
        decoded = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
        payload = json.loads(decoded.decode("utf-8"))
    except (ValueError, TypeError, binascii.Error, json.JSONDecodeError, UnicodeDecodeError) as error:
        raise LicenseError("cursor is invalid") from error
    if not isinstance(payload, list) or len(payload) != 2 or not isinstance(payload[0], str):
        raise LicenseError("cursor is invalid")
    return payload[0], payload[1]


class AdminOperationsService:
    """Operational reads for an already-authorized Jetta administrator."""

    def __init__(self, path: str | Path, licenses: LicenseService):
        self.path = Path(path)
        self.licenses = licenses

    def _connect(self) -> sqlite3.Connection:
        database = sqlite3.connect(self.path, timeout=10)
        database.row_factory = sqlite3.Row
        database.execute("PRAGMA foreign_keys = ON")
        return database

    @staticmethod
    def _account_payload(row: sqlite3.Row) -> dict[str, Any]:
        linked = bool(row["supabase_user_id"])
        return {
            "id": row["id"],
            "display_name": row["display_name"],
            "email": row["email"] or None,
            "supabase_user_id": row["supabase_user_id"] or None,
            "created_at": row["created_at"],
            "account_status": "EXISTS",
            "identity_type": "SUPABASE_LINKED" if linked else "LOCAL_DEVELOPMENT",
            "identity_label": "Supabase linked" if linked else "Local development account",
        }

    def search_users(self, query: Any, *, limit: Any = None, cursor: Any = None) -> dict[str, Any]:
        term = " ".join(str(query or "").strip().split())
        numeric_id = int(term) if term.isdigit() and int(term) > 0 else None
        if numeric_id is None and len(term) < 2:
            raise LicenseError("enter at least two characters to search users")
        page_size = _limit(limit)
        after = _decode_cursor(cursor)
        clauses = ["(p.id = ? OR lower(p.display_name) LIKE ? OR lower(COALESCE(p.email, '')) LIKE ? OR lower(COALESCE(p.supabase_user_id, '')) LIKE ?)"]
        lowered = f"%{term.casefold()}%"
        parameters: list[Any] = [numeric_id or -1, lowered, lowered, lowered]
        if after:
            try:
                after_id = int(after[1])
            except (TypeError, ValueError) as error:
                raise LicenseError("cursor is invalid") from error
            clauses.append("(lower(p.display_name) > ? OR (lower(p.display_name) = ? AND p.id > ?))")
            parameters.extend([after[0], after[0], after_id])
        parameters.append(page_size + 1)
        with self._connect() as database:
            rows = database.execute(f"""
                SELECT p.id, p.display_name, p.email, p.supabase_user_id, p.created_at
                FROM players p
                WHERE {' AND '.join(clauses)}
                ORDER BY lower(p.display_name), p.id
                LIMIT ?
            """, parameters).fetchall()
            items = []
            for row in rows[:page_size]:
                item = self._account_payload(row)
                item["roles"] = self.licenses.roles(row["id"])
                item["play_access"] = self.licenses.access_summary(row["id"])["play_access"]
                items.append(item)
        next_cursor = None
        if len(rows) > page_size and items:
            last = items[-1]
            next_cursor = _encode_cursor(last["display_name"].casefold(), last["id"])
        return {"items": items, "next_cursor": next_cursor, "limit": page_size}

    def user_detail(self, player_id: Any) -> dict[str, Any]:
        selected_id = _player_id(player_id)
        self.licenses.reconcile_subscription_lifecycle()
        with self._connect() as database:
            player = database.execute("""
                SELECT id, display_name, email, supabase_user_id, created_at
                FROM players WHERE id = ?
            """, (selected_id,)).fetchone()
            if player is None:
                raise LicenseError("player account was not found")
            subscriptions = database.execute("""
                SELECT id, plan, billing_provider, status, starts_at,
                       current_period_end, grace_ends_at, created_at, updated_at
                FROM subscriptions WHERE holder_player_id = ?
                ORDER BY created_at DESC LIMIT 25
            """, (selected_id,)).fetchall()
            grants = database.execute("""
                SELECT id, grant_type, subscription_id, sponsoring_coach_id,
                       seat_assignment_id, status, starts_at, expires_at, ended_at
                FROM entitlement_grants WHERE player_id = ?
                ORDER BY created_at DESC LIMIT 25
            """, (selected_id,)).fetchall()
            events = database.execute("""
                SELECT id, actor_player_id, subject_player_id, event_type,
                       entity_type, entity_id, detail_json, created_at
                FROM license_audit_events WHERE subject_player_id = ?
                ORDER BY created_at DESC, id DESC LIMIT 20
            """, (selected_id,)).fetchall()
            eligibility = database.execute("""
                SELECT id, player_id, offer_code, offer_version, status, qualified_at,
                       source_relationship_id, source_seat_assignment_id,
                       source_grant_id, source_coach_subscription_id, revoked_at,
                       revoked_by_player_id, correction_reason, created_at, updated_at
                FROM continuation_eligibilities WHERE player_id = ?
                ORDER BY created_at DESC LIMIT 10
            """, (selected_id,)).fetchall()
        account = self._account_payload(player)
        account["roles"] = self.licenses.roles(selected_id)
        return {
            "account": account,
            "diagnostic": self.licenses.entitlement_diagnostic(selected_id),
            "subscriptions": [dict(row) for row in subscriptions],
            "grants": [dict(row) for row in grants],
            "continuation_eligibilities": [dict(row) for row in eligibility],
            "recent_events": [self._audit_payload(row) for row in events],
        }

    def access_codes(self, *, limit: Any = None) -> dict[str, Any]:
        page_size = _limit(limit, 50)
        with self._connect() as database:
            rows = database.execute("""
                SELECT c.id, c.code_hint, c.plan, c.duration_days, c.redeem_by,
                       c.max_redemptions, c.redemption_count, c.status,
                       c.created_by_player_id, p.display_name AS created_by_name,
                       c.created_at, c.revoked_at
                FROM access_codes c
                JOIN players p ON p.id = c.created_by_player_id
                ORDER BY c.created_at DESC, c.id DESC LIMIT ?
            """, (page_size,)).fetchall()
        return {"items": [dict(row) for row in rows], "limit": page_size}

    def code_redemptions(self, code_id: Any, *, limit: Any = None) -> dict[str, Any]:
        clean_id = str(code_id or "").strip()
        if not clean_id:
            raise LicenseError("access code ID is required")
        page_size = _limit(limit, 50)
        with self._connect() as database:
            code = database.execute("""
                SELECT id, code_hint, plan, status, duration_days, max_redemptions,
                       redemption_count, created_at, redeem_by, revoked_at
                FROM access_codes WHERE id = ?
            """, (clean_id,)).fetchone()
            if code is None:
                raise LicenseError("access code was not found")
            rows = database.execute("""
                SELECT r.id, r.player_id, p.display_name AS player_name, p.email,
                       r.subscription_id, r.redeemed_at
                FROM access_code_redemptions r
                JOIN players p ON p.id = r.player_id
                WHERE r.access_code_id = ?
                ORDER BY r.redeemed_at DESC, r.id DESC LIMIT ?
            """, (clean_id, page_size)).fetchall()
        return {"code": dict(code), "items": [dict(row) for row in rows], "limit": page_size}

    def search_coaches(self, query: Any = "", *, limit: Any = None, cursor: Any = None) -> dict[str, Any]:
        term = " ".join(str(query or "").strip().split())
        page_size = _limit(limit)
        after = _decode_cursor(cursor)
        clauses = ["r.role = 'COACH'"]
        parameters: list[Any] = []
        if term:
            if len(term) < 2:
                raise LicenseError("enter at least two characters to search coaches")
            lowered = f"%{term.casefold()}%"
            clauses.append("(lower(p.display_name) LIKE ? OR lower(COALESCE(p.email, '')) LIKE ?)")
            parameters.extend([lowered, lowered])
        if after:
            try:
                after_id = int(after[1])
            except (TypeError, ValueError) as error:
                raise LicenseError("cursor is invalid") from error
            clauses.append("(lower(p.display_name) > ? OR (lower(p.display_name) = ? AND p.id > ?))")
            parameters.extend([after[0], after[0], after_id])
        parameters.append(page_size + 1)
        with self._connect() as database:
            rows = database.execute(f"""
                SELECT p.id, p.display_name, p.email, p.supabase_user_id, p.created_at,
                       s.id AS subscription_id, s.status AS subscription_status,
                       s.grace_ends_at
                FROM player_roles r
                JOIN players p ON p.id = r.player_id
                LEFT JOIN subscriptions s ON s.id = (
                    SELECT id FROM subscriptions
                    WHERE holder_player_id = p.id AND plan = 'COACH'
                    ORDER BY created_at DESC LIMIT 1
                )
                WHERE {' AND '.join(clauses)}
                ORDER BY lower(p.display_name), p.id LIMIT ?
            """, parameters).fetchall()
            items = []
            for row in rows[:page_size]:
                sponsored = database.execute("""
                    SELECT COUNT(*) FROM coach_seat_assignments
                    WHERE coach_id = ? AND status = 'ACTIVE'
                """, (row["id"],)).fetchone()[0]
                relationships = database.execute("""
                    SELECT COUNT(*) FROM coach_student_relationships
                    WHERE coach_id = ? AND status = 'ACTIVE'
                """, (row["id"],)).fetchone()[0]
                item = dict(row)
                item.update({"sponsored_students": sponsored,
                             "active_relationships": relationships,
                             "seat_capacity": self.licenses.coach_seat_capacity})
                items.append(item)
        next_cursor = None
        if len(rows) > page_size and items:
            last = items[-1]
            next_cursor = _encode_cursor(last["display_name"].casefold(), last["id"])
        return {"items": items, "next_cursor": next_cursor, "limit": page_size}

    def coach_detail(self, coach_id: Any) -> dict[str, Any]:
        selected_id = _player_id(coach_id, "Coach")
        self.licenses.reconcile_subscription_lifecycle()
        with self._connect() as database:
            coach = database.execute("""
                SELECT p.id, p.display_name, p.email, p.supabase_user_id, p.created_at
                FROM players p JOIN player_roles r ON r.player_id = p.id
                WHERE p.id = ? AND r.role = 'COACH'
            """, (selected_id,)).fetchone()
            if coach is None:
                raise LicenseError("Coach account was not found")
            subscription = database.execute("""
                SELECT id, plan, billing_provider, status, starts_at,
                       current_period_end, grace_ends_at, created_at, updated_at
                FROM subscriptions
                WHERE holder_player_id = ? AND plan = 'COACH'
                ORDER BY created_at DESC LIMIT 1
            """, (selected_id,)).fetchone()
            relationships = database.execute("""
                SELECT r.id AS relationship_id, r.player_id, p.display_name AS player_name,
                       p.email, r.status AS relationship_status, r.started_at, r.ended_at,
                       s.id AS seat_id, s.status AS seat_status, s.assigned_at, s.released_at
                FROM coach_student_relationships r
                JOIN players p ON p.id = r.player_id
                LEFT JOIN coach_seat_assignments s ON s.id = (
                    SELECT id FROM coach_seat_assignments
                    WHERE relationship_id = r.id ORDER BY assigned_at DESC LIMIT 1
                )
                WHERE r.coach_id = ?
                ORDER BY COALESCE(r.started_at, r.created_at) DESC LIMIT 100
            """, (selected_id,)).fetchall()
            invitations = database.execute("""
                SELECT id, invited_player_id, invited_email, token_hint, status,
                       created_at, responded_at
                FROM coach_invitations WHERE coach_id = ?
                ORDER BY created_at DESC LIMIT 100
            """, (selected_id,)).fetchall()
            cycle = database.execute("""
                SELECT id, subscription_id, started_at, deadline_snapshot_at,
                       status, closed_at, created_at, updated_at
                FROM subscription_grace_cycles
                WHERE subscription_id = COALESCE(?, '')
                ORDER BY started_at DESC LIMIT 1
            """, (subscription["id"] if subscription else None,)).fetchone()
            notifications = database.execute("""
                SELECT id, recipient_player_id, recipient_email, notification_type,
                       window_key, window_number, due_at, status, attempt_count,
                       last_attempt_at, sent_at, provider, provider_message_id,
                       last_error_code
                FROM license_notifications
                WHERE subscription_id = COALESCE(?, '')
                ORDER BY created_at DESC LIMIT 25
            """, (subscription["id"] if subscription else None,)).fetchall()
        account = self._account_payload(coach)
        account["roles"] = self.licenses.roles(selected_id)
        active_seats = sum(1 for row in relationships if row["seat_status"] == "ACTIVE")
        return {
            "account": account,
            "subscription": dict(subscription) if subscription else None,
            "seat_capacity": self.licenses.coach_seat_capacity,
            "sponsored_students": active_seats,
            "seats_available": max(0, self.licenses.coach_seat_capacity - active_seats),
            "relationships": [dict(row) for row in relationships],
            "invitations": [dict(row) for row in invitations],
            "grace_cycle": dict(cycle) if cycle else None,
            "notifications": [dict(row) for row in notifications],
        }

    def grace_summary(self) -> dict[str, int]:
        with self._connect() as database:
            active_cycles = database.execute(
                "SELECT COUNT(*) FROM subscription_grace_cycles WHERE status = 'ACTIVE'"
            ).fetchone()[0]
            at_risk = database.execute("""
                SELECT COUNT(*) FROM coach_seat_assignments a
                JOIN subscriptions s ON s.id = a.coach_subscription_id
                WHERE a.status = 'ACTIVE' AND s.status = 'PAST_DUE'
            """).fetchone()[0]
            counts = {row["status"].lower(): row["count"] for row in database.execute("""
                SELECT status, COUNT(*) AS count FROM license_notifications
                GROUP BY status
            """).fetchall()}
            eligibility = {row["status"].lower(): row["count"] for row in database.execute("""
                SELECT status, COUNT(*) AS count FROM continuation_eligibilities
                GROUP BY status
            """).fetchall()}
        return {
            "active_grace_cycles": active_cycles,
            "at_risk_sponsored_students": at_risk,
            "pending_notifications": counts.get("pending", 0),
            "failed_notifications": counts.get("failed", 0),
            "missed_notifications": counts.get("missed", 0),
            "no_address_notifications": counts.get("no_address", 0),
            "eligible_students": eligibility.get("eligible", 0),
            "revoked_eligibilities": eligibility.get("revoked", 0),
        }

    def notifications(
        self, *, subscription_id: Any = None, status: Any = None, limit: Any = None
    ) -> dict[str, Any]:
        page_size = _limit(limit, 50)
        clauses = ["1 = 1"]
        parameters: list[Any] = []
        if subscription_id not in (None, ""):
            clauses.append("n.subscription_id = ?")
            parameters.append(str(subscription_id).strip())
        if status not in (None, ""):
            normalized = str(status).strip().upper()
            allowed = {"PENDING", "CLAIMED", "FAILED", "SENT", "MISSED", "CANCELLED", "NO_ADDRESS"}
            if normalized not in allowed:
                raise LicenseError("notification status is invalid")
            clauses.append("n.status = ?")
            parameters.append(normalized)
        parameters.append(page_size)
        with self._connect() as database:
            rows = database.execute(f"""
                SELECT n.id, n.subscription_id, n.grace_cycle_id,
                       n.recipient_player_id, p.display_name AS recipient_name,
                       n.recipient_email, n.notification_type, n.window_key,
                       n.window_number, n.due_at, n.window_ends_at, n.status,
                       n.attempt_count, n.last_attempt_at, n.sent_at, n.provider,
                       n.provider_message_id, n.last_error_code, n.created_at, n.updated_at
                FROM license_notifications n
                JOIN players p ON p.id = n.recipient_player_id
                WHERE {' AND '.join(clauses)}
                ORDER BY n.created_at DESC, n.id DESC LIMIT ?
            """, parameters).fetchall()
        return {"items": [dict(row) for row in rows], "limit": page_size}

    def continuation_eligibilities(
        self, query: Any = "", *, status: Any = None, limit: Any = None
    ) -> dict[str, Any]:
        page_size = _limit(limit, 50)
        clauses = ["1 = 1"]
        parameters: list[Any] = []
        term = " ".join(str(query or "").strip().split())
        if term:
            if len(term) < 2:
                raise LicenseError("enter at least two characters to search eligibility")
            lowered = f"%{term.casefold()}%"
            numeric = int(term) if term.isdigit() else -1
            clauses.append("(p.id = ? OR lower(p.display_name) LIKE ? OR lower(COALESCE(p.email, '')) LIKE ?)")
            parameters.extend([numeric, lowered, lowered])
        if status not in (None, ""):
            normalized = str(status).upper()
            if normalized not in {"ELIGIBLE", "REVOKED"}:
                raise LicenseError("eligibility status is invalid")
            clauses.append("e.status = ?")
            parameters.append(normalized)
        parameters.append(page_size)
        with self._connect() as database:
            rows = database.execute(f"""
                SELECT e.id, e.player_id, p.display_name AS player_name, p.email,
                       e.offer_code, e.offer_version, e.status, e.qualified_at,
                       e.source_relationship_id, e.source_seat_assignment_id,
                       e.source_grant_id, e.source_coach_subscription_id,
                       e.revoked_at, e.revoked_by_player_id, e.correction_reason,
                       e.created_at, e.updated_at
                FROM continuation_eligibilities e
                JOIN players p ON p.id = e.player_id
                WHERE {' AND '.join(clauses)}
                ORDER BY e.qualified_at DESC, e.id DESC LIMIT ?
            """, parameters).fetchall()
        return {"items": [dict(row) for row in rows], "limit": page_size}

    @staticmethod
    def _audit_payload(row: sqlite3.Row) -> dict[str, Any]:
        try:
            detail = json.loads(row["detail_json"] or "{}")
        except (TypeError, json.JSONDecodeError):
            detail = {"unparsed": str(row["detail_json"] or "")[:1000]}
        if not isinstance(detail, (dict, list)):
            detail = {"value": detail}
        return {
            "id": row["id"],
            "actor_player_id": row["actor_player_id"],
            "subject_player_id": row["subject_player_id"],
            "event_type": row["event_type"],
            "entity_type": row["entity_type"],
            "entity_id": row["entity_id"],
            "detail": detail,
            "created_at": row["created_at"],
        }

    def audit_events(
        self,
        *,
        event_type: Any = None,
        subject_id: Any = None,
        actor_id: Any = None,
        entity_type: Any = None,
        entity_id: Any = None,
        before: Any = None,
        limit: Any = None,
    ) -> dict[str, Any]:
        page_size = _limit(limit, 50)
        clauses = ["1 = 1"]
        parameters: list[Any] = []
        filters = {
            "event_type": event_type,
            "entity_type": entity_type,
            "entity_id": entity_id,
        }
        for column, value in filters.items():
            if value not in (None, ""):
                clauses.append(f"{column} = ?")
                parameters.append(str(value).strip())
        if subject_id not in (None, ""):
            clauses.append("subject_player_id = ?")
            parameters.append(_player_id(subject_id, "subject"))
        if actor_id not in (None, ""):
            clauses.append("actor_player_id = ?")
            parameters.append(_player_id(actor_id, "actor"))
        cursor = _decode_cursor(before)
        if cursor:
            clauses.append("(created_at < ? OR (created_at = ? AND id < ?))")
            parameters.extend([cursor[0], cursor[0], str(cursor[1])])
        parameters.append(page_size + 1)
        with self._connect() as database:
            rows = database.execute(f"""
                SELECT id, actor_player_id, subject_player_id, event_type,
                       entity_type, entity_id, detail_json, created_at
                FROM license_audit_events WHERE {' AND '.join(clauses)}
                ORDER BY created_at DESC, id DESC LIMIT ?
            """, parameters).fetchall()
        items = [self._audit_payload(row) for row in rows[:page_size]]
        next_cursor = None
        if len(rows) > page_size and items:
            last = items[-1]
            next_cursor = _encode_cursor(last["created_at"], last["id"])
        return {"items": items, "next_cursor": next_cursor, "limit": page_size}
