"""Explicit download policy shared by the App and Mapper HTTP servers."""

from pathlib import Path
import re
from urllib.parse import unquote, urlsplit


PUBLIC_FILES = frozenset("""
index.html app.js styles.css editor.html editor.js editor.css
admin/index.html admin/admin.js admin/admin.css
USERGUIDE.md USERGUIDE_ZH_TW.md assets/tree-canopy-top.png
data/mapped_courses.json
packages/academy/academy_hole_rotation.mjs
packages/academy/academy_policy.mjs
packages/accounts/browser_access_guidance.mjs
packages/accounts/browser_profile_naming.mjs
packages/accounts/browser_supabase_auth.mjs
packages/assessment/browser_assessment_service.mjs
packages/audio/challenge_audio.mjs
packages/challenge/challenge_generator.mjs
packages/challenge/challenge_hole_loader.mjs
packages/challenge/challenge_state.mjs
packages/editor/course_mapper.mjs
packages/editor/game_map_preview.mjs
packages/editor/illustrated_hole_prototype.mjs
packages/editor/hazard_detection.mjs
packages/editor/map_projection.mjs
packages/editor/polygon_union.mjs
packages/editor/undo_history.mjs
packages/gps/browser_gps_mode.mjs
packages/gps/browser_gps_replay.mjs
packages/presentation/gm_conversation.mjs
packages/presentation/in_play_presentation_policy.mjs
packages/presentation/post_round_export.mjs
packages/presentation/post_round_report.mjs
packages/replay/browser_replay_loader.mjs
packages/simulation/browser_adjustment_reward.mjs
packages/simulation/browser_course_geometry.mjs
packages/simulation/browser_decision_scoring.mjs
packages/simulation/browser_engine.mjs
packages/simulation/browser_gm_feedback.mjs
packages/simulation/browser_green_caddie_read.mjs
packages/simulation/browser_green_contour.mjs
packages/simulation/browser_green_generator.mjs
packages/simulation/browser_green_relief_interaction.mjs
packages/simulation/browser_greenside.mjs
packages/simulation/browser_hole_terrain.mjs
packages/simulation/browser_multi_run_evaluator.mjs
packages/simulation/browser_putt_animation.mjs
packages/simulation/browser_putt_command.mjs
packages/simulation/browser_putting.mjs
packages/simulation/browser_round_analysis.mjs
packages/simulation/browser_short_game.mjs
packages/simulation/browser_shot_command.mjs
packages/simulation/browser_shot_type.mjs
packages/simulation/browser_sidehill.mjs
packages/simulation/browser_strategy_choices.mjs
packages/simulation/browser_strategy_worker.mjs
packages/simulation/browser_tree_conditions.mjs
packages/simulation/browser_tree_recovery.mjs
packages/simulation/competition.mjs
packages/simulation/fairway_first_cut.mjs
packages/simulation/round_save.mjs
packages/simulation/round_state.mjs
""".split())

# Newly installed courses work without exposing other data/runtime files.
COURSE_FILE = re.compile(
    r"data/[a-z0-9][a-z0-9-]{0,62}/"
    r"(?:scorecard\.csv|hole(?:[1-9]|1[0-8])\.json|"
    r"(?:images|illustrations)/hole(?:[1-9]|1[0-8])\.(?:png|jpg|jpeg|webp|svg))\Z"
)


def public_file(root: Path, request_path: str) -> Path | None:
    """Resolve only approved files; reject traversal, symlinks and listings."""
    try:
        path = unquote(urlsplit(request_path).path, errors="strict")
        if path in {"/", "/admin/"}:
            path += "index.html"
        if not path.startswith("/") or "\\" in path or "\x00" in path:
            return None
        relative = path[1:]
        if any(part in {"", ".", ".."} or part.startswith(".")
               for part in relative.split("/")):
            return None
        if relative not in PUBLIC_FILES and not COURSE_FILE.fullmatch(relative):
            return None
        base = root.resolve()
        candidate = base / relative
        # Even an allowed filename cannot point through a symlink to private data.
        if candidate.resolve() != candidate or not candidate.is_file():
            return None
        return candidate
    except (ValueError, UnicodeError, OSError, RuntimeError):
        return None
