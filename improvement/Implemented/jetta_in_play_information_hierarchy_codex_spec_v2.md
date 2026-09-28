# Jetta In-Play Information Hierarchy
## Simplified Post-Shot and Next-Shot UI — Codex Implementation Specification

**Status:** V2 — approved design refinements incorporated  
**Applies to:** Regular simulated play and matches  
**Primary goal:** Keep the normal 18-hole play loop fast and golf-like by showing only information needed for the next decision, while preserving deeper analysis behind Details and in replay.

---

## 1. Problem

Jetta currently can show a post-shot block similar to:

```text
Result
Finished in rough after targeting fairway.

Decision
Competitive plan. The selected line carried about 20% modeled decision risk.

Outcome vs target
Finished 21 yd right and 16 yd long of the modeled carry point on the selected line.

Next shot
160 yards to the pin · 32 yards right of the pin line.
You have the ball above your feet, and the shot plays nearly level.
Expect about 4 yards of movement left; aim roughly 4 yards right.
```

Each statement may be useful, but displaying all of it after ordinary shots creates too much reading during normal play.

The problem is not lack of useful intelligence. The problem is **information hierarchy**.

---

## 2. Product Principle

During normal play, Jetta should answer:

```text
Where am I?
↓
How far is the next shot?
↓
What is important about this lie/situation?
↓
What adjustment or decision matters now?
```

Deeper analysis should answer:

```text
Was the previous decision good?
How did execution compare with the target?
What was the modeled risk?
What can I learn?
```

### Core rule

> **During play, prioritize the next decision. Preserve deeper analysis, but reveal it on demand.**

Do not remove Jetta's assessment intelligence. Change when and how prominently it is shown.

---

## 3. Desired Normal-Play Experience

For the example above:

```text
ROUGH • 160 YD

Ball above your feet
Expect ~4 yd left
Favor ~4 yd right

Competitive drive • 20% risk     [Details]
```

The player should be able to understand the next situation immediately.

---

## 4. Details View

Preserve deeper evidence behind **Details**:

```text
SHOT DETAILS

Result
Rough

Decision
Competitive plan
Modeled decision risk: 20%

Outcome vs Target
21 yd right
16 yd long

Target
Fairway carry point
```

Do not discard data simply because it is hidden from the primary play surface.

---

## 5. Three Information Tiers

### Tier 1 — Immediate Play Information

Always visible when relevant:

- current lie/surface;
- distance to pin or active strategic target;
- critical stance/lie condition;
- important elevation effect;
- important directional adjustment;
- hazard/recovery information that materially changes the next shot;
- specialized strategy cards where applicable.

### Tier 2 — Compact Previous-Shot Assessment

Use the player-facing label **Previous shot**, not `Result`, for this compact area. This makes the time relationship clear: the large primary card concerns the next decision, while this smaller line summarizes the shot that just happened.

Normally zero or one line:

```text
Preferred plan • 12% risk
Competitive drive • 20% risk
Costly result • Preferred decision
Tree recovery • Clean escape
```

Include `[Details]`.

### Tier 3 — Detailed Analysis / Replay Evidence

Hidden during normal play unless requested:

- exact lateral miss;
- exact long/short miss;
- modeled carry point;
- expected-stroke comparison;
- detailed probability distributions;
- alternative-plan comparison;
- canonical assessment evidence;
- target coordinates;
- evaluator/version/debug evidence.

---

## 6. Remove Redundant Narration

Do not narrate facts already obvious from the UI unless they matter to the next decision.

Instead of:

```text
Finished in rough after targeting fairway.
```

prefer:

```text
ROUGH • 160 YD
```

The intended fairway target remains available in Details/replay.

---

## 7. Prioritize Actionable Information

This is actionable:

```text
Ball above your feet
Expect ~4 yd left
Favor ~4 yd right
```

This may be useful evidence but usually does not deserve equal prominence:

```text
32 yards right of the pin line
```

The presentation layer must distinguish:

```text
FACT JETTA KNOWS
```

from:

```text
FACT PLAYER NEEDS RIGHT NOW
```

---

## 8. Routine vs Important Events

Do not use identical verbosity after every shot.

### Routine shot

```text
FAIRWAY • 142 YD

Slightly uphill
Plays ~146 yd
```

### Meaningful miss

```text
ROUGH • 160 YD

Ball above your feet
Expect ~4 yd left
Favor ~4 yd right

Competitive drive • 20% risk     [Details]
```

### Hazard / penalty

```text
WATER • 1 PENALTY STROKE

Drop position: 138 yd to pin

[Details]
```

### Tree recovery

Use the specialized tree-recovery choices instead of stacking generic prose.

### Greenside

Use the specialized greenside strategy choices when eligible.

---

## 9. Do Not Stack Coaching Systems

If a specialized decision UI is active, suppress redundant generic coaching.

Bad:

```text
Long tree explanation
+ canonical assessment
+ outcome-vs-target paragraph
+ next-shot paragraph
+ tree strategy cards
```

Better:

```text
EDGE OF TREES • 336 YD

Direct route has high tree-interference risk.

[Recovery strategy cards]
```

For tree and greenside situations, the primary briefing should be deliberately short. Do not also render the previous long briefing, target-miss report, and assessment stack above the cards.

Apply the same principle to greenside strategy cards.

---

## 10. Canonical Assessment Remains Authoritative

This is a presentation change, not a new assessment engine.

Continue calculating:

- Result Assessment;
- Decision Assessment;
- Outcome vs Target;
- Risk Assessment.

Architecture:

```text
Shot + evaluator evidence
        ↓
Canonical Assessment Layer
        ↓
Complete structured assessment
        ↓
In-Play Presentation Policy
        ↓
Tier 1 + optional Tier 2
        ↓
Details / Replay exposes Tier 3
```

---

## 11. Decision vs Result Remains Separate

A bad outcome does not automatically mean a bad decision.

Compact example:

```text
Costly result • Preferred decision     [Details]
```

Do not let one random result retroactively change the pre-shot decision grade.

---

## 12. Suggested Compact Vocabulary

Use existing canonical terms.

### Surface/state

`FAIRWAY`, `ROUGH`, `FRINGE`, `GREEN`, `BUNKER`, `TREES`, `WATER`, `OB`

### Decision

`Preferred plan`, `Competitive plan`, `Higher-risk plan`, `Decision not graded`

### Result

Only emphasize when meaningful:

`Good result`, `Mixed result`, `Costly result`, `Penalty`, `Clean escape`

Avoid adding labels simply because they exist internally.

---

## 13. Compact Next-Shot Card

Conceptual contract:

```json
{
  "surface": "ROUGH",
  "distance_to_pin_yards": 160,
  "primary_conditions": [
    {"type": "BALL_ABOVE_FEET", "label": "Ball above your feet"}
  ],
  "adjustments": [
    {
      "type": "EXPECTED_LATERAL_MOVEMENT",
      "value_yards": 4,
      "direction": "LEFT",
      "display": "Expect ~4 yd left"
    },
    {
      "type": "AIM_ADJUSTMENT",
      "value_yards": 4,
      "direction": "RIGHT",
      "display": "Favor ~4 yd right"
    }
  ]
}
```

Adapt to existing repository contracts rather than duplicating state.

---

## 14. Compact Previous-Shot Summary

Conceptual presentation:

```json
{
  "decision_label": "COMPETITIVE_PLAN",
  "decision_risk": 0.20,
  "details_available": true
}
```

Rendered:

```text
Competitive drive • 20% risk     [Details]
```

If the risk number is not useful or reliable for that shot, omit it.

---

## 15. Details Contract

Generate Details from existing persisted evidence.

Possible sections:

```text
RESULT
Surface / penalty / final position

DECISION
Canonical decision label
Modeled risk
Expected-stroke comparison
Alternative-plan comparison

OUTCOME VS TARGET
Lateral miss
Long/short miss
Target type

SHOT
Club
Power
Carry
Roll
Lie modifiers
```

Only show evidence that actually exists.

---

## 16. Progressive Disclosure

Default:

```text
minimum useful information
```

Player selects:

```text
Details
```

to reveal deeper evidence.

This creates two different rhythms:

### Play Mode

Fast, actionable, low reading burden.

### Review Mode

Analytical, educational, detailed.

Both use the same underlying evidence.

---

## 17. Avoid Repetitive Generated Prose

Instead of repeatedly generating:

```text
You have the ball above your feet, and the shot plays nearly level.
Expect about 4 yards of movement left; aim roughly 4 yards right.
```

prefer structured concise rendering:

```text
Ball above your feet
Expect ~4 yd left
Favor ~4 yd right
```

Use generated prose only when it adds meaning structured labels cannot communicate clearly.

---

## 18. Rank Special Conditions

Show only the most important 1–3 conditions.

Examples:

- ball above/below feet;
- uphill/downhill lie;
- deep rough;
- restricted swing;
- tree interference;
- uphill/downhill shot;
- strong side slope;
- carry hazard;
- short-sided;
- downhill green.

Do not dump every detected condition.

Rank conditions by their expected effect on the next decision.

---

## 19. Numeric Precision

Normal play does not need excessive precision.

Prefer:

```text
~4 yd left
160 yd
20% risk
```

Keep exact values in persisted evidence/replay.

Round only presentation values.

---

## 20. Mobile Priority

The default next-shot view should fit comfortably without forcing the player to scroll through analysis before reaching the next action.

On mobile, place the **compact next-shot card before the carousel's caddie history and detailed feedback**. The golfer should encounter the next action before historical commentary.

Priority:

```text
Surface + distance
↓
1–3 critical conditions/adjustments
↓
strategy controls/cards
↓
compact previous-shot summary + Details
```

---

## 21. Game Master Comparison

Detailed Player-vs-GM comparison should not dominate the normal screen after routine shots.

Prefer:

```text
Your plan preferred • +0.16 expected strokes     [Compare]
```

The full comparison remains under **Compare**.

This preserves learning value without interrupting play.

---

## 22. Important Event Escalation

Event escalation must be intentionally rare.

### V1 escalation set

Use event treatment only for:

- penalty events, including water/OB where applicable;
- major tree contact or a materially significant recovery event;
- hole completion;
- meaningful match-state/lead changes.

Do **not** force an event banner for an ordinary `Good result`, routine fairway hit, normal green hit, or ordinary close shot merely because the canonical assessment has a positive label.

Example of a legitimate escalation:

```text
PENALTY
Water • 1 stroke
```

or, when the recovery is genuinely significant:

```text
RECOVERY
Back in play • 69 yd remaining
```

The goal is to preserve the attention value of event treatment. Do not solve text overload by creating banner overload.

---

## 23. Persistence

Continue persisting full evidence required for:

- canonical assessment;
- replay;
- Details;
- GM comparison;
- deterministic reproduction;
- future analysis.

The simplified UI is a **presentation change**, not a data-loss optimization.

---

## 24. Implementation Architecture

Prefer a centralized presentation/orchestration layer.

`InPlayPresentationPolicy` must be a **pure, testable presentation module**.

It may:

- consume current ball state;
- consume persisted shot/canonical-assessment evidence;
- consume specialized decision-UI state;
- decide what belongs in Tier 1, Tier 2, Tier 3, or event escalation;
- return display-ready structured data.

It must **not**:

- recalculate decision quality;
- recalculate canonical result assessment;
- rerun risk evaluation;
- rerun simulation;
- mutate ball/round/match state;
- persist new gameplay facts;
- call the LLM to determine factual display content.

Given identical inputs, it should return identical presentation output.

Prefer a centralized presentation/orchestration layer:

```text
Simulation Result
        +
Canonical Assessment
        +
Current Ball State
        +
Strategy/Recovery State
        ↓
InPlayPresentationPolicy
        ↓
{
  primaryNextShot,
  compactPreviousShot,
  importantEvent,
  detailsAvailable,
  specializedDecisionUI
}
```

The policy decides:

- Tier 1;
- whether Tier 2 is useful;
- event escalation;
- whether generic coaching is suppressed by specialized strategy UI;
- what belongs only in Details.

Avoid scattering visibility rules across many UI components.

---

## 25. Existing Game Master Panel as Integration Point

For V1, do **not** create another major in-play panel.

Use the existing Game Master feedback container as the initial integration point and replace its normal four equal-weight sections:

```text
Result
Decision
Outcome vs Target
Next Shot
```

with:

```text
NEXT SHOT
[compact next-shot card]

Previous shot
[optional one-line assessment]   [Details]
```

When a specialized tree-recovery or greenside strategy component is active, it occupies the decision area inside this same flow rather than creating another stacked analysis panel.

This keeps the implementation incremental and reduces UI duplication.

---

## 26. Details vs More Caddie Detail

These controls have different responsibilities and must remain separate.

### Details

`Details` exposes **deterministic stored game evidence**.

It must work even if AI/LLM commentary is unavailable.

Examples:

- previous-shot surface/result;
- canonical decision label;
- modeled risk;
- expected-stroke comparison;
- outcome vs target;
- exact miss;
- club/power/carry/roll evidence;
- saved alternative-plan evidence where available.

### More Caddie Detail

`More caddie detail` is optional explanatory/AI commentary.

It may:

- explain structured evidence;
- translate numbers into golfer-friendly language;
- provide additional coaching context.

It must not be required to retrieve factual shot evidence and must not become the source of truth for assessment.

Conceptually:

```text
Details
→ deterministic stored evidence
→ always available when evidence exists

More caddie detail
→ optional AI explanation
→ may be unavailable
```

---

## 27. Example Output

```json
{
  "primary": {
    "surface": "ROUGH",
    "distance_yards": 160,
    "conditions": ["Ball above your feet"],
    "adjustments": [
      "Expect ~4 yd left",
      "Favor ~4 yd right"
    ]
  },
  "previous_shot": {
    "summary": "Competitive drive",
    "risk": 0.20,
    "details_available": true
  },
  "specialized_decision_ui": null,
  "event": null
}
```

Rendered:

```text
ROUGH • 160 YD

Ball above your feet
Expect ~4 yd left
Favor ~4 yd right

Competitive drive • 20% risk     [Details]
```

---

## 28. Implementation Sequence

### Phase 1 — Repository Trace

Locate:

- Result/Decision/Outcome-vs-Target rendering;
- next-shot advice generation;
- Canonical Assessment Layer;
- GM comparison UI;
- tree-recovery UI;
- greenside strategy UI;
- replay/details UI;
- mobile layout;
- persisted shot evidence.

Do not rewrite the assessment system.

### Phase 2 — Pure Presentation Policy

Create `InPlayPresentationPolicy` as a pure, testable module. Classify existing evidence into Tier 1/2/3 without recalculating assessment or mutating game state.

### Phase 3 — Existing Game Master Container Integration

Use the existing Game Master feedback container. Replace the four default equal-weight sections with the compact next-shot card, optional `Previous shot` summary, and Details control.

Implement surface, distance, important conditions, and actionable adjustments.

### Phase 4 — Compact Previous-Shot Summary

Reduce normal assessment to a one-line optional summary plus Details.

### Phase 5 — Deterministic Details

Move deeper Result/Decision/Outcome-vs-Target evidence into an on-demand `Details` view backed only by stored deterministic game evidence. Keep `More caddie detail` as a separate optional AI commentary path.

### Phase 6 — Specialized Decision Integration

Ensure tree recovery and greenside strategy cards suppress redundant generic coaching.

### Phase 7 — GM Comparison

Collapse routine comparison into a compact Compare entry point.

### Phase 8 — V1 Event Escalation

Add only the V1 escalation set: penalties, major tree contact/material recovery, hole completion, and meaningful match changes. Do not add routine `Good result` banners.

### Phase 9 — Mobile / Full-Round Validation

Play full rounds and measure:

- lines shown per routine shot;
- scroll burden;
- time to next interaction;
- Details usage;
- repetitive wording;
- whether critical information is hidden.

---

## 29. Tests and Guardrails

Verify:

1. Routine shots no longer show full Result + Decision + Outcome vs Target + Next Shot blocks by default.
2. Current surface and next-shot distance remain immediately visible.
3. Critical lie/stance adjustments remain visible.
4. Exact target miss remains available in Details.
5. Decision assessment remains available.
6. Decision and result remain separate.
7. Canonical assessment is not recalculated differently by the presentation layer.
8. Replay retains full evidence.
9. Tree-recovery cards suppress redundant generic tree prose.
10. Greenside strategy cards suppress redundant generic greenside prose.
11. Hazard/penalty events receive appropriate prominence.
12. Routine fairway/rough shots stay concise.
13. Mobile users can reach the next action without scrolling through a report.
14. Missing evidence is omitted rather than invented.
15. Display rounding does not alter stored evidence.
16. GM comparison remains accessible.
17. Event escalation does not trigger on every shot.
18. Existing scoring/simulation behavior is unchanged.
19. Details can reconstruct deeper assessment from persisted evidence.
20. Full-round testing confirms concise wording does not hide material strategy information.
21. `InPlayPresentationPolicy` is deterministic for identical inputs.
22. `InPlayPresentationPolicy` does not mutate game state or rerun assessment/simulation.
23. V1 reuses the existing Game Master feedback container rather than creating another major panel.
24. The compact assessment area is labeled `Previous shot`.
25. `Details` works from stored deterministic evidence when AI/LLM commentary is unavailable.
26. `More caddie detail` remains separate from deterministic Details.
27. Tree/greenside specialized cards receive a short primary briefing and do not stack with the old long briefing.
28. Ordinary `Good result` shots do not trigger event banners.
29. Mobile places the next-shot card before caddie-history/detailed-feedback content.
30. Penalty, major tree contact/material recovery, hole completion, and meaningful match changes are the only V1 event-escalation categories unless an existing equivalent is explicitly mapped.

---

## 30. Acceptance Criteria

V1 is complete when:

- normal play emphasizes the **next shot**, not the previous-shot report;
- routine post-shot information is compact;
- surface, distance, and critical adjustments are immediately visible;
- previous-shot assessment is normally one compact line or omitted;
- full Result/Decision/Outcome-vs-Target evidence remains in Details/replay;
- tree/greenside decision UIs do not stack beneath long generic coaching;
- GM comparison remains available without dominating routine play;
- canonical assessment remains authoritative;
- no assessment/replay evidence is lost;
- regular 18-hole gameplay feels materially faster and less text-heavy;
- the presentation policy is pure and does not alter gameplay truth;
- the existing Game Master feedback container is reused for V1;
- deterministic Details remains available independently of AI commentary;
- mobile shows the next-shot card before caddie history/detailed feedback;
- routine positive results do not create banner noise.

---

## 31. Non-Goals

Do not:

- remove the Canonical Assessment Layer;
- remove replay analysis;
- remove Decision vs Result;
- redesign shot physics;
- redesign tree-recovery probabilities;
- redesign greenside strategy generation;
- change Golf Academy;
- hide penalties or important gameplay consequences;
- create a second independent analysis system in Details;
- create a new major in-play panel when the existing Game Master feedback container can host the simplified experience;
- make AI commentary necessary to access factual shot evidence.

---

## 32. Product Direction

Jetta has accumulated useful golf intelligence.

The next UX improvement is not to calculate less.

It is to **show less at the moment of play and reveal more when the golfer asks for it**.

Normal 18-hole rhythm:

```text
SHOT
↓
brief result
↓
understand next situation
↓
make next decision
↓
PLAY
```

not:

```text
SHOT
↓
read report
↓
read assessment
↓
read target analysis
↓
read coaching paragraph
↓
finally make next decision
```

A useful rule for future UI decisions:

> **If information does not materially help the golfer make the next decision, it probably belongs in Details or Replay rather than the primary play surface.**
