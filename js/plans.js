/**
 * plans.js — which training plans the app knows, and which one a record
 * belongs to.
 *
 * There used to be exactly one plan, so nothing recorded which plan it was
 * written under. Every session log, every cycle and the rotation pointer in
 * settings assumed it. With a second plan that assumption breaks in a
 * particular way: both plans letter their sessions from A, so an old "A" (heavy
 * bench) and a new "A" (lower body) would count towards each other's rotation,
 * and History would show the old session under the new plan's name.
 *
 * So every record says which plan it belongs to. Records written before this
 * existed carry nothing, and nothing is rewritten: a missing `planId` means the
 * original plan, which is the only one they could have been written under.
 *
 * Pure: no DOM, no storage, no clock.
 */

/** The plan every record predating `planId` was written under. */
export const DEFAULT_PLAN_ID = 'fopip-v2';

/**
 * Every plan the app can run, in the order Settings lists them. The files are
 * part of the offline shell (see `sw.js`), so switching works without a
 * connection.
 */
export const PLAN_FILES = Object.freeze([
  Object.freeze({ id: 'fopip-v2', url: './data/plan-fopip-v2.json' }),
  Object.freeze({ id: 'flopip-2', url: './data/plan-flopip-2.json' }),
]);

/** The plan a session log or a cycle belongs to. */
export const planIdOf = (record) => record?.planId ?? DEFAULT_PLAN_ID;

/** True when a record was written under this plan. */
export const belongsTo = (record, planId) => planIdOf(record) === planId;

/**
 * Where a plan keeps its rotation pointer in settings.
 *
 * The original plan keeps the keys it always had, so an existing database
 * needs no migration and an older build reading it still finds its rotation.
 * Any other plan gets its own keys, so switching plans and back again returns
 * each one to exactly where it was left.
 */
export function cycleSettingKeys(planId) {
  if (planId === DEFAULT_PLAN_ID) {
    return { sequence: 'cycleSequence', startedAtISO: 'cycleStartedAtISO', startedDate: 'cycleStartedDate' };
  }
  return {
    sequence: `cycleSequence@${planId}`,
    startedAtISO: `cycleStartedAtISO@${planId}`,
    startedDate: `cycleStartedDate@${planId}`,
  };
}

/**
 * Give every plan the exercises and muscles of every other plan, without
 * letting any plan's own definitions be overwritten.
 *
 * A set logged under one plan names an exercise from that plan's library. When
 * you switch, the set is still in your history, and the Log, the records, the
 * charts and the volume count all look its exercise up in the plan that is
 * active now. Merging the libraries means every exercise you have ever logged
 * still has a name and a muscle map whichever plan you are on.
 */
export function withSharedLibrary(plans) {
  const exercises = {};
  const muscles = {};
  for (const plan of plans) {
    for (const [id, exercise] of Object.entries(plan.exercises || {})) if (!exercises[id]) exercises[id] = exercise;
    for (const [id, muscle] of Object.entries(plan.muscles || {})) if (!muscles[id]) muscles[id] = muscle;
  }
  return plans.map((plan) => ({
    ...plan,
    exercises: { ...exercises, ...plan.exercises },
    muscles: { ...muscles, ...plan.muscles },
  }));
}

/**
 * The session a log was trained as, looked up in the plan it was trained
 * under — a saved custom workout included. Null for the blank ad-hoc session
 * and for anything the plan no longer contains.
 */
export function sessionForLog(plans, log) {
  const plan = plans?.[planIdOf(log)];
  if (!plan || !log?.sessionId) return null;
  return (
    (plan.sessions || []).find((session) => session.id === log.sessionId) ||
    (plan.customWorkouts || []).find((workout) => workout.id === log.sessionId) ||
    null
  );
}
