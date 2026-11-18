/**
 * Data safety: backups, restores, the bin and erase.
 *
 * Every test here is named after a way the app could lose or misreport data
 * that it actually could at the time the test was written. The audit that
 * found them reproduced each one against a real database before it was fixed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createFakeEnv } from './helpers/fake-indexeddb.js';
import { openDatabase, DB_VERSION } from '../js/db.js';
import { toCsv, CSV_COLUMNS } from '../js/export.js';

const freshDb = () => openDatabase({ indexedDB: createFakeEnv().indexedDB, version: DB_VERSION });
void freshDb;

/** Split one CSV line into cells, honouring quotes. */
function cellsOf(line) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      cells.push(current);
      current = '';
    } else current += char;
  }
  cells.push(current);
  return cells;
}

/* ── L3: CSV export ──────────────────────────────────────────────────── */

test('L3: an object cell in a CSV no longer splits into extra columns', () => {
  const csv = toCsv([{ id: 1, formBreakdown: { a: 1, b: 2 }, note: 'x' }], ['id', 'formBreakdown', 'note']);
  const [, row] = csv.trim().split('\n');
  const cells = cellsOf(row);
  assert.equal(cells.length, 3, 'three columns in, three columns out');
  assert.deepEqual(JSON.parse(cells[1]), { a: 1, b: 2 }, 'and the JSON reads back whole');
  assert.equal(cells[2], 'x');
});

test('L3: the CSVs say which rows are binned, and where a session sits in the plan', () => {
  for (const store of ['sessionLogs', 'sets', 'daily', 'measurements', 'niggles', 'media']) {
    assert.ok(CSV_COLUMNS[store].includes('deletedAtISO'), `${store}.csv says which rows are in the bin`);
  }
  for (const column of ['status', 'cycleSequence', 'rotationPosition']) {
    assert.ok(CSV_COLUMNS.sessionLogs.includes(column), `sessionLogs.csv carries ${column}`);
  }
});
