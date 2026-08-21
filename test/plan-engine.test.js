import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  blockFor,
  effortModeFor,
  staticHoldFor,
  resolveSession,
  applyReadiness,
  validatePlan,
  setCount,
} from '../js/plan.js';

const PLAN = JSON.parse(readFileSync(new URL('../data/plan-fopip-v2.json', import.meta.url), 'utf8'));
const rotationSets = (rotation) =>
  PLAN.meta.rotationOrder.reduce((total, sessionId) => total + setCount(resolveSession(PLAN, { rotation, sessionId })), 0);

test('every rotation and session resolves without prose fallbacks', () => {
  const report = validatePlan(PLAN);
  assert.equal(report.ok, true, report.problems.join('\n'));
});

test('the plan covers exactly 33 rotations with no gaps or overlaps', () => {
  for (let rotation = 1; rotation <= 33; rotation++) {
    assert.ok(blockFor(PLAN, rotation), `rotation ${rotation} has no block`);
  }
  assert.equal(blockFor(PLAN, 34), null, 'nothing beyond the plan');

  const covered = PLAN.blocks.flatMap((b) => Array.from({ length: b.to - b.from + 1 }, (_, i) => b.from + i));
  assert.equal(covered.length, 33, 'no rotation is claimed by two blocks');
});

/* ── the defect that mattered most: the plan must actually change ────── */

test('reduced-fatigue rotations genuinely taper', () => {
  // v1's Peak resolved to 188 sets with unchanged failure work while telling
  // the user it was a taper. This is the regression test for that.
  const normal = rotationSets(3);

  assert.ok(rotationSets(15) < normal * 0.7, `recovery ${rotationSets(15)} vs normal ${normal}`);
  assert.ok(rotationSets(31) < normal * 0.7, 'fatigue reduction');
  assert.ok(rotationSets(32) < normal * 0.65, 'test rotation');
  assert.ok(rotationSets(28) < normal, 'specificity is trimmed');
  assert.equal(rotationSets(3), rotationSets(16), 'both accumulation blocks are full volume');
});

test('no failure work survives a recovery, taper or test rotation', () => {
  for (const rotation of [15, 31, 32]) {
    for (const sessionId of PLAN.meta.rotationOrder) {
      const resolved = resolveSession(PLAN, { rotation, sessionId });
      for (const slot of resolved.slots) {
        assert.equal(slot.failSets, 0, `rotation ${rotation} ${sessionId} ${slot.ex}`);
        assert.equal(slot.myoOption, false, `rotation ${rotation} ${sessionId} ${slot.ex} myo-reps`);
      }
    }
  }
});

test('the accessory multiplier is actually delivered, not rounded away', () => {
  const normal = rotationSets(3);
  // Slot-by-slot rounding gave a 4% cut where 15% was intended; the session
  // total now lands within a few points of the block's stated multiplier.
  const specificity = rotationSets(28) / normal;
  assert.ok(specificity > 0.8 && specificity < 0.92, `specificity resolved to ${(specificity * 100).toFixed(0)}%`);

  const recovery = rotationSets(15) / normal;
  assert.ok(recovery > 0.53 && recovery < 0.67, `recovery resolved to ${(recovery * 100).toFixed(0)}%`);
});

test('a scaled slot says what it was scaled from', () => {
  const scaled = resolveSession(PLAN, { rotation: 15, sessionId: 'B' }).slots.filter((s) => s.scaledFrom);
  assert.ok(scaled.length, 'recovery scales something');
  for (const slot of scaled) {
    assert.ok(slot.sets >= 1, 'nothing is silently removed');
    assert.ok(slot.sets < slot.scaledFrom);
    assert.match(slot.scaleReason, /volume this block/);
  }
});

/* ── block-specific bench prescriptions ─────────────────────────────── */

test('bench work changes block by block', () => {
  const single = (rotation) => resolveSession(PLAN, { rotation, sessionId: 'A' }).slots.find((s) => s.role === 'top_single' || s.role === 'test');
  const backoff = (rotation) => resolveSession(PLAN, { rotation, sessionId: 'A' }).slots.find((s) => s.role === 'backoff');

  assert.equal(single(1).isTest, true, 'rotation 1 tests');
  assert.equal(backoff(1).rpe, 7, 'then autoregulated triples at RPE 7');

  assert.equal(single(3).rpe, 8);
  assert.equal(backoff(3).sets, 3);
  assert.equal(backoff(3).repsLow, 4);

  assert.equal(single(11).rpe, 8.5, 'intensification I');
  assert.equal(backoff(11).repsLow, 3);

  assert.equal(single(24).sets, 2, 'intensification II works up to two singles');
  assert.equal(backoff(24).repsLow, 2);

  assert.equal(backoff(16).sets, 4, 'accumulation II runs four back-offs');
});

test('back-off load comes from the day’s single and RPE, not a fixed share', () => {
  // v1 fixed back-offs at 85% of the top single, which computed to an effective
  // RPE below 6 while the slot claimed RPE 8.
  const backoff = resolveSession(PLAN, { rotation: 3, sessionId: 'A' }).slots.find((s) => s.role === 'backoff');
  assert.equal(backoff.pctBasis, 'topSingleRpe');
  assert.equal(backoff.pct, null, 'no fixed percentage');
  assert.match(backoff.note, /RPE/);
});

test('the AMRAP appears only where the plan says it does', () => {
  const hasAmrap = (rotation) => resolveSession(PLAN, { rotation, sessionId: 'C' }).slots.some((s) => s.amrap);

  assert.equal(hasAmrap(1), false, 'no AMRAP in the baseline rotation');
  assert.equal(hasAmrap(2), true, 'the first standardised test is rotation 2');
  assert.equal(hasAmrap(3), true);
  assert.equal(hasAmrap(15), false, 'not in recovery');
  assert.equal(hasAmrap(28), true, 'specificity keeps it at the block edges');
  assert.equal(hasAmrap(29), false, 'but not in between');
  assert.equal(hasAmrap(30), true);
  assert.equal(hasAmrap(31), false, 'not in the taper');
  assert.equal(hasAmrap(32), false, 'not in the test rotation');
});

/* ── static holds ────────────────────────────────────────────────────── */

test('static holds obey every rule the plan sets for them', () => {
  for (let rotation = 1; rotation <= 10; rotation++) {
    assert.equal(staticHoldFor(PLAN, rotation), null, `rotation ${rotation} is too early`);
  }
  for (const rotation of [15, 31, 32, 33]) {
    assert.equal(staticHoldFor(PLAN, rotation), null, `rotation ${rotation} must have none`);
  }

  assert.equal(staticHoldFor(PLAN, 11).variant, 'primer');
  assert.equal(staticHoldFor(PLAN, 12), null, 'at most every other rotation');
  assert.equal(staticHoldFor(PLAN, 13).variant, 'training', 'and the variants alternate');

  // A hold only exists in the resolved session when one is offered.
  assert.equal(resolveSession(PLAN, { rotation: 3, sessionId: 'A' }).slots.some((s) => s.role === 'hold'), false);
  const withHold = resolveSession(PLAN, { rotation: 11, sessionId: 'A' }).slots.find((s) => s.role === 'hold');
  assert.ok(withHold);
  assert.equal(withHold.optional, true, 'always optional');
  assert.equal(withHold.pct, 1.08);
});

/* ── the failure experiment ─────────────────────────────────────────── */

test('accumulation runs two counterbalanced effort waves', () => {
  const modes = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => effortModeFor(PLAN, from + i));

  assert.deepEqual(modes(3, 10), ['high', 'high', 'standard', 'standard', 'standard', 'standard', 'high', 'high']);
  assert.deepEqual(modes(16, 23), ['high', 'high', 'standard', 'standard', 'standard', 'standard', 'high', 'high']);

  assert.equal(effortModeFor(PLAN, 1), 'baseline');
  assert.equal(effortModeFor(PLAN, 11), 'standard', 'intensification never runs the experiment');
  assert.equal(effortModeFor(PLAN, 15), 'none');
});

test('high mode adds failure only to low-cost work, never to the compounds', () => {
  const high = resolveSession(PLAN, { rotation: 3, sessionId: 'A' });
  const standard = resolveSession(PLAN, { rotation: 5, sessionId: 'A' });

  const failing = (resolved) => resolved.slots.reduce((total, slot) => total + slot.failSets, 0);
  assert.ok(failing(high) > failing(standard), 'high mode fails more sets');

  for (const resolved of [high, standard]) {
    for (const slot of resolved.slots) {
      if (['top_single', 'backoff', 'speed', 'hold'].includes(slot.role)) {
        assert.equal(slot.failSets, 0, `${slot.ex} (${slot.role}) must never be taken to failure`);
      }
    }
    // Weighted pull-ups are explicitly excluded from failure work.
    const pullup = resolved.slots.find((s) => s.ex === 'pullupNorm');
    assert.equal(pullup.failSets, 0);
  }
});

/* ── readiness ───────────────────────────────────────────────────────── */

test('a yellow day trims work without abandoning the session', () => {
  const yellow = resolveSession(PLAN, { rotation: 3, sessionId: 'C', readiness: 'yellow' });
  const normal = resolveSession(PLAN, { rotation: 3, sessionId: 'C' });

  assert.ok(setCount(yellow) < setCount(normal));
  const amrap = yellow.slots.find((s) => s.id === 'C1');
  assert.equal(amrap.amrap, false, 'the AMRAP is replaced, not kept');
  assert.equal(amrap.repsLow, 3);
  assert.equal(amrap.rpe, 8);
  assert.equal(amrap.idx, false, 'and it no longer counts as an index set');
});

test('a red day removes the AMRAP, the holds and every grind', () => {
  const red = resolveSession(PLAN, { rotation: 11, sessionId: 'A', readiness: 'red' });

  assert.equal(red.slots.some((s) => s.role === 'hold'), false, 'no holds on a red day');
  for (const slot of red.slots) {
    assert.equal(slot.failSets, 0);
    if (['top_single', 'backoff'].includes(slot.role)) {
      assert.ok(slot.rpe <= 6, `${slot.ex} at RPE ${slot.rpe}`);
    }
  }
  assert.ok(setCount(red) < setCount(resolveSession(PLAN, { rotation: 11, sessionId: 'A' })));
});

test('readiness never mutates the plan it was handed', () => {
  const resolved = resolveSession(PLAN, { rotation: 3, sessionId: 'A' });
  const before = JSON.stringify(resolved.slots);
  applyReadiness({ ...resolved, readiness: 'red' });
  assert.equal(JSON.stringify(resolved.slots), before);
});

/* ── rotation 1 is a baseline, not an ordinary rotation ─────────────── */

test('rotation 1 is a full-volume baseline survey', () => {
  const a = resolveSession(PLAN, { rotation: 1, sessionId: 'A' });
  assert.equal(a.isBaseline, true);
  assert.equal(a.effortMode, 'baseline');

  const test1rm = a.slots.find((s) => s.role === 'test');
  assert.ok(test1rm, 'session A opens with the paused 1RM test');
  assert.match(test1rm.note, /spotter/i);

  // Full volume is retained despite the testing fatigue.
  assert.equal(rotationSets(1) > rotationSets(3) * 0.95, true, 'baseline keeps its volume');
  assert.equal(resolveSession(PLAN, { rotation: 2, sessionId: 'A' }).isBaseline, false);
});

test('session B runs arms first, then the heavy leg work', () => {
  /*
   * Requested by the owner, 21 August 2026, and his reasoning is the standard
   * one: heavy lower-body work is systemically expensive and degrades the
   * curls that used to follow it, while curls cost almost nothing and do not
   * touch leg press. Leg press before hip thrust is his preference for which
   * heavy lift gets the freshest legs.
   *
   * Only the order changed. Every slot keeps its id, its exercise, its sets,
   * reps, RPE, rest and effort text — proven at the time by sorting both
   * versions of the plan file by slot id and diffing them to nothing.
   *
   * Asserted by id rather than by position, so this test says what it means:
   * it is about which exercise comes first, not about a number that would
   * silently pass if the exercises were swapped underneath it.
   */
  const B = PLAN.sessions.find((session) => session.id === 'B');
  assert.deepEqual(
    B.slots.map((slot) => slot.id),
    ['B5', 'B6', 'B2', 'B1', 'B4', 'B3', 'B7', 'B8', 'B9', 'B10']
  );

  const names = B.slots.map((slot) => PLAN.exercises[slot.ex].name);
  assert.match(names[0], /curl/i, 'the first exercise is a curl');
  assert.match(names[1], /curl/i, 'and so is the second');
  assert.match(names[2], /leg press/i, 'then the heaviest leg lift');
  assert.match(names[3], /hip thrust/i);
});

test('reordering a session changed nothing about any prescription', () => {
  // The guard against a reorder quietly becoming an edit. Every slot in B still
  // carries exactly what it did, keyed by id so position is irrelevant.
  const B = PLAN.sessions.find((session) => session.id === 'B');
  const byId = Object.fromEntries(B.slots.map((slot) => [slot.id, slot]));

  const expected = {
    B1: { ex: 'hipThrust', sets: 3, repsLow: 6, repsHigh: 10, rpe: 8, restSec: 150 },
    B2: { ex: 'legpress', sets: 3, repsLow: 8, repsHigh: 12, rpe: 9, restSec: 150 },
    B3: { ex: 'legcurlSeat', sets: 4, repsLow: 8, repsHigh: 12, rpe: 10, restSec: 75 },
    B4: { ex: 'quadext', sets: 3, repsLow: 12, repsHigh: 20, rpe: 10, restSec: 75 },
    B5: { ex: 'curlIncline', sets: 3, repsLow: 8, repsHigh: 12, rpe: 10, restSec: 75 },
    B6: { ex: 'curlHammer', sets: 2, repsLow: 10, repsHigh: 15, rpe: 10, restSec: 75 },
  };

  for (const [id, want] of Object.entries(expected)) {
    for (const [field, value] of Object.entries(want)) {
      assert.equal(byId[id][field], value, `${id}.${field}`);
    }
  }
});
