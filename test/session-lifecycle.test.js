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
import { actions, slotsFor, resetSessionState } from '../js/ui/train.js';
import { stopRest } from '../js/ui/components.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const [V2, FLOPIP] = withSharedLibrary([load('data/plan-fopip-v2.json'), load('data/plan-flopip-2.json')]);
const APP = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

/** The body of one function or method in app.js, by its opening text. */
function appBody(opening) {
  const start = APP.indexOf(opening);
  assert.ok(start > -1, `app.js no longer has ${opening}`);
  const rest = APP.slice(start);
  const end = rest.search(/\n(\}|  \},?)\n/);
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

test('UI-03: a new civil date with no session open starts at normal readiness', () => {
  // An installed PWA resumes rather than reloads, so yesterday's red day was
  // still selected the next morning.
  const roll = appBody('async function rollOverIfNeeded()');
  assert.match(roll, /if \(!state\.activeLog\) state\.readiness = 'normal'/);
});
