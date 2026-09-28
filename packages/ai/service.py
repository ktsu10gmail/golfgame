"""Server-side AI service for local Ollama and optional Gemini narration."""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Protocol

from .advice_library import guidance_text

from .prompts import (
    COMPETITION_DECISION_RESPONSE_SCHEMA,
    GPS_HOLE_REVIEW_RESPONSE_SCHEMA,
    REPLAY_INTERPRETATION_RESPONSE_SCHEMA,
    ROUND_RESPONSE_SCHEMA,
    SHOT_RESPONSE_SCHEMA,
    STRATEGY_RESPONSE_SCHEMA,
    build_gps_hole_review_prompt,
    build_replay_interpretation_prompt,
    build_competition_decision_prompt,
    build_round_prompt,
    build_shot_prompt,
    build_strategy_prompt,
)


DEFAULT_AI_PROVIDER = "ollama"
DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434"
DEFAULT_OLLAMA_MODEL = "qwen3.5:4b"
DEFAULT_OLLAMA_TIMEOUT_SECONDS = 60
DEFAULT_OLLAMA_CONTEXT_TOKENS = 4096
DEFAULT_OLLAMA_TEMPERATURE = 0.3
DEFAULT_GEMINI_MODEL = "gemini-3.6-flash"
DEFAULT_GEMINI_TIMEOUT_SECONDS = 15

ACTION_ADVICE_KEYS = {
    "favor_safe_side", "favor_center_green", "prioritize_solid_contact",
    "clear_lip_first", "escape_first", "remove_big_miss", "accept_longer_putt",
    "play_to_widest_window", "cover_the_carry", "restore_position",
}
UNSUPPORTED_SWING_DIAGNOSES = (
    "poor strike", "struck poorly", "bad strike", "mishit", "swing fault",
    "poor contact", "bad contact",
)
UNSUPPORTED_GPS_INFERENCES = (
    "accurate", "inaccurate", "missed", "miss ", "short of", "long of",
    "good shot", "bad shot", "successful", "unsuccessful", "poor shot",
    "poor approach", "good approach", "correct club", "wrong club",
)
CONTRADICTS_SOUND_DECISION = ("bad decision", "poor decision", "wrong decision", "bad plan", "poor plan", "wrong plan")
CONTRADICTS_ON_PLAN_EXECUTION = ("poor execution", "bad execution", "failed execution", "execution missed", "missed execution")


class AiProviderError(RuntimeError):
    """Raised when the configured AI provider cannot satisfy a request."""


class GeminiProviderError(AiProviderError):
    """Raised when Gemini cannot satisfy a request."""


class OllamaProviderError(AiProviderError):
    """Raised when Ollama cannot satisfy a request."""


def _swing_label(power: object, club: object = "") -> str:
    try:
        normalized = int(round(float(power)))
    except (TypeError, ValueError):
        return ""
    if str(club).strip().lower() == "putter":
        return f"{normalized}% pace"
    nearest = min((25, 50, 75, 100), key=lambda level: abs(level - normalized))
    return {25: "quarter swing", 50: "half swing", 75: "three-quarter swing", 100: "full swing"}[nearest]


def _shot_reference(shot: dict) -> str:
    stroke = shot.get("stroke_number")
    club = str(shot.get("club") or "the selected club").strip()
    power = shot.get("power")
    swing = f" with a {_swing_label(power, club)}" if power is not None else ""
    return f"shot {stroke} ({club}{swing})" if stroke is not None else f"{club}{swing}"


def _has_unsupported_swing_diagnosis(*texts: object) -> bool:
    combined = " ".join(str(text or "").lower() for text in texts)
    return any(term in combined for term in UNSUPPORTED_SWING_DIAGNOSES)


def _has_unsupported_gps_inference(text: object) -> bool:
    combined = str(text or "").lower()
    return _has_unsupported_swing_diagnosis(combined) or any(
        term in combined for term in UNSUPPORTED_GPS_INFERENCES
    )


def _has_overconfident_decision_blame(*values: object) -> bool:
    combined = " ".join(str(value or "") for value in values).lower()
    return bool(re.search(r"\b[a-z]+_[a-z_]+\b", combined)) or any(
        phrase in combined for phrase in (
            "execution produced a miss",
            "does not justify changing a sound strategy",
            "decisions were sound, but",
            "decision was sound, but",
        )
    )


def _verified_hole_review(hole_number: int, hole: dict) -> dict:
    shots = [shot for shot in hole.get("shots", []) if isinstance(shot, dict)]
    decision_reviews = [shot for shot in shots if shot.get("decision_quality") == "review"]
    execution_reviews = [shot for shot in shots if shot.get("execution_quality") == "review"]
    penalties = sum(int(shot.get("penalty") or 0) for shot in shots)

    details = []
    sidehill_credit = ""
    adjustment_credit = ""
    rewarded_adjustments = [
        shot for shot in shots
        if isinstance(shot.get("adjustment_reward"), dict)
        and int(shot["adjustment_reward"].get("accuracy_bonus") or 0) > 0
    ]
    if rewarded_adjustments:
        credited_adjustment = rewarded_adjustments[0]
        reward = credited_adjustment["adjustment_reward"]
        adjustment_credit = (
            f"The verified adjustment on {_shot_reference(credited_adjustment)} earned a temporary "
            f"{int(reward.get('accuracy_bonus') or 0)}-point accuracy reward "
            f"({int(reward.get('base_accuracy') or 0)}% to {int(reward.get('effective_accuracy') or 0)}% for that shot only)"
        )
        details.append(adjustment_credit)
    correct_sidehill = [
        shot for shot in shots
        if isinstance(shot.get("sidehill_plan"), dict)
        and shot["sidehill_plan"].get("compensation") == "correct"
    ]
    if correct_sidehill:
        credited = correct_sidehill[0]
        plan = credited["sidehill_plan"]
        player_aim = float(plan.get("player_aim_yards") or 0)
        curve = float(plan.get("expected_curve_yards") or 0)
        aim_direction = "right" if player_aim > 0 else "left"
        curve_direction = "right" if curve > 0 else "left"
        intent_note = "The recorded player instruction and aim line" if credited.get("player_intent") else "The recorded aim line"
        sidehill_credit = (
            f"{intent_note} on {_shot_reference(credited)} correctly allowed {abs(player_aim):g} yards {aim_direction} "
            f"for the expected {abs(curve):g}-yard {curve_direction} sidehill curve"
        )
        details.append(sidehill_credit)
    if decision_reviews:
        references = ", ".join(_shot_reference(shot) for shot in decision_reviews[:3])
        details.append(f"The strategic choice needs review on {references}")
    if execution_reviews:
        references = ", ".join(_shot_reference(shot) for shot in execution_reviews[:3])
        if decision_reviews:
            details.append(f"the recorded result also missed the plan on {references}")
        else:
            details.append(
                f"The current evaluator classified the selected plan as meeting its criteria on {references}; "
                "the recorded result missed the intended outcome"
            )
    if penalties:
        details.append(f"the hole included {penalties} penalty {('stroke' if penalties == 1 else 'strokes')}")
    if not details:
        reasons = [
            str(reason).strip() for reason in hole.get("meaning_reasons", [])
            if reason is not None and str(reason).strip()
        ]
        details.append(f"The recorded review flagged {'; '.join(reasons) or 'a meaningful scoring result'}")

    if penalties:
        next_time = guidance_text(["recovery_after_penalty"], limit=1)
    elif decision_reviews:
        action_keys = []
        for shot in decision_reviews:
            strategy = shot.get("strategy_packet")
            decision = strategy.get("decision", {}) if isinstance(strategy, dict) else {}
            action_keys.extend(
                key for key in decision.get("advice_keys", [])
                if key in ACTION_ADVICE_KEYS
            )
        next_time = guidance_text(action_keys, limit=1) or "Choose the lower-risk target or club plan next time."
    elif execution_reviews:
        next_time = (
            "Review the selected plan, caddie recommendation, execution evidence, and recorded outcome separately; "
            "the miss alone does not prove which one should change."
        )
    else:
        next_time = "Use the recorded result to repeat the successful decision or adjust the next similar plan."

    sound_decisions = [shot for shot in shots if shot.get("decision_quality") == "good"]
    if adjustment_credit and sidehill_credit:
        credit = adjustment_credit + ". " + sidehill_credit + "."
    elif adjustment_credit:
        credit = adjustment_credit + "."
    elif sidehill_credit:
        credit = sidehill_credit + "."
    elif sound_decisions:
        references = ", ".join(_shot_reference(shot) for shot in sound_decisions[:3])
        credit = f"The selected plan met the current evaluator's criteria on {references}."
    else:
        credit = "The record does not show a specific strategic strength to credit on this hole."

    if decision_reviews:
        references = ", ".join(_shot_reference(shot) for shot in decision_reviews[:3])
        correction = f"The target, club, or risk choice needs review on {references}."
    elif execution_reviews:
        references = ", ".join(_shot_reference(shot) for shot in execution_reviews[:3])
        correction = (
            f"The recorded outcome missed the intended plan on {references}; this evidence alone does not identify "
            "whether the recommendation, model assumptions, or execution should change."
        )
    elif penalties:
        correction = f"The {penalties}-stroke penalty was the main cost recorded on this hole."
    else:
        correction = "No specific correction is supported by the recorded shot evidence."

    return {
        "hole_number": hole_number,
        "insight": ". ".join(details) + ".",
        "credit": credit,
        "correction": correction,
        "next_time": next_time,
        "source": "verified_fallback",
    }


class JsonProvider(Protocol):
    name: str
    model: str

    def generate_json(self, prompt: str, schema: dict) -> dict: ...


def _json_request(endpoint: str, request_body: dict, timeout_seconds: int) -> dict:
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(request_body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
        return json.loads(response.read().decode("utf-8"))


@dataclass(slots=True)
class OllamaProvider:
    model: str = DEFAULT_OLLAMA_MODEL
    host: str = DEFAULT_OLLAMA_HOST
    timeout_seconds: int = DEFAULT_OLLAMA_TIMEOUT_SECONDS
    context_tokens: int = DEFAULT_OLLAMA_CONTEXT_TOKENS
    temperature: float = DEFAULT_OLLAMA_TEMPERATURE
    name: str = "ollama"

    @property
    def endpoint(self) -> str:
        return f"{self.host.rstrip('/')}/api/generate"

    def generate_json(self, prompt: str, schema: dict) -> dict:
        prediction_tokens = 600 if schema == ROUND_RESPONSE_SCHEMA else 220
        request_body = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "think": False,
            "format": schema,
            "keep_alive": "10m",
            "options": {
                "num_ctx": self.context_tokens,
                "temperature": self.temperature,
                "num_predict": prediction_tokens,
            },
        }
        try:
            payload = _json_request(self.endpoint, request_body, self.timeout_seconds)
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise OllamaProviderError(f"Ollama HTTP {error.code}: {detail}") from error
        except (urllib.error.URLError, TimeoutError) as error:
            raise OllamaProviderError(f"Ollama network error: {error}") from error
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise OllamaProviderError("Ollama returned an invalid response") from error
        text = str(payload.get("response", "")).strip()
        if not text:
            detail = payload.get("error") or "no text payload"
            raise OllamaProviderError(f"Ollama returned {detail}")
        try:
            return json.loads(text)
        except json.JSONDecodeError as error:
            raise OllamaProviderError(f"Ollama returned invalid JSON: {text}") from error


@dataclass(slots=True)
class GeminiProvider:
    api_key: str
    model: str = DEFAULT_GEMINI_MODEL
    timeout_seconds: int = DEFAULT_GEMINI_TIMEOUT_SECONDS
    name: str = "gemini"

    @property
    def endpoint(self) -> str:
        return f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"

    def generate_json(self, prompt: str, schema: dict) -> dict:
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
        except (urllib.error.URLError, TimeoutError) as error:
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
    provider: JsonProvider | None
    disabled_reason: str = "AI provider is disabled"
    fallback_provider: JsonProvider | None = None

    def status(self) -> dict:
        if self.provider is None:
            return {"enabled": False, "provider": None, "reason": self.disabled_reason}
        return {"enabled": True, "provider": self.provider.name, "model": self.provider.model}

    def narrate_shot(self, payload: dict) -> dict:
        if self.provider is None:
            raise AiProviderError(self.disabled_reason)
        response = self.provider.generate_json(build_shot_prompt(payload), SHOT_RESPONSE_SCHEMA)
        return {
            "provider": self.provider.name,
            "model": self.provider.model,
            "summary": str(response.get("summary", "")).strip(),
            "decision_assessment": str(response.get("decision_assessment", "")).strip(),
            "execution_assessment": str(response.get("execution_assessment", "")).strip(),
            "next_play": str(response.get("next_play", "")).strip(),
        }

    def review_gps_hole(self, payload: dict) -> dict:
        if self.provider is None:
            raise AiProviderError(self.disabled_reason)
        response = self.provider.generate_json(
            build_gps_hole_review_prompt(payload), GPS_HOLE_REVIEW_RESPONSE_SCHEMA
        )
        summary = str(response.get("summary", "")).strip()
        if not summary or _has_unsupported_gps_inference(summary):
            raise AiProviderError("AI did not return a supported GPS hole summary")
        return {
            "provider": self.provider.name,
            "model": self.provider.model,
            "summary": summary,
        }

    def interpret_replay(self, payload: dict) -> dict:
        if self.provider is None:
            raise AiProviderError(self.disabled_reason)
        authoritative = payload.get("authoritative_assessment") if isinstance(payload, dict) else None
        if not isinstance(authoritative, dict):
            raise AiProviderError("authoritative replay assessment is missing")
        decision = str(authoritative.get("decision", "")).strip()
        result = str(authoritative.get("result", "")).strip()
        execution = str(authoritative.get("execution", "")).strip()
        if not result or not decision or not execution:
            raise AiProviderError("authoritative replay grades are missing")
        response = self.provider.generate_json(
            build_replay_interpretation_prompt(payload), REPLAY_INTERPRETATION_RESPONSE_SCHEMA
        )
        interpretation = str(response.get("interpretation", "")).strip()
        next_time = str(response.get("next_time", "")).strip()
        if not interpretation or not next_time or _has_unsupported_swing_diagnosis(interpretation, next_time):
            raise AiProviderError("AI did not return a supported replay interpretation")
        combined = f"{interpretation} {next_time}".lower()
        shot = payload.get("shot") if isinstance(payload.get("shot"), dict) else {}
        canonical = shot.get("canonical_assessment") if isinstance(shot.get("canonical_assessment"), dict) else {}
        outcome = canonical.get("outcome_vs_target") if isinstance(canonical.get("outcome_vs_target"), dict) else {}
        target_kind = str(outcome.get("target_kind", "")).upper()
        if target_kind == "DIRECTION_TARGET" and any(
            phrase in combined for phrase in ("target spot", "landing point", "landing target")
        ):
            raise AiProviderError("AI contradicted Direction Target semantics")
        if target_kind == "PUTTING_LINE" and "carry point" in combined:
            raise AiProviderError("AI contradicted putting target semantics")
        if any(grade in decision.lower() for grade in ("sound", "preferred", "competitive")) and any(
            term in combined for term in CONTRADICTS_SOUND_DECISION
        ):
            raise AiProviderError("AI contradicted the authoritative decision grade")
        if "on plan" in execution.lower() and any(term in combined for term in CONTRADICTS_ON_PLAN_EXECUTION):
            raise AiProviderError("AI contradicted the authoritative execution grade")
        return {
            "provider": self.provider.name,
            "model": self.provider.model,
            "result": result,
            "decision": decision,
            "execution": execution,
            "interpretation": interpretation,
            "next_time": next_time,
        }

    def review_round(self, payload: dict) -> dict:
        if self.provider is None:
            raise AiProviderError(self.disabled_reason)
        prompt = build_round_prompt(payload)
        response_provider = self.provider
        try:
            response = response_provider.generate_json(prompt, ROUND_RESPONSE_SCHEMA)
        except AiProviderError:
            if self.fallback_provider is None:
                raise
            response_provider = self.fallback_provider
            response = response_provider.generate_json(prompt, ROUND_RESPONSE_SCHEMA)
        primary_verdict = str(response.get("verdict", "")).strip()
        if (
            response_provider is self.provider
            and self.fallback_provider is not None
            and (not primary_verdict or _has_overconfident_decision_blame(primary_verdict))
        ):
            response_provider = self.fallback_provider
            response = response_provider.generate_json(prompt, ROUND_RESPONSE_SCHEMA)
        valid_holes = {}
        for hole in payload.get("holes", []):
            if not isinstance(hole, dict) or not hole.get("meaningful") or hole.get("hole_number") is None:
                continue
            try:
                valid_holes[int(hole.get("hole_number"))] = hole
            except (TypeError, ValueError):
                continue
        seen_holes: set[int] = set()
        hole_reviews = []
        for review in response.get("hole_reviews", []):
            if not isinstance(review, dict):
                continue
            try:
                hole_number = int(review.get("hole_number"))
            except (TypeError, ValueError):
                continue
            if hole_number not in valid_holes or hole_number in seen_holes:
                continue
            verified = _verified_hole_review(hole_number, valid_holes[hole_number])
            insight = str(review.get("insight", "")).strip()
            next_time = str(review.get("next_time", "")).strip()
            credit = str(review.get("credit", "")).strip()
            correction = str(review.get("correction", "")).strip()
            if not insight or not next_time or _has_unsupported_swing_diagnosis(
                insight, credit, correction, next_time
            ) or _has_overconfident_decision_blame(insight, credit, correction, next_time):
                continue
            seen_holes.add(hole_number)
            hole_reviews.append({
                "hole_number": hole_number,
                "insight": insight,
                "credit": credit or verified["credit"],
                "correction": correction or verified["correction"],
                "next_time": next_time,
                "source": "ai",
            })
        for hole_number, hole in valid_holes.items():
            if hole_number in seen_holes:
                continue
            hole_reviews.append(_verified_hole_review(hole_number, hole))
        verdict = str(response.get("verdict", "")).strip()
        if _has_overconfident_decision_blame(verdict):
            verdict = ""
        return {
            "provider": response_provider.name,
            "model": response_provider.model,
            "verdict": verdict,
            "strength": str(response.get("strength", "")).strip(),
            "priority": str(response.get("priority", "")).strip(),
            "hole_reviews": hole_reviews[:5],
        }

    def critique_strategy(self, payload: dict) -> dict:
        if self.provider is None:
            raise AiProviderError(self.disabled_reason)
        choices = payload.get("choices") if isinstance(payload, dict) else None
        valid_ids = {
            str(choice.get("id")) for choice in choices or []
            if isinstance(choice, dict) and choice.get("id")
        }
        if not valid_ids:
            raise AiProviderError("strategy choices are missing")
        response = self.provider.generate_json(
            build_strategy_prompt(payload), STRATEGY_RESPONSE_SCHEMA
        )
        recommended = str(response.get("recommended_choice_id", "")).strip()
        probability_analysis = payload.get("probability_analysis")
        hybrid_best = str(probability_analysis.get("recommended_choice_id", "")).strip() if isinstance(probability_analysis, dict) else ""
        if hybrid_best not in valid_ids:
            hybrid_best = next(
                (
                    str(choice.get("id")) for choice in choices
                    if isinstance(choice, dict) and choice.get("hybrid_outlook") == "Best"
                ),
                "",
            )
        deterministic_best = next(
            (
                str(choice.get("id")) for choice in choices
                if isinstance(choice, dict) and choice.get("deterministic_outlook") == "Best"
            ),
            "",
        )
        if hybrid_best in valid_ids:
            recommended = hybrid_best
        elif deterministic_best in valid_ids:
            recommended = deterministic_best
        if recommended not in valid_ids:
            recommended = str(payload.get("selected_choice_id", "")).strip()
        if recommended not in valid_ids:
            recommended = sorted(valid_ids)[0]
        choice_by_id = {
            str(choice["id"]): choice for choice in choices
            if isinstance(choice, dict) and str(choice.get("id", "")) in valid_ids
        }
        selected_id = str(payload.get("selected_choice_id", "")).strip()
        comparison_id = selected_id if selected_id in valid_ids and selected_id != recommended else str(response.get("comparison_choice_id", "")).strip()
        if comparison_id not in valid_ids or comparison_id == recommended:
            comparison_id = str(payload.get("selected_choice_id", "")).strip()
        if comparison_id not in valid_ids or comparison_id == recommended:
            comparison_id = next((choice_id for choice_id in valid_ids if choice_id != recommended), "")
        selected = choice_by_id.get(recommended, {})
        comparison = choice_by_id.get(comparison_id, {})
        title = str(selected.get("title") or recommended).strip()
        club = str(selected.get("club") or "Club").strip()
        power = selected.get("power_percent")
        swing_type = str(selected.get("swing_type") or "planned").replace("_", " ")
        risk = selected.get("modeled_risk")
        outlook = str(selected.get("hybrid_outlook") or selected.get("deterministic_outlook") or "").strip()
        outlook_label = {
            "Best": "simulation-backed recommendation" if selected.get("hybrid_outlook") else "calculated recommendation",
            "Competitive": "close alternative",
            "Higher risk": "higher-risk alternative",
        }.get(outlook, "calculated option")
        advice = (
            f"Prefer {title}: {club} with a {_swing_label(power, club)} is a {swing_type} shot. "
            f"Risk index: {risk}/100. This is the {outlook_label}."
        )
        probability = selected.get("probability_analysis")
        if isinstance(probability, dict):
            advice += (
                f" Across {probability.get('sample_count')} paired simulations, "
                f"{probability.get('target_percent')}% reached the target area, "
                f"{probability.get('playable_percent')}% stayed playable, and "
                f"{probability.get('penalty_percent')}% required a penalty."
            )
        clearance = selected.get("hazard_clearance_yards")
        hazard = str(selected.get("nearest_hazard") or "").replace("_", " ")
        if clearance is not None and hazard:
            unit = "yard" if clearance == 1 else "yards"
            advice += f" Its expected finish is {clearance} {unit} from the nearest mapped {hazard}."
        library_guidance = guidance_text(selected.get("advice_keys"))
        tradeoff = ""
        if comparison:
            comparison_title = str(comparison.get("title") or comparison_id).strip()
            comparison_outlook = str(comparison.get("hybrid_outlook") or comparison.get("deterministic_outlook") or "").strip()
            comparison_label = {
                "Best": "simulation-backed recommendation" if comparison.get("hybrid_outlook") else "calculated recommendation",
                "Competitive": "close alternative",
                "Higher risk": "higher-risk alternative",
            }.get(comparison_outlook, "calculated option")
            tradeoff = (
                f"Compare {comparison_title}: {comparison.get('club')} at {comparison.get('power_percent')}%, "
                f"risk index {comparison.get('modeled_risk')}/100 and the {comparison_label}, leaving {comparison.get('leaves_yards')} yards "
                f"on {str(comparison.get('finish_surface') or 'the mapped surface').replace('_', ' ')}."
            )
            comparison_probability = comparison.get("probability_analysis")
            if isinstance(comparison_probability, dict):
                tradeoff += (
                    f" Its paired outcomes reached the target {comparison_probability.get('target_percent')}% of the time, "
                    f"stayed playable {comparison_probability.get('playable_percent')}%, and drew a penalty "
                    f"{comparison_probability.get('penalty_percent')}%."
                )
        return {
            "provider": self.provider.name,
            "model": self.provider.model,
            "recommended_choice_id": recommended,
            "assessment": "agree" if recommended == selected_id else "challenge",
            "reason": str(response.get("reason", "better_outlook")).strip(),
            "advice": advice,
            "tradeoff": tradeoff,
            "library_guidance": library_guidance,
        }

    def explain_competition_decision(self, payload: dict) -> dict:
        if self.provider is None:
            raise AiProviderError(self.disabled_reason)
        selected = payload.get("selected") if isinstance(payload, dict) else None
        if not isinstance(selected, dict) or not selected.get("club"):
            raise AiProviderError("locked strategist decision is missing")
        response = self.provider.generate_json(
            build_competition_decision_prompt(payload), COMPETITION_DECISION_RESPONSE_SCHEMA
        )
        reason = str(response.get("reason", "")).strip()
        headline = str(response.get("headline", "")).strip()
        if not reason or not headline:
            raise AiProviderError("competition explanation is incomplete")
        return {
            "provider": self.provider.name,
            "model": self.provider.model,
            "headline": headline,
            "reason": reason,
            "concept": str(response.get("concept", "course management")).strip(),
            "confidence": str(response.get("confidence", "medium")).strip(),
        }


def create_ai_service() -> AiService:
    provider_name = os.getenv("AI_PROVIDER", DEFAULT_AI_PROVIDER).strip().lower()
    if provider_name in {"", "ollama"}:
        model = os.getenv("OLLAMA_MODEL", DEFAULT_OLLAMA_MODEL).strip() or DEFAULT_OLLAMA_MODEL
        host = os.getenv("OLLAMA_HOST", DEFAULT_OLLAMA_HOST).strip() or DEFAULT_OLLAMA_HOST
        if "://" not in host:
            host = f"http://{host}"
        timeout = int(
            os.getenv("OLLAMA_TIMEOUT_SECONDS", str(DEFAULT_OLLAMA_TIMEOUT_SECONDS))
        )
        context_tokens = int(
            os.getenv("OLLAMA_NUM_CTX", str(DEFAULT_OLLAMA_CONTEXT_TOKENS))
        )
        temperature = float(
            os.getenv("OLLAMA_TEMPERATURE", str(DEFAULT_OLLAMA_TEMPERATURE))
        )
        return AiService(
            provider=OllamaProvider(
                model=model,
                host=host,
                timeout_seconds=timeout,
                context_tokens=context_tokens,
                temperature=temperature,
            )
        )
    if provider_name in {"off", "none", "disabled"}:
        return AiService(provider=None, disabled_reason="AI_PROVIDER is disabled")
    if provider_name != "gemini":
        return AiService(
            provider=None,
            disabled_reason=f"unsupported AI_PROVIDER: {provider_name}",
        )
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        return AiService(provider=None, disabled_reason="missing GEMINI_API_KEY")
    model = os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL
    timeout = int(os.getenv("GEMINI_TIMEOUT_SECONDS", str(DEFAULT_GEMINI_TIMEOUT_SECONDS)))
    local_fallback = None
    if os.getenv("AI_LOCAL_FALLBACK", "on").strip().lower() not in {"0", "off", "false", "no"}:
        fallback_host = os.getenv("OLLAMA_HOST", DEFAULT_OLLAMA_HOST).strip() or DEFAULT_OLLAMA_HOST
        if "://" not in fallback_host:
            fallback_host = f"http://{fallback_host}"
        local_fallback = OllamaProvider(
            model=os.getenv("OLLAMA_MODEL", DEFAULT_OLLAMA_MODEL).strip() or DEFAULT_OLLAMA_MODEL,
            host=fallback_host,
            timeout_seconds=int(os.getenv("OLLAMA_TIMEOUT_SECONDS", str(DEFAULT_OLLAMA_TIMEOUT_SECONDS))),
            context_tokens=int(os.getenv("OLLAMA_NUM_CTX", str(DEFAULT_OLLAMA_CONTEXT_TOKENS))),
            temperature=float(os.getenv("OLLAMA_TEMPERATURE", str(DEFAULT_OLLAMA_TEMPERATURE))),
        )
    return AiService(
        provider=GeminiProvider(api_key=api_key, model=model, timeout_seconds=timeout),
        fallback_provider=local_fallback,
    )
