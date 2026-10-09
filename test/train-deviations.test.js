/**
 * Changing a session while you train it: sets, swaps, options, and the loads
 * that follow from what you actually logged.
 *
 * Each test names the defect it prevents.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { withSharedLibrary } from '../js/plans.js';
import { newCycle } from '../js/cycle.js';
import { recentEvidenceMax } from '../js/analytics.js';
import { actions, slotsFor, rowValues, workingMaxInfo, CUSTOM_SESSION_ID } from '../js/ui/train.js';
import { maxRowsFor } from '../js/ui/settings.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const [V2, FLOPIP] = withSharedLibrary([load('data/plan-fopip-v2.json'), load('data/plan-flopip-2.json')]);

/** Just enough of a page for a sheet to open and close. */
function withFakeDocument(run) {
  const previous = globalThis.document;
  const node = () => ({ innerHTML: '', classList: { on: false, add() { this.on = true; }, remove() { this.on = false; }, contains() { return this.on; } } });
  const nodes = { pan: node(), sheet: node() };
  globalThis.document = { getElementById: (id) => nodes[id] || null, querySelector: () => null };
  return Promise.resolve(run(nodes)).finally(() => {
    globalThis.document = previous;
  });
}

function trainState(plan, sessionId, { sequence = 1, extras = [], maxes = [['benchComp', 125]] } = {}) {
  return {
    plan,
    cycle: newCycle(plan, { sequence, startedAtISO: null, localStartDate: null }),
    trainSessionId: sessionId,
    readiness: 'normal',
    deviations: { swaps: {}, extras, addedSets: {}, exerciseNotes: {}, phaseSwaps: {} },
    loggedSets: new Map(),
    exOpen: new Set(),
    cleared: new Set(),
    grips: {},
    settings: { unit: 'kg', increment: 2.5, bodyweight: 90 },
    maxes: new Map(maxes.map(([id, workingMax]) => [id, { exerciseId: id, workingMax }])),
    sets: [],
    logs: [],
    todayISO: '2026-10-10',
    lastByExercise: new Map(),
    activeLog: { id: 99 },
  };
}

const ctxFor = (state) => ({ state, saveDeviations: async () => {}, render() {} });

/* ═══════════════════════════════════════════════════════════════════════
   Sets on exercises you added
   ═══════════════════════════════════════════════════════════════════════ */

test('+ Set on an added exercise changes that exercise, even when the plan dropped a slot', async () => {
  // Rotation 1 Friday has no AMRAP: the resolved session is one slot shorter
  // than the session in the file. "+ Set" used to subtract the file's length
  // and land on the wrong exercise — or on nothing, and throw.
  const state = trainState(FLOPIP, 'E', {
    extras: [
      { ex: 'lateral', sets: 3, reps: 15, rpe: 10, added: true },
      { ex: 'shrug', sets: 2, reps: 12, rpe: 10, added: true },
    ],
  });
  const slots = slotsFor(state);
  const lateral = slots.findIndex((slot) => slot.added && slot.ex === 'lateral');
  assert.ok(lateral > 0);

  await actions['add-set'](ctxFor(state), { si: String(lateral) });
  assert.equal(state.deviations.extras[0].sets, 4);
  assert.equal(state.deviations.extras[1].sets, 2, 'the other added exercise is untouched');
  assert.equal(slotsFor(state)[lateral].sets, 4);

  await actions['remove-set'](ctxFor(state), { si: String(lateral) });
  await actions['remove-set'](ctxFor(state), { si: String(lateral) });
  assert.equal(state.deviations.extras[0].sets, 2);
});

test('− Set takes a set off a planned exercise, but never below one', async () => {
  const state = trainState(FLOPIP, 'A');
  const ctx = ctxFor(state);
  const i = slotsFor(state).findIndex((slot) => slot.id === 'A9');
  assert.equal(slotsFor(state)[i].sets, 3);
  await actions['remove-set'](ctx, { si: String(i) });
  assert.equal(slotsFor(state)[i].sets, 2);
  await actions['remove-set'](ctx, { si: String(i) });
  assert.equal(slotsFor(state)[i].sets, 1);
  await withFakeDocument(async (nodes) => {
    await actions['remove-set'](ctx, { si: String(i) });
    assert.match(nodes.pan.innerHTML, /One set is the minimum/);
  });
  assert.equal(slotsFor(state)[i].sets, 1);
  await actions['add-set'](ctx, { si: String(i) });
  assert.equal(slotsFor(state)[i].sets, 2);
});

test('− Set refuses to hide a set you have already logged', async () => {
  const state = trainState(FLOPIP, 'A');
  const i = slotsFor(state).findIndex((slot) => slot.id === 'A9');
  state.loggedSets.set(`${i}:2`, { load: 25, reps: 12 });
  await withFakeDocument(async (nodes) => {
    await actions['remove-set'](ctxFor(state), { si: String(i) });
    assert.match(nodes.pan.innerHTML, /Set 3 is logged/);
  });
  assert.equal(slotsFor(state)[i].sets, 3);
});

test('a saved custom workout takes swaps and extra sets like any session', async () => {
  // Swaps were read only on the plan path: swapping in Custom workout 1 changed
  // nothing on screen. And "+ Set" there indexed the extras list with a planned
  // slot's position and threw.
  const state = trainState(V2, 'X1');
  const ctx = ctxFor(state);
  await actions['add-set'](ctx, { si: '6' });
  assert.equal(slotsFor(state)[6].sets, 4);
  await withFakeDocument(() => actions['do-swap'](ctx, { si: '3', id: 'ohpMachine' }));
  assert.equal(slotsFor(state)[3].ex, 'ohpMachine');
  assert.equal(slotsFor(state)[3].swappedFrom, 'ohpDB');
});

test('the blank custom session adds and removes sets on what you added', async () => {
  const state = trainState(V2, CUSTOM_SESSION_ID, { extras: [{ ex: 'curlEZ', sets: 3, reps: 10, rpe: 9, added: true }] });
  await actions['add-set'](ctxFor(state), { si: '0' });
  assert.equal(state.deviations.extras[0].sets, 4);
  await withFakeDocument(() => actions['do-swap'](ctxFor(state), { si: '0', id: 'curlHammer' }));
  assert.equal(slotsFor(state)[0].ex, 'curlHammer', 'an added exercise can be swapped too');
});

/* ═══════════════════════════════════════════════════════════════════════
   Option A or B
   ═══════════════════════════════════════════════════════════════════════ */

test('picking option B swaps the slot; picking A again undoes it rather than stacking a swap', async () => {
  const state = trainState(FLOPIP, 'B');
  const i = slotsFor(state).findIndex((slot) => slot.id === 'B2');
  assert.deepEqual(slotsFor(state)[i].options, ['benchClose', 'benchPin']);

  await withFakeDocument(() => actions['pick-option'](ctxFor(state), { si: String(i), id: 'benchPin' }));
  assert.equal(slotsFor(state)[i].ex, 'benchPin');
  assert.equal(state.deviations.swaps[i], 'benchPin');

  await withFakeDocument(() => actions['pick-option'](ctxFor(state), { si: String(i), id: 'benchClose' }));
  assert.equal(slotsFor(state)[i].ex, 'benchClose');
  assert.equal(state.deviations.swaps[i], undefined);
});

test('the load follows the option you picked', async () => {
  const state = trainState(FLOPIP, 'B', { sequence: 4 });
  const i = slotsFor(state).findIndex((slot) => slot.id === 'B2');
  const closeGrip = rowValues(state, slotsFor(state)[i], i, 0).prescribed;
  await withFakeDocument(() => actions['pick-option'](ctxFor(state), { si: String(i), id: 'benchPin' }));
  const pin = rowValues(state, slotsFor(state)[i], i, 0).prescribed;
  assert.ok(closeGrip > pin, `close-grip ${closeGrip} vs pin press ${pin}: each from its own ratio`);
});

test('options are offered on the card where the plan has them', async () => {
  const { view } = await import('../js/ui/train.js');
  const state = {
    ...trainState(FLOPIP, 'B'),
    cycleProgress: { positions: [], finished: false, complete: 0 },
    position: { nextSessionId: 'B' },
    block: { name: 'Settle in' },
    cleared: new Set(),
    grips: {},
    draft: { note: '', bodyweight: '', sessionRpe: '' },
  };
  state.exOpen = new Set(['1']);
  const html = view({ state });
  assert.match(html, /data-act="pick-option"[^>]*data-id="benchPin"/);
  assert.match(html, /A · Close-grip bench press/);
  assert.match(html, /B · Pin press/);
  assert.match(html, /data-act="remove-set"/);
});

/* ═══════════════════════════════════════════════════════════════════════
   Loads from what you actually did
   ═══════════════════════════════════════════════════════════════════════ */

test('back-offs are worked out from the single logged today, not from the stored max', () => {
  // The plan promised this and the screen did not do it: a strong day and a
  // weak day got the same back-offs.
  const state = trainState(FLOPIP, 'E', { sequence: 4 });
  const slots = slotsFor(state);
  const b = slots.findIndex((slot) => slot.id === 'E3');
  const before = rowValues(state, slots[b], b, 0).prescribed;

  state.loggedSets.set('0:0', { exerciseId: 'benchComp', slotIndex: 0, setIndex: 0, load: 120, reps: 1, rpe: 8 });
  const strong = rowValues(state, slotsFor(state)[b], b, 0).prescribed;
  state.loggedSets.set('0:0', { exerciseId: 'benchComp', slotIndex: 0, setIndex: 0, load: 112.5, reps: 1, rpe: 9 });
  const weak = rowValues(state, slotsFor(state)[b], b, 0).prescribed;

  assert.ok(strong > before, `120 @ 8 is a 130 kg day: ${before} → ${strong}`);
  assert.ok(weak < before, `112.5 @ 9 is a 118 kg day: ${before} → ${weak}`);
});

test('only the first set of an AMRAP slot is an AMRAP', () => {
  // Five sets at 100 kg on one Friday were all stored as AMRAPs — 7, 5, 4, 4, 4 —
  // and the extra four were back-offs, not measurements.
  const state = trainState(FLOPIP, 'E', { sequence: 2 });
  const slots = slotsFor(state);
  const a = slots.findIndex((slot) => slot.amrap);
  assert.ok(a >= 0);
  return withFakeDocument(() => {
    actions['open-step']({ state }, { si: String(a), i: '0', field: 'reps' });
    assert.equal(state.sheetCtx.isAmrap, true);
    actions['open-step']({ state }, { si: String(a), i: '1', field: 'reps' });
    assert.equal(state.sheetCtx.isAmrap, false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   Where a working max comes from
   ═══════════════════════════════════════════════════════════════════════ */

const session = (id, dateISO) => ({ id, dateISO, localDate: dateISO });
const set = (logId, load, reps, rpe, extra = {}) => ({ sessionLogId: logId, exerciseId: 'inclineSmith', load, reps, rpe, ...extra });

test('a lift with no max of your own uses your recent sets, not the plan’s August seed', () => {
  // Incline Smith asked for 37.5 kg while he pressed 70 for eight: the seed
  // never moved because nothing ever confirmed a max for it.
  const state = trainState(V2, 'E', { maxes: [['benchComp', 125]] });
  assert.equal(workingMaxInfo(state, 'inclineSmith').source, 'seed');

  state.logs = [session(1, '2026-09-27'), session(2, '2026-10-04')];
  state.sets = [set(1, 70, 8, 10), set(2, 70, 8, 10)];
  const info = workingMaxInfo(state, 'inclineSmith');
  assert.equal(info.source, 'evidence');
  assert.ok(info.value > 85 && info.value < 92, `${info.value}`);
});

test('a max you set yourself always wins over the evidence', () => {
  const state = trainState(V2, 'E', { maxes: [['benchComp', 125], ['inclineSmith', 80]] });
  state.logs = [session(1, '2026-10-04')];
  state.sets = [set(1, 70, 8, 10)];
  assert.deepEqual(
    { value: workingMaxInfo(state, 'inclineSmith').value, source: workingMaxInfo(state, 'inclineSmith').source },
    { value: 80, source: 'confirmed' }
  );
});

test('bench variations follow the competition bench by their ratio', () => {
  const state = trainState(FLOPIP, 'D');
  const info = workingMaxInfo(state, 'benchPause');
  assert.equal(info.source, 'ratio');
  assert.equal(info.value, 125 * 0.94);
});

test('the evidence is the middle session, ignores form breakdowns, old sets and today’s session', () => {
  const logs = [session(1, '2026-08-01'), session(2, '2026-09-20'), session(3, '2026-09-27'), session(4, '2026-10-04'), session(5, '2026-10-10')];
  const sets = [
    set(1, 100, 8, 10), // too old
    set(2, 60, 8, 10),
    set(3, 70, 8, 10),
    set(4, 90, 8, 10, { formBreakdown: true }), // does not count
    set(4, 65, 8, 10),
    set(5, 95, 8, 10), // today, still open
  ];
  const result = recentEvidenceMax(sets, logs, 'inclineSmith', { todayISO: '2026-10-10', excludeLogId: 5 });
  assert.equal(result.sessions, 3);
  assert.equal(result.fromISO, '2026-09-20');
  const sixtyFive = recentEvidenceMax([set(4, 65, 8, 10)], logs, 'inclineSmith', { todayISO: '2026-10-10' }).value;
  assert.equal(result.value, sixtyFive, 'the median session, not the best one');
});

test('Settings lists the plan’s tracked lifts with the bench first', () => {
  const state = trainState(FLOPIP, 'A');
  const rows = maxRowsFor(state);
  assert.equal(rows[0].id, 'benchComp');
  assert.ok(rows.some((row) => row.id === 'ohpBarbell'));
  assert.ok(rows.some((row) => row.id === 'benchPin'), 'option B lifts are listed too');
  assert.ok(!rows.some((row) => row.id === 'lateral'), 'isolation lifts have no working max to set');
});
