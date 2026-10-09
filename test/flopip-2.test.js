/**
 * FLOPIP 2 — the five-day plan — and the second-plan machinery under it.
 *
 * What these guard, in the order they would cost him:
 *
 *   The plan says what was agreed: five workouts in the order A (Saturday) to E
 *   (Friday), bench three days a week and never two days running, the AMRAP
 *   every second week and never in a test week, a paused max test after each
 *   taper, nothing pressing to failure on Wednesday.
 *
 *   Two plans letter their sessions from A, so nothing about one may leak into
 *   the other — History names, rotation progress, cycle ids.
 *
 *   Every screen renders under the new plan without arithmetic leaking into it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { validatePlan, resolveSession, toDisplaySession, isAmrapRotation, blockFor } from '../js/plan.js';
import { newCycle, cycleProgress, blockBoundary } from '../js/cycle.js';
import { weeklyVolume } from '../js/volume.js';
import {
  DEFAULT_PLAN_ID,
  PLAN_FILES,
  planIdOf,
  belongsTo,
  cycleSettingKeys,
  withSharedLibrary,
  sessionForLog,
} from '../js/plans.js';
import * as trainScreen from '../js/ui/train.js';
import * as progressScreen from '../js/ui/progress.js';
import * as planScreen from '../js/ui/plan.js';
import * as bodyScreen from '../js/ui/body.js';
import * as historyScreen from '../js/ui/history.js';
import * as settingsScreen from '../js/ui/settings.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const [V2, FLOPIP] = withSharedLibrary([load('data/plan-fopip-v2.json'), load('data/plan-flopip-2.json')]);
const RAW = load('data/plan-flopip-2.json');

const sessionAt = (rotation, sessionId, readiness = 'normal') =>
  toDisplaySession(resolveSession(FLOPIP, { rotation, sessionId, readiness }));
const slotAt = (rotation, sessionId, slotId) => sessionAt(rotation, sessionId).slots.find((s) => s.id === slotId);

/* ═══════════════════════════════════════════════════════════════════════
   The plan file
   ═══════════════════════════════════════════════════════════════════════ */

test('the plan validates: every rotation of every session resolves to real work', () => {
  const report = validatePlan(RAW);
  assert.deepEqual(report.problems, []);
  assert.equal(RAW.meta.id, 'flopip-2');
  assert.equal(RAW.meta.name, 'FLOPIP 2');
});

test('A is Saturday and the heavy-bench Friday is the last of five, in that order', () => {
  assert.deepEqual(RAW.meta.rotationOrder, ['A', 'B', 'C', 'D', 'E']);
  const byId = Object.fromEntries(RAW.sessions.map((s) => [s.id, s]));
  assert.match(byId.A.day, /Saturday/);
  assert.match(byId.B.day, /Sunday/);
  assert.match(byId.C.day, /Monday or Tuesday/);
  assert.match(byId.D.day, /Wednesday/);
  assert.match(byId.E.day, /Friday/);
  for (const session of RAW.sessions) {
    assert.ok(session.trains && session.purpose, `${session.id} says what it trains and why`);
  }
});

test('bench is three days a week and never on two days running, whichever rest days you take', () => {
  const benchDays = new Set(
    RAW.sessions.filter((s) => s.slots.some((slot) => slot.ex.startsWith('bench'))).map((s) => s.id)
  );
  assert.deepEqual([...benchDays].sort(), ['B', 'D', 'E']);

  for (const option of RAW.meta.restDays.options) {
    // The week is listed Friday first; check every neighbouring pair, wrapping round.
    const letters = option.week.map((day) => (day.startsWith('rest') ? null : day[0]));
    for (let i = 0; i < letters.length; i += 1) {
      const a = letters[i];
      const b = letters[(i + 1) % letters.length];
      assert.ok(!(benchDays.has(a) && benchDays.has(b)), `${option.label}: ${a} and ${b} are both bench days, back to back`);
    }
    assert.equal(option.week[option.week.length - 1], 'rest Thu', `${option.label}: Thursday rest before Friday`);
    assert.equal(option.week[0], 'E Fri', `${option.label}: the heavy bench is on Friday`);
  }
});

test('the AMRAP runs every second Friday — never in a test week or the week after one', () => {
  const tests = RAW.blocks.filter((b) => b.type === 'test').map((b) => b.from);
  for (let rotation = 1; rotation <= RAW.meta.rotations; rotation += 1) {
    const e = sessionAt(rotation, 'E');
    const amrap = e.slots.find((s) => s.amrap);
    assert.equal(!!amrap, isAmrapRotation(RAW, rotation), `rotation ${rotation}`);
    if (tests.includes(rotation) || tests.includes(rotation - 1)) assert.ok(!amrap, `no AMRAP in or straight after test ${rotation}`);
    if (amrap) {
      assert.equal(amrap.fixedLoad, 100);
      assert.equal(amrap.sets, 1, 'one AMRAP set, not five');
    }
  }
  const amraps = RAW.meta.amrapRotations;
  for (let i = 1; i < amraps.length; i += 1) assert.ok(amraps[i] - amraps[i - 1] >= 2, 'never two weeks running');
});

test('an AMRAP week takes one set off the back-offs; other weeks run three', () => {
  assert.equal(slotAt(2, 'E', 'E3').sets, 2);
  assert.equal(slotAt(4, 'E', 'E3').sets, 3);
  assert.equal(slotAt(4, 'E', 'E3').pctBasis, 'topSingleRpe', 'back-offs come from the day’s single');
});

test('the Friday single is RPE 8 in volume blocks and RPE 9 in heavy blocks', () => {
  for (const block of RAW.blocks) {
    const single = slotAt(block.from, 'E', 'E1');
    if (block.type === 'accumulation') assert.equal(single.rpe, 8, block.name);
    if (block.type === 'intensification') assert.equal(single.rpe, 9, block.name);
  }
});

test('each test week tapers: a paused max on Friday, no back-offs, nothing to failure', () => {
  const tests = RAW.blocks.filter((b) => b.type === 'test');
  assert.deepEqual(tests.map((b) => b.from), [3, 14, 25]);
  for (const block of tests) {
    const e = sessionAt(block.from, 'E');
    const single = e.slots.find((s) => s.id === 'E1');
    assert.equal(single.role, 'attempt', 'the test single can be recorded as made or missed');
    assert.ok(!e.slots.some((s) => s.id === 'E3'), 'no back-offs on test day');
    for (const id of RAW.meta.rotationOrder) {
      for (const slot of sessionAt(block.from, id).slots) {
        assert.equal(slot.failLast, 0, `${block.name} ${id} ${slot.ex}: nothing to failure in a taper`);
        if (slot.role !== 'attempt') assert.ok(slot.rpe <= 8, `${block.name} ${id} ${slot.ex}: RPE ${slot.rpe}`);
      }
    }
    const full = sessionAt(block.from - 1, 'A').slots.reduce((n, s) => n + s.sets, 0);
    const taper = sessionAt(block.from, 'A').slots.reduce((n, s) => n + s.sets, 0);
    assert.ok(taper < full * 0.75, 'accessory volume really drops');
  }
});

test('Wednesday is 48 hours before the heavy bench: no pressing to failure, no triceps isolation', () => {
  for (let rotation = 1; rotation <= RAW.meta.rotations; rotation += 1) {
    for (const slot of sessionAt(rotation, 'D').slots) {
      const muscles = FLOPIP.exercises[slot.ex].m;
      const presses = (muscles.chestMid || 0) + (muscles.chestUpper || 0) + (muscles.triLat || 0) >= 1;
      if (presses) assert.equal(slot.failLast, 0, `rotation ${rotation}: ${slot.ex} goes to failure`);
      assert.ok(!['triOH', 'pushdown', 'skull'].includes(slot.ex), 'no triceps isolation on Wednesday');
    }
  }
});

test('the priorities get their volume: side delts, upper chest, arms, and enough back', () => {
  const sessions = RAW.meta.rotationOrder.map((id) => sessionAt(4, id));
  const { volume } = weeklyVolume(sessions, FLOPIP.exercises);
  assert.ok(volume.deltSide >= 18, `side delts ${volume.deltSide}`);
  assert.ok(volume.chestUpper >= 12, `upper chest ${volume.chestUpper}`);
  assert.ok(volume.lats >= 14, `lats ${volume.lats}`);
  assert.ok(volume.upperBack >= 14, `upper back ${volume.upperBack}`);
  assert.ok(volume.bicLong + volume.bicShort >= 22, 'biceps');
  assert.ok(volume.triLong >= 8 && volume.triLong <= 12, `long head ${volume.triLong}: kept moderate for the elbow`);
});

test('every option is a real exercise, and option A is the slot’s own', () => {
  for (const session of RAW.sessions) {
    for (const slot of session.slots) {
      if (!slot.options) continue;
      assert.equal(slot.options[0], slot.ex, `${slot.id}: option A is the default`);
      for (const id of slot.options) assert.ok(FLOPIP.exercises[id], `${slot.id}: ${id}`);
    }
  }
  const b2 = RAW.sessions.find((s) => s.id === 'B').slots.find((s) => s.id === 'B2');
  assert.deepEqual(b2.options, ['benchClose', 'benchPin'], 'close-grip or pin press is a choice on the card');
});

test('the generated document is current', async () => {
  const before = readFileSync(new URL('../docs/training-plan-flopip-2.md', import.meta.url), 'utf8');
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, [new URL('../dev/plan-doc-flopip.mjs', import.meta.url).pathname], {
    cwd: new URL('..', import.meta.url).pathname,
  });
  const after = readFileSync(new URL('../docs/training-plan-flopip-2.md', import.meta.url), 'utf8');
  assert.equal(after, before, 'docs/training-plan-flopip-2.md is stale — run node dev/plan-doc-flopip.mjs');
});

/* ═══════════════════════════════════════════════════════════════════════
   Two plans side by side
   ═══════════════════════════════════════════════════════════════════════ */

test('a record with no plan id belongs to the original plan', () => {
  assert.equal(DEFAULT_PLAN_ID, 'fopip-v2');
  assert.equal(planIdOf({}), 'fopip-v2');
  assert.equal(planIdOf({ planId: 'flopip-2' }), 'flopip-2');
  assert.ok(belongsTo({ sessionId: 'A' }, 'fopip-v2'));
  assert.ok(!belongsTo({ sessionId: 'A' }, 'flopip-2'));
  assert.deepEqual(PLAN_FILES.map((f) => f.id), ['fopip-v2', 'flopip-2']);
});

test('each plan keeps its own rotation pointer, and the original keeps its old keys', () => {
  assert.deepEqual(cycleSettingKeys('fopip-v2'), {
    sequence: 'cycleSequence',
    startedAtISO: 'cycleStartedAtISO',
    startedDate: 'cycleStartedDate',
  });
  assert.equal(cycleSettingKeys('flopip-2').sequence, 'cycleSequence@flopip-2');
});

test('two plans’ rotation 1 are two different cycles', () => {
  const old = newCycle(V2, { sequence: 1, startedAtISO: null, localStartDate: null });
  const fresh = newCycle(FLOPIP, { sequence: 1, startedAtISO: null, localStartDate: null });
  assert.equal(old.id, 'cycle-1-1', 'the original keeps the id shape already in databases');
  assert.notEqual(fresh.id, old.id);
  assert.equal(fresh.planId, 'flopip-2');
});

test('the same letter in another plan is another session in History', () => {
  const plans = { 'fopip-v2': V2, 'flopip-2': FLOPIP };
  assert.match(sessionForLog(plans, { sessionId: 'A' }).name, /Heavy bench/);
  assert.match(sessionForLog(plans, { sessionId: 'A', planId: 'flopip-2' }).name, /Lower body A/);
  assert.equal(sessionForLog(plans, { sessionId: 'X1' }).name, 'Custom workout 1');

  const state = { plans, plan: FLOPIP };
  assert.match(historyScreen.sessionTitle(state, { sessionId: 'A' }), /Heavy bench.*FOPIP/);
  assert.equal(historyScreen.sessionTitle(state, { sessionId: 'A', planId: 'flopip-2' }), 'A · Lower body A and back');
});

test('a rotation only counts sessions from its own plan', () => {
  const cycle = newCycle(FLOPIP, { sequence: 1, startedAtISO: '2026-10-10T08:00:00Z', localStartDate: '2026-10-10' });
  const old = { id: 1, cycleId: cycle.id, rotationPosition: 'A', status: 'complete' };
  const mine = { id: 2, cycleId: cycle.id, rotationPosition: 'A', status: 'complete', planId: 'flopip-2' };
  // app.js filters by plan before handing logs to the engine — pinned here and in shell.test.js.
  const progress = cycleProgress(FLOPIP, cycle, [old, mine].filter((log) => belongsTo(log, 'flopip-2')));
  assert.equal(progress.complete, 1);
  assert.deepEqual(progress.positions.find((p) => p.position === 'A').logs, [2]);
});

test('the shared library gives each plan every exercise, without overwriting its own', () => {
  assert.ok(FLOPIP.exercises.benchSpeed, 'old exercises still have names under the new plan');
  assert.ok(V2.exercises.shrug, 'new exercises have names if you switch back');
  assert.deepEqual(V2.exercises.benchComp, load('data/plan-fopip-v2.json').exercises.benchComp, 'own definitions win');
  assert.deepEqual(FLOPIP.exercises.ohpDB, RAW.exercises.ohpDB);
});

test('app.js scopes cycles and finished sessions to the active plan, and tags new sessions', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /\.filter\(\(cycle\) => belongsTo\(cycle, planId\)\)/);
  assert.match(app, /log\.endedAt && belongsTo\(log, planId\)/);
  assert.match(app, /planId: state\.plan\.meta\.id,/);
  assert.match(app, /async switchPlan\(planId\)/);
});

/* ═══════════════════════════════════════════════════════════════════════
   Every screen, under the new plan
   ═══════════════════════════════════════════════════════════════════════ */

function stateFor(sequence = 1, sessionId = 'A') {
  const cycle = newCycle(FLOPIP, { sequence, startedAtISO: null, localStartDate: null });
  const block = blockFor(FLOPIP, sequence);
  return {
    plan: FLOPIP,
    plans: { 'fopip-v2': V2, 'flopip-2': FLOPIP },
    activePlanId: 'flopip-2',
    logs: [{ id: 1, sessionId: 'A', dateISO: '2026-10-03', endedAt: '2026-10-03T12:00:00Z', cycleSequence: 7 }],
    sets: [],
    daily: [],
    measurements: [],
    niggles: [],
    media: [],
    cycles: [cycle],
    deleted: [],
    maxes: new Map([['benchComp', { exerciseId: 'benchComp', workingMax: 125, setAtISO: '2026-09-18T17:34:49Z' }]]),
    maxHistory: [],
    lastByExercise: new Map(),
    cycle,
    settings: { unit: 'kg', increment: 2.5, bodyweight: 90, barKg: 20 },
    storage: { persisted: true, supported: true, usage: 0, quota: 1_000_000 },
    integrity: { ok: true, problems: [], formatVersion: 3 },
    buildVersion: 'v2.28.0',
    updateVersion: null,
    demo: false,
    todayISO: '2026-10-10',
    shut: new Set(),
    bodyDraft: { dateISO: '2026-10-10' },
    historyFilter: 'all',
    progressLift: 'benchComp',
    cycleProgress: cycleProgress(FLOPIP, cycle, []),
    block: { idx: block.id, label: String(block.id), ...block },
    blockProgress: { blockDone: 0, sessionTarget: 5, readyForReview: false, daysElapsed: null, behind: false },
    planProgress: { calendarWeek: 1, pace: null, sessionsDone: 0, cyclesDone: 0, daysElapsed: null },
    position: { nextSessionId: 'A' },
    boundary: blockBoundary(FLOPIP, cycle),
    trainSessionId: sessionId,
    readiness: 'normal',
    deviations: { swaps: {}, extras: [], addedSets: {}, exerciseNotes: {}, phaseSwaps: {} },
    grips: {},
    loggedSets: new Map(),
    exOpen: new Set(Array.from({ length: 14 }, (_, i) => String(i))),
    cleared: new Set(),
    draft: { note: '', bodyweight: '', sessionRpe: '' },
  };
}

const clean = (html, where) => {
  assert.ok(html.length > 300, `${where}: rendered something`);
  for (const bad of [/NaN/, /undefined/, /\[object Object\]/, /Infinity/]) assert.doesNotMatch(html, bad, where);
};

for (const rotation of [1, 2, 3, 4, 11, 14, 25]) {
  for (const sessionId of ['A', 'B', 'C', 'D', 'E']) {
    for (const readiness of ['normal', 'yellow', 'red']) {
      test(`Train renders ${sessionId} in rotation ${rotation} on a ${readiness} day`, () => {
        const state = { ...stateFor(rotation, sessionId), readiness };
        clean(trainScreen.view({ state, render() {} }), `${sessionId} r${rotation} ${readiness}`);
      });
    }
  }
}

for (const [name, screen, key, ids] of [
  ['Plan', planScreen, 'planSection', ['overview', 'workouts', 'exercises', 'blocks', 'tips']],
  ['Progress', progressScreen, 'progressSection', ['summary', 'strength', 'body', 'volume']],
  ['Log', historyScreen, 'logSection', ['entries', 'backups', 'bin']],
  ['Body', bodyScreen, null, [null]],
  ['Settings', settingsScreen, null, [null]],
]) {
  for (const id of ids) {
    test(`${name}${id ? ` → ${id}` : ''} renders under FLOPIP 2`, () => {
      const state = { ...stateFor(4), ...(key ? { [key]: id } : {}) };
      clean(screen.view({ state, render() {} }), `${name} ${id}`);
    });
  }
}

test('the Plan overview shows the week and the three rest-day options', () => {
  const html = planScreen.view({ state: stateFor(1), render() {} });
  assert.match(html, /Your week/);
  assert.match(html, /Monday \+ Thursday/);
  assert.match(html, /Wednesday \+ Thursday/);
  assert.match(html, /all 5 sessions/);
  assert.doesNotMatch(html, /six sessions/);
});

test('Settings offers both plans and lists the working maxes with their source', () => {
  const html = settingsScreen.view({ state: stateFor(1), render() {} });
  assert.match(html, /Training plan/);
  assert.match(html, /data-act="pick-plan" data-id="fopip-v2"/);
  assert.match(html, /FLOPIP 2/);
  assert.match(html, /Working maxes/);
  assert.match(html, /set by you on 2026-09-18/, 'a max you set says so');
  assert.match(html, /plan’s starting estimate|from your competition bench/);
});

test('the Train header says which day the workout is for and what it trains', () => {
  const html = trainScreen.view({ state: stateFor(1, 'E'), render() {} });
  assert.match(html, /Friday, after the Thursday rest day/);
  assert.match(html, /Heavy bench/);
});
