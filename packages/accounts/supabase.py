"""Minimal Supabase Auth integration for the dependency-free game server."""

from __future__ import annotations

import json
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
    def __init__(self, config: SupabaseConfig):
        self.config = config

    def get_user(self, access_token: str | None) -> dict[str, Any] | None:
        if not access_token:
            return None
        request = Request(
            f"{self.config.url}/auth/v1/user",
            headers={
                "apikey": self.config.anon_key,
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/json",
            },
        )
        try:
            with urlopen(request, timeout=10) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError):
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
