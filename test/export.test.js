import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFakeEnv } from './helpers/fake-indexeddb.js';
import { openDatabase, put, clearStore, saveSession, snapshot, DB_VERSION } from '../js/db.js';
import {
  makeZip,
  readZip,
  crc32,
  toCsv,
  buildExport,
  parseImport,
  restore,
  validateImport,
  verifyAgainst,
  applyImport,
} from '../js/export.js';


/** A snapshot shaped exactly as db.snapshot() produces one. */
const snapshotOf = (data) => ({
  format: 3,
  takenAtISO: '2026-08-19T10:00:00.000Z',
  kind: 'json-snapshot',
  data: {
    sessionLogs: [], sets: [], daily: [], measurements: [], media: [],
    niggles: [], maxes: [], settings: [], maxHistory: [], cycles: [], auditLog: [],
    ...data,
  },
});

/** Split CSV into records, respecting quoted fields that contain newlines. */
function splitCsvRows(csv) {
  const rows = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (char === '"') {
      if (inQuotes && csv[i + 1] === '"') {
        current += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      current += char;
    } else if (char === '\n' && !inQuotes) {
      if (current !== '') rows.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current !== '') rows.push(current);
  return rows;
}

const freshDb = async () => {
  const env = createFakeEnv();
  return openDatabase({ indexedDB: env.indexedDB, version: DB_VERSION });
};

/** A database with something in every store, which is what a restore has to survive. */
async function populate(db) {
  const first = await saveSession(
    db,
    {
      dateISO: '2026-08-18', startedAt: '2026-08-18T17:30:00.000Z', endedAt: '2026-08-18T18:45:00.000Z',
      sessionId: 'A', blockId: 0, rotationIndex: 0, bodyweight: 90.4, sessionRpe: 7, note: 'felt good',
      isPartial: false,
    },
    [
      { exerciseId: 'benchComp', slotIndex: 0, setIndex: 0, load: 105, reps: 1, rpe: 8, isIndexSet: true, note: null, pauseStyle: 'paused' },
      { exerciseId: 'benchComp', slotIndex: 1, setIndex: 0, load: 90, reps: 3, rpe: 8, note: 'comma, quote " and\nnewline' },
      { exerciseId: 'pullupNorm', slotIndex: 2, setIndex: 0, load: 10, reps: 5, rpe: 8, bodyweightUsed: 90, isIndexSet: true },
    ]
  );
  await saveSession(db, { dateISO: '2026-09-20', sessionId: 'B', blockId: 0, endedAt: '2026-09-20T19:00:00.000Z' }, [
    { exerciseId: 'legpress', slotIndex: 0, setIndex: 0, load: 200, reps: 10, rpe: 9 },
  ]);

  await put(db, 'daily', { dateISO: '2026-08-18', bodyweight: 90.4, bodyfatPct: 13.1, sleepHours: 7.5, steps: 9000, mood: 4, caffeine: 'yes', note: null });
  await put(db, 'daily', { dateISO: '2026-09-20', bodyweight: 92.1, bodyfatPct: null, sleepHours: null, steps: null, mood: null, caffeine: null, note: null });
  await put(db, 'measurements', { dateISO: '2026-08-18', waist: 82.3, chest: 108.5, shoulders: null, armL: 38.4, armR: 38.7, quadL: null, quadR: null, neck: null, note: null });
  await put(db, 'niggles', { dateISO: '2026-08-19', site: 'Left elbow', severity: 1, context: 'skullcrushers', note: null });
  await put(db, 'media', { dateISO: '2026-08-18', kind: 'physique', exerciseId: null, load: null, reps: null, note: null, fileRef: null, imageBytes: new Uint8Array([255, 216, 255, 224, 1, 2, 3]) });
  await put(db, 'maxes', { exerciseId: 'benchComp', workingMax: 115, conf: 'high', setAtISO: '2026-08-18', sourceSetId: null, blockId: 0 });
  return first.sessionLogId;
}

/* ── the zip itself ──────────────────────────────────────────────────── */

test('crc32 matches the known check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('a zip round-trips through its own reader', () => {
  const files = [
    { name: 'meta.json', data: new TextEncoder().encode('{"format":2}') },
    { name: 'photos/a.jpg', data: new Uint8Array([1, 2, 3, 4, 5]) },
  ];
  const zip = makeZip(files);

  assert.equal(zip[0], 0x50, 'starts with PK');
  assert.equal(zip[1], 0x4b);

  const read = readZip(zip);
  assert.deepEqual(Object.keys(read), ['meta.json', 'photos/a.jpg']);
  assert.equal(new TextDecoder().decode(read['meta.json']), '{"format":2}');
  assert.deepEqual([...read['photos/a.jpg']], [1, 2, 3, 4, 5]);
});

test('the zip is readable by a real unzip, not just by us', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bulk-zip-'));
  try {
    const zip = makeZip([
      { name: 'meta.json', data: new TextEncoder().encode('{"hello":"world"}') },
      { name: 'sets.csv', data: new TextEncoder().encode('id,load\n1,105\n') },
    ]);
    const path = join(dir, 'export.zip');
    writeFileSync(path, zip);

    // If the headers or the CRCs were wrong, unzip -t would fail here.
    const output = execFileSync('unzip', ['-t', path], { encoding: 'utf8' });
    assert.match(output, /No errors detected/);

    const listed = execFileSync('unzip', ['-Z1', path], { encoding: 'utf8' }).trim().split('\n');
    assert.deepEqual(listed, ['meta.json', 'sets.csv']);
    assert.equal(execFileSync('unzip', ['-p', path, 'sets.csv'], { encoding: 'utf8' }), 'id,load\n1,105\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ── CSV ─────────────────────────────────────────────────────────────── */

test('CSV quotes what needs quoting and leaves blanks blank', () => {
  const csv = toCsv(
    [{ a: 1, b: null, c: 'has, comma', d: 'has "quotes"', e: undefined }],
    ['a', 'b', 'c', 'd', 'e']
  );
  const [header, row] = csv.trim().split('\n');

  assert.equal(header, 'a,b,c,d,e');
  assert.equal(row, '1,,"has, comma","has ""quotes""",');
  assert.ok(!row.includes('null'), 'a blank is blank, never the word null');
  assert.ok(!/,0,/.test(row), 'and never zero');
});

/* ── export → import → deep equal ────────────────────────────────────── */

test('export, wipe, import — the data comes back identical', async () => {
  const db = await freshDb();
  await populate(db);

  const before = await snapshot(db);
  const { zip, meta } = buildExport(before, { meta: { id: 'test-plan' } });

  assert.equal(meta.counts.sessionLogs, 2);
  assert.equal(meta.counts.sets, 4);

  // Wipe everything, exactly as an import into an empty database would find it.
  for (const store of ['sessionLogs', 'sets', 'daily', 'measurements', 'niggles', 'media', 'maxes', 'maxHistory']) {
    await clearStore(db, store);
  }
  assert.equal((await snapshot(db)).data.sets.length, 0);

  const parsed = parseImport(zip);
  await restore(db, parsed, { put, clearStore });
  const after = await snapshot(db);

  for (const store of ['sessionLogs', 'sets', 'daily', 'measurements', 'niggles', 'maxes']) {
    assert.deepEqual(after.data[store], before.data[store], store);
  }
});

test('photos survive the round trip byte for byte', async () => {
  const db = await freshDb();
  await populate(db);

  const before = await snapshot(db);
  const { zip } = buildExport(before, null);
  const restored = parseImport(zip);

  const originalPhoto = before.data.media.find((m) => m.imageBytes);
  const restoredPhoto = restored.data.media.find((m) => m.imageBytes);
  assert.ok(originalPhoto && restoredPhoto);
  assert.deepEqual(Object.values(restoredPhoto.imageBytes), Object.values(originalPhoto.imageBytes));

  // And the same bytes are in the zip as a real file, so they can be looked at.
  const files = readZip(zip);
  const photoName = Object.keys(files).find((name) => name.startsWith('photos/'));
  assert.ok(photoName, 'photos are written as files, not only as JSON');
  assert.deepEqual([...files[photoName]], [...Object.values(originalPhoto.imageBytes)]);
});

test('a date range takes each session with its own sets', async () => {
  const db = await freshDb();
  await populate(db);
  const full = await snapshot(db);

  const august = buildExport(full, null, { from: '2026-08-01', to: '2026-08-31' });
  const parsed = parseImport(august.zip);

  assert.equal(parsed.data.sessionLogs.length, 1, 'only the August session');
  assert.equal(parsed.data.sets.length, 3, 'and its three sets, not September\'s');
  assert.equal(parsed.data.daily.length, 1);

  const logIds = new Set(parsed.data.sessionLogs.map((log) => log.id));
  for (const set of parsed.data.sets) {
    assert.ok(logIds.has(set.sessionLogId), 'no set is orphaned by the range');
  }
});

test('leaving content out of an export leaves it out', async () => {
  const db = await freshDb();
  await populate(db);
  const full = await snapshot(db);

  const { zip, files } = buildExport(full, null, { include: { media: false, daily: false } });
  const parsed = parseImport(zip);

  assert.equal(parsed.data.media.length, 0);
  assert.equal(parsed.data.daily.length, 0);
  assert.equal(parsed.data.sets.length, 4, 'what was included is untouched');
  assert.ok(!files.some((name) => name.startsWith('photos/')));
  assert.ok(!files.includes('daily.csv'));
});

test('an import refuses what it should refuse', () => {
  assert.throws(() => parseImport(makeZip([{ name: 'random.txt', data: new Uint8Array([1]) }])), /no data\.json/);

  const fromTheFuture = makeZip([
    { name: 'data.json', data: new TextEncoder().encode(JSON.stringify({ format: 99, data: {} })) },
  ]);
  assert.throws(() => parseImport(fromTheFuture), /newer version/);
});

test('the export carries CSVs a human can open', async () => {
  const db = await freshDb();
  await populate(db);

  const { zip, files } = buildExport(await snapshot(db), { meta: { id: 'test-plan' } });
  assert.ok(files.includes('sets.csv'));
  assert.ok(files.includes('sessions.csv') || files.includes('sessionLogs.csv'));
  assert.ok(files.includes('plan.json'));

  const csv = new TextDecoder().decode(readZip(zip)['sets.csv']);
  assert.ok(csv.startsWith('id,sessionLogId,exerciseId'));
  assert.ok(csv.includes('"comma, quote "" and\nnewline"'), 'awkward text survives quoting');

  // A newline inside a quoted field is legal CSV, so rows cannot be counted by
  // splitting on newlines — which is exactly why that note is in the fixture.
  const rows = splitCsvRows(csv);
  assert.equal(rows.length - 1, 4, 'four sets, one header');
  assert.equal(rows[2].split(',').length >= 3, true);
});

/* ── the import defects, each with a test that would have caught it ──── */

test('a corrupted archive is refused, not restored', () => {
  const { zip } = buildExport(snapshotOf({ daily: [{ dateISO: '2026-08-20', bodyweight: 90.4 }] }), null);

  // Flip a byte inside the stored data and the checksum no longer matches.
  const damaged = zip.slice();
  const marker = new TextEncoder().encode('90.4');
  const at = damaged.findIndex((_, i) => marker.every((byte, j) => damaged[i + j] === byte));
  assert.ok(at > 0, 'found the value to damage');
  damaged[at] = '9'.charCodeAt(0);
  damaged[at + 1] = '1'.charCodeAt(0);

  assert.throws(() => readZip(damaged), /corrupted|checksum/i);
});

test('verification compares contents, not row counts', () => {
  // v1 compared counts only, so a backup with the same number of sets but
  // altered loads passed.
  const snapshot = snapshotOf({
    sets: [{ id: 1, sessionLogId: 1, load: 100, reps: 5, rpe: 8 }],
    sessionLogs: [{ id: 1, dateISO: '2026-08-20' }],
  });
  const backup = JSON.parse(JSON.stringify(snapshot));

  assert.equal(verifyAgainst(backup, snapshot).ok, true, 'identical data verifies');

  const tampered = JSON.parse(JSON.stringify(backup));
  tampered.data.sets[0].load = 105;

  const report = verifyAgainst(tampered, snapshot);
  assert.equal(report.ok, false, 'same count, different load — must fail');
  assert.match(report.problems.join(' '), /differ in their contents/);
});

test('an archive is validated before anything is written', () => {
  const good = snapshotOf({
    sessionLogs: [{ id: 1, dateISO: '2026-08-20' }],
    sets: [{ id: 1, sessionLogId: 1, load: 100, reps: 5, rpe: 8, logicalKey: '1:0:0' }],
  });
  assert.equal(validateImport(good).ok, true);

  // A set with no session to belong to.
  const orphaned = snapshotOf({ sessionLogs: [], sets: [{ id: 1, sessionLogId: 99, load: 100, reps: 5 }] });
  const orphanReport = validateImport(orphaned);
  assert.equal(orphanReport.ok, false);
  assert.match(orphanReport.problems.join(' '), /refer to a session/);

  // Values that would poison every average downstream.
  const impossible = snapshotOf({
    sessionLogs: [{ id: 1, dateISO: '2026-08-20' }],
    sets: [{ id: 1, sessionLogId: 1, load: -50, reps: 5, rpe: 14 }],
    daily: [{ dateISO: '2026-08-20', bodyweight: 900 }],
  });
  const report = validateImport(impossible);
  assert.equal(report.ok, false);
  assert.match(report.problems.join(' '), /impossible load/);
  assert.match(report.problems.join(' '), /RPE outside/);
  assert.match(report.problems.join(' '), /impossible bodyweight/);

  // Two copies of one logical set would breach the unique index on apply.
  const duplicated = snapshotOf({
    sessionLogs: [{ id: 1, dateISO: '2026-08-20' }],
    sets: [
      { id: 1, sessionLogId: 1, logicalKey: '1:0:0', load: 100, reps: 5, rpe: 8 },
      { id: 2, sessionLogId: 1, logicalKey: '1:0:0', load: 100, reps: 5, rpe: 8 },
    ],
  });
  assert.match(validateImport(duplicated).problems.join(' '), /two copies/);
});

test('the preview says exactly what would be replaced', () => {
  const archive = snapshotOf({
    sessionLogs: [{ id: 1, dateISO: '2026-08-20' }],
    daily: [{ dateISO: '2026-08-20', bodyweight: 91 }],
  });

  const report = validateImport(archive, { current: { daily: 12, sets: 300 } });
  assert.equal(report.ok, true);

  const daily = report.preview.find((row) => row.store === 'daily');
  assert.equal(daily.incoming, 1);
  assert.equal(daily.existing, 12);
  assert.ok(report.replaces.includes('daily'), 'the user is told daily will be replaced');

  // An archive carrying an EMPTY sets array would clear 300 stored sets under
  // replace semantics. That is exactly what the preview has to say out loud.
  const sets = report.preview.find((row) => row.store === 'sets');
  assert.equal(sets.incoming, 0);
  assert.equal(sets.existing, 300);
  assert.ok(report.replaces.includes('sets'), 'the user is warned before losing them');
});
