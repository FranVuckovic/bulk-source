/**
 * A deleted entry must stay deleted.
 *
 * Reported from real use: "I think an entry I deleted has maybe returned
 * automatically." It had. Deleting a weigh-in put it in the bin correctly, and
 * then saving *any* weigh-in brought it back — into History, into the charts,
 * and into every average — until the next full reload quietly removed it again.
 *
 * The cause was duplication rather than logic. `loadEverything` filtered the
 * dated stores through `alive()`; the four save handlers each inlined their own
 * `getAll(...).sort(...)` and all four had dropped the filter. The database was
 * right throughout, which is why it was hard to see and easy to disbelieve.
 *
 * These tests hold the property at the level it broke: whatever a save path
 * reloads must not contain deleted rows.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeEnv } from './helpers/fake-indexeddb.js';
import { openDatabase, put, getAll, softDeleteRow, alive, deletedRecords } from '../js/db.js';

/** Each test gets its own empty database — no shared state between them. */
const openFresh = () => {
  const env = createFakeEnv();
  return openDatabase({ indexedDB: env.indexedDB, name: 'bulk' });
};

/** What a save handler does: write, then re-read the store for the screen. */
const reloadDated = async (db, store) =>
  alive(await getAll(db, store)).sort((a, b) => a.dateISO.localeCompare(b.dateISO));

test('saving a weigh-in does not bring a deleted one back', async () => {
  const db = await openFresh();
  await put(db, 'daily', { dateISO: '2026-08-10', bodyweight: 88 });
  await put(db, 'daily', { dateISO: '2026-08-20', bodyweight: 90 });

  await softDeleteRow(db, 'daily', '2026-08-10', { reason: 'logged twice' });
  assert.equal((await reloadDated(db, 'daily')).length, 1, 'gone after the delete');

  // The write that used to resurrect it.
  await put(db, 'daily', { dateISO: '2026-08-21', bodyweight: 90.5 });
  const shown = await reloadDated(db, 'daily');

  assert.equal(shown.length, 2, 'the new one and the surviving one — not the deleted one');
  assert.ok(!shown.some((row) => row.dateISO === '2026-08-10'), 'the deleted weigh-in stays deleted');
});

test('the deleted row is still in the database and still recoverable', async () => {
  // It was never destroyed; it was only ever wrongly re-displayed. The bin has
  // to keep working, or the fix would have traded one loss for another.
  const db = await openFresh();
  await put(db, 'daily', { dateISO: '2026-08-10', bodyweight: 88 });
  await softDeleteRow(db, 'daily', '2026-08-10', { reason: 'mis-typed' });
  await put(db, 'daily', { dateISO: '2026-08-21', bodyweight: 90.5 });

  const raw = await getAll(db, 'daily');
  assert.equal(raw.length, 2, 'both rows are still stored');

  const bin = await deletedRecords(db);
  assert.equal(bin.length, 1);
  assert.equal(bin[0].store, 'daily');
  assert.equal(bin[0].id, '2026-08-10');
});

test('every dated store behaves the same way', async () => {
  // All four save handlers had the same defect, so all four are held to it.
  for (const store of ['daily', 'measurements', 'niggles', 'media']) {
    const db = await openFresh();
    const key = store === 'niggles' || store === 'media' ? undefined : '2026-08-10';

    const id = await put(db, store, { dateISO: '2026-08-10', localDate: '2026-08-10', site: 'Left elbow', kind: 'physique' });
    await softDeleteRow(db, store, key ?? id, { reason: 'test' });
    await put(db, store, { dateISO: '2026-08-21', localDate: '2026-08-21', site: 'Wrist', kind: 'physique' });

    const shown = await reloadDated(db, store);
    assert.ok(
      !shown.some((row) => row.deletedAtISO),
      `${store}: a save must never reload a deleted row`
    );
  }
});
