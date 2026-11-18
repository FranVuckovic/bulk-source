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

/* ═══════════════════════════════════════════════════════════════════════
   Plausibility · a typo is asked about, never refused
   ═══════════════════════════════════════════════════════════════════════ */

test('plausibility: a 97 kg weigh-in among 91s is asked about, in plain words', async () => {
  // QA H2: 97 saved silently when yesterday was 91.05, and the rate moved.
  const { checkWeighIn } = await import('../js/plausibility.js');
  const earlier = weighIns([91.0, 91.2, 90.9, 91.05], '2026-11-14');
  const result = checkWeighIn(97, earlier, { dateISO: '2026-11-18' });
  assert.equal(result.ok, false);
  assert.match(result.message, /^Save 97 kg\? That's 6 kg above your 7-day average of 91 kg\.$/);
  assert.equal(checkWeighIn(91.6, earlier, { dateISO: '2026-11-18' }).ok, true, 'an ordinary day was questioned');
  assert.equal(checkWeighIn(9.1, [], {}).ok, false, 'a missing decimal point with no history went through');
  assert.equal(checkWeighIn(91.6, [], {}).ok, true, 'a first weigh-in has nothing to be compared with');
});

test('plausibility: the tape typos in his data would each have been asked about', async () => {
  const { checkTape } = await import('../js/plausibility.js');
  // Each of these is in the November export.
  assert.equal(checkTape('chest', 408.7, 110).ok, false);
  assert.equal(checkTape('armL', 3492, 38).ok, false);
  assert.equal(checkTape('quadR', 26.5, 62).ok, false);
  assert.equal(checkTape('armRFlex', 97.1, 41).ok, false);
  assert.equal(checkTape('forearmL', 91, 31).ok, false);
  // QA H2: chest 1095.
  assert.equal(checkTape('chest', 1095, 110).ok, false);
  // More than 10% from the last reading, inside the range.
  const jump = checkTape('waist', 95, 84, { label: 'Waist' });
  assert.equal(jump.ok, false);
  assert.match(jump.message, /^Save Waist 95 cm\? That's 13% above your last reading of 84 cm\.$/);
  assert.equal(checkTape('waist', 85, 84).ok, true);
});

test('plausibility: a working max far from the current one, or past any barbell, is asked about', async () => {
  // QA H2: 1300 for 130 saved, and session E prescribed 1197.5 kg × 1.
  const { checkWorkingMax } = await import('../js/plausibility.js');
  assert.equal(checkWorkingMax(1300, 125).ok, false);
  assert.equal(checkWorkingMax(1300, null).ok, false, 'no current max is no excuse for 1300');
  const drop = checkWorkingMax(100, 125, { name: 'Competition bench' });
  assert.equal(drop.ok, false);
  assert.match(drop.message, /20% below the 125 kg every load uses now/);
  assert.equal(checkWorkingMax(127.5, 125).ok, true, 'a normal 2.5 kg step was questioned');
});

test('plausibility: a set at 1025 for 102.5, or 80 reps on a bench, is asked about', async () => {
  const { checkSet } = await import('../js/plausibility.js');
  const benchComp = exercises.benchComp;
  assert.equal(checkSet({ load: 1025, reps: 5, exercise: benchComp, bestKg: 130 }).ok, false);
  assert.equal(checkSet({ load: 102.5, reps: 5, exercise: benchComp, bestKg: 130 }).ok, true);
  assert.equal(checkSet({ load: 60, reps: 80, exercise: benchComp, bestKg: 130 }).ok, false);
  assert.equal(checkSet({ load: 10, reps: 80, exercise: exercises.lateral, bestKg: 14 }).ok, true, 'isolation high reps are normal');
  assert.equal(checkSet({ load: 100, reps: 5, exercise: benchComp, bestKg: null }).ok, true, 'no history, no comparison');
});

test('plausibility: every check takes a formatter, so pounds mode says pounds', async () => {
  const { checkWeighIn } = await import('../js/plausibility.js');
  const lb = (kg) => `${Math.round(kg * 2.20462)} lb`;
  const result = checkWeighIn(97, weighIns([91, 91, 91], '2026-11-15'), { dateISO: '2026-11-18', fmt: lb });
  assert.match(result.message, /^Save 214 lb\? That's 13 lb above your 7-day average of 201 lb\.$/);
});

/** Just enough of a page for a sheet to open and close, and for an input to be read. */
function withFakeDocument(run, inputs = {}) {
  const previous = globalThis.document;
  const node = () => ({
    innerHTML: '',
    classList: { on: false, add() { this.on = true; }, remove() { this.on = false; }, contains() { return this.on; } },
  });
  const nodes = { pan: node(), sheet: node() };
  globalThis.document = {
    getElementById: (id) => nodes[id] || (id in inputs ? { value: inputs[id] } : null),
    querySelector: () => null,
  };
  return Promise.resolve(run(nodes)).finally(() => {
    globalThis.document = previous;
  });
}

test('plausibility: a 97 kg weigh-in asks "Save / Fix" first, and Save still saves it', async () => {
  const { actions } = await import('../js/ui/body.js');
  const saved = [];
  const ctx = {
    state: {
      bodyDraft: { dateISO: '2026-11-18', bodyweight: '97', bodyfatPct: '15', sleepHours: '8' },
      settings: { unit: 'kg' },
      daily: weighIns([91.0, 91.2, 90.9, 91.05], '2026-11-14').map((p, i) => ({ id: i, dateISO: p.dateISO, bodyweight: p.value })),
    },
    toKg: Number,
    saveDaily: async (row) => saved.push(row),
  };
  await withFakeDocument(async (nodes) => {
    await actions['save-daily'](ctx);
    assert.equal(saved.length, 0, 'saved without asking');
    assert.match(nodes.pan.innerHTML, /Save 97 kg\? That's 6 kg above your 7-day average/);
    assert.match(nodes.pan.innerHTML, />Save</);
    assert.match(nodes.pan.innerHTML, />Fix</);
    await actions['confirm-body-save'](ctx);
    assert.equal(saved.length, 1, 'Save did not save — the check must never block');
    assert.equal(saved[0].bodyweight, 97);
  });
});

test('plausibility: an ordinary weigh-in saves with no question', async () => {
  const { actions } = await import('../js/ui/body.js');
  const saved = [];
  const ctx = {
    state: {
      bodyDraft: { dateISO: '2026-11-18', bodyweight: '91.4', bodyfatPct: '15', sleepHours: '8' },
      settings: { unit: 'kg' },
      daily: weighIns([91.0, 91.2], '2026-11-16').map((p, i) => ({ id: i, dateISO: p.dateISO, bodyweight: p.value })),
    },
    toKg: Number,
    saveDaily: async (row) => saved.push(row),
  };
  await withFakeDocument(async () => {
    await actions['save-daily'](ctx);
    assert.equal(saved.length, 1);
  });
});

test('plausibility: a tape typo asks before saving', async () => {
  const { actions, MEASUREMENT_SITES } = await import('../js/ui/body.js');
  const saved = [];
  const draft = { dateISO: '2026-11-18', measureTime: 'morning' };
  for (const [id] of MEASUREMENT_SITES) draft[`m-${id}`] = '40';
  draft['m-chest'] = '1095';
  const ctx = {
    state: { bodyDraft: draft, settings: { unit: 'kg' }, measurements: [{ id: 1, dateISO: '2026-11-10', chest: 110 }] },
    saveMeasurements: async (row) => saved.push(row),
  };
  await withFakeDocument(async (nodes) => {
    await actions['save-measurements'](ctx);
    assert.equal(saved.length, 0);
    assert.match(nodes.pan.innerHTML, /Save Chest 1095 cm\?/);
  });
});

test('plausibility: a 1300 kg working max asks first; Save keeps what he typed', async () => {
  const { actions } = await import('../js/ui/settings.js');
  const [, plan] = withSharedLibrary([FOPIP, FLOPIP]);
  const written = [];
  const ctx = {
    state: {
      plan, settings: { unit: 'kg' }, sets: [], logs: [], todayISO: '2026-11-18', activeLog: null,
      maxes: new Map([['benchComp', { exerciseId: 'benchComp', workingMax: 125 }]]),
    },
    confirmMax: async (id, kg) => written.push([id, kg]),
    render() {},
  };
  await withFakeDocument(async (nodes) => {
    await actions['save-max'](ctx, { id: 'benchComp' });
    assert.equal(written.length, 0, '1300 became the working max with no question');
    assert.match(nodes.pan.innerHTML, /Set Competition bench press to 1300 kg\?/);
    await actions['save-max-confirmed'](ctx, { id: 'benchComp', value: '1300' });
    assert.deepEqual(written, [['benchComp', 1300]]);
  }, { 'max-value': '1300' });
});

/* ═══════════════════════════════════════════════════════════════════════
   QA H3 · typos already stored are left out of trends, with the reason
   ═══════════════════════════════════════════════════════════════════════ */

test('QA H3: his stored tape typos are left out of the series and named, never deleted', async () => {
  const { measurementSeries } = await import('../js/analytics.js');
  const tape = [
    { id: 1, dateISO: '2026-08-30', chest: 106, armL: 38, armRFlex: 41, forearmL: 31, quadR: 26.5 },
    { id: 2, dateISO: '2026-09-02', chest: 106.5, armL: 38.2, armRFlex: 97.1, forearmL: 91, quadR: 61 },
    { id: 3, dateISO: '2026-09-20', chest: 107, armL: 38.4, armRFlex: 41.5, forearmL: 31.2, quadR: 61.5 },
    { id: 4, dateISO: '2026-10-20', chest: 107.5, armL: 3492, armRFlex: 41.8, forearmL: 31.3, quadR: 62 },
    { id: 5, dateISO: '2026-10-23', chest: 408.7, armL: 38.8, armRFlex: 42, forearmL: 31.5, quadR: 62.2 },
    { id: 6, dateISO: '2026-11-10', chest: 108, armL: 39, armRFlex: 42.1, forearmL: 31.6, quadR: 62.5 },
  ];
  const typos = { chest: 408.7, armL: 3492, armRFlex: 97.1, forearmL: 91, quadR: 26.5 };
  for (const [site, typo] of Object.entries(typos)) {
    const series = measurementSeries(tape, site);
    assert.ok(!series.points.some((p) => p.value === typo), `${site} ${typo} was plotted`);
    const why = series.excluded.find((row) => row.value === typo);
    assert.ok(why?.reason, `${site} ${typo} was dropped without a reason`);
    assert.equal(series.points.length, 5, `${site}: a real reading was thrown out with the typo`);
  }
  assert.equal(tape[4].chest, 408.7, 'the stored reading was changed');
});

test('QA H3: a 97 kg reading among 91s is left out of the bodyweight trend, with its reason', async () => {
  const { bodyweightSeries, gainRateVerdict } = await import('../js/analytics.js');
  const daily = weighIns([91.0, 91.1, 91.2, 91.1, 97, 91.3, 91.2, 91.4, 91.5, 91.4, 91.6, 91.5, 91.7, 91.8, 91.7], '2026-11-01')
    .map((p, i) => ({ id: i, dateISO: p.dateISO, bodyweight: p.value }));
  const series = bodyweightSeries(daily);
  assert.ok(!series.points.some((p) => p.value === 97));
  assert.match(series.excluded[0].reason, /kg from/);
  const clean = gainRateVerdict(series.points);
  assert.ok(clean.perWeek < 0.5, `one typo still moved the rate to ${clean.perWeek}`);
  const steady = bodyweightSeries(weighIns([86, 86.5, 87, 87.4, 88, 88.5, 89], '2026-08-01', 7)
    .map((p, i) => ({ id: i, dateISO: p.dateISO, bodyweight: p.value })));
  assert.equal(steady.excluded.length, 0, 'a real 3 kg gain over seven weeks was called a typo');
});

/* ═══════════════════════════════════════════════════════════════════════
   M9 · a made attempt's working max is checked, and undone with it
   ═══════════════════════════════════════════════════════════════════════ */

test('M9: only becoming made, or a new load, writes the working max — not a note edit', async () => {
  const { attemptMaxEffect } = await import('../js/calc.js');
  const made = { id: 7, exerciseId: 'benchComp', load: 127.5, reps: 1, attemptResult: 'made' };
  assert.equal(attemptMaxEffect(undefined, made), 'write', 'a new made attempt');
  assert.equal(attemptMaxEffect({ ...made, attemptResult: null }, made), 'write', 'marked made later');
  assert.equal(attemptMaxEffect(made, { ...made, note: 'felt fast' }), 'none', 'a note edit appended another history row');
  assert.equal(attemptMaxEffect(made, { ...made, load: 130 }), 'write', 'a corrected load');
  assert.equal(attemptMaxEffect(made, { ...made, attemptResult: 'missed' }), 'revert', 'un-made left its max in place');
  assert.equal(attemptMaxEffect(made, { ...made, deletedAtISO: '2026-11-18T10:00:00Z' }), 'revert', 'deleted left its max in place');
  assert.equal(attemptMaxEffect({ ...made, attemptResult: 'missed' }, { ...made, attemptResult: 'missed', note: 'x' }), 'none');
});

test('M9: undoing an attempt restores the max that was in force before it', async () => {
  const { maxBeforeAttempt } = await import('../js/calc.js');
  const history = [
    { id: 1, setAtISO: '2026-09-04T17:00:00Z', workingMax: 120, sourceSetId: 403 },
    { id: 2, setAtISO: '2026-09-11T17:00:00Z', workingMax: 122.5, sourceSetId: 566 },
    { id: 3, setAtISO: '2026-09-15T08:00:00Z', workingMax: 123, sourceSetId: null }, // set in Settings
    { id: 4, setAtISO: '2026-09-18T17:00:00Z', workingMax: 1325, sourceSetId: 748 }, // the typo
    { id: 5, setAtISO: '2026-09-18T17:01:00Z', workingMax: 132.5, sourceSetId: 748 }, // load corrected
  ];
  const current = { exerciseId: 'benchComp', workingMax: 132.5, sourceSetId: 748 };
  assert.deepEqual(maxBeforeAttempt(history, current, 748), { workingMax: 123, sourceSetId: null });
  assert.equal(maxBeforeAttempt(history, current, 566), null, 'a later max replaced it — undoing 566 must change nothing');
  assert.deepEqual(
    maxBeforeAttempt([{ id: 1, setAtISO: 'x', workingMax: 120, sourceSetId: 9 }], { workingMax: 120, sourceSetId: 9 }, 9),
    { workingMax: null, sourceSetId: null },
    'with nothing before it, the max is cleared rather than left'
  );
});

test('M9: every path that un-makes or deletes a set goes through the attempt rule (wiring)', () => {
  // Written, tested and then not called is how two defects in this app
  // shipped. These are the four ways a made attempt stops being one.
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const body = (name) => {
    const start = app.search(new RegExp(`(async function ${name}\\(|async ${name}\\()`));
    assert.ok(start >= 0, `${name} not found`);
    const ends = ['\n}\n', '\n  },\n'].map((end) => app.indexOf(end, start)).filter((i) => i > 0);
    return app.slice(start, Math.min(...ends));
  };
  assert.match(body('saveSet'), /applyAttemptMax\(existing, written\)/, 'saveSet');
  assert.match(body('removeSet'), /applyAttemptMax\(/, 'Remove this set');
  assert.match(body('deleteSet'), /applyAttemptMax\(/, 'delete from the Log');
  assert.match(body('repairSet'), /applyAttemptMax\(/, 'Fix this set');
  assert.match(body('deleteEntry'), /applyAttemptMax\(/, 'deleting the whole session');
  assert.doesNotMatch(app, /if \(written\.attemptResult === 'made'/, 'the unconditional write is back');
});

/* ═══════════════════════════════════════════════════════════════════════
   M5 · the bodyweight on a pull-up is his weight that week
   ═══════════════════════════════════════════════════════════════════════ */

test('M5: bodyweight lifts use the 7-day average nearest the set, not a frozen setting', async () => {
  // All 116 chin-up, pull-up and dip sets stored 90 kg while he went from 86
  // to 93 — a 4.6 kg drift built into every one of those estimates.
  const { bodyweightOn } = await import('../js/analytics.js');
  const daily = [
    ...weighIns([86.0, 86.2, 86.1, 86.3], '2026-08-20'),
    ...weighIns([92.8, 93.0, 93.1, 92.9], '2026-11-14'),
  ].map((p, i) => ({ id: i, dateISO: p.dateISO, bodyweight: p.value }));
  assert.ok(Math.abs(bodyweightOn(daily, '2026-08-23', 90) - 86.15) < 0.01, 'August used 90');
  assert.ok(Math.abs(bodyweightOn(daily, '2026-11-18', 90) - 92.95) < 0.01, 'November used 90');
  assert.equal(bodyweightOn(daily, '2026-10-01', 90), 90, 'no weigh-in within a week: the setting, not a guess');
  assert.equal(bodyweightOn([], '2026-10-01', 90), 90);
  const withTypo = [...daily, { id: 99, dateISO: '2026-11-18', bodyweight: 9.3 }];
  assert.ok(bodyweightOn(withTypo, '2026-11-18', 90) > 90, 'a stored typo became the bodyweight on a set');
});

test('M5: saving a set reads the weigh-ins, not only the setting (wiring)', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /bodyweightUsed: [^\n]*bodyweightLoaded \? bodyweightOn\(state\.daily/, 'saveSet still stamps the setting');
});

test('M5: a record on a dip says the bodyweight that set used, not today’s setting', () => {
  const dipLogs = [log(50, '2026-08-25')];
  const dip = { id: 50, sessionLogId: 50, exerciseId: 'dip', isIndexSet: true, load: 20, reps: 5, rpe: 8, bodyweightUsed: 86 };
  const row = records([dip], { exercises, logs: dipLogs }).estimated.find((r) => r.exerciseId === 'dip');
  assert.equal(row.bodyweightUsed, 86);
});

/* ═══════════════════════════════════════════════════════════════════════
   L9 / UI-06 · "Fix this set" corrects the set, not just one field of it
   ═══════════════════════════════════════════════════════════════════════ */

test('L9: moving a set to another exercise recomputes what belonged to the old one', async () => {
  const { correctionFor } = await import('../js/analytics.js');
  const daily = weighIns([92.8, 93.0, 93.1], '2026-11-14').map((p, i) => ({ id: i, dateISO: p.dateISO, bodyweight: p.value }));
  const dip = {
    id: 1, exerciseId: 'dip', load: 20, reps: 8, rpe: 8, rir: 2, bodyweightUsed: 90, localDate: '2026-11-16',
    variantUsed: 'dip', pauseStyle: 'paused', gripWidth: 'wide', isIndexSet: true,
  };
  const toBench = correctionFor(dip, { exerciseId: 'benchClose' }, { exercises, daily, fallbackBodyweight: 90 });
  assert.equal(toBench.bodyweightUsed, null, 'a close-grip bench set kept 90 kg of bodyweight and became a 110 kg press');
  assert.equal(toBench.variantUsed, null);
  assert.equal(toBench.pauseStyle, null);
  assert.equal(toBench.gripWidth, null);
  assert.equal(toBench.isIndexSet, false, 'the old lift’s index flag cannot vouch for the new lift');

  const row = { ...dip, exerciseId: 'rowCSR', bodyweightUsed: null };
  const toDip = correctionFor(row, { exerciseId: 'dip' }, { exercises, daily, fallbackBodyweight: 90 });
  assert.ok(Math.abs(toDip.bodyweightUsed - 92.97) < 0.05, 'a dip with no bodyweight is a dip with no estimate');

  const rpeOnly = correctionFor(dip, { rpe: 9 }, { exercises, daily, fallbackBodyweight: 90 });
  assert.equal(rpeOnly.rir, 1, 'RIR still said 2 after the RPE became 9');
  assert.equal(rpeOnly.bodyweightUsed, undefined, 'an unrelated field was rewritten');
});

test('UI-06: saving only a note in pounds does not drift the load', async () => {
  const { actions } = await import('../js/ui/history.js');
  const patches = [];
  const ctx = {
    state: { settings: { unit: 'lb' }, sets: [] },
    toKg: (lb) => lb / 2.2046226218,
    repairSet: async (id, patch) => {
      patches.push(patch);
      return { changed: 1 };
    },
    render() {},
  };
  // 100 kg is shown as 220.5 lb; sending that back stored 100.017 kg and
  // wrote a "load" correction he never made.
  await withFakeDocument(async () => {
    await actions['repair-set-save'](ctx, { id: '1', loadShown: '220.5' });
  }, { 'fix-load': '220.5', 'fix-reps': '5', 'fix-rpe': '8', 'fix-ex': 'benchComp', 'fix-note': 'felt slow' });
  assert.equal('load' in patches[0], false, 'an untouched load box was re-sent');

  await withFakeDocument(async () => {
    await actions['repair-set-save'](ctx, { id: '1', loadShown: '220.5' });
  }, { 'fix-load': '225', 'fix-reps': '5', 'fix-rpe': '8', 'fix-ex': 'benchComp', 'fix-note': '' });
  assert.ok(Math.abs(patches[1].load - 102.06) < 0.01, 'a changed load was not saved');
});

test('UI-06: the exercise list is sorted and leaves out retired lifts', async () => {
  const { actions } = await import('../js/ui/history.js');
  const [, plan] = withSharedLibrary([FOPIP, FLOPIP]);
  const set = { id: 1, sessionLogId: 1, exerciseId: 'benchComp', setIndex: 0, load: 100, reps: 5, rpe: 8 };
  await withFakeDocument(async (nodes) => {
    actions['repair-set-open']({ state: { plan, settings: { unit: 'kg' }, sets: [set] } }, { id: '1' });
    const names = [...nodes.pan.innerHTML.matchAll(/<option value="[^"]*"[^>]*>([^<]*)<\/option>/g)].map((m) => m[1]);
    assert.ok(names.length > 10);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)), 'the list was in object order');
    const retired = Object.values(plan.exercises).filter((x) => x.retired).map((x) => x.name);
    assert.ok(retired.length > 0);
    assert.ok(!names.some((n) => retired.includes(n.replace(/&amp;/g, '&'))), 'retired lifts were offered');
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   UI-11 · a pound label is on a pound number
   ═══════════════════════════════════════════════════════════════════════ */

test('UI-11: record gains are converted before they are labelled lb', async () => {
  const { view } = await import('../js/ui/progress.js');
  const [, plan] = withSharedLibrary([FOPIP, FLOPIP]);
  const logs = [log(60, '2026-10-01', { cycleSequence: 1 }), log(61, '2026-10-20', { cycleSequence: 3 })];
  const sets = [bench(60, 60, { load: 100, reps: 5, rpe: 8 }), bench(61, 61, { load: 105, reps: 5, rpe: 8 })];
  const state = {
    plan, plans: { 'flopip-2': plan }, logs, sets, daily: [], measurements: [], niggles: [], media: [],
    maxes: new Map([['benchComp', { exerciseId: 'benchComp', workingMax: 125 }]]),
    cycle: { sequence: 4, id: 'c4', localStartDate: '2026-10-28' },
    settings: { unit: 'lb', increment: 2.5, bodyweight: 90 },
    todayISO: '2026-11-18', progressLift: 'benchComp', progressSection: 'strength',
    block: { idx: 3, from: 4, to: 10, name: 'Accumulation' },
    blockProgress: { blockDone: 0, sessionTarget: 5, readyForReview: false },
    planProgress: { calendarWeek: 10, pace: null },
  };
  const html = view({ state, render() {} });
  // 123.3 → 129.5 kg is +6.2 kg, which is +13.6 lb.
  assert.match(html, /\+13\.6 after 19 days/, 'a kilogram gain was printed beside pound values');
  assert.doesNotMatch(html, /\+6\.2 after/);
  assert.doesNotMatch(html, /NaN|undefined|\[object Object\]/);
});

test('UI-11: the record sheet converts its gain too (wiring)', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /\+\$\{fmtNum\(pr\.gain/, 'the PR sheet labels a kg gain with the display unit');
});

/* ═══════════════════════════════════════════════════════════════════════
   Session load · minutes are only multiplied when they are real
   ═══════════════════════════════════════════════════════════════════════ */

test('session load leaves out sessions whose timing is not reliable, and says why', async () => {
  // One forgotten Finish (388 min) was 3494 of the 3494 in a week's load, the
  // figure the app calls the earliest warning there is.
  const { weeklyLoads } = await import('../js/progress.js');
  const real = {
    id: 1, dateISO: '2026-11-10', sessionRpe: 7, timingReliable: true,
    startedAt: '2026-11-10T17:00:00.000Z', endedAt: '2026-11-10T18:00:00.000Z',
  };
  const stated = { ...real, id: 2, dateISO: '2026-11-11', timingReliable: false,
    startedAt: '2026-11-11T09:00:00.000Z', endedAt: '2026-11-11T15:00:00.000Z' };
  const typedUp = { ...real, id: 3, dateISO: '2026-11-12', startedAt: '2026-11-12T17:00:00.000Z', endedAt: '2026-11-12T23:00:00.000Z' };
  const sets = [
    ...[0, 3, 6, 9].map((m, i) => ({ id: 10 + i, sessionLogId: 1, timestampISO: `2026-11-10T17:${String(10 + m).padStart(2, '0')}:00.000Z` })),
    ...[0, 1, 2, 3, 4].map((s, i) => ({ id: 20 + i, sessionLogId: 3, timestampISO: `2026-11-12T22:59:0${s}.000Z` })),
  ];

  const result = weeklyLoads([real, stated, typedUp], sets);
  assert.equal(result.weeks.length, 1);
  assert.equal(result.weeks[0].value, 7 * 60, 'an unreliable session was multiplied into the week');
  assert.deepEqual(result.excluded.map((row) => row.logId).sort(), [2, 3]);
  assert.ok(result.excluded.every((row) => row.reason), 'a session was dropped without a reason');
});

/* ═══════════════════════════════════════════════════════════════════════
   L7 · the plan validator runs at startup, as its comment always said
   ═══════════════════════════════════════════════════════════════════════ */

test('L7: a broken plan stops the app with the problem named', async () => {
  const { assertPlansValid } = await import('../js/plan.js');
  const [fopip, flopip] = withSharedLibrary([FOPIP, FLOPIP]);
  assert.equal(assertPlansValid([fopip, flopip]), true, 'a shipped plan does not validate');
  const broken = structuredClone(flopip);
  broken.sessions[0].slots[0].ex = 'noSuchLift';
  assert.throws(() => assertPlansValid([fopip, broken]), /FLOPIP 2: .*unknown exercise noSuchLift/);
});

test('L7: boot calls the validator before the database is opened (wiring)', () => {
  // validatePlan was imported by app.js, described as running at startup, and
  // never called.
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const boot = app.slice(app.indexOf('async function boot()'));
  const validated = boot.search(/assertPlansValid\(\w+\)/);
  assert.ok(validated > 0, 'boot does not validate the plans');
  assert.ok(validated < boot.indexOf('openDatabase()'), 'the plans are validated after the database is opened');
});

test('L7: app.js imports nothing it does not use (grep evidence for the removals)', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  for (const name of ['rotationPosition', 'blockProgress', 'planProgress', 'isPartialSession', 'estimateForSet', 'isHighConfidence', 'validatePlan']) {
    const asFunction = new RegExp(`\\b${name}\\(`);
    assert.doesNotMatch(app, asFunction, `${name} is called, so its import was not dead`);
    assert.doesNotMatch(app, new RegExp(`^\\s*${name},$|[{,]\\s*${name}\\s*[,}]`, 'm'), `${name} is still imported`);
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   N7 · Summary says one thing about the bench
   ═══════════════════════════════════════════════════════════════════════ */

// His shape: a 130 single in October, then rotations whose best is lower.
const n7Logs = [
  log(1, '2026-09-04', { cycleSequence: 1 }),
  log(2, '2026-09-18', { cycleSequence: 2 }),
  log(3, '2026-10-02', { cycleSequence: 3 }),
  log(4, '2026-10-23', { cycleSequence: 4 }),
  log(5, '2026-11-06', { cycleSequence: 5 }),
  log(6, '2026-11-14', { cycleSequence: 6 }),
];
const n7Sets = [
  bench(1, 1, { load: 100, reps: 5, rpe: 8 }),
  bench(2, 2, { load: 105, reps: 5, rpe: 8 }),
  bench(3, 3, { load: 110, reps: 5, rpe: 8 }),
  bench(4, 4, { load: 130, reps: 1, rpe: 10 }),
  bench(5, 5, { load: 112.5, reps: 5, rpe: 8 }),
  bench(6, 6, { load: 120, reps: 1, rpe: 10 }),
];
const n7Averaged = ['2026-09-04', '2026-09-18', '2026-10-02', '2026-10-23', '2026-11-06', '2026-11-14'].map((dateISO, i) => ({
  dateISO,
  value: 88 + i * 0.6,
}));

test('N7: the max, its ratio to bodyweight and the goal all use the one bench max', async () => {
  // The tile said 1.43×BW, a card two rows down 1.32×, and the goal "20 kg to
  // go" (from the last point, 120) beside an estimated 1RM of 130.
  const { liftStanding } = await import('../js/analytics.js');
  const series = strengthSeries(n7Sets, { exercises, logs: n7Logs, exerciseId: 'benchComp' });
  const standing = liftStanding(series, n7Averaged, { goalKg: 140 });
  const best = Math.max(...series.points.map((p) => p.value));

  assert.equal(standing.max.value, best);
  assert.equal(standing.bodyweight.value, n7Averaged[n7Averaged.length - 1].value);
  assert.ok(Math.abs(standing.perKg.latest - best / standing.bodyweight.value) < 1e-9, 'the ratio uses another max or another bodyweight');
  assert.equal(standing.goal.current, best, 'the goal measures from another max');
  assert.ok(Math.abs(standing.goal.remaining - (140 - best)) < 1e-9);
  if (standing.goal.perWeek != null) assert.equal(standing.goal.perWeek, standing.strength.perWeek, 'the goal fits its own slope');
});

test('N7: a four-week change of nothing gets no tick', async () => {
  const { liftStanding } = await import('../js/analytics.js');
  const points = [
    { dateISO: '2026-10-10', value: 120, cycleSequence: 1 },
    { dateISO: '2026-11-14', value: 120, cycleSequence: 2 },
  ];
  const standing = liftStanding({ points, sampleCount: 2 }, []);
  assert.equal(standing.change.ok, true);
  assert.equal(standing.change.flat, true, '"✓ Up 0.0 kg in 4 weeks" read as progress');
});

test('N7: Summary draws every bench figure from liftStanding (wiring)', () => {
  const progress = readFileSync(new URL('../js/ui/progress.js', import.meta.url), 'utf8');
  const metrics = progress.slice(progress.indexOf('function metrics('), progress.indexOf('function summaryView('));
  assert.match(metrics, /liftStanding\(/);
  assert.doesNotMatch(metrics, /goalProgress\(|relativeStrengthSnapshot\(|changeOver\(/, 'a second pipeline for a bench figure');
  const tiles = progress.slice(progress.indexOf('function tiles('), progress.indexOf('function flagsSection('));
  assert.doesNotMatch(tiles, /m\.best \/ /, 'the tile divides by its own bodyweight');
});

/* ═══════════════════════════════════════════════════════════════════════
   N11 · pounds mode says pounds
   ═══════════════════════════════════════════════════════════════════════ */

test('N11: the Log lists a weigh-in in the display unit', async () => {
  // "91.05 kg (Home scale)" in pounds mode.
  const { entries } = await import('../js/ui/history.js');
  const state = {
    plan: { sessions: [], exercises: {} }, logs: [], sets: [], measurements: [], niggles: [], media: [],
    daily: [{ id: 1, dateISO: '2026-11-17', bodyweight: 91.05, scale: 'home' }],
    settings: { unit: 'lb' },
  };
  const row = entries(state).find((entry) => entry.kind === 'daily');
  assert.match(row.summary, /^200\.73 lb/);
  assert.doesNotMatch(row.summary, /kg/);
  state.settings.unit = 'kg';
  assert.match(entries(state).find((entry) => entry.kind === 'daily').summary, /^91\.05 kg/, 'the scale’s 0.05 is kept in kg');
});

test('N11: the gain-rate flag says pounds in pounds mode', async () => {
  const { decisionFlags } = await import('../js/progress.js');
  const gain = { ok: true, perWeek: 0.23, status: 'under', action: 'Nothing to do yet.', target: { lo: 0.4, hi: 0.5 } };
  const lb = (kg) => `${(kg * 2.2046226218).toFixed(2)} lb/week`;
  const flag = decisionFlags({ gain, strength: { ok: false }, calendarWeek: 6, rate: lb }).find((f) => f.metric === 'gain');
  assert.match(flag.detail, /^0\.51 lb\/week against the 0\.88–1\.10 lb\/week band/);
  assert.doesNotMatch(flag.detail, /kg/);
});

test('N11: Progress writes gain rates and the corridor in the display unit (wiring)', () => {
  // The tile read "200.8 lb" over "+0.23 kg/wk", and the Body chart's target
  // corridor added kg/week slopes to a line drawn in pounds.
  const progress = readFileSync(new URL('../js/ui/progress.js', import.meta.url), 'utf8');
  const kgRates = progress.split('\n').filter((line) => /kg\/w(ee)?k/.test(line) && !/GOAL_BENCH_KG|m\.goal/.test(line));
  assert.deepEqual(kgRates, [], 'a rate is written in kg whatever the unit');
  assert.match(progress, /lo: toDisplay\(target\.lo, unit\), hi: toDisplay\(target\.hi, unit\)/, 'the corridor slope is not converted');
});
