"""Minimal Supabase Auth integration for the dependency-free game server."""

from __future__ import annotations

import json
import hashlib
import threading
import time
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from .store import AccountError


@dataclass(frozen=True)
class SupabaseConfig:
    url: str
    anon_key: str

    @classmethod
    def from_values(cls, url: str | None, anon_key: str | None) -> "SupabaseConfig | None":
        normalized_url = str(url or "").strip().rstrip("/")
        normalized_key = str(anon_key or "").strip()
        if not normalized_url and not normalized_key:
            return None
        parsed = urlparse(normalized_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise AccountError("SUPABASE_URL must be a valid http or https URL")
        if not normalized_key:
            raise AccountError("SUPABASE_ANON_KEY is required when SUPABASE_URL is set")
        return cls(normalized_url, normalized_key)

    def public_payload(self) -> dict[str, Any]:
        return {"provider": "supabase", "url": self.url, "anon_key": self.anon_key}


class SupabaseAuth:
    def __init__(self, config: SupabaseConfig, *, cache_seconds: float = 30.0):
        self.config = config
        self.cache_seconds = max(0.0, float(cache_seconds))
        self._identity_cache: dict[bytes, tuple[float, dict[str, Any]]] = {}
        self._identity_inflight: dict[bytes, threading.Event] = {}
        self._identity_lock = threading.Lock()

    def get_user(self, access_token: str | None) -> dict[str, Any] | None:
        if not access_token:
            return None
        cache_key = hashlib.sha256(access_token.encode("utf-8")).digest()
        while True:
            with self._identity_lock:
                cached = self._identity_cache.get(cache_key)
                if cached is not None and cached[0] > time.monotonic():
                    return dict(cached[1])
                event = self._identity_inflight.get(cache_key)
                if event is None:
                    event = threading.Event()
                    self._identity_inflight[cache_key] = event
                    break
            # Concurrent API requests carrying the same token share one remote
            # Supabase validation instead of creating a validation burst.
            event.wait(timeout=21)

        identity = None
        try:
            identity = self._get_user_remote(access_token)
            if identity is not None and self.cache_seconds:
                with self._identity_lock:
                    self._identity_cache[cache_key] = (
                        time.monotonic() + self.cache_seconds,
                        dict(identity),
                    )
            return identity
        finally:
            with self._identity_lock:
                self._identity_inflight.pop(cache_key, None)
                event.set()

    def _get_user_remote(self, access_token: str) -> dict[str, Any] | None:
        request = Request(
            f"{self.config.url}/auth/v1/user",
            headers={
                "apikey": self.config.anon_key,
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/json",
            },
        )
        payload = None
        for attempt in range(2):
            try:
                with urlopen(request, timeout=10) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                break
            except HTTPError as error:
                if error.code not in {429, 500, 502, 503, 504} or attempt == 1:
                    return None
            except (URLError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError):
                if attempt == 1:
                    return None
            time.sleep(0.15)
        if not isinstance(payload, dict):
            return None
        user_id = payload.get("id")
        email = payload.get("email")
        if not isinstance(user_id, str) or not user_id:
            return None
        metadata = payload.get("user_metadata") if isinstance(payload.get("user_metadata"), dict) else {}
        display_name = metadata.get("display_name") or metadata.get("full_name")
        if not isinstance(display_name, str) or not display_name.strip():
            display_name = str(email or "Player").split("@", 1)[0]
        return {
            "external_id": user_id,
            "email": email if isinstance(email, str) else "",
            "name": " ".join(display_name.strip().split())[:40] or "Player",
        }
