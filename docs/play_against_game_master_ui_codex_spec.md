# Play Against the Game Master — UI/UX Specification
## Codex Implementation Brief

**Project:** Golf Strategy Simulator  
**Feature:** Play Against the Game Master  
**Purpose:** Create a fast, real-time competitive experience where the human plays against an AI Strategist using the same golfer profile. The interface must emphasize course strategy, comparison, and coaching without slowing down play.

> Core mobile principle: **The map is the game. Everything else overlays it only when needed.**

---

# 1. UX Goals

The mode should feel like playing alongside another golfer, not like running two separate simulators.

The UI must:

- Keep the course map as the primary visual surface.
- Show both the human and Game Master ball positions on the same map.
- Keep human shot controls immediately accessible.
- Automatically generate the Game Master's decision after the human commits a shot.
- Require no lobby, matchmaking, waiting room, or second human.
- Clearly separate **decision quality** from **shot execution/result**.
- Provide concise Game Master explanations without interrupting play.
- Support both a teaching-oriented `Normal` pace and streamlined `Fast Play`.
- Work especially well on iPhone portrait screens.
- Preserve a richer desktop layout without forcing the desktop UI onto mobile.

---

# 2. Terminology

Use:

```text
YOU
= human player

GM / Game Master
= visible AI opponent label

AI Strategist
= internal strategy engine that selects GM decisions

Game Master Coach
= Ollama explanation/narration layer
```

The UI can display `Game Master`, while internal code should keep the Strategist and LLM coach responsibilities separate.

---

# 3. Mobile Layout

Use one full-screen interactive map with overlays.

Concept:

```text
┌─────────────────────────────────┐
│ Hole 6 · Par 4 · 386 yd        │
│ YOU +2              GM +1       │
├─────────────────────────────────┤
│                                 │
│          COURSE MAP             │
│                                 │
│                    ● GM         │
│                                 │
│             ● YOU               │
│                                 │
│              ⛳                 │
│                                 │
│                                 │
├─────────────────────────────────┤
│ YOUR SHOT                       │
│ Fairway · 187 yd to pin         │
│                                 │
│ [3W] [5H] [6I] [7I] →          │
│                                 │
│ Power ─────────●── 92%          │
│                                 │
│        [ PLAY SHOT ]            │
└─────────────────────────────────┘
```

Do not permanently display a separate Game Master control panel.

The player's controls always belong to `YOU`.

---

# 4. Mobile Component Structure

Recommended component hierarchy:

```text
GameMasterCompetitionScreen
├── CompactCompetitionHeader
├── InteractiveHoleMap
│   ├── HumanBallMarker
│   ├── GameMasterBallMarker
│   ├── HumanShotPath
│   ├── GameMasterShotPath
│   ├── HumanTargetMarker
│   ├── GameMasterTargetMarker
│   ├── DispersionOverlay
│   └── HazardOverlay
├── PlayerShotBottomSheet
│   ├── CurrentLieSummary
│   ├── ClubCarousel
│   ├── PowerControl
│   ├── TargetSummary
│   └── PlayShotButton
├── GameMasterDecisionToast
├── ShotComparisonSheet
├── WhyDecisionSheet
├── CompetitionScorecardModal
└── GameMasterConversationSheet
```

---

# 5. Compact Competition Header

Keep the competition visible without consuming much space.

Default:

```text
Hole 8 · Par 4

YOU +4                    GM +2
```

Optionally include current stroke indicators:

```text
YOU +4 · Shot 2       GM +2 · Shot 2
```

Tapping the header opens the competition scorecard.

---

# 6. Player Shot Controls

Prioritize:

```text
TARGET → CLUB → POWER → PLAY
```

The player should be able to perform the normal shot without navigating away from the map.

Recommended bottom-sheet collapsed state:

```text
Fairway · 187 yd
3W · 92%
[PLAY SHOT]
```

Expanded state:

```text
YOUR SHOT

Lie: Fairway
Pin: 187 yd
Target: Center green

← 3W | 5W | 4H | 5H | 6I | 7I →

Power
70% ── 80% ── 90% ── 100%
                 ● 92%

[PLAY SHOT]
```

---

# 7. Real-Time Turn Flow

The human controls the pace.

Normal internal sequence:

```text
Human selects shot
        ↓
Human presses PLAY SHOT
        ↓
Human decision locked
        ↓
AI Strategist generates GM decision
        ↓
GM decision locked
        ↓
Paired execution sample generated
        ↓
Human shot resolved
        ↓
GM shot resolved
        ↓
Animations shown
        ↓
Short comparison
        ↓
Continue immediately
```

There must be:

- no lobby
- no waiting for another player
- no artificial turn timer
- no simulated "thinking" delay longer than necessary

---

# 8. Normal Play Mode

`Normal` mode is intended for learning.

After the human commits:

```text
YOUR CHOICE

3 Wood · 100%
Target: Green

GAME MASTER

6 Iron · 90%
Target: 65-yard layup zone

GM:
"I'm laying up because the 3-wood dispersion
brings the bunker into play and 65 yards is
inside this profile's preferred scoring range."

[PLAY BOTH SHOTS]
```

The Game Master explanation must be generated from verified strategy-engine data.

---

# 9. Fast Play Mode

Experienced players should be able to remove the extra decision screen.

Flow:

```text
Human presses PLAY
        ↓
GM decision generated and locked
        ↓
Both shots resolve
        ↓
Human animation
        ↓
GM animation
        ↓
One-line comparison
        ↓
Next shot
```

Example result toast:

```text
GM chose 6I to leave 64 yd and reduce bunker exposure.
Strategy edge: GM +0.32 expected strokes.
```

Default recommendation:

```text
New player: Normal
Returning player: remember last preference
```

---

# 10. Shot Animation

Do not animate both shots simultaneously.

Recommended sequence:

```text
Human shot animation
        ↓
Landing marker appears
        ↓
~0.5 second transition
        ↓
GM shot animation
        ↓
Landing marker appears
```

After both finish, leave both ball markers visible.

Example:

```text
                 GREEN
                   ⛳

             ● GM
             64 yd

             [Bunker]

        ● YOU
        18 yd
```

---

# 11. Player Markers

Use visually distinct markers.

Required labels:

```text
YOU
GM
```

Markers should remain understandable without relying exclusively on color.

Suggested marker information on tap:

```text
YOU
Fairway
64 yd to pin
Shot 3
```

and:

```text
GAME MASTER
Light Rough
71 yd to pin
Shot 3
```

---

# 12. Shot Path Display

After a shot, show both paths.

Support:

```text
Human path
GM path
```

Optional comparison mode can also show planned target lines.

Do not permanently show every historical path if it makes the mobile map unreadable.

Recommended:

```text
Current-hole latest paths = visible
Older paths = reduced or hidden
Tap "Shot History" = reveal all
```

---

# 13. Decision vs Result

This is a critical teaching feature.

Never imply:

```text
better outcome = better decision
```

Show decision quality separately from actual result.

Example:

```text
DECISION

YOU        88
GM         91

RESULT

YOU        Bunker
GM         Fairway
```

If the human chose the better plan but received a poor simulated result:

```text
Better decision, poor execution.

Your plan had 0.18 lower expected strokes,
but this particular execution produced an unfavorable miss.
```

If the GM made the worse decision but got lucky, state that explicitly.

---

# 14. Post-Shot Comparison Sheet

After both shots resolve, show a small draggable sheet rather than a full page.

Example:

```text
SHOT COMPARISON

YOU                  GM
3W · 100%             6I · 90%
Bunker                Fairway
18 yd                 64 yd

Decision quality
YOU 78                GM 91

Strategy Edge
GM +0.32 expected strokes

WHY?
GM kept the bunker mostly outside normal
dispersion and left a preferred wedge distance.

[WHY?]                  [CONTINUE]
```

Allow swipe-down/collapse.

Do not force multiple confirmation dialogs.

---

# 15. "Why?" Feature

Every Game Master decision should expose a small:

```text
[Why?]
```

button.

Example:

```text
GM: 6 Iron · 90%
[Why?]
```

Opening it shows:

```text
WHY I CHOSE THIS

6 Iron · 90%
Expected score: 4.87

Instead of:

3 Wood · 100%
Expected score: 5.21

Main reasons:

✓ Keeps front bunker mostly outside dispersion
✓ Reduces penalty exposure
✓ Expected leave: 64 yd
✓ 64 yd is inside preferred scoring range

[ASK GAME MASTER]
```

Numbers must come from the authoritative strategy evaluator, not the LLM.

---

# 16. Ask Game Master

`ASK GAME MASTER` opens the Ollama conversational layer.

Suggested quick questions:

```text
Why not use 3-wood?
Why is 64 yards better?
How dangerous is the bunker?
What would an aggressive golfer do?
What should I learn from this shot?
```

The player may also type a custom question.

The LLM receives the verified game-state and strategy-analysis packet.

It must not alter the game state.

---

# 17. Scorecard

Tapping the compact score header opens:

```text
              YOU       GM

Hole 1         5         4
Hole 2         4         4
Hole 3         5         5
Hole 4         6         5
...

TOTAL          +4        +2

Strategy
Score           84        91
```

Track separately:

```text
Golf Score
Strategy Score
```

Optional expanded metrics:

```text
Penalties
Bunkers
Double bogey+
GIR / target rate
Preferred-distance leaves
Decision advantage
```

---

# 18. Putting UI

When both players are on the green, simplify the interface.

Example:

```text
┌─────────────────────────────────┐
│ Hole 6 · Green                  │
│ YOU +2              GM +1       │
├─────────────────────────────────┤
│                                 │
│        GREEN / SLOPE MAP        │
│                                 │
│ YOU ● ────────↗                 │
│                   ⛳            │
│            ● GM                 │
│                                 │
├─────────────────────────────────┤
│ YOUR PUTT                       │
│ 18 ft · 1.4% R→L · uphill       │
│                                 │
│ Aim: 7" right                   │
│ Pace ───────●── 46%             │
│                                 │
│          [ PUTT ]               │
└─────────────────────────────────┘
```

After the human commits, the GM chooses its own:

```text
aim
pace
intended terminal speed
```

using the same putting skill profile.

Comparison example:

```text
YOU
Aim: 5" right
Pace: 51%

GM
Aim: 8" right
Pace: 46%
```

Again, distinguish read/pace decision quality from execution variance.

---

# 19. Hole Completion

When both players hole out:

```text
HOLE 6 COMPLETE

YOU             5
GAME MASTER     4

Strategy Edge
GM +0.6 expected strokes

Key Decision
Your second shot attacked the green with 3W.
GM laid up to 64 yd and avoided the bunker-heavy
landing zone.

[VIEW HOLE]       [NEXT HOLE]
```

Keep this concise.

---

# 20. Round Completion

At 18 holes:

```text
FINAL

YOU             89
GAME MASTER     85

Game Master wins by 4
```

Then:

```text
COURSE MANAGEMENT

YOU             84
GAME MASTER     92
```

Strategy breakdown:

```text
Tee strategy          GM +0.4
Approach strategy     GM +1.3
Layups                GM +1.6
Recovery              GM +0.9
Putting               YOU +0.2
```

Highlight 3–5 pivotal decisions.

Example:

```text
BIGGEST DIFFERENCE

Hole 7 · Shot 2

Your choice:
3W · attack green

GM:
6I · lay up to 68 yd

Expected strategy difference:
GM +0.72 strokes
```

---

# 21. Desktop Layout

Desktop may use three major regions:

```text
┌─────────────┬──────────────────────────┬─────────────┐
│ YOU         │                          │ GAME MASTER │
│             │                          │             │
│ Score +4    │        COURSE MAP        │ Score +2    │
│ Lie         │                          │ Lie         │
│ Club        │       ● YOU    ● GM      │ Last club   │
│ Power       │                          │ Strategy    │
│ Target      │                          │ Why?        │
│             │                          │             │
│ [PLAY]      │                          │             │
└─────────────┴──────────────────────────┴─────────────┘
```

Desktop can expose more analysis, but the map should remain central.

Do not force this three-column layout onto mobile.

---

# 22. Responsive Rules

## Mobile Portrait

Primary experience:

```text
Full-screen map
Compact header
Bottom-sheet controls
Temporary overlays
```

## Mobile Landscape

May use:

```text
Map left / center
Compact controls right
```

## Tablet

Allow wider bottom sheet or optional side analysis panel.

## Desktop

Allow full strategy comparison panel.

---

# 23. iPhone Requirements

Respect:

```css
padding-top: env(safe-area-inset-top);
padding-bottom: calc(12px + env(safe-area-inset-bottom));
```

Prefer:

```css
min-height: 100dvh;
```

over fixed `100vh` for the primary mobile game shell.

Important controls must remain above:

- iPhone home indicator
- browser toolbar
- Dynamic Island / top safe area

The main `PLAY SHOT` button should be reachable one-handed.

---

# 24. Loading and AI States

Do not fake long AI thinking.

If the strategy engine needs processing time:

```text
Game Master is choosing...
```

Then replace immediately when ready:

```text
GM chooses 6 Iron · 90%
```

If Ollama explanation is slower than strategy calculation:

1. Do not block gameplay.
2. Show the authoritative GM decision immediately.
3. Load the explanation asynchronously.
4. Allow the player to continue without waiting for Ollama.

Example:

```text
GM: 6 Iron · 90%

Explanation loading...
```

Then:

```text
GM: 6 Iron · 90%

Why:
Keeps the bunker outside normal dispersion
and leaves a preferred wedge distance.
```

---

# 25. Failure Handling

If Ollama is unavailable:

```text
Game Master decision:
6 Iron · 90%

Strategy data remains available.
AI explanation temporarily unavailable.
```

Gameplay must continue.

If strategy evaluation fails:

- do not allow the LLM to invent a replacement decision;
- use a deterministic documented fallback policy;
- log the failure;
- identify the decision as fallback-generated.

---

# 26. Accessibility

Required:

- Do not distinguish `YOU` and `GM` by color alone.
- Label markers with text/icons.
- Maintain usable touch targets.
- Support browser zoom where practical.
- Provide text alternatives for strategic map information.
- Ensure shot/result status can be understood without animation.
- Respect reduced-motion preference.

When reduced motion is enabled:

```text
Skip flight animation
→ show final shot path and landing result
```

---

# 27. Performance

Mobile performance is important.

Avoid rendering:

- every historical dispersion polygon
- every historical shot trace
- unnecessary map labels
- multiple heavy analysis panels simultaneously

Lazy-load:

```text
Why analysis
Full scorecard
Round analytics
Ollama conversation
```

Keep current-shot interaction responsive even if AI explanation is still processing.

---

# 28. Suggested UI State Machine

```text
READY_FOR_HUMAN
    ↓
HUMAN_EDITING_SHOT
    ↓
HUMAN_DECISION_LOCKED
    ↓
GM_DECIDING
    ↓
BOTH_DECISIONS_LOCKED
    ↓
RESOLVING
    ↓
ANIMATING_HUMAN
    ↓
ANIMATING_GM
    ↓
COMPARISON_READY
    ↓
READY_FOR_NEXT_SHOT
```

Hole completion:

```text
BOTH_HOLED_OUT
    ↓
HOLE_SUMMARY
    ↓
NEXT_HOLE
```

Round completion:

```text
ROUND_COMPLETE
    ↓
ROUND_COMPARISON
```

---

# 29. MVP UI Scope

Implement first:

- [ ] Compact `YOU vs GM` header
- [ ] One shared course map
- [ ] Human and GM ball markers
- [ ] Human shot bottom sheet
- [ ] Automatic GM decision after human commit
- [ ] Normal Play mode
- [ ] Fast Play mode
- [ ] Sequential shot animations
- [ ] Human and GM shot paths
- [ ] Post-shot comparison sheet
- [ ] Decision score separated from result
- [ ] `Why?` panel
- [ ] `Ask Game Master`
- [ ] Dual-player scorecard
- [ ] Putting comparison
- [ ] Hole summary
- [ ] Round summary
- [ ] Responsive iPhone layout
- [ ] Ollama failure does not block play

Do not require for first release:

- human multiplayer
- chat between human users
- spectators
- tournaments
- multiple AI golfers
- elaborate avatars
- voice commentary
- real-time network synchronization

---

# 30. Acceptance Criteria

The UI is complete when:

- [ ] A player can complete an entire 18-hole round against the GM without leaving the primary game experience.
- [ ] No second human or waiting room is required.
- [ ] The map remains the primary visual surface on iPhone.
- [ ] Human and GM positions are always distinguishable.
- [ ] Human shot controls are reachable without opening a separate page.
- [ ] GM responds automatically after human shot commitment.
- [ ] Normal and Fast Play modes work.
- [ ] The UI never exposes unresolved future execution to either decision maker.
- [ ] Decision quality and actual result are displayed separately.
- [ ] `Why?` uses authoritative strategy metrics.
- [ ] Ollama explanations never replace authoritative engine values.
- [ ] Ollama failure does not stop the round.
- [ ] Putting supports human-vs-GM comparison.
- [ ] Hole and round summaries explain strategic differences.
- [ ] Existing single-player mobile and desktop modes remain functional.

---

# 31. Codex Implementation Instructions

Before implementing:

1. Inspect the existing responsive game screen, map component, shot controls, scorecard, putting UI, plan comparison, and AI caddie components.
2. Reuse existing components and styles wherever possible.
3. Do not create a second independent game UI for the GM.
4. Extend the existing map to support a second participant.
5. Keep authoritative simulation data separate from presentation state.
6. Treat Ollama explanations as optional asynchronous UI content.
7. Preserve existing single-player behavior.
8. Implement mobile-first and verify on iPhone-sized viewports.
9. Avoid unnecessary modal navigation; prefer bottom sheets, overlays, and expandable panels.
10. Add UI/component tests for the competition state transitions.

The desired experience is:

> **I choose my shot, the Game Master immediately chooses its shot, we both play, I see the strategic difference, and I continue — all from the same course screen.**

The experience should feel fast enough to play for 18 holes while still making the Game Master useful as a coach.
