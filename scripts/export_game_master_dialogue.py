#!/usr/bin/env python3
"""Export privacy-safe Game Master text and saved player shot context."""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATABASE = ROOT / "data" / "player_accounts.sqlite3"
DEFAULT_OUTPUT = ROOT / "output" / "game_master_responses_and_player_inputs.txt"


def clean(value: Any, fallback: str = "Not recorded") -> str:
    if value is None or value == "":
        return fallback
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, float):
        return f"{value:.2f}".rstrip("0").rstrip(".")
    return " ".join(str(value).split())


def point_free_lie(fix: Any) -> str:
    return clean(fix.get("lie")) if isinstance(fix, dict) else "Not recorded"


def putt_leave(yards: Any) -> str:
    try:
        feet = max(0.0, float(yards) * 3)
    except (TypeError, ValueError):
        return "Not recorded"
    if feet < 1:
        inches = max(0, round(feet * 12))
        return f"{inches} {'inch' if inches == 1 else 'inches'}"
    rounded = round(feet, 1)
    amount = int(rounded) if rounded.is_integer() else rounded
    return f"{amount} {'foot' if rounded == 1 else 'feet'}"


def event_shots(round_document: dict[str, Any]) -> Iterable[tuple[int, int, dict[str, Any]]]:
    for hole_index, hole in enumerate(round_document.get("round_state", {}).get("holes", []), 1):
        shot_number = 0
        for event in hole.get("events", []):
            shot = event.get("payload", {}).get("shot") if isinstance(event, dict) else None
            if not isinstance(shot, dict):
                continue
            shot_number += 1
            yield hole_index, shot_number, shot


def direct_game_master_templates(source: str) -> list[str]:
    """Find direct string/template arguments supplied to addGmMessage."""
    matches = re.findall(
        r"addGmMessage\(\s*(?P<quote>[`\"'])(?P<body>(?:\\.|(?!\1).)*?)(?P=quote)",
        source,
        flags=re.DOTALL,
    )
    messages = []
    for _, body in matches:
        normalized = " ".join(body.replace("\n", " ").split())
        # Nested template literals inside ${...} cannot be captured safely by
        # the lightweight pattern above. Exclude those truncated fragments and
        # append their complete source forms explicitly below.
        if normalized and not normalized.endswith("?") and normalized not in messages:
            messages.append(normalized)
    nested_templates = [
        "${structuredInstruction} Target line: ${targetDistanceLabel} from the ball.${note ? ` Note: ${note}` : \"\"}",
        "Confirmed: ${currentClub().name} · ${finePaceControl() ? `${Math.round(state.swingPower * 100)}% pace` : swingLengthLabel(state.swingPower)} · ${aimName} · ${adjustment}.",
        "${currentClub().name} selected at ${finePaceControl() ? `${Math.round(state.swingPower * 100)}% pace` : swingLengthLabel(state.swingPower)}.",
    ]
    for message in nested_templates:
        if message not in messages:
            messages.append(message)
    return messages


def write_simulator_shot(lines: list[str], shot: dict[str, Any]) -> None:
    intent = shot.get("playerIntent") if isinstance(shot.get("playerIntent"), dict) else {}
    instructions = intent.get("instructions") if isinstance(intent.get("instructions"), list) else []
    strategy = shot.get("strategyChoice") if isinstance(shot.get("strategyChoice"), dict) else {}
    conditions = shot.get("conditionSnapshot") if isinstance(shot.get("conditionSnapshot"), dict) else {}
    packet = shot.get("strategyPacket") if isinstance(shot.get("strategyPacket"), dict) else {}
    decision = packet.get("decision") if isinstance(packet.get("decision"), dict) else {}
    reasons = decision.get("reasons") if isinstance(decision.get("reasons"), list) else []
    putt_packet = shot.get("puttPacket") if isinstance(shot.get("puttPacket"), dict) else {}
    is_putt = clean(intent.get("selected_club") or shot.get("club")) == "Putter"
    remaining_copy = putt_leave(putt_packet.get("remaining_distance_yards")) if is_putt and putt_packet else f"{clean(shot.get('remaining'))} yards"

    lines.extend([
        f"  Starting lie: {clean(conditions.get('lie') or shot.get('lie'))}",
        f"  Player club: {clean(intent.get('selected_club') or shot.get('club'))}",
        f"  Player power: {clean(intent.get('power_percent') or shot.get('power'))}%",
        f"  Player original instructions: {clean(' | '.join(clean(item) for item in instructions))}",
        f"  Player original note: {clean(intent.get('note'))}",
        f"  Player caddie selection: {clean(strategy.get('title') or strategy.get('id'))}",
        f"  Selected target label: {clean(strategy.get('target_label'))}",
        f"  Intended finish lie: {clean(shot.get('intendedLie'))}",
        "  --- Game Master / review evidence ---",
        "  Historical chat status: Exact on-screen Game Master bubbles were not persisted.",
        f"  Stored deterministic review text: {clean(shot.get('lesson'))}",
        f"  Decision grade: {clean(decision.get('label'))} ({clean(decision.get('score'))}/100)",
        f"  Decision reasons: {clean(' | '.join(clean(item) for item in reasons))}",
        f"  Recorded result lie: {clean(shot.get('landingLie') or shot.get('lie'))}",
        f"  Remaining distance: {remaining_copy}",
        f"  Penalty strokes: {clean(shot.get('penalty'), '0')}",
        "",
    ])


def write_gps_shot(lines: list[str], shot: dict[str, Any]) -> None:
    strategy = shot.get("strategy") if isinstance(shot.get("strategy"), dict) else {}
    considered = strategy.get("considered_strategy") if isinstance(strategy.get("considered_strategy"), dict) else {}
    evidence = strategy.get("decision_evidence") if isinstance(strategy.get("decision_evidence"), dict) else {}
    candidates = evidence.get("candidates") if isinstance(evidence.get("candidates"), list) else []
    selected_id = evidence.get("selected_choice_id") or strategy.get("id")
    selected = next((item for item in candidates if isinstance(item, dict) and item.get("id") == selected_id), {})
    analysis = selected.get("analysis") if isinstance(selected.get("analysis"), dict) else {}

    lines.extend([
        f"  Starting lie: {point_free_lie(shot.get('start'))}",
        f"  Player club: {clean(strategy.get('club_name') or strategy.get('title'))}",
        f"  Player power: {clean(strategy.get('power'))}%",
        "  Player original instructions: Not recorded in GPS Mode",
        "  Player original note: Not recorded in GPS Mode",
        f"  Player caddie selection: {clean(strategy.get('title') or strategy.get('id'))}",
        f"  Selected target label: {clean(strategy.get('target_label'))}",
        f"  Considered strategy: {clean(considered.get('title') or considered.get('id'))}",
        "  --- Game Master / review evidence ---",
        "  Historical chat status: GPS Mode did not persist an exact Game Master conversation.",
        f"  Saved decision outlook: {clean(analysis.get('hybrid_outlook') or strategy.get('hybrid_outlook'))}",
        f"  Saved probability score: {clean(analysis.get('probability_score') or strategy.get('probability_score'))}",
        f"  Recorded result lie: {point_free_lie(shot.get('end'))}",
        f"  Recorded shot distance: {clean(shot.get('distance_yards'))} yards",
        "  GPS coordinates: Redacted",
        "",
    ])


def export(database_path: Path, output_path: Path) -> Counter[str]:
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    player_ids = [row[0] for row in connection.execute(
        "SELECT DISTINCT player_id FROM completed_rounds "
        "UNION SELECT DISTINCT player_id FROM player_rounds "
        "UNION SELECT DISTINCT player_id FROM gps_rounds ORDER BY player_id"
    )]
    player_labels = {player_id: f"P{index:03d}" for index, player_id in enumerate(player_ids, 1)}
    counts: Counter[str] = Counter()
    lines = [
        "GAME MASTER RESPONSES AND PLAYER INPUTS",
        "=" * 40,
        f"Generated: {datetime.now(timezone.utc).isoformat()}",
        "",
        "PRIVACY",
        "-------",
        "Player names, emails, authentication data, and GPS coordinates are excluded.",
        "Players are represented by temporary labels such as P001.",
        "",
        "IMPORTANT LIMITATION",
        "--------------------",
        "The browser's exact Game Master conversation array was temporary and was not saved",
        "inside historical rounds. AI-generated narration was also not archived. Therefore:",
        "- Built-in direct response templates are exported below exactly as source templates.",
        "- Saved player instructions, notes, club choices, and caddie choices are included.",
        "- Stored deterministic review text and result evidence are paired with each shot.",
        "- Reconstructed evidence is not labeled as an exact historical Game Master quote.",
        "- Historical review text is preserved as recorded and may contain wording fixed in newer versions.",
        "",
        "PART 1 — BUILT-IN GAME MASTER RESPONSE TEMPLATES",
        "=" * 48,
        "Placeholders inside ${...} are filled from the current shot at runtime.",
        "Condition briefings, tree explanations, shot results, and AI narration are dynamic",
        "and can produce additional wording beyond these direct templates.",
        "",
    ]

    app_source = (ROOT / "app.js").read_text(encoding="utf-8")
    templates = direct_game_master_templates(app_source)
    for index, message in enumerate(templates, 1):
        lines.append(f"GM TEMPLATE {index:03d}: {message}")
    counts["templates"] = len(templates)

    lines.extend(["", "PART 2 — SAVED SIMULATOR PLAYER INPUTS AND EVIDENCE", "=" * 56, ""])
    simulator_rows = list(connection.execute(
        "SELECT player_id, course_id, completed_at AS recorded_at, round_json, 'completed' AS source "
        "FROM completed_rounds "
        "UNION ALL "
        "SELECT player_id, course_id, updated_at AS recorded_at, round_json, 'active' AS source "
        "FROM player_rounds WHERE is_complete = 0 "
        "ORDER BY player_id, recorded_at"
    ))
    for round_index, row in enumerate(simulator_rows, 1):
        document = json.loads(row["round_json"])
        shots = list(event_shots(document))
        if not shots:
            continue
        counts["simulator_rounds"] += 1
        lines.extend([
            f"SIMULATOR ROUND {round_index:03d}",
            f"Player: {player_labels[row['player_id']]}",
            f"Course: {clean(row['course_id'])}",
            f"Recorded: {clean(row['recorded_at'])}",
            f"Round state: {clean(row['source'])}",
            "-" * 40,
        ])
        for hole_number, shot_number, shot in shots:
            counts["simulator_shots"] += 1
            lines.append(f"Hole {hole_number} · Shot {shot_number}")
            write_simulator_shot(lines, shot)

    lines.extend(["", "PART 3 — SAVED GPS PLAYER SELECTIONS AND EVIDENCE", "=" * 51, ""])
    gps_rows = connection.execute(
        "SELECT player_id, course_id, started_at, round_id, round_json FROM gps_rounds "
        "ORDER BY player_id, started_at"
    )
    for round_index, row in enumerate(gps_rows, 1):
        document = json.loads(row["round_json"])
        shots = [
            (hole_index, shot_index, shot)
            for hole_index, hole in enumerate(document.get("holes", []), 1)
            for shot_index, shot in enumerate(hole.get("shots", []), 1)
            if isinstance(shot, dict)
        ]
        if not shots:
            continue
        counts["gps_rounds"] += 1
        lines.extend([
            f"GPS ROUND {round_index:03d}",
            f"Player: {player_labels[row['player_id']]}",
            f"Course: {clean(row['course_id'])}",
            f"Started: {clean(row['started_at'])}",
            "GPS round ID: Redacted",
            "-" * 40,
        ])
        for hole_number, shot_number, shot in shots:
            counts["gps_shots"] += 1
            lines.append(f"Hole {hole_number} · Shot {shot_number}")
            write_gps_shot(lines, shot)

    lines.extend([
        "EXPORT SUMMARY",
        "=" * 40,
        f"Built-in direct GM templates: {counts['templates']}",
        f"Simulator rounds with shots: {counts['simulator_rounds']}",
        f"Simulator shots: {counts['simulator_shots']}",
        f"GPS rounds with shots: {counts['gps_rounds']}",
        f"GPS shots: {counts['gps_shots']}",
        "",
    ])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines), encoding="utf-8")
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    counts = export(args.database.resolve(), args.output.resolve())
    print(f"Exported {counts['templates']} direct templates, {counts['simulator_shots']} simulator shots, "
          f"and {counts['gps_shots']} GPS shots to {args.output.resolve()}")


if __name__ == "__main__":
    main()
