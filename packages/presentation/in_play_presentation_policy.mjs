export const IN_PLAY_PRESENTATION_VERSION = "in-play-presentation-v1";

const title = value => String(value || "Unknown").toUpperCase();

// Presentation only: callers supply already-calculated facts and assessments.
// This module intentionally has no simulator, persistence, or assessment imports.
export function buildInPlayPresentation({ current = {}, previous = null, specialized = null } = {}) {
  const conditions = (current.conditions || []).filter(Boolean).slice(0, 3);
  const adjustments = (current.adjustments || []).filter(Boolean).slice(0, 3);
  const penalty = Number(previous?.penalty || 0);
  const tree = previous?.treeOutcome === "MAJOR_TREE_CONTACT";
  const event = penalty
    ? { label: "Penalty", copy: `${title(previous.surface)} · ${penalty} ${penalty === 1 ? "stroke" : "strokes"}` }
    : tree
      ? { label: "Recovery", copy: `Tree contact · ${Math.round(current.distanceYards || 0)} yd remaining` }
      : previous?.holeComplete ? { label: "Hole complete", copy: previous.holeComplete }
      : null;
  const summary = previous?.decisionLabel
    ? [previous.costly ? "Costly result" : previous.decisionLabel, Number.isFinite(previous.risk) ? `${Math.round(previous.risk)}% risk` : null]
      .filter(Boolean).join(" · ")
    : null;
  return {
    version: IN_PLAY_PRESENTATION_VERSION,
    primary: {
      surface: title(current.surface),
      distanceYards: Number.isFinite(current.distanceYards) ? Math.round(current.distanceYards) : null,
      conditions: specialized ? (current.specializedBriefing || []).slice(0, 1) : conditions,
      adjustments: specialized ? [] : adjustments
    },
    previousShot: summary ? { summary, detailsAvailable: Boolean(previous?.details?.length) } : null,
    event,
    specializedDecisionUI: specialized,
    details: previous?.details || []
  };
}
