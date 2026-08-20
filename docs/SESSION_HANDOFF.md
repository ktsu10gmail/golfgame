# Session Handoff

Last updated: 2026-08-11

Use this file to resume work after a reboot or in a new Codex conversation.
Project phase history remains authoritative in `docs/PROJECT_PHASES.md`.

## Current repository state

- Repository: `https://github.com/ktsu10gmail/golfgame.git`
- Branch: `main`
- Last recorded pushed commit: `fe7e691 Clarify greenside distance coaching`
- Phase 1: complete
- Phase 2: complete
- Phase 3 work packages 1–6: complete
- Automated verification baseline: 214 tests executed (82 Node/browser and 132
  Python: 205 passing, 9 optional-integration skips)
- Active work: the documented core work packages and the current mobile UI
  refinement pass are complete. Next perform a release-readiness review and a
  physical-device acceptance round. Engagement checkpoints and Friend
  Challenges remain intentionally deferred in `IMPROVEMENT.md`.
- Latest UI verification: all 149 Node/browser tests pass. The complete Python
  suite was not rerun during the final CSS/UI-only pass and remains part of the
  release-readiness check.

## Latest mobile and enlarged-green improvements

Completed on 2026-08-11:

- The mobile course SVG now uses the full available vertical map region instead
  of letterboxing the hole inside a square viewport. Desktop, putting, and
  enlarged-green projections retain their intended proportions.
- The floating mobile shot carousel now has only **Top** and **Bottom** docking
  positions. Its centered **Move** control toggles or drags between them. A
  touch-specific delayed-click guard prevents iPhone Chrome/WebKit from moving
  the selected map target when the carousel moves.
- The mobile header is icon-first: Guide, Reset Game, Player Account, and Player
  Profile use compact accessible icons. The repeated brand text and map-version
  line are hidden on mobile so the course selector receives the remaining room.
- Hole information, Reset Hole, Enlarge Green, and GPS share one 32px-high row.
  Reset Hole and Enlarge Green use icons; GPS deliberately retains its label.
- Reset Hole now opens a dedicated confirmation dialog. **Keep playing** changes
  nothing; **Reset hole** clears only the current hole's shots, score, target,
  and messages. The Enlarge Green action opens directly and has no confirmation.
- The map legend and the non-putting **Adjust line · 1 yd** pad are removed.
  Fine one-inch line adjustment remains available for putting.
- The off-green enlarged-green shot panel now uses a compact **Approach preview**
  summary. Club, Power, and Play Shot fit on one row, and the panel is fixed to
  the visible mobile viewport with Chrome-safe bottom clearance.
- Enlarged Green now has one unified top toolbar: **Top / 3D**, a **1×–5×** zoom
  dropdown, and an accessible **×** close button. The old oversized Close button
  and separate zoom slider are gone.
- The latest browser checks covered 360px and 390px widths, a reduced 390×650
  Chrome viewport, Top/Bottom docking, target anchoring, Reset Hole confirmation,
  enlarged-green controls, zoom selection, 3D switching, and closing.

## Pending work

1. Perform one physical iPhone 13 Chrome acceptance round, including address-bar
   expansion/collapse, device rotation, an off-green enlarged preview, and a
   complete putting sequence.
2. Run the complete Node and Python release suite, then do the documented core
   release-readiness review.
3. Validate GPS mode outdoors at a calibrated course, especially lateral
   alignment from the tee/bunker/green three-point calibration.
4. Continue real-round AI Caddie evaluation and prompt tuning only when a
   reproducible, authoritative shot packet demonstrates weak advice.
5. Deferred product work remains in `IMPROVEMENT.md`: three-hole engagement
   checkpoints, Friend Challenges/invitations, and the separately validated
   strokes-to-finish expected-score model.

## Completed product work

- Four complete 18-hole courses: Meadows, Warrenbrook, Cranbury, and Galloping
  Hill.
- Galloping Hill includes all supplied hole images, scorecard sources, generated
  hole JSON, browser registration, and authoritative surface validation.
- Full shots, chips, putting, penalties, relief, saved round recovery, decision
  scoring, and round analysis use deterministic authoritative packets.
- Ball-above-feet and ball-below-feet effects scale with shot distance and lie
  severity. Correct left/right aim compensation is graded separately from swing
  execution.
- The two-foot gimme boundary uses authoritative hundredth-yard precision and
  includes the conceded stroke in the final score.
- Greenside descriptions distinguish distance to the cup, distance to the front
  edge, carry, landing depth, and rollout.
- The standard strategy advice library is in
  `docs/STANDARD_ADVICE_LIBRARY.md`.
- Scorecard-based portable `.golfround` files can move an in-progress round
  between desktop and mobile while retaining authoritative replay state and the
  selected player profile.
- Eligible shots show **Aggressive** and **Safe & smart** when two plans differ
  materially. If only one honest plan survives deduplication, it appears as
  **Recommended** rather than hiding the planner. Partial-wedge guidance remains
  available inside 30 yards; putting guidance stays separate on the green.
  Each plan previews its map line, explains its objective through `?`, and uses
  the normal Play shot action as confirmation.
- `/editor.html` provides an 18-hole Course Mapper using either local hole images
  or USGS NAIP. It includes editable polygons, scorecard paste, yardage
  calibration, tee/pin/route markers, measurements, simplified bunker shapes,
  rotation, undo, `.golfmap` projects, authoritative JSON conversion, and direct
  game installation. Cranbury was completed through the faster local-image
  workflow. Public imagery and Census address lookup require no API key.
- The game UI now uses a calmer responsive yardage-book treatment. Desktop keeps
  the map centered between a course brief and compact shot desk, tablet places a
  two-column planning desk below the map, and mobile provides a scroll-safe shot
  sheet whose club, power, adjustment, and Play shot controls do not overlap.
- Desktop and tablet shot results appear in the left course panel above the
  round card; mobile continues to use the in-map result toast.
- The deterministic strategy planner treats Driver as tee-only; every later
  shot choice uses an appropriate fairway, hybrid, iron, or wedge option.
- The desktop/tablet Club and Power panel uses a compact approximately 75%-height
  treatment; mobile control sizing remains optimized for touch.
- The expanded mobile shot sheet uses a compact Club dropdown instead of square
  club tiles. Its option distances and Power readout update immediately from the
  selected percentage; the collapsed quick-club strip remains available.
- Mobile has one shot-confirmation action: the Adjustment row's Play button.
  Typed instructions are applied before execution, and an empty field plays the
  currently selected club, percentage, and target; there is no separate large
  Play Shot button.
- Back to Map sits in the mobile Caddie Choices heading for immediate access;
  the bottom utility row contains only Scorecard and Review.
- A second Back to Map button replaces the redundant Club-header yardage. The
  selected dropdown option and Power readout remain the distance sources.
- Mobile Caddie Choices use two compact equal columns within the viewport rather
  than a horizontal carousel; one-choice recommendations continue to span the
  available width.
- Mobile Game Master messages override the global chat bubble maximum and span
  the same full content width as the Club dropdown.
- The enabled user systemd unit at
  `/home/ksu/.config/systemd/user/golfgame.service` must run
  `scripts/serve.py --host 0.0.0.0 --port 8080`, not `python -m http.server`.
  Static-only serving makes `/api/auth/config` return 404 and triggers the
  generic course-data loading error.
- The desktop/tablet map toolbar also uses an approximately 75%-height treatment
  while mobile retains larger touch targets.
- The mobile Adjustment input uses a constant 16px editing size. This prevents
  iPhone Safari from zooming and enlarging the shot sheet when the field receives
  focus; the sheet and viewport dimensions remain unchanged while typing.
- Mobile map actions sit in a distinct row below the Hole/Par/Yardage and Round
  chips and above their overlay stacking layer, so the controls remain tappable;
  the scrolling map legend begins below that action row.
- The two mobile map-header rows share one flow-based `map-top-controls` group;
  do not return them to independently positioned overlays, since phone text
  sizing can otherwise make their touch regions collide.
- Full mobile shot setup adds `mobile-shot-setup-open` to the course stage. This
  hides map-only header controls and the legend until the player returns to the
  collapsed map state, keeping them out of the planner's touch and reading area.
- Reachable third shots remain approach plans even when multiple green targets
  deduplicate; they never fall back to partial-wood long-shot choices. Smart
  layup landing points are selected from verified interior fairway geometry.

## Player accounts and profiles

- Supabase provides email/password authentication, email verification, forgot
  password, recovery-link handling, and password replacement inside the game.
- The game server validates Supabase access tokens and maps each user to a local
  player record; only the publishable browser key is exposed to the client.
- The latest unfinished round follows the player across computers and phones and
  resumes automatically.
- Playing profiles persist independently of a round. They contain normal
  full-swing carry, club accuracy, and 3-, 6-, and 10-foot putting percentages.
- New players see profile setup; existing players use Player Account → Edit
  statistics. Saved values immediately affect dispersion and strategy planning.
- Custom profiles use the signed-in player's name instead of retaining the
  starter 80+/90+/100+ label; legacy generated names migrate automatically.
- Password-reset redirects force the New password screen even though the recovery
  token temporarily authenticates the player.
- Every newly completed round archives once under the signed-in account, even if
  automatic synchronization repeats. Player Account → Round history shows the
  chronological course, tee, strokes, score to par, and course-management score
  across computers and phones. Unfinished rounds remain in the separate resume
  workflow.
- Player Account → Top 10 rank board shows one best completed round per player,
  ordered by Course Management score with lower strokes as the tie-breaker.
- Completed authoritative shots are normalized into account-level learning
  observations with distance, lie/stance/slope, club and power, target and result
  surfaces, player adjustment text, decision/execution grades, penalty, and
  remaining distance. Legacy shots without an audited engine packet are ignored.
- Player Account → Player learning shows the evidence count and only patterns
  that clear conservative confidence rules. A pattern normally needs at least
  eight comparable shots across three completed rounds. Simulated distance and
  execution results never become claims about the golfer's real-world ability.
  New players see a clear evidence-building state instead of guessed advice.
- Player learning is limited to course-management evidence such as lie decisions,
  sidehill adjustments, and recurring strategic mistakes. Meaningful review shots
  receive a **Player record** note only when the shot directly matches one of those
  verified decision patterns.
- Player Learning → Recent decision form presents the latest six completed
  Course Management scores from oldest to newest. It compares the latest three
  with the previous three only after six scored rounds, treats changes smaller
  than four points as steady, and excludes simulated execution completely.
- AI strategy and round-review endpoints replace all browser-supplied learning
  claims with the signed-in player's server record before prompting the model.

## Completed learning work package

Continue completed-round history and lifetime player learning in this order:

1. Store every completed round per player without replacing prior rounds.
   **Complete**
2. Extract condition-aware shot observations from authoritative saved packets.
   **Complete**
3. Require sufficient samples before claiming a recurring course-management
   tendency. **Complete**
4. Add lie decisions, sidehill-reading quality, and recurring mistakes to the
   deterministic learning context. **Complete**
5. Expose only verified patterns to caddie choices and AI explanations.
   **Complete**
6. Add recent-round progress and improvement trends. **Complete**

Next: perform a core release-readiness review before starting any deferred work
from `IMPROVEMENT.md`.

## Current AI implementation

Phase 3 work package 1 adds optional local Ollama narration:

- Default model: `qwen3.5:4b` on the user's 6 GB NVIDIA GPU.
- Initial settings: `num_ctx=4096`, `temperature=0.3`.
- Avoid making an 8B model the default on 6 GB because model weights plus
  runtime and context-cache memory may force CPU offload.
- The deterministic golf engine must remain authoritative. The LLM may explain
  lies, strategy, engine results, next-play advice, and round reviews; it must
  not calculate physics, scoring, penalties, relief, gimmies, or shot outcomes.
- Send compact authoritative shot/strategy packets to the model rather than
  entire course files.
- Preserve the existing local heuristic fallback when Ollama is unavailable.

Ollama `0.32.5` is active at `/usr/local/bin/ollama`. `qwen3.5:4b` is installed
and verified at 100% GPU with a 4096-token context. It uses about 3.9 GB of
reported GPU process memory. A warm structured shot-narration request completed
in 3.8 seconds.

The provider implementation is in:

- `packages/ai/service.py`
- `packages/ai/prompts.py`
- `scripts/serve.py`
- browser endpoints `/api/ai/health`, `/api/ai/shot`, and `/api/ai/review`.

Ollama is the default. Use `AI_PROVIDER=gemini` with `GEMINI_API_KEY` to select
Gemini, or `AI_PROVIDER=off` to disable model-backed narration. Ollama settings
are configurable through `OLLAMA_MODEL`, `OLLAMA_HOST`, `OLLAMA_NUM_CTX`,
`OLLAMA_TEMPERATURE`, and `OLLAMA_TIMEOUT_SECONDS`.

## First actions after reboot

Run:

```bash
cd /home/ksu/golfgame
git status --short --branch
nvidia-smi
ollama --version
systemctl is-active ollama
ollama pull qwen3.5:4b
ollama run qwen3.5:4b
```

Then ask Codex:

> Read `README.md`, `docs/PROJECT_PHASES.md`, and
> `docs/SESSION_HANDOFF.md`. Resume the golf game from the saved handoff.
> Verify Ollama is active, run the golf game, and evaluate the local Game
> Master's shot narration and round review during a complete round.

Before changing code, run the existing baseline:

```bash
python3 -m unittest discover -v
node --test tests/*.test.mjs
```

After implementation, update this handoff and `docs/PROJECT_PHASES.md`, rerun
both suites, then commit and push the verified changes.
