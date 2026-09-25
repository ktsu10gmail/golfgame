# Mobile Full-Screen Shot Plan and Map View

## Bottom-Sheet Improvement Specification

**Status:** Implemented — September 22, 2026  
**Applies to:** Mobile layouts in all four game modes  
**Modes:** 18-hole round, Golf Academy, 3-hole match, and 18-hole match  
**Primary goal:** Let the player dedicate the mobile screen to either planning a shot or viewing the map, with a fast and predictable transition between the two.

---

## 1. Problem

The mobile shot-plan/control panel and the course map currently compete for limited vertical space. While setting up a shot, the player needs enough room to see all controls clearly. While reviewing the target or watching a shot, the player needs the largest practical map view.

The interface should not force the player to view partial versions of both surfaces at the same time.

---

## 2. Product Principle

> On mobile, show the complete shot-planning experience when the player is configuring a shot, and show the complete visual map when the player is aiming, reviewing, or watching the shot.

The shot plan becomes a bottom sheet with two primary states:

1. **Minimized:** a compact bar at the bottom; the map receives nearly the full screen.
2. **Expanded:** the shot plan fills the available screen; all controls can be viewed and edited.

The player must always be able to minimize the expanded shot plan without playing a shot.

---

## 3. Scope

Use the same interaction model in:

- 18-hole round;
- Golf Academy;
- 3-hole match;
- 18-hole match.

The content inside the sheet may vary by mode, but its position, state transitions, minimize control, accessibility behavior, and map relationship must remain consistent.

This improvement applies only at the existing mobile breakpoint. Desktop shot controls should remain unchanged.

---

## 4. Core User Flow

```text
Map visible
    ↓ tap minimized Shot plan bar
Full-screen shot plan
    ↓ configure club, swing, aim, target, shot type, and adjustment
    ├─ tap Minimize → full map, settings preserved
    └─ tap Play → submit shot → sheet minimizes automatically → full map
```

The player can reopen the sheet at any time by tapping the minimized bar. Reopening it must show the current, previously selected shot settings.

---

## 5. Required States

### 5.1 Minimized / Map-First

The minimized state should occupy only the bottom safe area plus a compact, touch-safe bar.

It should show, where available:

- **Shot plan** label;
- selected club and swing length;
- target or distance summary;
- a clear expand affordance such as an upward chevron;
- a touch target of at least 44 × 44 CSS pixels.

Example:

```text
┌──────────────────────────────────┐
│                                  │
│          FULL COURSE MAP         │
│                                  │
├──────────────────────────────────┤
│ Shot plan · 7 Iron · Full    ⌃   │
└──────────────────────────────────┘
```

The compact bar must not cover important map controls. The map viewport and camera calculations should account for the minimized bar and the device safe-area inset.

### 5.2 Expanded / Plan-First

The expanded state should fill the usable viewport above the bottom safe area. It should provide a dedicated, scrollable shot-planning surface rather than leaving a narrow strip of map visible.

The header must remain visible while the sheet content scrolls and contain:

- the current title, such as **Shot plan**;
- useful shot/hole context;
- a visible **Minimize** button;
- an accessible label, `Minimize shot plan and show map`.

Example:

```text
┌──────────────────────────────────┐
│ Shot plan                 ─  Minimize │
├──────────────────────────────────┤
│ Lie / distance / target summary  │
│                                  │
│ Club and swing                   │
│ Aim mode and target              │
│ Game Master / strategy options   │
│ Shot type and adjustment         │
│                                  │
│             [ Play ]             │
└──────────────────────────────────┘
```

The expanded content must present all five control sections on one vertically scrollable page. Do not split the controls into separate carousel pages. Keep this order: Shot overview, Game Master, Club & swing, Caddie choices, then Adjustment & play.

### 5.3 Shot in Progress

After a valid Play action:

- minimize the sheet automatically;
- show the full map before the shot animation or result visualization begins;
- prevent accidental duplicate Play submissions while processing;
- preserve the submitted setup for the shot record;
- keep the sheet minimized when the shot finishes, unless a blocking decision requires player input.

### 5.4 Validation Error

If Play cannot proceed because a required choice is missing or invalid:

- do **not** minimize the sheet;
- keep it expanded;
- show the validation message near the relevant control;
- move focus to the first invalid field or its error summary.

This ensures the player is not returned to the map before fixing the setup.

---

## 6. Minimize Button

Add a dedicated minimize button to the expanded shot-plan header. It must be available from every shot-plan section, including the final adjustment/Play section.

Requirements:

- use a familiar down-chevron, horizontal-line, or collapse icon with visible text where space permits;
- do not use an unlabeled icon for assistive technology;
- keep the control in the sticky header so scrolling cannot hide it;
- preserve every current input when pressed;
- return focus to the minimized Shot plan bar;
- reveal the map immediately without submitting or changing the shot;
- do not treat minimizing as Cancel or Reset.

The existing drag/move control must not be the only way to minimize the panel. A direct tap target is required.

---

## 7. Expansion Behavior

The sheet can be expanded by:

- tapping the minimized Shot plan bar;
- tapping its expand icon;
- optionally swiping upward from the bar if reliable gesture support is retained.

The button interaction is mandatory. Gesture interaction is an enhancement and must not be the only method.

When expanded:

- lock background map interaction so taps and gestures do not accidentally move the target;
- prevent background-page scrolling;
- place focus in the sheet header or on the last active shot-plan control;
- keep the Play action reachable without horizontal scrolling.

---

## 8. Play Behavior

The existing Play action remains the authoritative shot-submission action.

On successful activation:

1. Validate the current shot settings.
2. Disable Play while the request/animation is being started.
3. Change the sheet to the minimized state.
4. Restore the map as the primary visual surface.
5. run the shot animation and show its result.

The automatic minimize must happen for Play actions in all four modes, including mode-specific Play buttons or submission handlers.

Do not wait until the entire animation finishes to minimize. The purpose of the transition is to let the player see the shot on the map.

---

## 9. State Rules

Use one authoritative UI state for the mobile shot sheet, for example:

```text
mobileShotSheetState = "minimized" | "expanded"
```

Required rules:

| Event | Current state | Resulting state |
|---|---|---|
| Enter a playable hole on mobile | Any | Minimized |
| Tap minimized bar | Minimized | Expanded |
| Tap Minimize | Expanded | Minimized |
| Submit a valid Play action | Expanded | Minimized |
| Submit an invalid Play action | Expanded | Expanded |
| Finish shot animation | Minimized | Minimized |
| Move to next hole | Any | Minimized |
| Rotate or resize while mobile | Either | Preserve current state when practical |
| Leave mobile breakpoint | Either | Use existing desktop layout |

Mode switches must not create separate, inconsistent bottom-sheet implementations.

---

## 10. Mode-Specific Expectations

### 18-Hole Round

- Support the complete shot configuration flow.
- Automatically minimize after every successful Play action.

### Golf Academy

- Preserve Academy-specific controls, prompts, and feedback in the expanded sheet.
- Minimize after a valid practice-shot Play action so the player can watch the map.
- Reopening must retain the current drill context.

### 3-Hole Match

- Preserve player and Game Master status/context.
- Minimize after the player's valid Play action.
- Do not obscure opponent/result map visuals with an automatically reopened sheet.

### 18-Hole Match

- Use the same behavior as the 3-hole match.
- Preserve match status and selected shot controls across manual minimize/expand actions.

---

## 11. Accessibility and Mobile Details

- Use a button for Minimize and a button for the minimized expansion bar.
- Keep interactive targets at least 44 × 44 CSS pixels.
- Apply accurate `aria-expanded` and `aria-controls` values to the expansion control.
- Announce state changes with concise text only when necessary; avoid announcing every animation frame.
- Keep visible focus styles.
- Honor `prefers-reduced-motion` by replacing the sliding animation with an immediate or short fade transition.
- Account for `env(safe-area-inset-bottom)` on devices with a home indicator.
- Use dynamic viewport units (`dvh`) or an equivalent measured viewport so browser chrome and the on-screen keyboard do not hide controls.
- When a form field opens the keyboard, keep that field and the Play action reachable through vertical scrolling.

---

## 12. Animation

Use a short vertical sheet transition, approximately 180–250 ms, with an ease-out curve for opening and closing.

Animation must not delay shot submission. The map can begin preparing the shot visualization while the sheet closes.

Avoid bouncy motion because this is a frequent gameplay interaction.

---

## 13. Implementation Notes for the Current UI

The current mobile surface already uses `#mobile-shot-sheet` and mobile carousel section markup. Extend that existing surface rather than introducing a second overlapping panel, but render its five sections as one continuous mobile page.

Suggested changes:

- replace or normalize the current sheet-state values with explicit `minimized` and `expanded` states;
- add a dedicated minimize button to `.mobile-carousel-header`;
- keep the minimized summary bar outside the scrollable expanded content;
- route every mobile Play submission through one successful-submit callback that minimizes the sheet;
- route validation failures before that callback;
- ensure the four values of `#game-mode-select` (`round`, `academy`, `challenge`, and `competition`) share the behavior;
- leave desktop `.desktop-shot-plan` and `.desktop-shot-controls` behavior unchanged.

The existing dock/move preference may remain if still useful, but it must not conflict with the bottom-sheet model. On mobile, the minimized resting position is always at the bottom.

---

## 14. Out of Scope

- Redesigning the underlying shot-selection rules.
- Changing simulation or scoring behavior.
- Changing desktop control layouts.
- Resetting shot inputs when the panel is minimized.
- Automatically playing a shot when the panel closes.
- Requiring swipe gestures.

---

## 15. Acceptance Criteria

- [ ] In each of the four game modes, the mobile shot plan can be expanded to use the full usable screen.
- [ ] In each mode, the sheet has a clearly visible Minimize button in its persistent header.
- [ ] Tapping Minimize immediately reveals the full map without playing, canceling, or resetting the shot.
- [ ] The minimized bar remains available at the bottom and can reopen the shot plan.
- [ ] Selected club, swing, aim, target, shot type, strategy, and adjustment values survive minimize/reopen when applicable.
- [ ] A successful Play action minimizes the sheet before the shot visualization begins.
- [ ] An invalid Play action keeps the sheet open and identifies the field that needs attention.
- [ ] The sheet remains minimized after the animation/result so the map stays visible.
- [ ] Entering a new playable hole starts in the minimized state.
- [ ] Map controls and important map content are not covered by the minimized bar.
- [ ] The layout respects device safe areas and the mobile on-screen keyboard.
- [ ] Minimize and expand actions are usable with touch and keyboard and expose correct accessible labels/state.
- [ ] Reduced-motion users are not forced to watch a sliding transition.
- [ ] Desktop layouts and behavior are unchanged.

---

## 16. Test Matrix

Test at minimum:

- all four modes;
- narrow and wide phone widths;
- portrait orientation and a rotation to landscape/back;
- iOS Safari safe-area behavior;
- Android Chrome browser chrome and keyboard behavior;
- manual minimize from every shot-plan section;
- reopen with settings preserved;
- valid Play and invalid Play;
- rapid double-tap on Play;
- reduced-motion preference;
- keyboard-only expand, minimize, and form navigation;
- transition to the next hole;
- resize from mobile to desktop and back.

---

## 17. Definition of Done

This improvement is complete when a mobile player in any of the four modes can deliberately switch between a full shot-planning surface and a nearly full-screen map, can minimize the plan at any time without losing work, and is automatically returned to the map after a valid Play action.
