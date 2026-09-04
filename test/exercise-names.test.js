/**
 * One exercise, one name, one number.
 *
 * The plan shipped with thirteen slots whose exercise was really two: "Cable
 * fly / pec deck", "Hip thrust (barbell or machine)", "Box jumps / broad
 * jumps". Every one of those is a single row in `maxes` and a single line on
 * the strength charts, so a machine hip thrust at 140 kg and a barbell one at
 * 100 kg were the same lift going backwards, and a record could be beaten by
 * changing equipment.
 *
 * The rule these tests hold: a name that offers a choice is not a measurement.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PLAN = JSON.parse(readFileSync(new URL('../data/plan-fopip-v2.json', import.meta.url), 'utf8'));
const ENTRIES = Object.entries(PLAN.exercises);

test('no exercise name offers a choice between two exercises', () => {
  const compound = ENTRIES.filter(
    ([, e]) => !/retired/i.test(e.name) && (e.name.includes('/') || / or /.test(e.name))
  ).map(([id, e]) => `${id}: ${e.name}`);

  assert.deepEqual(compound, [], 'these name more than one exercise');
});

test('every split names a parent that exists', () => {
  for (const [id, e] of ENTRIES) {
    if (!e.splitFrom) continue;
    assert.ok(PLAN.exercises[e.splitFrom], `${id} was split from ${e.splitFrom}, which is not an exercise`);
    assert.notEqual(e.splitFrom, id, `${id} cannot be split from itself`);
  }
});

test('a split pair points at each other, so either is one tap away', () => {
  for (const [id, e] of ENTRIES) {
    if (!e.splitFrom) continue;
    const parent = PLAN.exercises[e.splitFrom];
    // The parent may have been retired, in which case it keeps old sets
    // labelled and does not need to link forward.
    if (/retired/i.test(parent.name)) continue;

    const names = (list) => (list || []).map((s) => s.toLowerCase());
    assert.ok(
      names(e.subs).some((s) => s.includes(parent.name.toLowerCase().split(' (')[0])),
      `${id} does not offer ${e.splitFrom} as a substitute`
    );
    assert.ok(
      names(parent.subs).some((s) => s.includes(e.name.toLowerCase().split(' (')[0])),
      `${e.splitFrom} does not offer ${id} as a substitute`
    );
  }
});

test('every exercise a slot points at exists, and every exercise has a muscle map', () => {
  for (const session of PLAN.sessions) {
    for (const slot of session.slots) {
      assert.ok(PLAN.exercises[slot.ex], `${session.id} ${slot.id} points at ${slot.ex}`);
    }
  }
  for (const [id, e] of ENTRIES) {
    assert.ok(e.m && typeof e.m === 'object', `${id} has no muscle map`);
    assert.ok(Array.isArray(e.how) && e.how.length, `${id} has no instructions`);
    assert.ok(typeof e.why === 'string' && e.why.length > 20, `${id} does not say why it is there`);
  }
});

test('a retired parent is kept, so sets logged under it keep their name', () => {
  const retired = ENTRIES.filter(([, e]) => /retired/i.test(e.name)).map(([id]) => id);
  assert.ok(retired.length, 'retirement is still how ambiguous history is preserved');
  for (const id of retired) {
    for (const session of PLAN.sessions) {
      for (const slot of session.slots) {
        assert.notEqual(slot.ex, id, `${session.id} ${slot.id} still prescribes the retired ${id}`);
      }
    }
  }
});
