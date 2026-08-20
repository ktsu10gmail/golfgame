function scaledPolygon(polygon, scale) {
  const points = Array.isArray(polygon) ? polygon : [];
  if (points.length < 3) return points.map(point => [...point]);
  const xs = points.map(point => Number(point[0]));
  const ys = points.map(point => Number(point[1]));
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  return points.map(([x, y]) => [
    centerX + (Number(x) - centerX) * scale,
    centerY + (Number(y) - centerY) * scale
  ]);
}

export function expandSandHazards(hole, scale = 2) {
  const safeScale = Number.isFinite(Number(scale)) && Number(scale) > 0 ? Number(scale) : 1;
  const geometries = hole?.geometries;
  if (!geometries || !Array.isArray(geometries.hazards)) return hole;
  return {
    ...hole,
    geometries: {
      ...geometries,
      hazards: geometries.hazards.map(hazard => (
        hazard?.lie_catalog_id?.includes("water")
          ? { ...hazard, polygon: hazard.polygon.map(point => [...point]) }
          : { ...hazard, polygon: scaledPolygon(hazard.polygon, safeScale) }
      ))
    }
  };
}

export function sandHazardScaleForCourse(course, hole = null) {
  const calibration = hole?.hole_metadata?.geometry_calibration;
  const authoredAtGameScale = calibration?.hazards_authored_at_game_scale === true ||
    /user-aligned local hole artwork/i.test(String(calibration?.method || ""));
  return course?.isCustomMap === true && authoredAtGameScale ? 1 : 2;
}
