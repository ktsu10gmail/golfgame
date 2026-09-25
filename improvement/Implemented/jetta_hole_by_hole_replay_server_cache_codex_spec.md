# Jetta Server-Side Round Storage and Hole-by-Hole Replay Loading
## Sliding Cache, Neighbor Prefetch, and Random-Jump Support
### Codex Implementation Specification

## 1. Goal

Fix the browser-storage scalability issue by keeping authoritative round/replay data on the server and loading only the hole data needed by the player.

Core principle:

> **Server is the source of truth. The browser keeps a small intelligent working cache.**

Normal working set:

```text
Previous Hole
Current Hole
Next Hole
```

When the player moves, prefetch likely next data. Random jumps fetch the requested hole directly without downloading intervening holes.

## 2. Problem

The current detailed Warrenbrook round exposed data duplication:
- detailed geometry is repeatedly embedded in replay/shot data;
- full-shot records became much larger than older courses;
- a legacy history copy duplicates browser data;
- clearing browser storage is temporary because login restores the oversized server round.

This is an application data-model/storage issue, not a browser choice issue.

Permanent fixes:
1. stop embedding full geometry per shot;
2. remove duplicate legacy history;
3. keep completed rounds server-side;
4. load lightweight summaries first;
5. load replay hole-by-hole;
6. use bounded caching/prefetching.

## 3. High-Level Architecture

```text
                         SERVER
                           |
              +------------+-------------+
              |                          |
        ROUND/REPLAY DATA          COURSE VERSION DATA
              |                          |
        Round summary               Hole geometry
        Hole 1 shots                Green/fringe
        Hole 2 shots                Fairway
        ...                         Bunkers/water/etc.
              |                          |
              +------------+-------------+
                           |
                        BROWSER
                           |
                   Lightweight index
                           |
                  Current-hole package
                           |
                 Small intelligent cache
```

Do not hydrate every historical round/hole into persistent browser storage at sign-in.

## 4. Server Is Authoritative

Server stores:
- round metadata and scores;
- shot records;
- targets;
- club/power evidence;
- strategy/evaluator evidence;
- replay evidence;
- course/version references.

Large course geometry is versioned separately from individual shots.

## 5. Lightweight Round List

At login/replay screen, fetch only round metadata.

Example:

```json
{
  "round_id": "round-123",
  "course_name": "Warrenbrook",
  "played_at": "2026-09-03",
  "score": 88,
  "status": "COMPLETED"
}
```

Do not fetch full replay payloads to display the round list. Support pagination as history grows.

## 6. Lightweight Round/Hole Index

When a round opens, fetch a small 18-hole summary:

```json
{
  "round_id": "round-123",
  "course_id": "warrenbrook",
  "course_version_id": "course-v12",
  "score": 88,
  "holes": [
    {"hole": 1, "par": 4, "score": 5, "shot_count": 5},
    {"hole": 2, "par": 3, "score": 3, "shot_count": 3}
  ]
}
```

This supports instant hole navigation controls without loading all replay detail.

## 7. One-Hole Replay Loading

Conceptual endpoint:

```text
GET /rounds/{round_id}/holes/{hole_number}
```

Return only round-specific replay evidence for that hole.

Geometry should preferably be a separate reusable resource:

```text
GET /courses/{course_id}/versions/{version_id}/holes/{hole_number}
```

Do not embed full hole geometry in every shot.

## 8. Separate Geometry and Replay Caches

Use separate keys:

```text
geometry:
course:warrenbrook:v12:hole:7

replay:
round:round-123:hole:7
```

Benefits:
- geometry is reused across multiple rounds;
- replay remains round-specific;
- cache invalidation is clearer;
- repeated course plays do not duplicate geometry.

## 9. Historical Integrity

Historical replay must remain faithful to what existed when the round was played.

Persist version references:

```json
{
  "course_id": "warrenbrook",
  "course_version_id": "course-v12",
  "geometry_version_id": "geom-v12",
  "simulation_version": "sim-v8"
}
```

Do not silently use the newest edited course/model for old replay.

If old geometry versions cannot be retained indefinitely, save one immutable geometry snapshot per appropriate course/round version—not one copy per shot.

## 10. Sequential Forward Replay

Viewing Hole 1:

```text
ACTIVE:   Hole 1
PREFETCH: Hole 2
```

Viewing Hole 2:

```text
KEEP:     Hole 1
ACTIVE:   Hole 2
PREFETCH: Hole 3
```

Viewing Hole 3:

```text
KEEP:     Hole 2
ACTIVE:   Hole 3
PREFETCH: Hole 4
```

The likely next hole should normally already be available before Next is pressed.

## 11. Backward Replay

If current hole is 8:

```text
KEEP:     Hole 7
ACTIVE:   Hole 8
PREFETCH: Hole 9
```

If player moves 8 -> 7:
- Hole 7 opens from cache;
- retain Hole 8;
- Hole 6 becomes the new likely prefetch.

Navigation direction should influence prefetch priority.

## 12. Random Hole Jumping

Example:

```text
Current: Hole 3
Cached:  2, 3, 4

Player taps Hole 15
```

Do NOT download Holes 5–14.

Instead:

```text
Fetch Hole 15 immediately (high priority)
        |
Display Hole 15
        |
Prefetch Hole 14 and Hole 16
```

Old cached holes may remain temporarily if cache budget allows.

Possible cache:

```text
2, 3, 4, 14, 15, 16
```

If player jumps back to a cached hole, replay is instant. If evicted, fetch it again.

## 13. Prefetch Policy

### Forward movement
For 6 -> 7:

```text
Current:  7
Keep:     6
Prefetch: 8
```

### Backward movement
For 7 -> 6:

```text
Current:  6
Keep:     7
Prefetch: 5
```

### Random jump
For 6 -> 14:

```text
Current:  14
Prefetch: 13 and 15
```

User-requested fetches always outrank background prefetches.

## 14. Cancel/Ignore Stale Requests

Rapid navigation must be safe.

Example:

```text
Viewing 5
prefetching 6
user jumps to 16
```

Hole 16 becomes high priority. Obsolete prefetch may be cancelled using `AbortController` or equivalent.

If user taps 10 and immediately 15, a late Hole 10 response must never replace Hole 15 on screen.

Use request IDs/navigation sequence IDs/abort signals.

Older successful responses may populate cache if still valid, but only the latest active navigation may change displayed hole.

## 15. Bounded LRU Cache

Use a bounded Least Recently Used/priority cache.

Suggested initial target:

```text
5–7 loaded holes
```

This is a starting point. Measure real package sizes and device memory before final tuning.

Eviction priority:

```text
1. Current hole          never evict
2. Adjacent holes        strongly retain
3. Recently viewed       retain if budget allows
4. Oldest unused         evict first
```

Goal:

> **Likely navigation is instant; unusual navigation is fast and reliable.**

Do not try to guarantee every possible jump is instant by loading all 18 holes.

## 16. Browser Storage

Do not write loaded replay packages back into one giant `localStorage` history object.

Recommended:

### localStorage
Only small items:
- UI preferences;
- last-opened round/hole IDs;
- lightweight settings.

### Memory
- active hole;
- neighboring holes;
- LRU working cache.

### IndexedDB (optional)
Can later provide a bounded cache for:
- recent versioned geometry;
- recent hole replay packages;
- offline support.

IndexedDB is a cache, not the authoritative database. Merely moving the oversized duplicated structure from localStorage to IndexedDB is not the permanent fix.

## 17. Loading States

Support internally:

```text
NOT_LOADED
LOADING
CACHED
ERROR
```

For an uncached random jump, show a lightweight loading state while fetching the requested hole.

Background prefetch failure must not interrupt current replay.

## 18. Geometry Deduplication Is Mandatory

Old pattern:

```text
Shot 1 -> full hole geometry
Shot 2 -> full hole geometry
Shot 3 -> full hole geometry
```

New pattern:

```text
Versioned Hole Geometry -> stored once/referenced

Shot 1 -> shot evidence
Shot 2 -> shot evidence
Shot 3 -> shot evidence
```

The storage issue is not considered fixed until repeated geometry is removed from shot records.

## 19. Remove Legacy Duplicate History

Inspect the legacy history copy.

Preferred migration:
- stop creating new duplicate history immediately;
- read old legacy data only when needed;
- migrate old records to normalized format;
- remove legacy write path.

Do not continue saving every new round twice.

## 20. Existing Oversized Round Migration

Preserve the current Warrenbrook round.

Migration:

```text
old oversized round
       |
identify repeated geometry
       |
extract/deduplicate geometry
       |
create geometry/version reference
       |
remove geometry from individual shots
       |
remove legacy duplicate copy
       |
save normalized round
```

Test against a copy first.

Verify:
- same score;
- same holes;
- same shot count/order;
- same start/finish coordinates;
- same clubs/power;
- same targets;
- same Game Master/caddie evidence;
- same replay behavior.

## 21. Suggested API Shape

Adapt to existing conventions.

```text
GET /rounds?summary=true
GET /rounds/{round_id}
GET /rounds/{round_id}/holes/{hole_number}
GET /courses/{course_id}/versions/{version_id}/holes/{hole_number}
```

Versioned immutable geometry is a good candidate for ETag/cache headers. Never publicly cache sensitive account-specific replay data.

## 22. Central Replay Loader

Avoid scattered fetch logic.

Conceptual TypeScript:

```ts
interface ReplayHoleLoader {
  loadRoundSummary(roundId: string): Promise<RoundSummary>;

  loadHole(
    roundId: string,
    holeNumber: number,
    options?: { priority?: "user" | "prefetch" }
  ): Promise<ReplayHolePackage>;

  prefetchHole(roundId: string, holeNumber: number): Promise<void>;

  getCachedHole(
    roundId: string,
    holeNumber: number
  ): ReplayHolePackage | undefined;

  evictHole(roundId: string, holeNumber: number): void;
}
```

Reuse the project's existing query/cache framework if present.

## 23. Navigation Algorithm

```text
navigateToHole(target)
        |
Is target cached?
   +----+----+
   |         |
  YES        NO
   |         |
display   high-priority fetch
   |         |
   +----+----+
        |
Update LRU usage
        |
Determine movement direction
        |
Prefetch likely neighbor(s)
        |
Evict old entries if over budget
```

## 24. Performance Instrumentation

Track in development:
- round-summary payload size;
- hole-replay payload size;
- hole-geometry payload size;
- cache hit/miss;
- prefetch hit rate;
- fetch duration;
- cached-hole count;
- estimated cache bytes;
- duplicate geometry detection;
- legacy duplicate writes.

Add warnings if:
- a shot unexpectedly contains full hole geometry;
- one shot payload exceeds expected budget;
- browser persistent replay storage grows unexpectedly;
- legacy history is duplicated.

Do not wait for browser quota failure to discover growth.

## 25. Required Tests

### Sequential
```text
1 -> 2 -> 3 -> 4
```
Verify next-hole prefetch creates cache hits.

### Backward
```text
8 -> 7 -> 6
```
Verify retained previous holes open immediately.

### Random jump
```text
3 -> 15
```
Verify:
- 15 is fetched directly;
- 4–14 are not fetched;
- 14/16 are prefetched after 15.

### Rapid jumps
```text
3 -> 15 -> 8 -> 17
```
Verify stale responses never replace the current selection.

### Cache eviction
Exceed the configured cache budget and verify LRU/priority behavior.

### Geometry reuse
Replay multiple rounds on the same course/version and verify geometry is not duplicated per round/shot.

### Warrenbrook regression
Simulate a complete high-shot-count round using the detailed imported Warrenbrook geometry.

Verify:
- no geometry repeated per shot;
- no legacy duplicate history;
- browser persistent storage remains within target budget;
- replay remains complete.

### Historical integrity
Verify old rounds use their saved/versioned course/model evidence.

## 26. Acceptance Criteria

- [ ] Server is authoritative for completed rounds.
- [ ] Login does not download all complete replays.
- [ ] Round list is lightweight.
- [ ] Opening a round first loads a lightweight 18-hole index.
- [ ] Replay can load one hole at a time.
- [ ] Hole geometry is separate from shot records.
- [ ] Same versioned geometry can be reused across rounds.
- [ ] Current-hole fetch has highest priority.
- [ ] Next hole is prefetched during forward navigation.
- [ ] Previous hole is retained when practical.
- [ ] Backward movement changes prefetch direction.
- [ ] Random jumps fetch only the requested hole.
- [ ] Random jumps prefetch neighbors afterward.
- [ ] Cache is bounded.
- [ ] LRU/priority eviction exists.
- [ ] Stale requests cannot replace current UI.
- [ ] Obsolete prefetches can be cancelled/ignored.
- [ ] Heavy replay data is not recreated as one giant localStorage object.
- [ ] New legacy duplicate history writes are removed.
- [ ] Existing oversized rounds can be migrated safely.
- [ ] Warrenbrook storage regression passes.
- [ ] Historical replay remains reproducible.

## 27. Suggested Codex Implementation Order

1. Inspect current account round synchronization.
2. Identify everything written to browser storage.
3. Locate the legacy duplicate-history write path.
4. Locate geometry embedded in shot/replay records.
5. Add payload-size instrumentation.
6. Normalize geometry out of individual shots.
7. Add/version reusable course-hole geometry resources.
8. Add lightweight round-list API.
9. Add lightweight round/hole-index API.
10. Add one-hole replay API.
11. Build centralized replay loader/cache.
12. Implement high-priority current-hole loading.
13. Implement next-hole prefetch.
14. Retain previous hole.
15. Add navigation-direction-aware prefetch.
16. Add direct random-jump loading.
17. Prefetch neighbors after random jumps.
18. Add request cancellation/race protection.
19. Add bounded LRU/priority cache.
20. Stop writing complete replay history into localStorage.
21. Stop new legacy duplicate history.
22. Build migration for existing oversized rounds.
23. Test migration on a copy of Warrenbrook New.
24. Add sequential/backward/random-jump tests.
25. Add full 18-hole detailed-course storage regression.
26. Measure real cache/payload performance and tune limits.

## 28. Final Product Behavior

Forward:

```text
WATCH HOLE 1
    |
Hole 2 quietly downloads
    |
OPEN HOLE 2
    |
Hole 2 is already available
    |
Hole 3 quietly downloads
```

Backward:

```text
ON HOLE 8
    |
Hole 7 retained
    |
PREVIOUS
    |
Hole 7 opens immediately
    |
Hole 6 becomes prefetch candidate
```

Random jump:

```text
ON HOLE 4
    |
TAP HOLE 16
    |
Fetch Hole 16 directly
    |
Display Hole 16
    |
Prefetch Hole 15 + Hole 17
```

Final architecture principle:

> **Download only what the player needs, prepare what they are most likely to need next, retain a small useful history, and let the server safely hold everything else.**
