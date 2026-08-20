# Cranbury Golf Club Geometry Audit

The active editor-installed geometry is stored in
`data/cranbury-golf-club/`. The retired built-in Cranbury dataset and source
assets have been removed.

## Authoritative orientation

All lateral feature positions use the golfer's perspective along the local
centerline. Positive lateral coordinates mean golfer-right; negative coordinates
mean golfer-left. Image screen orientation is never used as the side definition.

User-confirmed routes:

- Hole 5: dogleg left;
- Hole 6: dogleg left;
- Hole 9: dogleg left;
- Hole 17: dogleg left;
- Hole 18: generally straight with a slight left finish.

Hole 15 is modeled as a double bend, first right and then left. Holes 9, 10, 12,
and 15 have the lowest source-image precision because labels, stitching, or
vegetation obscure portions of the feature boundaries.

## Scorecard decisions

- The normalized game scorecard uses men's par: Hole 17 is par 4 and total par
  is 71.
- Cranbury's official forward tee is Gold. Its yardages remain in the app's
  canonical `Yards_Red` storage field but display as Gold for this course.
- The modeled centerline begins at the White tee and matches White scorecard
  distance. Separate Blue, White, and Gold tee surfaces cover all starting
  positions.

Future changes should be made in the Course Mapper and installed from the saved
`.golfmap` project so the game geometry remains aligned with the authored map.
