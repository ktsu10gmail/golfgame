#!/usr/bin/env python3
"""Serve the browser app and Gemini-backed AI endpoints from one process."""

from __future__ import annotations

import argparse
import json
import os
import sys
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from packages.ai import GeminiProviderError, create_ai_service

AI_SERVICE = create_ai_service()


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/ai/health":
            self._json_response(HTTPStatus.OK, AI_SERVICE.status())
            return
        return super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/ai/shot":
            self._handle_json_route(AI_SERVICE.narrate_shot)
            return
        if parsed.path == "/api/ai/review":
            self._handle_json_route(AI_SERVICE.review_round)
            return
        self._json_response(HTTPStatus.NOT_FOUND, {"error": "unknown api route"})

    def _handle_json_route(self, handler) -> None:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
        except (ValueError, json.JSONDecodeError):
            self._json_response(HTTPStatus.BAD_REQUEST, {"error": "invalid json body"})
            return
        try:
            response = handler(payload)
        except GeminiProviderError as error:
            self._json_response(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})
            return
        self._json_response(HTTPStatus.OK, response)

    def _json_response(self, status: HTTPStatus, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:
        if os.getenv("QUIET_HTTP_LOGS") == "1":
            return
        super().log_message(format, *args)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), AppHandler)
    print(f"Serving {ROOT} at http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
