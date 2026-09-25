function holeNumber(scorecard, index) {
  const supplied = Number(scorecard[index]?.Hole);
  return Number.isInteger(supplied) && supplied > 0 ? supplied : index + 1;
}

export function academyParFiveIndexes(scorecard = []) {
  return scorecard
    .map((entry, index) => Number(entry?.Par) === 5 ? index : null)
    .filter(index => index !== null);
}

export function selectAcademyParFiveIndex(scorecard = [], recentHoleNumbers = []) {
  const indexes = academyParFiveIndexes(scorecard);
  if (!indexes.length) return -1;
  const recent = recentHoleNumbers
    .map(Number)
    .filter(number => Number.isInteger(number) && number > 0);
  const recentSet = new Set(recent);
  const lastPosition = indexes.findIndex(index => holeNumber(scorecard, index) === recent[0]);
  const start = lastPosition >= 0 ? lastPosition + 1 : 0;
  const rotated = indexes.map((_, offset) => indexes[(start + offset) % indexes.length]);
  return rotated.find(index => !recentSet.has(holeNumber(scorecard, index))) ?? rotated[0];
}

export function rememberAcademyHole(recentHoleNumbers = [], playedHoleNumber, limit = 8) {
  const played = Number(playedHoleNumber);
  if (!Number.isInteger(played) || played < 1) return recentHoleNumbers.slice(0, limit);
  return [played, ...recentHoleNumbers.map(Number).filter(number => number !== played)]
    .slice(0, Math.max(1, limit));
}
