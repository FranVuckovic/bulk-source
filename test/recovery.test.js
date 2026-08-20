import test from 'node:test';
import assert from 'node:assert/strict';

import { createFakeEnv } from './helpers/fake-indexeddb.js';
import {
  openDatabase,
  putSetIdempotent,
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
  // `sets` joined the recoverable stores when deleting a single set became
  // reachable from the Log — the duplicate you logged twice, the one you put on
  // the wrong exercise. A set with no session of its own is listed on its own;
  // sets deleted by a session cascade are not, because the session restores them.
  const { sessionLogId } = await saveSession(
    db,
    { dateISO: '2026-08-01', sessionId: 'A', status: 'partial' },
    [{ exerciseId: 'benchComp', slotIndex: 0, setIndex: 0, load: 100, reps: 1, rpe: 8 }]
  );
  ids.sets = (await getAll(db, 'sets')).find((row) => row.sessionLogId === sessionLogId).id;

  for (const store of RECOVERABLE_STORES) {
    await softDeleteRow(db, store, ids[store]);
    // Deletions in the same millisecond would sort arbitrarily; the order is
    // what the recovery list depends on.
    await new Promise((resolve) => setTimeout(resolve, 2));
  }

  const bin = await deletedRecords(db);
  assert.equal(bin.length, 5);
  assert.deepEqual(
    [...bin].map((entry) => entry.store),
    ['sets', 'media', 'niggles', 'measurements', 'daily'],
    'newest deletion first'
  );
});

test('a set deleted with its session is not listed apart from it', async () => {
  // Deleting a session soft-deletes its sets by cascade. Listing each of them
  // as its own restorable row would put twenty-seven entries in the bin beside
  // the one session that already restores all of them.
  const db = await openFresh();
  const { sessionLogId } = await saveSession(
    db,
    { dateISO: '2026-08-05', sessionId: 'A', status: 'complete' },
    [
      { exerciseId: 'benchComp', slotIndex: 0, setIndex: 0, load: 100, reps: 5, rpe: 8 },
      { exerciseId: 'benchComp', slotIndex: 0, setIndex: 1, load: 100, reps: 5, rpe: 8 },
    ]
  );
  await softDeleteSession(db, sessionLogId, { reason: 'wrong day' });

  const bin = await deletedRecords(db);
  assert.equal(bin.length, 1, 'the session, and not its two sets');
  assert.equal(bin[0].store, 'sessionLogs');
});

test('a set deleted on its own can be restored without changing its session', async () => {
  const db = await openFresh();
  const { sessionLogId } = await saveSession(
    db,
    { dateISO: '2026-08-01', sessionId: 'A', status: 'partial' },
    [{ exerciseId: 'benchComp', slotIndex: 0, setIndex: 0, load: 100, reps: 1, rpe: 8 }]
  );
  const set = (await getAll(db, 'sets')).find((row) => row.sessionLogId === sessionLogId);

  await softDeleteRow(db, 'sets', set.id, { reason: 'logged against the wrong exercise' });
  assert.equal(alive(await getAll(db, 'sets')).length, 0);
  assert.deepEqual((await deletedRecords(db)).map((entry) => entry.store), ['sets']);

  await restoreRow(db, 'sets', set.id);
  const restored = alive(await getAll(db, 'sets'))[0];
  assert.equal(restored.exerciseId, 'benchComp');
  assert.equal(restored.load, 100);
  assert.equal(alive(await getAll(db, 'sessionLogs')).length, 1, 'the session stays live throughout');
});

test('an unrecoverable store is refused rather than silently ignored', async () => {
  const db = await openFresh();
  await assert.rejects(() => softDeleteRow(db, 'maxes', 1), /not a recoverable store/);
  await assert.rejects(() => restoreRow(db, 'cycles', 1), /not a recoverable store/);
});

test('restoring something that is gone says so', async () => {
  const db = await openFresh();
  await assert.rejects(() => restoreRow(db, 'daily', 999), /no longer exists/);
});

/*
 * "Remove this set" in the set editor called `remove` — a hard delete, no audit
 * entry, nothing in the bin. It was the only place in the app that destroyed a
 * logged set, and it disagreed with the Log, where deleting the same set is
 * recoverable. Two meanings for one action, and the destructive one was the one
 * you reached mid-session.
 *
 * The rule now: exactly one `remove` call survives in app.js, and it is the one
 * behind emptying the bin.
 */
test('nothing in the app hard-deletes except emptying the bin', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

  const lines = source.split('\n');
  const hardDeletes = lines
    .map((line, i) => ({ line: line.trim(), i }))
    .filter(({ line }) => /\bawait remove\(state\.db/.test(line));

  assert.equal(hardDeletes.length, 1, `expected one hard delete, found ${hardDeletes.length}`);

  // And it is the one inside the empty-the-bin loop.
  const context = lines.slice(Math.max(0, hardDeletes[0].i - 12), hardDeletes[0].i).join('\n');
  assert.match(context, /bin|purge|destroy/i, 'the surviving hard delete is not the bin');
});

test('removing a set from the editor puts it in the bin rather than destroying it', async () => {
  const db = await openFresh();
  const { sessionLogId } = await saveSession(
    db,
    { dateISO: '2026-08-20', sessionId: 'A', status: 'active' },
    [{ exerciseId: 'benchComp', slotIndex: 0, setIndex: 0, load: 100, reps: 5, rpe: 8 }]
  );
  const set = (await getAll(db, 'sets')).find((row) => row.sessionLogId === sessionLogId);

  await softDeleteRow(db, 'sets', set.id, { reason: 'removed from the set editor' });
  assert.equal(alive(await getAll(db, 'sets')).length, 0, 'gone from the session');
  assert.deepEqual((await deletedRecords(db)).map((e) => e.store), ['sets'], 'and waiting in the bin');

  await restoreRow(db, 'sets', set.id);
  assert.equal(alive(await getAll(db, 'sets'))[0].load, 100, 'with its load intact');
});

test('removing a set and logging it again leaves nothing in the bin', async () => {
  // The reason it was a hard delete: an unlog is usually immediately followed
  // by logging the same slot with the right weight. If the removed row stayed
  // in the bin, every corrected set would leave litter behind. It does not —
  // `logicalKey` puts the new value in the same row and clears the deletion.
  const db = await openFresh();
  const { sessionLogId } = await saveSession(db, { dateISO: '2026-08-20', sessionId: 'A', status: 'active' }, []);
  const record = {
    sessionLogId,
    exerciseId: 'benchComp',
    slotIndex: 0,
    setIndex: 0,
    load: 100,
    reps: 5,
    rpe: 8,
    logicalKey: `${sessionLogId}-0-0`,
    timestampISO: '2026-08-20T10:00:00.000Z',
  };

  const { set } = await putSetIdempotent(db, record, { operationId: 'op-1' });
  await softDeleteRow(db, 'sets', set.id, { reason: 'removed from the set editor' });
  assert.equal((await deletedRecords(db)).length, 1);

  const { set: corrected } = await putSetIdempotent(db, { ...record, load: 105 }, { operationId: 'op-2' });
  assert.equal(corrected.id, set.id, 'the same row, not a second one');
  assert.equal(corrected.load, 105);
  assert.equal(alive(await getAll(db, 'sets')).length, 1);
  assert.equal((await deletedRecords(db)).length, 0, 'the correction cleared the bin entry');
});
