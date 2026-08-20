import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  eligibleForStrength,
  strengthSeries,
  bestPerCycle,
  bestPerWeek,
  alignByDate,
  trend,
  rollingMean,
  changeOver,
  gainRateVerdict,
  goalProgress,
  blockComparison,
  records,
  GAIN_TARGETS,
} from '../js/analytics.js';

const PLAN = JSON.parse(readFileSync(new URL('../data/plan-fopip-v2.json', import.meta.url), 'utf8'));
const exercises = PLAN.exercises;

const log = (id, dateISO, extra = {}) => ({ id, dateISO, localDate: dateISO, cycleSequence: 1, blockId: 1, ...extra });
const set = (id, sessionLogId, extra = {}) => ({
  id, sessionLogId, exerciseId: 'benchComp', isIndexSet: true, load: 100, reps: 5, rpe: 8, ...extra,
});
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

/* ── eligibility says what it excluded and why ──────────────────────── */

test('only standardised index sets on trustworthy lifts count as evidence', () => {
  const logs = [log(1, '2026-08-20'), log(2, '2026-08-22', { effortMode: 'none' })];
  const sets = [
    set(1, 1),
    set(2, 1, { isIndexSet: false }),
    set(3, 1, { exerciseId: 'lateral' }),
    set(4, 1, { rpe: 5 }),
    set(5, 1, { rpe: null }),
    set(6, 2),
    set(7, 1, { deletedAtISO: '2026-08-21T10:00:00.000Z' }),
    set(8, 1, { variantUsed: 'benchVar' }),
  ];

  const { included, excluded } = eligibleForStrength(sets, { exercises, logs });

  assert.deepEqual(included.map((row) => row.set.id), [1]);
  const reasons = Object.fromEntries(excluded.map((row) => [row.id, row.reason]));
  assert.match(reasons[2], /not an index set/);
  assert.match(reasons[3], /indicative only/);
  assert.match(reasons[4], /outside the table/);
  assert.match(reasons[5], /no RPE recorded/);
  assert.match(reasons[6], /deload/);
  assert.match(reasons[7], /deleted/);
  assert.match(reasons[8], /substitute/);
});

/* ── series alignment ───────────────────────────────────────────────── */

test('two series are joined on dates, not on array positions', () => {
  // v1 walked both arrays by index, so a missing weigh-in paired a bodyweight
  // with the wrong week's strength.
  const strength = [
    { dateISO: '2026-08-03', value: 120 },
    { dateISO: '2026-08-10', value: 122 },
    { dateISO: '2026-08-17', value: 124 },
  ];
  const bodyweight = [
    { dateISO: '2026-08-03', value: 90 },
    { dateISO: '2026-08-17', value: 91 },
  ];

  const aligned = alignByDate(strength, bodyweight);
  assert.deepEqual(aligned, [
    { dateISO: '2026-08-03', a: 120, b: 90 },
    { dateISO: '2026-08-10', a: 122, b: null },
    { dateISO: '2026-08-17', a: 124, b: 91 },
  ]);
  assert.equal(aligned[1].b, null, 'the missing week is a gap, not a wrong pairing');
});

test('training analytics group by cycle, calendar ones by week', () => {
  const points = [
    { dateISO: '2026-08-03', cycleSequence: 1, value: 120 },
    { dateISO: '2026-08-05', cycleSequence: 1, value: 124 },
    { dateISO: '2026-08-12', cycleSequence: 2, value: 122 },
  ];

  const cycles = bestPerCycle(points);
  assert.deepEqual(cycles.map((c) => [c.cycleSequence, c.value]), [[1, 124], [2, 122]]);

  const weeks = bestPerWeek(points);
  assert.equal(weeks.length, 2, 'the 3rd and 5th fall in one calendar week');
  assert.equal(weeks[0].value, 124);
});

/* ── trends carry their own evidence ────────────────────────────────── */

test('a trend refuses to exist without enough evidence', () => {
  const two = trend([{ dateISO: '2026-08-01', value: 90 }, { dateISO: '2026-08-20', value: 91 }]);
  assert.equal(two.ok, false);
  assert.match(two.reason, /at least 3 points/);

  const tooShort = trend([
    { dateISO: '2026-08-01', value: 90 },
    { dateISO: '2026-08-02', value: 90.2 },
    { dateISO: '2026-08-03', value: 90.4 },
  ]);
  assert.equal(tooShort.ok, false);
  assert.match(tooShort.reason, /at least 14 days/);
});

test('a trend reports its slope, its span and how well the line fits', () => {
  const points = Array.from({ length: 21 }, (_, i) => ({
    dateISO: `2026-08-${String(i + 1).padStart(2, '0')}`,
    value: 90 + i * 0.05,
  }));

  const result = trend(points);
  assert.equal(result.ok, true);
  close(result.perWeek, 0.35, 1e-9);
  assert.equal(result.sampleCount, 21);
  assert.equal(result.spanDays, 20);
  assert.equal(result.fit, 1, 'a perfect line fits perfectly');
  assert.equal(result.confidence, 'good');
});

test('four-week change measures a real interval at both ends', () => {
  // v1 subtracted the value four points ago from the all-time best, hiding a
  // recent decline behind an old peak.
  const points = [
    { dateISO: '2026-07-01', value: 130 },
    { dateISO: '2026-07-15', value: 125 },
    { dateISO: '2026-08-01', value: 122 },
    { dateISO: '2026-08-15', value: 120 },
  ];

  const change = changeOver(points, { weeks: 4 });
  assert.equal(change.ok, true);
  assert.equal(change.to, 120, 'measured from the latest value');
  assert.ok(change.change < 0, 'a decline reads as a decline');
  assert.ok(change.actualDays >= 28);

  assert.equal(changeOver(points.slice(-1), { weeks: 4 }).ok, false, 'no comparable point');
});

/* ── decisions state the real bounds ────────────────────────────────── */

const ramp = (perWeek) =>
  Array.from({ length: 28 }, (_, i) => ({
    dateISO: `2026-08-${String(i + 1).padStart(2, '0')}`,
    value: 90 + i * (perWeek / 7),
  }));

test('the gain-rate verdict compares against the actual band', () => {
  // v1 called 0.20 kg/week "inside the 0.4–0.5 band" — it compared against
  // a quarter of the lower bound while printing the bound itself.
  const verdict = gainRateVerdict(ramp(0.2), { calendarWeek: 1 });
  assert.equal(verdict.ok, true);
  assert.ok(verdict.perWeek < verdict.target.lo, 'below the band');
  assert.equal(verdict.status, 'under');
  assert.equal(verdict.target.lo, GAIN_TARGETS.early.lo);

  assert.equal(gainRateVerdict(ramp(0.45), { calendarWeek: 1 }).status, 'in');
  assert.equal(gainRateVerdict(ramp(0.7), { calendarWeek: 1 }).status, 'over');
  assert.equal(gainRateVerdict(ramp(0.3), { calendarWeek: 20 }).status, 'over', 'the late band is lower');

  assert.equal(gainRateVerdict([], {}).ok, false);
});

test('the band and the action threshold are different numbers', () => {
  // The plan sets a target band of 0.4–0.5 but only prescribes calories below
  // 0.1 and above 0.6. Between the two, waiting is the instruction.
  assert.match(gainRateVerdict(ramp(0.05), { calendarWeek: 1 }).action, /250 kcal/);
  assert.match(gainRateVerdict(ramp(0.8), { calendarWeek: 1 }).action, /300 kcal/);

  const drifting = gainRateVerdict(ramp(0.25), { calendarWeek: 1 });
  assert.equal(drifting.status, 'under');
  assert.doesNotMatch(drifting.action, /kcal/, 'off the band is not the same as off the rails');
  assert.match(drifting.action, /Re-read/);
});

test('the goal is always kilograms, and the projection is a range', () => {
  // v1 projected toward the number 140 then labelled it with the display unit,
  // promising "140 lb" while calculating 308.6.
  const rising = Array.from({ length: 8 }, (_, i) => ({
    dateISO: `2026-0${6 + Math.floor(i / 4)}-${String((i % 4) * 7 + 1).padStart(2, '0')}`,
    value: 120 + i * 1.5,
  }));

  const goal = goalProgress(rising, { goalKg: 140 });
  assert.equal(goal.goalKg, 140, 'kilograms, always');
  assert.ok(goal.remaining > 0);
  assert.ok(goal.projection.lowWeeks < goal.projection.highWeeks, 'a range, never a date');
  assert.ok(goal.confidence);

  const flat = goalProgress([
    { dateISO: '2026-07-01', value: 120 },
    { dateISO: '2026-07-20', value: 120 },
    { dateISO: '2026-08-10', value: 119 },
    { dateISO: '2026-08-20', value: 120 },
    { dateISO: '2026-08-28', value: 120 },
  ]);
  assert.equal(flat.projection, null, 'no projection when nothing is rising');
});

test('block comparison uses chronological endpoints and keeps every lift', () => {
  // v1 took min as "first" and max as "last", so a regression became a gain,
  // and it kept only the first lift it encountered per block.
  const logs = [
    log(1, '2026-08-01', { blockId: 1 }), log(2, '2026-08-20', { blockId: 1 }),
    log(3, '2026-08-02', { blockId: 1 }), log(4, '2026-08-21', { blockId: 1 }),
  ];
  const sets = [
    set(1, 1, { load: 120, reps: 1, rpe: 10 }),
    set(2, 2, { load: 110, reps: 1, rpe: 10 }),
    set(3, 3, { exerciseId: 'dip', load: 30, reps: 8, rpe: 8, bodyweightUsed: 90 }),
    set(4, 4, { exerciseId: 'dip', load: 35, reps: 8, rpe: 8, bodyweightUsed: 90 }),
  ];

  const rows = blockComparison(sets, {
    exercises, logs,
    lifts: [{ id: 'benchComp', name: 'Competition bench press' }, { id: 'dip', name: 'Weighted dip' }],
  });

  const bench = rows.find((r) => r.lift === 'benchComp');
  assert.ok(bench.change < 0, 'a decline is reported as a decline, not converted to a gain');
  assert.equal(bench.first, 120);
  assert.equal(bench.last, 110);
  assert.equal(bench.firstDateISO, '2026-08-01');
  assert.equal(bench.lastDateISO, '2026-08-20');

  const dip = rows.find((r) => r.lift === 'dip');
  assert.ok(dip, 'the second lift is not dropped');
  assert.ok(dip.change > 0);
});

test('records are concrete categories, and isolation e1RM is not one of them', () => {
  const logs = [log(1, '2026-08-01'), log(2, '2026-08-20')];
  const sets = [
    set(1, 1, { load: 100 }),
    set(2, 2, { load: 110 }),
    set(3, 2, { exerciseId: 'lateral', isIndexSet: true, load: 14, reps: 15, rpe: 10 }),
  ];

  const result = records(sets, { exercises, logs });

  const bench = result.estimated.find((r) => r.exerciseId === 'benchComp');
  assert.equal(bench.load, 110, 'the best estimate comes from the heavier set');
  assert.equal(bench.rpe, 8, 'the record keeps the effort of the set that produced it');
  assert.equal(result.estimated.some((r) => r.exerciseId === 'lateral'), false, 'no estimated max on a lateral raise');

  // Heaviest-load records apply to everything, including isolation.
  assert.ok(result.heaviest.some((r) => r.exerciseId === 'lateral'), 'but a heaviest load is always a fact');
});

test('the whole pipeline runs off real records', () => {
  const logs = Array.from({ length: 6 }, (_, i) =>
    log(i + 1, `2026-0${7 + Math.floor(i / 3)}-${String((i % 3) * 10 + 1).padStart(2, '0')}`, { cycleSequence: i + 1 })
  );
  const sets = logs.map((l, i) => set(i + 1, l.id, { load: 100 + i * 2 }));

  const series = strengthSeries(sets, { exercises, logs, exerciseId: 'benchComp' });
  assert.equal(series.sampleCount, 6);
  assert.equal(series.points[0].dateISO, '2026-07-01');
  assert.ok(series.points.every((p, i, all) => i === 0 || p.dateISO >= all[i - 1].dateISO), 'sorted');

  const byCycle = bestPerCycle(series.points);
  assert.equal(byCycle.length, 6);
  assert.equal(trend(series.points).ok, true);
});


test('the rolling mean is a window of days, and several readings on one date do not break it', () => {
  const points = [
    { dateISO: '2026-08-01', value: 90 },
    { dateISO: '2026-08-01', value: 92 },
    { dateISO: '2026-08-02', value: 94 },
    { dateISO: '2026-08-20', value: 100 },
  ];

  const mean = rollingMean(points, 7);
  assert.equal(mean.length, 4);
  assert.equal(mean[0].value, 90);
  assert.equal(mean[1].value, 91, 'two readings on the same day both count');
  assert.equal(mean[2].value, 92, '(90 + 92 + 94) / 3');
  assert.equal(mean[3].value, 100, 'a reading 18 days later stands alone');
  assert.deepEqual(mean.map((m) => m.samples), [1, 2, 3, 1]);
});
