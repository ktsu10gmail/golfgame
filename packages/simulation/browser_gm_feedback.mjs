export const PLAYER_SAFE_SHOT_ERROR = "The shot could not be completed. Your ball and score have not changed. Please try again. If this continues, return to the hole and resume the round.";

export function modeledMakeChanceLabel(probability) {
  const percentage = Math.max(0, Number(probability) * 100);
  return percentage < 1 ? "under 1%" : `${Math.round(percentage)}%`;
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
