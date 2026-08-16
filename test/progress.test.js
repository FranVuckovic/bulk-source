import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DRIFT_WARN,
  BLOCK_WEEKS,
  daysBetween,
  sortLogsByDate,
  lastLogged,
  nextSessionId,
  rotationPosition,
  pace,
  drift,
  prescribedSetCount,
  isLoggedSet,
  loggedSetCount,
  isPartialSession,
  blockProgress,
  planProgress,
} from '../js/progress.js';

const PLAN = JSON.parse(
  readFileSync(new URL('../data/plan-bulk-v1.json', import.meta.url), 'utf8')
);
const ROTATION = PLAN.meta.rotation;

const close = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < eps, `expected ${actual} to be within ${eps} of ${expected}`);

const log = (id, dateISO, sessionId, extra = {}) => ({
  id,
  dateISO,
  sessionId,
  blockId: 1,
  ...extra,
});

/* ── dates ───────────────────────────────────────────────────────────── */

test('daysBetween ignores time of day and time zone', () => {
  assert.equal(daysBetween('2026-08-17', '2026-08-24'), 7);
  assert.equal(daysBetween('2026-08-17T22:30:00.000Z', '2026-08-18T01:00:00.000Z'), 1);
  assert.equal(daysBetween('2026-08-17', '2026-08-17'), 0);
  assert.equal(daysBetween('2026-08-24', '2026-08-17'), -7);

  // Across a DST change in Europe/London: still exactly 7 days.
  assert.equal(daysBetween('2026-10-22', '2026-10-29'), 7);
  assert.equal(daysBetween(null, '2026-08-17'), null);
});

/* ── rotation ────────────────────────────────────────────────────────── */

test('the rotation advances one session at a time and wraps', () => {
  assert.deepEqual(ROTATION, ['A', 'B', 'C', 'D', 'E', 'F']);
  assert.equal(nextSessionId(ROTATION, 'A'), 'B');
  assert.equal(nextSessionId(ROTATION, 'E'), 'F');
  assert.equal(nextSessionId(ROTATION, 'F'), 'A', 'wraps back to the top');
});

test('nothing logged yet starts at the top of the rotation', () => {
  assert.equal(nextSessionId(ROTATION, null), 'A');
  assert.equal(nextSessionId(ROTATION, 'Z'), 'A', 'an unknown session id does not break it');

  const position = rotationPosition([], ROTATION);
  assert.deepEqual(position, {
    lastSessionId: null,
    lastDateISO: null,
    nextSessionId: 'A',
    sessionsDone: 0,
  });
});

test('rotation position reads the last session BY DATE, not by entry order', () => {
  // C is entered last but happened first — the next session is still D.
  const logs = [
    log(1, '2026-08-20', 'A'),
    log(2, '2026-08-22', 'B'),
    log(3, '2026-08-24', 'D'),
    log(4, '2026-08-23', 'C'), // back-dated afterwards, in its real place
  ];

  const position = rotationPosition(logs, ROTATION);
  assert.equal(position.lastSessionId, 'D');
  assert.equal(position.lastDateISO, '2026-08-24');
  assert.equal(position.nextSessionId, 'E');
  assert.equal(position.sessionsDone, 4);

  assert.deepEqual(sortLogsByDate(logs).map((l) => l.sessionId), ['A', 'B', 'C', 'D']);
});

test('a back-dated entry before everything else does not become the last session', () => {
  const logs = [log(1, '2026-08-24', 'D'), log(2, '2026-08-01', 'A')];
  assert.equal(rotationPosition(logs, ROTATION).nextSessionId, 'E');
});

test('two sessions on one day are ordered by start time', () => {
  const logs = [
    log(1, '2026-08-24', 'D', { startedAt: '2026-08-24T18:00:00.000Z' }),
    log(2, '2026-08-24', 'C', { startedAt: '2026-08-24T07:00:00.000Z' }),
  ];
  assert.deepEqual(sortLogsByDate(logs).map((l) => l.sessionId), ['C', 'D']);
  assert.equal(rotationPosition(logs, ROTATION).nextSessionId, 'E');
});

test('sortLogsByDate does not mutate the array it is given', () => {
  const logs = [log(1, '2026-08-24', 'D'), log(2, '2026-08-01', 'A')];
  const before = logs.map((l) => l.id);
  sortLogsByDate(logs);
  assert.deepEqual(logs.map((l) => l.id), before);
});

test('a manual override just continues the rotation from what was done', () => {
  // Next was D; F was trained instead because the gym was busy. The rotation
  // picks up from F, no correction and no compensating session.
  const logs = [log(1, '2026-08-20', 'A'), log(2, '2026-08-22', 'B'), log(3, '2026-08-24', 'C'), log(4, '2026-08-26', 'F')];
  assert.equal(rotationPosition(logs, ROTATION).nextSessionId, 'A');
});

test('a partial session still advances the rotation', () => {
  const logs = [log(1, '2026-08-20', 'A'), log(2, '2026-08-22', 'B', { isPartial: true })];
  assert.equal(rotationPosition(logs, ROTATION).nextSessionId, 'C');
  assert.equal(lastLogged(logs).id, 2);
});

/* ── partial sessions ────────────────────────────────────────────────── */

test('prescribedSetCount adds up the plan slots', () => {
  const sessionA = PLAN.sessions.find((s) => s.id === 'A');
  assert.equal(prescribedSetCount(sessionA), 30);
  assert.equal(prescribedSetCount({ slots: [] }), 0);
  assert.equal(prescribedSetCount(null), 0);
});

test('a set counts as logged once it has reps or a load', () => {
  assert.equal(isLoggedSet({ reps: 5, load: 92.5 }), true);
  assert.equal(isLoggedSet({ reps: 5, load: null }), true, 'bodyweight work has no load');
  assert.equal(isLoggedSet({ reps: null, load: 92.5 }), true);
  assert.equal(isLoggedSet({ reps: null, load: null }), false, 'blank is blank, never zero');
  assert.equal(isLoggedSet({ reps: 0, load: 0 }), false);
  assert.equal(isLoggedSet(null), false);

  assert.equal(loggedSetCount([{ reps: 5 }, { reps: null }, { load: 60 }]), 2);
});

test('fewer than half the prescribed sets makes a session partial', () => {
  assert.equal(isPartialSession(14, 30), true);
  assert.equal(isPartialSession(15, 30), false, 'exactly half is not partial');
  assert.equal(isPartialSession(30, 30), false);
  assert.equal(isPartialSession(0, 30), true);
  assert.equal(isPartialSession(0, 0), false, 'nothing prescribed, nothing to be partial about');
});

/* ── pace and drift ──────────────────────────────────────────────────── */

test('pace is sessions per seven days', () => {
  close(pace(6, 7), 6);
  close(pace(19, 32), 19 / (32 / 7));
  close(pace(12, 14), 6);
  assert.equal(pace(6, 0), null);
  assert.equal(pace(6, null), null);
});

test('drift compares block progress against block calendar', () => {
  assert.equal(BLOCK_WEEKS, 6);

  // Half the block's sessions in half the block's weeks: dead on schedule.
  close(drift(18, 36, 21), 0);
  // Ahead: all the sessions in four weeks.
  close(drift(36, 36, 28), 1 - 28 / 7 / 6);
  // Behind: a third of the sessions in half the time.
  close(drift(12, 36, 21), 12 / 36 - 0.5);

  assert.equal(drift(12, 0, 21), null);
});

test('drift past the warning threshold is flagged', () => {
  assert.equal(DRIFT_WARN, -0.12);

  const block = { id: 1, sessionTarget: 36, startedISO: '2026-08-17' };
  const onTrack = blockProgress(
    Array.from({ length: 18 }, (_, i) => log(i, '2026-08-20', 'A')),
    block,
    '2026-09-07' // 21 days
  );
  close(onTrack.drift, 0);
  assert.equal(onTrack.behind, false);

  const behind = blockProgress(
    Array.from({ length: 12 }, (_, i) => log(i, '2026-08-20', 'A')),
    block,
    '2026-09-07'
  );
  close(behind.drift, 12 / 36 - 0.5);
  assert.equal(behind.behind, true);
});

/* ── block position ──────────────────────────────────────────────────── */

test('a block counts sessions, not days', () => {
  const block = { id: 1, sessionTarget: 36, startedISO: '2026-08-17' };
  const logs = [
    ...Array.from({ length: 19 }, (_, i) => log(i, '2026-08-20', 'A', { blockId: 1 })),
    ...Array.from({ length: 4 }, (_, i) => log(100 + i, '2026-07-20', 'A', { blockId: 0 })),
  ];

  const progress = blockProgress(logs, block, '2026-09-18'); // 32 days in
  assert.equal(progress.blockDone, 19, 'the previous block\'s sessions do not count');
  assert.equal(progress.sessionTarget, 36);
  assert.equal(progress.remaining, 17);
  assert.equal(progress.daysElapsed, 32);
  close(progress.pace, 19 / (32 / 7));
  close(progress.drift, 19 / 36 - 32 / 7 / 6);
});

test('reaching the session target opens the review and never advances the block', () => {
  const block = { id: 1, sessionTarget: 36, startedISO: '2026-08-17' };
  const logsAt = (n) => Array.from({ length: n }, (_, i) => log(i, '2026-08-20', 'A'));

  assert.equal(blockProgress(logsAt(35), block, '2026-09-28').readyForReview, false);

  const ready = blockProgress(logsAt(36), block, '2026-09-28');
  assert.equal(ready.readyForReview, true);
  assert.equal(ready.remaining, 0);
  assert.equal(ready.blockId, 1, 'still block 1 — nothing advances by itself');

  // Training past the target keeps the review open rather than rolling over.
  const past = blockProgress(logsAt(40), block, '2026-10-05');
  assert.equal(past.readyForReview, true);
  assert.equal(past.blockId, 1);
  assert.equal(past.remaining, 0);
});

test('block progress counts partial sessions separately', () => {
  const block = { id: 1, sessionTarget: 36, startedISO: '2026-08-17' };
  const logs = [
    log(1, '2026-08-18', 'A'),
    log(2, '2026-08-19', 'B', { isPartial: true }),
    log(3, '2026-08-21', 'C'),
  ];

  const progress = blockProgress(logs, block, '2026-08-24');
  assert.equal(progress.blockDone, 3, 'a partial session still happened');
  assert.equal(progress.partialCount, 1);
});

test('block progress works before a start date exists', () => {
  const progress = blockProgress([log(1, '2026-08-18', 'A')], { id: 1, sessionTarget: 36 }, null);
  assert.equal(progress.blockDone, 1);
  assert.equal(progress.daysElapsed, null);
  assert.equal(progress.drift, null);
  assert.equal(progress.behind, false);
});

/* ── plan position ───────────────────────────────────────────────────── */

test('plan progress reports the calendar week without scheduling anything by it', () => {
  const logs = Array.from({ length: 19 }, (_, i) => log(i, '2026-08-20', 'A'));
  const progress = planProgress(logs, '2026-08-17', '2026-09-18');

  assert.equal(progress.sessionsDone, 19);
  assert.equal(progress.daysElapsed, 32);
  assert.equal(progress.calendarWeek, 5);
  close(progress.pace, 19 / (32 / 7));

  assert.equal(planProgress([], '2026-08-17', '2026-08-17').calendarWeek, 1, 'day one is week one');
});
