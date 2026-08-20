import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createFakeEnv } from './helpers/fake-indexeddb.js';
import {
  DB_NAME,
  DEMO_DB_NAME,
  allowWrites,
  blockWrites,
  getAll,
  openDatabase,
  put,
} from '../js/db.js';
import { seedDemoData } from '../js/demo.js';
import { blockBoundary, cycleProgress } from '../js/cycle.js';
import { blockFor } from '../js/plan.js';
import * as progressScreen from '../js/ui/progress.js';
import * as settingsScreen from '../js/ui/settings.js';

const PLAN = JSON.parse(readFileSync(new URL('../data/plan-fopip-v2.json', import.meta.url), 'utf8'));

function fakeCanvasDocument() {
  return {
    createElement(name) {
      assert.equal(name, 'canvas');
      const gradient = { addColorStop() {} };
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            createLinearGradient: () => gradient,
            fillRect() {},
            beginPath() {},
            ellipse() {},
            fill() {},
            fillText() {},
            set fillStyle(_value) {},
            set font(_value) {},
            set textAlign(_value) {},
          };
        },
        toBlob(callback) {
          callback(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }));
        },
      };
    },
  };
}

test('demo seeding is repeatable and cannot alter the personal database', async () => {
  const env = createFakeEnv();
  const personal = await openDatabase({ indexedDB: env.indexedDB, name: DB_NAME });
  const demo = await openDatabase({ indexedDB: env.indexedDB, name: DEMO_DB_NAME });
  const previousDocument = globalThis.document;
  globalThis.document = fakeCanvasDocument();

  try {
    await put(personal, 'daily', { dateISO: '2026-08-20', bodyweight: 90 });
    await seedDemoData(demo, PLAN, { rotations: 2 });

    const firstCounts = {
      logs: (await getAll(demo, 'sessionLogs')).length,
      sets: (await getAll(demo, 'sets')).length,
      daily: (await getAll(demo, 'daily')).length,
      measurements: (await getAll(demo, 'measurements')).length,
      media: (await getAll(demo, 'media')).length,
    };
    assert.ok(firstCounts.logs > 0);
    assert.ok(firstCounts.sets > firstCounts.logs);
    assert.ok(firstCounts.daily > 0);
    assert.ok(firstCounts.measurements > 0);
    assert.ok(firstCounts.media > 0);

    const logs = await getAll(demo, 'sessionLogs');
    const sets = await getAll(demo, 'sets');
    const daily = await getAll(demo, 'daily');
    const measurements = await getAll(demo, 'measurements');
    const niggles = await getAll(demo, 'niggles');
    const media = await getAll(demo, 'media');
    const cycles = await getAll(demo, 'cycles');
    const maxRows = await getAll(demo, 'maxes');
    const cycle = cycles.sort((a, b) => a.sequence - b.sequence).at(-1);
    const block = blockFor(PLAN, cycle.sequence);
    const state = {
      plan: PLAN,
      logs,
      sets,
      daily,
      measurements,
      niggles,
      media,
      cycles,
      deleted: [],
      maxes: new Map(maxRows.map((row) => [row.exerciseId, row])),
      cycle,
      settings: { unit: 'kg', increment: 2.5, bodyweight: 90, barKg: 20, lastBackupISO: null },
      storage: { persisted: true, supported: true, usage: 12_000, quota: 1_000_000 },
      integrity: { ok: true, problems: [], formatVersion: 3 },
      todayISO: daily.at(-1)?.dateISO,
      shut: new Set(),
      bodyDraft: { dateISO: daily.at(-1)?.dateISO },
      historyFilter: 'all',
      progressLift: 'benchComp',
      progressSection: 'summary',
      cycleProgress: cycleProgress(PLAN, cycle, logs),
      block: { idx: block.id, label: String(block.id), ...block },
      blockProgress: { blockDone: logs.length, sessionTarget: 36, readyForReview: false, daysElapsed: 14, behind: false },
      planProgress: { calendarWeek: 3, pace: 5, sessionsDone: logs.length, cyclesDone: 1, daysElapsed: 14 },
      position: { nextSessionId: 'E' },
      boundary: blockBoundary(PLAN, cycle),
      buildVersion: 'v2.6.0',
      updateVersion: null,
      demo: true,
    };

    const summary = progressScreen.view({ state, render() {} });
    assert.match(summary, /Strength relative to bodyweight/);
    assert.match(summary, /index-set\/bodyweight matches within three days/);
    state.progressSection = 'strength';
    const strength = progressScreen.view({ state, render() {} });
    assert.match(strength, /Best eligible set this block/);
    assert.match(strength, /Working max · stable calculation anchor, not a record/);
    const settings = settingsScreen.view({ state, render() {} });
    assert.match(settings, /Demo mode is on/);
    assert.match(settings, /Data &amp; backups/);

    await seedDemoData(demo, PLAN, { rotations: 2 });
    assert.deepEqual(
      {
        logs: (await getAll(demo, 'sessionLogs')).length,
        sets: (await getAll(demo, 'sets')).length,
        daily: (await getAll(demo, 'daily')).length,
        measurements: (await getAll(demo, 'measurements')).length,
        media: (await getAll(demo, 'media')).length,
      },
      firstCounts,
      'reloading the demo replaces its generated history instead of duplicating it'
    );

    assert.deepEqual(await getAll(personal, 'daily'), [{ dateISO: '2026-08-20', bodyweight: 90 }]);
    assert.equal((await getAll(personal, 'sessionLogs')).length, 0);
  } finally {
    globalThis.document = previousDocument;
    personal.close();
    demo.close();
  }
});

test('the demo write lock refuses a write at the database boundary', async () => {
  const env = createFakeEnv();
  const db = await openDatabase({ indexedDB: env.indexedDB, name: DEMO_DB_NAME });
  blockWrites('Demo data is read-only.');

  try {
    await assert.rejects(
      put(db, 'daily', { dateISO: '2026-08-20', bodyweight: 90 }),
      /Demo data is read-only/
    );
    assert.equal((await getAll(db, 'daily')).length, 0);
  } finally {
    allowWrites();
    db.close();
  }
});
