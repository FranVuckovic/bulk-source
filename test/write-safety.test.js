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
import { openDatabase, put, getAll, editDatedRow, confirmWorkingMax, ALL_STORES } from '../js/db.js';

const source = readFileSync(new URL('../js/db.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

/**
 * Every store whose key comes from the data rather than from a counter, and
 * what stops a replacement being a loss.
 */
const NATURAL_KEYS = {
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

test('the dated stores cannot be replaced by a save at all any more', async () => {
  /*
   * The strongest version of the fix. `daily` and `measurements` used to be
   * keyed by `dateISO`, so a save on a day that already had one replaced it —
   * and the whole defence was remembering to route every write through a helper
   * that kept the old values.
   *
   * At v4 they are keyed by an auto-increment id. A save appends. There is no
   * route through which a save can destroy an entry, so there is nothing left
   * to remember.
   */
  const db = await openFresh();
  for (const store of ['daily', 'measurements']) {
    const tx = db.transaction(store);
    assert.equal(tx.objectStore(store).keyPath, 'id', `${store} is keyed by an id`);
    assert.ok(tx.objectStore(store).indexNames.contains('dateISO'), 'with the date as an index');
  }

  await put(db, 'daily', { dateISO: '2026-08-20', bodyweight: 86.05 });
  await put(db, 'daily', { dateISO: '2026-08-20', bodyweight: 85.5 });
  assert.equal((await getAll(db, 'daily')).length, 2, 'a save can only ever add');
});

test('editing an entry is a different call from saving one, and it is audited', () => {
  // Editing is deliberate: you opened one entry in the Log and changed it.
  assert.ok(app.includes("editDatedRow(state.db, store,"), 'the app has an edit path');
  assert.ok(app.includes("put(state.db, 'daily', row)"), 'and a save path that appends');

  const source = readFileSync(new URL('../js/db.js', import.meta.url), 'utf8');
  const fn = source.slice(source.indexOf('export async function editDatedRow'));
  assert.match(fn.slice(0, 2000), /action: 'edit'/, 'an edit is recorded');
  assert.match(fn.slice(0, 2000), /previous:/, 'with what it replaced');
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

test('an edit in a dated store keeps what it replaced', async () => {
  const db = await openFresh();
  const id = await put(db, 'measurements', { dateISO: '2026-08-20', waist: 80, chest: 105 });
  await editDatedRow(db, 'measurements', id, { waist: 79.6, chest: 104.6 });

  const audit = (await getAll(db, 'auditLog')).filter((row) => row.action === 'edit');
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

/* ═══════════════════════════════════════════════════════════════════════
   The Body screen's two drafts are independent
   ═══════════════════════════════════════════════════════════════════════ */

test('saving one Body section does not empty the other', () => {
  // Reported: "if you start inputting weekly body measurements and then you
  // save the daily weight it will delete the weekly numbers you were typing
  // even if they were not already saved."
  //
  // `saveDaily` called `resetBodyDraft`, which rebuilt the entire draft — tape
  // fields included. Nothing was lost from the database because it had never
  // reached the database, which is precisely what made it worse: several
  // minutes of measuring gone with no warning and nothing to recover from.
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

  const daily = app.slice(app.indexOf('async saveDaily(row)'));
  const dailyBody = daily.slice(0, daily.indexOf('\n  },'));
  assert.match(dailyBody, /clearDraftSection\('daily'\)/, 'saveDaily must clear only the daily fields');
  assert.ok(!dailyBody.includes('resetBodyDraft'), 'saveDaily still empties the whole draft');

  const tape = app.slice(app.indexOf('async saveMeasurements(row)'));
  const tapeBody = tape.slice(0, tape.indexOf('\n  },'));
  assert.match(tapeBody, /clearDraftSection\('measurements'\)/);
  assert.ok(!tapeBody.includes('resetBodyDraft'), 'saveMeasurements still empties the whole draft');
});

test('the two sections between them cover every field the Body form writes', () => {
  // A field in neither list is one that never clears after a save, and would
  // ride along into the next entry as a value nobody typed for it.
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const sections = app.slice(app.indexOf('const DRAFT_SECTIONS'), app.indexOf('/** Empty only the fields'));

  for (const field of ['bodyweight', 'bodyfatPct', 'sleepHours', 'steps', 'mood', 'caffeine', 'scale', 'scaleNote', 'note']) {
    assert.match(sections, new RegExp(`'${field}'`), `${field} is in neither section`);
  }
  // The tape sites are cleared by iterating MEASUREMENT_SITES rather than being
  // listed, so that adding a site cannot leave one behind.
  const clear = app.slice(app.indexOf('function clearDraftSection'));
  assert.match(clear.slice(0, clear.indexOf('\n}')), /MEASUREMENT_SITES/);
});

test('deleting or restoring an entry leaves what you are typing alone', () => {
  // Both used to reset the Body draft. Since v4 the draft is built empty, so
  // there was nothing to refresh — the calls only cost you your typing.
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

  const del = app.slice(app.indexOf('async deleteEntry(kind, id'));
  assert.ok(!del.slice(0, del.indexOf('\n  },')).includes('resetBodyDraft'), 'deleteEntry still resets the draft');

  const restore = app.slice(app.indexOf('async restoreEntry(store, rawKey)'));
  assert.ok(!restore.slice(0, restore.indexOf('\n  },')).includes('resetBodyDraft'), 'restoreEntry still resets the draft');
});
