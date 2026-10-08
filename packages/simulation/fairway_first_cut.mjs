const BAND_METERS = 5 * .9144;

// Capsules around each edge cover the exterior buffer, including concave corners.
// Fairway and higher-priority surfaces cover the inward half of each capsule.
export function withFairwayFirstCut(hole) {
  const geometry = hole?.geometries;
  if (!geometry) return hole;
  const zones = (geometry.rough_zones || []).filter(zone => zone.source !== "fairway_first_cut_5yd");
  for (const [index, fairway] of (geometry.fairway_segments || []).entries()) {
    const points = fairway.polygon || [];
    if (points.length < 3) continue;
    points.forEach((start, edge) => {
      const end = points[(edge + 1) % points.length];
      if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 1e-8) return;
      const angle = Math.atan2(end[1] - start[1], end[0] - start[0]);
      const polygon = [];
      for (const [center, initial] of [[end, angle - Math.PI / 2], [start, angle + Math.PI / 2]]) {
        for (let step = 0; step <= 24; step += 1) {
          const theta = initial + step / 24 * Math.PI;
          polygon.push([center[0] + BAND_METERS * Math.cos(theta), center[1] + BAND_METERS * Math.sin(theta)]);
        }
      }
      zones.push({
        id: `first_cut_${index}_${edge}`, lie_catalog_id: "lie_rough_light",
        source: "fairway_first_cut_5yd", width_yards: 5,
        description: "5-yard light rough outside fairway", polygon
      });
    });
  }
  return { ...hole, geometries: { ...geometry, rough_zones: zones } };
}
