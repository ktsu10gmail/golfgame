# Jetta Coach Course Wishlist + Back Office Course Operations

**Status:** V1 Design / Codex Specification\
**Scope:** Coach Beta course demand capture and operational fulfillment\
**Primary principle:** External course data is a **search directory
only**. Jetta's existing playable-course data remains authoritative.

## 1. Purpose

Jetta needs a simple way for Coaches to identify the golf courses they
and their students actually play so Jetta can prioritize preparing those
courses for Coach Beta.

The Coach should **not normally type a course name or address
manually**. Free-form entry creates spelling errors, inconsistent
naming, and duplicate requests.

Instead, Jetta should provide a searchable U.S. golf-course directory
containing only the identifying information needed for course selection:

-   Course name
-   Street address
-   City
-   State
-   ZIP/postal code

The Coach searches this directory, selects the correct course, and adds
it to their wishlist.

The selected directory record becomes the stable reference used to
aggregate demand in Jetta Back Office.

This directory is **not** Jetta's playable-course database and must
never become a competing canonical course model.

## 2. Product Goal

``` text
U.S. COURSE DIRECTORY
Course name + address
        |
        | Coach searches/selects
        v
COACH COURSE WISHLIST
        |
        v
BACK OFFICE COURSE DEMAND
        |
        v
JETTA COURSE OPERATIONS
        |
        v
Existing or newly prepared
canonical Jetta playable course
        |
        v
READY
        |
        v
Coach sees course is available
```

The primary beta question is:

> Which courses do our Coaches and their students need Jetta to support?

## 3. V1 Scope

V1 should support:

1.  Importing or maintaining a U.S. golf-course search directory.
2.  Searching by course name.
3.  Displaying location/address to distinguish similarly named courses.
4.  Allowing a Coach to select a directory course.
5.  Adding the selected course to the Coach's wishlist.
6.  Preventing duplicate wishlist entries for the same Coach/course.
7.  Aggregating Coach demand in Back Office.
8.  Showing whether a requested course corresponds to an existing
    playable Jetta course.
9.  Allowing ADMIN to link a directory course to the canonical Jetta
    course.
10. Tracking operational readiness.
11. Showing the Coach when a wishlist course becomes available.
12. Providing a controlled fallback when a legitimate course cannot be
    found.

Out of scope: public voting/rankings, marketplace features, payments,
licensing/grace/sponsorship changes, automated GIS/course generation,
automated publishing, public ETAs, complex prioritization algorithms, or
a second playable-course database.

## 4. Architectural Rule: Directory Is Not Jetta Course Data

Conceptually:

``` text
EXTERNAL COURSE DIRECTORY
- source
- source_course_id
- course_name
- street_address
- city
- state
- postal_code

             optional link
                  |
                  v

CANONICAL JETTA COURSE
Existing authoritative Jetta playable-course record
```

An external directory ID must never be treated as a Jetta course ID.

A directory course does not become playable merely because it exists in
the directory or appears on a wishlist. Jetta's existing course system
remains authoritative for playability.

## 5. External Directory Data

Minimum useful fields:

``` text
external_course_id
course_name
street_address
city
state
postal_code
source
```

Latitude/longitude may be retained internally if supplied by the source,
but are not required for Coach-facing V1.

Before implementation verify source licensing, storage/search rights,
stable IDs, U.S. coverage, address coverage, and update/import terms.
Avoid hard-coding the product architecture to one provider if a small
source abstraction is practical.

## 6. Coach Experience

Place the feature in the existing **Coach Dashboard**.

``` text
YOUR COURSES

Which courses do you and your students play most often?

Search U.S. golf courses
[ ______________________________ ]
```

Example result:

``` text
Makefield Highlands Golf Club
1418 Woodside Road
Yardley, PA 19067

[ Add to Wishlist ]
```

The Coach selects the record rather than retyping its name/address.

Search should tolerate partial names, capitalization, punctuation,
whitespace differences, and---if practical with the existing
stack---minor typos/fuzzy matching.

Results should show at least course name, street address, city, state,
and ZIP.

## 7. Coach Wishlist

Wishlist entries should reference stable directory course identity,
never the Coach's raw search string.

``` text
Coach A ---\
Coach B ----\
Coach C -----+--> External Course XYZ
Coach D ----/     Makefield Highlands Golf Club
Coach E ---/      Yardley, PA
```

This means five Coaches selecting the same directory course create one
aggregate demand target.

For Coach Beta, encourage approximately **3--5 primary courses** per
Coach, but do not impose a hard database limit unless the repository
audit finds a compelling reason.

## 8. Coach-Facing Status

Example:

``` text
Mercer Oaks West
West Windsor, NJ
✓ Available in Jetta

Mountain View Golf Course
West Trenton, NJ
◷ Preparing

Makefield Highlands Golf Club
Yardley, PA
○ Requested
```

The Coach should not need to understand GIS/import/publishing internals.

## 9. Missing Course Fallback

Provide an exception path:

``` text
Can't find your course?

[ Request a Missing Course ]
```

It may collect course name, street address, city, state, and ZIP. Manual
submissions must be clearly identified in Back Office as requiring
review.

ADMIN should be able to match the submission to an existing directory
record or canonical Jetta course rather than preserving a duplicate.

## 10. Back Office Course Operations

Add a Courses/Course Operations surface to the existing Jetta Back
Office, following current navigation conventions.

Example demand queue:

``` text
COURSE DEMAND

Course                         Coaches   Status
------------------------------------------------
Makefield Highlands GC            5      REQUESTED
Mountain View Golf Course          4      PREPARING
Princeton Country Club             3      VALIDATING
Mercer Oaks West                   8      READY
```

The primary V1 demand metric is number of Coaches selecting the course.

If student demand is displayed, calculate it from the correct existing
coaching-relationship model---not sponsored-seat counts.

## 11. Course Operations Detail

Example:

``` text
MAKEFIELD HIGHLANDS GOLF CLUB

1418 Woodside Road
Yardley, PA 19067

Demand
5 Coaches

Jetta Course
Not linked

Operational Status
REQUESTED

[ Match Existing Jetta Course ]
[ Start Preparation ]
```

Once a canonical course exists, link to its actual Jetta course ID.
Reuse existing course creation/import/publishing workflows rather than
creating parallel tooling.

## 12. Operational Lifecycle

Validate exact states against existing course infrastructure. A
reasonable conceptual lifecycle is:

``` text
REQUESTED -> MATCHED -> PREPARING -> VALIDATING -> READY
```

Exceptional states may include `DUPLICATE`, `UNAVAILABLE`, or `REJECTED`
only where needed.

`READY` must mean the request resolves to a canonical Jetta course that
existing Jetta rules consider available/playable. A Back Office label
alone must not bypass existing publication/playability rules.

## 13. Existing Jetta Course Matching

The repository audit must identify:

1.  Jetta's canonical course identifier.
2.  Current course-selection/listing APIs.
3.  Existing metadata available for matching.
4.  Whether address/location data already exists.
5.  Existing external/provider identifiers.
6.  Current publication/playability rules.

Matching must be conservative. Do not silently merge courses merely
because names are similar; uncertain matches require ADMIN resolution.

## 14. Demand Aggregation

Demand should be derived from wishlist selections rather than manually
maintained counters.

``` text
external_course_id = XYZ

Coach 101 -> XYZ
Coach 205 -> XYZ
Coach 417 -> XYZ
Coach 501 -> XYZ
Coach 833 -> XYZ

Back Office:
XYZ -> 5 Coaches
```

## 15. Coach Beta Readiness

A useful Back Office view may show:

``` text
COACH BETA COURSE READINESS

Coach             Requested   Ready
-----------------------------------
Michael Smith         4        4
Jane Miller           5        4
Robert Jones          4        2
```

This is operational information, not a public score. Keep V1 simple.

## 16. Authorization and Audit

Coach wishlist actions require authenticated Coach authorization
according to Jetta's existing role model.

Back Office Course Operations requires ADMIN authorization through the
existing centralized ADMIN mechanism. Never trust browser-supplied role,
Coach ID, player ID, or ownership claims.

Administrative resolution/readiness changes should reuse the existing
audit architecture. Avoid audit noise for ordinary searches.

## 17. Data Integrity Requirements

1.  A Coach cannot add the same external course twice.
2.  Multiple Coaches selecting the same external course aggregate into
    one demand item.
3.  External IDs never become canonical Jetta course IDs.
4.  Removing a wishlist entry never deletes a Jetta course.
5.  Linking never overwrites canonical Jetta course identity.
6.  Readiness cannot bypass existing publication/playability rules.
7.  ADMIN-only operations are enforced server-side.
8.  Manual requests remain distinguishable from directory selections
    until resolved.
9.  Existing Jetta course data remains authoritative.
10. Directory updates never alter gameplay/course geometry data.

## 18. Directory Update Strategy

Treat the directory as replaceable reference data. Determine the
simplest repository-appropriate update mechanism: periodic import,
administrative import command, or versioned static dataset.

Updates must not unexpectedly break wishlist identity. If provider IDs
are unstable, identify that risk before implementation and propose a
stable Jetta-side directory identity.

Do not build a complex synchronization service for V1 unless necessary.

## 19. Performance

Keep search simple. Do not introduce Elasticsearch, OpenSearch, or
another infrastructure service merely for this feature unless repository
evidence shows the existing stack cannot support the required directory
search.

## 20. Testing Expectations

Tests should cover:

-   Directory import and normalization.
-   Stable identity/update behavior.
-   Course-name and partial-name search.
-   Typo-tolerant search if implemented.
-   Coach authorization.
-   Add/remove wishlist.
-   Duplicate prevention.
-   Multi-Coach aggregation.
-   Linking external directory course to canonical Jetta course.
-   Separation of external and Jetta IDs.
-   READY/playability correctness.
-   ADMIN authorization.
-   Administrative audit behavior.
-   Manual missing-course fallback and resolution.
-   No unintended changes to canonical course/gameplay data.

## 21. Phase 0: Repository Audit Before Coding

Before writing application code, Codex must report:

1.  Where canonical Jetta course records live.
2.  The canonical course ID/data model.
3.  How a golfer currently selects a course for play.
4.  The UI -\> API -\> service -\> data path for course selection.
5.  How Jetta determines course playability/availability.
6.  Existing import/create/edit/validation/publish tooling.
7.  Existing search functionality that can be reused.
8.  Existing wishlist/course-request implementation or specs.
9.  Coach Dashboard insertion point for `Your Courses`.
10. Back Office insertion point for Course Operations.
11. Existing ADMIN authorization/audit mechanisms.
12. Existing Coach/student relationship services for optional
    student-demand counts.
13. Database/migration conventions.
14. Exact files likely to change.
15. Minimal schema changes needed.
16. External directory source/license/update assumptions requiring
    verification.
17. Architectural conflicts with this specification.

**Do not implement during Phase 0.**

## 22. Phase 0 Design Questions

Codex must explicitly answer:

**A. Directory storage:** What is the simplest way to store/search the
U.S. course-name/address directory?

**B. Stable identity:** What stable identifier should wishlist entries
reference?

**C. Existing-course matching:** How should an external directory record
associate with a canonical Jetta course without creating a second course
identity system?

**D. Search:** What mechanism should support partial names and, if
practical, minor spelling errors?

**E. Readiness:** Can readiness derive from existing canonical course
state, or is a separate operational status needed? Prefer derivation
from existing truth.

**F. Manual fallback:** What is the minimum workflow/schema for a course
missing from the directory?

## 23. Acceptance Criteria

V1 is successful when:

1.  A Coach can search U.S. golf courses by name from Coach Dashboard.
2.  Search uses structured directory records, not arbitrary free-form
    course names.
3.  Results show course name and address/location.
4.  The Coach selects the correct course and adds it to the wishlist.
5.  The Coach normally does not manually type the official course
    name/address.
6.  Multiple Coaches selecting the same course aggregate as one demand
    item.
7.  Back Office shows which courses Coaches want.
8.  ADMIN can determine whether a course already exists in Jetta.
9.  ADMIN can link the directory identity to the canonical Jetta course.
10. Existing Jetta course-production tooling remains authoritative.
11. When the canonical course becomes available, the Coach sees it as
    available.
12. A missing-directory fallback exists.
13. The external directory never becomes a competing playable-course
    database.
14. Licensing, grace, payment, sponsorship, and unrelated gameplay
    behavior remain unchanged.

## 24. Product Principle

The external course directory is a **lookup tool**, not a golf-content
platform.

Its job is:

> Help a Coach select the correct golf course without requiring them to
> type the official course name and address.

Jetta uses those selections to understand real Coach demand and
prioritize course preparation.

The canonical Jetta course system remains responsible for everything
required to actually play golf in Jetta.

## 25. Instruction to Codex

Audit the repository against this specification.

**Do not code yet.**

Return:

-   Current repository findings
-   Existing components/services to reuse
-   Proposed minimal architecture
-   Proposed schema changes
-   External directory import/search approach
-   Coach Dashboard integration plan
-   Back Office Course Operations plan
-   Canonical Jetta course matching/linking approach
-   Manual missing-course fallback
-   Exact files expected to change
-   Test plan
-   Risks/open questions
-   Recommended implementation phases

Do not create a second canonical golf-course model.

Do not change licensing, Coach sponsorship, grace-period, Student
Continuation, payment, or unrelated gameplay systems.

Wait for approval before implementation.
