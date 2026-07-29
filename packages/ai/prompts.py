"""Prompt builders for AI narration and review."""

from __future__ import annotations

import json


SHOT_RESPONSE_SCHEMA = {
    "summary": "One or two short sentences explaining what happened.",
    "decision_assessment": "sound or review",
    "execution_assessment": "on_plan or missed",
    "next_play": "One short sentence describing the smartest next action.",
}

ROUND_RESPONSE_SCHEMA = {
    "verdict": "Two or three short sentences summarizing the round.",
    "strength": "One short phrase naming the strongest pattern.",
    "priority": "One short phrase naming the practice priority.",
}


def _dump(payload: object) -> str:
    return json.dumps(payload, indent=2, sort_keys=True)


def build_shot_prompt(payload: dict) -> str:
    return (
        "You are the Game Master for a deterministic golf strategy game.\n"
        "Use only the supplied authoritative facts. Do not invent distances, lies, penalties, or outcomes.\n"
        "Return strict JSON with this schema:\n"
        f"{_dump(SHOT_RESPONSE_SCHEMA)}\n\n"
        "Decision assessment means whether the strategic choice was sound.\n"
        "Execution assessment means whether the shot outcome matched the intended plan.\n"
        "Keep the tone concise, clear, and practical.\n\n"
        "Authoritative shot context:\n"
        f"{_dump(payload)}\n"
    )


def build_round_prompt(payload: dict) -> str:
    return (
        "You are the Game Master for a deterministic golf strategy game.\n"
        "Use only the supplied authoritative round facts. Do not invent scores, misses, or coaching points.\n"
        "Return strict JSON with this schema:\n"
        f"{_dump(ROUND_RESPONSE_SCHEMA)}\n\n"
        "Keep the verdict concise and actionable.\n\n"
        "Authoritative round context:\n"
        f"{_dump(payload)}\n"
    )
