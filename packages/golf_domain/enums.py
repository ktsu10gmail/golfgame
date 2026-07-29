"""Canonical identifiers shared by the simulator and future application layers."""

from enum import StrEnum


class Dexterity(StrEnum):
    RIGHT = "right"
    LEFT = "left"


class LieType(StrEnum):
    TEE_STANDARD = "tee_standard"
    FAIRWAY_CLEAN = "fairway_clean"
    ROUGH_LIGHT = "rough_light"
    ROUGH_MEDIUM = "rough_medium"
    ROUGH_DEEP = "rough_deep"
    ROUGH_FLYER = "rough_flyer"
    HARDPAN = "hardpan"
    BUNKER_FAIRWAY = "bunker_fairway"
    BUNKER_BURIED = "bunker_buried"


class ShotQuality(StrEnum):
    PURE = "pure"
    SOLID = "solid"
    SLIGHT_MISHIT = "slight_mishit"
    FAT = "fat"
    THIN = "thin"
    TOPPED = "topped"
    HEEL = "heel"
    TOE = "toe"
    SHANK = "shank"
    FLYER = "flyer"


class SurfaceType(StrEnum):
    TEE = "tee"
    FAIRWAY = "fairway"
    FIRST_CUT = "first_cut"
    ROUGH = "rough"
    GREEN = "green"
    FRINGE = "fringe"
    BUNKER = "bunker"
    WATER = "water"
    OUT_OF_BOUNDS = "out_of_bounds"
    NATIVE = "native"


class PenaltyReason(StrEnum):
    WATER = "water"
    OUT_OF_BOUNDS = "out_of_bounds"
    UNPLAYABLE = "unplayable"


class ReliefType(StrEnum):
    WATER_LAST_CROSSING = "water_last_crossing"
    STROKE_AND_DISTANCE = "stroke_and_distance"
    UNPLAYABLE_BACK_ON_LINE = "unplayable_back_on_line"


class StrategicShotType(StrEnum):
    TEE_POSITIONING = "tee_positioning"
    TEE_ATTACK = "tee_attack"
    APPROACH_STANDARD = "approach_standard"
    APPROACH_FORCED_CARRY = "approach_forced_carry"
    LAYUP_POSITIONING = "layup_positioning"
    RECOVERY_ESCAPE = "recovery_escape"
    RECOVERY_ADVANCING = "recovery_advancing"
    BUNKER_ESCAPE = "bunker_escape"
    GREENSIDE_ATTACK = "greenside_attack"
    CHIP_PITCH_STANDARD = "chip_pitch_standard"
    PUTT_LAG = "putt_lag"
    PUTT_MAKE_ATTEMPT = "putt_make_attempt"


class PreferredMiss(StrEnum):
    CENTER_GREEN = "center_green"
    SHORT_SAFE = "short_safe"
    LONG_SAFE = "long_safe"
    LEFT_SAFE = "left_safe"
    RIGHT_SAFE = "right_safe"
    DRY_SIDE = "dry_side"
    AWAY_FROM_OB = "away_from_ob"
    BACK_IN_PLAY = "back_in_play"
    WIDEST_LANDING_ZONE = "widest_landing_zone"
    NONE_DECLARED = "none_declared"


class DecisionLabel(StrEnum):
    EXCELLENT = "excellent"
    SOUND = "sound"
    ACCEPTABLE = "acceptable"
    AGGRESSIVE = "aggressive"
    POOR = "poor"
    RECKLESS = "reckless"


class DecisionConfidence(StrEnum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class ExecutionLabel(StrEnum):
    MATCHED_PLAN = "matched_plan"
    SLIGHT_MISS = "slight_miss"
    CLEAR_MISS = "clear_miss"
    MAJOR_MISS = "major_miss"


class DecisionReason(StrEnum):
    SAFE_TARGET_SELECTED = "safe_target_selected"
    CORRECT_CLUB_FOR_CARRY = "correct_club_for_carry"
    LIE_RESPECTED = "lie_respected"
    HAZARD_RESPECTED = "hazard_respected"
    SENSIBLE_RECOVERY = "sensible_recovery"
    GOOD_MISS_PLAN = "good_miss_plan"
    SMART_LAYUP = "smart_layup"
    GREEN_CENTER_BIAS_CORRECT = "green_center_bias_correct"
    TARGET_TOO_AGGRESSIVE = "target_too_aggressive"
    CARRY_MARGIN_THIN = "carry_margin_thin"
    LIE_NOT_RESPECTED = "lie_not_respected"
    HAZARD_UNDERWEIGHTED = "hazard_underweighted"
    RECOVERY_NOT_TAKEN = "recovery_not_taken"
    BAD_MISS_PLAN = "bad_miss_plan"
    PIN_ATTACK_NOT_JUSTIFIED = "pin_attack_not_justified"
    OB_RISK_NOT_JUSTIFIED = "ob_risk_not_justified"
    HERO_SHOT_NOT_JUSTIFIED = "hero_shot_not_justified"
