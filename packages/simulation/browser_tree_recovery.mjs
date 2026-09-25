export const TREE_RECOVERY_EXECUTION_VERSION = "tree-recovery-execution-v1";

function hash(text) {
  let value = 2166136261;
  for (const char of String(text)) { value ^= char.charCodeAt(0); value = Math.imul(value, 16777619); }
  return value >>> 0;
}

export function resolveTreeRecoveryOutcome(probabilities, identity) {
  const roll = hash(`${identity}:${TREE_RECOVERY_EXECUTION_VERSION}`) / 4294967296;
  const clean = probabilities.clean_escape;
  const clip = probabilities.branch_clip;
  const outcome = roll < clean ? "CLEAN_ESCAPE" : roll < clean + clip ? "BRANCH_CLIP" : "MAJOR_TREE_CONTACT";
  return { outcome_roll: Math.round(roll * 10000) / 10000, resolved_outcome: outcome };
}

export function applyTreeRecoveryContact({ start, landing, resolution }) {
  if (resolution.resolved_outcome === "CLEAN_ESCAPE") return [...landing];
  const ratio = resolution.resolved_outcome === "BRANCH_CLIP" ? .63 : .27;
  const dx = landing[0] - start[0], dy = landing[1] - start[1];
  const lateral = resolution.resolved_outcome === "BRANCH_CLIP" ? ((resolution.outcome_roll * 2 - 1) * 5) : ((resolution.outcome_roll * 2 - 1) * 12);
  const length = Math.hypot(dx, dy) || 1;
  return [start[0] + dx * ratio - dy / length * lateral, start[1] + dy * ratio + dx / length * lateral];
}
