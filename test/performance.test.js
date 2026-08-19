/**
 * The size the app has to survive: 200 sessions and 6,000 sets.
 *
 * That is a full 33-rotation cycle and then some. These are not micro
 * benchmarks — they exist to catch the shape of the algorithm, not its
 * constant factor. A quadratic path shows up here as a wall, not as a slightly
 * slower number, which is why the budgets are loose enough to pass on a phone
 * and still fail on an accidental nested scan.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  strengthSeries,
  blockComparison,
  records,
  bestPerCycle,
  trend,
  rollingMean,
} from '../js/analytics.js';
import { rollUpFromSets, plannedVsCompleted } from '../js/volume.js';
import { resolveSession, toDisplaySession } from '../js/plan.js';

const PLAN = JSON.parse(readFileSync(new URL('../data/plan-fopip-v2.json', import.meta.url), 'utf8'));

const SESSIONS = 200;
const SETS = 6000;

/** One realistically shaped database: 200 sessions, 6,000 sets, 33 rotations. */
function buildCorpus() {
  const order = PLAN.meta.rotationOrder;
  const logs = [];
  const sets = [];
  const exerciseIds = Object.keys(PLAN.exercises);

  for (let i = 0; i < SESSIONS; i++) {
    const rotation = Math.min(PLAN.meta.rotations, Math.floor(i / 6) + 1);
    const block = PLAN.blocks.find((b) => rotation >= b.from && rotation <= b.to);
    const day = new Date(Date.UTC(2025, 0, 1) + i * 1.4 * 86400000).toISOString().slice(0, 10);
    logs.push({
      id: i + 1,
      dateISO: day,
      localDate: day,
      sessionId: order[i % order.length],
      cycleId: `cycle-${rotation}`,
      cycleSequence: rotation,
      blockId: block ? block.id : 0,
      status: 'complete',
      endedAt: `${day}T18:30:00.000Z`,
    });
  }

  for (let i = 0; i < SETS; i++) {
    const log = logs[i % SESSIONS];
    const exerciseId = i % 5 === 0 ? 'benchComp' : exerciseIds[i % exerciseIds.length];
    sets.push({
      id: i + 1,
      sessionLogId: log.id,
      exerciseId,
      slotIndex: i % 20,
      setIndex: i % 4,
      load: 60 + (i % 40),
      reps: 1 + (i % 10),
      rpe: 8,
      isIndexSet: i % 7 === 0,
      isMyoRep: false,
      bodyweightUsed: PLAN.exercises[exerciseId]?.bodyweightLoaded ? 90 : null,
    });
  }

  return { logs, sets };
}

const { logs, sets } = buildCorpus();
const exercises = PLAN.exercises;
const lifts = Object.entries(exercises)
  .filter(([, x]) => x.tracksMax && x.maxConf === 'high')
  .map(([id, x]) => ({ id, name: x.name }));

const timed = (label, budgetMs, body) => {
  const started = performance.now();
  const result = body();
  const took = performance.now() - started;
  assert.ok(took < budgetMs, `${label} took ${took.toFixed(0)} ms, budget ${budgetMs} ms`);
  return result;
};

test('the corpus is the size it claims to be', () => {
  assert.equal(logs.length, SESSIONS);
  assert.equal(sets.length, SETS);
});

test('a strength series over 6,000 sets stays well inside a frame budget', () => {
  const series = timed('strengthSeries', 250, () =>
    strengthSeries(sets, { exercises, logs, exerciseId: 'benchComp' })
  );
  assert.ok(series.points.length > 50, 'it actually found sets to work with');
});

test('block comparison across every tracked lift is linear, not quadratic', () => {
  // This is the one that was quadratic: a `logs.find` inside a `sets.find`
  // inside a loop over every point of every lift. At this size that was tens of
  // millions of comparisons.
  const rows = timed('blockComparison', 1500, () => blockComparison(sets, { exercises, logs, lifts }));
  assert.ok(rows.length > 0);
});

test('records, roll-ups and trends all complete inside their budgets', () => {
  timed('records', 400, () => records(sets, { exercises, logs }));
  timed('rollUpFromSets', 250, () => rollUpFromSets(sets, exercises, PLAN.muscles));

  const points = strengthSeries(sets, { exercises, logs, exerciseId: 'benchComp' }).points;
  timed('bestPerCycle + trend', 100, () => trend(bestPerCycle(points)));
  timed('rollingMean over 6,000', 400, () =>
    rollingMean(sets.map((s, i) => ({ dateISO: logs[i % SESSIONS].dateISO, value: s.load })), 7)
  );
});

test('planned against completed for one rotation is instant', () => {
  const plannedSessions = PLAN.meta.rotationOrder.map((sessionId) =>
    toDisplaySession(resolveSession(PLAN, { rotation: 12, sessionId }))
  );
  const cycleSets = sets.filter((s) => s.sessionLogId % 6 === 0);
  timed('plannedVsCompleted', 200, () =>
    plannedVsCompleted({ plannedSessions, loggedSets: cycleSets, exercises, muscles: PLAN.muscles })
  );
});

test('resolving all 33 rotations of all six sessions stays under a second', () => {
  timed('resolve 198 sessions', 1000, () => {
    // 198 sessions of nine to twelve exercise slots each. Counting them is how
    // the test knows the resolver did the work rather than short-circuiting.
    let slots = 0;
    for (let rotation = 1; rotation <= PLAN.meta.rotations; rotation++) {
      for (const sessionId of PLAN.meta.rotationOrder) {
        const resolved = resolveSession(PLAN, { rotation, sessionId });
        assert.equal(resolved.ok, true, `rotation ${rotation} session ${sessionId} did not resolve`);
        slots += resolved.slots.length;
      }
    }
    assert.ok(slots > 1500, `every rotation really resolved, got ${slots} slots`);
    return slots;
  });
});
