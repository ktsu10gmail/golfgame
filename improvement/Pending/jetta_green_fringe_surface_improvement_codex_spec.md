# Jetta Green Fringe Surface Improvement
## Codex Implementation Specification

## 1. Purpose

Add **Green Fringe** as a first-class surface type in Jetta.

This improvement should integrate with:

- course geometry and the Course Editor;
- illustrated hole rendering;
- shot lie classification;
- Landing Target mode;
- Rule of 12 short-game evaluation;
- trajectory and rollout;
- Simulated Green Contours;
- putting from off the green;
- Game Master recommendations;
- replay/evidence storage.

The key design principle is:

> **Fringe is not merely visual decoration. It is a gameplay surface that can affect landing, rollout, club selection, putting, and strategy.**

---

## 2. Surface Hierarchy

Jetta should recognize at least:

```text
FAIRWAY
ROUGH
FRINGE
GREEN
BUNKER
WATER
PENALTY_AREA
```

Preserve any additional existing surface types.

`FRINGE` should be distinguishable from both `GREEN` and `ROUGH`.

Conceptually:

```text
ROUGH → FRINGE → GREEN
```

---

## 3. Why Fringe Matters

With Landing Target and Rule of 12, the player is deciding:

```text
Where should the ball land?
Which club should I use?
How will the ball release after landing?
```

A ball landing on fringe should not automatically behave exactly like one landing on the green.

Example:

```text
Ball → Landing Target = 10 yd
Landing Target surface = FRINGE
Pin = 25 yd
```

The shot may:

1. carry to the fringe;
2. lose some speed while traveling through fringe;
3. enter the green;
4. continue rolling according to green speed and contour;
5. finish at the simulated final position.

This makes landing-target placement strategically meaningful.

---

## 4. Authoritative vs Derived Fringe Geometry

Support two fringe geometry sources:

```text
IMPORTED
MANUAL
GENERATED
```

### Imported

If a future provider supplies reliable fringe geometry, normalize it into Jetta's schema.

### Manual

The Course Editor must allow the user to draw/edit a fringe polygon.

### Generated

If only the green polygon exists, Jetta may generate an estimated collar around it.

Generated fringe must be explicitly identified as derived/simulated geometry.

Example metadata:

```json
{
  "surface_type": "FRINGE",
  "geometry_source": "GENERATED",
  "derived_from": "GREEN",
  "fringe_width_yards": 2.0,
  "generator_version": "1.0"
}
```

Do not represent generated fringe as surveyed/real-course geometry.

---

## 5. Generated Fringe Geometry

When generating fringe from an existing green polygon:

```text
outer_boundary = buffer(green_polygon, fringe_width)
fringe_polygon = outer_boundary - green_polygon
```

Use the project's existing local-meter/yard coordinate system and geometry libraries.

The width should be configurable.

Initial default may be approximately:

```text
2 yards
```

but this must be a configuration/default, not a claim that every course has a two-yard fringe.

The Course Editor should allow adjustment.

---

## 6. Geometry Rules

Validate that:

- fringe surrounds or borders its associated green;
- fringe does not overwrite the green polygon;
- green remains authoritative for `GREEN`;
- fringe does not create invalid/self-intersecting geometry;
- manual edits survive regeneration unless the user explicitly requests replacement;
- published geometry is versioned according to the existing course publishing workflow.

Define surface precedence clearly for overlapping geometry.

Suggested relevant precedence:

```text
GREEN > FRINGE > FAIRWAY/ROUGH
```

Do not change bunker/water/penalty precedence without inspecting existing rules.

---

## 7. Course Editor

Add `FRINGE` to the existing surface/polygon editor.

Suggested controls:

```text
Green
Fringe
Bunker
Fairway
Rough
Water
...
```

For a selected green, provide an optional action:

```text
[Generate Fringe]
```

Possible workflow:

```text
Select Green
    ↓
Generate Fringe
    ↓
Choose/accept width
    ↓
Preview
    ↓
Edit manually if needed
    ↓
Validate
    ↓
Save draft
```

Do not automatically overwrite an existing manually edited fringe.

---

## 8. Illustrated Hole Renderer

Render fringe visually as a collar around the green.

The illustrated background remains derived from authoritative/approved geometry.

Concept:

```text
rough
   ↓
slightly shorter/lighter fringe collar
   ↓
putting green
```

The renderer should preserve:

- exact green boundary;
- exact fringe boundary;
- same coordinate system as gameplay geometry;
- deterministic rendering.

Do not let visual texture modify gameplay geometry.

---

## 9. Lie Classification

The shot engine must be able to classify:

```text
ball lies on FRINGE
```

and:

```text
landing target lies on FRINGE
```

These are separate facts.

Example:

```text
start_lie = ROUGH
landing_surface = FRINGE
finish_lie = GREEN
```

Store all three where relevant.

---

## 10. Fringe Rollout Model

Add/reuse a surface-roll modifier for fringe.

At minimum:

```text
green = lower rolling resistance
fringe = greater rolling resistance than green
rough = substantially greater resistance than fringe
```

Do not hard-code unrealistic universal values if the project already has configurable surface coefficients.

Prefer configurable parameters such as:

```json
{
  "surface": "FRINGE",
  "roll_resistance_multiplier": 1.0,
  "speed_retention": 0.0
}
```

The values above are placeholders only. Codex must inspect the existing physics/rollout implementation and choose compatible fields and calibrated defaults.

---

## 11. Surface Transition During Roll

A rolling ball may cross multiple surfaces:

```text
FRINGE → GREEN
GREEN → FRINGE
FRINGE → ROUGH
GREEN → FRINGE → GREEN
```

The rollout calculation should apply the appropriate surface behavior along the path rather than assigning one surface coefficient to the entire roll.

Preferred conceptual algorithm:

```text
simulate roll path
      ↓
detect surface segments/intersections
      ↓
apply resistance for each segment
      ↓
apply green slope/contour when on green
      ↓
continue until ball stops
```

Reuse existing geometry and rollout systems where possible.

---

## 12. Landing Target Integration

Landing Target mode must identify the surface under the selected landing point.

Example UI:

```text
LANDING TARGET
10 yd

LANDING SURFACE
Fringe

CLUB
9 Iron

AUTO POWER
calculated

EXPECTED
Carry: 10 yd
Fringe travel: 3 yd
Green rollout: 10 yd
Finish: near pin
```

Actual values must come from the simulation.

The automatic power solver should continue solving primarily for **carry to the landing point**.

Fringe affects what happens after landing.

---

## 13. Rule of 12 Integration

Traditional Rule of 12 remains a candidate-club heuristic.

However, Jetta's dynamic evaluation should recognize that the planned rollout may cross fringe.

Example:

```text
Carry to landing target: 10 yd
Nominal remaining distance to pin: 15 yd

Traditional Rule of 12:
suggests 9I-like candidate

But landing point = FRINGE
and first 3 yd of rollout = FRINGE

Simulation:
9I loses additional speed before entering green
Expected finish = short
```

The evaluator may therefore:

- choose a less-lofted club;
- move the preferred landing target;
- recommend a different strategy.

Core principle remains:

> **Rule of 12 proposes. Simulation evaluates.**

---

## 14. Landing-Target Optimization

Do not assume the player must always land on the green.

Valid strategic landing targets may include:

```text
FRINGE
GREEN
FAIRWAY/APRON where appropriate
```

The Game Master can compare:

```text
Option A:
Land on fringe and release onto green

Option B:
Carry onto green and use less rollout

Option C:
Use higher loft and land closer to pin
```

This makes landing location part of the strategy rather than merely a UI marker.

---

## 15. Simulated Green Contours

When the ball reaches the green, apply the existing **Simulated Green Contours** model.

Conceptual sequence:

```text
shot lands on fringe
        ↓
fringe rollout
        ↓
ball crosses green boundary
        ↓
green rollout
        ↓
Simulated Green Contours influence speed/direction
        ↓
final position
```

Do not apply green contour effects to fringe unless the terrain model explicitly supports continuous elevation outside the green.

If possible, preserve elevation continuity at the fringe/green boundary.

---

## 16. Putting From Fringe

Allow `PUTTER` as a valid club when the ball lies on fringe unless an existing rule explicitly prevents it.

Putting from fringe should account for:

```text
distance traveled on fringe
distance traveled on green
fringe resistance
green speed
green contour after entering green
```

Example:

```text
Ball on fringe
3 ft fringe
18 ft green
Pin

Putter model:
initial energy
    ↓
3 ft fringe resistance
    ↓
green entry speed
    ↓
green contour/break
    ↓
cup
```

Do not treat the entire shot as a normal green putt.

---

## 17. Chipping From Fringe

The player may also choose to chip from fringe.

Possible choices:

```text
Putter
7 Iron
9 Iron
PW
SW
LW
```

Use existing club/lie rules and player profile.

The Game Master may compare putting vs chipping when both are viable.

---

## 18. Game Master

Provide structured facts such as:

```text
start lie: ROUGH
landing target: 11 yd
landing surface: FRINGE
fringe rollout segment: 2.8 yd
green rollout segment: 9.4 yd
pin distance: 24 yd
hazard clearance: none
```

The Game Master may explain:

> Your landing point is on the fringe, so the ball is expected to lose some speed before reaching the green. Moving the landing point just onto the green gives the 9-iron more predictable rollout in the current model.

The LLM must not invent surface distances or physics.

---

## 19. Safe & Smart vs Aggressive

Fringe can affect strategic evaluation.

Examples:

### Safe & Smart

A larger fringe landing area may provide more margin than attempting to land just over a bunker onto a small green target.

### Aggressive

A higher-lofted shot may carry directly onto the green and finish closer to the pin but have a smaller acceptable landing area.

Reuse the existing probabilistic/hybrid evaluator.

Do not create a separate fringe risk engine.

---

## 20. Replay Evidence

Persist fringe-related evidence where available:

```text
start_lie
landing_target_surface
actual_landing_surface
finish_lie
fringe_distance_traveled
green_distance_traveled
surface_transition_sequence
expected_rollout
actual_rollout
```

For Landing Target shots also retain the existing target/club/auto-power evidence.

Example replay facts:

```text
Intended landing surface: Fringe
Actual landing surface: Fringe
Fringe travel: 3.1 yd
Green rollout: 8.7 yd
Finish: 2.4 yd short of pin
```

Keep Result, Decision, and Outcome-vs-Target concepts separate.

---

## 21. Backward Compatibility

Existing courses may have no fringe polygon.

They must continue to work.

Possible behavior:

```text
if explicit fringe exists:
    use it

elif generated fringe feature enabled:
    use generated derived fringe

else:
    preserve existing green/rough/fairway behavior
```

Do not silently alter every published course without versioning/review.

---

## 22. Data Model

Adapt to the existing schema rather than duplicating concepts.

Possible geometry metadata:

```json
{
  "surface_type": "FRINGE",
  "green_id": "green_07",
  "geometry_source": "GENERATED",
  "derived_from_geometry_version": "green-v4",
  "fringe_width_yards": 2.0,
  "generator_version": "1.0"
}
```

Possible shot evidence:

```json
{
  "start_lie": "ROUGH",
  "aim_type": "LANDING_TARGET",
  "landing_target_surface": "FRINGE",
  "selected_club": "9I",
  "calculated_power_percent": 22.0,
  "expected_carry_yards": 10.0,
  "expected_fringe_roll_yards": 3.0,
  "expected_green_roll_yards": 10.0
}
```

Values are examples only.

---

## 23. Do Not Create Duplicate Systems

Before implementation, inspect and reuse:

```text
surface polygon schema
point-in-polygon lie classification
course editor geometry tools
geometry validation
illustrated renderer
club/partial swing model
Landing Target implementation
Rule-of-12 implementation
rollout engine
putting engine
Simulated Green Contours
hybrid/probabilistic evaluator
replay evidence schema
```

Fringe should extend these systems.

---

## 24. Tests

Add tests for:

- generated fringe around a valid green;
- manual fringe editing;
- green remains distinct from fringe;
- point classification on green/fringe/rough boundaries;
- shot landing on fringe;
- shot rolling fringe → green;
- shot rolling green → fringe;
- Landing Target placed on fringe;
- Rule-of-12 candidate with fringe rollout;
- simulation overriding textbook Rule-of-12 choice;
- uphill/downhill green after fringe transition;
- bunker between ball and fringe target;
- putter from fringe;
- chip from fringe;
- player chooses 7I/PW/SW/LW from same position;
- Game Master receives correct structured surface facts;
- replay stores fringe evidence;
- existing courses without fringe continue working;
- generated fringe is labeled as derived;
- manual fringe is not overwritten without explicit action.

---

## 25. Acceptance Criteria

- [ ] `FRINGE` exists as a first-class gameplay surface.
- [ ] Fringe is visually rendered around greens when geometry exists.
- [ ] Course Editor can create/edit fringe.
- [ ] Fringe may be generated from green geometry.
- [ ] Generated fringe is explicitly labeled derived/simulated.
- [ ] Fringe width is configurable/editable.
- [ ] Ball and landing-target surface classification recognizes fringe.
- [ ] Fringe has different rollout behavior from green and rough.
- [ ] Rollout can transition from fringe to green.
- [ ] Landing Target understands fringe landing points.
- [ ] Rule of 12 considers fringe during dynamic evaluation.
- [ ] Simulated Green Contours take over appropriately after the ball enters the green.
- [ ] Putter is supported from fringe where appropriate.
- [ ] Game Master can explain fringe effects from structured engine facts.
- [ ] Replay preserves relevant fringe evidence.
- [ ] Existing courses without fringe remain functional.
- [ ] Existing physics/evaluator systems are reused rather than duplicated.

---

## 26. Suggested Codex Implementation Order

1. Inspect current surface types and polygon precedence.
2. Inspect lie/landing-surface classification.
3. Inspect green geometry representation.
4. Add `FRINGE` domain type.
5. Add Course Editor fringe drawing/editing.
6. Implement optional green-buffer fringe generation.
7. Add geometry validation and source metadata.
8. Add fringe to illustrated renderer.
9. Add fringe point classification.
10. Add/reuse fringe rollout coefficient.
11. Implement surface-transition rollout.
12. Integrate with Landing Target.
13. Integrate with dynamic Rule of 12.
14. Integrate with Simulated Green Contours.
15. Add putting/chipping from fringe.
16. Expose structured fringe facts to Game Master.
17. Persist replay evidence.
18. Add backward-compatibility handling.
19. Add unit/integration/regression tests.
20. Validate representative 18-hole course before publishing changes.

---

## 27. Final Product Principle

Fringe should create a meaningful strategic transition between rough/fairway and the putting green.

For short-game play:

```text
BALL LIE
    ↓
LANDING TARGET
    ↓
LANDING SURFACE
    ↓
CLUB CHOICE
    ↓
AUTO POWER
    ↓
TRAJECTORY
    ↓
FRINGE / GREEN SURFACE TRANSITIONS
    ↓
SIMULATED GREEN CONTOURS
    ↓
ROLLOUT
    ↓
FINAL POSITION
```

Combined with Landing Target and the Rule of 12, this lets the golfer learn not only **which club to choose**, but also **where the ball should land and how the surface between that landing point and the pin changes the result**.
