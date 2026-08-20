# Golf Strategy Game Improvements

## Current backlog status — 2026-08-11

- **Delivered foundation:** deterministic authoritative gameplay, the reusable
  seeded multi-run evaluator, two caddie choices, player accounts/profiles,
  cross-device round recovery, course mapping/import, GPS-mode foundations, and
  the current desktop/mobile/enlarged-green UI refinement pass.
- **Next release work:** physical iPhone 13 Chrome acceptance, outdoor GPS
  calibration validation, and the complete release-readiness test/audit pass.
- **Deferred improvements in this document:** three-hole engagement checkpoints
  and other round-completion rewards, Friend Challenges and share invitations,
  and a separately validated strokes-to-finish expected-score model.
- Deferred items should not be started until the current core release-readiness
  review is complete.

## Player engagement and round completion

### Problem

Players are not feeling enough excitement during a round and often stop after
about six holes. The current game loop repeats similar actions while delaying
its most meaningful reward—the learning review—until all 18 holes are complete.

The goal is not to add arcade-style distractions. The game should make strategic
thinking feel rewarding throughout the round while preserving its purpose:
helping golfers think before every swing.

### Recommended experience

Treat an 18-hole round as six connected three-hole challenges. Give the player
a reachable finish line, useful feedback, and a reason to continue at each
checkpoint.

#### 1. Three-hole challenges

Show round progress as:

> Challenge 1 of 6 · Holes 1–3

After every three holes, show a checkpoint:

> **Challenge complete**  
> Course Management: 82  
> Best decision: Safe tee line on Hole 2  
> Improvement: Account for downhill carry  
> **Continue to Hole 4**

The player can continue immediately or resume later without losing the round.

#### 2. A strategic objective for every hole

Before the tee shot, present one objective derived from the mapped hole:

> **Hole 5 challenge**  
> Avoid the left bunker and leave a comfortable approach.

Possible objectives include:

- Avoid a mapped penalty area.
- Select the correct sidehill adjustment.
- Leave the ball on the safest side of the green.
- Finish the hole without an unnecessarily aggressive decision.
- Make a sensible recovery after a poor result.

The objective must reflect authoritative course geometry and conditions. It
must not invent hazards or prescribe a single supposedly correct club.

#### 3. Immediate hole-level feedback

After each hole, show a compact **Caddie Card** instead of waiting until the
18-hole review:

> **Smart hole — 86**  
> ✓ Recognized the ball-above-feet lie  
> ✓ Chose a target away from the bunker  
> △ Approach target was more aggressive than necessary  
> **Decision streak: 3 holes**

The card should explain one or two meaningful decisions, give credit for good
thinking, and identify no more than one useful improvement. It should not claim
that simulated execution measures the golfer's real-world ability.

#### 4. Compete against the course and personal best

Give every course or tee a Course Management target. During play, show:

> Your management score: **81**  
> Course target: **75**  
> **6 points ahead**

The primary comparison should be against:

- The course target.
- The player's personal best.
- The player's previous result over the same three holes.

The Top 10 leaderboard can remain, but it should not be the main motivation for
recreational players.

#### 5. Meaningful game lengths

Offer these choices before starting:

- **3-hole lesson** — approximately 5 minutes.
- **6-hole strategy game** — approximately 10 minutes and recommended.
- **9-hole round**.
- **18-hole full challenge**.

A shorter selection should count as a completed game. If the player continues,
the completed section becomes part of the same 18-hole round:

> Great work—you completed the first six holes. Continue with Holes 7–12 now,
> or resume later.

#### 6. One-tap strategic intent

Reduce typing by offering condition-aware intent buttons before a shot:

- Aim right for the lie.
- Aim left for the lie.
- Take extra club.
- Take less club.
- Favor the safe side.
- Keep it below the hole.
- Maximum advancement.
- Add a custom comment.

Only relevant buttons should appear. Selecting one records the player's stated
plan so the course-management system can evaluate whether the player read the
situation correctly.

### Visual direction

The experience should resemble a thoughtful personal yardage book rather than
an arcade game or spreadsheet. The signature interaction is a Caddie Card that
turns over after each hole to reveal what the player understood correctly.

Motion should be restrained, quick, and optional under reduced-motion settings.
Avoid coins, confetti after ordinary shots, childish badges, or rewards that do
not relate to course management.

### Implementation priority

1. Add three-hole checkpoints with Continue and Resume Later actions.
2. Add the immediate hole-level Caddie Card.
3. Add the course target and personal-best comparison.
4. Generate authoritative pre-hole strategic objectives.
5. Add condition-aware, one-tap strategic intent buttons.
6. Add selectable 3-, 6-, 9-, and 18-hole game lengths.

The first two changes should provide the largest immediate benefit because they
create reachable completion points and deliver the game's learning value while
the player is still engaged.

## Friend Challenges

### Purpose

Allow two signed-in friends to compete without requiring them to be online at
the same time. A private challenge adds social motivation while keeping course
management—not simulated shot luck—as the center of the game.

The first version should be asynchronous. Live synchronized play can come later;
it would add waiting, connection handling, and more complexity without being
necessary for a useful head-to-head experience.

### Match flow

1. A signed-in player selects **Challenge a friend**.
2. The player chooses a 3-, 6-, 9-, or 18-hole challenge.
3. The player selects the course and tee.
4. The game creates a private invitation link and a short invitation code.
5. The friend signs in and accepts the challenge.
6. Each player completes the same holes whenever convenient.
7. Both players can see match progress, but a player's shot choices remain
   hidden from the opponent until the opponent has played that hole.
8. The match screen announces the winner and offers a rematch on completion.

Invitation links and codes are preferable to username search for the first
release because player display names may not be unique.

### Invitation sharing

The game prepares the invitation, but the player sends it through their own
email or messaging application. The game must not send an email or text message
automatically.

Use one primary **Share invitation** action:

1. On a mobile phone, open the native sharing menu.
2. The player chooses Messages, their email application, WhatsApp, or another
   installed sharing application.
3. The player selects the friend from their own contacts.
4. The selected application opens with the invitation text and URL filled in.
5. The player reviews the message and presses Send.

On a computer, provide **Copy invitation link**, **Send by email**, and a QR code
that can be scanned with a phone. The game does not need access to the player's
contacts or the recipient's phone number.

Maintain two separate player names:

- **Player display name** — shown inside the game and on public rankings.
- **Invitation name** — supplied by the player and shown only in private
  invitations and friend matches.

Do not describe the invitation name as a verified real name unless identity
verification is added. Before opening the sharing application, show the complete
message preview and allow the player to edit their invitation name.

Example prepared message:

> Kevin Su (`ktsu10`) invited you to a 6-hole golf strategy challenge at
> Cranbury Golf Club.  
> Accept the challenge: `https://golfgame.jetta.com/challenge/8K4M2Q`

Because the invitation is sent through the player's own phone or email account,
it comes from their normal phone number or email address. The recipient's device
can display the sender's saved contact name, making the message recognizable and
less likely to look like spam. The golf game cannot read or control that saved
contact name.

Invitation security rules:

- Use a random, difficult-to-guess invitation token.
- Permit only one opponent to accept an invitation.
- Expire an unaccepted invitation after seven days.
- Allow the creator to cancel it before acceptance.
- Prevent a forwarded link from adding another player after acceptance.
- Never place an email address, phone number, or real name in the invitation URL.
- Return the recipient to the invitation automatically after sign-in or account
  creation.

### Scoring

Different player profiles produce different computer-generated shot outcomes,
so stroke score alone is not a fair measure of who made better decisions.

Determine each hole as follows:

1. The higher Course Management score wins the hole.
2. If Course Management scores are tied, the lower stroke score wins the hole.
3. If both scores are tied, the hole is halved.

The player who wins the most holes wins the match. Show stroke totals as useful
context, not as the primary ranking method.

Example:

> **Ktsu10 leads 2–1 after Hole 3**  
> Hole 1 — Ktsu10  
> Hole 2 — John  
> Hole 3 — Ktsu10  
> Course Management: 84 vs. 78

### Match features

- Private invitation link and six-character invitation code.
- Waiting for opponent, Your turn, and Friend finished statuses.
- Three-hole checkpoint results.
- Private match commentary.
- Rematch using the same course, tee, and hole count.
- Friend-match record showing wins, losses, and ties.
- Optional replay of the match's most meaningful hole.
- Automatic cross-device resume for either player's unfinished challenge.

### Fairness and privacy rules

- Both players must be signed in.
- Both players use the same course, tee, and selected holes.
- Each player continues using their own saved club and putting profile.
- Course Management score remains the authoritative competitive score.
- Neither player can modify the course or match settings after acceptance.
- Only invited players can open the match details.
- Do not reveal the opponent's unplayed decisions or target lines.

### Implementation priority

1. Add persistent challenges, participants, invitation tokens, and match status.
2. Add the private invitation name and invitation-message preview.
3. Add native mobile sharing with copy, email, and QR-code fallbacks.
4. Add Create Challenge and Accept Challenge screens, including sign-in return.
5. Connect each player's authoritative round progress to the challenge.
6. Calculate hole winners and overall match standing.
7. Add three-hole match checkpoints and completion results.
8. Add rematches and the personal friend-match record.
9. Consider live presence and real-time progress only after asynchronous matches
   have been tested successfully.

Friend Challenges should share the proposed three-hole checkpoint system. This
makes a short challenge a complete game while allowing longer matches to feel
like a sequence of attainable stages.

## Probabilistic Strategy Simulation

**Status: Completed August 11, 2026.** Gameplay uses replayable seeded outcomes;
the normal and on-course GPS caddies rank their choices with 400 paired runs of
the authoritative shot engine. The comparison runs in a browser worker when
available, falls back safely to the main thread, is cached by the complete shot
decision, and supplies its verified recommendation and metrics to the AI. The
deterministic planner remains the fallback when an analysis cannot be produced.
Expected score remains deliberately excluded until a validated strokes-to-finish
model exists.

### Purpose

Teach course management as decision-making under uncertainty. A player should
not receive the same outcome from every sensible shot, but the game must still
be able to reproduce an exact result when testing a bug or reviewing a saved
round.

Use a hybrid architecture:

- **Actual gameplay:** probabilistic shot outcomes based on the player's club
  profile and authoritative shot conditions.
- **Caddie analysis:** Monte Carlo comparison of the available strategies.
- **Testing and replay:** seeded randomness that reproduces the same shot and
  complete result packet.

The simulation engine—not the language model—must perform the Monte Carlo
calculations. AI may explain the verified results but must not invent,
recalculate, or override probabilities.

### Monte Carlo caddie comparison

Before presenting **Aggressive** and **Safe & Smart**, run approximately 300–500
outcomes for each candidate through the same authoritative shot engine used by
gameplay. Each comparison should use:

- the player's saved club carry and accuracy;
- selected power and modeled rollout;
- current lie, stance, and elevation;
- mapped fairway, rough, green, bunker, water, and out-of-bounds geometry;
- the candidate's actual target line;
- identical random samples for both choices so the comparison is fair.

Do not assume that the player will earn a condition-adjustment reward when the
choices are first generated. If the player later declares and applies a correct
adjustment, its temporary effective-accuracy bonus may be included in an
updated shot preview and the final played shot only.

### Player-facing results

Show a concise comparison rather than hundreds of individual outcomes:

| Strategy | Green/target | Playable lie | Bunker | Penalty | Typical leave |
|---|---:|---:|---:|---:|---:|
| Aggressive | 42% | 67% | 18% | 7% | 24 yd |
| Safe & Smart | 21% | 89% | 5% | 1% | 72 yd |

Useful first-version metrics:

- green or intended-target-area percentage;
- fairway or otherwise playable-lie percentage;
- bunker, water, and out-of-bounds probability;
- median distance remaining;
- common left/right and short/long miss;
- 10th, 50th, and 90th percentile outcomes;
- likely three-putt exposure for approach shots.

The explanation should connect the recommendation to those calculated facts:

> Aggressive reaches the green more often, but about one shot in four finishes
> in a bunker or penalty area. Safe & Smart keeps 89% of outcomes playable and
> is the recommended course-management choice.

Do not display **expected score** until a trustworthy strokes-to-finish model
has been built and validated. Early versions should use observable probability,
dispersion, lie, and remaining-distance metrics instead of presenting an
unverified score estimate as authoritative.

### Determinism and performance

- Preserve the recorded round, hole, and stroke seed for the single played
  outcome.
- Store enough simulation identity to reproduce every reported bug exactly.
- Derive a stable analysis seed for each candidate set so reopening the same
  decision does not make its percentages jump unexpectedly.
- Cache results while the ball position, profile, conditions, and choices are
  unchanged.
- Run candidate simulations outside the UI rendering path so mobile controls
  remain responsive.
- Add wind, fatigue, or other variables only after the game models them
  authoritatively; never add them only through AI narration.

### Delivered implementation

1. A reusable multi-run evaluator wraps the existing seeded shot engine.
2. Each pair of caddie choices receives 400 identical seeded outcome samples.
3. The evaluator aggregates playable lie, target, bunker, penalty, dispersion,
   and remaining-distance metrics into a versioned course-management ranking.
4. The compact probability comparison appears in each choice's `?` explanation.
5. The verified aggregate packet—not invented LLM arithmetic—controls the AI
   recommendation and narration.
6. Results are cached and calculated in a background worker on supported
   browsers, including the GPS caddie path.
7. A strokes-to-finish model and expected score remain a separate future
   validation project rather than part of this completed hybrid foundation.

## Unified Simulator and On-Course Playing History

**Status: Deferred until several on-course GPS rounds have been tested.** Do
not implement this yet. First use GPS Mode for real rounds and evaluate its
workflow, location accuracy, shot recording, and scoring on the course.

### Delivered live-round bridge — August 16, 2026

The game map now has separate **Simulator** and **On Course Live** modes. Live
mode retrieves the latest synchronized GPS round for the selected course,
opens at its most recently active hole, and draws the recorded tee, numbered
shot path, and current ball location over the installed course map. It reports
the real round strokes, current-hole strokes, last shot, lie, distance to the
pin, GPS accuracy, and synchronization age. It refreshes from the account every
five seconds; the player may inspect earlier holes without being forced back to
the active hole, while **Refresh** returns to the newest activity. Closing GPS
recording on the same phone opens this live view immediately.

This bridge is deliberately read-only. It does not copy GPS shots into the
simulator round, change the simulator score, or treat measured total travel as
club carry. Combined history, comparison, and reflective replay remain the
separate future work described below.

### Purpose

Give each signed-in player one Playing History while preserving a clear
distinction between computer-simulated rounds and real on-course rounds. The
player should be able to compare rounds on the same course without simulated
execution being presented as evidence of real golfing ability.

The history should provide separate **Simulator Rounds** and **On-Course
Rounds** headings or filters, plus a **Compare Rounds** view. Every round must
carry an unmistakable source label. Same-course comparisons should preferably
use the same tee and may include:

- stroke score and score to par;
- Course Management score, when comparable decision evidence exists;
- fairways, greens, penalties, and putts when those values are reliably
  recorded;
- club and power choices, common misses, and shot-distance summaries;
- simulator-versus-on-course results for the same hole or full course.

### Account synchronization

**Server synchronization foundation completed August 11, 2026.** GPS Mode now
saves every action to the phone first and queues a versioned copy to the
authenticated player's golf-game server account. The mobile header reports
local, syncing, synchronized, offline, and server-error states. Interrupted
uploads retry after later edits or when the browser comes back online.

GPS rounds use their own server table and authenticated API, separate from
simulator rounds. Each round has a unique ID and increasing revision; stale
uploads cannot overwrite a newer server copy. Existing browser-only GPS rounds
receive an ID and revision when next opened and can then synchronize. The
server exposes active-round retrieval and GPS history data for the later PC
history and replay interfaces.

Cross-device GPS resume selection, the combined Playing History interface, and
the PC replay interface remain deferred until real rounds have tested the
on-course workflow.

### Real-shot profile learning

Real on-course shots should become the primary evidence for suggested player
profile improvements. Simulated shot outcomes must remain excluded from claims
about the golfer's real club distance or accuracy.

Profile learning must be conservative:

- retain GPS accuracy, start and end position, lie, club, power, and intended
  target with every usable shot;
- exclude or separately classify poor GPS fixes, partial shots, recovery
  shots, penalties, severe lies, and other unreliable samples;
- never let one unusual shot silently change a club profile;
- wait for a meaningful sample across multiple rounds before recommending a
  change, such as roughly 20–30 valid shots for a club across at least three
  rounds;
- show the evidence and require the player to approve any proposed profile
  adjustment;
- maintain confidence and sample counts so later evidence can refine the
  recommendation.

Phone GPS measures total travel between consecutive ball locations, not the
exact airborne carry. Therefore, GPS distance must not be copied directly into
the profile's carry field. Initially show it as **observed total distance**.
Carry adjustment requires either a recorded landing point or a carefully
validated estimate that accounts for rollout, club, lie, and surface. Phone GPS
is also too imprecise for learning putting distance; putt totals should be
recorded manually and analyzed separately.

#### Delivered comparison foundation — August 16, 2026

The player statistics editor now places accumulated on-course evidence beside
the saved carry and accuracy for each club. This first conservative comparison:

- uses all synchronized on-course rounds for the signed-in player;
- estimates carry as 90% of GPS-measured total distance;
- treats normal 100% swings within ±20% of the established distance as
  successful carry samples;
- excludes mishits from carry, while retaining those eligible attempts in the
  accuracy denominator;
- excludes partial, recovery, bunker, green, penalty-like, and poor-GPS
  observations;
- shows attempts, successes, contributing rounds, and confidence; and
- requires an explicit **Use values** confirmation followed by **Save profile**.

This is an evidence-and-approval tool, not silent adaptive learning. The
longer-term recommendation threshold and rollout-aware model above still need
validation against more real rounds.

### On-Course Round Replay

After GPS rounds synchronize with the player's account, provide an
**On-Course Round Replay** on the PC. From Playing History, the player should be
able to select a real round by course, date, tee, and score and replay it hole
by hole or stroke by stroke on the mapped course.

Replay controls should include:

- play, pause, previous stroke, next stroke, and a stroke timeline;
- hole selection and an option to replay the complete round;
- an adjustable animation speed;
- clear **On Course** labeling so the replay is never confused with a
  simulated round.

For every recorded stroke, show:

- starting position, lie, and distance to the pin;
- whether the player selected **Aggressive**, **Safe & Smart**, or **Player
  Choice**;
- club, power, intended target, and any recorded player adjustment;
- actual GPS finishing position, observed shot distance, resulting lie, and
  distance remaining.

The GPS record must retain the exact intended target for Player Choice shots,
not only the selected club and power. Otherwise the replay cannot distinguish a
poor decision from an execution miss.

GPS normally records only the ball's starting and ending locations. Any ball
flight drawn between those points must therefore be labeled and treated as an
illustrative animation, not a reconstruction of the real trajectory.

At any paused stroke, offer **Try Another Strategy**. This should create a
separate simulated practice branch from approximately the recorded position so
the player can compare a different club, power, target, Aggressive plan, or
Safe & Smart plan. The experiment must never modify the original on-course
round or be counted as real-world performance evidence.

The replay's purpose is reflection rather than passive animation. It should
help the player identify what was known before the stroke, what decision was
made, whether the result was primarily strategic or execution-related, and
what plan the player wants to use the next time the same situation occurs.

### Suggested delivery order

1. Play and review several GPS rounds before changing storage or profile data.
2. ~~Add account synchronization and archival for active and completed GPS
   rounds.~~ Completed August 11, 2026.
3. Add Simulator, On Course, and Compare sections to Playing History.
4. Add the PC stroke-by-stroke On-Course Round Replay.
5. Store quality-controlled on-course shot observations with their source and
   GPS accuracy.
6. Add **Try Another Strategy** as a simulated replay branch.
7. ~~Add the initial evidence summary and player-approved profile value
   comparison.~~ Completed August 16, 2026. Continue validating thresholds
   before treating it as an automatic recommendation.
8. Validate comparisons and learning thresholds using real rounds before any
   automatic adaptation is considered.

## Design basis

The direction supports autonomy through meaningful shot choices, competence
through immediate and understandable feedback, and continued progress through
short reachable goals. These principles are consistent with research on
self-determination and video-game motivation:

- [The Motivational Pull of Video Games](https://selfdeterminationtheory.org/SDT/documents/2006_RyanRigbyPrzybylski_MandE.pdf)
- [Goal proximity and effortful control](https://pubmed.ncbi.nlm.nih.gov/38451699/)
