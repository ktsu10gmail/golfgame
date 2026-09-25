# Jetta Probabilistic Tree Recovery
## Codex Implementation Specification

**Applies to:** Regular Jetta simulation/match play, including 18-hole matches  
**Not dependent on:** Golf Academy  
**Goal:** Replace repetitive deterministic tree punch-outs with 1–3 understandable recovery choices showing modeled risk and reward.

## 1. Existing Behavior

Current tree handling:

- Ball is treated as in trees when inside mapped canopy or within ~4 yd of its edge.
- Tee/fairway/green/bunker/water/OB take surface priority over overlapping visual trees.
- Edge: light rough, 3/4-swing guidance.
- Under canopy: mild rough, 1/2-swing guidance.
- Deep: deep rough, punch-only guidance.
- Direct pin line is classified clear/partly blocked/blocked.
- Blocked situations tend to route toward nearest clear fairway/open area.
- Tree lies currently reduce carry to ~65%, roll to ~45%, and increase mishit risk.
- Swing restrictions are guidance rather than hard control locks.

Problem: canopy geometry does not describe individual trunks, branches, heights, or actual openings. Jetta therefore should not repeatedly claim precise knowledge such as “your only clear path is exactly 90° left.”

## 2. New Principle

Represent uncertainty rather than inventing exact tree corridors.

For a tree situation, generate **1–3 plausible recovery plans** based on data Jetta actually knows. Each meaningful plan should show:

1. target/direction;
2. intended progress;
3. **Clean Escape %**;
4. expected reward;
5. downside/tree-interference risk.

Example:

```text
UNDER THE TREES
137 yd to pin
Direct route toward green obstructed

A — SAFE PUNCH OUT
27 yd left → Fairway
92% Clean Escape
Expected leave: ~125 yd

B — FORWARD PUNCH
55 yd forward-left
72% Clean Escape
Expected leave if clean: ~95 yd

C — AGGRESSIVE PUNCH
80 yd toward green side
43% Clean Escape
Expected leave if clean: ~60 yd
```

Percentages above are examples only, not tuning constants.

## 3. Known vs Unknown

Jetta may know ball/pin coordinates, canopy polygons, depth class, fairway/open areas, green/hazard/OB geometry, direct-line canopy relationship, candidate target distances/directions, player profile, and existing tree penalties.

Jetta generally does **not** know exact trunk positions, branch positions/heights, or whether a real-world diagonal opening actually exists.

Therefore avoid unsupported claims that a specific corridor is physically clear. Prefer language such as:

> “A forward recovery is available in the game model, but it carries greater modeled tree-interference risk.”

## 4. Clean Escape %

**Clean Escape %** = modeled probability that the attempted recovery avoids meaningful tree interference and reaches a playable destination consistent with the selected plan.

It is a game-model probability, not a measured real-world probability or guarantee.

Suggested mutually exclusive internal outcomes:

```text
CLEAN_ESCAPE
BRANCH_CLIP
MAJOR_TREE_CONTACT
```

Conceptual example:

| Recovery | Clean | Clip | Major |
|---|---:|---:|---:|
| Safe punch | 0.92 | 0.07 | 0.01 |
| Forward punch | 0.72 | 0.21 | 0.07 |
| Aggressive punch | 0.43 | 0.35 | 0.22 |

Do not hard-code these sample values.

If a new persisted probability contract is needed, prefer normalized `0.0–1.0` internally and format as percentages in UI.

## 5. Probability Inputs

Use only modeled evidence:

```text
Tree depth
+ recovery direction
+ attempted distance
+ swing restriction / shot type
+ club / trajectory if modeled
+ player dispersion / mishit characteristics
+ destination/hazard exposure
→ recovery outcome probabilities
```

Existing Edge / Under Canopy / Deep classifications can establish different base obstruction levels, but do not assign one fixed probability to each depth.

Longer/more greenward recoveries can generally carry greater tree-interference exposure than short lateral escapes, all else equal. Player ability should affect probabilities where existing player-model evidence supports it.

## 6. Recovery Candidates

Generate **1–3 materially different plans**, never exactly three by requirement.

Examples:

**Edge**
```text
A — Play toward green
B — Forward recovery
C — Safe punch to fairway
```

**Under canopy**
```text
A — Forward punch       72% clean
B — Safe punch out      92% clean
```

**Deep**
```text
SAFE RECOVERY
Punch toward fairway
94% clean
[ PLAY ]
```

If only one defensible plan exists, show one. Do not invent an aggressive option merely to populate UI.

## 7. Target Generation

Generate destinations from known course geometry, not imaginary branch openings.

Candidate target families can include:

- nearest useful fairway/open-area recovery;
- farther forward fairway/open-area recovery;
- diagonal open-area recovery;
- greenward target when the game model permits it;
- backward/sideways escape when necessary.

Reject targets that are obviously invalid because of known water, OB, penalty areas, incompatible surfaces, or impossible modeled carry.

Group similar technical targets into golfer-friendly plans.

## 8. Show Risk AND Reward

Do not show only the safest percentage.

Preferred primary UI:

```text
A — SAFE PUNCH
92% CLEAN ESCAPE
→ Expected leave: ~125 yd

B — FORWARD PUNCH
72% CLEAN ESCAPE
→ Expected leave if clean: ~95 yd

C — AGGRESSIVE PUNCH
43% CLEAN ESCAPE
→ Expected leave if clean: ~60 yd
```

Optional **Details** must make the downside easy to inspect. It should expose, where supported:

- branch-clip probability;
- major-contact probability;
- probability of remaining in tree trouble after Major contact;
- hazard/penalty exposure created by the recovery;
- typical/median leave;
- playable-lie probability;
- other existing evaluator statistics.

The primary card can remain compact, but a player evaluating a risky recovery must be able to discover what the failure cases actually mean.

### Overall expected leave

In addition to `expected_leave_if_clean`, every candidate should internally calculate an **overall expected leave/outcome across Clean, Clip, and Major Contact outcomes**.

Example:

```text
Aggressive Punch
43% Clean  → ~60 yd remaining
35% Clip   → ~105 yd remaining
22% Major  → ~140 yd remaining / may remain in trees
```

Conceptually:

```text
overall_expected_leave
= P(clean) × leave(clean)
+ P(clip) × leave(clip)
+ P(major) × leave(major)
```

Use the repository's evaluator conventions where outcomes include penalties, hazards, non-playable destinations, or values that cannot sensibly be represented by distance alone. Expected strokes/scoring value may be a better comparison metric where already supported.

The primary UI does not need to show `overall_expected_leave` by default. It exists so the evaluator and Game Master compare the **whole gamble**, rather than comparing only successful outcomes.

`expected_leave_if_clean` remains useful player-facing reward information.

## 9. Execution Must Use the Displayed Probability

The percentage cannot be decorative.

```text
Player commits
→ stored recovery probabilities
→ deterministic/seeded outcome resolution
→ CLEAN / CLIP / MAJOR CONTACT
→ corresponding modifiers
→ existing Jetta shot simulation
→ final ball position and lie
```

Possible modeled effects:

- **Clean:** execute selected restricted/tree shot using the normal existing tree-lie physics, with no additional tree-contact penalty.
- **Clip:** use the normal existing tree-lie physics once, then add deterministic branch-clip modifiers such as reduced carry, additional directional error, altered rollout, or increased chance of remaining near trees.
- **Major:** use the normal existing tree-lie physics once, then add deterministic major-contact modifiers such as severe distance loss, directional disruption, or high probability of remaining in trouble.

### Critical penalty rule

**Apply the existing tree-lie penalty exactly once.**

Do not accidentally stack the base tree restriction twice.

Conceptually:

```text
Existing tree-lie physics
        ↓
Applied ONCE
        ↓
CLEAN
→ no additional tree-contact modifier

CLIP
→ add Clip modifier

MAJOR
→ add Major Contact modifier
```

For example, if the current tree lie already applies the existing ~65% carry / ~45% roll behavior, Clean must not apply another 65%/45% reduction. Clip and Major modify the already tree-restricted shot rather than restarting or duplicating the tree penalty.

Integrate with existing simulation architecture; do not build a disconnected second physics engine.

## 10. Determinism / Replay

After commitment, refresh/replay must not reroll the tree outcome.

Persist as appropriate:

- offered options;
- selected option;
- the exact probability set displayed to the player;
- the single seeded outcome roll used to resolve Clean / Clip / Major;
- resolved recovery outcome;
- analysis seed;
- execution/outcome seed;
- target;
- tree/recovery-model version;
- simulator version;
- geometry version;
- player-profile version/hash;
- displayed probability set exactly as shown at commitment;
- the single seeded recovery-outcome roll;
- resolved tree-interference outcome;
- final shot result.

Conceptually:

```json
{
  "probabilities": {
    "clean": 0.72,
    "clip": 0.21,
    "major": 0.07
  },
  "outcome_roll": 0.6842,
  "resolved_outcome": "CLEAN_ESCAPE"
}
```

Persisting both the probability set and the outcome roll makes replay/debugging explicit and prevents a refresh from silently recalculating different thresholds or rerolling the recovery.

Fixed state + fixed choice + fixed seed must reproduce the same result.

For debugging/replay, a conceptual persisted resolution may look like:

```json
{
  "probabilities": {
    "clean_escape": 0.72,
    "branch_clip": 0.21,
    "major_tree_contact": 0.07
  },
  "outcome_roll": 0.6842,
  "resolved_outcome": "CLEAN_ESCAPE"
}
```

Persisting both the probability set and the outcome roll prevents a refresh or later code path from silently rerolling the recovery.

## 11. Overall Expected Outcome

`expected_leave_if_clean` is useful for the player, but it is **not sufficient for strategy comparison**.

The evaluator and Game Master must also calculate an **overall expected outcome** across Clean, Clip, and Major branches.

Conceptually:

```text
Overall Expected Leave
=
P(Clean) × leave after Clean
+ P(Clip) × leave after Clip
+ P(Major) × leave after Major
```

If an outcome can remain in trees, enter a hazard, or create another materially different state, the evaluator should not reduce everything blindly to distance alone. Reuse the repository's existing scoring/strategy evaluation where possible so lie quality, penalties, and recovery difficulty can contribute.

At minimum preserve internally:

- expected leave if clean;
- expected/typical leave for Clip;
- expected/typical leave for Major;
- overall expected leave;
- probability of remaining in tree trouble;
- hazard/penalty probability where applicable.

The GM should compare the **whole gamble**, not simply compare `expected_leave_if_clean`.

Example:

```text
SAFE PUNCH
92% clean
Clean leave: 125 yd
Overall expected leave: 128 yd

AGGRESSIVE PUNCH
43% clean
Clean leave: 60 yd
Overall expected leave: 101 yd
Major-contact risk: 22%
```

The exact values above are illustrative only.

## 12. Dedicated Tree-Recovery Candidate Generator

Implement a dedicated tree-aware recovery candidate generator rather than forcing all behavior through the existing generic recovery generator.

The current generic recovery logic is a useful foundation, but tree recovery needs to support:

- 1–3 choices rather than a fixed reduced set;
- tree-depth awareness;
- direction/distance risk;
- Clean / Clip / Major probability contracts;
- risk-and-reward comparison;
- tree-specific candidate grouping.

Reuse existing geometry, open-area/fairway targeting, evaluator utilities, and generic recovery primitives where appropriate. Do not duplicate them unnecessarily.

Conceptual boundary:

```text
Generic course/geometry recovery primitives
                 ↓
Dedicated Tree Recovery Candidate Generator
                 ↓
1–3 tree-aware plans + probability contracts
                 ↓
Player / GM / UI
```

## 13. Game Master

GM should evaluate the **same recovery choices shown to the player** rather than inventing a hidden precise corridor.

Example GM explanation:

> “I chose the 72% forward punch. It gives up some safety compared with the lateral recovery, but I think the extra progress is worth the additional modeled tree risk.”

GM can explain tradeoffs without claiming its choice is the only correct decision.

The GM/evaluator should compare candidates using **all-outcome expected value**, not merely `expected_leave_if_clean`. A 43% aggressive recovery must account for what happens during the remaining 57% of Clip/Major outcomes when compared with a 92% safe recovery.

## 14. GM Language

Avoid unsupported certainty such as:

> “Dense mid-height branches form a wall and your only clear path is exactly 90° left.”

when Jetta only has canopy geometry.

Prefer:

> “You're under the tree canopy and the direct route toward the green is obstructed. The safest modeled recovery is a short punch toward the fairway. A more aggressive forward recovery is also available, but it carries greater modeled tree-interference risk.”

## 15. Preserve Existing Tree Model Initially

Do not require immediate changes to:

- canopy edge threshold;
- Edge / Under / Deep classification;
- 3/4 / 1/2 / punch-only guidance;
- ~65% carry modifier;
- ~45% roll modifier;
- existing mishit penalty.

Those can be tuned separately.

First replace:

```text
Pin blocked
→ nearest clear fairway
→ repetitive single punch-out
```

with:

```text
Tree situation
→ generate defensible recovery destinations
→ create 1–3 materially different plans
→ calculate tree-interference probabilities
→ show risk + reward
→ player chooses
→ probability affects actual execution
```

## 14. Dedicated Tree-Recovery Candidate Generator

Implement tree recovery through a **dedicated tree-recovery candidate generator** rather than forcing all behavior into the current generic recovery generator.

The existing generic recovery generator is a useful foundation because it already understands recovery targets and ordinary strategy choices, but it is not sufficient by itself for the new contract.

The tree-specific generator must support:

- 1–3 choices rather than collapsing normal play to a fixed pair;
- tree-depth context;
- candidate direction/distance classification;
- Clean / Clip / Major probabilities;
- risk-and-reward metadata;
- `expected_leave_if_clean`;
- internal all-outcome expectation;
- tree-specific evidence/versioning.

Reuse shared geometry/target/evaluator utilities from the generic recovery system wherever practical. Do not fork duplicate geometry or simulation logic.

Conceptually:

```text
Generic geometry/recovery utilities
             ↓
Dedicated Tree Recovery Candidate Generator
             ↓
1–3 tree-aware candidates
             ↓
Probability + reward evaluation
             ↓
Same candidate set → Player UI + Game Master
```

## 15. Conceptual Data Contract

Adapt to existing repository types rather than creating unnecessary parallel schemas.

```json
{
  "recovery_id": "tree-forward-punch",
  "title": "Forward Punch",
  "tree_depth": "UNDER_CANOPY",
  "target": {
    "type": "COURSE_COORDINATE",
    "x": 124.4,
    "y": 288.7
  },
  "intended_distance_yards": 55,
  "direction_class": "FORWARD_DIAGONAL",
  "shot_guidance": "HALF_SWING_PUNCH",
  "probabilities": {
    "clean_escape": 0.72,
    "branch_clip": 0.21,
    "major_tree_contact": 0.07
  },
  "reward": {
    "expected_leave_if_clean_yards": 95,
    "overall_expected_leave_yards": 104
  },
  "evidence": {
    "analysis_seed": 182731,
    "recovery_model_version": "tree-recovery-v1",
    "simulator_version": "...",
    "course_geometry_version": "...",
    "player_profile_hash": "..."
  }
}
```

If probabilities come from Monte Carlo, preserve sample count. If calculated analytically, do not fabricate a sample count; record calculation/model version instead.

## 16. Implementation Sequence

### Phase 1 — Repository trace
Locate existing tree classification, canopy intersection, clear/partial/blocked pin-line logic, recovery-target generator, tree carry/roll/mishit modifiers, GM recovery context, strategy evaluator, deterministic seed handling, and replay persistence. Reuse them.

### Phase 2 — Dedicated tree-recovery candidate generator
Create the dedicated tree-aware generator. Reuse generic recovery/geometry primitives, but produce 1–3 distinct tree-recovery destinations and preserve the probability-ready evidence needed for each plan. Do not change execution yet.

### Phase 3 — Versioned probability and expected-outcome model
Calculate Clean/Clip/Major probabilities and the all-outcome strategy evidence, including overall expected leave/outcome. Test Edge, Under, Deep, short lateral, longer diagonal, aggressive recovery, invalid hazard destinations, and cases where Major contact leaves the ball in trees or creates hazard exposure.

### Phase 4 — UI
Show recovery title, Clean Escape %, and reward/expected leave. Keep deeper statistics optional.

### Phase 5 — Simulation integration
Use one seeded recovery-outcome roll and feed the resolved Clean/Clip/Major modifiers into the existing shot simulation. Apply the normal tree-lie penalty exactly once; Clip/Major add only their incremental contact modifiers.

### Phase 6 — GM + wording
GM selects from the same candidate set and explains risk/reward. Update the recovery wording in the same phase so legacy phrases such as “the only clear path” do not contradict the probabilistic model.

### Phase 7 — Replay and tuning
Persist evidence/outcome and tune probabilities through play testing.

## 17. Guardrails / Tests

Verify:

1. Tree situations can produce 1, 2, or 3 choices.
2. UI never requires exactly three.
3. Short safe recovery generally has lower modeled tree risk than materially more aggressive recovery under equivalent conditions.
4. Deep-tree situations are generally more restrictive than edge situations.
5. Known hazards/OB invalidate inappropriate targets.
6. Mutually exclusive recovery probabilities sum correctly.
7. Displayed Clean Escape % equals the probability used for execution.
8. Fixed seed/state/choice reproduces the same tree-interference outcome.
9. Refresh after commitment does not reroll.
10. Replay reproduces stored outcome.
11. GM receives the same offered options.
12. GM does not invent unsupported branch/corridor facts.
13. Existing non-tree behavior remains unchanged.
14. Existing 18-hole scoring remains unchanged except for resulting ball outcomes.
15. Existing tree penalties are not removed or accidentally double-applied.
16. CLEAN applies the normal tree-lie physics once and adds no second tree-contact penalty.
17. CLIP and MAJOR apply only their incremental modifiers on top of normal tree-lie physics.
18. Persisted probability set + persisted outcome roll reproduce the same resolved outcome.
19. GM/evaluator compares all-outcome expectation rather than only `expected_leave_if_clean`.
20. Details reveal important failure consequences such as remaining in trees or hazard exposure when supported.
21. Tree-specific choices are produced through the dedicated tree-recovery candidate generator while reusing existing shared geometry/evaluator primitives.
16. Clean applies the base tree-lie physics exactly once and no additional contact penalty.
17. Clip/Major add their deterministic contact modifiers on top of the single base tree-lie application.
18. The persisted displayed probability set and outcome roll reproduce the committed Clean/Clip/Major result.
19. Evaluator/GM comparisons use all-outcome expectation rather than only `expected_leave_if_clean`.
20. The dedicated tree-recovery generator reuses shared geometry/simulation utilities rather than duplicating them.

## 18. Acceptance Criteria

V1 is complete when:

- blocked tree situations no longer default to the same deterministic sideways punch;
- Jetta can present 1–3 defensible recovery choices;
- each meaningful choice exposes modeled Clean Escape %;
- risk is paired with useful reward information;
- each candidate has `expected_leave_if_clean` plus an internal all-outcome expectation for evaluator/GM comparison;
- probabilities use only information the game actually models;
- Jetta does not pretend to know unmapped exact branches/trunks;
- displayed probability affects actual execution;
- outcome is deterministic after commitment;
- GM evaluates the same choices;
- GM language reflects uncertainty;
- existing physics/tree-lie rules remain authoritative and compatible;
- regular 18-hole match play remains intact;
- the existing tree-lie penalty is applied exactly once;
- the displayed probability set and seeded outcome roll are persisted;
- the evaluator/GM has an all-outcome expectation for comparing plans;
- important downside consequences are available in Details;
- tree recovery uses a dedicated tree-aware candidate generator built on shared existing primitives.

## 19. Non-Goals for V1

Do not require:

- individual real-world tree mapping;
- trunk geometry;
- exact branch geometry/heights;
- computer-vision reconstruction of openings;
- photorealistic tree collision;
- a new general shot physics engine;
- changes to Golf Academy;
- exactly three recovery choices;
- claims that modeled percentages are measured real-world probabilities.

## 20. Product Principle

Do not tell the golfer:

> **“There is only one shot.”**

when the data cannot support that certainty.

Instead:

> **“Here are the recovery choices Jetta can reasonably model. Here is the risk and reward of each. You decide how much risk is worth taking.”**

This turns tree trouble from a repetitive automatic punch-out into a meaningful golf decision while staying honest about the limits of Jetta's course data.
