/**
 * calc.js — every number the app calculates.
 *
 * Pure by contract: inputs in, outputs out. No DOM, no storage, no Date.now(),
 * no I/O of any kind. That is what makes it testable, and the maths is the part
 * that must never be silently wrong — a bad e1RM corrupts months of training
 * decisions before anyone notices.
 *
 * The RPE table and the e1RM / prescribed-load / rounding logic are ported from
 * the reviewed demo (docs/demo.html), not reinvented.
 *
 * All loads are kilograms. Pounds is a display transform and lives elsewhere.
 */

/* ═══════════════════════════════════════════════════════════════════════
   RPE → %1RM (Tuchscherer / Helms)
   ═══════════════════════════════════════════════════════════════════════ */

/** Table columns, descending. RPE 10 = failure, RPE 8 = 2 reps in reserve. */
export const RPE_COLUMNS = Object.freeze([10, 9.5, 9, 8.5, 8, 7.5, 7, 6.5, 6]);

/** Rep rows the table actually tabulates. 7, 9 and 11 are interpolated by row snapping. */
export const TABULATED_REPS = Object.freeze([1, 2, 3, 4, 5, 6, 8, 10, 12]);

/** Percentage of 1RM, keyed by reps, one entry per column in RPE_COLUMNS. */
export const RPE_TABLE = Object.freeze({
  1: Object.freeze([100, 97.8, 95.5, 93.9, 92.2, 90.7, 89.2, 87.8, 86.3]),
  2: Object.freeze([95.5, 93.9, 92.2, 90.7, 89.2, 87.8, 86.3, 85, 83.7]),
  3: Object.freeze([92.2, 90.7, 89.2, 87.8, 86.3, 85, 83.7, 82.4, 81.1]),
  4: Object.freeze([89.2, 87.8, 86.3, 85, 83.7, 82.4, 81.1, 79.9, 78.6]),
  5: Object.freeze([86.3, 85, 83.7, 82.4, 81.1, 79.9, 78.6, 77.4, 76.2]),
  6: Object.freeze([83.7, 82.4, 81.1, 79.9, 78.6, 77.4, 76.2, 75.1, 73.9]),
  8: Object.freeze([78.6, 77.4, 76.2, 75.1, 73.9, 72.3, 70.7, 69.4, 68]),
  10: Object.freeze([73.9, 72.3, 70.7, 69.4, 68, 66.7, 65.3, 64, 62.6]),
  12: Object.freeze([68, 66.7, 65.3, 64, 62.6, 61.3, 59.9, 58.6, 57.2]),
});

/** Highest rep count that still produces a meaningful estimated max. */
export const MAX_ESTIMABLE_REPS = 12;

/**
 * Snap a rep count to the nearest tabulated row. Ties go to the lower row,
 * so 7 reads as 6, 9 as 8 and 11 as 10 — the conservative direction, since the
 * lower row prescribes the lighter load.
 */
export function nearestRepRow(reps) {
  return TABULATED_REPS.reduce((a, b) => (Math.abs(b - reps) < Math.abs(a - reps) ? b : a));
}

/**
 * Percentage of 1RM for a given reps × RPE, interpolating linearly between
 * columns for half-points (and any other fractional RPE).
 *
 * An RPE outside 6–10 — including a missing one — falls back to the RPE 8
 * column rather than throwing, because a prescription still has to render.
 * Callers that care about the difference should use estimateE1rm(), which
 * flags the fallback instead of hiding it.
 */
export function pct(reps, rpe) {
  const row = RPE_TABLE[nearestRepRow(reps)];
  const exact = RPE_COLUMNS.indexOf(rpe);
  if (exact >= 0) return row[exact];

  for (let k = 0; k < RPE_COLUMNS.length - 1; k++) {
    if (rpe <= RPE_COLUMNS[k] && rpe >= RPE_COLUMNS[k + 1]) {
      const f = (rpe - RPE_COLUMNS[k + 1]) / (RPE_COLUMNS[k] - RPE_COLUMNS[k + 1]);
      return row[k + 1] + f * (row[k] - row[k + 1]);
    }
  }
  return row[4]; // off-table RPE → treat as RPE 8
}

/**
 * Inverse lookup: what RPE does this fraction of the working max represent at
 * this rep count? Used to show the effective RPE after a load is rounded to
 * something you can actually load on the bar.
 *
 * Clamps to 10 above the table and 6 below it — outside that range the scale
 * has nothing to say.
 */
export function rpeFor(ratio, reps) {
  const row = RPE_TABLE[nearestRepRow(reps)];
  const p = ratio * 100;

  for (let k = 0; k < RPE_COLUMNS.length - 1; k++) {
    if (p <= row[k] && p >= row[k + 1]) {
      const f = (p - row[k + 1]) / (row[k] - row[k + 1]);
      return RPE_COLUMNS[k + 1] + f * (RPE_COLUMNS[k] - RPE_COLUMNS[k + 1]);
    }
  }
  return p > row[0] ? 10 : 6;
}

/* ═══════════════════════════════════════════════════════════════════════
   Estimated 1RM
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Estimated 1RM from a set at a known RPE. Null above 12 reps: past there the
 * estimate stops being meaningful, and a number that looks precise and is not
 * is worse than no number.
 */
export function e1rm(load, reps, rpe) {
  if (!load || !reps || reps > MAX_ESTIMABLE_REPS) return null;
  return load / (pct(reps, rpe) / 100);
}

/**
 * Epley fallback for sets logged without an RPE. Reps of 1 returns the load
 * itself — Epley's formula adds 3.3% at a single, which is nonsense for a lift
 * you actually completed.
 */
export function epley(load, reps) {
  if (!load || !reps || reps > MAX_ESTIMABLE_REPS) return null;
  return reps === 1 ? load : load * (1 + reps / 30);
}

/**
 * The estimate plus how it was arrived at. A missing RPE drops to Epley and is
 * flagged low-confidence, so charts and PR claims can exclude it rather than
 * mixing two different measurements into one line.
 */
export function estimateE1rm(load, reps, rpe) {
  if (!load || !reps || reps > MAX_ESTIMABLE_REPS) return null;

  if (rpe == null) {
    return { value: epley(load, reps), method: 'epley', confidence: 'low' };
  }
  return { value: e1rm(load, reps, rpe), method: 'rpe', confidence: 'high' };
}

/* ═══════════════════════════════════════════════════════════════════════
   Prescribed load
   ═══════════════════════════════════════════════════════════════════════ */

/** Plates you can actually load. 2.5 kg unless micro-plates are available. */
export const DEFAULT_INCREMENT = 2.5;

/**
 * The AMRAP sits at a fixed fraction of the working max for a whole block —
 * comparability is the entire point of the measurement, so it is deliberately
 * not an RPE lookup. 83% sits mid-way through the 80–87% window the protocol
 * specifies.
 */
export const AMRAP_FRACTION = 0.83;

export function roundToIncrement(value, increment = DEFAULT_INCREMENT) {
  if (value == null || !Number.isFinite(value)) return null;
  if (!Number.isFinite(increment) || increment <= 0) return value;
  return Math.round(value / increment) * increment;
}

/*
 * Bodyweight-loaded lifts — pull-ups, chin-ups, dips.
 *
 * On these, what you lift is your bodyweight PLUS whatever hangs from the belt,
 * so every percentage, every RPE and every e1RM has to be computed on the total
 * system load. A +25 kg pull-up at 90 kg bodyweight is a 115 kg lift, and
 * treating it as a 25 kg lift makes the maths meaningless.
 *
 * The number you enter and the number stored stays the ADDED weight, because
 * that is what you put on the belt. Bodyweight is added on the way into the
 * maths and taken off again on the way out.
 */
export const systemLoad = (added, bodyweight = 0) =>
  added == null ? null : added + (bodyweight || 0);

export const addedLoad = (system, bodyweight = 0) =>
  system == null ? null : system - (bodyweight || 0);

/**
 * The load to put on the bar — or on the belt — for a plan slot, given the
 * exercise's working max. Returns null when there is no max to calculate from:
 * the first rotation, or an exercise that deliberately has no stored max.
 *
 * With a bodyweight, the working max is read as a TOTAL system load and the
 * returned figure is the ADDED weight. Rounding is applied to the added weight,
 * since that is the part that comes in plate-sized pieces.
 *
 * The intermediate top-single figure is rounded the same way, because it stands
 * for a load that would genuinely be on the bar that day.
 */
export function prescribedLoad(slot, workingMax, increment = DEFAULT_INCREMENT, { bodyweight = 0 } = {}) {
  if (!slot || !workingMax) return null;

  const roundAdded = (system) => roundToIncrement(system - bodyweight, increment);

  if (slot.amrap) return roundAdded(workingMax * AMRAP_FRACTION);

  // Back-offs are a percentage of TODAY'S top single, not of the working max —
  // that is how the protocol they come from was actually run.
  if (slot.pctTop) {
    const topSystem = systemLoad(roundAdded((workingMax * pct(1, 8)) / 100), bodyweight);
    return roundAdded(topSystem * slot.pctTop);
  }

  return roundAdded((workingMax * pct(slot.reps, slot.rpe)) / 100);
}

/** What the rounded load actually asks of you, at the slot's rep count. */
export function effectiveRpe(load, workingMax, reps, { bodyweight = 0 } = {}) {
  if (load == null || !workingMax) return null;
  const system = systemLoad(load, bodyweight);
  if (!system) return null;
  return rpeFor(system / workingMax, reps);
}

/**
 * How far past the table's edge a load has to sit before the screen says so.
 *
 * Rounding a prescription to the nearest plate moves it by a fraction of a
 * percent — a 250 kg leg press at RPE 10 rounds from 184.75 to 185 kg, which is
 * 0.1% past the top of the table. Flagging that as off-scale would be true and
 * useless. The table's own resolution is 0.1 percentage points; half a point of
 * slack is smaller than a single plate at any realistic load.
 */
export const TABLE_EDGE_TOLERANCE = 0.5;

/**
 * The effective RPE plus whether the table ran out underneath or above it.
 *
 * The scale only spans RPE 6 to 10, so a load lighter than the RPE 6 entry
 * clamps to 6 — and printing a flat "6.0" for a set that is genuinely easier
 * than that reads as precision the number does not have. The screen shows
 * "under 6" instead, alongside the percentage it is actually working at.
 */
export function effectiveRpeDetail(load, workingMax, reps, { bodyweight = 0 } = {}) {
  if (load == null || !workingMax) return null;
  const system = systemLoad(load, bodyweight);
  if (!system) return null;

  const row = RPE_TABLE[nearestRepRow(reps)];
  const percent = (system / workingMax) * 100;

  return {
    rpe: rpeFor(system / workingMax, reps),
    percent,
    systemLoad: system,
    clamped:
      percent > row[0] + TABLE_EDGE_TOLERANCE
        ? 'above'
        : percent < row[row.length - 1] - TABLE_EDGE_TOLERANCE
          ? 'below'
          : null,
  };
}

/**
 * Load and effective RPE together — the pair the Train screen shows as
 * "92.5 kg · RPE ~8.05". The deviation introduced by rounding is displayed
 * rather than hidden.
 */
export function prescription(slot, workingMax, increment = DEFAULT_INCREMENT, options = {}) {
  const load = prescribedLoad(slot, workingMax, increment, options);
  if (load == null) return { load: null, effectiveRpe: null };
  return { load, effectiveRpe: effectiveRpe(load, workingMax, slot.reps, options) };
}

/* ═══════════════════════════════════════════════════════════════════════
   Working max protocol
   ═══════════════════════════════════════════════════════════════════════ */

/*
 * Two distinct numbers per exercise, and confusing them is how people overreach:
 *
 *   observed e1RM — computed from index sets, a continuous history, never overwritten
 *   workingMax    — what prescriptions are calculated from, and it changes only
 *                   at block boundaries
 *
 * WHY the working max is frozen between blocks: 1RM test–retest CV in trained
 * lifters is about 3.3%, so a 130 kg bench carries ±4 kg of pure noise. Updating
 * on every good session ratchets loads upward on that noise, and six weeks later
 * you are training at a genuine RPE 9.5 while believing you are at 8. That is
 * overreaching by arithmetic, and it is essentially undetectable from the inside.
 *
 * An observation is { e1rm, weekIndex, isDeload }. Deload sessions never trigger
 * an update — their loads are deliberately low, so they carry no information
 * about what you can lift.
 */

/** Mid-block bump needs observed above this multiple of the working max. */
export const MID_BLOCK_BUMP_RATIO = 1.05;

/** …and it needs to hold for this many consecutive weeks. */
export const MID_BLOCK_BUMP_WEEKS = 2;

/** A block boundary may lower the working max, but by no more than this. */
export const MAX_BOUNDARY_DROP = 0.05;

function usableObservations(observations) {
  return (observations || []).filter(
    (o) => o && !o.isDeload && Number.isFinite(o.e1rm) && o.e1rm > 0
  );
}

/** Best observed e1RM in a set of observations, ignoring deloads. */
export function bestObserved(observations) {
  const usable = usableObservations(observations);
  return usable.length ? Math.max(...usable.map((o) => o.e1rm)) : null;
}

/**
 * Turn logged index sets into observations. Only index sets count — a random
 * good set on a fatigued day is not a measurement.
 *
 * Each set is { load, reps, rpe, weekIndex, isDeload, isIndexSet }.
 */
export function observationsFromSets(sets) {
  return (sets || [])
    .filter((s) => s && s.isIndexSet)
    .map((s) => ({
      e1rm: e1rm(s.load, s.reps, s.rpe),
      weekIndex: s.weekIndex,
      isDeload: !!s.isDeload,
      setId: s.id,
    }))
    .filter((o) => o.e1rm != null);
}

/**
 * End-of-block proposal: working max becomes the best observed e1RM from that
 * block's index sets. It may go down, but never by more than 5% at a time, and
 * the caller must say so prominently. Nothing here is applied automatically —
 * `requiresConfirmation` is the whole protocol.
 */
export function proposeBlockBoundaryMax(currentMax, observations) {
  const best = bestObserved(observations);

  if (best == null) {
    return {
      proposed: currentMax ?? null,
      best: null,
      change: 'none',
      capped: false,
      requiresConfirmation: false,
      reason: 'no-index-sets',
    };
  }

  if (!Number.isFinite(currentMax) || currentMax <= 0) {
    return {
      proposed: best,
      best,
      change: 'set',
      capped: false,
      requiresConfirmation: true,
      reason: 'no-current-max',
    };
  }

  const floor = currentMax * (1 - MAX_BOUNDARY_DROP);
  const capped = best < floor;
  const proposed = capped ? floor : best;
  const change = proposed > currentMax ? 'raise' : proposed < currentMax ? 'lower' : 'none';

  return {
    proposed,
    best,
    change,
    capped,
    requiresConfirmation: change !== 'none',
    reason: change === 'lower' ? (capped ? 'lowered-capped-at-5pct' : 'lowered') : 'block-end',
  };
}

/**
 * Mid-block exception: bump early only if observed exceeded the working max by
 * more than 5% in two consecutive weeks. One good week is noise; two is signal.
 *
 * It never lowers. A bad week is a bad week, not a strength loss.
 */
export function proposeMidBlockBump(currentMax, observations) {
  const none = (reason) => ({
    proposed: currentMax ?? null,
    best: bestObserved(observations),
    change: 'none',
    weeks: null,
    requiresConfirmation: false,
    reason,
  });

  if (!Number.isFinite(currentMax) || currentMax <= 0) return none('no-current-max');

  const bestByWeek = new Map();
  for (const o of usableObservations(observations)) {
    if (!Number.isFinite(o.weekIndex)) continue;
    const prev = bestByWeek.get(o.weekIndex);
    if (prev == null || o.e1rm > prev) bestByWeek.set(o.weekIndex, o.e1rm);
  }

  const threshold = currentMax * MID_BLOCK_BUMP_RATIO;
  const weeks = [...bestByWeek.keys()].sort((a, b) => a - b);

  // Most recent run of consecutive qualifying weeks wins, so a bump that has
  // just been earned is not masked by an older one.
  let qualifying = null;
  for (const week of weeks) {
    const run = [];
    for (let w = week; w > week - MID_BLOCK_BUMP_WEEKS; w--) {
      const value = bestByWeek.get(w);
      if (value == null || value <= threshold) break;
      run.unshift(w);
    }
    if (run.length === MID_BLOCK_BUMP_WEEKS) qualifying = run;
  }

  if (!qualifying) return none('below-threshold');

  const proposed = Math.max(...qualifying.map((w) => bestByWeek.get(w)));
  return {
    proposed,
    best: bestObserved(observations),
    change: 'raise',
    weeks: qualifying,
    requiresConfirmation: true,
    reason: 'two-week-exception',
  };
}

/**
 * The single entry point: what, if anything, should be proposed for this
 * exercise's working max right now.
 */
export function proposeWorkingMax(currentMax, observations, { atBlockBoundary = false } = {}) {
  return atBlockBoundary
    ? proposeBlockBoundaryMax(currentMax, observations)
    : proposeMidBlockBump(currentMax, observations);
}

/* ═══════════════════════════════════════════════════════════════════════
   Warm-up ramps and plate maths
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * The ramp up to a working load: empty bar, then roughly 40, 60, 80, 88 and
 * 95% of it. The ramp is not training — it exists to get you to the top set
 * warm and unfatigued, so the reps fall as the load rises.
 *
 * Returns [{ load, reps, restSec }] with the working set last.
 */
export function warmupRamp(topLoad, { bar = 20, increment = DEFAULT_INCREMENT } = {}) {
  if (!topLoad || topLoad <= bar) return [];

  const steps = [
    { fraction: null, reps: 12, restSec: 60 }, // the empty bar
    { fraction: 0.4, reps: 5, restSec: 60 },
    { fraction: 0.6, reps: 5, restSec: 90 },
    { fraction: 0.8, reps: 3, restSec: 90 },
    { fraction: 0.88, reps: 2, restSec: 150 },
    { fraction: 0.95, reps: 1, restSec: 180 },
  ];

  const ramp = [];
  for (const step of steps) {
    const load = step.fraction == null ? bar : roundToIncrement(topLoad * step.fraction, increment);
    if (load <= bar && step.fraction != null) continue;
    if (ramp.length && load <= ramp[ramp.length - 1].load) continue;
    if (load >= topLoad) break;
    ramp.push({ load, reps: step.reps, restSec: step.restSec, isWarmup: true });
  }
  ramp.push({ load: topLoad, reps: null, restSec: null, isWarmup: false });
  return ramp;
}

/** The plates in the owner's gym, heaviest first. */
export const DEFAULT_PLATES = Object.freeze([20, 10, 5, 2.5, 1.25]);

/**
 * What to hang on each side of the bar. Returns the plates and the load that
 * combination actually produces — which is not always the load you asked for,
 * and saying so beats silently rounding.
 */
export function platesFor(totalLoad, { bar = 20, plates = DEFAULT_PLATES } = {}) {
  if (totalLoad == null || totalLoad < bar) return { perSide: [], achieved: bar, exact: totalLoad === bar };

  let remaining = (totalLoad - bar) / 2;
  const perSide = [];
  for (const plate of plates) {
    while (remaining >= plate - 1e-9) {
      perSide.push(plate);
      remaining -= plate;
    }
  }
  const achieved = bar + perSide.reduce((sum, plate) => sum + plate, 0) * 2;
  return { perSide, achieved, exact: Math.abs(achieved - totalLoad) < 1e-9 };
}
