/**
 * Splitting one exercise into two, without touching what was already logged.
 *
 * The defects these prevent:
 *
 *  - rewriting logged sets to fit a schema change. A set records what was
 *    lifted, not which direction of a rotation it was; picking a half for it
 *    would be inventing a fact the record does not contain.
 *  - orphaning the old sets. They keep their own exercise id, so that id has to
 *    keep existing, or the Log shows a set belonging to nothing.
 *  - the new halves starting blind. Until each has a session of its own it
 *    should show the parent's last session, and stop the moment it does not
 *    need to.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PLAN = JSON.parse(readFileSync(new URL('../data/plan-fopip-v2.json', import.meta.url), 'utf8'));

/** The rule app.js applies when it builds the last-session history. */
function inherit(plan, latest) {
  for (const [id, exercise] of Object.entries(plan.exercises)) {
    if (!exercise.splitFrom || latest.has(id)) continue;
    const parent = latest.get(exercise.splitFrom);
    if (parent) latest.set(id, { ...parent, inheritedFrom: exercise.splitFrom });
  }
  return latest;
}

test('every split exercise names a parent that still exists', () => {
  for (const [id, exercise] of Object.entries(PLAN.exercises)) {
    if (!exercise.splitFrom) continue;
    assert.ok(
      PLAN.exercises[exercise.splitFrom],
      `${id} was split from ${exercise.splitFrom}, which is not in the plan — every set logged under it would lose its name`
    );
  }
});

test('a retired parent is out of every session but still in the exercise list', () => {
  const retired = Object.entries(PLAN.exercises).filter(([, x]) => x.retired);
  assert.ok(retired.length, 'the rotation split should have retired its parent');

  for (const [id] of retired) {
    const used = PLAN.sessions.filter((s) => s.slots.some((slot) => slot.ex === id));
    assert.deepEqual(used.map((s) => s.id), [], `${id} is retired but still prescribed`);
    assert.ok(PLAN.exercises[id].name, `${id} lost its name`);
  }
});

test('the forearm rotation is two exercises, both inheriting from the old one', () => {
  assert.equal(PLAN.exercises.cablePronation.splitFrom, 'cableRotation');
  assert.equal(PLAN.exercises.cableSupination.splitFrom, 'cableRotation');
  assert.equal(PLAN.exercises.cableRotation.retired, true);
});

test('the split preserves the prescription exactly, per direction', () => {
  const E = PLAN.sessions.find((s) => s.id === 'E');
  const halves = E.slots.filter((slot) => ['cablePronation', 'cableSupination'].includes(slot.ex));
  assert.equal(halves.length, 2, 'both halves are prescribed');

  // Same sets, reps, RPE and rest as the single slot they replaced. Two sets of
  // pronation plus two of supination is the same work as two sets of rotating
  // both ways — the set count goes up because each set now names a direction.
  for (const half of halves) {
    assert.equal(half.sets, 2);
    assert.equal(half.repsLow, 12);
    assert.equal(half.repsHigh, 20);
    assert.equal(half.rpe, 10);
    assert.equal(half.restSec, 60);
  }
});

test('a new half shows the parent’s last session until it has one of its own', () => {
  const parentEntry = { dateISO: '2026-08-22', logId: 7, sessionId: 'E', sets: [{ load: 5, reps: 15 }] };
  const latest = inherit(PLAN, new Map([['cableRotation', parentEntry]]));

  for (const id of ['cablePronation', 'cableSupination']) {
    assert.equal(latest.get(id).dateISO, '2026-08-22', `${id} did not inherit`);
    assert.equal(latest.get(id).inheritedFrom, 'cableRotation', `${id} does not say where it came from`);
  }
  // Nothing was rewritten: the parent's own entry is untouched and still there.
  assert.equal(latest.get('cableRotation'), parentEntry);
});

test('once a half has its own history the inheritance stops', () => {
  const own = { dateISO: '2026-08-29', logId: 9, sessionId: 'E', sets: [{ load: 6, reps: 12 }] };
  const latest = inherit(
    PLAN,
    new Map([
      ['cableRotation', { dateISO: '2026-08-22', logId: 7, sessionId: 'E', sets: [] }],
      ['cablePronation', own],
    ])
  );

  assert.equal(latest.get('cablePronation'), own, 'its own history was overwritten by the parent’s');
  assert.equal(latest.get('cablePronation').inheritedFrom, undefined);
  assert.equal(latest.get('cableSupination').inheritedFrom, 'cableRotation', 'the other half should still inherit');
});

test('app.js actually applies the rule, rather than only exporting the shape', () => {
  // The two defects this project has shipped were both code that existed and
  // was never called. The rule lives inline in buildHistory, so assert it is
  // there rather than trusting that it is.
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const build = app.slice(app.indexOf('function buildHistory()'), app.indexOf('state.lastByExercise = latest;'));
  assert.match(build, /splitFrom/, 'buildHistory does not apply splitFrom inheritance');
});
