# Warrenbrook Golf Course Geometry Audit

The new GPS aerial images, scorecard image, and scorecard text are preserved in
`data/warrenbrook/`. The generated geometry is a testing-quality schematic based
on those sources and the user's earlier hole-by-hole corrections, not surveyed
course data.

## Authoritative orientation

All feature sides use the golfer's perspective along the local centerline.
Positive lateral coordinates mean golfer-right and negative coordinates mean
golfer-left. Screen orientation is never used as the side definition.

Reviewed routes:

- Holes 1, 8, 15, and 17 finish to golfer-right;
- holes 2, 5, 14, and 18 finish to golfer-left;
- the remaining holes are generally straight or have only a slight finish.

Previously confirmed corrections remain authoritative: Hole 1 has no greenside
bunker; Hole 2 has a tree-shadow-obscured right fairway bunker near 200 meters;
Holes 3 and 4 have left and right greenside bunkers respectively; Hole 6 water
is right; Holes 7 and 10 have right fairway bunkers; all Hole 8 bunkers are
right; Hole 13 and 14 greenside bunkers are right; Hole 15 has three right
fairway bunkers and no greenside bunker; Hole 17 has only one landing-area
bunker; and both Hole 18 greenside bunkers are golfer-right.

## Scorecard decisions

- The game centerline begins at the White tee and matches White scorecard
  distance. Separate Blue, White, and Red tee surfaces cover all starts.
- Total par is 71. The supplied totals are 6,372 Blue yards, 6,074 White yards,
  and 5,095 Red yards.

## Reproducibility

Run the generator after changing route or feature definitions:

```bash
python3 scripts/generate_warrenbrook_course.py
```

The native-schema JSON is validated for route distance, reviewed dogleg
direction, golfer-relative hazard sides, confirmed bunker counts, water sides,
tee coverage, and tee/pin surface resolution.
