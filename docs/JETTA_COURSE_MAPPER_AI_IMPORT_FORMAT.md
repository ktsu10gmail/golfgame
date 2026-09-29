# Jetta Course Mapper AI Import Format

## Purpose

This document defines how an AI or other data-conversion tool should turn golf
course information into a project that Jetta Course Mapper can load.

The AI's output is a UTF-8 JSON file with the extension `.golfmap`. This is the
Mapper's editable source format. It is not the same as a `.golfcourse.json`
file, which is the game package produced by the Mapper after review and
validation.

The intended workflow is:

1. Collect reliable course metadata, scorecard values, and GPS geometry.
2. Ask the AI to normalize that data into the contract below.
3. Save the AI output as `<course-id>.golfmap`.
4. Open Course Mapper and choose **Load project**.
5. Review and correct every hole in the visual editor.
6. Preview the game map.
7. Use **Install in game** only after every hole reports that it is ready.

AI-generated geometry is a draft for human review. The AI must not invent
coordinates, hazards, yardages, or source attribution to make a project appear
complete.

## Import levels

There are two different meanings of "valid."

### Level 1: loadable project

A loadable project has valid JSON, the correct project version, a course name,
and structurally valid holes and polygons. The Mapper can open it even when
some course facts or shapes are missing. Missing holes are initialized as empty
holes by the Mapper.

This level is appropriate when the AI has incomplete source material and a
person will finish the mapping.

### Level 2: install-ready project

An install-ready project meets all Level 1 requirements and all publishing
requirements for every hole. The Mapper can convert it into Jetta's local game
geometry and install it.

The AI must report a project as install-ready only if every requirement in
the **Install-ready validation** section is satisfied.

## Required file rules

- File extension: `.golfmap`
- Encoding: UTF-8
- Content: one JSON object
- Project version: `golf-course-map-v1`
- No Markdown code fences in the saved file
- No comments, trailing commas, `NaN`, or `Infinity`
- All latitude and longitude values must be JSON numbers, not strings
- Units:
  - scorecard distances are yards;
  - elevation change is meters;
  - GPS coordinates are WGS84 decimal degrees.

## Top-level project contract

| Field | Type | Requirement | Meaning |
|---|---|---|---|
| `version` | string | Required | Must be `golf-course-map-v1`. |
| `course_name` | string | Required | Human-readable facility or course name. |
| `course_id` | string | Required for clean handoff | Lowercase identifier containing letters, numbers, and hyphens. Keep it at 63 characters or fewer. |
| `address` | string | Recommended | Source address, or an empty string if genuinely unavailable. |
| `updated_at` | string | Recommended | ISO 8601 timestamp for generation or refresh. |
| `imagery_source` | string | Recommended | Honest description of the geometry source. |
| `map_view` | object or null | Optional | Editor starting view, normally `null`. |
| `course_structure` | string | Required | `standard_18` or `three_nines`. |
| `nine_loops` | array | Required | Three fixed IDs with editable display names. |
| `holes` | object | Required | Hole objects keyed by the string hole number. |
| `external_course_source` | object | Recommended for imports | Provenance for the source data. |

Use these exact nine-loop IDs and hole ranges:

| ID | Default name | Holes |
|---|---|---|
| `central` | Central | 1–9 |
| `north` | North | 10–18 |
| `south` | South | 19–27 |

For `standard_18`, provide holes `"1"` through `"18"`. For `three_nines`,
provide holes `"1"` through `"27"`. All three loop names must be different for
a three-nine project.

Recommended provenance object:

```json
{
  "provider_name": "Name of the actual source",
  "provider_public_id": "Source record ID or URL",
  "provider_imported_at": "2026-09-28T12:00:00Z",
  "provider_payload_version": "Source version if known",
  "provider_last_refresh_at": "2026-09-28T12:00:00Z",
  "provider_source_hash": "SHA-256 if calculated",
  "imported_hole_count": 18
}
```

Do not claim a provider, source ID, version, or hash that was not actually
used. Omit an unknown optional field instead.

## Hole contract

Each entry in `holes` has this shape:

```json
{
  "hole_number": 1,
  "par": 4,
  "handicap": 7,
  "layout_type": "Dogleg right",
  "elevation_change_meters": 2.5,
  "yardages": {
    "blue": 410,
    "white": 382,
    "forward": 331
  },
  "markers": {
    "blue_tee": { "lat": 40.50001, "lng": -74.40001 },
    "white_tee": { "lat": 40.50012, "lng": -74.39998 },
    "forward_tee": { "lat": 40.50025, "lng": -74.39993 },
    "pin": { "lat": 40.50331, "lng": -74.39782 }
  },
  "route_points": [
    { "lat": 40.50175, "lng": -74.39912 }
  ],
  "features": [],
  "import_status": "NEEDS_REVIEW",
  "import_warnings": [
    "Example only: add verified feature polygons before installation."
  ],
  "field_provenance": {
    "par": "club scorecard",
    "handicap": "club scorecard",
    "yardages": "club scorecard",
    "geometry": "verified GPS source"
  }
}
```

The coordinates above demonstrate structure only. They do not describe a real
course and must not be copied into a production project.

### Hole field rules

| Field | Rule |
|---|---|
| `hole_number` | Integer matching the key in `holes`. |
| `par` | Normally an integer from 3 through 6. |
| `handicap` | Integer from 1 through 18. In a three-nine source, the author may use 1–9 within each nine. |
| `layout_type` | Short player-facing description. Do not expose source variable names. |
| `elevation_change_meters` | Tee-to-green change in meters. Use `0` only when the source says it is level or elevation is intentionally not modeled; record uncertainty in `import_warnings`. |
| `yardages` | Positive scorecard yardages for `blue`, `white`, and `forward`. Map differently named source tees to these three roles and retain that mapping in provenance. |
| `markers` | Point objects for the three tee starts and pin, or `null` when unknown. |
| `route_points` | Zero or more intermediate centerline points in tee-to-green order. Do not repeat the white tee or pin here. |
| `features` | Polygon features defined below. |
| `import_status` | Use `IMPORTED` when source mapping is complete, otherwise `NEEDS_REVIEW`. This is review metadata, not proof that a hole is install-ready. |
| `import_warnings` | Specific unresolved facts or transformations. Use an empty array only when none are known. |
| `field_provenance` | Recommended per-field source names. |

## Feature polygon contract

Every item in `features` should contain:

```json
{
  "id": "h1-green-1",
  "type": "green",
  "label": "Hole 1 green",
  "source": "verified GPS source",
  "manual_override": false,
  "points": [
    { "lat": 40.50320, "lng": -74.39791 },
    { "lat": 40.50327, "lng": -74.39770 },
    { "lat": 40.50343, "lng": -74.39777 },
    { "lat": 40.50338, "lng": -74.39798 }
  ]
}
```

The permitted `type` values are:

| Type | Use |
|---|---|
| `tee_blue` | Blue/back tee-box surface. |
| `tee_white` | White/middle tee-box surface. |
| `tee_forward` | Forward tee-box surface. |
| `fairway` | Fairway segment. Multiple segments are allowed. |
| `rough` | Primary playable rough. |
| `bunker` | Sand bunker. |
| `green` | Putting green. The first green is used as the primary game green. |
| `water` | Verified water hazard or water penalty area. |
| `penalty_area_unknown` | Known penalty boundary whose correct classification still needs review. This blocks installation. |
| `hole_outline` | Overall mapped hole boundary. |
| `cart_path` | Cart-path polygon. |
| `trees` | Tree or wooded-area polygon. |
| `out_of_bounds` | Out-of-bounds polygon. |

Each polygon must have at least three distinct points. List perimeter vertices
in order around the shape. Do not repeat the first point at the end. Avoid
self-intersections, duplicate consecutive vertices, and implausibly long edges.
Use a unique, stable `id` for each feature within a hole.

`id`, `label`, `source`, and `manual_override` improve editing and traceability,
even though the current basic loader validates primarily `type` and `points`.

## Coordinate rules

The direct import contract uses real WGS84 coordinates:

```json
{ "lat": 40.1234567, "lng": -74.1234567 }
```

- Latitude must be between -90 and 90.
- Longitude must be between -180 and 180.
- Use enough precision to preserve course geometry; six or seven decimal
  places is normally appropriate.
- All markers, route points, and feature polygons for a hole must use the same
  coordinate reference and be geographically aligned.
- Do not place image pixels, percentages, or local `[x, y]` values into
  `lat`/`lng` fields.
- If the source has only pixel geometry, it must first be georeferenced with
  reliable control points or completed manually in Course Mapper.
- Do not infer detailed polygons from only a street address, scorecard, or
  verbal course description.

When the Mapper exports a hole, it transforms the GPS geometry into the game's
local meter coordinate system. The white tee becomes `[0, 0]`; positive `y`
points forward toward the pin and `x` is golfer-relative lateral displacement.
This conversion is why consistent geographic alignment matters.

## Install-ready validation

Every hole must have all of the following before it can be installed:

- a `blue_tee`, `white_tee`, `forward_tee`, and `pin` marker;
- a `tee_blue`, `tee_white`, and `tee_forward` polygon;
- at least one `rough` polygon;
- at least one `green` polygon;
- at least one `fairway` polygon when `par` is greater than 3;
- nonzero blue, white, and forward yardages;
- no `penalty_area_unknown` features;
- each tee marker inside a corresponding tee polygon; and
- the pin inside a green polygon.

Par-3 holes do not require a fairway. Bunkers, water, trees, cart paths, hole
outlines, and out-of-bounds shapes are optional only when they genuinely do not
exist or are outside the intended source coverage. Never omit a known hazard
merely to pass validation.

A structurally valid project can still be geographically wrong. The human
reviewer must compare its shapes against an authorized aerial/GPS source before
installation.

## Handling incomplete source data

When required data is missing:

1. Preserve the known values.
2. Use `null` for unknown markers.
3. Use an empty array for geometry that is not available.
4. Set `import_status` to `NEEDS_REVIEW`.
5. Add a precise warning, such as `"No forward tee polygon was present in the source."`
6. Do not create a guessed shape or coordinate.

If a penalty boundary exists but its classification is uncertain, use
`penalty_area_unknown` and warn that it must be classified. Course Mapper will
intentionally prevent installation until the reviewer changes it to `water` or
removes it after verification.

## AI transformation methodology

An AI preparing a project should follow these steps in order.

### 1. Inventory the inputs

Identify each source and what it actually establishes:

- official or trusted scorecard: hole number, par, handicap, tee yardages;
- authorized GPS data: markers, paths, and surface polygons;
- elevation source: tee-to-green elevation change;
- facility metadata: name, address, loop names, and source IDs.

Do not treat a marketing description or rendered screenshot as precise GPS
geometry unless it has been georeferenced.

### 2. Select the course structure

Use `standard_18` for one 18-hole routing. Use `three_nines` only when the
facility has three distinct nine-hole loops to be combined into routes.

### 3. Normalize the scorecard

For each hole, map the source tees to blue/back, white/middle, and
forward. Keep the source tee name or color in provenance. Verify that hole
numbers are unique and that yardages are plausible and positive.

### 4. Normalize GPS geometry

Convert all source coordinates to `{ "lat": number, "lng": number }`. Preserve
polygon vertex order. Map source feature classes only when their meaning is
known. Do not classify an ambiguous penalty area as water solely to satisfy the
validator.

### 5. Derive markers conservatively

A source-provided marker is preferred. A polygon centroid may be used for a tee
marker or provisional pin only when that rule is documented in
`import_warnings` or provenance and the resulting point is confirmed to lie
inside the polygon.

### 6. Build the route

Place only intermediate dogleg or control points in `route_points`, in order
from white tee to pin. For a straight hole, use an empty array.

### 7. Validate relationships

Check polygon sizes and shapes, tee and pin containment, hole numbering,
coordinate ranges, unique feature IDs, and completeness. A numerical check does
not replace visual review.

### 8. Emit JSON only

For a directly saved import, output the JSON object with no explanation before
or after it. Put unresolved issues in `import_warnings`, not in surrounding
prose.

## Minimal loadable project example

This example is intentionally incomplete and is suitable only for testing the
loader. Course Mapper will create empty holes 2–18. It cannot be installed in
the game until all holes and required geometry are completed.

```json
{
  "version": "golf-course-map-v1",
  "course_name": "Example Course",
  "course_id": "example-course",
  "address": "",
  "updated_at": "2026-09-28T12:00:00Z",
  "imagery_source": "No geometry source supplied",
  "map_view": null,
  "course_structure": "standard_18",
  "nine_loops": [
    { "id": "central", "name": "Central" },
    { "id": "north", "name": "North" },
    { "id": "south", "name": "South" }
  ],
  "holes": {
    "1": {
      "hole_number": 1,
      "par": 4,
      "handicap": 1,
      "layout_type": "Unknown",
      "elevation_change_meters": 0,
      "yardages": { "blue": 0, "white": 0, "forward": 0 },
      "markers": {
        "blue_tee": null,
        "white_tee": null,
        "forward_tee": null,
        "pin": null
      },
      "route_points": [],
      "features": [],
      "import_status": "NEEDS_REVIEW",
      "import_warnings": [
        "No verified scorecard or GPS geometry has been supplied."
      ]
    }
  }
}
```

For a real AI-generated project, explicitly output every hole instead of
relying on the Mapper to create empty ones.

## Reusable AI instruction

The following instruction can be supplied to an AI together with authorized
source data:

```text
Convert the supplied golf-course data into one Jetta Course Mapper `.golfmap`
JSON object.

Requirements:
- Use project version `golf-course-map-v1`.
- Use `standard_18` with holes 1-18, or `three_nines` with holes 1-27, according
  to the supplied course structure.
- Use WGS84 decimal GPS objects in the form {"lat": number, "lng": number}.
- Use only these feature types: tee_blue, tee_white, tee_forward, fairway,
  rough, bunker, green, water, penalty_area_unknown, hole_outline, cart_path,
  trees, out_of_bounds.
- Give every feature a stable unique ID, useful label, honest source, and at
  least three perimeter points in order.
- Put tee markers inside their matching tee polygons and the pin inside the
  green when those data are available.
- Put only intermediate tee-to-green controls in route_points.
- Preserve yards as yards and elevation change as meters.
- Do not invent missing coordinates, yardages, hazards, elevation, provider
  names, or source IDs.
- For missing or ambiguous data, use null or an empty array, set import_status
  to NEEDS_REVIEW, and add a precise import_warnings entry.
- Do not describe an incomplete project as install-ready.
- Return JSON only, without Markdown fences or commentary.
```

## Loading and publishing the result

1. Save the AI response as `<course-id>.golfmap`.
2. Open `https://golfmapper.jetta.com/editor.html`.
3. Choose **Load project** and select the file.
4. If loading fails, correct the exact JSON or schema error shown by the Mapper.
5. Inspect every hole, especially tee-role mapping, hazards, green, pin,
   doglegs, and yardages.
6. Resolve every `NEEDS_REVIEW` warning using a reliable source.
7. Confirm each hole says it is ready to export.
8. Use **Preview game map** to inspect the converted local geometry.
9. Use **Install in game**. The server validates the generated game package,
   writes the scorecard and hole data, and registers the installed course.
10. Reload the game and perform a gameplay QA pass before treating the course
    as production-ready.

For a three-nine project, installation produces the six ordered 18-hole
combinations formed from the three loops.

## Existing automated provider path

Jetta also has an authenticated provider-import path in Course Mapper. That
path searches the provider, fetches course detail or an approved GPS-only
payload, normalizes it into the same `golf-course-map-v1` project, and opens the
result for review. It does not bypass human review or publish provider data
directly into gameplay.

Its normalizer maps known source classes to Mapper features, maps tee sets into
blue/white/forward roles, derives provisional markers when appropriate, and
creates warnings for missing green, tee, or fairway geometry and for ambiguous
penalty areas. Provider credentials and tokens remain on the server.

Provider licensing and terms still apply. Do not scrape, mirror, redistribute,
or use a provider catalog for model training or retrieval unless the applicable
agreement explicitly permits it. The direct `.golfmap` format does not grant
rights to the underlying source data.

## Final quality checklist

Before accepting an AI-created file, confirm:

- [ ] The file parses as JSON and uses `golf-course-map-v1`.
- [ ] The course name, ID, address, and structure are correct.
- [ ] All 18 or 27 holes are explicitly present.
- [ ] Par, handicap, and three tee yardages match a trusted scorecard.
- [ ] Every coordinate is real WGS84 data from an authorized source.
- [ ] Every polygon uses an allowed type and has at least three ordered points.
- [ ] No known hazard was invented, hidden, or misclassified.
- [ ] Tee markers are inside their tee boxes and the pin is inside the green.
- [ ] Intermediate route points follow the intended playing route.
- [ ] Missing facts are visible in `import_warnings`.
- [ ] Every install-ready requirement passes in Course Mapper.
- [ ] A person visually reviewed every hole and previewed the game map.
- [ ] The installed course received a gameplay QA pass.

## Implementation references

The authoritative behavior is implemented in:

- `packages/editor/course_mapper.mjs` — project parser, schema validation,
  publish checks, coordinate conversion, and package construction;
- `editor.js` — Load project, Save project, preview, export, and installation
  workflow;
- `packages/course_import/normalizer.py` — existing provider-to-Mapper
  normalization and provenance metadata;
- `scripts/serve.py` — server-side course-package installation; and
- `docs/COURSE_MAPPER.md` — human editing and publishing workflow.
