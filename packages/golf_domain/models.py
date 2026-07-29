"""Immutable contracts for the Phase 2 full-shot engine.

Coordinates and distances are expressed in yards. Positive lateral values are
right of the intended target line when looking from the ball toward the target.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from .enums import (
    DecisionConfidence,
    DecisionLabel,
    DecisionReason,
    Dexterity,
    ExecutionLabel,
    LieType,
    PenaltyReason,
    PreferredMiss,
    ReliefType,
    ShotQuality,
    StrategicShotType,
    SurfaceType,
)


DEFAULT_QUALITY_WEIGHTS: tuple[tuple[ShotQuality, float], ...] = (
    (ShotQuality.SLIGHT_MISHIT, 0.35),
    (ShotQuality.FAT, 0.25),
    (ShotQuality.THIN, 0.22),
    (ShotQuality.TOPPED, 0.08),
    (ShotQuality.HEEL, 0.05),
    (ShotQuality.TOE, 0.04),
    (ShotQuality.SHANK, 0.01),
)


@dataclass(frozen=True, slots=True)
class Vec2:
    x: float
    y: float

    def distance_to(self, other: Vec2) -> float:
        return math.hypot(other.x - self.x, other.y - self.y)


@dataclass(frozen=True, slots=True)
class ClubStat:
    club_id: str
    carry_mean: float
    carry_sd: float
    roll_mean: float
    lateral_sd: float
    directional_bias: float
    mishit_probability: float
    quality_weights: tuple[tuple[ShotQuality, float], ...] = DEFAULT_QUALITY_WEIGHTS

    def __post_init__(self) -> None:
        if not self.club_id:
            raise ValueError("club_id is required")
        if self.carry_mean <= 0:
            raise ValueError("carry_mean must be positive")
        if min(self.carry_sd, self.roll_mean, self.lateral_sd) < 0:
            raise ValueError("distance and dispersion values cannot be negative")
        if not 0 <= self.mishit_probability <= 1:
            raise ValueError("mishit_probability must be between 0 and 1")
        if not self.quality_weights or sum(weight for _, weight in self.quality_weights) <= 0:
            raise ValueError("quality_weights must have a positive total")
        if any(weight < 0 for _, weight in self.quality_weights):
            raise ValueError("quality weights cannot be negative")


@dataclass(frozen=True, slots=True)
class LieModifier:
    lie_type: LieType
    carry_multiplier: float = 1.0
    roll_multiplier: float = 1.0
    mishit_multiplier: float = 1.0
    lateral_bias_yards: float = 0.0
    version: str = "unversioned"

    def __post_init__(self) -> None:
        if self.carry_multiplier < 0 or self.roll_multiplier < 0:
            raise ValueError("lie distance multipliers cannot be negative")
        if self.mishit_multiplier <= 0:
            raise ValueError("lie mishit_multiplier must be positive")


@dataclass(frozen=True, slots=True)
class EnvironmentModifiers:
    wind_forward_yards: float = 0.0
    wind_lateral_yards: float = 0.0
    wind_roll_multiplier: float = 1.0
    elevation_carry_multiplier: float = 1.0
    slope_mishit_multiplier: float = 1.0
    surface_roll_multiplier: float = 1.0

    def __post_init__(self) -> None:
        if min(
            self.wind_roll_multiplier,
            self.elevation_carry_multiplier,
            self.slope_mishit_multiplier,
            self.surface_roll_multiplier,
        ) <= 0:
            raise ValueError("environment multipliers must be positive")


@dataclass(frozen=True, slots=True)
class ShotIntent:
    distance_multiplier: float = 1.0
    complexity_multiplier: float = 1.0
    label: str = "stock"

    def __post_init__(self) -> None:
        if not 0.1 <= self.distance_multiplier <= 1.5:
            raise ValueError("distance_multiplier is outside the supported range")
        if not 0.5 <= self.complexity_multiplier <= 3.0:
            raise ValueError("complexity_multiplier is outside the supported range")


@dataclass(frozen=True, slots=True)
class SurfaceRegion:
    surface: SurfaceType
    polygon: tuple[Vec2, ...]
    priority: int = 0
    region_id: str | None = None

    def __post_init__(self) -> None:
        if len(self.polygon) < 3:
            raise ValueError("surface polygon requires at least three points")


@dataclass(frozen=True, slots=True)
class ShotContext:
    start: Vec2
    target: Vec2
    pin: Vec2
    club: ClubStat
    lie: LieModifier
    dexterity: Dexterity = Dexterity.RIGHT
    environment: EnvironmentModifiers = field(default_factory=EnvironmentModifiers)
    intent: ShotIntent = field(default_factory=ShotIntent)
    surfaces: tuple[SurfaceRegion, ...] = ()
    default_surface: SurfaceType = SurfaceType.ROUGH
    profile_version: str = "unversioned"

    def __post_init__(self) -> None:
        if self.start.distance_to(self.target) <= 1e-9:
            raise ValueError("start and target cannot be identical")


@dataclass(frozen=True, slots=True)
class AuditModifier:
    name: str
    value: float


@dataclass(frozen=True, slots=True)
class ShotAudit:
    engine_version: str
    round_seed: int
    shot_seed: int
    hole_number: int
    stroke_index: int
    profile_version: str
    lie_version: str
    sampled_carry_yards: float
    sampled_lateral_yards: float
    mishit_probability: float
    modifiers: tuple[AuditModifier, ...]


@dataclass(frozen=True, slots=True)
class ResultAssessment:
    decision_assessment: str
    execution_assessment: str
    overall_assessment: str
    decision_risk: int | None = None
    risk_label: str | None = None


@dataclass(frozen=True, slots=True)
class PenaltyRelief:
    version: str
    reason: PenaltyReason
    penalty_strokes: int
    relief_type: ReliefType
    reference_point: Vec2
    ball_position: Vec2
    resulting_surface: SurfaceType
    resulting_region_id: str | None

    def __post_init__(self) -> None:
        if self.penalty_strokes < 1:
            raise ValueError("penalty relief requires at least one penalty stroke")


@dataclass(frozen=True, slots=True)
class ShotResultPacket:
    quality: ShotQuality
    carry_yards: float
    roll_yards: float
    total_yards: float
    lateral_yards: float
    landing: Vec2
    path: tuple[Vec2, ...]
    landing_surface: SurfaceType
    landing_region_id: str | None
    remaining_distance_yards: float
    assessment: ResultAssessment
    audit: ShotAudit
    relief: PenaltyRelief | None = None


@dataclass(frozen=True, slots=True)
class DecisionSubscores:
    target_selection: int
    club_selection: int
    lie_management: int
    hazard_management: int
    recovery_discipline: int
    miss_planning: int

    def __post_init__(self) -> None:
        for value in (
            self.target_selection,
            self.club_selection,
            self.lie_management,
            self.hazard_management,
            self.recovery_discipline,
            self.miss_planning,
        ):
            if not 0 <= value <= 100:
                raise ValueError("decision subscore values must be between 0 and 100")


@dataclass(frozen=True, slots=True)
class DecisionEvaluation:
    score: int
    label: DecisionLabel
    confidence: DecisionConfidence
    subscores: DecisionSubscores
    reasons: tuple[DecisionReason, ...]
    advice_keys: tuple[str, ...]

    def __post_init__(self) -> None:
        if not 0 <= self.score <= 100:
            raise ValueError("decision score must be between 0 and 100")


@dataclass(frozen=True, slots=True)
class ExecutionEvaluation:
    score: int
    label: ExecutionLabel
    plan_match: str
    reasons: tuple[str, ...]

    def __post_init__(self) -> None:
        if not 0 <= self.score <= 100:
            raise ValueError("execution score must be between 0 and 100")
        if not self.plan_match:
            raise ValueError("plan_match is required")


@dataclass(frozen=True, slots=True)
class StrategyContext:
    hole_number: int
    stroke_number: int
    distance_to_target_yards: float
    lie_type: LieType
    shot_type: StrategicShotType
    selected_club: ClubStat
    target_aggression: float = 0.0
    hazard_count: int = 0
    water_in_play: bool = False
    out_of_bounds_in_play: bool = False
    forced_carry_yards: float = 0.0
    pin_risk_level: int = 0
    recovery_required: bool = False
    preferred_miss: PreferredMiss = PreferredMiss.NONE_DECLARED
    strategy_notes: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not 1 <= self.hole_number <= 18:
            raise ValueError("hole_number must be between 1 and 18")
        if self.stroke_number < 1:
            raise ValueError("stroke_number must be positive")
        if self.distance_to_target_yards <= 0:
            raise ValueError("distance_to_target_yards must be positive")
        if not 0 <= self.target_aggression <= 1:
            raise ValueError("target_aggression must be between 0 and 1")
        if self.hazard_count < 0:
            raise ValueError("hazard_count cannot be negative")
        if self.forced_carry_yards < 0:
            raise ValueError("forced_carry_yards cannot be negative")
        if not 0 <= self.pin_risk_level <= 2:
            raise ValueError("pin_risk_level must be between 0 and 2")


@dataclass(frozen=True, slots=True)
class StrategyScorePacket:
    version: str
    shot_id: str
    shot_type: StrategicShotType
    preferred_miss: PreferredMiss
    preferred_miss_inferred: bool
    decision: DecisionEvaluation | PuttDecisionEvaluation
    execution: ExecutionEvaluation | None = None


@dataclass(frozen=True, slots=True)
class PuttDecisionSubscores:
    line_plan: int
    pace_plan: int
    three_putt_avoidance: int

    def __post_init__(self) -> None:
        for value in (self.line_plan, self.pace_plan, self.three_putt_avoidance):
            if not 0 <= value <= 100:
                raise ValueError("putting decision subscore values must be between 0 and 100")


@dataclass(frozen=True, slots=True)
class PuttDecisionEvaluation:
    score: int
    label: DecisionLabel
    confidence: DecisionConfidence
    subscores: PuttDecisionSubscores
    reasons: tuple[str, ...]
    advice_keys: tuple[str, ...]

    def __post_init__(self) -> None:
        if not 0 <= self.score <= 100:
            raise ValueError("putting decision score must be between 0 and 100")


@dataclass(frozen=True, slots=True)
class StrategyAnalysisShot:
    shot_id: str
    hole_number: int
    stroke_number: int
    shot_type: StrategicShotType
    decision_score: int
    decision_subscores: DecisionSubscores | None
    putting_read_discipline: int | None
    reasons: tuple[str, ...]
    advice_keys: tuple[str, ...]
    execution_score: int | None = None

    def __post_init__(self) -> None:
        if not self.shot_id:
            raise ValueError("shot_id is required")
        if not 1 <= self.hole_number <= 18:
            raise ValueError("hole_number must be between 1 and 18")
        if self.stroke_number < 1:
            raise ValueError("stroke_number must be positive")
        if not 0 <= self.decision_score <= 100:
            raise ValueError("decision_score must be between 0 and 100")
        if self.putting_read_discipline is not None and not 0 <= self.putting_read_discipline <= 100:
            raise ValueError("putting_read_discipline must be between 0 and 100")
        if self.execution_score is not None and not 0 <= self.execution_score <= 100:
            raise ValueError("execution_score must be between 0 and 100")


@dataclass(frozen=True, slots=True)
class DecisionMoment:
    shot_id: str
    hole_number: int
    stroke_number: int
    shot_type: StrategicShotType
    score: int
    reasons: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class StrategyPattern:
    key: str
    count: int
    high_cost_count: int
    summary: str

    def __post_init__(self) -> None:
        if not self.key or not self.summary:
            raise ValueError("strategy pattern key and summary are required")
        if self.count < 1 or self.high_cost_count < 0:
            raise ValueError("strategy pattern counts are invalid")


@dataclass(frozen=True, slots=True)
class HoleStrategyAnalysis:
    hole_number: int
    strategy_score: int
    scored_shots: int
    key_decision_moment: DecisionMoment
    pattern_summary: str


@dataclass(frozen=True, slots=True)
class RoundStrategySubscores:
    target_selection: int | None
    club_selection: int | None
    lie_management: int | None
    hazard_management: int | None
    recovery_discipline: int | None
    miss_planning: int | None
    putting_read_discipline: int | None

    def __post_init__(self) -> None:
        for value in (
            self.target_selection,
            self.club_selection,
            self.lie_management,
            self.hazard_management,
            self.recovery_discipline,
            self.miss_planning,
            self.putting_read_discipline,
        ):
            if value is not None and not 0 <= value <= 100:
                raise ValueError("round strategy subscore values must be between 0 and 100")


@dataclass(frozen=True, slots=True)
class RoundStrategyAnalysis:
    version: str
    strategy_score: int
    execution_score: int | None
    scored_shots: int
    subscores: RoundStrategySubscores
    holes: tuple[HoleStrategyAnalysis, ...]
    top_strength: str
    top_priority: str
    top_good_decisions: tuple[DecisionMoment, ...]
    top_costly_decisions: tuple[DecisionMoment, ...]
    patterns: tuple[StrategyPattern, ...]
    pattern_summary: str

    def __post_init__(self) -> None:
        if not self.version:
            raise ValueError("round strategy analysis version is required")
        if not 0 <= self.strategy_score <= 100:
            raise ValueError("strategy_score must be between 0 and 100")
        if self.execution_score is not None and not 0 <= self.execution_score <= 100:
            raise ValueError("execution_score must be between 0 and 100")
        if self.scored_shots < 1:
            raise ValueError("round analysis requires at least one scored shot")


@dataclass(frozen=True, slots=True)
class PuttProfile:
    make_rate_3ft: float
    make_rate_6ft: float
    make_rate_10ft: float
    putter_range_feet: float = 60.0

    def __post_init__(self) -> None:
        for rate in (self.make_rate_3ft, self.make_rate_6ft, self.make_rate_10ft):
            if not 0 <= rate <= 1:
                raise ValueError("putting make rates must be between 0 and 1")
        if self.putter_range_feet <= 0:
            raise ValueError("putter_range_feet must be positive")


@dataclass(frozen=True, slots=True)
class PuttRead:
    feet: float
    direction: str
    start_direction: str
    break_inches: float

    def __post_init__(self) -> None:
        if self.feet < 0:
            raise ValueError("putt distance cannot be negative")
        if self.direction not in {"left", "right"}:
            raise ValueError("direction must be left or right")
        if self.start_direction not in {"left", "right"}:
            raise ValueError("start_direction must be left or right")
        if self.break_inches < 0:
            raise ValueError("break_inches cannot be negative")


@dataclass(frozen=True, slots=True)
class PuttContext:
    start: Vec2
    target: Vec2
    pin: Vec2
    profile: PuttProfile
    read: PuttRead
    pace_scale: float
    profile_version: str = "unversioned"

    def __post_init__(self) -> None:
        if self.start.distance_to(self.target) <= 1e-9:
            raise ValueError("start and target cannot be identical")
        if not 0 <= self.pace_scale <= 1.5:
            raise ValueError("pace_scale is outside the supported range")


@dataclass(frozen=True, slots=True)
class PuttAudit:
    engine_version: str
    round_seed: int
    shot_seed: int
    hole_number: int
    stroke_index: int
    profile_version: str
    sampled_power_multiplier: float
    sampled_lateral_yards: float
    make_probability: float


@dataclass(frozen=True, slots=True)
class PuttResultPacket:
    made: bool
    landing: Vec2
    total_yards: float
    remaining_distance_yards: float
    aim_error_inches: float
    power_error_points: float
    make_probability: float
    aim_correct: bool
    pace_correct: bool
    correct_decision: bool
    player_offset_inches: float
    player_offset_direction: str
    read: PuttRead
    assessment: ResultAssessment
    audit: PuttAudit
