# OpenStreetMap course-import operations

Jetta Course Mapper uses OpenStreetMap as a zero-credit draft source. It is not a scorecard source and does not make a course playable without operator review.

## Operator workflow

1. Open **Course queue** and claim the oldest requested course.
2. In **Import course**, enter a known latitude/longitude or use the current map center.
3. Select the correct facility. The directory name, city, and state are confirmation evidence; a nearby name is never selected automatically.
4. Review the deterministic OSM preview. Unsupported or ambiguous geometry is skipped and listed with its OSM identity.
5. Open the draft in Mapper. Supply trusted tee identities, scorecard yardages, and any missing/corrected geometry.
6. Use the existing final game-map preview and per-hole readiness checks.
7. Install the course. The request becomes `READY` only after every expected package is installed and verified.

Golf Intelligence remains an explicit fallback. Jetta never calls it automatically after an OSM failure or incomplete result.

The initial real-data findings are recorded in [OpenStreetMap Beta proof of concept](openstreetmap-beta-poc.md).

## Data and identity

- Coordinates remain WGS84 `{lat, lng}` through import and editing.
- Each OSM hole is marked as georeferenced WGS84 geometry. When its white tee
  and pin are complete, Mapper generates the on-course GPS transform
  deterministically; manual three-point calibration is not required.
- `production_item_id` and immutable `directory_course_id` travel through the Mapper project, exported package, installed catalog, and READY mapping.
- OSM element IDs, source timestamp/hash, normalizer version, and import time are retained separately as provider provenance.
- Tee colors, scorecard yardages, and missing hole numbers are never inferred.

## Attribution and license handling

OSM-derived drafts retain `© OpenStreetMap contributors · ODbL` provenance. The attribution appears in Mapper while editing and in the game header for an installed OSM-derived course. It is also stored in the exported package and mapped-course catalog.

Before public release, the release owner must confirm that the selected Overpass endpoint permits the intended load, that product attribution remains visible, and that distribution or database obligations under ODbL are satisfied. Manual edits do not automatically erase source provenance.

## Configuration and limits

The server owns the allowlisted HTTPS Overpass endpoint; the browser cannot provide another endpoint. Settings are documented in `.env.example` under `OSM_IMPORT_*`.

The adapter bounds response size, element count, points per feature, total points, coordinate ranges, search radius, timeout, and retry count. Relation traversal is non-recursive in Beta. Closed ways and safely assembled outer rings are accepted; inner rings and unresolved relation geometry are skipped with warnings.

All queue, OSM import/refresh/commit, Golf Intelligence import, and install routes require the existing authenticated Developer policy.
