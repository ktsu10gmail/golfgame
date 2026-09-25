# Jetta Landing Target Short-Game System
## Rule of 12 + Automatic Power + Dynamic Club Evaluation
### Codex Implementation Specification

## Purpose

Add an explicit **Landing Target** aim mode for chips, pitches, and short-game shots.

The player chooses:
1. where the ball should land;
2. which club to use.

The game automatically calculates the nominal swing power required for that club to carry to the selected landing point. The actual shot still varies according to player skill, lie, club characteristics, dispersion, terrain, and the existing shot engine.

Use the traditional **Rule of 12** as a candidate-club heuristic while allowing Jetta's existing simulation/evaluation system to determine the best choice for the actual situation.

> **Rule of 12 proposes. Jetta's simulation engine evaluates. The Game Master explains.**

## 1. Explicit Aim Modes

Add:

```text
DIRECTION_TARGET
LANDING_TARGET
```

### Direction Target

Meaning: **Aim the shot along the line through this point.**

Player selects:
- direction target;
- club;
- swing power.

The marker controls direction only. Club + power determine expected distance. The ball is not expected to land on the marker.

### Landing Target

Meaning: **I intend the ball's first landing/carry point to be here.**

Player selects:
- landing target;
- club.

The game calculates:
- required nominal power;
- expected carry;
- expected trajectory;
- expected rollout;
- expected finish.

Do not require manual power selection in Landing Target mode unless a future advanced override is intentionally added.

## 2. Landing Target Must Not Guarantee the Result

Example:

```text
Landing target: 16 yd
Club: Sand Wedge
Calculated nominal power: 32%
Expected carry: 16 yd
```

This means the expected shot carries about 16 yards. It does **not** force the actual shot to land exactly there.

Actual carry continues through the existing probabilistic shot engine and may vary, for example:

```text
14.2 yd
15.3 yd
16.1 yd
17.0 yd
18.1 yd
```

Correct flow:

```text
landing target
      ↓
solve nominal power
      ↓
existing shot engine
      ↓
player skill + lie + dispersion + randomness
      ↓
actual result
```

## 3. Automatic Power Solver

Create or reuse a service that solves for swing percentage required for a selected club to achieve the requested carry.

Conceptual interface:

```python
class ShortGamePowerSolver:
    def solve_power(
        self,
        club,
        desired_carry_yards,
        player_profile,
        lie,
        shot_context,
    ):
        ...
```

Use the existing club-distance/partial-swing model. Do not hard-code sample percentages.

Interpolation may be used between modeled power points.

If a club cannot reasonably produce the requested carry, return an explicit status:

```text
REACHABLE
MARGINAL
UNREACHABLE
UNSAFE_TRAJECTORY
```

Never silently distort the club model.

## 4. Club Choice Must Matter

Different clubs using the same landing target must remain physically and strategically different.

Club selection affects:

```text
launch/trajectory
required power
carry variability
landing angle
rollout
hazard-clearance capability
lie sensitivity
final-position dispersion
```

Conceptually:

```text
                    SAME LANDING TARGET
                            X
                           /|\
                          / | \
                         /  |  \
                       LW   SW  PW -------- 7I
                     higher              lower
                     flight              flight
                       ↓                   ↓
                   less roll          more roll
```

Do not make different clubs cosmetically different ways to produce the same shot.

## 5. Rule of 12

Use the traditional Rule of 12 as a **strategy heuristic**, not authoritative physics.

Approximate classic relationship:

```text
Club number ≈ 12 - rollout/carry ratio
```

Conceptual candidates:

```text
Carry : Roll     Typical candidate
1 : 1            SW-ish
1 : 2            PW
1 : 3            9 Iron
1 : 4            8 Iron
1 : 5            7 Iron
```

These are starting heuristics only. Jetta's calibrated club model and simulation engine remain authoritative.

## 6. Rule-of-12 Geometry

Given:
- ball position;
- landing target;
- pin position;

calculate:

```text
carry_distance = ball → landing target
roll_distance_needed = landing target → pin
roll_to_carry_ratio = roll_distance_needed / carry_distance
```

Example:

```text
Ball → Landing = 8 yd
Landing → Pin = 16 yd

Carry : Roll = 1 : 2
```

The Rule of 12 suggests a PW-like candidate.

## 7. Rule of 12 Generates Candidates, Not Answers

Preferred flow:

```text
Landing target
      ↓
Carry / rollout requirement
      ↓
Rule of 12
      ↓
Candidate club set
      ↓
Automatic power solver for each club
      ↓
Existing trajectory/shot model
      ↓
Existing probabilistic/hybrid evaluator
      ↓
Terrain + hazard evaluation
      ↓
Expected rollout/final position
      ↓
Rank candidates
```

Example only:

```text
Ball → Pin: 25 yd
Landing Target: 10 yd
Required rollout: 15 yd

7I  → likely too much rollout
9I  → strong match
PW  → slightly short
SW  → substantially short
```

Actual values must come from Jetta's models.

## 8. Dynamic Rule of 12

Extend the textbook heuristic with the real situation.

Consider:

```text
lie
carry distance
landing surface
green slope
Simulated Green Contours
hazards
required hazard clearance
available green
pin location
player club profile
player distance control
club trajectory
club rollout
```

Architecture:

```text
Traditional Rule of 12
          ↓
Candidate clubs
          ↓
Player profile
 + lie
 + landing target
 + hazards
 + green contour
 + available green
          ↓
Existing shot evaluator
          ↓
Dynamic recommendation
```

## 9. Hazard Overrides

Before recommending a low-running club, verify that its modeled trajectory safely reaches the landing point.

Evaluate:
- hazard front edge;
- hazard back edge;
- required carry;
- trajectory clearance;
- landing margin.

A 7-iron may fit the carry/roll ratio but be inappropriate if a bunker must be flown.

Remove or downgrade unsafe candidates.

## 10. Green Contour Adjustment

Integrate with **Simulated Green Contours** when available.

Downhill after landing:
- expect more rollout;
- consider more loft;
- consider a shorter landing target.

Uphill:
- expect less rollout;
- consider less loft;
- consider a farther landing target.

Side slope:
- account for rollout direction/break where supported.

Rule of 12 remains the initial heuristic; terrain modifies the evaluation.

## 11. Lie Adjustment

The same club/landing target may behave differently from:

```text
fairway
fringe
light rough
heavy rough
bunker
```

Reuse existing lie modifiers.

For bunker shots, Landing Target may still be useful, but automatic power and trajectory must use the bunker-specific model.

## 12. Suggested Short-Game UI

For appropriate shots:

```text
AIM
● Landing Target
○ Direction Target
```

After target placement:

```text
LANDING TARGET
16 yd

CLUB
Sand Wedge

AUTO POWER
32%

EXPECTED
Carry:   16 yd
Roll:     4 yd
Finish:  ~20 yd
```

Power should be visibly marked **Auto** so the golfer understands why the manual power control is absent/disabled.

## 13. Club Comparison

Allow comparison while preserving the same landing target.

Example layout:

```text
LANDING TARGET: 10 yd
PIN: 25 yd

Club   Auto Power   Carry   Roll   Expected Finish
7I       --          10      --          --
9I       --          10      --          --
PW       --          10      --          --
SW       --          10      --          --
```

Populate values from the actual simulation; do not hard-code examples.

Highlight simulation-derived preferred candidates.

## 14. Safe & Smart vs Aggressive

Reuse the existing strategy evaluator.

Possible short-game distinction:

**Safe & Smart**
- higher probability of acceptable finish;
- lower hazard exposure;
- lower severe-miss risk.

**Aggressive**
- greater expected proximity/hole-out opportunity;
- potentially greater short-side or hazard exposure.

Both must use identical simulation assumptions.

## 15. Game Master

The Game Master explains structured engine evidence.

Example structured facts:

```text
Landing target: 10 yd
Pin: 25 yd
Rule-of-12 candidate: 9 Iron
9I expected rollout: 15 yd
PW expected rollout: 12 yd
SW expected rollout: 7 yd
No required aerial hazard clearance
```

Possible explanation:

> Safe & Smart: Try the 9-iron. Your landing point requires about 10 yards of carry and roughly 15 yards of rollout. The 9-iron best matches that requirement in the current model.

The LLM must not invent carry, rollout, slope, or risk values.

## 16. Player May Ignore Recommendation

Recommendations are educational, not mandatory.

If Game Master recommends 9I but the player chooses LW:

```text
same landing target
      ↓
calculate required LW power
      ↓
simulate LW trajectory
      ↓
calculate rollout
      ↓
record result
```

This lets the golfer learn by experimentation.

## 17. Replay Evidence

Persist enough evidence for round replay:

```text
aim_type
landing_target_coordinate
landing_target_distance
selected_club
auto_calculated_power
expected_carry
expected_roll
expected_finish
candidate_clubs
rule_of_12_candidate
recommended_choice
evaluator_version
seed
sample_count
```

This allows replay to distinguish:
- intended landing point;
- selected club;
- expected/model result;
- actual result.

Do not infer swing mechanics.

## 18. Outcome vs Target

Where data permits, calculate objective differences:

```text
actual landing vs intended landing target
final position vs expected finish
left/right deviation
short/long deviation
```

Use factual language only.

## 19. Refactor Existing Greenside Logic

Inspect the current special greenside behavior before changing it.

Replace hidden semantics such as "inside 30 yards the target controls carry" with explicit behavior:

```text
LANDING_TARGET
→ target defines desired nominal carry
→ engine calculates nominal power

DIRECTION_TARGET
→ target defines aim line
→ club + manual power define nominal distance
```

Do not automatically change aim semantics merely because the ball is within 30 yards if the golfer explicitly selected another mode.

## 20. Recommended Defaults

```text
Driver / Wood / normal full shot
→ DIRECTION_TARGET

Normal iron approach
→ DIRECTION_TARGET

Chip / pitch / greenside
→ LANDING_TARGET
```

The golfer may switch when appropriate.

## 21. Architecture

```text
PLAYER PLACES LANDING TARGET
            ↓
Calculate target carry
            ↓
Rule-of-12 candidate generator
            ↓
Generate practical club candidates
            ↓
For each candidate:
    solve required power
            ↓
Existing trajectory/shot model
            ↓
Existing dispersion evaluator
            ↓
Terrain + hazard evaluation
            ↓
Expected rollout/final position
            ↓
Rank candidates
            ↓
Safe & Smart / Aggressive recommendations
            ↓
Game Master explanation
```

## 22. Do Not Create Duplicate Physics

Before implementation inspect and reuse:

```text
club distance model
partial swing model
greenside model
lie modifiers
trajectory model
rollout model
dispersion model
hybrid/probabilistic evaluator
green contour model
hazard geometry
```

This feature should orchestrate existing systems rather than replace them.

## 23. Tests

Add tests for:
- Landing Target with SW;
- same target with LW/SW/PW/9I/8I/7I where supported;
- Direction Target retains manual power;
- Landing Target auto-calculates power;
- target does not guarantee actual landing;
- Rule of 12 generates plausible candidates;
- simulation can override Rule-of-12 candidate;
- bunker/water between ball and target;
- uphill/downhill/side-slope green where supported;
- fairway/rough/bunker lies;
- unreachable and extremely short targets;
- manual club choice against recommendation;
- existing shots/courses remain backward compatible;
- replay preserves original target evidence.

## 24. Acceptance Criteria

- [ ] Explicit Direction Target and Landing Target modes exist.
- [ ] Direction Target controls direction, not carry.
- [ ] Landing Target means intended first landing/carry point.
- [ ] Landing Target automatically calculates nominal power.
- [ ] Manual power is not required in Landing Target mode.
- [ ] Actual landing remains probabilistic.
- [ ] Club choice meaningfully changes trajectory/rollout.
- [ ] Rule of 12 is a heuristic, not authoritative physics.
- [ ] Rule of 12 generates candidates.
- [ ] Existing simulation evaluates candidates.
- [ ] Hazards and lies can override textbook choices.
- [ ] Simulated Green Contours influence rollout when available.
- [ ] Player may ignore the recommendation.
- [ ] Game Master explains engine-generated evidence only.
- [ ] Replay evidence is persisted.
- [ ] Existing hidden greenside behavior is refactored into explicit aim semantics.
- [ ] No duplicate shot/dispersion physics engine is introduced.

## 25. Suggested Codex Implementation Order

1. Inspect current Aim/target handling.
2. Locate the current greenside special behavior.
3. Inspect club/power distance curves.
4. Inspect rollout/trajectory models.
5. Inspect the hybrid/probabilistic evaluator.
6. Add `DIRECTION_TARGET` and `LANDING_TARGET`.
7. Preserve Direction Target manual-power behavior.
8. Implement/reuse inverse power solver.
9. Connect Landing Target to automatic power.
10. Keep actual results probabilistic.
11. Implement Rule-of-12 candidate generator.
12. Evaluate candidates through existing simulation.
13. Add hazard/lie filtering.
14. Integrate Simulated Green Contours.
15. Add club-comparison data/UI.
16. Add Safe & Smart / Aggressive short-game recommendations.
17. Update Game Master structured context.
18. Persist replay evidence.
19. Update mobile/desktop Aim UI.
20. Add regression and feature tests.

## 26. Final Product Principle

Landing Target should teach:

> **Where should this ball land, and which club gives me the best trajectory and rollout from there?**

The game handles the tedious conversion from desired carry to nominal swing percentage. The golfer still owns the strategic club and landing-point decision.

```text
CHOOSE LANDING SPOT
        ↓
CHOOSE CLUB
        ↓
AUTO-CALCULATE POWER
        ↓
RULE OF 12 SUGGESTS CANDIDATES
        ↓
JETTA SIMULATION EVALUATES THE REAL SITUATION
        ↓
GAME MASTER EXPLAINS
        ↓
PLAYER CHOOSES
        ↓
PROBABILISTIC SHOT RESULT
        ↓
LEARN FROM THE OUTCOME
```
