# OpenStreetMap Beta proof of concept

Tested against the configured Overpass endpoint on October 1, 2026.

## Existing Jetta-course coverage check

Warrenbrook Golf Course resolved to OSM facility `way/40139956`, but the returned data contained no numbered `golf=hole` routes. The importer correctly refused to fabricate a playable draft. For Warrenbrook, OSM does not currently reduce enough production work; the operator should use the explicit Golf Intelligence fallback or map manually.

The Meadows area likewise returned nearby facilities without usable numbered hole routes. This is an OSM coverage limitation, not an importer error.

## Parser capability check

Augusta National Golf Club (`way/871993734`) was used as a real-data parser exercise because it has substantially richer OSM coverage. After applying the selected facility boundary, the deterministic preview reported:

| Feature | Imported |
|---|---:|
| Numbered hole routes | 18 |
| Greens | 27 |
| Fairways | 19 |
| Tee polygons requiring identity | 48 |
| Bunkers | 42 |
| Water features | 5 |
| Rough features | 8 |

The extra greens/fairways and skipped diagnostics demonstrate why an operator preview and human review remain mandatory. Tee colors and scorecard yardages were not generated. Nearby-course hole routes were excluded using the selected facility boundary.

## Beta conclusion

The adapter materially reduces tracing work when OSM coverage includes numbered holes and surfaces, but coverage varies enough that it cannot replace the existing editor or Golf Intelligence fallback. The Beta workflow should remain OSM-first with an honest refusal when numbered hole evidence is absent.
