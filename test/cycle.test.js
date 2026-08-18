import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  newCycle,
  cycleProgress,
  nextSession,
  blockBoundary,
  completionRatio,
  sessionStatusFor,
  planCorrection,
  projectedFinish,
  COMPLETE_SESSION_RATIO,
} from '../js/cycle.js';

const PLAN = JSON.parse(readFileSync(new URL('../data/plan-fopip-v2.json', import.meta.url), 'utf8'));

const cycle = (sequence = 1) =>
  newCycle(PLAN, { sequence, startedAtISO: '2026-08-17T17:00:00.000Z', localStartDate: '2026-08-17' });

/** A session log belonging to a given cycle. */
const logFor = (c, position, status, extra = {}) => ({
  id: `${c.sequence}-${position}-${status}`,
  cycleId: c.id,
  rotationPosition: position,
  status,
  ...extra,
});

test('a cycle knows its block, type and effort mode from the plan', () => {
  assert.equal(cycle(1).blockId, 0);
  assert.equal(cycle(1).type, 'baseline');
  assert.equal(cycle(1).effortMode, 'baseline');

  assert.equal(cycle(3).effortMode, 'high', 'accumulation opens on a high-failure wave');
  assert.equal(cycle(15).type, 'recovery');
  assert.equal(cycle(32).type, 'test');
});

test('a rotation is complete only when every position has been trained', () => {
  const c = cycle(3);
  const log = (position, status, extra) => logFor(c, position, status, extra);

  const empty = cycleProgress(PLAN, c, []);
  assert.equal(empty.complete, 0);
  assert.equal(empty.nextPosition, 'A');
  assert.equal(empty.finished, false);

  const halfway = cycleProgress(PLAN, c, [log('A', 'complete'), log('B', 'complete'), log('C', 'complete')]);
  assert.equal(halfway.complete, 3);
  assert.equal(halfway.nextPosition, 'D', 'the next untrained position, in plan order');
  assert.equal(halfway.finished, false);

  const all = PLAN.meta.rotationOrder.map((p) => log(p, 'complete'));
  const done = cycleProgress(PLAN, c, all);
  assert.equal(done.finished, true);
  assert.equal(done.status, 'complete');
  assert.equal(done.nextPosition, null);
});

test('logging only the first and last session leaves the rotation unfinished', () => {
  // The case that started this: log A, then F. v1 simply moved on and could
  // never say the rotation was incomplete.
  const c = cycle(3);
  const progress = cycleProgress(PLAN, c, [logFor(c, 'A', 'complete'), logFor(c, 'F', 'complete')]);

  assert.equal(progress.complete, 2);
  assert.equal(progress.pending, 4);
  assert.equal(progress.finished, false);
  assert.equal(progress.nextPosition, 'B', 'the rotation still owes B, C, D and E');
  assert.deepEqual(
    progress.positions.filter((p) => p.status === 'pending').map((p) => p.position),
    ['B', 'C', 'D', 'E']
  );
});

test('a skipped position finishes the cycle but marks it partial', () => {
  const c = cycle(3);
  const sessions = [
    logFor(c, 'A', 'complete'), logFor(c, 'B', 'complete'), logFor(c, 'C', 'skipped'),
    logFor(c, 'D', 'complete'), logFor(c, 'E', 'complete'), logFor(c, 'F', 'complete'),
  ];
  const progress = cycleProgress(PLAN, c, sessions);

  assert.equal(progress.finished, true);
  assert.equal(progress.status, 'partial', 'finished is not the same as complete');
  assert.equal(progress.skipped, 1);
});

test('the cycle dose counts training done, not sessions opened', () => {
  // Twelve one-set sessions used to finish a block in v1.
  const c = cycle(3);
  const token = PLAN.meta.rotationOrder.map((p) => logFor(c, p, 'partial', { completionRatio: 0.1 }));
  const progress = cycleProgress(PLAN, c, token);

  assert.equal(progress.finished, true);
  assert.equal(progress.status, 'partial');
  assert.ok(progress.dose < 1, `dose ${progress.dose} — six token sessions are not a rotation`);

  const real = PLAN.meta.rotationOrder.map((p) => logFor(c, p, 'complete', { completionRatio: 1 }));
  assert.equal(cycleProgress(PLAN, c, real).dose, 6);
});

test('deleted sessions do not count towards a cycle', () => {
  const c = cycle(3);
  const sessions = [logFor(c, 'A', 'complete'), logFor(c, 'B', 'complete', { deletedAtISO: '2026-08-20T10:00:00.000Z' })];
  const progress = cycleProgress(PLAN, c, sessions);

  assert.equal(progress.complete, 1);
  assert.equal(progress.nextPosition, 'B', 'the deleted session is owed again');
});

test('finishing a rotation offers the next one, never silently', () => {
  const c3 = cycle(3);
  const all = PLAN.meta.rotationOrder.map((p) => logFor(c3, p, 'complete'));

  const mid = nextSession(PLAN, c3, all);
  assert.equal(mid.startsNewCycle, true);
  assert.equal(mid.cycleSequence, 4);
  assert.equal(mid.position, 'A');

  const partial = nextSession(PLAN, c3, [logFor(c3, 'A', 'complete')]);
  assert.equal(partial.startsNewCycle, false);
  assert.equal(partial.position, 'B');

  const c33 = cycle(33);
  const last = nextSession(PLAN, c33, PLAN.meta.rotationOrder.map((p) => logFor(c33, p, 'complete')));
  assert.equal(last.finishedPlan, true);
  assert.equal(last.cycleSequence, null);
});

test('block boundaries are reported, not acted on', () => {
  assert.equal(blockBoundary(PLAN, cycle(3)).atBoundary, false, 'mid-block');

  const boundary = blockBoundary(PLAN, cycle(10));
  assert.equal(boundary.atBoundary, true, 'rotation 10 ends accumulation I');
  assert.equal(boundary.fromBlock, 1);
  assert.equal(boundary.toBlock, 2);

  assert.equal(blockBoundary(PLAN, cycle(14)).toBlock, 3, 'into the recovery rotation');
  assert.equal(blockBoundary(PLAN, cycle(33)).isFinalCycle, true);
});

test('completion ratio decides complete versus partial', () => {
  assert.equal(completionRatio(26, 26), 1);
  assert.equal(completionRatio(13, 26), 0.5);
  assert.equal(completionRatio(3, 26), 0.12);
  assert.equal(completionRatio(5, 0), null);

  assert.equal(sessionStatusFor(1), 'complete');
  assert.equal(sessionStatusFor(COMPLETE_SESSION_RATIO), 'complete', 'exactly half still counts');
  assert.equal(sessionStatusFor(0.49), 'partial');
  assert.equal(sessionStatusFor(null), 'partial');
});

test('a manual correction has to say what and why', () => {
  const ok = planCorrection({ field: 'cycleSequence', from: 4, to: 3, reason: 'imported twice', atISO: '2026-08-20T10:00:00.000Z' });
  assert.equal(ok.ok, true);
  assert.equal(ok.entry.action, 'correct');
  assert.equal(ok.entry.from, 4);
  assert.equal(ok.entry.reason, 'imported twice');

  assert.equal(planCorrection({ field: 'cycleSequence', from: 3, to: 3, reason: 'x' }).ok, false);
  assert.equal(planCorrection({ field: 'cycleSequence', from: 3, to: 4 }).ok, false, 'a reason is required');
  assert.equal(planCorrection({ field: 'nonsense', from: 1, to: 2, reason: 'x' }).ok, false);
});

test('the finish estimate uses the pace actually achieved', () => {
  // Six sessions a week finishes 33 rotations in about 33 weeks; five takes
  // nearly 40, and no amount of cramming changes that.
  const sixPerWeek = projectedFinish(PLAN, { cyclesDone: 4, daysElapsed: 28 });
  assert.equal(sixPerWeek.daysPerCycle, 7);
  assert.equal(sixPerWeek.weeksTotal, 33);

  const fivePerWeek = projectedFinish(PLAN, { cyclesDone: 4, daysElapsed: 33.6 });
  assert.ok(fivePerWeek.weeksTotal > 39 && fivePerWeek.weeksTotal < 40, `${fivePerWeek.weeksTotal} weeks`);
  assert.equal(fivePerWeek.remainingCycles, 29);

  assert.equal(projectedFinish(PLAN, { cyclesDone: 0, daysElapsed: 10 }), null);
});
