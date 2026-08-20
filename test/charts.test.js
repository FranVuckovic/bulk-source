import test from 'node:test';
import assert from 'node:assert/strict';

import { pct } from '../js/calc.js';
import { scatterIso } from '../js/ui/charts.js';

test('the load-reps scatter distinguishes four recency windows and labels its e1RM curves', () => {
  const html = scatterIso(
    [
      { reps: 1, load: 100, ageDays: 3, dateISO: '2026-08-17' },
      { reps: 3, load: 95, ageDays: 10, dateISO: '2026-08-10' },
      { reps: 5, load: 90, ageDays: 20, dateISO: '2026-07-31' },
      { reps: 8, load: 80, ageDays: 40, dateISO: '2026-07-11' },
    ],
    { curves: [100, 110, 120, 130, 140, 150], pctFor: pct, unit: 'kg' }
  );

  for (const label of ['last 7 days', '8–14 days', '15–28 days', 'older']) assert.match(html, new RegExp(label));
  for (const curve of [100, 110, 120, 130, 140, 150]) assert.match(html, new RegExp(`>(?:e1RM )?${curve}<`));
});
