/**
 * The rest timer, and why it must never count ticks.
 *
 * The first implementation did `restLeft -= 1` inside a one-second setInterval.
 * That is correct only while the page is in the foreground on an unthrottled
 * tab. Background a phone browser and setInterval is throttled to roughly once
 * a minute, or suspended entirely — so a three-minute rest with two minutes
 * spent in another app came back reading barely a minute gone, which is exactly
 * what was reported from the gym.
 *
 * The clock was not running slow. It was measuring how often the browser felt
 * like calling us, which is not a unit of time.
 *
 * Every test here works by moving `now` forward without delivering a single
 * tick, because that is the failure. If these pass, throttling cannot affect
 * the reading — only how often it is redrawn.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { timerReading } from '../js/ui/components.js';

const T0 = 1_700_000_000_000;

test('a rest countdown is right after two minutes with no ticks at all', () => {
  const rest = { mode: 'rest', running: true, endsAtMs: T0 + 180_000 };

  assert.equal(timerReading(rest, T0).seconds, 180);
  assert.equal(timerReading(rest, T0 + 120_000).seconds, 60, 'two minutes away, two minutes gone');
  assert.equal(timerReading(rest, T0 + 179_000).seconds, 1);
});

test('a rest that ended while the phone was away reports done, not negative', () => {
  const rest = { mode: 'rest', running: true, endsAtMs: T0 + 180_000 };
  const reading = timerReading(rest, T0 + 600_000);

  assert.equal(reading.seconds, 0, 'never counts past zero into negative time');
  assert.equal(reading.done, true, 'and says it finished, so the bar can close itself');
});

test('a stopwatch is right after five minutes with no ticks at all', () => {
  const watch = { mode: 'stopwatch', running: true, startedAtMs: T0, accumulatedMs: 0 };

  assert.equal(timerReading(watch, T0 + 300_000).seconds, 300);
  assert.equal(timerReading(watch, T0 + 3_600_000).seconds, 3600, 'an hour is an hour');
});

test('a paused stopwatch holds its reading however long it is left', () => {
  // Pausing banks the run into accumulatedMs and drops the start instant, so
  // there is nothing left for the passage of time to act on.
  const paused = { mode: 'stopwatch', running: false, startedAtMs: null, accumulatedMs: 45_000 };

  assert.equal(timerReading(paused, T0).seconds, 45);
  assert.equal(timerReading(paused, T0 + 86_400_000).seconds, 45, 'a day later, still 45');
});

test('a resumed stopwatch adds to what it had rather than starting over', () => {
  const resumed = { mode: 'stopwatch', running: true, startedAtMs: T0, accumulatedMs: 45_000 };

  assert.equal(timerReading(resumed, T0 + 15_000).seconds, 60, '45 banked plus 15 more');
});

test('a rest with no end instant reads zero rather than NaN', () => {
  // Defensive: a reading taken before the timer was ever started must not put
  // NaN on the screen, which is the one thing every screen in this app is
  // tested against.
  const reading = timerReading({ mode: 'rest', running: false, endsAtMs: null }, T0);
  assert.equal(reading.seconds, 0);
  assert.ok(Number.isFinite(reading.seconds));
});
