import { gamePreviewBounds, gamePreviewProjector, renderGameMapPreview } from './game_map_preview.mjs?v=20261009-start-ball1';

function seededRandom(seed) {
  let value = 2166136261;
  for (const character of seed) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return () => { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return (value >>> 0) / 4294967296; };
}
function inside(point, polygon) {
  let found = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) found = !found;
  }
  return found;
}
function edgeDistance(point, polygon) {
  return Math.min(...polygon.map((a, index) => {
    const b = polygon[(index + 1) % polygon.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const fraction = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(point[0] - a[0] - fraction * dx, point[1] - a[1] - fraction * dy);
  }));
}

export function prototypeTreePlacements(hole, { density = .3, sizeScale = 1.5 } = {}) {
  const holeThreeScale = Number(hole.hole_metadata?.hole_number) === 3
    && /alta\s+vista/i.test(String(hole.hole_metadata?.course_name || "")) ? 2 : 1;
  const retainTrees = trees => {
    const count = Math.round(trees.length * Math.max(0, Math.min(1, density)));
    return Array.from({ length: count }, (_, index) => trees[Math.floor(index * trees.length / count)]);
  };
  const project = gamePreviewProjector(gamePreviewBounds(hole));
  const g = hole.geometries;
  const origin = project([0, 0]), oneMeter = project([1, 0]);
  const pixelsPerMeter = Math.hypot(oneMeter[0] - origin[0], oneMeter[1] - origin[1]);
  const clearance = 8 * .9144 * pixelsPerMeter;
  const route = (hole.centerline_waypoints || []).map(item => project(item.point));
  const teeCenters = (g.tee_boxes || []).map(item => {
    const points = item.polygon.map(project);
    return [points.reduce((sum, point) => sum + point[0], 0) / points.length,
      points.reduce((sum, point) => sum + point[1], 0) / points.length];
  });
  const corridors = [route, ...teeCenters.map(center => [center, ...route.slice(1)])].filter(points => points.length >= 2);
  const corridorWidth = 12 * .9144 * pixelsPerMeter;
  const fairways = (g.fairway_segments || []).map(item => item.polygon.map(project));
  const woods = (g.tree_zones || []).map(item => item.polygon.map(project));
  const protectedAreas = [
    ...fairways, g.green_complex.polygon.map(project),
    ...(g.tee_boxes || []).map(item => item.polygon.map(project)),
    ...(g.hazards || []).map(item => item.polygon.map(project)),
    ...(g.cart_paths || []).map(item => item.polygon.map(project)),
    ...(g.out_of_bounds || []).map(item => item.polygon.map(project)),
    ...(g.rough_zones || []).filter(item => item.lie_catalog_id === 'lie_rough_light').map(item => item.polygon.map(project))
  ].filter(polygon => polygon.length >= 3);
  const random = seededRandom(`${hole.hole_metadata?.course_name}:${hole.hole_metadata?.hole_number}:canopy-v1`);
  const trees = [];
  for (let y = 70; y < 940; y += 17) {
    for (let x = 55; x < 945; x += 17) {
      const point = [x + (random() - .5) * 13, y + (random() - .5) * 13];
      const radius = (8 + random() * 8) * sizeScale * holeThreeScale;
      const mapped = woods.some(polygon => inside(point, polygon));
      const besideFairway = fairways.some(polygon => edgeDistance(point, polygon) < 125);
      const besideParThree = Number(hole.hole_metadata?.par) === 3 && fairways.length === 0
        && corridors.some(points => points.slice(1).some((end, index) => {
          const start = points[index];
          const dx = end[0] - start[0], dy = end[1] - start[1];
          const lengthSquared = dx * dx + dy * dy;
          if (lengthSquared < 1e-8) return false;
          const progress = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared;
          return progress >= 0 && progress <= 1 && edgeDistance(point, [start, end]) < 125;
        }));
      if ((!mapped && !besideFairway && !besideParThree) || random() < (mapped ? .07 : .19)) continue;
      if (protectedAreas.some(polygon => inside(point, polygon) || edgeDistance(point, polygon) < radius * 1.6 + clearance)) continue;
      // Keep the tee-to-green playing line clear, including gaps before the fairway.
      // Include the canopy and shadow envelope in the clearance.
      if (corridors.some(points => points.slice(1).some((end, index) =>
        edgeDistance(point, [points[index], end]) < radius * 1.6 + corridorWidth
      ))) continue;
      trees.push({ x: point[0], y: point[1], radius, rotation: random() * 360, variant: Math.floor(random() * 6), source: mapped ? 'mapped_tree_zone' : 'decorative_estimate' });
      if (trees.length >= 900) return retainTrees(trees);
    }
  }
  return retainTrees(trees);
}

function canopyDefinitions() {
  const samples = [[300,400,110],[830,680,110],[1060,500,100],[550,300,105],[690,1020,105],[220,1000,100]];
  return samples.map(([x,y,radius], index) => {
    const random = seededRandom(`canopy-${index}`);
    const points = Array.from({length:48}, (_, step) => {
      const angle = step / 48 * Math.PI * 2;
      const radius = 13 + random() * 2;
      return `${(Math.cos(angle)*radius).toFixed(2)},${(Math.sin(angle)*radius).toFixed(2)}`;
    }).join(' ');
    const scale = 15 / radius;
    return `<clipPath id="canopy-clip-${index}"><polygon points="${points}"/></clipPath><g id="canopy-${index}" clip-path="url(#canopy-clip-${index})"><image href="assets/tree-canopy-top.png?v=20260812-2" x="${-x*scale}" y="${-y*scale}" width="${1254*scale}" height="${1254*scale}"/><circle r="16" fill="${index%2 ? '#183f33' : '#a2af4b'}" opacity=".12"/></g>`;
  }).join('');
}

export function renderIllustratedHolePrototype(hole) {
  const trees = prototypeTreePlacements(hole);
  let svg = renderGameMapPreview(hole, { showTrees: false });
  const definitions = `<linearGradient id="illustrated-fairway" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#9cbd61"/><stop offset=".45" stop-color="#7da447"/><stop offset="1" stop-color="#afc96c"/></linearGradient>
    <linearGradient id="illustrated-water" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#315d63"/><stop offset="1" stop-color="#133c4c"/></linearGradient>
    <radialGradient id="illustrated-green" cx=".35" cy=".3" r=".85"><stop stop-color="#c6df88"/><stop offset="1" stop-color="#8fbc51"/></radialGradient>
    <pattern id="illustrated-mow" width="42" height="42" patternUnits="userSpaceOnUse" patternTransform="rotate(-32)"><rect width="21" height="42" fill="#ffffff" opacity=".08"/></pattern>
    <filter id="illustrated-grain"><feTurbulence type="fractalNoise" baseFrequency=".72" numOctaves="2" seed="8"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".07"/></feComponentTransfer><feBlend in="SourceGraphic" mode="soft-light"/></filter>
    ${canopyDefinitions()}
    <style>
    .illustrated-hole .preview-fairway{fill:url(#illustrated-fairway);stroke:#749945;stroke-width:2}
    .illustrated-hole .preview-fairway-mow{fill:url(#illustrated-mow);stroke:none}
    .illustrated-hole .preview-first-cut{fill:#668d3c;stroke:none}
    .illustrated-hole .preview-green{fill:#4fb344;stroke:none}
    .illustrated-hole .preview-green-fringe{stroke:#a1c96e;stroke-width:9}
    .illustrated-hole .preview-water{fill:url(#illustrated-water);stroke:#84925f;stroke-width:4}
    .illustrated-hole .preview-sand{fill:#e5d6af;stroke:none}
    .illustrated-hole .preview-cart-path{fill:#aea990;stroke:#d1cbb4;stroke-width:1.5}
    .illustrated-hole .preview-route{stroke:#f5f5d4;stroke-width:2.5;stroke-dasharray:9 10;fill:none}
    .illustrated-hole .preview-tee{stroke-width:1.5}
    .illustrated-hole .decorative-forest{pointer-events:none}
    .illustrated-hole rect[fill="url(#preview-native)"]{opacity:.28}
    </style>`;
  svg = svg.replace('class="game-map-preview-svg"', 'class="game-map-preview-svg illustrated-hole" data-style="one-hole-prototype"').replace('<defs>', `<defs>${definitions}`);
  const project = gamePreviewProjector(gamePreviewBounds(hole));
  const points = [...(hole.geometries.fairway_segments || []).flatMap(item => item.polygon), ...hole.geometries.green_complex.polygon,
    ...(hole.centerline_waypoints || []).map(item => item.point),
    ...(Array.isArray(hole.hole_metadata?.default_start_point) ? [hole.hole_metadata.default_start_point] : [])].map(project);
  const left = Math.max(0, Math.min(...points.map(point => point[0])) - 155);
  const right = Math.min(1000, Math.max(...points.map(point => point[0])) + 155);
  const width = Math.max(480, right - left);
  const cropX = Math.max(0, Math.min(1000 - width, (left + right - width) / 2));
  svg = svg.replace('viewBox="0 0 1000 1000"', `viewBox="${cropX} 45 ${width} 920" style="aspect-ratio:${width}/920"`);
  const forest = `<g class="decorative-forest" aria-hidden="true" data-tree-count="${trees.length}">${trees.map(tree => `<ellipse cx="${(tree.x+tree.radius*.35).toFixed(2)}" cy="${(tree.y+tree.radius*.55).toFixed(2)}" rx="${tree.radius}" ry="${tree.radius*.8}" fill="#10271c" opacity=".32"/><use href="#canopy-${tree.variant}" transform="translate(${tree.x.toFixed(2)} ${tree.y.toFixed(2)}) rotate(${tree.rotation.toFixed(1)}) scale(${(tree.radius / 16).toFixed(3)})"/>`).join('')}</g>`;
  return svg.replace(/(<polyline class="preview-route"|<g class="preview-ball"|<g class="preview-pin")/, `${forest}$1`);
}


const gameTreeCache = new WeakMap();
// Reproject the approved placements into the game's camera without changing geometry.
export function renderIllustratedTreeLayer(hole, project) {
  let cached = gameTreeCache.get(hole);
  if (!cached) {
    const previewProject = gamePreviewProjector(gamePreviewBounds(hole));
    const origin = previewProject([0, 0]), xUnit = previewProject([1, 0]), yUnit = previewProject([0, 1]);
    cached = prototypeTreePlacements(hole).map(tree => ({ ...tree,
      point: [(tree.x - origin[0]) / (xUnit[0] - origin[0]), (tree.y - origin[1]) / (yUnit[1] - origin[1])],
      radiusMeters: tree.radius / Math.abs(xUnit[0] - origin[0])
    }));
    gameTreeCache.set(hole, cached);
  }
  return `<defs>${canopyDefinitions()}</defs><g class="decorative-forest" aria-hidden="true" pointer-events="none">${cached.map(tree => {
    const center = project(tree.point), unit = project([tree.point[0] + 1, tree.point[1]]);
    const radius = tree.radiusMeters * Math.hypot(unit[0] - center[0], unit[1] - center[1]);
    return `<ellipse cx="${center[0]+radius*.35}" cy="${center[1]+radius*.55}" rx="${radius}" ry="${radius*.8}" fill="#10271c" opacity=".32"/><use href="#canopy-${tree.variant}" transform="translate(${center[0]} ${center[1]}) rotate(${tree.rotation}) scale(${radius/16})"/>`;
  }).join('')}</g>`;
}
