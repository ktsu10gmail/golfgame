export const DECISION_SCORE_VERSION = "decision-score-v2";

const LIE_ADVICE_KEYS = {
  tee_standard: "tee_standard",
  fairway_clean: "fairway_clean",
  rough_light: "rough_light",
  rough_medium: "rough_medium",
  rough_deep: "rough_deep",
  rough_flyer: "rough_flyer",
  hardpan: "hardpan",
  bunker_fairway: "bunker_fairway",
  bunker_buried: "bunker_buried"
};

const SEVERE_LIES = new Set([
  "rough_medium",
  "rough_deep",
  "hardpan",
  "bunker_fairway",
  "bunker_buried"
]);

const VERY_SEVERE_LIES = new Set([
  "rough_deep",
  "bunker_buried"
]);

const LOW_CONTROL_LIES = new Set([...SEVERE_LIES, "rough_flyer"]);

const DEFAULT_WEIGHTS = {
  target_selection: 0.25,
  club_selection: 0.20,
  lie_management: 0.15,
  hazard_management: 0.20,
  recovery_discipline: 0.10,
  miss_planning: 0.10
};

const SHOT_TYPE_WEIGHTS = {
  tee_positioning: {
    target_selection: 0.30,
    club_selection: 0.18,
    lie_management: 0.15,
    hazard_management: 0.25,
    recovery_discipline: 0.04,
    miss_planning: 0.08
  },
  approach_standard: {
    target_selection: 0.24,
    club_selection: 0.22,
    lie_management: 0.15,
    hazard_management: 0.18,
    recovery_discipline: 0.08,
    miss_planning: 0.13
  },
  approach_forced_carry: {
    target_selection: 0.18,
    club_selection: 0.28,
    lie_management: 0.12,
    hazard_management: 0.25,
    recovery_discipline: 0.07,
    miss_planning: 0.10
  },
  recovery_escape: {
    target_selection: 0.10,
    club_selection: 0.16,
    lie_management: 0.18,
    hazard_management: 0.22,
    recovery_discipline: 0.26,
    miss_planning: 0.08
  },
  recovery_advancing: {
    target_selection: 0.12,
    club_selection: 0.18,
    lie_management: 0.17,
    hazard_management: 0.21,
    recovery_discipline: 0.24,
    miss_planning: 0.08
  },
  bunker_escape: {
    target_selection: 0.12,
    club_selection: 0.15,
    lie_management: 0.25,
    hazard_management: 0.18,
    recovery_discipline: 0.22,
    miss_planning: 0.08
  }
};

function clamp(value, lower = 0, upper = 100) {
  return Math.min(upper, Math.max(lower, value));
}

function decisionLabel(score) {
  if (score >= 90) return "excellent";
  if (score >= 80) return "sound";
  if (score >= 70) return "acceptable";
  if (score >= 60) return "aggressive";
  if (score >= 45) return "poor";
  return "reckless";
}

function executionLabel(score) {
  if (score >= 85) return "matched_plan";
  if (score >= 70) return "slight_miss";
  if (score >= 50) return "clear_miss";
  return "major_miss";
}

function weightedScore(shotType, subscores) {
  const weights = SHOT_TYPE_WEIGHTS[shotType] || DEFAULT_WEIGHTS;
  const weighted = Object.entries(weights)
    .reduce((sum, [key, weight]) => sum + subscores[key] * weight, 0);
  return Math.round(weighted);
}

function hazardKey(context) {
  if (context.out_of_bounds_in_play) return "out_of_bounds_in_play";
  if (context.forced_carry_yards > 0 && context.water_in_play) return "forced_water_carry";
  if (context.water_in_play) return "water_in_play";
  if (context.recovery_required) {
    return context.strategy_notes.includes("penalty") ? "recovery_after_penalty" : "unplayable_situation";
  }
  if (context.hazard_count > 0) return "fairway_bunker_in_play";
  return null;
}

function outcomeKey(context, reasons) {
  if (reasons.has("hero_shot_not_justified") || context.recovery_required) return "restore_position";
  if (context.forced_carry_yards > 0) return "cover_the_carry";
  if (context.pin_risk_level >= 1) return "favor_center_green";
  if (context.water_in_play || context.out_of_bounds_in_play) return "favor_safe_side";
  if (VERY_SEVERE_LIES.has(context.lie_type)) return "escape_first";
  if (LOW_CONTROL_LIES.has(context.lie_type)) return "prioritize_solid_contact";
  return "remove_big_miss";
}

function shotId(context) {
  return `h${context.hole_number}:s${context.stroke_number}`;
}

function inferPreferredMiss(context) {
  if (context.preferred_miss && context.preferred_miss !== "none_declared") return context.preferred_miss;
  if (context.recovery_required) return "back_in_play";
  if (context.out_of_bounds_in_play) return "away_from_ob";
  if (context.water_in_play) return "dry_side";
  if (context.pin_risk_level >= 1) return "center_green";
  if (new Set(["tee_positioning", "layup_positioning"]).has(context.shot_type)) return "widest_landing_zone";
  return "none_declared";
}

function scoreExecution(club, targetDistanceYards, result) {
  let score = 80;
  const reasons = [];
  if (result.relief !== null || ["water", "out_of_bounds"].includes(result.landing_surface)) {
    score -= 35;
    reasons.push("penalty_or_unplayable_result");
  }
  if (result.assessment?.execution_assessment !== "on_plan") {
    score -= 12;
    reasons.push("result_missed_plan");
  }
  if (result.remaining_distance_yards > Math.max(12, targetDistanceYards * 0.35)) {
    score -= 10;
    reasons.push("distance_short_of_plan");
  }
  if (Math.abs(result.lateral_yards) > Math.max(club.lateral_sd * 1.5, 12)) {
    score -= 8;
    reasons.push("missed_start_line");
  }
  if (!reasons.length) {
    score += 10;
    reasons.push("matched_intended_window");
  }
  score = clamp(score);
  return {
    score,
    label: executionLabel(score),
    plan_match: score >= 85 ? "matched_window" : "below_expected_start_line_and_distance",
    reasons
  };
}

export function scoreStrategy(context, result = null) {
  const reasons = new Set();
  const preferredMiss = inferPreferredMiss(context);
  const preferredMissInferred = !context.preferred_miss || context.preferred_miss === "none_declared";

  let targetSelection = 85;
  let clubSelection = 85;
  let lieManagement = 85;
  let hazardManagement = 85;
  let recoveryDiscipline = 85;
  let missPlanning = 85;

  if (context.target_aggression <= 0.30 && (context.water_in_play || context.out_of_bounds_in_play || context.pin_risk_level > 0)) {
    targetSelection += 5;
    hazardManagement += 4;
    reasons.add("safe_target_selected");
    reasons.add("hazard_respected");
  }
  if (context.target_aggression >= 0.70) {
    targetSelection -= 10;
    reasons.add("target_too_aggressive");
  }
  if (context.pin_risk_level >= 1 && context.target_aggression >= 0.55 && LOW_CONTROL_LIES.has(context.lie_type)) {
    targetSelection -= 12;
    missPlanning -= 6;
    reasons.add("pin_attack_not_justified");
  } else if (context.pin_risk_level >= 1 && context.target_aggression <= 0.35) {
    targetSelection += 4;
    reasons.add("green_center_bias_correct");
  }

  if (context.forced_carry_yards > 0) {
    const carryMargin = context.selected_club.carry_mean - context.forced_carry_yards;
    if (carryMargin >= 10) {
      clubSelection += 4;
      reasons.add("correct_club_for_carry");
    } else if (carryMargin < 5) {
      clubSelection -= 12;
      hazardManagement -= 10;
      reasons.add("carry_margin_thin");
    }
  }

  if (VERY_SEVERE_LIES.has(context.lie_type)) {
    if (context.target_aggression > 0.35) {
      lieManagement -= 14;
      reasons.add("lie_not_respected");
    } else {
      lieManagement += 4;
      reasons.add("lie_respected");
    }
  } else if (LOW_CONTROL_LIES.has(context.lie_type)) {
    if (context.target_aggression > 0.55) {
      lieManagement -= 10;
      reasons.add("lie_not_respected");
    } else {
      lieManagement += 3;
      reasons.add("lie_respected");
    }
  }

  if (context.sidehill_compensation === "correct") {
    lieManagement += 8;
    reasons.add("sidehill_compensation_correct");
  } else if (context.sidehill_compensation === "wrong_direction") {
    lieManagement -= 12;
    reasons.add("sidehill_compensation_wrong_direction");
  } else if (context.sidehill_compensation === "overcompensated") {
    lieManagement -= 6;
    reasons.add("sidehill_overcompensated");
  } else if (context.sidehill_compensation === "missing") {
    lieManagement -= 7;
    reasons.add("sidehill_compensation_missing");
  }

  if (context.water_in_play && context.target_aggression >= 0.60) {
    hazardManagement -= 8;
    reasons.add("hazard_underweighted");
  }
  if (context.out_of_bounds_in_play && context.target_aggression >= 0.45) {
    hazardManagement -= 12;
    reasons.add("ob_risk_not_justified");
  }

  if (context.recovery_required) {
    if (new Set(["recovery_escape", "bunker_escape"]).has(context.shot_type)) {
      recoveryDiscipline += 6;
      reasons.add("sensible_recovery");
    } else {
      recoveryDiscipline -= 15;
      targetSelection -= 6;
      reasons.add("recovery_not_taken");
      reasons.add("hero_shot_not_justified");
    }
  }

  if (context.shot_type === "layup_positioning") {
    recoveryDiscipline += 2;
    reasons.add("smart_layup");
  }

  let safeMiss = false;
  if (preferredMiss === "center_green" && context.pin_risk_level >= 1) safeMiss = true;
  if (preferredMiss === "dry_side" && context.water_in_play) safeMiss = true;
  if (preferredMiss === "away_from_ob" && context.out_of_bounds_in_play) safeMiss = true;
  if (preferredMiss === "back_in_play" && context.recovery_required) safeMiss = true;
  if (preferredMiss === "widest_landing_zone" && new Set(["tee_positioning", "layup_positioning"]).has(context.shot_type)) safeMiss = true;
  if (safeMiss) {
    missPlanning += 4;
    reasons.add("good_miss_plan");
  } else if (preferredMiss !== "none_declared") {
    missPlanning -= 6;
    reasons.add("bad_miss_plan");
  }

  const subscores = {
    target_selection: clamp(targetSelection),
    club_selection: clamp(clubSelection),
    lie_management: clamp(lieManagement),
    hazard_management: clamp(hazardManagement),
    recovery_discipline: clamp(recoveryDiscipline),
    miss_planning: clamp(missPlanning)
  };
  const decisionScore = weightedScore(context.shot_type, subscores);
  return {
    version: DECISION_SCORE_VERSION,
    shot_id: shotId(context),
    shot_type: context.shot_type,
    preferred_miss: preferredMiss,
    preferred_miss_inferred: preferredMissInferred,
    decision: {
      score: decisionScore,
      label: decisionLabel(decisionScore),
      confidence: "high",
      subscores,
      reasons: [...reasons].sort(),
      advice_keys: [
        LIE_ADVICE_KEYS[context.lie_type],
        context.stance_type && context.stance_type !== "level" ? context.stance_type : null,
        hazardKey(context),
        outcomeKey(context, reasons)
      ].filter(Boolean)
    },
    execution: result ? scoreExecution(context.selected_club, context.distance_to_target_yards, result) : null
  };
}

export function scorePuttStrategy(result) {
  const feet = result.read.feet;
  const longPutt = feet >= 25;
  const shotType = feet > 10 ? "putt_lag" : "putt_make_attempt";
  const linePlan = clamp(Math.round(90 - Math.max(0, result.aim_error_inches - 2) * 2.5));
  const pacePlan = clamp(Math.round(90 - Math.max(0, result.power_error_points - 3) * 2));
  const threePuttAvoidance = clamp(
    Math.round(92 - Math.max(0, result.power_error_points - (longPutt ? 6 : 8)) * 2.5)
  );
  const weights = longPutt ? [0.30, 0.45, 0.25] : [0.45, 0.40, 0.15];
  const decisionScore = Math.round(
    linePlan * weights[0]
      + pacePlan * weights[1]
      + threePuttAvoidance * weights[2]
  );
  const puttingKey = longPutt
    ? "long_putt"
    : result.read.break_inches >= 3
      ? "breaking_putt"
      : feet <= 6
        ? "short_must_make_putt"
        : "breaking_putt";

  const remainingFeet = result.remaining_distance_yards * 3;
  let executionScore;
  let executionReason;
  if (result.made) {
    executionScore = 95;
    executionReason = "putt_holed";
  } else if (remainingFeet <= 2) {
    executionScore = 90;
    executionReason = "tap_in_leave";
  } else if (remainingFeet <= 6) {
    executionScore = 78;
    executionReason = "manageable_leave";
  } else if (remainingFeet <= 10) {
    executionScore = 65;
    executionReason = "putt_finished_outside_target_window";
  } else {
    executionScore = 45;
    executionReason = "three_putt_risk_created";
  }

  return {
    version: DECISION_SCORE_VERSION,
    shot_id: `h${result.audit.hole_number}:s${result.audit.stroke_index}`,
    shot_type: shotType,
    preferred_miss: "none_declared",
    preferred_miss_inferred: false,
    decision: {
      score: decisionScore,
      label: decisionLabel(decisionScore),
      confidence: "high",
      subscores: {
        line_plan: linePlan,
        pace_plan: pacePlan,
        three_putt_avoidance: threePuttAvoidance
      },
      reasons: [
        result.aim_correct ? "putting_line_respected" : "putting_line_missed",
        result.pace_correct ? "putting_pace_respected" : "putting_pace_missed"
      ],
      advice_keys: [
        puttingKey,
        longPutt ? "accept_longer_putt" : "prioritize_solid_contact"
      ]
    },
    execution: {
      score: executionScore,
      label: executionLabel(executionScore),
      plan_match: executionScore >= 85 ? "matched_window" : "outside_intended_leave_window",
      reasons: [executionReason]
    }
  };
}
