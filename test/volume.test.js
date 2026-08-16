import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MIN_COUNTED_WEIGHT,
  DIMINISHING_RETURNS_SETS,
  sessionVolume,
  sessionMuscles,
  weeklyVolume,
  volumeFromSets,
  rollUp,
  volumeByGroup,
  bandStatus,
  pastDiminishingReturns,
} from '../js/volume.js';

/**
 * The shipped plan's muscle maps, sessions and muscle definitions, extracted
 * verbatim from docs/demo.html. The demo's volume figures are the reviewed
 * ones, so the fixture is the data itself rather than numbers retyped by hand.
 */
const PLAN = JSON.parse(
  readFileSync(new URL('./fixtures/plan-demo.json', import.meta.url), 'utf8')
);
const { muscles, exercises, sessions } = PLAN;

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

/* ── fractional counting ─────────────────────────────────────────────── */

test('a set counts fractionally per muscle, not as a whole set for each', () => {
  // Bench is a full set of mid chest, half a set of triceps and front delts.
  const session = { slots: [{ ex: 'benchComp', sets: 5, reps: 5, rpe: 8 }] };
  assert.deepEqual(sessionVolume(session, exercises), {
    chestMid: 5,
    triLat: 2.5,
    deltFront: 2.5,
  });
});

test('speed bench contributes zero', () => {
  assert.deepEqual(exercises.benchSpeed.m, {}, 'the plan gives it no muscle map at all');

  const speedOnly = { slots: [{ ex: 'benchSpeed', sets: 6, reps: 3, rpe: 6 }] };
  assert.deepEqual(sessionVolume(speedOnly, exercises), {});
  assert.equal(sessionMuscles(speedOnly, exercises).size, 0);

  // And adding it to a real session changes nothing.
  const sessionD = sessions.find((s) => s.id === 'D');
  const withoutSpeed = { ...sessionD, slots: sessionD.slots.filter((sl) => sl.ex !== 'benchSpeed') };
  assert.deepEqual(sessionVolume(sessionD, exercises), sessionVolume(withoutSpeed, exercises));
});

test('contributions below 0.3 are not counted', () => {
  assert.equal(MIN_COUNTED_WEIGHT, 0.3);

  const exs = {
    trace: { name: 'Trace stimulus', m: { chestMid: 1.0, triLat: 0.29, deltFront: 0.3 } },
  };
  const session = { slots: [{ ex: 'trace', sets: 4 }] };

  assert.deepEqual(sessionVolume(session, exs), { chestMid: 4, deltFront: 1.2 });
});

test('an unknown exercise is skipped rather than crashing the roll-up', () => {
  const session = { slots: [{ ex: 'benchComp', sets: 5 }, { ex: 'notInThePlan', sets: 3 }] };
  assert.deepEqual(sessionVolume(session, exercises), { chestMid: 5, triLat: 2.5, deltFront: 2.5 });
  assert.deepEqual(sessionVolume(null, exercises), {});
});

/* ── the shipped plan's weekly figures ───────────────────────────────── */

test('weekly per-muscle volume matches the reviewed plan', () => {
  const { volume } = weeklyVolume(sessions, exercises);

  assert.equal(round2(volume.chestUpper), 13.9);
  assert.equal(round2(volume.chestMid), 19.6);
  assert.equal(round2(volume.triLong), 11);
  assert.equal(round2(volume.triLat), 20.9);
  assert.equal(round2(volume.deltSide), 19.9);
  assert.equal(round2(volume.bicLong), 13);
  assert.equal(round2(volume.lats), 14.2);
  assert.equal(round2(volume.upperBack), 14.5);

  // Every muscle in the plan lands inside its target band — the state the
  // plan was signed off in.
  for (const [id, muscle] of Object.entries(muscles)) {
    if (id === 'quads') continue; // deliberately over its band, per the plan
    assert.equal(bandStatus(volume[id] || 0, muscle), 'in', `${id} at ${volume[id]}`);
  }
});

test('whole-muscle roll-ups', () => {
  const { volume } = weeklyVolume(sessions, exercises);
  const rolls = rollUp(volume, muscles);

  assert.equal(round1(rolls.Chest), 33.5);
  assert.equal(round1(rolls.Triceps), 31.9);

  // NOTE: back and biceps come out at 28.7 and 23.4 from the shipped plan data.
  // BUILD-BRIEF.md quotes 28.1 and 23.3 for these two, which the data does not
  // produce — flagged rather than fudged, since the muscle weights are training
  // content and not ours to adjust.
  assert.equal(round1(rolls.Back), 28.7);
  assert.equal(round1(rolls.Biceps), 23.4);
  assert.equal(round1(rolls.Core), 16.2);

  // Roll-ups are the sum of their heads, and only muscles with a roll key join.
  assert.equal(round2(rolls.Chest), round2(volume.chestUpper + volume.chestMid));
  assert.equal(round2(rolls.Back), round2(volume.lats + volume.upperBack));
  assert.equal(rolls.Delts, undefined, 'delts are shown per head, not rolled up');
  assert.equal(rolls.Legs, undefined);
});

test('frequency counts sessions that hit a muscle at 0.5 or more', () => {
  const { frequency } = weeklyVolume(sessions, exercises);

  assert.equal(frequency.deltSide, 5, 'side delts in five of six sessions');
  assert.equal(frequency.chestMid, 4, 'four bench exposures — speed bench excluded');
  assert.equal(frequency.chestUpper, 4);

  // A 0.4 contribution is counted as volume but is too small to be a session hit.
  const exs = { light: { name: 'Light', m: { lats: 0.4 } } };
  const session = { slots: [{ ex: 'light', sets: 3 }] };
  assert.equal(round2(sessionVolume(session, exs).lats), 1.2);
  assert.equal(sessionMuscles(session, exs).has('lats'), false);
});

test('the plan has no session that contributes nothing', () => {
  for (const session of sessions) {
    const total = Object.values(sessionVolume(session, exercises)).reduce((a, b) => a + b, 0);
    assert.ok(total > 0, `session ${session.id}`);
  }
});

/* ── logged volume ───────────────────────────────────────────────────── */

test('logged sets are counted one set at a time, with the same weights', () => {
  const logged = [
    { exerciseId: 'benchComp', reps: 5, load: 92.5 },
    { exerciseId: 'benchComp', reps: 5, load: 92.5 },
    { exerciseId: 'benchSpeed', reps: 3, load: 75 },
    { exerciseId: 'lateral', reps: 15, load: 12 },
  ];

  const volume = volumeFromSets(logged, exercises);
  assert.equal(volume.chestMid, 2);
  assert.equal(volume.triLat, 1);
  assert.equal(volume.deltSide, exercises.lateral.m.deltSide);
  assert.deepEqual(volumeFromSets([], exercises), {});

  // Two logged bench sets equal a planned 2×bench slot.
  const planned = sessionVolume({ slots: [{ ex: 'benchComp', sets: 2 }] }, exercises);
  assert.deepEqual(volume.chestMid, planned.chestMid);
});

/* ── presentation helpers ────────────────────────────────────────────── */

test('bandStatus places a muscle against its target range', () => {
  const muscle = { lo: 8, hi: 14 };
  assert.equal(bandStatus(7.9, muscle), 'under');
  assert.equal(bandStatus(8, muscle), 'in');
  assert.equal(bandStatus(14, muscle), 'in');
  assert.equal(bandStatus(14.1, muscle), 'over');
  assert.equal(bandStatus(10, {}), 'unknown');
});

test('volumeByGroup keeps the per-head view alongside the roll-ups', () => {
  const { volume } = weeklyVolume(sessions, exercises);
  const groups = volumeByGroup(volume, muscles);

  assert.deepEqual([...groups.keys()], ['Chest', 'Delts', 'Arms', 'Back', 'Core', 'Legs']);

  const chest = groups.get('Chest');
  assert.deepEqual(chest.map((r) => r.id), ['chestUpper', 'chestMid']);
  assert.equal(round2(chest[0].sets), 13.9);
  assert.equal(chest[0].roll, 'Chest');
  assert.equal(chest[0].status, 'in');
});

test('diminishing returns is claimed on roll-ups only, never on a single head', () => {
  assert.equal(DIMINISHING_RETURNS_SETS, 20);

  const { volume } = weeklyVolume(sessions, exercises);
  const rolls = rollUp(volume, muscles);

  assert.equal(pastDiminishingReturns(rolls.Triceps), true, '31.9 whole-muscle sets');
  assert.equal(pastDiminishingReturns(volume.triLong), false, '11 sets on the long head alone');
  assert.equal(pastDiminishingReturns(19.9), false);
  assert.equal(pastDiminishingReturns(20), true);
});
