/**
 * Swapping an exercise must not destroy the sets already logged under it.
 *
 * A set's identity is `logicalKey` — session, slot index, set index — and that
 * is a unique index, so a second write to the same key replaces the row rather
 * than adding one. That is exactly right when it is the same set being
 * corrected: unlog a set, log it again with the right weight, one row.
 *
 * It stops being right the moment the slot changes what it means. Swap leg
 * press for hack squat at slot 4 after three sets of leg press, log the first
 * hack squat set, and its key is `log-4-0` — the key the first leg press set
 * already holds. The leg press set was replaced. No bin entry, no audit, no
 * warning: three sets went in and two came out.
 *
 * `remove-added` already refused to reindex logged sets. `do-swap` did not, and
 * a UI guard would not have been enough anyway — the guarantee belongs at the
 * database, where the key is.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createFakeEnv } from './helpers/fake-indexeddb.js';
import { openDatabase, putSetIdempotent, getAll, saveSession, alive, deletedRecords } from '../js/db.js';

const openFresh = () => {
  const env = createFakeEnv();
  return openDatabase({ indexedDB: env.indexedDB, name: 'bulk' });
};

const record = (sessionLogId, slotIndex, setIndex, exerciseId, load) => ({
  sessionLogId,
  exerciseId,
  slotIndex,
  setIndex,
  load,
  reps: 8,
  rpe: 8,
  logicalKey: `${sessionLogId}-${slotIndex}-${setIndex}`,
  timestampISO: new Date().toISOString(),
});

const openSession = async (db) => {
  const { sessionLogId } = await saveSession(db, { dateISO: '2026-08-21', sessionId: 'B', status: 'active' }, []);
  return sessionLogId;
};

test('a swap does not destroy the sets logged before it', async () => {
  const db = await openFresh();
  const log = await openSession(db);

  for (let i = 0; i < 3; i++) {
    await putSetIdempotent(db, record(log, 4, i, 'legpress', 200 + i), { operationId: `press-${i}` });
  }
  assert.equal(alive(await getAll(db, 'sets')).length, 3);

  // Slot 4 is now hack squat. Its first set lands on the leg press set's key.
  await putSetIdempotent(db, record(log, 4, 0, 'hackSquat', 120), { operationId: 'hack-0' });

  const live = alive(await getAll(db, 'sets'));
  assert.equal(live.length, 3, 'three leg press sets became two plus one hack squat set');

  const press = live.filter((set) => set.exerciseId === 'legpress');
  assert.equal(press.length, 2, 'the two later leg press sets are untouched');

  const stored = await getAll(db, 'sets');
  const archived = stored.filter((set) => set.exerciseId === 'legpress' && set.deletedAtISO);
  assert.equal(archived.length, 1, 'the displaced set still exists');
  assert.equal(archived[0].load, 200, 'with its load intact');
});

test('the displaced set is in the bin, not merely still in the table', async () => {
  const db = await openFresh();
  const log = await openSession(db);
  await putSetIdempotent(db, record(log, 4, 0, 'legpress', 200), { operationId: 'press-0' });
  await putSetIdempotent(db, record(log, 4, 0, 'hackSquat', 120), { operationId: 'hack-0' });

  const bin = await deletedRecords(db);
  assert.equal(bin.length, 1, 'it is offered back');
  assert.equal(bin[0].store, 'sets');
  assert.equal(bin[0].row.exerciseId, 'legpress');

  const audit = (await getAll(db, 'auditLog')).filter((row) => row.action === 'displaced');
  assert.equal(audit.length, 1, 'and the reason is recorded');
  assert.equal(audit[0].previous.exerciseId, 'legpress');
  assert.equal(audit[0].exerciseId, 'hackSquat', 'including what took its place');
});

test('correcting the same set is still one row, not a displacement', async () => {
  // The behaviour that made the key worth having: unlog, retype, log again.
  const db = await openFresh();
  const log = await openSession(db);

  const { set: first } = await putSetIdempotent(db, record(log, 4, 0, 'legpress', 200), { operationId: 'a' });
  const { set: second } = await putSetIdempotent(db, record(log, 4, 0, 'legpress', 205), { operationId: 'b' });

  assert.equal(second.id, first.id, 'the same row');
  assert.equal(second.load, 205);
  assert.equal(alive(await getAll(db, 'sets')).length, 1);
  assert.equal((await deletedRecords(db)).length, 0, 'nothing displaced');
  assert.equal((await getAll(db, 'auditLog')).filter((r) => r.action === 'displaced').length, 0);
});

test('a retried save is still recognised as the same write', async () => {
  const db = await openFresh();
  const log = await openSession(db);

  const first = await putSetIdempotent(db, record(log, 4, 0, 'legpress', 200), { operationId: 'same' });
  const retry = await putSetIdempotent(db, record(log, 4, 0, 'legpress', 200), { operationId: 'same' });

  assert.equal(retry.duplicate, true);
  assert.equal(retry.set.id, first.set.id);
  assert.equal(alive(await getAll(db, 'sets')).length, 1);
});

test('a displaced set can be restored without colliding again', async () => {
  // Its key was released when it was displaced, so putting it back must not
  // fail the unique index nor evict the set that took its place.
  const db = await openFresh();
  const log = await openSession(db);
  await putSetIdempotent(db, record(log, 4, 0, 'legpress', 200), { operationId: 'press-0' });
  await putSetIdempotent(db, record(log, 4, 0, 'hackSquat', 120), { operationId: 'hack-0' });

  const { restoreRow } = await import('../js/db.js');
  const bin = await deletedRecords(db);
  await restoreRow(db, 'sets', bin[0].id);

  const live = alive(await getAll(db, 'sets'));
  assert.equal(live.length, 2, 'both sets are live');
  assert.deepEqual(live.map((s) => s.exerciseId).sort(), ['hackSquat', 'legpress']);
});

test('unlogging a set and then logging the swapped exercise does not resurrect it', async () => {
  /*
   * The path you actually take in a gym: a set is logged, you swap the slot,
   * you tap the tick to clear the set that is now showing under the wrong
   * exercise, then you log the new one.
   *
   * The unlog soft-deletes the row, which leaves it holding `logicalKey`.
   * Before this, the next write found it by that key and wrote straight into
   * it, clearing `deletedAtISO` on the way — so a deleted leg press set came
   * back to life as a hack squat set, with the leg press load gone and the bin
   * entry silently emptied.
   */
  const db = await openFresh();
  const log = await openSession(db);
  const { softDeleteRow, restoreRow } = await import('../js/db.js');

  const { set } = await putSetIdempotent(db, record(log, 4, 0, 'legpress', 200), { operationId: 'press-0' });
  await softDeleteRow(db, 'sets', set.id, { reason: 'removed from the set editor' });
  assert.equal((await deletedRecords(db)).length, 1, 'in the bin after the unlog');

  await putSetIdempotent(db, record(log, 4, 0, 'hackSquat', 120), { operationId: 'hack-0' });

  const live = alive(await getAll(db, 'sets'));
  assert.equal(live.length, 1);
  assert.equal(live[0].exerciseId, 'hackSquat', 'the new set is the live one');
  assert.equal(live[0].load, 120);

  const bin = await deletedRecords(db);
  assert.equal(bin.length, 1, 'and the leg press set is still in the bin');
  assert.equal(bin[0].row.exerciseId, 'legpress');
  assert.equal(bin[0].row.load, 200, 'with its own load, not the hack squat one');

  await restoreRow(db, 'sets', bin[0].id);
  assert.equal(alive(await getAll(db, 'sets')).length, 2, 'and can be brought back beside it');
});
