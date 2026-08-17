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
  const sessionsDone = (logs || []).length;
  const raw = daysBetween(startISO, todayISO);
  // Training logged before the plan's own start date — a history imported from
  // before day one, or a start date still in the future — must not produce a
  // week 0 or a negative pace. Day one is week one, whichever way the dates run.
  const daysElapsed = raw == null ? null : Math.max(0, raw);

  return {
    sessionsDone,
    daysElapsed,
    calendarWeek: daysElapsed == null ? null : Math.floor(daysElapsed / 7) + 1,
    pace: daysElapsed == null ? null : pace(sessionsDone, daysElapsed),
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   Trends, records and the decision flags
   ═══════════════════════════════════════════════════════════════════════ */

/*
 * Everything below is computed on read, never stored. A rolling average that
 * lives in the database is a rolling average that goes stale the moment a
 * back-dated entry lands.
 */

/** ISO week start (Monday) for a date — the bucket weekly figures fall into. */
export function weekStartISO(iso) {
  const date = new Date(`${dayOf(iso)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const day = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - day);
  return date.toISOString().slice(0, 10);
}

/**
 * Trailing average over a window of DAYS, not of samples — so a missed weigh-in
 * widens the gap rather than silently averaging over a longer stretch of time.
 * Points are [{ dateISO, value }] and come back with the same dates.
 */
export function rollingAverage(points, windowDays = 7) {
  const clean = (points || [])
    .filter((p) => p && Number.isFinite(p.value))
    .sort((a, b) => dayOf(a.dateISO).localeCompare(dayOf(b.dateISO)));

  return clean.map((point, i) => {
    let sum = 0;
    let count = 0;
    for (let j = i; j >= 0; j--) {
      if (daysBetween(clean[j].dateISO, point.dateISO) >= windowDays) break;
      sum += clean[j].value;
      count += 1;
    }
    return { dateISO: dayOf(point.dateISO), value: sum / count, samples: count };
  });
}

/**
 * Least-squares slope in units per WEEK — the gain rate the nutrition targets
 * are written in. Fewer than two points has no slope, and says so with null
 * rather than 0, which would read as "not gaining".
 */
export function weeklySlope(points) {
  const clean = (points || []).filter((p) => p && Number.isFinite(p.value));
  if (clean.length < 2) return null;

  const origin = clean[0].dateISO;
  const xs = clean.map((p) => daysBetween(origin, p.dateISO) / 7);
  const ys = clean.map((p) => p.value);
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;

  let top = 0;
  let bottom = 0;
  for (let i = 0; i < xs.length; i++) {
    top += (xs[i] - meanX) * (ys[i] - meanY);
    bottom += (xs[i] - meanX) ** 2;
  }
  return bottom === 0 ? null : top / bottom;
}

/** Best value per ISO week. One point per week is the resolution the signal has. */
export function weeklyBests(points) {
  const byWeek = new Map();
  for (const point of points || []) {
    if (!point || !Number.isFinite(point.value)) continue;
    const week = weekStartISO(point.dateISO);
    const current = byWeek.get(week);
    if (!current || point.value > current.value) {
      byWeek.set(week, { weekISO: week, value: point.value, dateISO: dayOf(point.dateISO) });
    }
  }
  return [...byWeek.values()].sort((a, b) => a.weekISO.localeCompare(b.weekISO));
}

/**
 * Personal records, in date order. A value that equals the standing best is a
 * tie and is marked as one — it is a repeat performance, not a new record, and
 * calling it a PR would inflate the log.
 *
 * Points are [{ dateISO, value, ...anything }]; the caller decides what counts
 * as eligible, which is where indicative maxes get excluded.
 */
export function detectPRs(points) {
  const ordered = (points || [])
    .filter((p) => p && Number.isFinite(p.value))
    .sort((a, b) => dayOf(a.dateISO).localeCompare(dayOf(b.dateISO)));

  let best = -Infinity;
  const records = [];
  for (const point of ordered) {
    if (point.value > best) {
      records.push({ ...point, kind: 'pr', previousBest: best === -Infinity ? null : best });
      best = point.value;
    } else if (point.value === best) {
      records.push({ ...point, kind: 'tie', previousBest: best });
    }
  }
  return records;
}

/**
 * Foster's session load: how hard it felt × how long it lasted. Useless on its
 * own, and the earliest warning there is when three weeks of it are rising
 * while your top sets flatten.
 */
export function sessionLoad(log) {
  if (!log?.sessionRpe || !log.startedAt || !log.endedAt) return null;
  const minutes = (Date.parse(log.endedAt) - Date.parse(log.startedAt)) / 60000;
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return log.sessionRpe * minutes;
}

export function weeklyLoads(logs) {
  const byWeek = new Map();
  for (const log of logs || []) {
    const load = sessionLoad(log);
    if (load == null) continue;
    const week = weekStartISO(log.dateISO);
    byWeek.set(week, (byWeek.get(week) || 0) + load);
  }
  return [...byWeek.entries()]
    .map(([weekISO, value]) => ({ weekISO, value }))
    .sort((a, b) => a.weekISO.localeCompare(b.weekISO));
}

/** Thresholds the plan already specifies, in one place so they are auditable. */
export const FLAG_RULES = Object.freeze({
  gainRateEarly: { lo: 0.4, hi: 0.5, throughWeek: 12 },
  gainRateLate: { lo: 0.2, hi: 0.25 },
  sleepFloor: 7,
  nigglesPerBlock: 2,
  topSetDropPct: 0.05,
  stalledWeeks: 4,
});

/**
 * The decision flags. Each one exists because the plan names a specific action
 * for it — a flag with no action attached is just anxiety.
 */
export function decisionFlags({ bodyweight = [], e1rmWeekly = [], sleep = [], niggles = [], calendarWeek = 1 } = {}) {
  const flags = [];

  const gainRate = weeklySlope(rollingAverage(bodyweight, 7).slice(-21));
  const target = calendarWeek <= FLAG_RULES.gainRateEarly.throughWeek ? FLAG_RULES.gainRateEarly : FLAG_RULES.gainRateLate;

  if (gainRate != null) {
    if (gainRate < target.lo * 0.25) {
      flags.push({
        kind: 'warn',
        title: 'Gaining under target',
        detail: `${gainRate.toFixed(2)} kg/week against a ${target.lo}–${target.hi} target. Add about 250 kcal — one extra meal-sized snack.`,
      });
    } else if (gainRate > target.hi * 1.4) {
      flags.push({
        kind: 'warn',
        title: 'Gaining faster than target',
        detail: `${gainRate.toFixed(2)} kg/week against a ${target.lo}–${target.hi} target. Cut about 300 kcal.`,
      });
    } else {
      flags.push({
        kind: 'ok',
        title: 'Gain rate on target',
        detail: `${gainRate.toFixed(2)} kg/week, inside the ${target.lo}–${target.hi} band for week ${calendarWeek}.`,
      });
    }
  }

  const recent = e1rmWeekly.slice(-FLAG_RULES.stalledWeeks);
  if (recent.length === FLAG_RULES.stalledWeeks && gainRate != null && gainRate > 0) {
    const strengthSlope = weeklySlope(recent.map((p) => ({ dateISO: p.weekISO, value: p.value })));
    if (strengthSlope != null && strengthSlope <= 0) {
      flags.push({
        kind: 'bad',
        title: 'e1RM flat while bodyweight rises',
        detail: `No strength trend across ${FLAG_RULES.stalledWeeks} weeks while gaining ${gainRate.toFixed(2)} kg/week. That is a recovery or programming problem, not a food problem — send the export.`,
      });
    }
  }

  const recentSleep = sleep.filter((s) => Number.isFinite(s.value)).slice(-7);
  if (recentSleep.length >= 3) {
    const mean = recentSleep.reduce((a, b) => a + b.value, 0) / recentSleep.length;
    if (mean < FLAG_RULES.sleepFloor) {
      flags.push({
        kind: 'warn',
        title: 'Sleep below seven hours',
        detail: `Averaging ${mean.toFixed(1)} h. Below 7 h the frequency stops being survivable — drop Session D first, it is the cheapest to lose.`,
      });
    }
  }

  if (niggles.length >= FLAG_RULES.nigglesPerBlock) {
    flags.push({
      kind: 'warn',
      title: `${niggles.length} niggles logged this block`,
      detail: 'Two or more in a block is the trigger to rotate the aggravating variation out. Do not push through it.',
    });
  }

  return flags;
}

/* ═══════════════════════════════════════════════════════════════════════
   Resolving a session for the block you are actually in
   ═══════════════════════════════════════════════════════════════════════ */

/*
 * A plan slot can vary by block. Three ways, all data:
 *
 *   fromBlock     the slot does not exist before that block — static holds are
 *                 introduced at block 2 and must not appear before it
 *   setsByBlock   more sets in some blocks, e.g. two heavy singles when the
 *                 block's job is intensification rather than accumulation
 *   repsByBlock   the bench variation runs 4s in intensification blocks and 6s
 *                 in accumulation blocks
 *
 * Resolving happens on read so the plan file stays a single description of all
 * 33 weeks rather than seven copies of the same session.
 */
export function resolveSlot(slot, blockIdx) {
  if (!slot) return null;
  if (Number.isFinite(slot.fromBlock) && blockIdx < slot.fromBlock) return null;

  const key = String(blockIdx);
  return {
    ...slot,
    sets: slot.setsByBlock?.[key] ?? slot.sets,
    reps: slot.repsByBlock?.[key] ?? slot.reps,
  };
}

export function resolveSession(session, blockIdx) {
  if (!session) return session;
  return { ...session, slots: (session.slots || []).map((s) => resolveSlot(s, blockIdx)).filter(Boolean) };
}

/**
 * Deloads are EARNED, not scheduled.
 *
 * The evidence for planned deloads is thinner than the folklore. A one-week
 * deload at the midpoint of a programme has been found to slightly REDUCE
 * strength gains against training through, with no hypertrophy benefit, and the
 * risk of non-functional overreaching without deloading is low. A controlled
 * trial also found complete cessation impaired strength relative to training
 * through, with more soreness and less motivation, not less.
 *
 * So nothing here schedules one. `deloadSessions` is 0 in the shipped plan and
 * this function returns false. What the app does instead is watch for the
 * triggers the plan already names — a top set 5% below your rolling average
 * twice, sleep under 7 h, two niggles in a block — and offer a deload when they
 * fire. See shouldDeload().
 */
export function isDeloadSession(blockDone, block) {
  const deload = block?.deloadSessions || 0;
  const target = block?.sessionTarget || 0;
  if (!deload || !target) return false;
  return blockDone >= target - deload;
}

/**
 * Whether the evidence in your own log says to take one now. The triggers are
 * the plan's own, and two must fire together: any single one of them is a bad
 * week, and a bad week is not a reason to cut training.
 */
export function shouldDeload({ topSetDrop = 0, sleepMean = null, nigglesThisBlock = 0, sessionsSinceDeload = 0 } = {}) {
  const reasons = [];
  if (topSetDrop >= FLAG_RULES.topSetDropPct) reasons.push('top set is more than 5% below your rolling average');
  if (sleepMean != null && sleepMean < FLAG_RULES.sleepFloor) reasons.push(`sleep averaging ${sleepMean.toFixed(1)} h`);
  if (nigglesThisBlock >= FLAG_RULES.nigglesPerBlock) reasons.push(`${nigglesThisBlock} niggles logged this block`);

  return {
    recommended: reasons.length >= 2 && sessionsSinceDeload >= 12,
    reasons,
    watch: reasons.length === 1,
  };
}

/** Deload loads: volume down 40–50%, intensity down about 10%, nothing near failure. */
export const DELOAD = Object.freeze({ setFactor: 0.55, loadFactor: 0.9, rpeCap: 7 });

export function applyDeload(slot) {
  if (!slot) return slot;
  return {
    ...slot,
    sets: Math.max(1, Math.round(slot.sets * DELOAD.setFactor)),
    rpe: Math.min(slot.rpe, DELOAD.rpeCap),
    failLast: null,
    myoReps: false,
    isDeload: true,
  };
}
