# Evidence-Based On-Course GPS Round Replay

## Purpose

Give a signed-in golfer a personal replay of a synchronized on-course round and
help them learn from recorded outcomes without pretending GPS data reveals swing
mechanics or guarantees counterfactual results.

The experience is a **yardage-book film room**: the course map is the film, each
recorded shot is a chapter, and every caddie comment states whether it comes from
a recorded fact, a course calculation, or a modeled alternative.

## Product principles

1. **Result, decision, and outcome versus target are different.** A poor result
   does not prove a poor decision. Replay labels the recorded result, grades a
   decision only from preserved probability evidence, and separately measures
   the actual endpoint against the saved intended target.
2. **The calculation speaks first.** Deterministic geometry and the seeded shot
   evaluator produce the evidence. AI may later turn that evidence into natural
   language, but it must not add facts or causal claims.
3. **Alternatives are probabilities, not promises.** Say that another club or
   target *reduced modeled bunker risk*, never that it *would have avoided* the
   bunker.
4. **Missing evidence is visible.** Older shots without an intended target show
   “Decision not graded” rather than receiving a fabricated score.
5. **No extra on-course burden.** Caddie selections should automatically retain
   their target, club snapshot, alternatives, and probability analysis. Manual
   choices may remain ungraded until a future target-selection control exists.

## Recorded evidence

Existing GPS rounds provide:

- shot start and finish GPS/course coordinates;
- start and finish lie;
- measured shot distance;
- club and swing percentage when selected;
- score, green reached, and putt count;
- mapped fairway, rough, bunker, water, trees, green, and pin geometry;
- selected caddie plan and probability analysis when available.

New GPS shots should additionally preserve, without asking the golfer to type:

- intended target course coordinate for a selected caddie plan;
- club carry and accuracy snapshot at the time of play;
- all compared caddie alternatives and their paired-simulation summaries;
- evaluator version, seed, sample count, and recommended choice ID.
- an immutable capture timestamp and an explicit `analysis_at_time_of_round`
  source marker.

This snapshot is historical evidence. Replay must not silently recompute it with
a newer evaluator. A future current-model reanalysis may be offered, but it must
be labeled separately from the analysis the golfer actually saw during the round.

## Outcome vs target

When shot origin, intended target, and actual finish are present, replay projects
the finish onto the original target line and reports lateral and distance miss:

> Outcome vs target: 27 yd right, 11 yd short.

This describes the recorded endpoint only. It must not infer clubface, swing
path, contact, wind, or any other cause. Older shots without a saved target show
“Target not recorded” and “Comparison unavailable.”

## What replay may say

Replay may state observed facts, for example:

> Recorded result: 6-iron at 75% traveled 163 yards from rough and finished
> 18 yards short-right in the bunker.

When preserved model evidence supports an alternative, replay may say:

> Modeled alternative: the longer-club option reduced bunker risk from 31% to
> 14%, while increasing long-miss exposure.

When the intended target is unavailable, replay must say:

> Decision not graded: the intended target was not recorded for this shot.

Replay must not diagnose contact, wind, or swing mechanics from two GPS points.

## Result labels

Use plain-language labels instead of a punitive 0–100 score:

- **Good result** — reached the green, found the fairway from the tee, escaped a
  recovery lie, or made substantial safe progress.
- **Mixed result** — remained playable but did not clearly improve the hole.
- **Costly result** — finished in bunker, water, out of bounds, or recovery.
- **Recorded result** — insufficient course evidence for a stronger label.

Decision evidence appears separately as **Preferred plan**, **Competitive plan**,
**Higher-risk plan**, or **Decision not graded**. A third evidence card,
**Outcome vs target**, reports right/left and short/long miss from saved geometry.

## Experience

### Replay library

The player account includes **On-course replays**. It lists synchronized GPS
rounds with date, course, total strokes, completion state, and a Replay action.
The server remains authoritative and round IDs remain scoped to the signed-in
player.

### Replay map

Opening a round switches to its installed course and opens the existing Live GPS
map in replay mode. A compact film-room panel provides:

- previous and next shot;
- play/pause;
- previous and next hole;
- current hole, shot, club, swing, distance, and finish lie;
- the result label and evidence-grounded caddie comment;
- a visible evidence key: Recorded / Modeled / Not graded.

The current recorded segment draws onto the map with restrained motion. The
animation is an illustrative transition between GPS fixes, not an exact ball
flight. Reduced-motion preferences remove the drawing animation.

### Older rounds

Existing rounds remain replayable. They receive factual result commentary and
course-position descriptions. They receive decision commentary only when their
saved strategy contains adequate probability evidence.

## Acceptance criteria

- A signed-in player can list and open any synchronized GPS round retained by
  the server.
- Replay never mutates the saved GPS round.
- Shot navigation reveals the route progressively rather than showing the whole
  hole immediately.
- Result, decision, and outcome-versus-target evidence are visually and
  semantically separate.
- The original evaluator output remains immutable and is never silently replaced
  by a newer model's result.
- A bunker result does not automatically produce “take more club.”
- Modeled comparisons quote saved percentages and identify their evidence.
- Missing target/model evidence produces an explicit non-judgmental message.
- The replay works on iPhone-sized and desktop layouts, supports keyboard focus,
  and respects reduced motion.

## Deferred work

- Manual target selection before an on-course shot.
- Optional player annotations such as mishit, wind, or exactly as planned.
- AI-generated prose constrained by a replay evidence schema.
- Cross-round patterns with minimum sample and round-count thresholds. The saved
  club snapshot, intended target, actual endpoint, target miss, evaluator
  identity, and captured-at timestamp support later aggregation such as typical
  right/left miss by club without claiming a swing cause.
- Exact putt replay after individual putting locations are recorded.
