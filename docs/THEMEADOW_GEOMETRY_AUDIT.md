# The Meadows at Middlesex Geometry Audit

The supplied aerial hole images, scorecard image, and scorecard text are
preserved in `data/themeadow/`. The generated geometry is a testing-quality
schematic derived from those sources, not surveyed course data.

## Authoritative orientation

All lateral feature positions use the golfer's perspective along the local
centerline. Positive lateral coordinates mean golfer-right; negative coordinates
mean golfer-left. Image screen orientation is never used as the side definition.

Reviewed routes:

- Holes 1, 3, 4, 13, 16, and 18 finish to golfer-right;
- holes 5, 7, 9, and 12 finish to golfer-left;
- the remaining holes are modeled as generally straight.

Reviewed water hazards appear only on Hole 2 golfer-left, Holes 10 and 11
golfer-right, and Hole 17 golfer-left. Labels, tree cover, image stitching, and
perspective limit the precision of some feature boundaries.

## Scorecard decisions

- The scorecard has Blue, White, and Red tees. The game centerline begins at the
  White tee and matches the White scorecard distance.
- Hole 11 White is stored as 332 yards because that is the value in the supplied
  scorecard text, despite the unusually large gap from its 415-yard Blue tee.
- Total par is 70. The supplied totals are 6,277 Blue yards, 6,027 White yards,
  and 4,762 Red yards.

## Reproducibility

Run the generator after changing reviewed route or feature definitions:

```bash
python3 scripts/generate_themeadow_course.py
```

The generated files are validated by the course adapter and Meadow-specific
tests for route distance, route direction, water-hazard sides, tee coverage, and
tee/pin surface resolution.
