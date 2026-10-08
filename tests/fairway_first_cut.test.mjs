import test from 'node:test';
import assert from 'node:assert/strict';
import { withFairwayFirstCut } from '../packages/simulation/fairway_first_cut.mjs';
import { resolveSurface as engineResolveSurface } from '../packages/simulation/browser_engine.mjs';

function resolveSurface(point, regions) {
  return engineResolveSurface({ x: point[0], y: point[1] }, regions.map(region => ({
    ...region, polygon: region.polygon.map(([x, y]) => ({ x, y }))
  })));
}

const fairway = [[0, 0], [20, 0], [20, 100], [0, 100]];
const hole = { geometries: { fairway_segments: [{ polygon: fairway }], rough_zones: [] } };
function surfaces(prepared) {
  return [{ surface: 'fairway', polygon: fairway, priority: 40 },
    ...prepared.geometries.rough_zones.map(zone => ({ surface: 'first_cut', polygon: zone.polygon, priority: 30 }))];
}
test('five-yard first cut leaves the fairway intact and returns to regular rough beyond', () => {
  const prepared = withFairwayFirstCut(hole);
  const regions = surfaces(prepared);
  assert.deepEqual(prepared.geometries.fairway_segments[0].polygon, fairway);
  assert.equal(resolveSurface([10, 50], regions)[0], 'fairway');
  assert.equal(resolveSurface([20 + 4.56, 50], regions)[0], 'first_cut');
  assert.equal(resolveSurface([20 + 4.58, 50], regions)[0], 'rough');
  assert.equal(resolveSurface([-3, -3], regions)[0], 'first_cut');
  assert.equal(resolveSurface([-4, -4], regions)[0], 'rough');
  assert.deepEqual(withFairwayFirstCut(prepared), prepared);
  assert.deepEqual(hole.geometries.rough_zones, []);
});
test('water and green override the first-cut band', () => {
  const regions = surfaces(withFairwayFirstCut(hole));
  const patch = [[20, 40], [25, 40], [25, 60], [20, 60]];
  assert.equal(resolveSurface([22, 50], [...regions, { surface: 'water', polygon: patch, priority: 90 }])[0], 'water');
  assert.equal(resolveSurface([22, 50], [...regions, { surface: 'green', polygon: patch, priority: 70 }])[0], 'green');
});
test('no fairway means no generated first-cut polygons', () => {
  const prepared = withFairwayFirstCut({ geometries: { fairway_segments: [], rough_zones: [] } });
  assert.deepEqual(prepared.geometries.rough_zones, []);
});
