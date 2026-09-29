import sqlite3
import tempfile
import unittest
from pathlib import Path

from packages.accounts import AdminOperationsService, LicenseError, LicenseService, PlayerStore


class AdminOperationsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "players.sqlite3"
        self.players = PlayerStore(self.path)
        self.admin = self.players.create_player("Admin Operator", "1234")
        self.player = self.players.create_player("David Player", "5678")
        self.licenses = LicenseService(self.path, enforcement="enforced")
        self.licenses.ensure_role(self.admin["id"], "ADMIN")
        self.operations = AdminOperationsService(self.path, self.licenses)

    def tearDown(self):
        self.temp.cleanup()

    def test_search_is_bounded_and_returns_only_safe_identity_fields(self):
        with self.assertRaisesRegex(LicenseError, "at least two"):
            self.operations.search_users("D")
        result = self.operations.search_users("David", limit=1)
        self.assertEqual(len(result["items"]), 1)
        account = result["items"][0]
        self.assertEqual(account["identity_type"], "LOCAL_DEVELOPMENT")
        self.assertEqual(account["account_status"], "EXISTS")
        self.assertNotIn("pin_hash", account)
        self.assertNotIn("pin_salt", account)
        with self.assertRaisesRegex(LicenseError, "between 1 and 100"):
            self.operations.search_users("David", limit=101)

    def test_search_cursor_is_stable_for_duplicate_display_sort_values(self):
        self.players.create_player("David Two", "2468")
        self.players.create_player("David Three", "1357")
        first = self.operations.search_users("David", limit=2)
        self.assertEqual(len(first["items"]), 2)
        self.assertIsNotNone(first["next_cursor"])
        second = self.operations.search_users("David", limit=2, cursor=first["next_cursor"])
        first_ids = {item["id"] for item in first["items"]}
        self.assertTrue(all(item["id"] not in first_ids for item in second["items"]))

    def test_supabase_linked_identity_uses_account_language(self):
        linked = self.players.upsert_supabase_player("uuid-123", "linked@example.com", "Linked Player")
        result = self.operations.user_detail(linked["id"])
        self.assertEqual(result["account"]["account_status"], "EXISTS")
        self.assertEqual(result["account"]["identity_label"], "Supabase linked")
        self.assertNotIn("authentication", result["account"])

    def test_code_listing_and_redemption_history_never_return_secret_material(self):
        created = self.licenses.create_access_code(self.admin["id"])
        self.licenses.redeem_access_code(self.player["id"], created["code"])
        listed = self.operations.access_codes()["items"][0]
        self.assertEqual(listed["created_by_name"], "Admin Operator")
        self.assertNotIn("code_hash", listed)
        self.assertNotIn("code", listed)
        history = self.operations.code_redemptions(created["id"])
        self.assertEqual(history["items"][0]["player_id"], self.player["id"])
        self.assertNotIn("code_hash", history["code"])

    def test_user_detail_uses_three_part_authoritative_diagnostic(self):
        detail = self.operations.user_detail(self.player["id"])
        diagnostic = detail["diagnostic"]
        self.assertEqual(diagnostic["entitlement_decision"], "DENIED")
        self.assertEqual(diagnostic["enforcement_mode"], "ENFORCED")
        self.assertEqual(diagnostic["runtime_result"], "DENIED")
        self.assertEqual(detail["subscriptions"], [])
        self.assertEqual(detail["grants"], [])

    def test_coach_detail_preserves_released_but_active_relationship(self):
        coach = self.players.create_player("Coach Inspector", "9999")
        coach_code = self.licenses.create_access_code(self.admin["id"], plan="COACH")
        self.licenses.redeem_access_code(coach["id"], coach_code["code"])
        invitation = self.licenses.create_coach_invitation(coach["id"], player_id=self.player["id"])
        accepted = self.licenses.accept_coach_invitation(self.player["id"], invitation["id"])
        self.licenses.release_sponsorship(coach["id"], accepted["relationship_id"])
        detail = self.operations.coach_detail(coach["id"])
        self.assertEqual(detail["relationships"][0]["relationship_status"], "ACTIVE")
        self.assertEqual(detail["relationships"][0]["seat_status"], "RELEASED")
        self.assertEqual(detail["sponsored_students"], 0)

    def test_audit_is_bounded_filtered_and_handles_malformed_legacy_detail(self):
        with sqlite3.connect(self.path) as database:
            database.execute("""
                INSERT INTO license_audit_events(
                    id, actor_player_id, subject_player_id, event_type,
                    entity_type, entity_id, detail_json, created_at
                ) VALUES ('legacy-event', ?, ?, 'LEGACY_EVENT', 'player', ?,
                          'not-json', '2026-09-29T00:00:00+00:00')
            """, (self.admin["id"], self.player["id"], str(self.player["id"])))
        result = self.operations.audit_events(event_type="LEGACY_EVENT", limit=1)
        self.assertEqual(len(result["items"]), 1)
        self.assertIn("unparsed", result["items"][0]["detail"])
        with self.assertRaisesRegex(LicenseError, "cursor"):
            self.operations.audit_events(before="not-a-cursor")


if __name__ == "__main__":
    unittest.main()
