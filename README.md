# Jetta Golf — The Strategy Round

A dependency-free, browser-based strategic golf game with four 18-hole courses:

- The Meadows at Middlesex
- Warrenbrook Golf Course
- Cranbury Golf Club
- Galloping Hill Golf Course

For a current catalog of player, GPS, and review tools, see the
[Features Guide](FEATURES_GUIDE.md). For the longer shot-by-shot tutorial, see the
[Player's Guide in English](USERGUIDE.md) or the
[Traditional Chinese Player's Guide](USERGUIDE_ZH_TW.md).

## Run locally

From this folder:

```bash
python3 scripts/serve.py --port 8080
```

Then open `http://localhost:8080`.

The app must be served over HTTP because browsers do not allow JavaScript modules to load course JSON from a `file://` page.

### Map a new golf course

Open `http://localhost:8080/editor.html` to align calculation geometry over local
aerial or illustrated hole images. The companion editor provides editable tee,
fairway, rough, bunker, green, water, and boundary shapes; draggable starting-ball,
tee, pin, and route markers; two-point distance calibration; portable 18-hole
projects; and complete game packages containing both artwork and geometry.

It requires no map API key or billing account. See [Course Mapper](docs/COURSE_MAPPER.md)
for setup, mapping, export, and local installation instructions.

#### Import a course from Golf Intelligence

Authorized developer accounts can search Golf Intelligence from Course Mapper,
review the expected credit use, download one selected course, and open the
normalized GPS geometry in the existing editor. Credentials remain server-side.
Add these settings to `.env` and restart the server:

```bash
GOLF_INTELLIGENCE_ENABLED=true
GOLF_INTELLIGENCE_BASE_URL=https://api.golfintelligence.com
GOLF_INTELLIGENCE_CLIENT_ID=your-client-id
GOLF_INTELLIGENCE_ACTIVE_TOKEN=your-active-token
```

Paid calls start OFF after every server restart. Enabling them in the editor does
not spend credits; the selected full-course download has a separate confirmation.
Successful imports are cached locally, and published gameplay uses only Jetta
course files. See [Golf Intelligence usage notes](docs/golf_intelligence_usage_notes.md).

### Player accounts and automatic round resume

The game supports Supabase email/password authentication. Every shot and round
position is saved automatically to this server under the authenticated Supabase
user ID. After sign-in, the most recently played unfinished round opens at the
saved course and hole.

To enable Supabase:

1. Create a Supabase project.
2. In **Project Settings → API**, copy the Project URL and publishable/anon key.
3. Copy `.env.example` to `.env` and replace both placeholder values.
4. In **Authentication → URL Configuration**, set the Site URL to
   `https://golfgame.jetta.com` and add that exact address to Redirect URLs.
5. Restart `scripts/serve.py`.

Supabase manages account creation, email confirmation, password recovery, and
access/refresh tokens. The public anon/publishable key is intentionally available
to the browser; never place a Supabase service-role key in `.env` for this app.
The round database remains local at `data/player_accounts.sqlite3` and is
excluded from version control. When Supabase variables are absent, the local
name/PIN login remains available for offline development.

Portable round files remain available as an optional backup. Open **Scorecard**, then:

1. Choose **Save round file** and keep the `.golfround` file in Downloads,
   Files, or cloud storage.
2. On the other device, open **Scorecard** and choose **Load round file**.
3. Select the saved file to restore the course, current hole, tee, shots, score,
   replay identity, and player profile.

Loading a file replaces the saved round for that course on the receiving
device. The game asks for confirmation when that course already has progress.

### Player feedback and developer replies

Signed-in players can open **Account → Feedback Center** without leaving or
changing the active round. They can rate the game, send a bug, suggestion,
feature request, course/map report, or AI Caddie comment, optionally attach a
compressed screenshot, and continue a private reply thread. Course, hole,
mode, lie, viewport, and browser context are included automatically; exact GPS
coordinates are not included.

Developer accounts also see a protected **Developer** inbox with status and
category filters, rating summary, workflow statuses, and player replies. Set a
comma-separated production allowlist in `.env` when needed:

```bash
GOLFGAME_DEVELOPER_EMAILS=admin@jetta.com,another-developer@example.com
```

The default developer email is `admin@jetta.com`. Authorization uses the
authenticated account email, not a browser-only UI flag. Feedback and ratings
are stored with the other player-account data in
`data/player_accounts.sqlite3`.

### Local AI Game Master

The server uses local Ollama with `qwen3.5:4b` by default. Install and pull the
model once:

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen3.5:4b
```

Then start the game normally:

```bash
python3 scripts/serve.py --port 8080
```

Ollama generates concise shot narration and round reviews from compact,
authoritative engine packets. If Ollama is unavailable, gameplay continues with
the built-in local commentary.

The defaults are tuned for a 6 GB NVIDIA GPU: a 4096-token context and
temperature `0.3`. They can be overridden with `OLLAMA_MODEL`,
`OLLAMA_HOST`, `OLLAMA_NUM_CTX`, `OLLAMA_TEMPERATURE`, and
`OLLAMA_TIMEOUT_SECONDS`.

Gemini remains available as an explicit alternative:

```bash
export AI_PROVIDER="gemini"
export GEMINI_API_KEY="your-key"
export GEMINI_MODEL="gemini-3.6-flash"
python3 scripts/serve.py --port 8080
```

Set `AI_PROVIDER=off` to disable model-backed narration entirely.

## Included

- All 72 supplied hole layouts across four courses
- Course selection with separate saved rounds
- Reference imagery for every hole at all four courses
- Scorecard-authoritative par, handicap, and Blue/White/forward-tee yardages
- Multiple tee positions, including correctly labeled Gold tees at Cranbury and
  Galloping Hill
- 80+, 90+, and 100+ player profiles
- Customizable copied profiles saved in the browser
- Player login with automatic server-backed unfinished-round resume across devices
- Private player Feedback Center with ratings, screenshots, threaded developer replies, and unread notices
- Player-scoped browser saves plus portable `.golfround` backup and import
- Satellite Course Mapper with editable GPS geometry and direct mapped-course registration
- Two or three context-sensitive strategy choices with player-specific clubs,
  distinct targets, map previews, confirmation, and deterministic `?` explanations
- Calm, responsive yardage-book interface with a map-centered desktop layout,
  a two-column tablet planning desk, and a scroll-safe mobile shot sheet
- Club selection, aim preview, shot dispersion, lie effects, penalties, scoring, pin positions, and round scorecard
- Distance- and severity-scaled ball-above/below-feet movement, natural-language
  aim compensation, and Game Master lie-management grading

## Phase 2 authoritative engine

The production-oriented deterministic engine in `packages/` now owns full-shot,
greenside-chip, putting, penalty, and relief outcomes. It includes
versioned player and lie fixtures, bounded shot distributions, seeded quality
states, coordinate projection, environment and lie modifiers, path samples,
landing-surface resolution, replay data, immutable audit packets, and a validated
yard-based adapter for all 72 real course holes. Browser full shots now consume
the same deterministic Result Packet contract and retain their complete replay
identity and canonical request. Water, out-of-bounds, and declared-unplayable
outcomes now use versioned authoritative relief records rather than provisional
browser drops. Full shots and putts also produce separate deterministic decision
and execution grades, which feed weighted hole and round strategy analysis,
repeat-pattern detection, the review UI, and optional AI narration.
Sidehill lies now apply deterministic directional bias from the standard advice
library: ball below feet moves right and calls for left aim; ball above feet
moves left and calls for right aim. Game Master grades that planning choice
separately from the resulting execution.

Phase 2 is complete: every browser gameplay path now consumes a replayable
authoritative engine packet rather than calculating outcomes independently.

Run its dependency-free test suite with:

```bash
python3 -m unittest discover -v
node --test tests/*.test.mjs
```

See `docs/PHASE_2.md` for the work-package boundary and next integration step.
See `docs/PROJECT_PHASES.md` for the current project phase, completion criteria,
and progress history.

## Course data layout

Each course is self-contained under `data/<course-id>/`:

```text
data/themeadow/
  scorecard.csv
  hole1.json … hole18.json
  images/hole1.png … hole18.png

data/warrenbrook/
  scorecard.csv
  hole1.json … hole18.json
  images/hole1.png … hole18.png

data/cranbury-golf-club/
  scorecard.csv
  hole1.json … hole18.json

data/gallopinghills/
  scorecard.csv
  scorecard-source.txt / scorecard-source.png
  hole1.json … hole18.json
  images/hole1.png … hole18.png
```

Shared engine calibration fixtures remain in `data/fixtures/`.
