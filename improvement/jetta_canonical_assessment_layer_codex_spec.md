# Jetta Canonical Assessment Layer
## Codex Implementation Specification

## 1. Purpose

Create one authoritative assessment layer in Jetta that standardizes how shots, decisions, targets, risk, and replay outcomes are evaluated.

Core principle:

> **Jetta should have one official assessment contract. Replay, GPS, PC simulation, UI, and Game Master should consume it instead of creating their own competing judgments.**

This layer is primarily deterministic application logic. It is not an LLM and it must not become a second physics engine.

## 2. Why This Is Needed

Jetta now contains several systems that can potentially evaluate a golf situation:

- Shot simulation
- Hybrid/probabilistic evaluator
- Safe & Smart strategy
- Aggressive strategy
- GPS round evidence
- Replay
- Landing Target
- Direction Target
- Rule of 12
- Short-game evaluation
- Outcome vs Target
- Game Master explanation

Without a canonical assessment layer, different modules can eventually contradict one another.

## 3. Architectural Position

```text
RAW GAME / ROUND DATA
        ↓
EXISTING JETTA ENGINES
physics / evaluator / GPS
        ↓
CANONICAL ASSESSMENT LAYER
        ↓
STANDARD ASSESSMENT
        ↓
Replay / GPS / PC Game / UI / Game Master
```

The canonical layer consumes existing evidence and produces a normalized assessment object.

## 4. Non-Goals

Do NOT:

1. create a second shot physics engine;
2. create a second independent risk evaluator;
3. duplicate the existing hybrid/probabilistic evaluator;
4. let the LLM determine official labels;
5. infer swing mechanics from GPS start/finish positions;
6. judge a decision only from the final result;
7. silently reevaluate historical rounds with newer models.

## 5. First-Version Assessment Domains

Implement four primary domains first:

```text
1. Result Assessment
2. Decision Assessment
3. Outcome vs Target
4. Risk Assessment
```

Later domains may include Club Selection, Landing Target, Short Game, Putting, Course Management, and Rule of 12 assessments.

## 6. Result Assessment

Result Assessment answers:

> **What actually happened?**

Possible labels:

```text
GOOD_RESULT
MIXED_RESULT
COSTLY_RESULT
RECORDED_RESULT
```

Example:

```json
{
  "label": "COSTLY_RESULT",
  "reason_codes": ["BUNKER_FINISH"]
}
```

Use observed outcome evidence such as finish lie, penalties, green reached, playable lie, remaining distance, score impact, and actual landing/finish surface.

Do not make simplistic mappings when existing expected-strokes/context logic is available.

## 7. Decision Assessment

Decision Assessment answers:

> **Was the selected plan strategically reasonable based on the evidence available before the shot?**

Possible labels:

```text
PREFERRED_PLAN
COMPETITIVE_PLAN
HIGHER_RISK_PLAN
DECISION_NOT_GRADED
```

A poor result must not automatically create a poor decision label.

Example:

```text
Decision = PREFERRED_PLAN
Result   = COSTLY_RESULT
```

Decision evidence may include selected target, club, swing %, Safe & Smart alternative, Aggressive alternative, paired simulation output, expected strokes, penalty probability, bunker probability, playable-lie probability, green/target probability, expected leave, evaluator version, seed, and sample count.

If original pre-shot evidence does not exist:

```text
DECISION_NOT_GRADED
```

## 8. Outcome vs Target

Outcome vs Target answers:

> **Where did the actual shot finish relative to the intended target?**

This should be geometric and deterministic.

Example:

```json
{
  "available": true,
  "distance_from_target_yards": 18.4,
  "lateral_miss_yards": 15.2,
  "depth_miss_yards": -10.3,
  "lateral_direction": "RIGHT",
  "depth_direction": "SHORT"
}
```

Do not diagnose swing mechanics from this evidence.

If intended target was not preserved, mark Outcome vs Target unavailable.

## 9. Risk Assessment

Normalize existing risk evidence rather than creating a new probability model.

Example:

```json
{
  "penalty_probability": 0.02,
  "bunker_probability": 0.08,
  "water_probability": 0.01,
  "playable_lie_probability": 0.91,
  "green_probability": 0.42
}
```

Possible reason codes:

```text
LOW_PENALTY_RISK
HIGH_BUNKER_EXPOSURE
NARROW_LANDING_ZONE
SMALL_EXPECTED_VALUE_GAIN
```

## 10. Canonical Shot Assessment Contract

Create one standardized object, adapting names to current Jetta conventions:

```json
{
  "assessment_version": "1.0",
  "result": {
    "label": "COSTLY_RESULT",
    "reason_codes": ["BUNKER_FINISH"]
  },
  "decision": {
    "label": "PREFERRED_PLAN",
    "confidence": 0.87,
    "reason_codes": ["LOWER_PENALTY_RISK", "STRONG_EXPECTED_VALUE"]
  },
  "outcome_vs_target": {
    "available": true,
    "distance_from_target_yards": 18.4,
    "lateral_miss_yards": 15.2,
    "depth_miss_yards": -10.3,
    "lateral_direction": "RIGHT",
    "depth_direction": "SHORT"
  },
  "risk": {
    "penalty_probability": 0.02,
    "bunker_probability": 0.08,
    "playable_lie_probability": 0.91
  },
  "evidence": {
    "simulation_version": "sim-v8",
    "evaluator_version": "hybrid-v5",
    "seed": 182731,
    "sample_count": 400
  }
}
```

## 11. Stable Reason Codes

Use stable reason codes instead of prose-only judgments.

Examples:

```text
GREEN_REACHED
FAIRWAY_FINISH
ROUGH_FINISH
FRINGE_FINISH
BUNKER_FINISH
WATER_PENALTY
OUT_OF_BOUNDS
HOLED_OUT
LOWER_PENALTY_RISK
HIGHER_PENALTY_RISK
LOWER_BUNKER_RISK
HIGH_BUNKER_EXPOSURE
BETTER_EXPECTED_STROKES
SMALL_EXPECTED_VALUE_GAIN
LARGER_PLAYABLE_AREA
NARROW_LANDING_ZONE
CARRY_HAZARD_REQUIRED
TARGET_EVIDENCE_MISSING
SIMULATION_EVIDENCE_MISSING
```

## 12. Canonical Assessment Service

Create a centralized service/module.

Conceptual Python:

```python
class AssessmentService:
    def assess_shot(self, context):
        return ShotAssessment(
            result=self.result_assessor.assess(context),
            decision=self.decision_assessor.assess(context),
            outcome_vs_target=self.target_assessor.assess(context),
            risk=self.risk_assessor.assess(context),
        )
```

Possible organization:

```text
assessment/
    models.py
    enums.py
    reason_codes.py
    result_assessor.py
    decision_assessor.py
    target_outcome_assessor.py
    risk_assessor.py
    assessment_service.py
```

Adapt to the existing project layout.

## 13. Normalized Input Context

Prefer a normalized input context instead of assessors reaching into arbitrary UI state.

Conceptual:

```python
@dataclass
class ShotAssessmentContext:
    shot_result: ShotResult
    intended_target: Target | None
    player_profile_snapshot: PlayerProfileSnapshot
    selected_plan: StrategyPlan | None
    strategy_alternatives: list[StrategyPlan]
    simulation_evidence: SimulationEvidence | None
    gps_evidence: GpsEvidence | None
    course_context: CourseContext
    hole_context: HoleContext
```

Reuse existing domain models where possible.

## 14. Game Master Relationship

The Game Master is not the canonical judge.

Correct flow:

```text
Canonical Assessment
        ↓
structured facts
        ↓
Game Master
        ↓
natural-language explanation
```

Example canonical output:

```text
Decision: Preferred Plan
Result: Costly Result
Outcome: 18 yd right of target
Finish: bunker
```

The Game Master may explain this, but it must not contradict official labels.

## 15. Replay Relationship

Replay should consume canonical assessments.

Suggested presentation:

```text
RESULT
Costly Result

DECISION
Preferred Plan

OUTCOME VS TARGET
18 yd right
10 yd short

EVIDENCE
Recorded / Modeled / Not graded
```

Replay should not independently derive competing labels.

## 16. GPS Relationship

For recorded GPS shots, use observed evidence such as start, finish, distance, finish lie, and score effect.

If target and strategy evidence were preserved, Decision and Outcome vs Target can be assessed.

If not:

```text
Decision = DECISION_NOT_GRADED
Outcome vs Target = unavailable
```

## 17. PC Simulation Relationship

PC simulation should use the same canonical labels so PC play, GPS replay, Replay, and Game Master all speak the same language.

## 18. Landing Target Integration

For Landing Target mode:

```text
player selects landing point
        ↓
player selects club
        ↓
auto-power solver computes expected carry
        ↓
shot simulation produces actual outcome
        ↓
canonical layer assesses
```

Preserve expected landing point, actual landing point, actual finish, landing surface, finish surface, and Outcome vs Target.

Do not force actual landing to the target.

## 19. Direction Target Integration

For Direction Target mode, target controls direction while club + power control distance.

The assessment input must preserve target semantics.

Do not treat a Direction Target as an intended landing point.

## 20. Rule of 12 Integration

Rule of 12 is an upstream candidate-club heuristic, not the canonical judge.

```text
Landing Target
      ↓
Rule of 12 candidates
      ↓
existing simulation/evaluator
      ↓
canonical assessment
      ↓
Game Master explanation
```

Possible reason codes:

```text
RULE_OF_12_CANDIDATE
HAZARD_OVERRIDE
FRINGE_ROLLOUT_ADJUSTMENT
GREEN_SLOPE_OVERRIDE
PLAYER_PROFILE_OVERRIDE
```

## 21. Fringe Integration

Fringe evidence should flow through the same assessment path.

Possible evidence:

```text
landing_surface = FRINGE
finish_surface = GREEN
fringe_distance_traveled = 3.2 yd
green_distance_traveled = 8.6 yd
```

Do not create separate ad-hoc fringe judgments in Replay or Game Master.

## 22. Safe & Smart vs Aggressive

The existing paired evaluator remains authoritative for strategy comparison.

Do not hard-code that Safe is always preferred or Aggressive is always bad.

Canonical Decision Assessment should classify plans from existing evaluator output and centralized policy.

## 23. Decision Policy

Put thresholds in one centralized/versioned policy rather than scattering them through UI code.

Conceptual example:

```python
DecisionAssessmentPolicy(
    preferred_ev_tolerance=0.05,
    high_penalty_delta=0.08,
    competitive_ev_tolerance=0.10,
)
```

Exact values must come from existing evaluator behavior and testing, not arbitrary guesses.

## 24. Confidence

Optional decision confidence can be used when supported by evaluator evidence.

Do not pretend high certainty when alternatives are statistically close.

If confidence cannot be defined cleanly in v1, omit it initially.

## 25. Missing Evidence

Make missing evidence first-class:

```text
DECISION_NOT_GRADED
TARGET_UNAVAILABLE
SIMULATION_EVIDENCE_UNAVAILABLE
HISTORICAL_EVIDENCE_INCOMPLETE
```

Never invent missing pre-shot evidence.

## 26. Historical Integrity

Historical rounds should preserve enough metadata to reproduce their original assessment:

```text
assessment_version
simulation_version
evaluator_version
decision_policy_version
seed
sample_count
target evidence
selected plan
alternative summaries
```

Do not automatically recalculate old rounds under newer policy and present that as the original judgment.

A future "Reanalyze with Current Model" feature must be explicit and separate.

## 27. Persistence Strategy

Persist compact canonical output and version references.

Do not embed huge geometry or full simulation payloads inside every assessment.

This must remain compatible with the new server-side, hole-by-hole replay loading architecture.

## 28. Runtime Flow

Live shot:

```text
Player chooses plan
        ↓
existing pre-shot evaluator
        ↓
save strategy evidence
        ↓
existing physics resolves shot
        ↓
save actual result
        ↓
AssessmentService.assess_shot(...)
        ↓
persist canonical assessment
        ↓
UI/Game Master consume it
```

Replay:

```text
load shot
   ↓
load preserved canonical assessment
   ↓
render Result / Decision / Outcome vs Target
   ↓
Game Master explains structured evidence
```

## 29. Required Tests

### Decision vs Result Separation
Given preferred pre-shot plan + bunker result, verify:

```text
Decision = PREFERRED_PLAN
Result = COSTLY_RESULT
```

### Good Result From Higher-Risk Decision
Given higher-risk aggressive plan + green result, verify:

```text
Decision = HIGHER_RISK_PLAN
Result = GOOD_RESULT
```

A good result must not retroactively make the decision preferred.

### Outcome vs Target
Verify geometric left/right and short/long calculations.

### Missing Target
Outcome vs Target must be unavailable, not invented.

### Missing Decision Evidence
Return `DECISION_NOT_GRADED`.

### Mode Consistency
The same assessment input must produce the same labels for PC Replay, GPS Replay, Game Master, and UI.

### Historical Versioning
Stored old assessments must not silently change after policy/evaluator updates.

## 30. Golden Scenarios

Create a small golden-test suite.

### Scenario A
Preferred safe target selected; actual shot misses right into bunker.

Expected:

```text
Decision: PREFERRED_PLAN
Result: COSTLY_RESULT
Outcome: RIGHT of target
```

### Scenario B
Higher-risk aggressive target selected; small EV gain and large penalty-risk increase; actual shot finishes green.

Expected:

```text
Decision: HIGHER_RISK_PLAN
Result: GOOD_RESULT
```

### Scenario C
Older GPS shot with no intended target stored.

Expected:

```text
Decision: DECISION_NOT_GRADED
Outcome vs Target: unavailable
```

## 31. Observability

Expose/log in development:

```text
assessment_version
result label
decision label
reason codes
input evidence IDs
policy version
evaluator version
seed
sample count
```

## 32. Acceptance Criteria

- [ ] One centralized canonical assessment contract exists.
- [ ] Result, Decision, Outcome vs Target, and Risk are distinct.
- [ ] Result does not automatically determine Decision.
- [ ] Outcome vs Target is geometric, not swing diagnosis.
- [ ] Missing evidence creates explicit unavailable/not-graded states.
- [ ] Existing physics engine is reused.
- [ ] Existing probabilistic/hybrid evaluator is reused.
- [ ] No duplicate risk engine is created.
- [ ] Game Master consumes canonical output and does not override it.
- [ ] Replay consumes the same output.
- [ ] GPS consumes the same output where evidence exists.
- [ ] PC simulation uses the same vocabulary.
- [ ] Landing Target semantics are preserved.
- [ ] Direction Target semantics are preserved.
- [ ] Rule of 12 remains an upstream heuristic.
- [ ] Fringe integrates through the same path.
- [ ] Safe & Smart/Aggressive use existing paired evaluation.
- [ ] Reason codes are stable/testable.
- [ ] Assessment/policy versions are stored.
- [ ] Historical assessments do not silently change.
- [ ] Golden tests cover decision/result disagreement cases.

## 33. Suggested Codex Implementation Order

1. Inspect current shot-resolution pipeline.
2. Inspect existing probabilistic/hybrid evaluator.
3. Find all existing good/bad/safe/aggressive labels.
4. Find duplicate assessment logic in Replay, GPS, Game Master, and UI.
5. Define canonical enums/reason codes.
6. Define `ShotAssessment` contract.
7. Define normalized `ShotAssessmentContext`.
8. Implement Outcome vs Target first.
9. Implement Result Assessment from existing evidence.
10. Implement Decision Assessment from preserved pre-shot evidence.
11. Implement Risk normalization from existing evaluator outputs.
12. Add `AssessmentService`.
13. Integrate into live shot-resolution flow.
14. Persist assessment/version metadata.
15. Update Replay to consume canonical assessment.
16. Update GPS replay to consume canonical assessment.
17. Update PC UI to consume canonical assessment.
18. Update Game Master to explain rather than independently judge.
19. Remove/retire duplicate assessment logic.
20. Add golden tests.
21. Add historical-versioning tests.
22. Add development observability.
23. Verify no second physics/risk/evaluator system was introduced.

## 34. Critical Codex Guardrail

Before implementation, inspect and reuse existing Jetta systems.

> **The canonical assessment layer is an orchestration/normalization layer over existing Jetta evidence. It is not a replacement simulation engine, physics engine, caddie evaluator, or risk model.**

If existing code already performs part of this behavior, refactor it into the canonical layer instead of duplicating it.

## 35. Final Product Principle

Jetta should be able to answer consistently:

```text
What happened?         -> Result
Was the plan sound?    -> Decision
Where did the shot go? -> Outcome vs Target
What risk existed?     -> Risk
```

Then:

```text
Replay shows it.
GPS shows it.
PC game shows it.
Game Master explains it.
```

That is the purpose of the canonical assessment layer.
