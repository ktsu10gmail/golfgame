import http.client
import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

from packages.accounts import (
    AdminOperationsService,
    CoursePreferenceService,
    LicenseService,
    PlayerStore,
)
from scripts import serve as serve_module


class CoursePreferenceHttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.path = root / "players.sqlite3"
        directory = root / "courses.csv"
        directory.write_text(
            "Course Name,Country,State,City,Type\n"
            "Mercer Oaks West,US,NJ,West Windsor,Public/Municipal\n"
            "Makefield Highlands Golf Club,US,PA,Yardley,Public\n",
            encoding="utf-8",
        )
        self.players = PlayerStore(self.path)
        self.player = self.players.create_player("HTTP Course Player", "1234")
        self.licenses = LicenseService(self.path, enforcement="shadow")
        self.preferences = CoursePreferenceService(self.path, directory)
        self.originals = (
            serve_module.PLAYER_STORE,
            serve_module.LICENSE_SERVICE,
            serve_module.ADMIN_OPERATIONS,
            serve_module.COURSE_PREFERENCE_SERVICE,
            serve_module.SUPABASE_AUTH,
            serve_module.DEVELOPER_EMAILS,
            serve_module.DEVELOPER_NAMES,
        )
        serve_module.PLAYER_STORE = self.players
        serve_module.LICENSE_SERVICE = self.licenses
        serve_module.ADMIN_OPERATIONS = AdminOperationsService(self.path, self.licenses)
        serve_module.COURSE_PREFERENCE_SERVICE = self.preferences
        serve_module.SUPABASE_AUTH = None
        serve_module.DEVELOPER_EMAILS = set()
        serve_module.DEVELOPER_NAMES = set()
        self.token = self.players.create_session(self.player["id"])
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
            serve_module.COURSE_PREFERENCE_SERVICE,
            serve_module.SUPABASE_AUTH,
            serve_module.DEVELOPER_EMAILS,
            serve_module.DEVELOPER_NAMES,
        ) = self.originals
        self.temp.cleanup()

    def request(self, method, path, payload=None, authenticated=True):
        connection = http.client.HTTPConnection(
            "127.0.0.1", self.server.server_port, timeout=5
        )
        headers = {}
        if authenticated:
            headers["Cookie"] = f"{serve_module.SESSION_COOKIE}={self.token}"
        body = None
        if payload is not None:
            headers["Content-Type"] = "application/json"
            body = json.dumps(payload)
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        result = response.status, json.loads(response.read())
        connection.close()
        return result

    def test_search_and_preferences_require_login_and_use_authenticated_owner(self):
        self.assertEqual(self.request(
            "GET", "/api/player/course-directory/search?query=mercer",
            authenticated=False,
        )[0], 401)
        status, result = self.request(
            "GET", "/api/player/course-directory/search?query=mercer"
        )
        self.assertEqual(status, 200)
        course_id = result["items"][0]["id"]
        status, result = self.request(
            "POST", "/api/player/preferred-courses",
            {"course_id": course_id, "player_id": 999999},
        )
        self.assertEqual(status, 200)
        self.assertEqual(result["items"][0]["id"], course_id)
        self.assertEqual(
            self.preferences.preferred_courses(self.player["id"])[0]["id"], course_id
        )

    def test_remove_is_idempotent(self):
        course_id = self.request(
            "GET", "/api/player/course-directory/search?query=makefield"
        )[1]["items"][0]["id"]
        self.request("POST", "/api/player/preferred-courses", {"course_id": course_id})
        status, result = self.request(
            "POST", "/api/player/preferred-courses/remove", {"course_id": course_id}
        )
        self.assertEqual(status, 200)
        self.assertEqual(result["items"], [])
        self.assertEqual(self.request(
            "POST", "/api/player/preferred-courses/remove", {"course_id": course_id}
        )[0], 200)

    def test_production_queue_and_claim_require_developer_access(self):
        course_id = self.request(
            "GET", "/api/player/course-directory/search?query=makefield"
        )[1]["items"][0]["id"]
        self.request("POST", "/api/player/preferred-courses", {"course_id": course_id})
        self.assertEqual(self.request(
            "GET", "/api/v1/course-production/queue", authenticated=False
        )[0], 401)
        self.assertEqual(self.request("GET", "/api/v1/course-production/queue")[0], 403)

        serve_module.DEVELOPER_NAMES = {self.player["name"].casefold()}
        status, queue = self.request("GET", "/api/v1/course-production/queue")
        self.assertEqual(status, 200)
        production_id = queue["requests"][0]["production_item_id"]
        status, claimed = self.request(
            "POST", f"/api/v1/course-production/{production_id}/claim",
            {"production_item_id": production_id},
        )
        self.assertEqual(status, 200)
        self.assertEqual(claimed["production_item"]["status"], "IN_PROGRESS")

    def test_mapper_import_refresh_commit_and_install_routes_are_protected(self):
        protected = [
            ("GET", "/api/v1/course-import/openstreetmap/status", None),
            ("POST", "/api/v1/course-import/openstreetmap/search", {"latitude": 1, "longitude": 1}),
            ("POST", "/api/v1/course-import/openstreetmap/preview", {"external_id": "way/1"}),
            ("POST", "/api/v1/course-import/openstreetmap/import", {"job_id": "missing"}),
            ("POST", "/api/v1/course-import/golf-intelligence/search", {"keywords": "test"}),
            ("POST", "/api/course-mapper/install", {"version": "invalid"}),
        ]
        for method, path, payload in protected:
            with self.subTest(path=path, identity="anonymous"):
                status, _ = self.request(
                    method, path, payload, authenticated=False
                )
                self.assertEqual(status, 401)
            with self.subTest(path=path, identity="player"):
                self.assertEqual(self.request(method, path, payload)[0], 403)


if __name__ == "__main__":
    unittest.main()
