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

import { planIdOf, DEFAULT_PLAN_ID } from './plans.js';
import { estimateForSet, isHighConfidence, systemLoad, setDifficulty, noEstimateReason } from './calc.js';
import { daysBetween, weekStart } from './dates.js';
import { TAPE_RANGES_CM, BODYWEIGHT_RANGE_KG, WEIGH_IN_DEVIATION_KG, outlierReason } from './plausibility.js';

/* ═══════════════════════════════════════════════════════════════════════
   Eligibility — said out loud, every time
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * A weekly attempt marked "Missed it".
 *
 * The step sheet prefills an attempt slot with 1 rep at RPE 10, and marking it
 * missed leaves those numbers in place — so the stored row reads exactly like
 * a made 1RM. Every pipeline that claims a max has to ask this first, or a
 * failed 135 becomes a record, a chart point and the basis for prescriptions.
 */
export const isMissedAttempt = (set) => set?.attemptResult === 'missed';

/**
 * A single he actually pressed: a made attempt, or one rep at RPE 10.
 *
 * Better evidence than any estimate the table can compute from a set of
 * eight — it is the thing the estimate is trying to guess.
 */
export const isMeasuredSingle = (set) =>
  !!set && set.reps === 1 && set.load != null && !isMissedAttempt(set) && (set.attemptResult === 'made' || set.rpe === 10);

/** How close in time a measured single has to be to outrank an estimate. */
export const MEASURED_WINDOW_DAYS = 14;

/** An estimate this much above the measured single it lost to is reported. */
export const DISAGREEMENT_PCT = 5;

/**
 * The one gate every number that claims a max goes through.
 *
 * There used to be five, and they answered "what is my bench max" five ways:
 * the PR check and session analysis invented RPE 8 for a set with no rating,
 * the PR check let a form-breakdown set celebrate, nothing but the attempt
 * ladder knew a missed attempt from a made one, and the Plan list labelled a
 * 12-rep grind "high confidence" above the single he had pressed a week
 * earlier. Each pipeline still chooses how strict to be — Records want index
 * sets, the Plan list shows rough estimates marked as rough — but the reasons a
 * set cannot speak for strength are decided here, once.
 *
 *   requireIndex    an index set, or a measured single (which is better)
 *   requireTracked  a lift whose estimates are trustworthy (maxConf 'high')
 *   requireHigh     a high-confidence estimate — off by default only for the
 *                   Plan list, which marks its rough rows
 *
 * Returns { ok: true, estimate, measured } or { ok: false, reason }.
 */
export function maxEvidence(
  set,
  { exercise, requireIndex = false, requireTracked = false, requireHigh = true, bodyweight = 0 } = {}
) {
  const no = (reason) => ({ ok: false, reason });
  if (!set) return no('missing');
  if (set.deletedAtISO) return no('deleted');
  // A set the lifter marked as form breakdown happened, counts as volume and
  // stays in the Log — but it may not speak for his strength.
  if (set.formBreakdown) return no('form breakdown');
  if (isMissedAttempt(set)) return no('a missed attempt');
  if (!exercise) return no('unknown exercise');
  const measured = isMeasuredSingle(set);
  if (requireIndex && !set.isIndexSet && !measured) return no('not an index set');
  if (requireTracked && (!exercise.tracksMax || exercise.maxConf !== 'high')) {
    return no('estimates on this lift are indicative only');
  }
  if (set.load == null || !set.reps) return no('incomplete set');

  let estimate = estimateForSet(set, { bodyweight });
  // A made attempt is a weight he pressed. With no effort rating it is still
  // at least that weight, which is a measurement rather than a formula.
  if (set.attemptResult === 'made' && set.reps === 1 && !isHighConfidence(estimate)) {
    estimate = {
      value: systemLoad(set.load, set.bodyweightUsed ?? bodyweight),
      method: 'measured',
      confidence: 'high',
      reason: null,
    };
  }
  if (!estimate?.value) return no(noEstimateReason(set.load, set.reps, set.rpe, { short: true }) || 'no usable effort rating');
  if (requireHigh && !isHighConfidence(estimate)) return no(estimate.reason || 'no usable effort rating');
  return { ok: true, estimate, measured };
}

/**
 * Measured singles first.
 *
 * Within `windowDays` of a measured single, an estimate may not claim a higher
 * max than the best single there — the single is what the estimate was trying
 * to guess, and it is right there. Estimates at or below it stay: they do not
 * contradict it. An outranked estimate more than `DISAGREEMENT_PCT` above the
 * single is reported, because a 12-rep grind that "says" 147 beside a pressed
 * 125 is worth knowing about — it is how the RPE table's reach shows up.
 *
 * Candidates are { value, dateISO, measured, ... }. Returns the ones kept, the
 * ones outranked (each with `by` and `pct`) and the reportable disagreements.
 */
export function preferMeasured(candidates, { windowDays = MEASURED_WINDOW_DAYS, threshold = DISAGREEMENT_PCT } = {}) {
  const singles = (candidates || []).filter((c) => c.measured && c.dateISO);
  const kept = [];
  const outranked = [];
  const disagreements = [];

  for (const candidate of candidates || []) {
    if (candidate.measured || !singles.length || !candidate.dateISO) {
      kept.push(candidate);
      continue;
    }
    const near = singles.filter((single) => {
      const gap = daysBetween(single.dateISO, candidate.dateISO);
      return gap != null && Math.abs(gap) <= windowDays;
    });
    if (!near.length) {
      kept.push(candidate);
      continue;
    }
    const by = near.reduce((best, single) => (single.value > best.value ? single : best));
    if (candidate.value <= by.value) {
      kept.push(candidate);
      continue;
    }
    const pct = (candidate.value / by.value - 1) * 100;
    outranked.push({ ...candidate, by, pct });
    if (pct > threshold) disagreements.push({ estimate: candidate, single: by, pct });
  }

  return { kept, outranked, disagreements };
}

/** The reason an outranked estimate is set aside, said the same way everywhere. */
const OUTRANKED = 'a measured single within two weeks outranks it';

/** What a disagreement looks like to a screen: plain numbers, no set objects. */
const describeDisagreement = ({ estimate, single, pct }) => ({
  pct,
  estimate: {
    value: estimate.value, dateISO: estimate.dateISO, setId: estimate.set?.id ?? null,
    load: estimate.set?.load ?? null, reps: estimate.set?.reps ?? null, rpe: estimate.set?.rpe ?? null,
  },
  single: {
    value: single.value, dateISO: single.dateISO, setId: single.set?.id ?? null,
    load: single.set?.load ?? null, rpe: single.set?.rpe ?? null,
  },
});

const dateOfSet = (set, byLog) => {
  const log = byLog.get(set.sessionLogId);
  return (log?.localDate || log?.dateISO || set.localDate || '').slice(0, 10) || null;
};

/**
 * Which sets may be used as evidence about strength, and why the others cannot.
 *
 * The rules are the plan's own: index sets on high-confidence lifts, performed
 * under the standard technique, not during a deload, and with an effort rating
 * the RPE table can actually express. The set-level rules are `maxEvidence`'s,
 * shared with every other pipeline that claims a max; an estimate that a
 * measured single nearby outranks is set aside with that reason, and the
 * disagreement, if it is large, comes back in `disagreements`.
 */
export function eligibleForStrength(sets, { exercises, logs = [] }) {
  const byLog = new Map(logs.map((log) => [log.id, log]));
  const candidates = [];
  const excluded = [];

  for (const set of sets || []) {
    const exercise = exercises[set.exerciseId];
    const log = byLog.get(set.sessionLogId);
    const reject = (reason) => excluded.push({ id: set.id, exerciseId: set.exerciseId, reason });

    const gate = maxEvidence(set, { exercise, requireIndex: true, requireTracked: true });
    if (!gate.ok) { reject(gate.reason); continue; }
    if (!log) { reject('its session record is gone'); continue; }
    if (log.deletedAtISO) { reject('the session was deleted'); continue; }
    /*
     * Taper, test, recovery and bridge rotations have no failure wave, which is
     * what effortMode 'none' says. Their ordinary sets are lighter on purpose
     * and are not comparable training — but the single in them is the test,
     * the most important measurement of the block. This used to reject every
     * set in them as "deload rotation", the test single included.
     */
    const reducedVolume = !!(log.isDeload || log.effortMode === 'none');
    if (reducedVolume && set.reps !== 1) {
      reject('reduced-volume rotation (taper, test, recovery or bridge) — only its singles count');
      continue;
    }
    if (set.substitutionReason || set.variantUsed) { reject('a substitute was used'); continue; }

    candidates.push({
      set, estimate: gate.estimate, log, measured: gate.measured, reducedVolume,
      value: gate.estimate.value, dateISO: dateOfSet(set, byLog),
    });
  }

  // Measured singles are ranked per lift: a pull-up single says nothing about
  // a bench estimate.
  const byLift = new Map();
  for (const candidate of candidates) {
    if (!byLift.has(candidate.set.exerciseId)) byLift.set(candidate.set.exerciseId, []);
    byLift.get(candidate.set.exerciseId).push(candidate);
  }
  const outrankedIds = new Set();
  const disagreements = [];
  for (const group of byLift.values()) {
    const ranked = preferMeasured(group);
    for (const row of ranked.outranked) {
      outrankedIds.add(row.set.id);
      excluded.push({ id: row.set.id, exerciseId: row.set.exerciseId, reason: OUTRANKED });
    }
    disagreements.push(...ranked.disagreements.map(describeDisagreement));
  }

  const included = candidates
    .filter((candidate) => !outrankedIds.has(candidate.set.id))
    .map(({ set, estimate, log, measured, reducedVolume }) => ({ set, estimate, log, measured, reducedVolume }));

  return { included, excluded, disagreements };
}

/* ═══════════════════════════════════════════════════════════════════════
   Series, aligned on real dates
   ═══════════════════════════════════════════════════════════════════════ */

/** e1RM points for one lift: { dateISO, cycleSequence, value }, oldest first. */
export function strengthSeries(sets, { exercises, logs, exerciseId }) {
  const { included, excluded, disagreements } = eligibleForStrength(
    sets.filter((set) => set.exerciseId === exerciseId),
    { exercises, logs }
  );

  const points = included
    .map(({ set, estimate, log, measured, reducedVolume }) => ({
      dateISO: (log?.localDate || log?.dateISO || set.localDate || '').slice(0, 10),
      // Rotations and blocks are numbered per plan: FOPIP rotation 5 and
      // FLOPIP rotation 5 are two months apart. Every grouping keys on both.
      planId: planIdOf(log),
      cycleSequence: log?.cycleSequence ?? null,
      blockId: log?.blockId ?? null,
      sessionId: log?.sessionId ?? null,
      value: estimate.value,
      setId: set.id,
      reps: set.reps,
      load: set.load,
      rpe: set.rpe,
      measured: !!measured,
      reducedVolume: !!reducedVolume,
    }))
    .filter((point) => point.dateISO)
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));

  return { points, excluded, disagreements, sampleCount: points.length };
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
    // Keyed on the plan as well as the number. Both plans count rotations from
    // 1, and keyed on the number alone FOPIP's September rotation 5 and
    // FLOPIP's November rotation 5 were one point.
    const key = `${point.planId ?? DEFAULT_PLAN_ID}:${point.cycleSequence}`;
    const held = byCycle.get(key);
    if (!held || point.value > held.value) byCycle.set(key, point);
  }
  // In date order, which is the order the training happened in. Sorted by
  // number, two plans' rotations interleaved and the trend ran backwards.
  return [...byCycle.values()].sort(
    (a, b) => a.dateISO.localeCompare(b.dateISO) || a.cycleSequence - b.cycleSequence
  );
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
   Body readings, with the typos set aside
   ═══════════════════════════════════════════════════════════════════════ */

const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * One tape site over time, without the readings that cannot be real.
 *
 * His export holds chest 408.7, arm L 3492, quad R 26.5, arm R flexed 97.1 and
 * forearm L 91 — typed, saved, and then plotted: the chest axis ran to 454 cm
 * and arm L "grew" 17.5 cm a week. A reading outside the site's range, or more
 * than 25% from the median of that site's other readings, is left out of the
 * points and listed in `excluded` with the reason. Nothing is deleted; it stays
 * in the Log, where it can be corrected.
 */
export function measurementSeries(measurements, site) {
  const readings = (measurements || [])
    .filter((row) => !row.deletedAtISO && Number.isFinite(row[site]) && row.dateISO)
    .map((row) => ({ id: row.id, dateISO: row.dateISO.slice(0, 10), value: row[site] }))
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));

  const points = [];
  const excluded = [];
  readings.forEach((reading, i) => {
    const others = readings.filter((_, j) => j !== i).map((row) => row.value);
    const reason = outlierReason(reading.value, others, { range: TAPE_RANGES_CM[site] || null, share: 0.25, unit: 'cm' });
    if (reason) excluded.push({ ...reading, site, reason });
    else points.push(reading);
  });
  return { points, excluded, sampleCount: points.length };
}

/**
 * Daily weigh-ins, without the ones that cannot be real.
 *
 * Judged against the readings around it rather than the whole history: a bulk
 * moves bodyweight on purpose, so 86 in August and 93 in November are both
 * right. A reading more than 3 kg from the median of the readings within a
 * week either side (at least three of them) — the same 3 kg the weigh-in check
 * asks about — or outside any possible bodyweight, is set aside with the
 * reason. One 97 among 91s moved the gain verdict from "under" to "in".
 */
export function bodyweightSeries(daily) {
  const readings = (daily || [])
    .filter((row) => !row.deletedAtISO && Number.isFinite(row.bodyweight) && row.dateISO)
    .map((row) => ({ id: row.id, dateISO: row.dateISO.slice(0, 10), value: row.bodyweight }))
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));

  const points = [];
  const excluded = [];
  readings.forEach((reading, i) => {
    if (reading.value < BODYWEIGHT_RANGE_KG.lo || reading.value > BODYWEIGHT_RANGE_KG.hi) {
      excluded.push({ ...reading, reason: `outside ${BODYWEIGHT_RANGE_KG.lo}–${BODYWEIGHT_RANGE_KG.hi} kg` });
      return;
    }
    const around = readings
      .filter((row, j) => j !== i && Math.abs(daysBetween(row.dateISO, reading.dateISO) ?? Infinity) <= 7)
      .map((row) => row.value);
    const middle = around.length >= 3 ? median(around) : null;
    if (middle != null && Math.abs(reading.value - middle) > WEIGH_IN_DEVIATION_KG) {
      excluded.push({
        ...reading,
        reason: `${Math.round(Math.abs(reading.value - middle) * 10) / 10} kg from the ${Math.round(middle * 10) / 10} kg of the readings around it`,
      });
      return;
    }
    points.push(reading);
  });
  return { points, excluded, sampleCount: points.length };
}

/** A weigh-in further than this from a set's date says nothing about it. */
export const BODYWEIGHT_NEAREST_DAYS = 7;

/**
 * His bodyweight on a given day: the 7-day average at the weigh-in nearest it.
 *
 * Pull-ups, chin-ups and dips are estimated on bodyweight + added, and every
 * one of the 116 he logged stored the Settings value, 90 kg, while his weight
 * went from 86 to 93. That built a 4.6 kg downward drift into each of those
 * estimates. The average rather than the single reading, so one heavy morning
 * does not land on a set; typos are already out of the series. With no
 * weigh-in within a week of the date, the setting — not a guess.
 */
export function bodyweightOn(daily, dateISO, fallback = null) {
  if (!dateISO) return fallback;
  const averaged = rollingMean(bodyweightSeries(daily).points, 7);
  let best = null;
  let bestGap = Infinity;
  for (const point of averaged) {
    const gap = Math.abs(daysBetween(point.dateISO, dateISO.slice(0, 10)) ?? Infinity);
    // On a tie, the earlier reading: a set is logged after the morning weigh-in.
    if (gap < bestGap || (gap === bestGap && point.dateISO <= dateISO)) {
      best = point;
      bestGap = gap;
    }
  }
  return best && bestGap <= BODYWEIGHT_NEAREST_DAYS ? best.value : fallback;
}

/**
 * A correction to a stored set, with what follows from it.
 *
 * "Fix this set" patched the fields it was given and nothing else. Moved from a
 * weighted dip to a close-grip bench, a set kept `bodyweightUsed: 90` and was
 * estimated as a 110 kg press; moved the other way, a dip had no bodyweight and
 * no estimate. The variant, pause, grip and index flag belonged to the old lift
 * and stayed, and RIR kept describing the old RPE.
 *
 * Returns the patch to write: the fields given, plus the ones that follow.
 * Fields that do not follow from the change are left out, not rewritten.
 */
export function correctionFor(set, patch, { exercises = {}, daily = [], fallbackBodyweight = null, dateISO = null } = {}) {
  const out = { ...patch };
  if ('rpe' in patch && (patch.rpe ?? null) !== (set.rpe ?? null)) {
    out.rir = patch.rpe == null ? null : Math.max(0, 10 - patch.rpe);
  }
  if (patch.exerciseId && patch.exerciseId !== set.exerciseId) {
    const target = exercises[patch.exerciseId];
    const day = dateISO || set.localDate || (set.timestampISO || '').slice(0, 10) || null;
    out.bodyweightUsed = target?.bodyweightLoaded ? bodyweightOn(daily, day, fallbackBodyweight) : null;
    // These described the old lift. A wrong grip on the right lift is worse
    // than no grip recorded, and an index flag is the old slot's claim.
    out.variantUsed = null;
    out.pauseStyle = null;
    out.gripWidth = null;
    out.isIndexSet = false;
  }
  return out;
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

/**
 * Trailing average over a window of days, not of samples.
 *
 * A sliding window rather than a backward scan per point. The scan is fine for
 * one weigh-in a day, where it stops after seven — and quadratic the moment
 * several readings share a date, which is exactly what a set-level series
 * looks like. Day numbers are computed once, because the cost here is parsing
 * dates, not adding numbers.
 */
export function rollingMean(points, windowDays = 7) {
  const clean = (points || [])
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));

  const days = clean.map((p) => Math.round(Date.parse(`${p.dateISO.slice(0, 10)}T00:00:00Z`) / 86400000));

  const out = [];
  let start = 0;
  let sum = 0;
  for (let i = 0; i < clean.length; i++) {
    sum += clean[i].value;
    while (days[i] - days[start] >= windowDays) {
      sum -= clean[start].value;
      start += 1;
    }
    out.push({ dateISO: clean[i].dateISO, value: sum / (i - start + 1), samples: i - start + 1 });
  }
  return out;
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

    // Per plan: FOPIP's block 3 is a recovery week and FLOPIP's block 3 is
    // seven rotations of accumulation. One key for both merged them.
    for (const point of points) {
      if (point.blockId == null) continue;
      const key = `${point.planId ?? DEFAULT_PLAN_ID}:${point.blockId}`;
      if (!byBlock.has(key)) byBlock.set(key, []);
      byBlock.get(key).push(point);
    }

    for (const blockPoints of byBlock.values()) {
      const ordered = blockPoints.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
      const { planId, blockId } = ordered[0];
      if (ordered.length < 2) {
        rows.push({
          lift: lift.id, name: lift.name, planId, blockId, change: null,
          firstDateISO: ordered[0].dateISO, sampleCount: ordered.length, reason: 'one observation',
        });
        continue;
      }
      rows.push({
        lift: lift.id,
        name: lift.name,
        planId,
        blockId,
        first: ordered[0].value,
        firstDateISO: ordered[0].dateISO,
        last: ordered[ordered.length - 1].value,
        lastDateISO: ordered[ordered.length - 1].dateISO,
        change: ordered[ordered.length - 1].value - ordered[0].value,
        sampleCount: ordered.length,
      });
    }
  }

  return rows.sort((a, b) => a.firstDateISO.localeCompare(b.firstDateISO) || a.name.localeCompare(b.name));
}

/* ═══════════════════════════════════════════════════════════════════════
   One session, in full
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Everything about a single session that can be derived from what it stored.
 *
 * The Log could show you a session's sets and nothing else — not what it
 * actually hit, not how it compared with the last time you did it, not where
 * the work went. All of that is computable from rows already in the database.
 *
 * Nothing here estimates anything it cannot justify: tonnage is exact
 * arithmetic on stored numbers, e1RM and difficulty come back null past the
 * rep limit rather than guessing, and the comparison is omitted entirely when
 * there is no earlier session of the same letter to compare with.
 */
export function sessionAnalysis(log, sets, { exercises = {}, logs = [], allSets = [] } = {}) {
  const live = (sets || []).filter((set) => !set.deletedAtISO);

  const byExercise = new Map();
  let tonnage = 0;
  let reps = 0;
  let workingSets = 0;
  let failureSets = 0;

  for (const set of live) {
    const exercise = exercises[set.exerciseId];
    const bodyweight = set.bodyweightUsed || 0;
    // Tonnage is what the muscles moved, so bodyweight counts on a pull-up.
    const total = systemLoad(set.load ?? 0, bodyweight);
    const setTonnage = total * (set.reps || 0);

    tonnage += setTonnage;
    reps += set.reps || 0;
    workingSets += 1;
    if (set.toFailure || set.isAmrap) failureSets += 1;

    const entry = byExercise.get(set.exerciseId) || {
      exerciseId: set.exerciseId,
      name: exercise?.name || set.exerciseId,
      sets: [],
      tonnage: 0,
      reps: 0,
      topLoad: null,
      bestEstimate: null,
      bestIsMeasured: false,
      bestDifficulty: null,
    };
    entry.sets.push(set);
    entry.tonnage += setTonnage;
    entry.reps += set.reps || 0;
    if (!isMissedAttempt(set) && (entry.topLoad == null || total > entry.topLoad)) entry.topLoad = total;

    // No invented RPE 8 for an unrated set, no missed attempt, no form
    // breakdown: the same gate as every other max claim. Inside one session a
    // measured single outranks an estimate, as it does everywhere else.
    const gate = maxEvidence(set, { exercise: exercise || {}, bodyweight });
    if (gate.ok) {
      const value = gate.estimate.value;
      const better =
        entry.bestEstimate == null ||
        (gate.measured && !entry.bestIsMeasured) ||
        (gate.measured === entry.bestIsMeasured && value > entry.bestEstimate);
      if (better) {
        entry.bestEstimate = value;
        entry.bestIsMeasured = gate.measured;
      }
    }
    const hard = isMissedAttempt(set) ? null : setDifficulty(total, set.reps);
    if (hard != null && (entry.bestDifficulty == null || hard > entry.bestDifficulty)) {
      entry.bestDifficulty = hard;
    }
    byExercise.set(set.exerciseId, entry);
  }

  return {
    tonnage,
    reps,
    workingSets,
    failureSets,
    exercises: [...byExercise.values()].sort((a, b) => b.tonnage - a.tonnage),
    previous: previousSameSession(log, { logs, allSets, exercises }),
  };
}

/**
 * The last time this same session letter was trained, and what changed.
 *
 * Compared per exercise rather than in total, because a session's tonnage moves
 * with the reps you happened to get as much as with the load — and per
 * exercise, "same lift, more weight" is a fact rather than an impression.
 * Returns null when there is nothing to compare against, which is the honest
 * answer for a first session and the one v1 would have filled with a zero.
 */
function previousSameSession(log, { logs, allSets, exercises }) {
  if (!log?.sessionId) return null;

  const earlier = (logs || [])
    .filter(
      (row) =>
        !row.deletedAtISO &&
        row.id !== log.id &&
        row.sessionId === log.sessionId &&
        // The same letter under a different plan is a different session.
        planIdOf(row) === planIdOf(log) &&
        (row.dateISO || '') < (log.dateISO || '')
    )
    .sort((a, b) => (b.dateISO || '').localeCompare(a.dateISO || ''));

  const previous = earlier[0];
  if (!previous) return null;

  const previousSets = (allSets || []).filter((set) => set.sessionLogId === previous.id && !set.deletedAtISO);
  if (!previousSets.length) return null;

  const summarise = (rows) => {
    const map = new Map();
    for (const set of rows) {
      const total = systemLoad(set.load ?? 0, set.bodyweightUsed || 0);
      const entry = map.get(set.exerciseId) || { tonnage: 0, topLoad: null, sets: 0 };
      entry.tonnage += total * (set.reps || 0);
      entry.sets += 1;
      if (entry.topLoad == null || total > entry.topLoad) entry.topLoad = total;
      map.set(set.exerciseId, entry);
    }
    return map;
  };

  const now = summarise((allSets || []).filter((set) => set.sessionLogId === log.id && !set.deletedAtISO));
  const then = summarise(previousSets);

  const rows = [];
  for (const [exerciseId, current] of now) {
    const before = then.get(exerciseId);
    if (!before) continue;
    rows.push({
      exerciseId,
      name: exercises[exerciseId]?.name || exerciseId,
      topLoadChange: current.topLoad - before.topLoad,
      tonnageChange: current.tonnage - before.tonnage,
      topLoadNow: current.topLoad,
      topLoadThen: before.topLoad,
    });
  }

  return {
    dateISO: (previous.dateISO || '').slice(0, 10),
    daysBefore: Math.round(
      (Date.parse(`${(log.dateISO || '').slice(0, 10)}T00:00:00Z`) -
        Date.parse(`${(previous.dateISO || '').slice(0, 10)}T00:00:00Z`)) /
        86400000
    ),
    rows: rows.sort((a, b) => b.topLoadChange - a.topLoadChange),
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   Session timing
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Gaps shorter than this are not rest — they are two rows filled in together.
 * Used to notice a session typed up afterwards rather than logged as it
 * happened, so the app can say the timing is not meaningful instead of
 * reporting eight seconds of rest between working sets.
 */
export const MIN_REAL_REST_SECONDS = 20;

/**
 * A gap longer than this is almost certainly not rest between sets — a phone
 * call, a queue for a rack, or the session being picked up again later. Still
 * reported, because it is real; just not counted into the typical rest.
 */
export const LONG_GAP_SECONDS = 20 * 60;

/**
 * A session start this much earlier than its first set did not begin then.
 *
 * From a real log: `startedAt` 11:14, first set 16:30, and the session reported
 * as eight hours. The log is created by the first thing you do, and un-ticking
 * a set deletes the set but leaves the log — so a tap in the morning that was
 * undone still stamped the session five hours before the training happened.
 * Reported rather than quietly corrected, with the working span offered beside
 * it, because which of the two is right is a question only the owner can answer.
 */
export const IMPLAUSIBLE_START_SECONDS = 45 * 60;

/**
 * What actually happened, minute by minute, from the timestamps already stored.
 *
 * Every set has carried a `timestampISO` since the first version and nothing
 * has ever read it. The times are therefore free — this derives rest between
 * sets, working time and session length from data already in the database,
 * including for sessions logged long before the report existed.
 *
 * The whole thing is conditional on the timing being real. A session typed up
 * on the bus home has timestamps a few seconds apart, and reporting "8 s of
 * rest" from them would be worse than reporting nothing: it looks like a
 * measurement. `reliable` is false when the owner has said so, and
 * `looksBulkEntered` is true when the gaps say so regardless of what anyone
 * said, so a screen can decline to draw conclusions from it.
 */
export function sessionTiming(log, sets, { now = null } = {}) {
  const ordered = (sets || [])
    .filter((set) => !set.deletedAtISO && set.timestampISO)
    .sort((a, b) => a.timestampISO.localeCompare(b.timestampISO));

  const stated = log?.timingReliable;
  const startedAt = log?.startedAt || ordered[0]?.timestampISO || null;
  const endedAt = log?.endedAt || (log && !log.endedAt ? now : null) || ordered[ordered.length - 1]?.timestampISO || null;

  const entries = ordered.map((set, i) => {
    const at = Date.parse(set.timestampISO);
    const previous = i ? Date.parse(ordered[i - 1].timestampISO) : startedAt ? Date.parse(startedAt) : null;
    const gapSeconds = previous == null || !Number.isFinite(at) ? null : Math.max(0, Math.round((at - previous) / 1000));
    return {
      setId: set.id,
      exerciseId: set.exerciseId,
      slotIndex: set.slotIndex,
      setIndex: set.setIndex,
      atISO: set.timestampISO,
      gapSeconds,
      isFirst: i === 0,
      isLongGap: gapSeconds != null && gapSeconds > LONG_GAP_SECONDS,
    };
  });

  // Gaps between one set and the next — the first entry's gap is warm-up time
  // from the session start, which is not rest between sets.
  const gaps = entries.slice(1).map((entry) => entry.gapSeconds).filter((g) => g != null);
  const restGaps = gaps.filter((g) => g >= MIN_REAL_REST_SECONDS && g <= LONG_GAP_SECONDS);

  // More than half the gaps too short to be rest means the rows were filled in
  // together, whatever the session log claims.
  const tooShort = gaps.filter((g) => g < MIN_REAL_REST_SECONDS).length;
  const looksBulkEntered = gaps.length >= 3 && tooShort / gaps.length > 0.5;

  const totalSeconds =
    startedAt && endedAt ? Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000)) : null;

  // First set to last: the span the work actually occupied, whatever the log
  // says about when it opened.
  const firstSetAt = ordered[0]?.timestampISO || null;
  const lastSetAt = ordered[ordered.length - 1]?.timestampISO || null;
  const workingSpanSeconds =
    firstSetAt && lastSetAt ? Math.max(0, Math.round((Date.parse(lastSetAt) - Date.parse(firstSetAt)) / 1000)) : null;
  const startedBeforeFirstSetSeconds =
    startedAt && firstSetAt ? Math.round((Date.parse(firstSetAt) - Date.parse(startedAt)) / 1000) : null;
  const startLooksWrong =
    startedBeforeFirstSetSeconds != null && startedBeforeFirstSetSeconds > IMPLAUSIBLE_START_SECONDS;

  /*
   * The other end. A Finish forgotten and pressed hours later made a quarter of
   * his sessions report hours they did not take — 446 minutes for 57 of work.
   * New sessions finished late end at their last set (see `finishTimes` in
   * ui/train.js); this flags the ones stored before that, and any other end
   * long after the last set. Only a finished session can have ended late.
   */
  const endedAfterLastSetSeconds =
    log?.endedAt && lastSetAt ? Math.round((Date.parse(log.endedAt) - Date.parse(lastSetAt)) / 1000) : null;
  const endLooksWrong = endedAfterLastSetSeconds != null && endedAfterLastSetSeconds > LONG_GAP_SECONDS;

  const sorted = [...restGaps].sort((a, b) => a - b);
  const reliable = stated === false ? false : !looksBulkEntered;

  /*
   * When the timing is not real, the derived figures are not merely hidden —
   * they are not returned. A metric object that carries a median it has just
   * said is meaningless is one screen away from printing it, and this file's
   * whole reason for existing is that a view should not have to know which of
   * the numbers it was handed are safe to show.
   */
  const derived = reliable
    ? {
        totalSeconds,
        medianRestSeconds: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
        longestRestSeconds: restGaps.length ? Math.max(...restGaps) : null,
        shortestRestSeconds: restGaps.length ? Math.min(...restGaps) : null,
        countedRests: restGaps.length,
      }
    : {
        totalSeconds: null,
        medianRestSeconds: null,
        longestRestSeconds: null,
        shortestRestSeconds: null,
        countedRests: 0,
      };

  return {
    reliable,
    statedUnreliable: stated === false,
    looksBulkEntered,
    startedAt,
    endedAt,
    firstSetAt,
    lastSetAt,
    workingSpanSeconds,
    startedBeforeFirstSetSeconds,
    startLooksWrong,
    endedAfterLastSetSeconds,
    endLooksWrong,
    setCount: entries.length,
    // The timeline itself is always returned: when each row was written is a
    // fact either way, and it is what shows you *why* the timing is not real.
    entries,
    longGaps: entries.filter((entry) => entry.isLongGap && !entry.isFirst).length,
    ...derived,
  };
}

/**
 * How a record got to where it is.
 *
 * The records card showed the current best and the date it was set, which
 * answers "what is my best" and nothing else. It cannot tell you whether a
 * record is three days old or four months old, how hard it was to beat, or
 * whether it has been creeping up steadily or jumped once and stalled — which
 * is the question you actually have when you look at it.
 *
 * This walks the sets in date order and emits an entry every time the running
 * best is beaten, so what comes back is the staircase rather than the top step.
 * Each rung carries what it gained on the one below and how long it took, both
 * of which are facts about the pair rather than about either one.
 */
/**
 * Estimated-max candidates per lift, through the shared gate and ranked so that
 * a measured single outranks an estimate beside it. Records, the record
 * staircase and the PR check all read this, so they cannot disagree.
 */
function recordCandidates(sets, { exercises, byLog }) {
  const byLift = new Map();
  for (const set of sets || []) {
    const gate = maxEvidence(set, { exercise: exercises[set.exerciseId], requireIndex: true, requireTracked: true });
    if (!gate.ok) continue;
    const dateISO = dateOfSet(set, byLog);
    if (!dateISO) continue;
    if (!byLift.has(set.exerciseId)) byLift.set(set.exerciseId, []);
    byLift.get(set.exerciseId).push({ set, value: gate.estimate.value, measured: gate.measured, dateISO });
  }
  const out = new Map();
  for (const [id, group] of byLift) out.set(id, preferMeasured(group));
  return out;
}

/** Heaviest load ever handled: every lift, no estimate, but only lifts he made. */
const countsAsHandled = (set) =>
  !set.deletedAtISO && set.load != null && set.reps && !set.formBreakdown && !isMissedAttempt(set);

export function recordHistory(sets, { exercises, logs }) {
  const byLog = new Map(logs.map((log) => [log.id, log]));

  const heaviest = new Map();
  const estimated = new Map();

  const push = (map, key, entry) => {
    const list = map.get(key) || [];
    const previous = list[list.length - 1];
    if (previous) {
      entry.gain = entry.value - previous.value;
      entry.daysSince = Math.round(
        (Date.parse(`${entry.dateISO}T00:00:00Z`) - Date.parse(`${previous.dateISO}T00:00:00Z`)) / 86400000
      );
    }
    list.push(entry);
    map.set(key, list);
  };

  const dated = (sets || [])
    .filter(countsAsHandled)
    .map((set) => ({ set, dateISO: dateOfSet(set, byLog) }))
    .filter((row) => row.dateISO && exercises[row.set.exerciseId])
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));

  for (const { set, dateISO } of dated) {
    const heavyList = heaviest.get(set.exerciseId);
    const bestLoad = heavyList ? heavyList[heavyList.length - 1].value : -Infinity;
    if (set.load > bestLoad) {
      push(heaviest, set.exerciseId, { dateISO, value: set.load, load: set.load, reps: set.reps, rpe: set.rpe ?? null });
    }
  }

  for (const [exerciseId, ranked] of recordCandidates(sets, { exercises, byLog })) {
    const ordered = [...ranked.kept].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    for (const { set, value, dateISO } of ordered) {
      const list = estimated.get(exerciseId);
      const best = list ? list[list.length - 1].value : -Infinity;
      if (value > best) {
        push(estimated, exerciseId, { dateISO, value, load: set.load, reps: set.reps, rpe: set.rpe ?? null });
      }
    }
  }

  return {
    heaviest: Object.fromEntries(heaviest),
    estimated: Object.fromEntries(estimated),
  };
}

/** Records, by concrete category rather than a wall of derived e1RM dots. */
export function records(sets, { exercises, logs }) {
  const byLog = new Map(logs.map((log) => [log.id, log]));
  const heaviest = new Map();
  const bestEstimate = new Map();
  const disagreements = [];

  for (const set of sets || []) {
    // A form-breakdown set happened and counts as volume, and a missed attempt
    // was work — but neither may claim a record.
    if (!countsAsHandled(set)) continue;
    const exercise = exercises[set.exerciseId];
    if (!exercise) continue;
    const dateISO = dateOfSet(set, byLog);
    if (!dateISO) continue;

    // Heaviest load ever handled, for any rep count. True of every exercise.
    const heavy = heaviest.get(set.exerciseId);
    if (!heavy || set.load > heavy.load) {
      heaviest.set(set.exerciseId, {
        exerciseId: set.exerciseId,
        name: exercise.name,
        load: set.load,
        reps: set.reps,
        rpe: set.rpe ?? null,
        dateISO,
      });
    }
  }

  // Estimated max, only where the estimate means something.
  for (const [exerciseId, ranked] of recordCandidates(sets, { exercises, byLog })) {
    const exercise = exercises[exerciseId];
    for (const { set, value, dateISO, measured } of ranked.kept) {
      const best = bestEstimate.get(exerciseId);
      if (!best || value > best.value) {
        bestEstimate.set(exerciseId, {
          exerciseId, name: exercise.name, value, measured,
          load: set.load, reps: set.reps, rpe: set.rpe ?? null, dateISO,
          bodyweightUsed: set.bodyweightUsed ?? null,
        });
      }
    }
    disagreements.push(...ranked.disagreements.map((row) => ({ exerciseId, ...describeDisagreement(row) })));
  }

  return {
    heaviest: [...heaviest.values()].sort((a, b) => b.dateISO.localeCompare(a.dateISO)),
    estimated: [...bestEstimate.values()].sort((a, b) => b.dateISO.localeCompare(a.dateISO)),
    disagreements,
  };
}

/**
 * The best estimated max ever recorded for every exercise, in one list.
 *
 * Deliberately a looser question than `records()`. That one answers "what may
 * claim a personal record", so it counts only index sets on lifts whose max is
 * trustworthy — which is the right bar for a record and the wrong bar for
 * "what is my best ever on the leg press". This answers the second question,
 * and carries the confidence along rather than quietly mixing the two.
 *
 * Every row says how many sets it had to choose from and how many were thrown
 * away, with the reason. A best-ever from one estimable set out of thirty is a
 * different claim from one out of thirty, and the screen should be able to say
 * so.
 */
export function bestEstimates(sets, { exercises, logs, bodyweight = 0, daily = null } = {}) {
  const byLog = new Map((logs || []).map((log) => [log.id, log]));
  const rows = new Map();
  const candidates = new Map();

  const row = (id, name) => {
    if (!rows.has(id)) {
      rows.set(id, {
        exerciseId: id, name, value: null, load: null, reps: null, rpe: null, dateISO: null,
        confidence: null, measured: false, disagreement: null, samples: 0, estimable: 0, excluded: [],
      });
    }
    return rows.get(id);
  };
  const note = (here, why) => {
    if (why && !here.excluded.includes(why)) here.excluded.push(why);
  };

  for (const set of sets || []) {
    if (set.deletedAtISO) continue;
    const exercise = exercises[set.exerciseId];
    if (!exercise) continue;

    const here = row(set.exerciseId, exercise.name);
    here.samples += 1;

    // Rough estimates are allowed here and marked as rough on the screen; the
    // reasons a set cannot speak for strength at all are the shared ones.
    // A set stored without its bodyweight is estimated on his weigh-ins that
    // day, through the same `bodyweightOn` the set would have been saved with.
    const fallback =
      exercise.bodyweightLoaded && set.bodyweightUsed == null && daily
        ? bodyweightOn(daily, dateOfSet(set, byLog), bodyweight)
        : bodyweight;
    const gate = maxEvidence(set, {
      exercise,
      requireHigh: false,
      bodyweight: exercise.bodyweightLoaded ? fallback : 0,
    });
    if (!gate.ok) {
      note(here, gate.reason);
      continue;
    }

    here.estimable += 1;
    if (!candidates.has(set.exerciseId)) candidates.set(set.exerciseId, []);
    candidates.get(set.exerciseId).push({
      set, estimate: gate.estimate, value: gate.estimate.value, measured: gate.measured, dateISO: dateOfSet(set, byLog),
    });
  }

  for (const [exerciseId, group] of candidates) {
    const here = rows.get(exerciseId);
    const ranked = preferMeasured(group);
    const best = ranked.kept.reduce((top, candidate) => (!top || candidate.value > top.value ? candidate : top), null);
    if (!best) continue;
    here.value = best.value;
    here.load = best.set.load;
    here.reps = best.set.reps;
    here.rpe = best.set.rpe ?? null;
    here.confidence = best.estimate.confidence;
    here.measured = best.measured;
    here.dateISO = best.dateISO;
    if (ranked.outranked.some((row) => row.value > best.value)) note(here, OUTRANKED);
    // The largest reportable gap, said once per lift.
    const worst = ranked.disagreements.reduce((top, d) => (!top || d.pct > top.pct ? d : top), null);
    here.disagreement = worst ? describeDisagreement(worst) : null;
  }

  return [...rows.values()]
    .filter((entry) => entry.value != null)
    .sort((a, b) => b.value - a.value);
}

/**
 * Everything you have written down about one exercise, most recent first.
 *
 * Two kinds of note exist and both matter at the moment you are about to lift:
 * the exercise note ("machine chest-supported row, seat height 8") and the set
 * notes. Neither was reachable from the Train screen, so the seat height you
 * worked out last week was in the app and not in front of you.
 *
 * Exercise notes are stored on the session log under their slot index, because
 * that is what the screen knows. Resolving a slot index back to an exercise for
 * a session finished weeks ago is done from `exerciseNoteIds` where the session
 * recorded it, and otherwise from a set logged at that slot — sets carry their
 * exercise, so a session with any logged work can always be resolved.
 */
export function exerciseNoteHistory(logs, sets, exerciseId, { limit = 6 } = {}) {
  if (!exerciseId) return [];
  const out = [];

  const setsByLog = new Map();
  for (const set of sets || []) {
    if (!setsByLog.has(set.sessionLogId)) setsByLog.set(set.sessionLogId, []);
    setsByLog.get(set.sessionLogId).push(set);
  }

  for (const log of logs || []) {
    const attached = setsByLog.get(log.id) || [];
    const notes = log.deviations?.exerciseNotes || {};
    const ids = log.deviations?.exerciseNoteIds || {};

    for (const [slotIndex, text] of Object.entries(notes)) {
      if (!text) continue;
      const resolved =
        ids[slotIndex] || attached.find((set) => String(set.slotIndex) === String(slotIndex))?.exerciseId || null;
      if (resolved !== exerciseId) continue;
      out.push({ dateISO: log.dateISO, sessionId: log.sessionId, kind: 'exercise', text });
    }

    for (const set of attached) {
      if (set.exerciseId !== exerciseId || !set.note) continue;
      out.push({
        dateISO: log.dateISO,
        sessionId: log.sessionId,
        kind: 'set',
        text: set.note,
        setIndex: set.setIndex,
      });
    }
  }

  return out
    .sort((a, b) => b.dateISO.localeCompare(a.dateISO) || (a.setIndex ?? -1) - (b.setIndex ?? -1))
    .slice(0, limit);
}

/**
 * What your recent sets say a lift's max is, when you have not set one.
 *
 * A lift with no working max of your own used to prescribe from the number the
 * plan was seeded with in August — incline Smith asked for 37.5 kg while you
 * pressed 70 for eight. A starting guess should not outrank months of real
 * sets, so this is the evidence the app falls back to instead.
 *
 * The median of the best high-confidence estimate from each session in the
 * window, not the single best set: one excellent day is noise, and a working
 * max built on it would have every following session run hot. Sets marked as a
 * form breakdown do not count, and nor does the session in progress — today's
 * own sets must not move today's prescriptions under you.
 *
 * Returns null when there is nothing in the window to go on.
 */
export function recentEvidenceMax(
  sets,
  logs,
  exerciseId,
  { todayISO = null, days = 42, excludeLogId = null, exercises = null } = {}
) {
  const byLog = new Map((logs || []).map((log) => [log.id, log]));
  const bestBySession = new Map();
  const singleBySession = new Map();

  for (const set of sets || []) {
    if (set.exerciseId !== exerciseId) continue;
    if (excludeLogId != null && set.sessionLogId === excludeLogId) continue;
    const log = byLog.get(set.sessionLogId);
    if (!log || log.deletedAtISO) continue;
    const dateISO = (log.localDate || log.dateISO || '').slice(0, 10);
    if (todayISO) {
      const age = daysBetween(dateISO, todayISO);
      if (age == null || age < 0 || age > days) continue;
    }
    const gate = maxEvidence(set, { exercise: exercises?.[exerciseId] || { tracksMax: true } });
    if (!gate.ok) continue;
    const value = gate.estimate.value;
    const previous = bestBySession.get(set.sessionLogId);
    if (!previous || value > previous.value) bestBySession.set(set.sessionLogId, { value, dateISO, set });
    if (gate.measured) {
      const held = singleBySession.get(set.sessionLogId);
      if (!held || value > held.value) singleBySession.set(set.sessionLogId, { value, dateISO, set });
    }
  }

  const rows = [...bestBySession.values()].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  if (!rows.length) return null;
  const median = (list) => {
    const values = list.map((row) => row.value).sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  };

  // Measured singles in the window outrank estimates: the same rule as every
  // other max claim. Still the median, of the singles this time, for the same
  // reason as before — one excellent day is noise.
  const singles = [...singleBySession.values()];
  const fromEstimates = median(rows);
  const value = singles.length ? median(singles) : fromEstimates;
  const gapPct = singles.length ? (fromEstimates / value - 1) * 100 : 0;

  return {
    value,
    source: singles.length ? 'measured-single' : 'estimates',
    measuredSessions: singles.length,
    disagreement: Math.abs(gapPct) > DISAGREEMENT_PCT ? { pct: gapPct, estimates: fromEstimates, singles: value } : null,
    sessions: rows.length,
    fromISO: rows[0].dateISO,
    toISO: rows[rows.length - 1].dateISO,
    rows,
  };
}

/**
 * The best e1RM this lift has shown before, and whether `record` beat it.
 *
 * Moved here from app.js so the "That is a record" sheet answers from the same
 * module, and the same rules, as the Records card it announces. Only
 * high-confidence tracked lifts qualify: a curl "record" from a formula known
 * to fail on isolation work is not a record. Asked BEFORE the set is stored, or
 * it beats itself.
 */
export function personalBestBefore(record, sets, { exercises = {}, logs = [] } = {}) {
  const exercise = exercises[record?.exerciseId];
  const gate = maxEvidence(record, { exercise, requireIndex: true, requireTracked: true });
  if (!gate.ok) return null;

  const byLog = new Map((logs || []).map((log) => [log.id, log]));
  const others = (sets || []).filter((set) => set.exerciseId === record.exerciseId && (record.id == null || set.id !== record.id));
  const ranked = recordCandidates(others, { exercises, byLog }).get(record.exerciseId);
  const prior = ranked?.kept || [];
  const best = prior.reduce((top, candidate) => (!top || candidate.value > top.value ? candidate : top), null);
  if (!best) return null;

  const value = gate.estimate.value;
  const dateISO = (record.localDate || '').slice(0, 10) || null;
  // An estimate that a measured single within two weeks already
  // outranks is not a record, whatever the table says about it.
  if (!gate.measured && dateISO) {
    const { outranked } = preferMeasured([...prior, { value, dateISO, measured: false, set: record }]);
    if (outranked.some((row) => row.set === record)) return null;
  }

  if (value <= best.value) return null;
  return { name: exercise.name, value, previous: best.value, gain: value - best.value };
}
