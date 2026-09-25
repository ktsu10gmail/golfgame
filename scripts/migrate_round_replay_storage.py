#!/usr/bin/env python3
"""Safely migrate monolithic rounds into compact, hole-addressable replay storage."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
import tempfile
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from packages.accounts import PlayerStore


def canonical_evidence(round_save: dict) -> str:
    value = deepcopy(round_save)
    value.pop("course_version_id", None)
    value.get("round_state", {}).pop("course_version_id", None)
    for hole in value["round_state"]["holes"]:
        for event in hole.get("events", []):
            payload = event.get("payload")
            if not isinstance(payload, dict):
                continue
            shot = payload.get("shot") if isinstance(payload.get("shot"), dict) else payload
            request = shot.get("resultRequest") if isinstance(shot, dict) else None
            if not isinstance(request, dict):
                continue
            request.pop("geometry_ref", None)
            context = request.get("context")
            if isinstance(context, dict):
                context.pop("surfaces", None)
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def fetch_round(database_path: Path, player_id: int, course_id: str) -> dict:
    with sqlite3.connect(database_path) as database:
        row = database.execute(
            "SELECT round_json FROM player_rounds WHERE player_id = ? AND course_id = ?",
            (player_id, course_id),
        ).fetchone()
    if row is None:
        raise SystemExit("The requested player round was not found.")
    return json.loads(row[0])


def online_backup(source_path: Path, destination_path: Path) -> None:
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(source_path) as source, sqlite3.connect(destination_path) as destination:
        source.backup(destination)


def migrate_copy(database_path: Path, player_id: int, course_id: str, version_id: str) -> dict:
    original = fetch_round(database_path, player_id, course_id)
    before_bytes = len(json.dumps(original, separators=(",", ":")).encode("utf-8"))
    expected = canonical_evidence(original)
    original["course_version_id"] = version_id
    original["round_state"]["course_version_id"] = version_id
    result = PlayerStore(database_path).save_round(player_id, original)
    migrated = fetch_round(database_path, player_id, course_id)
    actual = canonical_evidence(migrated)
    if actual != expected:
        raise RuntimeError("Migration changed round evidence; the source database was not approved.")
    after_bytes = len(json.dumps(migrated, separators=(",", ":")).encode("utf-8"))
    result.update({
        "course_id": course_id,
        "course_version_id": version_id,
        "evidence_sha256": actual,
        "bytes_before": before_bytes,
        "bytes_after": after_bytes,
        "bytes_removed": before_bytes - after_bytes,
    })
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=Path("data/player_accounts.sqlite3"))
    parser.add_argument("--player-id", type=int, required=True)
    parser.add_argument("--course-id", required=True)
    parser.add_argument("--course-version-id", required=True)
    parser.add_argument("--apply", action="store_true", help="Apply after the mandatory copy verification.")
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix="golf-replay-migration-") as temporary:
        test_database = Path(temporary) / "migration-test.sqlite3"
        online_backup(args.database, test_database)
        dry_run = migrate_copy(
            test_database, args.player_id, args.course_id, args.course_version_id
        )
    output = {"copy_test": dry_run, "applied": False}
    if args.apply:
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup = args.database.parent / "backups" / f"player_accounts-before-replay-{timestamp}.sqlite3"
        online_backup(args.database, backup)
        output["live"] = migrate_copy(
            args.database, args.player_id, args.course_id, args.course_version_id
        )
        output["backup"] = str(backup)
        output["applied"] = True
    print(json.dumps(output, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
