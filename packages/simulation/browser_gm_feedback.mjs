export const PLAYER_SAFE_SHOT_ERROR = "The shot could not be completed. Your ball and score have not changed. Please try again. If this continues, return to the hole and resume the round.";
export const GM_RECOMMENDATION_FALLBACK = "I could not calculate a recommendation for this position. Your shot setup has not changed. Select a club and target manually, or try Recommendation again.";

export function gameMasterTargetSuggestion({ viewMode, remainingYards, par, teeYards }) {
  if (viewMode === "putting") return { label: "Aim at cup", command: "Aim at cup" };
  if (Number(remainingYards) <= 210) return { label: "Aim at pin", command: "Aim at pin" };
  const layup = Number(par) === 5 && Number(remainingYards) < Number(teeYards) * .62;
  return layup
    ? { label: "Layup center", command: "Layup center" }
    : { label: "Fairway center", command: "Aim fairway center" };
}

export function hasGameMasterReply(messages, startIndex = 0) {
  return (Array.isArray(messages) ? messages : [])
    .slice(Math.max(0, Number(startIndex) || 0))
    .some(message => message?.role !== "player" && String(message?.text || "").trim());
}

export function puttAnalysisMatchLabels({
  aimCorrect,
  paceCorrect,
  aimErrorInches,
  playerPace,
  recommendedPace
}) {
  const exactAim = Boolean(aimCorrect) && Number(aimErrorInches) < .5;
  const displayedPaceMatches = Number(playerPace) === Number(recommendedPace);
  const maximumModeledPace = !paceCorrect && displayedPaceMatches && Number(recommendedPace) === 100;
  return {
    aim: exactAim ? "Matched model" : aimCorrect ? "Within model tolerance" : "Review",
    pace: paceCorrect
      ? displayedPaceMatches ? "Matched model" : "Within model tolerance"
      : maximumModeledPace
        ? "Maximum modeled pace"
        : displayedPaceMatches
          ? "At model pace"
          : "Review",
    maximumModeledPace
  };
}

export function recommendationTargetAdvice({ viewMode, recoveryRequired, greenReachable, par, startSurface }) {
  if (viewMode === "putting") return "Aim at the cup.";
  if (recoveryRequired) {
    return "Do not aim at the green through the trees. Choose one of the recovery plans and restore a playable position first.";
  }
  if (greenReachable) {
    return "Aim at the center of the green; use a named caddie plan when you want a verified hazard-specific target.";
  }
  if (Number(par) === 3 && String(startSurface).toLowerCase() === "tee") {
    return "The green is beyond this club's modeled reach. Choose a club that can cover the distance, or play to the safest short-of-green area—this is not a layup hole.";
  }
  return "The green is not reachable with that club. Aim for the center of a reachable fairway or layup area.";
}

export function completedHoleDestination(completedHoleIndex, totalHoles = 18) {
  const index = Number(completedHoleIndex);
  const count = Number(totalHoles);
  if (!Number.isInteger(index) || !Number.isInteger(count) || count < 1 || index < 0 || index >= count - 1) return null;
  return index + 1;
}

export function modeledMakeChanceLabel(probability) {
  if (probability == null || probability === "") return "Unavailable";
  const numeric = Number(probability);
  if (!Number.isFinite(numeric)) return "Unavailable";
  const percentage = Math.max(0, numeric * 100);
  return percentage < 1 ? "under 1%" : `${Math.round(percentage)}%`;
}

export function remainingDistanceBadge({ putting, remainingYards, holeFinished = false, completionType = null }) {
  if (putting && holeFinished && completionType === "gimme") {
    return { value: "Gimme", label: "Hole complete" };
  }
  if (putting && holeFinished && completionType === "holed") {
    return { value: "Holed", label: "In cup" };
  }
  const remaining = Math.max(0, Number(remainingYards) || 0);
  if (!putting) return { value: String(Math.round(remaining)), label: "yd left" };
  const feet = remaining * 3;
  return feet < 1
    ? { value: String(Math.max(1, Math.round(feet * 12))), label: "in from cup" }
    : { value: String(Math.round(feet)), label: "ft from cup" };
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
