/**
 * Adding a measurement site must never cost an old reading.
 *
 * Flexed biceps and forearms were added on 21 August 2026, taking the list from
 * eight sites to twelve. Every row written before that has no value for them,
 * and that has to stay true and harmless forever: absent reads as blank, the
 * charts skip it, the CSV writes an empty cell, and an export taken on the old
 * app still imports into the new one.
 *
 * The rule the tests hold: sites are only ever ADDED. Never removed, never
 * renamed. Renaming a key orphans every reading taken under the old one, which
 * is the same thing as deleting them.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { MEASUREMENT_SITES, MEASUREMENT_HOW } from '../js/ui/body.js';
import { buildExport, parseImport, applyImport } from '../js/export.js';
import { createFakeEnv } from './helpers/fake-indexeddb.js';
import { openDatabase, getAll, withTransaction, request } from '../js/db.js';

const ids = MEASUREMENT_SITES.map(([id]) => id);

/** The eight the app shipped with. These keys are now permanent. */
const ORIGINAL = ['waist', 'chest', 'shoulders', 'armL', 'armR', 'quadL', 'quadR', 'neck'];

test('the original sites keep their keys', () => {
  for (const id of ORIGINAL) {
    assert.ok(ids.includes(id), `${id} was removed or renamed; every reading under that key is orphaned`);
  }
});

test('every site has instructions and a label', () => {
  for (const [id, label] of MEASUREMENT_SITES) {
    assert.ok(label && label.length > 1, `${id} has no label`);
    assert.ok(MEASUREMENT_HOW[id], `${id} has no instructions — an unrepeatable measurement is noise`);
  }
});

test('the flexed arm is a separate site from the relaxed one', () => {
  // Mixing them is the failure mode the instructions warn about, so they cannot
  // share a key.
  assert.ok(ids.includes('armL') && ids.includes('armLFlex'));
  assert.notEqual('armL', 'armLFlex');
  assert.match(MEASUREMENT_HOW.armLFlex, /different measurement/i);
});

test('the CSV has a column for every site', async () => {
  // The header lives in export.js and the sites live in body.js. Adding a site
  // and forgetting the column would drop it silently from every backup, so the
  // two lists are checked against each other rather than trusted to stay
  // together.
  const source = await import('node:fs').then(({ readFileSync }) =>
    readFileSync(new URL('../js/export.js', import.meta.url), 'utf8')
  );
  const block = source.slice(source.indexOf('measurements: ['), source.indexOf('],', source.indexOf('measurements: [')));

  for (const id of ids) {
    assert.ok(block.includes(`'${id}'`), `${id} has no CSV column — it would vanish from every backup`);
  }
});

test('a row written before a site existed round-trips through export and import', async () => {
  // The exact shape of an old row: the original eight, and nothing else.
  const old = {
    dateISO: '2026-08-20',
    timeOfDay: 'waking',
    timeOfDayNote: null,
    waist: 80,
    chest: 105,
    shoulders: 124,
    armL: 32.6,
    armR: 32.5,
    quadL: 55.6,
    quadR: 56.2,
    neck: 39.5,
  };

  const snapshot = {
    data: {
      sessionLogs: [], sets: [], daily: [], niggles: [], media: [], maxes: [], maxHistory: [],
      settings: [], cycles: [], auditLog: [],
      measurements: [old],
    },
  };

  const { zip } = buildExport(snapshot, null, {});
  const parsed = parseImport(zip);
  assert.deepEqual(parsed.data.measurements[0], old, 'unchanged, and no invented nulls');

  const env = createFakeEnv();
  const db = await openDatabase({ indexedDB: env.indexedDB, name: 'bulk' });
  await applyImport(db, parsed, { withTransaction, request, stores: ['measurements'] });

  const stored = await getAll(db, 'measurements');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].waist, 80, 'the old reading survived');
  for (const id of ['armLFlex', 'armRFlex', 'forearmL', 'forearmR']) {
    assert.equal(stored[0][id], undefined, `${id} is absent, not zero`);
  }
});

test('a blank site is never stored as zero', () => {
  // A zero drags an average down and looks like a real reading. Blank must stay
  // blank all the way to the database.
  const row = { dateISO: '2026-08-21' };
  for (const id of ids) {
    assert.notEqual(row[id], 0);
    assert.equal(row[id] ?? null, null, `${id} reads as blank when it was never taken`);
  }
});

test('a save stamps when it was written, and old rows without one still work', async () => {
  /*
   * Reported twice: the fields were already full after saving, which reads as
   * "the form did not clear" rather than "you already logged this day". The
   * second time it was the mechanism of a data loss.
   *
   * `savedAtISO` is what lets the screen say "already logged at 07:12". It is
   * added like any other field — rows written before it exist simply have none,
   * and the screen says "already logged" without a time rather than inventing
   * one.
   */
  const { MEASUREMENT_SITES: sites } = await import('../js/ui/body.js');
  void sites;

  const older = { dateISO: '2026-08-20', waist: 80, chest: 105 };
  const newer = { dateISO: '2026-08-22', savedAtISO: '2026-08-22T07:12:00.000Z', waist: 79.2, chest: 103 };

  const snapshot = {
    data: {
      sessionLogs: [], sets: [], daily: [], niggles: [], media: [], maxes: [], maxHistory: [],
      settings: [], cycles: [], auditLog: [],
      measurements: [older, newer],
    },
  };

  const { zip } = buildExport(snapshot, null, {});
  const parsed = parseImport(zip);

  assert.deepEqual(parsed.data.measurements[0], older, 'the old row is unchanged and gains no invented stamp');
  assert.equal(parsed.data.measurements[1].savedAtISO, '2026-08-22T07:12:00.000Z');
});

test('the CSV has a column for the save stamp', async () => {
  const source = await import('node:fs').then(({ readFileSync }) =>
    readFileSync(new URL('../js/export.js', import.meta.url), 'utf8')
  );
  for (const store of ['measurements', 'daily']) {
    const start = source.indexOf(`${store}: [`);
    const block = source.slice(start, source.indexOf('],', start));
    assert.ok(block.includes("'savedAtISO'"), `${store} does not carry savedAtISO into a backup`);
  }
});

test('daily and measurements are counted separately', async () => {
  // They are separate records. Logging only a weigh-in must not make the tape
  // card claim anything about itself — the earlier check used `||` and did.
  const source = await import('node:fs').then(({ readFileSync }) =>
    readFileSync(new URL('../js/ui/body.js', import.meta.url), 'utf8')
  );
  const fn = source.slice(source.indexOf('function entriesToday'), source.indexOf('function loggedBanner'));
  assert.match(fn, /state\[store\]/, 'it takes the store as an argument');

  const view = source.slice(source.indexOf('export function view(ctx)'));
  assert.match(view, /entriesToday\(state, 'daily'\)/);
  assert.match(view, /entriesToday\(state, 'measurements'\)/);
  assert.match(view, /Save another weigh-in/, 'and the button says a save adds rather than replaces');
  assert.match(view, /Save another set of readings/);
});

test('the arms read relaxed then flexed, left then right', () => {
  // Asked for so the four arm numbers can be compared down the screen in the
  // order they are taken. Display order only — every key is unchanged, so no
  // reading moves.
  const arms = ids.filter((id) => id.startsWith('arm'));
  assert.deepEqual(arms, ['armL', 'armLFlex', 'armR', 'armRFlex']);
});
