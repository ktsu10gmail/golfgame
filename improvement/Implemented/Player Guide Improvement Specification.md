# Player Guide Improvement Specification

## Objective

Improve the English Player Guide so that a new player can understand the game quickly while preserving the existing detailed guide as the authoritative reference.

The Player Guide currently contains accurate and useful information, but it reads primarily as a reference manual. Improve its teaching structure without removing important technical explanations.

Do not change game behavior merely to make the documentation simpler.

Do not invent features that are not implemented.

Before editing documentation or UI, verify terminology and current behavior against the repository.

---

# 1. Preserve the Core Game Philosophy

The following concept is fundamental and must remain prominent:

> This is a golf strategy game, not a swing simulator.

The primary learning objective is Course Management.

The game should teach the player to:

- read the situation;
- recognize trouble;
- understand personal capability;
- select an appropriate club and swing;
- choose a target and preferred miss;
- understand what next shot is being left;
- distinguish decision quality from execution/result;
- learn from the decision rather than from one lucky or unlucky outcome.

Preserve the principle:

> A lucky result does not make a poor decision correct, and normal shot dispersion does not make a sound decision wrong.

---

# 2. Add a "5-Minute Quick Start"

Add a short beginner section near the beginning of the Player Guide.

Suggested title:

## 5-Minute Quick Start

A first-time player should be able to understand the basic game without reading the entire reference guide.

Suggested workflow:

1. Create or select an accurate Player Profile.
2. Read the Game Master before every shot.
3. Identify trouble and decide where a useful miss should be.
4. Select Club, Swing, Aim Mode, and Target.
5. Use Caddie Choices when a second opinion is useful.
6. Play the shot.
7. Evaluate Decision Quality separately from the shot result.
8. Continue from the new lie.

Emphasize:

> The game is not only asking, "Did I hit a good shot?"

> It is asking, "Did I make a good decision before I hit the shot?"

Do not duplicate the entire manual in this section.

It should be a concise onboarding page.

---

# 3. Add a Core Gameplay Loop

Create a simple visual or clearly formatted workflow:

READ → THINK → PLAN → AIM → PLAY → REVIEW → LEARN

Suggested mapping:

READ  
Lie, stance, slope, distance, elevation

THINK  
Hazards, trouble, preferred miss, next-shot position

PLAN  
Club, swing, shot type

AIM  
Direction Target or Landing Target

PLAY  
Commit the shot

REVIEW  
Decision Quality vs Execution Quality

LEARN  
What should I repeat or change?

This should represent the fundamental Golf-Domain gameplay loop.

---

# 4. Make Direction Target vs Landing Target Easier to Understand

The existing explanation is technically correct but important enough to deserve a clearer comparison.

Add a compact comparison such as:

| Feature | Direction Target | Landing Target |
|---|---|---|
| Marker represents | Starting direction | Intended first landing point |
| Player controls | Direction and power | Landing point and club |
| Game calculates | Result from selected power | Required Auto Power |
| Useful for | Driving, Lay up, Recovery, deliberate partial shots | Approach, Chip and run, short Bunker shots |
| Main question | "Which direction and how hard?" | "Where do I want the ball to land?" |

Preserve existing physics and eligibility rules.

Landing Target must NOT guarantee that the ball actually lands on the marker.

The marker represents intended carry.

Normal player-profile dispersion must still apply.

---

# 5. Add a Landing Target / Rule of 12 Example

The guide currently mentions Rule of 12 guidance but does not provide a simple player example.

Add an educational example.

Example concept:

Ball to landing point: 5 yards  
Landing point to cup: 15 yards  
Total distance: 20 yards

Explain that the player's objective is not necessarily to carry the ball all 20 yards.

The player chooses where the ball should land and selects a club whose expected rollout fits the remaining distance.

Different clubs may solve the same greenside problem differently.

The purpose of the example is to teach:

LAND → ROLL → FINISH

Do not change the existing Rule of 12 implementation unless repository behavior is inconsistent with the documentation.

---

# 6. Explain Decision Quality vs Execution Quality with Examples

This is one of the most important educational concepts in the game.

Add two examples.

## Good Decision, Poor Result

Example:

Water is on the right.

The player selects a club appropriate for the profile and chooses a safe target left of the water.

Normal dispersion causes the ball to finish in rough.

Interpretation:

Decision Quality: Good  
Execution/Outcome: Poor

Lesson:

The player should not conclude that the safe strategy was wrong merely because one simulated result was unfavorable.

## Poor Decision, Lucky Result

Example:

The player attempts a low-percentage hero shot over a major hazard when a safer practical route exists.

The random outcome happens to finish on the green.

Interpretation:

Decision Quality: Poor  
Outcome: Excellent

Lesson:

A lucky result does not convert a poor Course Management decision into a good one.

---

# 7. Add a Simple Aggressive vs Safe & Smart Example

Before explaining the strategy engine's paired simulations, give the player a practical golf example.

Example:

Situation:

175 yards to the green.  
Water protects the right side.  
The player's normal dispersion makes the water relevant.

Aggressive:

Attack the green or pin for the stronger scoring opportunity while accepting increased hazard exposure.

Safe & Smart:

Choose a safer target or layup that reduces penalty exposure and leaves a manageable next shot.

Explain:

Neither plan predicts exactly where the ball will finish.

Caddie Choices compare risk, playable outcomes, remaining distance, and scoring opportunity using the player's profile.

After the simple example, retain the existing technical explanation of paired simulations.

---

# 8. Clarify the Three Coaching/Information Systems

The guide should clearly distinguish:

## Game Master

Question answered:

> What is happening right now?

Responsibilities include authoritative calculated facts such as:

- distance;
- lie;
- slope;
- ball position;
- tree blockage;
- recovery direction;
- relevant shot conditions.

## Caddie Choices

Question answered:

> What are my reasonable strategic options?

Responsibilities include:

- Aggressive plan;
- Safe & Smart plan;
- club;
- swing;
- target;
- expected risk/reward evidence.

Caddie Choices are recommendations, not commands.

## AI Caddie

Question answered:

> What can I learn from what happened?

Responsibilities include:

- explaining verified shot facts;
- recognizing good decisions;
- identifying improvement opportunities;
- explaining strategy concepts.

AI Caddie must remain separate from authoritative shot calculation.

The game must remain playable and scoreable when AI is unavailable.

---

# 9. Add an On-Course GPS Quick Start

Create a compact cheat sheet specifically for using the game during a real round.

## At the Tee

Tee Location  
→ Select Club  
→ Select Swing  
→ Consider Caddie Choices if desired  
→ Record strategy/target  
→ Hit the real shot

Tee Location establishes the starting position and must not add a stroke.

## At the Ball

Walk to the ball  
→ Ball Location  
→ Verify/correct lie  
→ Record Ball/Hill/Rough conditions  
→ Select Club and Swing  
→ Consider strategy  
→ Hit

Ball Location completes the previous shot and adds the stroke.

## On the Green

On Green  
→ +1 Putt for each putt that remains out  
→ Holed Out for the final putt

Holed Out records the final stroke and completes the hole.

Keep this section extremely concise so it can be referenced on a phone during a real round.

---

# 10. Explain "What GPS Knows vs What the Player Knows"

Add a short conceptual explanation.

Suggested wording:

> GPS tells the game where you are. You tell the game what the ball actually looks like from where you are standing.

The system can estimate information from:

- GPS position;
- mapped course geometry;
- calibrated course data.

The player may need to confirm or correct:

- Fairway;
- Rough;
- Bunker;
- Recovery;
- Ball Above Feet;
- Ball Below Feet;
- Level;
- Uphill;
- Downhill;
- Rough severity;
- club used;
- swing used.

Do not imply that GPS can reliably determine physical conditions it cannot actually measure.

---

# 11. Add "How This Game Can Make You a Better Golfer"

Add a short section explaining the transferable skills the game is intended to develop.

Suggested skills:

- recognizing trouble before selecting a club;
- choosing a preferred miss;
- planning backward from the desired next shot;
- understanding personal dispersion;
- recognizing when safe advancement is better than a hero shot;
- accepting bogey when protecting against a much worse score is strategically correct;
- choosing useful landing points around the green;
- separating good decisions from lucky outcomes;
- learning real club tendencies from accumulated GPS evidence;
- making Course Management thinking automatic.

Avoid claiming that simulator results prove real-world performance improvement.

---

# 12. Reorganize the Guide into Three Conceptual Parts

Do not necessarily remove existing sections.

Reorganize them so players can distinguish onboarding, learning concepts, and reference information.

Suggested organization:

# Part I — Learn to Play

- What This Game Is For
- 5-Minute Quick Start
- Core Gameplay Loop
- Player Profile
- Course Selection
- Simulator
- Game Master
- Planning a Shot
- Aim Mode
- Shot Type
- Caddie Choices
- Putting
- GPS Quick Start

# Part II — Learn to Think Like a Golfer

- Course Management
- Preferred Miss
- Aggressive vs Safe & Smart
- Decision Quality vs Execution Quality
- Landing Target
- Rule of 12
- Recovery Strategy
- Review
- Player Learning
- Real On-Course Evidence

# Part III — Reference

- Account and synchronization
- Map modes
- Detailed GPS operation
- GPS synchronization states
- Scorecard
- Round Card
- Replay
- Round History
- Rank Board
- Feedback Center
- Technical behavior and limitations

Avoid unnecessary duplication between sections.

---

# 13. Promote the Final Questions into a Named Learning Framework

The current final questions are important enough to become a named part of the game's philosophy.

Suggested title:

# The Golf-Domain Habit

Before judging a shot, ask:

1. Did I read the condition correctly?
2. Did my club, swing, and target fit that condition?
3. Did I account for the safest useful miss?
4. Did I understand the next shot I was leaving?
5. Was the outcome caused by my decision, normal dispersion, or both?
6. What should I repeat or change next time?

Preserve the closing idea:

> When that thought process becomes natural, the game has done its job.

Consider showing a shortened version of these questions in Review so the learning framework appears inside the game as well as in documentation.

Do not implement the Review UI change automatically unless it fits the current architecture and does not clutter the interface. Evaluate it first.

---

# 14. Documentation Style

The Player Guide should be understandable by an ordinary golfer.

Prefer player-facing golf language over software-engineering terminology.

For example, explain the player concept first:

> The Caddie compares how each strategy is likely to perform.

Then, when useful, explain the technical implementation:

> The strategy engine tests the candidates through hundreds of paired outcomes under identical conditions.

Do not remove technical explanations that establish trust in the simulation.

Move detailed implementation explanations after the player-facing explanation.

---

# 15. Preserve Important System Boundaries

The revised documentation must continue to make these boundaries clear:

- Simulator outcomes are not real-world evidence.
- GPS travel distance is not automatically equal to airborne carry.
- Simulator putting contours do not represent the physical course green.
- AI does not determine authoritative shot results.
- AI does not replace deterministic scoring.
- Caddie Choices are recommendations.
- Landing Target represents intended carry, not guaranteed landing position.
- Player Profile must not be silently modified from observed evidence.
- GPS records and simulator records remain logically distinct.

Do not weaken these statements while simplifying the guide.

---

# 16. Implementation Instructions

Before making changes:

1. Read the current Player Guide source.
2. Inspect the relevant implementation for terminology and actual behavior.
3. Verify that examples match current game rules.
4. Identify documentation-only changes separately from possible UI improvements.
5. Do not change game mechanics unless a documented behavior is currently inconsistent with implementation.
6. Preserve existing useful content whenever possible.
7. Avoid rewriting unrelated sections.

After making changes:

1. Verify all UI labels against the current application.
2. Verify Direction Target and Landing Target behavior.
3. Verify Shot Type terminology.
4. Verify GPS stroke-recording behavior.
5. Verify Game Master, Caddie Choices, and AI Caddie responsibilities.
6. Verify all Rule of 12 examples against the implemented model.
7. Verify documentation does not claim functionality that does not exist.
8. Report any mismatch found between documentation and implementation instead of silently changing either side.

## Desired Result

A new player should be able to read approximately the first 2–3 pages and understand:

- what the game is trying to teach;
- how to play a shot;
- why target selection matters;
- when to use the Caddie;
- why a good decision can produce a bad result;
- what the player should learn from the result.

The remainder of the guide should serve as progressively deeper instruction and reference.