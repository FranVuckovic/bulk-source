/**
 * Finishing a rotation, and what the app does next.
 *
 * The defect this file was written for, in the owner's words: "I did workout A
 * of the second rotation today and after it I got a notification saying
 * something like starting next rotation and then it selected workout A as the
 * next workout although I already finished it."
 *
 * What actually happened. Advancing the rotation is a deliberate action —
 * nothing in this app moves the plan on its own, by design. But when a rotation
 * finished, the Train screen quietly preselected the *next* rotation's first
 * session while the app was still on the old one. Train it and the session is
 * filed against the rotation that was already complete, position A gets a
 * second log, the rotation is still finished, and the app says "that completes
 * rotation N — start rotation N+1" all over again.
 *
 * So the session was misfiled and the loop repeated every time.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { cycleProgress, nextSession, newCycle } from '../js/cycle.js';

const PLAN = JSON.parse(readFileSync(new URL('../data/plan-fopip-v2.json', import.meta.url), 'utf8'));
const cycleOne = () => newCycle(PLAN, { sequence: 1, startedAtISO: null, localStartDate: null });
const complete = (cycle, position, id) => ({
  id, cycleId: cycle.id, rotationPosition: position, status: 'complete', completionRatio: 1, endedAt: 'x',
});

test('a finished rotation reports itself finished and points at the next one', () => {
  const cycle = cycleOne();
  const logs = PLAN.meta.rotationOrder.map((p, i) => complete(cycle, p, i + 1));

  const progress = cycleProgress(PLAN, cycle, logs);
  const next = nextSession(PLAN, cycle, logs);

  assert.equal(progress.finished, true);
  assert.equal(progress.pending, 0);
  assert.equal(next.position, 'A', 'the next rotation starts at A');
  assert.equal(next.startsNewCycle, true, 'and it is a new rotation, not this one');
});

test('the reproduction: training A again without advancing files it to the old rotation', () => {
  const cycle = cycleOne();
  const logs = PLAN.meta.rotationOrder.map((p, i) => complete(cycle, p, i + 1));

  // "Not yet" on the advance prompt. The rotation pointer never moved, so the
  // next session logged still carries this cycle's id.
  logs.push(complete(cycle, 'A', 7));

  const progress = cycleProgress(PLAN, cycle, logs);
  const next = nextSession(PLAN, cycle, logs);

  assert.deepEqual(progress.positions[0].logs, [1, 7], 'A now holds two sessions in one rotation');
  assert.equal(progress.finished, true, 'and the rotation is still finished');
  assert.equal(next.position, 'A', 'so it offers A again — the loop the owner hit');
  assert.equal(next.startsNewCycle, true);
});

test('a position already trained this rotation is detectable before it is trained again', () => {
  // The guard the fix needs: the Train screen must be able to ask "is this
  // position already done in the rotation I am actually on".
  const cycle = cycleOne();
  const logs = PLAN.meta.rotationOrder.map((p, i) => complete(cycle, p, i + 1));
  const progress = cycleProgress(PLAN, cycle, logs);

  const statusOf = (position) => progress.positions.find((p) => p.position === position)?.status;
  assert.equal(statusOf('A'), 'complete');
  assert.equal(statusOf('F'), 'complete');

  const half = cycleProgress(PLAN, cycle, logs.slice(0, 2));
  assert.equal(half.positions.find((p) => p.position === 'A').status, 'complete');
  assert.equal(half.positions.find((p) => p.position === 'C').status, 'pending');
  assert.equal(half.finished, false);
});

test('advancing the rotation clears the finished state', () => {
  const cycle = cycleOne();
  const logs = PLAN.meta.rotationOrder.map((p, i) => complete(cycle, p, i + 1));

  // A real advance opens a new cycle with a new id, so none of the old logs
  // count towards it and every position is pending again.
  const second = newCycle(PLAN, { sequence: 2, startedAtISO: 'x', localStartDate: '2026-08-25' });
  assert.notEqual(second.id, cycle.id);

  const progress = cycleProgress(PLAN, second, logs);
  assert.equal(progress.finished, false);
  assert.equal(progress.pending, 6);
  assert.equal(progress.nextPosition, 'A');
  assert.equal(nextSession(PLAN, second, logs).startsNewCycle, false, 'A now belongs to rotation 2');
});
