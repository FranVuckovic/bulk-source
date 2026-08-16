/**
 * volume.js — fractional set counting and the whole-muscle roll-ups.
 *
 * Pure: inputs in, outputs out. No DOM, no storage, no Date.now().
 *
 * A set is not one set for every muscle it touches. Bench is a full set for the
 * mid chest and half a set for the triceps, and counting it as a whole set for
 * both would tell you that you are doing far more triceps work than you are.
 * The weights live in the plan (exercise.m), never in here — this file only
 * knows how to add them up.
 */

/**
 * Contributions below this are not counted at all. Below roughly 40% of maximum
 * voluntary contraction a muscle is not receiving a growth stimulus worth
 * counting, so the plan data drops them; this filter is the belt to that
 * braces, in case one ever appears.
 */
export const MIN_COUNTED_WEIGHT = 0.3;

/** A session "hits" a muscle when an exercise gives it at least this much. */
export const FREQUENCY_WEIGHT = 0.5;

/**
 * The ~20-sets-per-week literature uses whole-muscle units, which is why the
 * roll-ups exist. Only claim diminishing returns when the ROLL-UP is ≥ 20 —
 * never when a single head is.
 */
export const DIMINISHING_RETURNS_SETS = 20;

const countedEntries = (weights) =>
  Object.entries(weights || {}).filter(([, w]) => Number.isFinite(w) && w >= MIN_COUNTED_WEIGHT);

const addTo = (totals, muscleId, amount) => {
  totals[muscleId] = (totals[muscleId] || 0) + amount;
};

/**
 * Planned fractional sets per muscle for one session.
 *
 * Speed bench has an empty muscle map and therefore contributes nothing: sets
 * at RPE 5–6 are motor-pattern practice, not growth stimulus, and counting them
 * would both inflate the ledger and tempt you to make that day hard.
 */
export function sessionVolume(session, exercises) {
  const totals = {};
  for (const slot of session?.slots || []) {
    const exercise = exercises[slot.ex];
    if (!exercise) continue;
    for (const [muscleId, weight] of countedEntries(exercise.m)) {
      addTo(totals, muscleId, slot.sets * weight);
    }
  }
  return totals;
}

/** Muscles a session hits hard enough to count towards frequency. */
export function sessionMuscles(session, exercises) {
  const hit = new Set();
  for (const slot of session?.slots || []) {
    const exercise = exercises[slot.ex];
    if (!exercise) continue;
    for (const [muscleId, weight] of countedEntries(exercise.m)) {
      if (weight >= FREQUENCY_WEIGHT) hit.add(muscleId);
    }
  }
  return hit;
}

/**
 * A full rotation's planned volume, plus how many sessions hit each muscle.
 * One rotation is what the plan calls a week — the calendar has no say in it.
 */
export function weeklyVolume(sessions, exercises) {
  const volume = {};
  const frequency = {};

  for (const session of sessions || []) {
    for (const [muscleId, sets] of Object.entries(sessionVolume(session, exercises))) {
      addTo(volume, muscleId, sets);
    }
    for (const muscleId of sessionMuscles(session, exercises)) {
      addTo(frequency, muscleId, 1);
    }
  }
  return { volume, frequency };
}

/**
 * Volume from sets actually logged, rather than sets planned. Each logged set
 * counts once, weighted the same way — this is what tells you whether you are
 * accumulating what the plan says, or quietly skipping the accessories.
 */
export function volumeFromSets(sets, exercises) {
  const volume = {};
  for (const set of sets || []) {
    const exercise = exercises[set?.exerciseId];
    if (!exercise) continue;
    for (const [muscleId, weight] of countedEntries(exercise.m)) {
      addTo(volume, muscleId, weight);
    }
  }
  return volume;
}

/**
 * Sum per-head volume into whole muscles (Chest, Triceps, Biceps, Back, Core).
 * Muscles without a roll key — delts, quads, forearms — are not part of any
 * roll-up and are dropped here; they are shown per-head instead.
 */
export function rollUp(volume, muscles) {
  const totals = {};
  for (const [muscleId, sets] of Object.entries(volume || {})) {
    const roll = muscles[muscleId]?.roll;
    if (roll) addTo(totals, roll, sets);
  }
  return totals;
}

/**
 * Per-head volume arranged by display group, with each muscle's target band
 * attached. Both views have to be shown: the bands are per-head, the 20-set
 * literature is whole-muscle.
 */
export function volumeByGroup(volume, muscles) {
  const groups = new Map();
  for (const [muscleId, muscle] of Object.entries(muscles || {})) {
    const row = {
      id: muscleId,
      label: muscle.label,
      sets: volume[muscleId] || 0,
      lo: muscle.lo,
      hi: muscle.hi,
      roll: muscle.roll || null,
      status: bandStatus(volume[muscleId] || 0, muscle),
    };
    if (!groups.has(muscle.grp)) groups.set(muscle.grp, []);
    groups.get(muscle.grp).push(row);
  }
  return groups;
}

/** Where a muscle sits against its target band. */
export function bandStatus(sets, muscle) {
  if (!muscle || !Number.isFinite(muscle.lo) || !Number.isFinite(muscle.hi)) return 'unknown';
  if (sets < muscle.lo) return 'under';
  if (sets > muscle.hi) return 'over';
  return 'in';
}

/**
 * True only when the whole-muscle roll-up is genuinely at or past the point
 * where the evidence says returns flatten. Deliberately not applied to a single
 * head, which would claim diminishing returns at half the real volume.
 */
export function pastDiminishingReturns(rollUpSets) {
  return rollUpSets >= DIMINISHING_RETURNS_SETS;
}
