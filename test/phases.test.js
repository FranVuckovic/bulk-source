/**
 * How one exercise is prescribed across the plan.
 *
 * The question this answers — "what does this lift look like in the other
 * blocks?" — used to need opening five other sessions and a lot of counting.
 *
 * The reason it is derived rather than written down: the plan does NOT have a
 * one-to-one equivalent for every exercise in every rotation, and the ways it
 * does not are each different in kind.
 *
 *   The static hold is prescribed in nine rotations out of thirty-three.
 *   The AMRAP is absent in 15, 31, 32 and 33, and in 29 becomes a triple.
 *   In rotation 1 it is technique volume, not an AMRAP at all.
 *   Rotation 32 drops the competition bench work in A, C and E.
 *   Accumulation I alternates effort waves, so two rotations inside one block
 *   are not the same prescription.
 *
 * Anything hand-authored would have drifted from that within a week. These
 * tests fix the shape of the derivation and the honesty of its gaps.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { exerciseAcrossPlan, sameExerciseElsewhere, slotById, resolveSession } from '../js/plan.js';

const PLAN = JSON.parse(readFileSync(new URL('../data/plan-fopip-v2.json', import.meta.url), 'utf8'));
const ROTATIONS = PLAN.meta.rotations;

test('slot ids are unique across the whole plan, which is what makes them the anchor', () => {
  // Slot *indices* are not stable: readiness removes slots, added exercises are
  // appended, and the static hold appears and disappears. Comparing index 3 in
  // rotation 1 with index 3 in rotation 12 compares two different exercises.
  const ids = PLAN.sessions.flatMap((session) => session.slots.map((slot) => slot.id));
  assert.equal(new Set(ids).size, ids.length, 'no duplicate slot ids');
  assert.ok(ids.every(Boolean), 'no slot is missing an id');
});

test('every rotation is covered, with no gaps and no overlaps', () => {
  for (let rotation = 1; rotation <= ROTATIONS; rotation += 1) {
    const covering = PLAN.blocks.filter((block) => rotation >= block.from && rotation <= block.to);
    assert.equal(covering.length, 1, `rotation ${rotation} is covered by ${covering.length} blocks`);
  }
});

test('the phases of a slot cover every rotation exactly once, in order', () => {
  for (const session of PLAN.sessions) {
    for (const slot of session.slots) {
      const phases = exerciseAcrossPlan(PLAN, slot.id);
      assert.ok(phases.length, `${slot.id} has no phases`);
      assert.equal(phases[0].from, 1, `${slot.id} does not start at rotation 1`);
      assert.equal(phases[phases.length - 1].to, ROTATIONS, `${slot.id} does not reach rotation ${ROTATIONS}`);

      for (let i = 1; i < phases.length; i += 1) {
        assert.equal(phases[i].from, phases[i - 1].to + 1, `${slot.id} has a gap or overlap at phase ${i}`);
      }
    }
  }
});

test('a phase says what the engine would actually resolve for every rotation in it', () => {
  // The collapse is only trustworthy if every rotation inside a run really does
  // resolve to what the run claims. Checked exhaustively, for every slot.
  for (const session of PLAN.sessions) {
    for (const slot of session.slots) {
      for (const phase of exerciseAcrossPlan(PLAN, slot.id)) {
        for (let rotation = phase.from; rotation <= phase.to; rotation += 1) {
          const resolved = resolveSession(PLAN, { rotation, sessionId: session.id });
          const actual = resolved.slots.find((candidate) => candidate.id === slot.id) || null;
          if (phase.slot === null) {
            assert.equal(actual, null, `${slot.id} rotation ${rotation}: claimed absent but is prescribed`);
            continue;
          }
          assert.ok(actual, `${slot.id} rotation ${rotation}: claimed present but is absent`);
          for (const field of ['role', 'sets', 'repsLow', 'repsHigh', 'rpe', 'amrap', 'idx']) {
            assert.equal(actual[field], phase.slot[field], `${slot.id} rotation ${rotation}: ${field} differs`);
          }
        }
      }
    }
  }
});

test('rotations where nothing is prescribed are reported, not skipped', () => {
  // A gap in a list of rotation numbers reads as a bug. "Not in the plan then"
  // is an answer.
  const amrap = exerciseAcrossPlan(PLAN, 'C1');
  const absent = amrap.filter((phase) => phase.slot === null);
  assert.ok(absent.length, 'the AMRAP is absent in some rotations');

  const rotations = absent.flatMap((phase) => {
    const list = [];
    for (let r = phase.from; r <= phase.to; r += 1) list.push(r);
    return list;
  });
  assert.deepEqual(rotations, [15, 31, 32, 33], 'recovery, fatigue reduction, the test rotation and the bridge');
});

test('the baseline rotation is its own phase, because it is not an AMRAP', () => {
  const [first] = exerciseAcrossPlan(PLAN, 'C1');
  assert.equal(first.from, 1);
  assert.equal(first.to, 1, 'rotation 1 does not share a phase with rotation 2');
  assert.equal(first.slot.amrap, false);
  assert.equal(first.slot.rpe, 7);
});

test('a slot prescribed in only some rotations still reports every rotation', () => {
  const hold = exerciseAcrossPlan(PLAN, 'A1');
  const present = hold.filter((phase) => phase.slot);
  const prescribed = present.reduce((total, phase) => total + (phase.to - phase.from + 1), 0);

  assert.ok(prescribed > 0 && prescribed < ROTATIONS, 'the static hold is prescribed in some rotations, not all');
  const covered = hold.reduce((total, phase) => total + (phase.to - phase.from + 1), 0);
  assert.equal(covered, ROTATIONS, 'and the phases still account for all 33');
});

test('every block a phase spans is named, once', () => {
  for (const phase of exerciseAcrossPlan(PLAN, 'C1')) {
    assert.ok(phase.blocks.length, 'a phase names its blocks');
    assert.equal(new Set(phase.blocks).size, phase.blocks.length, 'without repeating one');
  }
});

test('an unknown slot id returns nothing rather than throwing', () => {
  // Added exercises and custom workouts have no plan slot. The Train screen
  // hides the control for those, but the engine must not depend on that.
  assert.deepEqual(exerciseAcrossPlan(PLAN, 'not-a-slot'), []);
  assert.equal(slotById(PLAN, 'not-a-slot'), null);
});

test('the same exercise elsewhere in a rotation is found, and the slot you are on is not listed twice', () => {
  const others = sameExerciseElsewhere(PLAN, 'benchComp', 3, { exclude: 'C1' });
  assert.ok(others.length >= 3, 'bench is prescribed several times per rotation');
  assert.ok(!others.some((entry) => entry.slot.id === 'C1'), 'not the one you are standing on');
  assert.ok(others.every((entry) => entry.slot.ex === 'benchComp'));
  assert.ok(others.some((entry) => entry.slot.role === 'top_single'));
  assert.ok(others.some((entry) => entry.slot.role === 'volume'));
});

test('elsewhere reflects the rotation asked for, not a fixed answer', () => {
  // Rotation 32 drops the competition bench work from A, C and E.
  const normal = sameExerciseElsewhere(PLAN, 'benchComp', 3);
  const test32 = sameExerciseElsewhere(PLAN, 'benchComp', 32);
  assert.ok(test32.length < normal.length, 'the test rotation prescribes less of it');
});

test('no phase carries a load', () => {
  // A load is computed from the working max on the day. A kilogram figure
  // against rotation 24 would be invented rather than stated.
  for (const phase of exerciseAcrossPlan(PLAN, 'A2')) {
    if (!phase.slot) continue;
    assert.equal(phase.slot.load, undefined, 'phases describe prescriptions, not weights');
  }
});

/*
 * The control is hidden where it would tell you something untrue.
 *
 * A swapped slot keeps the plan's slot id while showing a different exercise,
 * so "across the plan" for it would describe the exercise you swapped away
 * from, under the name of the one you swapped to. An added exercise has no
 * plan slot at all.
 */
test('the Phases control is offered only where the slot really is the plan\'s', async () => {
  const trainScreen = await import('../js/ui/train.js');
  const { newCycle, cycleProgress, blockBoundary } = await import('../js/cycle.js');
  const { blockFor } = await import('../js/plan.js');

  const build = (deviations) => {
    const cycle = newCycle(PLAN, { sequence: 3, startedAtISO: null, localStartDate: null });
    const block = blockFor(PLAN, 3);
    return {
      plan: PLAN,
      logs: [], sets: [], daily: [], measurements: [], niggles: [], media: [], cycles: [cycle], deleted: [],
      maxes: new Map(),
      lastByExercise: new Map(),
      cycle,
      settings: { unit: 'kg', increment: 2.5, bodyweight: 90, barKg: 20 },
      storage: { persisted: true, supported: true },
      integrity: { ok: true, problems: [], formatVersion: 3 },
      todayISO: '2026-08-21',
      shut: new Set(),
      exOpen: new Set(['0', '1', '2']),
      cleared: new Set(),
      grips: {},
      loggedSets: new Map(),
      demo: false,
      swapConfirmed: new Set(),
      draft: { note: '', bodyweight: '', sessionRpe: '' },
      trainSessionId: 'C',
      readiness: 'normal',
      activeLog: null,
      deviations,
      cycleProgress: cycleProgress(PLAN, cycle, []),
      block: { idx: block.id, label: String(block.id), ...block },
      blockProgress: { blockDone: 0, sessionTarget: 6, readyForReview: false, daysElapsed: null, behind: false },
      planProgress: { calendarWeek: 1, pace: null, sessionsDone: 0, cyclesDone: 0, daysElapsed: null },
      position: { nextSessionId: 'C' },
      boundary: blockBoundary(PLAN, cycle),
    };
  };

  const plain = trainScreen.view({
    state: build({ swaps: {}, extras: [], addedSets: {}, exerciseNotes: {} }),
    render() {},
  });
  assert.match(plain, /data-act="open-phases"/, 'offered on a planned slot');

  const swapped = trainScreen.view({
    state: build({ swaps: { 0: 'inclineSmith' }, extras: [], addedSets: {}, exerciseNotes: {} }),
    render() {},
  });
  const firstSlot = swapped.slice(0, swapped.indexOf('data-si="1"'));
  assert.doesNotMatch(firstSlot, /open-phases" data-si="0"/, 'not offered on a swapped slot');

  // Leak checking belongs to screens.test.js and the browser sweep, which build
  // a complete state. This state is hand-made to isolate one condition.
});
