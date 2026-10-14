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
        "scorecard_csv": "Hole,Par\n" + "".join(f"{number},4\n" for number in range(1, 19)),
        "holes": holes,
    }


class MappedCourseImporterTests(unittest.TestCase):
    def test_install_nine_holes_and_load_course(self):
        from packages.golf_domain.course_adapter import load_course
        payload = package()
        payload["holes"] = {key: value for key, value in payload["holes"].items() if int(key) <= 9}
        payload["hole_count"] = 9
        payload["scorecard_csv"] = "Hole,Par\n" + "".join(f"{number},4\n" for number in range(1, 10))
        IMPORTER.validate_package(payload)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(IMPORTER, "DATA_DIR", root), patch.object(IMPORTER, "CATALOG_PATH", root / "mapped_courses.json"):
                destination = IMPORTER.install_package(payload, force=False)
                self.assertFalse((destination / "hole10.json").exists())
                self.assertEqual(len(load_course(destination)), 9)
                self.assertEqual(json.loads((root / "mapped_courses.json").read_text())[0]["holeCount"], 9)
        payload["hole_count"] = 18
        with self.assertRaisesRegex(ValueError, "all 18"):
            IMPORTER.validate_package(payload)

    def test_default_rough_allows_install_without_rough_polygons(self):
        payload = package()
        payload["course_location"] = {"country": "TW", "city": "Tamsui"}
        for hole in payload["holes"].values():
            hole["geometries"]["rough_zones"] = []
        self.assertEqual(IMPORTER.validate_package(payload), payload)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(IMPORTER, "DATA_DIR", root), patch.object(IMPORTER, "CATALOG_PATH", root / "mapped_courses.json"):
                destination = IMPORTER.install_package(payload, force=False)
                self.assertTrue((destination / "hole18.json").is_file())


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

            with self.assertRaisesRegex(ValueError, "9 or 18"):
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
                "Hole,Par\n" + "".join(f"{number},4\n" for number in range(1, 19)),
            )
            installed_catalog = json.loads(catalog.read_text(encoding="utf-8"))
            self.assertEqual(installed_catalog[0]["id"], "mapped-links")
            self.assertEqual(installed_catalog[0]["mapUpdatedAt"], "2026-07-30T12:00:00Z")
            self.assertEqual(installed_catalog[0]["teeLabels"]["Red"], "Forward")

    def test_production_identity_and_osm_attribution_survive_install(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            data_dir = Path(directory) / "data"
            catalog = data_dir / "mapped_courses.json"
            data_dir.mkdir()
            catalog.write_text("[]\n", encoding="utf-8")
            payload = package()
            payload["production_context"] = {
                "production_item_id": "production_0123456789abcdef01234567",
                "directory_course_id": "course_0123456789abcdef01234567",
            }
            payload["external_course_source"] = {
                "provider_name": "openstreetmap",
                "attribution": "© OpenStreetMap contributors · ODbL",
            }

            with (
                patch.object(IMPORTER, "DATA_DIR", data_dir),
                patch.object(IMPORTER, "CATALOG_PATH", catalog),
            ):
                IMPORTER.install_package(IMPORTER.validate_package(payload), force=False)

            installed = json.loads(catalog.read_text(encoding="utf-8"))[0]
            self.assertEqual(installed["directoryCourseId"], payload["production_context"]["directory_course_id"])
            self.assertEqual(installed["productionItemId"], payload["production_context"]["production_item_id"])
            self.assertEqual(installed["sourceAttribution"], "© OpenStreetMap contributors · ODbL")

    def test_invalid_production_identity_is_rejected(self) -> None:
        payload = package()
        payload["production_context"] = {
            "production_item_id": "production_wrong",
            "directory_course_id": "course_wrong",
        }
        with self.assertRaisesRegex(ValueError, "production item identity"):
            IMPORTER.validate_package(payload)

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

    def test_marker_only_package_accepts_no_tee_surface_but_requires_start(self):
        payload = package()
        for hole in payload['holes'].values():
            hole['geometries']['tee_boxes'] = []
            hole['hole_metadata']['tee_surface_mode'] = 'markers-only'
            hole['hole_metadata']['default_start_point'] = [0, 0]
        IMPORTER.validate_package(payload)
        payload['holes']['1']['hole_metadata']['default_start_point'] = None
        with self.assertRaisesRegex(ValueError, 'default_start_point'):
            IMPORTER.validate_package(payload)

    def test_package_rejects_invalid_editor_artwork(self) -> None:
        payload = package()
        payload["hole_images"] = {"1": "data:image/jpeg;base64,not-valid!"}
        with self.assertRaisesRegex(ValueError, "Hole 1 artwork"):
            IMPORTER.validate_package(payload)

    def test_load_package_rejects_geometry_the_game_cannot_use(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "course.json"
            payload = package()
            payload["holes"]["4"]["geometries"]["tee_boxes"] = []
            path.write_text(json.dumps(payload), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "required tee surface is missing"):
                IMPORTER.load_package(path)


if __name__ == "__main__":
    unittest.main()
