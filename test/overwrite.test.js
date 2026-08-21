/**
 * Yesterday's readings must not be destroyed by today's.
 *
 * Reported from real use, with a photograph as the only surviving copy: a full
 * set of tape measurements and a weigh-in taken on 20 August were replaced by
 * the ones taken on 21 August. The export afterwards held one measurement row
 * and one daily row, both dated 2026-08-20, carrying the 21st's numbers.
 *
 * Two things had to be true for that, and both were:
 *
 * 1. `state.todayISO` was computed once, in `loadEverything`, at boot. An
 *    installed PWA that is resumed rather than reloaded keeps its JavaScript
 *    context, so after midnight the Body screen still believed it was the day
 *    the app was last started. It prefilled from that day's records — which is
 *    why the boxes were not empty — and wrote back to that day's key.
 * 2. `daily` and `measurements` are keyed by `dateISO`, so the write replaced
 *    the row outright, and nothing anywhere recorded what had been there.
 *
 * The first is the defect. The second is why it was silent, and is fixed too:
 * a replacement now leaves the values it replaced in the audit log.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createFakeEnv } from './helpers/fake-indexeddb.js';
import { openDatabase, put, get, getAll, putDatedRow } from '../js/db.js';

const openFresh = () => {
  const env = createFakeEnv();
  return openDatabase({ indexedDB: env.indexedDB, name: 'bulk' });
};

const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const between = (from, to) => app.slice(app.indexOf(from), app.indexOf(to));

test('the Body draft takes its date from the clock, not from a value cached at boot', () => {
  const reset = between('function resetBodyDraft()', 'function screenFor');
  assert.match(reset, /refreshToday\(\)/, 'the date is re-derived before the draft is built');

  const refresh = between('function refreshToday()', 'async function rollOverIfNeeded');
  assert.match(refresh, /todayISO\(\)/, 'and re-derived from the clock');
});

test('the app notices the day changing while it is open', () => {
  // A phone does not reload an installed app when you come back to it, so a
  // date worked out at boot is a date that can be wrong for as long as the app
  // stays in memory. Nothing may be computed once and trusted afterwards.
  const wiring = between('function wireDayRollover()', 'function wireKeyboardHandling');

  assert.match(wiring, /visibilitychange/, 'checked when the app is shown again');
  assert.match(wiring, /'focus'/, 'and when it regains focus');
  assert.match(wiring, /setInterval\(rollOverIfNeeded/, 'and on a timer, for an app left open across midnight');
  assert.ok(app.includes('wireDayRollover();'), 'and the wiring is actually called');
});

test('replacing a weigh-in keeps the numbers it replaced', async () => {
  const db = await openFresh();
  await put(db, 'daily', { dateISO: '2026-08-20', bodyweight: 86.05, bodyfatPct: 10.6, sleepHours: 7.5 });

  const result = await putDatedRow(db, 'daily', {
    dateISO: '2026-08-20',
    bodyweight: 86.4,
    bodyfatPct: 10.4,
    sleepHours: 7.5,
  });

  assert.equal(result.existed, true);
  assert.deepEqual(
    result.changed.map((c) => c.field).sort(),
    ['bodyfatPct', 'bodyweight'],
    'sleep did not change, so it is not reported as changed'
  );

  const stored = await get(db, 'daily', '2026-08-20');
  assert.equal(stored.bodyweight, 86.4, 'the new value is what is stored');

  const audit = (await getAll(db, 'auditLog')).filter((row) => row.action === 'overwrite');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].entity, 'daily');
  assert.equal(audit[0].entityId, '2026-08-20');
  assert.equal(audit[0].previous.bodyweight, 86.05, 'the replaced weight is still readable');
  assert.equal(audit[0].previous.bodyfatPct, 10.6);
});

test('the exact reported loss is now recoverable from the log', async () => {
  // The real numbers, from the photograph and from the export.
  const db = await openFresh();
  const yesterday = {
    dateISO: '2026-08-20',
    timeOfDay: 'waking',
    waist: 80,
    chest: 105,
    shoulders: 124,
    armL: 32.6,
    armR: 32.5,
    quadL: 55.6,
    quadR: 56.2,
    neck: 39.5,
  };
  await put(db, 'measurements', yesterday);

  await putDatedRow(db, 'measurements', {
    dateISO: '2026-08-20',
    timeOfDay: 'waking',
    waist: 79.6,
    chest: 104.6,
    shoulders: 122.7,
    armL: 32.9,
    armR: 32.9,
    quadL: 55.7,
    quadR: 56.4,
    neck: 40,
  });

  const audit = (await getAll(db, 'auditLog')).find((row) => row.action === 'overwrite');
  assert.ok(audit, 'the overwrite is recorded at all — previously it was not');
  for (const site of ['waist', 'chest', 'shoulders', 'armL', 'armR', 'quadL', 'quadR', 'neck']) {
    assert.equal(audit.previous[site], yesterday[site], `${site} survived the overwrite`);
  }
});

test('a first entry for a day is not reported as an overwrite', async () => {
  const db = await openFresh();
  const result = await putDatedRow(db, 'daily', { dateISO: '2026-08-21', bodyweight: 86.4 });

  assert.equal(result.existed, false);
  assert.deepEqual(result.changed, []);
  assert.equal((await getAll(db, 'auditLog')).length, 0, 'nothing was replaced, so nothing is logged');
});

test('the Body screen can be pointed at another day, but never at a future one', () => {
  const setter = between('setBodyDate(dateISO) {', 'async saveDaily(row)');
  assert.match(setter, /dateISO > state\.todayISO/, 'a future date is refused');
  assert.match(setter, /\\d\{4\}-\\d\{2\}-\\d\{2\}/, 'and so is anything that is not a date');
  assert.match(setter, /fillBodyDraftFrom\(dateISO\)/, 'the draft reloads from the day chosen');
});

test('the Log shows what a replacement replaced', async () => {
  // A sheet is rendered by a different path from a screen, and `screens.test.js`
  // renders screens. The first version of this panel referenced a date helper
  // that history.js does not import, which threw in the browser and nothing in
  // the suite noticed. So the sheet is rendered here.
  const { plainDetail } = await import('../js/ui/history.js');

  const state = {
    auditLog: [
      {
        atISO: '2026-08-21T08:00:00.000Z',
        entity: 'measurements',
        entityId: '2026-08-20',
        action: 'overwrite',
        previous: { waist: 80, chest: 105, neck: 39.5 },
      },
    ],
  };
  const row = {
    kind: 'measurement',
    key: 'measurement:2026-08-20',
    title: 'Measurements',
    dateISO: '2026-08-20',
    record: { dateISO: '2026-08-20', waist: 79.6, chest: 104.6, neck: 40 },
  };

  const html = plainDetail(state, row);
  assert.match(html, /Replaced values · 1/);
  assert.match(html, /waist<\/td><td>80</, 'the number that was replaced is readable');
  assert.match(html, /chest<\/td><td>105</);
  assert.doesNotMatch(html, /undefined|NaN|\[object Object\]/);
});

test('an entry that was never replaced shows no panel', async () => {
  const { plainDetail } = await import('../js/ui/history.js');
  const html = plainDetail(
    { auditLog: [] },
    { kind: 'daily', key: 'daily:2026-08-21', title: 'Daily', dateISO: '2026-08-21', record: { dateISO: '2026-08-21', bodyweight: 86.4 } }
  );
  assert.doesNotMatch(html, /Replaced values/);
  assert.doesNotMatch(html, /undefined|NaN/);
});
