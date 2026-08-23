import test from 'node:test';
import assert from 'node:assert/strict';

import { actions, CUSTOM_SESSION_ID, slotsFor, lastTimePanel } from '../js/ui/train.js';

test('a custom workout is built only from its added exercises', () => {
  const state = {
    trainSessionId: CUSTOM_SESSION_ID,
    deviations: {
      swaps: {},
      addedSets: {},
      exerciseNotes: {},
      extras: [{ ex: 'benchComp', sets: 3, reps: 8, rpe: 8, restSec: 120, added: true }],
    },
    loggedSets: new Map([['0:4', { reps: 8 }]]),
  };

  const slots = slotsFor(state);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].ex, 'benchComp');
  assert.equal(slots[0].sets, 5, 'a logged set never becomes invisible if the draft later shrinks');
  assert.equal(slots[0].prescribedSets, 3);
  assert.equal(slots[0].added, true);
});

test('a failed workout change reaches the central action error handler', async () => {
  const failure = new Error('database write failed');
  const ctx = {
    state: {
      deviations: { swaps: {}, addedSets: {}, exerciseNotes: {}, extras: [] },
      exOpen: new Set(),
    },
    saveDeviations: async () => {
      throw failure;
    },
  };

  await assert.rejects(actions['do-swap'](ctx, { si: '0', id: 'benchComp' }), failure);
});

/* ═══════════════════════════════════════════════════════════════════════
   Last session's estimated max, on the card
   ═══════════════════════════════════════════════════════════════════════ */

test('the last-time panel shows an estimated max for each set', () => {
  // "What did I lift" without "was it any good" is half the question you are
  // asking at the bar. Two sets at the same load for the same reps, one at
  // RPE 8 and one at RPE 10, are one line of loads and a 7 kg difference in
  // what they say about your max.
  const state = {
    settings: { unit: 'kg', bodyweight: 90 },
    plan: { exercises: { benchComp: { name: 'Competition bench press' } } },
  };
  const previous = {
    sessionId: 'A',
    ago: 'yesterday',
    summary: '100.0 kg × 5,5',
    sets: [
      { load: 100, reps: 5, rpe: 8 },
      { load: 100, reps: 5, rpe: 10 },
    ],
  };

  const html = lastTimePanel(state, previous, { ex: 'benchComp' });
  assert.match(html, /lb-e/, 'no estimate row rendered');
  // 100 at 5 × RPE 8 is 81.1% → 123.3; at 5 × RPE 10 it is 86.3% → 115.9.
  assert.match(html, /123\.3/);
  assert.match(html, /115\.9/);
  assert.match(html, /e-top/, 'the best estimate is not marked');
  assert.doesNotMatch(html, /NaN|undefined|\[object Object\]/);
});

test('a set the table cannot estimate says why instead of showing a number', () => {
  const state = {
    settings: { unit: 'kg', bodyweight: 90 },
    plan: { exercises: { benchComp: {} } },
  };
  const previous = { sessionId: 'A', ago: '3 days ago', summary: '60.0 kg × 30', sets: [{ load: 60, reps: 30, rpe: 10 }] };

  const html = lastTimePanel(state, previous, { ex: 'benchComp' });
  assert.match(html, /No estimated max/);
  assert.doesNotMatch(html, /NaN|undefined/);
});

test('a bodyweight lift says its estimate includes bodyweight', () => {
  // A 128 kg e1RM next to a 6 kg entry is baffling unless the panel says the
  // maths ran on bodyweight + added, which is what it does everywhere else.
  const state = {
    settings: { unit: 'kg', bodyweight: 90 },
    plan: { exercises: { chinup: { bodyweightLoaded: true } } },
  };
  const previous = { sessionId: 'D', ago: 'yesterday', summary: '6.0 kg × 8', sets: [{ load: 6, reps: 8, rpe: 8 }] };

  const html = lastTimePanel(state, previous, { ex: 'chinup' });
  assert.match(html, /on bodyweight \+ added/);
  // 96 kg system load at 8 × RPE 8 is 73.9% → 129.9.
  assert.match(html, /129\.9/);
});

test('no previous data still renders, and says so', () => {
  const html = lastTimePanel({ settings: { unit: 'kg' }, plan: { exercises: {} } }, null, { ex: 'benchComp' });
  assert.match(html, /baseline/);
  assert.doesNotMatch(html, /NaN|undefined/);
});
