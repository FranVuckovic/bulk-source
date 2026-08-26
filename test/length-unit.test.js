/**
 * Reading tape measurements in inches.
 *
 * The defects these prevent:
 *
 *  - a display setting that reaches the database. Every measurement is stored
 *    in centimetres, always. If switching to inches ever wrote inches, a
 *    fortnight of readings would silently become 2.54× wrong.
 *  - losing resolution in the conversion. A tape reads to a millimetre, and
 *    0.1 cm is 0.039 in — one decimal place in inches would throw away what
 *    was measured.
 *  - the entry form changing unit under the owner. He logs in cm; a form that
 *    silently became inches is how a cm number gets typed into an inches box.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CM_PER_INCH, toLength, fromLength, fmtLength, lengthLabel } from '../js/ui/components.js';
import { DEFAULT_SETTINGS } from '../js/db.js';

test('centimetres are the stored unit, and the default', () => {
  assert.equal(DEFAULT_SETTINGS.lengthUnit, 'cm');
});

test('the conversion round-trips exactly', () => {
  for (const cm of [38.1, 88, 106.2, 55.6, 40.4, 0.1]) {
    assert.ok(Math.abs(fromLength(toLength(cm, 'in'), 'in') - cm) < 1e-12, `${cm} did not survive`);
    assert.equal(toLength(cm, 'cm'), cm, 'cm is the identity');
    assert.equal(fromLength(cm, 'cm'), cm);
  }
  assert.equal(CM_PER_INCH, 2.54);
});

test('inches carry two decimals so a millimetre still reads', () => {
  // 38.1 and 38.2 cm are one millimetre apart. In inches at one decimal they
  // would both be "15.0" and a fortnight of arm growth would vanish.
  assert.notEqual(fmtLength(38.1, 'in'), fmtLength(38.2, 'in'));
  assert.equal(fmtLength(38.1, 'in'), '15.00');
  assert.equal(fmtLength(38.2, 'in'), '15.04');
  assert.equal(fmtLength(38.1, 'cm'), '38.1');
});

test('a missing measurement stays missing in either unit', () => {
  assert.equal(fmtLength(null, 'cm'), '—');
  assert.equal(fmtLength(null, 'in'), '—');
  assert.equal(fmtLength(undefined, 'in'), '—');
});

test('anything that is not inches is centimetres', () => {
  // The setting arrives from storage and from an export written by another
  // build. Unknown means cm, never a third behaviour.
  for (const value of ['cm', undefined, null, '', 'metres', 0]) {
    assert.equal(toLength(10, value), 10);
    assert.equal(lengthLabel(value), 'cm');
  }
});

test('switching the unit writes a setting and nothing else', () => {
  // The handler may touch `settings.lengthUnit` and re-render. If it ever
  // reaches a measurement row, the stored centimetres are at risk.
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const handler = app.slice(app.indexOf('async lengthUnit(_ctx, data)'));
  const body = handler.slice(0, handler.indexOf('\n  },'));

  assert.match(body, /writeSetting\(state\.db, 'lengthUnit'/);
  for (const name of ['measurements', 'saveMeasurements', 'editEntry']) {
    assert.ok(!body.includes(name), `the length toggle reaches ${name}`);
  }
});

test('the Body entry form stays in centimetres whatever the toggle says', () => {
  // Deliberate asymmetry with kg/lb: the owner logs in cm and reads in inches.
  const body = readFileSync(new URL('../js/ui/body.js', import.meta.url), 'utf8');
  assert.ok(!body.includes('lengthUnit'), 'the entry form has started following the display unit');
});
