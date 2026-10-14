const TEES = ["Blue", "White", "Red"];
export function availableScorecardTees(row) {
  return TEES.filter(tee => Number.isFinite(Number(row?.[`Yards_${tee}`])) && Number(row[`Yards_${tee}`]) > 0);
}
export function selectedScorecardTee(row, requested, metadata = {}) {
  const available = availableScorecardTees(row);
  const preferred = { blue: "Blue", white: "White", forward: "Red" }[metadata.default_start_tee];
  return [requested, preferred, "White", ...available].find(tee => available.includes(tee)) || requested;
}
export function originTeeYardage(row, metadata = {}) {
  const origin = metadata.coordinate_system?.origin || "";
  const tee = /^blue\b/i.test(origin) ? "Blue" : /^(forward|red)\b/i.test(origin) ? "Red" : "White";
  const fallback = selectedScorecardTee(row, tee, metadata);
  return Number(row[`Yards_${fallback}`]);
}
