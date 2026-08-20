export function createUndoHistory({ limit = 40, coalesceWindowMs = 1200, now = () => Date.now() } = {}) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("undo history limit must be positive");
  const entries = [];
  let lastKey = null;
  let lastTime = 0;

  return {
    push(state, label, { key = null } = {}) {
      const timestamp = now();
      if (key && key === lastKey && timestamp - lastTime <= coalesceWindowMs) {
        lastTime = timestamp;
        return false;
      }
      entries.push({ state: structuredClone(state), label: String(label || "change") });
      if (entries.length > limit) entries.shift();
      lastKey = key;
      lastTime = timestamp;
      return true;
    },
    pop() {
      lastKey = null;
      lastTime = 0;
      return entries.pop() || null;
    },
    clear() {
      entries.length = 0;
      lastKey = null;
      lastTime = 0;
    },
    get size() {
      return entries.length;
    },
    get nextLabel() {
      return entries.at(-1)?.label || null;
    }
  };
}
