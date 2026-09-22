/**
 * Saved custom workouts.
 *
 * The app already had a blank ad-hoc "Custom" session you fill in on the spot.
 * What it did not have was a custom workout you can save, name and run again —
 * fully prescribed, loading off your working maxes like any plan session.
 *
 * The defect to guard is the one that makes them dangerous: a custom workout
 * that carries a rotation position would satisfy a letter of A–F it is not.
 * Train Custom workout 1, and the app would record session A as done for the
 * rotation and never offer it. `cycleProgress` filters on `rotationPosition`,
 * so that field is the whole safety property.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { customWorkoutById, isOutsideRotation, slotsFor, CUSTOM_SESSION_ID } from '../js/ui/train.js';
import { cycleProgress, newCycle } from '../js/cycle.js';
import { prescribedLoad, roundToIncrement, pct } from '../js/calc.js';

const PLAN = JSON.parse(readFileSync(new URL('../data/plan-fopip-v2.json', import.meta.url), 'utf8'));
const stateFor = (id) => ({
  plan: PLAN,
  trainSessionId: id,
  deviations: { swaps: {}, addedSets: {}, exerciseNotes: {}, extras: [] },
  loggedSets: new Map(),
});

test('the plan carries at least one saved custom workout, fully formed', () => {
  const saved = PLAN.customWorkouts;
  assert.ok(Array.isArray(saved) && saved.length, 'plan.customWorkouts exists');

  for (const w of saved) {
    assert.ok(w.id && w.name && w.purpose, `${w.id} is named and explained`);
    assert.ok(Array.isArray(w.slots) && w.slots.length, `${w.id} has slots`);
    for (const slot of w.slots) {
      assert.ok(PLAN.exercises[slot.ex], `${w.id} ${slot.id} points at ${slot.ex}`);
      assert.ok(slot.sets > 0, `${w.id} ${slot.id} has sets`);
      assert.ok(slot.rpe >= 5 && slot.rpe <= 10, `${w.id} ${slot.id} RPE ${slot.rpe}`);
      assert.ok(slot.repsLow <= slot.repsHigh, `${w.id} ${slot.id} rep range`);
    }
    const ids = w.slots.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, `${w.id} slot ids are unique`);
  }
});

test('a saved custom workout never collides with a plan session id', () => {
  const letters = new Set(PLAN.sessions.map((s) => s.id));
  for (const w of PLAN.customWorkouts) {
    assert.equal(letters.has(w.id), false, `${w.id} shadows a plan session`);
    assert.notEqual(w.id, CUSTOM_SESSION_ID, 'and not the blank ad-hoc one either');
  }
});

test('Custom workout 1 is the session the owner asked for', () => {
  const w = customWorkoutById(stateFor('X1'), 'X1');
  assert.ok(w);
  assert.equal(w.name, 'Custom workout 1');

  assert.deepEqual(
    w.slots.map((s) => [s.ex, s.sets]),
    [
      ['benchComp', 1],
      ['benchComp', 2],
      ['benchClose', 2],
      ['ohpDB', 2],
      ['inclineDB', 2],
      ['rowCSR', 3],
      ['inclineFly', 3],
      ['lateral', 3],
      ['reardeltCable', 3],
      ['curlHighCable', 3],
    ]
  );
  assert.equal(w.slots.reduce((t, s) => t + s.sets, 0), 24);
});

test('it is outside the rotation, and so is the blank custom session', () => {
  const state = stateFor('X1');
  assert.equal(isOutsideRotation(state, 'X1'), true);
  assert.equal(isOutsideRotation(state, CUSTOM_SESSION_ID), true);
  for (const id of PLAN.meta.rotationOrder) {
    assert.equal(isOutsideRotation(state, id), false, `${id} is a plan session`);
  }
});

test('training it does not satisfy, advance or inflate a rotation', () => {
  const cycle = newCycle(PLAN, { sequence: 3, id: 'c3' });
  const log = (position, id) => ({
    id, cycleId: cycle.id, rotationPosition: position, status: 'complete', completionRatio: 1, endedAt: 'x',
  });

  // A custom workout is written with rotationPosition null, like the ad-hoc one.
  const progress = cycleProgress(PLAN, cycle, [log(PLAN.meta.rotationOrder[0], 1), log(null, 2)]);
  assert.equal(progress.complete, 1, 'the custom workout did not count as a session');
  assert.equal(progress.nextPosition, PLAN.meta.rotationOrder[1]);
  assert.equal(progress.dose, 1, 'nor inflate the rotation dose');
});

test('slotsFor returns the saved slots in order, through the display shape', () => {
  const slots = slotsFor(stateFor('X1'));
  assert.equal(slots.length, 10);
  assert.equal(slots[0].ex, 'benchComp');
  assert.equal(slots[0].reps, 1, 'the display shape carries a rep target');
  assert.equal(slots[2].ex, 'benchClose');
  assert.equal(slots[9].ex, 'curlHighCable');
  for (const slot of slots) assert.ok(Number.isFinite(slot.reps), `${slot.ex} has no rep target`);
});

test('a logged set past the prescription keeps the row visible', () => {
  const state = stateFor('X1');
  state.loggedSets = new Map([['2:4', { reps: 4 }]]);
  const slots = slotsFor(state);
  assert.equal(slots[2].sets, 5);
  assert.equal(slots[2].prescribedSets, 2);
  assert.equal(slots[2].beyondPlan, true);
});

test('exercises added on the day are appended after the saved slots', () => {
  const state = stateFor('X1');
  state.deviations.extras = [{ ex: 'pushdown', sets: 2, reps: 12, rpe: 10, restSec: 75, added: true }];
  const slots = slotsFor(state);
  assert.equal(slots.length, 11);
  assert.equal(slots[10].ex, 'pushdown');
  assert.equal(slots[10].added, true);
});

test('its loads come off the working maxes, like any plan session', () => {
  const state = stateFor('X1');
  const slots = slotsFor(state);
  const MAX = 120;

  const single = slots[0];
  assert.equal(prescribedLoad(single, MAX, 2.5), roundToIncrement((MAX * pct(1, 8)) / 100, 2.5));

  // And the close grip off its own ratio, not the competition max.
  const close = slots[2];
  const own = MAX * PLAN.exercises.benchClose.maxFrom.ratio;
  assert.equal(prescribedLoad(close, own, 2.5), 92.5);
});

test('the dumbbell shoulder press it needs exists and is a shoulder press', () => {
  const e = PLAN.exercises.ohpDB;
  assert.ok(e, 'ohpDB exists');
  assert.equal(e.m.deltFront, 1);
  assert.ok(e.m.triLat > 0 && e.m.deltSide > 0);
  assert.ok(Array.isArray(e.how) && e.how.length >= 2);
});
