"""Deterministic simulation package."""

from .decision_scoring import DECISION_SCORE_VERSION, score_putt_strategy, score_strategy
from .engine import (
    ENGINE_VERSION,
    PENALTY_RELIEF_VERSION,
    declare_unplayable,
    derive_shot_seed,
    resolve_penalty_relief,
    simulate_full_shot,
)
from .greenside import (
    GREENSIDE_ENGINE_VERSION,
    derive_greenside_seed,
    simulate_greenside_shot,
)
from .putting import PUTTING_ENGINE_VERSION, derive_putt_seed, simulate_putt
from .round_analysis import (
    ROUND_STRATEGY_VERSION,
    analysis_shot_from_packet,
    analyze_round_strategy,
)
from .sidehill import SIDEHILL_MODEL_VERSION, SidehillPlan, analyze_sidehill_shot

__all__ = [
    "ENGINE_VERSION",
    "GREENSIDE_ENGINE_VERSION",
    "PENALTY_RELIEF_VERSION",
    "PUTTING_ENGINE_VERSION",
    "ROUND_STRATEGY_VERSION",
    "SIDEHILL_MODEL_VERSION",
    "SidehillPlan",
    "analysis_shot_from_packet",
    "analyze_round_strategy",
    "analyze_sidehill_shot",
    "declare_unplayable",
    "DECISION_SCORE_VERSION",
    "derive_putt_seed",
    "derive_greenside_seed",
    "derive_shot_seed",
    "resolve_penalty_relief",
    "score_strategy",
    "score_putt_strategy",
    "simulate_full_shot",
    "simulate_greenside_shot",
    "simulate_putt",
]
