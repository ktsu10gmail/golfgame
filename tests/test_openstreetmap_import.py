from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs

from packages.course_import import (
    CourseImportError,
    CourseImportStore,
    OpenStreetMapConfig,
    OpenStreetMapImportService,
    OpenStreetMapProvider,
    normalize_openstreetmap_course,
)


def closed_polygon(lat: float, lon: float) -> list[dict[str, float]]:
    return [
        {"lat": lat - .00005, "lon": lon - .00005},
        {"lat": lat - .00005, "lon": lon + .00005},
        {"lat": lat + .00005, "lon": lon + .00005},
        {"lat": lat + .00005, "lon": lon - .00005},
        {"lat": lat - .00005, "lon": lon - .00005},
    ]


def osm_detail() -> dict:
    return {
        "osm3s": {"timestamp_osm_base": "2026-09-30T12:00:00Z"},
        "elements": [
            {
                "type": "way", "id": 100, "center": {"lat": 40.6, "lon": -74.5},
                "tags": {"leisure": "golf_course", "name": "Evidence Golf Club"},
                "geometry": [
                    {"lat": 40.598, "lon": -74.502},
                    {"lat": 40.598, "lon": -74.495},
                    {"lat": 40.602, "lon": -74.495},
                    {"lat": 40.602, "lon": -74.502},
                    {"lat": 40.598, "lon": -74.502},
                ],
            },
            {
                "type": "way", "id": 201, "tags": {"golf": "hole", "ref": "1", "par": "4"},
                "geometry": [
                    {"lat": 40.599, "lon": -74.5},
                    {"lat": 40.6, "lon": -74.5},
                    {"lat": 40.601, "lon": -74.5},
                ],
            },
            {
                "type": "way", "id": 202, "tags": {"golf": "hole", "ref": "2", "par": "3"},
                "geometry": [
                    {"lat": 40.599, "lon": -74.497},
                    {"lat": 40.6, "lon": -74.497},
                    {"lat": 40.601, "lon": -74.497},
                ],
            },
            {
                "type": "way", "id": 299, "tags": {"golf": "hole"},
                "geometry": [
                    {"lat": 40.599, "lon": -74.496},
                    {"lat": 40.601, "lon": -74.496},
                ],
            },
            {
                "type": "way", "id": 298, "tags": {"golf": "hole", "ref": "3"},
                "geometry": [
                    {"lat": 40.599, "lon": -74.49},
                    {"lat": 40.601, "lon": -74.49},
                ],
            },
            {"type": "way", "id": 301, "tags": {"golf": "green", "ref": "1"}, "geometry": closed_polygon(40.601, -74.5)},
            {"type": "way", "id": 302, "tags": {"golf": "fairway", "ref": "1"}, "geometry": closed_polygon(40.6, -74.5)},
            {"type": "way", "id": 303, "tags": {"golf": "rough", "ref": "1"}, "geometry": closed_polygon(40.6004, -74.5)},
            {"type": "way", "id": 304, "tags": {"golf": "bunker", "ref": "1"}, "geometry": closed_polygon(40.6008, -74.4999)},
            {"type": "way", "id": 305, "tags": {"natural": "water", "ref": "1"}, "geometry": closed_polygon(40.6002, -74.4999)},
            {"type": "way", "id": 306, "tags": {"golf": "tee", "ref": "1"}, "geometry": closed_polygon(40.599, -74.5)},
            {
                "type": "relation", "id": 401, "tags": {"golf": "green", "ref": "2"},
                "members": [
                    {"role": "outer", "geometry": closed_polygon(40.601, -74.497)},
                    {"role": "inner", "geometry": closed_polygon(40.601, -74.497)},
                ],
            },
        ],
    }


class FakeTransport:
    def __init__(self):
        self.calls: list[str] = []

    def __call__(self, url, body, headers, timeout, max_bytes):
        query = parse_qs(body.decode())["data"][0]
        self.calls.append(query)
        if "leisure" in query and "out center tags" in query:
            return 200, json.dumps({"elements": [{
                "type": "way", "id": 100,
                "center": {"lat": 40.6, "lon": -74.5},
                "tags": {"leisure": "golf_course", "name": "Evidence Golf Club", "addr:state": "NJ"},
            }]}).encode()
        return 200, json.dumps(osm_detail()).encode()


class OpenStreetMapImportTests(unittest.TestCase):
    def test_no_routes_preserves_reference_shapes_without_inventing_holes(self):
        detail = osm_detail()
        detail["elements"] = [element for element in detail["elements"] if element.get("tags", {}).get("golf") != "hole"]
        for element in detail["elements"]:
            element.get("tags", {}).pop("ref", None)
        project = normalize_openstreetmap_course(detail, "way/100")
        self.assertTrue(project["import_preview"]["partial_draft"])
        self.assertEqual(project["import_preview"]["counts"]["hole_routes"], 0)
        self.assertFalse(project["import_preview"]["ready_for_review"])
        references = project["external_course_source"]["reference_features"]
        self.assertEqual(project["holes"]["1"]["geometry_reference"], {
            "coordinate_system": "WGS84", "georeferenced": True, "source": "openstreetmap"
        })
        self.assertTrue(any(feature["type"] == "green" for feature in references))
        self.assertTrue(any(feature["type"] == "facility_boundary" for feature in references))
        self.assertTrue(any(feature["type"] == "tee" for feature in references))
        for hole in project["holes"].values():
            self.assertEqual(hole["features"], [])
            self.assertIsNone(hole["markers"]["pin"])
            self.assertIsNone(hole["markers"]["white_tee"])
            self.assertEqual(hole["yardages"], {"blue": 0, "white": 0, "forward": 0})

    def test_partial_draft_can_be_previewed_cached_and_opened(self):
        detail = osm_detail()
        detail["elements"] = detail["elements"][:1]
        transport = lambda *args: (200, json.dumps(detail).encode())
        with tempfile.TemporaryDirectory() as temporary:
            config = OpenStreetMapConfig(endpoint="https://overpass.example/api", enabled=True)
            service = OpenStreetMapImportService(config, CourseImportStore(Path(temporary) / "imports.sqlite3"), OpenStreetMapProvider(config, transport))
            preview = service.preview({"external_id": "way/100"}, "operator")
            self.assertTrue(preview["preview"]["partial_draft"])
            project = service.commit({"job_id": preview["job_id"]}, "operator")["project"]
            self.assertEqual(project["import_preview"]["counts"]["hole_routes"], 0)
            self.assertTrue(service.preview({"external_id": "way/100"}, "operator")["cache_hit"])

    def test_rate_limit_has_cooldown_and_no_immediate_retry(self):
        calls = []
        def transport(*args):
            calls.append(args)
            return 429, b"rate limited"
        config = OpenStreetMapConfig(endpoint="https://overpass.example/api", enabled=True)
        provider = OpenStreetMapProvider(config, transport)
        for _ in range(2):
            with self.assertRaises(Exception) as context:
                provider.search_courses(40.6, -74.5)
            self.assertEqual(context.exception.status, 429)
        self.assertEqual(len(calls), 1)

    def test_partial_provider_response_is_not_misreported_as_missing_data(self):
        config = OpenStreetMapConfig(endpoint="https://overpass.example/api", enabled=True)
        provider = OpenStreetMapProvider(config, lambda *args: (200, b'{"elements": [], "remark": "runtime error: timeout"}'))
        with self.assertRaises(Exception) as context:
            provider.search_courses(40.6, -74.5)
        self.assertEqual(context.exception.status, 503)

    def test_normalizer_preserves_wgs84_and_does_not_invent_tees_or_yardage(self):
        project = normalize_openstreetmap_course(
            osm_detail(), "way/100", requested_name="Directory Course",
            production_context={
                "production_item_id": "production_0123456789abcdef01234567",
                "directory_course_id": "course_0123456789abcdef01234567",
            },
        )
        self.assertEqual(project["version"], "golf-course-map-v1")
        self.assertEqual(project["course_name"], "Evidence Golf Club")
        self.assertEqual(project["course_id"], "osm-way-100")
        self.assertEqual(project["holes"]["1"]["markers"]["blue_tee"], {"lat": 40.599, "lng": -74.5})
        self.assertEqual(project["holes"]["1"]["yardages"], {"blue": 0, "white": 0, "forward": 0})
        self.assertIsNone(project["holes"]["1"]["markers"]["white_tee"])
        self.assertEqual(project["holes"]["1"]["tee_alignment_anchor"], "blue")
        self.assertIsNone(project["holes"]["1"]["markers"]["forward_tee"])
        self.assertEqual(project["import_preview"]["counts"]["rough"], 1)
        self.assertEqual(project["import_preview"]["counts"]["greens"], 2)
        self.assertEqual(project["import_preview"]["counts"]["tee_polygons"], 1)
        self.assertTrue(any(item["reason"] == "tee color/role is not explicit" for item in project["import_preview"]["skipped"]))
        self.assertTrue(any(item["reason"] == "inner ring unsupported in Beta" for item in project["import_preview"]["skipped"]))
        self.assertTrue(any(item["reason"] == "missing valid ref" for item in project["import_preview"]["skipped"]))
        self.assertTrue(any(item["reason"] == "outside selected facility boundary" for item in project["import_preview"]["skipped"]))
        self.assertIsNone(project["holes"]["3"]["markers"]["white_tee"])
        self.assertEqual(project["external_course_source"]["attribution"], "© OpenStreetMap contributors · ODbL")

    def test_provider_search_is_coordinate_bounded_and_rejects_large_radius(self):
        transport = FakeTransport()
        config = OpenStreetMapConfig(endpoint="https://overpass.example/api", enabled=True)
        provider = OpenStreetMapProvider(config, transport)
        results = provider.search_courses(40.6, -74.5, 3000)
        self.assertEqual(results[0].external_id, "way/100")
        self.assertIn('nwr(', transport.calls[0])
        self.assertNotIn("around", transport.calls[0])
        self.assertIn('["leisure"="golf_course"]', transport.calls[0])
        self.assertIn("[maxsize:67108864]", transport.calls[0])
        self.assertEqual(provider.search_courses(40.6, -74.5, 3000)[0].external_id, "way/100")
        self.assertEqual(len(transport.calls), 1)
        with self.assertRaises(CourseImportError):
            provider.search_courses(40.6, -74.5, 9000)

    def test_search_excludes_bbox_corner_results_outside_radius(self):
        data = {"elements": [
            {"type": "way", "id": 1, "center": {"lat": 40.6, "lon": -74.5}, "tags": {"leisure": "golf_course", "name": "Nearby"}},
            {"type": "way", "id": 2, "center": {"lat": 40.608, "lon": -74.489}, "tags": {"leisure": "golf_course", "name": "Outside radius"}},
        ]}
        provider = OpenStreetMapProvider(OpenStreetMapConfig(endpoint="https://overpass.example/api", enabled=True), lambda *args: (200, json.dumps(data).encode()))
        results = provider.search_courses(40.6, -74.5, 1000)
        self.assertEqual([result.external_id for result in results], ["way/1"])

    def test_course_geometry_query_is_limited_to_facility_bounds(self):
        transport = FakeTransport()
        provider = OpenStreetMapProvider(OpenStreetMapConfig(endpoint="https://overpass.example/api", enabled=True), transport)
        detail = provider.get_course_detail("way/100", 5000)
        self.assertEqual(len(transport.calls), 2)
        self.assertIn("way(100);out body geom", transport.calls[0])
        self.assertNotIn("around", transport.calls[1])
        self.assertIn("nwr(40.597", transport.calls[1])
        self.assertEqual(sum(item.get("id") == 100 for item in detail["elements"]), 1)

    def test_node_only_facility_uses_radius_about_its_center(self):
        facility = {"type": "node", "id": 100, "lat": 40.6, "lon": -74.5, "tags": {"leisure": "golf_course"}}
        queries = []
        def transport(url, body, *args):
            queries.append(parse_qs(body.decode())["data"][0])
            return 200, json.dumps({"elements": [facility]}).encode()
        provider = OpenStreetMapProvider(OpenStreetMapConfig(endpoint="https://overpass.example/api", enabled=True), transport)
        provider.get_course_detail("node/100", 250)
        self.assertIn("around:250,40.6000000,-74.5000000", queries[1])

    def test_cached_preview_receives_current_immutable_production_context(self):
        with tempfile.TemporaryDirectory() as temporary:
            config = OpenStreetMapConfig(endpoint="https://overpass.example/api", enabled=True)
            provider = OpenStreetMapProvider(config, FakeTransport())
            service = OpenStreetMapImportService(
                config, CourseImportStore(Path(temporary) / "imports.sqlite3"), provider
            )
            first = service.preview({"external_id": "way/100"}, "operator")
            service.commit({"job_id": first["job_id"]}, "operator")
            context = {
                "production_item_id": "production_aaaaaaaaaaaaaaaaaaaaaaaa",
                "directory_course_id": "course_bbbbbbbbbbbbbbbbbbbbbbbb",
            }
            second = service.preview({
                "external_id": "way/100", "production_context": context,
            }, "operator")
            project = service.commit({"job_id": second["job_id"]}, "operator")["project"]
            self.assertTrue(second["cache_hit"])
            self.assertEqual(project["production_context"], context)


if __name__ == "__main__":
    unittest.main()
