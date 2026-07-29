# Decision Scoring Spec

Last updated: 2026-07-29

**Implementation status:** The version 1 shot scorer, putting scorer, weighted
hole/round aggregation, repeat-pattern detection, browser review, and structured
AI handoff are implemented. Persistent multi-round progression remains future
work.

This document defines the deterministic scoring model for course-management
analysis. It turns the product goals in
`docs/COURSE_MANAGEMENT_ANALYSIS.md` into implementation-oriented rules,
schemas, and scoring mechanics.

## Purpose

This spec exists to make decision scoring:

- deterministic
- explainable
- testable
- reusable across Python, browser, and AI narration layers

The scoring engine should decide whether a player's shot choice was sound.
AI should only explain that result.

## Scope

This spec covers:

- per-shot strategic decision grading
- execution grading as a separate axis
- score aggregation into hole and round strategy scores
- reason codes and advice-key selection
- deterministic output contracts for future UI and AI use

This spec does not yet define:

- detailed UI presentation
- persistent player trend dashboards
- machine-learning models
- fully course-specific strategy exceptions

## Core Design Rules

- Decision grading must be based on pre-shot context, not just shot outcome.
- Execution grading must be based on how closely the result matched the chosen plan.
- Decision grading and execution grading must remain separate.
- Hazard cost must matter more than cosmetic distance errors.
- Severe lie or trouble situations should reward discipline more than aggression.
- The same inputs should always produce the same decision score.

## Evaluation Layers

Each meaningful shot produces two independent evaluations:

- `decision_evaluation`
- `execution_evaluation`

The course-management score is built mainly from `decision_evaluation`.

## Strategic Evaluation Lifecycle

The production scoring flow should work like this:

1. The engine resolves authoritative pre-shot facts.
2. The player chooses club, aim, and intended shot.
3. Decision-scoring logic evaluates the choice before or alongside outcome review.
4. The engine resolves the authoritative result packet.
5. Execution-scoring logic evaluates whether the result matched the plan.
6. Advice keys and reason codes are attached.
7. The UI and AI layers render the explanation.

## Required Inputs

Per shot, the scorer should eventually receive a normalized request object with
at least:

- `course_id`
- `hole_number`
- `stroke_number`
- `distance_to_target_yards`
- `distance_to_front_yards` when relevant
- `distance_to_back_yards` when relevant
- `lie_type`
- `surface_type`
- `ball_position_context`
- `hazards_in_play`
- `out_of_bounds_in_play`
- `forced_carry_yards`
- `landing_area_width_yards`
- `pin_risk_level`
- `intended_shot_type`
- `selected_club`
- `target_start_line`
- `target_depth_plan`
- `preferred_miss`
- `player_profile_id`

The scorer may also consume:

- `wind`
- `slope`
- `elevation`
- `shot_history`
- `hole_state`
- `score_context`

These should be added only when they improve strategic grading without making
the first implementation unstable.

## Canonical Shot Types

The scorer should classify shots into one of these strategic buckets:

- `tee_positioning`
- `tee_attack`
- `approach_standard`
- `approach_forced_carry`
- `layup_positioning`
- `recovery_escape`
- `recovery_advancing`
- `bunker_escape`
- `greenside_attack`
- `chip_pitch_standard`
- `putt_lag`
- `putt_make_attempt`

This bucket determines weighting and rule priority.

## Canonical Preferred Miss Values

The scorer should normalize the player's intended safe miss into one of:

- `center_green`
- `short_safe`
- `long_safe`
- `left_safe`
- `right_safe`
- `dry_side`
- `away_from_ob`
- `back_in_play`
- `widest_landing_zone`
- `none_declared`

If the player does not explicitly choose one, the scorer may infer it from aim
and context, but inferred values should be marked as inferred.

## Decision Score Structure

Each shot should produce:

- `decision_score`: integer `0-100`
- `decision_label`
- `decision_confidence`
- `decision_reasons`
- `decision_subscores`
- `advice_keys`

Suggested labels:

- `excellent`
- `sound`
- `acceptable`
- `aggressive`
- `poor`
- `reckless`

Suggested confidence values:

- `high`
- `medium`
- `low`

Confidence is about rule completeness, not about model uncertainty.

## Execution Score Structure

Each shot should also produce:

- `execution_score`: integer `0-100`
- `execution_label`
- `plan_match`
- `result_reasons`

Suggested labels:

- `matched_plan`
- `slight_miss`
- `clear_miss`
- `major_miss`

Execution should describe how the shot came off, not whether the decision was
smart.

## Deterministic Output Contract

Suggested future packet:

```json
{
  "version": "decision-score-v2",
  "shot_id": "course:hole:stroke",
  "decision": {
    "score": 78,
    "label": "sound",
    "confidence": "high",
    "subscores": {
      "target_selection": 82,
      "club_selection": 74,
      "lie_management": 85,
      "hazard_management": 76,
      "recovery_discipline": 80,
      "miss_planning": 70
    },
    "reasons": [
      "lie_respected",
      "hazard_respected",
      "safe_target_selected",
      "carry_margin_thin"
    ],
    "advice_keys": [
      "rough_medium",
      "water_in_play",
      "favor_safe_side"
    ]
  },
  "execution": {
    "score": 61,
    "label": "clear_miss",
    "plan_match": "below_expected_start_line_and_distance",
    "reasons": [
      "missed_start_line",
      "distance_short_of_plan"
    ]
  }
}
```

## Decision Subscores

The first implementation should score these six categories:

- `target_selection`
- `club_selection`
- `lie_management`
- `hazard_management`
- `recovery_discipline`
- `miss_planning`

Suggested weighting in the final shot decision score:

- `target_selection`: 25%
- `club_selection`: 20%
- `lie_management`: 15%
- `hazard_management`: 20%
- `recovery_discipline`: 10%
- `miss_planning`: 10%

These weights should be adjusted by shot type.

## Shot-Type Weight Overrides

### Tee positioning shots

- emphasize `target_selection`
- emphasize `hazard_management`
- de-emphasize `recovery_discipline`

### Standard approach shots

- emphasize `target_selection`
- emphasize `club_selection`
- emphasize `miss_planning`

### Forced-carry approaches

- heavily emphasize `club_selection`
- heavily emphasize `hazard_management`

### Recovery shots

- heavily emphasize `recovery_discipline`
- heavily emphasize `hazard_management`
- de-emphasize aggressive target value

### Bunker escape shots

- heavily emphasize `lie_management`
- heavily emphasize `recovery_discipline`

### Lag putts

- emphasize `pace discipline`
- de-emphasize make outcome

Putting can use a parallel but smaller scoring framework in the first release.

## Base Scoring Model

Use a penalty-and-credit model:

- start from `85`
- add small credits for strong strategic choices
- subtract penalties for risky or unsound choices
- clamp the final decision score to `0-100`

Why `85`:

- a normal sound golf decision should usually land in the `75-90` range
- this prevents average safe play from grading as artificially poor
- the system can reserve `90+` for clearly strong decisions

## Suggested Credits

- `+5`: clearly chose the largest safe target
- `+4`: selected a club with proper carry margin
- `+4`: adjusted correctly for a severe lie
- `+3`: chose the correct recovery/escape option
- `+3`: selected the correct preferred miss
- `+2`: laid up intelligently to a useful yardage

Credits should be limited so a reckless decision cannot be fully offset by one
good secondary choice.

## Suggested Penalties

- `-4`: target is tighter than necessary without strong reward
- `-5`: chosen club leaves thin carry margin
- `-6`: lie is not respected
- `-6`: preferred miss does not match the main hazard
- `-8`: attack line brings penalty area into unnecessary play
- `-8`: ignores obvious recovery/escape need
- `-10`: aggressive pin attack from reduced-control lie
- `-12`: out-of-bounds side challenged without clear reward
- `-12`: forced carry chosen without adequate margin
- `-15`: reckless hero shot from clear trouble

Multiple penalties may apply, but the scorer should prevent double-counting the
same mistake under different names.

## Decision Label Thresholds

- `90-100`: `excellent`
- `80-89`: `sound`
- `70-79`: `acceptable`
- `60-69`: `aggressive`
- `45-59`: `poor`
- `0-44`: `reckless`

These labels should be deterministic and not AI-generated.

## Reason Code System

The scorer should emit stable reason codes rather than only prose.

### Positive reason codes

- `safe_target_selected`
- `correct_club_for_carry`
- `lie_respected`
- `hazard_respected`
- `sensible_recovery`
- `good_miss_plan`
- `smart_layup`
- `green_center_bias_correct`

### Negative reason codes

- `target_too_aggressive`
- `carry_margin_thin`
- `lie_not_respected`
- `hazard_underweighted`
- `recovery_not_taken`
- `bad_miss_plan`
- `pin_attack_not_justified`
- `ob_risk_not_justified`
- `hero_shot_not_justified`

These codes will support testing, UI summaries, and AI narration.

## Rule Priority

When several rules apply, apply them in this order:

1. penalty-risk prevention
2. forced-carry validation
3. lie respect
4. recovery discipline
5. target selection
6. club selection
7. preferred miss logic
8. optimization credits

This priority order matters because avoiding doubles and penalties is more
important than maximizing birdie chance from a marginal spot.

## Core Rule Families

### 1. Hazard avoidance rules

If water, out of bounds, or a severe miss zone is in play:

- penalize aims that unnecessarily bias toward the hazard
- reward safe-side bias
- penalize preferred misses that point toward the hazard

Default outputs:

- advice key: `remove_big_miss`
- hazard key based on context

### 2. Forced-carry rules

If a shot requires a forced carry:

- reward clubs that provide a buffer above the carry number
- penalize clubs that require near-perfect strike to cover
- heavily penalize aggressive targeting if short is dead

Default outputs:

- advice key: `cover_the_carry`
- hazard key: `forced_water_carry` when applicable

### 3. Lie-respect rules

If the lie reduces control:

- reward center or safe-side targets
- penalize tucked-pin attacks
- reward extra loft or conservative advancement in heavy trouble

Default outputs:

- lie advice key from `docs/STANDARD_ADVICE_LIBRARY.md`
- outcome key: `prioritize_solid_contact` or `escape_first`

### 4. Recovery rules

If the ball is in trouble:

- reward return-to-play decisions
- penalize distance-forcing through low-probability windows
- reward rebuilding position after penalties

Default outputs:

- local or hazard key: `tree_trouble`, `recovery_after_penalty`, or `unplayable_situation`
- outcome key: `restore_position` or `escape_first`

### 5. Pin versus center-green rules

If the pin is tucked and the lie or hazard reduces control:

- reward center-green or fat-side targets
- penalize direct pin attacks from rough, sidehill, or forced-carry pressure

Default outputs:

- outcome key: `favor_center_green` or `favor_safe_side`

## Putting Decision Scoring

Putting should be included, but the first release should keep it simpler than
full-shot decision scoring.

Suggested categories:

- `pace_plan`
- `line_plan`
- `three_putt_avoidance`

Suggested rule examples:

- reward long-putt pace intent that prioritizes two-putt range
- penalize downhill putt aggression that ignores leave risk
- reward sensible breaking-putt pace that matches the read

Suggested advice keys:

- `long_putt`
- `breaking_putt`
- `uphill_putt`
- `downhill_putt`
- `short_must_make_putt`

## Execution Scoring Model

Execution scoring should compare actual outcome against declared or inferred
plan.

Suggested dimensions:

- start-line match
- distance-control match
- shape match
- result severity

Suggested execution scoring:

- start from `80`
- subtract based on mismatch severity
- clamp `0-100`

Example penalties:

- `-5`: slight start-line miss
- `-8`: moderate distance miss
- `-12`: severe directional miss
- `-15`: result created avoidable penalty or unusable next position

Execution penalties should not rewrite the decision score.

## Decision Versus Outcome Interpretation

The UI and AI should interpret combinations like this:

- high decision, low execution: `good plan, poor strike`
- low decision, high execution: `poor plan, fortunate result`
- high decision, high execution: `well managed and well executed`
- low decision, low execution: `strategy and execution both need review`

## Hole Score Aggregation

Each hole should produce:

- `hole_strategy_score`
- `hole_decision_pattern_summary`
- `key_decision_moment`

Suggested shot weights:

- tee positioning or attack: `1.0`
- standard approach: `1.2`
- forced-carry approach: `1.35`
- layup positioning: `1.0`
- recovery shot: `1.3`
- bunker escape: `1.2`
- lag putt: `0.6`
- short putt: `0.5`

The hole score is the weighted average of shot decision scores.

## Round Score Aggregation

Each round should produce:

- `round_strategy_score`
- `subscores`
- `top_strength`
- `top_priority`
- `top_good_decisions`
- `top_costly_decisions`
- `pattern_summary`

The round score should be the weighted average of hole or shot strategy scores.

The first implementation should aggregate from shot scores directly.

## Pattern Detection Rules

The system should detect repeated strategic mistakes using reason-code counts.

Suggested patterns:

- repeated aggressive targets from rough
- repeated thin carry choices
- repeated hazard underweighting
- repeated poor preferred-miss selection
- repeated failure to take recovery

Pattern detection can start with simple thresholds:

- same negative reason code appears 3 or more times
- or appears 2 times in high-cost situations

## Advice-Key Selection Rules

Every shot evaluation should attach a small set of advice keys.

Suggested maximum:

- 1 lie key
- 1 local situation key
- 1 hazard key
- 1 outcome key

Selection priority:

1. primary lie or trouble state
2. most costly hazard context
3. most appropriate outcome phrase

These keys should align to `docs/STANDARD_ADVICE_LIBRARY.md`.

## Minimum Viable Implementation

The first production-safe version should support:

- all canonical lie types in `data/fixtures/lie_catalog.json`
- water and out-of-bounds risk handling
- forced-carry detection
- center-green versus pin-attack logic
- recovery versus hero-shot logic
- deterministic shot and round scoring output
- stable reason codes
- stable advice keys

This is enough to produce meaningful post-round course-management analysis.

## Required Automated Tests

The decision scorer should eventually have coverage for:

- same input always yields same score
- safe target from rough grades higher than pin attack from rough
- proper carry club grades higher than thin carry club
- recovery punch-out grades higher than hero shot through trees
- center-green target near water grades higher than short-side attack
- lucky good outcome does not erase poor decision grade
- poor strike does not erase strong decision grade
- round aggregation preserves weighted scoring
- advice keys and reason codes are emitted correctly

## Proposed Implementation Order

1. Define immutable scoring contracts in `packages/golf_domain/models.py` or a new scoring module.
2. Add reason-code enums and decision-label enums.
3. Create a deterministic scorer in `packages/simulation/`.
4. Add unit tests for core rule families.
5. Add browser integration for per-shot and round analysis packets.
6. Extend `packages/ai/prompts.py` to consume structured decision output.
7. Add end-of-round AI narration based on deterministic scoring packets.

## Product Decisions

- The system will infer the preferred miss automatically from the target, hazards, and shot context.
- The player should explicitly declare intended shot type when it materially changes decision quality. Version 1 should support a small fixed set such as `stock`, `aggressive`, `conservative`, `recovery`, `layup`, and `putt`.
- The system should infer target safety, preferred miss, and hazard-avoidance intent rather than asking the player to declare them directly.
- Score context should only make small late-round adjustments. It may slightly increase aggression tolerance when trailing or slightly increase safety tolerance when protecting a lead, but it should not override basic hazard and lie discipline.
- Putting strategy should be scored separately from full-shot strategy in version 1 so approach, recovery, and putting decisions remain easier to interpret.
- The system should use hole-specific and course-specific context only when it is explicit and deterministic, such as hazard locations, out-of-bounds, layup zones, green depth, and severe slope tags. It should not depend on hidden course history or bespoke club-level modeling in version 1.

These decisions are sufficient to start deterministic scoring contracts and
tests without blocking on further product design.
