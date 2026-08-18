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

/**
 * A myo-rep cluster is one activation set to failure plus 3–5 short mini-sets.
 * It is worth roughly two straight sets of stimulus, and counting the mini-sets
 * individually would score it as five — which would quietly inflate every
 * weekly total the moment the technique is used.
 */
export const MYO_REP_SET_VALUE = 2;

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
    // The final set becomes a myo-rep cluster, worth two.
    const sets = slot.myoReps ? slot.sets - 1 + MYO_REP_SET_VALUE : slot.sets;
    for (const [muscleId, weight] of countedEntries(exercise.m)) {
      addTo(totals, muscleId, sets * weight);
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
    const value = set.isMyoRep ? MYO_REP_SET_VALUE : 1;
    for (const [muscleId, weight] of countedEntries(exercise.m)) {
      addTo(volume, muscleId, value * weight);
    }
  }
  return volume;
}

/**
 * Per-head volume summed into whole muscles (Chest, Triceps, Biceps, Back,
 * Core). Muscles without a roll key — delts, quads, forearms — are not part of
 * any roll-up and are dropped here; they are shown per-head instead.
 *
 * NOTE this double counts a set that hits two heads of the same muscle: an
 * incline press giving upper chest 1.0 and mid chest 0.3 adds 1.3 to "Chest".
 * Use rollUpBySet for the number to compare against the ~20-sets-per-week
 * literature, which counts whole muscles.
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
 * Whole-muscle volume counted the way the research counts it: each set
 * contributes its LARGEST head weighting to the muscle, not the sum of them.
 *
 * The ~20-sets-per-week figure everyone quotes is a whole-muscle number. Adding
 * the heads together turns one incline press set into 1.3 sets of chest, and
 * across a rotation that inflates the ledger by 10–15% — enough to make a plan
 * inside its target band look like it is past the point of diminishing returns.
 */
export function rollUpBySet(session, exercises, muscles) {
  const totals = {};
  for (const slot of session?.slots || []) {
    const exercise = exercises[slot.ex];
    if (!exercise) continue;
    const sets = slot.myoReps ? slot.sets - 1 + MYO_REP_SET_VALUE : slot.sets;

    const byRoll = new Map();
    for (const [muscleId, weight] of countedEntries(exercise.m)) {
      const roll = muscles[muscleId]?.roll;
      if (!roll) continue;
      byRoll.set(roll, Math.max(byRoll.get(roll) ?? 0, weight));
    }
    for (const [roll, weight] of byRoll) addTo(totals, roll, sets * weight);
  }
  return totals;
}

/** rollUpBySet across a whole rotation. */
export function weeklyRollUp(sessions, exercises, muscles) {
  const totals = {};
  for (const session of sessions || []) {
    for (const [roll, sets] of Object.entries(rollUpBySet(session, exercises, muscles))) {
      addTo(totals, roll, sets);
    }
  }
  return totals;
}

/**
 * Whole-muscle volume from sets actually logged, counted the same way as the
 * planned figure.
 *
 * v1 fed logged sets through rollUp(), which sums the heads: one incline fly
 * added 1.3 sets of chest instead of 1.0. Planned and completed volume were
 * therefore measured with two different rulers and could not be compared.
 */
export function rollUpFromSets(sets, exercises, muscles) {
  const totals = {};
  for (const set of sets || []) {
    const exercise = exercises[set?.exerciseId];
    if (!exercise) continue;
    const value = set.isMyoRep ? MYO_REP_SET_VALUE : 1;

    const byRoll = new Map();
    for (const [muscleId, weight] of countedEntries(exercise.m)) {
      const roll = muscles[muscleId]?.roll;
      if (!roll) continue;
      byRoll.set(roll, Math.max(byRoll.get(roll) ?? 0, weight));
    }
    for (const [roll, weight] of byRoll) addTo(totals, roll, value * weight);
  }
  return totals;
}

/**
 * Planned against completed for one cycle, per whole muscle.
 *
 * The comparison the Progress screen should have been making all along: what
 * the plan asked for this rotation, what was actually logged, and the share.
 */
export function plannedVsCompleted({ plannedSessions, loggedSets, exercises, muscles }) {
  const planned = weeklyRollUp(plannedSessions, exercises, muscles);
  const completed = rollUpFromSets(loggedSets, exercises, muscles);

  const rolls = [...new Set([...Object.keys(planned), ...Object.keys(completed)])].sort();
  return rolls.map((roll) => {
    const plannedSets = planned[roll] || 0;
    const completedSets = completed[roll] || 0;
    return {
      roll,
      planned: Math.round(plannedSets * 10) / 10,
      completed: Math.round(completedSets * 10) / 10,
      share: plannedSets ? Math.round((completedSets / plannedSets) * 100) / 100 : null,
    };
  });
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
