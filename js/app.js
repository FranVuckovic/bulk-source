/**
 * app.js — bootstrap, state, routing and every write to the database.
 *
 * The screens are pure-ish: they render from state and raise actions. Anything
 * that touches storage happens here, in one place, so there is exactly one path
 * a set can take from the screen into IndexedDB.
 */

import {
  openDatabase,
  readSettings,
  writeSetting,
  getAll,
  put,
  remove,
  saveSession,
  requestPersistentStorage,
  checkIntegrity,
} from './db.js';
import { rotationPosition, blockProgress, prescribedSetCount, isPartialSession, sortLogsByDate } from './progress.js';
import { escape, openSheet, closeSheet, stopRest, fromDisplay, toDisplay } from './ui/components.js';
import * as train from './ui/train.js';

const PLAN_URL = './data/plan-bulk-v1.json';
const TABS = { train: 'Bulk', body: 'Body', prog: 'Progress', plan: 'Plan', set: 'Settings' };

const state = {
  db: null,
  plan: null,
  settings: { unit: 'kg', increment: 2.5, bodyweight: 90 },
  storage: { supported: false, persisted: false },
  integrity: null,

  logs: [],
  sets: [],
  maxes: new Map(),
  lastByExercise: new Map(),

  tab: 'train',
  trainSessionId: null,
  position: { nextSessionId: null, sessionsDone: 0, lastSessionId: null },
  block: { idx: 0, label: '0', startedISO: null },
  blockProgress: { blockDone: 0, sessionTarget: 0, readyForReview: false },
  calibration: false,

  activeLog: null,
  loggedSets: new Map(),
  exOpen: new Set(['0']),
  cleared: new Set(),
  grips: {},
  deviations: { swaps: {}, extras: [], addedSets: {} },
  draft: { note: '', bodyweight: '', sessionRpe: '' },
  sheetCtx: null,
};

/* ═══════════════════════════════════════════════════════════════════════
   Loading
   ═══════════════════════════════════════════════════════════════════════ */

const todayISO = () => new Date().toISOString().slice(0, 10);
const nowISO = () => new Date().toISOString();

async function loadEverything() {
  state.logs = sortLogsByDate(await getAll(state.db, 'sessionLogs'));
  state.sets = await getAll(state.db, 'sets');
  state.maxes = new Map((await getAll(state.db, 'maxes')).map((m) => [m.exerciseId, m]));

  const finished = state.logs.filter((log) => log.endedAt);
  state.position = rotationPosition(finished, state.plan.meta.rotation);

  const blockIdx = Number((await readSettings(state.db)).blockIdx ?? 0);
  const blockStartedISO = (await readSettings(state.db)).blockStartedISO ?? state.plan.meta.startDateISO;
  const block = state.plan.blocks[blockIdx];
  state.block = { idx: blockIdx, label: block.n.split(' · ')[0], startedISO: blockStartedISO, ...block };
  state.blockProgress = blockProgress(
    finished,
    { id: blockIdx, sessionTarget: block.sessionTarget, startedISO: blockStartedISO, weeks: block.weeks },
    todayISO()
  );

  // Calibration only applies when there is genuinely nothing to prescribe from.
  // The shipped plan carries seed working maxes, so it stays off until a plan
  // without them is loaded.
  const hasAnyMax =
    state.maxes.size > 0 || Object.keys(state.plan.meta.seedWorkingMaxes || {}).length > 0;
  state.calibration = !hasAnyMax && finished.length < state.plan.meta.rotation.length;

  buildHistory();
}

/** Most recent previous sets per exercise — the prefill and the "last time" line. */
function buildHistory() {
  const byLog = new Map(state.logs.map((log) => [log.id, log]));
  const history = new Map();

  for (const set of state.sets) {
    if (state.activeLog && set.sessionLogId === state.activeLog.id) continue;
    const log = byLog.get(set.sessionLogId);
    if (!log) continue;
    const entry = history.get(set.exerciseId);
    if (!entry || log.dateISO > entry.dateISO) {
      history.set(set.exerciseId, { dateISO: log.dateISO, logId: log.id, sets: [set] });
    } else if (log.id === entry.logId) {
      entry.sets.push(set);
    }
  }

  for (const entry of history.values()) {
    entry.sets.sort((a, b) => (a.setIndex ?? 0) - (b.setIndex ?? 0));
    entry.note = entry.sets.map((s) => s.note).find(Boolean) || null;
  }
  state.lastByExercise = history;
}

/** Rebuilds the in-progress session from storage, so a reload loses nothing. */
async function restoreActiveSession() {
  const settings = await readSettings(state.db);
  const activeId = settings.activeSessionLogId ?? null;
  const active = activeId != null ? state.logs.find((log) => log.id === activeId) : null;

  if (!active) {
    state.activeLog = null;
    state.trainSessionId = state.trainSessionId || state.position.nextSessionId || state.plan.meta.rotation[0];
    return;
  }

  state.activeLog = active;
  state.trainSessionId = active.sessionId;
  state.deviations = active.deviations || { swaps: {}, extras: [], addedSets: {} };
  state.grips = active.grips || {};
  state.draft = {
    note: active.note || '',
    bodyweight: active.bodyweight == null ? '' : String(active.bodyweight),
    sessionRpe: active.sessionRpe == null ? '' : String(active.sessionRpe),
  };

  state.loggedSets = new Map(
    state.sets
      .filter((set) => set.sessionLogId === active.id)
      .map((set) => [`${set.slotIndex}:${set.setIndex}`, set])
  );
  for (const key of state.loggedSets.keys()) state.exOpen.add(key.split(':')[0]);
}

/* ═══════════════════════════════════════════════════════════════════════
   Writes
   ═══════════════════════════════════════════════════════════════════════ */

/** The session log is created by the first thing you actually do, not by looking. */
async function ensureActiveLog() {
  if (state.activeLog) return state.activeLog;

  const { sessionLogId } = await saveSession(
    state.db,
    {
      dateISO: todayISO(),
      startedAt: nowISO(),
      endedAt: null,
      sessionId: state.trainSessionId,
      blockId: state.block.idx,
      rotationIndex: state.plan.meta.rotation.indexOf(state.trainSessionId),
      bodyweight: null,
      sessionRpe: null,
      note: null,
      isPartial: false,
      deviations: state.deviations,
      grips: state.grips,
    },
    []
  );

  await writeSetting(state.db, 'activeSessionLogId', sessionLogId);
  state.logs = sortLogsByDate(await getAll(state.db, 'sessionLogs'));
  state.activeLog = state.logs.find((log) => log.id === sessionLogId);
  return state.activeLog;
}

async function saveSet(slotIndex, setIndex, values) {
  const log = await ensureActiveLog();
  const slot = train.slotsFor(state)[slotIndex];
  const key = `${slotIndex}:${setIndex}`;
  const existing = state.loggedSets.get(key);

  const record = {
    ...(existing ? { id: existing.id } : {}),
    sessionLogId: log.id,
    exerciseId: slot.ex,
    slotIndex,
    setIndex,
    load: values.load ?? null,
    reps: values.reps ?? null,
    rpe: values.rpe ?? null,
    rir: values.rpe == null ? null : Math.max(0, 10 - values.rpe),
    toFailure: !!values.toFailure,
    isAmrap: !!values.isAmrap,
    isIndexSet: !!slot.idx,
    isMyoRep: false,
    velocity: values.velocity ?? null,
    note: values.note ?? null,
    wasPrescribed: !!values.wasPrescribed,
    prescribedLoad: values.prescribedLoad ?? null,
    timestampISO: nowISO(),
    gripWidth: state.grips[`${state.trainSessionId}-${slotIndex}`] ?? null,
    // Stored per set: without it, a pull-up log stops being interpretable the
    // moment your bodyweight changes.
    bodyweightUsed: state.plan.exercises[slot.ex].bodyweightLoaded ? state.settings.bodyweight : null,
    variantUsed: slot.swappedFrom ? slot.ex : null,
    pauseStyle: values.pauseStyle ?? existing?.pauseStyle ?? null,
  };

  const id = await put(state.db, 'sets', record);
  state.loggedSets.set(key, { ...record, id });
  state.sets = await getAll(state.db, 'sets');
  render();
}

async function removeSet(slotIndex, setIndex) {
  const key = `${slotIndex}:${setIndex}`;
  const existing = state.loggedSets.get(key);
  if (existing) {
    await remove(state.db, 'sets', existing.id);
    state.loggedSets.delete(key);
    state.sets = await getAll(state.db, 'sets');
  }
  render();
}

/** Swaps, added exercises and grips belong to the session that used them. */
async function saveDeviations() {
  if (!state.activeLog) await ensureActiveLog();
  state.activeLog = { ...state.activeLog, deviations: state.deviations, grips: state.grips };
  await put(state.db, 'sessionLogs', state.activeLog);
}

async function persistDraft() {
  if (!state.activeLog) return;
  const unit = state.settings.unit;
  const bodyweight = parseFloat(state.draft.bodyweight);
  const sessionRpe = parseFloat(state.draft.sessionRpe);

  state.activeLog = {
    ...state.activeLog,
    note: state.draft.note || null,
    bodyweight: Number.isNaN(bodyweight) ? null : fromDisplay(bodyweight, unit),
    sessionRpe: Number.isNaN(sessionRpe) ? null : sessionRpe,
  };
  await put(state.db, 'sessionLogs', state.activeLog);
}

async function finishSession() {
  await persistDraft();
  const session = state.plan.sessions.find((s) => s.id === state.trainSessionId);
  const prescribed = prescribedSetCount({ slots: train.slotsFor(state) }) || prescribedSetCount(session);
  const logged = state.loggedSets.size;

  state.activeLog = {
    ...state.activeLog,
    endedAt: nowISO(),
    isPartial: isPartialSession(logged, prescribed),
  };
  await put(state.db, 'sessionLogs', state.activeLog);
  await writeSetting(state.db, 'activeSessionLogId', null);

  const finishedLog = state.activeLog;
  const minutes = Math.round(
    (Date.parse(finishedLog.endedAt) - Date.parse(finishedLog.startedAt)) / 60000
  );

  state.activeLog = null;
  state.loggedSets = new Map();
  state.cleared = new Set();
  state.grips = {};
  state.deviations = { swaps: {}, extras: [], addedSets: {} };
  state.draft = { note: '', bodyweight: '', sessionRpe: '' };
  state.exOpen = new Set(['0']);
  stopRest();

  await loadEverything();
  state.trainSessionId = state.position.nextSessionId;
  render();

  openSheet(`<div class="ttl">Session saved</div>
    <p style="text-align:center;margin:14px 0 4px;font-size:15px;color:var(--ink)"><b>${escape(session.id)} · ${escape(session.name)}</b></p>
    <p style="text-align:center;font-size:13px">${logged} of ${prescribed} sets${
      finishedLog.isPartial ? ' — logged as a partial session' : ''
    }${Number.isFinite(minutes) && minutes > 0 ? ` · ${minutes} min` : ''}</p>
    <p style="text-align:center;font-size:13px">Next in the rotation: <b>${escape(state.position.nextSessionId)}</b>${
      state.blockProgress.readyForReview
        ? '<br><br>You have reached this block’s session target. The block review opens from Progress — nothing advances on its own.'
        : ''
    }</p>
    <button class="big mt" data-act="sheet-close">Done</button>`);
}

/* ═══════════════════════════════════════════════════════════════════════
   Screens
   ═══════════════════════════════════════════════════════════════════════ */

const placeholder = (title, what) => `
  <h3 style="margin-top:4px">${escape(title)}</h3>
  <div class="card"><p style="margin:0">${escape(what)}</p></div>`;

function screenFor(tab) {
  if (tab === 'train') return train.view(ctx);
  if (tab === 'body') return placeholder('Body', 'Daily and weekly measurements arrive in the next stage.');
  if (tab === 'prog') return placeholder('Progress', 'Charts, flags and the working-max review arrive in the next stage.');
  if (tab === 'plan') return placeholder('Plan', 'Exercises, workouts and the knowledge base arrive in the next stage.');
  return settingsView();
}

function settingsView() {
  const storage = state.storage.persisted
    ? '<div class="flag f-ok"><i>✓</i><span><b>Persistent storage granted.</b> This app’s data will not be evicted to reclaim space.</span></div>'
    : `<div class="flag f-warn"><i>!</i><span><b>Persistent storage not granted.</b> ${
        state.storage.supported ? 'Install the app to the home screen and it is usually granted.' : 'This browser does not support it.'
      }</span></div>`;

  const integrity = state.integrity?.ok
    ? '<div class="flag f-ok"><i>✓</i><span><b>Database readable and consistent.</b></span></div>'
    : `<div class="flag f-bad"><i>!</i><span><b>Data integrity problem.</b> ${escape(
        (state.integrity?.problems || []).join('; ')
      )}</span></div>`;

  return `
  <button class="back" data-act="tab" data-tab="train">‹ Back</button>
  <h3 style="margin-top:0">Units</h3>
  <div class="card"><div class="seg">
    <button class="${state.settings.unit === 'kg' ? 'on' : ''}" data-act="unit" data-id="kg">Kilograms</button>
    <button class="${state.settings.unit === 'lb' ? 'on' : ''}" data-act="unit" data-id="lb">Pounds</button></div>
    <p class="hint">Changes every number in the app, everywhere, instantly. <b>Data is always stored in kg</b> — this is a display setting only, so switching back and forth can never corrupt anything or introduce rounding drift.</p>
    <div class="mt"><label for="inc">Load increment</label>
      <select id="inc" data-act-change="increment">
        ${[2.5, 1, 5]
          .map(
            (i) =>
              `<option value="${i}" ${state.settings.increment === i ? 'selected' : ''}>${i.toFixed(1)} kg${
                i === 2.5 ? ' (standard plates)' : i === 1 ? ' (micro-plates)' : ''
              }</option>`
          )
          .join('')}
      </select>
      <p class="hint">Prescribed loads round to this. The effective RPE after rounding is always shown.</p></div>

    <div class="mt"><label for="bw">Bodyweight for pull-ups and dips (${state.settings.unit})</label>
      <input id="bw" type="number" inputmode="decimal" step="0.5" value="${
        Math.round(toDisplay(state.settings.bodyweight, state.settings.unit) * 10) / 10
      }" data-act-change="bodyweight">
      <p class="hint">Pull-ups, chin-ups and dips lift your bodyweight plus whatever is on the belt, so this is part of every percentage, RPE and e1RM on those lifts. It is one deliberate number rather than the daily weigh-in — otherwise a 0.4 kg fluctuation would move every prescription.</p></div></div>

  <h3>Your data</h3>
  <div class="card">
    ${storage}
    ${integrity}
    <p class="hint">${state.logs.length} sessions · ${state.sets.length} sets</p>
    <p class="hint">Export, import and backup verification arrive with the export stage.</p>
  </div>

  <h3>Privacy &amp; permissions</h3>
  <div class="card">
    <div class="flag f-ok"><i>✓</i><span><b>No network access.</b> The app makes zero requests. It cannot phone home because there is nothing to phone.</span></div>
    <div class="flag f-ok"><i>✓</i><span><b>No account, no login, no analytics.</b> Your data never leaves the device unless you export it yourself.</span></div>
  </div>`;
}

function render() {
  document.getElementById('ttl').textContent = TABS[state.tab];
  document.getElementById('chip').textContent =
    state.tab === 'train'
      ? `Session ${state.trainSessionId}`
      : `Block ${state.block.label} · week ${Math.floor((state.blockProgress.daysElapsed ?? 0) / 7) + 1}`;
  document.getElementById('view').innerHTML = screenFor(state.tab);

  for (const key of ['train', 'body', 'prog', 'plan']) {
    document.getElementById(`n-${key === 'prog' ? 'prog' : key}`).classList.toggle('on', key === state.tab);
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   Actions
   ═══════════════════════════════════════════════════════════════════════ */

const ctx = {
  state,
  render,
  saveSet,
  removeSet,
  saveDeviations,
  finishSession,

  openSession(id) {
    if (state.activeLog && state.activeLog.sessionId !== id) {
      openSheet(`<div class="ttl">Session in progress</div>
        <p style="text-align:center;margin:14px 0 4px;font-size:14px;color:var(--ink)">You have <b>${state.loggedSets.size} sets</b> logged in session ${escape(
          state.activeLog.sessionId
        )}.</p>
        <p style="text-align:center;font-size:13px">Finish that session before starting another, or carry on where you left off.</p>
        <button class="big mt" data-act="sheet-close">Carry on</button>`);
      return;
    }
    state.trainSessionId = id;
    state.exOpen = new Set(['0']);
    state.cleared = new Set();
    render();
  },

  showExercise(id) {
    const x = state.plan.exercises[id];
    const muscles = Object.entries(x.m)
      .sort(([, a], [, b]) => b - a)
      .map(([m, w]) => `<span class="tag ${w >= 0.9 ? 'p' : ''}">${escape(state.plan.muscles[m].label)}${w < 1 ? ` (${w})` : ''}</span>`)
      .join('');

    openSheet(`<div class="ttl">${escape(x.name)}</div>
      <div style="margin-top:12px">${muscles || '<span class="tag">no counted stimulus</span>'}</div>
      <p style="margin-top:12px">${escape(x.why)}</p>
      <h3>How</h3><ul style="margin:0;padding-left:18px;font-size:13.5px;color:var(--ink2);line-height:1.6">${x.how
        .map((h) => `<li>${escape(h)}</li>`)
        .join('')}</ul>
      ${x.watch ? `<div class="cue mt">${escape(x.watch)}</div>` : ''}
      <h3>Substitutes</h3><p style="margin:0">${x.subs.map(escape).join(' · ')}</p>
      <h3>Rest</h3><p style="margin:0">${x.defaultRestSec} seconds${
        x.tracksMax ? ` · max confidence: ${x.maxConf === 'high' ? 'high' : 'indicative only'}` : ' · no stored max'
      }</p>
      <button class="big ghost mt" data-act="sheet-close">Close</button>`);
  },
};

const globalActions = {
  tab(_ctx, data) {
    state.tab = data.tab;
    closeSheet();
    render();
    window.scrollTo(0, 0);
  },
  settings() {
    state.tab = 'set';
    render();
    window.scrollTo(0, 0);
  },
  'sheet-close'() {
    closeSheet();
    render();
  },
  'rest-skip'() {
    stopRest();
  },
  async unit(_ctx, data) {
    state.settings.unit = data.id;
    await writeSetting(state.db, 'unit', data.id);
    render();
  },
};

const changeHandlers = {
  async bodyweight(value) {
    const parsed = parseFloat(value);
    if (Number.isNaN(parsed) || parsed <= 0) return;
    state.settings.bodyweight = fromDisplay(parsed, state.settings.unit);
    await writeSetting(state.db, 'bodyweight', state.settings.bodyweight);
    render();
  },
  async increment(value) {
    state.settings.increment = parseFloat(value);
    await writeSetting(state.db, 'increment', state.settings.increment);
    render();
  },
};

function showFailure(error) {
  console.error(error);
  openSheet(`<div class="ttl">That did not save</div>
    <p style="text-align:center;margin:14px 0 4px;font-size:14px;color:var(--ink)">${escape(error.message || String(error))}</p>
    <p style="text-align:center;font-size:13px">Nothing else has been changed. If this keeps happening, export your data from Settings before carrying on.</p>
    <button class="big mt" data-act="sheet-close">Close</button>`);
}

function wireEvents() {
  document.addEventListener('click', (event) => {
    const el = event.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    const handler = globalActions[act] || train.actions[act];
    if (!handler) return;

    // A write that fails has to say so. Silently doing nothing is the one
    // outcome that would let a session go unrecorded without anyone noticing.
    try {
      Promise.resolve(handler(ctx, el.dataset, event)).catch(showFailure);
    } catch (error) {
      showFailure(error);
    }
  });

  document.addEventListener('input', (event) => {
    const el = event.target;
    if (el.dataset.bind) {
      state.draft[el.dataset.bind] = el.value;
      persistDraft();
      return;
    }
    if (el.dataset.actInput) train.inputs[el.dataset.actInput]?.(ctx, el.value);
  });

  document.addEventListener('change', (event) => {
    const name = event.target.dataset.actChange;
    if (name) changeHandlers[name]?.(event.target.value);
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   Boot
   ═══════════════════════════════════════════════════════════════════════ */

async function boot() {
  if (location.protocol === 'file:') {
    throw new Error(
      'Bulk has to be served over http, not opened as a file — browsers block a page on file:// from loading the plan. Run "npm run serve" and open http://localhost:8123.'
    );
  }

  const response = await fetch(PLAN_URL);
  if (!response.ok) throw new Error(`Could not load the plan (${response.status} ${response.statusText}).`);
  state.plan = await response.json();
  state.db = await openDatabase();

  const settings = await readSettings(state.db);
  state.settings = {
    unit: settings.unit,
    increment: settings.increment,
    // Used for pull-ups, chin-ups and dips, where bodyweight is part of the
    // load. One number, edited in Settings — not read from the daily weigh-in,
    // so a 0.4 kg morning fluctuation cannot move every prescription.
    bodyweight: settings.bodyweight ?? state.plan.meta.referenceBodyweightKg ?? 90,
  };

  await loadEverything();
  await restoreActiveSession();
  // Rebuilt now that the active session is known, so today's own sets never
  // become their own "last time".
  buildHistory();

  state.integrity = await checkIntegrity(state.db);
  wireEvents();
  render();

  // Asked for after the first render, so the prompt never delays the screen.
  state.storage = await requestPersistentStorage();
  if (state.tab === 'set') render();
}

boot().catch((error) => {
  document.getElementById('view').innerHTML = `<div class="card"><h3 style="margin-top:0">Could not start</h3>
    <p>${escape(error.message)}</p>
    <p class="hint">Your data has not been touched. Reload to try again.</p></div>`;
  throw error;
});
