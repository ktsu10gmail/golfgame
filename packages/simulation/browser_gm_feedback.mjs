export const PLAYER_SAFE_SHOT_ERROR = "The shot could not be completed. Your ball and score have not changed. Please try again. If this continues, return to the hole and resume the round.";

export function modeledMakeChanceLabel(probability) {
  if (probability == null || probability === "") return "Unavailable";
  const numeric = Number(probability);
  if (!Number.isFinite(numeric)) return "Unavailable";
  const percentage = Math.max(0, numeric * 100);
  return percentage < 1 ? "under 1%" : `${Math.round(percentage)}%`;
}

export function clubCanReachTarget({ distanceYards, carryYards, lieMultiplier = 1, elevationFeet = 0 }) {
  const distance = Number(distanceYards);
  const carry = Number(carryYards);
  const lie = Number(lieMultiplier);
  const elevation = Number(elevationFeet);
  if (![distance, carry, lie, elevation].every(Number.isFinite) || distance < 0 || carry <= 0 || lie <= 0) {
    return false;
  }
  const playsLikeDistance = distance + Math.max(0, elevation) * .5;
  return carry * lie + 3 >= playsLikeDistance;
}

export function shotConditionBriefing({
  includeDistance = true,
  remainingYards,
  lie,
  stanceType,
  stance,
  slope,
  elevationFeet = 0,
  sidehillAdvice = ""
}) {
  const sentences = [];
  if (includeDistance && Number.isFinite(Number(remainingYards))) {
    sentences.push(`You have ${Math.round(Number(remainingYards))} yards to the pin from ${String(lie || "the current lie").toLowerCase()}.`);
  }
  if (stanceType && stanceType !== "level" && stance) {
    sentences.push(`You have ${stance}.`);
  }
  if (slope && slope !== "playing nearly level") {
    const amount = Math.abs(Number(elevationFeet));
    sentences.push(`The shot plays ${slope}${Number.isFinite(amount) && amount >= 4 ? ` by about ${Math.round(amount)} feet` : ""}.`);
  }
  const advice = String(sidehillAdvice || "").trim();
  if (advice) sentences.push(advice);
  return sentences.join(" ");
}

export function formatBreak(inches) {
  const amount = Math.abs(Number(inches));
  if (!Number.isFinite(amount)) return "0 inches";
  if (amount < 12) {
    const rounded = Math.round(amount);
    return `${rounded} ${rounded === 1 ? "inch" : "inches"}`;
  }
  const feet = Math.round(amount / 12 * 10) / 10;
  return `${feet} ${feet === 1 ? "foot" : "feet"}`;
}

export function outcomeDelta(start, target, landing, yardsPerUnit = 1) {
  const validPoint = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
  if (!validPoint(start) || !validPoint(target) || !validPoint(landing)) return null;
  if (!Number.isFinite(yardsPerUnit) || yardsPerUnit <= 0) return null;
  const dx = target[0] - start[0];
  const dy = target[1] - start[1];
  const targetDistance = Math.hypot(dx, dy);
  if (targetDistance <= 1e-9) return null;
  const ux = dx / targetDistance;
  const uy = dy / targetDistance;
  const actualX = landing[0] - start[0];
  const actualY = landing[1] - start[1];
  const longitudinalUnits = actualX * ux + actualY * uy - targetDistance;
  const rightX = uy;
  const rightY = -ux;
  const lateralUnits = actualX * rightX + actualY * rightY;
  return {
    lateral_yards: lateralUnits * yardsPerUnit,
    distance_yards: longitudinalUnits * yardsPerUnit
  };
}
