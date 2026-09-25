# Jetta Golf Academy — Revised Specification

**Status:** Pre-implementation  
**Mode:** Separate Jetta game mode; do not restructure 3-Hole Challenge  
**Sessions:** 3, 9, or 18 holes

## 1. Vision

> **Learn golf strategy by making decisions, not by reading lessons.**

Academy removes repetitive simulator operation. Instead of repeatedly choosing club, power, and target, the golfer chooses a meaningful golf plan. Jetta converts that plan into existing simulator commands.

```text
Situation → Meaningful choices → Player choice
→ Jetta configures shot → Existing simulation
→ Result + short learning feedback → Next shot
```

This is a medium-to-large feature, not merely a new UI. Academy needs its own orchestration, session state, strategy grouping, routine-shot detection, specialized short-game/putting adapters, and learning flow.

## 2. Reuse Existing Jetta

Reuse existing repository capabilities wherever available:

- attack, safe, layup, center-green, safe-miss, recovery plans
- multi-run green/bunker/water/penalty/playable-lie/typical-leave evaluation
- deterministic execution identities
- GM decision locking
- canonical Decision vs Result separation
- course geometry and player profiles
- club distance/dispersion and lie handling
- simulation and putting engines
- replay/evidence infrastructure
- landing/rollout, fringe, and Simulated Green Contours

**Do not create a second physics, putting, or risk engine.**

```text
Existing Course/Player/Strategy/Evaluator/Simulation Systems
                         ↓
                 Academy Orchestrator
                         ↓
        ┌────────────────┼────────────────┐
   Full-Shot         Short-Game        Putting
    Adapter            Adapter          Adapter
        └────────────────┼────────────────┘
                         ↓
                 Academy Choice UI
```

## 3. Two Decision Experiences

### Off green
Question:

> **How do you want to play this situation?**

Examples: attack vs layup, driver vs position, pin vs center, safe miss, recovery route, preferred-distance layup, chip/pitch/bump-and-run.

### On green
Question:

> **How do you want to roll this putt?**

Putting concerns line, pace, break, make opportunity, leave distance, and comeback exposure. It needs a specialized adapter and presentation rather than blindly reusing off-green strategy labels.

## 4. Full-Shot Example

```text
PAR 5 — SECOND SHOT
205 yd to pin
Fairway • Slight uphill
Water right • Bunker front
Preferred wedge range: ~65 yd

A — ATTACK THE GREEN
    5W → Green
    Chance to reach now
    More bunker/water exposure

B — PLAY TO YOUR WEDGE
    7I → ~65 yd remaining
    Sets up preferred wedge distance
    Lower immediate hazard exposure

C — STAY SHORT OF TROUBLE
    9I → ~90 yd remaining
    Keeps major trouble largely out of play
```

The player chooses the strategy. The option already contains simulator-ready club, power, and target.

## 5. Choices Must Be Genuine

Do not create a disguised quiz with one correct answer and two bad ones. Do not label choices **Best**, **Correct**, or **Wrong** before commitment.

Options should represent genuine tradeoffs:

- **Attack:** more opportunity, more exposure.
- **Position:** improve next-shot situation.
- **Conservative:** reduce immediate exposure, accept another cost.

Normally present 1–3 choices, never force three.

## 6. Routine-Shot Detection

Not every shot deserves a decision:

```text
92 yd • Fairway • Middle pin • No material trouble

STRAIGHTFORWARD SHOT
SW → Center Green

[ PLAY ]
```

An additional option should exist only when it differs materially in at least one area:

- expected strokes/scoring value, if available
- penalty/water/bunker probability
- green/target probability
- playable-lie probability
- median/typical leave
- recovery difficulty
- club or shot type
- target/intended miss
- carry requirement
- next-shot setup

Use a **versioned Academy decision policy** with configurable thresholds. Do not scatter arbitrary thresholds through UI code. Calibrate thresholds using real evaluator data during the vertical slice.

Core rule:

> **An option exists because it creates a materially different golf decision, not because the UI expects three cards.**

## 7. Strategy Presentation Adapter

Existing systems may generate multiple plans but reduce player-facing output to Aggressive and Safe & Smart. Academy needs a presentation adapter that can retain 1–3 genuinely different plans.

It should:

1. consume existing candidate/evaluator evidence;
2. remove redundant candidates;
3. group similar candidates into golfer-friendly plans;
4. retain materially different plans;
5. create concise factual titles/tradeoffs;
6. attach existing simulator-ready parameters;
7. classify the situation as ROUTINE or DECISION.

It must not invent probabilities or change physics.

## 8. Player-Specific Learning

Choices must use the golfer's actual Jetta profile. The same ball position can therefore generate different options for different players.

> **Given this golfer's abilities and this hole, where should the golfer try to put the ball next?**

## 9. Strategy Categories

**Tee:** Driver/challenge trouble; safer fairway club; positional club.

**Approach:** attack pin; center green; favor safe side.

**Par 5:** go for green; preferred-distance layup; stay short of major trouble.

**Recovery:** advance through opening; return to fairway; sideways safety recovery.

**Short game:** use a specialized adapter with existing landing-target/trajectory/rollout systems, e.g. SW fly, PW pitch-and-release, 8I bump-and-run.

---

# Putting Academy

## 10. Putting Is Different

Putting must be first-class. Do not ask the Academy player to repeatedly drag an aim point and operate a power slider.

```text
Ball + Cup + Green Terrain
          ↓
 Existing Putting Engine
          ↓
 Structured Putting Evidence
          ↓
 Academy Putting Adapter
          ↓
 1–3 Meaningful Choices
          ↓
 Player Choice
          ↓
 Existing Putting Simulation
```

The putting adapter should consume available structured evidence such as distance, elevation, uphill/downhill, break direction/severity, longitudinal/cross slope, ridge/tier transitions, green-speed assumptions, expected line/pace, make probability, expected leave, comeback exposure, Simulated Green Contours, and player putting profile.

The LLM must not guess the break or invent putting physics.

## 11. Putting Examples

### Meaningful medium putt

```text
18 FT FOR BIRDIE
Downhill • Breaking Right

A — GIVE IT A CHANCE
    Firmer pace • Less break
    More comeback exposure if missed

B — BALANCED
    Normal pace • Normal break
    Balance make opportunity and leave

C — PROTECT THE TWO-PUTT
    Softer/die pace • More break
    Prioritize finishing near the hole
```

These are examples, not fixed choices. Actual options must come from model evidence.

### Long putt

```text
35 FT FOR BIRDIE

A — GIVE IT A CHANCE
    Enough pace to reach/pass hole
    Greater leave-distance exposure

B — LAG TO THE HOLE
    Prioritize distance control
    Protect the two-putt
```

### Routine short putt

```text
3 FT FOR PAR
Slight left-to-right

STRAIGHTFORWARD PUTT

[ PUTT ]
```

### Difficult short putt

```text
5 FT FOR PAR
Downhill • Significant right break

A — FIRMER
    Less break
    Greater comeback exposure

B — CONTROLLED
    More break
    Lower finishing speed
```

## 12. Putting Meaningfulness

Do **not** show Aggressive/Normal/Die on every green. That becomes repetitive and may make Normal a disguised answer.

Multiple putting choices should appear only when consequences differ materially, considering:

- make-probability difference
- expected leave difference
- probability of a difficult comeback
- three-putt exposure
- severe downhill consequence
- break/pace sensitivity
- ridge/tier transition
- other evidence already supported by the putting model

Use the same versioned Academy decision-policy concept for putting thresholds.

## 13. Putting Visual Learning

After commitment, Academy may reveal the calculated line:

```text
● Ball
      ·
    ·
     ·
      ○ Cup

Selected plan: Balanced
Calculated aim: 7 in right
Pace: Normal
```

This teaches line/pace/break relationships without making the golfer manually configure them.

## 14. Putting Decision vs Result

Preserve pre-putt evidence separately:

```text
YOUR PLAN
Balanced

PRE-PUTT MODEL
Make probability: 18%
Typical leave: 1.9 ft
Long-comeback exposure: 6%

ACTUAL RESULT
Missed left
Finished 2 ft 4 in away
```

A missed putt does not prove the plan was poor. A risky putt that happens to drop does not prove the decision was superior.

---

# Game Master

## 15. GM Is a Teaching Comparison, Not a Persistent Opponent

Academy GM must be different from 3-Hole Challenge head-to-head play.

Required behavior:

1. Player and GM independently select from the **same pre-shot options**.
2. GM choice stays hidden until player commitment.
3. Reveal GM choice after commitment.
4. **Only the player's selected shot advances the Academy ball.**
5. Compare the pre-shot distributions of both plans.
6. Do not maintain a second persistent GM ball.

An optional GM simulation may demonstrate a counterfactual result, but label it clearly as an **example simulated outcome for the GM plan**. It must not affect player score, ball position, next-shot state, or round progression.

---

# UI

## 16. Keep the Four Logical States Fast

Logical states:

1. Situation / Choice
2. Commit / GM Reveal
3. Result
4. Learning

Do not turn these into four separate confirmation screens.

Preferred interaction:

```text
Situation + cards
      ↓
Select + Commit
      ↓
Brief GM reveal inline
      ↓
Shot/putt automatically plays
      ↓
Result + one-sentence lesson together
      ↓
[ NEXT SHOT ]
```

Detailed data stays behind **Compare Plans**, **Why?**, or **Coach Explanation**.

This is critical for 18-hole play.

---

# Evidence Contracts

## 17. Probability Units

Use **0.0–1.0 normalized probabilities internally**:

```json
{
  "penalty_probability": 0.03,
  "bunker_probability": 0.05,
  "green_probability": 0.38
}
```

UI displays `3%`, `5%`, `38%`.

Do not mix normalized probabilities and percentage integers in persisted Academy contracts.

## 18. Evidence Provenance

Each evaluated decision should preserve, using repository-native identifiers where available:

- sample count
- analysis seed
- simulator version
- evaluator version
- strategy-generator version
- Academy decision-policy version
- course geometry version
- player-profile hash/version
- putting-engine/green-terrain version when relevant

Conceptually:

```json
{
  "analysis_seed": 182731,
  "sample_count": 400,
  "simulator_version": "...",
  "evaluator_version": "...",
  "strategy_generator_version": "...",
  "academy_policy_version": "academy-decision-v1",
  "course_geometry_version": "...",
  "player_profile_hash": "..."
}
```

## 19. Strategy Contract

Conceptual full-shot option:

```json
{
  "strategy_id": "layup_preferred_wedge",
  "title": "Play to Your Wedge",
  "category": "LAYUP",
  "club_id": "7I",
  "target": "...existing target representation...",
  "power": "...existing simulator representation...",
  "expected_leave_yards": 65,
  "evaluation": {
    "penalty_probability": 0.03,
    "bunker_probability": 0.05,
    "green_probability": 0.00
  },
  "evidence": {
    "sample_count": 400,
    "analysis_seed": 182731,
    "simulator_version": "...",
    "evaluator_version": "...",
    "strategy_generator_version": "...",
    "course_geometry_version": "...",
    "player_profile_hash": "..."
  }
}
```

Preserve repository conventions for power/target commands rather than inventing a second command format.

Conceptual putting option:

```json
{
  "strategy_id": "putt_balanced",
  "title": "Balanced",
  "category": "PUTTING_PACE_LINE",
  "putt": {
    "starting_line": "...existing representation...",
    "pace": "...existing representation..."
  },
  "evaluation": {
    "make_probability": 0.18,
    "typical_leave_feet": 1.9,
    "long_comeback_probability": 0.06
  },
  "evidence": {
    "sample_count": 400,
    "analysis_seed": 182731,
    "putting_engine_version": "...",
    "academy_policy_version": "academy-decision-v1",
    "green_terrain_version": "...",
    "player_profile_hash": "..."
  }
}
```

---

# Sessions and Persistence

## 20. Session Rules

Before starting:

1. select published/playable course;
2. select available tee;
3. load player profile;
4. select session length.

### 18 holes
Full published 18-hole sequence.

### 9 holes
Front 9 or Back 9 where valid.

### 3 holes
For v1, player selects a starting hole and plays three consecutive holes. Curated/nonconsecutive Academy lessons can be a future format.

### Resume
Persist at a safe existing transaction boundary, preferably after each completed shot/putt.

Resume must restore course/version, tee, hole, ball/stroke state, score, selected strategies/evidence, and relevant version references.

Do not duplicate large course geometry inside every shot.

### Academy history
Record:

- course/version and tee
- session length and holes
- score
- shot/putt sequence
- strategies offered
- player choice
- GM choice when enabled
- evidence/version references
- canonical assessment/result
- concise lesson
- normal session metadata/timestamps

---

# Learning Model

## 21. Decision, Result, and Outcome vs Target

These remain separate.

**Decision:** evaluate using evidence available before execution.

**Result:** what actually happened.

**Outcome vs Target:** where the ball finished relative to intended plan without unsupported swing diagnosis.

Never teach:

> "Your strategy was better because this random shot happened to finish better."

Use the existing canonical assessment layer where possible.

## 22. LLM Boundary

The LLM may explain structured facts, rename plans in golfer-friendly language, explain GM reasoning, or provide optional coaching.

It must not invent probabilities, hazards, terrain, green reads, physics, assessments, or outcomes.

---

# Implementation Plan

## 23. Recommended Order

### Phase 1 — One Real Par-5 Vertical Slice
Use a real published Par 5, real player profile, real geometry, real strategy/evaluator data, and real simulator. Generate 1–3 actual options, choose one, execute, and show result/lesson.

**Goal:** prove that real generator output—not mocked UI—creates interesting decisions.

### Phase 2 — Routine/Meaningful Detection
Build and calibrate the versioned decision policy from real evaluator output.

### Phase 3 — Full-Shot Adapters
Add tee, approach, recovery, layup, center-green, and safe-miss presentation.

### Phase 4 — Short-Game Adapter
Integrate existing landing-target, trajectory, rollout, lie, fringe, and green systems.

### Phase 5 — Putting Academy
Build specialized routine/meaningful detection, 1–3 line/pace plans, automatic configuration, existing putting execution, post-commit line visualization, and Decision-vs-Result learning.

### Phase 6 — Complete Fast UI
Build shared Academy shell and streamlined tee-to-green/putting flow.

### Phase 7 — GM Teaching Comparison
Same option set, independent hidden choice, post-commit reveal, distribution comparison, no persistent GM ball.

### Phase 8 — Sessions/Persistence
Add 3-hole consecutive sessions, Front/Back 9, full 18, resume, history/replay.

### Phase 9 — Polish
Only after silent gameplay is enjoyable: animation, audio, coach commentary, progression, achievements, specialized lessons.

---

# Acceptance Criteria

## 24. Core

1. Academy is a separate mode.
2. 3-Hole Challenge and detailed simulation remain unchanged.
3. Existing physics/evaluator systems remain authoritative.
4. Player normally chooses strategy rather than manually configuring club/power/target.
5. Choices derive from actual course/player evidence.
6. Routine shots do not force fake choices.
7. Strategic shots normally show no more than three materially different plans.
8. Meaningfulness uses a versioned/calibratable policy.
9. Persisted probabilities use normalized 0–1 values.
10. Decision evidence preserves seed/sample/version provenance.
11. Only the player's Academy ball persists.
12. GM stays hidden until commitment and does not become a second head-to-head round.
13. Decision quality and actual result remain separate.
14. 3/9/18 session and resume rules are explicit.
15. Result and concise lesson can be consumed without excessive confirmation screens.

## 25. Putting

1. On-green play uses a specialized Putting Academy adapter.
2. It does not blindly reuse off-green strategy semantics.
3. Jetta normally configures putting line/pace after strategy selection.
4. Routine putts can use one simple **Putt** action.
5. Multiple plans appear only when consequences are materially different.
6. Plans derive from existing putting/terrain calculations.
7. Simulated Green Contours remain identified as simulated terrain where applicable.
8. Selected line may be visualized after commitment.
9. Pre-putt decision evidence remains separate from actual result.
10. A made putt does not automatically make a higher-risk decision superior.
11. LLM cannot invent green reads, line, pace, or probabilities.
12. Existing putting physics remain authoritative.

---

# Non-Goals

Academy v1 must not:

- replace or modify 3-Hole Challenge
- replace detailed simulation
- redesign shot or putting physics
- create another risk engine
- create a persistent GM opponent ball
- manufacture choices on every shot or putt
- turn every situation into a three-answer quiz
- expose a supposedly correct answer before commitment
- require repetitive manual club/power/target controls
- require repetitive manual putting aim/power controls
- guarantee safer strategies produce better random outcomes
- rely on LLM calculations for golf physics
- require provider/API calls during published play merely for Academy

---

# Future Academy Modules

Potential modules include Course Management Fundamentals, Break 100/90/80, Tee Strategy, Approach Strategy, Par 5 Decisions, Hazard Management, Preferred-Distance Layups, Recovery Strategy, Short Game, Putting Strategy, Risk vs Reward, Daily Strategy Challenge, and Academy Missions.

These should reuse the same Academy evidence/strategy/simulation infrastructure.

---

# Product Identity

Detailed Jetta simulation asks:

> **How do you want to hit this shot?**

Academy off the green asks:

> **How do you want to play this situation?**

Academy on the green asks:

> **How do you want to roll this putt?**

The common philosophy:

> **Jetta handles repetitive mechanics. The golfer makes the meaningful decision.**

Final design test:

> **Does this help the golfer make and understand a meaningful golf decision without adding unnecessary work?**

If it only adds another control the golfer must operate again and again, it probably does not belong in Jetta Golf Academy.
