import http.client
import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

from packages.accounts import AdminOperationsService, LicenseService, PlayerStore
from scripts import serve as serve_module


class _Mailer:
    def __init__(self):
        self.messages = []

    def send_coach_invitation(self, recipient, coach_name, invitation_token):
        self.messages.append((recipient, coach_name, invitation_token))
        return {"status": "SENT", "provider": "SMTP2GO", "message_id": "message-1"}


class CoachInvitationHttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "players.sqlite3"
        self.players = PlayerStore(self.path)
        self.admin = self.players.create_player("Admin", "1234")
        self.coach = self.players.upsert_supabase_player(
            "auth-coach", "coach@example.com", "Coach David"
        )
        self.student = self.players.upsert_supabase_player(
            "auth-student", "student@example.com", "Student Sam"
        )
        self.licenses = LicenseService(self.path, enforcement="shadow")
        self.licenses.ensure_role(self.admin["id"], "ADMIN")
        code = self.licenses.create_access_code(self.admin["id"], plan="COACH")
        self.licenses.redeem_access_code(self.coach["id"], code["code"])
        self.mailer = _Mailer()
        self.originals = (
            serve_module.PLAYER_STORE,
            serve_module.LICENSE_SERVICE,
            serve_module.ADMIN_OPERATIONS,
            serve_module.SUPABASE_AUTH,
            serve_module.SMTP2GO_MAILER,
            serve_module.DEVELOPER_EMAILS,
            serve_module.DEVELOPER_NAMES,
        )
        serve_module.PLAYER_STORE = self.players
        serve_module.LICENSE_SERVICE = self.licenses
        serve_module.ADMIN_OPERATIONS = AdminOperationsService(self.path, self.licenses)
        serve_module.SUPABASE_AUTH = None
        serve_module.SMTP2GO_MAILER = self.mailer
        serve_module.DEVELOPER_EMAILS = set()
        serve_module.DEVELOPER_NAMES = set()
        self.tokens = {
            "coach": self.players.create_session(self.coach["id"]),
            "student": self.players.create_session(self.student["id"]),
        }
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), serve_module.AppHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        (
            serve_module.PLAYER_STORE,
            serve_module.LICENSE_SERVICE,
            serve_module.ADMIN_OPERATIONS,
            serve_module.SUPABASE_AUTH,
            serve_module.SMTP2GO_MAILER,
            serve_module.DEVELOPER_EMAILS,
            serve_module.DEVELOPER_NAMES,
        ) = self.originals
        self.temp.cleanup()

    def request(self, path, *, role=None, payload=None):
        connection = http.client.HTTPConnection(
            "127.0.0.1", self.server.server_port, timeout=5
        )
        headers = {"Content-Type": "application/json"}
        if role:
            headers["Cookie"] = f"{serve_module.SESSION_COOKIE}={self.tokens[role]}"
        connection.request("POST", path, body=json.dumps(payload or {}), headers=headers)
        response = connection.getresponse()
        result = response.status, json.loads(response.read())
        connection.close()
        return result

    def test_create_sends_email_without_returning_plaintext_token(self):
        status, payload = self.request(
            "/api/coach/invitations", role="coach",
            payload={"email": "student@example.com"},
        )
        self.assertEqual(status, 201)
        self.assertEqual(payload["invitation"]["email_delivery"]["status"], "SENT")
        self.assertNotIn("token", payload["invitation"])
        self.assertEqual(self.mailer.messages[0][:2], (
            "student@example.com", "Coach David"
        ))
        self.assertTrue(self.mailer.messages[0][2].startswith("JINV-"))

    def test_link_claim_requires_login_and_matching_account(self):
        status, _ = self.request(
            "/api/coach/invitations", role="coach",
            payload={"email": "student@example.com"},
        )
        self.assertEqual(status, 201)
        token = self.mailer.messages[-1][2]
        self.assertEqual(self.request(
            "/api/player/coach-invitations/claim", payload={"token": token}
        )[0], 401)
        status, payload = self.request(
            "/api/player/coach-invitations/claim", role="student",
            payload={"token": token},
        )
        self.assertEqual(status, 200)
        self.assertEqual(len(payload["access"]["pending_invitations"]), 1)

    def test_non_coach_cannot_send_invitation(self):
        self.assertEqual(self.request(
            "/api/coach/invitations", role="student",
            payload={"email": "someone@example.com"},
        )[0], 403)


if __name__ == "__main__":
    unittest.main()
