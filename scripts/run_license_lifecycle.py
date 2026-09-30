#!/usr/bin/env python3
"""Run one bounded Jetta licensing lifecycle/notification pass."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from packages.accounts.runtime import create_account_runtime, load_local_environment


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    arguments = parser.parse_args()
    if arguments.dry_run:
        load_local_environment(ROOT / ".env")
        path = Path(os.getenv("GOLFGAME_PLAYER_DB", ROOT / "data" / "player_accounts.sqlite3"))
        uri = f"file:{path.resolve()}?mode=ro"
        with sqlite3.connect(uri, uri=True, timeout=10) as database:
            due = database.execute("""
                SELECT COUNT(*) FROM license_notifications
                WHERE status IN ('PENDING', 'FAILED') AND due_at <= ?
            """, (datetime.now(timezone.utc).isoformat(timespec="microseconds"),)).fetchone()[0]
        print(json.dumps({"mode": "dry-run", "due_notifications": due}, sort_keys=True))
        return 0
    runtime = create_account_runtime(ROOT)
    summary = runtime.notification_service.run_once(worker_id=f"pid-{os.getpid()}")
    print(json.dumps({"mode": "run", **summary}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
