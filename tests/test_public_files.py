import http.client
import re
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from scripts.public_files import PUBLIC_FILES, public_file
from scripts import serve


class PublicFilePolicyTests(unittest.TestCase):
    def test_all_existing_browser_modules_are_explicitly_approved(self):
        root = Path(__file__).resolve().parents[1]
        modules = {str(path.relative_to(root)) for path in (root / "packages").rglob("*.mjs")}
        self.assertFalse(modules - PUBLIC_FILES)
        # Check static module imports as well, including root App/Mapper imports.
        for relative in PUBLIC_FILES:
            path = root / relative
            if path.suffix not in {".js", ".mjs"} or not path.is_file():
                continue
            for imported in re.findall(r'(?:from\s*|import\s*)[\"\'](\.[^\"\']+)[\"\']', path.read_text()):
                target = (path.parent / imported.split("?", 1)[0]).resolve()
                self.assertIn(str(target.relative_to(root)), PUBLIC_FILES, relative)

    def test_approved_names_cannot_expose_symlinked_private_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            private = root / "private.env"
            private.write_text("test-secret")
            (root / "app.js").symlink_to(private)
            self.assertIsNone(public_file(root, "/app.js"))
            (root / "data").symlink_to(root)
            self.assertIsNone(public_file(root, "/data/test/hole1.json"))


class StaticFileHttpTests(unittest.TestCase):
    def test_get_and_head_enforce_policy_for_both_server_roles(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = {
                "index.html", "editor.html", "app.js", "admin/index.html",
                "admin/admin.js", "assets/tree-canopy-top.png", "USERGUIDE.md",
                "packages/gps/browser_gps_mode.mjs", "data/mapped_courses.json",
                "packages/editor/illustrated_hole_prototype.mjs",
                "packages/simulation/fairway_first_cut.mjs",
                "data/test-course/hole1.json", "data/test-course/scorecard.csv",
                "data/test-course/images/hole1.png",
                "data/test-course/illustrations/hole18.jpg",
                ".env", ".git/HEAD", "data/player_accounts.sqlite3",
                "data/player_accounts.sqlite3-wal", "data/course_imports.sqlite3",
                "scripts/serve.py", "tests/secret.js", "app.js.bak",
                "data/test-course/backup.json", "data/test-course/hole1.json.bak",
                "data/fixtures/default_profiles.json", "README.md",
            }
            for relative in files:
                file = root / relative
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text("fixture-content")
            with patch.object(serve, "ROOT", root):
                server = ThreadingHTTPServer(("127.0.0.1", 0), serve.AppHandler)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    allowed = files & PUBLIC_FILES | {
                        "data/test-course/hole1.json", "data/test-course/scorecard.csv",
                        "data/test-course/images/hole1.png",
                        "data/test-course/illustrations/hole18.jpg",
                    }
                    blocked = files - allowed
                    blocked |= {
                        "data/", "packages/", ".git/", "%2eenv", "%2egit/HEAD",
                        "data/test-course/../../.env", "data/test-course/%2e%2e/%2e%2e/.env",
                        "data%5cplayer_accounts.sqlite3", "app.js%00", "%FF",
                        "data/test-course/hole19.json",
                    }
                    for role in ("app", "mapper"):
                        with patch.object(serve, "SERVER_ROLE", role):
                            for method in ("GET", "HEAD"):
                                for relative in allowed | blocked:
                                    with self.subTest(role=role, method=method, path=relative):
                                        connection = http.client.HTTPConnection("127.0.0.1", server.server_port)
                                        connection.request(method, "/" + relative + "?v=test")
                                        response = connection.getresponse()
                                        response.read()
                                        # Existing App-to-Mapper editor redirect remains.
                                        redirected = method == "GET" and (
                                            (role == "app" and relative == "editor.html")
                                            or (role == "mapper" and relative == "index.html")
                                        )
                                        expected = 307 if redirected else 200 if relative in allowed else 404
                                        self.assertEqual(response.status, expected)
                                        connection.close()
                    connection = http.client.HTTPConnection("127.0.0.1", server.server_port)
                    connection.request("GET", "/admin/")
                    response = connection.getresponse()
                    self.assertEqual(response.status, 200)
                    response.read()
                    connection.close()
                finally:
                    server.shutdown()
                    server.server_close()
                    thread.join()
