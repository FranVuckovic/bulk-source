/**
 * Data safety: backups, restores, the bin and erase.
 *
 * Every test here is named after a way the app could lose or misreport data
 * that it actually could at the time the test was written. The audit that
 * found them reproduced each one against a real database before it was fixed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import { createFakeEnv } from './helpers/fake-indexeddb.js';
import {
  openDatabase,
  DB_VERSION,
  put,
  getAll,
  saveSession,
  snapshot,
  withTransaction,
  request,
} from '../js/db.js';
import { toCsv, CSV_COLUMNS, buildExport, parseImport, validateImport, applyImport, verifyAgainst } from '../js/export.js';
import { exportRangeDefaults } from '../js/ui/settings.js';

const freshDb = () => openDatabase({ indexedDB: createFakeEnv().indexedDB, version: DB_VERSION });
const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

/**
 * Two sessions in August and September, and body data either side of them:
 * a weigh-in and a tape reading from July, before the first session was ever
 * logged — which is exactly what the export sheet's default range used to drop.
 */
async function populate(db) {
  await saveSession(db, { dateISO: '2026-08-18', sessionId: 'A', endedAt: '2026-08-18T18:45:00.000Z' }, [
    { exerciseId: 'benchComp', slotIndex: 0, setIndex: 0, load: 105, reps: 1, rpe: 8, logicalKey: 'a:0:0' },
  ]);
  await saveSession(db, { dateISO: '2026-09-20', sessionId: 'B', endedAt: '2026-09-20T19:00:00.000Z' }, [
    { exerciseId: 'legpress', slotIndex: 0, setIndex: 0, load: 200, reps: 10, rpe: 9, logicalKey: 'b:0:0' },
  ]);
  await put(db, 'daily', { dateISO: '2026-07-01', bodyweight: 88.0 });
  await put(db, 'daily', { dateISO: '2026-08-18', bodyweight: 90.4 });
  await put(db, 'measurements', { dateISO: '2026-07-01', waist: 80.1 });
  await put(db, 'niggles', { dateISO: '2026-08-19', site: 'Left elbow', severity: 1 });
  await put(db, 'maxes', { exerciseId: 'benchComp', workingMax: 115, conf: 'high', setAtISO: '2026-08-18' });
  await put(db, 'settings', { key: 'unit', value: 'kg' });
}

async function counts(db) {
  const out = {};
  for (const store of ['sessionLogs', 'sets', 'daily', 'measurements', 'niggles', 'maxes']) {
    out[store] = (await getAll(db, store)).length;
  }
  return out;
}

const apply = (db, parsed) => applyImport(db, parsed, { withTransaction, request });

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

/* ── H2: a restore can wipe data the backup never contained ──────────── */

test('H2: an export with "Sets & sessions" unticked cannot delete every session on import', async () => {
  const db = await freshDb();
  await populate(db);
  const before = await counts(db);

  const { zip } = buildExport(await snapshot(db), null, { include: { sets: false } });
  const parsed = parseImport(zip);
  assert.equal(parsed.data.sessionLogs, undefined, 'a category left out is absent, not an empty list');
  assert.equal(parsed.data.sets, undefined);

  const report = validateImport(parsed, { current: before });
  assert.equal(report.ok, true);
  assert.ok(!report.replaces.includes('sessionLogs') && !report.replaces.includes('sets'), 'and the preview does not threaten them');

  await apply(db, parsed);
  const after = await counts(db);
  assert.equal(after.sessionLogs, 2, 'every session is still there');
  assert.equal(after.sets, 2, 'and every set');
});

test('H2: an older archive that wrote unticked categories as empty lists does not delete them either', async () => {
  // Zips already on his phone were written before the fix: `sessionLogs: []`
  // and `sets: []`, with `included.sets: false` beside them in the metadata.
  const db = await freshDb();
  await populate(db);
  const legacy = {
    format: 4,
    range: { from: null, to: null },
    included: { sets: false, daily: true, measurements: true, niggles: true, media: true, maxes: true, plan: true },
    data: {
      sessionLogs: [], sets: [], daily: [{ id: 1, dateISO: '2026-07-01', bodyweight: 88.0 }],
      measurements: [], niggles: [], media: [], maxes: [], maxHistory: [], settings: [], cycles: [], auditLog: [],
    },
  };

  const report = validateImport(legacy, { current: await counts(db) });
  assert.ok(!report.replaces.includes('sessionLogs'), 'the preview does not say sessions will be replaced');

  await apply(db, legacy);
  assert.equal((await getAll(db, 'sessionLogs')).length, 2, 'the sessions the archive never held survive');
  assert.equal((await getAll(db, 'sets')).length, 2);
});

test('H2: a ranged export restores without deleting what lay outside the range', async () => {
  const db = await freshDb();
  await populate(db);

  // The range the export sheet used to default to: first session to today.
  const { zip, meta } = buildExport(await snapshot(db), null, { from: '2026-08-18', to: '2026-09-30' });
  assert.ok(meta.partial.includes('daily'), 'the archive says it holds only part of daily');
  assert.ok(meta.partial.includes('measurements'));
  assert.ok(!meta.partial.includes('sessionLogs'), 'every session was in range, so that store is whole');

  const parsed = parseImport(zip);
  const report = validateImport(parsed, { current: await counts(db) });
  assert.ok(report.merges.includes('daily'), 'the preview says daily is merged');
  assert.ok(!report.replaces.includes('daily'), 'not replaced');

  // Change an in-range row so the merge is visible.
  const inRange = (await getAll(db, 'daily')).find((row) => row.dateISO === '2026-08-18');
  await put(db, 'daily', { ...inRange, bodyweight: 1 });

  await apply(db, parsed);
  const daily = await getAll(db, 'daily');
  assert.equal(daily.length, 2, 'the July weigh-in outside the range survives');
  assert.equal(daily.find((row) => row.dateISO === '2026-07-01').bodyweight, 88.0);
  assert.equal(daily.find((row) => row.dateISO === '2026-08-18').bodyweight, 90.4, 'and the in-range one is restored');
  assert.equal((await getAll(db, 'measurements')).length, 1, 'the July tape reading survives too');
});

test('H2: an older ranged archive is merged rather than replacing whole stores', async () => {
  const db = await freshDb();
  await populate(db);
  const legacy = {
    format: 4,
    range: { from: '2026-08-01', to: '2026-08-31' },
    included: { sets: true, daily: true, measurements: true, niggles: true, media: true, maxes: true, plan: true },
    data: { daily: [{ id: 2, dateISO: '2026-08-18', bodyweight: 90.4 }], measurements: [] },
  };
  await apply(db, legacy);
  assert.equal((await getAll(db, 'daily')).length, 2, 'the July weigh-in is still there');
  assert.equal((await getAll(db, 'measurements')).length, 1, 'an empty in-range list deletes nothing');
});

test('H2: an export whose range covers everything is still a full restore', async () => {
  const db = await freshDb();
  await populate(db);
  const { zip, meta } = buildExport(await snapshot(db), null, { from: '2026-07-01', to: '2026-09-30' });
  assert.deepEqual(meta.partial, [], 'nothing was left out, so nothing is partial');

  // Something added after the backup was taken is replaced, as a restore should.
  await put(db, 'daily', { dateISO: '2026-10-01', bodyweight: 95 });
  await apply(db, parseImport(zip));
  assert.equal((await getAll(db, 'daily')).length, 2);
});

test('H2: verifying a ranged backup does not report the rows outside its range as missing', async () => {
  const db = await freshDb();
  await populate(db);
  const live = await snapshot(db);
  const { zip } = buildExport(live, null, { from: '2026-08-18', to: '2026-09-30' });
  const report = verifyAgainst(parseImport(zip), live);
  assert.equal(report.ok, true, report.problems.join('; '));
});

test('H2: the JSON safety copy taken before an import or erase can itself be restored', async () => {
  const db = await freshDb();
  await populate(db);
  await put(db, 'media', { dateISO: '2026-08-18', kind: 'physique', imageBytes: new Uint8Array([255, 216, 1, 2, 3]) });
  const before = await snapshot(db);

  // Exactly what downloadBackup writes.
  const file = new TextEncoder().encode(JSON.stringify(before, null, 2));
  const parsed = parseImport(file);
  assert.equal(validateImport(parsed).ok, true);

  const target = await freshDb();
  await apply(target, parsed);
  const after = await snapshot(target);
  for (const store of ['sessionLogs', 'sets', 'daily', 'measurements', 'niggles', 'maxes', 'settings']) {
    assert.deepEqual(after.data[store], before.data[store], store);
  }
  const photo = after.data.media[0];
  assert.ok(photo.imageBytes instanceof Uint8Array, 'the photo comes back as bytes, not as {"0":255,…}');
  assert.deepEqual([...photo.imageBytes], [255, 216, 1, 2, 3]);
});

test('H2: the restore pickers accept the JSON backups the app hands out', () => {
  for (const path of ['../js/ui/settings.js', '../js/ui/history.js']) {
    const inputs = source(path).match(/<input type="file" id="(import|verify)-file"[^>]*>/g) || [];
    assert.ok(inputs.length, `${path} has its pickers`);
    for (const input of inputs) assert.match(input, /\.json/, `${path}: ${input}`);
  }
});

test('H2: the export sheet defaults to the earliest record of any kind, not the first session', () => {
  const state = {
    todayISO: '2026-09-30',
    logs: [{ dateISO: '2026-08-18' }],
    daily: [{ dateISO: '2026-07-01' }],
    measurements: [{ dateISO: '2026-07-04' }],
    niggles: [],
    media: [{ dateISO: '2026-06-30T09:00:00.000Z' }],
  };
  assert.equal(exportRangeDefaults(state).from, '2026-06-30');
  assert.equal(exportRangeDefaults({ ...state, daily: [], media: [], measurements: [] }).from, '2026-08-18');
});

/* ── L4 / UI-12: the export "To" date ───────────────────────────────── */

test('L4: the export "To" date is the local civil date, not the UTC one', () => {
  // Between local midnight and 01:00/02:00 in Zagreb the UTC date is still
  // yesterday, so the default range left out the session just logged.
  const state = { todayISO: '2026-09-30', logs: [], daily: [], measurements: [], niggles: [], media: [] };
  assert.equal(exportRangeDefaults(state).to, '2026-09-30');
  assert.equal(exportRangeDefaults(state).from, '2026-09-30', 'with nothing stored, the range is just today');
  assert.doesNotMatch(source('../js/ui/settings.js'), /toISOString\(\)\.slice\(0, 10\)/);
});
