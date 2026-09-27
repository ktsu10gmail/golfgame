export const STRATEGY_CHOICES_VERSION = "strategy-choices-v12";
export const TREE_RECOVERY_MODEL_VERSION = "tree-recovery-v2";

const SWING_LEVELS = [.25, .5, .75, 1];

const PENALTY_SURFACES = new Set(["water", "out_of_bounds"]);
const TROUBLE_SURFACES = new Set(["water", "out_of_bounds", "bunker"]);
const POOR_SURFACES = new Set(["bunker", "rough", "native"]);

function bounded(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function nearestSwingLevel(power, minimumPower = .25) {
  const choices = SWING_LEVELS.filter(level => level >= minimumPower - 1e-9);
  return choices.sort((first, second) => Math.abs(first - power) - Math.abs(second - power))[0] || 1;
}

function swingLabel(power) {
  return ({ 25: "quarter", 50: "half", 75: "three-quarter", 100: "full" })[Math.round(power * 100)] || "full";
}

function distance(first, second) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function pointOnSegment(point, start, end, tolerance = 1e-6) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= tolerance ** 2) return distance(point, start) <= tolerance;
  const cross = (point.y - start.y) * dx - (point.x - start.x) * dy;
  if (Math.abs(cross) / Math.sqrt(lengthSquared) > tolerance) return false;
  const dot = (point.x - start.x) * dx + (point.y - start.y) * dy;
  return dot >= -tolerance && dot <= lengthSquared + tolerance;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  let previous = polygon.at(-1);
  for (const current of polygon) {
    if (pointOnSegment(point, previous, current)) return true;
    if ((current.y > point.y) !== (previous.y > point.y)) {
      const intersection = (previous.x - current.x) * (point.y - current.y) /
        (previous.y - current.y) + current.x;
      if (point.x < intersection) inside = !inside;
    }
    previous = current;
  }
  return inside;
}

function centroid(polygon) {
  return polygon.reduce(
    (total, point) => ({ x: total.x + point.x / polygon.length, y: total.y + point.y / polygon.length }),
    { x: 0, y: 0 }
  );
}

function pointAlongPolylineFromEnd(points, yardsFromEnd) {
  let remaining = Math.max(0, yardsFromEnd);
  for (let index = points.length - 1; index > 0; index -= 1) {
    const end = points[index];
    const start = points[index - 1];
    const segmentLength = distance(start, end);
    if (remaining <= segmentLength) {
      const ratio = remaining / Math.max(segmentLength, 1e-9);
      return {
        x: end.x + (start.x - end.x) * ratio,
        y: end.y + (start.y - end.y) * ratio
      };
    }
    remaining -= segmentLength;
  }
  return { ...points[0] };
}

function surfaceAt(point, surfaces) {
  const match = [...surfaces]
    .sort((first, second) => second.priority - first.priority)
    .find(surface => pointInPolygon(point, surface.polygon));
  return match?.surface || "rough";
}

function pointToSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-9) return distance(point, start);
  const progress = bounded(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
    0,
    1
  );
  return distance(point, { x: start.x + dx * progress, y: start.y + dy * progress });
}

function distanceToPolygon(point, polygon) {
  if (pointInPolygon(point, polygon)) return 0;
  return Math.min(...polygon.map((current, index) =>
    pointToSegmentDistance(point, polygon[index === 0 ? polygon.length - 1 : index - 1], current)
  ));
}

function nearestTrouble(point, surfaces) {
  const trouble = surfaces
    .filter(surface => TROUBLE_SURFACES.has(surface.surface))
    .map(surface => ({ surface: surface.surface, distance: distanceToPolygon(point, surface.polygon) }))
    .sort((first, second) => first.distance - second.distance)[0];
  return trouble || { surface: null, distance: Infinity };
}

function lineHazards(start, target, surfaces) {
  const encountered = new Set();
  for (let step = 1; step <= 32; step += 1) {
    const progress = step / 32;
    const point = {
      x: start.x + (target.x - start.x) * progress,
      y: start.y + (target.y - start.y) * progress
    };
    const surface = surfaceAt(point, surfaces);
    if (TROUBLE_SURFACES.has(surface)) encountered.add(surface);
  }
  return [...encountered];
}

function chooseClub(clubs, requiredCarry, lieMultiplier, { accuracyBias = 0 } = {}) {
  return clubs
    .map((club, clubIndex) => ({ ...club, clubIndex: club.clubIndex ?? clubIndex }))
    .filter(club => !club.name.toLowerCase().includes("putter"))
    .sort((first, second) => {
      const firstScore = Math.abs(first.carry * lieMultiplier - requiredCarry) - first.accuracy * accuracyBias;
      const secondScore = Math.abs(second.carry * lieMultiplier - requiredCarry) - second.accuracy * accuracyBias;
      return firstScore - secondScore || second.accuracy - first.accuracy;
    })[0];
}

function chooseNormalSwingClub(clubs, requiredFinish, lieMultiplier, { includeRoll = true } = {}) {
  const candidates = clubs
    .map(club => {
      const fullCarry = club.carry * lieMultiplier;
      const roll = includeRoll ? expectedRollYards(club, lieMultiplier) : 0;
      const requiredShotCarry = Math.max(1, requiredFinish - roll);
      const plannedPower = requiredShotCarry / Math.max(fullCarry, 1);
      return { club, plannedPower };
    })
    .filter(candidate => candidate.plannedPower >= .55 && candidate.plannedPower <= 1.03)
    .sort((first, second) => {
      const firstNormal = first.plannedPower >= .9 && first.plannedPower <= 1.01;
      const secondNormal = second.plannedPower >= .9 && second.plannedPower <= 1.01;
      if (firstNormal !== secondNormal) return firstNormal ? -1 : 1;
      const firstScore = Math.abs(.97 - Math.min(first.plannedPower, 1)) * 100 - first.club.accuracy * .08;
      const secondScore = Math.abs(.97 - Math.min(second.plannedPower, 1)) * 100 - second.club.accuracy * .08;
      return firstScore - secondScore;
    });
  return candidates[0]?.club || chooseClub(clubs, requiredFinish, lieMultiplier, { accuracyBias: .3 });
}

function chooseSafeApproachClub(clubs, requiredCarry, lieMultiplier) {
  return chooseNormalSwingClub(clubs, requiredCarry, lieMultiplier, { includeRoll: true });
}

function targetForCarry(start, aimPoint, carryYards) {
  const aimDistance = distance(start, aimPoint);
  if (aimDistance <= 1e-9) return { ...aimPoint };
  const ratio = carryYards / aimDistance;
  return {
    x: start.x + (aimPoint.x - start.x) * ratio,
    y: start.y + (aimPoint.y - start.y) * ratio
  };
}

function expectedRollYards(club, lieMultiplier) {
  const name = club.name.toLowerCase();
  const stockRoll = name.includes("driver") ? 18
    : name.includes("wood") ? 12
      : name.includes("hybrid") ? 9
        : name.includes("wedge") ? 3
          : 5;
  return stockRoll * lieMultiplier;
}

function plan({
  id, title, objective, targetLabel, mode, start, pin, aimPoint, club,
  lieMultiplier, surfaces, preferredApproachYards, minimumPower = .75
}) {
  const requiredFinish = distance(start, aimPoint);
  const fullCarry = club.carry * lieMultiplier;
  const rollYards = mode === "approach" ? expectedRollYards(club, lieMultiplier) : 0;
  const requiredCarry = Math.max(1, requiredFinish - rollYards);
  const requestedPower = bounded(requiredCarry / Math.max(fullCarry, 1), minimumPower, 1);
  const power = nearestSwingLevel(requestedPower, minimumPower);
  const carry = fullCarry * power;
  const target = targetForCarry(start, aimPoint, carry);
  const expectedFinish = mode === "approach"
    ? targetForCarry(start, aimPoint, carry + rollYards)
    : target;
  const landingSurface = surfaceAt(target, surfaces);
  const finishSurface = surfaceAt(expectedFinish, surfaces);
  const hazards = lineHazards(start, expectedFinish, surfaces);
  const trouble = nearestTrouble(expectedFinish, surfaces);
  const leavesYards = distance(expectedFinish, pin);
  const advancement = Math.max(0, distance(start, pin) - leavesYards);
  let risk = (100 - club.accuracy) * .55;
  if (PENALTY_SURFACES.has(landingSurface)) risk += 45;
  else if (POOR_SURFACES.has(landingSurface)) risk += landingSurface === "bunker" ? 22 : 12;
  if (finishSurface !== landingSurface) {
    if (PENALTY_SURFACES.has(finishSurface)) risk += 45;
    else if (POOR_SURFACES.has(finishSurface)) risk += finishSurface === "bunker" ? 22 : 12;
  }
  risk += hazards.filter(surface => PENALTY_SURFACES.has(surface)).length * 18;
  risk += hazards.includes("bunker") ? 7 : 0;
  if (trouble.distance < 8) risk += 20;
  else if (trouble.distance < 15) risk += 10;
  else if (trouble.distance < 25) risk += 4;
  const partialSwingPenalty = power < .9
    ? Math.round((.9 - power) * 70 + (club.name.toLowerCase().includes("wedge") ? 0 : 4))
    : 0;
  risk += partialSwingPenalty;
  risk = Math.round(bounded(risk, 1, 99));
  const approachPenalty = mode === "approach"
    ? leavesYards * .55
    : Math.abs(leavesYards - preferredApproachYards) /
      Math.max(preferredApproachYards, 1) * 18;
  const finishBonus = leavesYards <= 18 ? 24 : leavesYards <= 35 ? 12 : 0;
  const scoringSurface = mode === "approach" ? finishSurface : landingSurface;
  const surfacePenalty = scoringSurface === "fairway" || scoringSurface === "green" ? 0 :
    scoringSurface === "bunker" ? 18 : PENALTY_SURFACES.has(scoringSurface) ? 42 : 9;
  const scoringIndex = Math.round(risk * .55 + approachPenalty + surfacePenalty - finishBonus);
  const landingLabel = landingSurface.replaceAll("_", " ");
  const liePercent = Math.round(lieMultiplier * 100);
  const powerPercent = Math.round(power * 100);
  const reasons = [
    `This plan targets ${targetLabel.toLowerCase()}.`,
    `${club.name} is ${Math.round(club.carry)} yards normally; the ${liePercent}% lie adjustment and ${swingLabel(power)} swing produce about ${Math.round(carry)} yards of carry.`,
    power === 1
      ? "This uses a full swing, which is preferred when the mapped clearance is adequate."
      : `This uses a ${swingLabel(power)} swing; the partial swing adds ${partialSwingPenalty} points of execution risk.`,
    mode === "approach"
      ? `Allow about ${Math.round(rollYards)} yards of rollout after landing; the expected finish leaves ${Math.round(leavesYards)} yards.`
      : leavesYards <= 8
        ? "The planned landing finishes at the green target."
        : `The planned landing leaves about ${Math.round(leavesYards)} yards.`,
    landingSurface === "fairway"
      ? "The landing point is in the mapped fairway."
      : landingSurface === "green"
        ? "The landing point is on the mapped green."
        : `The mapped landing surface is ${landingLabel}.`,
    mode === "approach"
      ? finishSurface === landingSurface
        ? `The expected finish remains on the mapped ${finishSurface.replaceAll("_", " ")}.`
        : `The rollout is expected to finish on the mapped ${finishSurface.replaceAll("_", " ")}.`
      : null,
    hazards.length
      ? `The line brings ${hazards.join(" and ").replaceAll("_", " ")} into play.`
      : "The center line does not cross a mapped penalty hazard.",
    trouble.surface && trouble.distance < 40
      ? `The nearest mapped ${trouble.surface.replaceAll("_", " ")} is about ${Math.round(trouble.distance)} yards from the landing point.`
      : "No mapped bunker or penalty area is close to the landing point."
  ].filter(Boolean);
  return {
    version: STRATEGY_CHOICES_VERSION,
    mode,
    id,
    title,
    objective,
    targetLabel,
    clubIndex: club.clubIndex,
    clubName: club.name,
    stockCarryYards: Math.round(club.carry),
    lieAdjustedFullCarryYards: Math.round(fullCarry),
    power: Math.round(power * 100),
    swingType: power >= .9 ? "normal" : "partial",
    target,
    expectedFinish,
    carryYards: Math.round(carry),
    rollYards: Math.round(rollYards),
    leavesYards: Math.round(leavesYards),
    advancementYards: Math.round(advancement),
    landingSurface,
    finishSurface,
    hazards,
    nearestHazard: trouble.surface,
    hazardClearanceYards: Number.isFinite(trouble.distance) ? Math.round(trouble.distance) : null,
    partialSwingPenalty,
    risk,
    scoringIndex,
    reasons
  };
}

function safeAimPoint({ start, pin, centerline, fairways, desiredCarry }) {
  const remaining = distance(start, pin);
  const routeTarget = pointAlongPolylineFromEnd(centerline, Math.max(0, remaining - desiredCarry));
  const fairwayPoints = fairways.flatMap(polygon => {
    const center = centroid(polygon);
    return [
      center,
      ...polygon.flatMap(vertex => [.25, .5, .75].map(progress => ({
        x: center.x + (vertex.x - center.x) * progress,
        y: center.y + (vertex.y - center.y) * progress
      })))
    ].filter(point => pointInPolygon(point, polygon));
  });
  const candidates = [
    ...fairwayPoints,
    ...(fairways.some(polygon => pointInPolygon(routeTarget, polygon)) ? [routeTarget] : [])
  ].filter(point => {
    const progress = remaining - distance(point, pin);
    return progress > 10 && distance(start, point) <= desiredCarry * 1.12;
  });
  return candidates.sort((first, second) => {
    const firstFairway = fairways.some(polygon => pointInPolygon(first, polygon)) ? 0 : 35;
    const secondFairway = fairways.some(polygon => pointInPolygon(second, polygon)) ? 0 : 35;
    return firstFairway + Math.abs(distance(start, first) - desiredCarry) -
      (secondFairway + Math.abs(distance(start, second) - desiredCarry));
  })[0] || fairwayPoints
    .filter(point => remaining - distance(point, pin) > 10)
    .sort((first, second) => Math.abs(distance(start, first) - desiredCarry) -
      Math.abs(distance(start, second) - desiredCarry))[0] || routeTarget;
}

function directionalLabel(start, pin, center, target) {
  const forwardLength = Math.max(distance(start, pin), 1);
  const forward = { x: (pin.x - start.x) / forwardLength, y: (pin.y - start.y) / forwardLength };
  const right = { x: forward.y, y: -forward.x };
  const delta = { x: target.x - center.x, y: target.y - center.y };
  const lateral = delta.x * right.x + delta.y * right.y;
  const longitudinal = delta.x * forward.x + delta.y * forward.y;
  const lateralLabel = Math.abs(lateral) >= 3 ? (lateral > 0 ? "Right" : "Left") : "";
  const depthLabel = Math.abs(longitudinal) >= 3 ? (longitudinal > 0 ? "back" : "front") : "center";
  if (lateralLabel && depthLabel !== "center") return `${lateralLabel}-${depthLabel}`;
  if (lateralLabel) return `${lateralLabel}-center`;
  return depthLabel === "center" ? "Green center" : `${depthLabel[0].toUpperCase()}${depthLabel.slice(1)} green`;
}

function frontGreenTarget(start, pin, polygon, center) {
  const length = Math.max(distance(start, pin), 1);
  const forward = { x: (pin.x - start.x) / length, y: (pin.y - start.y) / length };
  const projections = polygon.map(point => ({ point, value: point.x * forward.x + point.y * forward.y }));
  const minimum = Math.min(...projections.map(item => item.value));
  const edge = projections.filter(item => item.value <= minimum + 1).map(item => item.point);
  const edgeCenter = centroid(edge.length ? edge : [projections.sort((a, b) => a.value - b.value)[0].point]);
  return { x: center.x * .5 + edgeCenter.x * .5, y: center.y * .5 + edgeCenter.y * .5 };
}

function safestGreenTarget(start, pin, polygon, center, surfaces) {
  const trouble = surfaces.filter(surface => TROUBLE_SURFACES.has(surface.surface));
  if (!trouble.some(surface => distanceToPolygon(center, surface.polygon) < 40)) return null;
  const candidates = polygon.map(vertex => ({
    x: center.x * .62 + vertex.x * .38,
    y: center.y * .62 + vertex.y * .38
  }));
  return candidates.sort((first, second) => {
    const firstClearance = nearestTrouble(first, surfaces).distance;
    const secondClearance = nearestTrouble(second, surfaces).distance;
    return secondClearance - firstClearance || distance(second, pin) - distance(first, pin);
  })[0];
}

function filteredClubs(clubs, lieMultiplier, startSurface) {
  const driverAllowed = startSurface === "tee";
  return clubs
    .map((club, clubIndex) => ({ ...club, clubIndex, effectiveCarry: club.carry * lieMultiplier }))
    .filter(club => {
      const name = club.name.toLowerCase();
      if (name.includes("putter")) return false;
      if (!driverAllowed && name.includes("driver")) return false;
      if (lieMultiplier <= .75 && name.includes("wood")) return false;
      return true;
    })
    .sort((first, second) => second.effectiveCarry - first.effectiveCarry);
}

function longChoices(context) {
  const { start, pin, centerline, fairways, surfaces, lieMultiplier, preferred, clubs } = context;
  const remaining = distance(start, pin);
  const maximumClub = clubs[0];
  const safeClub = clubs
    .filter(club => club.effectiveCarry >= maximumClub.effectiveCarry * .65)
    .sort((first, second) => second.accuracy - first.accuracy || second.effectiveCarry - first.effectiveCarry)[0];
  const balancedClub = clubs
    .filter(club => club.effectiveCarry >= maximumClub.effectiveCarry * .76 && club.clubIndex !== safeClub.clubIndex)
    .sort((first, second) => {
      const desired = maximumClub.effectiveCarry * .85;
      return Math.abs(first.effectiveCarry - desired) - first.accuracy * .04 -
        (Math.abs(second.effectiveCarry - desired) - second.accuracy * .04);
    })[0] || maximumClub;
  const attackAim = pointAlongPolylineFromEnd(centerline, Math.max(0, remaining - maximumClub.effectiveCarry));
  const safeAim = safeAimPoint({ start, pin, centerline, fairways, desiredCarry: safeClub.effectiveCarry });
  const normalSafeClub = chooseNormalSwingClub(clubs, distance(start, safeAim), lieMultiplier, { includeRoll: false });
  const preferredLayupReachable = remaining <= maximumClub.effectiveCarry + preferred + 8;
  const layupAim = preferredLayupReachable
    ? safeAimPoint({ start, pin, centerline, fairways, desiredCarry: Math.max(15, remaining - preferred) })
    : safeAimPoint({ start, pin, centerline, fairways, desiredCarry: balancedClub.effectiveCarry });
  return [
    plan({ id: "attack", title: "Attack", objective: "Maximum advancement", targetLabel: "Longest playable line", mode: "long",
      start, pin, aimPoint: attackAim, club: maximumClub, lieMultiplier, surfaces, preferredApproachYards: preferred }),
    plan({ id: "safe", title: "Safe advance", objective: "Easiest landing", targetLabel: "Fairway center", mode: "long",
      start, pin, aimPoint: safeAim, club: normalSafeClub, lieMultiplier, surfaces, preferredApproachYards: preferred }),
    plan({ id: "smart", title: "Smart layup", objective: preferredLayupReachable ? "Preferred approach distance" : "Balanced position",
      targetLabel: preferredLayupReachable ? `${Math.round(preferred)}-yard leave` : "Balanced fairway position", mode: "long",
      start, pin, aimPoint: layupAim, club: preferredLayupReachable
        ? chooseNormalSwingClub(clubs, distance(start, layupAim), lieMultiplier, { includeRoll: false })
        : balancedClub,
      lieMultiplier, surfaces, preferredApproachYards: preferred, minimumPower: .55 })
  ];
}

function approachChoices(context) {
  const { start, pin, surfaces, lieMultiplier, preferred, clubs } = context;
  const minimumPower = distance(start, pin) <= 30 ? .1 : .55;
  const green = surfaces.find(surface => surface.surface === "green");
  const greenCenter = green ? centroid(green.polygon) : pin;
  const safeTarget = green ? safestGreenTarget(start, pin, green.polygon, greenCenter, surfaces) : null;
  const thirdTarget = safeTarget || (green ? frontGreenTarget(start, pin, green.polygon, greenCenter) : greenCenter);
  const safePlan = plan({ id: "safe_miss", title: safeTarget ? "Safe miss" : "Front green", objective: safeTarget ? "Avoid costly miss" : "Front-green margin",
    targetLabel: safeTarget ? "Safe side away from trouble" : "Front-green margin", mode: "approach",
    start, pin, aimPoint: thirdTarget,
    club: chooseSafeApproachClub(clubs, distance(start, thirdTarget), lieMultiplier), lieMultiplier,
    surfaces, preferredApproachYards: preferred, minimumPower });
  const safeLandingLabel = safeTarget
    ? `${directionalLabel(start, pin, greenCenter, safePlan.target)} away from trouble`
    : directionalLabel(start, pin, greenCenter, safePlan.target);
  safePlan.targetLabel = safeLandingLabel;
  safePlan.reasons[0] = `This plan targets ${safeLandingLabel.toLowerCase()}.`;
  return [
    plan({ id: "attack_pin", title: "Attack pin", objective: "Closest look", targetLabel: "Pin line", mode: "approach",
      start, pin, aimPoint: pin, club: chooseClub(clubs, distance(start, pin), lieMultiplier), lieMultiplier,
      surfaces, preferredApproachYards: preferred, minimumPower }),
    plan({ id: "green_center", title: "Green center", objective: "Hit the green", targetLabel: "Green center", mode: "approach",
      start, pin, aimPoint: greenCenter, club: chooseClub(clubs, distance(start, greenCenter), lieMultiplier, { accuracyBias: .08 }),
      lieMultiplier, surfaces, preferredApproachYards: preferred, minimumPower }),
    safePlan
  ];
}

function recoveryChoices(context) {
  const { start, pin, centerline, fairways, surfaces, lieMultiplier, preferred, clubs } = context;
  const maximumClub = clubs[0];
  const escapeClub = clubs
    .filter(club => club.effectiveCarry >= Math.min(80, maximumClub.effectiveCarry * .45))
    .sort((first, second) => second.accuracy - first.accuracy || first.effectiveCarry - second.effectiveCarry)[0];
  const positionClub = clubs
    .filter(club => club.clubIndex !== escapeClub.clubIndex && club.effectiveCarry >= maximumClub.effectiveCarry * .6)
    .sort((first, second) => Math.abs(first.effectiveCarry - maximumClub.effectiveCarry * .72) -
      Math.abs(second.effectiveCarry - maximumClub.effectiveCarry * .72))[0] || maximumClub;
  const advanceAim = safeAimPoint({ start, pin, centerline, fairways, desiredCarry: maximumClub.effectiveCarry });
  const escapeAim = safeAimPoint({ start, pin, centerline, fairways, desiredCarry: escapeClub.effectiveCarry });
  const positionAim = safeAimPoint({ start, pin, centerline, fairways, desiredCarry: positionClub.effectiveCarry });
  return [
    plan({ id: "advance", title: "Advance", objective: "Most safe distance", targetLabel: "Forward fairway", mode: "recovery",
      start, pin, aimPoint: advanceAim, club: maximumClub, lieMultiplier, surfaces, preferredApproachYards: preferred }),
    plan({ id: "escape", title: "Escape", objective: "Easiest recovery", targetLabel: "Nearest fairway", mode: "recovery",
      start, pin, aimPoint: escapeAim, club: escapeClub, lieMultiplier, surfaces, preferredApproachYards: preferred }),
    plan({ id: "position", title: "Position", objective: "Best next angle", targetLabel: "Playable fairway angle", mode: "recovery",
      start, pin, aimPoint: positionAim, club: positionClub, lieMultiplier, surfaces, preferredApproachYards: preferred })
  ];
}

function recoveryPlans(context) {
  // Inside 30 yards, full-club recovery plans can fly beyond the hole before
  // their minimum supported swing is applied. Reuse the calibrated approach
  // construction, then retain the recovery classification for coaching.
  if (distance(context.start, context.pin) <= 30) {
    return approachChoices(context).map(choice => ({ ...choice, mode: "recovery" }));
  }
  return recoveryChoices(context);
}

export function choicesMeaningfullyDifferent(first, second) {
  if (first.clubIndex !== second.clubIndex) return true;
  if (Math.abs(first.power - second.power) >= 5) return true;
  if (distance(first.target, second.target) >= 5) return true;
  if (Math.abs(first.leavesYards - second.leavesYards) >= 8) return true;
  if (first.landingSurface !== second.landingSurface) return true;
  if (first.hazards.slice().sort().join("|") !== second.hazards.slice().sort().join("|")) return true;
  return Math.abs(first.risk - second.risk) >= 8;
}

function finalizeChoices(choices) {
  const distinct = choices.filter(choice =>
    choices.slice(0, choices.indexOf(choice)).every(previous => choicesMeaningfullyDifferent(choice, previous))
  );
  const ranked = [...distinct].sort((first, second) => first.scoringIndex - second.scoringIndex);
  return distinct.map(choice => {
    const rank = ranked.findIndex(item => item.id === choice.id);
    const outlook = rank === 0 ? "Best" : rank === 1 ? "Competitive" : "Higher risk";
    return {
      ...choice,
      outlook,
      reasons: [
        rank === 0
          ? `This option is the calculated recommendation among the ${distinct.length} distinct plans.`
          : rank === 1
            ? `This option is the close alternative among the ${distinct.length} distinct plans.`
            : `This option ranks ${rank + 1} among the ${distinct.length} distinct plans.`,
        ...choice.reasons
      ]
    };
  });
}

function withoutInternalRankingReasons(reasons) {
  const internalPhrases = [
    "distinct plans",
    "deterministic scoring outlook",
    "higher modeled cost"
  ];
  return reasons.filter(reason =>
    !internalPhrases.some(phrase => reason.toLowerCase().includes(phrase))
  );
}

function selectTwoStrategyChoices(choices) {
  if (!choices.length) return [];
  if (choices.length === 1) {
    const only = choices[0];
    return [{
      ...only,
      id: "recommended",
      sourcePlanId: only.id,
      strategyRole: "recommended",
      title: "Recommended",
      objective: "Best available plan",
      outlook: "Best",
      reasons: [
        "The other calculated routes were too similar to justify showing a second choice, so the caddie is presenting one honest recommendation.",
        ...withoutInternalRankingReasons(only.reasons)
      ]
    }];
  }
  const aggressiveSource = choices.find(choice =>
    ["attack", "attack_pin", "advance"].includes(choice.id)
  ) || choices[0];
  const alternatives = choices.filter(choice => choice.id !== aggressiveSource.id);
  const minimumUsefulAdvancement = aggressiveSource.mode === "approach"
    ? 0
    : aggressiveSource.advancementYards * .65;
  const practical = alternatives.filter(choice =>
    choice.advancementYards >= minimumUsefulAdvancement
  );
  const safeSource = [...(practical.length ? practical : alternatives)]
    .sort((first, second) => first.scoringIndex - second.scoringIndex || first.risk - second.risk)[0];
  if (!safeSource) return [aggressiveSource];
  const selected = [
    {
      ...aggressiveSource,
      id: "aggressive",
      sourcePlanId: aggressiveSource.id,
      strategyRole: "aggressive",
      title: "Aggressive",
      objective: "Maximum scoring opportunity"
    },
    {
      ...safeSource,
      id: "safe_smart",
      sourcePlanId: safeSource.id,
      strategyRole: "safe_smart",
      title: "Safe & smart",
      objective: "Best practical safety"
    }
  ];
  const ranked = [...selected].sort((first, second) => first.scoringIndex - second.scoringIndex);
  return selected.map(choice => {
    const rank = ranked.findIndex(item => item.id === choice.id);
    return {
      ...choice,
      outlook: rank === 0 ? "Best" : "Higher risk",
      reasons: [
        rank === 0
          ? "Before paired simulation, this option has the better preliminary outlook of the two player-facing plans."
          : "Before paired simulation, this is the alternative of the two player-facing plans.",
        ...withoutInternalRankingReasons(choice.reasons)
      ]
    };
  });
}

function planAdviceKeys(choice, startSurface) {
  const lieKey = {
    tee: "tee_standard",
    fairway: "fairway_clean",
    rough: "rough_medium",
    light_rough: "rough_light",
    heavy_rough: "rough_deep",
    native: "rough_deep",
    bunker: "bunker_fairway"
  }[startSurface];
  const nearestIsClose = choice.hazardClearanceYards != null && choice.hazardClearanceYards < 40;
  const relevantHazards = new Set(choice.hazards);
  if (nearestIsClose && choice.nearestHazard) relevantHazards.add(choice.nearestHazard);
  let hazardKey = null;
  if (relevantHazards.has("out_of_bounds")) hazardKey = "out_of_bounds_in_play";
  else if (relevantHazards.has("water")) hazardKey = choice.hazards.includes("water") ? "forced_water_carry" : "water_in_play";
  else if (relevantHazards.has("bunker")) hazardKey = choice.mode === "approach" ? "greenside_bunker_in_play" : "fairway_bunker_in_play";
  const outcomeKey = choice.mode === "recovery"
    ? "restore_position"
    : choice.id === "green_center"
      ? "favor_center_green"
      : choice.strategyRole === "safe_smart" || ["safe_miss", "safe"].includes(choice.id)
        ? (choice.mode === "approach" ? "favor_safe_side" : "play_to_widest_window")
        : choice.mode === "long" && choice.id === "smart"
          ? "play_to_widest_window"
          : relevantHazards.size
            ? "remove_big_miss"
            : null;
  return [lieKey, hazardKey, outcomeKey].filter(Boolean);
}

export function buildStrategyChoices({
  start, pin, centerline, fairways, surfaces, clubs, lieMultiplier = 1,
  preferredApproachYards, startSurface = "fairway", recoveryRequired = false
}) {
  if (!start || !pin || !Array.isArray(centerline) || centerline.length < 2) {
    throw new Error("strategy choices require start, pin, and a centerline");
  }
  if (!Array.isArray(clubs) || !clubs.some(club => !club.name.toLowerCase().includes("putter"))) {
    throw new Error("strategy choices require at least one full-shot club");
  }
  const preferred = Number.isFinite(preferredApproachYards) && preferredApproachYards > 20
    ? preferredApproachYards
    : 90;
  const normalizedSurface = String(startSurface).toLowerCase().replaceAll(" ", "_");
  const fullShotClubs = filteredClubs(clubs, lieMultiplier, normalizedSurface);
  if (!fullShotClubs.length) throw new Error("no club is suitable for the current lie");
  const context = {
    start, pin, centerline, fairways, surfaces, lieMultiplier,
    preferred, clubs: fullShotClubs
  };
  const recovery = recoveryRequired || ["bunker", "native", "heavy_rough"].includes(normalizedSurface);
  if (recovery) return selectTwoStrategyChoices(finalizeChoices(recoveryPlans(context))).map(choice => ({
    ...choice,
    adviceKeys: planAdviceKeys(choice, normalizedSurface)
  }));

  const remaining = distance(start, pin);
  const reachable = remaining <= fullShotClubs[0].effectiveCarry + 2;
  if (reachable) {
    const approachPlans = selectTwoStrategyChoices(finalizeChoices(approachChoices(context)));
    if (approachPlans.length) return approachPlans.map(choice => ({
      ...choice,
      adviceKeys: planAdviceKeys(choice, normalizedSurface)
    }));
  }
  return selectTwoStrategyChoices(finalizeChoices(longChoices(context))).map(choice => ({
    ...choice,
    adviceKeys: planAdviceKeys(choice, normalizedSurface)
  }));
}

// Academy keeps the honest underlying plans instead of collapsing them into
// the normal caddie's two-button Aggressive / Safe & smart presentation.
// Physics inputs and deterministic ranking remain shared with normal play.
export function buildAcademyStrategyChoices({
  start, pin, centerline, fairways, surfaces, clubs, lieMultiplier = 1,
  preferredApproachYards, startSurface = "fairway", recoveryRequired = false
}) {
  if (!start || !pin || !Array.isArray(centerline) || centerline.length < 2) {
    throw new Error("academy strategy choices require start, pin, and a centerline");
  }
  if (!Array.isArray(clubs) || !clubs.some(club => !club.name.toLowerCase().includes("putter"))) {
    throw new Error("academy strategy choices require at least one full-shot club");
  }
  const preferred = Number.isFinite(preferredApproachYards) && preferredApproachYards > 20
    ? preferredApproachYards
    : 90;
  const normalizedSurface = String(startSurface).toLowerCase().replaceAll(" ", "_");
  const fullShotClubs = filteredClubs(clubs, lieMultiplier, normalizedSurface);
  if (!fullShotClubs.length) throw new Error("no club is suitable for the current lie");
  const context = {
    start, pin, centerline, fairways, surfaces, lieMultiplier,
    preferred, clubs: fullShotClubs
  };
  const recovery = recoveryRequired || ["bunker", "native", "heavy_rough"].includes(normalizedSurface);
  const remaining = distance(start, pin);
  const reachable = remaining <= fullShotClubs[0].effectiveCarry + 2;
  const plans = recovery
    ? recoveryPlans(context)
    : reachable
      ? approachChoices(context)
      : longChoices(context);
  return finalizeChoices(plans).slice(0, 3).map(choice => ({
    ...choice,
    reasons: withoutInternalRankingReasons(choice.reasons),
    adviceKeys: planAdviceKeys(choice, normalizedSurface)
  }));
}

// Tree canopies describe an obstruction field, not individual trunks or
// branch openings.  Build ordinary geometry-safe recovery targets first, then
// attach an honest, versioned interference model to 1–3 distinct choices.
export function buildTreeRecoveryChoices({ treeCondition, ...input }) {
  if (!treeCondition) throw new Error("tree recovery requires a tree condition");
  const base = buildAcademyStrategyChoices({ ...input, startSurface: "trees", recoveryRequired: true });
  const depth = treeCondition.tree_position;
  const limit = depth === "deep_in_trees" ? 1 : depth === "under_canopy" ? 2 : 3;
  const maxDistance = Math.max(distance(input.start, input.pin), 1);
  const depthRisk = depth === "deep_in_trees" ? .36 : depth === "under_canopy" ? .21 : .09;
  const forward = { x: (input.pin.x - input.start.x) / maxDistance, y: (input.pin.y - input.start.y) / maxDistance };
  const decorated = base.map(choice => {
    const attempted = distance(input.start, choice.target);
    const dx = choice.target.x - input.start.x, dy = choice.target.y - input.start.y;
    const progress = (dx * forward.x + dy * forward.y) / Math.max(attempted, 1);
    const directionRisk = progress > .7 ? .16 : progress > .2 ? .08 : progress < -.1 ? -.05 : 0;
    const distanceRisk = Math.min(.18, attempted / maxDistance * .18);
    const selectedClub = input.clubs.find((club, index) => (club.clubIndex ?? index) === choice.clubIndex);
    const accuracyRisk = Math.max(0, 100 - (selectedClub?.accuracy || 70)) / 100 * .1;
    const clubName = String(selectedClub?.name || choice.clubName || "").toLowerCase();
    const ironNumber = Number.parseInt(clubName, 10);
    const trajectoryRisk = clubName.includes("driver") ? .14
      : clubName.includes("wood") ? .1
        : clubName.includes("hybrid") ? .07
          : clubName.includes("wedge") ? -.04
            : Number.isFinite(ironNumber) && ironNumber <= 5 ? .06
              : Number.isFinite(ironNumber) && ironNumber <= 7 ? .035 : .015;
    const major = bounded(.015 + depthRisk * .42 + directionRisk * .5 + distanceRisk * .32 + accuracyRisk * .22 + trajectoryRisk * .32, .01, .48);
    const clip = bounded(.035 + depthRisk * .72 + directionRisk * .62 + distanceRisk * .48 + accuracyRisk * .35 + trajectoryRisk * .5, .03, .58 - major);
    const clean = Math.round((1 - clip - major) * 1000) / 1000;
    const normalizedClip = Math.round(clip * 1000) / 1000;
    const normalizedMajor = Math.round((1 - clean - normalizedClip) * 1000) / 1000;
    const cleanLeave = Math.round(choice.leavesYards);
    const clipLeave = Math.round(cleanLeave + Math.max(10, attempted * .34));
    const majorLeave = Math.round(cleanLeave + Math.max(25, attempted * .76));
    const overallLeave = Math.round(clean * cleanLeave + normalizedClip * clipLeave + normalizedMajor * majorLeave);
    const directionClass = progress > .7 ? "FORWARD" : progress > .15 ? "FORWARD_DIAGONAL" : progress < -.15 ? "BACKWARD" : "LATERAL";
    const safety = clean >= .8 ? "Safe Punch" : clean >= .58 ? "Forward Punch" : "Aggressive Punch";
    return {
      ...choice,
      id: `tree-${choice.id}`,
      title: safety,
      objective: clean >= .8 ? "Highest clean escape" : clean >= .58 ? "More progress, more tree risk" : "Maximum progress, high tree risk",
      treeRecovery: {
        version: TREE_RECOVERY_MODEL_VERSION,
        tree_depth: depth,
        direction_class: directionClass,
        intended_distance_yards: Math.round(attempted),
        probabilities: { clean_escape: clean, branch_clip: normalizedClip, major_tree_contact: normalizedMajor },
        reward: { expected_leave_if_clean_yards: cleanLeave, clip_leave_yards: clipLeave, major_leave_yards: majorLeave, overall_expected_leave_yards: overallLeave },
        remaining_in_trees_on_major: depth === "deep_in_trees" ? .78 : depth === "under_canopy" ? .61 : .42,
        hazard_exposure: choice.hazards?.length ? .08 : 0
      },
      // Used by the GM's tree-specific comparison before the general evaluator
      // has a physical branch model.
      scoringIndex: overallLeave + normalizedMajor * 35 + normalizedClip * 12
    };
  }).filter(choice => choice.leavesYards <= maxDistance + 5)
    .sort((a, b) => a.scoringIndex - b.scoringIndex);
  return decorated.slice(0, limit);
}
