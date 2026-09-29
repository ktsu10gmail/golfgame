import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

from packages.accounts import LicenseError, LicenseService, PlayAccessDenied, PlayerStore


class LicenseServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "players.sqlite3"
        self.players = PlayerStore(self.path)
        self.admin = self.players.create_player("Admin Golfer", "1234")
        self.player = self.players.create_player("Test Golfer", "5678")
        self.licenses = LicenseService(self.path, enforcement="enforced")
        self.licenses.ensure_role(self.admin["id"], "ADMIN")

    def tearDown(self):
        self.temp.cleanup()

    def test_new_accounts_are_players_but_authentication_is_not_entitlement(self):
        self.assertEqual(self.licenses.roles(self.player["id"]), ["PLAYER"])
        access = self.licenses.access_summary(self.player["id"])
        self.assertEqual(access["play_access"], "HISTORICAL_ONLY")
        self.assertFalse(access["can_start_new_play"])
        with self.assertRaises(PlayAccessDenied):
            self.licenses.authorize_new_activity(self.player["id"], "ROUND", "round-123456")

    def test_individual_code_creates_promotional_access_and_is_not_stored_plaintext(self):
        created = self.licenses.create_access_code(
            self.admin["id"], plan="INDIVIDUAL", duration_days=90
        )
        with sqlite3.connect(self.path) as database:
            stored = database.execute(
                "SELECT code_hash FROM access_codes WHERE id = ?", (created["id"],)
            ).fetchone()[0]
        self.assertNotEqual(stored, created["code"])
        self.assertNotIn(created["code"], self.path.read_bytes().decode("latin1"))

        result = self.licenses.redeem_access_code(self.player["id"], created["code"])
        self.assertEqual(result["grant_type"], "PROMOTIONAL")
        self.assertEqual(result["access"]["play_access"], "ACTIVE")
        self.assertNotIn("SELF_PAID", [grant["type"] for grant in result["access"]["grants"]])

    def test_coach_code_adds_role_and_coach_self_access(self):
        created = self.licenses.create_access_code(self.admin["id"], plan="COACH")
        result = self.licenses.redeem_access_code(self.player["id"], created["code"])
        self.assertEqual(result["grant_type"], "COACH_SELF")
        self.assertEqual(self.licenses.roles(self.player["id"]), ["COACH", "PLAYER"])

    def test_code_is_single_use_and_redeemed_atomically(self):
        created = self.licenses.create_access_code(self.admin["id"])
        self.licenses.redeem_access_code(self.player["id"], created["code"])
        with self.assertRaisesRegex(LicenseError, "already redeemed"):
            self.licenses.redeem_access_code(self.player["id"], created["code"])
        with sqlite3.connect(self.path) as database:
            code = database.execute(
                "SELECT status, redemption_count FROM access_codes WHERE id = ?", (created["id"],)
            ).fetchone()
        self.assertEqual(code, ("EXHAUSTED", 1))

    def test_concurrent_redemption_never_exceeds_code_capacity(self):
        second = self.players.create_player("Second Golfer", "2468")
        created = self.licenses.create_access_code(self.admin["id"], max_redemptions=1)

        def redeem(player_id):
            try:
                self.licenses.redeem_access_code(player_id, created["code"])
                return True
            except LicenseError:
                return False

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(redeem, [self.player["id"], second["id"]]))
        self.assertEqual(results.count(True), 1)
        with sqlite3.connect(self.path) as database:
            count = database.execute("""
                SELECT COUNT(*) FROM access_code_redemptions WHERE access_code_id = ?
            """, (created["id"],)).fetchone()[0]
        self.assertEqual(count, 1)

    def test_expired_code_cannot_be_redeemed(self):
        deadline = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        created = self.licenses.create_access_code(self.admin["id"], redeem_by=deadline)
        with self.assertRaisesRegex(LicenseError, "expired"):
            self.licenses.redeem_access_code(self.player["id"], created["code"])

    def test_revoked_code_and_repeated_failures_cannot_activate_access(self):
        created = self.licenses.create_access_code(self.admin["id"])
        self.licenses.revoke_access_code(self.admin["id"], created["id"])
        with self.assertRaisesRegex(LicenseError, "no longer available"):
            self.licenses.redeem_access_code(self.player["id"], created["code"])
        for _ in range(8):
            self.licenses.record_redemption_attempt(self.player["id"], "test-client", False)
        with self.assertRaisesRegex(LicenseError, "too many unsuccessful"):
            self.licenses.check_redemption_rate(self.player["id"], "test-client")

    def test_authorized_activity_survives_later_entitlement_expiration(self):
        created = self.licenses.create_access_code(self.admin["id"], duration_days=1)
        self.licenses.redeem_access_code(self.player["id"], created["code"])
        activity = self.licenses.authorize_new_activity(
            self.player["id"], "GPS", "gps-round-123456"
        )
        with sqlite3.connect(self.path) as database:
            database.execute(
                "UPDATE subscriptions SET current_period_end = ? WHERE holder_player_id = ?",
                ("2000-01-01T00:00:00+00:00", self.player["id"]),
            )
        self.assertEqual(
            self.licenses.access_summary(self.player["id"])["play_access"], "HISTORICAL_ONLY"
        )
        self.assertTrue(
            self.licenses.validate_activity(self.player["id"], activity["id"], "GPS")
        )
        with self.assertRaises(PlayAccessDenied):
            self.licenses.authorize_new_activity(
                self.player["id"], "GPS", "gps-round-new-123456"
            )

    def test_activity_authorization_is_idempotent_and_player_scoped(self):
        created = self.licenses.create_access_code(self.admin["id"], max_redemptions=2)
        self.licenses.redeem_access_code(self.player["id"], created["code"])
        first = self.licenses.authorize_new_activity(
            self.player["id"], "ACADEMY", "academy-123456"
        )
        second = self.licenses.authorize_new_activity(
            self.player["id"], "ACADEMY", "academy-123456"
        )
        self.assertEqual(first["id"], second["id"])
        self.assertFalse(self.licenses.validate_activity(self.admin["id"], first["id"], "ACADEMY"))

    def test_shadow_mode_records_an_allow_without_manufacturing_entitlement(self):
        shadow = LicenseService(self.path, enforcement="shadow")
        activity = shadow.authorize_new_activity(
            self.player["id"], "ROUND", "shadow-round-123456"
        )
        self.assertEqual(activity["authorization_source"], "SHADOW_ALLOW")
        self.assertEqual(shadow.access_summary(self.player["id"])["grants"], [])

    def test_billing_event_boundary_is_idempotent(self):
        self.assertTrue(self.licenses.record_billing_event("STRIPE", "evt_123", "invoice.paid"))
        self.assertFalse(self.licenses.record_billing_event("STRIPE", "evt_123", "invoice.paid"))

    def _coach_with_subscription(self, name="Coach Golfer"):
        coach = self.players.create_player(name, "9999")
        code = self.licenses.create_access_code(self.admin["id"], plan="COACH")
        self.licenses.redeem_access_code(coach["id"], code["code"])
        return coach

    def test_accepting_coach_invitation_creates_relationship_seat_and_grant(self):
        coach = self._coach_with_subscription()
        invitation = self.licenses.create_coach_invitation(
            coach["id"], player_id=self.player["id"]
        )
        accepted = self.licenses.accept_coach_invitation(self.player["id"], invitation["id"])
        self.assertTrue(accepted["sponsored"])
        self.assertEqual(accepted["access"]["current_coach"]["coach_id"], coach["id"])
        self.assertIn(
            "COACH_SPONSORED", [grant["type"] for grant in accepted["access"]["grants"]]
        )
        dashboard = self.licenses.coach_dashboard(coach["id"])
        self.assertEqual(dashboard["sponsored_students"], 1)
        self.assertEqual(dashboard["seats_available"], 9)

    def test_releasing_sponsorship_preserves_active_relationship(self):
        coach = self._coach_with_subscription()
        invitation = self.licenses.create_coach_invitation(
            coach["id"], player_id=self.player["id"]
        )
        accepted = self.licenses.accept_coach_invitation(self.player["id"], invitation["id"])
        self.licenses.release_sponsorship(coach["id"], accepted["relationship_id"])
        access = self.licenses.access_summary(self.player["id"])
        self.assertIsNotNone(access["current_coach"])
        self.assertEqual(access["grants"], [])
        dashboard = self.licenses.coach_dashboard(coach["id"])
        self.assertEqual(len(dashboard["students"]), 1)
        self.assertEqual(dashboard["sponsored_students"], 0)

    def test_full_capacity_acceptance_keeps_relationship_without_sponsorship(self):
        licenses = LicenseService(self.path, enforcement="enforced", coach_seat_capacity=2)
        coach = self._coach_with_subscription()
        students = [
            self.players.create_player(f"Student {index}", f"80{index}0") for index in range(3)
        ]
        invitations = [
            licenses.create_coach_invitation(coach["id"], player_id=student["id"])
            for student in students
        ]
        self.assertTrue(licenses.accept_coach_invitation(students[0]["id"], invitations[0]["id"])["sponsored"])
        self.assertTrue(licenses.accept_coach_invitation(students[1]["id"], invitations[1]["id"])["sponsored"])
        third = licenses.accept_coach_invitation(students[2]["id"], invitations[2]["id"])
        self.assertFalse(third["sponsored"])
        self.assertIsNotNone(third["access"]["current_coach"])
        self.assertEqual(licenses.coach_dashboard(coach["id"])["sponsored_students"], 2)

    def test_concurrent_invitation_acceptance_cannot_exceed_seat_capacity(self):
        licenses = LicenseService(self.path, enforcement="enforced", coach_seat_capacity=1)
        coach = self._coach_with_subscription()
        second = self.players.create_player("Concurrent Golfer", "1357")
        invitations = [
            licenses.create_coach_invitation(coach["id"], player_id=player_id)
            for player_id in (self.player["id"], second["id"])
        ]

        def accept(args):
            player_id, invitation = args
            return licenses.accept_coach_invitation(player_id, invitation["id"])

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(accept, zip(
                (self.player["id"], second["id"]), invitations
            )))
        self.assertEqual(sum(result["sponsored"] for result in results), 1)
        dashboard = licenses.coach_dashboard(coach["id"])
        self.assertEqual(dashboard["sponsored_students"], 1)
        self.assertEqual(len(dashboard["students"]), 2)

    def test_dual_promotional_and_sponsored_grants_are_preserved(self):
        individual = self.licenses.create_access_code(self.admin["id"])
        self.licenses.redeem_access_code(self.player["id"], individual["code"])
        coach = self._coach_with_subscription()
        invitation = self.licenses.create_coach_invitation(
            coach["id"], player_id=self.player["id"]
        )
        self.licenses.accept_coach_invitation(self.player["id"], invitation["id"])
        grant_types = {
            grant["type"] for grant in self.licenses.access_summary(self.player["id"])["grants"]
        }
        self.assertEqual(grant_types, {"PROMOTIONAL", "COACH_SPONSORED"})

    def test_ending_relationship_releases_seat_but_not_other_access(self):
        individual = self.licenses.create_access_code(self.admin["id"])
        self.licenses.redeem_access_code(self.player["id"], individual["code"])
        coach = self._coach_with_subscription()
        invitation = self.licenses.create_coach_invitation(
            coach["id"], player_id=self.player["id"]
        )
        accepted = self.licenses.accept_coach_invitation(self.player["id"], invitation["id"])
        self.licenses.end_coach_relationship(self.player["id"], accepted["relationship_id"])
        access = self.licenses.access_summary(self.player["id"])
        self.assertIsNone(access["current_coach"])
        self.assertEqual([grant["type"] for grant in access["grants"]], ["PROMOTIONAL"])

    def test_player_cannot_accept_a_second_active_coach(self):
        first_coach = self._coach_with_subscription("First Coach")
        second_coach = self._coach_with_subscription("Second Coach")
        first = self.licenses.create_coach_invitation(
            first_coach["id"], player_id=self.player["id"]
        )
        second = self.licenses.create_coach_invitation(
            second_coach["id"], player_id=self.player["id"]
        )
        self.licenses.accept_coach_invitation(self.player["id"], first["id"])
        with self.assertRaisesRegex(LicenseError, "current Coach relationship"):
            self.licenses.accept_coach_invitation(self.player["id"], second["id"])

    def test_only_owning_coach_can_release_or_end_student_relationship(self):
        coach = self._coach_with_subscription("Owning Coach")
        other = self._coach_with_subscription("Other Coach")
        invitation = self.licenses.create_coach_invitation(
            coach["id"], player_id=self.player["id"]
        )
        accepted = self.licenses.accept_coach_invitation(self.player["id"], invitation["id"])
        with self.assertRaisesRegex(LicenseError, "not found"):
            self.licenses.release_sponsorship(other["id"], accepted["relationship_id"])
        with self.assertRaisesRegex(LicenseError, "not found"):
            self.licenses.end_coach_relationship(other["id"], accepted["relationship_id"])

    def test_coach_round_visibility_starts_with_relationship(self):
        coach = self._coach_with_subscription()
        old_completed = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
        with sqlite3.connect(self.path) as database:
            database.execute("""
                INSERT INTO completed_rounds(
                    id, player_id, fingerprint, course_id, course_name, tee,
                    completed_at, total_strokes, round_json
                ) VALUES ('old-round', ?, 'old-fingerprint', 'course', 'Course',
                          'White', ?, 80, '{}')
            """, (self.player["id"], old_completed))
        invitation = self.licenses.create_coach_invitation(
            coach["id"], player_id=self.player["id"]
        )
        self.licenses.accept_coach_invitation(self.player["id"], invitation["id"])
        new_completed = (datetime.now(timezone.utc) + timedelta(seconds=1)).isoformat()
        with sqlite3.connect(self.path) as database:
            database.execute("""
                INSERT INTO completed_rounds(
                    id, player_id, fingerprint, course_id, course_name, tee,
                    completed_at, total_strokes, round_json
                ) VALUES ('new-round', ?, 'new-fingerprint', 'course', 'Course',
                          'White', ?, 79, '{}')
            """, (self.player["id"], new_completed))
        self.assertFalse(self.licenses.coach_can_view_round(
            coach["id"], self.player["id"], "old-round"
        ))
        self.assertTrue(self.licenses.coach_can_view_round(
            coach["id"], self.player["id"], "new-round"
        ))

    def test_cancelled_invitation_disappears_without_consuming_a_seat(self):
        coach = self._coach_with_subscription()
        invitation = self.licenses.create_coach_invitation(
            coach["id"], player_id=self.player["id"]
        )
        self.licenses.cancel_coach_invitation(coach["id"], invitation["id"])
        dashboard = self.licenses.coach_dashboard(coach["id"])
        self.assertEqual(dashboard["pending_invitations"], [])
        self.assertEqual(dashboard["sponsored_students"], 0)
        self.assertEqual(dashboard["seats_available"], 10)

    def test_coach_past_due_grace_preserves_play_but_blocks_new_invitations(self):
        coach = self._coach_with_subscription()
        subscription_id = self.licenses.access_summary(coach["id"])["grants"][0]["subscription_id"]
        transition = self.licenses.transition_subscription(subscription_id, "PAST_DUE")
        self.assertEqual(transition["status"], "PAST_DUE")
        self.assertEqual(self.licenses.access_summary(coach["id"])["play_access"], "ACTIVE")
        with self.assertRaisesRegex(LicenseError, "active Jetta Coach"):
            self.licenses.create_coach_invitation(
                coach["id"], player_id=self.player["id"]
            )

    def test_elapsed_coach_grace_ends_sponsorship_not_relationship(self):
        coach = self._coach_with_subscription()
        invitation = self.licenses.create_coach_invitation(
            coach["id"], player_id=self.player["id"]
        )
        self.licenses.accept_coach_invitation(self.player["id"], invitation["id"])
        subscription_id = self.licenses.access_summary(coach["id"])["grants"][0]["subscription_id"]
        self.licenses.transition_subscription(subscription_id, "PAST_DUE")
        future = datetime.now(timezone.utc) + timedelta(days=31)
        self.licenses.reconcile_subscription_lifecycle(future)
        with sqlite3.connect(self.path) as database:
            relationship_status = database.execute("""
                SELECT status FROM coach_student_relationships WHERE player_id = ?
            """, (self.player["id"],)).fetchone()[0]
            seat_status = database.execute("""
                SELECT status FROM coach_seat_assignments WHERE player_id = ?
            """, (self.player["id"],)).fetchone()[0]
            sponsored_grant_status = database.execute("""
                SELECT status FROM entitlement_grants
                WHERE player_id = ? AND grant_type = 'COACH_SPONSORED'
            """, (self.player["id"],)).fetchone()[0]
        self.assertEqual(relationship_status, "ACTIVE")
        self.assertEqual(seat_status, "RELEASED")
        self.assertEqual(sponsored_grant_status, "ENDED")
        self.assertEqual(self.licenses.access_summary(self.player["id"])["play_access"], "HISTORICAL_ONLY")
        dashboard = self.licenses.coach_dashboard(coach["id"])
        self.assertEqual(dashboard["subscription_status"], "EXPIRED")
        self.assertEqual(len(dashboard["students"]), 1)
        self.assertEqual(dashboard["sponsored_students"], 0)

    def test_expired_individual_subscription_has_no_grace(self):
        code = self.licenses.create_access_code(self.admin["id"], duration_days=1)
        result = self.licenses.redeem_access_code(self.player["id"], code["code"])
        self.licenses.transition_subscription(result["subscription_id"], "EXPIRED")
        self.assertEqual(self.licenses.access_summary(self.player["id"])["play_access"], "HISTORICAL_ONLY")


if __name__ == "__main__":
    unittest.main()
