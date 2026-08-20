import test from 'node:test';
import assert from 'node:assert/strict';

import { actions, DEFAULT_MEASUREMENT_TIME, MEASUREMENT_SITES } from '../js/ui/body.js';

const draft = () => ({
  dateISO: '2026-08-20',
  bodyweight: '90',
  bodyfatPct: '15',
  sleepHours: '8',
  steps: '8000',
  mood: '4',
  caffeine: 'no',
  scale: 'home',
  note: '',
  measureTime: DEFAULT_MEASUREMENT_TIME,
  ...Object.fromEntries(MEASUREMENT_SITES.map(([id], index) => [`m-${id}`, String(35 + index)])),
});

test('a failed daily save is returned to the central action error handler', async () => {
  const failure = new Error('daily write failed');
  const ctx = {
    state: { bodyDraft: draft(), settings: { unit: 'kg' } },
    toKg: Number,
    saveDaily: async () => {
      throw failure;
    },
  };

  await assert.rejects(actions['save-daily'](ctx), failure);
});

test('a failed measurement save is returned to the central action error handler', async () => {
  const failure = new Error('measurement write failed');
  const ctx = {
    state: { bodyDraft: draft() },
    saveMeasurements: async () => {
      throw failure;
    },
  };

  await assert.rejects(actions['save-measurements'](ctx), failure);
});

test('a failed niggle save is returned to the central action error handler', async () => {
  const failure = new Error('niggle write failed');
  const ctx = {
    state: {
      bodyDraft: {
        dateISO: '2026-08-20',
        niggleSite: 'Left elbow',
        niggleSeverity: 2,
        niggleContext: 'Pressing',
      },
    },
    saveNiggle: async () => {
      throw failure;
    },
  };

  await assert.rejects(actions['save-niggle'](ctx), failure);
});
