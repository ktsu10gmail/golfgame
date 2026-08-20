import { validateRoundState } from "./round_state.mjs";

export const ROUND_SAVE_VERSION = "golf-round-save-v1";
export const ROUND_SAVE_EXTENSION = "golfround";

function assertIndex(value, label, maximum) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label} must be between 0 and ${maximum}`);
  }
}

function validateProfile(profile) {
  if (!profile || typeof profile !== "object") throw new Error("player profile is missing");
  if (typeof profile.id !== "string" || !profile.id.trim()) throw new Error("player profile id is missing");
  if (typeof profile.name !== "string" || !profile.name.trim()) throw new Error("player profile name is missing");
  if (!Array.isArray(profile.clubs) || profile.clubs.length === 0) {
    throw new Error("player profile must include clubs");
  }
  for (const club of profile.clubs) {
    if (!club || typeof club.name !== "string" || !Number.isFinite(club.carry) || !Number.isFinite(club.accuracy)) {
      throw new Error("player profile contains an invalid club");
    }
  }
  return profile;
}

function validateRoundSummary(summary) {
  if (summary == null) return null;
  if (typeof summary !== "object" || Array.isArray(summary)) throw new Error("round summary must be an object");
  if (typeof summary.course_name !== "string" || !summary.course_name.trim()) {
    throw new Error("round summary course name is missing");
  }
  if (typeof summary.tee !== "string" || !summary.tee.trim()) throw new Error("round summary tee is missing");
  for (const field of ["holes_completed", "total_strokes", "total_par", "score_to_par", "strategy_score", "execution_score", "scored_shots"]) {
    const value = summary[field];
    if (value != null && !Number.isInteger(value)) throw new Error(`round summary ${field} must be an integer`);
  }
  if (summary.holes_completed < 0 || summary.holes_completed > 18) throw new Error("round summary holes_completed is invalid");
  if (summary.strategy_score != null && (summary.strategy_score < 0 || summary.strategy_score > 100)) {
    throw new Error("round summary strategy_score is invalid");
  }
  if (summary.execution_score != null && (summary.execution_score < 0 || summary.execution_score > 100)) {
    throw new Error("round summary execution_score is invalid");
  }
  return summary;
}

export function validateRoundSave(save) {
  if (!save || typeof save !== "object") throw new Error("save file must contain an object");
  if (save.version !== ROUND_SAVE_VERSION) {
    throw new Error(`unsupported save file version: ${save.version || "missing"}`);
  }
  validateRoundState(save.round_state);
  if (save.course_id !== save.round_state.course_id) {
    throw new Error("save file course does not match its round");
  }
  assertIndex(save.current_hole_index, "current_hole_index", 17);
  assertIndex(save.pin_index, "pin_index", 20);
  validateProfile(save.player_profile);
  validateRoundSummary(save.round_summary);
  return save;
}

export function createRoundSave({
  roundState,
  currentHoleIndex,
  pinIndex,
  playerProfile,
  roundSummary = null,
  savedAt = new Date().toISOString()
}) {
  const save = {
    version: ROUND_SAVE_VERSION,
    game: "Middlesex — The Strategy Round",
    saved_at: savedAt,
    course_id: roundState?.course_id,
    current_hole_index: currentHoleIndex,
    pin_index: pinIndex,
    player_profile: structuredClone(playerProfile),
    ...(roundSummary ? { round_summary: structuredClone(roundSummary) } : {}),
    round_state: structuredClone(roundState)
  };
  return validateRoundSave(save);
}

export function parseRoundSave(text) {
  if (typeof text !== "string" || !text.trim()) throw new Error("save file is empty");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error("save file is not valid JSON", { cause: error });
  }
  return validateRoundSave(parsed);
}

export function roundSaveFilename(save) {
  validateRoundSave(save);
  const date = String(save.saved_at || "").slice(0, 10) || "saved";
  return `${save.course_id}-hole-${save.current_hole_index + 1}-${date}.${ROUND_SAVE_EXTENSION}`;
}
