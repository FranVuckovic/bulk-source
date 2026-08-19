/**
 * Readiness, mid-session.
 *
 * Readiness reshapes an already-resolved session: yellow removes the last work
 * set from multi-set work, red removes the static hold outright. Logged sets
 * are keyed by their position in that session — `slotIndex:setIndex` — so
 * reshaping it after work has been logged is a data-attribution problem
 * wearing the clothes of a display problem.
 *
 * Four defects, all reachable from the Train screen, all found by flagging a
 * day part-way through it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { resolveSession } from '../js/plan.js';
import { slotsFor, readinessWouldReindex } from '../js/ui/train.js';

const PLAN = JSON.parse(readFileSync(new URL('../data/plan-fopip-v2.json', import.meta.url), 'utf8'));

function stateAt(sequence, sessionId, { readiness = 'normal', logged = [] } = {}) {
  return {
    plan: PLAN,
    cycle: { sequence },
    trainSessionId: sessionId,
    readiness,
    settings: { unit: 'kg', increment: 2.5, bodyweight: 90, barKg: 20 },
    maxes: new Map(),
    deviations: { swaps: {}, extras: [], addedSets: {} },
    loggedSets: new Map(logged.map((key) => [key, { id: key }])),
  };
}

test('a set already logged is still shown after switching to yellow', () => {
  // Session A of rotation 1: slot 1 is 4x4 competition bench, so yellow trims
  // it to three. With four already logged, the fourth used to have nowhere to
  // render: still in the database, still in every export, invisible on the
  // screen that logged it, and impossible to un-tick.
  const normal = slotsFor(stateAt(1, 'A'));
  const multi = normal.findIndex((slot) => slot.sets > 2 && !slot.idx);
  assert.ok(multi > -1, 'expected a multi-set slot to exist');

  const prescribed = normal[multi].sets;
  const logged = Array.from({ length: prescribed }, (_, i) => `${multi}:${i}`);
  const yellow = slotsFor(stateAt(1, 'A', { readiness: 'yellow', logged }));

  assert.equal(
    yellow[multi].sets,
    prescribed,
    'yellow must not hide a set that has already been logged against this slot'
  );
  assert.ok(yellow[multi].beyondPlan, 'the kept row is marked as beyond what the plan now asks for');
  assert.ok(yellow[multi].prescribedSets < yellow[multi].sets, 'and still reports what the plan asks for');
});

test('yellow still trims the last set when nothing has been logged yet', () => {
  const normal = slotsFor(stateAt(1, 'A'));
  const yellow = slotsFor(stateAt(1, 'A', { readiness: 'yellow' }));
  const multi = normal.findIndex((slot) => slot.sets > 2 && !slot.idx);

  assert.equal(yellow[multi].sets, normal[multi].sets - 1, 'the readiness rule itself is unchanged');
  assert.equal(yellow[multi].beyondPlan, false);
});

test('a red day is refused once sets are logged in a session whose slots it would reindex', () => {
  // Rotation 11 session A carries the static hold at index 0. Red removes
  // holds, so every slot after it shifts up by one: bench sets logged at slot 1
  // would render — and, on edit, be rewritten — as the static hold, the incline
  // as the bench, and so on down the session. The owner is past rotation 11.
  const hold = resolveSession(PLAN, { rotation: 11, sessionId: 'A' }).slots.findIndex((s) => s.role === 'hold');
  assert.equal(hold, 0, 'this test is about the hold sitting first; the plan moved it');

  assert.equal(
    readinessWouldReindex(stateAt(11, 'A'), 'red'),
    true,
    'red on rotation 11 session A reindexes every slot and must be refused'
  );
});

test('a readiness change that only shrinks a slot is allowed', () => {
  // Yellow keeps every exercise in place; it only asks for fewer sets. That is
  // survivable now that a logged set is never hidden, so it must not be caught
  // by the same guard that stops a red day.
  assert.equal(readinessWouldReindex(stateAt(11, 'A'), 'yellow'), false);
  assert.equal(readinessWouldReindex(stateAt(1, 'A'), 'yellow'), false);
  assert.equal(readinessWouldReindex(stateAt(1, 'A'), 'red'), false, 'no hold in rotation 1, so nothing reindexes');
});
