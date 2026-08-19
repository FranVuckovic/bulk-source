/**
 * Session timing, from the timestamps that were always there.
 *
 * Every set has stored `timestampISO` since the first version and nothing read
 * it. Deriving rest and duration from it is free — but only when the ticks
 * happened when the work did, which is the whole difficulty. A session typed up
 * afterwards has ticks seconds apart, and eight seconds of "rest" between
 * working sets is not a small error, it is a number that looks like a
 * measurement and is not one.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionTiming, MIN_REAL_REST_SECONDS, LONG_GAP_SECONDS } from '../js/analytics.js';

const BASE = Date.parse('2026-08-19T17:00:00.000Z');
const at = (seconds) => new Date(BASE + seconds * 1000).toISOString();
const setAt = (seconds, i = 0) => ({
  id: i, timestampISO: at(seconds), exerciseId: 'benchComp', slotIndex: 0, setIndex: i,
});

test('rest, total and typical are derived from when each set was ticked', () => {
  const sets = [120, 300, 480, 660].map((s, i) => setAt(s, i));
  const t = sessionTiming({ id: 1, startedAt: at(0), endedAt: at(900) }, sets);

  assert.equal(t.reliable, true);
  assert.equal(t.totalSeconds, 900, 'start to finish, not first set to last');
  assert.equal(t.setCount, 4);
  assert.equal(t.medianRestSeconds, 180);
  assert.equal(t.entries[0].gapSeconds, 120, 'the first gap is warm-up from the session start');
  assert.equal(t.entries[0].isFirst, true, 'and is not counted as rest');
  assert.equal(t.countedRests, 3);
});

test('a session filled in all at once reports no rest rather than seconds of it', () => {
  // The case that makes this feature dangerous rather than merely useless: four
  // rows typed on the bus home are four timestamps two seconds apart.
  const sets = [0, 2, 4, 6, 8].map((s, i) => setAt(s, i));
  const t = sessionTiming({ id: 2, startedAt: at(0), endedAt: at(10) }, sets);

  assert.equal(t.looksBulkEntered, true);
  assert.equal(t.reliable, false, 'worked out from the gaps, with nobody having said so');
  assert.equal(t.medianRestSeconds, null, 'and no figure is offered at all');
});

test('saying the timing is not real is believed even when the gaps look fine', () => {
  const sets = [120, 300, 480].map((s, i) => setAt(s, i));
  const t = sessionTiming({ id: 3, startedAt: at(0), endedAt: at(600), timingReliable: false }, sets);

  assert.equal(t.statedUnreliable, true);
  assert.equal(t.reliable, false);
  assert.equal(t.medianRestSeconds, null);
  assert.equal(t.setCount, 3, 'the timeline is still there — only the conclusions are withheld');
});

test('a twenty-minute gap is shown but kept out of the rest figures', () => {
  // A queue for the rack, or a phone call. Real, and not a rest interval — one
  // of them would otherwise drag the typical rest into nonsense.
  const sets = [120, 300, 300 + LONG_GAP_SECONDS + 60, 300 + LONG_GAP_SECONDS + 240].map((s, i) => setAt(s, i));
  const t = sessionTiming({ id: 4, startedAt: at(0), endedAt: at(3000) }, sets);

  assert.equal(t.longGaps, 1);
  assert.equal(t.medianRestSeconds, 180, 'the long gap does not move the typical figure');
  assert.ok(t.entries.some((e) => e.isLongGap), 'but it is still in the timeline');
});

test('re-ticking a set counts the later tick, because that is the row that exists', () => {
  // Un-ticking deletes the row; ticking again writes a new one with a new
  // timestamp. Timing therefore follows the last tick with nothing extra to do.
  const first = setAt(120, 0);
  const retick = { ...first, timestampISO: at(400) };
  const t = sessionTiming({ id: 5, startedAt: at(0), endedAt: at(600) }, [retick, setAt(580, 1)]);

  assert.equal(t.entries[0].atISO, at(400));
  assert.equal(t.entries[0].gapSeconds, 400);
});

test('a session with no timestamps at all reports nothing rather than zero', () => {
  const t = sessionTiming({ id: 6, startedAt: null, endedAt: null }, []);
  assert.equal(t.setCount, 0);
  assert.equal(t.totalSeconds, null);
  assert.equal(t.medianRestSeconds, null);
});

test('the thresholds are stated rather than buried', () => {
  assert.equal(MIN_REAL_REST_SECONDS, 20);
  assert.equal(LONG_GAP_SECONDS, 1200);
});

/* ═══════════════════════════════════════════════════════════════════════
   Set difficulty, and why an estimate is sometimes withheld
   ═══════════════════════════════════════════════════════════════════════ */

import { setDifficulty, noEstimateReason, e1rm as estimate1RM, systemLoad, MAX_ESTIMABLE_REPS } from '../js/calc.js';

test('difficulty is the same estimate taken at RPE 10, so it ignores how it felt', () => {
  // The size of what you did, rather than an estimate of what you could do.
  // Two sets of the same load and reps are the same amount of work whatever
  // RPE was written against them.
  assert.equal(setDifficulty(97.5, 3), estimate1RM(97.5, 3, 10));
  assert.equal(setDifficulty(97.5, 3), setDifficulty(97.5, 3));
});

test('difficulty rises with load and with reps', () => {
  assert.ok(setDifficulty(110, 5) > setDifficulty(100, 5), 'more load is harder');
  assert.ok(setDifficulty(100, 8) > setDifficulty(100, 5), 'more reps is harder');
});

test('difficulty is below the estimate for any set short of failure', () => {
  // A set at RPE 7 says you had three left, so what you did is smaller than
  // what you could have done. If this ever inverted, difficulty would be being
  // read as a max.
  assert.ok(setDifficulty(100, 5) < estimate1RM(100, 5, 7));
  assert.equal(setDifficulty(100, 5), estimate1RM(100, 5, 10), 'and equal at failure');
});

test('a 15-rep set says it is over the rep limit, not nothing at all', () => {
  // From a real log: four pull-up sets, two of them 15 reps, both blank. The
  // obvious explanation — zero added weight — was wrong, and the app said
  // nothing either way. Fifteen of twenty-seven sets in that session were
  // affected.
  const total = systemLoad(0, 90);
  assert.equal(estimate1RM(total, 15, 10), null);
  assert.match(noEstimateReason(total, 15, 10), /over 12 reps/);
});

test('zero added weight on a bodyweight lift is not the reason for a blank', () => {
  // The control that settles it: same zero, one rep fewer than the limit.
  const total = systemLoad(0, 90);
  assert.ok(estimate1RM(total, MAX_ESTIMABLE_REPS, 10) > 0, 'zero added, twelve reps, real estimate');
  assert.equal(noEstimateReason(total, MAX_ESTIMABLE_REPS, 10), null, 'and nothing to explain');
});

test('a set that can be estimated has no reason to give', () => {
  assert.equal(noEstimateReason(110, 6, 10), null);
});
