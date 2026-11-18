/**
 * plausibility.js — is this number what he meant to type?
 *
 * Every check here is soft. It never refuses a value: a real 6 kg swing after
 * a stomach bug is possible, and the app does not get to overrule the scale.
 * What it does is notice the numbers that are far more likely to be a typo —
 * 1025 for 102.5, 9.1 for 91, a chest of 408.7 — and give the screen a plain
 * sentence to ask about before saving. The answer is always "Save" or "Fix".
 *
 * Found in his own data before this existed: a 1300 kg working max that
 * prescribed 1197.5 kg × 1, a 97 kg weigh-in among 91s that moved the gain
 * verdict, arm L 3492 cm, quad R 26.5, chest 408.7 — all saved without a word.
 *
 * Pure: numbers in (kilograms and centimetres, always), verdicts out. Loads are
 * stored in kilograms, so every check runs in kilograms; `fmt` is how the
 * screen wants a kilogram figure written, which is where pounds come in.
 *
 * Each check returns { ok: true } or
 * { ok: false, reason, message, value, reference }.
 */

const round1 = (n) => Math.round(n * 10) / 10;
const kgText = (kg) => `${round1(kg)} kg`;
const cmText = (cm) => `${round1(cm)} cm`;
const fine = { ok: true };

/** Weigh-ins further than this from the 7-day mean are asked about. */
export const WEIGH_IN_DEVIATION_KG = 3;

/** No adult weigh-in outside this is real. */
export const BODYWEIGHT_RANGE_KG = Object.freeze({ lo: 30, hi: 250 });

/** A tape reading this far from the last one at the same site is asked about. */
export const TAPE_DEVIATION_SHARE = 0.1;

/**
 * Circumferences an adult lifter's body can have, per site, in centimetres.
 * Wide on purpose: these catch a misplaced decimal point or a reading typed
 * into the wrong box, not an unusual physique.
 */
export const TAPE_RANGES_CM = Object.freeze({
  waist: { lo: 50, hi: 200 },
  chest: { lo: 60, hi: 200 },
  shoulders: { lo: 70, hi: 200 },
  armL: { lo: 20, hi: 70 },
  armR: { lo: 20, hi: 70 },
  armLFlex: { lo: 20, hi: 75 },
  armRFlex: { lo: 20, hi: 75 },
  forearmL: { lo: 15, hi: 55 },
  forearmR: { lo: 15, hi: 55 },
  quadL: { lo: 35, hi: 110 },
  quadR: { lo: 35, hi: 110 },
  neck: { lo: 25, hi: 65 },
});

/** A working max this far from the current one is asked about. */
export const WORKING_MAX_CHANGE_SHARE = 0.15;

/** No working max above this is a real barbell number for one lifter. */
export const WORKING_MAX_CEILING_KG = 400;

/** A logged load this many times his best on the lift is asked about. */
export const SET_LOAD_FACTOR = 1.5;

/** More reps than this on a compound is asked about. */
export const COMPOUND_REP_LIMIT = 40;

/** The mean of the readings in the seven days up to `dateISO`, or null. */
export function sevenDayMean(weighIns, dateISO = null) {
  const dated = (weighIns || [])
    .filter((row) => Number.isFinite(row?.value) && row.dateISO)
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  if (!dated.length) return null;
  const anchor = dateISO || dated[dated.length - 1].dateISO;
  const anchorDay = Date.parse(`${anchor.slice(0, 10)}T00:00:00Z`);
  const recent = dated.filter((row) => {
    const age = (anchorDay - Date.parse(`${row.dateISO.slice(0, 10)}T00:00:00Z`)) / 86400000;
    return age >= 0 && age < 7;
  });
  if (!recent.length) return null;
  return recent.reduce((sum, row) => sum + row.value, 0) / recent.length;
}

/**
 * A weigh-in, against the 7-day average of the readings before it.
 *
 * `weighIns` are earlier readings, [{ dateISO, value }] in kg — the one being
 * saved should not be among them, or it vouches for itself.
 */
export function checkWeighIn(valueKg, weighIns = [], { dateISO = null, fmt = kgText } = {}) {
  if (!Number.isFinite(valueKg)) return fine;
  if (valueKg < BODYWEIGHT_RANGE_KG.lo || valueKg > BODYWEIGHT_RANGE_KG.hi) {
    return {
      ok: false,
      reason: 'outside a possible bodyweight',
      message: `Save ${fmt(valueKg)}? That is not a bodyweight an adult can have — is a decimal point missing?`,
      value: valueKg,
      reference: null,
    };
  }
  const mean = sevenDayMean(weighIns, dateISO);
  if (mean == null) return fine;
  const delta = valueKg - mean;
  if (Math.abs(delta) <= WEIGH_IN_DEVIATION_KG) return fine;
  return {
    ok: false,
    reason: `more than ${WEIGH_IN_DEVIATION_KG} kg from the 7-day average`,
    message: `Save ${fmt(valueKg)}? That's ${fmt(Math.abs(delta))} ${delta > 0 ? 'above' : 'below'} your 7-day average of ${fmt(mean)}.`,
    value: valueKg,
    reference: mean,
  };
}

/**
 * One tape reading, against the site's plausible range and its last reading.
 * `site` is a measurement id ('waist', 'armL', …); `label` is how to name it.
 */
export function checkTape(site, valueCm, previousCm = null, { label = site, fmt = cmText } = {}) {
  if (!Number.isFinite(valueCm)) return fine;
  const range = TAPE_RANGES_CM[site];
  if (range && (valueCm < range.lo || valueCm > range.hi)) {
    return {
      ok: false,
      reason: `outside ${range.lo}–${range.hi} cm`,
      message: `Save ${label} ${fmt(valueCm)}? That is outside what a ${label.toLowerCase()} measures (${fmt(range.lo)}–${fmt(range.hi)}).`,
      value: valueCm,
      reference: null,
    };
  }
  if (!Number.isFinite(previousCm) || previousCm <= 0) return fine;
  const share = valueCm / previousCm - 1;
  if (Math.abs(share) <= TAPE_DEVIATION_SHARE) return fine;
  return {
    ok: false,
    reason: `more than ${Math.round(TAPE_DEVIATION_SHARE * 100)}% from the last reading`,
    message: `Save ${label} ${fmt(valueCm)}? That's ${Math.round(Math.abs(share) * 100)}% ${share > 0 ? 'above' : 'below'} your last reading of ${fmt(previousCm)}.`,
    value: valueCm,
    reference: previousCm,
  };
}

/** A working max, against the current one and a sane ceiling. */
export function checkWorkingMax(newKg, currentKg = null, { name = 'this lift', fmt = kgText } = {}) {
  if (!Number.isFinite(newKg)) return fine;
  if (newKg > WORKING_MAX_CEILING_KG) {
    return {
      ok: false,
      reason: `above ${WORKING_MAX_CEILING_KG} kg`,
      message: `Set ${name} to ${fmt(newKg)}? Every load on it is worked out from this number — is a decimal point missing?`,
      value: newKg,
      reference: currentKg,
    };
  }
  if (!Number.isFinite(currentKg) || currentKg <= 0) return fine;
  const share = newKg / currentKg - 1;
  if (Math.abs(share) <= WORKING_MAX_CHANGE_SHARE) return fine;
  return {
    ok: false,
    reason: `more than ${Math.round(WORKING_MAX_CHANGE_SHARE * 100)}% from the current max`,
    message: `Set ${name} to ${fmt(newKg)}? That's ${Math.round(Math.abs(share) * 100)}% ${share > 0 ? 'above' : 'below'} the ${fmt(currentKg)} every load uses now.`,
    value: newKg,
    reference: currentKg,
  };
}

/**
 * One logged set, against his best on the lift and a rep count a compound
 * can have.
 *
 * `bestKg` is the heaviest load he has handled on this exercise (or its
 * working max, whichever the caller has); `exercise` is the plan's entry.
 * Compound means the plan tracks a high-confidence max for it.
 */
export function checkSet({ load = null, reps = null, exercise = null, bestKg = null, fmt = kgText } = {}) {
  const name = exercise?.name?.split(' (')[0] || 'this lift';
  if (Number.isFinite(load) && Number.isFinite(bestKg) && bestKg > 0 && load > bestKg * SET_LOAD_FACTOR) {
    return {
      ok: false,
      reason: `more than ${SET_LOAD_FACTOR}× your best on the lift`,
      message: `Log ${fmt(load)} on ${name}? That's ${round1(load / bestKg)}× your best of ${fmt(bestKg)}.`,
      value: load,
      reference: bestKg,
    };
  }
  const compound = exercise?.tracksMax && exercise?.maxConf === 'high';
  if (compound && Number.isFinite(reps) && reps > COMPOUND_REP_LIMIT) {
    return {
      ok: false,
      reason: `more than ${COMPOUND_REP_LIMIT} reps on a compound`,
      message: `Log ${reps} reps on ${name}? That is more than a compound set runs to — check for a typo.`,
      value: reps,
      reference: COMPOUND_REP_LIMIT,
    };
  }
  return fine;
}

/**
 * Whether a stored reading should be left out of a trend, and why.
 *
 * Used by analytics on data already saved — the typos that got in before any
 * of the checks above existed. Nothing is deleted: the reading stays in the
 * Log, where it can be corrected, and the chart says what it left out.
 *
 * `others` are the other readings at the same site. A reading outside the
 * site's range is always left out; one more than `share` from the median of
 * the others is left out when there are at least three others to judge by.
 */
export function outlierReason(value, others, { range = null, share = 0.25, unit = 'cm' } = {}) {
  if (!Number.isFinite(value)) return null;
  if (range && (value < range.lo || value > range.hi)) return `outside ${range.lo}–${range.hi} ${unit}`;
  const usable = (others || []).filter(Number.isFinite).sort((a, b) => a - b);
  if (usable.length < 3) return null;
  const mid = Math.floor(usable.length / 2);
  const median = usable.length % 2 ? usable[mid] : (usable[mid - 1] + usable[mid]) / 2;
  if (median > 0 && Math.abs(value / median - 1) > share) {
    return `${Math.round(Math.abs(value / median - 1) * 100)}% from the usual ${round1(median)} ${unit}`;
  }
  return null;
}

/**
 * The question to ask before a logged set is saved, or null.
 *
 * The set editor and the one-tap path ask with the set itself and every stored
 * set: the best for the same exercise is found here, bodyweight lifts compare
 * bodyweight + added (so a first weighted dip is not mistaken for a typo), and
 * the set being edited is left out so an outlier is judged against the rest.
 * The rep rule comes from `checkSet` when the exercise is known.
 */
export function questionSet(set, history, { exercise = null } = {}) {
  const total = (s) => (Number.isFinite(s?.load) ? s.load + (Number(s.bodyweightUsed) || 0) : null);
  const value = total(set);
  if (value == null || !set?.exerciseId) return null;
  let best = null;
  let bestRow = null;
  for (const row of history || []) {
    if (row.exerciseId !== set.exerciseId || row.deletedAtISO) continue;
    if (set.id != null && row.id === set.id) continue;
    const t = total(row);
    if (t != null && (best == null || t > best)) {
      best = t;
      bestRow = row;
    }
  }
  if (value > 0 && best != null && best > 0 && value > best * SET_LOAD_FACTOR) {
    return `Save ${round1(set.load)} kg? Your best on this lift is ${round1(bestRow.load)} kg.`;
  }
  if (exercise) {
    const verdict = checkSet({ load: null, reps: set.reps, exercise });
    if (!verdict.ok) return verdict.message;
  }
  return null;
}
