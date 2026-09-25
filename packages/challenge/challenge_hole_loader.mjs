export class ChallengeHoleLoader {
  constructor({ fetchText = url => fetch(url).then(response => {
    if (!response.ok) throw new Error(`Could not load ${url}`);
    return response.text();
  }), fetchJson = url => fetch(url).then(response => {
    if (!response.ok) throw new Error(`Could not load ${url}`);
    return response.json();
  }), maxHoles = 3 } = {}) {
    this.fetchText = fetchText;
    this.fetchJson = fetchJson;
    this.maxHoles = maxHoles;
    this.cache = new Map();
    this.sequence = 0;
  }

  key(course, holeNumber) {
    return `${course.id}:${course.dataVersion}:${holeNumber}`;
  }

  async load(course, holeNumber) {
    if (!course?.id || !Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > 18) {
      throw new Error("valid course and hole number are required");
    }
    const key = this.key(course, holeNumber);
    const existing = this.cache.get(key);
    if (existing) {
      existing.used = ++this.sequence;
      return existing.promise;
    }
    const version = encodeURIComponent(course.dataVersion || "v1");
    const promise = Promise.all([
      this.fetchText(`${course.dataPath}/${course.scorecard}?v=${version}`),
      this.fetchJson(`${course.dataPath}/${course.holeFile(holeNumber)}?v=${version}`)
    ]).then(([scoreText, rawHole]) => ({ scoreText, rawHole, course, holeNumber }));
    this.cache.set(key, { promise, used: ++this.sequence });
    this.trim();
    try {
      return await promise;
    } catch (error) {
      this.cache.delete(key);
      throw error;
    }
  }

  prefetch(course, holeNumber) {
    return this.load(course, holeNumber).catch(() => null);
  }

  trim() {
    if (this.cache.size <= this.maxHoles) return;
    const oldest = [...this.cache.entries()].sort((a, b) => a[1].used - b[1].used)[0];
    if (oldest) this.cache.delete(oldest[0]);
  }

  clear() {
    this.cache.clear();
  }
}
