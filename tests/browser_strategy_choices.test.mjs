import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAcademyStrategyChoices,
  buildStrategyChoices,
  buildTreeRecoveryChoices,
  choicesMeaningfullyDifferent,
  STRATEGY_CHOICES_VERSION
} from "../packages/simulation/browser_strategy_choices.mjs";
import { resolveTreeRecoveryOutcome } from "../packages/simulation/browser_tree_recovery.mjs";

const rectangle = (left, bottom, right, top) => [
  { x: left, y: bottom }, { x: right, y: bottom }, { x: right, y: top }, { x: left, y: top }
];

function fixture() {
  return {
    start: { x: 0, y: 0 },
    pin: { x: 0, y: 185 },
    centerline: [{ x: 0, y: 0 }, { x: 0, y: 185 }],
    fairways: [rectangle(-25, 20, 25, 155)],
    surfaces: [
      { surface: "green", priority: 70, polygon: rectangle(-14, 172, 14, 198) },
      { surface: "fairway", priority: 40, polygon: rectangle(-25, 20, 25, 155) },
      { surface: "rough", priority: 20, polygon: rectangle(-50, -10, 50, 205) }
    ],
    clubs: [
      { name: "3 Wood", carry: 200, accuracy: 61 },
      { name: "5 Wood", carry: 185, accuracy: 65 },
      { name: "4 Hybrid", carry: 175, accuracy: 68 },
      { name: "6 Iron", carry: 153, accuracy: 72 },
      { name: "Gap Wedge", carry: 90, accuracy: 84 },
      { name: "Putter", carry: 20, accuracy: 100 }
    ],
    lieMultiplier: 1,
    preferredApproachYards: 90
  };
}

test("reachable centered approach removes the duplicate center plan", () => {
  const input = fixture();
  input.pin = { x: 0, y: 72 };
  input.centerline = [{ x: 0, y: 0 }, { x: 0, y: 72 }];
  input.fairways = [rectangle(-20, 5, 20, 58)];
  input.surfaces = [
    { surface: "green", priority: 70, polygon: rectangle(-12, 60, 12, 84) },
    { surface: "fairway", priority: 40, polygon: rectangle(-20, 5, 20, 58) },
    { surface: "rough", priority: 20, polygon: rectangle(-35, -5, 35, 90) }
  ];
  input.clubs = [
    { name: "Sand Wedge", carry: 72, accuracy: 85 },
    { name: "Lob Wedge", carry: 55, accuracy: 82 },
    { name: "Putter", carry: 20, accuracy: 100 }
  ];
  const choices = buildStrategyChoices(input);

  assert.deepEqual(choices.map(choice => choice.id), ["aggressive", "safe_smart"]);
  assert.deepEqual(choices.map(choice => choice.title), ["Aggressive", "Safe & smart"]);
  assert.ok(choices.every(choice => choice.version === STRATEGY_CHOICES_VERSION));
  assert.equal(choices[0].clubName, "Sand Wedge");
  assert.equal(choices[0].clubName, choices[1].clubName);
  assert.notEqual(choices[0].targetLabel, choices[1].targetLabel);
  assert.ok(Math.hypot(
    choices[0].target.x - choices[1].target.x,
    choices[0].target.y - choices[1].target.y
  ) >= 5);
  assert.ok(choices.every(choice => choice.reasons.length >= 7));
});

test("a single distinct approach is returned as an honest recommendation", () => {
  const input = fixture();
  input.pin = { x: 0, y: 45 };
  input.centerline = [{ x: 0, y: 0 }, { x: 0, y: 45 }];
  input.fairways = [rectangle(-20, 5, 20, 37)];
  input.surfaces = [
    { surface: "green", priority: 70, polygon: rectangle(-1, 44, 1, 46) },
    { surface: "fairway", priority: 40, polygon: rectangle(-20, 5, 20, 37) },
    { surface: "rough", priority: 20, polygon: rectangle(-35, -5, 35, 60) }
  ];
  input.clubs = [
    { name: "Sand Wedge", carry: 72, accuracy: 85 },
    { name: "Lob Wedge", carry: 55, accuracy: 82 },
    { name: "Putter", carry: 20, accuracy: 100 }
  ];
  input.lieMultiplier = .9;
  input.startSurface = "Rough";

  const choices = buildStrategyChoices(input);

  assert.equal(choices.length, 1);
  assert.equal(choices[0].id, "recommended");
  assert.equal(choices[0].title, "Recommended");
  assert.equal(choices[0].sourcePlanId, "attack_pin");
  assert.match(choices[0].reasons[0], /too similar/);
});

test("short-game shots inside 30 yards retain a playable caddie plan", () => {
  const input = fixture();
  input.pin = { x: 0, y: 20 };
  input.centerline = [{ x: 0, y: 0 }, { x: 0, y: 20 }];
  input.fairways = [rectangle(-12, 3, 12, 15)];
  input.surfaces = [
    { surface: "green", priority: 70, polygon: rectangle(-2, 18, 2, 22) },
    { surface: "fairway", priority: 40, polygon: rectangle(-12, 3, 12, 15) },
    { surface: "rough", priority: 20, polygon: rectangle(-20, -5, 20, 30) }
  ];
  input.clubs = [
    { name: "Sand Wedge", carry: 72, accuracy: 85 },
    { name: "Lob Wedge", carry: 55, accuracy: 82 },
    { name: "Putter", carry: 20, accuracy: 100 }
  ];
  input.lieMultiplier = .9;
  input.startSurface = "Rough";

  const choices = buildStrategyChoices(input);

  assert.ok(choices.length >= 1);
  assert.ok(choices.every(choice => choice.power < 55));
  assert.ok(choices.every(choice => choice.clubName.includes("Wedge")));
});

test("62-yard rough approach uses a standard swing and ranks the closest finish first", () => {
  const input = fixture();
  input.pin = { x: 0, y: 62 };
  input.centerline = [{ x: 0, y: 0 }, { x: 0, y: 62 }];
  input.fairways = [rectangle(-18, 5, 18, 48)];
  input.surfaces = [
    { surface: "green", priority: 70, polygon: rectangle(-12, 49, 12, 70) },
    { surface: "fairway", priority: 40, polygon: rectangle(-18, 5, 18, 48) },
    { surface: "rough", priority: 20, polygon: rectangle(-35, -5, 35, 75) }
  ];
  input.clubs = [
    { name: "Sand Wedge", carry: 72, accuracy: 85 },
    { name: "Lob Wedge", carry: 55, accuracy: 82 },
    { name: "Putter", carry: 20, accuracy: 100 }
  ];
  input.lieMultiplier = .9;
  input.startSurface = "Rough";

  const choices = buildStrategyChoices(input);
  const attack = choices.find(choice => choice.id === "aggressive");

  assert.equal(attack.clubName, "Sand Wedge");
  assert.equal(attack.power, 100);
  assert.equal(attack.rollYards, 3);
  assert.equal(attack.outlook, "Best");
  assert.ok(attack.leavesYards <= 6);
  assert.match(attack.reasons.join(" "), /Allow about 3 yards of rollout/);
  assert.equal(choices.find(choice => choice.id === "safe_smart").sourcePlanId, "safe_miss");
});

test("lie loss changes the generated club or power instead of using generic distances", () => {
  const input = fixture();
  input.clubs.unshift({ name: "Driver", carry: 220, accuracy: 56 });
  const fairwayChoices = buildStrategyChoices(input);
  const roughChoices = buildStrategyChoices({ ...input, lieMultiplier: .8 });

  assert.notDeepEqual(
    roughChoices.map(choice => [choice.clubName, choice.power]),
    fairwayChoices.map(choice => [choice.clubName, choice.power])
  );
  assert.ok(roughChoices.every(choice => choice.clubName !== "Driver"));
});

test("mapped penalty hazards are disclosed in the explanation", () => {
  const input = fixture();
  input.surfaces.unshift({ surface: "water", priority: 90, polygon: rectangle(-20, 145, 20, 170) });
  const attack = buildStrategyChoices(input)[0];

  assert.ok(attack.hazards.includes("water"));
  assert.ok(attack.adviceKeys.includes("forced_water_carry"));
  assert.ok(attack.adviceKeys.includes("remove_big_miss"));
  assert.match(attack.reasons.join(" "), /water into play/);
});

test("long holes produce one aggressive and one practical safe-smart plan", () => {
  const input = fixture();
  input.pin = { x: 0, y: 510 };
  input.centerline = [{ x: 0, y: 0 }, { x: 0, y: 510 }];
  input.fairways = [rectangle(-30, 20, 30, 460)];
  input.surfaces = [
    { surface: "green", priority: 70, polygon: rectangle(-14, 495, 14, 525) },
    { surface: "fairway", priority: 40, polygon: rectangle(-30, 20, 30, 460) },
    { surface: "rough", priority: 20, polygon: rectangle(-60, -10, 60, 530) }
  ];

  const choices = buildStrategyChoices(input);
  assert.ok(choices.every(choice => [25, 50, 75, 100].includes(choice.power)));
  assert.equal(choices.length, 2);
  assert.equal(new Set(choices.map(choice => choice.clubName)).size, 2);
  assert.equal(choices[0].clubName, "3 Wood");
  assert.ok(choices[1].advancementYards >= choices[0].advancementYards * .65);
  assert.deepEqual(choices.map(choice => choice.id), ["aggressive", "safe_smart"]);
  assert.ok(choices.every(choice => !/3 distinct plans|three distinct plans/i.test(choice.reasons.join(" "))));
  assert.ok(choices.every(choice => /two player-facing plans/i.test(choice.reasons[0])));
});

test("Academy retains three genuine long-hole plans without changing normal caddie choices", () => {
  const input = fixture();
  input.pin = { x: 0, y: 510 };
  input.centerline = [{ x: 0, y: 0 }, { x: 0, y: 510 }];
  input.fairways = [rectangle(-30, 20, 30, 460)];
  input.surfaces = [
    { surface: "green", priority: 70, polygon: rectangle(-14, 495, 14, 525) },
    { surface: "fairway", priority: 40, polygon: rectangle(-30, 20, 30, 460) },
    { surface: "rough", priority: 20, polygon: rectangle(-60, -10, 60, 530) }
  ];

  const academy = buildAcademyStrategyChoices(input);
  const normal = buildStrategyChoices(input);

  assert.deepEqual(academy.map(choice => choice.id), ["attack", "safe", "smart"]);
  assert.equal(new Set(academy.map(choice => choice.clubName)).size, 3);
  assert.ok(academy.every(choice => !/ranks|calculated recommendation among/i.test(choice.reasons.join(" "))));
  assert.deepEqual(normal.map(choice => choice.id), ["aggressive", "safe_smart"]);
});

test("borderline 227-yard fairway shot keeps two honest and distinct choices", () => {
  const input = fixture();
  input.pin = { x: 10, y: 227 };
  input.centerline = [{ x: 0, y: 0 }, { x: 0, y: 120 }, { x: 10, y: 227 }];
  input.fairways = [rectangle(-20, 0, 30, 210)];
  input.surfaces = [
    { surface: "green", priority: 70, polygon: rectangle(3, 220, 17, 234) },
    { surface: "fairway", priority: 40, polygon: rectangle(-20, 0, 30, 210) },
    { surface: "rough", priority: 20, polygon: rectangle(-40, -10, 50, 245) }
  ];
  input.clubs.unshift({ name: "Driver", carry: 220, accuracy: 56 });
  input.startSurface = "Fairway";

  const choices = buildStrategyChoices(input);

  assert.deepEqual(choices.map(choice => choice.id), ["aggressive", "safe_smart"]);
  assert.equal(choices.length, 2);
  assert.ok(choices.every(choice => choice.clubName !== "Driver"));
  assert.ok(new Set(choices.map(choice => choice.clubName)).size >= 2);
  assert.ok(choicesMeaningfullyDifferent(choices[0], choices[1]));
  assert.ok(choices.every(choice => choice.mode === "long"));
});

test("driver is offered from the tee but never for a second shot", () => {
  const input = fixture();
  input.pin = { x: 0, y: 510 };
  input.centerline = [{ x: 0, y: 0 }, { x: 0, y: 510 }];
  input.fairways = [rectangle(-30, 20, 30, 460)];
  input.surfaces = [
    { surface: "green", priority: 70, polygon: rectangle(-14, 495, 14, 525) },
    { surface: "fairway", priority: 40, polygon: rectangle(-30, 20, 30, 460) },
    { surface: "rough", priority: 20, polygon: rectangle(-60, -10, 60, 530) }
  ];
  input.clubs.unshift({ name: "Driver", carry: 220, accuracy: 56 });

  const teeChoices = buildStrategyChoices({ ...input, startSurface: "Tee" });
  const fairwayChoices = buildStrategyChoices({ ...input, startSurface: "Fairway" });

  assert.equal(teeChoices[0].clubName, "Driver");
  assert.ok(fairwayChoices.every(choice => choice.clubName !== "Driver"));
  assert.equal(fairwayChoices[0].clubName, "3 Wood");
});

test("reachable approach presents the pin attack and the best safer target", () => {
  const input = fixture();
  input.pin = { x: -9, y: 185 };
  input.surfaces.unshift({ surface: "water", priority: 90, polygon: rectangle(-32, 160, -15, 202) });

  const choices = buildStrategyChoices(input);
  assert.deepEqual(choices.map(choice => choice.id), ["aggressive", "safe_smart"]);
  assert.equal(choices[0].targetLabel, "Pin line");
  assert.ok(["green_center", "safe_miss"].includes(choices[1].sourcePlanId));
  assert.ok(choices[1].risk < choices[0].risk);
});

test("short third shot never falls back to a partial fairway wood", () => {
  const input = fixture();
  input.pin = { x: 0, y: 123 };
  input.centerline = [{ x: 0, y: 0 }, { x: 0, y: 123 }];
  input.fairways = [rectangle(-18, 5, 18, 117)];
  input.surfaces = [
    { surface: "green", priority: 70, polygon: rectangle(-3, 119, 3, 127) },
    { surface: "fairway", priority: 40, polygon: rectangle(-18, 5, 18, 117) },
    { surface: "rough", priority: 20, polygon: rectangle(-35, -5, 35, 132) }
  ];
  input.clubs = [
    { name: "3 Wood", carry: 200, accuracy: 61 },
    { name: "7 Iron", carry: 142, accuracy: 75 },
    { name: "8 Iron", carry: 130, accuracy: 78 },
    { name: "9 Iron", carry: 118, accuracy: 81 },
    { name: "Gap Wedge", carry: 90, accuracy: 84 },
    { name: "Putter", carry: 20, accuracy: 100 }
  ];
  input.startSurface = "Fairway";

  const choices = buildStrategyChoices(input);

  assert.ok(choices.length >= 1);
  assert.ok(choices.every(choice => choice.mode === "approach"));
  assert.ok(choices.every(choice => !choice.clubName.includes("Wood")));
  assert.ok(choices.every(choice => choice.power >= 55));
});

test("safe approach prefers a normal shorter iron when a distant bunker leaves ample clearance", () => {
  const input = fixture();
  input.pin = { x: 0, y: 125 };
  input.centerline = [{ x: 0, y: 0 }, { x: 0, y: 125 }];
  input.fairways = [rectangle(-22, 5, 22, 108)];
  input.surfaces = [
    { surface: "bunker", priority: 80, polygon: rectangle(18, 195, 34, 207) },
    { surface: "green", priority: 70, polygon: rectangle(-14, 113, 14, 137) },
    { surface: "fairway", priority: 40, polygon: rectangle(-22, 5, 22, 108) },
    { surface: "rough", priority: 20, polygon: rectangle(-45, -5, 45, 215) }
  ];
  input.clubs = [
    { name: "6 Iron", carry: 153, accuracy: 72 },
    { name: "7 Iron", carry: 142, accuracy: 75 },
    { name: "8 Iron", carry: 130, accuracy: 78 },
    { name: "9 Iron", carry: 118, accuracy: 81 },
    { name: "Putter", carry: 20, accuracy: 100 }
  ];
  input.lieMultiplier = .9;
  input.startSurface = "Rough";

  const safe = buildStrategyChoices(input).find(choice => choice.id === "safe_smart");

  assert.ok(safe);
  assert.ok(safe.power >= 90, `${safe.clubName} was only ${safe.power}%`);
  assert.notEqual(safe.clubName, "6 Iron");
  assert.ok(safe.hazardClearanceYards >= 60);
  assert.equal(safe.partialSwingPenalty, 0);
  assert.deepEqual(safe.adviceKeys, ["rough_medium", "favor_safe_side"]);
  assert.match(safe.reasons.join(" "), /full swing/);
});

test("smart layup moves a route-line rough target into the mapped fairway", () => {
  const input = fixture();
  input.pin = { x: 0, y: 270 };
  input.centerline = [{ x: 0, y: 0 }, { x: 0, y: 270 }];
  input.fairways = [rectangle(10, 145, 30, 198)];
  input.surfaces = [
    { surface: "green", priority: 70, polygon: rectangle(-12, 258, 12, 282) },
    { surface: "fairway", priority: 40, polygon: rectangle(10, 145, 30, 198) },
    { surface: "rough", priority: 20, polygon: rectangle(-50, -10, 50, 290) }
  ];

  const choices = buildStrategyChoices(input);
  const smart = choices.find(choice => choice.id === "safe_smart");

  assert.ok(smart);
  assert.equal(smart.landingSurface, "fairway");
  assert.ok(smart.target.x >= 10 && smart.target.x <= 30);
  assert.ok(smart.target.y >= 145 && smart.target.y <= 198);
});

test("recovery situations still provide aggressive and safe-smart recovery choices", () => {
  const choices = buildStrategyChoices({
    ...fixture(),
    lieMultiplier: .72,
    startSurface: "Bunker",
    recoveryRequired: true
  });

  assert.deepEqual(choices.map(choice => choice.id), ["aggressive", "safe_smart"]);
  assert.ok(["escape", "position"].includes(choices[1].sourcePlanId));
  assert.ok(choices.every(choice => choice.mode === "recovery"));
  assert.ok(choices.every(choice => !choice.clubName.includes("Wood")));
});

test("tree recovery offers honest risk contracts and a seeded outcome", () => {
  const input = fixture();
  const choices = buildTreeRecoveryChoices({
    ...input,
    lieMultiplier: .65,
    treeCondition: { tree_position: "under_canopy", pin_line: "partially_blocked" }
  });
  assert.ok(choices.length >= 1 && choices.length <= 2);
  for (const choice of choices) {
    const probability = choice.treeRecovery.probabilities;
    assert.equal(Math.round((probability.clean_escape + probability.branch_clip + probability.major_tree_contact) * 1000), 1000);
    assert.ok(choice.treeRecovery.reward.overall_expected_leave_yards >= choice.treeRecovery.reward.expected_leave_if_clean_yards);
  }
  const first = resolveTreeRecoveryOutcome(choices[0].treeRecovery.probabilities, "round:1:2:tree");
  assert.deepEqual(first, resolveTreeRecoveryOutcome(choices[0].treeRecovery.probabilities, "round:1:2:tree"));
});

test("meaningful difference requires a material club, power, target, result, or risk change", () => {
  const base = {
    clubIndex: 4, power: 100, target: { x: 0, y: 72 }, leavesYards: 2,
    landingSurface: "green", hazards: [], risk: 12
  };
  assert.equal(choicesMeaningfullyDifferent(base, { ...base, target: { x: 2, y: 72 }, risk: 15 }), false);
  assert.equal(choicesMeaningfullyDifferent(base, { ...base, target: { x: 6, y: 72 } }), true);
  assert.equal(choicesMeaningfullyDifferent(base, { ...base, power: 94 }), true);
});

test("legacy simulated approach-band evidence cannot personalize a caddie plan", () => {
  const input = fixture();
  input.pin = { x: 0, y: 270 };
  input.centerline = [{ x: 0, y: 0 }, { x: 0, y: 270 }];
  input.fairways = [rectangle(-30, 20, 30, 245)];
  input.surfaces = [
    { surface: "green", priority: 70, polygon: rectangle(-14, 258, 14, 282) },
    { surface: "fairway", priority: 40, polygon: rectangle(-30, 20, 30, 245) },
    { surface: "rough", priority: 20, polygon: rectangle(-55, -10, 55, 290) }
  ];
  input.verifiedApproachBand = {
    kind: "preferred_distance_band",
    key: "110_139_yd",
    confidence: "verified",
    sample_size: 12,
    round_count: 4,
    decision_score: 88,
    execution_score: 84
  };

  const choices = buildStrategyChoices(input);

  assert.ok(choices.every(choice => !("playerFit" in choice)));
  assert.ok(choices.every(choice => !choice.reasons.join(" ").includes("your verified")));
});
