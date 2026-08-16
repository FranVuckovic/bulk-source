import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { pct, prescribedLoad } from '../js/calc.js';
import { prescribedSetCount } from '../js/progress.js';
import { MIN_COUNTED_WEIGHT, sessionVolume } from '../js/volume.js';

/**
 * The plan is data, not code — which only works if the data is well formed.
 * These are the checks that catch a plan file edited by hand at 11pm.
 */
const PLAN = JSON.parse(
  readFileSync(new URL('../data/plan-bulk-v1.json', import.meta.url), 'utf8')
);

test('the plan declares its format and its rotation', () => {
  assert.equal(PLAN.format, 1);
  assert.deepEqual(PLAN.meta.rotation, ['A', 'B', 'C', 'D', 'E', 'F']);
  assert.equal(PLAN.meta.startDateISO, '2026-08-17');
  assert.match(PLAN.meta.startDateISO, /^\d{4}-\d{2}-\d{2}$/);
});

test('every session in the rotation exists, and every session is in the rotation', () => {
  const ids = PLAN.sessions.map((s) => s.id);
  assert.deepEqual([...ids].sort(), [...PLAN.meta.rotation].sort());
});

test('every slot points at an exercise that exists', () => {
  for (const session of PLAN.sessions) {
    for (const slot of session.slots) {
      assert.ok(PLAN.exercises[slot.ex], `${session.id} references missing exercise ${slot.ex}`);
      assert.ok(slot.sets > 0, `${session.id}/${slot.ex} has no sets`);
      assert.ok(slot.reps > 0, `${session.id}/${slot.ex} has no reps`);
      assert.ok(slot.rpe >= 5 && slot.rpe <= 10, `${session.id}/${slot.ex} RPE ${slot.rpe}`);
      assert.ok(slot.restSec > 0, `${session.id}/${slot.ex} has no rest period`);
    }
  }
});

test('every muscle an exercise names exists, with a sane weight', () => {
  for (const [id, exercise] of Object.entries(PLAN.exercises)) {
    for (const [muscleId, weight] of Object.entries(exercise.m)) {
      assert.ok(PLAN.muscles[muscleId], `${id} references missing muscle ${muscleId}`);
      assert.ok(weight > 0 && weight <= 1, `${id}/${muscleId} weight ${weight}`);
    }
  }
});

test('a weight below the counting floor contributes nothing', () => {
  // The plan is carried over verbatim from the reviewed demo, which leaves one
  // sub-0.3 weight in place (pushdown → triceps long head, 0.2). BUILD-BRIEF.md
  // says such weights are excluded from the data entirely; rather than edit a
  // muscle map, volume.js filters them, so the ledger is the same either way.
  const belowFloor = Object.entries(PLAN.exercises).flatMap(([id, x]) =>
    Object.entries(x.m).filter(([, w]) => w < MIN_COUNTED_WEIGHT).map(([m, w]) => `${id}/${m}=${w}`)
  );
  assert.deepEqual(belowFloor, ['pushdown/triLong=0.2']);

  const withIt = sessionVolume({ slots: [{ ex: 'pushdown', sets: 3 }] }, PLAN.exercises);
  assert.deepEqual(withIt, { triLat: 3 }, 'the 0.2 contribution is not counted');
});

test('every exercise carries what the Plan screen shows', () => {
  for (const [id, exercise] of Object.entries(PLAN.exercises)) {
    assert.ok(exercise.name, `${id} has no name`);
    assert.ok(exercise.why, `${id} has no rationale`);
    assert.ok(Array.isArray(exercise.how) && exercise.how.length, `${id} has no cues`);
    assert.ok(Array.isArray(exercise.subs), `${id} has no substitutes list`);
    assert.ok(exercise.defaultRestSec > 0, `${id} has no rest default`);
    assert.equal('refPhotoId' in exercise, true, `${id} has no reference-photo slot`);
  }
});

test('exercises that track a max declare how much to trust it', () => {
  const tracked = Object.entries(PLAN.exercises).filter(([, x]) => x.tracksMax);
  assert.ok(tracked.length > 0);

  for (const [id, exercise] of tracked) {
    assert.ok(['high', 'ind'].includes(exercise.maxConf), `${id} has maxConf ${exercise.maxConf}`);
  }

  // The lifts the protocol names as high-confidence strength numbers.
  for (const id of ['benchComp', 'benchVar', 'inclineDB', 'pullupNorm', 'dip', 'legpress']) {
    assert.equal(PLAN.exercises[id].maxConf, 'high', id);
  }

  // Isolation work prescribes loads but never claims a PR.
  for (const id of ['lateral', 'curlEZ', 'pushdown', 'inclineFly']) {
    assert.equal(PLAN.exercises[id].maxConf, 'ind', id);
  }
});

test('index sets are on the lifts the protocol names, one per lift per session', () => {
  const indexSlots = PLAN.sessions.flatMap((s) =>
    s.slots.filter((slot) => slot.idx).map((slot) => `${s.id}:${slot.ex}`)
  );

  assert.deepEqual(indexSlots, [
    'A:benchComp',
    'A:pullupNorm',
    'B:legpress',
    'C:inclineDB',
    'C:pullupWide',
    'D:ohpLadder',
    'E:benchComp',
    'E:dip',
  ]);

  // The bench AMRAP is the one index set taken to failure, and it goes first.
  const sessionE = PLAN.sessions.find((s) => s.id === 'E');
  assert.equal(sessionE.slots[0].amrap, true);
  assert.equal(sessionE.slots[0].ex, 'benchComp');
  assert.equal(sessionE.slots[0].idx, true);
});

test('every block declares a session target derived from its weeks', () => {
  assert.equal(PLAN.blocks.length, 7);

  for (const block of PLAN.blocks) {
    assert.equal(block.sessionTarget, block.weeks * PLAN.meta.rotation.length, block.n);
    assert.ok(block.theme && block.cap && Array.isArray(block.changes) && block.changes.length);
  }

  // Blocks 1–4 are the six-week blocks the plan is built around.
  assert.equal(PLAN.blocks[1].sessionTarget, 36);
  assert.equal(PLAN.blocks.reduce((total, b) => total + b.weeks, 0), 33, '33 weeks in total');
});

test('the fallbacks and knowledge base are present', () => {
  assert.equal(PLAN.fallbacks.fourDay.length, 4);
  assert.equal(PLAN.fallbacks.threeDay.length, 3);
  assert.ok(
    PLAN.fallbacks.fourDay.some((d) => d.contents.includes('AMRAP')),
    'the AMRAP is the last thing to go'
  );

  assert.ok(PLAN.knowledge.length >= 20, `${PLAN.knowledge.length} knowledge entries`);
  for (const entry of PLAN.knowledge) {
    assert.ok(entry.s && entry.t && entry.c, `incomplete knowledge entry ${entry.t}`);
  }
});

test('bodyweight-loaded lifts are flagged, and their seeds are total loads', () => {
  const bodyweight = PLAN.meta.referenceBodyweightKg;
  assert.equal(bodyweight, 90);

  const loaded = Object.entries(PLAN.exercises)
    .filter(([, x]) => x.bodyweightLoaded)
    .map(([id]) => id)
    .sort();
  assert.deepEqual(loaded, ['chinup', 'dip', 'pullupNorm', 'pullupWide']);

  // Seeds for those lifts are bodyweight + added: +32 on the tracked pull-up,
  // +38 on the dip. Only the tracked variant is seeded — the wide grip and the
  // chin-up are the second exposure and earn a max from their own first set.
  assert.equal(PLAN.meta.seedWorkingMaxes.pullupNorm, bodyweight + 32);
  assert.equal(PLAN.meta.seedWorkingMaxes.dip, bodyweight + 38);
  assert.equal(PLAN.meta.seedWorkingMaxes.pullupWide, undefined);
  assert.equal(PLAN.meta.seedWorkingMaxes.chinup, undefined);
  assert.equal(PLAN.meta.seedWorkingMaxes.pullup, undefined, 'the pre-split key is gone');

  // Every seeded lift names an exercise that exists.
  for (const id of Object.keys(PLAN.meta.seedWorkingMaxes)) {
    assert.ok(PLAN.exercises[id], `seed max for unknown exercise ${id}`);
  }
});

test('the plan prescribes real loads from its own seed maxes', () => {
  const { seedWorkingMaxes } = PLAN.meta;
  assert.equal(seedWorkingMaxes.benchComp, 115);

  const sessionA = PLAN.sessions.find((s) => s.id === 'A');
  const [topSingle, backOffs] = sessionA.slots;

  assert.equal(prescribedLoad(topSingle, seedWorkingMaxes.benchComp, 2.5), 105);
  assert.equal(prescribedLoad(backOffs, seedWorkingMaxes.benchComp, 2.5), 90);
  assert.equal(pct(topSingle.reps, topSingle.rpe), 92.2);

  // Speed bench is deliberately not a tracked lift, so it prescribes nothing.
  const sessionD = PLAN.sessions.find((s) => s.id === 'D');
  assert.equal(prescribedLoad(sessionD.slots[0], seedWorkingMaxes.benchSpeed), null);
});

test('session sizes match what the plan says they are', () => {
  const setsPerSession = Object.fromEntries(
    PLAN.sessions.map((s) => [s.id, prescribedSetCount(s)])
  );

  // Straight from the shipped sessions — a slot added or dropped by hand shows
  // up here rather than quietly changing a session's length.
  assert.deepEqual(setsPerSession, { A: 30, B: 29, C: 22, D: 35, E: 24, F: 32 });
  for (const session of PLAN.sessions) {
    assert.ok(session.mins, `${session.id} has no duration estimate`);
    assert.ok(session.purpose && session.key, `${session.id} has no rationale`);
  }
});
