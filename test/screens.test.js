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

test('the Plan workout cards stay closed when the user minimizes the next workout', () => {
  const state = emptyState();
  state.planSection = 'workouts';
  state.planOpenSession = null;

  const html = planScreen.view({ state, render() {} });
  assert.doesNotMatch(html, /card wo open/, 'null is an intentional closed state, not a missing default');
  assert.match(html, /subnav plan-tabs/, 'all Plan destinations use the dedicated wrapping navigation');
});

test('the tonnage comparison uses a real 44-tonne articulated lorry', () => {
  assert.deepEqual(progressScreen.tonnageComparison(960000), {
    weightKg: 44000,
    thing: 'a fully laden articulated lorry',
    count: 22,
  });
});

test('every screen survives a rotation at each block boundary', () => {
  for (const block of PLAN.blocks) {
    for (const sequence of [block.from, block.to]) {
      for (const [name, screen] of screens) {
        const html = screen.view({ state: emptyState({ sequence }), render() {} });
        assert.doesNotMatch(html, /NaN|undefined|\[object Object\]/, `${name} at rotation ${sequence}`);
      }
    }
  }
});
