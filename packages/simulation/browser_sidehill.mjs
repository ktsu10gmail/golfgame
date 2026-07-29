// Browser port of packages/simulation/sidehill.py. Keep numerical changes paired.

export const SIDEHILL_MODEL_VERSION = "sidehill-v1";

function clamp(value, lower, upper) {
  return Math.min(upper, Math.max(lower, value));
}

function roundTo(value, places = 2) {
  const factor = 10 ** places;
  return Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * factor) / factor;
}

export function analyzeSidehillShot({
  stance,
  lateralDistanceYards,
  shotDistanceYards,
  playerAimYards = 0
}) {
  if (!["level", "ball_below_feet", "ball_above_feet"].includes(stance)) {
    throw new Error("stance must be level, ball_below_feet, or ball_above_feet");
  }
  if (![lateralDistanceYards, shotDistanceYards, playerAimYards].every(Number.isFinite)) {
    throw new Error("sidehill inputs must be finite");
  }
  if (lateralDistanceYards < 0 || shotDistanceYards < 0) {
    throw new Error("sidehill distances cannot be negative");
  }
  if (stance === "level") {
    return {
      stance,
      severity: "level",
      expected_curve_yards: 0,
      recommended_aim_yards: 0,
      player_aim_yards: roundTo(playerAimYards),
      compensation: "not_required"
    };
  }

  let severity;
  let severityFactor;
  if (lateralDistanceYards < 12) {
    severity = "mild";
    severityFactor = .75;
  } else if (lateralDistanceYards < 22) {
    severity = "moderate";
    severityFactor = 1;
  } else {
    severity = "severe";
    severityFactor = 1.35;
  }

  const curveAmount = clamp(shotDistanceYards * .025 * severityFactor, 1.5, 12);
  const expectedCurve = stance === "ball_below_feet" ? curveAmount : -curveAmount;
  const recommendedAim = -expectedCurve;
  const sameDirection = playerAimYards * recommendedAim > 0;
  const ratio = Math.abs(playerAimYards) / Math.max(Math.abs(recommendedAim), .01);
  let compensation;
  if (Math.abs(playerAimYards) < .75) compensation = "missing";
  else if (!sameDirection) compensation = "wrong_direction";
  else if (ratio > 2.25) compensation = "overcompensated";
  else if (ratio >= .35) compensation = "correct";
  else compensation = "missing";

  return {
    stance,
    severity,
    expected_curve_yards: roundTo(expectedCurve),
    recommended_aim_yards: roundTo(recommendedAim),
    player_aim_yards: roundTo(playerAimYards),
    compensation
  };
}
