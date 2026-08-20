// Deterministic, shot-only reward for a player who declares and applies a
// condition adjustment. AI may explain this packet, but must not grade it.

export const ADJUSTMENT_REWARD_VERSION = "adjustment-reward-v1";
export const ADJUSTMENT_ACCURACY_CAP = 92;

function clamp(value, lower, upper) {
  return Math.min(upper, Math.max(lower, value));
}

function instructionText(instructions) {
  return (Array.isArray(instructions) ? instructions : [])
    .filter(value => typeof value === "string")
    .join(" ")
    .toLowerCase()
    .replaceAll("-", " ");
}

function declaredSidehillAdjustment(text) {
  return /\b(?:aim|start|favor|favour)\b[^.!?]{0,45}\b(?:left|right)\b/.test(text) ||
    /\b\d+(?:\.\d+)?\s*(?:yards?|yds?|inches?|inch|in)\s+(?:left|right)\b/.test(text);
}

function declaredClubAdjustment(text) {
  if (/\b(?:one\s+)?club\s+(?:up|more)\b|\b(?:extra|more)\s+club\b|\bclub\s+up\b/.test(text)) return 1;
  if (/\b(?:one\s+)?club\s+(?:down|less)\b|\b(?:less)\s+club\b|\bclub\s+down\b/.test(text)) return -1;
  return 0;
}

function declaredLiePlan(text, lie) {
  if (["Rough", "Heavy rough"].includes(lie)) {
    return /\b(?:extra club|more club|club up|more loft|safe side|safe area|center|centre|widest|solid contact|escape)\b/.test(text);
  }
  if (lie === "Bunker") {
    return /\b(?:clear (?:the )?lip|get (?:it|the ball) out|escape|more loft|loft|safe result|back in play)\b/.test(text);
  }
  return false;
}

function resultPacket({ baseAccuracy, bonus, grade, reason, explanation, evidence }) {
  const base = Math.round(clamp(Number(baseAccuracy) || 0, 0, 100));
  const awarded = Math.min(Math.max(0, bonus), Math.max(0, ADJUSTMENT_ACCURACY_CAP - base));
  return {
    version: ADJUSTMENT_REWARD_VERSION,
    grade,
    reason,
    explanation,
    evidence,
    base_accuracy: base,
    accuracy_bonus: awarded,
    effective_accuracy: base + awarded,
    shot_only: true
  };
}

export function gradeAdjustmentReward({
  instructions = [],
  sidehillPlan = null,
  slope = "playing nearly level",
  clubAdjustment = 0,
  lie = "Fairway",
  baseAccuracy = 0
} = {}) {
  const text = instructionText(instructions);
  const sidehillDeclared = declaredSidehillAdjustment(text);
  const statedClubAdjustment = declaredClubAdjustment(text);
  const expectedClubAdjustment = slope === "uphill" ? 1 : slope === "downhill" ? -1 : 0;
  const appliedClubAdjustment = Number(clubAdjustment) || 0;
  const evidence = {
    sidehill_declared: sidehillDeclared,
    sidehill_compensation: sidehillPlan?.compensation || "not_required",
    expected_aim_yards: sidehillPlan?.recommended_aim_yards ?? 0,
    player_aim_yards: sidehillPlan?.player_aim_yards ?? 0,
    stated_club_adjustment: statedClubAdjustment,
    applied_club_adjustment: appliedClubAdjustment,
    expected_club_adjustment: expectedClubAdjustment,
    lie
  };

  if (!text.trim()) {
    return resultPacket({
      baseAccuracy, bonus: 0, grade: "not_declared", reason: "no_adjustment_declared",
      explanation: "No player adjustment was declared for this shot.", evidence
    });
  }

  if (sidehillDeclared && sidehillPlan && sidehillPlan.compensation !== "not_required") {
    if (sidehillPlan.compensation !== "correct") {
      return resultPacket({
        baseAccuracy, bonus: 0, grade: "incorrect", reason: "lie_not_respected",
        explanation: sidehillPlan.compensation === "wrong_direction"
          ? "The declared aim moved with the sidehill curve instead of against it."
          : "The declared sidehill aim did not match the recommended allowance.",
        evidence
      });
    }
    const expected = Math.max(Math.abs(sidehillPlan.recommended_aim_yards), .01);
    const ratio = Math.abs(sidehillPlan.player_aim_yards) / expected;
    const excellent = ratio >= .75 && ratio <= 1.35;
    const slopeAlsoCorrect = expectedClubAdjustment !== 0 &&
      statedClubAdjustment === expectedClubAdjustment && appliedClubAdjustment === expectedClubAdjustment;
    return resultPacket({
      baseAccuracy,
      bonus: excellent || slopeAlsoCorrect ? 15 : 8,
      grade: excellent || slopeAlsoCorrect ? "excellent" : "sound",
      reason: "lie_respected",
      explanation: excellent
        ? "The declared aim direction and amount closely matched the sidehill requirement."
        : "The declared aim correctly opposed the sidehill curve, with an imperfect amount.",
      evidence
    });
  }

  const liePlanDeclared = declaredLiePlan(text, lie);
  if (liePlanDeclared && expectedClubAdjustment === 0) {
    return resultPacket({
      baseAccuracy, bonus: 4, grade: "partial", reason: "lie_respected",
      explanation: lie === "Bunker"
        ? "The declared plan prioritized loft and clearing the bunker lip."
        : "The declared plan respected the reduced control from the rough.",
      evidence
    });
  }

  if (statedClubAdjustment !== 0) {
    const correct = expectedClubAdjustment !== 0 &&
      statedClubAdjustment === expectedClubAdjustment && appliedClubAdjustment === expectedClubAdjustment;
    return resultPacket({
      baseAccuracy,
      bonus: correct ? 8 : 0,
      grade: correct ? "sound" : "incorrect",
      reason: correct ? "lie_respected" : "lie_not_respected",
      explanation: correct
        ? `The declared club adjustment correctly accounted for the ${slope} shot.`
        : expectedClubAdjustment === 0
          ? "A club adjustment was declared, but the shot is playing nearly level."
          : `The declared club adjustment did not match the ${slope} requirement.`,
      evidence
    });
  }

  if (liePlanDeclared) {
    return resultPacket({
      baseAccuracy, bonus: 4, grade: "partial", reason: "lie_respected",
      explanation: lie === "Bunker"
        ? "The declared plan prioritized loft and clearing the bunker lip."
        : "The declared plan respected the reduced control from the rough.",
      evidence
    });
  }

  return resultPacket({
    baseAccuracy, bonus: 0, grade: "not_recognized", reason: "no_verified_adjustment",
    explanation: "The instruction did not contain a condition adjustment the game could verify.", evidence
  });
}
