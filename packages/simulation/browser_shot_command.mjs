function normalizeInstruction(value) {
  return String(value || "")
    .toLowerCase()
    .replaceAll("-", " ")
    .replace(/[“”″]/g, '"')
    .replace(/\b(?:aaim|aimm)\b/g, "aim")
    .replace(/\bdistanc\s+eis\b/g, "distance is")
    .replace(/\brolll+\b/g, "roll")
    .replace(/\bi(?=\s*(?:inch|inches|in)\b)/g, "1")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseShotTargetInstruction(value) {
  const normalized = normalizeInstruction(value);
  const directLanding = normalized.match(
    /\b(?:aim|land|landing|target)(?:\s+(?:it|the\s+ball|ball))?\s*(?:at\s+)?(\d+(?:\.\d+)?)\s*(?:yards?|yds?)\s+(?:from|away\s+from)\s+(?:the\s+)?ball\b/
  );
  const namedTargetDistance = normalized.match(
    /\b(?:target|landing)\s+distance\s*(?:is|=|of)?\s*(\d+(?:\.\d+)?)\s*(?:yards?|yds?)\b/
  );
  const targetAtDistance = normalized.match(
    /\b(?:target|landing)(?:\s+(?:point|distance))?\s+(?:at|is|=|of)\s+(\d+(?:\.\d+)?)\s*(?:yards?|yds?)(?:\s+distance)?\b/
  );
  const landing = directLanding || namedTargetDistance || targetAtDistance;
  const lateral = normalized.match(
    /\b(\d+(?:\.\d+)?)\s*(?:inches?|in\b|\")\s+(?:(?:to\s+(?:the\s+)?)?(right|left)|(?:to\s+)?(right|left)\s+of)\b/
  );
  const explicitPinAim = /\baim(?:ed|ing)?\s+(?:(?:at|to|toward|towards)\s+)?(?:the\s+)?(?:pin|cup|flag)\b/.test(normalized);
  const rollToCup = /\b(?:roll|release|run)\b[^.!?]*\b(?:to|toward|towards)\s+(?:the\s+)?(?:cup|pin|hole)\b/.test(normalized);
  const mentionsTargeting = /\b(?:aim|land|landing|target)\b/.test(normalized);
  const mentionsLateralOffset = /(?:\b\d+(?:\.\d+)?\s*(?:inches?|in\b|\")|\bslightly)\s+(?:(?:to\s+(?:the\s+)?)?(?:right|left)|(?:to\s+)?(?:right|left)\s+of)\b/.test(normalized);

  return {
    normalized,
    landing_yards: landing ? Number(landing[1]) : null,
    lateral_inches: lateral ? Number(lateral[1]) : null,
    lateral_direction: lateral ? lateral[2] || lateral[3] : null,
    explicit_pin_aim: explicitPinAim,
    roll_to_cup: rollToCup,
    mentions_targeting: mentionsTargeting,
    mentions_lateral_offset: mentionsLateralOffset
  };
}
