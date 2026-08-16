/**
 * progress.js — where you are: rotation position, block position, pace, drift.
 *
 * Pure: inputs in, outputs out. No DOM, no storage, no Date.now(). Anything
 * that needs "today" takes it as an argument, which is also what makes these
 * testable without freezing the clock.
 *
 * Two models, deliberately separate:
 *
 *   Rotation position — a counter over LOGGED sessions, sorted by DATE.
 *   Deterministic and immune to missed days, which is the whole point of a
 *   rotation. Back-dating an entry re-orders the history, so the counter has to
 *   read dates rather than the order things were typed in.
 *
 *   Block position — driven by sessions COMPLETED, not by the calendar,
 *   because a block is an amount of training, not an amount of time. The
 *   calendar is tracked alongside purely as a pace check, since the March
 *   target is a real date.
 */

/** Drift past this means the calendar is getting away from you. */
export const DRIFT_WARN = -0.12;

/** Blocks are six calendar weeks' worth of training, by design. */
export const BLOCK_WEEKS = 6;

/** Below this share of the prescribed sets, a session is logged as partial. */
export const PARTIAL_SESSION_RATIO = 0.5;

const MS_PER_DAY = 86400000;

/** Date-only part of an ISO date or timestamp. */
const dayOf = (iso) => (typeof iso === 'string' ? iso.slice(0, 10) : '');

/**
 * Whole days between two ISO dates, ignoring time of day and time zone —
 * both ends are read as UTC midnight so the answer never shifts with the clock.
 */
export function daysBetween(fromISO, toISO) {
  const from = Date.parse(`${dayOf(fromISO)}T00:00:00Z`);
  const to = Date.parse(`${dayOf(toISO)}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / MS_PER_DAY);
}

/**
 * Logs in the order they actually happened. Date first, then start time, then
 * id — so two sessions on one day keep a stable, meaningful order, and a
 * back-dated entry sorts into its real place rather than onto the end.
 */
export function sortLogsByDate(logs) {
  return [...(logs || [])].sort((a, b) => {
    const byDay = dayOf(a.dateISO).localeCompare(dayOf(b.dateISO));
    if (byDay !== 0) return byDay;
    const byStart = String(a.startedAt || '').localeCompare(String(b.startedAt || ''));
    if (byStart !== 0) return byStart;
    return String(a.id ?? '').localeCompare(String(b.id ?? ''));
  });
}

/** The most recent session log by date, or null if nothing is logged yet. */
export function lastLogged(logs) {
  const sorted = sortLogsByDate(logs);
  return sorted.length ? sorted[sorted.length - 1] : null;
}

/**
 * The next session in the rotation. An unrecognised or missing last session
 * starts the rotation from the top — which is also the calibration case, before
 * anything has been logged at all.
 */
export function nextSessionId(rotation, lastSessionId) {
  if (!rotation?.length) return null;
  const index = rotation.indexOf(lastSessionId);
  if (index < 0) return rotation[0];
  return rotation[(index + 1) % rotation.length];
}

/**
 * Rotation position from the logs. Because it reads only the last session by
 * date, a manual override needs no special handling: train C when D was next
 * and the rotation simply continues from C.
 */
export function rotationPosition(logs, rotation) {
  const last = lastLogged(logs);
  return {
    lastSessionId: last ? last.sessionId : null,
    lastDateISO: last ? dayOf(last.dateISO) : null,
    nextSessionId: nextSessionId(rotation, last ? last.sessionId : null),
    sessionsDone: (logs || []).length,
  };
}

/** Sessions per week actually achieved. Six is a full rotation in seven days. */
export function pace(sessionsDone, daysElapsed) {
  if (!daysElapsed || daysElapsed <= 0) return null;
  return sessionsDone / (daysElapsed / 7);
}

/**
 * How far ahead of or behind the calendar the block is, as a fraction of the
 * block. Negative means behind. daysElapsed is measured from the start of the
 * BLOCK, not the start of the plan — the comparison is block progress against
 * the six weeks a block is supposed to take.
 */
export function drift(blockDone, sessionTarget, daysElapsed, blockWeeks = BLOCK_WEEKS) {
  if (!sessionTarget || !blockWeeks) return null;
  return blockDone / sessionTarget - daysElapsed / 7 / blockWeeks;
}

/** Sets the plan asks for in a session. */
export function prescribedSetCount(session) {
  return (session?.slots || []).reduce((total, slot) => total + (slot.sets || 0), 0);
}

/** A set counts as logged once it has a rep count or a load on it. */
export function isLoggedSet(set) {
  return !!set && ((Number.isFinite(set.reps) && set.reps > 0) || (Number.isFinite(set.load) && set.load > 0));
}

export function loggedSetCount(sets) {
  return (sets || []).filter(isLoggedSet).length;
}

/**
 * Fewer than half the prescribed sets logged makes it a partial session. It is
 * still a real session and still advances the rotation — it is flagged so that
 * volume and block counts can say so, not so it can be thrown away.
 */
export function isPartialSession(loggedSets, prescribedSets) {
  if (!prescribedSets) return false;
  return loggedSets / prescribedSets < PARTIAL_SESSION_RATIO;
}

/**
 * Block position. `readyForReview` is the whole point of counting sessions:
 * reaching the target OPENS the block review, it never advances the block.
 * Nothing about a block boundary happens without confirmation.
 *
 * block is { id, sessionTarget, startedISO, weeks }.
 */
export function blockProgress(logs, block, todayISO) {
  const inBlock = (logs || []).filter((log) => log.blockId === block?.id);
  const blockDone = inBlock.length;
  const sessionTarget = block?.sessionTarget || 0;
  const weeks = block?.weeks || BLOCK_WEEKS;
  const daysElapsed = block?.startedISO && todayISO ? daysBetween(block.startedISO, todayISO) : null;
  const driftValue = daysElapsed == null ? null : drift(blockDone, sessionTarget, daysElapsed, weeks);

  return {
    blockId: block?.id ?? null,
    blockDone,
    sessionTarget,
    remaining: Math.max(0, sessionTarget - blockDone),
    readyForReview: sessionTarget > 0 && blockDone >= sessionTarget,
    partialCount: inBlock.filter((log) => log.isPartial).length,
    daysElapsed,
    weeksElapsed: daysElapsed == null ? null : daysElapsed / 7,
    pace: daysElapsed == null ? null : pace(blockDone, daysElapsed),
    drift: driftValue,
    behind: driftValue != null && driftValue < DRIFT_WARN,
  };
}

/**
 * Plan-level position: how far through the whole thing you are, and whether the
 * calendar target is still in reach. Calendar week is a report, not a schedule —
 * nothing in the plan advances because a week passed.
 */
export function planProgress(logs, startISO, todayISO) {
  const daysElapsed = daysBetween(startISO, todayISO);
  const sessionsDone = (logs || []).length;
  return {
    sessionsDone,
    daysElapsed,
    calendarWeek: daysElapsed == null ? null : Math.floor(daysElapsed / 7) + 1,
    pace: daysElapsed == null ? null : pace(sessionsDone, daysElapsed),
  };
}
