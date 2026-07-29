"""Seeded, deterministic Phase 2 putting simulation."""

from __future__ import annotations

import math

from packages.golf_domain import PuttAudit, PuttContext, PuttResultPacket, ResultAssessment, Vec2, project_landing


PUTTING_ENGINE_VERSION = "putt-v1"

_MASK_64 = (1 << 64) - 1
_FNV_OFFSET_64 = 0xCBF29CE484222325
_FNV_PRIME_64 = 0x100000001B3
_METERS_TO_YARDS = 1.09361


class _DeterministicRandom:
    def __init__(self, seed: int) -> None:
        self.state = seed & _MASK_64

    def random(self) -> float:
        self.state = (self.state + 0x9E3779B97F4A7C15) & _MASK_64
        value = self.state
        value = ((value ^ (value >> 30)) * 0xBF58476D1CE4E5B9) & _MASK_64
        value = ((value ^ (value >> 27)) * 0x94D049BB133111EB) & _MASK_64
        value ^= value >> 31
        return (value >> 11) / 9007199254740992


def derive_putt_seed(round_seed: int, hole_number: int, stroke_index: int) -> int:
    if not 1 <= hole_number <= 18:
        raise ValueError("hole_number must be between 1 and 18")
    if stroke_index < 1:
        raise ValueError("stroke_index must be positive")
    material = f"{PUTTING_ENGINE_VERSION}:{round_seed}:{hole_number}:{stroke_index}".encode()
    hashed = _FNV_OFFSET_64
    for byte in material:
        hashed ^= byte
        hashed = (hashed * _FNV_PRIME_64) & _MASK_64
    return hashed


def _round(value: float, places: int) -> float:
    return round(value + 10 ** (-(places + 6)), places)


def _putting_consistency(context: PuttContext) -> float:
    weighted = (
        context.profile.make_rate_3ft * 0.3
        + context.profile.make_rate_6ft * 0.4
        + context.profile.make_rate_10ft * 0.3
    )
    return max(0.45, min(0.98, 0.45 + weighted * 0.55))


def _baseline_make_probability(feet: float, context: PuttContext) -> float:
    rates = context.profile

    def interpolate(distance: float, start_distance: float, end_distance: float, start_rate: float, end_rate: float) -> float:
        progress = (distance - start_distance) / (end_distance - start_distance)
        return start_rate + (end_rate - start_rate) * progress

    if feet <= 3:
        percentage = interpolate(feet, 0, 3, 1, rates.make_rate_3ft)
    elif feet <= 6:
        percentage = interpolate(feet, 3, 6, rates.make_rate_3ft, rates.make_rate_6ft)
    elif feet <= 10:
        percentage = interpolate(feet, 6, 10, rates.make_rate_6ft, rates.make_rate_10ft)
    elif rates.make_rate_10ft <= 0:
        percentage = 0
    else:
        observed_decay = rates.make_rate_10ft / rates.make_rate_6ft if rates.make_rate_6ft > 0 else 0.7
        four_foot_decay = max(0.35, min(0.95, observed_decay))
        percentage = rates.make_rate_10ft * math.pow(four_foot_decay, (feet - 10) / 4)
    return max(0, min(1, percentage))


def simulate_putt(context: PuttContext, *, round_seed: int, hole_number: int, stroke_index: int) -> PuttResultPacket:
    shot_seed = derive_putt_seed(round_seed, hole_number, stroke_index)
    rng = _DeterministicRandom(shot_seed)
    consistency = _putting_consistency(context)
    power_multiplier = 1 + (rng.random() - 0.5) * (1 - consistency) * 0.16
    travel_yards = context.profile.putter_range_feet / 3 * context.pace_scale * power_multiplier
    sampled_lateral_yards = ((rng.random() + rng.random()) - 1) * (1 - consistency) * 0.18 * _METERS_TO_YARDS
    landing = project_landing(context.start, context.target, travel_yards, sampled_lateral_yards)
    traveled_fraction = min(1, context.start.distance_to(landing) / max(context.start.distance_to(context.pin), 1))
    break_yards = context.read.break_inches / 36 * traveled_fraction
    lateral_break = break_yards if context.read.direction == "right" else -break_yards
    landing = Vec2(landing.x + lateral_break, landing.y)
    ideal_target = Vec2(
        context.pin.x + (context.read.break_inches / 36 if context.read.start_direction == "right" else -context.read.break_inches / 36),
        context.pin.y,
    )
    aim_error_inches = context.target.distance_to(ideal_target) * 36
    required_power = context.read.feet / context.profile.putter_range_feet
    power_error_points = abs(context.pace_scale - required_power) * 100
    aim_quality = math.exp(-aim_error_inches / 8)
    pace_quality = math.exp(-power_error_points / 12)
    can_reach_cup = context.profile.putter_range_feet * context.pace_scale >= context.read.feet * 0.97
    baseline_probability = _baseline_make_probability(context.read.feet, context)
    make_probability = (
        max(0, min(1, baseline_probability * (0.15 + 0.85 * aim_quality) * (0.1 + 0.9 * pace_quality)))
        if can_reach_cup
        else 0
    )
    aim_correct = aim_error_inches <= max(2, context.read.break_inches * 0.35)
    pace_correct = power_error_points <= 6
    correct_decision = aim_correct and pace_correct
    made = rng.random() < make_probability
    if made:
        landing = context.pin
    player_offset_inches = abs(context.target.x - context.pin.x) * 36
    player_offset_direction = "right" if context.target.x >= context.pin.x else "left"
    remaining = landing.distance_to(context.pin)
    assessment = ResultAssessment(
        decision_assessment="sound" if correct_decision else "review",
        execution_assessment="on_plan" if made else "missed",
        overall_assessment="good" if made or correct_decision else "bad",
    )
    return PuttResultPacket(
        made=made,
        landing=Vec2(_round(landing.x, 4), _round(landing.y, 4)),
        total_yards=_round(travel_yards, 2),
        remaining_distance_yards=_round(remaining, 2),
        aim_error_inches=_round(aim_error_inches, 2),
        power_error_points=_round(power_error_points, 2),
        make_probability=_round(make_probability, 6),
        aim_correct=aim_correct,
        pace_correct=pace_correct,
        correct_decision=correct_decision,
        player_offset_inches=_round(player_offset_inches, 2),
        player_offset_direction=player_offset_direction,
        read=context.read,
        assessment=assessment,
        audit=PuttAudit(
            engine_version=PUTTING_ENGINE_VERSION,
            round_seed=round_seed,
            shot_seed=shot_seed,
            hole_number=hole_number,
            stroke_index=stroke_index,
            profile_version=context.profile_version,
            sampled_power_multiplier=_round(power_multiplier, 6),
            sampled_lateral_yards=_round(sampled_lateral_yards, 6),
            make_probability=_round(make_probability, 6),
        ),
    )
