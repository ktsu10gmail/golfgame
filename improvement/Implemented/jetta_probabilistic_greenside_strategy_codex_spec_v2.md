# Jetta Probabilistic Greenside Strategy Choices
## Codex Implementation Specification

**Status:** Proposed improvement  
**Applies to:** Regular Jetta simulation/match play, especially greenside approach/chip/pitch situations  
**Primary goal:** Replace overly prescriptive greenside advice with 1–3 meaningful, simulator-backed strategy choices showing risk and reward.

---

## 1. Problem

A current greenside response can look like:

> "16 yards to the pin · 14 yards right of the pin line. From rough, along the direct line, the front edge of the green is about 6 yards from the ball. Treat the target as a landing spot, not the cup. A Sand Wedge should land about 8 yards from the ball—about 2 yards onto the green, then release about 8 yards toward the cup. Favor the left side by about 6 inches."

The geometry is internally reasonable:

- ball-to-pin: ~16 yd;
- front edge: ~6 yd;
- proposed landing: ~8 yd from ball;
- therefore landing point: ~2 yd onto green;
- proposed rollout: ~8 yd.

However, the system has effectively made the entire golf decision:

```text
Club
+ landing point
+ power/carry
+ rollout
+ aim adjustment
→ already prescribed
```

The player has little meaningful strategy left to choose.

Jetta should instead use its calculations to construct a small number of legitimate greenside plans and let the player choose the tradeoff.

---

## 2. Product Principle

The regular game should move from:

> "Here is exactly how you should hit this shot."

toward:

> "Here are the reasonable ways to play this situation. Here is the modeled risk and reward of each. You decide."

Jetta should handle low-level calculations behind each option:

- club;
- nominal power;
- landing target;
- direction;
- expected carry;
- expected rollout;
- lie effects;
- player dispersion.

The player primarily chooses the **strategy**.

This should not require changing the detailed/manual simulator mode where explicit controls are intentionally available. Integrate with the current regular-match UX carefully and preserve existing behavior where appropriate.

---

## 3. Example Player Experience

Situation:

```text
16 yd to pin
Rough
Front edge of green: 6 yd
Pin: ~10 yd onto green
```

Instead of one prescription, Jetta might generate:

```text
A — SOFT PITCH
Sand Wedge
Land ~8 yd • Release ~8 yd
Inside 8 ft: 68%
Expected leave: 9 ft

B — LOWER CHIP
Pitching Wedge
Land ~6 yd • More rollout
Inside 8 ft: 61%
Expected leave: 11 ft

C — CENTER GREEN
Sand Wedge
Conservative landing target
Green Hit: 86%
Expected leave: 13 ft
```

All percentages above are examples only. They must come from Jetta's existing simulation/evaluation model, not hard-coded values.

Do not force exactly three options.

---

## 4. Choice Count

Generate **1–3 materially different greenside plans**.

### One option

Use one straightforward plan when there is no meaningful strategic tradeoff.

Example:

```text
STRAIGHTFORWARD PITCH
Sand Wedge
12 yd
[ PLAY ]
```

Do not manufacture choices merely to create a multiple-choice interface.

### Two options

Use two when there is one meaningful tradeoff, for example:

```text
A — LAND SOFTER
Higher loft • less rollout

B — CHIP AND RUN
Lower flight • more rollout
```

### Three options

Use three only when geometry, lie, player profile, and modeled outcomes support three genuinely different plans.

---

## 5. What Makes Two Plans Meaningfully Different?

Do not create multiple cards that are effectively the same shot.

Candidate plans should differ materially in one or more of:

- club;
- trajectory;
- carry-to-roll relationship;
- landing area;
- intended miss;
- green-hit probability;
- proximity distribution;
- expected leave;
- short/long risk;
- bunker/water/penalty exposure;
- probability of remaining off green;
- rollout sensitivity;
- recovery difficulty after failure.

Use a versioned/calibratable decision policy rather than scattered UI thresholds.

---

## 6. Canonical Greenside Eligibility

Use the **existing greenside-engine eligibility rule as the single source of truth**.

Do not create separate definitions of "greenside" in the candidate generator, evaluator, Game Master, UI, or execution path.

Conceptually:

```text
Existing Greenside Eligibility Rule
              ↓
     qualifies? yes / no
              ↓
Candidate Generator
Evaluator
Game Master
Final Execution
Replay
```

For the same ball state, all components must agree on whether the shot qualifies for the greenside strategy system.

If the existing rule changes later, the strategy feature should inherit that change rather than maintain its own threshold.

Add regression tests proving that candidate generation, evaluation, GM selection, and execution use the same eligibility result.

---

## 7. Greenside Evidence

The candidate generator should use information Jetta already knows where available:

```text
Ball position
Pin position
Ball lie
Green polygon
Fringe
Bunkers
Water / penalty / OB
Front/back/side green boundaries
Distance to green
Distance to pin
Green shape
Simulated Green Contours where applicable
Player club distances
Player dispersion
Existing carry/roll model
Existing lie modifiers
Existing short-game simulation
```

Do not invent terrain or hazards that are not represented in Jetta's data.

---

## 8. Landing Target Remains Important

For greenside play, a landing target is still the correct underlying concept.

The difference is that the player should not necessarily have to manually construct it every time.

Conceptual flow:

```text
Course + ball + lie + pin
          ↓
Greenside candidate generator
          ↓
Candidate strategy
          ↓
Club + landing target + nominal power + direction
          ↓
Existing shot simulator
```

Example internal candidate:

```text
SOFT PITCH
Club: SW
Landing target: 8 yd
Nominal carry: 8 yd
Expected rollout: 8 yd
Aim offset: 0.5 ft left
```

The UI can summarize this without requiring the player to manually set every parameter.

---

## 9. Probability Metrics

Do **not** reuse `Clean Escape %` from the tree-recovery feature.

Greenside decisions need outcome metrics appropriate to short-game golf.

Extend the existing multi-run evaluator with greenside-specific metrics. Reuse its current green/playable/bunker/penalty/leave evidence rather than building a separate evaluator.

Required V1 metrics where the simulator provides the necessary outcome data:

- Green Hit %;
- Inside 3 ft %;
- Inside 6 ft %;
- Inside 8 ft %;
- Inside 15 ft %;
- expected leave in feet;
- median leave in feet;
- short/off-green %;
- long/off-green %;
- bunker exposure/probability;
- penalty exposure/probability;
- fringe probability where modeled;
- playable-lie probability;
- expected strokes from resulting position, if already supported by the existing evaluator.

The **3/6/8/15-foot proximity rings are the principal evaluator extension for V1**. Calculate them from the same deterministic sample outcomes already used by the multi-run evaluator.

The main strategy card must stay compact. Prefer:

```text
Plan name
Club
1–2 primary probabilities
Expected leave
```

Put secondary metrics—median leave, short/long miss, bunker/penalty exposure, landing point, rollout, etc.—behind optional **Details** or **Compare**.

Internally, use the repository's established probability convention; if a new contract is needed, prefer `0.0–1.0` and format percentages in UI.

---

## 10. Risk AND Reward

A choice must not be presented only by its best-case outcome.

For example:

```text
A — SOFT PITCH
68% inside 8 ft
Expected leave: 9 ft
Short/off-green: 8%

B — CHIP AND RUN
61% inside 8 ft
Expected leave: 11 ft
Short/off-green: 4%

C — CENTER GREEN
86% green hit
Expected leave: 13 ft
Low short-side risk
```

The exact metrics displayed should depend on the situation.

A plan with a higher make/proximity upside may still be worse on failure. The evaluator and GM need the full outcome distribution.

---

## 11. Overall Expected Outcome

Do not compare strategies only using:

```text
Expected leave if perfectly executed
```

Evaluate the full distribution.

Conceptually:

```text
Plan
↓
many deterministic/seeded samples or existing evaluator method
↓
landing / rollout / final-lie distribution
↓
proximity + green hit + hazard + recovery evidence
↓
overall expected outcome
```

Where Jetta already has expected-strokes or strategy-evaluation logic, reuse it.

The GM should be able to distinguish cases such as:

```text
Plan A
Better chance inside 8 ft
but larger short-side failure

Plan B
Slightly worse average proximity
but much lower chance of missing green
```

Do not create a second contradictory risk engine.

---

## 12. Greenside Bunker Scope for V1

Bunker handling must be explicit rather than accidentally entering this feature through generic greenside classification.

### V1 rule

Include a greenside bunker shot in this strategy-choice system **only if the existing bunker simulator can produce outcome evidence that is comparable enough to evaluate the candidate plans consistently**.

At minimum, that means the existing path must support the relevant:

- landing/final position;
- green-hit result;
- leave distance;
- bunker/penalty/playable result;
- deterministic/seeded execution behavior.

If the current bunker flow cannot provide comparable evidence, then:

```text
Ball in greenside bunker
        ↓
retain existing bunker flow
        ↓
do NOT force it through greenside strategy cards
```

Do not delay the rough/fringe/short-grass V1 in order to redesign bunker physics.

Bunker-specific strategy choices can be added later using the same high-level pattern once the existing bunker simulator supports the required evidence.

---

## 13. Candidate Strategy Families

Possible strategy families include:

### Soft Pitch
More carry, less rollout.

### Chip and Run
Lower trajectory, earlier landing, more rollout.

### Center Green
Prioritize a larger, safer portion of the putting surface rather than maximum pin proximity.

### Attack Pin
Use only when the geometry and player model support a meaningful higher-upside/higher-risk plan.

### Play Away From Trouble
Target safer green area when bunker, water, short-side miss, or green boundary creates meaningful risk.

### Fringe/Putter Option
Where current rules and lie permit, putting from fringe or very short grass can be a legitimate candidate.

These are strategy concepts, not mandatory cards.

Do not show all families on every shot.

---

## 14. Candidate Generation

Implement a dedicated **Greenside Strategy Candidate Generator** or a clean greenside adapter over existing candidate-generation infrastructure.

It should:

1. inspect the current greenside situation;
2. generate technically valid candidate shots;
3. evaluate candidates using existing simulation;
4. remove redundant candidates;
5. group technically similar shots into golfer-friendly strategies;
6. retain only 1–3 materially different choices;
7. attach the exact simulator parameters needed for execution.

Do not duplicate the shot simulator.

---

## 15. Routine Detection

Some greenside situations do not need a strategic quiz.

Example:

```text
10 yd
Good lie
Plenty of green
No bunker/water
Middle pin
```

If candidate outcomes are materially equivalent, collapse to:

```text
STRAIGHTFORWARD CHIP
Pitching Wedge
[ PLAY ]
```

The goal is meaningful decisions, not constant decision fatigue.

---

## 16. Execution

Once the player chooses a strategy:

```text
Player chooses strategy card
          ↓
Use stored club / landing target / power / direction
          ↓
Existing lie modifiers
          ↓
Existing short-game simulation
          ↓
Landing
          ↓
Existing rollout / surface transitions
          ↓
Final ball position
```

The player should not have to reconstruct the plan manually unless they intentionally enter a detailed/manual control mode.

---

## 17. Preserve Player Skill and Randomness

Selecting a strategy does not guarantee the nominal landing point.

Example:

```text
Player selects:
SW
8 yd landing target
nominal 8 yd carry

Actual execution:
player dispersion
+ lie
+ mishit model
+ seeded randomness
→ actual landing point
```

The strategy card describes the intended/expected shot. Existing player skill and probabilistic execution remain authoritative.

---

## 18. Game Master

The GM must receive the **exact same generated candidate set and analysis evidence** offered to the player.

The GM selects privately only **after the player commits**. Do not regenerate a separate option set for the GM.

Prefer:

```text
PLAYER CHOOSES
Soft Pitch

GM CHOOSES
Chip and Run

GM explanation:
"I chose the lower chip because it gives up a little proximity upside but reduces the chance of leaving the next shot in the rough."
```

Do not have the GM invent a separate hidden shot that cannot be compared with the player's options.

The GM should explain tradeoffs using structured evaluator evidence, not invent new physics or probabilities.

---

## 19. Avoid Pre-Answering the Decision

Before the player commits, avoid labels such as:

- Best;
- Correct;
- Recommended Winner;
- Bad Choice;
- Wrong Shot.

Use descriptive strategy names.

The purpose is to let the player make the golf decision.

After commitment/result, Jetta can explain why one strategy had different modeled risk/reward.

---

## 20. Direction and Aim Advice

Existing advice such as:

> "Favor the left side by about 6 inches."

can remain part of a candidate's internal shot construction when supported by the putting/green/geometry model.

It should not necessarily be the main decision.

Example:

```text
SOFT PITCH
SW
Land 8 yd
68% inside 8 ft

Details:
Landing target: 2 yd onto green
Aim: ~6 in left
Expected rollout: ~8 yd
```

This keeps useful coaching without turning every shot into manual setup work.

---

## 21. Determinism and Replay

Once the player commits, preserve enough evidence to prevent rerolls and support replay.

Persist the **complete offered strategy set**, not merely the selected card.

Persist as appropriate:

- all offered strategies exactly as analyzed/displayed;
- player selection;
- GM selection;
- club;
- landing target;
- intended direction;
- nominal power/carry;
- expected rollout;
- displayed probability metrics for every offered strategy;
- evaluator evidence for every offered strategy;
- analysis seed;
- sample count/method used for the offered set;
- execution seed;
- simulator/evaluator version;
- course geometry version;
- player-profile hash/version;
- actual landing/result;
- final lie.

Refresh must not regenerate a more favorable strategy set or execution result after commitment.

---

## 22. Conceptual Data Contract

Adapt this to existing repository structures.

```json
{
  "strategy_id": "greenside-soft-pitch",
  "title": "Soft Pitch",
  "situation_type": "GREENSIDE_ROUGH",
  "club": "SW",
  "target": {
    "type": "LANDING_TARGET",
    "carry_yards": 8.0,
    "green_depth_yards": 2.0,
    "aim_offset_feet": -0.5
  },
  "execution": {
    "nominal_power": 0.32,
    "expected_rollout_yards": 8.0
  },
  "metrics": {
    "green_hit_probability": 0.91,
    "inside_8ft_probability": 0.68,
    "expected_leave_feet": 9.4,
    "short_off_green_probability": 0.08
  },
  "evidence": {
    "analysis_seed": 182731,
    "sample_count": 400,
    "strategy_generator_version": "greenside-v1",
    "evaluator_version": "...",
    "greenside_eligibility_version": "...",
    "simulator_version": "...",
    "course_geometry_version": "...",
    "player_profile_hash": "..."
  }
}
```

If evaluation is analytical rather than Monte Carlo, omit `sample_count` and preserve the appropriate method/model version.

---

## 23. Relationship to Tree Recovery

Tree recovery and greenside strategy should share the same higher-level product pattern:

```text
Situation
↓
Generate 1–3 meaningful strategies
↓
Evaluate risk/reward
↓
Player chooses
↓
Execute through existing simulator
↓
Compare decision vs result
```

But their probability contracts are domain-specific.

### Tree recovery
Primary metric:
`Clean Escape %`

Outcomes:
`Clean / Clip / Major`

### Greenside
Primary metrics may be:
`Green Hit % / Proximity % / Expected Leave / Miss Risk`

Do not force both domains into one misleading metric.

Shared UI/evaluator infrastructure is desirable where appropriate, but domain-specific candidate generators/adapters should remain possible.

---

## 24. Implementation Sequence

### Phase 1 — Repository Trace

Before coding, locate:

- the canonical existing greenside-engine eligibility rule;
- current greenside advice generator;
- landing-target logic;
- Rule-of-12 integration if currently used;
- club/power solver;
- lie modifiers;
- carry/roll model;
- fringe behavior;
- Simulated Green Contours integration;
- short-game simulator;
- strategy evaluator;
- GM choice/explanation;
- deterministic seed handling;
- replay persistence.

Reuse existing systems.

### Phase 2 — One Real Vertical Slice

Use a real case similar to:

```text
16 yd to pin
Rough
6 yd to front edge
10 yd of green available
```

Generate and evaluate 2–3 legitimate plans.

Validate that the choices actually feel different before generalizing.

### Phase 3 — Candidate Generator

Build the greenside-specific candidate generator/adapter. It must call the same existing greenside eligibility rule used by final execution.

### Phase 4 — Evaluator Extension and Routine Detection

Extend the existing multi-run evaluator with 3/6/8/15-foot proximity rings plus expected/median leave in feet and supported short/long/off-green evidence.

Evaluate candidates, remove redundant options, and collapse routine situations to one plan.

Measure performance. Avoid making every short-game decision wait on unnecessarily expensive simulation.

### Phase 5 — UI

Implement compact strategy cards with risk/reward and optional Details.

### Phase 6 — Execution Integration

Selected strategy automatically supplies club, target, power, and direction to existing simulation.

### Phase 7 — GM

GM independently selects from the same candidate set and explains its tradeoff after player commitment.

### Phase 8 — Replay / Persistence / Tuning

Persist the complete offered set, its shared analysis seed, sample count/method, versions, selected strategy, execution seed, and actual outcome. Tune thresholds using actual gameplay.

---

## 25. Tests and Guardrails

Verify at minimum:

1. Greenside situations can produce 1, 2, or 3 choices.
2. Exactly three choices are never required.
3. Routine situations collapse to one plan.
4. Similar/redundant candidates are removed.
5. Displayed probabilities come from the evaluator used for comparison.
6. Player selection uses the exact stored simulator parameters for that strategy.
7. Player skill/dispersion still affects actual result.
8. Lie modifiers are not accidentally applied twice.
9. Rollout respects green/fringe/rough transitions already modeled by Jetta.
10. Known bunker/water/OB risk is included where supported.
11. GM receives the same candidate set.
12. GM does not invent unsupported probabilities.
13. Refresh after commitment does not reroll choices/result.
14. Replay preserves strategy and outcome evidence.
15. Non-greenside shots remain unchanged.
16. Existing detailed/manual shot controls remain available wherever current product design requires them.
17. No new contradictory short-game physics engine is introduced.
18. A higher success/proximity number does not automatically label a plan "correct."
19. Candidate generation remains performant enough for normal match flow.
20. Candidate generator, evaluator, GM, and final execution all use the same canonical greenside eligibility rule.
21. The evaluator reports 3/6/8/15-foot proximity metrics from the same deterministic sample set.
22. Expected and median leave are reported in feet for greenside comparisons.
23. The complete offered set and its evidence are persisted, not only the selected strategy.
24. GM receives the exact same offered set and selects privately after player commitment.
25. Main cards remain compact; secondary metrics are available through optional Details/Compare.
26. Greenside bunker shots enter this feature only when the existing bunker simulator supports comparable outcome evidence; otherwise the existing bunker flow remains unchanged.

---

## 26. Acceptance Criteria

V1 is complete when:

- the system no longer always gives one fully prescribed greenside answer;
- Jetta can present 1–3 meaningful short-game strategies;
- routine shots do not create fake choices;
- each strategy contains internally complete club/target/power/direction instructions;
- player primarily chooses strategy rather than rebuilding the shot;
- risk/reward metrics come from existing simulation/evaluation;
- actual execution still reflects player skill and randomness;
- GM chooses from the same strategies;
- decision quality remains distinct from one random shot result;
- replay remains deterministic after commitment;
- existing simulation physics remain authoritative;
- regular match play remains compatible;
- all components agree on canonical greenside eligibility;
- the evaluator includes the V1 proximity-ring metrics;
- the complete offered choice set is replay-safe and cannot be rerolled on refresh;
- GM uses the same choice set after player commitment;
- bunker behavior follows the explicit V1 scope above.

---

## 27. Non-Goals for V1

Do not require:

- replacing Jetta's short-game physics;
- forcing three options on every shot;
- making every greenside shot a quiz;
- removing detailed/manual controls globally;
- claiming one strategy is universally correct;
- adding invented green/hazard data;
- changing Golf Academy;
- changing the separate probabilistic tree-recovery model;
- redesigning bunker physics merely to include bunker strategy cards in V1.

---

## 28. Product Direction

This feature is part of a broader Jetta interaction principle:

```text
Do not make the player repeatedly construct
club + power + target + aim
when Jetta can calculate those details.

Use those calculations to create meaningful golf strategies,
show the tradeoffs,
and let the golfer decide.
```

For this greenside case, the interesting decision should not be:

> "Can I manually set SW to exactly 8 yards and aim 6 inches left?"

It should be closer to:

> **"Do I want the softer pitch, the lower-running chip, or the safer green-first play—and is the extra reward worth the modeled risk?"**
