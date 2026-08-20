export function puttRollDurationMs(totalYards) {
  const feet = Math.max(0, Number(totalYards) || 0) * 3;
  return Math.round(Math.max(3000, Math.min(6500, 2400 + feet * 55)));
}

export function projectPuttPath(points, project) {
  if (!Array.isArray(points) || typeof project !== "function") return [];
  // Do not pass `project` directly to Array.map. map's second callback
  // argument is the array index, while the 3D projector's optional second
  // argument is an explicit elevation. Treating 0, 1, 2... as elevations
  // makes an animated ball climb away from the rendered green.
  return points.map(point => project(point));
}

export function puttMotionTiming(points) {
  const path = Array.isArray(points) ? points : [];
  if (path.length < 2) return { keyPoints: "0;1", keyTimes: "0;1" };
  const cumulative = [0];
  for (let index = 1; index < path.length; index += 1) {
    cumulative.push(cumulative.at(-1) + Math.hypot(
      Number(path[index][0]) - Number(path[index - 1][0]),
      Number(path[index][1]) - Number(path[index - 1][1])
    ));
  }
  const total = cumulative.at(-1);
  const keyPoints = total > 1e-9
    ? cumulative.map(value => value / total)
    : cumulative.map((_, index) => index / (cumulative.length - 1));
  const keyTimes = cumulative.map((_, index) => index / (cumulative.length - 1));
  const format = value => Number(value.toFixed(5));
  return {
    keyPoints: keyPoints.map(format).join(";"),
    keyTimes: keyTimes.map(format).join(";")
  };
}
