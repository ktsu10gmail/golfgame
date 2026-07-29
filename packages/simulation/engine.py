"""Seeded, deterministic Phase 2 full-shot simulation."""

from __future__ import annotations

import math
from dataclasses import dataclass

from packages.golf_domain import (
    AuditModifier,
    PenaltyReason,
    PenaltyRelief,
    ReliefType,
    ResultAssessment,
    ShotAudit,
    ShotContext,
    ShotQuality,
    ShotResultPacket,
    SurfaceType,
    Vec2,
    point_in_polygon,
    project_landing,
    resolve_surface,
    target_axes,
)


ENGINE_VERSION = "full-shot-v3"
PENALTY_RELIEF_VERSION = "penalty-relief-v1"

_MASK_64 = (1 << 64) - 1
_FNV_OFFSET_64 = 0xCBF29CE484222325
_FNV_PRIME_64 = 0x100000001B3


class _DeterministicRandom:
    """Small cross-runtime RNG shared exactly with the browser engine."""

    def __init__(self, seed: int) -> None:
        self.state = seed & _MASK_64
        self.spare_gaussian: float | None = None

    def random(self) -> float:
        self.state = (self.state + 0x9E3779B97F4A7C15) & _MASK_64
        value = self.state
        value = ((value ^ (value >> 30)) * 0xBF58476D1CE4E5B9) & _MASK_64
        value = ((value ^ (value >> 27)) * 0x94D049BB133111EB) & _MASK_64
        value ^= value >> 31
        return (value >> 11) / 9007199254740992

    def gauss(self, mean: float, standard_deviation: float) -> float:
        if self.spare_gaussian is not None:
            standard = self.spare_gaussian
            self.spare_gaussian = None
        else:
            first = max(self.random(), 1 / 9007199254740992)
            second = self.random()
            radius = math.sqrt(-2 * math.log(first))
            angle = 2 * math.pi * second
            standard = radius * math.cos(angle)
            self.spare_gaussian = radius * math.sin(angle)
        return mean + standard * standard_deviation


@dataclass(frozen=True, slots=True)
class QualityModifiers:
    carry: float
    roll: float
    lateral_spread: float
    lateral_bias_yards: float = 0.0


QUALITY_MODIFIERS: dict[ShotQuality, QualityModifiers] = {
    ShotQuality.PURE: QualityModifiers(1.01, 1.00, 0.65),
    ShotQuality.SOLID: QualityModifiers(1.00, 1.00, 1.00),
    ShotQuality.SLIGHT_MISHIT: QualityModifiers(0.91, 0.95, 1.25),
    ShotQuality.FAT: QualityModifiers(0.58, 0.30, 1.15),
    ShotQuality.THIN: QualityModifiers(0.82, 1.60, 1.30),
    ShotQuality.TOPPED: QualityModifiers(0.28, 2.10, 1.55),
    ShotQuality.HEEL: QualityModifiers(0.87, 0.90, 1.55, 4.0),
    ShotQuality.TOE: QualityModifiers(0.89, 0.95, 1.45, -3.0),
    ShotQuality.SHANK: QualityModifiers(0.55, 0.50, 0.80, 35.0),
    ShotQuality.FLYER: QualityModifiers(1.10, 1.35, 1.15),
}


def derive_shot_seed(round_seed: int, hole_number: int, stroke_index: int) -> int:
    if not 1 <= hole_number <= 18:
        raise ValueError("hole_number must be between 1 and 18")
    if stroke_index < 1:
        raise ValueError("stroke_index must be positive")
    material = f"{ENGINE_VERSION}:{round_seed}:{hole_number}:{stroke_index}".encode()
    hashed = _FNV_OFFSET_64
    for byte in material:
        hashed ^= byte
        hashed = (hashed * _FNV_PRIME_64) & _MASK_64
    return hashed


def _bounded_gauss(
    rng: _DeterministicRandom,
    mean: float,
    standard_deviation: float,
    lower: float,
    upper: float,
) -> float:
    if standard_deviation == 0:
        return min(upper, max(lower, mean))
    for _ in range(32):
        value = rng.gauss(mean, standard_deviation)
        if lower <= value <= upper:
            return value
    return min(upper, max(lower, value))


def _weighted_quality(rng: _DeterministicRandom, context: ShotContext) -> ShotQuality:
    probability = min(
        0.95,
        context.club.mishit_probability
        * context.lie.mishit_multiplier
        * context.environment.slope_mishit_multiplier
        * context.intent.complexity_multiplier,
    )
    if rng.random() >= probability:
        return ShotQuality.PURE if rng.random() < 0.15 else ShotQuality.SOLID

    draw = rng.random() * sum(weight for _, weight in context.club.quality_weights)
    cumulative = 0.0
    for quality, weight in context.club.quality_weights:
        cumulative += weight
        if draw <= cumulative:
            return quality
    return context.club.quality_weights[-1][0]


def _mishit_probability(context: ShotContext) -> float:
    return min(
        0.95,
        context.club.mishit_probability
        * context.lie.mishit_multiplier
        * context.environment.slope_mishit_multiplier
        * context.intent.complexity_multiplier,
    )


def _path_samples(
    start: Vec2,
    target: Vec2,
    total_yards: float,
    lateral_yards: float,
    count: int = 13,
) -> tuple[Vec2, ...]:
    forward, right = target_axes(start, target)
    points: list[Vec2] = []
    for index in range(count):
        progress = index / (count - 1)
        forward_distance = total_yards * progress
        lateral_distance = lateral_yards * progress**1.6
        points.append(
            Vec2(
                start.x + forward.x * forward_distance + right.x * lateral_distance,
                start.y + forward.y * forward_distance + right.y * lateral_distance,
            )
        )
    return tuple(points)


def _rounded_point(point: Vec2) -> Vec2:
    return Vec2(round(point.x, 4), round(point.y, 4))


def _bounded(value: float, lower: float, upper: float) -> float:
    return min(upper, max(lower, value))


def _risk_label(risk: int) -> str:
    if risk < 30:
        return "Conservative"
    if risk < 58:
        return "Measured risk"
    return "High risk"


def _decision_risk(context: ShotContext) -> tuple[int, str]:
    aim = context.start.distance_to(context.target)
    expected = context.club.carry_mean * context.lie.carry_multiplier
    uncertainty = _bounded(context.club.mishit_probability * 2.2, 0.0, 1.0)
    target_surface, _ = resolve_surface(context.target, context.surfaces, context.default_surface)
    risk = abs(aim - expected) / max(expected, 1.0) * 70 + uncertainty * 100 * 0.45
    if target_surface in {SurfaceType.WATER, SurfaceType.OUT_OF_BOUNDS}:
        risk += 35
    if target_surface in {SurfaceType.BUNKER, SurfaceType.ROUGH, SurfaceType.NATIVE, SurfaceType.FIRST_CUT}:
        risk += 15
    rounded = round(_bounded(risk, 0.0, 100.0))
    return rounded, _risk_label(rounded)


def _full_shot_assessment(
    context: ShotContext,
    landing_surface: SurfaceType,
    relief: PenaltyRelief | None,
) -> ResultAssessment:
    decision_risk, risk_label = _decision_risk(context)
    target_surface, _ = resolve_surface(context.target, context.surfaces, context.default_surface)
    result_surface = relief.resulting_surface if relief is not None else landing_surface
    execution = "on_plan" if result_surface is target_surface else "missed"
    return ResultAssessment(
        decision_assessment="sound" if decision_risk < 58 else "review",
        execution_assessment=execution,
        overall_assessment="good" if execution == "on_plan" else "bad",
        decision_risk=decision_risk,
        risk_label=risk_label,
    )


def _penalty_region(context: ShotContext, surface: SurfaceType, region_id: str | None, point: Vec2):
    matching = [region for region in context.surfaces if region.surface is surface]
    if region_id is not None:
        identified = next((region for region in matching if region.region_id == region_id), None)
        if identified is not None:
            return identified
    return next((region for region in matching if point_in_polygon(point, region.polygon)), None)


def _last_boundary_entry(path: tuple[Vec2, ...], polygon: tuple[Vec2, ...]) -> tuple[Vec2, Vec2]:
    states = [point_in_polygon(point, polygon) for point in path]
    transition = next(
        (index for index in range(len(path) - 1, 0, -1) if states[index] and not states[index - 1]),
        None,
    )
    if transition is None:
        return path[0], path[-1]
    outside, inside = path[transition - 1], path[transition]
    low, high = outside, inside
    for _ in range(48):
        middle = Vec2((low.x + high.x) / 2, (low.y + high.y) / 2)
        if point_in_polygon(middle, polygon):
            high = middle
        else:
            low = middle
    return low, high


def _playable_relief_position(context: ShotContext, reference: Vec2, toward: Vec2) -> tuple[Vec2, SurfaceType, str | None]:
    dx, dy = toward.x - reference.x, toward.y - reference.y
    length = math.hypot(dx, dy)
    if length <= 1e-9:
        dx, dy = context.start.x - reference.x, context.start.y - reference.y
        length = max(math.hypot(dx, dy), 1.0)
    unit = Vec2(dx / length, dy / length)
    for relief_distance in range(2, 21):
        candidate = Vec2(reference.x + unit.x * relief_distance, reference.y + unit.y * relief_distance)
        surface, region_id = resolve_surface(candidate, context.surfaces, context.default_surface)
        if surface not in {SurfaceType.WATER, SurfaceType.OUT_OF_BOUNDS}:
            return _rounded_point(candidate), surface, region_id
    surface, region_id = resolve_surface(context.start, context.surfaces, context.default_surface)
    return _rounded_point(context.start), surface, region_id


def resolve_penalty_relief(
    context: ShotContext,
    *,
    landing: Vec2,
    path: tuple[Vec2, ...],
    landing_surface: SurfaceType,
    landing_region_id: str | None,
    declared_unplayable: bool = False,
) -> PenaltyRelief | None:
    """Resolve automatic water/OOB relief or a declared unplayable ball."""
    if declared_unplayable:
        if landing_surface in {SurfaceType.WATER, SurfaceType.OUT_OF_BOUNDS}:
            raise ValueError("unplayable relief cannot replace automatic water or out-of-bounds relief")
        ball, surface, region_id = _playable_relief_position(context, landing, context.start)
        return PenaltyRelief(
            PENALTY_RELIEF_VERSION, PenaltyReason.UNPLAYABLE, 1,
            ReliefType.UNPLAYABLE_BACK_ON_LINE, _rounded_point(landing), ball, surface, region_id,
        )
    if landing_surface is SurfaceType.OUT_OF_BOUNDS:
        surface, region_id = resolve_surface(context.start, context.surfaces, context.default_surface)
        return PenaltyRelief(
            PENALTY_RELIEF_VERSION, PenaltyReason.OUT_OF_BOUNDS, 1,
            ReliefType.STROKE_AND_DISTANCE, _rounded_point(landing), _rounded_point(context.start), surface, region_id,
        )
    if landing_surface is SurfaceType.WATER:
        region = _penalty_region(context, SurfaceType.WATER, landing_region_id, landing)
        outside, boundary = _last_boundary_entry(path, region.polygon) if region else (context.start, landing)
        ball, surface, region_id = _playable_relief_position(context, boundary, outside)
        return PenaltyRelief(
            PENALTY_RELIEF_VERSION, PenaltyReason.WATER, 1,
            ReliefType.WATER_LAST_CROSSING, _rounded_point(boundary), ball, surface, region_id,
        )
    return None


def declare_unplayable(context: ShotContext, packet: ShotResultPacket) -> PenaltyRelief:
    if packet.relief is not None:
        raise ValueError("this shot already has automatic penalty relief")
    relief = resolve_penalty_relief(
        context,
        landing=packet.landing,
        path=packet.path,
        landing_surface=packet.landing_surface,
        landing_region_id=packet.landing_region_id,
        declared_unplayable=True,
    )
    if relief is None:
        raise RuntimeError("unplayable relief was not produced")
    return relief


def simulate_full_shot(
    context: ShotContext,
    *,
    round_seed: int,
    hole_number: int,
    stroke_index: int,
) -> ShotResultPacket:
    """Return an immutable Result Packet for one full shot.

    The same context, engine version, round seed, hole, and stroke always
    produce the same packet.
    """
    shot_seed = derive_shot_seed(round_seed, hole_number, stroke_index)
    rng = _DeterministicRandom(shot_seed)
    quality = _weighted_quality(rng, context)
    quality_modifiers = QUALITY_MODIFIERS[quality]

    lower_carry = max(1.0, context.club.carry_mean - 2.75 * context.club.carry_sd)
    upper_carry = context.club.carry_mean + 2.75 * context.club.carry_sd
    sampled_carry = _bounded_gauss(
        rng,
        context.club.carry_mean,
        context.club.carry_sd,
        lower_carry,
        upper_carry,
    )
    carry_yards = (
        sampled_carry
        * context.lie.carry_multiplier
        * context.environment.elevation_carry_multiplier
        * quality_modifiers.carry
        * context.intent.distance_multiplier
        + context.environment.wind_forward_yards
    )
    carry_yards = max(1.0, carry_yards)

    roll_yards = max(
        0.0,
        context.club.roll_mean
        * context.lie.roll_multiplier
        * context.environment.surface_roll_multiplier
        * context.environment.wind_roll_multiplier
        * quality_modifiers.roll,
    )
    total_yards = carry_yards + roll_yards

    lateral_limit = max(1.0, context.club.lateral_sd * quality_modifiers.lateral_spread * 3)
    sampled_lateral = _bounded_gauss(
        rng,
        0.0,
        context.club.lateral_sd * quality_modifiers.lateral_spread,
        -lateral_limit,
        lateral_limit,
    )
    lateral_yards = (
        sampled_lateral
        + context.club.directional_bias
        + context.lie.lateral_bias_yards
        + context.environment.wind_lateral_yards
        + quality_modifiers.lateral_bias_yards
    )

    landing = project_landing(context.start, context.target, total_yards, lateral_yards)
    surface, region_id = resolve_surface(landing, context.surfaces, context.default_surface)
    path = _path_samples(context.start, context.target, total_yards, lateral_yards)
    modifiers = (
        AuditModifier("lie_carry", context.lie.carry_multiplier),
        AuditModifier("lie_roll", context.lie.roll_multiplier),
        AuditModifier("lie_mishit", context.lie.mishit_multiplier),
        AuditModifier("elevation_carry", context.environment.elevation_carry_multiplier),
        AuditModifier("slope_mishit", context.environment.slope_mishit_multiplier),
        AuditModifier("surface_roll", context.environment.surface_roll_multiplier),
        AuditModifier("wind_roll", context.environment.wind_roll_multiplier),
        AuditModifier("intent_distance", context.intent.distance_multiplier),
        AuditModifier("intent_complexity", context.intent.complexity_multiplier),
        AuditModifier("quality_carry", quality_modifiers.carry),
        AuditModifier("quality_roll", quality_modifiers.roll),
        AuditModifier("quality_lateral", quality_modifiers.lateral_spread),
    )
    audit = ShotAudit(
        engine_version=ENGINE_VERSION,
        round_seed=round_seed,
        shot_seed=shot_seed,
        hole_number=hole_number,
        stroke_index=stroke_index,
        profile_version=context.profile_version,
        lie_version=context.lie.version,
        sampled_carry_yards=round(sampled_carry, 4),
        sampled_lateral_yards=round(sampled_lateral, 4),
        mishit_probability=round(_mishit_probability(context), 6),
        modifiers=modifiers,
    )
    rounded_landing = _rounded_point(landing)
    rounded_path = tuple(_rounded_point(point) for point in path)
    relief = resolve_penalty_relief(
        context,
        landing=rounded_landing,
        path=rounded_path,
        landing_surface=surface,
        landing_region_id=region_id,
    )
    resolved_ball = relief.ball_position if relief else rounded_landing
    assessment = _full_shot_assessment(context, surface, relief)
    return ShotResultPacket(
        quality=quality,
        carry_yards=round(carry_yards, 2),
        roll_yards=round(roll_yards, 2),
        total_yards=round(total_yards, 2),
        lateral_yards=round(lateral_yards, 2),
        landing=rounded_landing,
        path=rounded_path,
        landing_surface=surface,
        landing_region_id=region_id,
        remaining_distance_yards=round(resolved_ball.distance_to(context.pin), 2),
        assessment=assessment,
        audit=audit,
        relief=relief,
    )
