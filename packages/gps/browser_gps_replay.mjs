import {
  DecisionLabel,
  ResultLabel,
  canonicalAssessmentForGpsShot
} from "../assessment/browser_assessment_service.mjs";

function finitePoint(point) {
  return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
}

function titleCase(value) {
  return String(value || "Unknown lie").replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function shotOrdinal(number) {
  if (number === 1) return "Tee shot";
  const suffix = number % 10 === 2 && number % 100 !== 12
    ? "nd"
    : number % 10 === 3 && number % 100 !== 13 ? "rd" : "th";
  return `${number}${suffix} shot`;
}

export function gpsReplayFinishDescription(startPoint, endPoint, pinPoint) {
  if (!finitePoint(startPoint) || !finitePoint(endPoint) || !finitePoint(pinPoint)) return null;
  const towardPin = [pinPoint[0] - startPoint[0], pinPoint[1] - startPoint[1]];
  const length = Math.hypot(...towardPin);
  if (length < 1) return null;
  const forward = [towardPin[0] / length, towardPin[1] / length];
  const right = [forward[1], -forward[0]];
  const fromPin = [endPoint[0] - pinPoint[0], endPoint[1] - pinPoint[1]];
  const longitudinal = fromPin[0] * forward[0] + fromPin[1] * forward[1];
  const lateral = fromPin[0] * right[0] + fromPin[1] * right[1];
  const distance = Math.round(Math.hypot(...fromPin));
  if (distance <= 4) return "near the pin";
  const directions = [];
  if (longitudinal <= -4) directions.push("short");
  else if (longitudinal >= 4) directions.push("long");
  if (lateral >= 4) directions.push("right");
  else if (lateral <= -4) directions.push("left");
  return `${distance} yards ${directions.join("-") || "from the pin"}`;
}

export function gpsReplayOutcomeVsTarget(startPoint, targetPoint, endPoint) {
  if (!finitePoint(startPoint) || !finitePoint(targetPoint) || !finitePoint(endPoint)) {
    return {
      available: false,
      lateralLabel: "Target not recorded",
      distanceLabel: "Comparison unavailable"
    };
  }
  const targetVector = [targetPoint[0] - startPoint[0], targetPoint[1] - startPoint[1]];
  const targetDistance = Math.hypot(...targetVector);
  if (targetDistance < 1) {
    return {
      available: false,
      lateralLabel: "Target not recorded",
      distanceLabel: "Comparison unavailable"
    };
  }
  const forward = [targetVector[0] / targetDistance, targetVector[1] / targetDistance];
  const right = [forward[1], -forward[0]];
  const finishVector = [endPoint[0] - startPoint[0], endPoint[1] - startPoint[1]];
  const lateralYards = finishVector[0] * right[0] + finishVector[1] * right[1];
  const distanceYards = finishVector[0] * forward[0] + finishVector[1] * forward[1] - targetDistance;
  const roundedLateral = Math.round(lateralYards);
  const roundedDistance = Math.round(distanceYards);
  const lateralLabel = Math.abs(roundedLateral) < 2
    ? "On target line"
    : `${Math.abs(roundedLateral)} yd ${roundedLateral > 0 ? "right" : "left"}`;
  const distanceLabel = Math.abs(roundedDistance) < 2
    ? "Target distance"
    : `${Math.abs(roundedDistance)} yd ${roundedDistance > 0 ? "long" : "short"}`;
  return {
    available: true,
    lateralYards: roundedLateral,
    distanceYards: roundedDistance,
    lateralLabel,
    distanceLabel,
    summary: `${lateralLabel.toLowerCase()} and ${distanceLabel.toLowerCase()}`
  };
}

function decisionEvidence(strategy) {
  const evidence = strategy?.decision_evidence;
  const candidates = Array.isArray(evidence?.candidates) ? evidence.candidates : [];
  const selectedId = evidence?.selected_choice_id || strategy?.id;
  const selected = candidates.find(candidate => candidate.id === selectedId);
  const recommended = candidates.find(candidate => candidate.id === evidence?.recommended_choice_id);
  const outlook = selected?.analysis?.hybrid_outlook || strategy?.hybrid_outlook;
  const label = {
    Best: "Preferred plan",
    Competitive: "Competitive plan",
    "Higher risk": "Higher-risk plan"
  }[outlook] || "Decision not graded";
  const club = selected?.club_name || strategy?.club_name || strategy?.title || "Club not recorded";
  const target = selected?.target_label || strategy?.target_label;
  return {
    label,
    detail: target ? `${club} · ${target}` : club,
    graded: label !== "Decision not graded",
    selected,
    recommended: recommended && recommended.id !== selectedId ? recommended : null,
    sampleCount: Number(evidence?.sample_count) || Number(strategy?.probability_analysis?.sample_count) || null
  };
}

function intendedTarget(strategy, decision) {
  if (finitePoint(strategy?.target_course_point)) return strategy.target_course_point;
  if (finitePoint(decision?.selected?.target_course_point)) return decision.selected.target_course_point;
  return null;
}

function modeledAlternative(decision, endLie) {
  const selectedRisk = Number(decision.selected?.analysis?.bunker_percent);
  const recommendedRisk = Number(decision.recommended?.analysis?.bunker_percent);
  if (endLie !== "Bunker" || !Number.isFinite(selectedRisk) || !Number.isFinite(recommendedRisk) || selectedRisk - recommendedRisk < 5) {
    return null;
  }
  const candidate = decision.recommended;
  return `${candidate.club_name || candidate.title} modeled ${recommendedRisk}% bunker risk versus ${selectedRisk}% for the recorded plan. It reduced bunker exposure; it did not guarantee a different result.`;
}

export function gpsReplayShotEvidence({ shot, holeNumber, shotIndex, pinPoint }) {
  const number = Number(shot?.number) || shotIndex + 1;
  const startPoint = shot?.start?.course_point;
  const endPoint = shot?.end?.course_point;
  const startLie = shot?.start?.lie || (number === 1 ? "Tee" : "Unknown lie");
  const endLie = shot?.end?.lie || "Unknown lie";
  const club = shot?.strategy?.club_name || "Club not recorded";
  const power = Number(shot?.strategy?.power);
  const distance = Math.max(0, Math.round(Number(shot?.distance_yards) || 0));
  const finish = gpsReplayFinishDescription(startPoint, endPoint, pinPoint);
  const savedDecision = decisionEvidence(shot?.strategy);
  const outcomeVsTarget = gpsReplayOutcomeVsTarget(startPoint, intendedTarget(shot?.strategy, savedDecision), endPoint);
  const canonicalAssessment = canonicalAssessmentForGpsShot(shot, outcomeVsTarget.available ? {
    lateral_yards: outcomeVsTarget.lateralYards,
    distance_yards: outcomeVsTarget.distanceYards
  } : null, pinPoint);
  const result = {
    id: {
      [ResultLabel.GOOD]: "good",
      [ResultLabel.MIXED]: "mixed",
      [ResultLabel.COSTLY]: "costly",
      [ResultLabel.RECORDED]: "recorded"
    }[canonicalAssessment.result.label],
    label: {
      [ResultLabel.GOOD]: "Good result",
      [ResultLabel.MIXED]: "Mixed result",
      [ResultLabel.COSTLY]: "Costly result",
      [ResultLabel.RECORDED]: "Recorded result"
    }[canonicalAssessment.result.label]
  };
  const decision = {
    ...savedDecision,
    label: {
      [DecisionLabel.PREFERRED]: "Preferred plan",
      [DecisionLabel.COMPETITIVE]: "Competitive plan",
      [DecisionLabel.HIGHER_RISK]: "Higher-risk plan",
      [DecisionLabel.NOT_GRADED]: "Decision not graded"
    }[canonicalAssessment.decision.label],
    graded: canonicalAssessment.decision.label !== DecisionLabel.NOT_GRADED
  };
  const alternative = modeledAlternative(decision, endLie);
  const swing = Number.isFinite(power) ? ` at ${Math.round(power)}%` : "";
  const finishCopy = finish ? `, ${finish}` : "";
  const recorded = `${club}${swing} traveled ${distance} yards from ${titleCase(startLie)} and finished in ${titleCase(endLie)}${finishCopy}.`;
  const outcomeCopy = outcomeVsTarget.available
    ? ` The recorded shot finished ${outcomeVsTarget.summary} of the selected target.`
    : "";
  const ungradedComment = outcomeVsTarget.available
    ? "Comparable model evidence was not saved, so this replay does not grade the decision or prescribe a different club."
    : "The intended target and comparable model evidence were not saved, so this replay does not grade the decision or prescribe a different club.";
  const comment = (alternative
    ? alternative
    : decision.graded
      ? `The saved ${decision.label.toLowerCase()} is supported by ${decision.sampleCount || "the"} paired simulations; the recorded finish is one outcome, not proof that the plan was wrong.`
      : ungradedComment) + outcomeCopy;
  return {
    key: `${holeNumber}:${number}`,
    holeNumber,
    shotIndex,
    number,
    shotLabel: shotOrdinal(number),
    club,
    power: Number.isFinite(power) ? Math.round(power) : null,
    distance,
    startLie: titleCase(startLie),
    endLie: titleCase(endLie),
    finish,
    result,
    decision: { label: decision.label, detail: decision.detail, graded: decision.graded },
    outcomeVsTarget,
    canonicalAssessment,
    evidenceType: alternative ? "modeled" : decision.graded ? "modeled" : "recorded",
    recorded,
    comment
  };
}

export function gpsReplaySteps(round, pinPoints = []) {
  return (round?.holes || []).flatMap((hole, holeIndex) => (hole?.shots || []).map((shot, shotIndex) =>
    gpsReplayShotEvidence({ shot, holeNumber: holeIndex + 1, shotIndex, pinPoint: pinPoints[holeIndex] })
  ));
}
