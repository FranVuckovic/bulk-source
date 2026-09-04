/**
 * The bench variations, their ratios, and the slots that run them.
 *
 * The defect underneath all of this: `benchVar` was one exercise called "bench
 * variation" with its own seeded working max, and `blocks[].variation` was a
 * display string nothing acted on. So the slot could not know which variation
 * it was running, and the load could not know what fraction of the competition
 * lift it was supposed to be — which is how a close-grip bench became a maximal
 * attempt with a bad grip.
 *
 * Now every variation is a real exercise carrying its ratio to the competition
 * max, and the block names the exercise. These tests fail if a ratio drifts, if
 * a block points at a variation that does not exist, or if the label and the
 * exercise disagree.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveSession, toDisplaySession } from '../js/plan.js';
import { prescribedLoad, roundToIncrement, pct } from '../js/calc.js';

const PLAN = JSON.parse(readFileSync(new URL('../data/plan-fopip-v2.json', import.meta.url), 'utf8'));

/** The ratios, as agreed. A change here is a training decision, not a refactor. */
const RATIOS = {
  benchDouble: 0.82,
  benchPin: 0.85,
  benchClose: 0.88,
  benchPause: 0.88,
  benchFeetUp: 0.92,
  benchWide: 0.97,
};

test('every variation derives its max from the competition bench, at its ratio', () => {
  for (const [id, ratio] of Object.entries(RATIOS)) {
    const exercise = PLAN.exercises[id];
    assert.ok(exercise, `${id} exists`);
    assert.equal(exercise.maxFrom?.exerciseId, 'benchComp', `${id} derives from the competition lift`);
    assert.equal(exercise.maxFrom.ratio, ratio, `${id} ratio`);
  }
});

test('the ratios are ordered the way the lifts are hard', () => {
  // Double pause lowest — a second pause at the sticking point costs more than
  // a long one on the chest. Wide grip highest — a shorter range.
  const order = Object.entries(RATIOS).sort((a, b) => a[1] - b[1]).map(([id]) => id);
  assert.equal(order[0], 'benchDouble', 'the double pause is the hardest per kilo');
  assert.equal(order[order.length - 1], 'benchWide');
  for (const ratio of Object.values(RATIOS)) {
    assert.ok(ratio > 0.7 && ratio < 1.05, `${ratio} is not a plausible ratio`);
  }
});

test('every block names a variation that exists, and labels it correctly', () => {
  for (const block of PLAN.blocks) {
    const id = block.variationEx;
    if (id == null) {
      assert.equal(block.variation, '—', `block ${block.id} has no variation and says so`);
      continue;
    }
    assert.ok(PLAN.exercises[id], `block ${block.id} points at ${id}`);
    assert.equal(block.variation, PLAN.exercises[id].name, `block ${block.id}'s label matches its exercise`);
  }
});

test('the double pause runs through the first three blocks', () => {
  const at = (rotation) => resolveSession(PLAN, { rotation, sessionId: 'C' }).slots.find((s) => s.id === 'C2');
  for (const rotation of [1, 3, 10, 11, 14]) {
    assert.equal(at(rotation).ex, 'benchDouble', `rotation ${rotation}`);
  }
  assert.equal(at(16).ex, 'benchPin', 'the pin press waits for data on where he stalls');
  assert.equal(at(24).ex, 'benchPause');
});

test('a variation is loaded off its own max, not the competition one', () => {
  // The whole point. At a 120 kg competition max the double pause's own max is
  // 82% of 120, and the RPE table is applied to THAT.
  //
  // Through toDisplaySession, because `prescribedLoad` reads `slot.reps` and
  // the resolver speaks in repsLow/repsHigh. A raw resolved slot has no `reps`,
  // and pct(undefined, 8) silently falls through to the single-rep row — which
  // would have prescribed 90 kg here instead of 77.5.
  const slot = toDisplaySession(resolveSession(PLAN, { rotation: 3, sessionId: 'C' })).slots.find(
    (s) => s.id === 'C2'
  );
  assert.equal(slot.ex, 'benchDouble');
  assert.equal(slot.reps, 6, 'the display shape carries a rep target');

  const own = 120 * RATIOS.benchDouble;
  const expected = roundToIncrement((own * pct(slot.reps, slot.rpe)) / 100, 2.5);
  assert.equal(prescribedLoad(slot, own, 2.5), expected);
  assert.equal(expected, 77.5, 'the number he will actually see');
  assert.ok(expected < 120 * 0.7, `${expected} kg — a variation must not land near the competition load`);
});

test('the close-grip slot in F loads off the close-grip max', () => {
  const slot = toDisplaySession(resolveSession(PLAN, { rotation: 3, sessionId: 'F' })).slots.find(
    (s) => s.id === 'F8'
  );
  const own = 120 * RATIOS.benchClose;
  assert.equal(prescribedLoad(slot, own, 2.5), 87.5, '3 x 4 @ RPE 8 off a 105 kg close-grip max');
});

/* ── the slots that changed ─────────────────────────────────────────── */

test('F runs competition speed work, then heavy close grip', () => {
  const slots = resolveSession(PLAN, { rotation: 3, sessionId: 'F' }).slots;
  const speed = slots.find((s) => s.id === 'F1');
  const close = slots.find((s) => s.id === 'F8');

  assert.equal(speed.ex, 'benchSpeed', 'the speed slot stays the competition groove');
  assert.equal(speed.sets, 3, 'three triples answer the diagnostic as well as five');

  assert.ok(close, 'F has a close-grip slot');
  assert.equal(close.ex, 'benchClose');
  assert.equal(close.sets, 3, 'three sets is a dose; two is not');
  assert.equal(close.repsLow, 4);
  assert.equal(close.rpe, 8);
  assert.ok(slots.indexOf(close) > slots.indexOf(speed), 'and it follows the speed work, while the bar is moving');
});

test('no block prescribes more than three sets of speed work', () => {
  for (const block of PLAN.blocks) {
    const speed = block.bench?.F?.speed;
    if (speed) assert.ok(speed.sets <= 3, `block ${block.id} prescribes ${speed.sets}`);
  }
});

test('the raw slots state what the blocks actually prescribe', () => {
  // An unresolved plan that advertises five speed sets when no rotation runs
  // more than three is a plan screen that lies before you start.
  const raw = (sid, slid) => PLAN.sessions.find((s) => s.id === sid).slots.find((s) => s.id === slid);
  const most = (pick) => Math.max(...PLAN.blocks.map((b) => pick(b)?.sets ?? 0));

  assert.equal(raw('F', 'F1').sets, most((b) => b.bench?.F?.speed));
  assert.equal(raw('E', 'E2').sets, most((b) => b.bench?.E?.volume));
});

test('the long head gets a third overhead slot, and the skullcrusher slot is now overhead too', () => {
  const overhead = [];
  for (const session of PLAN.sessions) {
    for (const slot of session.slots) if (slot.ex === 'triOH') overhead.push(`${session.id}${slot.id}`);
  }
  assert.equal(overhead.length, 4, `four overhead slots, found ${overhead.join(' ')}`);

  // The skullcrusher is kept as an exercise — his elbows, his call, and he
  // means to bring it back — so it must still be reachable as a substitute.
  assert.ok(PLAN.exercises.skull, 'the skullcrusher still exists');
  assert.ok(
    PLAN.exercises.triOH.subs.some((s) => /skull/i.test(s)),
    'and the overhead slot offers it as a substitute'
  );
});

test('no session runs four sets of lateral raises any more', () => {
  for (const session of PLAN.sessions) {
    for (const slot of session.slots) {
      if (slot.ex === 'lateral') {
        assert.ok(slot.sets <= 3, `${session.id} ${slot.id} runs ${slot.sets} sets`);
      }
    }
  }
});

test('both calf slots stay standing — no seated machine', () => {
  const calf = [];
  for (const session of PLAN.sessions) {
    for (const slot of session.slots) if (/^calf/.test(slot.ex)) calf.push(slot.ex);
  }
  assert.ok(calf.length, 'there are calf slots');
  assert.deepEqual([...new Set(calf)], ['calfStand'], 'he has no seated calf machine');
});

test('every variation carries the band its ratio may recalibrate inside', () => {
  for (const [id, ratio] of Object.entries(RATIOS)) {
    const range = PLAN.exercises[id].maxFrom.range;
    assert.ok(Array.isArray(range) && range.length === 2, `${id} has a range`);
    const [lo, hi] = range;
    assert.ok(lo < hi, `${id} range is ordered`);
    assert.ok(lo <= ratio && ratio <= hi, `${id} ratio ${ratio} is outside its own band ${lo}–${hi}`);
    assert.ok(hi - lo <= 0.12, `${id} band ${lo}–${hi} is too wide to mean anything`);
  }
});

test('the weekly attempt opens at the weight he decided to go after', () => {
  // Not the working max. Seeding the ladder from the working max opened at 115;
  // seeding the working max at 120 instead would have made every other slot in
  // the plan prescribe as though he had already lifted it.
  const raw = PLAN.sessions.find((s) => s.id === 'C').slots.find((s) => s.id === 'C11');
  assert.equal(raw.attemptStart, 120);
  assert.equal(PLAN.meta.seedWorkingMaxes.benchComp, 115, 'and the rest of the plan is unmoved');
});
