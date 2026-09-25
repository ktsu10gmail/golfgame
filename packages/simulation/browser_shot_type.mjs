export const RULE_OF_12_MAX_CARRY_YARDS = 30;

export const ShotType = Object.freeze({
  DRIVING: "driving",
  LAY_UP: "lay_up",
  APPROACH: "approach",
  CHIP_AND_RUN: "chip_and_run",
  BUNKER: "bunker",
  RECOVERY: "recovery",
  PUTTING: "putting"
});

export const SHOT_TYPE_LABELS = Object.freeze({
  [ShotType.DRIVING]: "Driving",
  [ShotType.LAY_UP]: "Lay up",
  [ShotType.APPROACH]: "Approach",
  [ShotType.CHIP_AND_RUN]: "Chip and run",
  [ShotType.BUNKER]: "Bunker shot",
  [ShotType.RECOVERY]: "Recovery",
  [ShotType.PUTTING]: "Putting"
});

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function landingTargetAllowed({ lie, clubName }) {
  return String(lie || "").toLowerCase() !== "green" &&
    String(clubName || "").toLowerCase() !== "putter";
}

export function recommendShotType({
  lie,
  clubName,
  distanceToPinYards,
  targetDistanceYards = null,
  targetSurface = null,
  effectiveCarryYards = 0,
  landingTarget = false
}) {
  const normalizedLie = String(lie || "").toLowerCase();
  const normalizedClub = String(clubName || "").toLowerCase();
  const distanceToPin = finiteOrNull(distanceToPinYards) ?? 0;
  const targetDistance = finiteOrNull(targetDistanceYards);
  const effectiveCarry = finiteOrNull(effectiveCarryYards) ?? 0;

  if (normalizedLie === "green" || normalizedClub === "putter") return ShotType.PUTTING;
  if (normalizedLie === "trees") return ShotType.RECOVERY;
  if (normalizedLie === "bunker") return ShotType.BUNKER;
  const shortGameDistance = landingTarget ? (targetDistance ?? distanceToPin) : distanceToPin;
  if (shortGameDistance <= RULE_OF_12_MAX_CARRY_YARDS) {
    return ShotType.CHIP_AND_RUN;
  }
  if (normalizedLie === "tee" && /driver|wood|hybrid/.test(normalizedClub) && distanceToPin >= 180) {
    return ShotType.DRIVING;
  }
  const targetLeavesMeaningfulApproach = targetDistance !== null &&
    String(targetSurface || "").toLowerCase() !== "green" &&
    distanceToPin - targetDistance >= 35;
  if (targetLeavesMeaningfulApproach || distanceToPin > Math.max(210, effectiveCarry + 40)) {
    return ShotType.LAY_UP;
  }
  return ShotType.APPROACH;
}

export function validateShotType({ shotType, lie, clubName, targetDistanceYards }) {
  const targetDistance = finiteOrNull(targetDistanceYards);
  const puttingSetup = String(lie || "").toLowerCase() === "green" &&
    String(clubName || "").toLowerCase() === "putter";
  if (puttingSetup && shotType !== ShotType.PUTTING) {
    return { valid: false, message: "Choose Putting for a Putter shot from the green." };
  }
  if (shotType === ShotType.CHIP_AND_RUN &&
      (targetDistance === null || targetDistance > RULE_OF_12_MAX_CARRY_YARDS)) {
    return {
      valid: false,
      message: `Chip and run is supported for landing targets up to ${RULE_OF_12_MAX_CARRY_YARDS} yards. Choose Approach for this longer shot.`
    };
  }
  if (shotType === ShotType.PUTTING && !puttingSetup) {
    return { valid: false, message: "Putting requires the ball to be on the green with Putter selected." };
  }
  return { valid: true, message: "" };
}

export function shotTypeUsesGreensideEngine({ shotType, targetDistanceYards }) {
  const targetDistance = finiteOrNull(targetDistanceYards);
  return [ShotType.CHIP_AND_RUN, ShotType.BUNKER].includes(shotType) &&
    targetDistance !== null && targetDistance <= RULE_OF_12_MAX_CARRY_YARDS;
}
