/**
 * Numbers you can trust: every figure that claims a max agrees with the others,
 * and every set that cannot speak for strength is set aside with its reason.
 *
 * Each test names the defect it prevents. Most come from the November audit of
 * his real export, where the same bench press had five different "maxes"
 * depending on which screen asked.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { withSharedLibrary } from '../js/plans.js';
import { newCycle } from '../js/cycle.js';
import { slotsFor, rowValues } from '../js/ui/train.js';
import { maxRows } from '../js/ui/progress.js';
import {
  eligibleForStrength,
  strengthSeries,
  records,
  recordHistory,
  bestEstimates,
  recentEvidenceMax,
  sessionAnalysis,
  personalBestBefore,
  bestPerCycle,
  blockComparison,
} from '../js/analytics.js';

const load = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const FOPIP = load('data/plan-fopip-v2.json');
const FLOPIP = load('data/plan-flopip-2.json');
const exercises = { ...FOPIP.exercises, ...FLOPIP.exercises };

const log = (id, dateISO, extra = {}) => ({
  id, dateISO, localDate: dateISO, cycleSequence: 4, blockId: 3, effortMode: 'standard', sessionId: 'E',
  planId: 'flopip-2', ...extra,
});
const bench = (id, sessionLogId, extra = {}) => ({
  id, sessionLogId, exerciseId: 'benchComp', isIndexSet: true, load: 100, reps: 5, rpe: 8, ...extra,
});

/* ═══════════════════════════════════════════════════════════════════════
   H1 · a missed attempt is not a made max
   ═══════════════════════════════════════════════════════════════════════ */

// Prior best 120×1 @8 (130.4). Then 135 attempted and missed: the step sheet
// leaves the prefilled reps 1 and RPE 10, so the stored row reads as a made 1RM.
const h1Logs = [log(1, '2026-10-02'), log(2, '2026-10-09')];
const made = bench(1, 1, { load: 120, reps: 1, rpe: 8 });
const missed = bench(2, 2, { load: 135, reps: 1, rpe: 10, attemptResult: 'missed' });

test('H1: a missed attempt never reaches the strength series, and says why', () => {
  const { included, excluded } = eligibleForStrength([made, missed], { exercises, logs: h1Logs });
  assert.deepEqual(included.map((row) => row.set.id), [1], 'the missed 135 was counted as a made single');
  assert.equal(excluded.find((row) => row.id === 2)?.reason, 'a missed attempt');
  const series = strengthSeries([made, missed], { exercises, logs: h1Logs, exerciseId: 'benchComp' });
  assert.ok(Math.max(...series.points.map((p) => p.value)) < 131);
});

test('H1: a missed attempt claims no record, heaviest or estimated, and no staircase step', () => {
  const out = records([made, missed], { exercises, logs: h1Logs });
  assert.equal(out.heaviest.find((r) => r.exerciseId === 'benchComp').load, 120, 'a weight he failed is not his heaviest');
  assert.ok(out.estimated.find((r) => r.exerciseId === 'benchComp').value < 131);
  const history = recordHistory([made, missed], { exercises, logs: h1Logs });
  assert.ok(history.estimated.benchComp.every((step) => step.load !== 135));
  assert.ok(history.heaviest.benchComp.every((step) => step.load !== 135));
});

test('H1: the best-estimate list and the evidence max ignore a missed attempt', () => {
  const row = bestEstimates([made, missed], { exercises, logs: h1Logs }).find((r) => r.exerciseId === 'benchComp');
  assert.ok(row.value < 131, 'the Plan list showed the missed 135 as a max');
  assert.ok(row.excluded.includes('a missed attempt'), 'the exclusion was silent');
  const evidence = recentEvidenceMax([made, missed], h1Logs, 'benchComp', { todayISO: '2026-10-10' });
  assert.ok(evidence.value < 131, 'prescriptions would be worked out from a failed lift');
});

test('H1: a missed attempt cannot open the "That is a record" sheet', () => {
  const beaten = personalBestBefore({ ...missed, id: undefined }, [made], { exercises, logs: h1Logs });
  assert.equal(beaten, null);
});

test('H1: a session’s best estimate is not its missed attempt', () => {
  const analysis = sessionAnalysis(h1Logs[1], [missed, bench(3, 2, { load: 100, reps: 5, rpe: 8 })], { exercises });
  const row = analysis.exercises.find((r) => r.exerciseId === 'benchComp');
  assert.ok(row.bestEstimate < 124, `bestEstimate ${row.bestEstimate} came from the missed attempt`);
});

/* ═══════════════════════════════════════════════════════════════════════
   H4 · one gate for every number that claims a max
   ═══════════════════════════════════════════════════════════════════════ */

// The audit's case: a measured 125 single, then a week later the fixed-100 kg
// AMRAP ground out to 12 reps at RPE 10. The table calls that 147.1 and four
// pipelines gave four answers: 147.1, 130.2, 136 and a "+16.9 kg record".
const h4Logs = [log(1, '2026-11-06'), log(2, '2026-11-13', { cycleSequence: 5 })];
const single = bench(1, 1, { load: 125, reps: 1, rpe: 10 });
const amrap = bench(2, 2, { load: 100, reps: 12, rpe: 10, isAmrap: true, isIndexSet: false });
const amrapIndexed = { ...amrap, isIndexSet: true };

test('H4: a measured single outranks an estimate in the same window, and the gap is reported', () => {
  const row = bestEstimates([single, amrap], { exercises, logs: h4Logs }).find((r) => r.exerciseId === 'benchComp');
  assert.equal(row.value, 125, 'the Plan list ranked a 12-rep estimate above a weight he pressed');
  assert.ok(row.disagreement, 'a 17.7% disagreement was not reported');
  assert.ok(row.disagreement.pct > 15 && row.disagreement.pct < 20);
  assert.equal(row.disagreement.estimate.reps, 12);
});

test('H4: every pipeline that claims a bench max gives the same answer for the same sets', () => {
  const sets = [single, amrapIndexed];
  const series = strengthSeries(sets, { exercises, logs: h4Logs, exerciseId: 'benchComp' });
  const best = Math.max(...series.points.map((p) => p.value));
  const record = records(sets, { exercises, logs: h4Logs }).estimated.find((r) => r.exerciseId === 'benchComp');
  const listed = bestEstimates(sets, { exercises, logs: h4Logs }).find((r) => r.exerciseId === 'benchComp');
  const evidence = recentEvidenceMax(sets, h4Logs, 'benchComp', { todayISO: '2026-11-18' });
  const history = recordHistory(sets, { exercises, logs: h4Logs }).estimated.benchComp;

  assert.equal(best, 125, 'strength series');
  assert.equal(record.value, 125, 'records');
  assert.equal(listed.value, 125, 'best-estimate list');
  assert.equal(evidence.value, 125, 'evidence max — this one moves prescriptions');
  assert.equal(history[history.length - 1].value, 125, 'record staircase');
  assert.ok(series.disagreements.length === 1, 'the series hid the disagreement');
  const excluded = series.excluded.find((row) => row.id === 2);
  assert.match(excluded.reason, /measured single/, 'the AMRAP vanished without a reason');
});

test('H4: an AMRAP a week after a measured single opens no record sheet', () => {
  const beaten = personalBestBefore({ ...amrapIndexed, id: undefined, localDate: '2026-11-13' }, [single], { exercises, logs: h4Logs });
  assert.equal(beaten, null, 'the "+16.9 kg record" sheet came from a 12-rep estimate');
});

test('H4: a set with no RPE never claims a record — no RPE 8 is invented for it', () => {
  // v1 mapped a missing RPE onto the RPE 8 column, which calc.js itself calls
  // a fabricated record. The PR check and session analysis still did it.
  const prior = bench(1, 1, { load: 100, reps: 5, rpe: 8 });
  const unrated = { exerciseId: 'benchComp', isIndexSet: true, load: 110, reps: 5, rpe: null, localDate: '2026-11-13' };
  assert.equal(personalBestBefore(unrated, [prior], { exercises, logs: h4Logs }), null);
  const analysis = sessionAnalysis(h4Logs[1], [{ ...unrated, id: 9, sessionLogId: 2 }], { exercises });
  assert.equal(analysis.exercises[0].bestEstimate, null, 'session analysis estimated an unrated set at RPE 8');
});

test('H4: a form-breakdown set cannot open the record sheet', () => {
  const prior = bench(1, 1, { load: 100, reps: 5, rpe: 8 });
  const ground = { exerciseId: 'benchComp', isIndexSet: true, load: 115, reps: 5, rpe: 9, formBreakdown: true, localDate: '2026-11-13' };
  assert.equal(personalBestBefore(ground, [prior], { exercises, logs: h4Logs }), null);
});

test('H4: a set that is not an index set or a measured single claims no record', () => {
  const prior = bench(1, 1, { load: 100, reps: 5, rpe: 8 });
  const backoff = { exerciseId: 'benchComp', isIndexSet: false, load: 105, reps: 5, rpe: 8, localDate: '2026-11-13' };
  assert.equal(personalBestBefore(backoff, [prior], { exercises, logs: h4Logs }), null, 'the Records card would not list it');
  const beaten = personalBestBefore({ ...backoff, isIndexSet: true }, [prior], { exercises, logs: h4Logs });
  assert.ok(beaten && beaten.gain > 0, 'a genuine index-set record still celebrates');
});

test('H4: the record staircase ignores form-breakdown sets too, as the Records card does', () => {
  const ground = bench(3, 2, { load: 140, reps: 1, rpe: 10, formBreakdown: true });
  const history = recordHistory([single, ground], { exercises, logs: h4Logs });
  assert.ok(history.heaviest.benchComp.every((step) => step.load !== 140));
  assert.ok(history.estimated.benchComp.every((step) => step.load !== 140));
});

test('H4: the evidence max prefers measured singles in its window over the median of estimates', () => {
  const sets = [single, bench(3, 2, { load: 110, reps: 5, rpe: 9 })]; // ≈ 129.9 estimate
  const evidence = recentEvidenceMax(sets, h4Logs, 'benchComp', { todayISO: '2026-11-18' });
  assert.equal(evidence.value, 125);
  assert.equal(evidence.source, 'measured-single');
});

test('H1: back-offs are not worked out from a missed single', () => {
  // The back-off basis is today's single. A missed attempt keeps the prefilled
  // 1 rep @10, so a failed 135 would set the back-offs as if he had pressed it.
  const [, plan] = withSharedLibrary([FOPIP, FLOPIP]);
  const state = {
    plan,
    cycle: newCycle(plan, { sequence: 4, startedAtISO: null, localStartDate: null }),
    trainSessionId: 'E', readiness: 'normal',
    deviations: { swaps: {}, extras: [], addedSets: {}, exerciseNotes: {}, phaseSwaps: {} },
    loggedSets: new Map(), exOpen: new Set(), cleared: new Set(), grips: {},
    settings: { unit: 'kg', increment: 2.5, bodyweight: 90 },
    maxes: new Map([['benchComp', { exerciseId: 'benchComp', workingMax: 125 }]]),
    sets: [], logs: [], todayISO: '2026-10-10', lastByExercise: new Map(), activeLog: { id: 99 },
  };
  const slots = slotsFor(state);
  const b = slots.findIndex((slot) => slot.id === 'E3');
  const before = rowValues(state, slots[b], b, 0).prescribed;
  state.loggedSets.set('0:0', {
    exerciseId: 'benchComp', slotIndex: 0, setIndex: 0, load: 135, reps: 1, rpe: 10, attemptResult: 'missed',
  });
  assert.equal(rowValues(state, slotsFor(state)[b], b, 0).prescribed, before);
});

/* ═══════════════════════════════════════════════════════════════════════
   H3 · the test single is the measurement, not a "deload" set
   ═══════════════════════════════════════════════════════════════════════ */

// FLOPIP rotation 3 is "Taper and test": no failure wave, so effortMode 'none'.
// Every set in it was rejected as "deload rotation" — including the test
// single, the most important measurement of the block.
const testWeek = log(10, '2026-10-23', { cycleSequence: 3, blockId: 2, effortMode: 'none' });
const testSingle = bench(10, 10, { load: 130, reps: 1, rpe: 10 });

test('H3: a test-week single reaches the strength series', () => {
  const series = strengthSeries([testSingle], { exercises, logs: [testWeek], exerciseId: 'benchComp' });
  assert.deepEqual(series.points.map((p) => p.value), [130], 'the test single was dropped as a deload set');
  assert.equal(series.points[0].reducedVolume, true, 'the point should still say it came from a reduced-volume week');
});

test('H3: a made attempt in a reduced-volume rotation counts even without an index flag', () => {
  const madeAttempt = { ...testSingle, isIndexSet: false, rpe: 9.5, attemptResult: 'made' };
  const { included } = eligibleForStrength([madeAttempt], { exercises, logs: [testWeek] });
  assert.equal(included.length, 1);
});

test('H3: an ordinary triple in a recovery rotation is still set aside, with an honest reason', () => {
  const recovery = log(11, '2026-08-05', { planId: 'fopip-v2', cycleSequence: 15, blockId: 3, effortMode: 'none' });
  const triple = bench(11, 11, { load: 95, reps: 3, rpe: 6 });
  const { included, excluded } = eligibleForStrength([triple], { exercises, logs: [recovery] });
  assert.equal(included.length, 0);
  assert.match(excluded[0].reason, /reduced-volume rotation/);
});

/* ═══════════════════════════════════════════════════════════════════════
   M2 · rotations and blocks belong to a plan
   ═══════════════════════════════════════════════════════════════════════ */

// FOPIP rotation 5 was in September; FLOPIP rotation 5 in November. Keyed on
// the number alone they shared a bucket, the series ran r4 = Nov then r5 = Aug,
// the trend read "10/09 to 10/02, -7 days" and its lines left the card.
const m2Logs = [
  log(20, '2026-09-18', { planId: 'fopip-v2', cycleSequence: 5, blockId: 1 }),
  log(21, '2026-10-30', { planId: 'flopip-2', cycleSequence: 4, blockId: 3 }),
  log(22, '2026-11-13', { planId: 'flopip-2', cycleSequence: 5, blockId: 3 }),
  log(23, '2026-09-01', { planId: 'fopip-v2', cycleSequence: 3, blockId: 1 }),
];
const m2Sets = [
  bench(20, 20, { load: 110, reps: 5, rpe: 9 }),
  bench(21, 21, { load: 100, reps: 5, rpe: 8 }),
  bench(22, 22, { load: 102.5, reps: 5, rpe: 8 }),
  bench(23, 23, { load: 100, reps: 5, rpe: 8.5 }),
];

test('M2: one bucket per plan and rotation, in date order', () => {
  const { points } = strengthSeries(m2Sets, { exercises, logs: m2Logs, exerciseId: 'benchComp' });
  const perCycle = bestPerCycle(points);
  assert.equal(perCycle.length, 4, 'FOPIP r5 and FLOPIP r5 were merged into one bucket');
  const dates = perCycle.map((p) => p.dateISO);
  assert.deepEqual(dates, [...dates].sort(), 'rotations from two plans were ordered by number, not by date');
  assert.deepEqual(perCycle.map((p) => p.planId), ['fopip-v2', 'fopip-v2', 'flopip-2', 'flopip-2']);
});

test('M2: blocks with the same number in two plans are two blocks', () => {
  const logs = [
    log(30, '2026-08-20', { planId: 'fopip-v2', blockId: 3 }), log(31, '2026-08-25', { planId: 'fopip-v2', blockId: 3 }),
    log(32, '2026-10-30', { planId: 'flopip-2', blockId: 3 }), log(33, '2026-11-06', { planId: 'flopip-2', blockId: 3 }),
  ];
  const sets = [
    bench(30, 30, { load: 100 }), bench(31, 31, { load: 105 }),
    bench(32, 32, { load: 90 }), bench(33, 33, { load: 92.5 }),
  ];
  const rows = blockComparison(sets, { exercises, logs, lifts: [{ id: 'benchComp', name: 'Bench' }] });
  assert.equal(rows.length, 2, 'FOPIP block 3 (recovery) merged with FLOPIP block 3 (accumulation)');
  assert.deepEqual(rows.map((r) => r.planId), ['fopip-v2', 'flopip-2'], 'rows are in date order');
  assert.ok(rows.every((r) => r.sampleCount === 2));
});

test('M2: rotation volume is counted per plan and rotation, in date order', async () => {
  const { volumeByRotation } = await import('../js/volume.js');
  const groups = volumeByRotation(m2Sets, m2Logs, { exercises, muscles: FLOPIP.muscles });
  assert.equal(groups.length, 4, 'FOPIP rotation n and FLOPIP rotation n were added together');
  assert.deepEqual(
    groups.map((g) => `${g.planId}:${g.cycleSequence}`),
    ['fopip-v2:3', 'fopip-v2:5', 'flopip-2:4', 'flopip-2:5']
  );
  assert.ok(groups.every((g) => g.values.Chest > 0));
});

test('M2: the working-max review reads only the active plan’s rotations', () => {
  const [, plan] = withSharedLibrary([FOPIP, FLOPIP]);
  const state = {
    plan,
    settings: { unit: 'kg', bodyweight: 90 },
    block: { idx: 3, from: 4, to: 10, name: 'Accumulation' },
    cycle: { sequence: 5 },
    maxes: new Map([['benchComp', { exerciseId: 'benchComp', workingMax: 125 }]]),
    sets: m2Sets,
    logs: m2Logs,
    todayISO: '2026-11-18',
    activeLog: null,
  };
  const row = maxRows(state).find((r) => r.id === 'benchComp');
  assert.deepEqual(
    row.observations.map((o) => o.dateISO),
    ['2026-10-30', '2026-11-13'],
    'September FOPIP sets entered a FLOPIP block review'
  );
});

/* ═══════════════════════════════════════════════════════════════════════
   M4 · one gain-rate verdict, with its minimum sample rules
   ═══════════════════════════════════════════════════════════════════════ */

const weighIns = (values, from = '2026-11-01', stepDays = 1) =>
  values.map((value, i) => {
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i * stepDays);
    return { dateISO: d.toISOString().slice(0, 10), value };
  });

test('M4: two weigh-ins raise no gain-rate flag (the verdict says it needs more)', async () => {
  // 91.0 then 91.6 three days later: the tile read "needs a few weigh-ins"
  // while the flag beside it said "Gaining faster than target — cut 300 kcal".
  const { decisionFlags } = await import('../js/progress.js');
  const { gainRateVerdict } = await import('../js/analytics.js');
  const bodyweight = weighIns([91.0, 91.6], '2026-11-01', 3);
  const gain = gainRateVerdict(bodyweight, { calendarWeek: 6 });
  assert.equal(gain.ok, false);
  const flags = decisionFlags({ gain, strength: { ok: false }, calendarWeek: 6 });
  assert.ok(!flags.some((f) => /gain/i.test(f.title)), JSON.stringify(flags));
});

test('M4: the gain flag says what the verdict says, never something else', async () => {
  const { decisionFlags } = await import('../js/progress.js');
  const { gainRateVerdict } = await import('../js/analytics.js');
  for (const perDay of [0, 0.03, 0.065, 0.2]) {
    const bodyweight = weighIns(Array.from({ length: 21 }, (_, i) => 90 + perDay * i));
    const gain = gainRateVerdict(bodyweight, { calendarWeek: 6 });
    assert.ok(gain.ok);
    const flag = decisionFlags({ gain, strength: { ok: false }, calendarWeek: 6 }).find((f) => f.metric === 'gain');
    assert.ok(flag, `no gain flag at ${perDay} kg/day`);
    assert.equal(flag.status, gain.status);
    assert.ok(flag.detail.includes(gain.action), 'the flag gave different advice from the verdict');
  }
});

test('M4: "e1RM flat while gaining" needs a real strength trend, not four points', async () => {
  const { decisionFlags } = await import('../js/progress.js');
  const { gainRateVerdict } = await import('../js/analytics.js');
  const gain = gainRateVerdict(weighIns(Array.from({ length: 21 }, (_, i) => 90 + 0.06 * i)), { calendarWeek: 6 });
  const tooFew = decisionFlags({ gain, strength: { ok: false, reason: 'needs at least 3 points' }, calendarWeek: 6 });
  assert.ok(!tooFew.some((f) => /flat/.test(f.title)));
  const flat = decisionFlags({ gain, strength: { ok: true, perWeek: -0.2, sampleCount: 6 }, calendarWeek: 6 });
  assert.ok(flat.some((f) => /flat/.test(f.title)));
});

test('M4: the Body screen’s rate is the same verdict, not a slope from two readings', async () => {
  const { view } = await import('../js/ui/body.js');
  const state = {
    settings: { unit: 'kg' },
    bodyDraft: { dateISO: '2026-11-04' },
    daily: [
      { id: 1, dateISO: '2026-11-01', bodyweight: 91.0 },
      { id: 2, dateISO: '2026-11-04', bodyweight: 91.6 },
    ],
    measurements: [], niggles: [], media: [], shut: new Set(), todayISO: '2026-11-04',
  };
  const html = view({ state });
  assert.ok(!/kg\/week/.test(html), 'Body printed a weekly rate from two weigh-ins');
});

/* ═══════════════════════════════════════════════════════════════════════
   L10 · the review compares against the number prescriptions use
   ═══════════════════════════════════════════════════════════════════════ */

test('L10: the working-max review uses the same max as the prescriptions', async () => {
  const { workingMaxInfo } = await import('../js/ui/train.js');
  const [, plan] = withSharedLibrary([FOPIP, FLOPIP]);
  const logs = [log(40, '2026-11-06', { cycleSequence: 4 })];
  const sets = [
    { id: 40, sessionLogId: 40, exerciseId: 'benchClose', isIndexSet: true, load: 100, reps: 5, rpe: 8 },
    { id: 41, sessionLogId: 40, exerciseId: 'inclineSmith', isIndexSet: true, load: 70, reps: 8, rpe: 9 },
  ];
  const state = {
    plan,
    settings: { unit: 'kg', bodyweight: 90 },
    block: { idx: 3, from: 4, to: 10, name: 'Accumulation' },
    cycle: { sequence: 5 },
    maxes: new Map([['benchComp', { exerciseId: 'benchComp', workingMax: 125 }]]),
    sets,
    logs,
    todayISO: '2026-11-18',
    activeLog: null,
  };
  for (const id of ['benchClose', 'inclineSmith']) {
    const row = maxRows(state).find((r) => r.id === id);
    assert.ok(row, `${id} is not in the review`);
    assert.equal(
      row.workingMax,
      workingMaxInfo(state, id).value,
      `${id}: the review proposed changes against a number no prescription uses`
    );
  }
});
