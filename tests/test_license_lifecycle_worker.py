import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from packages.accounts import LicenseService, PlayerStore


ROOT = Path(__file__).resolve().parents[1]


class LicenseLifecycleWorkerTests(unittest.TestCase):
    def test_dry_run_opens_the_database_read_only(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "players.sqlite3"
            PlayerStore(path)
            LicenseService(path)
            with sqlite3.connect(path) as database:
                before = database.total_changes
                migration_count = database.execute(
                    "SELECT COUNT(*) FROM license_schema_migrations"
                ).fetchone()[0]
                notification_count = database.execute(
                    "SELECT COUNT(*) FROM license_notifications"
                ).fetchone()[0]

            environment = os.environ.copy()
            environment["GOLFGAME_PLAYER_DB"] = str(path)
            result = subprocess.run(
                [sys.executable, "scripts/run_license_lifecycle.py", "--dry-run"],
                cwd=ROOT,
                env=environment,
                capture_output=True,
                text=True,
                check=True,
            )

            self.assertEqual(
                json.loads(result.stdout),
                {"due_notifications": 0, "mode": "dry-run"},
            )
            with sqlite3.connect(path) as database:
                self.assertEqual(database.total_changes, before)
                self.assertEqual(
                    database.execute(
                        "SELECT COUNT(*) FROM license_schema_migrations"
                    ).fetchone()[0],
                    migration_count,
                )
                self.assertEqual(
                    database.execute(
                        "SELECT COUNT(*) FROM license_notifications"
                    ).fetchone()[0],
                    notification_count,
                )


if __name__ == "__main__":
    unittest.main()
