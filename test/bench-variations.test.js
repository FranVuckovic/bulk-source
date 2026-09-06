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

/**
 * The ratios, as agreed. A change here is a training decision, not a refactor.
 *
 * These were population averages until his own logs were read back: on 19 and
 * 20 August he pressed 115 kg for a single at RPE 10 PAUSED and 115 kg at RPE
 * 10 touch-and-go, one day apart, and on 21 August a narrow grip and a normal
 * grip at 90 x 6 both read RPE 7. His gaps are far smaller than the population's
 * — and his WIDE grip was his hardest, not his easiest.
 */
const RATIOS = {
  benchPin: 0.90,
  benchFeetUp: 0.92,
  benchClose: 0.93,
  benchWide: 0.93,
  benchPause: 0.94,
};

test('every variation derives its max from the competition bench, at its ratio', () => {
  for (const [id, ratio] of Object.entries(RATIOS)) {
    const exercise = PLAN.exercises[id];
    assert.ok(exercise, `${id} exists`);
    assert.equal(exercise.maxFrom?.exerciseId, 'benchComp', `${id} derives from the competition lift`);
    assert.equal(exercise.maxFrom.ratio, ratio, `${id} ratio`);
  }
});

test('the ratios are ordered the way the lifts are hard FOR HIM', () => {
  const order = Object.entries(RATIOS).sort((a, b) => a[1] - b[1]).map(([id]) => id);
  assert.equal(order[0], 'benchPin', 'a dead stop at the weakest joint angle is the hardest per kilo');
  assert.equal(order[order.length - 1], 'benchPause', 'and a pause costs him almost nothing');
  assert.ok(
    RATIOS.benchPause > RATIOS.benchClose,
    'his pause is barely a change; his close grip is a real one'
  );
  for (const ratio of Object.values(RATIOS)) {
    assert.ok(ratio > 0.7 && ratio < 1.05, `${ratio} is not a plausible ratio`);
  }
});

test('no block swaps the variation any more — three fixed lifts', () => {
  // The rotating variation slot was the thing he found confusing: the lift in
  // C2 changed underneath him at a block boundary. Three fixed lifts instead,
  // one per session, and the block still decides sets, reps and RPE.
  for (const block of PLAN.blocks) {
    assert.equal(block.variationEx, null, `block ${block.id} still names a variation exercise`);
  }
});

test('the three variations sit one per session, in every rotation', () => {
  const WHERE = { E: ['E2', 'benchPause'], F: ['F8', 'benchClose'], C: ['C2', 'benchPin'] };
  for (const rotation of [1, 3, 10, 11, 16, 24, 28, 33]) {
    for (const [sessionId, [slotId, ex]] of Object.entries(WHERE)) {
      const slot = resolveSession(PLAN, { rotation, sessionId }).slots.find((s) => s.id === slotId);
      if (!slot) continue; // a reduced rotation may drop it entirely
      assert.equal(slot.ex, ex, `rotation ${rotation} ${sessionId} ${slotId}`);
    }
  }
});

test('the double pause is retired, kept, and prescribed nowhere', () => {
  assert.match(PLAN.exercises.benchDouble.name, /retired/i);
  for (const session of PLAN.sessions) {
    for (const slot of session.slots) {
      assert.notEqual(slot.ex, 'benchDouble', `${session.id} ${slot.id} still prescribes it`);
    }
  }
});

test('a variation is loaded off its own max, not the competition one', () => {
  // The whole point. At a 120 kg competition max the double pause's own max is
  // 82% of 120, and the RPE table is applied to THAT.
  //
  // Through toDisplaySession, because `prescribedLoad` reads `slot.reps` and
  // the resolver speaks in repsLow/repsHigh. A raw resolved slot has no `reps`,
  // and pct(undefined, 8) silently falls through to the single-rep row — which
  // would have prescribed 90 kg here instead of 77.5.
  const slot = toDisplaySession(resolveSession(PLAN, { rotation: 3, sessionId: 'E' })).slots.find(
    (s) => s.id === 'E2'
  );
  assert.equal(slot.ex, 'benchPause');
  assert.equal(slot.reps, 5, 'the display shape carries a rep target');

  const own = 120 * RATIOS.benchPause;
  const expected = roundToIncrement((own * pct(slot.reps, slot.rpe)) / 100, 2.5);
  assert.equal(prescribedLoad(slot, own, 2.5), expected);
  assert.equal(expected, 92.5, 'the number he will actually see');

  // The check he applied himself, and the one that caught the old numbers: the
  // working weight, not the derived max, is what says whether a ratio is sane.
  const competition = roundToIncrement((120 * pct(5, 8)) / 100, 2.5);
  assert.equal(competition, 97.5);
  assert.ok(competition - expected <= 7.5, 'a pause should cost him a plate, not a plate and a half');
});

test('the close-grip slot in F loads off the close-grip max', () => {
  const slot = toDisplaySession(resolveSession(PLAN, { rotation: 3, sessionId: 'F' })).slots.find(
    (s) => s.id === 'F8'
  );
  const own = 120 * RATIOS.benchClose;
  assert.equal(prescribedLoad(slot, own, 2.5), 92.5, '3 x 4 @ RPE 8 off a 112.5 kg close-grip max');
});

test('a paused competition-grip bench counts as the competition lift, not as a triceps variation', () => {
  // It inherited benchVar's { chest 0.6, triceps 1.0 } when it was split out —
  // a close-grip profile on a lift with the competition grip. Four sets moving
  // to it would have read as +2 triceps and -1.6 chest a week, which never
  // happened: same grip, same joint angles, same muscles.
  assert.deepEqual(PLAN.exercises.benchPause.m, PLAN.exercises.benchComp.m);
  assert.deepEqual(PLAN.exercises.benchFeetUp.m, PLAN.exercises.benchComp.m);
  assert.ok(PLAN.exercises.benchClose.m.triLat > PLAN.exercises.benchComp.m.triLat, 'close grip is triceps-biased');
  assert.ok(PLAN.exercises.benchWide.m.chestMid > PLAN.exercises.benchComp.m.chestMid, 'wide grip is chest-biased');
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
