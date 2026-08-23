/**
 * A weigh-in and a set of tape readings are log entries, not properties of a day.
 *
 * `daily` and `measurements` were keyed by `dateISO`. One record per day was
 * the only shape they could hold, and the app hit both consequences:
 *
 *   Saving the same day twice REPLACED the first — how a full set of tape
 *   readings was destroyed by a stale idea of what "today" was.
 *   You could not take a reading on waking and another before bed, even though
 *   `timeOfDay` existed to tell them apart.
 *
 * v4 keys them by an id with `dateISO` as an ordinary index. Saving appends.
 * Nothing is replaced by a save, ever.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createFakeEnv } from './helpers/fake-indexeddb.js';
import { openDatabase, put, getAll, DB_VERSION, MIGRATIONS } from '../js/db.js';

const openFresh = () => {
  const env = createFakeEnv();
  return openDatabase({ indexedDB: env.indexedDB, name: 'bulk' });
};

test('the schema is at v4 and the migration exists', () => {
  assert.equal(DB_VERSION, 4);
  assert.ok(MIGRATIONS.some((m) => m.version === 4), 'a v4 migration is defined');
  assert.deepEqual(
    MIGRATIONS.map((m) => m.version),
    [1, 2, 3, 4],
    'every version from 1 is still there — a database can arrive from any of them'
  );
});

for (const store of ['daily', 'measurements']) {
  test(`${store} takes more than one entry for the same day`, async () => {
    const db = await openFresh();

    await put(db, store, { dateISO: '2026-08-22', timeOfDay: 'waking', waist: 79.2, bodyweight: 85.9 });
    await put(db, store, { dateISO: '2026-08-22', timeOfDay: 'sleep', waist: 80.4, bodyweight: 86.8 });

    const rows = await getAll(db, store);
    assert.equal(rows.length, 2, 'the second did not replace the first');
    assert.notEqual(rows[0].id, rows[1].id, 'each has its own identity');
    assert.deepEqual(rows.map((r) => r.dateISO), ['2026-08-22', '2026-08-22']);
  });

  test(`${store} is keyed by id, not by the date`, async () => {
    const db = await openFresh();
    const key = await put(db, store, { dateISO: '2026-08-22', waist: 79.2 });
    assert.equal(typeof key, 'number', 'an auto-increment id, not a date string');

    const tx = db.transaction(store);
    assert.equal(tx.objectStore(store).keyPath, 'id');
    assert.ok(tx.objectStore(store).indexNames.contains('dateISO'), 'and the date is an index');
  });

  test(`saving ${store} again never destroys what is there`, async () => {
    // The property the whole migration exists for.
    const db = await openFresh();
    for (let i = 0; i < 5; i += 1) {
      await put(db, store, { dateISO: '2026-08-22', waist: 79 + i, bodyweight: 85 + i });
    }
    const rows = await getAll(db, store);
    assert.equal(rows.length, 5, 'five saves, five entries');
    assert.deepEqual(rows.map((r) => r.waist), [79, 80, 81, 82, 83], 'and none of them lost a value');
  });
}

test('a v3 database keeps every row through the upgrade', async () => {
  /*
   * The migration reads each store, drops it and rebuilds it with a different
   * keyPath, because IndexedDB cannot change one in place. Losing a row there
   * would be the worst possible version of the bug it is fixing.
   */
  const env = createFakeEnv();

  const old = await openDatabase({ indexedDB: env.indexedDB, name: 'bulk', version: 3 });
  await put(old, 'daily', { dateISO: '2026-08-20', bodyweight: 85.5, bodyfatPct: 10.4 });
  await put(old, 'daily', { dateISO: '2026-08-22', bodyweight: 85.95 });
  await put(old, 'measurements', { dateISO: '2026-08-20', timeOfDay: 'waking', waist: 80, chest: 105 });
  old.close();

  const upgraded = await openDatabase({ indexedDB: env.indexedDB, name: 'bulk' });

  const daily = (await getAll(upgraded, 'daily')).sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  assert.equal(daily.length, 2, 'both weigh-ins survived');
  assert.equal(daily[0].bodyweight, 85.5, 'with their values');
  assert.equal(daily[0].bodyfatPct, 10.4, 'and every field, not just the ones the app happens to read');
  assert.equal(daily[1].bodyweight, 85.95);
  assert.ok(daily.every((row) => Number.isFinite(row.id)), 'and gained an id');

  const tape = await getAll(upgraded, 'measurements');
  assert.equal(tape.length, 1);
  assert.equal(tape[0].waist, 80);
  assert.equal(tape[0].chest, 105);
  assert.equal(tape[0].timeOfDay, 'waking');
  assert.equal(tape[0].dateISO, '2026-08-20', 'the date is kept as a field');
});

test('after the upgrade the day can hold a second entry', async () => {
  const env = createFakeEnv();
  const old = await openDatabase({ indexedDB: env.indexedDB, name: 'bulk', version: 3 });
  await put(old, 'measurements', { dateISO: '2026-08-22', timeOfDay: 'waking', waist: 79.2 });
  old.close();

  const upgraded = await openDatabase({ indexedDB: env.indexedDB, name: 'bulk' });
  await put(upgraded, 'measurements', { dateISO: '2026-08-22', timeOfDay: 'sleep', waist: 80.4 });

  const rows = await getAll(upgraded, 'measurements');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.timeOfDay).sort(), ['sleep', 'waking']);
});

test('an upgrade from v1 still lands on v4 with its data', async () => {
  // A phone that has not been opened in months arrives from whatever version it
  // was last on. Every path has to work, not just the most recent one.
  const env = createFakeEnv();
  const v1 = await openDatabase({ indexedDB: env.indexedDB, name: 'bulk', version: 1 });
  await put(v1, 'daily', { dateISO: '2026-01-01', bodyweight: 80 });
  v1.close();

  const now = await openDatabase({ indexedDB: env.indexedDB, name: 'bulk' });
  assert.equal(now.version, 4);
  const rows = await getAll(now, 'daily');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].bodyweight, 80);
});
