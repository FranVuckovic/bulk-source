/**
 * The RPE calculator.
 *
 * The defects these prevent:
 *
 *  - a calculator that answers when the table cannot. Every other estimate in
 *    this app refuses off-table input; a calculator that quietly interpolated
 *    RPE 5 would be the one place a fabricated number reaches a bar.
 *  - the reverse direction disagreeing with the forward one. They are the same
 *    table read in two directions and they have to round-trip.
 *  - the sheet writing something. It is a scratch pad; nothing it does may
 *    touch training data.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { e1rm, loadForE1rm, pct, MAX_ESTIMABLE_REPS } from '../js/calc.js';
import { answer, resetCalculator, calculatorState, sheet, actions, EXPLAINER } from '../js/ui/calculator.js';

const state = { settings: { unit: 'kg' } };
const pad = (over) => ({ mode: 'forward', basis: 'weight', load: '', max: '', reps: '5', rpe: '8', ...over });

test('loadForE1rm is the exact inverse of e1rm', () => {
  for (const reps of [1, 2, 3, 4, 5, 6, 8, 10, 12]) {
    for (const rpe of [6, 7, 8, 9, 10]) {
      const max = e1rm(100, reps, rpe);
      assert.ok(max != null, `no estimate at ${reps}×${rpe}`);
      const back = loadForE1rm(max, reps, rpe);
      assert.ok(Math.abs(back - 100) < 1e-9, `${reps}×${rpe} round-tripped to ${back}`);
    }
  }
});

test('loadForE1rm refuses exactly where e1rm refuses', () => {
  // Off the table below and above, and past the rep ceiling. v1's failure was
  // mapping these onto the RPE 8 column and printing a confident number.
  assert.equal(loadForE1rm(150, 5, 5), null);
  assert.equal(loadForE1rm(150, 5, 11), null);
  assert.equal(loadForE1rm(150, MAX_ESTIMABLE_REPS + 1, 8), null);
  assert.equal(loadForE1rm(0, 5, 8), null);
  assert.equal(loadForE1rm(150, 0, 8), null);
});

test('forward: weight, reps and RPE give the estimated max', () => {
  const result = answer(state, pad({ load: '100', reps: '5', rpe: '8' }));
  assert.equal(result.kind, 'max');
  // 5 reps at RPE 8 is 81.1% of the max.
  assert.equal(result.percent, 81.1);
  assert.ok(Math.abs(result.value - 100 / 0.811) < 1e-9);
});

test('reverse: a max, reps and RPE give the weight to load', () => {
  const result = answer(state, pad({ mode: 'reverse', max: '123.3', reps: '5', rpe: '8' }));
  assert.equal(result.kind, 'load');
  assert.ok(Math.abs(result.value - 123.3 * 0.811) < 1e-9);
});

test('the two directions agree with each other', () => {
  const forward = answer(state, pad({ load: '95', reps: '6', rpe: '9' }));
  const back = answer(state, pad({ mode: 'reverse', max: String(forward.value), reps: '6', rpe: '9' }));
  assert.ok(Math.abs(back.value - 95) < 1e-6);
});

test('an RPE the table cannot express gets a reason, not a number', () => {
  for (const rpe of ['5', '5.5', '10.5', '11']) {
    const result = answer(state, pad({ load: '100', rpe }));
    assert.equal(result.kind, 'none', `RPE ${rpe} produced ${result.kind}`);
    assert.match(result.why, /6–10/);
    assert.equal(result.value, undefined);
  }
});

test('past twelve reps it says so rather than extrapolating', () => {
  const result = answer(state, pad({ load: '60', reps: '15', rpe: '10' }));
  assert.equal(result.kind, 'none');
  assert.match(result.why, /12 reps/);
});

test('a missing input waits instead of answering', () => {
  assert.equal(answer(state, pad({ load: '' })).kind, 'waiting');
  assert.equal(answer(state, pad({ reps: '' })).kind, 'waiting');
  assert.equal(answer(state, pad({ mode: 'reverse', max: '' })).kind, 'waiting');
});

test('percent basis reports the percentage the table gives', () => {
  const result = answer(state, pad({ basis: 'percent', load: '80' }));
  assert.equal(result.kind, 'percent-forward');
  assert.equal(result.percent, pct(5, 8));
});

test('pounds are converted before the maths, not after', () => {
  const lb = { settings: { unit: 'lb' } };
  const inKg = answer(state, pad({ load: '100', reps: '5', rpe: '8' }));
  const inLb = answer(lb, pad({ load: '220.462262', reps: '5', rpe: '8' }));
  // 220.46 lb is 100 kg, so the stored estimate must be the same kilograms.
  assert.ok(Math.abs(inKg.value - inLb.value) < 1e-3);
});

/* ── Find the RPE ─────────────────────────────────────────────────────── */

test('effort mode: a weight against a max gives the RPE', () => {
  // 100 kg is 81.1% of 123.3, which is exactly the 5-rep RPE 8 row.
  const result = answer(state, pad({ mode: 'effort', load: '100', max: '123.3', reps: '5' }));
  assert.equal(result.kind, 'rpe');
  assert.equal(result.value, 8);
});

test('effort mode round-trips against the other two directions', () => {
  for (const [reps, rpe] of [[3, 9], [5, 8], [8, 10], [10, 7]]) {
    const load = answer(state, pad({ mode: 'reverse', max: '150', reps: String(reps), rpe: String(rpe) }));
    const back = answer(state, pad({ mode: 'effort', load: String(load.value), max: '150', reps: String(reps) }));
    assert.equal(back.kind, 'rpe', `${reps}×${rpe} gave ${back.kind}`);
    assert.equal(back.value, rpe, `${reps} reps at ${rpe} came back as ${back.value}`);
  }
});

test('effort mode reports an off-table load instead of clamping it', () => {
  // rpeFor() returns a flat 10 or 6 outside the table. A calculator that
  // printed "RPE 10" for a load nobody could lift for that many reps would be
  // stating a fact about the lifter that the table never claimed.
  const heavy = answer(state, pad({ mode: 'effort', load: '120', max: '123.3', reps: '5' }));
  assert.equal(heavy.kind, 'none');
  assert.match(heavy.why, /heavier than/);

  const light = answer(state, pad({ mode: 'effort', load: '60', max: '123.3', reps: '5' }));
  assert.equal(light.kind, 'none');
  assert.match(light.why, /lighter than RPE 6/);
});

test('effort mode waits for both numbers', () => {
  assert.equal(answer(state, pad({ mode: 'effort', load: '100', max: '' })).kind, 'waiting');
  assert.equal(answer(state, pad({ mode: 'effort', load: '', max: '150' })).kind, 'waiting');
});

test('effort mode asks for no RPE, and the other modes take it from buttons only', () => {
  const effort = sheet(state, pad({ mode: 'effort', load: '100', max: '150' }));
  assert.ok(!effort.includes('data-act-input="calc-rpe"'), 'effort mode still has an RPE field');
  assert.ok(!effort.includes('calc-rpes'), 'effort mode still offers RPE buttons');

  for (const mode of ['forward', 'reverse']) {
    const html = sheet(state, pad({ mode }));
    assert.ok(!html.includes('data-act-input="calc-rpe"'), `${mode} still has an RPE text field`);
    assert.ok(html.includes('data-act="calc-rpe-pick"'), `${mode} lost the RPE buttons`);
  }
});

test('the sheet renders every RPE column as a shortcut', () => {
  resetCalculator();
  assert.deepEqual(calculatorState(), pad());
  const html = sheet(state);
  for (const rpe of [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]) {
    assert.ok(html.includes(`data-id="${rpe}"`), `RPE ${rpe} missing from the shortcuts`);
  }
});

test('the sheet never shows NaN, undefined or [object Object]', () => {
  for (const over of [{}, { load: 'abc' }, { reps: '99' }, { rpe: '3' }, { mode: 'reverse' }, { basis: 'percent' }]) {
    const html = sheet(state, pad(over));
    for (const bad of ['NaN', 'undefined', '[object Object]']) {
      assert.ok(!html.includes(bad), `${bad} reached the sheet with ${JSON.stringify(over)}`);
    }
  }
});

test('the calculator writes nothing', () => {
  // A scratch pad that could touch the database would be a data-loss risk with
  // no upside. It has no access to one, and this asserts the module keeps it
  // that way rather than trusting that it will.
  const source = readFileSync(new URL('../js/ui/calculator.js', import.meta.url), 'utf8');
  const forbidden = ['saveSet', 'putSet', 'saveDaily', 'saveMeasurements', 'ctx.db', 'editEntry'];
  for (const name of forbidden) {
    assert.ok(!source.includes(name), `calculator.js reaches for ${name}`);
  }
});

test('the explain button opens the knowledge entry that explains it', () => {
  let went = null;
  actions['calc-explain']({ state, goTo: (to) => { went = to; } });
  assert.deepEqual(went, { tab: 'plan', planSection: 'tips', tipOpen: EXPLAINER });

  // Matched by title, so the title has to still be there. Renaming the entry
  // without renaming this would land on the top of a 42-item accordion, which
  // is where the explanation was unfindable to begin with.
  const plan = JSON.parse(readFileSync(new URL('../data/plan-fopip-v2.json', import.meta.url), 'utf8'));
  assert.ok(
    plan.knowledge.some((entry) => entry.t === EXPLAINER),
    `no knowledge entry titled "${EXPLAINER}"`
  );
});
