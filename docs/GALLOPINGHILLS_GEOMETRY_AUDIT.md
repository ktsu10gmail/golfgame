# Galloping Hill Golf Course Geometry Audit

Last updated: 2026-07-29

The supplied GPS aerial images, scorecard image, and scorecard text are
preserved in `data/gallopinghills/`. The generated geometry is a
testing-quality schematic derived from those sources, not surveyed course data.

## Authoritative orientation

All lateral feature positions use the golfer's perspective along the local
centerline. Positive lateral coordinates mean golfer-right; negative coordinates
mean golfer-left. Image screen orientation is not stored as the side definition.

The reviewed aerials show rightward finishes on Holes 1, 2, 3, 4, 6, 7, 8, 9,
10, 12, 13, 14, 16, 17, and 18. Holes 5, 11, and 15 are modeled as generally
straight par threes. Water is modeled golfer-left on Holes 3, 12, and 18.

Feature boundaries are approximate. Tree shadows, GPS labels, fall foliage, and
the source screenshots' perspective obscure portions of several bunkers and
rough edges.

## Scorecard decisions

- The normalized game scorecard uses the Blue/White men's par and handicap row:
  Hole 3 and Hole 14 are par 4, and total par is 71.
- The official forward tee is Gold. Its yardages remain in the app's canonical
  `Yards_Red` storage field but display as Gold for this course.
- The modeled centerline begins at the White tee and matches White scorecard
  distance. Separate Blue, White, and Gold tee surfaces cover all starts.
- The supplied totals are 6,273 Blue yards, 5,570 White yards, and 5,103 Gold
  yards.

The course's official scorecard publishes separate par/handicap rows for its
Blue/White and Gold tees. The project currently stores one par and handicap per
hole, so it follows the men's Blue/White row, consistent with the supplied
scorecard text:

<https://vip.teeitup.com/202303202/scorecard-layout/>

## Reproducibility

Run the generator after changing reviewed route or feature definitions:

```bash
python3 scripts/generate_gallopinghills_course.py
```

The generated files are validated by the course adapter and by Galloping
Hill-specific tests for route distance, rightward turns, golfer-relative hazard
sides, water placement, tee coverage, and tee/pin surface resolution.
