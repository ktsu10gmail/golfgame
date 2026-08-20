import { simulateFullShot } from "./browser_engine.mjs?v=20260815-4";
import { simulateGreensideShot } from "./browser_greenside.mjs";
import { evaluateShotCandidates } from "./browser_multi_run_evaluator.mjs";

self.addEventListener("message", event => {
  const { requestId, candidates, sampleCount, analysisSeed, holeNumber } = event.data || {};
  try {
    const analysis = evaluateShotCandidates({
      candidates,
      sampleCount,
      analysisSeed,
      holeNumber,
      simulate: (candidate, identity) => candidate.engine === "greenside"
        ? simulateGreensideShot(candidate.context, identity)
        : simulateFullShot(candidate.context, identity)
    });
    self.postMessage({ requestId, analysis });
  } catch (error) {
    self.postMessage({ requestId, error: error instanceof Error ? error.message : String(error) });
  }
});
