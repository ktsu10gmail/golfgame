# Course Management Analysis

Last updated: 2026-07-29

Implementation status: roadmap phases 1–4 are delivered for the current
deterministic rule set. Phase 5 progression tracking remains future work.

This document defines the product thinking, scoring model, and production path
for course-management analysis. It is intended to guide implementation from the
current prototype state through production-quality decision scoring and AI
feedback.

## Core Product Idea

The most important output of this game is not just the player's golf score.
The core value is helping the player understand whether their decisions were
good or bad in each golf situation.

A player should finish a round with two separate results:

- `stroke score`: what they shot
- `course management score`: how well they managed lies, hazards, targets, and risk

This distinction matters because:

- a player can make a good decision and hit a poor shot
- a player can make a poor decision and still get a lucky result
- score alone does not teach better golf thinking
- decision analysis can help players improve how they play real golf

The strategic learning loop is the real product:

1. Player plays a round.
2. The game evaluates decisions, not just outcomes.
3. The game explains what was smart, risky, or unnecessary.
4. The player adjusts future choices.
5. Better decision-making leads to better real-world scoring over time.

## Product Goal

Turn the game from a simple round simulator into a golf decision-training
system.

The game should teach players:

- when to attack
- when to play safe
- how to respect the lie
- how to account for hazards
- how to choose a target and a preferred miss
- how to recover without making the hole worse

The player should feel that the game is coaching their golf brain, not just
tracking their golf score.

## Primary Product Principle

The game score is for fun.

The course-management score is the core of the product.

## What The Round Analysis Must Explain

At the end of a round, the analysis should answer:

- Which decisions were strategically sound?
- Which decisions created unnecessary risk?
- Which decisions ignored the lie or hazard?
- Which poor outcomes came from good process?
- Which good outcomes came from bad process?
- What repeating patterns cost the player the most?
- What one or two adjustments would most improve future rounds?

## Good And Bad Learning Signals

The system must distinguish outcome from decision quality.

### Good decision, bad result

This should be graded as a strategically sound process.

Example:

- player aims center green from a difficult lie
- player chooses enough club to clear trouble
- shot is still slightly mishit and finishes in rough

Interpretation:

- strategy was good
- execution was weaker than the plan
- player should keep the decision pattern

### Bad decision, good result

This should still be graded as a poor strategic process.

Example:

- player attacks a tucked pin from moderate rough over water
- shot happens to finish safely on the green

Interpretation:

- result was acceptable
- strategy was poor
- player should not learn the wrong lesson from a lucky outcome

## Strategic Score Philosophy

The course-management score should grade thinking, not luck.

It should mainly evaluate:

- club selection
- target selection
- lie respect
- hazard respect
- recovery discipline
- miss planning
- shot ambition versus situation

It should only partially consider execution, and only to help separate process
from result.

## Two-Layer Evaluation Model

Every shot should be evaluated on two separate axes.

### 1. Decision Quality

Question:

`Was this the smart shot choice for the situation?`

This is the primary course-management grade.

### 2. Execution Quality

Question:

`Did the player carry out the chosen plan effectively?`

This should be tracked separately so the analysis can tell the player whether
the issue was strategic or technical.

## Per-Shot Decision Evaluation

Every meaningful shot should be reviewed against the same strategic categories.

### Target Choice

Did the player choose the right target?

Examples:

- center of green instead of tucked pin from rough
- safe side away from water
- widest landing zone from the tee
- proper recovery window under trees

### Club Choice

Did the player choose a club that fit the carry, lie, and landing area?

Examples:

- enough club to clear forced carry
- not too much club into a narrow landing area
- enough loft from bunker or deep rough
- sensible layup yardage instead of forcing distance

### Lie Respect

Did the player adjust properly for the lie?

Examples:

- taking extra club from rough
- lowering expectations for spin from flyer lies
- simplifying the shot from hardpan
- escaping first from buried bunker lies

### Hazard Respect

Did the player adapt to the actual cost of the miss?

Examples:

- shifting the target away from out of bounds
- favoring dry side when water is in play
- avoiding short-siding near greenside bunker or water
- not bringing double-penalty risk into play without enough reward

### Situation Awareness

Did the player understand what the hole situation required?

Examples:

- attack when the lie is clean and risk is justified
- play safely when the lie reduces control
- take medicine after trouble
- choose position over heroics after a penalty

### Miss Planning

Did the player choose the correct preferred miss?

Examples:

- center green
- short of the hole
- dry side of the target
- away from out of bounds
- back into play instead of toward the flag

## Strategic Score Output Per Shot

Each shot should eventually produce a structured evaluation record.

Suggested fields:

- `decision_score`: `0-100`
- `decision_label`: `excellent | sound | acceptable | aggressive | poor | reckless`
- `execution_score`: `0-100`
- `execution_label`: `matched_plan | slight_miss | clear_miss`
- `primary_strength`: short phrase
- `primary_mistake`: short phrase or `none`
- `recommended_pattern`: short coaching sentence
- `advice_keys`: reference keys from `docs/STANDARD_ADVICE_LIBRARY.md`

## Suggested Decision Labels

- `excellent`: clearly optimal decision for the situation
- `sound`: strong practical decision with low unnecessary risk
- `acceptable`: defensible but not ideal
- `aggressive`: higher-risk play with limited justification
- `poor`: weak strategic choice for the lie or hazard context
- `reckless`: ignored clear danger or situation constraints

## Suggested Score Interpretation

- `90-100`: elite decision quality
- `80-89`: strong course management
- `70-79`: mostly sound with some avoidable mistakes
- `60-69`: inconsistent strategic discipline
- `50-59`: repeated risk or lie-management errors
- `below 50`: poor strategic control of the course

## Which Shots Should Be Graded

Not every stroke needs the same weight.

### Full weight

- tee shots on non-trivial holes
- approach shots
- recovery shots
- forced-carry shots
- hazard-affected shots
- layup decisions

### Reduced weight

- straightforward short chips
- routine lag putts with little strategic choice
- very short tap-ins

### Special handling

- penalty situations
- declared unplayable situations
- punch-out decisions
- greenside short-sided recovery

These should often carry more strategic value because they reveal discipline.

## Round-Level Course Management Score

A round score should aggregate shot-level decision quality into one strategic
summary.

Suggested model:

- `hole_strategy_score`: weighted average of shot decision scores for the hole
- `round_strategy_score`: weighted average of hole or shot decision scores

Suggested emphasis:

- approach and recovery decisions weighted more than tap-ins
- hazard decisions weighted more than routine neutral shots
- penalty-avoidance decisions weighted heavily

## Strategy Subscores

The final round analysis should also produce category subscores.

Suggested subscores:

- `target_selection`
- `club_selection`
- `lie_management`
- `hazard_management`
- `recovery_discipline`
- `miss_planning`
- `putting_read_discipline`

These subscores are important because they make the feedback teachable.

Example:

- `Stroke score: 91`
- `Course management score: 73`
- `Best area: recovery discipline`
- `Weakest area: hazard management`

## End-Of-Round Analysis Goals

The round summary should be short, useful, and actionable.

It should identify:

- what the player did well strategically
- what repeated mistake hurt them most
- whether the round problems came from process or execution
- what the next round should focus on

## Required End-Of-Round Output

At production quality, the round analysis should provide:

- `course_management_score`
- `decision_summary`
- `strength`
- `priority`
- `top_good_decisions`
- `top_costly_decisions`
- `pattern_summary`
- `next_round_focus`

## Example Round Summary

- `Stroke score: 92`
- `Course management score: 68`
- `Strength: sensible recovery choices after trouble`
- `Priority: safer targets from rough and around water`
- `Most costly pattern: attacking tucked targets without lie support`
- `Best habit: taking medicine instead of forcing low-percentage recoveries`

## Role Of The Standard Advice Library

`docs/STANDARD_ADVICE_LIBRARY.md` should act as the shared strategic wording
source for this system.

Its role:

- define standard advice for each lie and hazard situation
- supply stable advice keys for prompts and future structured scoring
- keep coaching language consistent across shots and rounds
- reduce random wording drift in AI analysis

The analysis system should compare:

- the player's actual choice
- the recommended strategic pattern
- the severity of the mismatch

## How AI Should Be Used

AI should explain the decision analysis, not invent it.

The engine should determine the structured evaluation first.
AI should then convert that structured evaluation into clear player-facing
language.

Preferred order:

1. Engine resolves authoritative shot facts.
2. Decision-scoring logic grades the strategic choice.
3. Advice keys are selected from the advice library.
4. AI produces concise explanation from structured inputs.

This prevents the model from making up golf logic that the engine did not
actually evaluate.

## Production Design Principle

Scoring logic should be deterministic.

Narration can be AI-assisted.

That means:

- the score should not depend on model mood or wording
- the reason codes should come from deterministic rules
- AI should explain the result, not decide the result

## Production Roadmap

### Phase 1: strategic design definition

Define:

- decision categories
- scoring weights
- label thresholds
- structured shot evaluation schema
- round summary schema

### Phase 2: deterministic shot evaluation

Implement rule-based decision grading using authoritative shot context:

- lie
- hazards
- target line
- carry requirement
- chosen club
- resulting plan and miss pattern

### Phase 3: round aggregation

Aggregate per-shot evaluations into:

- hole strategy scores
- round strategy score
- subscores
- repeat-pattern detection

### Phase 4: AI explanation layer

Use the advice library and structured scoring output to generate:

- shot feedback
- hole summaries
- end-of-round strategy analysis

### Phase 5: progression tracking

Track how the player's course-management score changes over time.

Useful future features:

- trend charts
- recurring mistake categories
- best improvement area over last 5 rounds
- player-type comparison by handicap profile

## What Production Success Looks Like

This system is successful when a player can say:

- `I understand why this round score happened.`
- `I know which decisions were smart and which were not.`
- `I can separate bad swings from bad strategy.`
- `I know what to do differently next round.`

That is the real training value of the game.

## Immediate Next Design Tasks

- validate the scoring thresholds through gameplay sessions
- expand the machine-readable advice catalog where new situations require it
- validate authoritative greenside scoring thresholds through gameplay sessions
- design multi-round progression tracking after Phase 2 integration is complete
