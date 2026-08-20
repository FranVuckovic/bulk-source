/**
 * cycle.js — the training cycle, as a first-class thing.
 *
 * "Week" meant three incompatible things in v1: the plan called one A–F
 * rotation a week, the analytics bucketed Monday to Sunday, and plan progress
 * counted elapsed calendar weeks. A rotation that took nine days was split
 * across two bars, a partial sequence could not be told from a complete one,
 * and the block never advanced at all because nothing owned that decision.
 *
 * One completed A–F rotation is one cycle. Cycles are numbered 1..33, carry
 * their own status, and are the unit every training analysis groups by. The
 * calendar is kept for nutrition and recovery, where dates genuinely matter.
 *
 * Pure functions over records. Persistence lives in db.js.
 */

import { blockFor, effortModeFor } from './plan.js';

export const CYCLE_STATUS = Object.freeze(['planned', 'active', 'complete', 'partial', 'abandoned', 'reopened']);
export const POSITION_STATUS = Object.freeze(['pending', 'active', 'complete', 'partial', 'skipped', 'moved']);

/** A session counts towards the cycle's dose only if enough of it happened. */
export const COMPLETE_SESSION_RATIO = 0.5;

/** Build the cycle record for a rotation number. */
export function newCycle(plan, { sequence, startedAtISO, localStartDate, id }) {
  const block = blockFor(plan, sequence);
  return {
    id: id ?? `cycle-${sequence}-${startedAtISO ?? localStartDate ?? sequence}`,
    sequence,
    planVersion: plan.meta.planVersion,
    blockId: block ? block.id : null,
    type: block ? block.type : 'normal',
    effortMode: effortModeFor(plan, sequence),
    status: 'active',
    startedAtISO: startedAtISO ?? null,
    endedAtISO: null,
    localStartDate: localStartDate ?? null,
    localEndDate: null,
    note: null,
    deletedAtISO: null,
  };
}

/**
 * Where a cycle stands: which positions are done, which is next, and whether
 * the sequence is genuinely finished.
 *
 * `sessions` are the logs belonging to this cycle. Position is taken from the
 * log's `rotationPosition`, not inferred from dates, so a manual override or a
 * back-dated entry cannot silently reorder the rotation.
 */
export function cycleProgress(plan, cycle, sessions) {
  const order = plan.meta.rotationOrder;
  // Ad-hoc sessions deliberately share the current cycle for analytics, but
  // have no rotation position and must never satisfy or inflate A–F progress.
  const live = (sessions || []).filter(
    (s) => !s.deletedAtISO && s.cycleId === cycle.id && order.includes(s.rotationPosition)
  );

  const positions = order.map((position) => {
    const logs = live.filter((log) => log.rotationPosition === position);
    const best = logs.find((log) => log.status === 'complete') || logs.find((log) => log.status === 'partial') || logs[0];

    return {
      position,
      status: best ? best.status : 'pending',
      logId: best ? best.id : null,
      logs: logs.map((log) => log.id),
      completionRatio: best?.completionRatio ?? null,
    };
  });

  const done = positions.filter((p) => p.status === 'complete').length;
  const partial = positions.filter((p) => p.status === 'partial').length;
  const skipped = positions.filter((p) => p.status === 'skipped').length;
  const pending = positions.filter((p) => p.status === 'pending');

  // The dose actually trained, not the number of sessions opened. Twelve
  // one-set sessions did finish a block in v1.
  const dose = live
    .filter((log) => !['skipped'].includes(log.status))
    .reduce((total, log) => total + (log.completionRatio ?? (log.status === 'complete' ? 1 : 0)), 0);

  return {
    cycleId: cycle.id,
    sequence: cycle.sequence,
    positions,
    complete: done,
    partial,
    skipped,
    pending: pending.length,
    nextPosition: pending.length ? pending[0].position : null,
    dose: Math.round(dose * 100) / 100,
    finished: pending.length === 0,
    status: pending.length === 0 ? (partial || skipped ? 'partial' : 'complete') : cycle.status,
  };
}

/**
 * The session to offer next.
 *
 * The first position that has not been trained, in plan order. A skipped or
 * partial position is not offered again automatically — the rotation slides
 * forward, which is the whole point of not using a calendar — but it is
 * reported so the review can say what was missed.
 */
export function nextSession(plan, cycle, sessions) {
  const progress = cycleProgress(plan, cycle, sessions);
  if (progress.nextPosition) {
    return { cycleSequence: cycle.sequence, position: progress.nextPosition, startsNewCycle: false };
  }
  const nextSequence = cycle.sequence + 1;
  return {
    cycleSequence: nextSequence <= plan.meta.rotations ? nextSequence : null,
    position: plan.meta.rotationOrder[0],
    startsNewCycle: true,
    finishedPlan: nextSequence > plan.meta.rotations,
  };
}

/**
 * Whether finishing this cycle crosses a block boundary.
 *
 * Nothing advances on its own. This only reports that a review is due; the
 * transition is a deliberate confirmed action in db/app.
 */
export function blockBoundary(plan, cycle) {
  const block = blockFor(plan, cycle.sequence);
  const next = blockFor(plan, cycle.sequence + 1);
  if (!block) return { atBoundary: false };
  return {
    atBoundary: !!next && next.id !== block.id,
    fromBlock: block.id,
    toBlock: next ? next.id : null,
    fromName: block.name,
    toName: next ? next.name : null,
    isFinalCycle: cycle.sequence >= plan.meta.rotations,
  };
}

/**
 * How complete a session was, as a share of what the resolved plan prescribed.
 * Used for the cycle's dose and to decide complete versus partial.
 */
export function completionRatio(loggedSetCount, prescribedSetCount) {
  if (!prescribedSetCount) return null;
  return Math.min(1, Math.round((loggedSetCount / prescribedSetCount) * 100) / 100);
}

export const sessionStatusFor = (ratio) =>
  ratio == null ? 'partial' : ratio >= COMPLETE_SESSION_RATIO ? 'complete' : 'partial';

/**
 * A manual correction to cycle or block, with its reason recorded.
 *
 * v1 had no way to fix a wrong block, a wrong cycle or a mis-ordered sequence
 * after an import. Every correction here produces an audit entry; nothing
 * changes irreversibly and silently.
 */
export function planCorrection({ field, from, to, reason, atISO }) {
  if (!['cycleSequence', 'blockId', 'position', 'startDate'].includes(field)) {
    return { ok: false, reason: `${field} is not a correctable field` };
  }
  if (from === to) return { ok: false, reason: 'that is already the current value' };
  if (!reason) return { ok: false, reason: 'a correction has to say why' };

  return {
    ok: true,
    entry: { atISO, entity: 'plan', action: 'correct', field, from, to, reason },
  };
}

/** Estimated calendar finish, from the pace actually achieved. */
export function projectedFinish(plan, { cyclesDone, daysElapsed }) {
  if (!cyclesDone || !daysElapsed || daysElapsed <= 0) return null;
  const daysPerCycle = daysElapsed / cyclesDone;
  const remaining = plan.meta.rotations - cyclesDone;
  return {
    daysPerCycle: Math.round(daysPerCycle * 10) / 10,
    remainingCycles: remaining,
    daysRemaining: Math.round(remaining * daysPerCycle),
    // At six sessions a week the 33 rotations take about 33 weeks. At five they
    // take about 39.6, and no amount of cramming changes that arithmetic.
    weeksTotal: Math.round(((plan.meta.rotations * daysPerCycle) / 7) * 10) / 10,
  };
}
