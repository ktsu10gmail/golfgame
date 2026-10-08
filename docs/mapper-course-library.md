# Mapper Course Library — CSV-first Beta

## Using the library

Refresh Mapper, sign in with the existing local Mapper password, and choose
**Course library** in the header. Search by course/city and filter by state
(for example `NJ`) or import status. The library keeps Draft and Game status
separate. Imported drafts are not automatically installed.

1. **Add updated CSV** validates and stages new rows. Reordered/unchanged rows
   do not restart work; completed or incomplete imports are not retried daily.
2. Before importing a course already in the game, use **Link game course** to
   confirm its installed ID. This preserves that identity for later updates.
   Legacy installations show `Installed — revision unverified`.
3. Select up to 25 eligible courses and **Import selected**. A background worker
   serializes requests, spaces jobs by at least 30 seconds, and uses existing
   successful-response caching. Temporary failures retry after 60 seconds and
   then 5 minutes, with at most 3 total import attempts. OSM remains a shared
   external service and can still be unavailable. Local contention is shown
   separately and does not consume an upstream attempt.
4. **Pause queue** retains pending work; the current request finishes.
5. **Open draft** opens the existing editor. Finish missing geometry and trusted
   scorecard facts. **Save current library project** stores an immutable server
   revision; the header Save project button also saves library projects to the
   server before downloading a local copy. Non-library projects retain the
   original download-only behavior.
6. Use existing readiness checks/preview and explicit **Install in game** or
   **Update installed course**. Nothing is published by the batch worker.

Use **Review match** for shared coordinates, ambiguous/no matches, or changed
spreadsheet inputs. Optionally confirm a verified OSM `way/…`, `node/…`, or
`relation/…` identifier from the existing import workflow. Do not guess. The
same OSM facility cannot silently produce two projects. Saved projects cannot
be replaced by an unattended reimport; use the reviewed source-update workflow
below for new OSM geometry.

## Check newer OSM data without overwriting edits

Choose **Check OSM updates** on a saved course. This starts a separate bounded
source check; it does not resume a paused initial-import queue. Both queues can
be paused together; **Resume queues** explicitly resumes pending work.

The importer forces a fresh source fetch, retains the candidate as a private
draft, and compares its geometry with the last imported source and the current
saved project. If no geometry changed, it records **No changes** without creating
a new revision. Upstream failure affects only the check, not the saved project's
mapping or installation status. Checking repeatedly while a check/review is
pending attaches to the existing job instead of duplicating requests.

Choose **Review OSM update** when the source is ready. Save any local editor
changes first. Each change starts unchecked:

- **Source change**: the source changed and the corresponding draft unit was
  not changed independently. **Select uncontested changes** selects these only.
- **Conflict**: source and operator edits differ; explicitly choose which to use.
- **Removal**: source geometry disappeared; it is retained unless explicitly selected.

Expand **Compare geometry** to inspect summaries and geometry hashes; download
the complete source draft for map inspection. Operator-assigned reference shapes
retain their chosen hole/tee classification when geometry is refreshed.
Scorecard values, course identity and unrelated manual geometry are not replaced.

Use **Import scorecard** on an existing draft to match it to OpenGolfAPI and
save official scorecard facts as a new immutable revision. New CSV/OSM imports
attempt the same enrichment automatically. Ambiguous matches and missing tee
sets require review; the installed game is never changed by scorecard import.
Changed/unsupported hole grouping blocks automatic merge and needs layout review.

**Save reviewed revision** uses selected changes only, preserving everything else.
Selecting none retains the existing revision and records your decision to keep
the draft. Applying checks the saved revision again and rejects stale reviews.
Reopen the draft to see the saved result; installation remains a separate action.
**Discard OSM check** / **Discard source update** preserves the draft untouched.

## Project revision history

Choose **Revision history** to see up to 100 recent immutable revisions. Download
any listed revision, or explicitly **Restore revision** to create a new draft
from that snapshot. Current IDs remain stable and older snapshots are retained.
Restore checks that the current revision has not changed since the history was
opened. Unsaved editor work is not included; save it first if needed.

Project restore is not game rollback. The installed game changes only through
the existing explicit installation/update workflow.

## CSV identity and validation

CSV columns: Course Name, State, City, Latitude, Longitude. A permanent
**Course ID** is strongly recommended; reuse the IDs in **Download results CSV**
on subsequent sheets. Without IDs, normalized name/state/city determine initial
identity. Shared coordinates flag a possible rename or separate layout for
review, rather than assuming either. Removed CSV rows never delete projects.

Missing/invalid required fields are reported, not guessed or geocoded.
Download results includes invalid input rows from the latest intake. Full
validation details are stored privately in `Courses/reports/intake-validation.json`.

The supplied 2026-10-02 CSV contains 14,567 rows: 1,368 pass initial validation;
13,199 need coordinates or other required-field corrections. No mass OSM run
is started on upload. At initial staging, 112 co-located identities need review.

## Storage, operation and limitations

Private ledger: `data/course_library.sqlite3`; back it up together with `Courses/`.
Projects: `Courses/projects/<Course ID>/revision-N.golfmap`; partial projects:
`Courses/drafts/<Course ID>/revision-N.golfmap`; reports: `Courses/reports/`.
These are Git-ignored and blocked by public static file serving. Access is
through the existing password-protected Mapper/backend boundary only.

Requires Python 3, Node available to the App systemd service, and a configured
OSM endpoint. App service owns the worker; Mapper proxies private API calls.
Restart recovers interrupted jobs without resetting attempt counts. No new
account/role system, Stripe dependency, or automatic paid-provider call.

CSV intake may also be run from the repository:

```bash
python3 scripts/intake_course_library.py Courses/jetta_us_course_directory_latlon_10022026_0123pm.csv
# Explicit small batch (optional; never installs):
python3 scripts/intake_course_library.py Courses/jetta_us_course_directory_latlon_10022026_0123pm.csv --state NJ --queue-limit 5
```

Daily unattended intake is not scheduled until an upload path, timezone and
schedule are agreed. Excel, OpenGolfAPI enrichment, automated vegetation
conversion, full request-queue Build integration,
atomic multi-package installation, and live-game rollback are not complete at
this milestone. Revision history preserves projects, not historical game
geometry snapshots. Current game installation still uses the existing engine.
Do not call this the entire Automated Course Builder specification completed.

The editor supports 18 holes and three nines (27). Unsupported 36-hole or
repeated-number layouts retain source routes and are blocked from installation
pending review/support; no silently truncated course is marked Done.

## Verification record (2026-10-02)

65 targeted Python tests and 41 existing Mapper Node tests passed; syntax and
diff-whitespace checks passed. Local HTTP smoke checks confirmed login-required
library access and 404 for private CSV/ledger/report paths. Browser checks
covered desktop/mobile layout, state filtering and opening a saved draft.

One live CSV course, The Meadows At Middlesex Golf Club, was linked to the
existing game ID and imported after one upstream rate-limit retry. Revision 1
contains four unassigned reference shapes and no numbered hole routes; it is
correctly Incomplete. No game installation occurred. Re-intake reported zero
new rows and 1,368 unchanged rows, preserving the saved draft. Queue paused
after verification; all other staged entries remain unprocessed.
