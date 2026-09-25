# Play Against the Game Master
## Codex Implementation Specification

**Project:** AI Golf Strategy Simulator  
**Feature:** Compete With the Game Master  
**Goal:** Let a human player compete against an AI-controlled golfer that uses the **same golfer profile and execution ability**, so the outcome primarily measures the value of better course-management decisions.

---

# 1. Product Intent

Add a competitive single-player mode where:

- The human selects a golfer profile such as `80+`, `90+`, `100+`, or a custom profile.
- The AI opponent receives an **exact clone of that same golfer profile**.
- Both competitors play the same course, tee, pin positions, course conditions, rules, and weather.
- The human chooses shots manually.
- The AI opponent chooses shots using the strategy engine.
- Both players use the same authoritative golf simulation engine.
- Both players receive the same execution probabilities but independent random rolls.
- The AI opponent must not receive better distance, accuracy, putting, bunker, recovery, or lie skills than the human.
- The AI opponent receives no built-in ability advantage; strategy and independent shot variance determine the match.
- The local Ollama LLM is used to explain decisions and coach the player. It must not control physics, scoring, shot outcome, or random results.

The feature should answer:

> With the same golf ability and independent execution rolls, can better course management produce a lower score over the match?

---

# 2. Naming

Use these internal names:

```text
Game Master
= narrator, referee, coach, and explainer

AI Strategist
= the virtual golfer competing against the human
```

UI label may say:

```text
Play Against the Game Master
```

Internally, keep the AI golfer separate from the narration layer.

Recommended enums:

```python
CompetitionMode.PLAY_VS_STRATEGIST
ParticipantType.HUMAN
ParticipantType.AI_STRATEGIST
```

---

# 3. Non-Negotiable Architecture Rules

## 3.1 Authoritative Engine

The deterministic game engine owns:

- ball position
- shot distance
- shot dispersion
- mishit outcome
- lie
- hazard collisions
- penalties
- putting result
- hole completion
- score
- random seed
- round state

The LLM must never override these values.

## 3.2 AI Strategy Layer

The AI Strategist owns only:

- candidate-shot generation
- club choice
- target choice
- swing power
- shot intent
- layup decision
- recovery choice
- putting strategy
- risk preference

## 3.3 LLM Layer

Ollama may:

- explain the Strategist's choice
- narrate verified results
- compare human and Strategist decisions
- coach the human
- summarize hole and round strategy

Ollama may not:

- invent a shot
- move a ball
- change a score
- apply a penalty
- decide if a ball is holed
- change a golfer profile
- see future random execution outcomes before the decisions are locked

---

# 4. Player Profile Cloning

When the mode starts, clone the selected human golfer profile.

```python
human_profile = load_player_profile(selected_profile_id)

strategist_profile = clone_profile(
    source=human_profile,
    owner_type="AI_STRATEGIST",
    locked=True,
)
```

The clone must preserve exactly:

- club distances
- carry means
- roll means
- distance standard deviation
- lateral dispersion
- directional bias
- dominant miss
- mishit probability
- lie modifiers
- rough ability
- bunker ability
- recovery ability
- wedge ability
- putting ability
- putting make rates
- putting pace variance
- putting read variance
- dexterity
- fatigue rules
- profile-specific preferred scoring distances

Persist:

```text
profile_clone_source_id
profile_clone_hash
profile_version
```

Before the round begins:

```python
assert human_profile.gameplay_hash == strategist_profile.gameplay_hash
```

---

# 5. Strategy Policies

Implement the first AI opponent with:

```text
StrategyPolicy.SMART_EXPECTED_SCORE
```

The Strategist should choose the action with the lowest expected scoring cost while respecting realistic candidate actions.

Future policies may include:

```text
MAX_DISTANCE
AGGRESSIVE
CONSERVATIVE
MATCH_PLAY
MIRROR_PLAYER
```

Do not hard-code the first policy into round logic.

---

# 6. Candidate Shot Generation

For every AI Strategist turn:

1. Read authoritative ball state.
2. Read player profile.
3. Read hole geometry.
4. Read hazards and obstruction geometry.
5. Read lie, slope, elevation, and wind.
6. Generate legal candidate shots.
7. Evaluate candidates.
8. Select the best candidate.
9. Lock the decision.
10. Only then run the actual shot simulation.

Candidate generation should include reasonable options such as:

```text
Driver to safe fairway zone
Driver toward maximum advance
3 wood to layup zone
Hybrid to fairway center
Iron to preferred wedge distance
Center-green approach
Safe-side green approach
Attack pin
Punch to fairway
Pitch sideways
Lay up short of water
Bunker escape
Lag putt
Aggressive putt
```

Never generate physically impossible or illegal actions.

---

# 7. Strategy Evaluation

Use the existing paired Monte Carlo / plan-evaluation system.

Recommended sample size per candidate:

```text
400 simulated outcomes
```

Each candidate should return:

```json
{
  "candidate_id": "cand_004",
  "club": "6_iron",
  "power_percent": 90,
  "target": "preferred_layup_zone",
  "expected_score": 4.87,
  "green_or_target_rate": 0.54,
  "fairway_rate": 0.71,
  "rough_rate": 0.19,
  "bunker_rate": 0.04,
  "penalty_rate": 0.02,
  "blocked_recovery_rate": 0.03,
  "double_bogey_plus_rate": 0.11,
  "median_remaining_distance_yards": 62,
  "p10_remaining_distance_yards": 47,
  "p90_remaining_distance_yards": 83
}
```

Primary selection metric:

```python
min(candidate.expected_score)
```

Tie-breakers:

1. lower double-bogey-plus probability
2. lower penalty probability
3. higher playable-lie probability
4. better preferred-distance alignment
5. lower dispersion exposure
6. lower execution complexity

---

# 8. Preferred Distance Logic

If a player profile includes:

```json
{
  "preferred_scoring_range_yards": [40, 80]
}
```

then a layup that reliably leaves 55–70 yards may be better than a shot that advances farther but finishes in difficult greenside rough or bunker.

Do not optimize for:

```text
minimum distance remaining
```

Optimize for:

```text
lowest expected score
```

---

# 9. Independent Execution Randomness

This is required for fairness.

For corresponding strokes, keep the paired turn identity but derive a separate
execution seed and sample for each participant:

```json
{
  "contact_quantile": 0.64,
  "distance_error_z": 0.31,
  "lateral_error_z": -0.72,
  "mishit_roll": 0.84,
  "putting_read_z": 0.14,
  "putting_pace_z": -0.22
}
```

Apply each participant's independent sample through the same authoritative shot
model. The ability model and shot conditions remain equal; the actual probability
roll does not.

Example:

```text
Human:
3 Wood, 100%

AI:
6 Iron, 90%

Both receive:
the same profile and conditions
different distance_error_z
different lateral_error_z
different contact quantile
```

The results can differ even when club, power, target, and lie match because each
competitor receives an independent execution roll.

Recommended seed hierarchy:

```python
round_seed
hole_seed
paired_stroke_seed
```

Example:

```python
paired_stroke_seed = hash(
    round_seed,
    hole_number,
    paired_stroke_index,
)

human_execution_seed = hash(paired_stroke_seed, "human")
strategist_execution_seed = hash(paired_stroke_seed, "ai_strategist")
```

Persist:

```text
paired_execution_sample_id
paired_seed
human_execution_seed
strategist_execution_seed
```

---

# 10. Decision Locking

Required order:

```text
Human decision entered
AI Strategist decision generated
Both decisions locked
Paired execution sample generated
Human shot simulated
AI shot simulated
Results revealed
```

Persist:

```text
decision_locked_at
decision_hash
simulation_started_at
```

The AI Strategist must never see unresolved execution outcomes.

---

# 11. Round State Model

```python
class CompetitionRound:
    id
    course_id
    tee_id
    mode
    round_seed
    human_participant_id
    strategist_participant_id
    status
    current_hole
    created_at
```

```python
class CompetitionParticipant:
    id
    round_id
    participant_type
    display_name
    profile_id
    strategy_policy
    total_score
    relative_to_par
    holes_completed
```

```python
class ParticipantHoleState:
    participant_id
    hole_id
    strokes
    penalties
    ball_state_id
    is_holed_out
```

---

# 12. Suggested Database Tables

```text
competition_rounds
competition_participants
participant_hole_states
participant_shots
strategist_decisions
strategy_candidate_evaluations
paired_execution_samples
competition_hole_summaries
competition_round_summaries
```

Suggested strategist decision record:

```text
id
round_id
hole_id
stroke_number
participant_id
strategy_policy
selected_candidate_id
club_id
power_percent
target_json
intent_json
expected_score
decision_score
reason_codes_json
decision_locked_at
created_at
```

---

# 13. API Design

## Create Competition Round

```http
POST /api/v1/competition-rounds
```

```json
{
  "mode": "play_vs_strategist",
  "course_id": "meadows_middlesex",
  "tee_id": "white",
  "player_profile_id": "profile_90_plus",
  "strategy_policy": "smart_expected_score",
  "coaching_enabled": true
}
```

Response:

```json
{
  "round_id": "cr_123",
  "human": {
    "participant_id": "p_human",
    "profile_id": "profile_90_plus"
  },
  "strategist": {
    "participant_id": "p_ai",
    "profile_id": "profile_90_plus_clone",
    "strategy_policy": "smart_expected_score"
  },
  "profile_match_verified": true
}
```

## Submit Human Decision

```http
POST /api/v1/competition-rounds/{round_id}/human-decision
```

## Generate Strategist Decision

```http
POST /api/v1/competition-rounds/{round_id}/strategist-decision
```

This endpoint:

- generates candidates
- runs candidate evaluation
- selects a decision
- persists the decision
- does not simulate the actual shot

## Resolve Paired Shots

```http
POST /api/v1/competition-rounds/{round_id}/resolve-paired-turn
```

This endpoint:

- verifies both decisions are locked
- derives paired execution sample
- simulates both shots
- persists both results
- returns authoritative states

## Hole Summary

```http
GET /api/v1/competition-rounds/{round_id}/holes/{hole_number}/summary
```

## Round Summary

```http
GET /api/v1/competition-rounds/{round_id}/summary
```

---

# 14. UI Requirements

Add a mode selection option:

```text
Play Against the Game Master
```

Setup screen:

```text
Course
Tee
Golfer Profile
AI Strategy Style
Coaching On/Off
```

For MVP:

```text
AI Strategy Style = Smart & Strategic
```

Show:

```text
The Game Master uses the same golfer profile as you.
It does not have better distance, accuracy, putting, or recovery skills.
Only the decisions are different.
```

---

# 15. In-Game UI

Recommended status display:

```text
YOU                         GAME MASTER
Score: +2                   Score: +1
Shot: 3                     Shot: 3
Lie: Fairway                Lie: Fairway
```

Map should support:

- human ball marker
- AI ball marker
- human shot path
- AI shot path
- optional target lines
- optional comparison mode

Suggested labels:

```text
YOU
GM
```

---

# 16. Decision Reveal

Before simulation, optionally show:

```text
Your choice:
3 Wood · 100%
Target: Green

Game Master's choice:
6 Iron · 90%
Target: 65-yard layup zone
```

Then:

```text
[Play Both Shots]
```

AI explanation must be based only on candidate evaluation data.

Example:

```text
I am laying up with 6-iron. The 3-wood can get closer, but its normal dispersion brings the front bunker and right penalty area into play. The 6-iron leaves about 60–70 yards, which is a strong scoring range for this profile.
```

---

# 17. Post-Shot Comparison

After both shots:

```text
YOU
3 Wood · 100%
Result: Greenside bunker
Remaining: 18 yd

GAME MASTER
6 Iron · 90%
Result: Fairway
Remaining: 64 yd
```

Then show:

```text
Decision comparison:
Game Master +0.32 expected strokes
```

Do not judge strategy using only actual outcome.

If the human made the better decision but got a bad result:

```text
Your decision was strategically stronger, but the simulated execution was poor.
The result does not make the original decision bad.
```

---

# 18. Hole Summary

Example:

```json
{
  "human_score": 6,
  "strategist_score": 5,
  "human_decision_score": 74,
  "strategist_decision_score": 91,
  "expected_strategy_difference": 0.68,
  "actual_score_difference": 1,
  "key_turn": 2
}
```

Narrative:

```text
The Game Master gained the advantage on the second shot.
You attacked the green with 3-wood, bringing the bunker into your normal miss zone.
The Game Master laid up to 64 yards and preserved a cleaner path to bogey or par.
```

---

# 19. Round Summary

Show:

```text
FINAL SCORE

You             89
Game Master     85
```

Strategy breakdown:

```text
Tee strategy             GM +0.4 strokes
Approach strategy        GM +1.3
Layup decisions          GM +1.6
Recovery decisions       GM +0.9
Putting strategy         You +0.2
```

Also show:

```text
Expected strategy advantage
Actual score advantage
Penalty strokes
Double bogey or worse
Bunker visits
Preferred-distance leaves
Hero-shot attempts
```

---

# 20. LLM Integration

Recommended interface:

```python
explanation = game_master_llm.explain_strategist_decision(
    situation=situation_packet,
    selected_candidate=selected_candidate,
    alternatives=top_alternatives,
)
```

Example input:

```json
{
  "player_profile": {
    "type": "90_plus",
    "preferred_scoring_range": [40, 80]
  },
  "situation": {
    "distance_to_pin": 187,
    "lie": "fairway_clean",
    "water_right": true,
    "front_bunker": true
  },
  "selected": {
    "club": "6_iron",
    "power": 90,
    "expected_score": 4.87,
    "median_leave": 62,
    "penalty_rate": 0.02,
    "bunker_rate": 0.04
  },
  "alternative": {
    "club": "3_wood",
    "power": 100,
    "expected_score": 5.21,
    "penalty_rate": 0.12,
    "bunker_rate": 0.19
  }
}
```

Expected structured output:

```json
{
  "headline": "Lay up to the scoring zone",
  "reason": "The 6-iron keeps the penalty area and bunker mostly outside the normal dispersion while leaving a strong wedge distance.",
  "concept": "preferred scoring distance",
  "confidence": "high"
}
```

---

# 21. AI Guardrails

The LLM must:

- never claim a profile advantage
- never invent probabilities
- never invent distances
- never invent hazards
- never see unresolved random outcomes
- never say the Strategist made the correct choice solely because the actual result was better
- explicitly separate decision quality from execution quality
- use concise golf terminology
- acknowledge when the human decision had lower expected score than the Strategist's

---

# 22. Fairness Validation

Before round start:

```python
validate_same_gameplay_profile(human, strategist)
```

Return:

```json
{
  "same_profile": true,
  "differences": []
}
```

If false:

```text
Block competition start.
```

---

# 23. Testing Requirements

## Unit Tests

Test:

- profile clone equality
- profile clone immutability
- candidate generation
- expected-score ranking
- preferred-distance handling
- paired seed reproducibility
- paired execution quantiles
- decision lock ordering
- LLM packet does not include future result
- score independence from LLM

## Fairness Test

If both choose:

```text
7 iron
same target
same power
same paired sample
```

the authoritative result should be identical.

If decisions differ, randomness remains paired but resulting distances and dispersions may differ.

## Golden Strategy Cases

1. Long approach with bunker guarding green.
2. Water reachable by driver but avoidable by hybrid.
3. Deep rough with hero-shot option.
4. Layup to preferred 40–80 yard range.
5. Ball above feet.
6. Ball below feet.
7. Downhill lie.
8. Uphill lie.
9. Long lag putt.
10. Short makeable putt.

---

# 24. Acceptance Criteria

- [ ] User can select `Play Against the Game Master`.
- [ ] User can select `80+`, `90+`, `100+`, or custom profile.
- [ ] AI Strategist receives an exact locked clone.
- [ ] Both participants use the same course and conditions.
- [ ] Human chooses shots manually.
- [ ] AI Strategist chooses shots from the strategy engine.
- [ ] AI decision is locked before execution is generated.
- [ ] Paired randomness is implemented and persisted.
- [ ] Both use the same simulation engine.
- [ ] Both ball positions appear on the map.
- [ ] Scoreboard tracks both independently.
- [ ] AI can explain its decision before the result.
- [ ] Post-shot feedback separates decision from execution.
- [ ] Hole summaries identify key strategic differences.
- [ ] Round summary explains strategy-derived stroke differences.
- [ ] LLM cannot modify game state.
- [ ] Same round seed reproduces authoritative outcomes.
- [ ] Existing single-player gameplay still works unchanged.

---

# 25. Suggested Implementation Order

```text
1. Competition domain models
2. Profile cloning and fairness validation
3. Multi-participant round state
4. AI Strategist policy interface
5. Candidate-shot generator
6. Candidate evaluator using existing 400-shot simulation
7. Decision locking
8. Paired randomness
9. Paired-turn resolution endpoint
10. Dual-player map rendering
11. Dual scorecard
12. Hole summary
13. Round summary
14. Ollama explanation layer
15. Regression tests
```

---

# 26. Strategy Policy Interface

```python
class StrategyPolicy(Protocol):
    def choose_action(
        self,
        game_state: GameState,
        player_profile: PlayerProfile,
        course_state: CourseState,
        candidate_actions: list[CandidateAction],
    ) -> StrategyDecision:
        ...
```

Initial:

```python
SmartExpectedScorePolicy
```

Future:

```python
MaxDistancePolicy
AggressivePolicy
ConservativePolicy
MatchPlayPolicy
MirrorHumanPolicy
```

---

# 27. UX Principle

The purpose is not:

```text
AI beats player
```

The purpose is:

```text
AI demonstrates the value of strategy using the same golfer ability.
```

Good:

```text
The Game Master gained 0.6 expected strokes by laying up to a preferred wedge distance.
```

Bad:

```text
The AI is better than you.
```

---

# 28. MVP Scope

Required:

```text
- Stroke play
- 1 human
- 1 AI Strategist
- same profile
- same course
- same conditions
- independent participant execution randomness
- Smart Expected Score policy
- dual map markers
- dual scoreboard
- hole comparison
- round comparison
- Ollama explanation
```

Not required:

```text
- human multiplayer
- match play
- skins
- tournaments
- multiple AI opponents
- live chat
- spectator mode
- adaptive personality
```

---

# 29. Final Codex Instruction

Implement this feature as a clean extension of the existing game.

Before changing code:

1. Inspect the existing repository structure.
2. Reuse the existing golfer-profile, shot-simulation, map, scorecard, plan-comparison, and 400-shot evaluator wherever possible.
3. Do not duplicate existing engine logic.
4. Preserve backward compatibility with current single-player mode.
5. Keep the LLM outside the authoritative game engine.
6. Add database migrations rather than destructive schema edits.
7. Add tests before considering the feature complete.
8. If an existing implementation already solves part of this specification, extend it instead of replacing it.

The core invariant is:

> **Same golfer profile + same execution probabilities + independent results.**

That invariant must remain testable and visible in the implementation.
