const DEFAULT_LIMIT = 6;

function cacheKey(roundId, holeNumber) {
  return `${roundId}:${holeNumber}`;
}

function touch(cache, key, value) {
  cache.delete(key);
  cache.set(key, value);
}

function trim(cache, limit, protectedKeys = new Set()) {
  while (cache.size > limit) {
    let candidate = null;
    for (const key of cache.keys()) {
      if (!protectedKeys.has(key)) {
        candidate = key;
        break;
      }
    }
    if (candidate == null) break;
    cache.delete(candidate);
  }
}

export class ReplayHoleLoader {
  constructor({ fetchJson, maxHoles = DEFAULT_LIMIT, onMetric = () => {} } = {}) {
    if (typeof fetchJson !== "function") throw new Error("fetchJson is required");
    this.fetchJson = fetchJson;
    this.maxHoles = Math.max(3, Math.min(12, Number(maxHoles) || DEFAULT_LIMIT));
    this.onMetric = onMetric;
    this.replayCache = new Map();
    this.geometryCache = new Map();
    this.inflight = new Map();
    this.prefetchControllers = new Map();
    this.navigationSequence = 0;
    this.current = null;
  }

  async loadRoundSummary(roundId) {
    return this.fetchJson(`/api/player/rounds/${encodeURIComponent(roundId)}`);
  }

  getCachedHole(roundId, holeNumber) {
    const key = cacheKey(roundId, holeNumber);
    const value = this.replayCache.get(key);
    if (value) touch(this.replayCache, key, value);
    return value;
  }

  evictHole(roundId, holeNumber) {
    const key = cacheKey(roundId, holeNumber);
    this.replayCache.delete(key);
    for (const geometryKey of this.geometryCache.keys()) {
      if (geometryKey.endsWith(`:${holeNumber}`)) this.geometryCache.delete(geometryKey);
    }
  }

  async loadHole(roundId, holeNumber, { priority = "user", signal } = {}) {
    const key = cacheKey(roundId, holeNumber);
    const cached = this.getCachedHole(roundId, holeNumber);
    if (cached) {
      this.onMetric({ type: "cache_hit", cache: "replay", roundId, holeNumber });
      return cached;
    }
    this.onMetric({ type: "cache_miss", cache: "replay", roundId, holeNumber, priority });
    if (this.inflight.has(key)) return this.inflight.get(key);
    const started = performance.now();
    const request = this.fetchJson(
      `/api/player/rounds/${encodeURIComponent(roundId)}/holes/${holeNumber}`,
      { signal }
    ).then(payload => {
      touch(this.replayCache, key, payload);
      trim(this.replayCache, this.maxHoles, this.protectedReplayKeys());
      this.onMetric({
        type: "fetch_complete", cache: "replay", roundId, holeNumber,
        priority, milliseconds: Math.round(performance.now() - started),
        bytes: JSON.stringify(payload).length, cachedHoles: this.replayCache.size
      });
      return payload;
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, request);
    return request;
  }

  async loadGeometry(courseId, versionId, holeNumber, { signal } = {}) {
    const key = `${courseId}:${versionId}:${holeNumber}`;
    if (this.geometryCache.has(key)) {
      const value = this.geometryCache.get(key);
      touch(this.geometryCache, key, value);
      this.onMetric({ type: "cache_hit", cache: "geometry", courseId, versionId, holeNumber });
      return value;
    }
    const payload = await this.fetchJson(
      `/api/courses/${encodeURIComponent(courseId)}/versions/${encodeURIComponent(versionId)}/holes/${holeNumber}`,
      { signal }
    );
    touch(this.geometryCache, key, payload);
    trim(this.geometryCache, this.maxHoles);
    return payload;
  }

  protectedReplayKeys() {
    if (!this.current) return new Set();
    const { roundId, holeNumber } = this.current;
    return new Set([holeNumber - 1, holeNumber, holeNumber + 1]
      .filter(number => number >= 1 && number <= 18)
      .map(number => cacheKey(roundId, number)));
  }

  cancelPrefetches(exceptKey = null) {
    for (const [key, controller] of this.prefetchControllers) {
      if (key === exceptKey) continue;
      controller.abort();
      this.prefetchControllers.delete(key);
    }
  }

  async prefetchHole(roundId, holeNumber) {
    if (holeNumber < 1 || holeNumber > 18 || this.getCachedHole(roundId, holeNumber)) return;
    const key = cacheKey(roundId, holeNumber);
    if (this.prefetchControllers.has(key)) return;
    const controller = new AbortController();
    this.prefetchControllers.set(key, controller);
    try {
      const replay = await this.loadHole(roundId, holeNumber, { priority: "prefetch", signal: controller.signal });
      await this.loadGeometry(replay.course_id, replay.course_version_id, holeNumber, { signal: controller.signal });
    } catch (error) {
      if (error?.name !== "AbortError") this.onMetric({ type: "prefetch_error", roundId, holeNumber });
    } finally {
      this.prefetchControllers.delete(key);
    }
  }

  async navigateToHole(roundId, holeNumber) {
    if (!Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > 18) {
      throw new Error("holeNumber must be between 1 and 18");
    }
    const sequence = ++this.navigationSequence;
    const previous = this.current;
    this.cancelPrefetches(cacheKey(roundId, holeNumber));
    const replay = await this.loadHole(roundId, holeNumber, { priority: "user" });
    const geometry = await this.loadGeometry(replay.course_id, replay.course_version_id, holeNumber);
    if (sequence !== this.navigationSequence) return { stale: true, replay, geometry };
    this.current = { roundId, holeNumber };
    const delta = previous?.roundId === roundId ? holeNumber - previous.holeNumber : 0;
    const neighbors = Math.abs(delta) > 1 || delta === 0
      ? [holeNumber - 1, holeNumber + 1]
      : [holeNumber + Math.sign(delta)];
    for (const neighbor of neighbors) void this.prefetchHole(roundId, neighbor);
    trim(this.replayCache, this.maxHoles, this.protectedReplayKeys());
    return { stale: false, replay, geometry };
  }

  diagnostics() {
    return {
      replayHoles: this.replayCache.size,
      geometryHoles: this.geometryCache.size,
      inflight: this.inflight.size,
      estimatedBytes: [...this.replayCache.values(), ...this.geometryCache.values()]
        .reduce((total, value) => total + JSON.stringify(value).length, 0)
    };
  }
}
