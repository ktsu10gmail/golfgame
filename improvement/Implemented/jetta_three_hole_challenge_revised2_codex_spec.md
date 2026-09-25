# Jetta Golf — 3-Hole Challenge + Game Master + Dynamic Audio/Announcer

## Purpose

Create a fast, replayable entertainment-focused game mode for Jetta Golf that turns the existing golf simulation and strategy systems into a short competitive experience.

The mode should automatically build a 3-hole mini-match consisting of:

- exactly one Par 3
- exactly one Par 4
- exactly one Par 5
- preferably selected from different published courses
- Player vs Game Master
- dynamic background music
- golf sound effects
- crowd reactions
- situational announcer commentary
- post-match strategy recap
- near-instant Play Again flow

The objective is to make the game feel lively, joyful, competitive, and replayable without requiring a full 18-hole commitment.

---

## Core Product Principle

Do not build this as a separate golf physics system.

Reuse the existing Jetta systems:

- player profile
- shot simulation
- course geometry
- strategy evaluator
- Safe & Smart / Aggressive logic
- Game Master decision engine
- canonical assessment layer
- target semantics
- putting engine
- replay evidence

This feature is mainly a new **game loop, presentation layer, and audio event system** over the existing simulation.

The core loop should feel like:

```text
CHALLENGE CREATED
      ↓
PLAYER VS GAME MASTER
      ↓
MAKE DECISION
      ↓
SHOT ANTICIPATION
      ↓
SHOT RESULT
      ↓
AUDIO / ANNOUNCER REACTION
      ↓
MATCH STATE CHANGES
      ↓
NEXT SHOT / NEXT HOLE
      ↓
WINNER + STRATEGY RECAP
      ↓
PLAY AGAIN
```

---

# 1. New Game Mode: 3-Hole Challenge

Add a primary game mode:

```text
3-HOLE CHALLENGE
Player vs Game Master
~5–10 minutes
```

Suggested home/menu placement:

```text
JETTA GOLF

⚡ 3-HOLE CHALLENGE
   Player vs Game Master
   ~5–10 minutes

🏌️ PLAY 18
   Full simulation round

🎯 PRACTICE
   Strategy & short game

📍 GPS ROUND
   On-course mode

🎬 REPLAY
   Review previous rounds
```

The 3-Hole Challenge should be the fastest way to start playing.

---

# 2. Challenge Generator

## Required hole composition

Every generated challenge must contain:

```text
1 × Par 3
1 × Par 4
1 × Par 5
```

Prefer three different courses when enough published courses are available.

Example:

```text
3-HOLE CHALLENGE

Hole 1 — Par 3 — Green Knoll #7
Hole 2 — Par 4 — Warrenbrook #14
Hole 3 — Par 5 — Galloping Hill #18
```

## Eligibility

Only use holes that are:

- published
- validated
- playable by the current engine
- compatible with the selected player profile
- available locally from Jetta data

Do not call external course providers during Play Mode.

## Selection rules

Avoid:

- duplicate holes in one challenge
- the same hole appearing repeatedly across immediate Play Again sessions when enough alternatives exist
- broken/unvalidated geometry
- holes requiring unsupported gameplay features

Prefer strategic variety.

Example intent:

```text
Par 3 → precision / green target / miss management
Par 4 → tee-club / landing-zone / approach strategy
Par 5 → risk-reward / layup / attack decision
```

The first implementation may use simple random selection with validation, but design the generator so strategic weighting can be added later.

---

# 3. Player vs Game Master

The Game Master is a real opponent in this mode, not just an advisor.

## Fairness principle

By default, use the same physical player profile for both sides:

```text
PLAYER                 GAME MASTER
same club distances    same club distances
same dispersion        same dispersion
same putting ability   same putting ability
same lie penalties     same lie penalties

Different decisions
```

This allows the game to compare course-management quality rather than giving the Game Master artificial physical advantages.

Recommended mode name:

```text
MIRROR MATCH
Same physical golfer.
Different decisions.
```

## GM behavior

The GM should:

- consume the same course state as the player
- use existing strategy/evaluator systems
- choose target, club, swing %, and shot plan using existing logic
- execute shots using the existing simulation engine
- never bypass simulation outcomes
- never receive guaranteed good results

The GM may make aggressive or conservative choices depending on configured personality.

---

# 4. Match Scoring

Primary competition uses normal golf score.

Example:

```text
PLAYER       GM

Par 3
  3          4

Par 4
  5          4

Par 5
  ?          ?
```

Lowest total strokes after three holes wins.

Secondary strategy score may also be shown, but must not replace golf score.

Example final result:

```text
FINAL

PLAYER            GAME MASTER

Golf Score
  12                  11

Strategy Score
  87                  92

GAME MASTER WINS BY 1
```

The strategy score must come from the canonical assessment / existing evaluator evidence, not from a separate ad-hoc scoring engine.

---

# 5. Canonical Assessment Integration

The announcer and UI must consume structured game facts.

Recommended flow:

```text
Simulation Engine
      ↓
Canonical Assessment Layer
      ↓
Game Event
      ↓
Audio Event Resolver
      ↓
Sound / Crowd / Announcer
```

Do NOT allow the announcer or LLM to independently decide what happened.

Do NOT let audio commentary override official result or decision labels.

Example canonical evidence:

```json
{
  "result": {
    "label": "GOOD_RESULT",
    "reason_codes": ["GREEN_REACHED"]
  },
  "decision": {
    "label": "PREFERRED_PLAN"
  },
  "outcome_vs_target": {
    "available": true,
    "lateral_direction": "RIGHT",
    "lateral_miss_yards": 3,
    "depth_direction": "LONG",
    "depth_miss_yards": 3
  }
}
```

The announcer may then say something like:

> "Safely aboard. Three yards right and three yards long of the landing target."

Avoid unsupported swing-mechanics claims.

---

# 6. Audio System Architecture

Implement audio as an event-driven subsystem.

Suggested modules:

```text
audio/
    audio_event_types.ts
    audio_event_resolver.ts
    music_manager.ts
    sfx_manager.ts
    crowd_manager.ts
    announcer_manager.ts
    audio_settings.ts
```

Equivalent backend/frontend organization is acceptable if it fits the current project structure.

## Audio categories

Support these independent channels:

```text
MASTER
MUSIC
ANNOUNCER
SFX
CROWD
```

Each should have independent volume control.

---

# 7. Audio Event Types

Start with a limited, maintainable event set. Target approximately 20–30 event types for v1.

Recommended v1 events:

```text
CHALLENGE_START
HOLE_START
PLAYER_TURN
GM_TURN
SHOT_START
BALL_FLIGHT
BALL_LAND
GREEN_HIT
FAIRWAY_HIT
ROUGH_FINISH
FRINGE_FINISH
BUNKER_FINISH
WATER_PENALTY
OB_PENALTY
CLOSE_APPROACH
LONG_PUTT_MADE
BIRDIE
PAR
BOGEY
DOUBLE_OR_WORSE
PLAYER_TAKES_LEAD
GM_TAKES_LEAD
MATCH_TIED
FINAL_HOLE_START
FINAL_HOLE_CLOSE_MATCH
PLAYER_WINS
GM_WINS
MATCH_TIED_FINAL
PLAY_AGAIN
```

Later expansions may include:

- chip-in
- eagle
- hole-in-one
- comeback
- three-hole sweep
- no-penalty challenge
- clutch save
- risk-reward success/failure

---

# 8. Sound Effects

Use lightweight, satisfying golf sounds.

Recommended SFX:

```text
club impact
ball whoosh
ball landing fairway
ball landing green
ball landing bunker
water splash
cup drop
flag/cup sound
putt roll
UI confirm
score reveal
challenge start sting
victory sting
loss sting
```

Avoid excessive arcade-style effects that make the product feel disconnected from golf.

Sound design should be cheerful and polished rather than cartoonish unless a specific audio theme is selected.

---

# 9. Crowd Reactions

Crowd audio should be contextual and brief.

Suggested reactions:

```text
small applause
large applause
cheer
soft "oooh"
disappointed murmur
big reaction
birdie cheer
long-putt cheer
final-hole tension reaction
```

Examples:

```text
GREEN_HIT → small applause
CLOSE_APPROACH → stronger applause
BIRDIE → cheer
WATER_PENALTY → "oooh" / murmur
LONG_PUTT_MADE → big reaction
PLAYER_WINS → celebration
```

Do not play crowd audio after every routine shot.

---

# 10. Dynamic Music States

Music should react to match state.

Recommended states:

```text
MENU
CHALLENGE_INTRO
NORMAL_PLAY
DECISION_TENSION
SHOT_TENSION
FINAL_HOLE
CLUTCH_MOMENT
VICTORY
LOSS_LIGHT
```

Example behavior:

```text
Challenge starts
→ energetic intro

Normal play
→ light cheerful background music

Important decision
→ lower background level + tension layer

Ball in flight
→ music ducks slightly

Good result
→ short positive sting

Final hole with close score
→ tension music

Victory
→ celebratory music

Loss
→ playful/light ending, not depressing
```

The game should remain fun after losing.

---

# 11. Announcer System

The announcer should make the competition feel alive.

## Key rule

The announcer must speak from structured game facts.

Do not let an LLM invent:

- swing mechanics
- wind effects not recorded by the game
- player intent not stored
- causal explanations unsupported by evidence

## Commentary priority

Do not announce every shot.

Prioritize:

- challenge introduction
- hole introduction
- excellent results
- costly results
- penalties
- birdies / doubles
- lead changes
- match ties
- risky choices
- close approaches
- long putts
- final-hole situation
- match winner

Routine shots should often use only SFX.

---

# 12. Announcer Phrase Variations

Each important event should have multiple phrase variants to avoid repetition.

Example:

```json
{
  "GREEN_HIT": [
    "Safely aboard.",
    "That's on the green.",
    "A solid approach finds the putting surface."
  ],
  "BUNKER_FINISH": [
    "That one finds the sand.",
    "The bunker gets involved.",
    "A little trouble here — that's in the bunker."
  ],
  "WATER_PENALTY": [
    "Splash. That's going to cost a stroke.",
    "That one finds the water.",
    "The hazard wins that battle."
  ]
}
```

Keep phrasing short enough that audio does not slow down play.

---

# 13. Announcer Personalities

Design the system so multiple announcer styles can be supported later.

Suggested modes:

```text
FUN
CLASSIC
COACH
MINIMAL
OFF
```

## FUN

Energetic, light humor, playful competition.

Example:

> "The Game Master found the water. Apparently even artificial intelligence can't negotiate with a pond."

Humor should be occasional, not constant.

## CLASSIC

Calm golf-broadcast style.

## COACH

Adds brief strategy explanation using structured facts.

## MINIMAL

Only major scoring and match-state events.

## OFF

No voice commentary.

For v1, FUN + OFF is sufficient if implementation scope needs to stay small.

---

# 14. Match-State Announcements

Competitive commentary is more valuable than merely restating shot results.

Examples:

```text
PLAYER_TAKES_LEAD
→ "That moves you one ahead."

GM_TAKES_LEAD
→ "The Game Master takes a one-shot lead."

MATCH_TIED
→ "We're all square."

FINAL_HOLE_CLOSE_MATCH
→ "Two holes down and nothing between you. One Par 5 decides it."

PLAYER_NEEDS_BIRDIE_TO_TIE
→ "You need birdie here to force a tie."

PLAYER_NEEDS_PAR_TO_WIN
→ "Par wins the match."
```

These should be generated from real score state.

---

# 15. Final-Hole Drama

The third hole should receive special presentation when the match is close.

Example:

```text
FINAL HOLE
PAR 5

PLAYER   +1
GM       +1

MATCH TIED
```

Behavior:

- transition to final-hole music
- announce match state
- reduce unnecessary commentary
- emphasize decisive shots
- duck music during important putts
- use stronger crowd reaction for clutch outcomes

Example flow:

```text
GM makes birdie
→ crowd cheer
→ announcer: "The Game Master has posted birdie. You need birdie to force a tie."

Player has 8-foot putt
→ music lowers
→ putt sound
→ cup sound
→ crowd cheer
→ victory/tie sting
```

---

# 16. Difficulty Modes

Difficulty should preferably come from hole selection and strategy complexity, not artificial GM physics advantages.

Suggested modes:

```text
EASY
NORMAL
HARD
NIGHTMARE
```

Example selection weighting:

```text
EASY
- wider fairways
- fewer forced carries
- simple green approaches

NORMAL
- mixed strategic decisions

HARD
- tighter landing areas
- meaningful hazards
- difficult approaches

NIGHTMARE
- three difficult risk/reward holes
- water / penalty exposure
- demanding target selection
```

The GM can also use different decision personalities later, but do not silently increase its physical skill unless explicitly designed as a separate mode.

---

# 17. Challenge Variants — Future Ready

Design challenge generation so these can be added later:

```text
RANDOM 3
Any Par 3 + Par 4 + Par 5

DAILY 3
Same three holes and seed for all players that day

WATER TROUBLE
Three hazard-heavy holes

PRECISION
Accuracy-focused holes

RISK & REWARD
Aggressive-vs-layup decisions

COURSE MANAGER
Penalty avoidance / positioning emphasis

MIRROR MATCH
Same physical profile for Player and GM
```

Do not build all variants in v1. Keep the generator extensible.

---

# 18. Seeded Challenge Support

Where compatible with the current simulator, allow the challenge to carry a seed so a challenge can be reproduced.

Suggested metadata:

```json
{
  "challenge_id": "...",
  "challenge_type": "RANDOM_3",
  "seed": 182731,
  "holes": [
    {"course_id": "...", "course_version_id": "...", "hole_number": 7},
    {"course_id": "...", "course_version_id": "...", "hole_number": 14},
    {"course_id": "...", "course_version_id": "...", "hole_number": 18}
  ],
  "player_profile_snapshot_id": "...",
  "gm_profile_mode": "MIRROR"
}
```

For future Daily Challenge or direct comparisons, reproducibility is important.

Do not force both players to receive identical realized shot outcomes. Use the existing paired/evaluator logic where appropriate for strategy comparison, while normal gameplay remains probabilistic.

---

# 19. Post-Match Recap

After the third hole, show a concise result screen.

Example:

```text
3-HOLE CHALLENGE COMPLETE

PLAYER              GAME MASTER
  12                     11

GAME MASTER WINS BY 1

Strategy Score
  87                     92

Best Decision
Hole 2 — 4H layup avoided water risk

Most Costly Result
Hole 3 — bunker finish

[PLAY AGAIN]
[REVIEW SHOTS]
[EXIT]
```

Use canonical assessment language.

Do not equate a bad result with a bad decision.

Example valid recap:

```text
Decision: Preferred Plan
Result: Costly Result
```

This distinction must remain intact.

---

# 20. Play Again Must Be Fast

The Play Again button is critical.

Expected flow:

```text
MATCH COMPLETE
      ↓
PLAY AGAIN
      ↓
Generate new Par 3 + Par 4 + Par 5
      ↓
Reuse current player profile and preferred settings
      ↓
Start immediately
```

Avoid forcing the player through setup screens again unless they choose to change settings.

Try to avoid selecting the exact same holes as the immediately previous challenge when enough eligible holes exist.

---

# 21. Audio Settings UI

Provide controls such as:

```text
AUDIO

Master Volume       80%
Music               50%
Announcer           80%
Golf Sound Effects  80%
Crowd               50%

Announcer
● Fun
○ Minimal
○ Off
```

Persist only lightweight preferences.

Do not store large audio assets or match state in localStorage.

---

# 22. Web Audio / Browser Considerations

Respect browser autoplay restrictions.

Audio should begin only after a user gesture such as:

```text
START CHALLENGE
```

The audio manager should:

- initialize after user interaction
- gracefully handle muted/autoplay-blocked states
- avoid overlapping announcer clips
- duck background music while commentary plays
- cancel stale commentary if game state advances quickly
- stop audio cleanly when exiting the challenge
- support mobile Safari and Chrome behavior

Use preloaded short assets where practical.

Do not require an online text-to-speech request during gameplay for v1.

---

# 23. Announcer Implementation Strategy

For v1, prefer a deterministic phrase library + prerecorded audio or locally generated static assets.

Recommended path:

```text
Structured Event
      ↓
Phrase Template Resolver
      ↓
Select Variant
      ↓
Audio Clip / TTS Asset ID
      ↓
Playback
```

Example event:

```json
{
  "type": "PLAYER_TAKES_LEAD",
  "player_name": "Player",
  "lead_strokes": 1
}
```

Phrase resolver:

```text
"That moves you one ahead."
```

Future LLM-generated commentary may be added, but it must remain constrained by structured facts and should never block gameplay.

---

# 24. Suggested Domain Models

Example:

```ts
type ChallengeHoleRef = {
  courseId: string;
  courseVersionId: string;
  holeNumber: number;
  par: 3 | 4 | 5;
};

type ThreeHoleChallenge = {
  id: string;
  type: 'RANDOM_3';
  seed: number;
  holes: ChallengeHoleRef[];
  currentHoleIndex: number;
  playerScore: number;
  gmScore: number;
  status: 'READY' | 'IN_PROGRESS' | 'COMPLETE';
};
```

Audio event:

```ts
type AudioGameEvent = {
  type: AudioEventType;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  actor?: 'PLAYER' | 'GAME_MASTER';
  holeNumber?: number;
  scoreContext?: MatchScoreContext;
  canonicalAssessment?: ShotAssessment;
};
```

---

# 25. Audio Priority and Collision Rules

Not all events should play.

Use priority and cooldown rules.

Example:

```text
CRITICAL
- final-hole decisive result
- match win
- hole-in-one

HIGH
- lead change
- birdie
- water penalty
- long putt

NORMAL
- green hit
- bunker
- hole introduction

LOW
- routine fairway finish
```

If several events occur at once, collapse them into one useful sequence.

Example:

Do NOT play:

```text
GREEN_HIT
CLOSE_APPROACH
PLAYER_TAKES_LEAD
PAR
```

as four separate voice clips.

Prefer one combined announcement:

> "Great approach. That sets up par and moves you one ahead."

For v1, this combination can be rule-based.

---

# 26. Do Not Make Audio Annoying

Important UX guardrails:

- no commentary after every routine shot
- no long speeches during active gameplay
- no repeated identical phrase back-to-back
- no announcer blocking user input
- user can skip/disable voice
- music should never overpower golf SFX
- commentary should usually be 1 short sentence
- major moments may use 2 short sentences

Target commentary length:

```text
~2–6 seconds typical
```

---

# 27. Humor Guidelines

The FUN announcer may use light humor.

Good examples:

```text
"The bunker gets involved. It was feeling left out."

"The Game Master found the water. The pond wins that argument."

"No heroics here — just a very sensible layup."
```

Avoid:

- mocking the player personally
- insulting skill level
- excessive sarcasm
- jokes after every mistake
- claims unsupported by game data

Tone should feel friendly and joyful.

---

# 28. Performance Requirements

The 3-Hole Challenge should feel immediate.

Targets:

- challenge generation should be fast using local Jetta data
- no provider API calls during Play Mode
- preload only assets needed for the active challenge/audio theme
- audio event handling must not block shot simulation
- Play Again should start rapidly
- avoid loading all course assets when only three holes are needed

Reuse the hole-by-hole / bounded cache architecture where practical.

---

# 29. Persistence

Persist a compact challenge record so finished matches can be reviewed later.

Suggested fields:

```text
challenge_id
challenge_type
seed
created_at
player_profile_snapshot_id
GM profile/personality
course_id + course_version_id + hole_number for each hole
player hole scores
GM hole scores
final result
strategy score summary
assessment version
simulation version
```

Do not duplicate full course geometry inside each shot or challenge record.

Reference versioned geometry instead.

---

# 30. Testing Requirements

## Challenge generation

Test:

- exactly one Par 3
- exactly one Par 4
- exactly one Par 5
- no duplicate hole
- published/valid holes only
- graceful fallback if fewer than three courses exist
- graceful error if insufficient eligible holes exist

## Game Master

Test:

- same physical profile in Mirror Match
- GM uses existing simulation
- no guaranteed results
- correct turn order
- correct score calculation

## Audio

Test:

- audio initializes only after user interaction
- mute works
- each channel volume works
- no overlapping announcer clips
- critical events preempt lower-priority commentary
- music ducks during announcer speech
- final-hole music state activates correctly
- Play Again resets stale audio state
- leaving mode stops all audio

## Canonical assessment

Golden test:

```text
Decision = PREFERRED_PLAN
Result = COSTLY_RESULT
```

Announcer must not say:

```text
"That was a bad decision."
```

It may say:

```text
"The plan was sound, but the shot finished in the bunker."
```

## Browser/mobile

Test at minimum:

- desktop Chrome
- mobile Safari
- mobile Chrome where available
- muted device state
- browser audio unlock after START CHALLENGE

---

# 31. Suggested Implementation Phases

## Phase 1 — Core 3-Hole Challenge

Build:

- challenge generator
- Par 3 + Par 4 + Par 5 selection
- Player vs GM
- normal golf scoring
- simple match screen
- Play Again

No advanced audio needed yet.

## Phase 2 — SFX + Music

Add:

- impact/flight/landing/cup sounds
- normal background music
- final-hole music
- victory/loss stings
- channel volume controls

## Phase 3 — Announcer

Add:

- event resolver
- 20–30 event types
- phrase variation library
- short commentary
- match-state announcements
- music ducking

## Phase 4 — Personality / Polish

Add:

- FUN announcer
- CLASSIC/COACH options
- better phrase combination
- more situational commentary
- themed challenge types

## Phase 5 — Daily / Competitive Extensions

Later:

- Daily 3-Hole Challenge
- leaderboard if product direction supports it
- challenge sharing by seed
- themed challenge playlists
- achievement integration

---

# 32. Acceptance Criteria for v1

The feature is complete enough for first release when:

1. Player can select 3-Hole Challenge from the main game menu.
2. Game automatically selects one Par 3, one Par 4, and one Par 5.
3. Holes may come from different installed/published courses.
4. Player competes against Game Master using normal golf scoring.
5. Mirror Match uses the same physical player profile for both sides.
6. GM decisions come from existing Jetta strategy systems.
7. Shot results come from the existing simulation engine.
8. No external provider API is called during the challenge.
9. Basic golf SFX play correctly.
10. Background music changes for normal play and final-hole tension.
11. Major game events can trigger announcer commentary.
12. Announcer facts come from canonical/structured evidence.
13. Match-state commentary correctly recognizes lead/tie/final-hole situations.
14. Player can independently control Music, Announcer, SFX, and Crowd volume.
15. Match ends with winner + concise strategy recap.
16. Play Again quickly creates a new three-hole challenge.
17. No full course geometry is duplicated into every challenge/shot record.
18. Existing 18-hole, GPS, replay, and practice modes continue working.

---

# 33. Critical Guardrails for Codex

**Do not create a second golf simulation engine.** Reuse the existing Jetta shot simulation.

**Do not create a second strategy/risk engine.** Reuse the current evaluator / canonical assessment evidence.

**Do not let the announcer determine truth.** It only communicates structured facts produced by the game.

**Do not judge decision quality from the final shot result.** A preferred decision can still produce a costly result.

**Do not call Golf Intelligence or another external provider during Play Mode.** The challenge uses already imported/published Jetta course data.

**Do not duplicate detailed course geometry inside each shot/challenge record.** Reference versioned server-side geometry.

**Do not make the announcer speak after every routine shot.** Prioritize meaningful moments.

**Do not make Play Again slow.** This mode depends on a fast "one more match" loop.

---

# 34. Product Goal

The target experience is not merely:

```text
"Golf simulator that teaches strategy."
```

It should feel like:

```text
"A fast golf strategy game where I compete against the Game Master,
make decisions, feel the tension of the result, hear the match come alive,
and want to play another three holes."
```

The entertainment layer should make the player's existing Jetta intelligence systems feel alive without sacrificing simulation integrity.

---

# Revision Addendum — Implementation Assessment Incorporated

This revision supersedes ambiguous portions of the original specification. Codex should treat the following requirements as authoritative for v1.

## 1. Fixed Hole Order

The challenge always uses this order:

```text
Hole 1 = Par 3
Hole 2 = Par 4
Hole 3 = Par 5
```

The Par 5 is intentionally the final hole to support a risk/reward finale. Prefer three different courses, but preserve the Par 3/4/5 order even when course reuse is required.

## 2. Eligible Hole Definition

Before a hole can enter the random selection pool, require that it:

- is present in the current mapped/installed course catalog (`mapped_courses.json` if still authoritative);
- has passed the existing import/course validation process;
- has loadable scorecard data;
- has loadable hole geometry;
- contains surfaces supported by the current simulator;
- has valid green/pin information;
- contains the selected tee;
- is playable for the selected player profile.

Codex must inspect existing publication, installation, import-validation and geometry-loading code before adding new flags. Reuse existing state wherever possible.

### Profile compatibility

Do not reject a hole solely because one direct route contains a carry longer than a percentage of the player's longest club. A hole is profile-compatible when the existing strategy/simulation system can identify at least one legal/playable route from the selected tee without an impossible forced carry. A valid layup or alternate route counts.

If the current engine cannot expose this cleanly, add the smallest compatibility validator based on existing geometry and player club-distance facts. Do not create a second strategy engine.

## 3. Separate Random Seeds

Do not use one challenge seed for every random process. Persist at least:

```text
selection_seed
pin_condition_seed
player_execution_seed
gm_execution_seed
```

Also persist the state required for genuine replay/review:

- challenge/version ID;
- selected course IDs and course-version IDs;
- hole numbers;
- tee choice;
- pin selection/position or deterministic pin reference;
- player profile snapshot;
- GM profile snapshot if different;
- simulation version;
- evaluator version;
- canonical-assessment/policy version;
- relevant saved strategy evidence;
- final scores.

Changing the player execution seed must not change hole selection. Changing the GM execution seed must not change the player's execution sequence. Historical challenges must not be silently recalculated using newer course/evaluator versions.

## 4. Live Scoring Semantics

The official match lead changes only after both competitors finish the current hole.

Do not call current strokes, projected score, expected strokes or an unfinished-hole advantage the official lead.

During an unfinished hole use deterministic contextual statements such as:

- `Game Master posted birdie; you need birdie to tie.`
- `Game Master is in with par; you need par to stay one ahead.`
- `Bogey or better wins the challenge.`

Only use `takes the lead`, `leads by one`, `match tied`, etc. after both players have posted a score for that hole.

## 5. Persistence Ownership

Completed challenges should use the existing player-account/server persistence when they are expected to synchronize, remain reviewable or participate in replay/history.

Do not use `localStorage` as the authoritative challenge database.

Use browser local storage only for lightweight preferences such as:

- volume;
- announcer on/off;
- last selected mode;
- small non-critical UI preferences.

Do not repeatedly embed full course/hole geometry in challenge or shot history. Store compact version references and reuse the server-side/hole-by-hole architecture already adopted for replay. This feature must not recreate the previous oversized browser-storage problem.

## 6. Announcer Asset Model

For v1, prefer prerecorded generic phrases with dynamic numeric/name detail shown as text in the UI.

Example:

```text
Audio: "That's safely on the green!"
UI:    Sand Wedge • 8 ft from the hole
```

Do not create a huge clip matrix for player names, course names, clubs and exact distances.

Build-time-generated static voice assets may be supported later. Browser speech synthesis may be an optional fallback, but it must not be the quality baseline because voice and timing differ across browsers/operating systems.

## 7. Audio Asset Ownership and Budget

Production audio must be original or appropriately licensed for the intended product use.

Keep separate logical asset categories for:

```text
music
sfx
crowd
announcer
```

Codex should inspect the supported browser matrix before choosing final audio formats. Preload only common/critical sounds, lazy-load less-common announcer assets, and fail gracefully if optional audio is unavailable.

Do not hard-code an arbitrary total download-size or loop-duration requirement before real assets exist. Instrument and measure actual asset/network size, loading latency and repetition during playtesting.

## 8. Fringe Event

Do not make `FRINGE_FINISH` announcer/audio behavior part of required v1 functionality until fringe gameplay physics is implemented and authoritative.

The canonical layer may recognize the label, but audio must not imply gameplay fidelity that the simulator does not yet have.

## 9. Match Duration

Replace the product promise `5–10 minutes` with language such as:

> Quick 3-Hole Match

Instrument actual duration and validate it through playtesting. Fast animations, automatic GM progression, concise commentary, next-hole prefetch and skippable non-essential comparisons should keep the experience moving, but no fixed five-minute requirement should drive the architecture.

## 10. Recommended V1 Scope

The first release should contain:

- seeded Par 3 → Par 4 → Par 5 generation;
- three-course preference with safe fallback;
- eligibility/profile-compatibility validation;
- existing Mirror Match / Game Master gameplay;
- independent Player/GM execution seeds;
- ordinary golf score and completed-hole lead state;
- fast `Play Again`;
- compact server/account persistence;
- impact, landing, cup and penalty SFX;
- normal-play, final-hole and victory/end music states;
- approximately 12–15 meaningful announcer event categories;
- `Fun` and `Off` announcer modes;
- canonical post-match recap.

Defer unless already trivial to reuse:

- difficulty modes;
- Daily Challenge;
- multiple announcer personalities;
- elaborate phrase combination;
- leaderboards;
- live dynamic TTS;
- fringe-specific audio.

## 11. Recommended Module Shape

Use the existing repository conventions where possible. A reasonable conceptual split is:

```text
challenge/
  challenge_generator.mjs
  challenge_state.mjs
  challenge_hole_loader.mjs
  challenge_recap.mjs

audio/
  audio_event_resolver.mjs
  audio_director.mjs
  music_manager.mjs
  sfx_manager.mjs
  announcer_manager.mjs
  audio_settings.mjs
```

The structured flow is:

```text
Simulation / Game State
        ↓
Canonical Assessment
        ↓
Pure Audio Event Resolver
        ↓
Prioritized Audio Cues
        ↓
Audio Director
        ↓
Music / SFX / Announcer
```

The audio director owns queueing, preemption, cooldowns, music ducking, cancellation and channel gains. Audio never changes scoring or assessment.

## 12. V1 Announcer Event Budget

Start with roughly 12–15 meaningful categories rather than commenting after every shot. Candidate events include:

```text
CHALLENGE_START
HOLE_INTRO
GOOD_APPROACH
CLOSE_APPROACH
BUNKER_FINISH
WATER_OR_PENALTY
BIRDIE_OR_BETTER
BOGEY
DOUBLE_OR_WORSE
LONG_PUTT_MADE
PLAYER_TAKES_OFFICIAL_LEAD
GM_TAKES_OFFICIAL_LEAD
MATCH_TIED_AFTER_HOLE
FINAL_HOLE_CONTEXT
CHALLENGE_COMPLETE
```

Routine shots should usually use SFX only.

## 13. Challenge Loading

Reuse the server-side hole-by-hole loading design:

```text
Start challenge:
  load Par 3
  prefetch Par 4

Par 3 complete:
  display Par 4
  prefetch Par 5

Par 4 complete:
  display Par 5
```

Challenge selection should use lightweight catalog/validation metadata when possible. Do not download every candidate course's full geometry to the browser just to randomize three holes.

## 14. Play Again

`Play Again` should be a primary completion action and should:

1. create a new challenge ID;
2. generate fresh seeds;
3. choose a new eligible Par 3/4/5 set;
4. clear stale challenge/audio state;
5. immediately begin loading Hole 1;
6. prefetch Hole 2.

Do not force the player through setup screens again unless they choose to change profile/settings.

## 15. Canonical Assessment Guardrail

Keep the distinction between result, decision and outcome versus target.

Examples that must remain valid:

```text
Decision = PREFERRED_PLAN
Result   = COSTLY_RESULT
```

and:

```text
Decision = HIGHER_RISK_PLAN
Result   = GOOD_RESULT
```

The announcer must not reinterpret these labels. It receives structured facts and chooses presentation. If the canonical layer returns `DECISION_NOT_GRADED`, audio must not invent a decision judgment.

## 16. Tests Added by This Revision

Add explicit tests that verify:

- order is always Par 3 → Par 4 → Par 5;
- three-course preference and one/two-course fallbacks;
- invalid/unvalidated/unloadable holes are excluded;
- selected tee exists;
- profile compatibility recognizes valid layup/alternate routes;
- selection/pin/player/GM seeds are independent;
- official lead changes only after both finish a hole;
- final-hole `need X to tie/win` statements are mathematically correct;
- missing audio never blocks gameplay;
- stale audio is cancelled on `Play Again` or navigation;
- audio never mutates score, simulation or canonical assessment;
- completed challenge persistence does not duplicate full geometry;
- historical version references are preserved;
- existing simulator, GPS, replay and GM modes do not regress.

## 17. Implementation Sequence

Before substantial implementation, Codex must inspect the existing code and identify what can be reused for:

- GM/Mirror Match;
- course catalog and publication/versioning;
- import validation;
- hole loading;
- player profile snapshots;
- simulator/evaluator randomness;
- canonical assessment;
- account persistence;
- existing audio utilities.

Then implement in this order:

```text
1. Challenge eligibility + deterministic generation
2. Challenge state + scoring semantics
3. Compact persistence/version snapshots
4. Silent playable Player-vs-GM challenge
5. SFX
6. Reactive music
7. Announcer event resolver/director
8. Browser/device tests
9. Playtesting and pacing polish
```

The silent version must already be a complete playable challenge. Audio enhances it; audio must not be required for game correctness.

## 18. Provider Guardrail

3-Hole Challenge is Play Mode. It must use published/local Jetta course data.

**Do not call Golf Intelligence or another paid course provider during challenge play.**

## 19. Final Codex Instruction

Treat this revised specification as an orchestration and entertainment feature over the current Jetta architecture, not an invitation to rewrite the simulator.

Before creating a new subsystem, search the existing repository for equivalent functionality and reuse/refactor it. If the repository conflicts with an assumption in this specification, report the conflict and propose the smallest compatible change rather than silently introducing duplicate architecture.
# FINAL CONSOLIDATED V1 IMPLEMENTATION DIRECTIVES

**This section supersedes any conflicting requirement elsewhere in this document. Before implementation, Codex should remove/replace contradictory legacy wording so the working specification contains only one authoritative requirement.**

## A. Challenge aggregate
Do not retrofit the feature into an 18-hole-only `RoundState` or single-course competition aggregate. Create a separate three-slot `ChallengeState` and extract/reuse paired-turn, GM, simulation, putting, assessment, strategy-analysis, replay-compaction, and geometry-storage primitives. Preserve existing 18-hole behavior.

## B. Fixed composition
The V1 order is always:
1. Par 3
2. Par 4
3. Par 5

Prefer three different eligible courses; fall back to two or one course only when necessary. Product wording is **Quick 3-Hole Match**. Do not promise 5–10 minutes; instrument and playtest actual duration.

## C. Deterministic eligibility/profile compatibility
A candidate must pass existing course/import/geometry/tee/pin validation.

For V1, profile compatibility means:

> From the selected tee, the existing candidate generator returns at least one legal target that makes positive progress and whose intended landing is on a supported playable surface without requiring an impossible forced carry.

Do not solve an entire multi-shot route during challenge generation. After the opening shot, normal strategy evaluation resumes.

## D. Separate seeds
Persist independently:
- `selection_seed`
- `pin_condition_seed`
- `player_execution_seed`
- `gm_execution_seed`

Also persist profile snapshot, tee/pin identity, simulation/evaluator/assessment versions, and per-slot course versions needed for replay fidelity.

## E. Cross-course slot/replay schema
Each slot must contain:
```text
challenge_slot
course_id
course_version_id
source_hole_number
tee_id
pin_ref/position
```

Do not force a three-course challenge into a replay index that assumes one course/version per round. Create/extend a challenge replay index while reusing existing versioned geometry and compact per-hole replay storage. Never duplicate full geometry per shot.

## F. Official scoring semantics
Official lead changes occur only after both participants complete the hole.

During an unfinished hole, factual posted-score context is allowed, e.g.:
> Game Master posted birdie; you need birdie to tie.

Do not present projected/expected score as the official lead.

## G. Strategy Score source
Canonical assessment remains authoritative for categorical recap wording such as `PREFERRED_PLAN`, `HIGHER_RISK_PLAN`, `GOOD_RESULT`, and `COSTLY_RESULT`.

A numeric Strategy Score must use the existing `analyzeRoundStrategy()` path or an equivalent normalized input built from the same saved evaluator/strategy packets.

**No new challenge-specific scoring formula may be introduced.**

If Player and GM do not persist equivalent scoring evidence, do not display superficially comparable numeric scores. Either extend GM evidence persistence or show evidence-backed categorical decision comparisons in V1.

## H. Persistence and guests
Authenticated players:
- server/account owns completed challenge history;
- history/replay may synchronize across devices according to existing account behavior.

Guests:
- may play the complete challenge normally;
- may retain temporary current-session state according to existing guest conventions;
- completed history is not guaranteed after session/browser data is lost.

Do not add portable challenge export to V1. Keep browser storage small/bounded.

## I. Incremental loading
For selected challenge holes:
```text
load Slot 1
prefetch Slot 2
play Slot 1
use Slot 2
prefetch Slot 3
play Slot 2
use Slot 3
```

Do not fetch all 18 holes from each selected source course. Extract/reuse a single-hole loader and guard against stale prefetch races.

## J. V1 audio scope
V1 includes:
- SFX;
- normal/final-hole/end music;
- approximately 12–15 meaningful announcer categories;
- announcer modes `Fun` and `Off`;
- approximately 4–5 reusable crowd reactions;
- independent Crowd volume.

Suggested crowd reactions:
```text
CROWD_SMALL_APPLAUSE
CROWD_BIG_APPLAUSE
CROWD_OOH
CROWD_DISAPPOINTED_REACTION
CROWD_VICTORY_CHEER
```

Use generic prerecorded announcer phrases with dynamic numeric/course/player detail displayed as text. Browser speech synthesis may be fallback only.

`FRINGE_FINISH` audio is deferred until fringe gameplay physics is authoritative.

Audio flow:
```text
Simulation/Game State
        ↓
Canonical Assessment
        ↓
Pure Audio Event Resolver
        ↓
Audio Director
        ↓
Music / SFX / Crowd / Announcer
```

Audio must never modify scoring, simulation, strategy, or assessment.

## K. Implementation sequence
1. Repository inspection and shared-primitive extraction plan.
2. Silent three-hole challenge and generator.
3. Cross-course persistence and replay.
4. Incremental single-hole loading/prefetch.
5. SFX, music, and crowd.
6. Announcer.
7. Mobile/browser validation and pacing polish.

The silent challenge must be complete and fun/playable before audio is required.

## L. V1 acceptance decisions
V1 is accepted only if:
- challenge is exactly Par 3 → Par 4 → Par 5;
- separate ChallengeState preserves 18-hole invariants;
- eligibility/profile compatibility is deterministic;
- four seed concerns are separated;
- Player/GM execution remains fair and independent;
- official lead changes only after completed holes;
- cross-course replay identifies each slot's course/version/source hole;
- authenticated persistence is server-owned;
- guest play works without guaranteed persistent history;
- numeric strategy comparisons use existing equivalent evidence only;
- selected holes load incrementally;
- crowd is included with independent volume;
- announcer scope is approximately 12–15 categories;
- fringe audio is deferred;
- audio is presentation-only;
- Play Again is fast and uses fresh seeds;
- duration is measured rather than promised;
- Play Mode makes no paid external course-provider calls;
- existing 18-hole/GPS/replay/simulation behavior does not regress.

## M. Explicit V1 non-goals
Defer:
- difficulty modes;
- Daily Challenge;
- leaderboards;
- multiple announcer personalities;
- live cloud TTS;
- elaborate phrase composition;
- challenge export;
- fringe-specific audio/physics additions;
- new simulator/strategy/risk engines.

## N. Codex implementation rule
Before adding substantial code, inspect the repository and identify which existing modules/functions satisfy each requirement. Extract the smallest reusable primitives necessary. Do not create parallel implementations simply because current GM/competition logic is embedded in `app.js`.

The intended architecture is:

```text
                  Shared Jetta Golf Systems
                           │
              ┌────────────┴────────────┐
              │                         │
        18-Hole Round              3-Hole Challenge
        existing behavior          new 3-slot aggregate
              │                         │
              └────────────┬────────────┘
                           ↓
             shared GM / turn / simulation
             putting / assessment / strategy
             replay compaction / geometry
```

The product goal remains:

> A quick golf strategy match where the player competes against the Game Master, feels the match state change after every hole, gets meaningful audio atmosphere, and wants to press **Play Again**.
