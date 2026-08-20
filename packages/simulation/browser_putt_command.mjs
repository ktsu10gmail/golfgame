function cleanNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) ? String(number) : String(Math.round(number * 10) / 10);
}

export function parsePuttAimInstruction(value) {
  const normalized = String(value || "")
    .toLowerCase()
    .replaceAll("-", " ")
    .replace(/\bi(?=\s*(?:inch|inches|in)\b)/g, "1")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;

  const edge = normalized.match(/\b(left|right)\s+edge\s+(?:of\s+)?(?:the\s+)?(?:cup|pin)\b/);
  if (edge) {
    const direction = edge[1];
    return {
      offset_inches: direction === "right" ? 2.125 : -2.125,
      description: `${direction} edge of the cup`
    };
  }

  const offset = normalized.match(
    /\b(\d+(?:\.\d+)?)\s*(?:in|inch|inches)\s+(?:to\s+(?:the\s+)?)?(left|right)(?:\s+(?:of|to)\s+(?:the\s+)?(?:cup|pin))?\b/
  );
  if (offset) {
    const inches = Number(offset[1]);
    const direction = offset[2];
    return {
      offset_inches: inches * (direction === "right" ? 1 : -1),
      description: `${cleanNumber(inches)} in ${direction} of the cup`
    };
  }

  if (/\b(?:cup|pin|flag)\b/.test(normalized)) {
    return { offset_inches: 0, description: "the cup" };
  }
  return null;
}
