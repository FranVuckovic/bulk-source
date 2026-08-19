/**
 * analytics.js — one auditable pipeline for every number the app claims.
 *
 * v1 computed metrics inside the drawing code, which is how it ended up
 * asserting things its own numbers contradicted: a rate called "on target" when
 * it was outside the band, a four-week change that hid a recent decline behind
 * an old all-time best, a block comparison that turned regressions into gains,
 * and series aligned by array position so a missing week paired unrelated
 * observations.
 *
 * Every function here takes records and returns a metric object that carries
 * its own evidence: the window it used, how many samples it had, what it
 * excluded and why. The UI renders those objects. It never calculates.
 *
 * Pure: records in, metrics out.
 */

import { estimateForSet, isHighConfidence } from './calc.js';
import { daysBetween, weekStart } from './dates.js';

/* ═══════════════════════════════════════════════════════════════════════
   Eligibility — said out loud, every time
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Which sets may be used as evidence about strength, and why the others cannot.
 *
 * The rules are the plan's own: index sets on high-confidence lifts, performed
 * under the standard technique, not during a deload, and with an effort rating
 * the RPE table can actually express.
 */
export function eligibleForStrength(sets, { exercises, logs = [] }) {
  const byLog = new Map(logs.map((log) => [log.id, log]));
  const included = [];
  const excluded = [];

  for (const set of sets || []) {
    const exercise = exercises[set.exerciseId];
    const log = byLog.get(set.sessionLogId);
    const reject = (reason) => excluded.push({ id: set.id, exerciseId: set.exerciseId, reason });

    if (set.deletedAtISO) { reject('deleted'); continue; }
    if (!exercise) { reject('unknown exercise'); continue; }
    if (!set.isIndexSet) { reject('not an index set'); continue; }
    if (!exercise.tracksMax || exercise.maxConf !== 'high') { reject('estimates on this lift are indicative only'); continue; }
    if (set.load == null || !set.reps) { reject('incomplete set'); continue; }
    if (!log) { reject('its session record is gone'); continue; }
    if (log.deletedAtISO) { reject('the session was deleted'); continue; }
    if (log.isDeload || log.effortMode === 'none') { reject('deload rotation'); continue; }
    if (set.substitutionReason || set.variantUsed) { reject('a substitute was used'); continue; }

    const estimate = estimateForSet(set);
    if (!isHighConfidence(estimate)) { reject(estimate?.reason || 'no usable effort rating'); continue; }

    included.push({ set, estimate, log });
  }

  return { included, excluded };
}

/* ═══════════════════════════════════════════════════════════════════════
   Series, aligned on real dates
   ═══════════════════════════════════════════════════════════════════════ */

/** e1RM points for one lift: { dateISO, cycleSequence, value }, oldest first. */
export function strengthSeries(sets, { exercises, logs, exerciseId }) {
  const { included, excluded } = eligibleForStrength(
    sets.filter((set) => set.exerciseId === exerciseId),
    { exercises, logs }
  );

  const points = included
    .map(({ set, estimate, log }) => ({
      dateISO: (log?.localDate || log?.dateISO || set.localDate || '').slice(0, 10),
      cycleSequence: log?.cycleSequence ?? null,
      blockId: log?.blockId ?? null,
      sessionId: log?.sessionId ?? null,
      value: estimate.value,
      setId: set.id,
      reps: set.reps,
      load: set.load,
      rpe: set.rpe,
    }))
    .filter((point) => point.dateISO)
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));

  return { points, excluded, sampleCount: points.length };
}

/**
 * Best per cycle, which is the resolution the signal actually has.
 *
 * Training analytics group by cycle, not by calendar week: a rotation that took
 * nine days is one training unit, not two thirds of one week plus a third of
 * the next.
 */
export function bestPerCycle(points) {
  const byCycle = new Map();
  for (const point of points) {
    if (point.cycleSequence == null) continue;
    const held = byCycle.get(point.cycleSequence);
    if (!held || point.value > held.value) byCycle.set(point.cycleSequence, point);
  }
  return [...byCycle.values()].sort((a, b) => a.cycleSequence - b.cycleSequence);
}

/** Best per calendar week, for anything genuinely tied to dates. */
export function bestPerWeek(points) {
  const byWeek = new Map();
  for (const point of points) {
    const week = weekStart(point.dateISO);
    const held = byWeek.get(week);
    if (!held || point.value > held.value) byWeek.set(week, { ...point, weekISO: week });
  }
  return [...byWeek.values()].sort((a, b) => a.weekISO.localeCompare(b.weekISO));
}

/**
 * Two series joined on their dates rather than their positions.
 *
 * v1's indexed chart walked both arrays by array index, so a missing weigh-in
 * silently paired a bodyweight with the wrong week's strength.
 */
export function alignByDate(a, b) {
  const bByDate = new Map(b.map((point) => [point.dateISO, point]));
  return a
    .map((point) => ({ dateISO: point.dateISO, a: point.value, b: bByDate.get(point.dateISO)?.value ?? null }))
    .filter((row) => row.a != null || row.b != null);
}

/* ═══════════════════════════════════════════════════════════════════════
   Trends
   ═══════════════════════════════════════════════════════════════════════ */

/** Least-squares slope per week, with the evidence it rests on. */
export function trend(points, { minSamples = 3, minDays = 14, label = 'trend' } = {}) {
  const clean = (points || []).filter((p) => Number.isFinite(p.value) && p.dateISO);
  if (clean.length < minSamples) {
    return { ok: false, reason: `needs at least ${minSamples} points, has ${clean.length}`, sampleCount: clean.length, label };
  }

  const first = clean[0].dateISO;
  const spanDays = daysBetween(first, clean[clean.length - 1].dateISO);
  if (spanDays < minDays) {
    return { ok: false, reason: `needs at least ${minDays} days, has ${spanDays}`, sampleCount: clean.length, spanDays, label };
  }

  const xs = clean.map((p) => daysBetween(first, p.dateISO) / 7);
  const ys = clean.map((p) => p.value);
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;

  let top = 0;
  let bottom = 0;
  for (let i = 0; i < xs.length; i++) {
    top += (xs[i] - meanX) * (ys[i] - meanY);
    bottom += (xs[i] - meanX) ** 2;
  }
  if (bottom === 0) return { ok: false, reason: 'every point falls on the same day', sampleCount: clean.length, label };

  const slope = top / bottom;
  const intercept = meanY - slope * meanX;

  // How much of the variation the line actually explains. A slope from four
  // noisy points deserves to be labelled as such.
  const predicted = xs.map((x) => intercept + slope * x);
  const ssRes = ys.reduce((sum, y, i) => sum + (y - predicted[i]) ** 2, 0);
  const ssTot = ys.reduce((sum, y) => sum + (y - meanY) ** 2, 0);
  const fit = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  return {
    ok: true,
    label,
    perWeek: slope,
    current: ys[ys.length - 1],
    sampleCount: clean.length,
    spanDays,
    fit: Math.round(fit * 100) / 100,
    confidence: clean.length >= 8 && fit > 0.4 ? 'good' : clean.length >= 5 ? 'fair' : 'weak',
  };
}

/** Trailing average over a window of days, not of samples. */
export function rollingMean(points, windowDays = 7) {
  const clean = (points || [])
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));

  return clean.map((point, i) => {
    let sum = 0;
    let count = 0;
    for (let j = i; j >= 0; j--) {
      if (daysBetween(clean[j].dateISO, point.dateISO) >= windowDays) break;
      sum += clean[j].value;
      count += 1;
    }
    return { dateISO: point.dateISO, value: sum / count, samples: count };
  });
}

/**
 * Change over a real interval, measured from comparable estimates at both ends.
 *
 * v1 subtracted the value four points ago from the all-time best, so a recent
 * decline was invisible behind an old peak.
 */
export function changeOver(points, { weeks = 4 } = {}) {
  if (!points.length) return { ok: false, reason: 'nothing logged' };

  const latest = points[points.length - 1];
  const targetDays = weeks * 7;
  const earlier = [...points]
    .reverse()
    .find((point) => daysBetween(point.dateISO, latest.dateISO) >= targetDays);

  if (!earlier) {
    return { ok: false, reason: `no comparable point ${weeks} weeks back`, sampleCount: points.length };
  }
  return {
    ok: true,
    change: latest.value - earlier.value,
    from: earlier.value,
    to: latest.value,
    fromDateISO: earlier.dateISO,
    toDateISO: latest.dateISO,
    actualDays: daysBetween(earlier.dateISO, latest.dateISO),
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   Decisions
   ═══════════════════════════════════════════════════════════════════════ */

/** Bodyweight targets, as a share of bodyweight per week. */
export const GAIN_ACTIONS = Object.freeze({ low: 0.1, high: 0.6 });

export const GAIN_TARGETS = Object.freeze({
  early: { lo: 0.4, hi: 0.5, throughWeek: 12 },
  late: { lo: 0.2, hi: 0.25 },
});

/**
 * Is the bulk running at the intended rate?
 *
 * v1 called anything between 25% of the lower bound and 140% of the upper one
 * "on target", then printed the actual band as though the number sat inside it.
 * This compares against the real bounds and says which side it is on.
 */
export function gainRateVerdict(bodyweightPoints, { calendarWeek = 1, targets = GAIN_TARGETS, ACT = GAIN_ACTIONS } = {}) {
  const averaged = rollingMean(bodyweightPoints, 7);
  const recent = averaged.filter(
    (point) => daysBetween(point.dateISO, averaged[averaged.length - 1]?.dateISO ?? point.dateISO) <= 21
  );
  const result = trend(recent, { minSamples: 8, minDays: 14, label: 'bodyweight' });
  if (!result.ok) return { ok: false, reason: result.reason, sampleCount: result.sampleCount };

  const target = calendarWeek <= targets.early.throughWeek ? targets.early : targets.late;
  const perWeek = result.perWeek;
  const status = perWeek < target.lo ? 'under' : perWeek > target.hi ? 'over' : 'in';

  return {
    ok: true,
    perWeek,
    target,
    status,
    sampleCount: result.sampleCount,
    spanDays: result.spanDays,
    confidence: result.confidence,
    // The plan names a band and, separately, the rates at which it says to
    // actually change what you eat. Between the two the answer is to wait: a
    // slope from three weeks of scale readings is mostly noise.
    action:
      perWeek < ACT.low
        ? 'Add about 250 kcal — one extra meal-sized snack.'
        : perWeek > ACT.high
          ? 'Cut about 300 kcal.'
          : status === 'in'
            ? 'Nothing to change. Re-read in two to three weeks.'
            : status === 'under'
              ? 'Not far enough off to act on. Re-read in two weeks before changing anything.'
              : 'Not far enough off to act on. Watch the waist trend rather than the scale.',
  };
}

/**
 * Distance to a goal, always computed in kilograms.
 *
 * v1 projected toward the number 140 and then labelled it with the display
 * unit, so pounds mode promised "140 lb" while calculating 308.6.
 */
export function goalProgress(points, { goalKg = 140 } = {}) {
  if (!points.length) return { ok: false, reason: 'no index sets yet', goalKg };

  const current = points[points.length - 1].value;
  const result = trend(points, { minSamples: 5, minDays: 21, label: 'strength' });
  const remaining = goalKg - current;

  if (!result.ok || result.perWeek <= 0) {
    return { ok: true, goalKg, current, remaining, projection: null, reason: result.reason ?? 'not currently rising' };
  }

  // A range, not a date. Extrapolating a promise from a handful of noisy weeks
  // is how an app loses trust the first time it is wrong.
  const optimistic = remaining / (result.perWeek * 1.3);
  const pessimistic = remaining / (result.perWeek * 0.7);

  return {
    ok: true,
    goalKg,
    current,
    remaining,
    perWeek: result.perWeek,
    confidence: result.confidence,
    sampleCount: result.sampleCount,
    projection: { lowWeeks: Math.max(1, Math.round(optimistic)), highWeeks: Math.round(pessimistic) },
  };
}

/**
 * Change per block, using chronological endpoints.
 *
 * v1 took the minimum as "first" and the maximum as "last", which converted
 * every regression into a gain, and kept only the first lift it encountered.
 */
export function blockComparison(sets, { exercises, logs, lifts }) {
  const rows = [];

  // One pass per lift over sets already indexed by log — no nested lookups, so
  // this stays linear at six thousand sets rather than quadratic.
  for (const lift of lifts) {
    const { points } = strengthSeries(sets, { exercises, logs, exerciseId: lift.id });
    const byBlock = new Map();

    for (const point of points) {
      if (point.blockId == null) continue;
      if (!byBlock.has(point.blockId)) byBlock.set(point.blockId, []);
      byBlock.get(point.blockId).push(point);
    }

    for (const [blockId, blockPoints] of byBlock) {
      const ordered = blockPoints.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
      if (ordered.length < 2) {
        rows.push({ lift: lift.id, name: lift.name, blockId, change: null, sampleCount: ordered.length, reason: 'one observation' });
        continue;
      }
      rows.push({
        lift: lift.id,
        name: lift.name,
        blockId,
        first: ordered[0].value,
        last: ordered[ordered.length - 1].value,
        change: ordered[ordered.length - 1].value - ordered[0].value,
        sampleCount: ordered.length,
      });
    }
  }

  return rows.sort((a, b) => a.blockId - b.blockId || a.name.localeCompare(b.name));
}

/** Records, by concrete category rather than a wall of derived e1RM dots. */
export function records(sets, { exercises, logs }) {
  const byLog = new Map(logs.map((log) => [log.id, log]));
  const heaviest = new Map();
  const bestEstimate = new Map();

  for (const set of sets || []) {
    if (set.deletedAtISO || set.load == null || !set.reps) continue;
    const exercise = exercises[set.exerciseId];
    if (!exercise) continue;
    const log = byLog.get(set.sessionLogId);
    const dateISO = (log?.localDate || log?.dateISO || '').slice(0, 10);
    if (!dateISO) continue;

    // Heaviest load ever handled, for any rep count. True of every exercise.
    const heavy = heaviest.get(set.exerciseId);
    if (!heavy || set.load > heavy.load) {
      heaviest.set(set.exerciseId, { exerciseId: set.exerciseId, name: exercise.name, load: set.load, reps: set.reps, dateISO });
    }

    // Estimated max, only where the estimate means something.
    if (set.isIndexSet && exercise.maxConf === 'high') {
      const estimate = estimateForSet(set);
      if (isHighConfidence(estimate)) {
        const best = bestEstimate.get(set.exerciseId);
        if (!best || estimate.value > best.value) {
          bestEstimate.set(set.exerciseId, {
            exerciseId: set.exerciseId, name: exercise.name, value: estimate.value,
            load: set.load, reps: set.reps, dateISO,
          });
        }
      }
    }
  }

  return {
    heaviest: [...heaviest.values()].sort((a, b) => b.dateISO.localeCompare(a.dateISO)),
    estimated: [...bestEstimate.values()].sort((a, b) => b.dateISO.localeCompare(a.dateISO)),
  };
}
