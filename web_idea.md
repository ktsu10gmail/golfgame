# Promotional Website Concept

## Core Positioning

The website should present the game as a golf strategy trainer—not as a swing
or physics simulator.

> **Play the shot before you swing it.**  
> Train course-management decisions at home. Use GPS Mode on the course.
> Compare your plan with what actually happened.

The central story is a continuous learning loop:

```text
Practice on PC → Choose a strategy → Play it on course → Record the result → Learn for next time
```

The main differentiator is the connection between decisions practiced at home
and decisions verified on the real course.

## Recommended Page Structure

### 1. Hero

- Show the desktop strategy game and mobile GPS Mode together.
- Use **Start a Strategy Round** as the primary action.
- Use **See GPS Mode** as the secondary action.
- Lead with strategy training rather than AI or simulation technology.

### 2. Think Before Every Swing

- Read the lie, slope, distance, hazards, and target.
- Compare **Aggressive** with **Safe & Smart**.
- Choose the player's own club and power when preferred.
- Reinforce that the player makes the final decision.

### 3. Take the Strategy Onto the Course

- Show the player's current GPS position and distance to the pin.
- Show the Ball, Hill, and Rough condition selectors.
- Show club, power, and strategy selection.
- Show that the on-course record is synchronized to the player's account.

### 4. Verify the Decision

- Place the planned strategy beside the actual result.
- Explain what was strategically sound and what could improve.
- Clearly distinguish decision quality from swing execution.
- Avoid judging a good decision only by whether one probabilistic shot happened
  to succeed.

### 5. Build a Smarter Playing Profile

- Explain personal club distances and dispersion.
- Explain that real on-course evidence can eventually support player-approved
  profile recommendations.
- Present post-round learning as a better alternative to generic golf advice.
- Do not claim that simulated execution measures real golfing ability.

### 6. Mapped Courses and Final Invitation

- Show several available mapped courses.
- Explain that mapped fairways, greens, bunkers, water, tees, and pins support
  the strategy calculations.
- Finish with **Play smarter on your next round**.

## Visual Direction

Use the visual language of a premium digital yardage book rather than a generic
software landing page.

Suggested palette:

- deep pine green;
- fairway green;
- sand-gold accents;
- warm scorecard paper;
- restrained red for risk and aggressive decisions.

A dashed shot line should travel through the page, connecting the desktop
strategy screen to mobile GPS Mode and finally to the learning review. This
becomes the website's distinctive visual signature and communicates the full
practice-to-course loop.

Use restrained motion to trace the line or reveal the steps. Respect the
browser's reduced-motion preference.

## Screenshot Plan

Existing Playwright PNG files can provide source material, but development
screenshots should not automatically become marketing assets. Capture a small,
consistent, polished set with current UI and staged demonstration data.

Recommended final captures:

1. Current desktop strategy view with only **Aggressive** and **Safe & Smart**.
2. A clear target and planned shot line on the mapped hole.
3. Current GPS Mode with Ball, Hill, and Rough conditions plus **Synced**.
4. An actual recorded shot result with useful context.
5. A complete, meaningful post-round review without errors or unavailable AI.
6. The 3D contour green as a visually strong secondary feature.

Capture requirements:

- Use a generic account such as **Demo Golfer**.
- Do not expose a real player's identity, email address, or private round.
- Avoid incomplete holes, error messages, debug controls, and stale UI.
- Use consistent desktop and iPhone-sized viewports.
- Retain the PNG originals and publish optimized WebP/AVIF versions with
  responsive dimensions and useful alternative text.
- Do not use the obsolete screenshot that displays three strategy choices.
- Do not use a review screenshot containing **AI insight unavailable**.

Device frames and selective cropping can help visitors understand which view
belongs on the computer and which belongs on the course, but the actual game UI
should remain the focus.

## Messaging Principles

- Say **strategy trainer**, not merely **AI golf simulator**.
- Emphasize thinking before swinging.
- Explain the connection between intention, decision, and actual result.
- Present AI as a caddie and reference—not as the player's decision-maker.
- Avoid guarantees that the product will lower a golfer's score.
- Avoid presenting planned functionality as already available.
- The future PC On-Course Round Replay may appear as **Coming Soon** only when
  that designation is useful and intentional.

## Suggested Headline and Supporting Copy

### Headline

**Play the shot before you swing it.**

### Supporting copy

Practice course-management decisions at home, carry the same strategy onto the
course with GPS Mode, and learn from the difference between what you intended
and what actually happened.

### Primary actions

- **Start a Strategy Round**
- **See GPS Mode**

### Closing line

**Play smarter on your next round.**

## Build Boundary

This document describes the website concept only. Before building, confirm the
public product name, destination for the primary action, hosting/domain plan,
and which features should be described as current versus coming soon.
