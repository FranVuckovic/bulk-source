/**
 * calculator.js — the RPE calculator.
 *
 * Two questions, one sheet:
 *
 *   forward   weight + reps + RPE  →  estimated max
 *   reverse   estimated max + reps + RPE  →  the weight to load
 *
 * Both are the same table read in opposite directions, and both come from
 * `calc.js` — `e1rm` and `loadForE1rm`. Nothing is computed here. The rule the
 * rest of the app follows applies just as hard to a calculator: an answer that
 * cannot be justified is not shown. Off the table, or past twelve reps, it says
 * why instead of printing a confident number.
 *
 * State lives in this module rather than in `state`, because none of it is
 * worth persisting and none of it is anyone's training data — it is a scratch
 * pad. It survives closing the sheet within a session and nothing longer.
 */

import { e1rm, loadForE1rm, pct, rpeFor, noEstimateReason, MAX_ESTIMABLE_REPS, RPE_COLUMNS } from '../calc.js';
import { openSheet, escape, fmtNum, toDisplay, fromDisplay, parseNumber } from './components.js';

/** 8, not 8.0 — but 8.5 keeps its half. */
const tidy = (value) => (value == null ? '—' : String(Math.round(value * 10) / 10));

/** The scratch pad. Numbers are strings, because that is what an input holds. */
const pad = {
  // 'forward' → find the max · 'reverse' → find the weight · 'effort' → find the RPE
  mode: 'forward',
  basis: 'weight', // 'weight' → kilos or pounds · 'percent' → % of 1RM
  load: '',
  max: '',
  reps: '5',
  rpe: '8',
};

/** For tests: the pad, without reaching into the module. */
export const calculatorState = () => ({ ...pad });

/** For tests, and for a fresh sheet after the unit changes under it. */
export function resetCalculator() {
  Object.assign(pad, { mode: 'forward', basis: 'weight', load: '', max: '', reps: '5', rpe: '8' });
}

/** Which fields a mode asks for. RPE is an answer in 'effort', an input elsewhere. */
export const MODES = Object.freeze({
  forward: { label: 'Find max', needs: ['load'], asksRpe: true },
  reverse: { label: 'Find weight', needs: ['max'], asksRpe: true },
  effort: { label: 'Find RPE', needs: ['load', 'max'], asksRpe: false },
});

/* ═══════════════════════════════════════════════════════════════════════
   The answer
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * What the calculator currently knows, as a plain object a view can render and
 * a test can assert on.
 *
 * `value` is always kilograms — the app's one rule about loads — and `percent`
 * is the same answer expressed against the max, which is the whole point of the
 * basis toggle. A missing input is not an error; it is just not an answer yet.
 */
export function answer(state, input = pad) {
  const reps = parseNumber(input.reps);
  const unit = state.settings.unit;

  if (reps == null) return { kind: 'waiting', why: 'Enter the reps.' };
  if (!Number.isFinite(reps) || reps < 1) return { kind: 'none', why: 'Reps has to be at least 1.' };
  if (reps > MAX_ESTIMABLE_REPS) {
    return { kind: 'none', why: `Over ${MAX_ESTIMABLE_REPS} reps the table has nothing to say.` };
  }

  /* ── Find the RPE ── weight and a max, against the table ─────────────── */
  if (input.mode === 'effort') {
    const typed = parseNumber(input.load);
    const typedMax = parseNumber(input.max);
    if (typed == null || typedMax == null) {
      return { kind: 'waiting', why: 'Enter the weight and the max to measure it against.' };
    }
    if (typedMax <= 0) return { kind: 'none', why: 'The max has to be more than nothing.' };

    // In percent basis the weight typed is already the percentage.
    const ratio = input.basis === 'percent' ? typed / 100 : parseNumber(input.load) / typedMax;
    const percentage = ratio * 100;

    // The table's own edges for this rep count, so a load outside them is
    // reported as outside rather than clamped to 10 or 6 and called an answer.
    const hardest = pct(reps, 10);
    const easiest = pct(reps, 6);
    if (percentage > hardest) {
      return {
        kind: 'none',
        why: `That is ${tidy(percentage)}% of the max — heavier than the table's hardest ${reps}-rep set (${tidy(hardest)}%). One of the two numbers is wrong, or your max is higher than you think.`,
      };
    }
    if (percentage < easiest) {
      return {
        kind: 'none',
        why: `That is ${tidy(percentage)}% of the max — lighter than RPE 6 for ${reps} reps (${tidy(easiest)}%). Easier than the table goes.`,
      };
    }
    // To the nearest half, because that is the granularity the table has and
    // the only vocabulary the rest of the app speaks. "RPE 8.4" is a precision
    // neither the maths nor a lifter possesses.
    return { kind: 'rpe', value: Math.round(rpeFor(ratio, reps) * 2) / 2, percent: percentage };
  }

  /* ── The two directions that take an RPE ────────────────────────────── */
  const rpe = parseNumber(input.rpe);
  if (rpe == null) return { kind: 'waiting', why: 'Pick an RPE.' };

  const percentage = pct(reps, rpe);
  if (percentage == null) {
    return { kind: 'none', why: `RPE ${tidy(rpe)} is outside the table's 6–10 range.` };
  }

  if (input.mode === 'forward') {
    const typed = parseNumber(input.load);
    if (typed == null) return { kind: 'waiting', why: 'Enter the weight you lifted.', percent: percentage };
    if (input.basis === 'percent') {
      return { kind: 'percent-forward', percent: percentage, typed, value: null };
    }
    const kg = fromDisplay(typed, unit);
    const value = e1rm(kg, reps, rpe);
    if (value == null) return { kind: 'none', why: noEstimateReason(kg, reps, rpe) || 'No estimate.' };
    return { kind: 'max', value, percent: percentage };
  }

  const typedMax = parseNumber(input.max);
  if (typedMax == null) return { kind: 'waiting', why: 'Enter the max to work from.', percent: percentage };
  if (input.basis === 'percent') {
    return { kind: 'percent-reverse', percent: percentage, value: null };
  }
  const maxKg = fromDisplay(typedMax, unit);
  const value = loadForE1rm(maxKg, reps, rpe);
  if (value == null) return { kind: 'none', why: 'That combination is off the table.' };
  return { kind: 'load', value, percent: percentage };
}

/* ═══════════════════════════════════════════════════════════════════════
   View
   ═══════════════════════════════════════════════════════════════════════ */

const toggle = (items, current, action) =>
  `<div class="calc-seg">${items
    .map(
      ([id, label]) =>
        `<button class="${id === current ? 'on' : ''}" data-act="${action}" data-id="${id}">${escape(label)}</button>`
    )
    .join('')}</div>`;

const RPE_STEPS = [...RPE_COLUMNS].reverse();

/**
 * The knowledge entry that explains this calculator, by title.
 *
 * Matched by title rather than by index, because the knowledge base is data and
 * an index would silently point at the wrong article the first time an entry is
 * inserted above it. A test asserts the title still exists.
 */
export const EXPLAINER = 'Where the estimated max comes from';

function resultBlock(state, result, input = pad) {
  const unit = state.settings.unit;
  const pctLine =
    result.percent == null
      ? ''
      : `<div class="calc-sub">${tidy(result.percent)}% of 1RM at ${escape(tidy(parseNumber(input.reps)))} reps</div>`;

  if (result.kind === 'rpe') {
    return `<div class="calc-out">
      <div class="calc-lbl">That set was about</div>
      <div class="calc-big">RPE ${escape(tidy(result.value))}</div>
      <div class="calc-sub">${escape(repsInReserve(result.value))} · ${tidy(result.percent)}% of the max you gave</div>
    </div>`;
  }

  if (result.kind === 'max' || result.kind === 'load') {
    return `<div class="calc-out">
      <div class="calc-lbl">${result.kind === 'max' ? 'Estimated max' : 'Load this'}</div>
      <div class="calc-big">${escape(fmtNum(toDisplay(result.value, unit)))}<small>${escape(unit)}</small></div>
      ${pctLine}
    </div>`;
  }

  if (result.kind === 'percent-forward' || result.kind === 'percent-reverse') {
    return `<div class="calc-out">
      <div class="calc-lbl">${result.kind === 'percent-forward' ? 'That set is' : 'Load this'}</div>
      <div class="calc-big">${escape(tidy(result.percent))}<small>% of 1RM</small></div>
      <div class="calc-sub">Switch to ${escape(unit)} to turn this into a number for the bar.</div>
    </div>`;
  }

  return `<div class="calc-out ${result.kind === 'none' ? 'bad' : 'wait'}">
    <div class="calc-lbl">${result.kind === 'none' ? 'No answer' : 'Waiting'}</div>
    <div class="calc-why">${escape(result.why)}</div>
    ${result.kind === 'none' ? '' : pctLine}
  </div>`;
}

/** What an RPE means, in the words the app uses everywhere else. */
function repsInReserve(rpe) {
  const left = Math.round((10 - rpe) * 2) / 2;
  if (left <= 0) return 'nothing left';
  if (left === 1) return 'about one rep left';
  return `about ${tidy(left)} reps left`;
}

export function sheet(state, input = pad) {
  const unit = state.settings.unit;
  const result = answer(state, input);
  const percentBasis = input.basis === 'percent';
  const mode = MODES[input.mode] ?? MODES.forward;

  const label = (key) => {
    if (key === 'load') return percentBasis ? 'Weight, % of max' : `Weight (${unit})`;
    return percentBasis ? 'Max = 100%' : `Max (${unit})`;
  };
  // In percent basis a "max" field means nothing — the max is 100 by definition.
  const shown = mode.needs.filter((key) => !(percentBasis && key === 'max'));

  return `<h3 style="margin-top:0">RPE calculator</h3>
  <p class="hint" style="margin:0 2px 12px">The same table the app uses, read in any direction.</p>

  <div class="calc-seg">${Object.entries(MODES)
    .map(
      ([id, m]) =>
        `<button class="${id === input.mode ? 'on' : ''}" data-act="calc-mode" data-id="${id}">${escape(m.label)}</button>`
    )
    .join('')}</div>

  <div class="calc-grid" style="grid-template-columns:repeat(${shown.length + 1},1fr)">
    ${shown
      .map(
        (key) => `<label class="calc-f">
      <span>${escape(label(key))}</span>
      <input type="number" inputmode="decimal" step="0.5" data-act-input="calc-${key}" value="${escape(input[key])}">
    </label>`
      )
      .join('')}
    <label class="calc-f">
      <span>Reps</span>
      <input type="number" inputmode="numeric" step="1" min="1" data-act-input="calc-reps" value="${escape(input.reps)}">
    </label>
  </div>

  ${
    mode.asksRpe
      ? `<div class="calc-lbl" style="margin:0 2px 6px">RPE</div>
    <div class="calc-rpes">${RPE_STEPS.map(
      (value) =>
        `<button class="${String(value) === String(parseNumber(input.rpe)) ? 'on' : ''}" data-act="calc-rpe-pick" data-id="${value}">${value}</button>`
    ).join('')}</div>`
      : ''
  }

  <div id="calc-result">${resultBlock(state, result, input)}</div>

  ${toggle(
    [
      ['weight', unit],
      ['percent', '% of 1RM'],
    ],
    input.basis,
    'calc-basis'
  )}

  <p class="hint" style="margin:14px 2px 0">
    RPE 10 is no reps left, 9 is one left, 8 is two.
    <button class="linky" data-act="calc-explain">How this maths works →</button>
  </p>`;
}

/**
 * Repaint only the answer.
 *
 * Redrawing the whole sheet on every keystroke would take the focus and the
 * caret with it, which makes a number impossible to type on a phone. The
 * toggles redraw everything, because they change what the fields mean.
 */
function repaint(ctx) {
  const host = document.getElementById('calc-result');
  if (host) host.innerHTML = resultBlock(ctx.state, answer(ctx.state));
}

export const inputs = {
  'calc-load'(ctx, value) {
    pad.load = value;
    repaint(ctx);
  },
  'calc-max'(ctx, value) {
    pad.max = value;
    repaint(ctx);
  },
  'calc-reps'(ctx, value) {
    pad.reps = value;
    repaint(ctx);
  },
};

export const actions = {
  'open-calculator'(ctx) {
    openSheet(sheet(ctx.state));
  },
  'calc-mode'(ctx, data) {
    pad.mode = data.id;
    openSheet(sheet(ctx.state));
  },
  'calc-basis'(ctx, data) {
    pad.basis = data.id;
    openSheet(sheet(ctx.state));
  },
  'calc-rpe-pick'(ctx, data) {
    pad.rpe = data.id;
    openSheet(sheet(ctx.state));
  },
  'calc-explain'(ctx) {
    ctx.goTo({ tab: 'plan', planSection: 'tips', tipOpen: EXPLAINER });
  },
};
