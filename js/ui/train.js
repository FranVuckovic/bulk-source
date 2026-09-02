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
  exerciseAcrossPlan,
  sameExerciseElsewhere,
  slotById,
  companionSlots,
  BORROWABLE_FIELDS,
  substitutesFor,
} from '../plan.js';
import { exerciseNoteHistory } from '../analytics.js';
import { daysBetween } from '../dates.js';
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
} from './components.js';

const setKey = (slotIndex, setIndex) => `${slotIndex}:${setIndex}`;
export const CUSTOM_SESSION_ID = 'custom';

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
  if (state.trainSessionId === CUSTOM_SESSION_ID) {
    return (state.deviations.extras || []).map((slot, i) => {
      const prescribed = slot.sets;
      const loggedHere = highestLoggedIndex(state, i);
      const sets = Math.max(prescribed, loggedHere + 1);
      return { ...slot, sets, prescribedSets: prescribed, beyondPlan: sets > prescribed, added: true };
    });
  }
  // Everything block-specific comes from the plan engine: the bench work for
  // this block, the failure permission for this rotation's effort mode, the
  // accessory multiplier, the static hold if one is offered, and any readiness
  // adjustment. The screen never decides what the session is.
  const resolved = toDisplaySession(
    resolveSession(state.plan, {
      rotation: state.cycle.sequence,
      sessionId: state.trainSessionId,
      readiness: readinessOverride ?? state.readiness ?? 'normal',
    })
  );
  const planned = (resolved.slots || []).map((raw, i) => {
    const swappedTo = state.deviations.swaps[i];
    const extraSets = state.deviations.addedSets[i] || 0;

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

    /*
     * A slot never shows fewer rows than have already been logged against it.
     *
     * Anything that reshapes a session mid-way — switching to yellow, which
     * removes the last work set — otherwise leaves a logged set with nowhere to
     * render. It stays in the database and in every export, but the Train
     * screen stops drawing it, stops counting it, and gives you no way to
     * un-tick it. Three sets logged, "2 / 20 sets" on the header, and the third
     * one still real. A set that exists is always shown; whether the plan still
     * asks for it is a different question, answered by `beyondPlan`.
     */
    const prescribed = slot.sets + extraSets;
    const loggedHere = highestLoggedIndex(state, i);
    const sets = Math.max(prescribed, loggedHere + 1);

    return {
      ...slot,
      ex: swappedTo || slot.ex,
      sets,
      prescribedSets: prescribed,
      beyondPlan: sets > prescribed,
      swappedFrom: swappedTo ? slot.ex : null,
    };
  });
  return [...planned, ...state.deviations.extras];
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
  if (state.trainSessionId === CUSTOM_SESSION_ID) return false;
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
const workingMaxFor = (state, exerciseId) => {
  const own = state.maxes.get(exerciseId)?.workingMax ?? state.plan.meta.seedWorkingMaxes[exerciseId];
  if (own != null) return own;

  const from = state.plan.exercises[exerciseId]?.maxFrom;
  if (!from) return null;
  const parent = state.maxes.get(from.exerciseId)?.workingMax ?? state.plan.meta.seedWorkingMaxes[from.exerciseId];
  return parent == null ? null : parent * from.ratio;
};

/**
 * Bodyweight counts as part of the load on pull-ups, chin-ups and dips, so the
 * maths runs on bodyweight + added and the screen shows the added weight.
 * Everything else gets 0 and behaves exactly as before.
 */
const bodyweightFor = (state, exerciseId) =>
  state.plan.exercises[exerciseId]?.bodyweightLoaded ? state.settings.bodyweight : 0;

const loadOptions = (state, exerciseId) => ({ bodyweight: bodyweightFor(state, exerciseId) });

const prescriptionFor = (state, slot) =>
  prescribedLoad(slot, workingMaxFor(state, slot.ex), state.settings.increment, loadOptions(state, slot.ex));

const isFailureSet = (slot, i) => !!slot.failLast && i >= slot.sets - slot.failLast;

/** What the row is displaying, so a one-tap set stores it rather than null. */
const defaultGrip = (state, slot, slotIndex) => {
  const exercise = state.plan.exercises[slot.ex];
  if (!exercise?.grips?.length) return null;
  return state.grips[`${state.trainSessionId}-${slotIndex}`] || exercise.grips[0];
};

/** Every competition-bench set in this plan is paused; say so rather than guess later. */
const defaultPause = (state, slot) => (tracksPause(slot.ex) ? 'paused' : null);

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
export function lastTimePanel(state, previous, slot) {
  if (!previous) return '<div class="lastbox none">No previous data — today sets the baseline.</div>';

  const unit = state.settings.unit;
  const best = previous.sets.reduce(
    (top, set) => (set.load != null && (top == null || set.load > top.load) ? set : top),
    null
  );

  return `<div class="lastbox">
    <div class="lb-h">Last time${previous.sessionId ? ` · session ${escape(previous.sessionId)}` : ''}${
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
  const isCustom = state.trainSessionId === CUSTOM_SESSION_ID;
  const session = isCustom
    ? { id: 'Custom', name: 'Custom workout', purpose: 'An ad-hoc session that does not advance or change the A–F rotation.' }
    : state.plan.sessions.find((s) => s.id === state.trainSessionId);
  const slots = slotsFor(state);
  const resolved = isCustom
    ? { effortMode: 'none', accessoryMultiplier: 1, blockType: 'custom' }
    : resolveSession(state.plan, {
        rotation: state.cycle.sequence,
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
  <div class="picker">${state.plan.sessions
    .map(
      (s) =>
        `<button class="pill ${s.id === state.trainSessionId ? 'on' : ''}" data-act="pick-session" data-id="${s.id}">${s.id}</button>`
    )
    .join('')}<button class="pill custom ${isCustom ? 'on' : ''}" data-act="pick-session" data-id="${CUSTOM_SESSION_ID}">Custom</button></div>

  ${state.calibration && !isCustom ? calibrationCard() : ''}

  ${isCustom ? '' : readinessBar(state)}

  <div class="shead">
    <div class="lbl">${label}</div>
    <div class="nm">${escape(session.id)} · ${escape(session.name)}</div>
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
      isCustom
        ? '<p class="hint" style="margin-top:8px">Add any exercises below. Custom work still appears in History and analytics, but never replaces A–F.</p>'
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
function rotationDoneCard(state) {
  const last = state.cycle.sequence >= state.plan.meta.rotations;
  return `<div class="rotdone">
    <div class="rd-h">Rotation ${state.cycle.sequence} of ${state.plan.meta.rotations} is complete</div>
    <p>All six sessions are done. ${
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

function overshootNote(state, c) {
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
 * Three groups, and the order is the point. The plan's own suggestions lead,
 * because someone chose them. Then everything else the app knows, ranked by
 * how much of the same work it does — derived from the muscle map rather than
 * written down, so it cannot drift. Then the suggestions with no exercise
 * behind them, named rather than dropped: they used to render as dead buttons
 * saying "not tracked", which reads as a bug rather than as an invitation.
 *
 * That last group is what "add your own" is for. The gym that has no hack squat
 * is the reason this screen exists.
 */
function swapSheet(state, slotIndex, slot, exercise) {
  const { listed, similar, unlisted } = substitutesFor(state.plan, slot.ex);

  const row = (entry, badge) => {
    const other = entry.exercise;
    const share = Object.entries(other.m || {})
      .filter(([, weight]) => weight >= 0.5)
      .map(([id]) => state.plan.muscles[id]?.label || id)
      .slice(0, 3)
      .join(', ');
    return `<button data-act="do-swap" data-si="${slotIndex}" data-id="${escape(entry.id)}">
      ${escape(other.name)}${badge ? `<i class="tag">${escape(badge)}</i>` : ''}
      <span>${escape(share || 'no counted stimulus')}${
        other.custom ? ' · added by you' : ''
      }</span></button>`;
  };

  return `<div class="ttl">Swap ${escape(exercise.name)}</div>

    <button class="big mt" data-act="open-custom-exercise" data-si="${slotIndex}">
      + An exercise the plan does not have</button>
    <p class="hint" style="margin:6px 2px 14px">Kept for next time, counted in your volume, and it travels in your
    backups. Use it when the gym does not have what the plan asks for.</p>

    ${
      listed.length
        ? `<h4>The plan's own substitutes</h4>
           <div class="picklist">${listed.map((entry) => row(entry, 'listed')).join('')}</div>`
        : ''
    }

    ${
      similar.length
        ? `<h4>Closest by what they train</h4>
           <div class="picklist" style="max-height:38vh;overflow:auto">${similar
             .map((entry) => row(entry, null))
             .join('')}</div>`
        : '<p class="hint" style="margin:10px 2px">Nothing else in the plan trains this closely enough to stand in for it.</p>'
    }

    ${
      unlisted.length
        ? `<h4>Suggested, but not in the app</h4>
           <p class="hint" style="margin:0 2px 8px">${escape(
             unlisted.join(' · ')
           )} — add one above and it becomes trackable like any other.</p>`
        : ''
    }

    <button class="big ghost mt" data-act="sheet-close">Cancel</button>`;
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
  const workingMax = workingMaxFor(state, slot.ex);

  const rows = Array.from({ length: slot.sets }, (_, i) => setRow(state, slot, slotIndex, i)).join('');
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
    ${
      slot.added
        ? `<button class="warn" data-act="remove-added" data-si="${slotIndex}">Remove</button>`
        : `<button data-act="open-swap" data-si="${slotIndex}">Swap</button>`
    }
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
          ? prescriptionHint(state, slot, prescribed, workingMax)
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
 * What the prescribed load actually is, in the terms that make it judgeable.
 *
 * RPE is always relative to your one-rep max, never to today's top single — so
 * a back-off set shows both numbers: the percentage of today's single it was
 * derived from, and the percentage of the working max that the RPE comes from.
 * Below the bottom of the table it says "under 6" rather than printing a 6.00
 * that pretends to a precision the scale does not have.
 */
function prescriptionHint(state, slot, prescribed, workingMax) {
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
  parts.push(`${detail.percent.toFixed(1)}% of your ${fmtLoad(workingMax, unit)} ${unit} max`);
  parts.push(
    detail.clamped === 'below'
      ? 'effective RPE <b>under 6</b>'
      : `effective RPE <b>${detail.clamped === 'above' ? '10+' : fmtNum(detail.rpe, 2)}</b>`
  );

  return `<p class="hint">${parts.join(' · ')}</p>`;
}

function setRow(state, slot, slotIndex, i) {
  const unit = state.settings.unit;
  const { logged, toFailure, load, reps, rpe } = rowValues(state, slot, slotIndex, i);
  const cls = logged ? '' : 'pres';
  const bodyweight = bodyweightFor(state, slot.ex);
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
        <div class="v">${reps == null ? '—' : slot.amrap && !logged ? 'AM' : reps}</div><div class="k">reps</div></div>
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
function drawStepSheet(ctx) {
  const { state } = ctx;
  const c = state.sheetCtx;
  const exercise = state.plan.exercises[c.slot.ex];
  const unit = state.settings.unit;
  const workingMax = workingMaxFor(state, c.slot.ex);
  const bodyweight = bodyweightFor(state, c.slot.ex);

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
      ${field('load', bodyweight ? `Added (${unit})` : `Load (${unit})`, Math.round(toDisplay(c.load ?? 0, unit) * 10) / 10, stepFor(unit, state.settings.increment))}
      ${field('reps', 'Reps', c.reps ?? '', 1)}
      ${field('rpe', 'RPE', c.rpe ?? '', 0.5)}
    </div>

    <div class="eff" id="stepEff">${stepReadout(state, c, workingMax)}</div>
    <div id="stepOver">${overshootNote(state, c)}</div>

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
      <button class="big ghost mt" data-act="sheet-close">Cancel</button>
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
      workingMaxFor(ctx.state, ctx.state.sheetCtx.slot.ex)
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
    if (slot.amrap || slot.isTest) {
      actions['open-step'](ctx, { si: String(slotIndex), i: String(i), field: 'reps' });
      return;
    }

    const { load, reps, rpe, toFailure, prescribed } = rowValues(state, slot, slotIndex, i);
    await ctx.saveSet(slotIndex, i, {
      load,
      reps,
      rpe,
      toFailure,
      isAmrap: !!slot.amrap,
      formBreakdown: false,
      // The screen shows a default grip and pause; v1 saved null for both on a
      // one-tap set, so analytics silently mixed incomparable techniques.
      gripWidth: defaultGrip(state, slot, slotIndex),
      pauseStyle: defaultPause(state, slot),
      isMyoRep: !!slot.myoReps && i === slot.sets - 1,
      wasPrescribed: load != null && load === prescribed,
      prescribedLoad: prescribed,
    });
    startRest(slot.restSec || state.plan.exercises[slot.ex].defaultRestSec);
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

  async 'add-set'(ctx, data) {
    const slotIndex = Number(data.si);
    const planned = ctx.state.plan.sessions.find((s) => s.id === ctx.state.trainSessionId)?.slots || [];
    if (slotIndex < planned.length) {
      ctx.state.deviations.addedSets[slotIndex] = (ctx.state.deviations.addedSets[slotIndex] || 0) + 1;
    } else {
      ctx.state.deviations.extras[slotIndex - planned.length].sets += 1;
    }
    ctx.state.exOpen.add(String(slotIndex));
    if (ctx.state.activeLog || ctx.state.trainSessionId !== CUSTOM_SESSION_ID) await ctx.saveDeviations();
    ctx.render();
  },

  async 'remove-added'(ctx, data) {
    const { state } = ctx;
    const slotIndex = Number(data.si);
    const wouldReindexLogged = [...state.loggedSets.keys()].some((key) => Number(key.split(':')[0]) >= slotIndex);
    if (wouldReindexLogged) {
      openSheet(`<div class="ttl">Exercise has logged sets</div>
        <p style="text-align:center;margin:14px 0;font-size:13px">This exercise or one below it already has logged sets. Remove those sets first, or discard the whole session. A visible set is never shifted onto a different exercise.</p>
        <button class="big mt" data-act="sheet-close">Go back</button>`);
      return;
    }
    const plannedLength = state.plan.sessions.find((s) => s.id === state.trainSessionId)?.slots.length || 0;
    state.deviations.extras.splice(slotIndex - plannedLength, 1);
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
      load: values.load ?? 0,
      reps: values.reps ?? slot.reps,
      rpe: values.rpe,
      toFailure: values.logged ? !!values.logged.toFailure : values.toFailure,
      isAmrap: values.logged ? !!values.logged.isAmrap : !!slot.amrap,
      formBreakdown: !!values.logged?.formBreakdown,
      isMyoRep: values.logged ? !!values.logged.isMyoRep : !!slot.myoReps && i === slot.sets - 1,
      isIndexSet: values.logged ? !!values.logged.isIndexSet : !!slot.idx,
      velocity: values.logged?.velocity ?? null,
      note: values.logged?.note ?? null,
      pauseStyle: values.logged?.pauseStyle ?? null,
      prescribed: values.prescribed,
    };
    drawStepSheet(ctx);
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

  /** One tap fills every set of an accessory with last session's numbers. */
  async 'same-as-last'(ctx, data) {
    const { state } = ctx;
    const slotIndex = Number(data.si);
    const slot = slotsFor(state)[slotIndex];
    const previous = lastTime(state, slot.ex);
    if (!previous?.sets?.length) return;

    state.exOpen.add(String(slotIndex));
    for (let i = 0; i < slot.sets; i++) {
      const source = previous.sets[i] ?? previous.sets[previous.sets.length - 1];
      await ctx.saveSet(slotIndex, i, {
        load: source.load,
        reps: source.reps,
        rpe: source.rpe ?? slot.rpe,
        toFailure: isFailureSet(slot, i),
        isAmrap: !!slot.amrap,
        isMyoRep: !!slot.myoReps && i === slot.sets - 1,
        wasPrescribed: false,
        prescribedLoad: prescriptionFor(state, slot),
      });
    }
    startRest(slot.restSec || state.plan.exercises[slot.ex].defaultRestSec);
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
    ctx.state.exOpen.add(String(c.si));
    await ctx.saveSet(c.si, c.i, {
      // Zero is a real added load on a pull-up, chin-up or dip. v1's `|| null`
      // turned an unweighted set into a blank that produced no e1RM and no
      // tonnage.
      load: Number.isFinite(c.load) ? c.load : null,
      reps: c.reps ?? null,
      rpe: c.rpe,
      toFailure: c.toFailure,
      isAmrap: c.isAmrap,
      formBreakdown: !!c.formBreakdown,
      isMyoRep: c.isMyoRep,
      isIndexSet: c.isIndexSet,
      velocity: c.velocity,
      note: c.note,
      pauseStyle: c.pauseStyle,
      wasPrescribed: c.load != null && c.load === c.prescribed,
      prescribedLoad: c.prescribed,
    });
    startRest(c.slot.restSec || ctx.state.plan.exercises[c.slot.ex].defaultRestSec);
    closeSheet();
    ctx.render();
  },

  async 'unlog-step'(ctx) {
    const c = ctx.state.sheetCtx;
    await ctx.removeSet(c.si, c.i);
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

  'open-add'(ctx) {
    const { state } = ctx;
    openSheet(`<div class="ttl">Add an exercise</div><div class="picklist mt" style="max-height:60vh;overflow:auto">${Object.entries(
      state.plan.exercises
    )
      .map(
        ([id, x]) =>
          `<button data-act="do-add" data-id="${id}">${escape(x.name)}<span>${
            Object.keys(x.m)
              .map((m) => escape(state.plan.muscles[m].label.split(' —')[0]))
              .join(' · ') || 'no counted stimulus'
          }</span></button>`
      )
      .join('')}</div><button class="big ghost mt" data-act="sheet-close">Cancel</button>`);
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
    if (state.activeLog || state.trainSessionId !== CUSTOM_SESSION_ID) await ctx.saveDeviations();
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
    if (state.activeLog || state.trainSessionId !== CUSTOM_SESSION_ID) await ctx.saveDeviations();
    closeSheet();
    ctx.render();
  },

  async 'revert-phase'(ctx, data) {
    const { state } = ctx;
    const swaps = { ...(state.deviations.phaseSwaps || {}) };
    delete swaps[String(Number(data.si))];
    state.deviations = { ...state.deviations, phaseSwaps: swaps };
    if (state.activeLog || state.trainSessionId !== CUSTOM_SESSION_ID) await ctx.saveDeviations();
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
    ctx.state.deviations.swaps[Number(data.si)] = data.id;
    ctx.state.exOpen.add(String(data.si));
    await ctx.saveDeviations();
    closeSheet();
    ctx.render();
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

  /** Start the clock without logging anything. */
  /**
   * Starting a session that this rotation has already had.
   *
   * The last line of defence for the misfiling loop. Even with the screen
   * saying the rotation is finished, you can pick a session and start it — and
   * you may genuinely want to, after a session that went badly. What you must
   * not do is start it *believing* you are in the next rotation. So the app
   * says which rotation the work is about to be filed under, and offers the
   * advance instead.
   */
  async 'start-session'(ctx) {
    const { state } = ctx;
    const status =
      state.trainSessionId === CUSTOM_SESSION_ID
        ? null
        : state.cycleProgress.positions.find((p) => p.position === state.trainSessionId)?.status;

    if (status === 'complete' || status === 'partial') {
      const last = state.cycle.sequence >= state.plan.meta.rotations;
      openSheet(`<div class="ttl">Already done this rotation</div>
        <p style="text-align:center;margin:14px 0 4px;font-size:14px;color:var(--ink)">Session <b>${escape(
          state.trainSessionId
        )}</b> is already logged as ${escape(status)} in <b>rotation ${state.cycle.sequence}</b>.</p>
        <p style="text-align:center;font-size:13px">Starting it now records a second ${escape(
          state.trainSessionId
        )} in rotation ${state.cycle.sequence}${
          last ? '.' : ` — not in rotation ${state.cycle.sequence + 1}.`
        }</p>
        ${
          last
            ? ''
            : `<button class="big mt" data-act="advance-cycle">Start rotation ${state.cycle.sequence + 1} first</button>`
        }
        <button class="big ghost mt" data-act="do-start-session">Train it in rotation ${state.cycle.sequence} anyway</button>
        <button class="big ghost mt" data-act="sheet-close">Go back</button>`);
      return;
    }

    await ctx.startSession();
  },

  async 'do-start-session'(ctx) {
    closeSheet();
    await ctx.startSession();
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
  set('in-load', Math.round(toDisplay(c.load ?? 0, unit) * 10) / 10);
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

export const inputs = {
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
