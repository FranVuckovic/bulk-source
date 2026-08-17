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
  deleteSessionCascade,
  snapshot,
  saveSession,
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
import { e1rm, systemLoad } from './calc.js';
import { buildExport, parseImport, restore } from './export.js';
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

const PLAN_URL = './data/plan-bulk-v1.json';
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

const todayISO = () => new Date().toISOString().slice(0, 10);
const nowISO = () => new Date().toISOString();

async function loadEverything() {
  state.todayISO = todayISO();
  state.logs = sortLogsByDate(await getAll(state.db, 'sessionLogs'));
  state.sets = await getAll(state.db, 'sets');
  state.daily = (await getAll(state.db, 'daily')).sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  state.measurements = (await getAll(state.db, 'measurements')).sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  state.niggles = (await getAll(state.db, 'niggles')).sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  state.media = (await getAll(state.db, 'media')).sort((a, b) => a.dateISO.localeCompare(b.dateISO));
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

  // Pace runs from whichever came first: the plan's start date or the earliest
  // session logged against it.
  const firstLogged = finished.length ? finished[0].dateISO.slice(0, 10) : null;
  const effectiveStart =
    firstLogged && firstLogged < state.plan.meta.startDateISO ? firstLogged : state.plan.meta.startDateISO;
  state.planProgress = planProgress(finished, effectiveStart, state.todayISO);

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

  // Was this a record? Ask BEFORE the set is stored, or it beats itself.
  const beaten = personalBestBefore(record);

  const id = await put(state.db, 'sets', record);
  state.loggedSets.set(key, { ...record, id });
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
  async deleteEntry(kind, id) {
    if (kind === 'session') {
      await deleteSessionCascade(state.db, id);
      if (state.activeLog?.id === id) {
        state.activeLog = null;
        state.loggedSets = new Map();
        await writeSetting(state.db, 'activeSessionLogId', null);
      }
    } else {
      const store = { daily: 'daily', measurement: 'measurements', niggle: 'niggles', media: 'media' }[kind];
      if (!store) throw new Error(`nothing knows how to delete a ${kind}`);
      await remove(state.db, store, id);
    }
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

  /** Restore from a zip this app wrote. Replaces only what the export carries. */
  async importZip(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = parseImport(bytes);
    const restored = await restore(state.db, parsed, { put, clearStore });

    await writeSetting(state.db, 'activeSessionLogId', null);
    state.activeLog = null;
    state.loggedSets = new Map();
    await loadEverything();
    resetBodyDraft();
    render();
    return restored;
  },

  /**
   * Verify a backup restores, without touching the real data: the export is
   * parsed and compared against what is stored, record for record. You find out
   * a backup is broken BEFORE you need it, not after.
   */
  async verifyBackup(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = parseImport(bytes);
    const live = await snapshot(state.db);

    const problems = [];
    for (const [store, rows] of Object.entries(parsed.data)) {
      const here = live.data[store] || [];
      if (store === 'settings') continue;
      if (rows.length !== here.length) problems.push(`${store}: ${rows.length} in the backup, ${here.length} here`);
    }
    return { ok: problems.length === 0, problems, counts: parsed.counts ?? {} };
  },

  /** A real file on disk, offered before anything is deleted. */
  async downloadBackup() {
    const payload = await snapshot(state.db);
    downloadBytes(JSON.stringify(payload, null, 2), `bulk-backup-${todayISO()}.json`, 'application/json');
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
    state.settings.unit = data.id;
    await writeSetting(state.db, 'unit', data.id);
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
      Promise.resolve(settings.files[fileAction]?.(ctx, event.target.files[0])).catch(showFailure);
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
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;

  navigator.serviceWorker
    .register('./sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then(() => {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.version) {
          state.buildVersion = event.data.version;
          if (state.tab === 'set') render();
        }
      });
      navigator.serviceWorker.controller?.postMessage('version');
    })
    .catch((error) => console.warn('service worker not registered:', error.message));
}

boot().catch((error) => {
  document.getElementById('view').innerHTML = `<div class="card"><h3 style="margin-top:0">Could not start</h3>
    <p>${escape(error.message)}</p>
    <p class="hint">Your data has not been touched. Reload to try again.</p></div>`;
  throw error;
});
