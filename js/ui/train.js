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
  prescribedLoad,
  effectiveRpeDetail,
  roundToIncrement,
  systemLoad,
  warmupRamp,
  platesFor,
  pct,
} from '../calc.js';
import { resolveSession, toDisplaySession } from '../plan.js';
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
  const planned = (resolved.slots || []).map((slot, i) => {
    const swappedTo = state.deviations.swaps[i];
    const extraSets = state.deviations.addedSets[i] || 0;

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
  const current = slotsFor(state);
  const next = slotsFor(state, nextReadiness);
  if (current.length !== next.length) return true;
  return current.some((slot, i) => slot.ex !== next[i].ex);
}

const workingMaxFor = (state, exerciseId) =>
  state.maxes.get(exerciseId)?.workingMax ?? state.plan.meta.seedWorkingMaxes[exerciseId] ?? null;

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
  return {
    ...previous,
    summary: sameLoad
      ? `${fmtLoad(loads[0], state.settings.unit)} ${state.settings.unit} × ${reps}`
      : previous.sets
          .map((s) => `${fmtLoad(s.load, state.settings.unit)}×${s.reps ?? '—'}`)
          .join(' · '),
  };
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
  const session = state.plan.sessions.find((s) => s.id === state.trainSessionId);
  const slots = slotsFor(state);
  const resolved = resolveSession(state.plan, {
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

  const isNext = state.trainSessionId === state.position.nextSessionId;
  const label = isNext
    ? `Next in rotation · session ${state.position.sessionsDone + 1}`
    : `Picked manually · next up is ${escape(state.position.nextSessionId)}`;

  return `
  <div class="picker">${state.plan.sessions
    .map(
      (s) =>
        `<button class="pill ${s.id === state.trainSessionId ? 'on' : ''}" data-act="pick-session" data-id="${s.id}">${s.id}</button>`
    )
    .join('')}</div>

  ${state.calibration ? calibrationCard() : ''}

  ${readinessBar(state)}

  <div class="shead">
    <div class="lbl">${label}</div>
    <div class="nm">${escape(session.id)} · ${escape(session.name)}</div>
    <p class="why">${escape(session.purpose)}</p>
    <div class="bar"><i style="width:${prescribedSets ? (doneSets / prescribedSets) * 100 : 0}%"></i></div>
    <div class="meta">
      <span>${doneSets} / ${prescribedSets} sets</span>
      <span>~${estimateMinutes(state, slots)} min</span>
      <span>Cycle ${state.cycle.sequence}/${state.plan.meta.rotations} · ${escape(state.block.name)}</span>
      <span>${state.cycleProgress.complete}/${state.plan.meta.rotationOrder.length} this rotation</span>
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
    <div class="mini" style="margin-top:10px"><button data-act="open-cycle-control">Rotation ${state.cycle.sequence} ·
      correct</button></div>
  </div>

  <div class="card flush">${slots.map((slot, si) => exerciseBlock(state, slot, si)).join('')}</div>

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
    ${
      state.activeLog
        ? ''
        : `<button class="big ghost mt" data-act="start-session">Start session</button>
           <p class="hint">Only starts the clock. You never have to press it — the session starts itself the moment
           you tick your first set, and finishes fine either way. It is here for when you want the warm-up counted.</p>`
    }
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

  return `<div class="ex ${open ? 'open' : ''}">
    <div class="exhead" data-act="toggle-ex" data-si="${slotIndex}">
      <div class="tick ${all ? 'done' : done ? 'part' : ''}">${all ? '✓' : done || ''}</div>
      <div class="exnm"><b>${name}${slot.idx ? '<span class="badge idx">INDEX</span>' : ''}${
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
      <p class="hint">Last time · <b>${previous ? escape(previous.summary) : 'no previous data'}</b>${
        previous ? ` <span style="color:var(--muted)">· ${escape(previous.dateISO)}</span>` : ''
      }</p>
      ${
        prescribed != null
          ? prescriptionHint(state, slot, prescribed, workingMax)
          : `<p class="hint"><b>${slot.idx ? 'Find your baseline.' : 'No stored max for this one.'}</b> Pick a weight you think lands at the target RPE, log what actually happened, and the app carries it forward from here.</p>`
      }
      ${previous?.note ? `<p class="hint">Your last note · <b>${escape(previous.note)}</b></p>` : ''}
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
      <div class="mini">
        ${previous ? `<button data-act="same-as-last" data-si="${slotIndex}">Same as last time</button>` : ''}
        ${prescribed != null && !state.plan.exercises[slot.ex].bodyweightLoaded ? `<button data-act="open-ramp" data-si="${slotIndex}">Warm-up</button>` : ''}
        ${prescribed != null && !state.plan.exercises[slot.ex].bodyweightLoaded ? `<button data-act="open-plates" data-si="${slotIndex}">Plates</button>` : ''}
        <button data-act="add-set" data-si="${slotIndex}">+ Set</button>
        <button data-act="open-swap" data-si="${slotIndex}">Swap</button>
        <button class="warn" data-act="clear-pres" data-si="${slotIndex}">${
          state.cleared.has(String(slotIndex)) ? 'Restore prescribed' : 'Clear prescribed'
        }</button>
        <button data-act="about" data-id="${slot.ex}">About</button>
        <button class="${exerciseNote(state, slotIndex) ? 'warn' : ''}" data-act="open-ex-note" data-si="${slotIndex}">${
          exerciseNote(state, slotIndex) ? '\u2713 Note' : 'Note'
        }</button>
        ${
          exercise.grips
            ? `<button data-act="open-grip" data-si="${slotIndex}">Grip: ${escape(
                (state.grips[`${state.trainSessionId}-${slotIndex}`] || exercise.grips[0]).split(' (')[0]
              )}</button>`
            : ''
        }
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
  const why = total != null && estimate == null ? noEstimateReason(total, reps, Math.min(10, rpe)) : null;

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

    <div class="mini" style="justify-content:center;margin-bottom:12px">
      <button data-act="flag" data-flag="toFailure" class="${c.toFailure ? 'warn' : ''}">${c.toFailure ? '\u2713 ' : ''}To failure</button>
      <button data-act="flag" data-flag="isAmrap" class="${c.isAmrap ? 'warn' : ''}">${c.isAmrap ? '\u2713 ' : ''}AMRAP</button>
      <button data-act="flag" data-flag="isMyoRep" class="${c.isMyoRep ? 'warn' : ''}">${c.isMyoRep ? '\u2713 ' : ''}Myo-reps</button>
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

    <div class="g2">
      <div><label for="stepVel">Bar speed (m/s)</label>
        <input id="stepVel" type="number" inputmode="decimal" step="0.01" value="${c.velocity ?? ''}" data-pick data-act-input="velocity"></div>
      <div><label for="stepNote">Note for this set</label>
        <input id="stepNote" type="text" value="${escape(c.note ?? '')}" data-act-input="note"></div>
    </div>

    <div class="sheet-actions">
      <button class="big" data-act="save-step">Log this set</button>
      ${c.logged ? '<button class="big ghost mt" data-act="unlog-step">Remove this set</button>' : ''}
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

  'add-set'(ctx, data) {
    const slotIndex = Number(data.si);
    const planned = ctx.state.plan.sessions.find((s) => s.id === ctx.state.trainSessionId).slots;
    if (slotIndex < planned.length) {
      ctx.state.deviations.addedSets[slotIndex] = (ctx.state.deviations.addedSets[slotIndex] || 0) + 1;
    } else {
      ctx.state.deviations.extras[slotIndex - planned.length].sets += 1;
    }
    ctx.state.exOpen.add(String(slotIndex));
    ctx.saveDeviations();
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
      isMyoRep: values.logged ? !!values.logged.isMyoRep : !!slot.myoReps && i === slot.sets - 1,
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
      isMyoRep: c.isMyoRep,
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

  'set-grip'(ctx, data) {
    const { state } = ctx;
    const slot = slotsFor(state)[Number(data.si)];
    const grip = state.plan.exercises[slot.ex].grips[Number(data.gi)];
    state.grips[`${state.trainSessionId}-${data.si}`] = grip;
    ctx.saveDeviations();
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

  'do-add'(ctx, data) {
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
    ctx.saveDeviations();
    closeSheet();
    ctx.render();
  },

  'open-swap'(ctx, data) {
    const { state } = ctx;
    const slot = slotsFor(state)[Number(data.si)];
    const exercise = state.plan.exercises[slot.ex];
    const byId = Object.entries(state.plan.exercises);
    const suggested = exercise.subs
      .map((name) => byId.find(([, x]) => x.name.toLowerCase() === name.toLowerCase()))
      .filter(Boolean);

    openSheet(`<div class="ttl">Swap ${escape(exercise.name)}</div>
      <p style="font-size:13px;margin:12px 0 4px;color:var(--ink2)"><b style="color:var(--ink)">Recommended substitutes</b> — these hit the same muscles in the same way.</p>
      <div class="picklist">${exercise.subs
        .map((name, i) => {
          const match = suggested.find(([, x]) => x.name.toLowerCase() === name.toLowerCase());
          return match
            ? `<button data-act="do-swap" data-si="${data.si}" data-id="${match[0]}">${escape(name)}</button>`
            : `<button data-act="sheet-close" title="Not in the plan's exercise list">${escape(name)}<span>not tracked — log it as an added exercise</span></button>`;
        })
        .join('')}</div>
      <p style="font-size:12px;margin:12px 0 4px;color:var(--muted)">Or pick anything from the full list.</p>
      <div class="picklist" style="max-height:34vh;overflow:auto">${byId
        .map(([id, x]) => `<button data-act="do-swap" data-si="${data.si}" data-id="${id}">${escape(x.name)}</button>`)
        .join('')}</div>
      <button class="big ghost mt" data-act="sheet-close">Cancel</button>`);
  },

  'do-swap'(ctx, data) {
    ctx.state.deviations.swaps[Number(data.si)] = data.id;
    ctx.state.exOpen.add(String(data.si));
    ctx.saveDeviations();
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

    ctx.finishSession();
  },

  'do-finish'(ctx) {
    closeSheet();
    ctx.finishSession();
  },

  /** Start the clock without logging anything. */
  async 'start-session'(ctx) {
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
  if (value) notes[String(slotIndex)] = value;
  else delete notes[String(slotIndex)];

  state.deviations = { ...state.deviations, exerciseNotes: notes };
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
