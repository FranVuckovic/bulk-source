/**
 * No write may destroy a record without leaving a way back.
 *
 * Two losses were reported from real use inside a week, and they were the same
 * shape twice: a store whose key is something the data supplies, written with a
 * plain `put`, so a second write for the same key replaced the first with
 * nothing recording what had been there.
 *
 *   `measurements` is keyed by `dateISO`. A stale idea of "today" pointed a
 *   save at yesterday and a full set of tape readings went.
 *   `sets` is keyed by `logicalKey`. A swap changed what a slot meant and the
 *   first set of the new exercise replaced the first set of the old one.
 *
 * The stores with an auto-increment key cannot do this: every write is a new
 * row. The stores with a natural key can, so each of them is listed here with
 * the reason it is safe, and the list is checked against the schema. A new
 * store with a natural key fails this test until someone says which it is.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createFakeEnv } from './helpers/fake-indexeddb.js';
import { openDatabase, put, getAll, putDatedRow, confirmWorkingMax, ALL_STORES } from '../js/db.js';

const source = readFileSync(new URL('../js/db.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

/**
 * Every store whose key comes from the data rather than from a counter, and
 * what stops a replacement being a loss.
 */
const NATURAL_KEYS = {
  daily: 'putDatedRow keeps the replaced values in the audit log',
  measurements: 'putDatedRow keeps the replaced values in the audit log',
  maxes: 'confirmWorkingMax appends every value to maxHistory',
  settings: 'holds preferences, not records — a unit or an increment has no history worth keeping',
  cycles: 'the id carries the instant the rotation started, so a new one never lands on an old row',
};

const openFresh = () => {
  const env = createFakeEnv();
  return openDatabase({ indexedDB: env.indexedDB, name: 'bulk' });
};

test('every store with a natural key is accounted for', async () => {
  const db = await openFresh();
  const unlisted = [];

  for (const name of ALL_STORES) {
    const store = db.transaction(name).objectStore(name);
    if (store.autoIncrement) continue;
    // `sets` and `sessionLogs` key on an id the app assigns, not on data.
    if (store.keyPath === 'id') continue;
    if (!NATURAL_KEYS[name]) unlisted.push(`${name} (keyed by ${store.keyPath})`);
  }

  assert.deepEqual(
    unlisted,
    [],
    'a store keyed by its own data can be silently replaced; say here what stops that being a loss'
  );
});

test('the dated stores are never written with a plain put from the app', () => {
  // The defect was not the replacement — a weigh-in re-entered is the same
  // weigh-in. It was that nothing recorded what the replacement replaced.
  for (const store of ['daily', 'measurements']) {
    assert.ok(
      !app.includes(`put(state.db, '${store}'`),
      `${store} is written with a plain put somewhere in app.js`
    );
    assert.ok(
      app.includes(`putDatedRow(state.db, '${store}'`),
      `${store} must go through putDatedRow`
    );
  }
});

test('a working max never replaces its predecessor without keeping it', async () => {
  const db = await openFresh();
  await confirmWorkingMax(db, { exerciseId: 'benchComp', workingMax: 115, conf: 'high' }, 'test');
  await confirmWorkingMax(db, { exerciseId: 'benchComp', workingMax: 120, conf: 'high' }, 'block-boundary');

  const live = await getAll(db, 'maxes');
  assert.equal(live.length, 1, 'one current working max per exercise');
  assert.equal(live[0].workingMax, 120);

  const history = await getAll(db, 'maxHistory');
  assert.equal(history.length, 2, 'and every value it ever had');
  assert.deepEqual(history.map((row) => row.workingMax), [115, 120]);
});

test('two rotations at the same sequence do not collide', async () => {
  // `cycles` is keyed by `id`, and the id is built from the sequence. If it were
  // built from the sequence alone, correcting a rotation backwards and then
  // forwards again would write over the record of the first attempt.
  const { newCycle } = await import('../js/cycle.js');
  const PLAN = JSON.parse(readFileSync(new URL('../data/plan-fopip-v2.json', import.meta.url), 'utf8'));

  const first = newCycle(PLAN, { sequence: 5, startedAtISO: '2026-08-01T09:00:00.000Z' });
  const second = newCycle(PLAN, { sequence: 5, startedAtISO: '2026-09-01T09:00:00.000Z' });
  assert.notEqual(first.id, second.id, 'the start instant is part of the identity');

  const db = await openFresh();
  await put(db, 'cycles', first);
  await put(db, 'cycles', second);
  assert.equal((await getAll(db, 'cycles')).length, 2, 'both are stored');
});

test('a replacement in a dated store is written as an audit entry, not just overwritten', async () => {
  const db = await openFresh();
  await putDatedRow(db, 'measurements', { dateISO: '2026-08-20', waist: 80, chest: 105 });
  await putDatedRow(db, 'measurements', { dateISO: '2026-08-20', waist: 79.6, chest: 104.6 });

  const audit = (await getAll(db, 'auditLog')).filter((row) => row.action === 'overwrite');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].previous.waist, 80);
  assert.equal(audit[0].previous.chest, 105);
});

test('the only hard delete in the database layer is the one behind emptying the bin', () => {
  // `remove` exists; what matters is how many places reach for it.
  const calls = [...source.matchAll(/store\.delete\(|\.delete\(key\)/g)];
  assert.ok(calls.length <= 2, `unexpected delete calls in db.js: ${calls.length}`);
  assert.ok(source.includes('export function remove('), 'the one deliberate one');
});
