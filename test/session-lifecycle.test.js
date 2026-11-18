/**
 * The session lifecycle and set logging: starting, logging, editing,
 * discarding and finishing a session on the Train screen.
 *
 * Every test names the defect it prevents. Where the behaviour lives in
 * `app.js`, which cannot be imported without a browser, the test drives the
 * pure helper the app calls and then checks that the app really calls it —
 * the "written, tested and not called" shape `shell.test.js` exists for.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { withSharedLibrary } from '../js/plans.js';
import { newCycle, cycleProgress } from '../js/cycle.js';
import {
  actions,
  inputs,
  slotsFor,
  resetSessionState,
  defaultPause,
  setStamps,
  keepStepDraft,
  loggedSetsFor,
} from '../js/ui/train.js';
import { stopRest } from '../js/ui/components.js';
import { createFakeEnv } from './helpers/fake-indexeddb.js';
import { openDatabase, getAll, putSetIdempotent, logicalSetKey } from '../js/db.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const [V2, FLOPIP] = withSharedLibrary([load('data/plan-fopip-v2.json'), load('data/plan-flopip-2.json')]);
const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

/** The body of one function or method in app.js, by its opening text. */
function appBody(opening) {
  const start = APP.indexOf(opening);
  assert.ok(start > -1, `app.js no longer has ${opening}`);
  const rest = APP.slice(start);
  // A top-level function ends at a closing brace in column 0; a method of
  // `ctx` or `globalActions` at "  }," — inner blocks are indented further.
  const end = rest.search(/function /.test(opening) ? /\n\}\n/ : /\n  \},\n/);
  return rest.slice(0, end === -1 ? undefined : end);
}

/** Just enough of a page for a sheet to open and close, and to read what it says. */
function withFakeDocument(run) {
  const previous = globalThis.document;
  const node = () => ({
    innerHTML: '',
    classList: { on: false, add() { this.on = true; }, remove() { this.on = false; }, contains() { return this.on; } },
  });
  const nodes = { pan: node(), sheet: node() };
  globalThis.document = { getElementById: (id) => nodes[id] || null, querySelector: () => null };
  return Promise.resolve(run(nodes)).finally(() => {
    stopRest();
    globalThis.document = previous;
  });
}

function trainState(plan, sessionId, { sequence = 1, extras = [], maxes = [['benchComp', 125]], activeLog = { id: 99 } } = {}) {
  const cycle = newCycle(plan, { sequence, startedAtISO: null, localStartDate: null });
  return {
    plan,
    cycle,
    cycleProgress: cycleProgress(plan, cycle, []),
    position: { nextSessionId: plan.meta.rotationOrder[0] },
    trainSessionId: sessionId,
    readiness: 'normal',
    deviations: { swaps: {}, extras, addedSets: {}, exerciseNotes: {}, phaseSwaps: {} },
    loggedSets: new Map(),
    exOpen: new Set(),
    cleared: new Set(),
    grips: {},
    swapConfirmed: new Set(),
    draft: { note: '', bodyweight: '', sessionRpe: '' },
    settings: { unit: 'kg', increment: 2.5, bodyweight: 90 },
    maxes: new Map(maxes.map(([id, workingMax]) => [id, { exerciseId: id, workingMax }])),
    sets: [],
    logs: [],
    cycles: [cycle],
    todayISO: '2026-10-10',
    lastByExercise: new Map(),
    activeLog,
  };
}

/** A ctx whose saveSet records what it was asked to store, and stores it. */
function recordingCtx(state) {
  const saved = [];
  let nextId = 1000;
  const ctx = {
    state,
    saved,
    render() {},
    saveDeviations: async () => {},
    async saveSet(slotIndex, setIndex, values) {
      const set = { id: nextId++, slotIndex, setIndex, exerciseId: slotsFor(state)[slotIndex].ex, ...values };
      saved.push(set);
      state.loggedSets.set(`${slotIndex}:${setIndex}`, set);
      return { set, beaten: null };
    },
    async removeSet(slotIndex, setIndex) {
      state.loggedSets.delete(`${slotIndex}:${setIndex}`);
    },
    celebrate() {},
  };
  return ctx;
}

const lastTimeFor = (exerciseId, sets) => [
  exerciseId,
  { dateISO: '2026-10-03', logId: 1, sessionId: 'C', planId: 'fopip-v2', sets },
];

/* ═══════════════════════════════════════════════════════════════════════
   UI-01 · "Same as last time"
   ═══════════════════════════════════════════════════════════════════════ */

test('UI-01: "same as last time" never overwrites a set you logged by hand', async () => {
  // It looped over every row and saved each one, so a set typed in by hand was
  // replaced with last week's numbers.
  const state = trainState(V2, 'C', { sequence: 2 });
  const slotIndex = slotsFor(state).findIndex((slot) => slot.ex === 'dip');
  state.lastByExercise = new Map([
    lastTimeFor('dip', [
      { load: 20, reps: 8, rpe: 8, setIndex: 0 },
      { load: 20, reps: 8, rpe: 8, setIndex: 1 },
      { load: 20, reps: 7, rpe: 9, setIndex: 2 },
    ]),
  ]);
  state.loggedSets.set(`${slotIndex}:0`, { id: 1, load: 25, reps: 6, rpe: 9 });

  await withFakeDocument(async () => {
    const ctx = recordingCtx(state);
    await actions['same-as-last'](ctx, { si: String(slotIndex) });
    assert.deepEqual(ctx.saved.map((set) => set.setIndex), [1, 2], 'only the unlogged rows are filled');
    assert.equal(state.loggedSets.get(`${slotIndex}:0`).load, 25, 'the hand-logged set is untouched');
  });
});

test('UI-01: "same as last time" never fabricates an AMRAP or an attempt result', async () => {
  // Rotation 2 session C: slot 0 is the weekly attempt, slot 1 the AMRAP. The
  // reps of an AMRAP and the outcome of an attempt are the measurement; copying
  // last week's is inventing this week's.
  const state = trainState(V2, 'C', { sequence: 2 });
  const slots = slotsFor(state);
  const amrap = slots.findIndex((slot) => slot.amrap);
  const attempt = slots.findIndex((slot) => slot.role === 'attempt');
  assert.ok(amrap > -1 && attempt > -1);
  state.lastByExercise = new Map([lastTimeFor('benchComp', [{ load: 100, reps: 7, rpe: 10, setIndex: 0 }])]);

  await withFakeDocument(async () => {
    const ctx = recordingCtx(state);
    await actions['same-as-last'](ctx, { si: String(amrap) });
    await actions['same-as-last'](ctx, { si: String(attempt) });
    assert.equal(ctx.saved.length, 0, 'an AMRAP or attempt row was filled from last time');
  });
});

test('UI-01: "same as last time" stores the grip and pause the row shows, like a tick', async () => {
  // A tick stored the displayed grip and pause; this path stored null for both,
  // so the same set had different fields depending on which button logged it.
  const state = trainState(FLOPIP, 'E', { sequence: 4 });
  const slotIndex = slotsFor(state).findIndex((slot) => slot.role === 'backoff');
  state.lastByExercise = new Map([lastTimeFor('benchComp', [{ load: 100, reps: 5, rpe: 8, setIndex: 0 }])]);

  await withFakeDocument(async () => {
    const ctx = recordingCtx(state);
    await actions['same-as-last'](ctx, { si: String(slotIndex) });
    assert.equal(ctx.saved.length, 3);
    for (const set of ctx.saved) {
      assert.equal(set.pauseStyle, 'paused');
      assert.equal(set.gripWidth, FLOPIP.exercises.benchComp.grips[0]);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   UI-02, UI-03 · One reset for everything a session leaves behind
   ═══════════════════════════════════════════════════════════════════════ */

test('UI-02: a discarded session leaves no swap, extra, grip, note or readiness behind', () => {
  // Discard nulled only the log and its sets. Swaps, extras and notes are keyed
  // by slot index, so the next session drew slot 2 as the discarded session's
  // swap, and the first tick stored the swapped exercise.
  const state = trainState(FLOPIP, 'A');
  state.deviations.swaps[2] = 'legPress';
  state.deviations.extras.push({ ex: 'lateral', sets: 3, reps: 15, rpe: 9, added: true });
  state.deviations.exerciseNotes['1'] = 'seat 4';
  state.grips['A-0'] = 'Inside rings (narrow)';
  state.draft = { note: 'bad day', bodyweight: '91', sessionRpe: '8' };
  state.readiness = 'yellow';
  state.swapConfirmed.add(2);
  state.cleared.add('3');
  state.loggedSets.set('0:0', { id: 1 });

  resetSessionState(state);
  state.trainSessionId = 'B';

  assert.equal(state.activeLog, null);
  assert.equal(state.loggedSets.size, 0);
  assert.deepEqual(state.deviations, { swaps: {}, extras: [], addedSets: {}, exerciseNotes: {}, phaseSwaps: {} });
  assert.deepEqual(state.grips, {});
  assert.deepEqual(state.draft, { note: '', bodyweight: '', sessionRpe: '' });
  assert.equal(state.swapConfirmed.size, 0);
  assert.equal(state.cleared.size, 0);
  const slots = slotsFor(state);
  assert.ok(slots.every((slot) => !slot.swappedFrom && !slot.added), 'B shows something the discarded A chose');
});

test('UI-03: readiness goes back to normal once a session is over', () => {
  // A yellow or red day carried into the next session: the set was trimmed and
  // the new log stamped yellow, until the app was cold-started.
  const state = trainState(FLOPIP, 'A');
  state.readiness = 'red';
  resetSessionState(state);
  assert.equal(state.readiness, 'normal');
});

test('UI-02/03: finish, discard, plan switch and erase all go through the one reset', () => {
  // Four hand-written reset lists had drifted apart; discard had almost none.
  assert.match(appBody('async function finishSession('), /resetSessionState\(state\)/);
  const del = appBody('async deleteEntry(kind, id');
  assert.match(del, /resetSessionState\(state\)/, 'discarding the open session does not reset it');
  assert.match(appBody('async switchPlan(planId)'), /resetSessionState\(state\)/);
  assert.match(appBody('async eraseEverything()'), /resetSessionState\(state\)/);
  // Discard goes through deleteEntry and must not set state on its own.
  const discard = appBody("async 'confirm-discard-session'");
  assert.match(discard, /deleteEntry\('session'/);
  assert.doesNotMatch(discard, /state\.deviations\s*=/);
});

/* ═══════════════════════════════════════════════════════════════════════
   UI-04 · Pause style and grip: one default, whichever way the set is logged
   ═══════════════════════════════════════════════════════════════════════ */

const slotOf = (plan, sessionId, sequence, predicate) => {
  const state = trainState(plan, sessionId, { sequence });
  return slotsFor(state).find(predicate);
};

test('UI-04: each plan gets the pause style its own text states for competition bench', () => {
  // The one-tap path stamped every bench* lift "paused" — pin press and speed
  // bench included — while FOPIP's own plan says its competition bench is
  // always touch-and-go. FLOPIP 2 says the opposite, slot by slot.
  const v2 = trainState(V2, 'A', { sequence: 2 });
  const fl = trainState(FLOPIP, 'E', { sequence: 4 });
  const flSlot = (pred) => slotsFor(fl).find(pred);

  assert.equal(defaultPause(fl, flSlot((s) => s.role === 'top_single')), 'paused');
  assert.equal(defaultPause(fl, flSlot((s) => s.role === 'backoff')), 'paused', 'a FLOPIP slot with no pause text');
  assert.equal(defaultPause(v2, slotOf(V2, 'A', 2, (s) => s.role === 'backoff')), 'touch-and-go');
  assert.equal(defaultPause(v2, slotOf(V2, 'E', 4, (s) => s.ex === 'benchComp')), 'touch-and-go');
  // FOPIP's AMRAP and attempt are paused by that plan's own statement.
  assert.equal(defaultPause(v2, slotOf(V2, 'C', 2, (s) => s.amrap)), 'paused');
  assert.equal(defaultPause(v2, slotOf(V2, 'C', 2, (s) => s.role === 'attempt')), 'paused');
});

test('UI-04: long-pause is paused, pin press and speed bench have no pause style', () => {
  const v2 = trainState(V2, 'A', { sequence: 4 });
  assert.equal(defaultPause(v2, slotOf(V2, 'E', 4, (s) => s.ex === 'benchPause')), 'paused');
  assert.equal(defaultPause(v2, slotOf(V2, 'C', 4, (s) => s.ex === 'benchPin')), null);
  assert.equal(defaultPause(v2, slotOf(V2, 'F', 4, (s) => s.ex === 'benchSpeed')), null);
  const fl = trainState(FLOPIP, 'D', { sequence: 4 });
  assert.equal(defaultPause(fl, slotsFor(fl).find((s) => s.ex === 'benchPause')), 'paused');
});

test('UI-04: a swapped slot does not inherit the planned lift\'s pause text', () => {
  // FLOPIP B1 is labelled "paused" and the label survives a swap. A pin press
  // swapped into it is still not a paused lift.
  const state = trainState(FLOPIP, 'B', { sequence: 4 });
  state.deviations.swaps[0] = 'benchPin';
  const slot = slotsFor(state)[0];
  assert.equal(slot.ex, 'benchPin');
  assert.equal(defaultPause(state, slot), null);
});

test('UI-04: the set editor stores the same pause and grip as a tick', async () => {
  // The editor — 95% of logged sets — opened with pause null and sent no grip,
  // so 147 of 153 competition-bench sets in the real log have neither.
  for (const [plan, sessionId, sequence, expected] of [
    [V2, 'A', 4, 'touch-and-go'],
    [FLOPIP, 'E', 4, 'paused'],
  ]) {
    const state = trainState(plan, sessionId, { sequence });
    const si = slotsFor(state).findIndex((s) => s.role === 'backoff');
    await withFakeDocument(async () => {
      const ctx = recordingCtx(state);
      await actions.tick(ctx, { si: String(si), i: '0' }, { stopPropagation() {} });
      actions['open-step'](ctx, { si: String(si), i: '1', field: 'reps' });
      await actions['save-step'](ctx);
      const [ticked, edited] = ctx.saved;
      assert.equal(ticked.pauseStyle, expected);
      assert.equal(edited.pauseStyle, expected, `${plan.meta.id}: the editor stored a different pause`);
      assert.equal(edited.gripWidth, plan.exercises.benchComp.grips[0], 'the editor stored no grip');
      assert.equal(edited.gripWidth, ticked.gripWidth);
    });
  }
});

test('UI-04: editing a logged set keeps the pause it was logged with', async () => {
  const state = trainState(FLOPIP, 'E', { sequence: 4 });
  const si = slotsFor(state).findIndex((s) => s.role === 'backoff');
  state.loggedSets.set(`${si}:0`, { id: 5, load: 100, reps: 5, rpe: 8, pauseStyle: 'touch-and-go', gripWidth: 'Index on rings (wide)' });
  await withFakeDocument(async () => {
    const ctx = recordingCtx(state);
    actions['open-step'](ctx, { si: String(si), i: '0', field: 'rpe' });
    assert.equal(state.sheetCtx.pauseStyle, 'touch-and-go');
    await actions['save-step'](ctx);
    assert.equal(ctx.saved[0].pauseStyle, 'touch-and-go');
    assert.equal(ctx.saved[0].gripWidth, 'Index on rings (wide)');
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   Tracking #1 · Editing a set does not move it in time
   ═══════════════════════════════════════════════════════════════════════ */

test('Tracking #1: an edit keeps the time the set was logged, and says when it was edited', () => {
  // saveSet re-stamped `timestampISO` on every save. Fixing an RPE at the end
  // of the session moved that set to the end, so "logged late" and "edited
  // late" could not be told apart and every duration and rest gap lied.
  const first = setStamps(null, '2026-11-17T17:00:00.000Z');
  assert.deepEqual(first, {
    timestampISO: '2026-11-17T17:00:00.000Z',
    editedAtISO: null,
    stamp: '2026-11-17T17:00:00.000Z',
  });
  const edit = setStamps({ timestampISO: '2026-11-17T17:00:00.000Z', editedAtISO: null }, '2026-11-17T19:10:00.000Z');
  assert.equal(edit.timestampISO, '2026-11-17T17:00:00.000Z');
  assert.equal(edit.editedAtISO, '2026-11-17T19:10:00.000Z');
  // The operation id is built from `stamp`. Built from the kept timestamp, an
  // edit would carry the original save's operation id, and the idempotency
  // check would return the old row and drop the edit.
  assert.notEqual(edit.stamp, first.stamp);
});

test('Tracking #1: an edited set reaches the database with its first timestamp', async () => {
  const env = createFakeEnv();
  const db = await openDatabase({ indexedDB: env.indexedDB, name: 'bulk' });
  const key = logicalSetKey(1, 0, 0);
  const base = { sessionLogId: 1, logicalKey: key, exerciseId: 'benchComp', slotIndex: 0, setIndex: 0 };

  const s1 = setStamps(null, '2026-11-17T17:00:00.000Z');
  const { set: one } = await putSetIdempotent(db, { ...base, load: 100, reps: 5, rpe: 8, ...s1, stamp: undefined }, {
    operationId: `${key}-${s1.stamp}`,
  });
  const s2 = setStamps(one, '2026-11-17T19:10:00.000Z');
  await putSetIdempotent(db, { ...base, id: one.id, load: 100, reps: 5, rpe: 9, ...s2, stamp: undefined }, {
    operationId: `${key}-${s2.stamp}`,
  });

  const [row] = await getAll(db, 'sets');
  assert.equal(row.rpe, 9, 'the edit was dropped');
  assert.equal(row.timestampISO, '2026-11-17T17:00:00.000Z');
  assert.equal(row.editedAtISO, '2026-11-17T19:10:00.000Z');
});

test('Tracking #1: saveSet stamps through setStamps and builds its operation id from the stamp', () => {
  const save = appBody('async function saveSet(');
  assert.match(save, /train\.setStamps\(existing, nowISO\(\)\)/);
  assert.doesNotMatch(save, /timestampISO: nowISO\(\)/, 'saveSet still re-stamps every save');
  assert.match(save, /operationId: values\.operationId \?\? `\$\{record\.logicalKey\}-\$\{stamps\.stamp\}`/);
});

/* ═══════════════════════════════════════════════════════════════════════
   UI-07 · The record celebration survives the set editor
   ═══════════════════════════════════════════════════════════════════════ */

test('UI-07: a record logged through the set editor is still celebrated', async () => {
  // saveSet opened the record sheet, and save-step closed "the sheet" straight
  // after — the record sheet. AMRAPs, attempts and every edited set go through
  // the editor, so a record there was never shown.
  const state = trainState(FLOPIP, 'E', { sequence: 4 });
  const si = slotsFor(state).findIndex((s) => s.role === 'top_single');
  await withFakeDocument(async (nodes) => {
    const events = [];
    const remove = nodes.sheet.classList.remove;
    nodes.sheet.classList.remove = function () { events.push('close'); return remove.call(this); };
    const ctx = recordingCtx(state);
    ctx.saveSet = async () => ({ set: { id: 1 }, beaten: { name: 'Competition bench press', value: 130, previous: 127, gain: 3 } });
    ctx.celebrate = (pr) => events.push(`celebrate ${pr.value}`);

    actions['open-step'](ctx, { si: String(si), i: '0', field: 'load' });
    await actions['save-step'](ctx);
    assert.deepEqual(events.slice(-2), ['close', 'celebrate 130'], 'the editor closed after the record sheet opened');
  });
});

test('UI-07: saveSet reports a record rather than opening the sheet itself', () => {
  const save = appBody('async function saveSet(');
  assert.doesNotMatch(save, /celebrate\(/, 'saveSet still opens the record sheet under whatever called it');
  assert.match(save, /return \{ set: written, beaten \}/);
  assert.match(APP, /\n  celebrate,\n/, 'ctx does not expose celebrate');
});

/* ═══════════════════════════════════════════════════════════════════════
   UI-08 / H4 · A weighted set is never logged without a load
   ═══════════════════════════════════════════════════════════════════════ */

const blankRowState = () => {
  // An exercise added today with no max and no history: the row shows "—".
  const state = trainState(FLOPIP, CUSTOM, {
    extras: [{ ex: 'ohpMachine', sets: 3, reps: 10, rpe: 8, added: true }],
  });
  return state;
};
const CUSTOM = 'custom';

test('UI-08: one tap on a row with no load opens the editor on the load', async () => {
  // ✓ saved `load: null` with the slot's reps and RPE: a logged set with no
  // tonnage and no estimate.
  const state = blankRowState();
  await withFakeDocument(async () => {
    const ctx = recordingCtx(state);
    await actions.tick(ctx, { si: '0', i: '0' }, { stopPropagation() {} });
    assert.equal(ctx.saved.length, 0, 'a weighted set was logged with no load');
    assert.equal(state.sheetCtx?.kind, 'step');
    assert.equal(state.sheetCtx.field, 'load');
  });
});

test('H4: the editor shows a blank load as blank, and will not log it as 0 kg', async () => {
  // The editor's load box read 0 for a row showing "—", and changing only the
  // reps logged 0 kg. Tick and editor now agree: no load, no weighted set.
  const state = blankRowState();
  await withFakeDocument(async (nodes) => {
    const ctx = recordingCtx(state);
    actions['open-step'](ctx, { si: '0', i: '0', field: 'reps' });
    assert.equal(state.sheetCtx.load, null);
    assert.match(nodes.pan.innerHTML, /id="in-load"[^>]*value=""/, 'the load box is not empty');
    await actions['save-step'](ctx);
    assert.equal(ctx.saved.length, 0, 'a blank load was saved');
    assert.match(nodes.pan.innerHTML, /Enter the load/);
    assert.ok(nodes.sheet.classList.contains(), 'the editor closed and lost the set');
  });
});

test('UI-08: a bodyweight lift still logs as bodyweight with nothing added', async () => {
  // Zero added is a real pull-up. Only weighted lifts need a load.
  const state = trainState(FLOPIP, CUSTOM, { extras: [{ ex: 'pullupNorm', sets: 3, reps: 8, rpe: 8, added: true }] });
  // "Clear prescribed" is the other way a row ends up with no load.
  state.cleared.add('0');
  await withFakeDocument(async () => {
    const ctx = recordingCtx(state);
    actions['open-step'](ctx, { si: '0', i: '0', field: 'reps' });
    assert.equal(state.sheetCtx.load, 0);
    await actions['save-step'](ctx);
    assert.equal(ctx.saved[0].load, 0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   UI-26 · A stray tap does not throw away a half-edited set
   ═══════════════════════════════════════════════════════════════════════ */

test('UI-26: closing the editor by the backdrop keeps what you typed for that set', async () => {
  // With the keyboard up, the strip above the editor is the backdrop. One stray
  // tap closed it and the typed load, reps, RPE and note were gone.
  const state = trainState(FLOPIP, 'B', { sequence: 4 });
  await withFakeDocument(async () => {
    const ctx = recordingCtx(state);
    actions['open-step'](ctx, { si: '0', i: '1', field: 'load' });
    inputs['field-load'](ctx, '102.5');
    inputs['field-reps'](ctx, '7');
    inputs.note(ctx, 'grip slipped');

    keepStepDraft(state); // what any close does, before the sheet goes
    state.sheetCtx = null;

    actions['open-step'](ctx, { si: '0', i: '2', field: 'load' });
    assert.notEqual(state.sheetCtx.load, 102.5, 'another set opened with this one\'s draft');
    keepStepDraft(state);

    actions['open-step'](ctx, { si: '0', i: '1', field: 'load' });
    assert.equal(state.sheetCtx.load, 102.5);
    assert.equal(state.sheetCtx.reps, 7);
    assert.equal(state.sheetCtx.note, 'grip slipped');
  });
});

test('UI-26: Cancel and a saved set both end the draft', async () => {
  const state = trainState(FLOPIP, 'B', { sequence: 4 });
  await withFakeDocument(async () => {
    const ctx = recordingCtx(state);
    actions['open-step'](ctx, { si: '0', i: '0', field: 'load' });
    inputs['field-load'](ctx, '102.5');
    actions['step-cancel'](ctx);
    actions['open-step'](ctx, { si: '0', i: '0', field: 'load' });
    assert.notEqual(state.sheetCtx.load, 102.5, 'Cancel kept the draft');

    inputs['field-load'](ctx, '97.5');
    await actions['save-step'](ctx);
    keepStepDraft(state); // the close that follows a save must not stash it
    assert.equal(state.stepDrafts?.['0:0'], undefined);
  });
});

test('UI-26: every way a sheet closes keeps the editor draft, and Cancel is its own action', () => {
  assert.match(appBody('function onSheetClose('), /train\.keepStepDraft\(state\)/);
  const train = readFileSync(new URL('../js/ui/train.js', import.meta.url), 'utf8');
  const sheet = train.slice(train.indexOf('function drawStepSheet('), train.indexOf('function stepReadout('));
  assert.match(sheet, /data-act="step-cancel">Cancel</);
});

/* ═══════════════════════════════════════════════════════════════════════
   UI-05 · A change made in the Log reaches the open session's Train screen
   ═══════════════════════════════════════════════════════════════════════ */

test('UI-05: the open session\'s logged sets are rebuilt from what is stored', () => {
  const sets = [
    { id: 1, sessionLogId: 7, slotIndex: 0, setIndex: 0, load: 100 },
    { id: 2, sessionLogId: 7, slotIndex: 0, setIndex: 1, load: 100 },
    { id: 3, sessionLogId: 6, slotIndex: 0, setIndex: 0, load: 90 },
  ];
  const logged = loggedSetsFor(sets, 7);
  assert.deepEqual([...logged.keys()], ['0:0', '0:1']);
  assert.equal(logged.get('0:1').id, 2);
});

test('UI-05: correcting, deleting or restoring in the Log rebuilds the open session', () => {
  // Each reloaded the stores and left `state.loggedSets` alone. A set deleted
  // in the Log stayed ticked on Train; one restored from the bin stayed
  // unticked, and Finish counted from the stale map and could mark the
  // session partial. Moving the open session to another rotation was undone
  // by the next draft save, which wrote back the stale in-memory log.
  for (const opening of [
    'async repairSet(setId, patch)',
    'async deleteSet(setId,',
    'async restoreEntry(store, rawKey)',
    'async moveSessionToCycle(logId, toSequence)',
  ]) {
    assert.match(appBody(opening), /rebuildActiveSession\(\)/, `${opening} leaves the Train screen stale`);
  }
  assert.match(appBody('async function restoreActiveSession('), /train\.loggedSetsFor\(state\.sets, active\.id\)/);
});

test('UI-03: a new civil date with no session open starts at normal readiness', () => {
  // An installed PWA resumes rather than reloads, so yesterday's red day was
  // still selected the next morning.
  const roll = appBody('async function rollOverIfNeeded()');
  assert.match(roll, /if \(!state\.activeLog\) state\.readiness = 'normal'/);
});
