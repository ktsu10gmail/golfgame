# Jetta --- Marketing-to-Application Feature Gap Review

## Codex Assessment and Implementation Planning Specification

## Purpose

The Jetta marketing website currently describes several capabilities
that appear to be ahead of the application.

**Do not immediately implement everything in this document.** First
inspect the current Jetta source and produce a repository-grounded
feasibility and implementation assessment.

The goals are to:

1.  Verify each marketing/application gap.
2.  Find existing components and data that can be reused.
3.  Determine technical feasibility.
4.  Identify schema, authentication, authorization, API, UI, security,
    and migration implications.
5.  Recommend an implementation order.
6.  Bring the product and marketing site into alignment without creating
    duplicate systems.

## Repositories

### Jetta Application

``` text
GitHub: github.com/ktsu10gmail/golfgame
Local path: /home/ksu/golfgame
Branch: main
Remote: origin
Application: https://golfgame.jetta.com
```

If reviewing another checkout, state its path and commit explicitly.
Search current source; prior line numbers may be stale.

### Marketing Website

``` text
GitHub: github.com/ktsu10gmail/website
Local path: /home/ksu/www
Branch: main
Remote: origin -> git@github.com:ktsu10gmail/website.git
```

Do not modify the marketing repository during this assessment unless
explicitly instructed.

## Product Principle

Jetta's intended learning loop is:

``` text
Coach
  ↓
Student
  ↓
Practice / Simulated Play / Real-Course Play
  ↓
Jetta Evidence and Analysis
  ↓
Post-Round Learning Report
  ↓
Coach Review
  ↓
Next Learning Focus
  ↓
Student Plays Again
```

Preserve this core distinction:

``` text
DECISION QUALITY ≠ EXECUTION QUALITY ≠ RESULT
```

Do not create a second scoring, risk, or assessment engine that
conflicts with existing deterministic/canonical analysis.

------------------------------------------------------------------------

# 1. Verify Existing Capabilities

A prior source review reported these as already implemented. Verify them
in the current repository.

## On-Course GPS Logging

Reported: - Tee/shot locations - Lies - Clubs - Putting - Hole review -
Sync - Replay/history

Prior references:

``` text
index.html around line 704
app.js around line 13715
```

Verify persistence and whether this evidence can support coach-facing
views.

## Post-Round Learning Report

Reported implemented.

Prior references:

``` text
index.html round-review dialog around line 1430
packages/presentation/post_round_report.mjs around line 290
```

Document the current report model, persistence, rendering, historical
behavior, and access model.

## Decision vs Execution

Reported implemented.

Prior references:

``` text
packages/presentation/post_round_report.mjs around line 312
app.js around line 12021
```

Treat the existing distinction as authoritative.

## PDF and JSON Report Export

Reported implemented.

Prior references:

``` text
packages/presentation/post_round_export.mjs around line 48
app.js around line 12045
```

Assess reuse for coach review.

## Existing Player Feedback

Reported as private mailbox-style feedback.

Prior references:

``` text
index.html around line 1011
README.md around line 91
```

Determine overlap with planned public/community Feedback Forum.

## Course/Map Feedback

Reported as an existing feedback category.

Prior reference:

``` text
index.html around line 1051
```

Determine how it should coexist with a dedicated Course Wishlist.

------------------------------------------------------------------------

# 2. Feature A --- Round Grade Summary

Marketing currently suggests letter grades such as:

``` text
Decision       A
Execution      C+
Course Mgmt    B+
Putting        B
```

The app reportedly already has percentages, strategy scores,
decision/execution analysis, and category analysis.

Assess:

1.  Which existing metrics could support grades.
2.  Whether grades can be a presentation mapping rather than a new
    scoring system.
3.  Correct denominators and handling of ungraded decisions.
4.  Whether marketing categories map to actual app categories.
5.  Versioning required for grade mappings.
6.  Historical-report implications.

Preferred architecture:

``` text
Existing authoritative metric
          ↓
Versioned presentation mapping
          ↓
Letter grade
```

Do not invent a new grading formula merely to match marketing.

------------------------------------------------------------------------

# 3. Feature B --- Strategy Heatmap

Marketing suggests a visual representation of strategic targets,
dispersion, risk areas, or shot patterns.

The app reportedly already has replay maps, shot evidence, course
geometry, intended targets in some workflows, and dispersion/simulation
evidence.

Determine what is actually persisted for historical shots:

-   Intended target
-   Actual finish
-   Dispersion samples/summaries
-   Hazard geometry
-   Preferred miss
-   Candidate strategy targets
-   Course/version
-   Analysis seed/version
-   Player-profile snapshot

Assess truthful visualizations such as:

``` text
Target vs Actual
Dispersion footprint
Preferred miss area
Risk exposure
Shot concentration
Decision-quality locations
```

Do not create a heatmap that implies historical evidence exists when it
does not.

Recommend the smallest useful visualization supported by real data.

------------------------------------------------------------------------

# 4. Feature C --- Risk / Reward Analytics

Marketing suggests a chart summarizing strategy risk versus expected
reward.

The app reportedly already has strategy scores, risk/reason codes,
decision analysis, and candidate/evaluator evidence.

Determine whether existing data supports:

-   Risk percentage
-   Expected leave
-   Expected strokes or equivalent scoring value
-   Hazard/penalty exposure
-   Green/target probability
-   Alternative-strategy comparison
-   Aggressive versus safer choices

Any chart must consume existing evaluator/canonical evidence.

**Do not create a second risk model solely for visualization.**

Define graceful degradation for old rounds lacking evidence.

------------------------------------------------------------------------

# 5. Feature D --- Coach Portal / Dashboard

This is likely the largest functional gap.

Marketing implies coaches can:

-   Sign in
-   See linked students
-   Review student activity
-   Open rounds
-   Review learning reports
-   Identify learning patterns
-   Prepare for the next lesson

Before design, inspect the actual authentication/account model.

Determine:

1.  Current authentication provider.
2.  Whether Supabase Auth is authoritative.
3.  Current user/profile schema.
4.  Existing roles/permissions.
5.  Whether coach/student account types exist.
6.  Round ownership model.
7.  Report authorization.
8.  Existing APIs/data paths for history/reports.

Evaluate a minimal Coach Portal V1:

``` text
Coach Dashboard
    |
    +-- Student List
    |
    +-- Student
          |
          +-- Recent Rounds
          +-- Learning Reports
          +-- Learning Patterns
```

Do not begin by rebuilding scheduling, payments, CRM, messaging, or
lesson booking. Jetta's coach portal should focus on **learning
evidence**.

------------------------------------------------------------------------

# 6. Feature E --- Coach/Student Relationship

This is foundational to coach access.

Evaluate a many-to-many-capable model such as:

``` text
coach_student_relationship
--------------------------
coach_user_id
student_user_id
status
created_at
accepted_at
revoked_at
```

Possible states:

``` text
PENDING
ACTIVE
REVOKED
DECLINED
```

Adapt to the actual identity schema.

A coach must never access student rounds simply by knowing a student ID.

Evaluate:

``` text
Coach invites student
        ↓
Student accepts
        ↓
ACTIVE authorized relationship
        ↓
Coach may access approved learning data
```

Avoid unnecessarily preventing multiple students per coach or multiple
coaches per student.

------------------------------------------------------------------------

# 7. Feature F --- Coach Assignment Workflow

Marketing currently implies coaches can assign strategy rules, target
zones, preferred misses, and risk parameters.

Do not automatically build a complex strategy-rule engine.

First evaluate a simpler **Learning Assignment / Practice Focus**:

``` text
Student: DavidS
Focus: Tee-shot decision making

Coach instruction:
"When trouble is right, compare the conservative target
before choosing driver."

Optional:
Course
Hole(s)
Strategy category
Due date
Coach note
```

Desired loop:

``` text
Coach assignment
      ↓
Student plays
      ↓
Relevant evidence captured
      ↓
Round report
      ↓
Coach reviews
```

Determine how assignments can reference student, coach, course, holes,
strategy category, free-text objective, rounds, and completion state.

Coach assignments must not override simulation physics or authoritative
course data.

------------------------------------------------------------------------

# 8. Feature G --- Learning Journal / Logbook

Marketing suggests longitudinal learning/reflection.

The app reportedly already has shot logs, GPS logs, optional coaching
notes, learning reports, and history.

Assess whether to use:

### Separate entries

``` text
journal_entry
-------------
user_id
round_id optional
hole_number optional
shot_id optional
text
created_at
```

or a structured view over existing persisted notes/reports.

Avoid duplicate note systems.

V1 should answer:

> "What have I been learning over time?"

Possible V1: - Player post-round reflection - Coach note after review -
Round link - Date - Learning focus/category

Do not turn this into a social feed.

------------------------------------------------------------------------

# 9. Feature H --- Dedicated Course Wishlist

Marketing/product concept:

-   Course requests
-   Search
-   Duplicate detection
-   Voting
-   Status
-   Public list

Possible statuses:

``` text
REQUESTED
REVIEWING
PREPARING
TESTING
AVAILABLE
DECLINED
```

A separate community design proposes verified Jetta identity, unique
display names, voting, and moderation.

Important architecture question: the authoritative wishlist may live on
`www.jetta.com`.

Determine whether the app needs:

-   No wishlist implementation beyond auth/API support
-   A link to the website wishlist
-   Shared API/data access
-   An in-app view of the same authoritative wishlist

**Do not create two independent wishlist databases.**

------------------------------------------------------------------------

# 10. Feedback Forum Relationship

A website Community feature is planned with authenticated users, display
names, posts, comments, votes, statuses, and moderation.

The app reportedly already has private feedback.

Determine whether the correct distinction is:

``` text
PRIVATE SUPPORT / APP FEEDBACK
"I have a problem with my account/course/round."

PUBLIC COMMUNITY FEEDBACK
"I would like Jetta to add this feature."
        +
discussion
        +
voting
```

Do not publish existing private support messages.

------------------------------------------------------------------------

# 11. Required Authentication / Identity Audit

Before coach features, answer from actual source:

1.  Is Supabase Auth authoritative?
2.  What field contains the Supabase UUID?
3.  Does Jetta also have a numeric `user_id`?
4.  How is Supabase UUID → numeric Jetta ID mapped?
5.  Where is email stored?
6.  Is there a username/display-name/nickname?
7.  Is numeric Jetta ID immutable?
8.  What session/auth mechanism is used after login?
9.  What protects user rounds?
10. Is there an existing role model?
11. Can roles support Player, Coach, Admin?
12. Can one account have multiple roles?

Do not output secrets, tokens, JWTs, passwords, service-role keys, or
credentials.

------------------------------------------------------------------------

# 12. Roles

Evaluate support for:

``` text
PLAYER
COACH
ADMIN
```

A person may eventually be both PLAYER and COACH. Avoid forcing one role
per user unless the current architecture requires it.

Conceptual example only:

``` text
user_roles
----------
user_id
role
```

Reuse an existing suitable role system if present.

------------------------------------------------------------------------

# 13. Coach Authorization

Coach access must be enforced server-side.

Example:

``` text
Coach requests Student Round 123
          ↓
Server verifies:
  authenticated coach
          +
  ACTIVE coach/student relationship
          +
  round belongs to that student
          ↓
Allow
```

Never rely on hidden UI or browser-supplied user IDs.

------------------------------------------------------------------------

# 14. Historical Fidelity

New functionality must not silently rewrite historical analysis.

For reports, grades, charts, and coach views:

-   Prefer persisted historical evidence.
-   Preserve analysis/evaluator versions where available.
-   If current logic reinterprets an old round, label that
    appropriately.
-   Do not imply new information existed during the original round.
-   Gracefully degrade when old rounds lack required data.

------------------------------------------------------------------------

# 15. Reuse Before Rebuild

Before adding modules/tables, search for existing:

-   User/profile model
-   Auth utilities
-   Authorization middleware
-   Round repository/service
-   GPS evidence
-   Replay geometry
-   Canonical assessment
-   Strategy evaluator
-   Decision/execution metrics
-   Learning-pattern analysis
-   Report builder/export
-   Notes
-   Feedback
-   Course catalog/version model

For each feature, identify what should be reused.

Avoid parallel implementations.

------------------------------------------------------------------------

# 16. Proposed Phasing to Evaluate

This order is a hypothesis; change it if repository dependencies justify
doing so.

## Phase 0 --- Architecture and Identity Audit

No feature implementation.

Deliver current auth/user model, reporting/evidence architecture,
feedback architecture, reusable components, schema gaps, and security
implications.

## Phase 1 --- Report Presentation Alignment

Where supported by existing data:

1.  Round Grade Summary
2.  Risk/Reward visualization
3.  Strategy visualization/heatmap

## Phase 2 --- Coach/Student Foundation

1.  Role model
2.  Coach/student relationship
3.  Invitation/acceptance
4.  Permissions
5.  Shared report access

## Phase 3 --- Coach Portal

1.  Student list
2.  Recent activity
3.  Round list
4.  Learning reports
5.  Learning patterns

## Phase 4 --- Learning Assignment

Start with simple learning focus/instruction, not a complex
strategy-rule engine.

## Phase 5 --- Learning Journal

Reuse existing notes/report evidence where possible.

## Phase 6 --- Community Integration

Coordinate with website repository for Feedback Forum, Course Wishlist,
and shared identity. Avoid duplicate systems.

------------------------------------------------------------------------

# 17. Marketing Alignment Classification

Classify each marketing capability as:

``` text
IMPLEMENTED
PARTIALLY_IMPLEMENTED
IMPLEMENTABLE_WITH_EXISTING_DATA
REQUIRES_NEW_DATA_MODEL
REQUIRES_NEW_BACKEND_CAPABILITY
REQUIRES_NEW_AUTHORIZATION_MODEL
ROADMAP_ONLY
NOT_RECOMMENDED
```

Provide source evidence and reasoning for each.

------------------------------------------------------------------------

# 18. Required Codex Deliverable --- Do Not Code First

Produce:

``` text
JETTA MARKETING-TO-APP GAP ASSESSMENT

Repository reviewed:
Commit:
Date:

1. Current Architecture
2. Authentication / Identity
3. Existing Reporting System
4. Existing GPS / Replay Evidence
5. Existing Feedback System

FEATURE ASSESSMENTS

A. Round Grade Summary
   Status:
   Existing reusable code:
   Missing pieces:
   Data migration:
   Security impact:
   Complexity:
   Recommendation:

B. Strategy Heatmap
   ...

C. Risk / Reward Analytics
   ...

D. Coach Portal
   ...

E. Coach/Student Relationship
   ...

F. Coach Assignment
   ...

G. Learning Journal
   ...

H. Course Wishlist
   ...

CROSS-CUTTING RISKS

RECOMMENDED IMPLEMENTATION ORDER

FILES/MODULES EXPECTED TO CHANGE

DATABASE MIGRATIONS EXPECTED

TEST PLAN

OPEN QUESTIONS
```

Use engineering complexity labels such as SMALL, MEDIUM, LARGE, VERY
LARGE and explain why. Do not provide fake precision.

------------------------------------------------------------------------

# 19. Questions Codex Must Explicitly Answer

1.  Can all listed marketing capabilities reasonably fit the current
    Jetta architecture?
2.  Which are mostly presentation/UI work?
3.  Which require new persisted data?
4.  Which require new authentication/authorization?
5.  Which require historical report/schema changes?
6.  Which belong in `golfgame`?
7.  Which belong in `website`?
8.  Which need a shared API/identity contract?
9.  Are any marketing claims still misleading even if implemented as
    proposed?
10. Should any feature be changed rather than implemented exactly as
    marketed?

------------------------------------------------------------------------

# 20. Security Guardrails

-   Never expose Supabase `service_role` credentials in browsers.
-   Never accept browser-supplied `user_id` as proof of identity.
-   Do not give the public website unrestricted app database
    credentials.
-   Do not allow coach access without explicit authorization.
-   Do not expose private email as community identity.
-   Do not trust client-side role claims.
-   Enforce permissions server-side.
-   Validate/sanitize user content.
-   Preserve Cloudflare/origin protections.
-   Keep secrets out of Git.

------------------------------------------------------------------------

# 21. Desired End State

``` text
COACH
  │
  ├── links student
  ├── sets learning focus
  │
  ▼
STUDENT
  │
  ├── practices in Jetta
  ├── plays simulated round
  └── plays real round using GPS
          │
          ▼
EXISTING JETTA ENGINE
  │
  ├── decision evidence
  ├── execution evidence
  ├── result
  ├── strategy/risk evidence
  └── learning patterns
          │
          ▼
CANONICAL REPORT MODEL
          │
     ┌────┴───────────┐
     ▼                ▼
PLAYER REPORT      COACH VIEW
     │                │
     └──────┬─────────┘
            ▼
       NEXT LEARNING
          FOCUS
```

The coach view must consume the same authoritative Jetta evidence as the
player report. Do not create a separate coach analysis engine.

------------------------------------------------------------------------

# 22. Final Instruction to Codex

**Start with analysis, not implementation.**

Inspect the current repository and produce the requested gap/feasibility
assessment first.

The goal is not merely to make the app visually match the marketing
website. The goal is to make the marketing promises **real,
maintainable, secure, and consistent with Jetta's existing
golf-intelligence architecture**.

If a marketing promise should be softened rather than implemented, say
so.
