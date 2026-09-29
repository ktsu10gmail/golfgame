#!/usr/bin/env python3
"""Serve the browser app and optional AI endpoints from one process."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, unquote, urlencode, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _load_local_environment(path: Path) -> None:
    """Load simple KEY=VALUE settings without overriding service environment."""
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        value = value.strip().strip('"').strip("'")
        if name:
            os.environ.setdefault(name, value)


_load_local_environment(ROOT / ".env")

from packages.ai import AiProviderError, create_ai_service
from packages.accounts import (
    AccountError,
    LicenseError,
    LicenseService,
    PlayerStore,
    PlayAccessDenied,
    SupabaseAuth,
    SupabaseConfig,
    attach_verified_learning_context,
)
from packages.course_import import (
    CourseImportError,
    CourseImportService,
    CourseImportStore,
    GolfIntelligenceConfig,
)
from scripts.import_mapped_course import install_package, validate_package

AI_SERVICE = create_ai_service()
PLAYER_DB_PATH = Path(os.getenv("GOLFGAME_PLAYER_DB", ROOT / "data" / "player_accounts.sqlite3"))
PLAYER_STORE = PlayerStore(PLAYER_DB_PATH)
LICENSE_SERVICE = LicenseService(
    PLAYER_DB_PATH,
    enforcement=os.getenv("GOLFGAME_LICENSE_ENFORCEMENT", "shadow"),
    coach_seat_capacity=int(os.getenv("GOLFGAME_COACH_SEAT_CAPACITY", "10")),
    coach_grace_days=int(os.getenv("GOLFGAME_COACH_GRACE_DAYS", "30")),
)
SUPABASE_CONFIG = SupabaseConfig.from_values(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_ANON_KEY"))
SUPABASE_AUTH = SupabaseAuth(SUPABASE_CONFIG) if SUPABASE_CONFIG else None
SERVER_ROLE = os.getenv("GOLFGAME_SERVER_ROLE", "app").strip().casefold() or "app"
MAPPER_PORT = int(os.getenv("GOLFGAME_MAPPER_PORT", "8081"))
GOLF_INTELLIGENCE_CONFIG = GolfIntelligenceConfig.from_env()
COURSE_IMPORT_STORE = CourseImportStore(
    os.getenv("GOLFGAME_COURSE_IMPORT_DB", ROOT / "data" / "course_imports.sqlite3")
)
COURSE_IMPORT_SERVICE = CourseImportService(GOLF_INTELLIGENCE_CONFIG, COURSE_IMPORT_STORE)
GPS_RECOVERY_SCORECARDS = {
    "53FZ3QDT": ROOT / "data" / "the-warrenbrook-golf-course" / "scorecard.csv",
}
SESSION_COOKIE = "golfgame_session"
CENSUS_GEOCODER_URL = (
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"
)
DEVELOPER_EMAILS = {
    value.strip().casefold()
    for value in os.getenv("GOLFGAME_DEVELOPER_EMAILS", "admin@jetta.com").split(",")
    if value.strip()
}
DEVELOPER_NAMES = {
    value.strip().casefold()
    for value in os.getenv("GOLFGAME_DEVELOPER_NAMES", "").split(",")
    if value.strip()
}


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        """Keep the game shell fresh while allowing conditional asset requests."""
        path = urlparse(self.path).path
        if path in {"/", "/index.html"}:
            self.send_header("Cache-Control", "no-store, max-age=0")
        elif Path(path).suffix.lower() in {".js", ".mjs", ".css"}:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if SERVER_ROLE == "app" and parsed.path == "/editor.html":
            host = urlparse(f"//{self.headers.get('Host', '')}").hostname or "localhost"
            safe_host = host if re.fullmatch(r"[A-Za-z0-9.-]+", host) else "localhost"
            self.send_response(HTTPStatus.TEMPORARY_REDIRECT)
            self.send_header("Location", f"//{safe_host}:{MAPPER_PORT}/editor.html")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return
        if SERVER_ROLE == "mapper" and parsed.path in {"/", "/index.html"}:
            self.send_response(HTTPStatus.TEMPORARY_REDIRECT)
            self.send_header("Location", "/editor.html")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return
        if parsed.path == "/api/ai/health":
            self._json_response(HTTPStatus.OK, AI_SERVICE.status())
            return
        if parsed.path == "/api/v1/course-import/golf-intelligence/status":
            player = self._require_developer()
            if player is not None:
                status = COURSE_IMPORT_SERVICE.status()
                status["gps_only_recovery_public_ids"] = sorted(GPS_RECOVERY_SCORECARDS)
                self._json_response(HTTPStatus.OK, status)
            return
        if parsed.path.startswith("/api/v1/course-import/jobs/"):
            player = self._require_developer()
            if player is None:
                return
            job_id = parsed.path.removeprefix("/api/v1/course-import/jobs/").strip("/")
            try:
                result = COURSE_IMPORT_SERVICE.job(job_id, str(player["id"]))
            except CourseImportError as error:
                self._json_response(HTTPStatus(error.status), {"error": str(error)})
                return
            self._json_response(HTTPStatus.OK, result)
            return
        if parsed.path == "/api/geocode":
            self._handle_geocode(parsed.query)
            return
        if parsed.path == "/api/player/session":
            player = self._current_player()
            self._json_response(HTTPStatus.OK, {"player": player})
            return
        if parsed.path == "/api/player/access":
            player = self._require_player()
            if player is not None:
                self._json_response(HTTPStatus.OK, {"access": LICENSE_SERVICE.access_summary(player["id"])})
            return
        if parsed.path == "/api/admin/access-codes":
            player = self._require_admin()
            if player is not None:
                query = parse_qs(parsed.query)
                limit = int(query.get("limit", ["100"])[0])
                self._json_response(HTTPStatus.OK, {"codes": LICENSE_SERVICE.list_access_codes(limit)})
            return
        if parsed.path == "/api/coach/dashboard":
            player = self._require_coach()
            if player is None:
                return
            try:
                dashboard = LICENSE_SERVICE.coach_dashboard(player["id"])
            except LicenseError as error:
                self._json_response(HTTPStatus.FORBIDDEN, {"error": str(error)})
                return
            self._json_response(HTTPStatus.OK, {"dashboard": dashboard})
            return
        if parsed.path == "/api/auth/config":
            payload = SUPABASE_CONFIG.public_payload() if SUPABASE_CONFIG else {"provider": "local"}
            self._json_response(HTTPStatus.OK, payload)
            return
        if parsed.path == "/api/player/active-round":
            player = self._require_player()
            if player is not None:
                self._json_response(HTTPStatus.OK, {"round": PLAYER_STORE.active_round(player["id"])})
            return
        if parsed.path == "/api/player/gps-round":
            player = self._require_player()
            if player is None:
                return
            try:
                query = parse_qs(parsed.query)
                round_id = query.get("round_id", [None])[0]
                course_id = query.get("course_id", [None])[0]
                gps_round = (
                    PLAYER_STORE.gps_round(player["id"], round_id)
                    if round_id else PLAYER_STORE.active_gps_round(player["id"], course_id)
                )
            except AccountError as error:
                self._json_response(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                return
            self._json_response(HTTPStatus.OK, {"round": gps_round})
            return
        if parsed.path == "/api/player/gps-round-history":
            player = self._require_player()
            if player is None:
                return
            try:
                limit = int(parse_qs(parsed.query).get("limit", ["50"])[0])
                rounds = PLAYER_STORE.gps_round_history(player["id"], limit)
            except (AccountError, TypeError, ValueError) as error:
                self._json_response(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                return
            self._json_response(HTTPStatus.OK, {"rounds": rounds})
            return
        if parsed.path == "/api/player/gps-club-stats":
            player = self._require_player()
            if player is not None:
                self._json_response(HTTPStatus.OK, {"statistics": PLAYER_STORE.on_course_club_stats(player["id"])})
            return
        if parsed.path == "/api/player/profile":
            player = self._require_player()
            if player is not None:
                self._json_response(HTTPStatus.OK, {"profile": PLAYER_STORE.player_profile(player["id"])})
            return
        if parsed.path == "/api/player/round-history":
            player = self._require_player()
            if player is None:
                return
            try:
                raw_limit = parse_qs(parsed.query).get("limit", ["50"])[0]
                limit = int(raw_limit)
                rounds = PLAYER_STORE.completed_round_history(player["id"], limit)
            except (AccountError, TypeError, ValueError) as error:
                self._json_response(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                return
            self._json_response(HTTPStatus.OK, {"rounds": rounds})
            return
        if parsed.path == "/api/player/challenge-history":
            player = self._require_player()
            if player is None:
                return
            try:
                limit = int(parse_qs(parsed.query).get("limit", ["50"])[0])
                challenges = PLAYER_STORE.challenge_history(player["id"], limit)
            except (AccountError, TypeError, ValueError) as error:
                self._json_response(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                return
            self._json_response(HTTPStatus.OK, {"challenges": challenges})
            return
        challenge_match = re.fullmatch(r"/api/player/challenges/([^/]+)", parsed.path)
        if challenge_match:
            player = self._require_player()
            if player is None:
                return
            try:
                challenge = PLAYER_STORE.challenge(player["id"], unquote(challenge_match.group(1)))
            except AccountError as error:
                self._json_response(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                return
            if challenge is None:
                self._json_response(HTTPStatus.NOT_FOUND, {"error": "challenge was not found"})
                return
            self._json_response(HTTPStatus.OK, {"challenge": challenge})
            return
        coach_history_match = re.fullmatch(r"/api/coach/students/(\d+)/round-history", parsed.path)
        if coach_history_match:
            coach = self._require_coach()
            if coach is None:
                return
            try:
                student_id = int(coach_history_match.group(1))
                relationship = LICENSE_SERVICE.coach_relationship_context(coach["id"], student_id)
                limit = int(parse_qs(parsed.query).get("limit", ["50"])[0])
                rounds = [
                    item for item in PLAYER_STORE.completed_round_history(student_id, limit)
                    if item.get("completed_at", "") >= (relationship.get("started_at") or "")
                ]
            except (AccountError, LicenseError, TypeError, ValueError) as error:
                self._json_response(HTTPStatus.FORBIDDEN, {"error": str(error)})
                return
            self._json_response(HTTPStatus.OK, {"rounds": rounds})
            return
        coach_replay_match = re.fullmatch(
            r"/api/coach/students/(\d+)/rounds/([^/]+)(?:/holes/(\d+))?", parsed.path
        )
        if coach_replay_match:
            coach = self._require_coach()
            if coach is None:
                return
            student_id = int(coach_replay_match.group(1))
            round_id = unquote(coach_replay_match.group(2))
            if not LICENSE_SERVICE.coach_can_view_round(coach["id"], student_id, round_id):
                self._json_response(HTTPStatus.FORBIDDEN, {"error": "round is outside this coaching relationship"})
                return
            try:
                hole_number = coach_replay_match.group(3)
                payload = PLAYER_STORE.round_replay_hole(student_id, round_id, int(hole_number)) \
                    if hole_number else PLAYER_STORE.round_replay_index(student_id, round_id)
            except (AccountError, TypeError, ValueError) as error:
                self._json_response(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                return
            if payload is None:
                self._json_response(HTTPStatus.NOT_FOUND, {"error": "round replay was not found"})
                return
            self._json_response(HTTPStatus.OK, payload)
            return
        replay_match = re.fullmatch(r"/api/player/rounds/([^/]+)(?:/holes/(\d+))?", parsed.path)
        if replay_match:
            player = self._require_player()
            if player is None:
                return
            try:
                round_id = unquote(replay_match.group(1))
                hole_number = replay_match.group(2)
                payload = PLAYER_STORE.round_replay_hole(player["id"], round_id, int(hole_number)) \
                    if hole_number else PLAYER_STORE.round_replay_index(player["id"], round_id)
            except (AccountError, TypeError, ValueError) as error:
                self._json_response(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                return
            if payload is None:
                self._json_response(HTTPStatus.NOT_FOUND, {"error": "round replay was not found"})
                return
            self._json_response(HTTPStatus.OK, payload)
            return
        geometry_match = re.fullmatch(r"/api/courses/([^/]+)/versions/([^/]+)/holes/(\d+)", parsed.path)
        if geometry_match:
            player = self._require_player()
            if player is None:
                return
            try:
                course_id, version_id, raw_hole = geometry_match.groups()
                course_id, version_id = unquote(course_id), unquote(version_id)
                payload = PLAYER_STORE.course_hole_geometry(course_id, version_id, int(raw_hole))
            except (AccountError, TypeError, ValueError) as error:
                self._json_response(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                return
            if payload is None:
                self._json_response(HTTPStatus.NOT_FOUND, {"error": "course geometry version was not found"})
                return
            etag = hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()[:24]
            self._json_response(HTTPStatus.OK, payload, {
                "Cache-Control": "private, max-age=31536000, immutable",
                "ETag": f'"{etag}"',
            })
            return
        if parsed.path == "/api/player/leaderboard":
            player = self._require_player()
            if player is None:
                return
            self._json_response(HTTPStatus.OK, {"leaders": PLAYER_STORE.leaderboard(10)})
            return
        if parsed.path == "/api/player/learning":
            player = self._require_player()
            if player is not None:
                self._json_response(HTTPStatus.OK, {"learning": PLAYER_STORE.player_learning(player["id"])})
            return
        if parsed.path == "/api/player/feedback":
            player = self._require_player()
            if player is not None:
                self._json_response(HTTPStatus.OK, PLAYER_STORE.player_feedback(player["id"]))
            return
        if parsed.path == "/api/player/feedback-attachment":
            player = self._require_player()
            if player is None:
                return
            attachment_id = parse_qs(parsed.query).get("id", [""])[0]
            attachment = PLAYER_STORE.feedback_attachment(
                attachment_id,
                None if player.get("is_developer") else player["id"],
            )
            if attachment is None:
                self._json_response(HTTPStatus.NOT_FOUND, {"error": "feedback screenshot was not found"})
                return
            self._binary_response(
                HTTPStatus.OK,
                attachment["file_data"],
                attachment["mime_type"],
                attachment["file_name"],
            )
            return
        if parsed.path == "/api/developer/feedback":
            player = self._require_developer()
            if player is None:
                return
            try:
                query = parse_qs(parsed.query)
                limit = int(query.get("limit", ["100"])[0])
                payload = PLAYER_STORE.developer_feedback(
                    limit,
                    query.get("status", [None])[0],
                    query.get("category", [None])[0],
                )
            except (AccountError, TypeError, ValueError) as error:
                self._json_response(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                return
            self._json_response(HTTPStatus.OK, payload)
            return
        return super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/ai/shot":
            self._handle_json_route(AI_SERVICE.narrate_shot)
            return
        if parsed.path == "/api/ai/review":
            self._handle_json_route(AI_SERVICE.review_round, attach_verified_learning=True)
            return
        if parsed.path == "/api/ai/gps-hole-review":
            self._handle_json_route(AI_SERVICE.review_gps_hole)
            return
        if parsed.path == "/api/ai/replay":
            self._handle_json_route(AI_SERVICE.interpret_replay)
            return
        if parsed.path == "/api/ai/strategy":
            self._handle_json_route(AI_SERVICE.critique_strategy, attach_verified_learning=True)
            return
        if parsed.path == "/api/ai/competition-decision":
            self._handle_json_route(AI_SERVICE.explain_competition_decision)
            return
        if parsed.path == "/api/course-mapper/install":
            self._handle_course_install()
            return
        if parsed.path.startswith("/api/v1/course-import/golf-intelligence/"):
            self._handle_golf_intelligence_import(parsed.path)
            return
        if parsed.path == "/api/player/register":
            self._handle_player_access(create=True)
            return
        if parsed.path == "/api/player/login":
            self._handle_player_access(create=False)
            return
        if parsed.path == "/api/player/logout":
            token = self._session_token()
            PLAYER_STORE.delete_session(token)
            self._json_response(
                HTTPStatus.OK,
                {"logged_out": True},
                headers={"Set-Cookie": self._expired_session_cookie()},
            )
            return
        if parsed.path == "/api/player/access-code/redeem":
            player = self._require_player()
            if player is None:
                return
            remote_key = self.client_address[0] if self.client_address else "unknown"
            try:
                payload = self._read_json_body()
                LICENSE_SERVICE.check_redemption_rate(player["id"], remote_key)
                result = LICENSE_SERVICE.redeem_access_code(player["id"], payload.get("code"))
                LICENSE_SERVICE.record_redemption_attempt(player["id"], remote_key, True)
            except (LicenseError, ValueError, json.JSONDecodeError, UnicodeDecodeError) as error:
                LICENSE_SERVICE.record_redemption_attempt(player["id"], remote_key, False)
                self._json_response(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                return
            self._json_response(HTTPStatus.OK, result)
            return
        if parsed.path == "/api/player/play-activities":
            player = self._require_player()
            if player is None:
                return
            try:
                payload = self._read_json_body()
                result = LICENSE_SERVICE.authorize_new_activity(
                    player["id"], payload.get("activity_kind"), payload.get("client_activity_id")
                )
            except PlayAccessDenied as error:
                self._json_response(HTTPStatus.FORBIDDEN, {
                    "error": str(error), "code": "PLAY_ACCESS_REQUIRED",
                    "access": LICENSE_SERVICE.access_summary(player["id"]),
                })
                return
            except (LicenseError, ValueError, json.JSONDecodeError, UnicodeDecodeError) as error:
                self._json_response(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                return
            self._json_response(HTTPStatus.CREATED, {"activity": result})
            return
        if parsed.path == "/api/admin/access-codes":
            player = self._require_admin()
            if player is None:
                return
            try:
                payload = self._read_json_body()
                result = LICENSE_SERVICE.create_access_code(
                    player["id"], plan=payload.get("plan", "INDIVIDUAL"),
                    duration_days=payload.get("duration_days", 90),
                    max_redemptions=payload.get("max_redemptions", 1),
                    redeem_by=payload.get("redeem_by"),
                )
            except (LicenseError, ValueError, json.JSONDecodeError, UnicodeDecodeError) as error:
                self._json_response(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                return
            self._json_response(HTTPStatus.CREATED, {"access_code": result})
            return
        if parsed.path == "/api/admin/access-codes/revoke":
            player = self._require_admin()
            if player is None:
                return
            try:
                payload = self._read_json_body()
                LICENSE_SERVICE.revoke_access_code(player["id"], str(payload.get("code_id") or ""))
            except (LicenseError, ValueError, json.JSONDecodeError, UnicodeDecodeError) as error:
                self._json_response(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                return
            self._json_response(HTTPStatus.OK, {"revoked": True})
            return
        if parsed.path == "/api/coach/invitations":
            player = self._require_coach()
            if player is None:
                return
            try:
                payload = self._read_json_body()
                result = LICENSE_SERVICE.create_coach_invitation(
                    player["id"], player_id=payload.get("player_id"), email=payload.get("email")
                )
            except (LicenseError, ValueError, json.JSONDecodeError, UnicodeDecodeError) as error:
                self._json_response(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                return
            self._json_response(HTTPStatus.CREATED, {"invitation": result})
            return
        if parsed.path in {
            "/api/player/coach-invitations/accept", "/api/player/coach-invitations/decline",
            "/api/coach/invitations/cancel", "/api/coach/sponsorship/assign",
            "/api/coach/sponsorship/release", "/api/player/coach-relationship/end",
        }:
            player = self._require_player()
            if player is None:
                return
            try:
                payload = self._read_json_body()
                if parsed.path.endswith("/accept"):
                    result = LICENSE_SERVICE.accept_coach_invitation(
                        player["id"], str(payload.get("invitation_id") or "")
                    )
                elif parsed.path.endswith("/decline"):
                    LICENSE_SERVICE.decline_coach_invitation(
                        player["id"], str(payload.get("invitation_id") or "")
                    )
                    result = {"declined": True}
                elif parsed.path.endswith("invitations/cancel"):
                    if "COACH" not in player.get("roles", []):
                        raise LicenseError("Coach access required")
                    LICENSE_SERVICE.cancel_coach_invitation(
                        player["id"], str(payload.get("invitation_id") or "")
                    )
                    result = {"cancelled": True}
                elif parsed.path.endswith("sponsorship/assign"):
                    if "COACH" not in player.get("roles", []):
                        raise LicenseError("Coach access required")
                    result = LICENSE_SERVICE.assign_sponsorship(
                        player["id"], str(payload.get("relationship_id") or "")
                    )
                elif parsed.path.endswith("sponsorship/release"):
                    if "COACH" not in player.get("roles", []):
                        raise LicenseError("Coach access required")
                    result = LICENSE_SERVICE.release_sponsorship(
                        player["id"], str(payload.get("relationship_id") or "")
                    )
                else:
                    result = LICENSE_SERVICE.end_coach_relationship(
                        player["id"], str(payload.get("relationship_id") or "")
                    )
            except (LicenseError, ValueError, json.JSONDecodeError, UnicodeDecodeError) as error:
                self._json_response(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                return
            self._json_response(HTTPStatus.OK, result)
            return
        if parsed.path in {"/api/player/feedback", "/api/player/feedback/reply"}:
            player = self._require_player()
            if player is None:
                return
            try:
                payload = self._read_json_body(max_bytes=2 * 1024 * 1024)
                if parsed.path.endswith("/reply"):
                    result = PLAYER_STORE.reply_to_feedback(
                        player["id"], payload.get("feedback_id"), payload.get("body"), player["name"]
                    )
                else:
                    result = PLAYER_STORE.create_feedback(
                        player["id"], payload.get("category"), payload.get("title"),
                        payload.get("body"), payload.get("context"), payload.get("attachment"),
                    )
            except (AccountError, ValueError, json.JSONDecodeError, UnicodeDecodeError) as error:
                self._json_response(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                return
            self._json_response(HTTPStatus.OK, result)
            return
        self._json_response(HTTPStatus.NOT_FOUND, {"error": "unknown api route"})

    def do_PUT(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path not in {
            "/api/player/active-round", "/api/player/profile", "/api/player/gps-round",
            "/api/player/challenge", "/api/player/rating", "/api/player/feedback/read", "/api/developer/feedback",
        }:
            self._json_response(HTTPStatus.NOT_FOUND, {"error": "unknown api route"})
            return
        player = self._require_developer() if parsed.path == "/api/developer/feedback" else self._require_player()
        if player is None:
            return
        try:
            if parsed.path == "/api/player/profile":
                payload = self._read_json_body(max_bytes=128 * 1024)
                result = PLAYER_STORE.save_profile(player["id"], payload.get("profile"))
            elif parsed.path == "/api/player/gps-round":
                payload = self._read_json_body(max_bytes=2 * 1024 * 1024)
                round_value = payload.get("round")
                self._validate_play_save(player["id"], round_value, "GPS")
                result = PLAYER_STORE.save_gps_round(player["id"], round_value)
            elif parsed.path == "/api/player/challenge":
                payload = self._read_json_body(max_bytes=5 * 1024 * 1024)
                challenge = payload.get("challenge")
                self._validate_play_save(player["id"], challenge, "THREE_HOLE_MATCH")
                result = PLAYER_STORE.save_challenge(
                    player["id"], challenge, payload.get("geometry_snapshot")
                )
            elif parsed.path == "/api/player/rating":
                payload = self._read_json_body()
                result = PLAYER_STORE.save_game_rating(player["id"], payload.get("stars"), payload.get("comment"))
            elif parsed.path == "/api/player/feedback/read":
                self._read_json_body()
                result = PLAYER_STORE.mark_feedback_read(player["id"])
            elif parsed.path == "/api/developer/feedback":
                payload = self._read_json_body()
                result = PLAYER_STORE.update_feedback_as_developer(
                    payload.get("feedback_id"), player["name"], payload.get("status"), payload.get("reply"),
                )
            else:
                payload = self._read_json_body(max_bytes=10 * 1024 * 1024)
                round_value = payload.get("round")
                activity_kind = str(
                    round_value.get("license_activity_kind", "ROUND")
                    if isinstance(round_value, dict) else "ROUND"
                ).upper()
                self._validate_play_save(player["id"], round_value, activity_kind)
                result = PLAYER_STORE.save_round(player["id"], round_value)
        except (AccountError, ValueError, json.JSONDecodeError, UnicodeDecodeError) as error:
            if parsed.path == "/api/player/gps-round":
                print(f"GPS round sync rejected: {error}", flush=True)
            self._json_response(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        self._json_response(HTTPStatus.OK, result)

    @staticmethod
    def _validate_play_save(player_id: int, value: Any, activity_kind: str) -> None:
        activity_id = value.get("license_activity_id") if isinstance(value, dict) else None
        if not LICENSE_SERVICE.validate_activity(player_id, activity_id, activity_kind):
            raise AccountError("play activity authorization is invalid")

    def _session_token(self) -> str | None:
        cookies = SimpleCookie()
        try:
            cookies.load(self.headers.get("Cookie", ""))
        except Exception:
            return None
        morsel = cookies.get(SESSION_COOKIE)
        return morsel.value if morsel else None

    def _current_player(self) -> dict | None:
        if SUPABASE_AUTH is not None:
            authorization = self.headers.get("Authorization", "")
            token = authorization.removeprefix("Bearer ").strip() if authorization.startswith("Bearer ") else None
            identity = SUPABASE_AUTH.get_user(token)
            if identity is None:
                return None
            player = PLAYER_STORE.upsert_supabase_player(
                identity["external_id"], identity["email"], identity["name"]
            )
        else:
            player = PLAYER_STORE.player_for_session(self._session_token())
        return self._with_access_role(player)

    @staticmethod
    def _with_access_role(player: dict | None) -> dict | None:
        if player is None:
            return None
        player = dict(player)
        player["is_developer"] = (
            str(player.get("email") or "").casefold() in DEVELOPER_EMAILS
            or str(player.get("name") or "").casefold() in DEVELOPER_NAMES
        )
        LICENSE_SERVICE.ensure_role(player["id"], "PLAYER")
        if player["is_developer"]:
            LICENSE_SERVICE.ensure_role(player["id"], "ADMIN")
        player["roles"] = LICENSE_SERVICE.roles(player["id"])
        player["is_admin"] = "ADMIN" in player["roles"]
        player["access"] = LICENSE_SERVICE.access_summary(player["id"])
        return player

    def _require_player(self) -> dict | None:
        player = self._current_player()
        if player is None:
            self._json_response(HTTPStatus.UNAUTHORIZED, {"error": "player login required"})
        return player

    def _require_developer(self) -> dict | None:
        player = self._require_player()
        if player is not None and not player.get("is_developer"):
            self._json_response(HTTPStatus.FORBIDDEN, {"error": "developer access required"})
            return None
        return player

    def _require_admin(self) -> dict | None:
        player = self._require_player()
        if player is not None and not player.get("is_admin"):
            self._json_response(HTTPStatus.FORBIDDEN, {"error": "administrator access required"})
            return None
        return player

    def _require_coach(self) -> dict | None:
        player = self._require_player()
        if player is not None and "COACH" not in player.get("roles", []):
            self._json_response(HTTPStatus.FORBIDDEN, {"error": "Coach access required"})
            return None
        return player

    @staticmethod
    def _session_cookie(token: str) -> str:
        return f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000"

    @staticmethod
    def _expired_session_cookie() -> str:
        return f"{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"

    def _read_json_body(self, max_bytes: int = 64 * 1024) -> dict:
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length <= 0 or content_length > max_bytes:
            raise ValueError("request body has an invalid size")
        payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("request body must be an object")
        return payload

    def _handle_player_access(self, *, create: bool) -> None:
        if SUPABASE_AUTH is not None:
            self._json_response(
                HTTPStatus.CONFLICT,
                {"error": "player access is managed by Supabase"},
            )
            return
        try:
            payload = self._read_json_body()
            if create:
                player = PLAYER_STORE.create_player(payload.get("name"), payload.get("pin"))
            else:
                player = PLAYER_STORE.authenticate(payload.get("name"), payload.get("pin"))
                if player is None:
                    self._json_response(HTTPStatus.UNAUTHORIZED, {"error": "player name or PIN is incorrect"})
                    return
            token = PLAYER_STORE.create_session(player["id"])
        except (AccountError, ValueError, json.JSONDecodeError, UnicodeDecodeError) as error:
            self._json_response(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        self._json_response(
            HTTPStatus.OK,
            {"player": self._with_access_role(player)},
            headers={"Set-Cookie": self._session_cookie(token)},
        )

    def _handle_course_install(self) -> None:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > 25 * 1024 * 1024:
                raise ValueError("course package must be between 1 byte and 25 MB")
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
            payload = validate_package(payload)
            destination = install_package(payload, force=True)
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as error:
            self._json_response(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        except OSError as error:
            self._json_response(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": f"could not write the course files: {error}"},
            )
            return
        self._json_response(HTTPStatus.OK, {
            "installed": True,
            "course_id": payload["course_id"],
            "course_name": payload["course_name"],
            "holes": 18,
            "gps_calibrated_holes": sum(
                1 for hole in payload["holes"].values()
                if hole.get("hole_metadata", {}).get("gps_calibration")
            ),
            "map_updated_at": payload.get("exported_at"),
            "destination": str(destination.relative_to(ROOT)),
        })

    def _handle_golf_intelligence_import(self, path: str) -> None:
        player = self._require_developer()
        if player is None:
            return
        try:
            payload = self._read_json_body(max_bytes=128 * 1024)
            requested_by = str(player["id"])
            if path.endswith("/search"):
                result = COURSE_IMPORT_SERVICE.search(payload)
            elif path.endswith("/preview-gps-only"):
                external_id = str(payload.get("public_id") or "").strip()
                scorecard_path = GPS_RECOVERY_SCORECARDS.get(external_id)
                if scorecard_path is None or not scorecard_path.is_file():
                    raise CourseImportError(
                        "No trusted local scorecard is configured for this GPS-only recovery",
                        status=409,
                    )
                result = COURSE_IMPORT_SERVICE.preview_gps_only(
                    payload,
                    requested_by,
                    scorecard_path.read_text(encoding="utf-8"),
                )
            elif path.endswith("/preview"):
                result = COURSE_IMPORT_SERVICE.preview(payload, requested_by)
            elif path.endswith("/import"):
                result = COURSE_IMPORT_SERVICE.commit(payload, requested_by)
            elif path.endswith("/paid-calls"):
                if not isinstance(payload.get("allowed"), bool):
                    raise CourseImportError("allowed must be true or false")
                result = COURSE_IMPORT_SERVICE.set_paid_calls_allowed(payload["allowed"])
                result["gps_only_recovery_public_ids"] = sorted(GPS_RECOVERY_SCORECARDS)
            else:
                self._json_response(HTTPStatus.NOT_FOUND, {"error": "unknown course import route"})
                return
        except CourseImportError as error:
            try:
                status = HTTPStatus(error.status)
            except ValueError:
                status = HTTPStatus.BAD_REQUEST
            self._json_response(status, {"error": str(error)})
            return
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as error:
            self._json_response(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        except Exception as error:
            self.log_error("course import failed unexpectedly: %s", error)
            self._json_response(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": "The course import failed safely. Paid calls are now OFF; check the server log before retrying."},
            )
            COURSE_IMPORT_SERVICE.set_paid_calls_allowed(False)
            return
        self._json_response(HTTPStatus.OK, result)

    def _attach_verified_learning(self, payload: dict) -> None:
        player = self._current_player()
        learning = PLAYER_STORE.player_learning(player["id"]) if player is not None else None
        attach_verified_learning_context(payload, learning)

    def _handle_json_route(self, handler, *, attach_verified_learning: bool = False) -> None:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
        except (ValueError, json.JSONDecodeError):
            self._json_response(HTTPStatus.BAD_REQUEST, {"error": "invalid json body"})
            return
        try:
            if attach_verified_learning:
                self._attach_verified_learning(payload)
            response = handler(payload)
        except AiProviderError as error:
            self._json_response(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})
            return
        self._json_response(HTTPStatus.OK, response)

    def _handle_geocode(self, query: str) -> None:
        address = parse_qs(query).get("address", [""])[0].strip()
        if not address:
            self._json_response(HTTPStatus.BAD_REQUEST, {"error": "address is required"})
            return
        parameters = urlencode({
            "address": address,
            "benchmark": "Public_AR_Current",
            "format": "json",
        })
        request = Request(
            f"{CENSUS_GEOCODER_URL}?{parameters}",
            headers={"User-Agent": "MiddlesexGolfCourseMapper/1.0"},
        )
        try:
            with urlopen(request, timeout=12) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError):
            self._json_response(
                HTTPStatus.BAD_GATEWAY,
                {"error": "The U.S. Census address service is unavailable. Try again shortly."},
            )
            return
        matches = payload.get("result", {}).get("addressMatches", [])
        if not matches:
            self._json_response(
                HTTPStatus.NOT_FOUND,
                {"error": "No U.S. street-address match was found. Include street, city, state, and ZIP."},
            )
            return
        match = matches[0]
        coordinates = match.get("coordinates", {})
        self._json_response(HTTPStatus.OK, {
            "formatted_address": match.get("matchedAddress", address),
            "location": {
                "lat": coordinates.get("y"),
                "lng": coordinates.get("x"),
            },
            "source": "U.S. Census Geocoder",
        })

    def _json_response(self, status: HTTPStatus, payload: dict, headers: dict | None = None) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        response_headers = dict(headers or {})
        self.send_header("Cache-Control", response_headers.pop("Cache-Control", "no-store"))
        for name, value in response_headers.items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def _binary_response(self, status: HTTPStatus, body: bytes, mime_type: str, file_name: str) -> None:
        safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", file_name).strip("-") or "feedback-image"
        self.send_response(status)
        self.send_header("Content-Type", mime_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Content-Disposition", f'inline; filename="{safe_name}"')
        self.send_header("Cache-Control", "private, no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:
        if os.getenv("QUIET_HTTP_LOGS") == "1":
            return
        super().log_message(format, *args)


def main(*, default_port: int = 8080, description: str | None = None) -> None:
    parser = argparse.ArgumentParser(description=description or __doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=default_port)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), AppHandler)
    print(f"Serving {ROOT} at http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
