/**
 * ui/train.js — the Train screen.
 *
 * The highest-friction surface in the app and the one that decides whether any
 * of the rest gets used. Three rules it is built around:
 *
 *   One tap logs an unchanged set — the ✓ writes the prescribed (or last
 *   session's) numbers straight to the database.
 *   Ticking a set never collapses the exercise you are working in.
 *   Clearing the prescribed values only clears what you did NOT type.
 *
 * Layout, copy and interaction are ported from the reviewed demo.
 */

import {
  e1rm,
  setDifficulty,
  noEstimateReason,
  roughE1rm,
  roughConfidence,
  sessionDuration,
  SET_SETUP_SECONDS,
  SECONDS_PER_REP,
  prescribedLoad,
  nextAttemptLoad,
  effectiveRpeDetail,
  roundToIncrement,
  systemLoad,
  estimateForSet,
  warmupRamp,
  platesFor,
  pct,
  AMRAP_FRACTION,
} from '../calc.js';
import {
  resolveSession,
  toDisplaySession,
  toDisplaySlot,
  exerciseAcrossPlan,
  sameExerciseElsewhere,
  slotById,
  companionSlots,
  BORROWABLE_FIELDS,
} from '../plan.js';
import { exerciseNoteHistory, recentEvidenceMax, LONG_GAP_SECONDS, bodyweightOn } from '../analytics.js';
import { rankSwaps, listedSubs, searchKey, matchesQuery, guessBasedOn, normalize } from '../library.js';
import { cycleProgress } from '../cycle.js';
import { questionSet } from '../plausibility.js';
import { daysBetween, localDate, localDateOf } from '../dates.js';
import {
  escape,
  fmtLoad,
  fmtNum,
  toDisplay,
  fromDisplay,
  stepFor,
  openSheet,
  closeSheet,
  startRest,
  parseNumber,
  questionSheet,
  questionFmt,
  SET_TYPO_NOTE,
} from './components.js';

const setKey = (slotIndex, setIndex) => `${slotIndex}:${setIndex}`;
export const CUSTOM_SESSION_ID = 'custom';

/**
 * A saved custom workout, by id, or null.
 *
 * These live in `plan.customWorkouts` and are fully prescribed — sets, reps,
 * RPE, rest — so they load off your working maxes exactly like a plan session.
 * What makes them custom is that they carry no rotation position: they never
 * advance, satisfy or replace a letter in A–F.
 *
 * `CUSTOM_SESSION_ID` stays what it was, the blank ad-hoc session you fill in
 * on the spot.
 */
export const customWorkoutById = (state, id) =>
  (state?.plan?.customWorkouts || []).find((w) => w.id === id) || null;

/** A session's departures from the plan, before it has any. */
export const freshDeviations = () => ({ swaps: {}, extras: [], addedSets: {}, exerciseNotes: {}, phaseSwaps: {} });

/**
 * Forget everything the last session left on the Train screen.
 *
 * One list, used by finish, discard, plan switch and erase. There used to be a
 * hand-written list in each, and they had drifted: discard cleared only the
 * log and its sets, so the next session inherited the discarded one's swaps,
 * added exercises, grips, note — all keyed by slot index, so they landed on
 * whatever the next session had in that position — and none of them reset
 * readiness, so a red day stayed red until the app was cold-started.
 */
export function resetSessionState(state) {
  state.activeLog = null;
  state.loggedSets = new Map();
  state.deviations = freshDeviations();
  state.grips = {};
  state.swapConfirmed = new Set();
  state.draft = { note: '', bodyweight: '', sessionRpe: '' };
  state.cleared = new Set();
  state.exOpen = new Set(['0']);
  state.readiness = 'normal';
  state.stepDrafts = {};
  state.startAnswer = null;
  state.pendingSet = null;
  state.pendingTick = null;
  state.staleAnswered = null;
}

/**
 * When a set happened, and when it was last corrected.
 *
 * `timestampISO` is the moment the set was first logged and an edit never
 * moves it. Every save used to re-stamp it, so fixing an RPE at the end of the
 * session moved that set to the end — and every rest gap, duration and
 * "logged live?" judgement built on the timestamps was wrong in a way nothing
 * could detect. `editedAtISO` says when it was changed instead.
 *
 * `stamp` is what the save's operation id is built from. It must change on an
 * edit: built from the kept timestamp, the edit would carry the first save's
 * operation id and the idempotency check would hand back the old row.
 */
export function setStamps(existing, now) {
  if (!existing?.timestampISO) return { timestampISO: now, editedAtISO: null, stamp: now };
  return { timestampISO: existing.timestampISO, editedAtISO: now, stamp: now };
}

/* ═══════════════════════════════════════════════════════════════════════
   Starting a session the rotation did not expect
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * A write that cannot go ahead until the lifter answers a question.
 *
 * Thrown from `ensureActiveLog` — the one place every session is opened from,
 * whether by Start, the first tick, a swap or an added exercise — and caught by
 * the central action handler, which asks instead of reporting a failure.
 */
export class NeedsAnswer extends Error {
  constructor(question) {
    super('This needs an answer before anything is saved.');
    this.name = 'NeedsAnswer';
    this.question = question;
  }
}

/**
 * Should starting this session ask first? Null when it should not.
 *
 * Two cases, both from real use:
 *
 *   `done` — the position is already complete or partial in this rotation.
 *   The Start button asked; the first tick did not, and one tick on a finished
 *   rotation's A filed a second A into it.
 *
 *   `order` — nothing is logged in this rotation yet and this is not its first
 *   letter. Starting FLOPIP on a Friday with E made every rotation run E, A, B,
 *   C, D, and in rotation 3 put the test before the taper.
 *
 * Neither is forbidden. Both are asked, with the previous rotation offered
 * when this position is still pending there — the usual reason for both is a
 * rotation advanced a session too early.
 */
export function startQuestion(state) {
  if (state.activeLog || isOutsideRotation(state)) return null;
  const id = state.trainSessionId;
  const order = state.plan.meta.rotationOrder;
  if (!order.includes(id) || !state.cycleProgress) return null;

  const sequence = state.cycle.sequence;
  const positions = state.cycleProgress.positions || [];
  const status = positions.find((p) => p.position === id)?.status ?? 'pending';
  const common = { sessionId: id, sequence, canAdvance: sequence < state.plan.meta.rotations, previous: previousOpening(state, id) };

  if (status === 'complete' || status === 'partial') return { kind: 'done', status, ...common };
  if (id !== order[0] && positions.every((p) => p.status === 'pending')) return { kind: 'order', first: order[0], ...common };
  return null;
}

/** The previous rotation, if this position is still pending in it. */
function previousOpening(state, position) {
  const sequence = state.cycle.sequence - 1;
  const cycle = (state.cycles || []).find((c) => c.sequence === sequence);
  if (!cycle) return null;
  const finished = (state.logs || []).filter((log) => log.endedAt && !log.deletedAtISO);
  const progress = cycleProgress(state.plan, cycle, finished);
  const status = progress.positions.find((p) => p.position === position)?.status ?? 'pending';
  return status === 'pending' ? { sequence, cycleId: cycle.id } : null;
}

/** Has this question been answered, for this session in this rotation? */
export function isAnswered(state, question) {
  const answer = state.startAnswer;
  return !!answer && answer.sessionId === question.sessionId && answer.sequence === question.sequence;
}

/**
 * Ask it, on the sheet the Start button has always used, in its words.
 *
 * `question.resume` is the row whose tick asked, carried on the answer buttons
 * so answering logs that set.
 */
export function askQuestion(state, question) {
  if (question.kind === 'stale') return askAboutStaleSession(question);
  const id = escape(question.sessionId);
  const n = question.sequence;
  const resume = question.resume ? ` data-si="${question.resume.si}" data-i="${question.resume.i}"` : '';
  const previous = question.previous
    ? `<button class="big ghost mt" data-act="start-answer" data-choice="previous"${resume}>File it in rotation ${question.previous.sequence}</button>`
    : '';
  const anyway = `<button class="big ghost mt" data-act="start-answer" data-choice="anyway"${resume}>Train it in rotation ${n} anyway</button>`;
  const back = '<button class="big ghost mt" data-act="sheet-close">Go back</button>';

  if (question.kind === 'done') {
    openSheet(`<div class="ttl">Already done this rotation</div>
      <p style="text-align:center;margin:14px 0 4px;font-size:14px;color:var(--ink)">Session <b>${id}</b> is already logged as ${escape(
        question.status
      )} in <b>rotation ${n}</b>.</p>
      <p style="text-align:center;font-size:13px">Starting it now records a second ${id} in rotation ${n}${
        question.canAdvance ? ` — not in rotation ${n + 1}.` : '.'
      }</p>
      ${question.canAdvance ? `<button class="big mt" data-act="advance-cycle">Start rotation ${n + 1} first</button>` : ''}
      ${previous}${anyway}${back}`);
    return;
  }

  const first = escape(question.first);
  openSheet(`<div class="ttl">Not the first session of the rotation</div>
    <p style="text-align:center;margin:14px 0 4px;font-size:14px;color:var(--ink)">Nothing is logged in <b>rotation ${n}</b> yet, and it starts with <b>${first}</b>.</p>
    <p style="text-align:center;font-size:13px">Starting ${id} now makes it the first session of rotation ${n}, out of order.</p>
    <button class="big mt" data-act="start-pick" data-id="${first}">Open ${first} instead</button>
    ${previous}${anyway}${back}`);
}

/* ═══════════════════════════════════════════════════════════════════════
   A forgotten Finish
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * A rest after the last set: what a late Finish is replaced with.
 *
 * Roughly a working set's rest, so the session is not cut off the moment the
 * last set was logged, and short enough that a forgotten Finish costs minutes
 * rather than hours.
 */
export const FINISH_REST_SECONDS = 3 * 60;

/**
 * An open session this long after its last set, or on another day, was
 * almost certainly left open rather than still being trained.
 */
export const STALE_SESSION_SECONDS = 3 * 60 * 60;

const lastStamp = (sets) =>
  (sets || []).map((set) => set?.timestampISO).filter(Boolean).sort().pop() || null;

/**
 * When a session ended, given the moment Finish was pressed.
 *
 * Finish stamped `endedAt = now`, unconditionally. Pressed hours after the
 * last set — forgotten, then remembered at home — that turned 57 minutes of
 * work into a 446-minute session, and an overnight one into 1350 minutes. It
 * happened in a quarter of his sessions and dominated the weekly session load.
 *
 * Pressed more than a long gap (`LONG_GAP_SECONDS`, the same 20 minutes that
 * stops counting as rest) after the last set, the session ends at that set
 * plus a rest. The button time is kept as `finishPressedAt`, so nothing about
 * what happened is thrown away.
 */
export function finishTimes(sets, now) {
  const last = lastStamp(sets);
  const lateBy = last ? (Date.parse(now) - Date.parse(last)) / 1000 : null;
  if (lateBy != null && lateBy > LONG_GAP_SECONDS) {
    return {
      endedAt: new Date(Date.parse(last) + FINISH_REST_SECONDS * 1000).toISOString(),
      finishPressedAt: now,
      endedAtSource: 'last-set',
      lastSetAt: last,
    };
  }
  return { endedAt: now, finishPressedAt: now, endedAtSource: 'finish', lastSetAt: last };
}

const pad2 = (n) => String(n).padStart(2, '0');
const clockTime = (iso) => {
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/**
 * Is the open session one that was left open, rather than one being trained?
 *
 * Stale when its last set (or its start, with no sets) is on an earlier civil
 * date, or more than three hours ago. Null otherwise. `day` is how the prompt
 * names it: today, yesterday, or the weekday.
 */
export function staleSession(log, sets, now) {
  if (!log) return null;
  const own = (sets || []).filter((set) => set.sessionLogId == null || set.sessionLogId === log.id);
  const lastSet = lastStamp(own);
  const last = lastSet || log.startedAt;
  if (!last) return null;
  const nowDate = new Date(now);
  const lastDay = localDateOf(last);
  const today = localDate(nowDate);
  const gap = (nowDate.getTime() - Date.parse(last)) / 1000;
  if (lastDay === today && gap <= STALE_SESSION_SECONDS) return null;

  const days = daysBetween(lastDay, today);
  const day =
    days === 0
      ? 'today'
      : days === 1
        ? 'yesterday'
        : new Date(last).toLocaleDateString('en-GB', { weekday: 'long' });
  return {
    kind: 'stale',
    sessionId: log.sessionId ?? null,
    logId: log.id,
    lastSetAt: lastSet,
    hasSets: !!lastSet,
    day,
    time: clockTime(last),
  };
}

/**
 * Ask before anything is added to a session that was left open.
 *
 * Nothing is closed, discarded or appended without a tap. Closing ends it at
 * its last set, the same rule as a late Finish.
 */
function askAboutStaleSession(question) {
  const whose = question.day === 'today' ? 'this' : question.day === 'yesterday' ? "yesterday's" : `${question.day}'s`;
  const when = question.day === 'today' ? 'today' : question.day === 'yesterday' ? 'yesterday' : `on ${question.day}`;
  const resume = question.resume ? ` data-si="${question.resume.si}" data-i="${question.resume.i}"` : '';
  openSheet(`<div class="ttl">Session ${escape(question.sessionId ?? '')} is still open</div>
    <p style="text-align:center;margin:14px 0 4px;font-size:14px;color:var(--ink)">${
      question.hasSets
        ? `Its last set was logged ${escape(when)} at <b>${escape(question.time)}</b>.`
        : `It was opened ${escape(when)} at <b>${escape(question.time)}</b> and has nothing logged.`
    }</p>
    <p style="text-align:center;font-size:13px">If you forgot to finish it, ${
      question.hasSets ? 'close it there' : 'discard it'
    }. Anything you log after that starts a new session.</p>
    ${
      question.hasSets
        ? `<button class="big mt" data-act="close-stale">Close ${escape(whose)} session at its last set (${escape(question.time)})</button>`
        : '<button class="big mt" data-act="discard-session">Discard it</button>'
    }
    <button class="big ghost mt" data-act="keep-stale"${resume}>Keep it open and log here</button>
    <button class="big ghost mt" data-act="sheet-close">Go back</button>`);
}

/* ═══════════════════════════════════════════════════════════════════════
   A number worth a second look
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Ask before saving a set that does not look like something that happened.
 *
 * Soft: "Save" saves exactly what was entered, "Fix" goes back to the editor
 * with it. 1025 typed for 102.5 used to save without a word, and a typo in a
 * working max prescribed 1197.5 kg for one tap to log. Returns true when it
 * asked, and the save is waiting on the answer.
 */
function askIfImplausible(ctx, pending) {
  const { state } = ctx;
  const logged = state.loggedSets.get(setKey(pending.si, pending.i));
  const warning = questionSet(
    {
      id: logged?.id,
      exerciseId: pending.slot.ex,
      load: pending.values.load,
      reps: pending.values.reps,
      bodyweightUsed: bodyweightFor(state, pending.slot.ex) || null,
    },
    state.sets,
    { exercise: state.plan.exercises[pending.slot.ex], fmt: questionFmt(state.settings.unit) }
  );
  if (!warning) return false;
  state.pendingSet = pending;
  openSheet(
    questionSheet([warning], {
      title: 'Check this set',
      note: SET_TYPO_NOTE,
      save: 'data-act="plausible-save"',
      fix: 'data-act="plausible-fix"',
    })
  );
  return true;
}

/** Put the caret in the editor's load box, once the sheet is drawn. */
function focusLoadBox() {
  globalThis.requestAnimationFrame?.(() => document.getElementById('in-load')?.focus?.());
}

/** Log a one-tap set, start the rest, and celebrate a record. */
async function commitTick(ctx, slotIndex, i, slot, values) {
  const result = await saveAsking(ctx, slotIndex, i, values);
  startRest(slot.restSec || ctx.state.plan.exercises[slot.ex].defaultRestSec);
  if (result?.beaten) ctx.celebrate?.(result.beaten);
}

/** Log the set in the editor, close it, and celebrate a record once it is gone. */
async function commitStep(ctx, values) {
  const c = ctx.state.sheetCtx;
  ctx.state.exOpen.add(String(c.si));
  const result = await ctx.saveSet(c.si, c.i, values);
  endStepEdit(ctx.state);
  startRest(c.slot.restSec || ctx.state.plan.exercises[c.slot.ex].defaultRestSec);
  closeSheet();
  ctx.render();
  // After the editor is gone, or closing it would close this too.
  if (result?.beaten) ctx.celebrate?.(result.beaten);
}

/** saveSet, with the row attached to any question it raises. */
async function saveAsking(ctx, slotIndex, setIndex, values) {
  try {
    return await ctx.saveSet(slotIndex, setIndex, values);
  } catch (error) {
    if (error instanceof NeedsAnswer) error.question.resume = { si: slotIndex, i: setIndex };
    throw error;
  }
}

/** One session's stored sets, keyed the way the Train screen reads them. */
export function loggedSetsFor(sets, sessionLogId) {
  return new Map(
    (sets || [])
      .filter((set) => set.sessionLogId === sessionLogId && !set.deletedAtISO)
      .map((set) => [setKey(set.slotIndex, set.setIndex), set])
  );
}

/**
 * The rotation the displayed session is resolved against.
 *
 * An open session's own, whatever the plan has moved on to. Logged sets are
 * keyed by position (`slotIndex:setIndex`), and the shape of a session changes
 * between rotations — FLOPIP's Friday has an AMRAP every other rotation, FOPIP
 * A gains a static hold at the front from rotation 11. Reopening a past
 * session, or advancing or correcting the rotation while one is open, used to
 * re-resolve it against the plan's current rotation, so its sets were drawn
 * under the wrong exercises and the next tick could displace them.
 *
 * This is the minimal safe fix rather than keying sets by slot id: it changes
 * no stored data, and a session's slot list can no longer change under its
 * own logged sets except through readiness, which is already refused when it
 * would reindex.
 */
export const sessionRotation = (state) => state.activeLog?.cycleSequence ?? state.cycle.sequence;

/** True for the blank ad-hoc session and for any saved custom workout. */
export const isOutsideRotation = (state, id = state.trainSessionId) =>
  id === CUSTOM_SESSION_ID || customWorkoutById(state, id) != null;

/*
 * A touch-and-go rep is worth about 4% more than a one-second pause, so mixing
 * the two silently corrupts the e1RM trend. Any barbell press records which it
 * was; everything else has no meaningful distinction to record.
 */
const PAUSE_STYLES = ['paused', 'touch-and-go'];
const tracksPause = (exerciseId) => exerciseId.startsWith('bench');

/**
 * Slots for the displayed session: the plan's, with swaps and additions.
 *
 * `readinessOverride` asks what the session *would* look like at a different
 * readiness, without changing anything. It exists so a readiness change can be
 * checked for safety before it is applied.
 */
export function slotsFor(state, readinessOverride) {
  /*
   * A saved custom workout has no block, no readiness adjustment and no
   * accessory multiplier — it is exactly what it says. Through the same display
   * transform as a plan session so the card reads identically, and with the
   * day's additions appended, so "add exercise" works here too.
   *
   * Swaps, options and added or removed sets apply here exactly as they do in a
   * plan session. They used to be read only on the plan path, so a swap in a
   * saved workout changed nothing on screen and "+ Set" crashed outright.
   */
  const saved = customWorkoutById(state, state.trainSessionId);
  if (saved) {
    const planned = (saved.slots || []).map((raw, i) =>
      withDeviations(state, toDisplaySlot({ ...raw, failSets: raw.failLast ?? 0 }, i), i)
    );
    return [...planned, ...extraSlots(state, planned.length)];
  }

  if (state.trainSessionId === CUSTOM_SESSION_ID) return extraSlots(state, 0);
  // Everything block-specific comes from the plan engine: the bench work for
  // this block, the failure permission for this rotation's effort mode, the
  // accessory multiplier, the static hold if one is offered, and any readiness
  // adjustment. The screen never decides what the session is.
  const resolved = toDisplaySession(
    resolveSession(state.plan, {
      rotation: sessionRotation(state),
      sessionId: state.trainSessionId,
      readiness: readinessOverride ?? state.readiness ?? 'normal',
    })
  );
  const planned = (resolved.slots || []).map((raw, i) => {
    /*
     * A prescription borrowed from another rotation.
     *
     * Only the work comes across — sets, reps, RPE, the load basis, rest, the
     * effort text. `ex` and `id` stay whatever this slot is, so borrowing
     * rotation 24's bench cannot turn your bench into something else, and the
     * Phases view keeps working because it is anchored on the id.
     *
     * If the borrowed rotation does not prescribe this slot at all, there is
     * nothing to borrow and the plan's own prescription stands. The Phases
     * sheet does not offer those rows, but a stored one could survive a plan
     * edit, so it is checked here too.
     */
    const borrowedFrom = state.deviations.phaseSwaps?.[String(i)];
    let slot = raw;
    if (borrowedFrom != null) {
      // Through the same display transform as the rest of the screen, or the
      // borrowed slot would carry the engine's raw field names — `failSets`
      // rather than `failLast`, no `reps` — and half of it would read blank.
      const other = toDisplaySession(
        resolveSession(state.plan, {
          rotation: Number(borrowedFrom),
          sessionId: state.trainSessionId,
          readiness: readinessOverride ?? state.readiness ?? 'normal',
        })
      );
      const lent = other.ok ? other.slots.find((candidate) => candidate.id === raw.id) : null;
      if (lent) {
        slot = { ...raw };
        for (const field of [...BORROWABLE_FIELDS, 'reps', 'myoReps']) slot[field] = lent[field];
        slot.borrowedFrom = Number(borrowedFrom);
      }
    }

    return withDeviations(state, slot, i);
  });
  return [...planned, ...extraSlots(state, planned.length)];
}

/**
 * One planned slot, with today's swap and today's added or removed sets.
 *
 * A slot never shows fewer rows than have already been logged against it.
 *
 * Anything that reshapes a session mid-way — switching to yellow, which removes
 * the last work set, or taking a set away — otherwise leaves a logged set with
 * nowhere to render. It stays in the database and in every export, but the
 * Train screen stops drawing it, stops counting it, and gives you no way to
 * un-tick it. A set that exists is always shown; whether the plan still asks
 * for it is a different question, answered by `beyondPlan`.
 *
 * `addedSets` may be negative — "− Set" takes a set away — but never below one.
 */
function withDeviations(state, slot, i) {
  const swappedTo = state.deviations.swaps?.[i];
  const extraSets = state.deviations.addedSets?.[i] || 0;
  const prescribed = Math.max(1, slot.sets + extraSets);
  const loggedHere = highestLoggedIndex(state, i);
  const sets = Math.max(prescribed, loggedHere + 1);

  /*
   * A label and a cue written for the planned exercise do not belong to its
   * replacement — "single leg, holding a dumbbell" under a shrug. Labels that
   * say what the slot is for (back-offs, AMRAP, index set) stay; exercise
   * labels go. A cue stays when the replacement is one of the slot's own
   * options, because those cues are written about both.
   */
  const swapped = !!swappedTo && swappedTo !== slot.ex;
  const keepsLabel = ['top_single', 'backoff', 'amrap', 'volume', 'attempt', 'test'].includes(slot.role);
  const isOption = swapped && (slot.options || []).includes(swappedTo);

  return {
    ...slot,
    ex: swappedTo || slot.ex,
    label: swapped && !keepsLabel ? null : slot.label,
    note: swapped && !isOption ? null : slot.note,
    sets,
    prescribedSets: prescribed,
    beyondPlan: sets > prescribed,
    swappedFrom: swapped ? slot.ex : null,
    // The exercise the plan wrote here, before any swap or option was taken —
    // what "option A" means, and what a swap reverts to.
    plannedEx: slot.ex,
    slotIndex: i,
  };
}

/**
 * The exercises added today, after the planned ones.
 *
 * Each carries `extraIndex`, its position in `deviations.extras`. Every action
 * that edits an added exercise used to work that position out as "slot index
 * minus the length of the session as written in the plan file" — but the
 * screen shows the session as *resolved*, and a block that removes a slot (the
 * AMRAP in an off week, the static hold in most rotations) made the two
 * lengths differ. "+ Set" then edited the wrong exercise or none at all.
 */
function extraSlots(state, offset) {
  return (state.deviations.extras || []).map((raw, j) => {
    const i = offset + j;
    const prescribed = Math.max(1, raw.sets);
    const loggedHere = highestLoggedIndex(state, i);
    const sets = Math.max(prescribed, loggedHere + 1);
    return {
      ...raw,
      sets,
      prescribedSets: prescribed,
      beyondPlan: sets > prescribed,
      added: true,
      extraIndex: j,
      slotIndex: i,
      plannedEx: raw.ex,
    };
  });
}

/** The highest setIndex already logged against a slot, or -1 for none. */
function highestLoggedIndex(state, slotIndex) {
  let highest = -1;
  for (const key of state.loggedSets.keys()) {
    const [si, i] = key.split(':').map(Number);
    if (si === slotIndex && i > highest) highest = i;
  }
  return highest;
}

/**
 * Would moving to this readiness leave already-logged sets attached to the
 * wrong exercise?
 *
 * Logged sets are keyed by position — `slotIndex:setIndex` — and readiness can
 * remove a slot outright. On rotation 11 session A the static hold sits at
 * index 0, so a red day shifts every slot up by one: the bench sets you logged
 * become the static hold, the incline becomes the bench, and editing any of
 * them rewrites the exercise in the database. Shrinking a slot is now
 * survivable (see above); reindexing is not, so it is refused instead.
 */
export function readinessWouldReindex(state, nextReadiness) {
  if (isOutsideRotation(state)) return false;
  const current = slotsFor(state);
  const next = slotsFor(state, nextReadiness);
  if (current.length !== next.length) return true;
  return current.some((slot, i) => slot.ex !== next[i].ex);
}

/**
 * The working max to prescribe from.
 *
 * Your own confirmed max first, then the seed. Failing both, an exercise may
 * declare `maxFrom` — a ratio against another lift — and be derived from it.
 *
 * That is how the bench variations work. A close-grip max is about 90% of a
 * competition max for almost everybody, so deriving it means the variation is
 * loaded correctly from the first session instead of being guessed at, and
 * confirming a new competition max recalibrates every variation at once. The
 * moment you confirm a max for the variation itself, that wins — a derived
 * number is a starting point, not a claim about you.
 */
export function workingMaxInfo(state, exerciseId, depth = 0) {
  const confirmed = state.maxes?.get(exerciseId);
  if (confirmed?.workingMax != null) {
    return { value: confirmed.workingMax, source: 'confirmed', setAtISO: confirmed.setAtISO ?? null };
  }

  const exercise = state.plan.exercises[exerciseId];
  const from = exercise?.maxFrom;
  if (from && depth < 3) {
    const parent = workingMaxInfo(state, from.exerciseId, depth + 1);
    if (parent?.value != null) {
      return { value: parent.value * from.ratio, source: 'ratio', ratio: from.ratio, parentId: from.exerciseId, parent };
    }
  }

  /*
   * No max of your own: what your recent sets show, before the plan's seed.
   * Only on lifts whose estimate is trustworthy — a compound, inside the
   * table's rep range, with an effort rating.
   */
  if (exercise?.tracksMax && exercise.maxConf === 'high') {
    const evidence = evidenceFor(state, exerciseId);
    if (evidence) return { value: evidence.value, source: 'evidence', evidence };
  }

  const seed = state.plan.meta?.seedWorkingMaxes?.[exerciseId];
  if (seed != null) return { value: seed, source: 'seed' };
  return null;
}

const workingMaxFor = (state, exerciseId) => workingMaxInfo(state, exerciseId)?.value ?? null;

/*
 * The evidence is recomputed only when the sets, the open session or the day
 * change — it is read for every row of every card on every render.
 */
let evidenceMemo = { sets: null, active: null, today: null, byExercise: new Map() };
function evidenceFor(state, exerciseId) {
  const active = state.activeLog?.id ?? null;
  if (evidenceMemo.sets !== state.sets || evidenceMemo.active !== active || evidenceMemo.today !== state.todayISO) {
    evidenceMemo = { sets: state.sets, active, today: state.todayISO, byExercise: new Map() };
  }
  if (!evidenceMemo.byExercise.has(exerciseId)) {
    evidenceMemo.byExercise.set(
      exerciseId,
      recentEvidenceMax(state.sets || [], state.logs || [], exerciseId, {
        todayISO: state.todayISO ?? null,
        excludeLogId: active,
      })
    );
  }
  return evidenceMemo.byExercise.get(exerciseId);
}

/**
 * Today's top single, as a max, when it has been logged.
 *
 * Back-offs are meant to come from the single you actually pressed today — the
 * plan said so and the screen did not do it: they were taken from the stored
 * working max, so a strong day and a weak day got the same back-offs. A single
 * logged earlier in this session, on the same lift, at one rep with an effort
 * rating, is now what they are worked out from.
 */
function todaysSingle(state, slot) {
  let best = null;
  for (const set of state.loggedSets?.values?.() || []) {
    if (set.exerciseId !== slot.ex || set.reps !== 1 || set.rpe == null || set.load == null || set.formBreakdown) continue;
    if (set.attemptResult === 'missed') continue; // a weight he failed is not today's max
    if (slot.slotIndex != null && set.slotIndex >= slot.slotIndex) continue;
    const value = e1rm(systemLoad(set.load, set.bodyweightUsed || 0), 1, Math.min(10, set.rpe));
    if (value != null && (!best || value > best.value)) best = { value, set };
  }
  return best;
}

/** The max a slot's load is worked out from: today's single for back-offs, else the working max. */
function prescriptionMax(state, slot) {
  if (slot.pctBasis === 'topSingleRpe') {
    const single = todaysSingle(state, slot);
    if (single) return { value: single.value, single };
  }
  return { value: workingMaxFor(state, slot.ex), single: null };
}

/**
 * Bodyweight counts as part of the load on pull-ups, chin-ups and dips, so the
 * maths runs on bodyweight + added and the screen shows the added weight.
 * Everything else gets 0 and behaves exactly as before.
 *
 * Today's bodyweight comes from `bodyweightOn`, the same function the saved set
 * takes its `bodyweightUsed` from. This read the Settings figure (90) while the
 * stored set used his weigh-ins (91.1), so the same chin-up showed e1RM 137.8
 * here and 139.2 in the Log, and its prescription and typo check used 90.
 */
const bodyweightFor = (state, exerciseId) =>
  state.plan.exercises[exerciseId]?.bodyweightLoaded
    ? bodyweightOn(state.daily || [], state.todayISO, state.settings.bodyweight)
    : 0;

const loadOptions = (state, exerciseId) => ({ bodyweight: bodyweightFor(state, exerciseId) });

/**
 * Every attempt logged for a lift, oldest first.
 *
 * Ordered by when the set was written rather than by rotation, because that is
 * the order they were actually pressed in — a session logged late, or repaired
 * into an earlier rotation, must not reorder the ladder underneath itself.
 */
const attemptsFor = (state, exerciseId) =>
  (state.sets || [])
    .filter((set) => set.exerciseId === exerciseId && (set.attemptResult === 'made' || set.attemptResult === 'missed'))
    .sort((a, b) => String(a.timestampISO).localeCompare(String(b.timestampISO)))
    .map((set) => ({ load: set.load, result: set.attemptResult }));

/**
 * What the weekly attempt should be loaded to. Null for every other slot, so
 * the ordinary prescription path is untouched.
 */
export const attemptTargetFor = (state, slot) =>
  slot?.role === 'attempt'
    ? nextAttemptLoad(attemptsFor(state, slot.ex), {
        /*
         * `attemptStart` is where the ladder begins before anything has been
         * attempted — the weight he has decided to go after, which is not the
         * same as the working max the rest of the plan is prescribed from.
         * Seeding from the working max would have opened at 115 kg; seeding the
         * working max at 120 instead would have made every other slot in the
         * plan behave as though he had already lifted it.
         *
         * It is ignored the moment a real attempt exists, because from then on
         * the ladder is made of things that actually happened.
         */
        seed: slot.attemptStart ?? workingMaxFor(state, slot.ex),
        step: state.settings.increment,
      })
    : null;

const prescriptionFor = (state, slot) =>
  prescribedLoad(slot, prescriptionMax(state, slot).value, state.settings.increment, {
    ...loadOptions(state, slot.ex),
    fixedLoad: attemptTargetFor(state, slot),
  });

const isFailureSet = (slot, i) => !!slot.failLast && i >= slot.sets - slot.failLast;

/*
 * Only the first set in an AMRAP slot is the AMRAP. Extra sets added there are
 * training, not measurements — they used to be stored as AMRAPs too, which put
 * five "AMRAP readings" of 7, 5, 4, 4, 4 into one day and dragged the trend
 * down with sets that were never meant to measure anything.
 */
const isAmrapSet = (slot, i) => !!slot.amrap && i === 0;

/**
 * A row whose numbers are the measurement: the AMRAP, a test, the attempt.
 * Nothing may fill these in for you — not a tick, not "same as last time".
 */
const isMeasurementRow = (slot, i) => isAmrapSet(slot, i) || !!slot.isTest || slot.role === 'attempt';

/** What the row is displaying, so a one-tap set stores it rather than null. */
const defaultGrip = (state, slot, slotIndex) => {
  const exercise = state.plan.exercises[slot.ex];
  if (!exercise?.grips?.length) return null;
  return state.grips[`${state.trainSessionId}-${slotIndex}`] || exercise.grips[0];
};

/*
 * What each plan says about how its bench lifts are performed.
 *
 * The two plans disagree about the competition bench, and each is right about
 * itself. FOPIP v2: "The competition bench is always controlled touch-and-go.
 * All paused competition-grip work lives in the long-pause lift" — except its
 * AMRAP ("a fixed 100 kg, paused") and the weekly attempt ("Paused, spotted",
 * the note plan.js writes on it). FLOPIP 2 writes "paused" on every
 * competition-bench slot, Sunday volume, Friday single, AMRAP and test alike
 * (docs/training-plan-flopip-2.md).
 *
 * Keyed `exercise` or `exercise@role`; the role entry wins.
 */
const PLAN_PAUSE = Object.freeze({
  'fopip-v2': { benchComp: 'touch-and-go', 'benchComp@amrap': 'paused', 'benchComp@attempt': 'paused' },
  'flopip-2': { benchComp: 'paused' },
});

/*
 * What a lift is, whatever the plan. Long-pause is paused by definition. Pin
 * press starts from the pins and speed bench is about bar speed, so neither has
 * a pause style worth stamping. Anything else is left for the lifter to say.
 */
const EXERCISE_PAUSE = Object.freeze({ benchPause: 'paused', benchPin: null, benchSpeed: null });

/**
 * The pause style a bench set is stored with unless you choose another.
 *
 * One source, used by the tick, by "same as last time" and by the set editor.
 * The tick used to stamp "paused" on every exercise whose id began with
 * `bench` and the editor stamped nothing, so the same set got a different
 * stored value depending on which button logged it.
 *
 * In order: a pause style the slot states as a field; a slot whose own text
 * says paused or touch-and-go (FLOPIP writes it there) — unless it has been
 * swapped, because the label survives a swap and a pin press in a slot
 * labelled "paused" is still a pin press; the plan's statement; the lift's.
 */
export function defaultPause(state, slot) {
  if (!slot || !tracksPause(slot.ex)) return null;
  if (PAUSE_STYLES.includes(slot.pauseStyle)) return slot.pauseStyle;
  if (!slot.swappedFrom) {
    const said = `${slot.label || ''} ${slot.note || ''}`;
    if (/touch-and-go/i.test(said)) return 'touch-and-go';
    if (/\bpaused\b/i.test(said)) return 'paused';
  }
  const stated = PLAN_PAUSE[state.plan?.meta?.id] || {};
  const byRole = stated[`${slot.ex}@${slot.role}`];
  if (byRole !== undefined) return byRole;
  if (stated[slot.ex] !== undefined) return stated[slot.ex];
  return EXERCISE_PAUSE[slot.ex] ?? null;
}

/** What this exercise looked like last time, for the prefill and the hint. */
function lastTime(state, exerciseId) {
  const previous = state.lastByExercise.get(exerciseId);
  if (!previous?.sets?.length) return null;
  const loads = previous.sets.map((s) => s.load);
  const sameLoad = loads.every((l) => l === loads[0]);
  const reps = previous.sets.map((s) => (s.reps == null ? '—' : s.reps)).join(',');

  // How long ago, in the unit anyone actually uses for it.
  const days = daysBetween(previous.dateISO, state.todayISO ?? previous.dateISO);
  const ago =
    days == null || days < 0
      ? null
      : days === 0
        ? 'today'
        : days === 1
          ? 'yesterday'
          : `${days} days ago`;

  return {
    ...previous,
    ago,
    days,
    summary: sameLoad
      ? `${fmtLoad(loads[0], state.settings.unit)} ${state.settings.unit} × ${reps}`
      : previous.sets
          .map((s) => `${fmtLoad(s.load, state.settings.unit)}×${s.reps ?? '—'}`)
          .join(' · '),
  };
}

/**
 * What you did last time, at a size you can read between sets.
 *
 * It used to be one grey hint line under the sets, in the same weight as
 * everything else on the card, giving the loads and a bare ISO date. The number
 * you are trying to beat is the most useful thing on the screen at the moment
 * you are standing over the bar, so it is now the most legible: the loads and
 * reps large, and beside them which session it was and how long ago, because
 * "session B, three days ago" tells you whether to expect to beat it and
 * "2026-08-19" does not.
 */
/**
 * " · FOPIP" when last time was trained under a different plan.
 *
 * Both plans letter their sessions from A, so "session B" alone would point at
 * the wrong workout the moment you switch.
 */
function otherPlanName(state, previous) {
  const own = previous?.planId;
  const active = state.plan?.meta?.id;
  if (!own || !active || own === active) return '';
  return ` \u00b7 ${escape(state.plans?.[own]?.meta?.name || own)}`;
}

export function lastTimePanel(state, previous, slot) {
  if (!previous) return '<div class="lastbox none">No previous data — today sets the baseline.</div>';

  const unit = state.settings.unit;
  const best = previous.sets.reduce(
    (top, set) => (set.load != null && (top == null || set.load > top.load) ? set : top),
    null
  );

  return `<div class="lastbox">
    <div class="lb-h">Last time${previous.sessionId ? ` · session ${escape(previous.sessionId)}${otherPlanName(state, previous)}` : ''}${
      previous.ago ? ` · ${escape(previous.ago)}` : ''
    }</div>
    <div class="lb-v">${escape(previous.summary)}</div>
    ${
      best?.rpe != null
        ? `<div class="lb-s">Top set ${escape(fmtLoad(best.load, unit))} ${escape(unit)} × ${
            best.reps ?? '—'
          } at RPE ${escape(String(best.rpe))}</div>`
        : ''
    }
    ${lastTimeEstimates(state, previous, slot)}
    ${previous.note ? `<div class="lb-n">${escape(previous.note)}</div>` : ''}
  </div>`;
}

/**
 * Last session's estimated max, set by set, in the same order as the loads
 * above it.
 *
 * The panel already answered "what did I lift"; it did not answer "was it any
 * good", and that is the question you are actually asking at the bar. Two sets
 * of the same weight for the same reps at RPE 8 and RPE 10 are a large
 * difference in what they say about your max, and reading that off three
 * separate numbers in your head between sets is not something anyone does.
 *
 * Every estimate comes from `estimateForSet`, so bodyweight lifts are estimated
 * on bodyweight + added like everywhere else — marked, because a 128 kg chin-up
 * e1RM next to a 6 kg entry is otherwise baffling. Sets the table cannot
 * express say so instead of showing a number, and the low-confidence Epley
 * fallback is marked rather than mixed in silently.
 */
function lastTimeEstimates(state, previous, slot) {
  const bodyweight = slot ? bodyweightFor(state, slot.ex) : 0;
  const estimates = previous.sets.map((set) => estimateForSet(set, { bodyweight }));
  const usable = estimates.filter((estimate) => estimate?.value != null);
  if (!usable.length) {
    const first = previous.sets[0];
    const why = first && noEstimateReason(first.load, first.reps, first.rpe, { short: true });
    return why ? `<div class="lb-e none">No estimated max — ${escape(why)}</div>` : '';
  }

  const top = Math.max(...usable.map((estimate) => estimate.value));
  const cells = estimates
    .map((estimate) => {
      if (estimate?.value == null) return '<span class="e-x">—</span>';
      const text = escape(fmtLoad(estimate.value, state.settings.unit));
      const classes = ['e-v'];
      if (estimate.value === top) classes.push('e-top');
      if (estimate.confidence !== 'high') classes.push('e-low');
      return `<span class="${classes.join(' ')}" title="${escape(estimate.reason || 'from the RPE table')}">${text}</span>`;
    })
    .join('<i>·</i>');

  return `<div class="lb-e">
    <span class="e-k">e1RM</span>
    ${cells}
    <span class="e-u">${escape(state.settings.unit)}</span>
    ${bodyweight ? '<span class="e-bw">on bodyweight + added</span>' : ''}
  </div>`;
}


/**
 * The values a row shows. Anything logged wins; then the prescription, or last
 * session's load when there is no max to prescribe from; and nothing at all
 * once the prescribed values have been cleared.
 */
export function rowValues(state, slot, slotIndex, setIndex) {
  const logged = state.loggedSets.get(setKey(slotIndex, setIndex));
  const cleared = state.cleared.has(String(slotIndex));
  const toFailure = isFailureSet(slot, setIndex);
  const prescribed = prescriptionFor(state, slot);
  const previous = lastTime(state, slot.ex);
  const previousLoad = previous?.sets?.[setIndex]?.load ?? previous?.sets?.[0]?.load ?? null;

  const fallbackLoad = prescribed ?? previousLoad;
  return {
    logged,
    toFailure,
    prescribed,
    load: logged ? logged.load : cleared ? null : fallbackLoad,
    reps: logged ? logged.reps : cleared ? null : slot.reps,
    rpe: logged ? logged.rpe : toFailure ? 10 : slot.rpe,
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   View
   ═══════════════════════════════════════════════════════════════════════ */

export function view(ctx) {
  const { state } = ctx;
  const saved = customWorkoutById(state, state.trainSessionId);
  const isCustom = isOutsideRotation(state);
  const session = saved
    ? { id: saved.id, name: saved.name, purpose: saved.purpose }
    : isCustom
      ? { id: 'Custom', name: 'Custom workout', purpose: `An ad-hoc session that does not advance or change the ${rotationSpan(state)} rotation.` }
      : state.plan.sessions.find((s) => s.id === state.trainSessionId);
  const slots = slotsFor(state);
  const resolved = isCustom
    ? { effortMode: 'none', accessoryMultiplier: 1, blockType: 'custom' }
    : resolveSession(state.plan, {
        rotation: sessionRotation(state),
        sessionId: state.trainSessionId,
        readiness: state.readiness || 'normal',
      });
  const unit = state.settings.unit;

  let prescribedSets = 0;
  let doneSets = 0;
  slots.forEach((slot, si) => {
    prescribedSets += slot.sets;
    for (let i = 0; i < slot.sets; i++) if (state.loggedSets.has(setKey(si, i))) doneSets++;
  });

  /*
   * Where this session sits in the rotation, and whether it has already been
   * done in it.
   *
   * A finished rotation used to preselect the next rotation's first session
   * while the app was still on the old one — so training it filed the session
   * against a rotation that was already complete, gave position A a second log,
   * and produced "that completes rotation N" all over again. Nothing here
   * advances the rotation, which is deliberate; what it does now is refuse to
   * pretend the rotation has advanced.
   */
  const rotationFinished = !isCustom && state.cycleProgress.finished;
  const positionStatus = isCustom
    ? null
    : state.cycleProgress.positions.find((p) => p.position === state.trainSessionId)?.status ?? 'pending';
  const alreadyDone = positionStatus === 'complete' || positionStatus === 'partial';

  const isNext = !isCustom && !rotationFinished && state.trainSessionId === state.position.nextSessionId;
  const label = isCustom
    ? `Outside the rotation · next remains ${escape(state.position.nextSessionId)}`
    : rotationFinished
    ? `Rotation ${state.cycle.sequence} is complete`
    : isNext
    ? // Which session of *this* rotation, not how many have ever been trained.
      // It read "session 7" on the first session of rotation 2, which is true
      // of the plan and useless on a screen about a six-session rotation.
      `Next in rotation · session ${state.plan.meta.rotationOrder.indexOf(state.trainSessionId) + 1} of ${
        state.plan.meta.rotationOrder.length
      }`
    : alreadyDone
    ? `Already done this rotation · next up is ${escape(state.position.nextSessionId)}`
    : `Picked manually · next up is ${escape(state.position.nextSessionId)}`;

  return `
  <div class="picker">${state.plan.meta.rotationOrder
    .map(
      (id) =>
        `<button class="pill ${id === state.trainSessionId ? 'on' : ''}" data-act="pick-session" data-id="${id}">${id}</button>`
    )
    /*
     * Rotation order, not the order the sessions happen to sit in the file.
     * They were the same until the rotation became A D E F C B, at which point
     * the picker read A B C D E F while the Plan screen — which has always
     * mapped `rotationOrder` — read the real thing. Tapping left to right has
     * to be the order you actually train in.
     */
    .join('')}${(state.plan.customWorkouts || [])
      .map(
        (w) =>
          `<button class="pill custom ${w.id === state.trainSessionId ? 'on' : ''}" data-act="pick-session" data-id="${escape(
            w.id
          )}" title="${escape(w.name)}">${escape(w.id)}</button>`
      )
      .join('')}<button class="pill custom ${
    state.trainSessionId === CUSTOM_SESSION_ID ? 'on' : ''
  }" data-act="pick-session" data-id="${CUSTOM_SESSION_ID}">Custom</button></div>

  ${state.calibration && !isCustom ? calibrationCard() : ''}

  ${isCustom ? '' : readinessBar(state)}

  <div class="shead">
    <div class="lbl">${label}</div>
    <div class="nm">${escape(session.id)} · ${escape(session.name)}</div>
    ${session.day ? `<p class="why" style="margin-bottom:4px"><b>${escape(session.day)}</b>${
      session.trains ? ` \u00b7 ${escape(session.trains)}` : ''
    }</p>` : ''}
    <p class="why">${escape(session.purpose)}</p>
    <div class="bar"><i style="width:${prescribedSets ? (doneSets / prescribedSets) * 100 : 0}%"></i></div>
    <div class="meta">
      <span>${doneSets} / ${prescribedSets} sets</span>
      <span>~${Math.round(sessionClock(state, slots).totalSeconds / 60)} min incl. warm-ups</span>
      <span>${isCustom ? 'Does not advance the plan' : `Cycle ${state.cycle.sequence}/${state.plan.meta.rotations} · ${escape(state.block.name)}`}</span>
      <span>${state.cycleProgress.complete}/${state.plan.meta.rotationOrder.length} planned sessions this rotation</span>
    </div>
    ${
      resolved.effortMode === 'high' || resolved.effortMode === 'standard'
        ? `<p class="hint" style="margin-top:8px">Effort mode: <b>${escape(resolved.effortMode)} failure</b>${
            resolved.accessoryMultiplier < 1
              ? ` · accessories at ${Math.round(resolved.accessoryMultiplier * 100)}%`
              : ''
          }</p>`
        : resolved.blockType === 'recovery' || resolved.blockType === 'taper' || resolved.blockType === 'test'
          ? `<p class="hint" style="margin-top:8px"><b>${escape(resolved.blockName)}</b> — reduced volume, nothing to failure.</p>`
          : ''
    }
    ${
      saved
        ? `<p class="hint" style="margin-top:8px"><b>${escape(
            saved.name
          )}</b> — outside the rotation. It is logged and counted in History and analytics, but never advances or replaces ${rotationSpan(state)}.${
            saved.key ? ` ${escape(saved.key)}` : ''
          }</p>`
        : isCustom
        ? `<p class="hint" style="margin-top:8px">Add any exercises below. Custom work still appears in History and analytics, but never replaces ${rotationSpan(state)}.</p>`
        : `<div class="mini" style="margin-top:10px"><button data-act="open-cycle-control">Rotation ${state.cycle.sequence} · correct</button></div>`
    }
  </div>

  ${rotationFinished && !state.activeLog ? rotationDoneCard(state) : ''}

  ${
    state.activeLog
      ? `<div class="mini session-actions"><button class="warn" data-act="discard-session">Discard session</button></div>`
      : slots.length
        ? `<button class="big train-start" data-act="start-session">Start session</button>
           <p class="hint train-start-hint">Starts the clock before your warm-up. If you skip this, the first logged set starts it automatically.</p>`
        : '<p class="hint train-start-hint"><b>Add an exercise to build this workout.</b> The clock will not start while you are choosing.</p>'
  }

  ${sessionProgressCard(state, slots)}

  ${slots.length ? `<div class="card flush">${slots.map((slot, si) => exerciseBlock(state, slot, si)).join('')}</div>` : ''}

  <div class="mini" style="margin:0 2px 12px"><button data-act="open-add">+ Add exercise</button><button data-act="open-timer">Timer</button></div>

  <div class="card">
    <label for="session-note">Session note</label>
    <textarea id="session-note" rows="2" data-bind="note" placeholder="Anything worth remembering…">${escape(state.draft.note)}</textarea>
    <div class="g2 mt">
      <div><label for="session-bw">Bodyweight (${unit})</label>
        <input id="session-bw" type="number" inputmode="decimal" step="0.1" data-bind="bodyweight" value="${escape(state.draft.bodyweight)}"></div>
      <div><label for="session-rpe">Session RPE</label>
        <input id="session-rpe" type="number" inputmode="decimal" step="0.5" data-bind="sessionRpe" value="${escape(state.draft.sessionRpe)}"></div>
    </div>
    <p class="hint">Session RPE = how hard the <b>whole session</b> felt, 0–10, rated about 20 minutes after you finish. Multiplied by duration it gives a session load — the earliest warning sign that weekly fatigue is climbing, usually a week before you feel it.</p>
    ${timingRow(state)}
    <button class="big mt" data-act="finish">Finish session</button>
  </div>`;
}

/**
 * Is the clock telling the truth about this session?
 *
 * Every set has always stored the moment it was ticked, so rest and session
 * length come free — but only when the ticks happened when the work did. Log
 * the whole session from memory on the bus home and the timestamps are all
 * within a minute of each other, which would report eight seconds of rest
 * between working sets and look like a measurement rather than an artefact.
 *
 * So it is stated rather than assumed. The default is that it is real, because
 * usually it is; this is the switch for the times it is not. Everything else
 * about the session is unaffected either way — only the timing report is.
 */
function timingRow(state) {
  const log = state.activeLog;
  const reliable = log ? log.timingReliable !== false : true;
  const started = log?.startedAt ? new Date(log.startedAt) : null;

  return `<div class="timing-row mt">
    <div>
      <b>${reliable ? 'Timing is real' : 'Timing is not meaningful'}</b>
      <span>${
        reliable
          ? started
            ? `Running since ${started.getHours()}:${String(started.getMinutes()).padStart(2, '0')} — rest and session length will be recorded.`
            : 'Rest and session length will be recorded from when you tick each set.'
          : 'Logged after the fact, so rest and duration will not be reported for this session. Everything else is kept.'
      }</span>
    </div>
    <button data-act="toggle-timing">${reliable ? 'Not really' : 'It is real'}</button>
  </div>`;
}

/**
 * The session's cost in seconds, warm-ups included, and how much of it is done.
 *
 * The prescribed loads have to be gathered first because the warm-up ramp is
 * computed from the top load of each exercise — there is no ramp without a
 * number to ramp to.
 */
export function sessionClock(state, slots) {
  const prescribedLoads = {};
  slots.forEach((slot, i) => {
    const load = prescriptionFor(state, slot);
    if (load != null) prescribedLoads[i] = load;
  });

  const completed = new Set();
  slots.forEach((slot, i) => {
    for (let j = 0; j < slot.sets; j++) if (state.loggedSets.has(setKey(i, j))) completed.add(`${i}:${j}`);
  });

  return sessionDuration(slots, {
    exercises: state.plan.exercises,
    bar: state.settings.barKg,
    increment: state.settings.increment,
    prescribedLoads,
    completed,
  });
}

const asClock = (seconds) => {
  const value = Math.max(0, Math.round(seconds));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const sec = value % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

/**
 * Where you are in the session, in minutes rather than in sets.
 *
 * Three different numbers, and they answer three different questions. Elapsed
 * is wall-clock since you started and is the only one that is measured — it
 * ticks from `data-since` against Date.now(), never from counted intervals, for
 * the reason the rest timer had to be rewritten. Done and left are the *plan*
 * spent and owed: warm-up ramps plus every set plus the rest between them.
 *
 * They will not agree, and that is the useful part. Elapsed well past done
 * means the rests are running long.
 */
function sessionProgressCard(state, slots) {
  const clock = sessionClock(state, slots);
  const started = state.activeLog?.startedAt || null;
  const pct = clock.totalSeconds ? Math.min(100, (clock.doneSeconds / clock.totalSeconds) * 100) : 0;

  return `<div class="card sess">
    <div class="g3">
      <div class="tstat"><b id="sess-elapsed" data-since="${escape(started || '')}">${
        started ? asClock((Date.now() - Date.parse(started)) / 1000) : '—'
      }</b><span>${started ? 'elapsed' : 'not started'}</span></div>
      <div class="tstat"><b>${Math.round(clock.doneSeconds / 60)}<small> min</small></b><span>of plan done</span></div>
      <div class="tstat"><b>${Math.round(clock.remainingSeconds / 60)}<small> min</small></b><span>left</span></div>
    </div>
    <div class="bar mt"><i style="width:${pct}%"></i></div>
    <p class="hint" style="margin:8px 0 0">About <b>${Math.round(clock.totalSeconds / 60)} min</b> in total —
    ${Math.round(clock.warmupSeconds / 60)} of warm-up ramps and ${Math.round(clock.workingSeconds / 60)} of work
    and rest. Estimates, at ${SET_SETUP_SECONDS} s to get set and ${SECONDS_PER_REP} s a rep.${
      started ? '' : ' <b>Start session</b> above begins the clock; logging a set starts it automatically.'
    }</p>
  </div>`;
}

/**
 * A duration estimate from the work actually prescribed, not a fixed string.
 * v1 carried hand-written minute ranges that went stale the moment the plan
 * changed. Roughly the rest between sets plus about 40 seconds of work each.
 */
export function estimateMinutes(state, slots) {
  const seconds = slots.reduce((total, slot) => {
    const rest = slot.restSec || state.plan.exercises[slot.ex]?.defaultRestSec || 90;
    return total + slot.sets * (rest + 40);
  }, 0);
  const minutes = Math.round(seconds / 60);
  return `${Math.round(minutes * 0.9 / 5) * 5}–${Math.round(minutes * 1.1 / 5) * 5}`;
}

/**
 * The rotation is finished and the plan has not been moved on yet.
 *
 * This is the state the owner got stuck in. The app will not advance on its
 * own — that is a deliberate rule, because the rotation number decides the
 * block, the effort wave and every prescribed load — but leaving the screen
 * looking like an ordinary session is how a session ends up filed against a
 * rotation that finished a week ago.
 */
/** "A–F", or "A–E": the letters of this plan's rotation, for the sentences that name them. */
const rotationSpan = (state) => {
  const order = state.plan?.meta?.rotationOrder || [];
  const sorted = [...order].sort();
  return sorted.length ? `${sorted[0]}–${sorted[sorted.length - 1]}` : 'the';
};

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];

function rotationDoneCard(state) {
  const last = state.cycle.sequence >= state.plan.meta.rotations;
  const count = state.plan.meta.rotationOrder.length;
  return `<div class="rotdone">
    <div class="rd-h">Rotation ${state.cycle.sequence} of ${state.plan.meta.rotations} is complete</div>
    <p>All ${NUMBER_WORDS[count] || count} sessions are done. ${
      last
        ? 'That is the last rotation of the plan.'
        : `Anything you train now is still recorded against <b>rotation ${state.cycle.sequence}</b> until you move the plan on.`
    }</p>
    ${
      last
        ? ''
        : `<button class="big" data-act="advance-cycle">Start rotation ${state.cycle.sequence + 1}</button>
           <p class="hint">You can still train without advancing — it just goes into rotation ${state.cycle.sequence}.</p>`
    }
  </div>`;
}

/**
 * Say so when the load being logged is a long way above what was prescribed.
 *
 * Not a block — going heavier is allowed and sometimes right. But the whole
 * reason the plan prescribes an RPE is that the load is supposed to land
 * there, and a session run 7.5 kg over at three RPE points harder than asked
 * is worth seeing at the moment it happens rather than four sessions later
 * when the back is already sore.
 */
const OVERSHOOT_KG = 5;

/**
 * The weekly attempt's two buttons, and what each one does to the plan.
 *
 * Made and missed are not a flag and its absence — an unanswered attempt is a
 * third state, and it has to stay distinguishable from a missed one or the
 * ladder cannot tell "did not say" from "did not lift it".
 */
function attemptButtons(state, c) {
  if (c.slot?.role !== 'attempt') return '';

  const unit = state.settings.unit;
  const next = c.load == null ? null : c.load + state.settings.increment;
  const made = c.attemptResult === 'made';
  const missed = c.attemptResult === 'missed';

  const outcome = made
    ? `<b>Recorded as made.</b> Logging this sets your working max to ${escape(fmtLoad(c.load, unit))} ${escape(unit)}
       and every prescription in the plan — the bench variations included — recalculates from it. Next week asks for
       ${escape(fmtLoad(next, unit))} ${escape(unit)}.`
    : missed
      ? `<b>Recorded as missed.</b> Your working max does not move, and next week asks for
         ${escape(fmtLoad(c.load, unit))} ${escape(unit)} again. A miss is information about the day, not proof the
         load is wrong.`
      : `<b>Say what happened before you log it.</b> The attempt is the only set in the plan that can move your
         working max, so it does not move on its own.`;

  return `<div class="mini" style="justify-content:center;margin-bottom:10px">
      <button data-act="attempt-result" data-id="made" class="${made ? 'good' : ''}">${made ? '\u2713 ' : ''}Made it</button>
      <button data-act="attempt-result" data-id="missed" class="${missed ? 'crit' : ''}">${missed ? '\u2713 ' : ''}Missed it</button>
    </div>
    <p class="hint" style="margin:-4px 2px 12px;color:var(--s2)">${outcome}</p>`;
}

/**
 * What a bench variation is worth, next to the competition lift.
 *
 * The variations are not lighter versions of the same thing — each one has its
 * own 1RM, and the plan states that as a fraction of the competition max. That
 * fraction is the whole reason the loads differ, and without it on screen a
 * 77.5 kg double pause next to a 100 kg back-off reads as a light day rather
 * than as the same effort against a different lift.
 *
 * He ran variations at close to his competition weight for months because the
 * relationship was written in a document and not in the app.
 */
function variationNote(state, exerciseId) {
  const exercise = state.plan.exercises[exerciseId];
  const from = exercise?.maxFrom;
  if (!from) return '';

  const parent = state.plan.exercises[from.exerciseId];
  const parentMax = workingMaxFor(state, from.exerciseId);
  const unit = state.settings.unit;
  const asPct = (ratio) => `${(ratio * 100).toFixed(0)}%`;
  const own = workingMaxFor(state, exerciseId);
  const confirmed = state.maxes.get(exerciseId)?.workingMax != null;

  const band = from.range
    ? `Yours should settle between <b>${asPct(from.range[0])}</b> and <b>${asPct(from.range[1])}</b>.`
    : '';

  const kilos =
    parentMax == null || own == null
      ? ''
      : ` From a ${escape(fmtLoad(parentMax, unit))} ${escape(unit)} ${escape(
          (parent?.name || 'competition').toLowerCase()
        )} max that is <b>${escape(fmtLoad(own, unit))} ${escape(unit)}</b> for this lift, and the working weight comes off the RPE table from there.`;

  const calibrating = confirmed
    ? ' You have confirmed a max for this lift, so that is what it uses — the percentage is only the starting point.'
    : ' If the RPE comes out a point high or low across three or four sessions, the percentage is wrong rather than you.';

  return `<div class="cue" style="border-left-color:var(--s3)"><b>${escape(
    asPct(from.ratio)
  )} of your ${escape((parent?.name || 'competition bench').toLowerCase())}.</b> ${band}${kilos}${calibrating}</div>`;
}

function overshootNote(state, c) {
  // On the weekly attempt, choosing the weight is the slot's entire purpose.
  // Warning that a chosen attempt is heavier than the suggested one is noise.
  if (c.slot?.role === 'attempt') return '';
  const prescribed = prescriptionFor(state, c.slot);
  if (prescribed == null || c.load == null) return '';
  const over = c.load - prescribed;
  if (over < OVERSHOOT_KG) return '';

  const unit = state.settings.unit;
  return `<p class="hint" style="margin:-6px 2px 12px;color:var(--s2)"><b>${escape(
    fmtLoad(over, unit)
  )} ${escape(unit)} above the prescription.</b> This slot asks for ${escape(
    fmtLoad(prescribed, unit)
  )} ${escape(unit)} at RPE ${escape(String(c.slot.rpe))}${
    c.slot.amrap ? '' : ` × ${escape(String(c.slot.reps))}`
  }. Going heavier is your call — just know you are choosing it, not following it.</p>`;
}

/**
 * Readiness is today's answer, not the plan's. It changes what is prescribed
 * for this session only: yellow trims the last set and replaces the AMRAP,
 * red removes the AMRAP, the holds and every grind.
 */
function readinessBar(state) {
  const current = state.readiness || 'normal';
  const options = [
    ['normal', 'Normal'],
    ['yellow', 'Yellow — poor sleep, slow warm-up'],
    ['red', 'Red — pain or illness'],
  ];
  // The picker stays on screen whatever is selected. It used to be replaced by
  // the warning once a day was flagged, which left "Back to normal" as the only
  // move — you could not go from yellow to red without going through normal
  // first, and on a day that is getting worse rather than better that is
  // exactly the move you want.
  const picker = `<div class="picker" style="margin-bottom:4px">${options
    .map(
      ([id, label]) =>
        `<button class="pill ${id === current ? 'on' : ''}" data-act="readiness" data-id="${id}">${escape(
          id === 'normal' ? 'Normal' : label.split(' — ')[0]
        )}</button>`
    )
    .join('')}</div>`;

  if (current === 'normal') return picker;

  return `${picker}<div class="flag f-warn" style="margin-bottom:10px"><i>!</i><span><b>${escape(
    current === 'red' ? 'Red day' : 'Yellow day'
  )}.</b> ${
    current === 'red'
      ? 'No AMRAP, no holds, no grinding. Bench converts to light triples and accessories run at about half volume.'
      : 'The final work set is removed and the AMRAP is replaced by a triple at RPE 8.'
  } <button data-act="readiness" data-id="normal" style="background:none;border:0;color:var(--s1);font:inherit;font-weight:650;padding:0;cursor:pointer">Back to normal</button></span></div>`;
}

const calibrationCard = () => `<div class="card" style="border-color:var(--s2);border-width:2px">
  <div style="font-size:11px;color:var(--s2);text-transform:uppercase;letter-spacing:.07em;font-weight:800;margin-bottom:5px">Calibration week</div>
  <p style="margin-bottom:8px"><b style="color:var(--ink)">There is no separate test day.</b> This session runs normally — you just find your own weights instead of being given them.</p>
  <p style="margin-bottom:0;font-size:12.5px"><b style="color:var(--ink)">On lifts marked INDEX:</b> ramp up until a set at the target reps feels like the target RPE, then log it. <b style="color:var(--ink)">On everything else:</b> pick a weight, do the reps, log what happened. One full rotation and every exercise has a number.</p></div>`;

/**
 * A note about the exercise, not about one set of it.
 *
 * "Chest-supported row, machine, seat height 8" is true of every set you will
 * ever do on that machine, and writing it against set 2 of 4 is the wrong
 * shape — you would have to remember which set you put it on. Kept on the
 * session log beside the swaps and grips, because it is a fact about how this
 * session was performed rather than about the plan.
 */
/**
 * Everything about a prescription that lets you compare it with another one.
 *
 * Sets, reps and RPE alone do not: "1 × max @ RPE 10" and "3 × 5 @ RPE 7" are
 * not comparable until you know one is at a fixed 83% of your working max and
 * the other is wherever the RPE table lands. The percentage is what the plan
 * states and does not change with your strength, so it travels across
 * rotations; the kilograms do not, and are shown only for this rotation.
 */
function loadBasis(slot) {
  if (!slot) return '';
  /*
   * These branches mirror `prescribedLoad` exactly, and deliberately ignore
   * `slot.pct` on anything that is not an AMRAP. The plan file carries a `pct`
   * on slots whose load is actually taken from the RPE table — rotation 29's
   * bench triple says 0.86 and is prescribed from the table — so reading it
   * here would put a percentage on screen that the app does not use.
   */
  if (slot.role === 'attempt') return 'last attempt made, plus 2.5 kg';
  if (Number.isFinite(slot.fixedLoad)) return `fixed ${slot.fixedLoad} kg \u2014 it does not move with your max`;
  if (slot.amrap) return `${Math.round(AMRAP_FRACTION * 100)}% of working max`;
  if (slot.pctTop) return `${Math.round(slot.pctTop * 100)}% of today's top single`;
  if (slot.pctBasis === 'topSingleRpe') return "from today's top single, to the target RPE";
  return `RPE table · ${slot.rpe} at ${slot.amrap ? 'max' : repsText(slot)} reps`;
}

/** Rest, in the units it is actually thought about. */
const restText = (seconds) => {
  if (!seconds) return '';
  if (seconds < 120) return `${seconds}s rest`;
  const minutes = seconds / 60;
  return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} min rest`;
};

const repsText = (slot) =>
  slot.amrap ? 'max' : slot.repsLow === slot.repsHigh ? String(slot.repsLow) : `${slot.repsLow}–${slot.repsHigh}`;

/** One prescription, with the badges that change what a set means. */
function shapeCell(slot) {
  if (!slot) return '<i>not prescribed</i>';
  const rest = restText(slot.restSec);
  const parts = [loadBasis(slot), rest, slot.effort || ''].filter(Boolean);
  return `<b>${slot.sets} × ${escape(repsText(slot))} @ RPE ${slot.rpe}</b>${
    slot.amrap ? '<span class="badge amr">AMRAP</span>' : ''
  }${slot.idx ? '<span class="badge idx">INDEX</span>' : ''}${
    slot.myoOption ? '<span class="badge myo">MYO</span>' : ''
  }<span class="sub">${escape(parts.join(' · '))}</span>`;
}

/**
 * One slot's phases as a table.
 *
 * Rows that prescribe something are tappable when this is the slot you are
 * standing on: tapping borrows that rotation's prescription for today. Rows for
 * rotations that prescribe nothing are not — there is nothing to borrow — and
 * neither is the rotation you are already in.
 */
function phaseTable(state, slotId, here, { slotIndex, borrowed, main }) {
  const authored = slotById(state.plan, slotId);
  const phases = exerciseAcrossPlan(state.plan, slotId);
  if (!phases.length) return '';

  const label = authored?.slot.label || authored?.slot.role || slotId;
  const heading = main ? 'Across the plan' : `Also in this session · ${label}`;

  const rows = phases
    .map((phase) => {
      const range = phase.from === phase.to ? `${phase.from}` : `${phase.from}–${phase.to}`;
      const isHere = here >= phase.from && here <= phase.to;
      const isBorrowed = borrowed != null && borrowed >= phase.from && borrowed <= phase.to;
      const canBorrow = main && phase.slot && !isHere;
      const attrs = canBorrow ? ` data-act="borrow-phase" data-si="${slotIndex}" data-rot="${phase.from}"` : '';
      return `<tr class="${isHere ? 'now' : ''}${isBorrowed ? ' borrowed' : ''}${phase.slot ? '' : ' off'}${
        canBorrow ? ' pick' : ''
      }"${attrs}>
        <td>${escape(range)}</td>
        <td>${shapeCell(phase.slot)}</td>
        <td>${escape(phase.blocks.join(' · '))}${canBorrow ? '<span class="take">use</span>' : ''}</td>
      </tr>`;
    })
    .join('');

  return `<h4>${escape(heading)}</h4><table class="phases"><tbody>${rows}</tbody></table>`;
}

/**
 * The substitutes for one slot, closest first.
 *
 * The plan's own choices lead, because someone chose them: the slot's other
 * option (A/B), then the exercise's `subs`, matched to real exercises by name
 * or alias. Then everything else the app knows — the plans and the exercise
 * library — ranked by `rankSwaps`: muscle overlap, movement pattern and
 * equipment. Then the suggestions with no exercise behind them, named rather
 * than dropped.
 *
 * Typing switches to every exercise in the same order — pinned first, then by
 * similarity — and filters it. It used to switch to an alphabetical list,
 * which threw the ranking away the moment you looked for anything. The last
 * row is "Other": whatever you typed, created on the spot, counted like the
 * exercise it replaces.
 */
function swapSheet(state, slotIndex, slot, exercise) {
  const exercises = state.plan.exercises;
  const muscles = state.plan.muscles;

  // Back to the plan's own exercise, when today's is a swap of it.
  const reverting = slot.swappedFrom && exercises[slot.plannedEx];
  const revert = reverting
    ? `<button class="big ghost mt" data-act="do-swap" data-si="${slotIndex}" data-id="${escape(
        slot.plannedEx
      )}">Back to ${escape(exercises[slot.plannedEx].name)}</button>`
    : '';

  const options = (slot.options || [])
    .map((id, n) => ({ id, exercise: exercises[id], badge: `option ${String.fromCharCode(65 + n)}` }))
    .filter((entry) => entry.exercise && entry.id !== slot.ex && !(reverting && entry.id === slot.plannedEx));
  const { listed, unlisted } = listedSubs(slot.ex, exercises);
  const pinned = [
    ...options,
    ...listed.filter((entry) => !options.some((o) => o.id === entry.id)).map((entry) => ({ ...entry, badge: 'listed' })),
  ];
  const pinnedIds = pinned.map((entry) => entry.id);
  const similar = rankSwaps(slot.ex, exercises, { exclude: pinnedIds, limit: 30, muscles });
  const everything = rankSwaps(slot.ex, exercises, { exclude: pinnedIds, floor: -Infinity, muscles });

  const row = (entry) =>
    exerciseButton(state, entry.id, entry.exercise, { act: 'do-swap', slotIndex, badge: entry.badge || null });

  // A custom exercise is counted through the one it was based on; basing a new
  // one on a custom exercise would leave it nothing to copy after a reload.
  const base = exercise?.custom && exercises[exercise.basedOn] ? exercise.basedOn : slot.ex;

  return `<div class="ttl">Swap ${escape(exercise.name)}</div>

    <input class="mt" type="search" placeholder="Search by name, machine or muscle…" autocomplete="off"
      data-act-input="exercise-filter" aria-label="Search exercises">
    ${revert}

    <div data-filter-group="suggested">
    <button class="big mt" data-act="open-custom-exercise" data-si="${slotIndex}">
      + An exercise the plan does not have</button>
    <p class="hint" style="margin:6px 2px 14px">Kept for next time, counted in your volume, and it travels in your
    backups. Use it when the gym does not have what the plan asks for.</p>

    ${
      pinned.length
        ? `<h4>The plan's own substitutes</h4>
           <div class="picklist">${pinned.map(row).join('')}</div>`
        : ''
    }

    ${
      similar.length
        ? `<h4>Closest by what they train</h4>
           <div class="picklist" style="max-height:38vh;overflow:auto">${similar.map(row).join('')}</div>`
        : '<p class="hint" style="margin:10px 2px">Nothing else the app knows trains this closely enough to stand in for it.</p>'
    }

    ${
      unlisted.length
        ? `<h4>Suggested, but not in the app</h4>
           <p class="hint" style="margin:0 2px 8px">${escape(
             unlisted.join(' · ')
           )} — add one above and it becomes trackable like any other.</p>`
        : ''
    }
    </div>

    <div data-filter-group="all" hidden>
      <h4>Every exercise, closest first</h4>
      <div class="picklist" style="max-height:46vh;overflow:auto">${[...pinned, ...everything].map(row).join('')}
        ${quickCreateRow({ slotIndex, basedOnName: exercises[base]?.name })}</div>
      <p class="hint" data-filter-empty hidden style="margin:10px 2px">Nothing by that name. Add it with Other above.</p>
      <button class="big ghost mt" data-act="open-custom-exercise" data-si="${slotIndex}">+ An exercise the plan does not have</button>
    </div>

    <button class="big ghost mt" data-act="sheet-close">Cancel</button>`;
}

/**
 * "Other: …" — the name you typed, as a new exercise, in one tap.
 *
 * He logged a T-bar row as "Machine row" and a curl machine as "High-cable
 * curl" because adding the right one meant leaving the search, finding a
 * button, and filling in a form. This is the last row of the search results,
 * kept in step with the box by `exercise-filter`, and it says what the new
 * exercise will be counted as before you tap it.
 */
function quickCreateRow({ slotIndex = null, basedOnName = null }) {
  return `<button data-act="quick-exercise"${slotIndex == null ? '' : ` data-si="${slotIndex}"`} data-quick-create hidden>
      Other: “<b data-quick-label></b>”<i class="tag">new</i>
      <span data-quick-basis>${
        basedOnName ? `Added as your own exercise · counted like ${escape(basedOnName)}` : 'Added as your own exercise'
      }</span></button>`;
}

/**
 * One exercise in a pick list: its name, and the muscles it mainly trains.
 *
 * `data-search` is what the search box matches against: the name, its
 * aliases, its equipment and the muscles it mainly trains, normalized once
 * here. The search filters rows that are already on the page rather than
 * re-rendering the sheet, so the box keeps its focus and the keyboard stays up
 * while you type — and the rows keep the order they were rendered in.
 */
function exerciseButton(state, id, exercise, { act, slotIndex = null, badge = null }) {
  const share = Object.entries(exercise.m || {})
    .filter(([, weight]) => weight >= 0.5)
    .map(([muscle]) => state.plan.muscles[muscle]?.label?.split(' —')[0] || muscle)
    .slice(0, 3)
    .join(', ');
  return `<button data-act="${act}"${slotIndex == null ? '' : ` data-si="${slotIndex}"`} data-id="${escape(
    id
  )}" data-search="${escape(searchKey(exercise, { muscles: state.plan.muscles }))}">
      ${escape(exercise.name)}${badge ? `<i class="tag">${escape(badge)}</i>` : ''}
      <span>${escape(share || 'no counted stimulus')}${exercise.custom ? ' · added by you' : ''}</span></button>`;
}

/**
 * What you wrote down last time you did this exercise.
 *
 * The seat height you worked out three weeks ago was in the database and not on
 * the screen, which makes it worth roughly nothing at the moment you are
 * standing in front of the machine.
 */
function pastNotes(state, exerciseId) {
  const history = exerciseNoteHistory(state.logs || [], state.sets || [], exerciseId);
  if (!history.length) return '';

  return `<details class="card" style="margin-top:12px"><summary>Last time · ${history.length}</summary><div class="c">
    ${history
      .map(
        (entry) => `<div class="pastnote">
          <b>${escape(entry.dateISO)}${entry.sessionId ? ` · ${escape(entry.sessionId)}` : ''}${
            entry.kind === 'set' ? ` · set ${Number(entry.setIndex) + 1}` : ''
          }</b>
          <span>${escape(entry.text)}</span></div>`
      )
      .join('')}
  </div></details>`;
}

const exerciseNote = (state, slotIndex) => state.deviations.exerciseNotes?.[String(slotIndex)] || '';

function exerciseBlock(state, slot, slotIndex) {
  const exercise = state.plan.exercises[slot.ex];
  const open = state.exOpen.has(String(slotIndex));
  const unit = state.settings.unit;

  let done = 0;
  for (let i = 0; i < slot.sets; i++) if (state.loggedSets.has(setKey(slotIndex, i))) done++;
  const all = done === slot.sets;

  const prescribed = prescriptionFor(state, slot);
  const previous = lastTime(state, slot.ex);
  const name = escape(exercise.name) + (slot.label ? ` — ${escape(slot.label)}` : '');
  const basis = prescriptionMax(state, slot);
  const workingMax = basis.value;

  const rows = optionPicker(state, slot, slotIndex) + Array.from({ length: slot.sets }, (_, i) => setRow(state, slot, slotIndex, i)).join('');
  const valueActions = `${
    previous ? `<button data-act="same-as-last" data-si="${slotIndex}">Same as last time</button>` : ''
  }${
    prescribed != null
      ? `<button class="warn" data-act="clear-pres" data-si="${slotIndex}">${
          state.cleared.has(String(slotIndex)) ? 'Restore prescribed' : 'Clear prescribed'
        }</button>`
      : ''
  }`;
  const setupActions = `${
    prescribed != null && !state.plan.exercises[slot.ex].bodyweightLoaded
      ? `<button data-act="open-ramp" data-si="${slotIndex}">Warm-up</button>
         <button data-act="open-plates" data-si="${slotIndex}">Plates</button>`
      : ''
  }${
    exercise.grips
      ? `<button data-act="open-grip" data-si="${slotIndex}">Grip: ${escape(
          (state.grips[`${state.trainSessionId}-${slotIndex}`] || exercise.grips[0]).split(' (')[0]
        )}</button>`
      : ''
  }`;
  const exerciseActions = `<button data-act="add-set" data-si="${slotIndex}">+ Set</button>
    <button data-act="remove-set" data-si="${slotIndex}">\u2212 Set</button>
    <button data-act="open-swap" data-si="${slotIndex}">Swap</button>
    ${slot.added ? `<button class="warn" data-act="remove-added" data-si="${slotIndex}">Remove</button>` : ''}
    <button data-act="about" data-id="${slot.ex}">About</button>
    ${
      slot.id && !slot.swappedFrom && !slot.added
        ? `<button class="${slot.borrowedFrom ? 'warn' : ''}" data-act="open-phases" data-si="${slotIndex}">${
            slot.borrowedFrom ? `Rotation ${slot.borrowedFrom}` : 'Phases'
          }</button>`
        : ''
    }${
      slot.borrowedFrom
        ? `<button class="warn" data-act="revert-phase" data-si="${slotIndex}">Revert</button>`
        : ''
    }
    <button class="${exerciseNote(state, slotIndex) ? 'warn' : ''}" data-act="open-ex-note" data-si="${slotIndex}">${
      exerciseNote(state, slotIndex) ? '\u2713 Note' : 'Note'
    }</button>`;
  const actionGroup = (label, buttons) =>
    buttons ? `<div class="action-group"><span>${label}</span><div class="mini">${buttons}</div></div>` : '';

  return `<div class="ex ${open ? 'open' : ''}">
    <div class="exhead" data-act="toggle-ex" data-si="${slotIndex}">
      <div class="tick ${all ? 'done' : done ? 'part' : ''}">${all ? '✓' : done || ''}</div>
      <div class="exnm"><b>${name}${
        slot.borrowedFrom ? `<span class="badge lent">ROT ${slot.borrowedFrom}</span>` : ''
      }${slot.idx ? '<span class="badge idx">INDEX</span>' : ''}${
        slot.amrap ? '<span class="badge amr">AMRAP</span>' : ''
      }${slot.myoReps ? '<span class="badge myo">MYO</span>' : ''}${
        slot.isTest ? '<span class="badge test">TEST</span>' : ''
      }${slot.role === 'hold' ? '<span class="badge hold">HOLD</span>' : ''}${
        slot.optional ? '<span class="badge opt">OPTIONAL</span>' : ''
      }</b>
        <span class="sc">${slot.sets} × ${slot.amrap ? 'max' : slot.reps} @ RPE ${slot.rpe}${
          prescribed == null
            ? ''
            : bodyweightFor(state, slot.ex) && prescribed === 0
              ? ' · bodyweight'
              : ` · ${workingMaxFor(state, slot.ex) && bodyweightFor(state, slot.ex) ? '+' : ''}${fmtLoad(prescribed, unit)} ${unit}`
        }</span></div>
      <div class="car">›</div></div>
    <div class="exbody">${rows}
      ${lastTimePanel(state, previous, slot)}
      ${
        prescribed != null
          ? prescriptionHint(state, slot, prescribed, workingMax, basis.single)
          : `<p class="hint"><b>${slot.idx ? 'Find your baseline.' : 'No stored max for this one.'}</b> Pick a weight you think lands at the target RPE, log what actually happened, and the app carries it forward from here.</p>`
      }

      ${
        slot.note
          ? `<div class="cue" style="border-left-color:${slot.isTest || slot.role === 'hold' ? 'var(--crit)' : 'var(--s1)'}">${escape(
              slot.note
            )}</div>`
          : ''
      }
      ${
        slot.scaledFrom
          ? `<p class="hint">Reduced from <b>${slot.scaledFrom} sets</b> — ${escape(slot.scaleReason)}.</p>`
          : ''
      }
      ${
        slot.adjusted
          ? `<p class="hint">Adjusted for a <b>${escape(slot.adjusted)}</b> day.</p>`
          : ''
      }
      ${
        slot.myoReps
          ? `<div class="cue" style="border-left-color:var(--s2)"><b>Last set is a myo-rep cluster.</b>
             One activation set to failure at ${slot.reps}+ reps, then rest 15–20 s and do 3–5 mini-sets of 3–5 reps
             with 15–20 s between them. Stop when you cannot hit 3. Worth roughly two straight sets in about two
             minutes — tick the MYO flag when you log it.</div>`
          : ''
      }
      ${variationNote(state, slot.ex)}
      <div class="cue">${escape(exercise.how[0])}</div>
      ${
        exerciseNote(state, slotIndex)
          ? `<div class="exnote" data-act="open-ex-note" data-si="${slotIndex}">${escape(
              exerciseNote(state, slotIndex)
            )}</div>`
          : ''
      }
      <div class="ex-actions">
        ${actionGroup('Values', valueActions)}
        ${actionGroup('Setup', setupActions)}
        ${actionGroup('Exercise', exerciseActions)}
      </div></div></div>`;
}

/**
 * Option A or B, where the plan offers a choice.
 *
 * Shown on the card rather than behind Swap, because these are not departures
 * from the plan: both are in it, and which one suits today is the question.
 */
function optionPicker(state, slot, slotIndex) {
  const options = slot.options || [];
  if (options.length < 2) return '';
  return `<div class="optpick"><span>Option</span><div class="picker">${options
    .map((id, n) => {
      const exercise = state.plan.exercises[id];
      if (!exercise) return '';
      return `<button class="pill ${slot.ex === id ? 'on' : ''}" data-act="pick-option" data-si="${slotIndex}" data-id="${escape(
        id
      )}">${String.fromCharCode(65 + n)} \u00b7 ${escape(exercise.name)}</button>`;
    })
    .join('')}</div></div>`;
}

/**
 * What the prescribed load actually is, in the terms that make it judgeable.
 *
 * RPE is always relative to your one-rep max, never to today's top single — so
 * a back-off set shows both numbers: the percentage of today's single it was
 * derived from, and the percentage of the working max that the RPE comes from.
 * Below the bottom of the table it says "under 6" rather than printing a 6.00
 * that pretends to a precision the scale does not have.
 */
function prescriptionHint(state, slot, prescribed, workingMax, single = null) {
  const unit = state.settings.unit;
  const bodyweight = bodyweightFor(state, slot.ex);
  const detail = effectiveRpeDetail(prescribed, workingMax, slot.reps, { bodyweight });
  if (!detail) return '';

  // You cannot add less than nothing to a pull-up. When the percentage works
  // out below bodyweight the honest instruction is the rep target, not a load.
  const bodyweightOnly = bodyweight > 0 && prescribed === 0;

  const parts = [
    bodyweightOnly
      ? `<b>Bodyweight only</b> — the target percentage lands below your ${fmtLoad(bodyweight, unit)} ${unit}, so the rep range is what makes this hard`
      : `Prescribed <b>${bodyweight ? '+' : ''}${fmtLoad(prescribed, unit)} ${unit}</b>`,
  ];

  if (bodyweight && !bodyweightOnly) {
    parts.push(`${fmtLoad(detail.systemLoad, unit)} ${unit} total with bodyweight`);
  }
  if (slot.pctTop) {
    const topSingle = systemLoad(
      prescribedLoad({ reps: 1, rpe: 8 }, workingMax, state.settings.increment, { bodyweight }),
      bodyweight
    );
    parts.push(`${Math.round(slot.pctTop * 100)}% of today's ${fmtLoad(topSingle, unit)} ${unit} top single`);
  }
  parts.push(
    single
      ? `${detail.percent.toFixed(1)}% of the ${fmtLoad(workingMax, unit)} ${unit} max today's ${fmtLoad(
          single.set.load,
          unit
        )} ${unit} single @${fmtNum(single.set.rpe, 1)} shows`
      : `${detail.percent.toFixed(1)}% of your ${fmtLoad(workingMax, unit)} ${unit} max${maxSourceNote(state, slot.ex)}`
  );
  parts.push(
    detail.clamped === 'below'
      ? 'effective RPE <b>under 6</b>'
      : `effective RPE <b>${detail.clamped === 'above' ? '10+' : fmtNum(detail.rpe, 2)}</b>`
  );

  return `<p class="hint">${parts.join(' · ')}</p>`;
}

/** Where the working max came from, when it is not one you set yourself. */
function maxSourceNote(state, exerciseId) {
  const info = workingMaxInfo(state, exerciseId);
  if (!info) return '';
  if (info.source === 'evidence') return ` (from your sets since ${info.evidence.fromISO.slice(5)})`;
  if (info.source === 'seed') return ' (the plan\u2019s starting estimate \u2014 set your own in Settings)';
  return '';
}

function setRow(state, slot, slotIndex, i) {
  const unit = state.settings.unit;
  const { logged, toFailure, load, reps, rpe } = rowValues(state, slot, slotIndex, i);
  const cls = logged ? '' : 'pres';
  // A logged set is shown on the bodyweight it was stored with, as the Log shows it.
  const bodyweight = bodyweightFor(state, slot.ex) ? logged?.bodyweightUsed ?? bodyweightFor(state, slot.ex) : 0;
  // e1RM is computed on what you actually lifted: bodyweight included.
  const total = load != null && reps ? systemLoad(load, bodyweight) : null;
  const estimate = total != null ? e1rm(total, reps, Math.min(10, rpe)) : null;
  // How big the set was, independent of how hard it felt. See setDifficulty.
  const difficulty = total != null ? setDifficulty(total, reps) : null;
  // A blank where a number usually sits reads as a broken app. Say which it is.
  const why = total != null && estimate == null ? noEstimateReason(total, reps, Math.min(10, rpe), { short: true }) : null;
  // Past the table's twelve reps, a weaker estimate rather than a blank.
  const rough = estimate == null && total != null ? roughE1rm(total, reps, Math.min(10, rpe)) : null;

  return `<div class="setrow ${logged ? 'logged' : ''}">
      <div class="sn ${toFailure ? 'f' : ''}">${i + 1}</div>
      <div class="fld ${cls} ${load == null ? 'empty' : ''}" data-act="open-step" data-si="${slotIndex}" data-i="${i}" data-field="load">
        <div class="v">${fmtLoad(load, unit)}</div><div class="k">${bodyweight ? `+${unit}` : unit}</div></div>
      <div class="fld ${cls} ${reps == null ? 'empty' : ''}" data-act="open-step" data-si="${slotIndex}" data-i="${i}" data-field="reps">
        <div class="v">${reps == null ? '—' : isAmrapSet(slot, i) && !logged ? 'AM' : reps}</div><div class="k">reps</div></div>
      <div class="fld ${cls}" data-act="open-step" data-si="${slotIndex}" data-i="${i}" data-field="rpe">
        <div class="v">${rpe}</div><div class="k">${toFailure ? 'fail' : 'rpe'}</div></div>
      <button class="setok ${logged ? 'done' : ''}" data-act="tick" data-si="${slotIndex}" data-i="${i}" aria-label="Log set ${i + 1}">✓</button>
    </div>${
      estimate
        ? `<div class="e1">e1RM <b>${fmtLoad(estimate, unit)} ${unit}</b>${
            bodyweight ? ` <span style="color:var(--muted)">(+${fmtLoad(estimate - bodyweight, unit)} added)</span>` : ''
          }${
            difficulty ? ` <span class="dif">difficulty <b>${fmtLoad(difficulty, unit)}</b></span>` : ''
          }</div>`
        : rough
          ? `<div class="e1 rough">~<b>${fmtLoad(rough, unit)} ${unit}</b> <span>${escape(
              roughConfidence(reps)
            )} \u00b7 ${reps} reps is past the RPE table</span></div>`
          : why
            ? `<div class="e1 none">no estimate \u2014 ${escape(why)}</div>`
            : ''
    }`;
}

/* ═══════════════════════════════════════════════════════════════════════
   The set sheet
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * The set editor: load, reps and RPE together.
 *
 * It used to open on one field at a time, so logging a set that differed from
 * the prescription in two ways meant opening it twice. All three are here, each
 * with its own steppers for thumbs and its own box for typing.
 *
 * `data-pick` marks a number box whose contents should be selected when it is
 * focused, so typing replaces the value rather than appending to it — tapping a
 * box reading 9 and typing 10 gave 910.
 *
 * The action bar is sticky at the foot of the sheet, and the sheet itself is
 * lifted above the on-screen keyboard (see `keyboardInset` in app.js), because
 * "Log this set" being hidden behind the keyboard means scrolling to save every
 * single set of every session.
 */
/**
 * Keep the set being edited, if the editor is closing without a save.
 *
 * Called on every sheet close. With the keyboard up, the visible strip above
 * the editor is the backdrop, and one stray tap there threw away the typed
 * load, reps, RPE and note. The draft is kept against its row and comes back
 * when that row's editor is opened again. A save, "Remove this set" and Cancel
 * end the editing first, so they leave nothing behind.
 */
export function keepStepDraft(state) {
  const c = state.sheetCtx;
  if (c?.kind !== 'step' || !c.editing) return;
  c.editing = false;
  // Only what was actually changed is a draft. An editor opened and closed
  // untouched keeps nothing, so a prescription that moves later — back-offs
  // follow the day's single — is never replaced by a stale copy of itself.
  if (stepFields(c) === c.opened) return;
  const key = setKey(c.si, c.i);
  state.stepDrafts = {
    ...(state.stepDrafts || {}),
    [key]: { ...c, exerciseId: c.slot.ex, loggedId: state.loggedSets.get(key)?.id ?? null },
  };
}

/** What the editor lets you change, as one comparable string. */
const stepFields = (c) =>
  JSON.stringify([c.load, c.reps, c.rpe, c.toFailure, c.isAmrap, c.formBreakdown, c.attemptResult, c.isMyoRep,
    c.isIndexSet, c.velocity, c.note, c.pauseStyle]);

/** End the editing without keeping a draft: the set was saved, removed or cancelled. */
function endStepEdit(state) {
  const c = state.sheetCtx;
  if (c?.kind !== 'step') return;
  c.editing = false;
  if (state.stepDrafts) delete state.stepDrafts[setKey(c.si, c.i)];
}

/** The load box's text: blank for no load, never a 0 nobody typed. */
const loadBox = (kg, unit) => (Number.isFinite(kg) ? Math.round(toDisplay(kg, unit) * 10) / 10 : '');

function drawStepSheet(ctx) {
  const { state } = ctx;
  const c = state.sheetCtx;
  const exercise = state.plan.exercises[c.slot.ex];
  const unit = state.settings.unit;
  const workingMax = prescriptionMax(state, c.slot).value;
  const bodyweight = bodyweightFor(state, c.slot.ex);
  c.editing = true;

  const field = (key, label, value, step) => `<div class="fcol">
    <label for="in-${key}">${escape(label)}</label>
    <input id="in-${key}" type="number" inputmode="decimal" step="${step}" value="${value}"
      data-pick data-act-input="field-${key}">
    <div class="fbtns">
      <button data-act="bump" data-f="${key}" data-d="-1" aria-label="${escape(label)} down">\u2212</button>
      <button data-act="bump" data-f="${key}" data-d="1" aria-label="${escape(label)} up">+</button>
    </div></div>`;

  openSheet(`<div class="ttl">${escape(exercise.name)} \u00b7 set ${c.i + 1}</div>

    <div class="fields">
      ${field('load', bodyweight ? `Added (${unit})` : `Load (${unit})`, loadBox(c.load, unit), stepFor(unit, state.settings.increment))}
      ${field('reps', 'Reps', c.reps ?? '', 1)}
      ${field('rpe', 'RPE', c.rpe ?? '', 0.5)}
    </div>

    ${
      c.needsLoad
        ? `<p class="hint" style="margin:-4px 2px 10px;color:var(--s2)"><b>Enter the load to log this set.</b> A weighted set with no load counts as done but carries no weight and no estimate.</p>`
        : ''
    }
    <div class="eff" id="stepEff">${stepReadout(state, c, workingMax)}</div>
    <div id="stepOver">${overshootNote(state, c)}</div>
    ${variationNote(state, c.slot.ex)}

    ${attemptButtons(state, c)}

    <div class="mini" style="justify-content:center;margin-bottom:12px">
      <button data-act="flag" data-flag="toFailure" class="${c.toFailure ? 'warn' : ''}">${c.toFailure ? '\u2713 ' : ''}To failure</button>
      <button data-act="flag" data-flag="isAmrap" class="${c.isAmrap ? 'warn' : ''}">${c.isAmrap ? '\u2713 ' : ''}AMRAP</button>
      <button data-act="flag" data-flag="isMyoRep" class="${c.isMyoRep ? 'warn' : ''}">${c.isMyoRep ? '\u2713 ' : ''}Myo-reps</button>
      <button data-act="flag" data-flag="isIndexSet" class="${c.isIndexSet ? 'warn' : ''}">${c.isIndexSet ? '\u2713 ' : ''}Index set</button>
      <button data-act="flag" data-flag="formBreakdown" class="${c.formBreakdown ? 'crit' : ''}">${c.formBreakdown ? '\u2713 ' : ''}Form broke</button>
      ${
        tracksPause(c.slot.ex)
          ? PAUSE_STYLES.map(
              (style) =>
                `<button data-act="pause-style" data-id="${style}" class="${c.pauseStyle === style ? 'warn' : ''}">${
                  c.pauseStyle === style ? '\u2713 ' : ''
                }${style}</button>`
            ).join('')
          : ''
      }
    </div>

    ${
      c.formBreakdown
        ? `<p class="hint" style="margin:-6px 2px 12px;color:var(--s2)"><b>Marked as form breakdown.</b> The set is kept
           exactly as logged and still counts as volume — it just cannot claim a record or move a working max.</p>`
        : ''
    }
    ${
      c.isAmrap && tracksPause(c.slot.ex) && !c.pauseStyle
        ? `<p class="hint" style="margin:-6px 2px 12px;color:var(--s2)"><b>Pick a pause style before logging this.</b>
           An AMRAP is the plan's only measurement, and a touch-and-go rep and a paused rep at the same load are not
           the same evidence. Both of the AMRAPs in your history have this blank.</p>`
        : ''
    }

    <div class="g2">
      <div><label for="stepVel">Bar speed (m/s)</label>
        <input id="stepVel" type="number" inputmode="decimal" step="0.01" value="${c.velocity ?? ''}" data-pick data-act-input="velocity"></div>
      <div><label for="stepNote">Note for this set</label>
        <input id="stepNote" type="text" value="${escape(c.note ?? '')}" data-act-input="note"></div>
    </div>

    <div class="sheet-actions">
      <button class="big" data-act="save-step">Log this set</button>
      ${
        c.logged
          ? '<button class="big ghost mt" data-act="unlog-step">Remove this set</button><p class="hint" style="text-align:center;margin:6px 0 0">Recoverable from Log → Bin.</p>'
          : ''
      }
      <button class="big ghost mt" data-act="step-cancel">Cancel</button>
    </div>`);
}

function stepReadout(state, c, workingMax) {
  const unit = state.settings.unit;
  const bodyweight = bodyweightFor(state, c.slot.ex);
  const total = systemLoad(c.load, bodyweight);
  const estimate = e1rm(total, c.reps, Math.min(10, c.rpe));
  const detail = effectiveRpeDetail(c.load, workingMax, c.reps, { bodyweight });
  const difficulty = setDifficulty(total, c.reps);
  const why = estimate == null ? noEstimateReason(total, c.reps, Math.min(10, c.rpe)) : null;

  return `${bodyweight ? '+' : ''}${fmtLoad(c.load, unit)} ${unit} × ${c.reps ?? '—'} @ RPE ${c.rpe}
    ${bodyweight ? `<br><span style="color:var(--muted)">${fmtLoad(total, unit)} ${unit} total with bodyweight</span>` : ''}
    ${estimate ? `<br>e1RM <b>${fmtLoad(estimate, unit)} ${unit}</b>` : ''}
    ${difficulty ? ` · difficulty <b>${fmtLoad(difficulty, unit)} ${unit}</b>` : ''}
    ${why ? `<br><span style="color:var(--muted)">No estimate — ${escape(why)}.</span>` : ''}
    ${
      detail
        ? ` · ${detail.percent.toFixed(1)}% of max · effective RPE <b>${
            detail.clamped === 'below' ? 'under 6' : detail.clamped === 'above' ? '10+' : fmtNum(detail.rpe, 1)
          }</b>`
        : ''
    }
    <br><span style="color:var(--muted);font-size:11.5px">Type directly, or use the buttons. Overrides are recorded as deviations, not errors.</span>`;
}

const repaintReadout = (ctx) => {
  const el = document.getElementById('stepEff');
  if (el) {
    el.innerHTML = stepReadout(
      ctx.state,
      ctx.state.sheetCtx,
      prescriptionMax(ctx.state, ctx.state.sheetCtx.slot).value
    );
  }
  // The overshoot warning has to repaint with the load, not be decided once
  // when the sheet opened — the sheet opens on the prescribed weight, and
  // typing a heavier one is exactly the moment worth saying something.
  const over = document.getElementById('stepOver');
  if (over) over.innerHTML = overshootNote(ctx.state, ctx.state.sheetCtx);
};

/* ═══════════════════════════════════════════════════════════════════════
   Actions
   ═══════════════════════════════════════════════════════════════════════ */

export const actions = {
  'pick-session'(ctx, data) {
    ctx.openSession(data.id);
  },

  'toggle-ex'(ctx, data) {
    const key = String(data.si);
    ctx.state.exOpen.has(key) ? ctx.state.exOpen.delete(key) : ctx.state.exOpen.add(key);
    ctx.render();
  },

  /** One tap logs the set exactly as shown. The accordion stays open. */
  async tick(ctx, data, event) {
    event.stopPropagation();
    const { state } = ctx;
    const slotIndex = Number(data.si);
    const i = Number(data.i);
    const slot = slotsFor(state)[slotIndex];
    const key = setKey(slotIndex, i);

    state.exOpen.add(String(slotIndex));

    if (state.loggedSets.has(key)) {
      await ctx.removeSet(slotIndex, i);
      return;
    }

    /*
     * An AMRAP has no prescribed rep count — the number of reps IS the
     * measurement. v1 showed the slot's nominal six and one tap logged it,
     * fabricating the single most important data point in the plan.
     */
    if (isMeasurementRow(slot, i)) {
      actions['open-step'](ctx, { si: String(slotIndex), i: String(i), field: 'reps' });
      return;
    }

    const { load, reps, rpe, toFailure, prescribed } = rowValues(state, slot, slotIndex, i);

    /*
     * A weighted set with no load is not a set anyone can use: no tonnage, no
     * estimate, and it still counts as logged. That is what one tap stored for
     * an exercise with no max and no history, or after "Clear prescribed". The
     * editor opens on the load instead. A bodyweight lift with nothing added is
     * a real set and is logged as one.
     */
    if (load == null && !bodyweightFor(state, slot.ex)) {
      actions['open-step'](ctx, { si: String(slotIndex), i: String(i), field: 'load' });
      // On the box, so the next thing typed is the load. It opened unfocused,
      // and only a failed Save moved the focus there — a second tap every time.
      focusLoadBox();
      return;
    }

    const values = {
      load,
      reps,
      rpe,
      toFailure,
      isAmrap: isAmrapSet(slot, i),
      formBreakdown: false,
      // The screen shows a default grip and pause; v1 saved null for both on a
      // one-tap set, so analytics silently mixed incomparable techniques.
      gripWidth: defaultGrip(state, slot, slotIndex),
      pauseStyle: defaultPause(state, slot),
      isMyoRep: !!slot.myoReps && i === slot.sets - 1,
      wasPrescribed: load != null && load === prescribed,
      prescribedLoad: prescribed,
    };
    if (askIfImplausible(ctx, { from: 'tick', si: slotIndex, i, slot, values })) return;
    await commitTick(ctx, slotIndex, i, slot, values);
  },

  /** "Save" on the plausibility question: it was right. Never blocked. */
  async 'plausible-save'(ctx) {
    const pending = ctx.state.pendingSet;
    ctx.state.pendingSet = null;
    if (!pending) return;
    if (pending.from === 'tick') {
      closeSheet();
      await commitTick(ctx, pending.si, pending.i, pending.slot, pending.values);
      return;
    }
    await commitStep(ctx, pending.values);
  },

  /** "Fix" on the plausibility question: back to the editor, with what was typed. */
  'plausible-fix'(ctx) {
    const pending = ctx.state.pendingSet;
    ctx.state.pendingSet = null;
    if (!pending) return;
    if (pending.from === 'tick') {
      actions['open-step'](ctx, { si: String(pending.si), i: String(pending.i), field: 'load' });
      return;
    }
    ctx.state.sheetCtx.field = 'load';
    drawStepSheet(ctx);
  },

  'open-ex-note'(ctx, data) {
    const { state } = ctx;
    const slotIndex = Number(data.si);
    const slot = slotsFor(state)[slotIndex];
    const exercise = state.plan.exercises[slot.ex];

    openSheet(`<div class="ttl">Note \u00b7 ${escape(exercise.name)}</div>
      <p style="font-size:13px;margin:12px 0 10px">About the exercise as you did it today \u2014 the machine, the seat
      height, the pin, the handle. It stays against this exercise for the whole session rather than against one set
      of it, and it travels into your history with the session.</p>
      <input id="ex-note" type="text" value="${escape(exerciseNote(state, slotIndex))}"
        placeholder="Machine chest-supported row, seat height 8" autocomplete="off">
      ${pastNotes(state, slot.ex)}
      <div class="sheet-actions">
        <button class="big mt" data-act="save-ex-note" data-si="${slotIndex}">Save the note</button>
        ${
          exerciseNote(state, slotIndex)
            ? `<button class="big ghost mt" data-act="clear-ex-note" data-si="${slotIndex}">Remove it</button>`
            : ''
        }
        <button class="big ghost mt" data-act="sheet-close">Cancel</button>
      </div>`);
    requestAnimationFrame(() => document.getElementById('ex-note')?.focus());
  },

  async 'save-ex-note'(ctx, data) {
    const value = document.getElementById('ex-note')?.value?.trim() || '';
    await setExerciseNote(ctx, Number(data.si), value);
  },

  async 'clear-ex-note'(ctx, data) {
    await setExerciseNote(ctx, Number(data.si), '');
  },

  /*
   * "+ Set" and "− Set" work on every exercise on the screen: the plan's, the
   * ones you added today, and the ones in a saved custom workout. Which list a
   * set belongs to is read off the slot itself (`added`, `extraIndex`) rather
   * than worked out from lengths — see `extraSlots`.
   */
  async 'add-set'(ctx, data) {
    await changeSetCount(ctx, Number(data.si), +1);
  },

  async 'remove-set'(ctx, data) {
    await changeSetCount(ctx, Number(data.si), -1);
  },

  async 'remove-added'(ctx, data) {
    const { state } = ctx;
    const slotIndex = Number(data.si);
    const slot = slotsFor(state)[slotIndex];
    if (!slot?.added) return;
    const wouldReindexLogged = [...state.loggedSets.keys()].some((key) => Number(key.split(':')[0]) >= slotIndex);
    if (wouldReindexLogged) {
      openSheet(`<div class="ttl">Exercise has logged sets</div>
        <p style="text-align:center;margin:14px 0;font-size:13px">This exercise or one below it already has logged sets. Remove those sets first, or discard the whole session. A visible set is never shifted onto a different exercise.</p>
        <button class="big mt" data-act="sheet-close">Go back</button>`);
      return;
    }
    state.deviations.extras.splice(slot.extraIndex, 1);
    state.exOpen = new Set(['0']);
    if (state.activeLog) await ctx.saveDeviations();
    ctx.render();
  },

  /**
   * Clears the prescribed numbers so nothing is pre-filled — and leaves every
   * value you actually entered exactly where it is.
   */
  'clear-pres'(ctx, data) {
    const key = String(data.si);
    ctx.state.cleared.has(key) ? ctx.state.cleared.delete(key) : ctx.state.cleared.add(key);
    ctx.state.exOpen.add(key);
    ctx.render();
  },

  'open-step'(ctx, data) {
    const { state } = ctx;
    const slotIndex = Number(data.si);
    const i = Number(data.i);
    const slot = slotsFor(state)[slotIndex];
    const values = rowValues(state, slot, slotIndex, i);

    state.sheetCtx = {
      kind: 'step',
      si: slotIndex,
      i,
      field: data.field,
      slot,
      logged: !!values.logged,
      // Blank stays blank. It used to open on 0, so a row showing "—" was
      // logged as 0 kg by anyone who only changed the reps. Zero added is
      // still the right start for a bodyweight lift.
      load: values.load ?? (bodyweightFor(state, slot.ex) ? 0 : null),
      reps: values.reps ?? slot.reps,
      rpe: values.rpe,
      toFailure: values.logged ? !!values.logged.toFailure : values.toFailure,
      isAmrap: values.logged ? !!values.logged.isAmrap : isAmrapSet(slot, i),
      formBreakdown: !!values.logged?.formBreakdown,
      attemptResult: values.logged?.attemptResult ?? null,
      isMyoRep: values.logged ? !!values.logged.isMyoRep : !!slot.myoReps && i === slot.sets - 1,
      isIndexSet: values.logged ? !!values.logged.isIndexSet : !!slot.idx,
      velocity: values.logged?.velocity ?? null,
      note: values.logged?.note ?? null,
      // The same defaults a tick stores, from the same functions. A logged set
      // keeps what it was logged with; a pause style is shown and changeable
      // above, a grip is chosen on the exercise card.
      pauseStyle: values.logged ? values.logged.pauseStyle ?? null : defaultPause(state, slot),
      gripWidth: values.logged?.gripWidth ?? defaultGrip(state, slot, slotIndex),
      prescribed: values.prescribed,
    };

    state.sheetCtx.opened = stepFields(state.sheetCtx);

    // A draft kept for this very row — same set, same exercise, and the logged
    // row it was editing (if any) still the one there — comes back as it was.
    const key = setKey(slotIndex, i);
    const draft = state.stepDrafts?.[key];
    if (draft) {
      if (draft.exerciseId === slot.ex && draft.loggedId === (values.logged?.id ?? null)) {
        state.sheetCtx = { ...draft, slot, field: data.field, logged: !!values.logged, prescribed: values.prescribed };
      }
      delete state.stepDrafts[key];
    }
    drawStepSheet(ctx);
  },

  /** Cancel means it: the draft goes with the sheet. */
  'step-cancel'(ctx) {
    endStepEdit(ctx.state);
    closeSheet();
    ctx.render();
  },

  /** Steppers now say which of the three fields they move. */
  bump(ctx, data) {
    const c = ctx.state.sheetCtx;
    const direction = Number(data.d);
    const unit = ctx.state.settings.unit;
    const field = data.f || c.field;

    if (field === 'load') {
      const stepKg = fromDisplay(stepFor(unit, ctx.state.settings.increment), unit);
      c.load = Math.max(0, roundToIncrement((c.load || 0) + direction * stepKg, 0.01));
    } else if (field === 'reps') {
      c.reps = Math.max(1, (c.reps || 0) + direction);
    } else {
      c.rpe = Math.min(10, Math.max(5, (c.rpe ?? 8) + direction * 0.5));
    }

    repaintFields(ctx);
    repaintReadout(ctx);
  },


  /** Today's ramp, calculated from today's top set. The ramp is not training. */
  'open-ramp'(ctx, data) {
    const { state } = ctx;
    const slot = slotsFor(state)[Number(data.si)];
    const unit = state.settings.unit;
    const top = prescriptionFor(state, slot);
    const ramp = warmupRamp(top, { bar: state.settings.barKg, increment: state.settings.increment });

    openSheet(`<div class="ttl">Warm-up to ${fmtLoad(top, unit)} ${unit}</div>
      <table style="margin-top:12px"><thead><tr><th>Set</th><th>Load</th><th>Reps</th><th>Rest</th></tr></thead><tbody>
        ${ramp
          .map(
            (step, i) =>
              `<tr${step.isWarmup ? '' : ' style="font-weight:700"'}><td>${
                step.isWarmup ? i + 1 : 'work'
              }</td><td>${fmtLoad(step.load, unit)} ${unit}</td><td>${step.reps ?? '—'}</td><td>${
                step.restSec ? `${step.restSec}s` : '—'
              }</td></tr>`
          )
          .join('')}
      </tbody></table>
      <p class="hint">Rest 60–90 s on the light sets and 2–3 min before the top set. <b>The ramp is not training</b> —
      never let it accumulate fatigue.</p>
      <button class="big ghost mt" data-act="sheet-close">Close</button>`);
  },

  /** What to actually hang on the bar, in the plates this gym owns. */
  'open-plates'(ctx, data) {
    const { state } = ctx;
    const slot = slotsFor(state)[Number(data.si)];
    const unit = state.settings.unit;
    const target = rowValues(state, slot, Number(data.si), 0).load ?? prescriptionFor(state, slot);
    const bar = state.settings.barKg;
    const result = platesFor(target, { bar });

    const grouped = new Map();
    for (const plate of result.perSide) grouped.set(plate, (grouped.get(plate) || 0) + 1);

    openSheet(`<div class="ttl">${fmtLoad(target, unit)} ${unit} · per side</div>
      <p style="text-align:center;font-size:26px;font-weight:700;margin:16px 0 6px;font-variant-numeric:tabular-nums">${
        grouped.size
          ? [...grouped.entries()].map(([plate, count]) => `${count}×${plate}`).join('  ·  ')
          : 'just the bar'
      }</p>
      <p style="text-align:center;font-size:13px">${bar} kg bar${
        result.exact
          ? ''
          : ` · closest you can load is <b>${fmtLoad(result.achieved, unit)} ${unit}</b>, not ${fmtLoad(target, unit)}`
      }</p>
      <button class="big ghost mt" data-act="sheet-close">Close</button>`);
  },

  /**
   * One tap fills the unlogged sets of an exercise with last session's numbers.
   *
   * Only the unlogged ones. It used to save every row, so a set typed in by
   * hand was replaced by last week's — and on an AMRAP or attempt row it copied
   * last week's reps or outcome in as this week's measurement, the exact thing
   * `tick` refuses to do. Those rows are left for the editor. Grip and pause
   * come from the same defaults a tick stores, so the button used to log a set
   * no longer decides what the set says about technique.
   */
  async 'same-as-last'(ctx, data) {
    const { state } = ctx;
    const slotIndex = Number(data.si);
    const slot = slotsFor(state)[slotIndex];
    const previous = lastTime(state, slot.ex);
    if (!previous?.sets?.length) return;

    state.exOpen.add(String(slotIndex));
    let filled = 0;
    let beaten = null;
    for (let i = 0; i < slot.sets; i++) {
      if (state.loggedSets.has(setKey(slotIndex, i))) continue;
      if (isMeasurementRow(slot, i)) continue;
      const source = previous.sets[i] ?? previous.sets[previous.sets.length - 1];
      const result = await ctx.saveSet(slotIndex, i, {
        load: source.load,
        reps: source.reps,
        rpe: source.rpe ?? slot.rpe,
        toFailure: isFailureSet(slot, i),
        isAmrap: false,
        formBreakdown: false,
        gripWidth: defaultGrip(state, slot, slotIndex),
        pauseStyle: defaultPause(state, slot),
        isMyoRep: !!slot.myoReps && i === slot.sets - 1,
        wasPrescribed: false,
        prescribedLoad: prescriptionFor(state, slot),
      });
      filled += 1;
      if (result?.beaten && (!beaten || result.beaten.value > beaten.value)) beaten = result.beaten;
    }
    if (!filled) return;
    startRest(slot.restSec || state.plan.exercises[slot.ex].defaultRestSec);
    if (beaten) ctx.celebrate?.(beaten);
  },

  /** Made, missed, or tapped again to take it back to unanswered. */
  'attempt-result'(ctx, data) {
    const c = ctx.state.sheetCtx;
    c.attemptResult = c.attemptResult === data.id ? null : data.id;
    drawStepSheet(ctx);
  },

  'pause-style'(ctx, data) {
    const c = ctx.state.sheetCtx;
    c.pauseStyle = c.pauseStyle === data.id ? null : data.id;
    drawStepSheet(ctx);
  },

  flag(ctx, data) {
    const c = ctx.state.sheetCtx;
    c[data.flag] = !c[data.flag];
    if (data.flag === 'toFailure' && c.toFailure) c.rpe = 10;
    drawStepSheet(ctx);
  },

  async 'save-step'(ctx) {
    const c = ctx.state.sheetCtx;
    if (!Number.isFinite(c.load) && !bodyweightFor(ctx.state, c.slot.ex)) {
      c.needsLoad = true;
      drawStepSheet(ctx);
      focusLoadBox();
      return;
    }
    const values = {
      // Zero is a real added load on a pull-up, chin-up or dip. v1's `|| null`
      // turned an unweighted set into a blank that produced no e1RM and no
      // tonnage.
      load: Number.isFinite(c.load) ? c.load : null,
      reps: c.reps ?? null,
      rpe: c.rpe,
      toFailure: c.toFailure,
      isAmrap: c.isAmrap,
      formBreakdown: !!c.formBreakdown,
      attemptResult: c.slot.role === 'attempt' ? c.attemptResult : null,
      isMyoRep: c.isMyoRep,
      isIndexSet: c.isIndexSet,
      velocity: c.velocity,
      note: c.note,
      pauseStyle: c.pauseStyle,
      gripWidth: c.gripWidth ?? null,
      wasPrescribed: c.load != null && c.load === c.prescribed,
      prescribedLoad: c.prescribed,
    };
    if (askIfImplausible(ctx, { from: 'step', si: c.si, i: c.i, slot: c.slot, values })) return;
    await commitStep(ctx, values);
  },

  async 'unlog-step'(ctx) {
    const c = ctx.state.sheetCtx;
    await ctx.removeSet(c.si, c.i);
    endStepEdit(ctx.state);
    closeSheet();
  },

  'open-grip'(ctx, data) {
    const { state } = ctx;
    const slot = slotsFor(state)[Number(data.si)];
    const exercise = state.plan.exercises[slot.ex];
    openSheet(`<div class="ttl">Grip used — recorded on every set</div>
      <p style="font-size:12.5px;margin:12px 0 4px;color:var(--ink2)">Your competition grip does not change. This field exists so the grip test is answerable from the data, and so a session where you deliberately used something else is not silently mixed in.</p>
      <div class="picklist">${exercise.grips
        .map((g, gi) => `<button data-act="set-grip" data-si="${data.si}" data-gi="${gi}">${escape(g)}</button>`)
        .join('')}</div>
      <button class="big ghost mt" data-act="sheet-close">Cancel</button>`);
  },

  async 'set-grip'(ctx, data) {
    const { state } = ctx;
    const slot = slotsFor(state)[Number(data.si)];
    const grip = state.plan.exercises[slot.ex].grips[Number(data.gi)];
    state.grips[`${state.trainSessionId}-${data.si}`] = grip;
    await ctx.saveDeviations();
    closeSheet();
    ctx.render();
  },

  /**
   * Add an exercise to today's session — or to the blank custom one, where it
   * is the only way anything gets in.
   *
   * There is nothing being replaced, so there is nothing to rank by
   * similarity: the plan's own exercises come first, then the library, each
   * alphabetical, and the search filters that order without changing it. The
   * last row is "Other", which creates what you typed, counted like the
   * closest exercise its name matches.
   */
  'open-add'(ctx) {
    const { state } = ctx;
    const inPlan = new Set((state.plan.sessions || []).flatMap((s) => (s.slots || []).flatMap((slot) => [slot.ex, ...(slot.options || [])])));
    const entries = rankSwaps(null, state.plan.exercises, { floor: -Infinity }).sort(
      (a, b) => inPlan.has(b.id) - inPlan.has(a.id) || a.exercise.name.localeCompare(b.exercise.name)
    );
    openSheet(`<div class="ttl">Add an exercise</div>
      <input class="mt" type="search" placeholder="Search by name, machine or muscle…" autocomplete="off"
        data-act-input="exercise-filter" aria-label="Search exercises">
      <div data-filter-group="all">
        <div class="picklist mt" style="max-height:56vh;overflow:auto">${entries
          .map((entry) => exerciseButton(state, entry.id, entry.exercise, { act: 'do-add' }))
          .join('')}
          ${quickCreateRow({})}</div>
        <p class="hint" data-filter-empty hidden style="margin:10px 2px">Nothing by that name. Add it with Other above.</p>
      </div>
      <button class="big ghost mt" data-act="sheet-close">Cancel</button>`);
  },

  /**
   * "Other: …" from either sheet: create the exercise you typed and use it now.
   *
   * From Swap it is counted like the exercise it replaces — one tap, and the
   * volume is right. From Add there is nothing being replaced, so it is
   * counted like the closest exercise its name matches ("Machine curl X" →
   * Machine curl), or not counted at all when nothing does. The row says
   * which before you tap it.
   */
  async 'quick-exercise'(ctx, data) {
    const { state } = ctx;
    const typed = data.quickName ?? globalThis.document?.querySelector('.sheet input[type="search"]')?.value ?? '';
    const name = String(typed).replace(/\s+/g, ' ').trim();
    if (!name) return undefined;
    const exercises = state.plan.exercises;

    if (data.si != null && data.si !== '') {
      const slot = slotsFor(state)[Number(data.si)];
      if (!slot) return undefined;
      const current = exercises[slot.ex];
      const basedOn = current?.custom && exercises[current.basedOn] ? current.basedOn : slot.ex;
      const id = await ctx.addCustomExercise({ name, basedOn });
      return actions['do-swap'](ctx, { si: data.si, id });
    }

    const id = await ctx.addCustomExercise({ name, basedOn: guessBasedOn(name, exercises) });
    return actions['do-add'](ctx, { id });
  },

  async 'do-add'(ctx, data) {
    const { state } = ctx;
    const exercise = state.plan.exercises[data.id];
    state.deviations.extras.push({
      ex: data.id,
      label: null,
      sets: 3,
      reps: 10,
      rpe: 8,
      idx: false,
      amrap: false,
      failLast: null,
      pctTop: null,
      restSec: exercise.defaultRestSec,
      added: true,
    });
    state.exOpen.add(String(slotsFor(state).length - 1));
    // Building a custom workout is not starting it. The in-memory draft is
    // persisted with the session when Start or the first set is logged.
    if (state.activeLog || !isOutsideRotation(state)) await ctx.saveDeviations();
    closeSheet();
    ctx.render();
  },

  /**
   * How this exercise is prescribed everywhere else in the plan.
   *
   * Anchored on the slot's `id`, never on its index. Slot indices are not
   * stable across rotations — readiness removes slots, added exercises are
   * appended, and the static hold is prescribed in nine rotations out of
   * thirty-three — so an index compared across rotations compares two different
   * exercises. Slot ids are unique across the whole plan and never move.
   *
   * The phases are derived from the engine, one rotation at a time, and
   * consecutive rotations prescribing the same thing are collapsed. That is why
   * the effort waves inside Accumulation I, the AMRAP running only at each end
   * of Specificity, and the rotations where nothing is prescribed all appear
   * without any of them being written down twice.
   *
   * Companion slots come with it. Session A's bench is really two slots — the
   * top single and the back-offs that hang off it — and a comparison that shows
   * one without the other says nothing about how the day's bench work changes.
   */
  'open-phases'(ctx, data) {
    const { state } = ctx;
    const slotIndex = Number(data.si);
    const slot = slotsFor(state)[slotIndex];
    if (!slot?.id) return;

    const authored = slotById(state.plan, slot.id);
    const exercise = state.plan.exercises[slot.ex];
    const here = state.cycle.sequence;
    const borrowed = state.deviations.phaseSwaps?.[String(slotIndex)] ?? null;

    const ids = [slot.id, ...companionSlots(state.plan, slot.id)];
    const tables = ids
      .map((id, position) => phaseTable(state, id, here, { slotIndex, borrowed, main: position === 0 }))
      .join('');

    const elsewhere = sameExerciseElsewhere(state.plan, slot.ex, here, { exclude: slot.id }).filter(
      (entry) => !ids.includes(entry.slot.id)
    );

    openSheet(`<div class="ttl">${escape(exercise.name)}</div>
      <p style="text-align:center;font-size:12.5px;margin:8px 0 12px;color:var(--muted)">Session ${escape(
        authored?.session.id ?? ''
      )}${slot.label ? ` · ${escape(slot.label)}` : ''} · rotation ${here} of ${state.plan.meta.rotations}</p>

      ${tables}

      <p class="hint" style="margin:8px 0 0">Rotations, not weeks. A percentage is what the plan states; the kilograms
      it becomes depend on your working max on the day, which is why only this rotation's are shown.${
        borrowed
          ? ''
          : ' Tap a rotation to borrow its prescription for today.'
      }</p>

      ${
        borrowed
          ? `<button class="big warn mt" data-act="revert-phase" data-si="${slotIndex}">Back to rotation ${here}'s own prescription</button>`
          : ''
      }

      ${
        elsewhere.length
          ? `<h4>The same lift in other sessions</h4>
             <table class="phases"><tbody>${elsewhere
               .map(
                 (entry) => `<tr>
                   <td>${escape(entry.sessionId)}</td>
                   <td>${shapeCell(entry.slot)}</td>
                   <td>${escape(entry.slot.label || entry.slot.role)}</td>
                 </tr>`
               )
               .join('')}</tbody></table>
             <p class="hint" style="margin:6px 0 0">The same lift at different intensities, on purpose — that spread is
             what the plan is made of.</p>`
          : ''
      }
      <button class="big ghost mt" data-act="sheet-close">Close</button>`);
  },

  /**
   * Borrow another rotation's prescription for this slot, for this session.
   *
   * It lives in `deviations`, which is already the record of how a session
   * departed from the plan and already travels with the session log — so what
   * you actually did is in your history rather than only on screen. The
   * exercise never changes: only sets, reps, RPE, the load basis, rest and the
   * effort text come across.
   */
  async 'borrow-phase'(ctx, data) {
    const { state } = ctx;
    const slotIndex = String(Number(data.si));
    const rotation = Number(data.rot);
    if (!Number.isFinite(rotation)) return;

    state.deviations = {
      ...state.deviations,
      phaseSwaps: { ...(state.deviations.phaseSwaps || {}), [slotIndex]: rotation },
    };
    if (state.activeLog || !isOutsideRotation(state)) await ctx.saveDeviations();
    closeSheet();
    ctx.render();
  },

  async 'revert-phase'(ctx, data) {
    const { state } = ctx;
    const swaps = { ...(state.deviations.phaseSwaps || {}) };
    delete swaps[String(Number(data.si))];
    state.deviations = { ...state.deviations, phaseSwaps: swaps };
    if (state.activeLog || !isOutsideRotation(state)) await ctx.saveDeviations();
    closeSheet();
    ctx.render();
  },

  'open-swap'(ctx, data) {
    const { state } = ctx;
    const slotIndex = Number(data.si);
    const slot = slotsFor(state)[slotIndex];
    const exercise = state.plan.exercises[slot.ex];

    /*
     * Sets already logged here belong to the exercise that is being swapped
     * out. The database keeps them — a displaced set goes to the bin rather
     * than being replaced — but being told afterwards that your work is in the
     * bin is not the same as being asked first.
     */
    const logged = [...state.loggedSets.keys()].filter((key) => Number(key.split(':')[0]) === slotIndex).length;
    if (logged && !state.swapConfirmed?.has(slotIndex)) {
      openSheet(`<div class="ttl">${escape(exercise.name)} has ${logged} logged set${logged === 1 ? '' : 's'}</div>
        <p style="text-align:center;margin:14px 0 4px;font-size:14px;color:var(--ink)">Those sets were done on
        <b>${escape(exercise.name)}</b>, not on whatever you swap to.</p>
        <p style="text-align:center;font-size:13px">They stay in your history as ${escape(
          exercise.name
        )}. Any set number the new exercise reaches will move the old set of that number to <b>Log → Bin</b>, where you
        can put it back. Nothing is destroyed either way.</p>
        <button class="big mt" data-act="confirm-swap" data-si="${slotIndex}">Swap anyway</button>
        <button class="big ghost mt" data-act="sheet-close">Keep ${escape(exercise.name)}</button>`);
      return;
    }

    openSheet(swapSheet(state, slotIndex, slot, exercise));
  },

  /** Name it, say what it stands in for, and it is yours from now on. */
  'open-custom-exercise'(ctx, data) {
    const { state } = ctx;
    const slotIndex = Number(data.si);
    const slot = slotsFor(state)[slotIndex];
    const exercise = state.plan.exercises[slot.ex];

    openSheet(`<div class="ttl">An exercise of your own</div>
      <p style="font-size:13px;margin:12px 0 12px;color:var(--ink2)">It is kept, counted in your volume like any other,
      and it travels in your backups. Nothing about it is temporary.</p>

      <div><label for="cx-name">What is it called</label>
        <input id="cx-name" type="text" placeholder="Smith machine squat" autocomplete="off"></div>

      <div class="mt"><label for="cx-based">It trains the same things as</label>
        <select id="cx-based">${Object.entries(state.plan.exercises)
          .filter(([, e]) => !e.custom && Object.keys(e.m || {}).length)
          .sort((a, b) => a[1].name.localeCompare(b[1].name))
          .map(
            ([id, e]) =>
              `<option value="${escape(id)}" ${id === slot.ex ? 'selected' : ''}>${escape(e.name)}</option>`
          )
          .join('')}</select></div>
      <p class="hint" style="margin:6px 2px 0">This copies that exercise's muscles, rest and units, so your new one
      counts correctly from the first set. Pick the closest thing — it does not have to be exact.</p>

      <button class="big mt" data-act="save-custom-exercise" data-si="${slotIndex}">Add it and use it today</button>
      <button class="big ghost mt" data-act="open-swap" data-si="${slotIndex}">Back</button>`);
    requestAnimationFrame(() => document.getElementById('cx-name')?.focus());
    void exercise;
  },

  async 'save-custom-exercise'(ctx, data) {
    const name = document.getElementById('cx-name')?.value ?? '';
    const basedOn = document.getElementById('cx-based')?.value ?? null;
    const id = await ctx.addCustomExercise({ name, basedOn });
    // Straight into today's session, because that is why you added it.
    await actions['do-swap'](ctx, { si: data.si, id });
  },

  'confirm-swap'(ctx, data) {
    const { state } = ctx;
    const slotIndex = Number(data.si);
    state.swapConfirmed = new Set([...(state.swapConfirmed || []), slotIndex]);
    actions['open-swap'](ctx, data);
  },

  async 'do-swap'(ctx, data) {
    const { state } = ctx;
    const slotIndex = Number(data.si);
    const slot = slotsFor(state)[slotIndex];
    if (!slot || !state.plan.exercises[data.id]) return;

    if (slot.added) {
      // An exercise you added is yours to change outright; there is no plan
      // exercise underneath it to swap back to.
      const extra = state.deviations.extras[slot.extraIndex];
      if (extra) extra.ex = data.id;
    } else if (data.id === slot.plannedEx) {
      // Choosing the plan's own exercise again is not a swap — it is undoing one.
      delete state.deviations.swaps[slotIndex];
    } else {
      state.deviations.swaps[slotIndex] = data.id;
    }
    state.exOpen.add(String(slotIndex));
    if (state.activeLog || !isOutsideRotation(state)) await ctx.saveDeviations();
    closeSheet();
    ctx.render();
  },

  /**
   * Option A or B, chosen on the card.
   *
   * An option is a swap the plan has already approved, so it goes through the
   * same path — the same record in `deviations`, the same `variantUsed` on every
   * set, the same warning when sets are already logged on the slot.
   */
  'pick-option'(ctx, data) {
    const { state } = ctx;
    const slotIndex = Number(data.si);
    const slot = slotsFor(state)[slotIndex];
    if (!slot || slot.ex === data.id) return;
    const logged = [...state.loggedSets.keys()].filter((key) => Number(key.split(':')[0]) === slotIndex).length;
    if (logged && !state.swapConfirmed?.has(slotIndex)) {
      const exercise = state.plan.exercises[slot.ex];
      openSheet(`<div class="ttl">${escape(exercise.name)} has ${logged} logged set${logged === 1 ? '' : 's'}</div>
        <p style="text-align:center;margin:14px 0 4px;font-size:14px;color:var(--ink)">Those sets were done on
        <b>${escape(exercise.name)}</b> and stay in your history as that. Any set number the other option reaches
        moves the old set of that number to <b>Log → Bin</b>, where you can put it back.</p>
        <button class="big mt" data-act="confirm-option" data-si="${slotIndex}" data-id="${escape(data.id)}">Switch anyway</button>
        <button class="big ghost mt" data-act="sheet-close">Keep ${escape(exercise.name)}</button>`);
      return;
    }
    return actions['do-swap'](ctx, { si: String(slotIndex), id: data.id });
  },

  'confirm-option'(ctx, data) {
    const { state } = ctx;
    state.swapConfirmed = new Set([...(state.swapConfirmed || []), Number(data.si)]);
    return actions['do-swap'](ctx, data);
  },

  about(ctx, data) {
    ctx.showExercise(data.id);
  },

  finish(ctx) {
    const { state } = ctx;
    const slots = slotsFor(state);
    let prescribed = 0;
    let done = 0;
    slots.forEach((slot, si) => {
      prescribed += slot.sets;
      for (let i = 0; i < slot.sets; i++) if (state.loggedSets.has(setKey(si, i))) done++;
    });

    if (done === 0) {
      openSheet(`<div class="ttl">Nothing logged</div>
        <p style="text-align:center;margin:14px 0 4px;font-size:14px;color:var(--ink)">No sets have been logged in this session.</p>
        <p style="text-align:center;font-size:13px">There is nothing to save yet.</p>
        <button class="big mt" data-act="sheet-close">Go back</button>`);
      return;
    }

    if (done < prescribed) {
      openSheet(`<div class="ttl">Empty values</div>
        <p style="text-align:center;margin:14px 0 4px;font-size:14px;color:var(--ink)"><b>${prescribed - done} of ${prescribed} sets</b> have no logged values.</p>
        <p style="text-align:center;font-size:13px">Save the session anyway? Unlogged sets are stored as empty, not as zero — they will not drag your averages down.</p>
        <button class="big mt" data-act="do-finish">Save anyway</button>
        <button class="big ghost mt" data-act="sheet-close">Go back</button>`);
      return;
    }

    return ctx.finishSession();
  },

  'do-finish'(ctx) {
    closeSheet();
    return ctx.finishSession();
  },

  /**
   * Start the clock without logging anything.
   *
   * Asks first when the rotation says this session is not the one to start —
   * see `startQuestion`. The first tick, a swap or an added exercise ask the
   * same question, from `ensureActiveLog`.
   */
  async 'start-session'(ctx) {
    const question = startQuestion(ctx.state);
    if (question && !isAnswered(ctx.state, question)) {
      askQuestion(ctx.state, question);
      return;
    }
    await ctx.startSession();
  },

  /**
   * The answer to "already done" or "not the first session": train it anyway,
   * or file it in the previous rotation. Recorded for this session and this
   * rotation only, then the session starts — and the set whose tick asked the
   * question is logged, so the answer does not cost a second tap.
   */
  async 'start-answer'(ctx, data) {
    const { state } = ctx;
    state.startAnswer = { sessionId: state.trainSessionId, sequence: state.cycle.sequence, choice: data.choice };
    closeSheet();
    await ctx.startSession();
    if (data.si != null && data.i != null) {
      await actions.tick(ctx, { si: data.si, i: data.i }, { stopPropagation() {} });
    } else {
      ctx.render();
    }
  },

  /** Close a session that was left open, at its last set. See `finishTimes`. */
  async 'close-stale'(ctx) {
    closeSheet();
    await ctx.finishSession();
  },

  /** It is still the same session: stop asking about it, and log the set. */
  async 'keep-stale'(ctx, data) {
    const { state } = ctx;
    state.staleAnswered = state.activeLog?.id ?? null;
    closeSheet();
    if (data.si != null && data.i != null) {
      await actions.tick(ctx, { si: data.si, i: data.i }, { stopPropagation() {} });
    } else {
      ctx.render();
    }
  },

  /** "Open A instead": the rotation's first session, in place of this one. */
  'start-pick'(ctx, data) {
    closeSheet();
    ctx.openSession(data.id);
  },

  async 'toggle-timing'(ctx) {
    await ctx.setTimingReliable(ctx.state.activeLog?.timingReliable === false);
  },
};

/** Inputs inside the set sheet, which must not trigger a re-render. */
/**
 * Write the three boxes from state.
 *
 * Called by the steppers and by nothing else: a box being typed into must never
 * have its own text replaced under the cursor, which is why the input handlers
 * below update state and the readout but not the box they came from.
 */
function repaintFields(ctx) {
  const c = ctx.state.sheetCtx;
  const unit = ctx.state.settings.unit;
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  };
  set('in-load', loadBox(c.load, unit));
  set('in-reps', c.reps ?? '');
  set('in-rpe', c.rpe ?? '');
}

/*
 * Notes live in `deviations`, which is already the record of how a session
 * departed from the plan, and already persisted by `saveDeviations`. A note is
 * exactly that kind of fact.
 */
async function setExerciseNote(ctx, slotIndex, value) {
  const { state } = ctx;
  const notes = { ...(state.deviations.exerciseNotes || {}) };
  // The exercise is recorded beside the note. A slot index is only meaningful
  // against the session that produced it, and reading a note back weeks later
  // means knowing which exercise it was about — otherwise it can only be
  // recovered from a set that happened to be logged at the same slot.
  const ids = { ...(state.deviations.exerciseNoteIds || {}) };
  const slot = slotsFor(state)[slotIndex];

  if (value) {
    notes[String(slotIndex)] = value;
    if (slot?.ex) ids[String(slotIndex)] = slot.ex;
  } else {
    delete notes[String(slotIndex)];
    delete ids[String(slotIndex)];
  }

  state.deviations = { ...state.deviations, exerciseNotes: notes, exerciseNoteIds: ids };
  await ctx.saveDeviations();
  closeSheet();
  ctx.render();
}

/**
 * One more set, or one fewer, on one exercise.
 *
 * Never below one set, and never below a set that is already logged: taking
 * away a row that has a logged set on it would hide real work. That set has to
 * be removed first, on purpose, in the set editor.
 */
async function changeSetCount(ctx, slotIndex, delta) {
  const { state } = ctx;
  const slot = slotsFor(state)[slotIndex];
  if (!slot) return;

  if (delta < 0) {
    const lastRow = slot.sets - 1;
    if (slot.sets <= 1) {
      openSheet(`<div class="ttl">One set is the minimum</div>
        <p style="text-align:center;margin:14px 0;font-size:13px">${
          slot.added
            ? 'To drop this exercise altogether, use <b>Remove</b>.'
            : 'To skip this exercise today, leave it unlogged — or swap it for something else.'
        }</p>
        <button class="big mt" data-act="sheet-close">OK</button>`);
      return;
    }
    if (state.loggedSets.has(setKey(slotIndex, lastRow))) {
      openSheet(`<div class="ttl">Set ${lastRow + 1} is logged</div>
        <p style="text-align:center;margin:14px 0;font-size:13px">Remove that set first — tap it and choose
        <b>Remove this set</b>. A set you logged is never hidden by taking its row away.</p>
        <button class="big mt" data-act="sheet-close">OK</button>`);
      return;
    }
  }

  if (slot.added) {
    const extra = state.deviations.extras[slot.extraIndex];
    if (!extra) return;
    extra.sets = Math.max(1, (extra.sets || 1) + delta);
  } else {
    const current = state.deviations.addedSets[slotIndex] || 0;
    const planned = slot.prescribedSets - current;
    // Bounded so the prescription never drops under one set.
    state.deviations.addedSets[slotIndex] = Math.max(1 - planned, current + delta);
  }

  state.exOpen.add(String(slotIndex));
  if (state.activeLog || !isOutsideRotation(state)) await ctx.saveDeviations();
  ctx.render();
}

export const inputs = {
  /**
   * Filter the exercise list in the open sheet.
   *
   * Works on the rows already on the page — no re-render, so the box keeps its
   * focus — and only ever hides rows, so whatever order they were rendered in
   * (closest first, in the swap sheet) is the order the matches stay in. In
   * the swap sheet an empty box shows the suggestions and a typed one shows
   * every matching exercise in the app. The "Other" row follows what you type.
   */
  'exercise-filter'(ctx, value) {
    const raw = String(value || '').replace(/\s+/g, ' ').trim();
    const query = normalize(raw);
    const sheet = document.querySelector('.sheet') || document;
    const suggested = sheet.querySelector('[data-filter-group="suggested"]');
    const all = sheet.querySelector('[data-filter-group="all"]');
    if (suggested) {
      suggested.hidden = !!query;
      if (all) all.hidden = !query;
    }
    let shown = 0;
    for (const button of all?.querySelectorAll('[data-search]') || []) {
      const match = !query || matchesQuery(button.dataset.search, query);
      button.hidden = !match;
      if (match) shown += 1;
    }

    // Offered unless what you typed is already an exercise, by name.
    const quick = all?.querySelector('[data-quick-create]');
    if (quick) {
      const exercises = ctx?.state?.plan?.exercises || {};
      const exists = Object.values(exercises).some((exercise) => normalize(exercise?.name) === query);
      quick.hidden = !query || exists;
      quick.dataset.quickName = raw;
      const label = quick.querySelector('[data-quick-label]');
      if (label) label.textContent = raw;
      if (quick.dataset.si == null) {
        const basis = quick.querySelector('[data-quick-basis]');
        const guess = exercises[guessBasedOn(raw, exercises)];
        if (basis) basis.textContent = guess ? `Added as your own exercise \u00b7 counted like ${guess.name}` : 'Added as your own exercise \u00b7 muscles not counted';
      }
    }

    const empty = all?.querySelector('[data-filter-empty]');
    if (empty) empty.hidden = shown > 0 || !query;
  },

  'field-load'(ctx, value) {
    const parsed = parseNumber(value);
    // An empty box is mid-edit, not a zero. Leave the last good value alone
    // until something parses, or clearing the box to retype would log a 0 kg set.
    if (parsed == null) return;
    ctx.state.sheetCtx.load = fromDisplay(parsed, ctx.state.settings.unit);
    repaintReadout(ctx);
  },
  'field-reps'(ctx, value) {
    const parsed = parseNumber(value);
    if (parsed == null) return;
    ctx.state.sheetCtx.reps = Math.max(1, Math.round(parsed));
    repaintReadout(ctx);
  },
  'field-rpe'(ctx, value) {
    const parsed = parseNumber(value);
    if (parsed == null) return;
    ctx.state.sheetCtx.rpe = Math.min(10, Math.max(5, parsed));
    repaintReadout(ctx);
  },
  velocity(ctx, value) {
    ctx.state.sheetCtx.velocity = parseNumber(value);
  },
  note(ctx, value) {
    ctx.state.sheetCtx.note = value || null;
  },
};
