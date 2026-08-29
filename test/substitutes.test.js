/**
 * Finding something to do instead.
 *
 * The swap sheet used to be the plan's `subs` — free-text names — followed by
 * all 49 exercises in file order. Half the suggestions rendered as dead buttons
 * reading "not tracked", and the full list was alphabetical soup: to replace a
 * hack squat you scrolled past cable rotations and wrist rollers.
 *
 * The reason this matters is not tidiness. The owner's gym has no hack squat,
 * no lying leg curl and no seated calf raise, and one of the six sessions is
 * built on all three.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  exerciseSimilarity,
  substitutesFor,
  withCustomExercises,
  customExerciseId,
} from '../js/plan.js';

const PLAN = JSON.parse(readFileSync(new URL('../data/plan-fopip-v2.json', import.meta.url), 'utf8'));

test('an exercise is most like itself', () => {
  for (const id of ['legpress', 'benchComp', 'calfStand']) {
    assert.equal(exerciseSimilarity(PLAN.exercises[id], PLAN.exercises[id]), 1);
  }
});

test('magnitude counts, not just direction', () => {
  /*
   * Box jumps are `{quads: 0.3}` and a hack squat is `{quads: 1, hams: 0.3}`.
   * Those vectors point almost the same way, so cosine alone scored them 0.98
   * and the app offered jumps as a substitute for a squat. They train the same
   * muscle to wildly different degrees, which is the opposite of substitutable.
   */
  const squat = PLAN.exercises.hackBulg;
  const jumps = PLAN.exercises.jumps;
  const press = PLAN.exercises.legpress;

  assert.ok(exerciseSimilarity(squat, jumps) < 0.4, 'jumps are not a squat substitute');
  assert.ok(exerciseSimilarity(squat, press) > 0.9, 'a leg press is');
  assert.ok(exerciseSimilarity(squat, press) > exerciseSimilarity(squat, jumps) * 2);
});

test('substitutes come back sorted, closest first', () => {
  const { similar } = substitutesFor(PLAN, 'legpress');
  for (let i = 1; i < similar.length; i += 1) {
    assert.ok(similar[i - 1].score >= similar[i].score, 'out of order');
  }
});

test("the plan's own suggestions lead, and are not repeated below", () => {
  const { listed, similar } = substitutesFor(PLAN, 'hackBulg');
  assert.ok(listed.some((entry) => entry.id === 'legpress'), 'leg press is a listed substitute');
  assert.ok(!similar.some((entry) => entry.id === 'legpress'), 'and is not offered twice');
});

test('a suggestion with no exercise behind it is named, not dropped', () => {
  // These used to render as dead buttons saying "not tracked", which reads as a
  // bug. They are real suggestions the plan makes, and they are what the
  // add-your-own button is for.
  const { unlisted } = substitutesFor(PLAN, 'legpress');
  assert.ok(unlisted.includes('Pendulum squat'));
  assert.ok(unlisted.every((name) => typeof name === 'string' && name.length));
});

test('nothing lists itself as its own substitute', () => {
  for (const id of Object.keys(PLAN.exercises)) {
    const { listed, similar } = substitutesFor(PLAN, id);
    assert.ok(!listed.some((e) => e.id === id), `${id} lists itself`);
    assert.ok(!similar.some((e) => e.id === id), `${id} lists itself`);
  }
});

test('an unknown exercise returns empty groups rather than throwing', () => {
  assert.deepEqual(substitutesFor(PLAN, 'not-an-exercise'), { listed: [], similar: [], unlisted: [] });
});

/* ── Exercises you add yourself ─────────────────────────────────────────── */

test('a custom exercise is an ordinary exercise everywhere downstream', () => {
  const plan = withCustomExercises(PLAN, [
    { id: 'custom-smith-squat', name: 'Smith machine squat', basedOn: 'hackBulg' },
  ]);
  const added = plan.exercises['custom-smith-squat'];

  assert.equal(added.name, 'Smith machine squat');
  assert.deepEqual(added.m, PLAN.exercises.hackBulg.m, 'the muscle map is copied, so it counts in volume');
  assert.equal(added.unit, PLAN.exercises.hackBulg.unit);
  assert.equal(added.defaultRestSec, PLAN.exercises.hackBulg.defaultRestSec);
  assert.equal(added.custom, true);
});

test('a custom exercise is findable as a substitute for what it stands in for', () => {
  const plan = withCustomExercises(PLAN, [
    { id: 'custom-smith-squat', name: 'Smith machine squat', basedOn: 'hackBulg' },
  ]);
  const { similar } = substitutesFor(plan, 'hackBulg');
  assert.equal(similar[0].id, 'custom-smith-squat', 'and it leads, because it is the closest thing there is');
});

test('the plan is untouched when there is nothing to add', () => {
  assert.equal(withCustomExercises(PLAN, []), PLAN);
  assert.equal(withCustomExercises(PLAN, null), PLAN);
  assert.equal(withCustomExercises(PLAN, undefined), PLAN);
});

test('a custom exercise can never overwrite one of the plan\'s', () => {
  const plan = withCustomExercises(PLAN, [{ id: 'legpress', name: 'Not the leg press', basedOn: 'legpress' }]);
  assert.equal(plan.exercises.legpress.name, PLAN.exercises.legpress.name);
  assert.notEqual(plan.exercises.legpress.name, 'Not the leg press');
});

test('ids are namespaced and never reused', () => {
  assert.match(customExerciseId('Smith machine squat'), /^custom-/);
  assert.equal(customExerciseId('Smith machine squat'), 'custom-smith-machine-squat');
  assert.equal(
    customExerciseId('Smith machine squat', ['custom-smith-machine-squat']),
    'custom-smith-machine-squat-2',
    'a second one with the same name gets its own id, so a logged set keeps pointing at the right exercise'
  );
  assert.ok(!Object.keys(PLAN.exercises).some((id) => id.startsWith('custom-')), 'the namespace is free');
});

test('a nameless or malformed entry is skipped rather than crashing the plan', () => {
  const plan = withCustomExercises(PLAN, [{ id: 'custom-x' }, { name: 'no id' }, null, 'nonsense']);
  assert.equal(plan.exercises['custom-x'], undefined);
  assert.equal(Object.keys(plan.exercises).length, Object.keys(PLAN.exercises).length);
});

test('custom exercises live in settings, so they need no migration and travel in a backup', async () => {
  // A new store would mean a schema migration. A settings row is a key and an
  // arbitrary value: an older build ignores a key it does not know, a newer one
  // reading a database without it gets the default, and settings are already in
  // every export.
  const { DEFAULT_SETTINGS, ALL_STORES } = await import('../js/db.js');
  assert.deepEqual(DEFAULT_SETTINGS.customExercises, []);
  assert.ok(ALL_STORES.includes('settings'));

  const source = readFileSync(new URL('../js/db.js', import.meta.url), 'utf8');
  assert.ok(!source.includes("name: 'customExercises'"), 'not a store — that would need a migration');
});
