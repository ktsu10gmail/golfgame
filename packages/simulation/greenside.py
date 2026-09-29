"""Seeded, deterministic greenside chip simulation."""

from __future__ import annotations

import math

from packages.golf_domain import (
    AuditModifier,
    GreensideContext,
    GreensideResultPacket,
    LieType,
    ResultAssessment,
    ShotAudit,
    ShotQuality,
    SurfaceType,
    Vec2,
    project_landing,
    resolve_surface,
)

from .engine import resolve_penalty_relief


GREENSIDE_ENGINE_VERSION = "greenside-chip-v4"
_GREENSIDE_SEED_VERSION = "greenside-chip-v2"

_MASK_64 = (1 << 64) - 1
_FNV_OFFSET_64 = 0xCBF29CE484222325
_FNV_PRIME_64 = 0x100000001B3


class _DeterministicRandom:
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


def derive_greenside_seed(round_seed: int, hole_number: int, stroke_index: int) -> int:
    if not 1 <= hole_number <= 18:
        raise ValueError("hole_number must be between 1 and 18")
    if stroke_index < 1:
        raise ValueError("stroke_index must be positive")
    material = f"{_GREENSIDE_SEED_VERSION}:{round_seed}:{hole_number}:{stroke_index}".encode()
    hashed = _FNV_OFFSET_64
    for byte in material:
        hashed ^= byte
        hashed = (hashed * _FNV_PRIME_64) & _MASK_64
    return hashed


def _round(value: float, places: int) -> float:
    return round(value + 10 ** (-(places + 6)), places)


def _round_int(value: float) -> int:
    return math.floor(value + 0.5)


def _rounded_point(point: Vec2) -> Vec2:
    return Vec2(_round(point.x, 4), _round(point.y, 4))


def _roll_ratio(club_id: str) -> float:
    name = club_id.lower().replace("_", " ")
    if "lob wedge" in name:
        return 0.8
    if "sand wedge" in name:
        return 1.0
    if "gap wedge" in name:
        return 1.5
    if "pitching wedge" in name:
        return 2.0
    if "9 iron" in name:
        return 3.0
    if "8 iron" in name:
        return 4.0
    if "7 iron" in name:
        return 5.0
    if "6 iron" in name:
        return 6.0
    return 2.5


def _lie_spread(context: GreensideContext) -> tuple[float, float]:
    if context.lie_type in {LieType.BUNKER_FAIRWAY, LieType.BUNKER_BURIED}:
        return 0.09, 0.045
    if context.lie_type is LieType.ROUGH_DEEP:
        return 0.08, 0.05
    if context.lie_type in {LieType.ROUGH_LIGHT, LieType.ROUGH_MEDIUM, LieType.ROUGH_FLYER}:
        return 0.05, 0.03
    return 0.03, 0.01


def _lie_roll_factor(lie_type: LieType) -> float:
    if lie_type in {LieType.BUNKER_FAIRWAY, LieType.BUNKER_BURIED}:
        return 0.35
    return 1.0


def _progressive_roll_path(
    start: Vec2,
    carry_point: Vec2,
    roll_yards: float,
    lateral_break: float,
    steps: int = 6,
) -> tuple[Vec2, ...]:
    if roll_yards <= 1e-9:
        return ()
    incoming_x = carry_point.x - start.x
    incoming_y = carry_point.y - start.y
    incoming_length = max(math.hypot(incoming_x, incoming_y), 1e-9)
    forward_target = Vec2(
        carry_point.x + incoming_x / incoming_length,
        carry_point.y + incoming_y / incoming_length,
    )
    return tuple(
        project_landing(
            carry_point,
            forward_target,
            roll_yards * progress,
            lateral_break * progress * progress,
        )
        for progress in ((index + 1) / steps for index in range(steps))
    )


def _break_inches(feet: float, contour_modifier: int) -> int:
    if feet <= 3:
        base = feet * 0.15
        adjustment = contour_modifier * 0.25
        return min(2, max(0, _round_int(base + adjustment)))
    if feet <= 8:
        base = 0.75 + (feet - 3) * 0.35
        adjustment = contour_modifier * 0.25
        return min(4, max(1, _round_int(base + adjustment)))
    if feet <= 15:
        base = 2.5 + (feet - 8) * 0.55
        adjustment = contour_modifier * 0.6
        return min(8, max(3, _round_int(base + adjustment)))
    base = 6.5 + (feet - 15) * 0.5
    return min(16, max(8, _round_int(base + contour_modifier)))


def simulate_greenside_shot(
    context: GreensideContext,
    *,
    round_seed: int,
    hole_number: int,
    stroke_index: int,
) -> GreensideResultPacket:
    """Return one replayable chip packet from canonical yard inputs."""
    shot_seed = derive_greenside_seed(round_seed, hole_number, stroke_index)
    rng = _DeterministicRandom(shot_seed)
    carry_target = context.start.distance_to(context.target)
    carry_lie_spread, lateral_lie_spread = _lie_spread(context)
    carry_bias = 0.82 + context.power * 0.2
    carry_sd = max(
        0.4,
        carry_target * (0.05 + (1 - context.accuracy) * 0.12 + carry_lie_spread),
    )
    actual_carry = max(0.5, rng.gauss(carry_target * carry_bias, carry_sd))
    lateral_sd = max(
        0.15,
        carry_target * (0.015 + (1 - context.accuracy) * 0.06 + lateral_lie_spread),
    )
    lateral_yards = rng.gauss(0, lateral_sd)
    carry_point = project_landing(context.start, context.target, actual_carry, lateral_yards)
    landing_surface, landing_region_id = resolve_surface(
        carry_point, context.surfaces, context.default_surface
    )

    feet_to_pin = carry_point.distance_to(context.pin) * 3
    break_inches = _break_inches(feet_to_pin, context.contour_modifier)
    roll_ratio = _roll_ratio(context.club_id)
    start_lie_roll_factor = _lie_roll_factor(context.lie_type)
    surface_factor = 1 if landing_surface is SurfaceType.GREEN else 0.65
    roll_yards = max(
        0,
        actual_carry
        * roll_ratio
        * start_lie_roll_factor
        * context.roll_slope_factor
        * surface_factor,
    )
    break_scale = min(1.3, roll_yards / max(carry_point.distance_to(context.pin), 1))
    lateral_break = break_inches / 36 * break_scale
    if context.break_direction == "left":
        lateral_break *= -1
    # Preserve the actual direction at impact. Contour influence builds during
    # rollout instead of making the ball turn sharply toward the cup.
    roll_path = _progressive_roll_path(
        context.start, carry_point, roll_yards, lateral_break
    )
    final_point = roll_path[-1] if roll_path else carry_point
    final_surface, final_region_id = resolve_surface(
        final_point, context.surfaces, context.default_surface
    )

    rounded_carry = _rounded_point(carry_point)
    rounded_final = _rounded_point(final_point)
    path = (
        _rounded_point(context.start),
        rounded_carry,
        *(_rounded_point(point) for point in roll_path),
    )
    relief = resolve_penalty_relief(
        context,  # type: ignore[arg-type]
        landing=rounded_final,
        path=path,
        landing_surface=final_surface,
        landing_region_id=final_region_id,
    )
    resolved_ball = relief.ball_position if relief else rounded_final
    resolved_surface = relief.resulting_surface if relief else final_surface
    resolved_region_id = relief.resulting_region_id if relief else final_region_id
    remaining = resolved_ball.distance_to(context.pin)
    execution = "on_plan" if remaining <= 4.5 and resolved_surface is SurfaceType.GREEN else "missed"
    target_miss = carry_point.distance_to(context.target)
    quality = (
        ShotQuality.SOLID
        if target_miss <= 1.5
        else ShotQuality.SLIGHT_MISHIT
        if target_miss <= 3
        else ShotQuality.FAT
    )
    decision_risk = min(100, _round_int(20 + _round(target_miss, 1) * 8))
    risk_label = (
        "Conservative" if target_miss <= 1.5
        else "Measured risk" if target_miss <= 3
        else "High risk"
    )
    assessment = ResultAssessment(
        decision_assessment="sound",
        execution_assessment=execution,
        overall_assessment="good" if execution == "on_plan" else "bad",
        decision_risk=decision_risk,
        risk_label=risk_label,
    )
    audit = ShotAudit(
        engine_version=GREENSIDE_ENGINE_VERSION,
        round_seed=round_seed,
        shot_seed=shot_seed,
        hole_number=hole_number,
        stroke_index=stroke_index,
        profile_version=context.profile_version,
        lie_version=context.lie_version,
        sampled_carry_yards=_round(actual_carry, 4),
        sampled_lateral_yards=_round(lateral_yards, 4),
        mishit_probability=_round(1 - context.accuracy, 3),
        modifiers=(
            AuditModifier("greenside_roll_ratio", roll_ratio),
            AuditModifier("start_lie_roll", start_lie_roll_factor),
            AuditModifier("greenside_slope_factor", context.roll_slope_factor),
            AuditModifier("intent_distance", context.power),
            AuditModifier("contour_modifier", context.contour_modifier),
        ),
    )
    return GreensideResultPacket(
        quality=quality,
        carry_yards=_round(actual_carry, 2),
        roll_yards=_round(roll_yards, 2),
        total_yards=_round(actual_carry + roll_yards, 2),
        lateral_yards=_round(lateral_yards, 2),
        landing=rounded_carry,
        resolved_ball=resolved_ball,
        path=path,
        landing_surface=landing_surface,
        landing_region_id=landing_region_id,
        resolved_surface=resolved_surface,
        resolved_region_id=resolved_region_id,
        remaining_distance_yards=_round(remaining, 2),
        assessment=assessment,
        audit=audit,
        relief=relief,
    )
