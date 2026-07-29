"""Server-side AI service using Gemini as the primary provider."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass

from .prompts import build_round_prompt, build_shot_prompt


DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
DEFAULT_GEMINI_TIMEOUT_SECONDS = 8


class GeminiProviderError(RuntimeError):
    """Raised when the Gemini provider cannot satisfy a request."""


@dataclass(slots=True)
class GeminiProvider:
    api_key: str
    model: str = DEFAULT_GEMINI_MODEL
    timeout_seconds: int = DEFAULT_GEMINI_TIMEOUT_SECONDS

    @property
    def endpoint(self) -> str:
        return f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"

    def generate_json(self, prompt: str) -> dict:
        request_body = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"responseMimeType": "application/json"},
        }
        request = urllib.request.Request(
            self.endpoint,
            data=json.dumps(request_body).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": self.api_key,
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise GeminiProviderError(f"Gemini HTTP {error.code}: {detail}") from error
        except urllib.error.URLError as error:
            raise GeminiProviderError(f"Gemini network error: {error}") from error
        candidate = (payload.get("candidates") or [{}])[0]
        parts = (((candidate.get("content") or {}).get("parts")) or [])
        text = "".join(part.get("text", "") for part in parts if isinstance(part, dict)).strip()
        if not text:
            raise GeminiProviderError("Gemini returned no text payload")
        try:
            return json.loads(text)
        except json.JSONDecodeError as error:
            raise GeminiProviderError(f"Gemini returned invalid JSON: {text}") from error


@dataclass(slots=True)
class AiService:
    provider: GeminiProvider | None

    def status(self) -> dict:
        if self.provider is None:
            return {"enabled": False, "provider": None, "reason": "missing GEMINI_API_KEY"}
        return {"enabled": True, "provider": "gemini", "model": self.provider.model}

    def narrate_shot(self, payload: dict) -> dict:
        if self.provider is None:
            raise GeminiProviderError("Gemini is not configured")
        response = self.provider.generate_json(build_shot_prompt(payload))
        return {
            "provider": "gemini",
            "model": self.provider.model,
            "summary": str(response.get("summary", "")).strip(),
            "decision_assessment": str(response.get("decision_assessment", "")).strip(),
            "execution_assessment": str(response.get("execution_assessment", "")).strip(),
            "next_play": str(response.get("next_play", "")).strip(),
        }

    def review_round(self, payload: dict) -> dict:
        if self.provider is None:
            raise GeminiProviderError("Gemini is not configured")
        response = self.provider.generate_json(build_round_prompt(payload))
        return {
            "provider": "gemini",
            "model": self.provider.model,
            "verdict": str(response.get("verdict", "")).strip(),
            "strength": str(response.get("strength", "")).strip(),
            "priority": str(response.get("priority", "")).strip(),
        }


def create_ai_service() -> AiService:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        return AiService(provider=None)
    model = os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL
    timeout = int(os.getenv("GEMINI_TIMEOUT_SECONDS", str(DEFAULT_GEMINI_TIMEOUT_SECONDS)))
    return AiService(provider=GeminiProvider(api_key=api_key, model=model, timeout_seconds=timeout))
