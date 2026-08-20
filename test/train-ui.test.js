import test from 'node:test';
import assert from 'node:assert/strict';

import { actions, CUSTOM_SESSION_ID, slotsFor } from '../js/ui/train.js';

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
