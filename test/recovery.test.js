import test from 'node:test';
import assert from 'node:assert/strict';

import { createFakeEnv } from './helpers/fake-indexeddb.js';
import {
  openDatabase,
  put,
  getAll,
  softDeleteRow,
  restoreRow,
  softDeleteSession,
  restoreSession,
  deletedRecords,
  saveSession,
  alive,
  RECOVERABLE_STORES,
} from '../js/db.js';

/** Each test gets its own empty database — no shared state between them. */
const openFresh = () => {
  const env = createFakeEnv();
  return openDatabase({ indexedDB: env.indexedDB, name: 'bulk' });
};

test('a deleted weigh-in leaves the live set and comes back whole', async () => {
  const db = await openFresh();
  // `daily` is keyed by its date, not by an id — one weigh-in per day.
  const id = await put(db, 'daily', { dateISO: '2026-08-01', bodyweight: 90.4, sleepHours: 7.5 });
  await put(db, 'daily', { dateISO: '2026-08-02', bodyweight: 90.6 });

  await softDeleteRow(db, 'daily', id, { reason: 'typed 9.2 instead of 92' });

  const afterDelete = await getAll(db, 'daily');
  assert.equal(afterDelete.length, 2, 'the row is still stored');
  assert.equal(alive(afterDelete).length, 1, 'but it is not live');

  const audit = await getAll(db, 'auditLog');
  const entry = audit.find((row) => row.entity === 'daily' && row.action === 'delete');
  assert.equal(entry.reason, 'typed 9.2 instead of 92', 'the reason is on the record');
  assert.equal(entry.restorable, true);

  await restoreRow(db, 'daily', id);
  const restored = alive(await getAll(db, 'daily')).find((row) => row.dateISO === id);
  assert.equal(restored.bodyweight, 90.4, 'the values are unchanged');
  assert.equal(restored.sleepHours, 7.5, 'including the ones nothing else reads');
});

test('restoring a session puts back the status it had, not a better one', async () => {
  // v1's restore promoted anything with an end time to 'complete', so a
  // half-finished session came back looking like a full one.
  const db = await openFresh();
  const { sessionLogId } = await saveSession(
    db,
    { dateISO: '2026-08-03', sessionId: 'C', status: 'partial', completionRatio: 0.4, endedAt: '2026-08-03T18:00:00.000Z' },
    [
      { exerciseId: 'benchComp', slotIndex: 0, setIndex: 0, load: 100, reps: 5, rpe: 8 },
      { exerciseId: 'benchComp', slotIndex: 0, setIndex: 1, load: 100, reps: 5, rpe: 8 },
    ]
  );

  const { deletedSets } = await softDeleteSession(db, sessionLogId, { reason: 'logged on the wrong day' });
  assert.equal(deletedSets, 2, 'the sets go with it');
  assert.equal(alive(await getAll(db, 'sets')).length, 0);

  const bin = await deletedRecords(db);
  assert.equal(bin.length, 1);
  assert.equal(bin[0].store, 'sessionLogs');

  const { restoredSets } = await restoreSession(db, sessionLogId);
  assert.equal(restoredSets, 2);
  const log = alive(await getAll(db, 'sessionLogs'))[0];
  assert.equal(log.status, 'partial', 'a partial session comes back partial');
  assert.equal(alive(await getAll(db, 'sets')).length, 2);
});

test('the bin lists every recoverable store, newest deletion first', async () => {
  const db = await openFresh();
  const ids = {};
  ids.daily = await put(db, 'daily', { dateISO: '2026-08-01', bodyweight: 90 });
  ids.measurements = await put(db, 'measurements', { dateISO: '2026-08-01', waist: 82 });
  ids.niggles = await put(db, 'niggles', { dateISO: '2026-08-01', site: 'Left elbow', severity: 1 });
  ids.media = await put(db, 'media', { dateISO: '2026-08-01', kind: 'physique' });

  for (const store of RECOVERABLE_STORES) {
    await softDeleteRow(db, store, ids[store]);
    // Deletions in the same millisecond would sort arbitrarily; the order is
    // what the recovery list depends on.
    await new Promise((resolve) => setTimeout(resolve, 2));
  }

  const bin = await deletedRecords(db);
  assert.equal(bin.length, 4);
  assert.deepEqual(
    [...bin].map((entry) => entry.store),
    ['media', 'niggles', 'measurements', 'daily'],
    'newest deletion first'
  );
});

test('an unrecoverable store is refused rather than silently ignored', async () => {
  const db = await openFresh();
  await assert.rejects(() => softDeleteRow(db, 'maxes', 1), /not a recoverable store/);
  await assert.rejects(() => restoreRow(db, 'sets', 1), /not a recoverable store/);
});

test('restoring something that is gone says so', async () => {
  const db = await openFresh();
  await assert.rejects(() => restoreRow(db, 'daily', 999), /no longer exists/);
});
