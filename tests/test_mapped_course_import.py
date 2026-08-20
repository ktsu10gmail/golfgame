import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "import_mapped_course.py"
SPEC = importlib.util.spec_from_file_location("import_mapped_course", SCRIPT)
IMPORTER = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(IMPORTER)


def package() -> dict:
    holes = {
        str(number): {
            "hole_metadata": {
                "course_name": "Mapped Links",
                "hole_number": number,
                "par": 4,
                "handicap_rating": number,
                "total_distance_meters": 100,
                "coordinate_system": {"unit": "meters"},
            },
            "centerline_waypoints": [
                {"index": 0, "point": [0, 0]},
                {"index": 1, "point": [0, 100]},
            ],
            "geometries": {
                "tee_boxes": [
                    {
                        "id": f"tee_h{number}",
                        "polygon": [[-5, -5], [5, -5], [5, 8], [-5, 8]],
                    }
                ],
                "fairway_segments": [],
                "rough_zones": [
                    {
                        "id": f"rough_h{number}",
                        "polygon": [[-40, -10], [40, -10], [40, 110], [-40, 110]],
                    }
                ],
                "hazards": [],
                "green_complex": {
                    "id": f"green_h{number}",
                    "polygon": [[-12, 88], [12, 88], [12, 112], [-12, 112]],
                },
                "out_of_bounds": [],
            },
        }
        for number in range(1, 19)
    }
    return {
        "version": IMPORTER.PACKAGE_VERSION,
        "course_id": "mapped-links",
        "course_name": "Mapped Links",
        "exported_at": "2026-07-30T12:00:00Z",
        "scorecard_csv": "Hole,Par\n1,4\n",
        "holes": holes,
    }


class MappedCourseImporterTests(unittest.TestCase):
    def test_validate_package_accepts_an_in_memory_editor_export(self) -> None:
        payload = package()
        self.assertIs(IMPORTER.validate_package(payload), payload)

    def test_validate_package_rejects_non_object_json(self) -> None:
        with self.assertRaisesRegex(ValueError, "JSON object"):
            IMPORTER.validate_package([])

    def test_load_package_requires_all_18_holes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "course.json"
            payload = package()
            del payload["holes"]["18"]
            path.write_text(json.dumps(payload), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "missing 18"):
                IMPORTER.load_package(path)

    def test_install_writes_holes_scorecard_and_catalog(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            data_dir = Path(directory) / "data"
            catalog = data_dir / "mapped_courses.json"
            data_dir.mkdir()
            catalog.write_text("[]\n", encoding="utf-8")

            with (
                patch.object(IMPORTER, "DATA_DIR", data_dir),
                patch.object(IMPORTER, "CATALOG_PATH", catalog),
            ):
                destination = IMPORTER.install_package(package(), force=False)

            self.assertTrue((destination / "hole18.json").exists())
            self.assertEqual(
                (destination / "scorecard.csv").read_text(encoding="utf-8"),
                "Hole,Par\n1,4\n",
            )
            installed_catalog = json.loads(catalog.read_text(encoding="utf-8"))
            self.assertEqual(installed_catalog[0]["id"], "mapped-links")
            self.assertEqual(installed_catalog[0]["mapUpdatedAt"], "2026-07-30T12:00:00Z")
            self.assertEqual(installed_catalog[0]["teeLabels"]["Red"], "Forward")

    def test_install_writes_editor_artwork_and_catalog_registration(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            data_dir = Path(directory) / "data"
            catalog = data_dir / "mapped_courses.json"
            data_dir.mkdir()
            catalog.write_text("[]\n", encoding="utf-8")
            payload = package()
            payload["hole_images"] = {
                str(number): "data:image/jpeg;base64,/9j/2Q=="
                for number in range(1, 19)
            }

            with (
                patch.object(IMPORTER, "DATA_DIR", data_dir),
                patch.object(IMPORTER, "CATALOG_PATH", catalog),
            ):
                destination = IMPORTER.install_package(payload, force=False)

            self.assertTrue((destination / "illustrations" / "hole18.jpg").exists())
            installed = json.loads(catalog.read_text(encoding="utf-8"))[0]
            self.assertTrue(installed["illustrations"])
            self.assertEqual(installed["illustrationPath"], "data/mapped-links/illustrations")
            self.assertEqual(installed["illustrationExtension"], "jpg")

    def test_package_rejects_invalid_editor_artwork(self) -> None:
        payload = package()
        payload["hole_images"] = {"1": "data:image/jpeg;base64,not-valid!"}
        with self.assertRaisesRegex(ValueError, "Hole 1 artwork"):
            IMPORTER.validate_package(payload)

    def test_load_package_rejects_geometry_the_game_cannot_use(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "course.json"
            payload = package()
            payload["holes"]["4"]["geometries"]["rough_zones"] = []
            path.write_text(json.dumps(payload), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "required rough surface is missing"):
                IMPORTER.load_package(path)


if __name__ == "__main__":
    unittest.main()
