# One-hole illustrated renderer prototype — 2026-10-08

The prototype follows the supplied course renderer specification, with the user's
later preference for the simple flat green shown in the left reference panel.
It is opt-in in Mapper's game preview and is not applied to gameplay, export,
installation, replay, or the green close-up view.

## Review

Open a hole's **Preview game map**, then enable **Illustrated style · one-hole
prototype**. Disable the checkbox to compare the existing renderer. Each new
preview opens in the existing style; the setting is neither saved nor exported.

A standalone comparison of the existing saved Warrenbrook Golf Course - New,
Hole 1 geometry is generated with:

    node scripts/preview_course_renderer.mjs

Open `output/playwright/renderer-prototype.html`. The desktop comparison and
mobile screenshots are `renderer-comparison.png` and `renderer-mobile.png` in
that directory. Alta Vista geometry was unavailable in the local saved catalog.

## Architecture and boundaries

Existing `renderMap`, `terrainReliefMarkup`, and `greenReliefMarkup` in app.js
own game rendering. Mapper uses `renderGameMapPreview` in
packages/editor/game_map_preview.mjs. Existing preview trees clip the shared
assets/tree-canopy-top.png texture into mapped tree zones.

The prototype consumes the same game-hole object through
packages/editor/illustrated_hole_prototype.mjs. It adds a cosmetic SVG layer:
seeded canopy placements, six crops from the existing tree texture, varied
rotation/size, consistent southeast shadows, fairway mowing bands, subdued
water, bunker edge styling, and a flat green with a restrained collar.

Mapped tree zones inform placement. Additional trees outside fairways are
explicit decorative estimates. Canopies avoid fairways, greens, first cut,
tees, water, bunkers, paths, and out-of-bounds polygons. No tree zones or
obstructions are added to course data. The 5-yard first-cut gameplay geometry
and all mapped geometry remain unchanged. A portrait crop is presentation only.

This code creates no course schema, lie, shot, GPS, replay, green-mode,
installation, or publication changes. It adds no asset dependency or network
request beyond the existing local tree texture. At most 900 reused canopy
instances are rendered. Exact photorealism is not claimed.

## Validation and limits

Real Warrenbrook geometry tests verify repeatable output, data immutability,
placement outside fairway/green, and the canopy limit. Existing Mapper tests
remain passing. Browser review used local Chromium with desktop and 390 x 844
mobile viewports; comparison control and resource loading were checked. The
reference hole originally generated 523 canopies; the requested 40% reduction
now retains 314. Existing screenshots show the original density; the standalone
HTML and Mapper toggle use the reduced density. This is not a measured mobile-device
performance benchmark or a verification of the authenticated running Mapper.

Before expanding beyond this prototype, review the screenshots and the desired
tree density. Future rollout needs shared renderer integration and regression
coverage for long par 5, narrow par 4, par 3, water and bunker complexes, close-up
green, GPS, replay, and installation. No wider rollout is performed here.

Tree placement additionally excludes the full tee-to-green route, including
the open ground before the fairway and green approach. An 8-yard feature
clearance and a 12-yard route half-width include each canopy/shadow envelope.
This applies only to decorative preview trees; source tree/gameplay geometry
is unchanged. Counts fall further where these clearances remove trees.

Latest tree adjustment: canopies are 1.5 times their original diameter and
density is reduced from 60% to 30% of eligible placements. Enlarged canopy
and shadow clearances may remove additional trees near playable areas.

User-approved expansion: illustrated style is now the default Mapper preview
for every hole. The preview window includes a hole selector so all 18 holes
(or 27 for three-nines layouts) can be browsed without changing the editor's
active hole. Missing geometry produces a per-hole message rather than retaining
the previous hole's image. Original style remains available via the checkbox.
Gameplay and installed course rendering are not changed by this expansion.

Par-3 previews without a fairway now derive decorative tree candidates beside
the tee-to-green corridor. They use the same density, size, and protected-area
clearance rules, and never create a fairway or gameplay tree obstruction.

Alta Vista Hole 3 has a course-specific cosmetic override: its trees are twice
the current canopy size. Enlarged canopy/shadow clearance still applies.
Other holes keep their existing size.

Approved game rollout: the game now shares the approved decorative canopy
placement and size rules in its full-hole map and 3D terrain map, reprojected
through the active camera. A per-hole placement cache avoids recomputing trees
on each render. Installed geometry renders directly instead of using older
baked illustration images. The flat green and diagonal mowing presentation
are applied in the full-hole/terrain views. Existing close-up green interaction,
GPS, replay, shot, and calculation layers remain authoritative.

An installation export fix maps an empty OSM production context to null. It
does not discard supplied production identities or weaken installer validation.
