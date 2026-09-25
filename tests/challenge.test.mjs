import test from "node:test";
import assert from "node:assert/strict";

import {
  challengeScoreToPar,
  compactChallengeForStorage,
  createChallengeState,
  officialMatchState,
  postedScoreRequirement,
  recordChallengeHole,
  startChallenge
} from "../packages/challenge/challenge_state.mjs";
import {
  challengeSeeds,
  generateChallengeHoles,
  orderedChallengeCandidates,
  replaceIneligibleHole
} from "../packages/challenge/challenge_generator.mjs";
import { ChallengeHoleLoader } from "../packages/challenge/challenge_hole_loader.mjs";
import { ChallengeAudioDirector, resolveChallengeAudioEvent } from "../packages/audio/challenge_audio.mjs";

const candidates = [3, 4, 5].flatMap(par => ["alpha", "beta", "gamma"].map((course, index) => ({
  course_id: course,
  course_version_id: "v1",
  course_name: course,
  source_hole_number: par + index,
  par
})));

const profile = { id: "90", name: "90+", clubs: [] };

test("challenge generation always orders Par 3, Par 4, Par 5 and prefers three courses", () => {
  const holes = generateChallengeHoles(candidates, { selectionSeed: 123, teeId: "White" });
  assert.deepEqual(holes.map(hole => hole.par), [3, 4, 5]);
  assert.equal(new Set(holes.map(hole => hole.course_id)).size, 3);
  assert.deepEqual(holes.map(hole => hole.challenge_slot), [1, 2, 3]);
});

test("challenge generation falls back safely when only one course exists", () => {
  const oneCourse = candidates.filter(candidate => candidate.course_id === "alpha");
  const holes = generateChallengeHoles(oneCourse, { selectionSeed: 7 });
  assert.deepEqual(holes.map(hole => hole.par), [3, 4, 5]);
  assert.equal(new Set(holes.map(hole => hole.course_id)).size, 1);
});

test("recent holes are avoided and rejected candidates can be replaced deterministically", () => {
  const recent = ["alpha:3"];
  const ordered = orderedChallengeCandidates(candidates, 12, recent);
  assert.notEqual(`${ordered[0][0].course_id}:${ordered[0][0].source_hole_number}`, recent[0]);
  const initial = generateChallengeHoles(candidates, { selectionSeed: 12 });
  const rejected = `${initial[0].course_id}:${initial[0].source_hole_number}`;
  const next = replaceIneligibleHole(initial, 0, ordered, [rejected]);
  assert.notEqual(`${next[0].course_id}:${next[0].source_hole_number}`, rejected);
  assert.equal(next[0].par, 3);
});

test("selection, pin, player and GM seed concerns are independent", () => {
  const seeds = challengeSeeds(9182);
  assert.equal(new Set(Object.values(seeds)).size, 4);
  assert.equal(seeds.selection_seed, 9182);
});

function challenge() {
  const seeds = challengeSeeds(42);
  const holes = generateChallengeHoles(candidates, { selectionSeed: seeds.selection_seed });
  return startChallenge(createChallengeState({
    id: "challenge-test",
    holes,
    seeds,
    playerProfile: profile,
    gmProfile: { ...profile, id: "90-gm" }
  }));
}

test("official lead changes only after both posted scores are recorded", () => {
  let state = challenge();
  assert.deepEqual(officialMatchState(state), { player: 0, gm: 0, completed: 0, leader: "TIED", margin: 0 });
  state = recordChallengeHole(state, {
    playerScore: 3,
    gmScore: 4,
    humanHole: { hole_number: 1, score: 3, events: [] },
    strategistHole: { hole_number: 1, score: 4, events: [] }
  });
  assert.equal(state.holes[0].official_leader_after_hole.leader, "PLAYER");
  assert.equal(state.holes[0].official_leader_after_hole.margin, 1);
});

test("challenge scoreboard reports completed-hole score to par without recounting the active hole", () => {
  let state = challenge();
  state = recordChallengeHole(state, {
    playerScore: 4,
    gmScore: 4,
    humanHole: { hole_number: 1, score: 4, events: [] },
    strategistHole: { hole_number: 1, score: 4, events: [] }
  });
  state = recordChallengeHole(state, {
    slot: 1,
    playerScore: 5,
    gmScore: 4,
    humanHole: { hole_number: 2, score: 5, events: [] },
    strategistHole: { hole_number: 2, score: 4, events: [] }
  });
  assert.deepEqual(challengeScoreToPar(state, 1), {
    player: 9,
    gm: 8,
    par: 7,
    completed: 2,
    player_to_par: 2,
    gm_to_par: 1
  });
});

test("completed challenges preserve implementation versions and measure duration", () => {
  const seeds = challengeSeeds(42);
  let state = startChallenge(createChallengeState({
    id: "challenge-versioned",
    holes: generateChallengeHoles(candidates, { selectionSeed: seeds.selection_seed }),
    seeds,
    playerProfile: profile,
    gmProfile: { ...profile, id: "90-gm" },
    implementationVersions: { simulation: "engine-v4", evaluator: "evaluator-v1" },
    now: "2026-09-16T12:00:00.000Z"
  }), "2026-09-16T12:00:00.000Z");
  for (let slot = 0; slot < 3; slot += 1) {
    state = recordChallengeHole(state, {
      slot,
      playerScore: state.holes[slot].par,
      gmScore: state.holes[slot].par,
      humanHole: { hole_number: slot + 1, score: state.holes[slot].par, events: [] },
      strategistHole: { hole_number: slot + 1, score: state.holes[slot].par, events: [] },
      now: `2026-09-16T12:0${slot + 1}:00.000Z`
    });
  }
  assert.deepEqual(state.implementation_versions, { simulation: "engine-v4", evaluator: "evaluator-v1" });
  assert.equal(state.duration_seconds, 180);
});

test("posted final-hole requirements are mathematically derived without changing official lead", () => {
  assert.deepEqual(postedScoreRequirement({ completedPlayer: 7, completedGm: 8, postedScore: 4 }), {
    score_to_tie: 5,
    score_to_win: 4
  });
});

test("challenge compaction removes embedded simulation geometry", () => {
  const state = challenge();
  state.human_state.holes[0].events.push({ payload: { shot: { resultRequest: { context: { surfaces: [1, 2] } } } } });
  const compact = compactChallengeForStorage(state);
  assert.equal(compact.human_state.holes[0].events[0].payload.shot.resultRequest.context.surfaces, undefined);
});

test("single-hole loader caches bounded selected holes and retries failures", async () => {
  let jsonCalls = 0;
  const loader = new ChallengeHoleLoader({
    fetchText: async () => "Hole,Par\n1,3",
    fetchJson: async () => { jsonCalls += 1; return { hole_metadata: { par: 3 } }; },
    maxHoles: 2
  });
  const course = { id: "alpha", dataVersion: "v1", dataPath: "data/alpha", scorecard: "scorecard.csv", holeFile: number => `hole${number}.json` };
  await loader.load(course, 1);
  await loader.load(course, 1);
  assert.equal(jsonCalls, 1);
});

test("audio resolver is presentation-only and omits fringe-specific v1 behavior", () => {
  const facts = Object.freeze({ kind: "shot", reason_codes: Object.freeze(["GREEN_REACHED"]), close: true });
  const snapshot = JSON.stringify(facts);
  const cues = resolveChallengeAudioEvent(facts);
  assert.ok(cues.some(cue => cue.event === "CLOSE_APPROACH"));
  assert.equal(JSON.stringify(facts), snapshot);
  assert.deepEqual(resolveChallengeAudioEvent({ kind: "shot", reason_codes: ["FRINGE_FINISH"] }), []);
});

test("challenge SFX covers impact, flight, landing, cup and penalty without mutating facts", () => {
  assert.deepEqual(resolveChallengeAudioEvent({ kind: "shot_start" }).map(cue => cue.event), ["impact", "flight"]);
  assert.deepEqual(resolveChallengeAudioEvent({ kind: "cup" }).map(cue => cue.event), ["cup"]);
  assert.ok(resolveChallengeAudioEvent({ kind: "shot", reason_codes: [] }).some(cue => cue.event === "landing"));
  assert.ok(resolveChallengeAudioEvent({ kind: "shot", reason_codes: ["WATER_PENALTY"] }).some(cue => cue.event === "penalty"));
});

test("challenge announcer briefly calls the Game Master's shot result", () => {
  const eventFor = facts => resolveChallengeAudioEvent({ kind: "gm_shot_result", ...facts })
    .find(cue => cue.category === "announcer")?.event;
  assert.equal(eventFor({ lie: "Bunker" }), "GM_BUNKER");
  assert.equal(eventFor({ lie: "Heavy rough" }), "GM_ROUGH");
  assert.equal(eventFor({ lie: "Green" }), "GM_GREEN");
  assert.equal(eventFor({ lie: "Green", putt: true }), "GM_PUTT_MISS");
  assert.equal(eventFor({ lie: "Green", putt: true, completion_type: "holed" }), "GM_HOLED");
  assert.equal(eventFor({ lie: "Green", putt: true, completion_type: "gimme" }), "GM_GIMME");
  assert.equal(eventFor({ lie: "Fairway", penalty_strokes: 1 }), "GM_PENALTY");
});

test("audio channels remain independent and missing optional audio resolves without blocking", async () => {
  const director = new ChallengeAudioDirector({ settings: { music: .4, announcer: .7, sfx: .6, crowd: .3 } });
  const gains = Object.fromEntries(["master", "music", "announcer", "sfx", "crowd"].map(name => [name, {
    gain: { value: 0, cancelScheduledValues() {}, setTargetAtTime(value) { this.value = value; } }
  }]));
  director.nodes = gains;
  director.context = { currentTime: 0 };
  director.applySettings();
  assert.deepEqual([gains.music.gain.value, gains.announcer.gain.value, gains.sfx.gain.value, gains.crowd.gain.value], [.4, .7, .6, .3]);
  director.setMusicDucked(true);
  assert.equal(gains.music.gain.value, .4 * .28);
  await director.playAnnouncement("CHALLENGE_START", director.generation);
  assert.equal(gains.music.gain.value, .4);
  director.cancel();
  assert.deepEqual(director.queue, []);
});
