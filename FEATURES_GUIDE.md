# Golf Strategy Game — Player Features Guide

This guide explains the features currently available in the golf strategy game.
Every entry identifies **where the feature is available, why it is useful, and
how to use it**.

## Mode key

- **Game Mode:** The golf strategy simulator.
- **Play GM Mode:** A Game Mode competition against the Game Master.
- **GPS Mode:** Real-round recording on the course.
- **Live Mode:** Read-only map view of a synchronized GPS round.
- **Player Account:** Personal records, profile, learning, and feedback.

## Quick navigation

- [Player setup and navigation](#player-setup-and-navigation)
- [Simulator and strategy tools](#simulator-and-strategy-tools)
- [On-course GPS tools](#on-course-gps-tools)
- [Review and learning tools](#review-and-learning-tools)

## Player setup and navigation

### Feature title: Player account and cross-device resume

**Mode:** Player Account; supports Game, GPS, and Live Modes.

**Purpose:** Keep each player's profile, unfinished round, GPS rounds, history,
and feedback private and available on the server. An unfinished simulator round
can be continued on another signed-in device.

**How to use:** Create a player from the opening sign-in screen, confirm the
email when required, and use the same account on each device. Open the player
button in the top toolbar to reach account features or sign out.

### Feature title: Playing profile

**Mode:** Player Account; used by Game, Play GM, and GPS Modes.

**Purpose:** Make club recommendations, shot distance, dispersion, and putting
results reflect the golfer instead of a generic player.

**How to use:** Open the player-profile button and choose the closest starting
profile. Select **Enter my statistics** or **Edit statistics** to enter carry,
accuracy, and putting percentages. Review any eligible on-course club evidence,
choose **Use values** if appropriate, and then save the profile; the game never
changes these values silently.

### Feature title: Course, tee, and pin selection

**Mode:** Game Mode; select the course before entering GPS or Live Mode.

**Purpose:** Set the correct course geometry, scorecard yardage, and pin
position for the round.

**How to use:** Choose an installed course from the course menu. Select Blue,
White, or Forward tee in the course book, then choose a pin location. If another
course has an unfinished simulator round, the game asks before switching.

### Feature title: Round Card and hole navigation

**Mode:** Game Mode.

**Purpose:** Show round progress and provide fast access to any hole without
opening the full scorecard.

**How to use:** Select a hole in the compact **Round Card**, or use **Previous**
and **Next**. On mobile, select the current-hole control to open the expanded
Round Card.

### Feature title: Portable round file

**Mode:** Game Mode → Scorecard.

**Purpose:** Provide an optional manual backup of a simulator round in addition
to normal account synchronization.

**How to use:** Open **Scorecard** and choose **Save round file**. On another
device, choose **Load round file** and select the saved `.golfround` file. Loading
it replaces existing progress for that course only after confirmation.

## Simulator and strategy tools

### Feature title: Strategy simulator

**Mode:** Game Mode.

**Purpose:** Practice choosing a club, swing, target, and adjustment while a
replayable shot engine supplies realistic outcomes. It teaches course management,
not swing mechanics.

**How to use:** In **Game** mode, choose a club and swing, select or tap a target,
set any required aim adjustment, and select **Play shot**. Continue from the new
lie until the hole is complete.

### Feature title: Game Master briefing

**Mode:** Game Mode and Play GM Mode.

**Purpose:** Explain verified facts about the current situation, including lie,
distance, slope, sidehill movement, tree blockage, and recovery options.

**How to use:** Read the **Game Master** card before planning the shot. On
desktop, use the voice button if you want briefings and results spoken aloud.
Gameplay continues with built-in factual commentary when model-backed narration
is unavailable.

### Feature title: Caddie Choices

**Mode:** Game Mode and Play GM Mode.

**Purpose:** Compare an aggressive plan with a safe and practical plan using the
same player profile, course geometry, and paired simulation conditions.

**How to use:** Open **Caddie choices**, inspect the available plans, and select
the question-mark explanation for supporting evidence. Selecting a plan fills in
its club, swing, and target; select **Play shot** when ready. When only one honest
plan exists, the caddie does not invent a second one.

### Feature title: Structured aim and lie adjustment

**Mode:** Game Mode and Play GM Mode.

**Purpose:** Record the player's intended compensation clearly so course-management
scoring does not have to guess from a sentence.

**How to use:** Choose the intended aim, select **None**, **Aim left**, or **Aim
right**, and enter the offset when needed. Use the optional note only for extra
coaching context; it does not change the shot setup.

### Feature title: Shot flight, landing, and roll

**Mode:** Game Mode and Play GM Mode.

**Purpose:** Make the outcome readable while keeping the stored engine result—not
the animation—as the authority.

**How to use:** Select **Play shot** and watch the ball travel, land, and roll.
Carry and roll are displayed separately. The final lie, remaining distance, and
left/right position appear after the shot.

### Feature title: Hazard and recovery play

**Mode:** Game Mode and Play GM Mode.

**Purpose:** Teach practical decisions from bunkers, water, out of bounds, and
trees using mapped course geometry and consistent penalty rules.

**How to use:** Read the new lie and Game Master briefing after the shot. In a
tree-recovery situation, select the gold **PUNCH** marker to use the mapped safe
route, then choose a club and restricted swing. Water, out-of-bounds, and
unplayable outcomes apply their recorded relief and penalty automatically.

### Feature title: Enlarged green and putting practice

**Mode:** Game Mode and Play GM Mode.

**Purpose:** Provide a close, generated putting exercise for practicing contour,
start line, and pace decisions. It is not a survey of the physical course green.

**How to use:** When the simulated ball reaches the green, select **Enlarge
green**. Switch between Top and 3D views, zoom, rotate, or use Ball-to-pin view.
Tap a target, set putting aim and pace, and play the putt. Close the enlarged
view to return to the full hole.

### Feature title: Caddie Read

**Mode:** Game Mode and Play GM Mode → Enlarged Green.

**Purpose:** Demonstrate a defensible start line and pace window using the exact
generated contour visible in the simulator.

**How to use:** Open the enlarged green and select **Caddie read**. Compare the
suggested trace with the displayed slopes, then use it as a learning example.
Do not treat it as the line for the corresponding real-world green.

### Feature title: Play Against the Game Master

**Mode:** Play GM Mode.

**Purpose:** Let the golfer compare decisions against a strategist using an
identical locked copy of the golfer's clubs, accuracy, putting, and shot
conditions. Each competitor receives an independent, replayable execution roll,
so matching choices can still finish differently.

**How to use:** Select **Play GM** in the top toolbar, review the fairness setup,
and start the match. Plan and play normally. The comparison card shows the two
plans and results, while the competition scorecard tracks the match. On the final
putt, the Game Master completes its play before the player finishes the match.

## On-course GPS tools

### Feature title: On-course GPS round recording

**Mode:** GPS Mode.

**Purpose:** Record a real round as a sequence of actual ball locations, clubs,
swings, lies, putts, and scores without mixing it into the simulator round.

**How to use:** On the phone, select the physical course and hole, then select
**GPS** and allow precise location access. At the white tee select **Tee
location**. Choose the actual club and swing before playing. At the next ball,
select **Ball location** to finish the previous shot and add one stroke.

### Feature title: GPS Caddie Choices and saved intent

**Mode:** GPS Mode → Shot page.

**Purpose:** Offer on-course planning help and preserve what the golfer intended
so the round can be reviewed fairly later.

**How to use:** On the GPS shot page, open **Caddie choices** and select a plan,
or record your own club and swing. A selected caddie plan saves its target,
club, alternatives, and comparison shown at that moment. Choosing a plan records
intent; it does not simulate or play the real shot.

### Feature title: Lie and condition correction

**Mode:** GPS Mode → Shot page.

**Purpose:** Correct the map's detected surface and add conditions that phone GPS
cannot determine reliably.

**How to use:** After recording a location, choose **Fairway**, **Rough**,
**Bunker**, or **Recovery** when the detected lie is wrong. Record ball position,
hill direction, and rough depth when those controls are available. Selecting
**Recovery** describes the lie and does not add a penalty stroke.

### Feature title: On Green and Holed Out

**Mode:** GPS Mode → Shot and Green pages.

**Purpose:** Move from full-shot recording to a simple putting workflow without
forcing unnecessary scrolling or location captures on the green.

**How to use:** Select **On Green** beside Ball Location when the ball reaches the
green. Select **+1 Putt** for every putt that stays out. Select **Holed Out** for
the final putt; it records that stroke, completes the hole, and opens the next
hole.

### Feature title: GPS undo and Hole Review

**Mode:** GPS Mode → Hole Review.

**Purpose:** Correct on-course recording mistakes and review the completed hole
before continuing.

**How to use:** Select **Undo last** to remove the most recent location, putt, or
completion action. Open **Hole review** to inspect shot distance, club, swing,
GIR, putts, and score. If a shot has the wrong or missing club, edit it in the
review. Select **View in Live** to inspect its route on the course map.

### Feature title: GPS synchronization

**Mode:** GPS Mode.

**Purpose:** Keep recording safely when the connection is unreliable and copy
the round back to the server when service is available.

**How to use:** Watch the GPS header for **On phone**, **Syncing**, **Synced**,
**Offline**, or **Server unavailable**. Continue recording if offline; actions
save on the phone first and retry later. A newer server revision is protected
from being overwritten by an older phone copy.

### Feature title: On Course Live

**Mode:** Live Mode.

**Purpose:** Display the server copy of the real GPS round on the installed
course map without changing simulator scores or positions.

**How to use:** Leave GPS Mode with **Live**, or open Live for the same course on
another signed-in device. Use **Refresh** for the latest active hole and use hole
navigation to inspect other holes. The map shows recorded tee, numbered shot
lines, latest ball, range references, lie, distance, and GPS accuracy.

### Feature title: On-course round replay

**Mode:** Player Account → On-course replays; playback opens in Live Mode.

**Purpose:** Turn a synchronized GPS round into an evidence-based film-room
review that separates the result, the plan, and the recorded endpoint.

**How to use:** Open **Player account → On-course replays**, choose a round, and
select **Replay**. Use Previous, Play/Pause, and Next to move through the shots.
Each shot shows:

- **Result:** the recorded finish, such as Good, Mixed, or Costly result;
- **Decision:** the plan ranking saved at the time of the round; and
- **Outcome vs target:** how far the endpoint finished right/left and short/long
  of the selected target.

Older shots without a saved target show **Target not recorded**. Replay reports
GPS evidence and saved model comparisons but does not diagnose a swing cause.

## Review and learning tools

### Feature title: Scorecard

**Mode:** Game Mode.

**Purpose:** Show hole scores in traditional golf notation and provide access to
round-level controls.

**How to use:** Select **Scorecard** from the game controls. Review each hole and
the total. A circle represents birdie, a double circle eagle or better, a square
bogey, and a filled square double bogey or worse. Use its round-file controls
when a portable backup is needed.

### Feature title: Simulator Hole Review and shot replay

**Mode:** Game Mode → Review.

**Purpose:** Separate decision quality from execution quality and focus coaching
on the holes with the most useful lessons.

**How to use:** Select **Review**, choose a hole, and inspect the recorded plan,
result, decision evidence, execution evidence, hazards, and suggested improvement.
Use **Replay this shot** or **Replay every shot** to watch without adding strokes.
Use **Reset & replay Hole** only when you want to clear that hole and try another
strategy.

### Feature title: Round History

**Mode:** Player Account.

**Purpose:** Preserve completed simulator rounds and their course-management
results separately from unfinished play and GPS rounds.

**How to use:** Open **Player account → Round history**. Select a finished round
to review its course, date, strokes, and available management scores.

### Feature title: Player Learning

**Mode:** Player Account.

**Purpose:** Summarize verified strategic strengths and recurring decisions only
after enough reliable completed-round evidence exists.

**How to use:** Open **Player account → Player learning**. Review the evidence
count and any supported patterns. A building-evidence message means the system
does not yet have enough observations to make a responsible claim.

### Feature title: Top 10 rank board

**Mode:** Player Account.

**Purpose:** Rank players by course-management quality rather than rewarding only
a fortunate simulated stroke score.

**How to use:** Open **Player account → Top 10 rank board**. Each player appears
once using the best completed Course Management score; lower strokes break a tie.

### Feature title: Feedback Center

**Mode:** Player Account; available without leaving the active Game Mode round.

**Purpose:** Let a signed-in player privately report a bug, suggestion, feature
request, course-map issue, or AI Caddie concern and receive developer replies.

**How to use:** Open **Player account → Feedback Center**. Choose a category,
enter a title and comment, optionally attach a screenshot, and send it. Use **My
feedback** to read replies and see whether the report is Received, Under review,
Planned, Implemented, or Closed. The game includes useful interface context but
does not attach exact GPS coordinates.

## What players should know about the evidence

- Shot, lie, penalty, scoring, and replay facts come from the game calculations
  and course map. AI explains those facts but does not replace them.
- Simulator results and real GPS records remain separate.
- GPS endpoint data can state where a shot finished relative to its selected
  target, but it cannot determine clubface, swing path, contact, or wind.
- Historical on-course replay uses the analysis saved at the time of the round;
  it is not silently recomputed with a newer evaluator.
- Generated putting contours teach a reading process and do not represent the
  physical green at the selected course.
