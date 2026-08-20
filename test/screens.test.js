/**
 * Every screen against an empty database.
 *
 * A first install has no sessions, no weigh-ins and no maxes, and it is the
 * state least likely to be looked at while developing — which is how the Plan
 * screen came to render "week 14 of NaN" and an empty progress bar against v2
 * blocks. These render each screen with nothing stored and assert that no
 * arithmetic leaked into the page.
 *
 * They are not a substitute for looking at it. They are the guard that says
 * something changed shape.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { newCycle, cycleProgress, blockBoundary } from '../js/cycle.js';
import { blockFor } from '../js/plan.js';
import * as progressScreen from '../js/ui/progress.js';
import * as planScreen from '../js/ui/plan.js';
import * as bodyScreen from '../js/ui/body.js';
import * as historyScreen from '../js/ui/history.js';
import * as settingsScreen from '../js/ui/settings.js';

const PLAN = JSON.parse(readFileSync(new URL('../data/plan-fopip-v2.json', import.meta.url), 'utf8'));

function emptyState({ sequence = 1 } = {}) {
  const cycle = newCycle(PLAN, { sequence, startedAtISO: null, localStartDate: null });
  const block = blockFor(PLAN, sequence);
  return {
    plan: PLAN,
    logs: [], sets: [], daily: [], measurements: [], niggles: [], media: [], cycles: [cycle], deleted: [],
    maxes: new Map(),
    cycle,
    settings: { unit: 'kg', increment: 2.5, bodyweight: 90, barKg: 20 },
    storage: { persisted: true, supported: true, usage: 0, quota: 1_000_000 },
    integrity: { ok: true, problems: [], formatVersion: 3 },
    buildVersion: 'v2.6.0',
    updateVersion: null,
    demo: false,
    todayISO: '2026-08-19',
    shut: new Set(),
    bodyDraft: { dateISO: '2026-08-19' },
    historyFilter: 'all',
    progressLift: 'benchComp',
    cycleProgress: cycleProgress(PLAN, cycle, []),
    block: { idx: block.id, label: String(block.id), ...block },
    blockProgress: { blockDone: 0, sessionTarget: 6, readyForReview: false, daysElapsed: null, behind: false },
    planProgress: { calendarWeek: 1, pace: null, sessionsDone: 0, cyclesDone: 0, daysElapsed: null },
    position: { nextSessionId: 'A' },
    boundary: blockBoundary(PLAN, cycle),
  };
}

const screens = [
  ['Progress', progressScreen],
  ['Plan', planScreen],
  ['Body', bodyScreen],
  ['History', historyScreen],
  ['Settings', settingsScreen],
];

for (const [name, screen] of screens) {
  test(`${name} renders on an empty database without leaking arithmetic`, () => {
    const html = screen.view({ state: emptyState(), render() {} });

    assert.ok(html.length > 500, 'it rendered something');
    assert.doesNotMatch(html, /NaN/, 'a number that could not be computed reached the page');
    assert.doesNotMatch(html, /undefined/, 'a missing value reached the page');
    assert.doesNotMatch(html, /\[object Object\]/, 'an object was interpolated as text');
    assert.doesNotMatch(html, /Infinity/, 'a division by nothing reached the page');
  });
}

test('the Plan screen counts rotations, not a week field the blocks do not have', () => {
  // v2 blocks carry `from` and `to`. v1's screen summed a `weeks` field, which
  // produced "week 14 of NaN" and a progress bar with no width.
  const html = planScreen.view({ state: emptyState({ sequence: 12 }), render() {} });
  assert.match(html, /Rotation 12 of 33/);
  assert.doesNotMatch(html, /width:NaN/);
});

/*
 * The sections behind the tabs are the part most likely to rot: they render
 * only when their tab is selected, so nothing exercises them by accident. Each
 * one gets the same empty-database treatment as its parent screen.
 */
const sections = [
  ['Progress', progressScreen, 'progressSection', ['summary', 'strength', 'body', 'volume']],
  ['Plan', planScreen, 'planSection', ['overview', 'workouts', 'exercises', 'blocks', 'tips']],
  ['Log', historyScreen, 'logSection', ['entries', 'backups', 'bin']],
];

for (const [name, screen, key, ids] of sections) {
  for (const id of ids) {
    test(`${name} → ${id} renders on an empty database`, () => {
      const html = screen.view({ state: { ...emptyState(), [key]: id }, render() {} });
      assert.ok(html.length > 200, 'it rendered something');
      assert.doesNotMatch(html, /NaN/, 'a number that could not be computed reached the page');
      assert.doesNotMatch(html, /undefined/, 'a missing value reached the page');
      assert.doesNotMatch(html, /\[object Object\]/, 'an object was interpolated as text');
      assert.doesNotMatch(html, /Infinity/, 'a division by nothing reached the page');
    });
  }
}
test('the Plan workout cards stay closed when the user minimizes the next workout', () => {
  const state = emptyState();
  state.planSection = 'workouts';
  state.planOpenSession = null;

  const html = planScreen.view({ state, render() {} });
  assert.doesNotMatch(html, /card wo open/, 'null is an intentional closed state, not a missing default');
  assert.match(html, /subnav plan-tabs/, 'all Plan destinations use the dedicated wrapping navigation');
});

test('the Plan stimulus view distinguishes small overages and can be collapsed by group', () => {
  const html = planScreen.view({ state: emptyState({ sequence: 3 }), render() {} });
  assert.match(html, /target bands are guardrails, not pass\/fail boundaries/i);
  assert.match(html, /slightly above/);
  assert.match(html, /materially above/);
  assert.match(html, /class="card stimulus-group"/);
  assert.match(html, /specialisation volume; additional returns are likely smaller/);
});

test('only the whole-muscle roll-up is coloured; the heads are reported, not judged', () => {
  // Volume landmarks are published PER MUSCLE. The screen used to colour each
  // head against a band with no published basis, so the biceps short head read
  // orange at 13.4 against a 6–12 band nobody had measured, while chest at 29
  // against the 10–20 range the research does state was not coloured at all.
  // The verdict now sits on the roll-up, where the evidence is.
  const html = planScreen.view({ state: emptyState({ sequence: 12 }), render() {} });

  assert.match(html, /in the 10–20 range/, 'the roll-up is judged against the stated range');
  assert.match(html, /maintenance volume — under the 10–20 growth range/, 'below growth is not a warning');
  assert.match(html, /per head only — not judged/, 'a group with no whole-muscle figure says so rather than showing nothing');
  assert.match(html, /class="head-bars"/, 'the heads are set apart from the roll-up');
  assert.match(html, /plan reference \d/, 'a head bar states its band as a reference, not a verdict');
  assert.match(html, /per head — not judged/, 'the legend says so');

  // No head bar may carry a verdict colour.
  const heads = html.slice(html.indexOf('class="head-bars"'));
  const headSection = heads.slice(0, heads.indexOf('</details>'));
  for (const verdict of ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--warn)']) {
    assert.ok(!headSection.includes(verdict), `a per-head bar was coloured ${verdict}`);
  }
});

test('the tonnage comparison uses a real 44-tonne articulated lorry', () => {
  assert.deepEqual(progressScreen.tonnageComparison(960000), {
    weightKg: 44000,
    thing: 'a fully laden articulated lorry',
    count: 22,
  });
});

test('the Progress summary groups evidence and keeps secondary material collapsible', () => {
  const html = progressScreen.view({ state: emptyState(), render() {} });
  assert.match(html, /class="card summary-group" open/);
  assert.match(html, /Bodyweight & waist/);
  assert.match(html, /Strength relative to bodyweight/);
  assert.match(html, /Plan completion/);
  assert.match(html, /Actions and recovery signals/);
  assert.match(html, /Consistency and work done/);
});

test('Settings keeps routine controls open and everything else in named compact groups', () => {
  const html = settingsScreen.view({ state: emptyState(), render() {} });
  assert.match(html, /Demo data/);
  assert.match(html, /<details class="card settings-group" open>/);
  assert.match(html, /Data &amp; backups/);
  assert.match(html, /Privacy &amp; storage/);
  assert.match(html, /Deletion &amp; reset/);
  assert.match(html, /About this build/);
  assert.equal((html.match(/<details class="card settings-group/g) || []).length, 5);
});

test('measurement history shows real dates, a selectable chart and a bodyweight comparison', () => {
  const state = emptyState();
  state.progressSection = 'body';
  state.measurements = [
    { dateISO: '2026-08-01', chest: 105, waist: 90 },
    { dateISO: '2026-06-01', chest: 101, waist: 88 },
    { dateISO: '2026-07-01', chest: 103, waist: 89 },
  ];
  state.daily = [
    { dateISO: '2026-06-01', bodyweight: 88 },
    { dateISO: '2026-07-01', bodyweight: 89 },
    { dateISO: '2026-08-01', bodyweight: 90 },
  ];

  const html = progressScreen.view({ state, render() {} });
  assert.match(html, /Chest · 2026-06-01 to 2026-08-01/, 'readings are sorted and their interval is explicit');
  assert.match(html, /data-act="measurement-focus"/, 'a tape site can be selected without adding every chart to the page');
  assert.match(html, /Compare chest with bodyweight/);
  assert.match(html, /Tape changes describe circumference, not body composition/);
});

test('relative strength matches only nearby bodyweight readings and reports the real ratio', () => {
  const rows = progressScreen.relativeStrengthSeries(
    [
      { dateISO: '2026-08-01', value: 120 },
      { dateISO: '2026-08-10', value: 130 },
      { dateISO: '2026-08-20', value: 140 },
    ],
    [
      { dateISO: '2026-08-02', value: 80 },
      { dateISO: '2026-08-16', value: 90 },
    ]
  );

  assert.equal(rows.length, 1, 'a four-day-old bodyweight is not silently paired');
  assert.equal(rows[0].bodyweight, 80);
  assert.equal(rows[0].value, 1.5);
});

test('relative strength summary exposes the current ratio and real first-to-last change', () => {
  const snapshot = progressScreen.relativeStrengthSnapshot(
    [
      { dateISO: '2026-08-01', value: 120 },
      { dateISO: '2026-08-15', value: 132 },
    ],
    [
      { dateISO: '2026-08-01', value: 80 },
      { dateISO: '2026-08-15', value: 82.5 },
    ]
  );

  assert.equal(snapshot.sampleCount, 2);
  assert.equal(snapshot.latest, 1.6);
  assert.ok(Math.abs(snapshot.change - 0.1) < 1e-12);
  assert.equal(snapshot.fromDateISO, '2026-08-01');
  assert.equal(snapshot.toDateISO, '2026-08-15');
});

test('Strength leads with the selected lift record and keeps the full lift list off the horizontal axis', () => {
  const state = emptyState();
  state.progressSection = 'strength';
  state.logs = [
    { id: 'log-1', localDate: '2026-08-10', dateISO: '2026-08-10', blockId: 0, cycleSequence: 1, sessionId: 'A' },
  ];
  state.sets = [
    { id: 'set-1', sessionLogId: 'log-1', exerciseId: 'benchComp', load: 100, reps: 5, rpe: 8, isIndexSet: true },
  ];

  const html = progressScreen.view({ state, render() {} });
  assert.ok(html.indexOf('Best performance') < html.indexOf('Estimated 1RM trend'), 'the evidence precedes its graph');
  assert.match(html, /Record set: 100\.0 kg × 5 reps · RPE 8/);
  assert.match(html, /kg e1RM/);
  assert.match(html, /What prescriptions use/);
  assert.match(html, /Working max · stable calculation anchor, not a record/);
  assert.ok(html.indexOf('Strength relative to bodyweight') < html.indexOf('Programming diagnostics'));
  assert.match(html, /class="lift-grid"/, 'all lifts live in a wrapping chooser');
  assert.doesNotMatch(html, /class="picker"/, 'the sideways lift carousel is gone');
});

test('every screen survives a rotation at each block boundary', () => {
  for (const block of PLAN.blocks) {
    for (const sequence of [block.from, block.to]) {
      for (const [name, screen] of screens) {
        const html = screen.view({ state: emptyState({ sequence }), render() {} });
        assert.doesNotMatch(html, /NaN|undefined|\[object Object\]/, `${name} at rotation ${sequence}`);
      }
      // And every section of every screen, at every boundary.
      for (const [name, screen, key, ids] of sections) {
        for (const id of ids) {
          const html = screen.view({ state: { ...emptyState({ sequence }), [key]: id }, render() {} });
          assert.doesNotMatch(html, /NaN|undefined|\[object Object\]/, `${name} → ${id} at rotation ${sequence}`);
        }
      }
    }
  }
});
