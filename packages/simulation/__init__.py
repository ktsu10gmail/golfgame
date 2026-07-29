"""Deterministic simulation package."""

from .decision_scoring import DECISION_SCORE_VERSION, score_strategy
from .engine import (
    ENGINE_VERSION,
    PENALTY_RELIEF_VERSION,
    declare_unplayable,
    derive_shot_seed,
    resolve_penalty_relief,
    simulate_full_shot,
)
from .putting import PUTTING_ENGINE_VERSION, derive_putt_seed, simulate_putt

__all__ = [
    "ENGINE_VERSION",
    "PENALTY_RELIEF_VERSION",
    "PUTTING_ENGINE_VERSION",
    "declare_unplayable",
    "DECISION_SCORE_VERSION",
    "derive_putt_seed",
    "derive_shot_seed",
    "resolve_penalty_relief",
    "score_strategy",
    "simulate_full_shot",
    "simulate_putt",
]
