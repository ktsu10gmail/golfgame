import http.client
import json
import sqlite3
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

from packages.accounts import AdminOperationsService, LicenseService, PlayerStore
from scripts import serve as serve_module


class AdminHttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "players.sqlite3"
        self.players = PlayerStore(self.path)
        self.admin = self.players.create_player("HTTP Admin", "1234")
        self.player = self.players.create_player("HTTP Player", "5678")
        self.coach = self.players.create_player("HTTP Coach", "9012")
        self.licenses = LicenseService(self.path, enforcement="shadow")
        self.licenses.ensure_role(self.admin["id"], "ADMIN")
        self.licenses.ensure_role(self.coach["id"], "COACH")
        self.operations = AdminOperationsService(self.path, self.licenses)
        self.originals = (
            serve_module.PLAYER_STORE,
            serve_module.LICENSE_SERVICE,
            serve_module.ADMIN_OPERATIONS,
            serve_module.SUPABASE_AUTH,
            serve_module.DEVELOPER_EMAILS,
            serve_module.DEVELOPER_NAMES,
        )
        serve_module.PLAYER_STORE = self.players
        serve_module.LICENSE_SERVICE = self.licenses
        serve_module.ADMIN_OPERATIONS = self.operations
        serve_module.SUPABASE_AUTH = None
        serve_module.DEVELOPER_EMAILS = set()
        serve_module.DEVELOPER_NAMES = set()
        self.tokens = {
            "admin": self.players.create_session(self.admin["id"]),
            "player": self.players.create_session(self.player["id"]),
            "coach": self.players.create_session(self.coach["id"]),
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
            serve_module.DEVELOPER_EMAILS,
            serve_module.DEVELOPER_NAMES,
        ) = self.originals
        self.temp.cleanup()

    def request(self, method, path, *, role=None, payload=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        headers = {}
        if role:
            headers["Cookie"] = f"{serve_module.SESSION_COOKIE}={self.tokens[role]}"
        body = None
        if payload is not None:
            body = json.dumps(payload)
            headers["Content-Type"] = "application/json"
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        raw = response.read()
        result = (response.status, dict(response.getheaders()), raw)
        connection.close()
        return result

    def test_admin_redirect_and_shell_are_data_free(self):
        status, headers, _ = self.request("GET", "/admin")
        self.assertEqual(status, 308)
        self.assertEqual(headers["Location"], "/admin/")
        status, _, body = self.request("GET", "/admin/")
        self.assertEqual(status, 200)
        text = body.decode("utf-8")
        self.assertIn("Restricted Jetta Back Office", text)
        self.assertNotIn("HTTP Admin", text)
        self.assertNotIn("HTTP Player", text)

    def test_admin_api_requires_server_authorization_for_every_role(self):
        self.assertEqual(self.request("GET", "/api/admin/session")[0], 401)
        self.assertEqual(self.request("GET", "/api/admin/session", role="player")[0], 403)
        self.assertEqual(self.request("GET", "/api/admin/session", role="coach")[0], 403)
        status, _, body = self.request("GET", "/api/admin/session", role="admin")
        self.assertEqual(status, 200)
        payload = json.loads(body)
        self.assertEqual(payload["admin"]["id"], self.admin["id"])
        self.assertEqual(payload["enforcement_mode"], "SHADOW")

    def test_player_session_uses_unauthorized_status_to_trigger_browser_refresh(self):
        status, _, body = self.request("GET", "/api/player/session")
        self.assertEqual(status, 401)
        self.assertEqual(json.loads(body)["error"], "player login required")

    def test_unknown_admin_route_cannot_bypass_central_gate(self):
        self.assertEqual(self.request("GET", "/api/admin/not-real")[0], 401)
        self.assertEqual(self.request("GET", "/api/admin/not-real", role="player")[0], 403)
        self.assertEqual(self.request("GET", "/api/admin/not-real", role="admin")[0], 404)

    def test_code_generation_uses_authenticated_admin_as_audit_actor(self):
        status, _, body = self.request(
            "POST", "/api/admin/access-codes", role="admin",
            payload={"plan": "INDIVIDUAL", "duration_days": 90, "max_redemptions": 1,
                     "actor_player_id": self.player["id"]},
        )
        self.assertEqual(status, 201)
        generated = json.loads(body)["access_code"]
        self.assertTrue(generated["code"].startswith("JETTA-"))
        status, _, body = self.request("GET", "/api/admin/access-codes", role="admin")
        self.assertEqual(status, 200)
        self.assertNotIn(generated["code"], body.decode("utf-8"))
        with sqlite3.connect(self.path) as database:
            actor = database.execute("""
                SELECT actor_player_id FROM license_audit_events
                WHERE event_type = 'ACCESS_CODE_CREATED' ORDER BY created_at DESC LIMIT 1
            """).fetchone()[0]
        self.assertEqual(actor, self.admin["id"])

    def test_invalid_admin_parameters_return_controlled_bad_request(self):
        status, _, body = self.request(
            "GET", "/api/admin/users?query=x&limit=500", role="admin"
        )
        self.assertEqual(status, 400)
        self.assertIn("error", json.loads(body))


if __name__ == "__main__":
    unittest.main()
