/**
 * The weekly attempt: one measured single, and the two buttons that decide
 * what it means.
 *
 * The defect this prevents is the one the plan ran on for its whole life so
 * far: the working max never moved. `maxes` and `maxHistory` were both empty,
 * so every prescription came from a seed of 115 kg and every session asked for
 * the same weights it had asked for the session before. The AMRAP was supposed
 * to move it and did not, because an AMRAP produces an ESTIMATE that still has
 * to be confirmed, and nothing ever confirmed one.
 *
 * A measured single removes the estimate. The button that marks it made is the
 * confirmation, so there is nothing left to forget.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nextAttemptLoad, ATTEMPT_STEP, prescribedLoad } from '../js/calc.js';
import { resolveSession } from '../js/plan.js';

const PLAN = JSON.parse(readFileSync(new URL('../data/plan-fopip-v2.json', import.meta.url), 'utf8'));

test('the first attempt is the working max — nothing has been earned yet', () => {
  assert.equal(nextAttemptLoad([], { seed: 120 }), 120);
  assert.equal(nextAttemptLoad(null, { seed: 120 }), 120);
});

test('with no attempts and no max there is nothing to prescribe', () => {
  assert.equal(nextAttemptLoad([], { seed: null }), null);
});

test('a made attempt adds the step to the next one', () => {
  const next = nextAttemptLoad([{ load: 120, result: 'made' }], { seed: 115 });
  assert.equal(next, 120 + ATTEMPT_STEP);
});

test('a missed attempt repeats the same weight — a miss is not a reason to back off', () => {
  assert.equal(nextAttemptLoad([{ load: 122.5, result: 'missed' }], { seed: 115 }), 122.5);
});

test('the ladder follows the last attempt, not the best one', () => {
  const history = [
    { load: 120, result: 'made' },
    { load: 122.5, result: 'made' },
    { load: 125, result: 'missed' },
  ];
  assert.equal(nextAttemptLoad(history, { seed: 115 }), 125, 'retry the one that was missed');

  assert.equal(
    nextAttemptLoad([...history, { load: 125, result: 'made' }], { seed: 115 }),
    127.5,
    'and move on once it is made'
  );
});

test('an attempt with no load, or no answer, is not part of the ladder', () => {
  const history = [
    { load: null, result: 'made' },
    { load: 120, result: 'made' },
    { load: 125, result: null },
  ];
  assert.equal(nextAttemptLoad(history, { seed: 115 }), 122.5);
});

test('the seed is rounded to a load that can be put on a bar', () => {
  // A derived max — a variation's ratio of the competition max — is not a
  // round number. 120 × 0.82 is 98.4, and you cannot load 98.4 kg.
  assert.equal(nextAttemptLoad([], { seed: 98.4 }), 97.5);
});

test('the AMRAP is a fixed 100 kg and does not move when the max does', () => {
  const slot = resolveSession(PLAN, { rotation: 3, sessionId: 'C' }).slots.find((s) => s.id === 'C1');
  assert.equal(slot.fixedLoad, 100, 'the plan states it outright');
  assert.equal(prescribedLoad(slot, 120, 2.5), 100);
  assert.equal(prescribedLoad(slot, 150, 2.5), 100, 'still 100 at a much higher max');
});

test('a fixed load needs no working max at all', () => {
  assert.equal(prescribedLoad({ fixedLoad: 100 }, null, 2.5), 100);
});

test('the AMRAP is no longer an index set — the attempt is', () => {
  const slots = resolveSession(PLAN, { rotation: 3, sessionId: 'C' }).slots;
  const attempt = slots.find((s) => s.role === 'attempt');
  const amrap = slots.find((s) => s.id === 'C1');

  assert.ok(attempt, 'session C opens with the attempt');
  assert.equal(attempt.idx, true, 'a weight he actually pressed is the measurement');
  assert.equal(amrap.idx, false, 'a rep count at a fixed load is not a max estimate');
});

test('the attempt comes before the AMRAP, both before anything that tires him', () => {
  const slots = resolveSession(PLAN, { rotation: 3, sessionId: 'C' }).slots;
  assert.equal(slots[0].role, 'attempt');
  assert.equal(slots[1].id, 'C1');
});

test('no maximal single in a rotation whose purpose is to shed fatigue', () => {
  // Recovery (15), taper (31) and the test rotation (32). A deload with a
  // maximal attempt in it is not a deload.
  for (const rotation of [15, 31, 32]) {
    const slots = resolveSession(PLAN, { rotation, sessionId: 'C' }).slots;
    assert.equal(
      slots.some((s) => s.role === 'attempt'),
      false,
      `rotation ${rotation} runs no attempt`
    );
  }
});

test('every other block does run one', () => {
  for (const rotation of [1, 3, 11, 16, 24, 28, 33]) {
    const slots = resolveSession(PLAN, { rotation, sessionId: 'C' }).slots;
    assert.equal(
      slots.some((s) => s.role === 'attempt'),
      true,
      `rotation ${rotation} runs an attempt`
    );
  }
});

test('the attempt slot says what each button does', () => {
  const slot = resolveSession(PLAN, { rotation: 3, sessionId: 'C' }).slots.find((s) => s.role === 'attempt');
  assert.match(slot.note, /made/i);
  assert.match(slot.note, /missed/i);
  assert.match(slot.note, /2\.5 kg/);
});
