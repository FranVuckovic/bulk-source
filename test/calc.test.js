import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RPE_COLUMNS,
  RPE_TABLE,
  TABULATED_REPS,
  AMRAP_FRACTION,
  MID_BLOCK_BUMP_RATIO,
  nearestRepRow,
  pct,
  rpeFor,
  e1rm,
  epley,
  estimateE1rm,
  roundToIncrement,
  prescribedLoad,
  effectiveRpe,
  prescription,
  bestObserved,
  observationsFromSets,
  proposeBlockBoundaryMax,
  proposeMidBlockBump,
  proposeWorkingMax,
} from '../js/calc.js';

const close = (actual, expected, eps = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) < eps,
    `expected ${actual} to be within ${eps} of ${expected}`
  );

/**
 * Transcribed by hand from the documents, not from js/calc.js — RPE 10 to 7 from
 * docs/bulk-plan.md Part 13.2, RPE 6.5 and 6 from the demo's table. A typo in the
 * port shows up here rather than in the gym.
 */
const TABLE_FROM_DOCS = {
  //      10    9.5    9     8.5     8     7.5     7     6.5     6
  1: [100, 97.8, 95.5, 93.9, 92.2, 90.7, 89.2, 87.8, 86.3],
  2: [95.5, 93.9, 92.2, 90.7, 89.2, 87.8, 86.3, 85.0, 83.7],
  3: [92.2, 90.7, 89.2, 87.8, 86.3, 85.0, 83.7, 82.4, 81.1],
  4: [89.2, 87.8, 86.3, 85.0, 83.7, 82.4, 81.1, 79.9, 78.6],
  5: [86.3, 85.0, 83.7, 82.4, 81.1, 79.9, 78.6, 77.4, 76.2],
  6: [83.7, 82.4, 81.1, 79.9, 78.6, 77.4, 76.2, 75.1, 73.9],
  8: [78.6, 77.4, 76.2, 75.1, 73.9, 72.3, 70.7, 69.4, 68.0],
  10: [73.9, 72.3, 70.7, 69.4, 68.0, 66.7, 65.3, 64.0, 62.6],
  12: [68.0, 66.7, 65.3, 64.0, 62.6, 61.3, 59.9, 58.6, 57.2],
};

/* ── the table ───────────────────────────────────────────────────────── */

test('RPE table matches the documents at every tabulated point', () => {
  assert.deepEqual(TABULATED_REPS.slice(), Object.keys(TABLE_FROM_DOCS).map(Number));
  assert.deepEqual(RPE_COLUMNS.slice(), [10, 9.5, 9, 8.5, 8, 7.5, 7, 6.5, 6]);

  for (const reps of TABULATED_REPS) {
    assert.deepEqual(RPE_TABLE[reps].slice(), TABLE_FROM_DOCS[reps], `row ${reps}`);
  }
});

test('pct returns the tabulated value at every tabulated point', () => {
  for (const reps of TABULATED_REPS) {
    RPE_COLUMNS.forEach((rpe, i) => {
      assert.equal(pct(reps, rpe), TABLE_FROM_DOCS[reps][i], `${reps} reps @ RPE ${rpe}`);
    });
  }
});

test('the plan\'s worked example holds: 6 reps @ RPE 8 is 78.6%', () => {
  assert.equal(pct(6, 8), 78.6);
  close(115 * (pct(6, 8) / 100), 90.39);
});

test('rep counts snap to the nearest tabulated row, ties going down', () => {
  assert.equal(nearestRepRow(7), 6);
  assert.equal(nearestRepRow(9), 8);
  assert.equal(nearestRepRow(11), 10);
  assert.equal(nearestRepRow(13), 12);
  assert.equal(nearestRepRow(1), 1);
  assert.equal(nearestRepRow(0), 1);

  assert.equal(pct(7, 8), pct(6, 8));
  assert.equal(pct(9, 8), pct(8, 8));
  assert.equal(pct(11, 8), pct(10, 8));
});

/* ── interpolation ───────────────────────────────────────────────────── */

test('pct interpolates linearly between RPE columns', () => {
  // Half-way between RPE 8.5 (93.9) and RPE 9 (95.5) at one rep.
  close(pct(1, 8.75), 94.7);
  // A quarter of the way from RPE 8 (81.1) to RPE 8.5 (82.4) at five reps.
  close(pct(5, 8.125), 81.425);
  // Half-way between RPE 7 (59.9) and RPE 7.5 (61.3) at twelve reps.
  close(pct(12, 7.25), 60.6);
});

test('pct is monotonic in RPE within a row', () => {
  for (const reps of TABULATED_REPS) {
    for (let rpe = 6; rpe < 10; rpe += 0.25) {
      assert.ok(pct(reps, rpe) < pct(reps, rpe + 0.25), `${reps} reps around RPE ${rpe}`);
    }
  }
});

test('an off-table or missing RPE falls back to the RPE 8 column', () => {
  assert.equal(pct(5, 11), pct(5, 8));
  assert.equal(pct(5, 5), pct(5, 8));
  assert.equal(pct(5, undefined), pct(5, 8));
  assert.equal(pct(5, null), pct(5, 8));
});

/* ── e1RM ────────────────────────────────────────────────────────────── */

test('e1rm at RPE 10 and one rep is the load itself', () => {
  assert.equal(e1rm(140, 1, 10), 140);
});

test('e1rm matches hand-computed values', () => {
  close(e1rm(90, 6, 8), 90 / 0.786);
  close(e1rm(100, 5, 8), 100 / 0.811);
  close(e1rm(100, 12, 10), 100 / 0.68);
});

test('e1rm round-trips through pct at every tabulated point', () => {
  for (const reps of TABULATED_REPS) {
    for (const rpe of RPE_COLUMNS) {
      const estimated = e1rm(100, reps, rpe);
      close(estimated * (pct(reps, rpe) / 100), 100, 1e-12);
    }
  }
});

test('e1rm round-trips a prescribed load back to the working max', () => {
  const workingMax = 115;
  for (const reps of [1, 3, 5, 8]) {
    const load = (workingMax * pct(reps, 8)) / 100; // unrounded, so it is exact
    close(e1rm(load, reps, 8), workingMax, 1e-12);
  }
});

test('e1rm returns null above 12 reps', () => {
  assert.equal(e1rm(60, 13, 10), null);
  assert.equal(e1rm(60, 20, 10), null);
  assert.notEqual(e1rm(60, 12, 10), null);
});

test('e1rm returns null on missing load or reps', () => {
  assert.equal(e1rm(null, 5, 8), null);
  assert.equal(e1rm(0, 5, 8), null);
  assert.equal(e1rm(100, null, 8), null);
  assert.equal(e1rm(100, 0, 8), null);
});

/* ── Epley fallback ──────────────────────────────────────────────────── */

test('a missing RPE falls back to Epley and is flagged low confidence', () => {
  const missing = estimateE1rm(100, 5, null);
  assert.equal(missing.method, 'epley');
  assert.equal(missing.confidence, 'low');
  close(missing.value, 100 * (1 + 5 / 30));

  assert.deepEqual(estimateE1rm(100, 5, undefined), missing);
});

test('a set with an RPE uses the table and is flagged high confidence', () => {
  const withRpe = estimateE1rm(100, 5, 8);
  assert.equal(withRpe.method, 'rpe');
  assert.equal(withRpe.confidence, 'high');
  close(withRpe.value, 100 / 0.811);
});

test('Epley returns the load unchanged at one rep, and null above 12', () => {
  assert.equal(epley(140, 1), 140);
  close(epley(100, 10), 100 * (1 + 10 / 30));
  assert.equal(epley(100, 13), null);
  assert.equal(estimateE1rm(100, 13, null), null);
});

/* ── rounding ────────────────────────────────────────────────────────── */

test('roundToIncrement rounds to the nearest plate', () => {
  assert.equal(roundToIncrement(92.4, 2.5), 92.5);
  assert.equal(roundToIncrement(93.265, 2.5), 92.5);
  assert.equal(roundToIncrement(93.75, 2.5), 95); // an exact half rounds up
  assert.equal(roundToIncrement(92.4, 1), 92);
  assert.equal(roundToIncrement(92.6, 1), 93);
  assert.equal(roundToIncrement(93.265, 1), 93);
  assert.equal(roundToIncrement(0, 2.5), 0);
});

test('roundToIncrement defaults to 2.5 kg and handles bad input', () => {
  assert.equal(roundToIncrement(93.265), 92.5);
  assert.equal(roundToIncrement(null), null);
  assert.equal(roundToIncrement(undefined), null);
  assert.equal(roundToIncrement(100, 0), 100);
  assert.equal(roundToIncrement(100, -2.5), 100);
});

/* ── prescribed load ─────────────────────────────────────────────────── */

const WORKING_MAX = 115; // comp bench, the demo's working max

test('a plain slot is working max × the table percentage, rounded', () => {
  // Session C volume bench: 5×5 @ RPE 8 → 81.1% of 115 = 93.265
  const slot = { ex: 'benchComp', sets: 5, reps: 5, rpe: 8 };
  assert.equal(prescribedLoad(slot, WORKING_MAX, 2.5), 92.5);
  assert.equal(prescribedLoad(slot, WORKING_MAX, 1), 93);
  assert.equal(prescribedLoad(slot, WORKING_MAX), 92.5, 'defaults to 2.5 kg');
});

test('pctTop back-offs are a percentage of today\'s top single', () => {
  // Session A: top single at RPE 8 = 92.2% of 115 = 106.03 → 105 kg on the bar,
  // then the back-offs are 85% of that = 89.25 → 90 kg.
  const slot = { ex: 'benchComp', label: 'back-offs', sets: 3, reps: 3, rpe: 8, pctTop: 0.85 };
  assert.equal(prescribedLoad(slot, WORKING_MAX, 2.5), 90);
  assert.equal(prescribedLoad(slot, WORKING_MAX, 1), 90); // 106 × 0.85 = 90.1

  // It is genuinely a percentage of the single, not of the working max:
  // 85% of 115 would be 97.75 → 97.5, which is not what we prescribe.
  assert.notEqual(prescribedLoad(slot, WORKING_MAX, 2.5), 97.5);
});

test('an AMRAP is a fixed fraction of the working max, ignoring reps and RPE', () => {
  const slot = { ex: 'benchComp', label: 'AMRAP', sets: 1, reps: 6, rpe: 10, amrap: true };
  assert.equal(AMRAP_FRACTION, 0.83);
  assert.equal(prescribedLoad(slot, WORKING_MAX, 2.5), 95); // 95.45 → 95
  assert.equal(prescribedLoad(slot, WORKING_MAX, 1), 95);

  // Same load whatever the rep target says — comparability is the point.
  const other = { ...slot, reps: 3, rpe: 8 };
  assert.equal(prescribedLoad(other, WORKING_MAX, 2.5), prescribedLoad(slot, WORKING_MAX, 2.5));
});

test('no working max means no prescription', () => {
  const slot = { ex: 'lateral', sets: 4, reps: 15, rpe: 10 };
  assert.equal(prescribedLoad(slot, null), null);
  assert.equal(prescribedLoad(slot, 0), null);
  assert.equal(prescribedLoad(slot, undefined), null);
  assert.equal(prescribedLoad(null, WORKING_MAX), null);
});

test('effective RPE is the inverse of the rounded load', () => {
  // 92.5 kg is 80.435% of 115, which sits between RPE 7.5 (79.9) and 8 (81.1)
  // on the five-rep row.
  close(effectiveRpe(92.5, WORKING_MAX, 5), 7.7228260869565215, 1e-9);

  const { load, effectiveRpe: eff } = prescription({ sets: 5, reps: 5, rpe: 8 }, WORKING_MAX, 2.5);
  assert.equal(load, 92.5);
  close(eff, 7.7228260869565215, 1e-9);

  // Rounding up rather than down puts you above the target RPE, not below.
  assert.ok(effectiveRpe(95, WORKING_MAX, 5) > 8);
  assert.deepEqual(prescription({ reps: 5, rpe: 8 }, null), { load: null, effectiveRpe: null });
});

test('rpeFor inverts pct at every tabulated point', () => {
  for (const reps of TABULATED_REPS) {
    for (const rpe of RPE_COLUMNS) {
      close(rpeFor(pct(reps, rpe) / 100, reps), rpe, 1e-9);
    }
  }
});

test('rpeFor clamps outside the table', () => {
  assert.equal(rpeFor(1.2, 1), 10); // heavier than a table-top single
  assert.equal(rpeFor(0.4, 12), 6); // far lighter than the lightest entry
});

/* ── working max protocol ────────────────────────────────────────────── */

const obs = (e1rmValue, weekIndex, isDeload = false) => ({ e1rm: e1rmValue, weekIndex, isDeload });

test('a block boundary proposes the best observed e1RM from the block', () => {
  const result = proposeBlockBoundaryMax(115, [obs(118, 1), obs(122.4, 3), obs(120, 5)]);

  assert.equal(result.proposed, 122.4);
  assert.equal(result.best, 122.4);
  assert.equal(result.change, 'raise');
  assert.equal(result.capped, false);
  assert.equal(result.requiresConfirmation, true, 'never silent');
});

test('deload sessions never trigger an update', () => {
  // The deload week carries the highest number and is still ignored.
  const withDeload = proposeBlockBoundaryMax(115, [obs(118, 1), obs(130, 6, true)]);
  assert.equal(withDeload.proposed, 118);
  assert.equal(withDeload.best, 118);

  const onlyDeload = proposeBlockBoundaryMax(115, [obs(130, 6, true)]);
  assert.equal(onlyDeload.proposed, 115, 'working max is left alone');
  assert.equal(onlyDeload.change, 'none');
  assert.equal(onlyDeload.requiresConfirmation, false);
  assert.equal(onlyDeload.reason, 'no-index-sets');

  // …and mid-block too.
  const midBlock = proposeMidBlockBump(115, [obs(130, 3, true), obs(131, 4, true)]);
  assert.equal(midBlock.change, 'none');
});

test('a block boundary may lower the max, by at most 5%', () => {
  const capped = proposeBlockBoundaryMax(115, [obs(100, 2)]);
  close(capped.proposed, 109.25); // 115 − 5%
  assert.equal(capped.best, 100);
  assert.equal(capped.change, 'lower');
  assert.equal(capped.capped, true, 'flagged so the UI can say so prominently');
  assert.equal(capped.requiresConfirmation, true);

  const small = proposeBlockBoundaryMax(115, [obs(112, 2)]);
  assert.equal(small.proposed, 112);
  assert.equal(small.change, 'lower');
  assert.equal(small.capped, false);
});

test('a block boundary with no stored max seeds it from the block', () => {
  const seeded = proposeBlockBoundaryMax(null, [obs(118, 1), obs(121, 3)]);
  assert.equal(seeded.proposed, 121);
  assert.equal(seeded.change, 'set');
  assert.equal(seeded.requiresConfirmation, true);
  assert.equal(seeded.reason, 'no-current-max');

  assert.equal(proposeBlockBoundaryMax(null, []).proposed, null);
});

test('an unchanged best proposes nothing', () => {
  const same = proposeBlockBoundaryMax(115, [obs(115, 2)]);
  assert.equal(same.change, 'none');
  assert.equal(same.requiresConfirmation, false);
});

test('mid-block bumps only above 5% in two consecutive weeks', () => {
  assert.equal(MID_BLOCK_BUMP_RATIO, 1.05);
  const threshold = 115 * 1.05; // 120.75

  const twoWeeks = proposeMidBlockBump(115, [obs(121, 3), obs(122, 4)]);
  assert.equal(twoWeeks.change, 'raise');
  assert.equal(twoWeeks.proposed, 122, 'best of the qualifying weeks');
  assert.deepEqual(twoWeeks.weeks, [3, 4]);
  assert.equal(twoWeeks.requiresConfirmation, true);
  assert.equal(twoWeeks.reason, 'two-week-exception');

  const oneWeek = proposeMidBlockBump(115, [obs(125, 3), obs(118, 4)]);
  assert.equal(oneWeek.change, 'none', 'one good week is noise');
  assert.equal(oneWeek.proposed, 115);
  assert.equal(oneWeek.reason, 'below-threshold');

  const nonConsecutive = proposeMidBlockBump(115, [obs(125, 3), obs(118, 4), obs(126, 5)]);
  assert.equal(nonConsecutive.change, 'none', 'weeks 3 and 5 are not consecutive');

  const exactlyFivePercent = proposeMidBlockBump(115, [obs(threshold, 3), obs(threshold, 4)]);
  assert.equal(exactlyFivePercent.change, 'none', 'the rule is more than 5%, not exactly');

  const justOver = proposeMidBlockBump(115, [obs(threshold + 0.01, 3), obs(threshold + 0.02, 4)]);
  assert.equal(justOver.change, 'raise');
});

test('mid-block takes the most recent qualifying pair', () => {
  const result = proposeMidBlockBump(115, [obs(121, 1), obs(122, 2), obs(124, 3), obs(126, 4)]);
  assert.deepEqual(result.weeks, [3, 4]);
  assert.equal(result.proposed, 126);
});

test('the working max never lowers mid-block', () => {
  const bad = proposeMidBlockBump(115, [obs(100, 3), obs(101, 4), obs(99, 5)]);
  assert.equal(bad.change, 'none');
  assert.equal(bad.proposed, 115, 'a bad week is a bad week, not a strength loss');

  const viaEntryPoint = proposeWorkingMax(115, [obs(100, 3), obs(101, 4)], {
    atBlockBoundary: false,
  });
  assert.equal(viaEntryPoint.proposed, 115);

  // The same observations at a block boundary do lower it, capped at 5%.
  const atBoundary = proposeWorkingMax(115, [obs(100, 3), obs(101, 4)], { atBlockBoundary: true });
  assert.equal(atBoundary.change, 'lower');
  close(atBoundary.proposed, 109.25);
});

test('proposeWorkingMax defaults to the mid-block rule', () => {
  const result = proposeWorkingMax(115, [obs(122, 3), obs(123, 4)]);
  assert.equal(result.reason, 'two-week-exception');
});

test('bestObserved ignores deloads and unusable numbers', () => {
  assert.equal(bestObserved([obs(118, 1), obs(130, 2, true), obs(null, 3)]), 118);
  assert.equal(bestObserved([]), null);
  assert.equal(bestObserved(null), null);
});

/* ── index sets → observations ───────────────────────────────────────── */

test('only index sets become observations, and only estimable ones', () => {
  const sets = [
    { id: 1, load: 105, reps: 1, rpe: 8, weekIndex: 3, isIndexSet: true },
    { id: 2, load: 90, reps: 3, rpe: 8, weekIndex: 3 }, // back-off, not an index set
    { id: 3, load: 60, reps: 15, rpe: 10, weekIndex: 3, isIndexSet: true }, // above 12 reps
    { id: 4, load: 95, reps: 6, rpe: 10, weekIndex: 4, isIndexSet: true, isDeload: true },
  ];

  const observations = observationsFromSets(sets);
  assert.equal(observations.length, 2);
  assert.deepEqual(observations.map((o) => o.setId), [1, 4]);

  close(observations[0].e1rm, 105 / 0.922);
  assert.equal(observations[0].weekIndex, 3);
  assert.equal(observations[0].isDeload, false);
  assert.equal(observations[1].isDeload, true);

  // The deload observation is carried but never acted on.
  assert.equal(bestObserved(observations), observations[0].e1rm);
  assert.equal(observationsFromSets(null).length, 0);
});

test('the demo\'s Session A index set gives the expected e1RM', () => {
  // Top single, 105 kg at RPE 8 → 105 / 0.922 = 113.9 kg observed.
  const [observation] = observationsFromSets([
    { id: 'a1', load: 105, reps: 1, rpe: 8, weekIndex: 1, isIndexSet: true },
  ]);
  close(observation.e1rm, 113.88286334056398, 1e-9);

  // Which is below the 115 kg working max, so nothing is proposed mid-block.
  assert.equal(proposeMidBlockBump(115, [observation]).change, 'none');
});
