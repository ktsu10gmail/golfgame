# Player's Guide

> Think → Choose → Commit → Learn

## What this game is for

This is a golf strategy game, not a swing simulator. Its purpose is to help you make a deliberate decision before every shot.

Your simulated stroke score makes the round feel like golf, but Course Management is the more important learning measure. It evaluates decisions such as:

- Reading the lie, stance, slope, elevation, and ball position
- Choosing a club and swing that fit your player profile
- Selecting a sensible target and preferred miss
- Respecting bunkers, water, out of bounds, trees, and recovery situations
- Recognizing when a safe advance is better than a low-percentage hero shot
- Responding intelligently when the previous shot does not go as planned

A high Course Management score means you managed the course well using the information available and the abilities recorded in your profile. A lucky result does not make a poor decision correct, and normal shot dispersion does not make a sound decision wrong.

The habit to build is simple: think before you swing.

## 1. Sign in and resume on any device

Create an account with your player name, email address, and password. Confirm your email if requested. Use the same account on your computer and phone.

The game automatically saves an unfinished simulator round to your account. When you sign in on another device, the same round, hole, score, ball position, and player profile can be restored.

If you forget your password, select Forgot password? on the sign-in screen. Follow the link in the email and enter a new password when the game reopens.

Your account menu provides access to:

- Your playing profile and personal statistics
- Completed simulator round history
- Player Learning summaries
- The Top 10 rank board
- Sign out

## 2. Create an accurate player profile

Choose the built-in profile closest to your current ability, then select Enter my statistics or Edit statistics to create your personal profile.

Enter:

- Full-swing carry distance for each club
- Accuracy percentage for each club
- Putting make percentages from 3, 6, and 10 feet

The profile uses your player name instead of retaining a generic label such as “90+ player.” Your profile follows your account to every device.

Profile accuracy matters. Club selection, shot dispersion, putting probability, and caddie recommendations all use this information. Update it when your real golf changes.

Simulator-generated shot distances are not treated as proof of your real club distance. Real on-course evidence remains clearly distinguished from simulated outcomes.

The statistics editor shows accumulated on-course evidence beside each club in your saved profile. Because phone GPS records the total distance between ball locations rather than airborne carry, the game estimates carry as 90% of the measured distance. Only normal full swings finishing within 20% of the club's established distance contribute to that carry average. Eligible mishits are excluded from the carry average but still count against on-course accuracy. Poor GPS fixes, recovery shots, severe lies, putts, and partial swings are excluded from this comparison.

The evidence card shows the number of attempts, successful shots, rounds, and its confidence level. After at least three successful shots, select **Use values** to copy the observed carry and accuracy into the editable fields. Review the change, then select **Save profile**; the game never updates a player's profile silently.

## 3. Choose a course, tee, and pin

Select an installed course from the course menu, then choose Blue, White, or Forward tee. The course book shows the hole’s par, handicap, and tee yardage.

Installed course maps may contain:

- Tee boxes
- Fairway and rough
- Greens and contour models
- Bunkers and water
- Trees and recovery areas
- Cart paths, streams, and out-of-bounds areas

The pin location rotates to provide different strategic situations. The hole map’s update date helps identify the installed mapping version.

Changing course while a simulator round is in progress asks for confirmation. The unfinished round is saved before the new course opens.

## 4. Understand the two map modes

The map has two clearly separated modes.

### Simulator

Simulator is the normal strategy game. You choose a club, swing, target, and adjustment; the shot engine produces a realistic probabilistic result. These shots count toward the simulator score, Course Management review, and completed simulator history.

Normal play uses realistic randomness based on the player profile, club, lie, and shot conditions. Recorded seed information makes the same shot reproducible for replay and debugging; it does not make every new attempt produce the same result.

### On Course Live

On Course Live is a read-only view of the latest GPS round recorded for the selected course under the same player account.

It shows:

- The recorded tee position
- Numbered real-shot lines
- The latest recorded ball position
- Current lie and distance to the pin
- GPS accuracy
- Total recorded strokes and current-hole strokes
- The latest club or strategy record
- How recently the server copy was updated

The view refreshes from the server approximately every five seconds. Select Refresh to return to the hole with the newest GPS activity. You can also use Previous and Next to inspect another hole without being forced back automatically.

On Course Live never adds GPS shots to the simulator, changes the simulator score, or treats measured GPS travel as simulated club carry.

## 5. Read the Game Master before choosing a shot

The Game Master provides the calculated facts for the ball’s current situation. Depending on the shot, this may include:

- Distance to the pin or cup
- Current lie
- Ball above, below, or level with your feet
- Uphill, downhill, or nearly level slope
- Expected sidehill movement
- Tree blockage and the available recovery direction
- Distance to the useful end of the fairway in a recovery situation

Read this message first. It describes the problem you need to solve.

On the desktop, Game Master voice can announce the result and next situation when Voice is enabled.

## 6. Plan a simulator shot manually

For a normal full shot:

1. Select a club.
2. Select a quarter, half, three-quarter, or full swing.
3. Move the pointer over the map to preview distance from the ball.
4. Choose Selected target and click or tap the intended target. You may do these in either order.
5. Check the target distance and projected distance remaining to the pin.
6. Complete the Aim and Lie Adjustment controls when needed.
7. Add an optional coaching note if you want the review to remember your thinking.
8. Select Play shot.

Changing club or swing updates the calculated carry shown beside the club. A manually selected club and swing also create a target preview before you commit.

On the green, putter pace remains a fine percentage because small pace changes matter more than quarter-swing labels.

The shot is not committed until you select Play shot. Moving the pointer only previews yardage; clicking or tapping fixes the target.

### Mobile shot controls

On a phone, the compact movable panel contains five sections:

1. Shot Plan
2. Game Master
3. Club and Power
4. Caddie Choices
5. Adjustment and Play

Use the up and down controls to move through the sections. Select Move to dock the panel at the top or bottom of the map. Moving the panel never moves a target that has already been selected.

## 7. Use Caddie Choices when you need a second opinion

The game offers up to two distinct plans when two meaningful choices exist:

- Aggressive: pursues the strongest scoring opportunity while accepting more exposure or dispersion.
- Safe & Smart: selects the best practical course-management option for the current lie, mapped hazards, and player profile.

If only one honest plan exists, the game may show one recommendation instead of inventing a duplicate choice.

Open Caddie Choices and select the question-mark explanation to see why a plan was offered. The explanation can include intended carry, expected finish, remaining distance, mapped hazards, likely dispersion, and the reason the plan is aggressive or safer.

The strategy engine compares choices by running hundreds of paired outcomes through the same authoritative shot engine. Each candidate receives the same test conditions, allowing the game to compare playable finishes, hazards, dispersion, and remaining distance fairly. AI may explain this evidence, but it does not invent or replace the calculated ranking.

Selecting a caddie choice prepares its club, swing, and fixed target. It does not play automatically. Selecting Play shot confirms the choice.

Caddie choices are recommendations, not commands. You can always return to your own club, swing, and target.

## 8. Record your adjustment with the structured controls

The game no longer depends on interpreting a sentence to decide the actual shot setup. Use the dropdown controls so your intention is unambiguous.

Aim options include:

- Pin
- Selected target

Lie Adjustment options include:

- None
- Aim left
- Aim right

When left or right is selected, choose the offset in yards. For putting, use the putting aim controls for the cup or an offset from the cup.

The optional message box is a coaching note. It records additional thinking for later analysis, but it cannot silently change the selected club, swing, or target.

A correct adjustment can temporarily improve the effective accuracy of that shot. For example, correctly compensating for a verified sidehill lie can earn an accuracy bonus, subject to a cap. The permanent club accuracy in your profile does not change from one simulated decision.

## 9. Know what each feedback area means

### Game Master

The Game Master reports authoritative calculated conditions, confirms the setup, and reports the next lie after the shot. After a non-putting shot, the mobile shot controls return to the Game Master section so the new lie is visible immediately.

### Shot Result

The result appears immediately without waiting for AI. It shows where the ball finished, the remaining distance, and how far it is left or right of the pin line.

“42 yards left of the pin line” describes the final location relative to the intended pin line. It does not by itself prove that the swing was a slice, hook, pull, or push.

### AI Caddie

AI commentary is separate from the authoritative result. It can arrive afterward without delaying play. It uses verified shot facts and available golf guidance to explain what you recognized, what deserved credit, and what could improve.

AI is coaching support, not the shot calculator. If AI is unavailable, the deterministic result, scoring, and review evidence remain complete.

## 10. Watch the shot and replay it

Full shots display a visible ball flight and landing sequence. Carry and roll are represented separately, and the final ball position comes from the authoritative shot result rather than the animation frame.

Putting displays a slower contour-aware roll so you can see the route to the finishing point.

Open Review and use Replay every shot or Replay this shot to watch a recorded simulator shot again. Replaying the animation does not add another stroke.

Reset & replay Hole clears that hole after confirmation and lets you test a different strategy. Reset hole also asks for confirmation before removing the current hole’s progress.

## 11. Handle trees, hazards, and recovery situations

Mapped geometry—not AI wording—determines whether the ball is in fairway, rough, bunker, water, trees, or out of bounds.

When the ball is in trees, the Game Master selects from verified recovery conditions. It reports whether the pin line is blocked and places a gold **PUNCH** target near the middle of the mapped safe fairway interval. The message gives the target distance, angle left or right of the pin line, clock direction when facing the pin, and the available margin before and beyond the target.

The recovery marker is guidance, not an automatic shot selection. Tap or click the gold marker to use that line, then choose a club and swing that fit the reported canopy and swing-room restriction.

Tree restrictions do not apply to a ball on a mapped tee box.

Water, out of bounds, and unplayable situations use authoritative penalty and relief rules. Bunker and water calculations use the invisible geometry installed with the course, even when decorative artwork extends beyond it.

## 12. Practice green reading in the simulator

Putting mode is a procedural mini-game and green-reading exercise. Its green is generated by the game; it is **not a replica, scan, or survey of the physical green at the selected golf course**. Use the exercise to practice a repeatable reading process inside the simulator, not to choose a real-world putting line.

When the simulated ball reaches the green, the game changes to a close putting view. Pointer hover on the top view reports distance from the simulated ball and from the cup.

Select Enlarge Green for a more detailed view. The enlarged-green toolbar provides:

- Top view
- 3D view
- Green zoom from 1× through 5×
- Ball-to-pin view
- Quarter-turn rotation
- Close enlarged view

At every zoom level, the view keeps the ball and cup as the focus. You can click or tap a target in Top or 3D view. The putting controls let you select the target, adjust pace, and play without leaving the enlarged view.

Select Caddie Read to see how a starting line and pace window can be derived from the **generated contour currently shown on screen**. The line is correct only for that simulated contour. It is an example of the reasoning process—not a read of the corresponding real green and not a promise that the simulated putt will be holed.

The simulated ball follows the same generic contour field shown by the colors and slope arrows. The top and 3D views are two presentations of that same elevation model.

Long putts become progressively less precise from 15 feet onward. Downhill and heavily breaking putts receive additional dispersion, while stronger putting profiles remain more consistent. A putt finishing within two feet is a gimme and triggers the gimme completion message.

## 13. Know what the putting exercise can teach

The generated green changes orientation, shape, contour, and pin position to create varied practice problems. The transferable lesson is the decision process; the exact aim point, break amount, pace percentage, and ball path apply only to the on-screen exercise.

Use it to practice:

- Reading high and low areas
- Choosing a start line
- Matching pace to break and slope
- Planning an approach that leaves a simpler next putt
- Accepting realistic three-putt pressure on long putts

On a physical course, read the actual green, grain, moisture, speed, and cup location yourself. Do not carry the simulator's displayed line or pace percentage into GPS play as though it described that course's real putting surface.

## 14. Record a real round with GPS Mode

GPS Mode is designed for use at a calibrated installed course on your phone.

For at-home interface testing, use the **Page preview** menu at the top of GPS Mode. It can display Tee setup, Shot page, Green page, or Hole Review without requesting a location or changing the saved round. Preview controls are intentionally read-only. Return to **Current round** before recording real play.

Before starting:

1. Sign in to the same account used by the game.
2. Select the course you are physically playing.
3. Open the correct hole.
4. Select GPS.
5. Allow precise location access in the browser.

At the white tee, select Tee location. This establishes the starting position and does not add a stroke.

Before hitting, choose your own club and quarter, half, three-quarter, or full swing. If you want help, select **Caddie choices** to reveal the Aggressive and Safe & Smart plans.

The selection records the decision you considered. GPS Mode does not swing the club or simulate the shot.

When you reach the ball, select Ball location. This completes the previous shot, records the ending GPS position, and adds one stroke. Repeat at each new ball location.

The map estimates the surface lie. Correct it when necessary by selecting Fairway, Rough, Bunker, or Recovery. Then record:

- Ball: TBD, Level, Above feet, or Below feet
- Hill: TBD, Level, Uphill, or Downhill
- Rough: TBD, Light, Mild, or Deep when applicable

When GPS and the mapped course data cannot determine these conditions, the practical defaults are **Level** ball position, **Level** hill, and **Light** rough. Correct any default that does not match the actual lie before choosing your shot.

On the green, select **+1 putt after every putt**, including the putt that goes in. Then select the **next-hole arrow (→)** to finish the current hole and continue. Finishing the hole does not add another stroke. Select **Hole review** to see every recorded shot with its club and distance, GIR status, putts, and final score. Use Undo last if you record a location, putt, or hole completion incorrectly.

Phone GPS measures travel between two recorded ball locations. That number includes carry, roll, measurement error, and the route between fixes. It must not be interpreted automatically as exact airborne club carry.

## 15. GPS saving and synchronization

Every GPS action saves to the phone first, then synchronizes a versioned copy to the signed-in account on the game server.

The GPS header reports states such as:

- Saved on phone
- Syncing
- Synced
- Offline
- Server unavailable

If the connection is interrupted, continue recording. The phone copy remains available and later edits or reconnecting will retry synchronization. A newer server revision cannot be overwritten by an older phone copy.

After leaving GPS Mode, the game opens On Course Live so the recorded path is immediately visible on the installed course map. On another signed-in device, select the same course and then On Course Live.

Current simulator history and GPS records remain separate. Combined simulator-versus-on-course history and reflective on-course replay are future features; the live map does not pretend they already exist.

## 16. Read the scorecard, Round Card, and review

The Scorecard uses traditional visual notation:

- Circle for birdie
- Double circle for eagle or better
- Square for bogey
- Filled square for double bogey or worse
- Plain score for par

The compact Round Card is for hole navigation and progress. Select the current-hole control on mobile to open it.

The Scorecard also provides Save round file and Load round file. Account synchronization is the normal way to resume on another device; a round file is an optional portable backup that includes the player profile, scores, current position, and replayable shot history.

Review focuses on meaningful learning holes instead of filling the report with routine holes. A selected hole can include:

- Hole par, tee yardage, handicap, and score
- The recorded player decision
- Decision quality versus execution quality
- Correct lie recognition and adjustment credit
- Preferred miss and hazard evidence
- One useful improvement for next time
- AI Caddie insight when available
- Shot replay and Reset & replay Hole

Different review colors help identify strong holes, neutral holes, and holes with a useful improvement opportunity.

## 17. Use Round History, Player Learning, and the rank board correctly

Round History stores completed simulator rounds under your account. It shows course, score, and Course Management information without mixing in an unfinished round.

Player Learning summarizes verified strategic patterns from completed rounds. It needs enough reliable evidence before presenting a trend. Simulated approach distances are not treated as measured proof that your real golf is better from one distance band than another.

The Top 10 rank board uses each player’s best completed Course Management score. Lower stroke score is the tiebreaker when Course Management scores are equal.

Course Management is the ranking measure because the game is designed to reward thinking, not merely a favorable random simulated outcome.

## 18. Send feedback or read a developer reply

Open **Account → Feedback Center**. This does not pause, reset, or change the
shot you are planning.

Use **Send feedback** to update your 1–5 star rating or send a private message.
Choose Bug, Suggestion, Feature request, Course or map, AI Caddie, or Other.
Add a short title and enough detail for the developer to understand what
happened. An optional screenshot can make a map or display problem easier to
identify.

The game automatically includes useful technical context such as the course,
hole, play mode, lie, screen size, and browser. It does not include your exact
GPS coordinates. Your screenshot and message are visible only to your account
and the developer.

Use **My feedback** to see whether a report is Received, Under review, Planned,
Implemented, or Closed. A number on Feedback Center means that a developer has
replied. Open the message to read the reply and continue the conversation.

## 19. A useful routine for every shot

1. Read the lie and location.
2. Identify the trouble and the safest useful miss.
3. Choose your own club and swing first.
4. Use Caddie Choices if you want a comparison.
5. Fix the target on the map.
6. Record the necessary lie adjustment.
7. Commit with Play shot.
8. Separate decision quality from execution quality.
9. Continue from the new lie.

## The questions to ask yourself

Do not judge a decision only by whether one simulated ball finished close to the pin. Ask:

1. Did I read the condition correctly?
2. Did my club, swing, and target fit that condition?
3. Did I account for the safest useful miss?
4. Did I understand the next shot I was leaving?
5. Was the outcome caused by my decision, normal dispersion, or both?
6. What should I repeat or change next time?

When that thought process becomes natural, the game has done its job.
