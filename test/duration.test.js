/**
 * How long a session takes, warm-ups included.
 *
 * The old estimate counted work sets only. Warming up to a heavy single is six
 * ramp sets and the better part of ten minutes, and none of it was in the
 * number — so a session A that really costs about 99 minutes was advertised at
 * 65–80.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { sessionDuration, warmupRamp, SECONDS_PER_REP, SET_SETUP_SECONDS } from '../js/calc.js';
import { resolveSession, toDisplaySession } from '../js/plan.js';

const PLAN = JSON.parse(readFileSync(new URL('../data/plan-fopip-v2.json', import.meta.url), 'utf8'));
const EXERCISES = { bench: { defaultRestSec: 180 }, pullup: { defaultRestSec: 120, bodyweightLoaded: true } };

test('a set costs setup plus its reps plus its rest', () => {
  const one = sessionDuration([{ ex: 'bench', sets: 1, reps: 5, restSec: 180 }], { exercises: EXERCISES });
  assert.equal(one.totalSeconds, SET_SETUP_SECONDS + 5 * SECONDS_PER_REP + 180);
  assert.equal(one.warmupSeconds, 0, 'no prescribed load means no ramp to cost');
});

test('a prescribed load brings its warm-up ramp with it', () => {
  const bare = sessionDuration([{ ex: 'bench', sets: 3, reps: 5, restSec: 180 }], { exercises: EXERCISES });
  const ramped = sessionDuration([{ ex: 'bench', sets: 3, reps: 5, restSec: 180 }], {
    exercises: EXERCISES, prescribedLoads: { 0: 100 },
  });

  assert.ok(ramped.warmupSeconds > 0, 'the ramp is counted');
  assert.equal(ramped.totalSeconds, bare.totalSeconds + ramped.warmupSeconds, 'and added to the total');

  // It matches the ramp the Warm-up sheet actually shows, rather than a guess.
  const expected = warmupRamp(100, { bar: 20, increment: 2.5 })
    .filter((step) => step.isWarmup)
    .reduce((sum, step) => sum + SET_SETUP_SECONDS + step.reps * SECONDS_PER_REP + step.restSec, 0);
  assert.equal(ramped.warmupSeconds, expected);
});

test('one exercise across two slots warms up once, not twice', () => {
  // The bench top single and its back-offs are one warm-up between them.
  const twice = sessionDuration(
    [
      { ex: 'bench', sets: 1, reps: 1, restSec: 180 },
      { ex: 'bench', sets: 3, reps: 5, restSec: 180 },
    ],
    { exercises: EXERCISES, prescribedLoads: { 0: 110, 1: 90 } }
  );
  const once = sessionDuration([{ ex: 'bench', sets: 1, reps: 1, restSec: 180 }], {
    exercises: EXERCISES, prescribedLoads: { 0: 110 },
  });
  assert.equal(twice.warmupSeconds, once.warmupSeconds);
});

test('a bodyweight lift is never charged a barbell warm-up', () => {
  const d = sessionDuration([{ ex: 'pullup', sets: 4, reps: 8, restSec: 120 }], {
    exercises: EXERCISES, prescribedLoads: { 0: 20 },
  });
  assert.equal(d.warmupSeconds, 0, 'there is no bar to build up to');
});

test('logged sets spend the plan, and the first one spends the warm-up with it', () => {
  const slots = [{ ex: 'bench', sets: 3, reps: 5, restSec: 180 }];
  const opts = { exercises: EXERCISES, prescribedLoads: { 0: 100 } };

  const none = sessionDuration(slots, opts);
  assert.equal(none.doneSeconds, 0);
  assert.equal(none.remainingSeconds, none.totalSeconds);

  const first = sessionDuration(slots, { ...opts, completed: new Set(['0:0']) });
  const perSet = SET_SETUP_SECONDS + 5 * SECONDS_PER_REP + 180;
  assert.equal(first.doneSeconds, perSet + none.warmupSeconds, 'the ramp is spent when the first work set is');

  const all = sessionDuration(slots, { ...opts, completed: new Set(['0:0', '0:1', '0:2']) });
  assert.equal(all.doneSeconds, all.totalSeconds);
  assert.equal(all.remainingSeconds, 0, 'and never goes negative');
});

test('the real session A costs meaningfully more than its work sets alone', () => {
  const resolved = toDisplaySession(resolveSession(PLAN, { rotation: 1, sessionId: 'A' }));
  const loads = {};
  resolved.slots.forEach((slot, i) => {
    const max = PLAN.meta.seedWorkingMaxes[slot.ex];
    if (max) loads[i] = max * 0.8;
  });
  const d = sessionDuration(resolved.slots, {
    exercises: PLAN.exercises, bar: 20, increment: 2.5, prescribedLoads: loads,
  });

  assert.ok(d.warmupSeconds > 10 * 60, 'the ramps are worth more than ten minutes, and used to be invisible');
  assert.equal(d.totalSeconds, d.warmupSeconds + d.workingSeconds);
});
