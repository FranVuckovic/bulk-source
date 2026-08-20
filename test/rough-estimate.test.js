/**
 * The rough estimate, past where the RPE table stops.
 *
 * The table refuses above 12 reps, deliberately: past there a percentage-of-max
 * number stops meaning anything. That reasoning still holds — but a real log
 * came back with 15 of 27 sets blank, and "nothing" communicated "broken"
 * rather than "unknowable".
 *
 * So there is a second, weaker estimate for those sets, using Mayhew, and these
 * tests hold the two properties that decide whether it helps or misleads:
 * it must join the table smoothly rather than stepping, and it must never be
 * mistaken for the real estimate.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  e1rm,
  roughE1rm,
  roughConfidence,
  MAX_ESTIMABLE_REPS,
  MAX_ROUGH_REPS,
} from '../js/calc.js';

test('it declines where the table works, so there are never two answers', () => {
  for (let reps = 1; reps <= MAX_ESTIMABLE_REPS; reps++) {
    assert.equal(roughE1rm(100, reps, 10), null, `${reps} reps is the table's job`);
    assert.equal(roughConfidence(reps), null);
  }
});

test('it joins the table exactly at the boundary rather than stepping', () => {
  // Used raw, Mayhew sits systematically below this table — at twelve reps the
  // table says 68% of max and Mayhew about 74%. A thirteen-rep set would have
  // estimated ~10 kg LOWER than a twelve-rep set at the same weight: one more
  // rep making you look weaker. Anchoring removes that.
  const atTwelve = e1rm(100, MAX_ESTIMABLE_REPS, 10);
  const atThirteen = roughE1rm(100, MAX_ESTIMABLE_REPS + 1, 10);

  assert.ok(atThirteen > atTwelve, 'one more rep must not lower the estimate');
  assert.ok(atThirteen - atTwelve < 5, 'and must not jump either');
});

test('more reps at the same load always means a higher estimate', () => {
  let previous = e1rm(100, MAX_ESTIMABLE_REPS, 10);
  for (let reps = MAX_ESTIMABLE_REPS + 1; reps <= MAX_ROUGH_REPS; reps++) {
    const value = roughE1rm(100, reps, 10);
    assert.ok(value > previous, `${reps} reps must beat ${reps - 1}`);
    previous = value;
  }
});

test('a set short of failure counts the reps it left behind', () => {
  // Fifteen at RPE 8 is seventeen you stopped early, which is how the RPE table
  // treats sub-maximal sets too.
  assert.equal(roughE1rm(100, 15, 8), roughE1rm(100, 17, 10));
  assert.ok(roughE1rm(100, 15, 8) > roughE1rm(100, 15, 10));
});

test('it gives up entirely rather than extrapolating without limit', () => {
  assert.ok(roughE1rm(100, MAX_ROUGH_REPS, 10) > 0);
  assert.equal(roughE1rm(100, MAX_ROUGH_REPS + 1, 10), null);
  assert.equal(roughConfidence(MAX_ROUGH_REPS + 1), null);
});

test('it never claims to be a good estimate', () => {
  // Mayhew was developed and validated to about 15 reps; past that this is
  // extrapolation and has to say so.
  assert.equal(roughConfidence(13), 'rough');
  assert.equal(roughConfidence(15), 'rough');
  assert.equal(roughConfidence(16), 'very rough');
  assert.equal(roughConfidence(25), 'very rough');
});

test('the real estimate is untouched, so records cannot be fabricated from it', () => {
  // The invariant that matters: e1rm still refuses past 12 reps, and every
  // record, working-max proposal and strength chart goes through e1rm.
  assert.equal(e1rm(100, 13, 10), null);
  assert.equal(e1rm(100, 20, 10), null);
  assert.ok(e1rm(100, 12, 10) > 0);
});

test('nonsense in, nothing out', () => {
  assert.equal(roughE1rm(0, 15, 10), null);
  assert.equal(roughE1rm(100, 0, 10), null);
  assert.equal(roughE1rm(null, 15, 10), null);
});
