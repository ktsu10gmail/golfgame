import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from packages.accounts import LicenseService, PlayerStore
from packages.accounts.license_notifications import LicenseNotificationService
from packages.accounts.smtp2go import EmailDeliveryError


UTC = timezone.utc


class _FailingMailer:
    def __init__(self):
        self.calls = 0

    def send_message(self, *_args):
        self.calls += 1
        raise EmailDeliveryError("SMTP2GO could not be reached")


class _RecordingMailer:
    def __init__(self):
        self.messages = []

    def send_message(self, recipient, subject, text_body, html_body):
        self.messages.append((recipient, subject, text_body, html_body))
        return {"provider": "SMTP2GO", "message_id": f"message-{len(self.messages)}",
                "request_id": f"request-{len(self.messages)}"}


class LicenseNotificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "players.sqlite3"
        self.players = PlayerStore(self.path)
        self.admin = self.players.create_player("Admin", "1234")
        self.licenses = LicenseService(self.path, enforcement="enforced")
        self.licenses.ensure_role(self.admin["id"], "ADMIN")

    def tearDown(self):
        self.temp.cleanup()

    def _coach(self, email="coach@example.com"):
        coach = self.players.upsert_supabase_player(f"auth-{email}", email, "Coach Grace")
        code = self.licenses.create_access_code(self.admin["id"], plan="COACH", duration_days=365)
        result = self.licenses.redeem_access_code(coach["id"], code["code"])
        return coach, result["subscription_id"]

    def _sponsor(self, coach, email="student@example.com"):
        student = self.players.upsert_supabase_player(f"auth-{email}", email, "Student Grace")
        invitation = self.licenses.create_coach_invitation(coach["id"], player_id=student["id"])
        accepted = self.licenses.accept_coach_invitation(student["id"], invitation["id"])
        self.assertTrue(accepted["sponsored"])
        return student

    def test_day_one_is_immediate_and_total_coach_windows_are_thirty(self):
        coach, subscription_id = self._coach()
        started = datetime(2026, 10, 1, 15, tzinfo=UTC)
        self.licenses.transition_subscription(subscription_id, "PAST_DUE", effective_at=started)
        with sqlite3.connect(self.path) as database:
            rows = database.execute("""
                SELECT window_key, window_number, due_at FROM license_notifications
                WHERE subscription_id = ? AND notification_type = 'COACH_GRACE_DAILY'
                ORDER BY window_number
            """, (subscription_id,)).fetchall()
        self.assertEqual(len(rows), 30)
        self.assertEqual(rows[0][0:2], ("day-01", 1))
        self.assertEqual(rows[-1][0:2], ("day-30", 30))
        self.assertEqual(datetime.fromisoformat(rows[0][2]), started)
        self.assertEqual(datetime.fromisoformat(rows[1][2]), started + timedelta(days=1))

    def test_sponsored_grant_creates_durable_eligibility(self):
        coach, _ = self._coach()
        student = self._sponsor(coach)
        eligibility = self.licenses.continuation_eligibility(student["id"])
        self.assertEqual(eligibility["status"], "ELIGIBLE")
        self.licenses.release_sponsorship(
            coach["id"], self.licenses.access_summary(student["id"])["current_coach"]["relationship_id"]
        )
        self.assertEqual(self.licenses.continuation_eligibility(student["id"])["status"], "ELIGIBLE")

    def test_three_total_provider_attempts_include_initial_attempt(self):
        _, subscription_id = self._coach()
        started = datetime(2026, 10, 1, 15, tzinfo=UTC)
        self.licenses.transition_subscription(subscription_id, "PAST_DUE", effective_at=started)
        mailer = _FailingMailer()
        worker = LicenseNotificationService(
            self.licenses, mailer, delivery_enabled=True, batch_size=10
        )
        worker.run_once(at=started, worker_id="test")
        worker.run_once(at=started + timedelta(minutes=15), worker_id="test")
        worker.run_once(at=started + timedelta(minutes=75), worker_id="test")
        worker.run_once(at=started + timedelta(hours=8), worker_id="test")
        with sqlite3.connect(self.path) as database:
            row = database.execute("""
                SELECT status, attempt_count FROM license_notifications
                WHERE subscription_id = ? AND window_key = 'day-01'
            """, (subscription_id,)).fetchone()
        self.assertEqual(row, ("MISSED", 3))
        self.assertEqual(mailer.calls, 3)

    def test_expiration_preserves_relationship_and_queues_ended_email(self):
        coach, subscription_id = self._coach()
        student = self._sponsor(coach)
        started = datetime(2026, 10, 1, 15, tzinfo=UTC)
        self.licenses.transition_subscription(subscription_id, "PAST_DUE", effective_at=started)
        self.licenses.reconcile_subscription_lifecycle(started + timedelta(days=30))
        access = self.licenses.access_summary(student["id"])
        self.assertEqual(access["coach_sponsorship"]["status"], "ENDED")
        self.assertEqual(access["play_access"], "HISTORICAL_ONLY")
        self.assertIsNotNone(access["current_coach"])
        with sqlite3.connect(self.path) as database:
            notice = database.execute("""
                SELECT status FROM license_notifications
                WHERE recipient_player_id = ?
                  AND notification_type = 'STUDENT_SPONSORSHIP_ENDED'
            """, (student["id"],)).fetchone()
        self.assertEqual(notice[0], "PENDING")

    def test_migration_reconstruction_does_not_queue_student_start_email(self):
        coach, subscription_id = self._coach()
        student = self._sponsor(coach)
        started = datetime.now(UTC) - timedelta(days=5)
        self.licenses.transition_subscription(subscription_id, "PAST_DUE", effective_at=started)
        with sqlite3.connect(self.path) as database:
            database.execute("DELETE FROM license_notifications")
            database.execute("DELETE FROM subscription_grace_cycles")
            database.execute("DELETE FROM license_schema_migrations WHERE version = 2")
        reconstructed = LicenseService(self.path, enforcement="enforced")
        with sqlite3.connect(self.path) as database:
            student_start = database.execute("""
                SELECT COUNT(*) FROM license_notifications
                WHERE recipient_player_id = ? AND notification_type = 'STUDENT_GRACE_STARTED'
            """, (student["id"],)).fetchone()[0]
            coach_windows = database.execute("""
                SELECT COUNT(*) FROM license_notifications
                WHERE subscription_id = ? AND notification_type = 'COACH_GRACE_DAILY'
            """, (subscription_id,)).fetchone()[0]
        self.assertEqual(student_start, 0)
        self.assertEqual(coach_windows, 30)
        self.assertEqual(reconstructed.coach_dashboard(coach["id"])["grace"]["status"], "ACTIVE")


if __name__ == "__main__":
    unittest.main()
