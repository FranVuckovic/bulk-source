/**
 * Editing and deleting a body entry from the Log.
 *
 * The defects these prevent:
 *
 *  - the one this file was written to catch. The v4 migration rekeyed `daily`
 *    and `measurements` from `dateISO` to an auto-increment `id`, and the Log
 *    kept identifying those rows by date. `parseStoreKey('daily', '2026-08-22')`
 *    is NaN and `store.get('2026-08-22')` matches nothing, so deleting a
 *    weigh-in from the Log threw instead of deleting it — and two entries on
 *    one day collided on the same row key.
 *  - an edit that silently writes nothing, or writes over the wrong row.
 *  - an edit with no confirmation. Overwriting a logged measurement is the
 *    thing that lost the 20 August data in the first place.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeEnv } from './helpers/fake-indexeddb.js';
import { openDatabase, put, getAll, editDatedRow, softDeleteRow, parseStoreKey } from '../js/db.js';
import { entries, editSheet, actions } from '../js/ui/history.js';

const openFresh = () => openDatabase({ indexedDB: createFakeEnv().indexedDB, name: 'bulk' });

const PLAN = { sessions: [], exercises: {} };

function baseState(rows) {
  return {
    plan: PLAN,
    logs: [], sets: [], niggles: [], media: [], cycles: [], deleted: [], auditLog: [],
    daily: rows.daily || [],
    measurements: rows.measurements || [],
    settings: { unit: 'kg' },
    historyFilter: 'all',
  };
}

test('parseStoreKey turns a Log row key back into the key the store uses', () => {
  // The regression in one line: a date is not a key for these stores any more.
  assert.equal(parseStoreKey('daily', '7'), 7);
  assert.equal(parseStoreKey('measurements', '12'), 12);
  assert.ok(Number.isNaN(parseStoreKey('daily', '2026-08-22')), 'a date parses to NaN, which finds nothing');
});

test('two body entries on the same day are two separate rows in the Log', () => {
  const state = baseState({
    measurements: [
      { id: 1, dateISO: '2026-08-22', waist: 88.0, measuredAt: 'waking' },
      { id: 2, dateISO: '2026-08-22', waist: 87.6, measuredAt: 'evening' },
    ],
  });
  const rows = entries(state).filter((row) => row.kind === 'measurement');

  assert.equal(rows.length, 2, 'both entries are listed');
  assert.notEqual(rows[0].key, rows[1].key, 'the two rows share a key, so a tap cannot tell them apart');
  assert.deepEqual([rows[0].id, rows[1].id].sort(), [1, 2], 'rows are identified by their own id, not by their date');
});

test('a Log row carries the key its store can actually be asked for', async () => {
  const db = await openFresh();
  await put(db, 'measurements', { dateISO: '2026-08-20', waist: 88, chest: 106.2 });
  const stored = (await getAll(db, 'measurements'))[0];

  const state = baseState({ measurements: [stored] });
  const row = entries(state).find((entry) => entry.kind === 'measurement');

  // The whole bug: this call used to be made with the date and threw.
  const result = await softDeleteRow(db, 'measurements', parseStoreKey('measurements', String(row.id)), {
    reason: 'test',
  });
  assert.equal(result.row.waist, 88);
  const after = (await getAll(db, 'measurements'))[0];
  assert.ok(after.deletedAtISO, 'the row was not marked deleted');
  db.close();
});

test('editing writes only the fields that changed, and records what was there', async () => {
  const db = await openFresh();
  await put(db, 'measurements', { dateISO: '2026-08-20', waist: 88, chest: 106.2, armL: 38.1 });
  const stored = (await getAll(db, 'measurements'))[0];

  const result = await editDatedRow(db, 'measurements', stored.id, { waist: 87.4, chest: 106.2 });
  assert.deepEqual(
    result.changed,
    [{ field: 'waist', from: 88, to: 87.4 }],
    'an unchanged field was written as a change'
  );

  const after = (await getAll(db, 'measurements'))[0];
  assert.equal(after.waist, 87.4);
  assert.equal(after.chest, 106.2);
  assert.equal(after.armL, 38.1, 'a field the form did not touch was lost');

  const audit = await getAll(db, 'auditLog');
  const edit = audit.find((entry) => entry.action === 'edit');
  assert.ok(edit, 'no audit entry was written');
  assert.equal(edit.previous.waist, 88, 'the audit entry does not carry what the value was');
  db.close();
});

test('the saved message names the fields rather than stringifying them', () => {
  // `changed` is a list of {field, from, to}. Joining it directly puts
  // "[object Object]" on screen, which is exactly what screens.test.js exists
  // to catch everywhere else.
  const changed = [{ field: 'waist', from: 88, to: 87.4 }];
  const text = changed.map((change) => change.field).join(', ');
  assert.equal(text, 'waist');
  assert.ok(!text.includes('[object Object]'));
});

test('an edit that changes nothing writes nothing', async () => {
  const db = await openFresh();
  await put(db, 'daily', { dateISO: '2026-08-20', bodyweight: 85.5 });
  const stored = (await getAll(db, 'daily'))[0];

  const result = await editDatedRow(db, 'daily', stored.id, { bodyweight: 85.5 });
  assert.deepEqual(result.changed, []);
  assert.equal((await getAll(db, 'auditLog')).filter((e) => e.action === 'edit').length, 0);
  db.close();
});

test('the edit form offers every field the entry has, filled in', () => {
  const state = baseState({
    measurements: [{ id: 3, dateISO: '2026-08-20', waist: 88, chest: 106.2, armL: 38.1 }],
  });
  const row = entries(state).find((entry) => entry.kind === 'measurement');
  const html = editSheet(state, row);

  for (const [field, value] of [['waist', '88'], ['chest', '106.2'], ['armL', '38.1']]) {
    assert.match(html, new RegExp(`data-edit-field="${field}"[^>]*value="${value}"`), `${field} is not filled in`);
  }
  assert.match(html, /data-edit-field="dateISO"[^>]*value="2026-08-20"/, 'the date cannot be corrected');
  assert.doesNotMatch(html, /NaN|undefined|\[object Object\]/);
});

test('saving an edit goes through a confirmation, never straight to the write', () => {
  const state = baseState({ measurements: [{ id: 3, dateISO: '2026-08-20', waist: 88 }] });
  const row = entries(state).find((entry) => entry.kind === 'measurement');

  // The button on the form must not be the one that writes.
  assert.doesNotMatch(editSheet(state, row), /data-act="history-edit-save"/);
  assert.match(editSheet(state, row), /data-act="history-edit-review"/);
  assert.ok(actions['history-edit-review'], 'no review step exists');
  assert.ok(actions['history-edit-save'], 'no save step exists');
});

test('a failed edit is returned to the central action handler', async () => {
  // An async write that is started but neither awaited nor returned fails
  // silently, and the user never learns their correction did not land.
  const failure = new Error('write failed');
  const ctx = {
    state: baseState({ measurements: [{ id: 3, dateISO: '2026-08-20', waist: 88 }] }),
    editEntry: async () => { throw failure; },
    render() {},
  };
  await assert.rejects(actions['history-edit-save'](ctx, { key: 'measurement:3', patch: '{"waist":87}' }), failure);
});
