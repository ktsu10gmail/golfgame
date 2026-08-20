"""Read the approved player guidance directly from the documentation source."""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path


ADVICE_LIBRARY_PATH = Path(__file__).resolve().parents[2] / "docs" / "STANDARD_ADVICE_LIBRARY.md"
DOCS_PATH = ADVICE_LIBRARY_PATH.parent
SHORT_PHRASES_HEADING = "## AI Approved Short Phrases"
ASSEMBLY_RULES_HEADING = "## AI Assembly Rules"
PHRASE_PATTERN = re.compile(r"^- `([a-z0-9_]+)`: `([^`]+)`$", re.MULTILINE)


def _markdown_section(path: Path, start_heading: str, end_heading: str) -> str:
    text = path.read_text(encoding="utf-8")
    try:
        start = text.index(start_heading) + len(start_heading)
        end = text.index(end_heading, start)
    except ValueError as error:
        raise RuntimeError(f"prompt guidance headings are missing in {path.name}") from error
    return text[start:end].strip()


@lru_cache(maxsize=1)
def approved_short_phrases() -> dict[str, str]:
    text = ADVICE_LIBRARY_PATH.read_text(encoding="utf-8")
    try:
        start = text.index(SHORT_PHRASES_HEADING)
        end = text.index(ASSEMBLY_RULES_HEADING, start)
    except ValueError as error:
        raise RuntimeError("standard advice library headings are missing") from error
    phrases = dict(PHRASE_PATTERN.findall(text[start:end]))
    if not phrases:
        raise RuntimeError("standard advice library contains no approved short phrases")
    return phrases


def guidance_for_keys(keys: object, *, limit: int = 4) -> list[dict[str, str]]:
    if not isinstance(keys, (list, tuple)):
        return []
    phrases = approved_short_phrases()
    guidance: list[dict[str, str]] = []
    seen: set[str] = set()
    for raw_key in keys:
        key = str(raw_key)
        if key in seen or key not in phrases:
            continue
        guidance.append({"key": key, "phrase": phrases[key]})
        seen.add(key)
        if len(guidance) >= limit:
            break
    return guidance


def guidance_text(keys: object, *, limit: int = 4) -> str:
    return " ".join(item["phrase"] for item in guidance_for_keys(keys, limit=limit))


@lru_cache(maxsize=1)
def round_review_prompt_guidance() -> list[dict[str, str]]:
    """Load the bounded review rules from the prompt-ready Markdown sources."""
    return [
        {
            "source": "STANDARD_ADVICE_LIBRARY.md",
            "guidance": _markdown_section(ADVICE_LIBRARY_PATH, "### AI Rules", "### AI Output Shape"),
        },
        {
            "source": "COURSE_MANAGEMENT_ANALYSIS.md",
            "guidance": _markdown_section(
                DOCS_PATH / "COURSE_MANAGEMENT_ANALYSIS.md",
                "## How AI Should Be Used",
                "## Production Design Principle",
            ),
        },
        {
            "source": "DECISION_SCORING_SPEC.md",
            "guidance": _markdown_section(
                DOCS_PATH / "DECISION_SCORING_SPEC.md",
                "## Decision Versus Outcome Interpretation",
                "## Hole Score Aggregation",
            ),
        },
    ]
