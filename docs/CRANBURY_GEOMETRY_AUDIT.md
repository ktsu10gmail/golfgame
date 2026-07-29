# Cranbury Golf Club Geometry Audit

Source assets are preserved in `data/cranbury/`. The geometry is a
testing-quality schematic derived from the supplied GPS aerial images and
scorecard, not surveyed course data.

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

## Reproducibility

Run the generator after changing reviewed route or feature definitions:

```bash
python3 scripts/generate_cranbury_course.py
```

The generated files are validated by the course adapter and by Cranbury-specific
tests for route distance, confirmed left turns, tee coverage, and golfer-relative
hazard sides.
