import { uprightHoleCameraBounds } from "./map_projection.mjs";

const FRAME = { left: 125, right: 875, top: 125, bottom: 875 };

function playingLinePoints(hole) {
  return (hole.centerline_waypoints || [])
    .map(item => item.point)
    .filter(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite));
}

function allGeometryPoints(hole) {
  const geometries = hole.geometries;
  return [
    ...(geometries.tee_boxes || []).flatMap(item => item.polygon || []),
    ...(geometries.fairway_segments || []).flatMap(item => item.polygon || []),
    ...(geometries.rough_zones || []).flatMap(item => item.polygon || []),
    ...(geometries.tree_zones || []).flatMap(item => item.polygon || []),
    ...(geometries.cart_paths || []).flatMap(item => item.polygon || []),
    ...(geometries.hazards || []).flatMap(item => item.polygon || []),
    ...(geometries.out_of_bounds || []).flatMap(item => item.polygon || []),
    ...(geometries.green_complex?.polygon || []),
    ...(hole.centerline_waypoints || []).map(item => item.point)
  ].filter(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite));
}

export function gamePreviewBounds(hole) {
  const playingLine = playingLinePoints(hole);
  if (playingLine.length >= 2) {
    return uprightHoleCameraBounds(playingLine, FRAME);
  }
  const points = allGeometryPoints(hole);
  if (!points.length) throw new Error("The hole does not contain previewable geometry");
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const xPad = Math.max(22, (maxX - minX) * .12);
  const yPad = Math.max(18, (maxY - minY) * .045);
  return { minX: minX - xPad, maxX: maxX + xPad, minY: minY - yPad, maxY: maxY + yPad };
}

export function gamePreviewProjector(bounds) {
  const width = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const height = Math.max(bounds.maxY - bounds.minY, 1e-6);
  const scale = Math.min(
    (FRAME.right - FRAME.left) / width,
    (FRAME.bottom - FRAME.top) / height
  );
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const screenCenterX = (FRAME.left + FRAME.right) / 2;
  const screenCenterY = (FRAME.top + FRAME.bottom) / 2;
  const sx = x => screenCenterX + (x - centerX) * scale;
  const sy = y => screenCenterY - (y - centerY) * scale;
  return point => [sx(point[0]), sy(point[1])];
}

function roundedPath(points, cornerRatio = .18) {
  if (!Array.isArray(points) || points.length < 3) return "";
  const ratio = Math.max(0, Math.min(.35, cornerRatio));
  const toward = (from, to) => [
    from[0] + (to[0] - from[0]) * ratio,
    from[1] + (to[1] - from[1]) * ratio
  ];
  const format = point => `${point[0].toFixed(2)},${point[1].toFixed(2)}`;
  const commands = [`M${format(toward(points[0], points[1]))}`];
  for (let index = 1; index <= points.length; index += 1) {
    const previous = points[(index - 1) % points.length];
    const current = points[index % points.length];
    const next = points[(index + 1) % points.length];
    commands.push(`L${format(toward(current, previous))}`);
    commands.push(`Q${format(current)} ${format(toward(current, next))}`);
  }
  return `${commands.join(" ")} Z`;
}

function smoothPoints(points, samplesPerSegment = 8, tension = .82) {
  if (!Array.isArray(points) || points.length < 3) return points || [];
  const curve = [];
  for (let index = 0; index < points.length; index += 1) {
    const p0 = points[(index - 1 + points.length) % points.length];
    const p1 = points[index];
    const p2 = points[(index + 1) % points.length];
    const p3 = points[(index + 2) % points.length];
    const tangent1 = [(p2[0] - p0[0]) * tension / 2, (p2[1] - p0[1]) * tension / 2];
    const tangent2 = [(p3[0] - p1[0]) * tension / 2, (p3[1] - p1[1]) * tension / 2];
    for (let sample = 0; sample < samplesPerSegment; sample += 1) {
      const t = sample / samplesPerSegment, t2 = t * t, t3 = t2 * t;
      curve.push([
        (2 * t3 - 3 * t2 + 1) * p1[0] + (t3 - 2 * t2 + t) * tangent1[0] + (-2 * t3 + 3 * t2) * p2[0] + (t3 - t2) * tangent2[0],
        (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * tangent1[1] + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * tangent2[1]
      ]);
    }
  }
  return curve;
}

function smoothPath(points) {
  const smooth = smoothPoints(points);
  return `${smooth.map((point, index) => `${index ? "L" : "M"}${point[0].toFixed(2)},${point[1].toFixed(2)}`).join(" ")} Z`;
}

function scaledPolygon(points, factor = .7) {
  if (!Array.isArray(points) || !points.length) return [];
  const center = points.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0])
    .map(value => value / points.length);
  return points.map(point => [
    center[0] + (point[0] - center[0]) * factor,
    center[1] + (point[1] - center[1]) * factor
  ]);
}

function treeCanopyMarkup(items, project) {
  const definitions = [];
  const artwork = [];
  (items || []).forEach((item, index) => {
    const outer = (item.polygon || []).map(project);
    if (outer.length < 3) return;
    const core = scaledPolygon(outer, .7);
    const xs = outer.map(point => point[0]), ys = outer.map(point => point[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    const width = Math.max(1, Math.max(...xs) - x), height = Math.max(1, Math.max(...ys) - y);
    const outerId = `preview-tree-outer-${index}`;
    const coreId = `preview-tree-core-${index}`;
    definitions.push(`<clipPath id="${outerId}"><path d="${smoothPath(outer)}"/></clipPath><clipPath id="${coreId}"><path d="${smoothPath(core)}"/></clipPath>`);
    const image = clipId => `<image href="assets/tree-canopy-top.png?v=20260812-2" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>`;
    artwork.push(`<g class="preview-tree-canopy"><g opacity=".5">${image(outerId)}</g>${image(coreId)}</g>`);
  });
  return { definitions: definitions.join(""), artwork: artwork.join("") };
}

export function renderGameMapPreview(hole) {
  const bounds = gamePreviewBounds(hole);
  const project = gamePreviewProjector(bounds);
  const geometries = hole.geometries;
  const paths = (items, className, smooth = false, displayPolygon = item => item.polygon || []) => (items || []).map(item => {
    const points = displayPolygon(item).map(project);
    return `<path class="${className}" d="${smooth ? smoothPath(points) : roundedPath(points, className.includes("tee") ? .12 : .18)}"/>`;
  }).join("");
  const water = (geometries.hazards || []).filter(item => item.lie_catalog_id?.includes("water"));
  const streams = water.filter(item => /stream|ditch/i.test(String(item.description || "")));
  const openWater = water.filter(item => !streams.includes(item));
  const sand = (geometries.hazards || []).filter(item => !item.lie_catalog_id?.includes("water"));
  const trees = treeCanopyMarkup(geometries.tree_zones, project);
  const greenPoints = (geometries.green_complex?.polygon || []).map(project);
  const route = (hole.centerline_waypoints || []).map(item => project(item.point));
  const pinSource = geometries.green_complex?.pin_zones?.find(zone => Array.isArray(zone.center_point))?.center_point;
  const teeSource = hole.centerline_waypoints?.[0]?.point;
  const pin = pinSource ? project(pinSource) : null;
  const tee = teeSource ? project(teeSource) : null;
  const routePoints = route.map(point => point.join(",")).join(" ");
  const teeArtwork = (geometries.tee_boxes || []).map(item => {
    const identity = `${item.id || ""} ${item.description || ""}`.toLowerCase();
    const teeClass = identity.includes("blue")
      ? "tee-blue"
      : identity.includes("red") || identity.includes("forward")
        ? "tee-forward"
        : "tee-white";
    const points = scaledPolygon(item.polygon || [], 1.75).map(project);
    return `<path class="preview-tee" data-tee="${teeClass}" d="${roundedPath(points, .12)}"/>`;
  }).join("");
  return `<svg class="game-map-preview-svg" viewBox="0 0 1000 1000" role="img" aria-label="Final full-hole game preview">
    <defs>
      <linearGradient id="preview-ground" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#315f3b"/><stop offset=".55" stop-color="#244d33"/><stop offset="1" stop-color="#1f412c"/></linearGradient>
      <pattern id="preview-native" width="38" height="38" patternUnits="userSpaceOnUse"><path d="M4 34l3-6m10 8l2-5m12 2l3-7M9 12l2-5m13 9l3-7m8 6l2-4" stroke="rgba(220,235,199,.13)" stroke-width="1.4" stroke-linecap="round"/></pattern>
      <pattern id="preview-fairway" width="58" height="58" patternUnits="userSpaceOnUse"><rect width="29" height="58" fill="rgba(255,255,255,.085)"/><rect x="29" width="29" height="58" fill="rgba(38,91,48,.055)"/></pattern>
      <pattern id="preview-sand" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="4" cy="5" r="1.2" fill="rgba(116,86,42,.17)"/><circle cx="15" cy="12" r=".9" fill="rgba(255,250,218,.38)"/></pattern>
      ${trees.definitions}
    </defs>
    <rect width="1000" height="1000" fill="url(#preview-ground)"/><rect width="1000" height="1000" fill="url(#preview-native)"/>
    ${paths(geometries.out_of_bounds, "preview-oob")}
    ${paths(geometries.rough_zones, "preview-rough")}
    ${paths(geometries.fairway_segments, "preview-fairway")}
    ${paths(geometries.fairway_segments, "preview-fairway-mow")}
    ${paths(geometries.cart_paths, "preview-cart-path", true)}
    <path class="preview-green-fringe" d="${smoothPath(greenPoints)}"/><path class="preview-green" d="${smoothPath(greenPoints)}"/>
    ${paths(openWater, "preview-water", true)}
    ${paths(streams, "preview-stream")}
    ${paths(sand, "preview-sand", true)}${paths(sand, "preview-sand-grain", true)}
    ${trees.artwork}
    ${teeArtwork}
    ${routePoints ? `<polyline class="preview-route" points="${routePoints}"/>` : ""}
    ${tee ? `<g class="preview-ball" transform="translate(${tee[0]},${tee[1]})"><circle r="10"/><circle class="preview-ball-shine" cx="-3" cy="-3" r="3"/></g>` : ""}
    ${pin ? `<g class="preview-pin" transform="translate(${pin[0]},${pin[1]})"><ellipse rx="9" ry="4"/><path d="M0 0V-48"/><path class="flag" d="M1-48l34 11-34 12z"/></g>` : ""}
  </svg>`;
}
