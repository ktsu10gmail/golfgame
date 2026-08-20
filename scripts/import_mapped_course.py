#!/usr/bin/env python3
"""Install a Course Mapper game package into the local golf game."""

from __future__ import annotations

import argparse
import base64
import binascii
import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from packages.golf_domain.course_adapter import adapt_hole_payload


DATA_DIR = ROOT / "data"
CATALOG_PATH = DATA_DIR / "mapped_courses.json"
PACKAGE_VERSION = "golf-game-course-package-v1"
SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
IMAGE_DATA = re.compile(r"^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=\s]+)$")


def decoded_hole_images(payload: dict) -> dict[int, tuple[str, bytes]]:
    images = payload.get("hole_images")
    if images is None:
        return {}
    if not isinstance(images, dict):
        raise ValueError("Package hole_images must contain an object")
    decoded: dict[int, tuple[str, bytes]] = {}
    extensions = {"jpeg": "jpg", "png": "png", "webp": "webp"}
    for hole_number in range(1, 19):
        source = images.get(str(hole_number))
        if source is None:
            continue
        if not isinstance(source, str) or not (match := IMAGE_DATA.fullmatch(source)):
            raise ValueError(f"Hole {hole_number} artwork must be a JPEG, PNG, or WebP data URL")
        try:
            content = base64.b64decode(match.group(2), validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError(f"Hole {hole_number} artwork contains invalid base64 data") from error
        if not content or len(content) > 3 * 1024 * 1024:
            raise ValueError(f"Hole {hole_number} artwork must be between 1 byte and 3 MB")
        decoded[hole_number] = (extensions[match.group(1)], content)
    return decoded


def validate_course_holes(payload: dict) -> None:
    course_id = payload["course_id"]
    for hole_number in range(1, 19):
        try:
            adapted = adapt_hole_payload(
                payload["holes"][str(hole_number)],
                course_id=course_id,
                source=f"mapped package hole {hole_number}",
            )
        except ValueError as error:
            raise ValueError(f"Course geometry validation failed: {error}") from error
        if adapted.hole_number != hole_number:
            raise ValueError(
                f"Course geometry validation failed: package hole {hole_number} "
                f"contains hole number {adapted.hole_number}"
            )


def load_package(path: Path) -> dict:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Could not read package: {error}") from error
    return validate_package(payload)


def validate_package(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("Package must contain a JSON object")
    if payload.get("version") != PACKAGE_VERSION:
        raise ValueError(f"Unsupported package version: {payload.get('version', 'missing')}")
    course_id = payload.get("course_id")
    if not isinstance(course_id, str) or not SAFE_ID.fullmatch(course_id):
        raise ValueError("Package course_id must contain only lowercase letters, numbers, and hyphens")
    if not isinstance(payload.get("course_name"), str) or not payload["course_name"].strip():
        raise ValueError("Package course_name is missing")
    holes = payload.get("holes")
    if not isinstance(holes, dict):
        raise ValueError("Package holes are missing")
    missing = [number for number in range(1, 19) if str(number) not in holes]
    if missing:
        raise ValueError(
            "A game import requires all 18 holes; missing "
            + ", ".join(str(number) for number in missing)
        )
    if not isinstance(payload.get("scorecard_csv"), str):
        raise ValueError("Package scorecard_csv is missing")
    decoded_hole_images(payload)
    validate_course_holes(payload)
    return payload


def load_catalog() -> list[dict]:
    if not CATALOG_PATH.exists():
        return []
    try:
        catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"{CATALOG_PATH} contains invalid JSON") from error
    if not isinstance(catalog, list):
        raise ValueError(f"{CATALOG_PATH} must contain a JSON array")
    return catalog


def install_package(payload: dict, *, force: bool) -> Path:
    validate_course_holes(payload)
    hole_images = decoded_hole_images(payload)
    course_id = payload["course_id"]
    destination = DATA_DIR / course_id
    if destination.exists() and not force:
        raise ValueError(
            f"{destination} already exists; rerun with --force to update this mapped course"
        )
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "scorecard.csv").write_text(payload["scorecard_csv"], encoding="utf-8")
    for hole_number in range(1, 19):
        hole_path = destination / f"hole{hole_number}.json"
        hole_path.write_text(
            json.dumps(payload["holes"][str(hole_number)], indent=2) + "\n",
            encoding="utf-8",
        )
    if hole_images:
        illustrations = destination / "illustrations"
        illustrations.mkdir(parents=True, exist_ok=True)
        for hole_number, (extension, content) in hole_images.items():
            (illustrations / f"hole{hole_number}.{extension}").write_bytes(content)

    entry = {
        "id": course_id,
        "name": payload["course_name"].strip(),
        "shortName": payload["course_name"].strip(),
        "dataPath": f"data/{course_id}",
        "scorecard": "scorecard.csv",
        "dataVersion": payload.get("exported_at", "mapped-v1"),
        "mapUpdatedAt": payload.get("exported_at", "mapped-v1"),
        "images": False,
        "illustrations": len(hole_images) == 18,
        "illustrationPath": f"data/{course_id}/illustrations" if hole_images else "",
        "illustrationExtension": next(iter(hole_images.values()))[0] if hole_images else "jpg",
        "teeLabels": {"Blue": "Blue", "White": "White", "Red": "Forward"},
    }
    catalog = [item for item in load_catalog() if item.get("id") != course_id]
    catalog.append(entry)
    catalog.sort(key=lambda item: item.get("name", ""))
    CATALOG_PATH.write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
    return destination


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path, help="Exported .golfcourse.json file")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Update an existing mapped course with the same course id",
    )
    args = parser.parse_args()
    try:
        payload = load_package(args.package.resolve())
        destination = install_package(payload, force=args.force)
    except ValueError as error:
        parser.error(str(error))
    print(f"Installed {payload['course_name']} in {destination}")
    print("Reload the game page, then choose the course from the course menu.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
