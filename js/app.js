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
  clearStore,
  withTransaction,
  request,
  alive,
  putSetIdempotent,
  startSessionAtomic,
  finishSessionAtomic,
  softDeleteSession,
  restoreSession,
  logicalSetKey,
  softDeleteRow,
  restoreRow,
  deletedRecords,
  deleteSessionCascade,
  claimSingleTab,
  parseStoreKey,
  snapshot,
  confirmWorkingMax,
  requestPersistentStorage,
  storageEstimate,
  checkIntegrity,
  ALL_STORES,
} from './db.js';
import {
  rotationPosition,
  blockProgress,
  planProgress,
  prescribedSetCount,
  isPartialSession,
  sortLogsByDate,
} from './progress.js';
import { e1rm, systemLoad, estimateForSet, isHighConfidence } from './calc.js';
import { localDate, nowISO, timeZone, utcOffsetMinutes, daysBetween } from './dates.js';
import { blockFor, effortModeFor, resolveSession, toDisplaySession, validatePlan } from './plan.js';
import {
  newCycle,
  cycleProgress,
  nextSession,
  blockBoundary,
  completionRatio,
  sessionStatusFor,
  projectedFinish,
  planCorrection,
} from './cycle.js';
import { buildExport, parseImport, validateImport, applyImport, verifyAgainst } from './export.js';
import {
  escape,
  fmtLoad,
  fmtNum,
  openSheet,
  closeSheet,
  stopRest,
  fromDisplay,
  toDisplay,
  parseNumber,
} from './ui/components.js';
import * as train from './ui/train.js';
import * as body from './ui/body.js';
import * as progress from './ui/progress.js';
import * as plan from './ui/plan.js';
import * as settings from './ui/settings.js';
import * as history from './ui/history.js';

const PLAN_URL = './data/plan-fopip-v2.json';
const TABS = { train: 'Bulk', body: 'Body', prog: 'Progress', plan: 'Plan', set: 'Settings' };

const state = {
  db: null,
  plan: null,
  settings: { unit: 'kg', increment: 2.5, bodyweight: 90, barKg: 20 },
  storage: { supported: false, persisted: false },
  integrity: null,
  buildVersion: null,

  logs: [],
  sets: [],
  cycles: [],
  cycle: null,
  cycleProgress: null,
  next: null,
  boundary: null,
  effortMode: null,
  projection: null,
  readiness: 'normal',
  daily: [],
  measurements: [],
  niggles: [],
  media: [],
  maxes: new Map(),
  lastByExercise: new Map(),
  todayISO: null,

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

  // Body screen
  bodyDraft: { dateISO: null },
  shut: new Set(),
  pendingSave: null,

  // Progress and Plan
  progressLift: 'benchComp',
  progressSection: null,
  historyFilter: 'all',
  planSection: null,
  exerciseSearch: '',
  planProgress: { sessionsDone: 0, daysElapsed: null, calendarWeek: 1, pace: null },
};

/* ═══════════════════════════════════════════════════════════════════════
   Loading
   ═══════════════════════════════════════════════════════════════════════ */

// Civil dates come from the device's own calendar. v1 used toISOString, which
// is UTC: anything logged after local midnight was filed under the previous day.
const todayISO = () => localDate();

async function loadEverything() {
  state.todayISO = todayISO();

  // Deleted rows are filtered out here, once, so no screen has to remember to
  // do it. They are kept in `state.deleted` for the recovery centre — a delete
  // in this app takes a record out of the way, not out of existence.
  const byDate = (a, b) => a.dateISO.localeCompare(b.dateISO);
  state.logs = sortLogsByDate(alive(await getAll(state.db, 'sessionLogs')));
  state.sets = alive(await getAll(state.db, 'sets'));
  state.daily = alive(await getAll(state.db, 'daily')).sort(byDate);
  state.measurements = alive(await getAll(state.db, 'measurements')).sort(byDate);
  state.niggles = alive(await getAll(state.db, 'niggles')).sort(byDate);
  state.media = alive(await getAll(state.db, 'media')).sort(byDate);
  state.maxes = new Map((await getAll(state.db, 'maxes')).map((m) => [m.exerciseId, m]));
  state.deleted = await deletedRecords(state.db);

  state.cycles = alive(await getAll(state.db, 'cycles')).sort((a, b) => a.sequence - b.sequence);
  const finished = state.logs.filter((log) => log.endedAt);

  // ── where the plan actually is ──
  const stored = await readSettings(state.db);
  const sequence = Math.min(Math.max(1, Number(stored.cycleSequence ?? 1)), state.plan.meta.rotations);
  state.cycle =
    state.cycles.find((c) => c.sequence === sequence) ||
    newCycle(state.plan, { sequence, startedAtISO: stored.cycleStartedAtISO ?? null, localStartDate: stored.cycleStartedDate ?? null });

  state.cycleProgress = cycleProgress(state.plan, state.cycle, finished);
  state.next = nextSession(state.plan, state.cycle, finished);
  state.boundary = blockBoundary(state.plan, state.cycle);

  const block = blockFor(state.plan, state.cycle.sequence);
  state.block = { idx: block.id, label: String(block.id), name: block.name, ...block };
  state.effortMode = effortModeFor(state.plan, state.cycle.sequence);

  // Kept in the shape the screens already read, so the engine change does not
  // ripple through every view at once.
  state.position = {
    nextSessionId: state.next.position,
    sessionsDone: finished.length,
    lastSessionId: finished.length ? finished[finished.length - 1].rotationPosition ?? null : null,
  };
  state.blockProgress = {
    blockDone: state.cycleProgress.complete,
    sessionTarget: state.plan.meta.rotationOrder.length,
    readyForReview: state.cycleProgress.finished && state.boundary.atBoundary,
    daysElapsed: state.cycle.localStartDate ? daysBetween(state.cycle.localStartDate, state.todayISO) : null,
  };

  const firstLogged = finished.length ? (finished[0].localDate || finished[0].dateISO || '').slice(0, 10) : null;
  state.planProgress = {
    sessionsDone: finished.length,
    cyclesDone: Math.max(0, state.cycle.sequence - 1) + (state.cycleProgress.finished ? 1 : 0),
    daysElapsed: firstLogged ? daysBetween(firstLogged, state.todayISO) : null,
    calendarWeek: firstLogged ? Math.floor(Math.max(0, daysBetween(firstLogged, state.todayISO)) / 7) + 1 : 1,
    pace: null,
  };
  if (state.planProgress.daysElapsed > 0) {
    state.planProgress.pace = finished.length / (state.planProgress.daysElapsed / 7);
    state.projection = projectedFinish(state.plan, {
      cyclesDone: state.planProgress.cyclesDone,
      daysElapsed: state.planProgress.daysElapsed,
    });
  }

  state.calibration = false;

  buildHistory();
}

/** Most recent previous sets per exercise — the prefill and the "last time" line. */
function buildHistory() {
  const byLog = new Map(state.logs.map((log) => [log.id, log]));
  const latest = new Map();

  for (const set of state.sets) {
    if (state.activeLog && set.sessionLogId === state.activeLog.id) continue;
    const log = byLog.get(set.sessionLogId);
    if (!log) continue;
    const entry = latest.get(set.exerciseId);
    if (!entry || log.dateISO > entry.dateISO) {
      latest.set(set.exerciseId, { dateISO: log.dateISO, logId: log.id, sets: [set] });
    } else if (log.id === entry.logId) {
      entry.sets.push(set);
    }
  }

  for (const entry of latest.values()) {
    entry.sets.sort((a, b) => (a.setIndex ?? 0) - (b.setIndex ?? 0));
    entry.note = entry.sets.map((s) => s.note).find(Boolean) || null;
  }
  state.lastByExercise = latest;
}

/** Rebuilds the in-progress session from storage, so a reload loses nothing. */
async function restoreActiveSession() {
  const settings = await readSettings(state.db);
  const activeId = settings.activeSessionLogId ?? null;
  const active = activeId != null ? state.logs.find((log) => log.id === activeId) : null;

  if (!active) {
    state.activeLog = null;
    state.trainSessionId = state.trainSessionId || state.position.nextSessionId || state.plan.meta.rotationOrder[0];
    return;
  }

  state.activeLog = active;
  state.trainSessionId = active.sessionId;
  state.deviations = active.deviations || { swaps: {}, extras: [], addedSets: {} };
  state.grips = active.grips || {};
  // Stored values are kilograms; the draft is labelled with the display unit.
  // v1 copied the raw kg straight into a field labelled lb, so a 90 kg session
  // reopened as "90 lb" and finishing converted it again to 40.8 kg.
  state.draft = {
    note: active.note || '',
    bodyweight:
      active.bodyweight == null ? '' : String(Math.round(toDisplay(active.bodyweight, state.settings.unit) * 10) / 10),
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

/*
 * Two ticks in quick succession both find `state.activeLog` empty, because
 * neither has finished writing yet. Holding the in-flight promise means the
 * second one waits for the first rather than starting a second session.
 */
let startingSession = null;

/**
 * The session log is created by the first thing you actually do, not by looking.
 *
 * Through `startSessionAtomic`, which checks the active pointer and the
 * operation id inside the same transaction as the write. v1 wrote the log and
 * the pointer separately, so a fast run of taps could open four sessions for
 * the same slot — the guarantee existed and was tested, and the app was not
 * calling it.
 */
async function ensureActiveLog() {
  if (state.activeLog) return state.activeLog;
  if (startingSession) return startingSession;

  // Stable for this position on this day, so a retry cannot open a second one.
  const operationId = `start:${state.cycle.id}:${state.trainSessionId}:${todayISO()}`;

  startingSession = (async () => {
    const { log } = await startSessionAtomic(
      state.db,
      {
        dateISO: todayISO(),
        localDate: todayISO(),
        timeZone: timeZone(),
        startedAt: nowISO(),
        endedAt: null,
        sessionId: state.trainSessionId,
        rotationPosition: state.trainSessionId,
        cycleId: state.cycle.id,
        cycleSequence: state.cycle.sequence,
        blockId: state.block.idx,
        effortMode: state.effortMode,
        readiness: state.readiness || 'normal',
        rotationIndex: state.plan.meta.rotationOrder.indexOf(state.trainSessionId),
        bodyweight: null,
        sessionRpe: null,
        note: null,
        isPartial: false,
        deviations: state.deviations,
        grips: state.grips,
      },
      { operationId }
    );

    state.logs = sortLogsByDate(alive(await getAll(state.db, 'sessionLogs')));
    state.activeLog = state.logs.find((row) => row.id === log.id) || log;
    return state.activeLog;
  })();

  try {
    return await startingSession;
  } finally {
    startingSession = null;
  }
}

async function saveSet(slotIndex, setIndex, values) {
  const log = await ensureActiveLog();
  const slot = train.slotsFor(state)[slotIndex];
  const key = `${slotIndex}:${setIndex}`;
  const existing = state.loggedSets.get(key);

  const record = {
    ...(existing ? { id: existing.id } : {}),
    sessionLogId: log.id,
    logicalKey: logicalSetKey(log.id, slotIndex, setIndex),
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
    isMyoRep: !!values.isMyoRep,
    velocity: values.velocity ?? null,
    note: values.note ?? null,
    wasPrescribed: !!values.wasPrescribed,
    prescribedLoad: values.prescribedLoad ?? null,
    timestampISO: nowISO(),
    localDate: todayISO(),
    timeZone: timeZone(),
    utcOffsetMinutes: utcOffsetMinutes(),
    gripWidth: state.grips[`${state.trainSessionId}-${slotIndex}`] ?? null,
    // Stored per set: without it, a pull-up log stops being interpretable the
    // moment your bodyweight changes.
    bodyweightUsed: state.plan.exercises[slot.ex].bodyweightLoaded ? state.settings.bodyweight : null,
    variantUsed: slot.swappedFrom ? slot.ex : null,
    pauseStyle: values.pauseStyle ?? existing?.pauseStyle ?? null,
  };

  // Was this a record? Ask BEFORE the set is stored, or it beats itself.
  const beaten = personalBestBefore(record);

  // Idempotent: a double tap, or a retried save, resolves to one row because
  // the logical key is a unique index rather than a convention.
  const { set: written } = await putSetIdempotent(state.db, record, {
    operationId: values.operationId ?? `${record.logicalKey}-${record.timestampISO}`,
  });
  state.loggedSets.set(key, written);
  state.sets = await getAll(state.db, 'sets');
  render();

  if (beaten) celebrate(beaten);
}

/**
 * The best e1RM this lift has ever shown, and whether this set beat it.
 *
 * Only high-confidence tracked lifts qualify: a curl "record" from a formula
 * known to fail on isolation work is not a record. Existing sets are read from
 * state, which is why this has to run before the new one lands.
 */
function personalBestBefore(record) {
  const exercise = state.plan.exercises[record.exerciseId];
  if (!exercise?.tracksMax || exercise.maxConf !== 'high') return null;
  if (record.load == null || !record.reps) return null;

  const value = e1rm(systemLoad(record.load, record.bodyweightUsed || 0), record.reps, record.rpe ?? 8);
  if (value == null) return null;

  let best = 0;
  for (const set of state.sets) {
    if (set.exerciseId !== record.exerciseId || set.id === record.id) continue;
    if (set.load == null || !set.reps) continue;
    const previous = e1rm(systemLoad(set.load, set.bodyweightUsed || 0), set.reps, set.rpe ?? 8);
    if (previous != null && previous > best) best = previous;
  }

  if (!best || value <= best) return null;
  return { name: exercise.name, value, previous: best, gain: value - best };
}

function celebrate(pr) {
  const unit = state.settings.unit;
  openSheet(`<div class="ttl">That is a record</div>
    <p style="text-align:center;font-size:34px;font-weight:800;margin:14px 0 2px;letter-spacing:-.02em">${fmtLoad(
      pr.value,
      unit
    )} ${unit}</p>
    <p style="text-align:center;font-size:13px;margin:0 0 4px">estimated max · ${escape(pr.name)}</p>
    <p style="text-align:center;font-size:14px;color:var(--goodtx);font-weight:650">+${fmtNum(pr.gain, 1)} ${unit} on your previous best of ${fmtLoad(
      pr.previous,
      unit
    )}</p>
    <button class="big mt" data-act="sheet-close">Back to it</button>`);
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
  const bodyweight = parseNumber(state.draft.bodyweight);
  const sessionRpe = parseNumber(state.draft.sessionRpe);

  state.activeLog = {
    ...state.activeLog,
    note: state.draft.note || null,
    bodyweight: bodyweight == null ? null : fromDisplay(bodyweight, unit),
    sessionRpe,
  };
  await put(state.db, 'sessionLogs', state.activeLog);
}

async function finishSession() {
  await persistDraft();
  const session = state.plan.sessions.find((s) => s.id === state.trainSessionId);
  const prescribed = prescribedSetCount({ slots: train.slotsFor(state) });
  const logged = state.loggedSets.size;
  const ratio = completionRatio(logged, prescribed);

  // One transaction: the end state and the active pointer move together, so a
  // failure between them cannot leave a finished session looking active.
  const { log: finishedLog } = await finishSessionAtomic(state.db, state.activeLog.id, {
    endedAt: nowISO(),
    localEndDate: todayISO(),
    isPartial: ratio != null && ratio < 0.5,
    completionRatio: ratio,
    prescribedSets: prescribed,
    loggedSets: logged,
    status: sessionStatusFor(ratio),
    note: state.draft.note || null,
  });
  state.activeLog = finishedLog;

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
    ${
      state.cycleProgress.finished
        ? `<p style="text-align:center;font-size:13px">That completes <b>rotation ${state.cycle.sequence}</b>${
            state.cycleProgress.partial || state.cycleProgress.skipped
              ? ` — with ${state.cycleProgress.partial + state.cycleProgress.skipped} position${
                  state.cycleProgress.partial + state.cycleProgress.skipped === 1 ? '' : 's'
                } partial or skipped`
              : ''
          }.${
            state.boundary.atBoundary
              ? ` It also ends <b>${escape(state.boundary.fromName)}</b>. Review your working maxes before moving on.`
              : ''
          }</p>
          <button class="big mt" data-act="advance-cycle">Start rotation ${state.cycle.sequence + 1}</button>
          <button class="big ghost mt" data-act="sheet-close">Not yet</button>`
        : `<p style="text-align:center;font-size:13px">Next in the rotation: <b>${escape(
            state.position.nextSessionId
          )}</b> · ${state.cycleProgress.pending} still to do in rotation ${state.cycle.sequence}.</p>
          <button class="big mt" data-act="sheet-close">Done</button>`
    }`);
}

/** Today's Body entries, prefilled from whatever is already stored for today. */
function resetBodyDraft() {
  const today = state.todayISO;
  const daily = state.daily.find((d) => d.dateISO === today) || {};
  const measurement = state.measurements.find((m) => m.dateISO === today) || {};
  const unit = state.settings.unit;
  const show = (value) => (value == null ? '' : String(Math.round(toDisplay(value, unit) * 10) / 10));

  state.bodyDraft = {
    dateISO: today,
    bodyweight: show(daily.bodyweight),
    bodyfatPct: daily.bodyfatPct == null ? '' : String(daily.bodyfatPct),
    sleepHours: daily.sleepHours == null ? '' : String(daily.sleepHours),
    steps: daily.steps == null ? '' : String(daily.steps),
    mood: daily.mood == null ? '' : String(daily.mood),
    caffeine: daily.caffeine || '',
    note: daily.note || '',
    niggleSite: '',
    niggleSeverity: '1',
    niggleContext: '',
  };
  for (const [id] of body.MEASUREMENT_SITES) {
    state.bodyDraft[`m-${id}`] = measurement[id] == null ? '' : String(measurement[id]);
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   Screens
   ═══════════════════════════════════════════════════════════════════════ */

function screenFor(tab) {
  if (tab === 'train') return train.view(ctx);
  if (tab === 'body') return body.view(ctx);
  if (tab === 'prog') return state.progressSection === 'history' ? history.view(ctx) : progress.view(ctx);
  if (tab === 'plan') return plan.view(ctx);
  return settings.view(ctx);
}

/**
 * The update banner.
 *
 * A new build is never applied under you: it sits in the wings until you say
 * so, and it says plainly that an active session would be interrupted.
 */
/**
 * The read-only banner, shown to a tab that has lost the lock.
 *
 * It does not lock the interface: a stale tab that refuses to do anything is
 * worse than one that tells you it is stale, and reload is one tap away.
 */
function staleBanner() {
  if (!state.readOnly) return '';
  return `<div class="flag f-warn" style="margin:0 0 12px"><i>!</i><span>
    <b>Bulk is open in another tab.</b> That one is now the live copy. Anything you log here may be overwritten by
    it, and what you see was loaded before it started.
    <button data-act="reload-app" style="display:block;margin-top:6px;background:none;border:0;color:var(--s1);font:inherit;font-weight:650;padding:0;cursor:pointer">Reload this tab</button>
  </span></div>`;
}

function updateBanner() {
  if (!state.updateReady) return '';
  const mid = !!state.activeLog;
  return `<div class="flag f-${mid ? 'warn' : 'info'}" style="margin:0 0 12px"><i>${mid ? '!' : 'i'}</i><span>
    <b>A new version of Bulk is ready.</b> ${
      mid
        ? 'You are part-way through a session — finish it first. Applying an update reloads the app, and an unlogged set would be lost.'
        : 'It is downloaded and waiting. Applying it reloads the app; your data is untouched.'
    }
    <button data-act="apply-update" style="display:block;margin-top:6px;background:none;border:0;color:var(--s1);font:inherit;font-weight:650;padding:0;cursor:pointer">Update now</button>
  </span></div>`;
}

function render() {
  document.getElementById('ttl').textContent = TABS[state.tab];
  document.getElementById('chip').textContent =
    state.tab === 'train'
      ? `Session ${state.trainSessionId}`
      : `Rotation ${state.cycle.sequence}/${state.plan.meta.rotations}`;
  document.getElementById('view').innerHTML = staleBanner() + updateBanner() + screenFor(state.tab);

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

  toKg: (value) => (value == null ? null : fromDisplay(value, state.settings.unit)),

  async saveDaily(row) {
    await put(state.db, 'daily', row);
    state.daily = (await getAll(state.db, 'daily')).sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    render();
  },

  async saveMeasurements(row) {
    await put(state.db, 'measurements', row);
    state.measurements = (await getAll(state.db, 'measurements')).sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    render();
  },

  async saveNiggle(row) {
    await put(state.db, 'niggles', row);
    state.niggles = (await getAll(state.db, 'niggles')).sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    state.bodyDraft.niggleSite = '';
    state.bodyDraft.niggleContext = '';
    render();
  },

  async deleteMedia(id, { reason = null } = {}) {
    await softDeleteRow(state.db, 'media', id, { reason });
    await loadEverything();
  },

  async saveMedia(row) {
    await put(state.db, 'media', row);
    state.media = (await getAll(state.db, 'media')).sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    render();
  },

  /** Confirming a working max writes it and appends to the audit history. */
  async confirmMax(exerciseId, workingMax, reason) {
    await confirmWorkingMax(
      state.db,
      {
        exerciseId,
        workingMax,
        conf: state.plan.exercises[exerciseId].maxConf,
        setAtISO: nowISO(),
        sourceSetId: null,
        blockId: state.block.idx,
      },
      reason
    );
    await loadEverything();
    render();
  },

  /**
   * Deleting is the only irreversible thing here, so it goes through one path
   * with one cascade rule: a session takes its sets with it.
   */
  /**
   * Deleting takes a record out of the way, not out of existence.
   *
   * Everything here is a soft delete with an audit entry behind it, so a
   * mis-tap — or a weigh-in typed as 9.2 instead of 92 and noticed a week
   * later — is recoverable from Settings rather than gone.
   */
  async deleteEntry(kind, id, { reason = null } = {}) {
    if (kind === 'session') {
      await softDeleteSession(state.db, id, { reason });
      if (state.activeLog?.id === id) {
        state.activeLog = null;
        state.loggedSets = new Map();
        await writeSetting(state.db, 'activeSessionLogId', null);
      }
    } else {
      const store = { daily: 'daily', measurement: 'measurements', niggle: 'niggles', media: 'media' }[kind];
      if (!store) throw new Error(`nothing knows how to delete a ${kind}`);
      await softDeleteRow(state.db, store, id, { reason });
    }
    await loadEverything();
    buildHistory();
    resetBodyDraft();
  },

  /**
   * Destroy everything in the bin. The only call in the app that removes rows
   * rather than marking them, which is why it lives behind two confirmations.
   */
  async emptyBin() {
    const doomed = state.deleted || [];
    for (const entry of doomed) {
      if (entry.store === 'sessionLogs') {
        await deleteSessionCascade(state.db, entry.id);
      } else {
        await remove(state.db, entry.store, entry.id);
      }
    }
    await loadEverything();
    buildHistory();
    return doomed.length;
  },

  /** Put one back, from the recovery centre. */
  async restoreEntry(store, rawKey) {
    // A key that came back through a data attribute is a string. A weigh-in is
    // keyed by its date and a session by a number, so it has to be put back
    // into its own type before IndexedDB will find it.
    const key = parseStoreKey(store, rawKey);
    if (store === 'sessionLogs') await restoreSession(state.db, key);
    else await restoreRow(state.db, store, key);
    await loadEverything();
    buildHistory();
    resetBodyDraft();
  },

  /**
   * The zip: CSVs for reading, data.json for restoring, photos as files.
   * Selective by date range and by content type.
   */
  async exportZip(options = {}) {
    const payload = await snapshot(state.db);
    const { zip, meta } = buildExport(payload, state.plan, options);
    downloadBytes(zip, `bulk-export-${todayISO()}.zip`, 'application/zip');
    await writeSetting(state.db, 'lastBackupISO', todayISO());
    state.settings.lastBackupISO = todayISO();
    return meta;
  },

  /**
   * Advance to the next rotation. One deliberate action, never automatic.
   *
   * v1 read blockIdx and never wrote it, so the block could not advance at all
   * and three encoded plan features were unreachable for the whole 33 weeks.
   */
  async advanceCycle({ reason = 'rotation complete' } = {}) {
    const from = state.cycle.sequence;
    const to = Math.min(from + 1, state.plan.meta.rotations);
    if (to === from) return { moved: false, reason: 'this is the last rotation of the plan' };

    // Close the cycle that is finishing, then open the next one.
    await put(state.db, 'cycles', {
      ...state.cycle,
      status: state.cycleProgress.finished && !state.cycleProgress.partial && !state.cycleProgress.skipped
        ? 'complete'
        : 'partial',
      endedAtISO: nowISO(),
      localEndDate: todayISO(),
    });

    const next = newCycle(state.plan, { sequence: to, startedAtISO: nowISO(), localStartDate: todayISO() });
    await put(state.db, 'cycles', next);
    await writeSetting(state.db, 'cycleSequence', to);
    await put(state.db, 'auditLog', {
      atISO: nowISO(), entity: 'cycle', action: 'advance', from, to, reason,
    });

    await loadEverything();
    render();
    return { moved: true, from, to };
  },

  /**
   * Correct the rotation number by hand, with a reason recorded.
   *
   * Needed after an import, a mis-tap, or training that happened away from the
   * app. Nothing about the plan position may change silently.
   */
  async correctCycle(to, reason) {
    const correction = planCorrection({
      field: 'cycleSequence', from: state.cycle.sequence, to, reason, atISO: nowISO(),
    });
    if (!correction.ok) return correction;

    const existing = state.cycles.find((c) => c.sequence === to);
    if (!existing) {
      await put(state.db, 'cycles', newCycle(state.plan, { sequence: to, startedAtISO: nowISO(), localStartDate: todayISO() }));
    }
    await writeSetting(state.db, 'cycleSequence', to);
    await put(state.db, 'auditLog', correction.entry);

    await loadEverything();
    render();
    return { ok: true };
  },

  /** Today's readiness. Applied to the resolved session, never stored as plan. */
  setReadiness(value) {
    state.readiness = value;
    render();
  },

  /** A plain JSON file with every record in it, offered before anything is lost. */
  async downloadBackup({ label = 'backup' } = {}) {
    const payload = await snapshot(state.db);
    const bytes = new TextEncoder().encode(JSON.stringify(payload, null, 2));
    downloadBytes(bytes, `bulk-${label}-${todayISO()}.json`, 'application/json');
  },

  /**
   * Step one: read and check. Nothing is written.
   *
   * v1 cleared and repopulated each store the moment a file was chosen, one
   * store at a time, with no validation and no way back. Importing into a
   * populated database silently replaced settings and any store the archive
   * happened to contain.
   */
  async stageImport(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = parseImport(bytes);

    const current = {};
    for (const store of ALL_STORES) current[store] = (await getAll(state.db, store)).length;

    const report = validateImport(parsed, { current });
    state.pendingImport = report.ok ? { parsed, report, name: file.name } : null;
    return report;
  },

  /**
   * Step two: apply, in one transaction across every affected store. Either the
   * whole restore lands or the database is untouched.
   *
   * A safety export is taken first, because the thing being replaced is the
   * only copy of months of training.
   */
  async applyStagedImport() {
    const staged = state.pendingImport;
    if (!staged) throw new Error('nothing staged to import');

    await ctx.downloadBackup({ label: 'before-import' });

    const restored = await applyImport(state.db, staged.parsed, { withTransaction, request });
    state.pendingImport = null;

    await loadEverything();
    await restoreActiveSession();
    buildHistory();
    resetBodyDraft();
    render();
    return restored;
  },

  /** Read a backup and compare its contents with what is stored. Writes nothing. */
  async verifyBackup(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = parseImport(bytes);
    const live = await snapshot(state.db);
    return verifyAgainst(parsed, live);
  },

  async eraseEverything() {
    for (const store of ALL_STORES) {
      if (store === 'settings') continue;
      await clearStore(state.db, store);
    }
    await writeSetting(state.db, 'activeSessionLogId', null);
    state.activeLog = null;
    state.loggedSets = new Map();
    state.deviations = { swaps: {}, extras: [], addedSets: {} };
    state.grips = {};
    state.draft = { note: '', bodyweight: '', sessionRpe: '' };
    await loadEverything();
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
  'reload-app'() {
    location.reload();
  },

  /**
   * Apply a waiting build. The worker swaps, `controllerchange` fires, and the
   * page reloads once — so every module comes from the same new version rather
   * than a mix of the two.
   */
  async 'apply-update'() {
    if (state.activeLog && !confirm('You have a session open. Updating reloads the app and anything not yet logged is lost. Update anyway?')) {
      return;
    }
    const registration = await navigator.serviceWorker?.getRegistration();
    registration?.waiting?.postMessage('apply-update');
  },

  async 'advance-cycle'(ctx) {
    const result = await ctx.advanceCycle();
    closeSheet();
    if (result.moved) {
      openSheet(`<div class="ttl">Rotation ${result.to}</div>
        <p style="text-align:center;font-size:14px;margin:14px 0 4px;color:var(--ink)">${escape(state.block.name)}</p>
        <p style="text-align:center;font-size:13px">${escape(state.block.theme)}</p>
        ${
          state.effortMode === 'high' || state.effortMode === 'standard'
            ? `<p style="text-align:center;font-size:13px">Effort mode this rotation: <b>${escape(state.effortMode)} failure</b>.</p>`
            : ''
        }
        <button class="big mt" data-act="sheet-close">Start</button>`);
    }
  },

  'open-cycle-control'(ctx) {
    openSheet(`<div class="ttl">Where the plan is</div>
      <p style="text-align:center;font-size:13px;margin:12px 0 4px">Rotation <b>${state.cycle.sequence}</b> of ${
        state.plan.meta.rotations
      } · ${escape(state.block.name)}</p>
      <p style="text-align:center;font-size:13px">${state.cycleProgress.complete} of ${
        state.plan.meta.rotationOrder.length
      } sessions done this rotation</p>
      <div class="mt"><label for="cycle-to">Set the rotation number</label>
        <input id="cycle-to" type="number" min="1" max="${state.plan.meta.rotations}" value="${state.cycle.sequence}"></div>
      <div class="mt"><label for="cycle-why">Why</label>
        <input id="cycle-why" type="text" placeholder="Trained away from the app, imported twice…"></div>
      ${
        state.cycleProgress.finished
          ? `<div class="flag f-ok" style="margin-top:10px"><i>✓</i><span><b>Rotation ${
              state.cycle.sequence
            } is finished.</b>${
              state.boundary.atBoundary
                ? ` It also ends <b>${escape(state.boundary.fromName)}</b> — review your working maxes before moving on.`
                : ''
            }</span></div>
          <button class="big mt" data-act="advance-cycle">Start rotation ${state.cycle.sequence + 1}</button>`
          : ''
      }
      <p class="hint">Corrections are recorded with their reason. Nothing about the plan position changes silently.</p>
      <button class="big${state.cycleProgress.finished ? ' ghost' : ''} mt" data-act="correct-cycle">Correct it</button>
      <button class="big ghost mt" data-act="sheet-close">Cancel</button>`);
  },

  async 'correct-cycle'(ctx) {
    const to = Number(document.getElementById('cycle-to')?.value);
    const reason = document.getElementById('cycle-why')?.value?.trim();
    const result = await ctx.correctCycle(to, reason);

    if (!result.ok) {
      openSheet(`<div class="ttl">Not changed</div>
        <p style="text-align:center;font-size:14px;margin:14px 0;color:var(--ink)">${escape(result.reason)}</p>
        <button class="big mt" data-act="sheet-close">Close</button>`);
      return;
    }
    closeSheet();
    render();
  },

  readiness(ctx, data) {
    ctx.setReadiness(data.id);
  },

  tab(_ctx, data) {
    state.tab = data.tab;
    if (data.tab !== 'prog') state.progressSection = null;
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
    const from = state.settings.unit;
    const to = data.id;
    if (from === to) return;

    // Convert anything typed but not yet saved, so the number on screen keeps
    // meaning the same weight.
    const convert = (text) => {
      const parsed = parseNumber(text);
      if (parsed == null) return text;
      const kg = fromDisplay(parsed, from);
      return String(Math.round(toDisplay(kg, to) * 10) / 10);
    };
    state.draft.bodyweight = convert(state.draft.bodyweight);
    state.bodyDraft.bodyweight = convert(state.bodyDraft.bodyweight);

    state.settings.unit = to;
    await writeSetting(state.db, 'unit', to);
    render();
  },
};

const changeHandlers = {
  async bodyweight(value) {
    const parsed = parseNumber(value);
    if (parsed == null || parsed <= 0) return;
    state.settings.bodyweight = fromDisplay(parsed, state.settings.unit);
    await writeSetting(state.db, 'bodyweight', state.settings.bodyweight);
    render();
  },
  async increment(value) {
    state.settings.increment = parseNumber(value);
    await writeSetting(state.db, 'increment', state.settings.increment);
    render();
  },
};

/** Hand a file to the browser. The only thing in the app that leaves the device. */
function downloadBytes(data, filename, type) {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

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
    const handler =
      globalActions[act] ||
      train.actions[act] ||
      body.actions[act] ||
      progress.actions[act] ||
      history.actions[act] ||
      plan.actions[act] ||
      settings.actions[act];
    if (!handler) return;

    // A write that fails has to say so. Silently doing nothing is the one
    // outcome that would let a session go unrecorded without anyone noticing.
    try {
      Promise.resolve(handler(ctx, el.dataset, event)).catch(showFailure);
    } catch (error) {
      showFailure(error);
    }
  });

  // Chart points answer on tap. There is no hover on the only device this runs
  // on, so an SVG <title> would be an invisible tooltip.
  document.addEventListener('click', (event) => {
    const point = event.target.closest('[data-tip]');
    const wrap = (point || event.target).closest?.('.ch-wrap');
    if (!wrap) return;
    const slot = wrap.querySelector('[data-tip-slot]');
    if (!slot) return;
    if (!point) return;
    if (!slot.dataset.rest) slot.dataset.rest = slot.textContent;
    slot.textContent = point.dataset.tip;
    slot.classList.add('on');
  });

  document.addEventListener('input', (event) => {
    const el = event.target;
    if (el.dataset.bind) {
      state.draft[el.dataset.bind] = el.value;
      persistDraft();
      return;
    }
    if (el.dataset.bodyField) {
      state.bodyDraft[el.dataset.bodyField] = el.value;
      return;
    }
    const input = el.dataset.actInput;
    if (input) (train.inputs[input] || plan.inputs[input])?.(ctx, el.value);
  });

  document.addEventListener('change', (event) => {
    const name = event.target.dataset.actChange;
    if (name) changeHandlers[name]?.(event.target.value);

    const fileAction = event.target.dataset.actFile;
    if (fileAction && event.target.files?.length) {
      // A picker that takes one file gets one; a picker that takes many gets
      // the list. Passing only files[0] to a multiple picker is how five of six
      // chosen photos used to vanish without a word.
      const handler = body.files[fileAction] || settings.files[fileAction];
      const argument = event.target.multiple ? event.target.files : event.target.files[0];
      Promise.resolve(handler?.(ctx, argument)).catch(showFailure);
      event.target.value = '';
    }
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
    barKg: settings.barKg ?? 20,
  };

  await loadEverything();
  resetBodyDraft();
  await restoreActiveSession();
  // Rebuilt now that the active session is known, so today's own sets never
  // become their own "last time".
  buildHistory();

  state.integrity = await checkIntegrity(state.db);

  // Another tab of the same app is a data-loss shape: two drafts, two ideas of
  // the active session, and the second write silently wins. The newest tab
  // keeps the pen; this one steps back and says so rather than fighting it.
  state.tabLock = claimSingleTab({
    onLost() {
      state.readOnly = true;
      render();
    },
  });
  window.addEventListener('pagehide', () => state.tabLock?.release());

  wireEvents();
  render();

  // Asked for after the first render, so the prompt never delays the screen.
  state.storage = { ...(await requestPersistentStorage()), ...(await storageEstimate()) };
  registerServiceWorker();
  if (state.tab === 'set') render();
}

/**
 * The offline shell. Registered after boot so a failing service worker can
 * never stop the app starting — the app works without it, it just needs a
 * connection.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;

  // Not on localhost, unless asked for with ?sw=1.
  //
  // The worker serves the whole shell out of one versioned cache, which is what
  // makes an update atomic — and which, while developing, means every edit is
  // invisible until the version is bumped. That is correct in production and
  // pure friction here, so the development host opts out and the flag exists
  // for the times the update path itself is what needs testing.
  const forced = new URLSearchParams(location.search).get('sw') === '1';
  if (LOCAL_HOSTS.has(location.hostname) && !forced) return;

  // One reload, ever. Without the guard a controller change during startup can
  // put the app in a reload loop, which on a phone looks exactly like a crash.
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });

  navigator.serviceWorker
    .register('./sw.js')
    .then((registration) => {
      const offer = (worker) => {
        // 'installed' with a controller already present means this is an
        // update, not a first install. A first install has nothing to offer.
        if (worker && worker.state === 'installed' && navigator.serviceWorker.controller) {
          state.updateReady = true;
          render();
        }
      };

      offer(registration.waiting);
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => offer(worker));
      });

      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.version) {
          state.buildVersion = event.data.version;
          if (state.tab === 'set') render();
        }
        if (event.data?.shell) state.shellReport = event.data.shell;
      });
      navigator.serviceWorker.controller?.postMessage('version');
      // Ask the worker to top up anything missing from the offline shell. A
      // cache emptied by the browser under storage pressure otherwise stays
      // half-empty, and you find out in a gym with no signal.
      navigator.serviceWorker.controller?.postMessage('verify-shell');

      // Checked on every start rather than only when the browser feels like
      // it, so an update lands the next time the app is opened.
      registration.update().catch(() => {});
    })
    .catch((error) => console.warn('service worker not registered:', error.message));
}

boot().catch((error) => {
  document.getElementById('view').innerHTML = `<div class="card"><h3 style="margin-top:0">Could not start</h3>
    <p>${escape(error.message)}</p>
    <p class="hint">Your data has not been touched. Reload to try again.</p></div>`;
  throw error;
});
