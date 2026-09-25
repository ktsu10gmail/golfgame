from __future__ import annotations

import base64
import gzip
import json
import tempfile
import threading
import unittest
from pathlib import Path

from packages.course_import import (
    CourseImportError,
    CourseImportService,
    CourseImportStore,
    GolfIntelligenceConfig,
    GolfIntelligenceProvider,
    GolfIntelligenceTokenManager,
    normalize_golf_intelligence_course,
    normalize_golf_intelligence_gps_with_scorecard,
)
from packages.course_import.normalizer import CourseNormalizationError


def coordinate(latitude: float, longitude: float) -> dict:
    return {"latitude": latitude, "longitude": longitude}


def rectangle(latitude: float, longitude: float, width: float = 0.00008, height: float = 0.00008) -> list[dict]:
    return [
        coordinate(latitude - height, longitude - width),
        coordinate(latitude - height, longitude + width),
        coordinate(latitude + height, longitude + width),
        coordinate(latitude + height, longitude - width),
    ]


def course_detail(hole_count: int = 18) -> dict:
    base_latitude = 40.61
    base_longitude = -74.51
    holes = []
    tees = []
    for tee_id, tee_name, total_offset in ((1, "Blue", 30), (2, "White", 0), (3, "Forward", -35)):
        tee_holes = []
        for number in range(1, hole_count + 1):
            tee_holes.append({
                "holeId": 1000 + number,
                "holeNumber": number,
                "par": 3 if number % 5 == 0 else 4,
                "yardage": 390 + total_offset + number,
                "allocation": number,
            })
        tees.append({
            "teeId": tee_id,
            "teeName": tee_name,
            "teeColorType": tee_name,
            "yardage": sum(item["yardage"] for item in tee_holes),
            "isTeeActive": True,
            "holes": tee_holes,
        })
    gps_items = []
    for number in range(1, hole_count + 1):
        latitude = base_latitude + number * 0.002
        longitude = base_longitude
        tee_coordinate = coordinate(latitude, longitude)
        green_coordinate = coordinate(latitude + 0.0015, longitude)
        holes.append({
            "holeId": 1000 + number,
            "holeNumber": number,
            "par": 3 if number % 5 == 0 else 4,
            "yardage": 390 + number,
            "allocation": number,
            "teeGPSCoordinate": tee_coordinate,
            "approachGPSCoordinate": coordinate(latitude + 0.001, longitude),
            "greenGPSCoordinate": green_coordinate,
        })
        traces = {
            "TeeboxTrace": [
                rectangle(latitude - 0.00012, longitude),
                rectangle(latitude, longitude),
                rectangle(latitude + 0.00012, longitude),
            ],
            "FairwayTrace": [rectangle(latitude + 0.00075, longitude, 0.00014, 0.0005)],
            "GreenTrace": [rectangle(latitude + 0.0015, longitude, 0.00012, 0.0001)],
            "BunkerTrace": [rectangle(latitude + 0.00135, longitude + 0.0002, 0.00005, 0.00004)],
            "WaterTrace": [rectangle(latitude + 0.0008, longitude + 0.00025, 0.00005, 0.00012)],
            "HoleBoundry": [rectangle(latitude + 0.00075, longitude, 0.0004, 0.00085)],
        }
        for gps_type, shapes in traces.items():
            gps_items.append({"holeId": 1000 + number, "gpsType": gps_type, "shapes": shapes})
    return {
        "publicId": "warrenbrook-test-id",
        "name": "Warrenbrook Golf Course",
        "updatedOn": "2026-08-01T00:00:00Z",
        "facility": {
            "facilityName": "Warrenbrook Golf Course",
            "address": {"city": "Warren", "regionCode": "NJ", "countryCode": "USA"},
        },
        "courses": [{
            "courseId": 71,
            "name": "Warrenbrook",
            "courseHoleType": "EighteenHole" if hole_count == 18 else "NineHole",
            "courseStatusType": "Active",
            "tees": tees,
        }],
        "holes": holes,
        "gpsItems": gps_items,
    }


def gps_only_detail() -> dict:
    detail = course_detail()
    detail.pop("courses")
    detail["layouts"] = [{
        "layoutId": 71,
        "layoutName": "Primary",
        "layoutType": "Primary",
        "holes": detail["holes"],
    }]
    return detail


def local_scorecard_text() -> str:
    lines = ["Hole,Par,Handicap,Yards_Blue,Yards_White,Yards_Red"]
    for number in range(1, 19):
        par = 3 if number % 5 == 0 else 4
        lines.append(f"{number},{par},{number},{420 + number},{390 + number},{355 + number}")
    return "\n".join(lines)


class FakeTransport:
    def __init__(self):
        self.calls: list[tuple[str, str, dict, bytes | None]] = []
        self.search_unauthorized_once = False

    def __call__(self, method, url, headers, body, timeout):
        self.calls.append((method, url, dict(headers), body))
        if url.endswith("/auth/authenticateToken"):
            return 200, json.dumps({"access_token": f"token-{len(self.calls)}", "expires_in": 3600}).encode()
        if url.endswith("/courses/searchCourseGroups"):
            if self.search_unauthorized_once:
                self.search_unauthorized_once = False
                return 401, b"{}"
            return 200, json.dumps({
                "data": [{
                    "publicId": "warrenbrook-test-id",
                    "name": "Warrenbrook Golf Course",
                    "courseCount": 1,
                    "teeCount": 3,
                    "gpsCount": 18,
                    "isActive": True,
                    "facility": {
                        "facilityName": "Warrenbrook Golf Course",
                        "gpsCoordinate": coordinate(40.61, -74.51),
                        "address": {"city": "Warren", "regionCode": "NJ", "countryCode": "USA"},
                    },
                }],
                "total": 1,
            }).encode()
        if "/courses/getCourseGroupDetail?" in url:
            return 200, json.dumps(course_detail()).encode()
        if "/courses/getCourseGroupGPS?" in url:
            return 200, json.dumps(gps_only_detail()).encode()
        return 404, b"{}"


class GolfIntelligenceProviderTests(unittest.TestCase):
    def setUp(self):
        self.config = GolfIntelligenceConfig(
            client_id="client-id",
            active_token="active-token",
            enabled=True,
        )

    def test_token_exchange_is_cached_and_secrets_are_only_in_auth_body(self):
        transport = FakeTransport()
        tokens = GolfIntelligenceTokenManager(self.config, transport)
        first = tokens.get_access_token()
        second = tokens.get_access_token()
        self.assertEqual(first, second)
        self.assertEqual(len(transport.calls), 1)
        _, _, headers, body = transport.calls[0]
        self.assertNotIn("Authorization", headers)
        self.assertIn(b"client_id=client-id", body)
        self.assertIn(b"code=active-token", body)

    def test_search_reauthenticates_once_after_401(self):
        transport = FakeTransport()
        transport.search_unauthorized_once = True
        provider = GolfIntelligenceProvider(self.config, transport=transport)
        results = provider.search_courses(type("Query", (), {
            "keywords": "Warrenbrook", "rows": 10, "offset": 0, "country": None, "region": None,
        })())
        self.assertEqual(results[0].name, "Warrenbrook Golf Course")
        auth_calls = [call for call in transport.calls if call[1].endswith("authenticateToken")]
        self.assertEqual(len(auth_calls), 2)


class GolfIntelligenceNormalizerTests(unittest.TestCase):
    def test_full_course_maps_to_existing_mapper_project(self):
        project = normalize_golf_intelligence_course(course_detail(), "warrenbrook-test-id")
        self.assertEqual(project["version"], "golf-course-map-v1")
        self.assertEqual(project["course_name"], "Warrenbrook Golf Course")
        self.assertEqual(len(project["holes"]), 18)
        first = project["holes"]["1"]
        self.assertEqual(first["yardages"], {"blue": 421, "white": 391, "forward": 356})
        self.assertTrue(first["markers"]["white_tee"])
        feature_types = {feature["type"] for feature in first["features"]}
        self.assertTrue({"tee_blue", "tee_white", "tee_forward", "fairway", "green", "bunker", "water", "hole_outline", "rough"}.issubset(feature_types))
        self.assertEqual(first["import_status"], "IMPORTED")
        self.assertEqual(project["green_contour_defaults"]["green_contour_source"], "simulated")

    def test_nine_hole_course_is_reviewable_without_inventing_second_nine(self):
        project = normalize_golf_intelligence_course(course_detail(9), "nine-test-id")
        self.assertEqual(project["external_course_source"]["imported_hole_count"], 9)
        self.assertEqual(project["holes"]["9"]["import_status"], "IMPORTED")
        self.assertEqual(project["holes"]["10"]["import_status"], "NEEDS_REVIEW")

    def test_three_direct_provider_layouts_create_a_27_hole_mapper_project(self):
        detail = course_detail(18)
        detail.pop("courses")
        all_holes = []
        all_gps_items = []
        layouts = []
        loop_names = ("South Left", "Center Right", "North Right")
        for loop_index, loop_name in enumerate(loop_names):
            layout_holes = []
            for local_number in range(1, 10):
                source = dict(detail["holes"][local_number - 1])
                source["holeId"] = 2000 + loop_index * 9 + local_number
                source["holeNumber"] = local_number
                layout_holes.append(source)
                all_holes.append(source)
                original_id = 1000 + local_number
                for item in detail["gpsItems"]:
                    if item["holeId"] == original_id:
                        copied = dict(item)
                        copied["holeId"] = source["holeId"]
                        all_gps_items.append(copied)
            layouts.append({
                "layoutId": 80 + loop_index,
                "layoutName": loop_name,
                "layoutType": "NineHole",
                "holes": layout_holes,
            })
        detail["name"] = "Chang Gung Golf Club"
        detail["layouts"] = layouts
        detail["holes"] = all_holes
        detail["gpsItems"] = all_gps_items * 3

        project = normalize_golf_intelligence_course(detail, "chang-gung-test-id")

        self.assertEqual(project["course_structure"], "three_nines")
        self.assertEqual(len(project["holes"]), 27)
        self.assertEqual(
            [loop["name"] for loop in project["nine_loops"]],
            list(loop_names),
        )
        self.assertEqual(project["holes"]["10"]["provider_hole_id"], 2010)
        self.assertTrue(any(
            feature["type"] == "green"
            for feature in project["holes"]["27"]["features"]
        ))
        first_feature_types = [feature["type"] for feature in project["holes"]["1"]["features"]]
        self.assertEqual(first_feature_types.count("green"), 1)
        self.assertEqual(first_feature_types.count("fairway"), 1)
        self.assertEqual(first_feature_types.count("water"), 1)

    def test_unknown_penalty_area_requires_review(self):
        detail = course_detail()
        detail["gpsItems"].append({
            "holeId": 1001,
            "gpsType": "HazardPath",
            "shapes": [rectangle(40.6128, -74.5097)],
        })
        project = normalize_golf_intelligence_course(detail, "hazard-test-id")
        first = project["holes"]["1"]
        self.assertEqual(first["import_status"], "NEEDS_REVIEW")
        self.assertIn("penalty_area_unknown", {feature["type"] for feature in first["features"]})

    def test_provider_tree_markers_become_editable_tree_canopies(self):
        detail = course_detail()
        detail["gpsItems"].extend([
            {
                "holeId": 1001,
                "gpsType": "LeafyTree",
                "gpsCoordinate": coordinate(40.6131, -74.5099),
                "shapes": None,
            },
            {
                "holeId": 1001,
                "gpsType": "PineTree",
                "gpsCoordinate": coordinate(40.6132, -74.5098),
                "shapes": None,
            },
        ])
        project = normalize_golf_intelligence_course(detail, "tree-marker-test-id")
        trees = [
            feature for feature in project["holes"]["1"]["features"]
            if feature["type"] == "trees"
        ]
        self.assertEqual(len(trees), 2)
        self.assertEqual({tree["provider_tree_type"] for tree in trees}, {"LeafyTree", "PineTree"})
        self.assertTrue(all(len(tree["points"]) == 12 for tree in trees))

    def test_imported_gps_calibration_chooses_a_lateral_bunker(self):
        detail = course_detail()
        first_hole_id = 1001
        for item in detail["gpsItems"]:
            if item["holeId"] == first_hole_id and item["gpsType"] == "BunkerTrace":
                item["shapes"] = [rectangle(40.61275, -74.51, 0.00005, 0.00004)]
                break
        detail["gpsItems"].append({
            "holeId": first_hole_id,
            "gpsType": "BunkerTrace",
            "shapes": [rectangle(40.61275, -74.5097, 0.00005, 0.00004)],
        })

        project = normalize_golf_intelligence_course(detail, "lateral-anchor-test-id")
        controls = project["holes"]["1"]["gps_control_points"]

        self.assertGreater(controls["bunker_center"]["lng"], -74.5098)

    def test_null_gps_payload_fails_safely_without_a_type_error(self):
        detail = course_detail()
        detail["gpsItems"] = None
        with self.assertRaisesRegex(CourseNormalizationError, "no GPS geometry"):
            normalize_golf_intelligence_course(detail, "null-gps-test-id")

    def test_serialized_gps_array_is_used_when_documented_field_is_null(self):
        detail = course_detail()
        detail["data"] = json.dumps(detail["gpsItems"])
        detail["gpsItems"] = None
        project = normalize_golf_intelligence_course(detail, "serialized-gps-test-id")
        self.assertTrue(any(
            feature["type"] == "green"
            for feature in project["holes"]["1"]["features"]
        ))

    def test_serialized_gps_object_is_used_by_gps_only_recovery(self):
        detail = gps_only_detail()
        detail["data"] = json.dumps({"gpsItems": detail["gpsItems"]})
        detail["gpsItems"] = None
        project = normalize_golf_intelligence_gps_with_scorecard(
            detail,
            "serialized-warrenbrook-test-id",
            local_scorecard_text(),
        )
        self.assertTrue(any(
            feature["type"] == "green"
            for feature in project["holes"]["1"]["features"]
        ))

    def test_base64_serialized_gps_is_used(self):
        detail = course_detail()
        detail["data"] = base64.b64encode(json.dumps(detail["gpsItems"]).encode()).decode()
        detail["gpsItems"] = None
        project = normalize_golf_intelligence_course(detail, "base64-gps-test-id")
        self.assertTrue(any(
            feature["type"] == "green"
            for feature in project["holes"]["1"]["features"]
        ))

    def test_gzip_base64_serialized_gps_is_used(self):
        detail = course_detail()
        serialized = gzip.compress(json.dumps({"gpsItems": detail["gpsItems"]}).encode())
        detail["data"] = base64.b64encode(serialized).decode()
        detail["gpsItems"] = None
        project = normalize_golf_intelligence_course(detail, "gzip-base64-gps-test-id")
        self.assertTrue(any(
            feature["type"] == "green"
            for feature in project["holes"]["1"]["features"]
        ))

    def test_malformed_serialized_gps_data_fails_safely(self):
        detail = course_detail()
        detail["gpsItems"] = None
        detail["data"] = "not-json"
        with self.assertRaisesRegex(CourseNormalizationError, "unsupported encoding"):
            normalize_golf_intelligence_course(detail, "malformed-serialized-gps-test-id")

    def test_gps_only_payload_combines_with_trusted_local_scorecard(self):
        project = normalize_golf_intelligence_gps_with_scorecard(
            gps_only_detail(),
            "warrenbrook-test-id",
            local_scorecard_text(),
        )
        self.assertEqual(project["holes"]["1"]["yardages"], {"blue": 421, "white": 391, "forward": 356})
        self.assertTrue(any(feature["type"] == "green" for feature in project["holes"]["1"]["features"]))
        self.assertEqual(project["external_course_source"]["provider_operation"], "getCourseGroupGPS")


class CourseImportServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_directory.cleanup)
        self.transport = FakeTransport()
        config = GolfIntelligenceConfig(
            client_id="client-id",
            active_token="active-token",
            enabled=True,
            cache_ttl_days=365,
        )
        provider = GolfIntelligenceProvider(config, transport=self.transport)
        self.store = CourseImportStore(Path(self.temp_directory.name) / "imports.sqlite3")
        self.service = CourseImportService(config, self.store, provider)

    def test_paid_preview_defaults_off_and_requires_explicit_confirmation(self):
        with self.assertRaises(CourseImportError):
            self.service.preview({"public_id": "warrenbrook-test-id", "confirm_paid": True}, "developer")
        self.service.set_paid_calls_allowed(True)
        with self.assertRaises(CourseImportError):
            self.service.preview({"public_id": "warrenbrook-test-id"}, "developer")
        self.assertFalse(any("getCourseGroupDetail" in call[1] for call in self.transport.calls))

    def test_cache_prevents_second_paid_detail_call(self):
        self.service.set_paid_calls_allowed(True)
        first = self.service.preview(
            {"public_id": "warrenbrook-test-id", "confirm_paid": True},
            "developer",
        )
        self.service.set_paid_calls_allowed(False)
        second = self.service.preview({"public_id": "warrenbrook-test-id"}, "developer")
        detail_calls = [call for call in self.transport.calls if "getCourseGroupDetail" in call[1]]
        self.assertEqual(len(detail_calls), 1)
        self.assertFalse(first["cache_hit"])
        self.assertTrue(second["cache_hit"])
        self.assertEqual(second["estimated_credits_used"], 0)

    def test_malformed_paid_response_turns_paid_calls_back_off(self):
        calls = 0

        def malformed_detail(_external_id):
            nonlocal calls
            calls += 1
            detail = course_detail()
            detail["gpsItems"] = None
            return detail

        self.service.provider.get_course_detail = malformed_detail
        self.service.set_paid_calls_allowed(True)
        with self.assertRaisesRegex(CourseImportError, "no GPS geometry"):
            self.service.preview(
                {"public_id": "warrenbrook-test-id", "confirm_paid": True},
                "developer",
            )
        self.assertFalse(self.service.status()["paid_calls_allowed"])
        with self.assertRaisesRegex(CourseImportError, "Paid Golf Intelligence API calls are OFF"):
            self.service.preview(
                {"public_id": "warrenbrook-test-id", "confirm_paid": True},
                "developer",
            )
        self.assertEqual(calls, 1)

    def test_gps_only_recovery_requires_confirmation_and_is_single_use(self):
        self.service.set_paid_calls_allowed(True)
        with self.assertRaisesRegex(CourseImportError, "Confirm the GPS-only"):
            self.service.preview_gps_only(
                {"public_id": "warrenbrook-test-id"},
                "developer",
                local_scorecard_text(),
            )
        result = self.service.preview_gps_only(
            {"public_id": "warrenbrook-test-id", "confirm_gps_only": True},
            "developer",
            local_scorecard_text(),
        )
        self.assertEqual(result["estimated_credits_used"], 2)
        self.assertEqual(result["recovery_mode"], "gps_only_with_local_scorecard")
        self.assertFalse(self.service.status()["paid_calls_allowed"])
        gps_calls = [call for call in self.transport.calls if "getCourseGroupGPS" in call[1]]
        self.assertEqual(len(gps_calls), 1)
        cached = self.service.preview_gps_only(
            {"public_id": "warrenbrook-test-id"},
            "developer",
            local_scorecard_text(),
        )
        self.assertTrue(cached["cache_hit"])
        self.assertEqual(cached["estimated_credits_used"], 0)

    def test_commit_returns_only_normalized_mapper_project(self):
        self.service.set_paid_calls_allowed(True)
        preview = self.service.preview(
            {"public_id": "warrenbrook-test-id", "confirm_paid": True},
            "developer",
        )
        result = self.service.commit({"job_id": preview["job_id"]}, "developer")
        self.assertEqual(result["project"]["version"], "golf-course-map-v1")
        self.assertNotIn("gpsItems", result["project"])

    def test_parallel_previews_share_one_paid_hydration(self):
        self.service.set_paid_calls_allowed(True)
        barrier = threading.Barrier(2)
        results = []

        def preview():
            barrier.wait()
            results.append(self.service.preview(
                {"public_id": "warrenbrook-test-id", "confirm_paid": True},
                "developer",
            ))

        threads = [threading.Thread(target=preview) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        detail_calls = [call for call in self.transport.calls if "getCourseGroupDetail" in call[1]]
        self.assertEqual(len(detail_calls), 1)
        self.assertEqual(sorted(result["cache_hit"] for result in results), [False, True])

    def test_gameplay_packages_do_not_depend_on_course_import_provider(self):
        root = Path(__file__).resolve().parents[1]
        gameplay_sources = [root / "app.js", *sorted((root / "packages" / "simulation").glob("*"))]
        for path in gameplay_sources:
            if not path.is_file():
                continue
            source = path.read_text(encoding="utf-8")
            self.assertNotIn("golf_intelligence", source.casefold(), str(path))
            self.assertNotIn("course-import/golf-intelligence", source.casefold(), str(path))


if __name__ == "__main__":
    unittest.main()
