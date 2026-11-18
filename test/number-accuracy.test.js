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

import {
  eligibleForStrength,
  strengthSeries,
  records,
  recordHistory,
  bestEstimates,
  recentEvidenceMax,
  sessionAnalysis,
  personalBestBefore,
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
