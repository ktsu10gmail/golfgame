import { CHALLENGE_PARS } from "./challenge_state.mjs";

function mix32(value) {
  value >>>= 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return value >>> 0;
}

export function deriveChallengeSeed(seed, salt) {
  if (!Number.isInteger(seed) || seed < 1) throw new Error("seed must be positive");
  return mix32(seed ^ salt) || 1;
}

export function challengeSeeds(selectionSeed) {
  return Object.freeze({
    selection_seed: selectionSeed,
    pin_condition_seed: deriveChallengeSeed(selectionSeed, 0x9e3779b1),
    player_execution_seed: deriveChallengeSeed(selectionSeed, 0x243f6a88),
    gm_execution_seed: deriveChallengeSeed(selectionSeed, 0xb7e15162)
  });
}

function shuffled(items, seed) {
  const output = [...items];
  let value = seed >>> 0;
  for (let index = output.length - 1; index > 0; index -= 1) {
    value = mix32(value + index + 1);
    const target = value % (index + 1);
    [output[index], output[target]] = [output[target], output[index]];
  }
  return output;
}

function candidateKey(candidate) {
  return `${candidate.course_id}:${candidate.source_hole_number}`;
}

export function orderedChallengeCandidates(candidates, selectionSeed, recentKeys = []) {
  const recent = new Set(recentKeys);
  return CHALLENGE_PARS.map((par, slot) => shuffled(
    candidates.filter(candidate => Number(candidate.par) === par),
    deriveChallengeSeed(selectionSeed, Math.imul(slot + 1, 0x85ebca6b))
  ).sort((a, b) => Number(recent.has(candidateKey(a))) - Number(recent.has(candidateKey(b)))));
}

export function generateChallengeHoles(candidates, {
  selectionSeed,
  teeId = "White",
  recentKeys = []
}) {
  if (!Array.isArray(candidates)) throw new Error("challenge candidates are required");
  const ordered = orderedChallengeCandidates(candidates, selectionSeed, recentKeys);
  const chosen = [];
  const usedHoles = new Set();
  const usedCourses = new Set();
  for (let slot = 0; slot < 3; slot += 1) {
    const pool = ordered[slot].filter(candidate => !usedHoles.has(candidateKey(candidate)) && candidate.valid !== false);
    const candidate = pool.find(item => !usedCourses.has(item.course_id)) || pool[0];
    if (!candidate) throw new Error(`No eligible Par ${CHALLENGE_PARS[slot]} hole is installed`);
    usedHoles.add(candidateKey(candidate));
    usedCourses.add(candidate.course_id);
    chosen.push({
      challenge_slot: slot + 1,
      course_id: candidate.course_id,
      course_version_id: candidate.course_version_id,
      course_name: candidate.course_name,
      source_hole_number: Number(candidate.source_hole_number),
      par: CHALLENGE_PARS[slot],
      tee_id: teeId,
      pin_ref: null
    });
  }
  return chosen;
}

export function replaceIneligibleHole(holes, slot, orderedCandidates, rejectedKeys = []) {
  const rejected = new Set(rejectedKeys);
  const used = new Set(holes.filter((_, index) => index !== slot).map(candidateKey));
  const usedCourses = new Set(holes.filter((_, index) => index !== slot).map(hole => hole.course_id));
  const pool = orderedCandidates[slot].filter(candidate => !rejected.has(candidateKey(candidate)) && !used.has(candidateKey(candidate)));
  const replacement = pool.find(candidate => !usedCourses.has(candidate.course_id)) || pool[0];
  if (!replacement) throw new Error(`No compatible Par ${CHALLENGE_PARS[slot]} replacement is available`);
  const next = structuredClone(holes);
  next[slot] = {
    challenge_slot: slot + 1,
    course_id: replacement.course_id,
    course_version_id: replacement.course_version_id,
    course_name: replacement.course_name,
    source_hole_number: Number(replacement.source_hole_number),
    par: CHALLENGE_PARS[slot],
    tee_id: holes[slot]?.tee_id || "White",
    pin_ref: null
  };
  return next;
}

export function challengeHoleKey(hole) {
  return candidateKey(hole);
}
