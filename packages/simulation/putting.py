"""Seeded, deterministic Phase 2 putting simulation."""

from __future__ import annotations

import math

from packages.golf_domain import PuttAudit, PuttContext, PuttResultPacket, ResultAssessment, Vec2, project_landing
from packages.simulation.green_contour import sample_course_green_contour


PUTTING_ENGINE_VERSION = "putt-v4"

_MASK_64 = (1 << 64) - 1
_FNV_OFFSET_64 = 0xCBF29CE484222325
_FNV_PRIME_64 = 0x100000001B3
_METERS_TO_YARDS = 1.09361
_GREEN_FRICTION = 1.35
_GREEN_GRAVITY = 10.72
_CONTOUR_GRAVITY_SCALE = 0.12
_PHYSICS_TIME_STEP = 0.04
_PHYSICS_STOP_SPEED = 0.035
_MAX_PHYSICS_STEPS = 650
_CUP_TOLERANCE_YARDS = 0.06
_CUP_TOLERANCE_FEET = _CUP_TOLERANCE_YARDS * 3


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


def _roll_across_contour(
    context: PuttContext,
    desired_travel_yards: float,
    lateral_error_yards: float,
) -> tuple[Vec2, tuple[Vec2, ...], float, int, float]:
    forward_x = context.target.x - context.start.x
    forward_y = context.target.y - context.start.y
    forward_length = math.hypot(forward_x, forward_y)
    forward_x /= forward_length
    forward_y /= forward_length
    right_x, right_y = forward_y, -forward_x
    lateral_ratio = lateral_error_yards / max(desired_travel_yards, 0.25)
    direction_x = forward_x + right_x * lateral_ratio
    direction_y = forward_y + right_y * lateral_ratio
    direction_length = math.hypot(direction_x, direction_y) or 1
    direction_x /= direction_length
    direction_y /= direction_length
    speed = math.sqrt(2 * _GREEN_FRICTION * max(0, desired_travel_yards))
    velocity_x = direction_x * speed
    velocity_y = direction_y * speed
    position = context.start
    path = [position]
    traveled = 0.0
    closest_to_pin = position.distance_to(context.pin)
    steps = 0

    while steps < _MAX_PHYSICS_STEPS and speed > _PHYSICS_STOP_SPEED:
        sample = sample_course_green_contour(position, context.green_polygon, context.contour_hole_number)
        gravity = (
            _GREEN_GRAVITY
            * math.sin(sample["slope_degrees"] * math.pi / 180)
            * _CONTOUR_GRAVITY_SCALE
            * max(0, min(2, context.contour_strength))
        )
        unit_x = velocity_x / speed if speed > 1e-9 else direction_x
        unit_y = velocity_y / speed if speed > 1e-9 else direction_y
        acceleration_x = sample["downhill_course_x"] * gravity - unit_x * _GREEN_FRICTION
        acceleration_y = sample["downhill_course_y"] * gravity - unit_y * _GREEN_FRICTION
        next_velocity_x = velocity_x + acceleration_x * _PHYSICS_TIME_STEP
        next_velocity_y = velocity_y + acceleration_y * _PHYSICS_TIME_STEP
        if next_velocity_x * velocity_x + next_velocity_y * velocity_y <= 0:
            break
        next_position = Vec2(
            position.x + (velocity_x + next_velocity_x) * 0.5 * _PHYSICS_TIME_STEP,
            position.y + (velocity_y + next_velocity_y) * 0.5 * _PHYSICS_TIME_STEP,
        )
        traveled += position.distance_to(next_position)
        position = next_position
        velocity_x, velocity_y = next_velocity_x, next_velocity_y
        speed = math.hypot(velocity_x, velocity_y)
        closest_to_pin = min(closest_to_pin, position.distance_to(context.pin))
        if steps % 4 == 3:
            path.append(position)
        steps += 1
    if path[-1].distance_to(position) > 1e-7:
        path.append(position)
    return position, tuple(path), traveled, steps, closest_to_pin


def simulate_putt(context: PuttContext, *, round_seed: int, hole_number: int, stroke_index: int) -> PuttResultPacket:
    shot_seed = derive_putt_seed(round_seed, hole_number, stroke_index)
    rng = _DeterministicRandom(shot_seed)
    consistency = _putting_consistency(context)
    execution_gap = 1 - consistency
    pace_noise = (rng.random() + rng.random()) - 1
    lateral_noise = (rng.random() + rng.random()) - 1
    slope_pace_multiplier = max(0.9, min(1.1, 1 + context.read.downhill_strength * 0.012))
    contour_physics = len(context.green_polygon) >= 3
    base_travel_yards = context.profile.putter_range_feet / 3 * context.pace_scale * (1 if contour_physics else slope_pace_multiplier)
    distance_ramp = max(0, min(1, (context.read.feet - 10) / 5))
    contour_difficulty = (
        1
        + max(0, context.read.slope_degrees - 2) * 0.07
        + min(0.25, context.read.break_inches / max(context.read.feet, 1) * 0.4)
        + max(0, context.read.downhill_strength) * 0.025
    )
    short_pace_error_yards = base_travel_yards * pace_noise * execution_gap * 0.08
    long_pace_amplitude_feet = (context.read.feet + 8) * (0.07 + execution_gap * 0.65) * contour_difficulty
    long_pace_error_yards = pace_noise * long_pace_amplitude_feet / 3
    pace_error_yards = short_pace_error_yards * (1 - distance_ramp) + long_pace_error_yards * distance_ramp
    travel_yards = max(0, base_travel_yards + pace_error_yards)
    base_for_multiplier = max(base_travel_yards, 1e-9)
    power_multiplier = travel_yards / base_for_multiplier
    short_lateral_yards = lateral_noise * execution_gap * 0.18 * _METERS_TO_YARDS
    long_lateral_amplitude_feet = (context.read.feet + 5) * (0.018 + execution_gap * 0.11) * contour_difficulty
    long_lateral_yards = lateral_noise * long_lateral_amplitude_feet / 3
    sampled_lateral_yards = short_lateral_yards * (1 - distance_ramp) + long_lateral_yards * distance_ramp
    physics_steps = 0
    actual_travel_yards = travel_yards
    if contour_physics:
        landing, path, actual_travel_yards, physics_steps, _ = _roll_across_contour(
            context, travel_yards, sampled_lateral_yards
        )
    else:
        landing = project_landing(context.start, context.target, travel_yards, sampled_lateral_yards)
        traveled_fraction = min(1, context.start.distance_to(landing) / max(context.start.distance_to(context.pin), 1))
        pin_dx = context.pin.x - context.start.x
        pin_dy = context.pin.y - context.start.y
        pin_length = math.hypot(pin_dx, pin_dy) or 1
        right_x, right_y = pin_dy / pin_length, -pin_dx / pin_length
        lateral_break = context.read.break_inches / 36 * traveled_fraction
        lateral_break *= 1 if context.read.direction == "right" else -1
        landing = Vec2(
            landing.x + right_x * lateral_break,
            landing.y + right_y * lateral_break,
        )
        path = (context.start, landing)
    pin_dx = context.pin.x - context.start.x
    pin_dy = context.pin.y - context.start.y
    pin_length = math.hypot(pin_dx, pin_dy) or 1
    right_x, right_y = pin_dy / pin_length, -pin_dx / pin_length
    read_offset_yards = context.read.break_inches / 36
    read_offset_yards *= 1 if context.read.start_direction == "right" else -1
    ideal_target = Vec2(
        context.pin.x + right_x * read_offset_yards,
        context.pin.y + right_y * read_offset_yards,
    )
    aim_error_inches = context.target.distance_to(ideal_target) * 36
    required_power = context.read.feet / context.profile.putter_range_feet / slope_pace_multiplier
    power_error_points = abs(context.pace_scale - required_power) * 100
    aim_quality = math.exp(-aim_error_inches / 8)
    pace_quality = math.exp(-power_error_points / 12)
    projected_travel_feet = context.profile.putter_range_feet * context.pace_scale * slope_pace_multiplier
    can_reach_cup = projected_travel_feet >= max(0, context.read.feet - _CUP_TOLERANCE_FEET)
    baseline_probability = _baseline_make_probability(context.read.feet, context)
    make_probability = (
        max(0, min(1, baseline_probability * (0.15 + 0.85 * aim_quality) * (0.1 + 0.9 * pace_quality)))
        if can_reach_cup
        else 0
    )
    aim_correct = aim_error_inches <= max(2, context.read.break_inches * 0.35)
    pace_correct = can_reach_cup and power_error_points <= 6
    correct_decision = aim_correct and pace_correct
    sampled_make = rng.random() < make_probability
    geometric_make = landing.distance_to(context.pin) <= _CUP_TOLERANCE_YARDS
    made = geometric_make or sampled_make
    if made:
        landing = context.pin
        path = (*path, context.pin)
    signed_player_offset_yards = (
        (context.target.x - context.pin.x) * right_x
        + (context.target.y - context.pin.y) * right_y
    )
    player_offset_inches = abs(signed_player_offset_yards) * 36
    player_offset_direction = "right" if signed_player_offset_yards >= 0 else "left"
    remaining = landing.distance_to(context.pin)
    assessment = ResultAssessment(
        decision_assessment="sound" if correct_decision else "review",
        execution_assessment="on_plan" if made else "missed",
        overall_assessment="good" if made or correct_decision else "bad",
    )
    return PuttResultPacket(
        made=made,
        landing=Vec2(_round(landing.x, 4), _round(landing.y, 4)),
        total_yards=_round(actual_travel_yards, 2),
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
            physics_steps=physics_steps,
            contour_physics=contour_physics,
        ),
        path=tuple(Vec2(_round(point.x, 4), _round(point.y, 4)) for point in path),
    )
