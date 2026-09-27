export const SHORT_GAME_MODEL_VERSION = "landing-target-rule-of-12-v1";

export const AimType = Object.freeze({
  DIRECTION_TARGET: "direction_target",
  LANDING_TARGET: "landing_target"
});

export const PowerStatus = Object.freeze({
  REACHABLE: "REACHABLE",
  MARGINAL: "MARGINAL",
  UNREACHABLE: "UNREACHABLE",
  UNSAFE_TRAJECTORY: "UNSAFE_TRAJECTORY"
});

const MIN_PRACTICAL_POWER = .08;
const COMFORTABLE_MIN_POWER = .15;
const MAX_POWER = 1;
const MARGINAL_MAX_POWER = 1.08;

function bounded(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value)));
}

export function nominalAimCarryYards({ aimType, targetDistanceYards, clubCarryYards, power, lieMultiplier = 1 }) {
  const targetDistance = Number(targetDistanceYards);
  if (aimType === AimType.LANDING_TARGET) return targetDistance;
  return Math.max(1, Number(clubCarryYards) * Number(power) * Number(lieMultiplier));
}

export function solveShortGamePower({ clubCarryYards, desiredCarryYards, lieMultiplier = 1 }) {
  const fullCarry = Number(clubCarryYards) * Number(lieMultiplier);
  const desiredCarry = Number(desiredCarryYards);
  if (!Number.isFinite(fullCarry) || fullCarry <= 0 || !Number.isFinite(desiredCarry) || desiredCarry <= 0) {
    return {
      status: PowerStatus.UNREACHABLE,
      power: null,
      power_percent: null,
      expected_carry_yards: null,
      desired_carry_yards: desiredCarry
    };
  }
  const rawPower = desiredCarry / fullCarry;
  const status = rawPower < MIN_PRACTICAL_POWER || rawPower > MARGINAL_MAX_POWER
    ? PowerStatus.UNREACHABLE
    : rawPower < COMFORTABLE_MIN_POWER || rawPower > MAX_POWER
      ? PowerStatus.MARGINAL
      : PowerStatus.REACHABLE;
  const power = bounded(rawPower, MIN_PRACTICAL_POWER, MAX_POWER);
  return {
    status,
    power,
    power_percent: Math.round(power * 100),
    raw_power: rawPower,
    expected_carry_yards: Math.round(fullCarry * power * 10) / 10,
    desired_carry_yards: Math.round(desiredCarry * 10) / 10,
    full_carry_yards: Math.round(fullCarry * 10) / 10
  };
}

export function ruleOf12ClubNumber(rollToCarryRatio) {
  if (!Number.isFinite(rollToCarryRatio) || rollToCarryRatio < 0) return null;
  return bounded(Math.round(12 - rollToCarryRatio), 7, 11);
}

export function shortGameClubNumber(clubName) {
  const name = String(clubName || "").toLowerCase();
  const iron = name.match(/(?:^|\s)([7-9])\s*iron/);
  if (iron) return Number(iron[1]);
  if (name.includes("pitching wedge")) return 10;
  if (name.includes("gap wedge")) return 10.5;
  if (name.includes("sand wedge")) return 11;
  if (name.includes("lob wedge")) return 11.5;
  return null;
}

export function generateRuleOf12Candidates({ clubs, carryDistanceYards, rollDistanceYards, lieMultiplier = 1 }) {
  const carry = Number(carryDistanceYards);
  const roll = Math.max(0, Number(rollDistanceYards));
  const ratio = carry > 0 ? roll / carry : Number.POSITIVE_INFINITY;
  const suggestedNumber = ruleOf12ClubNumber(ratio);
  return (clubs || []).map((club, clubIndex) => {
    const clubNumber = shortGameClubNumber(club.name);
    if (clubNumber === null) return null;
    const power = solveShortGamePower({
      clubCarryYards: club.carry,
      desiredCarryYards: carry,
      lieMultiplier
    });
    return {
      club_index: clubIndex,
      club_name: club.name,
      club_number: clubNumber,
      rule_of_12_distance: suggestedNumber === null ? null : Math.abs(clubNumber - suggestedNumber),
      rule_of_12_candidate: suggestedNumber !== null && Math.abs(clubNumber - suggestedNumber) <= .5,
      roll_to_carry_ratio: Number.isFinite(ratio) ? Math.round(ratio * 100) / 100 : null,
      ...power
    };
  }).filter(Boolean).sort((first, second) =>
    (first.status === PowerStatus.UNREACHABLE) - (second.status === PowerStatus.UNREACHABLE) ||
    (first.rule_of_12_distance ?? 99) - (second.rule_of_12_distance ?? 99) ||
    first.club_index - second.club_index
  );
}

export function expectedShortGameRoll({ carryYards, rollRatio, slopeFactor = 1, landingSurface = "green" }) {
  const surfaceFactor = landingSurface === "green" ? 1 : .65;
  return Math.max(0, Number(carryYards) * Number(rollRatio) * Number(slopeFactor) * surfaceFactor);
}

export function recommendNonPutterClubIndex({ clubs, targetDistanceYards, lieMultiplier = 1, startSurface = "" }) {
  const target = Number(targetDistanceYards);
  const driverAllowed = String(startSurface).trim().toLowerCase() === "tee";
  const candidates = (clubs || [])
    .map((club, index) => ({
      index,
      club,
      difference: Math.abs(Number(club.carry) * Number(lieMultiplier) - target)
    }))
    .filter(candidate =>
      !String(candidate.club?.name || "").toLowerCase().includes("putter") &&
      (driverAllowed || !String(candidate.club?.name || "").toLowerCase().includes("driver")) &&
      Number.isFinite(candidate.difference)
    )
    .sort((first, second) => first.difference - second.difference || first.index - second.index);
  return candidates[0]?.index ?? -1;
}

export function markUnsafeTrajectory(candidate, unsafe) {
  return unsafe ? { ...candidate, status: PowerStatus.UNSAFE_TRAJECTORY } : candidate;
}
