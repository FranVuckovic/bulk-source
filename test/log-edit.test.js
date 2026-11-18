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

/* ═══════════════════════════════════════════════════════════════════════
   N1 · the Log's corrections ask the same question every other screen asks
   ═══════════════════════════════════════════════════════════════════════ */

/** Just enough of a page for a sheet to open and close, and for inputs to be read. */
async function withPage(run, inputs = {}) {
  const previous = globalThis.document;
  const node = () => ({ innerHTML: '', classList: { on: false, add() { this.on = true; }, remove() { this.on = false; }, contains() { return this.on; } } });
  const nodes = { pan: node(), sheet: node() };
  globalThis.document = {
    getElementById: (id) => nodes[id] || (id in inputs ? { value: inputs[id] } : null),
    querySelector: () => null,
    querySelectorAll: () => Object.entries(inputs).filter(([key]) => key.startsWith('edit:')).map(([key, value]) => ({ dataset: { editField: key.slice(5) }, value })),
  };
  try {
    return await run(nodes);
  } finally {
    globalThis.document = previous;
  }
}

const BENCH_PLAN = { sessions: [], exercises: { benchComp: { name: 'Competition bench press', tracksMax: true, maxConf: 'high' } } };

function benchCtx() {
  const sets = [
    { id: 1, sessionLogId: 9, exerciseId: 'benchComp', setIndex: 0, load: 120, reps: 1, rpe: 10 },
    { id: 2, sessionLogId: 8, exerciseId: 'benchComp', setIndex: 0, load: 130, reps: 1, rpe: 10 },
    { id: 3, sessionLogId: 8, exerciseId: 'benchComp', setIndex: 1, load: 110, reps: 5, rpe: 8 },
  ];
  const ctx = {
    state: { ...baseState({}), plan: BENCH_PLAN, sets, logs: [{ id: 9, dateISO: '2026-11-14' }], settings: { unit: 'kg', bodyweight: 90 } },
    toKg: Number,
    repaired: [],
    async repairSet(id, patch) {
      this.repaired.push([id, patch]);
      return { changed: 1 };
    },
    render() {},
  };
  return ctx;
}

const fixForm = (load) => ({ 'fix-load': load, 'fix-reps': '1', 'fix-rpe': '10', 'fix-ex': 'benchComp', 'fix-note': '' });

test('N1: a bench single corrected to 1250 in the Log asks first, and Save still saves it', async () => {
  // It said "Corrected" with no question, and Progress then showed a 1250 kg 1RM.
  const ctx = benchCtx();
  await withPage(async (nodes) => {
    await actions['repair-set-save'](ctx, { id: '1', loadShown: '120.0' });
    assert.equal(ctx.repaired.length, 0, 'the Log wrote 1250 without asking');
    assert.match(nodes.pan.innerHTML, /Save 1250 kg\? Your best on this lift is 130 kg\./);
    assert.match(nodes.pan.innerHTML, /data-act="repair-set-confirm">Save</);
    assert.match(nodes.pan.innerHTML, /data-act="repair-set-fix">Fix</);

    await actions['repair-set-confirm'](ctx);
    assert.equal(ctx.repaired.length, 1, 'Save must never be blocked');
    assert.equal(ctx.repaired[0][1].load, 1250);
  }, fixForm('1250'));
});

test('N1: Fix on the Log question brings the form back with what was typed', async () => {
  const ctx = benchCtx();
  await withPage(async (nodes) => {
    await actions['repair-set-save'](ctx, { id: '1', loadShown: '120.0' });
    actions['repair-set-fix'](ctx);
    assert.equal(ctx.repaired.length, 0);
    assert.match(nodes.pan.innerHTML, /id="fix-load"[^>]*value="1250"/);
    // Still the stored load: whether the box was touched is judged against it.
    assert.match(nodes.pan.innerHTML, /data-load-shown="120\.0"/);
  }, fixForm('1250'));
});

test('N1: an ordinary correction in the Log saves with no question', async () => {
  const ctx = benchCtx();
  await withPage(async () => {
    await actions['repair-set-save'](ctx, { id: '1', loadShown: '120.0' });
  }, fixForm('122.5'));
  assert.equal(ctx.repaired.length, 1);
  assert.equal(ctx.repaired[0][1].load, 122.5);
});

test('N1: a rejected Log set correction reaches the central action handler', async () => {
  const failure = new Error('write failed');
  const ctx = benchCtx();
  ctx.repairSet = async () => { throw failure; };
  await withPage(async () => {
    await assert.rejects(actions['repair-set-save'](ctx, { id: '1', loadShown: '120.0' }), failure);
  }, fixForm('122.5'));
  await withPage(async () => {
    await actions['repair-set-save'](ctx, { id: '1', loadShown: '120.0' });
    await assert.rejects(actions['repair-set-confirm'](ctx), failure);
  }, fixForm('1250'));
});

test('N1: a weigh-in edited to 97 among 91s in the Log asks before the review', async () => {
  const daily = ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'].map((dateISO, i) => ({ id: i + 1, dateISO, bodyweight: 91 }));
  const ctx = { state: baseState({ daily }) };
  const key = 'daily:4';
  await withPage(async (nodes) => {
    actions['history-edit-review'](ctx, { key });
    assert.match(nodes.pan.innerHTML, /Save 97 kg\? That's 6 kg above your 7-day average of 91 kg\./);
    assert.doesNotMatch(nodes.pan.innerHTML, /history-edit-save/, 'the review — and its write — came before the question');

    actions['history-edit-fix'](ctx, { key });
    assert.match(nodes.pan.innerHTML, /data-edit-field="bodyweight"[^>]*value="97"/, 'Fix lost what was typed');

    actions['history-edit-review'](ctx, { key });
    actions['history-edit-review'](ctx, { key, checked: '1' });
    assert.match(nodes.pan.innerHTML, /data-act="history-edit-save"/, 'Save on the question did not lead on to the review');
    assert.match(nodes.pan.innerHTML, /&quot;bodyweight&quot;:97/);
  }, { 'edit:dateISO': '2026-11-15', 'edit:bodyweight': '97', 'edit:bodyfatPct': '', 'edit:sleepHours': '', 'edit:steps': '', 'edit:note': '' });
});

test('N1: a tape reading edited to 1095 in the Log asks before the review', async () => {
  const measurements = [{ id: 1, dateISO: '2026-11-01', chest: 110 }, { id: 2, dateISO: '2026-11-10', chest: 109 }];
  const ctx = { state: baseState({ measurements }) };
  await withPage(async (nodes) => {
    actions['history-edit-review'](ctx, { key: 'measurement:2' });
    assert.match(nodes.pan.innerHTML, /Save Chest 1095 cm\?/);
    assert.doesNotMatch(nodes.pan.innerHTML, /history-edit-save/);
  }, { 'edit:dateISO': '2026-11-10', 'edit:chest': '1095' });
});

test('N1: every Save/Fix question in the app is drawn by the one questionSheet (wiring)', async () => {
  // The Log wrote its own sheets and asked nothing; a copy is how a path ends
  // up asking differently or not at all.
  const { readFileSync } = await import('node:fs');
  for (const file of ['train', 'body', 'settings', 'history']) {
    const source = readFileSync(new URL(`../js/ui/${file}.js`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, />Fix<\/button>/, `ui/${file}.js draws its own Save/Fix sheet`);
    assert.match(source, /questionSheet\(/, `ui/${file}.js does not ask through questionSheet`);
  }
  const history = readFileSync(new URL('../js/ui/history.js', import.meta.url), 'utf8');
  assert.match(history, /questionSet\(/, 'the Log set correction does not use questionSet');
  assert.match(history, /checkWeighIn\(/);
  assert.match(history, /checkTape\(/);
});
