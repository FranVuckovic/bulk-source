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
  alive,
  putSetIdempotent,
  softDeleteRow,
  softDeleteSession,
  restoreSession,
  deletedRecords,
  startSessionAtomic,
  clearStore,
  readSettings,
  ALL_STORES,
} from '../js/db.js';
import { cycleSettingKeys } from '../js/plans.js';
import { planCorrection } from '../js/cycle.js';
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

/* ── M1: restoring a session restores only what the delete took ────── */

test('M1: restoring a deleted session does not bring back displaced sets or sets binned on purpose', async () => {
  const db = await freshDb();
  const { sessionLogId } = await saveSession(db, { dateISO: '2026-08-18', sessionId: 'D', endedAt: '2026-08-18T19:00:00.000Z' }, []);
  const set = (slotIndex, setIndex, exerciseId, load) => ({
    sessionLogId, slotIndex, setIndex, exerciseId, load, reps: 10, rpe: 8, timestampISO: '2026-08-18T18:00:00.000Z',
  });

  // The leg press set, then a swap to hack squat on the same slot displaces it.
  await putSetIdempotent(db, set(0, 0, 'legpress', 200), { operationId: 'op-1' });
  const { set: hack } = await putSetIdempotent(db, set(0, 0, 'hackSquat', 120), { operationId: 'op-2' });
  // A duplicate, deleted on purpose.
  const { set: duplicate } = await putSetIdempotent(db, set(1, 0, 'legCurl', 50), { operationId: 'op-3' });
  await softDeleteRow(db, 'sets', duplicate.id, { reason: 'logged twice' });

  assert.deepEqual(alive(await getAll(db, 'sets')).map((row) => row.id), [hack.id], 'one live set before the delete');

  await softDeleteSession(db, sessionLogId);
  await restoreSession(db, sessionLogId);

  const live = alive(await getAll(db, 'sets'));
  assert.deepEqual(live.map((row) => row.id), [hack.id], 'and exactly that one after the restore');
  const binned = (await deletedRecords(db)).filter((entry) => entry.store === 'sets');
  assert.ok(binned.some((entry) => entry.id === duplicate.id), 'the purposely deleted set is still in the bin');
});

/* ── L2: restoring a discarded open session ─────────────────────────── */

/** An open session with two sets, discarded the way the Train screen does it. */
async function discardedOpenSession(db, { day = '2026-08-18' } = {}) {
  const { log } = await startSessionAtomic(
    db,
    { dateISO: day, localDate: day, sessionId: 'A', startedAt: `${day}T17:00:00.000Z`, endedAt: null },
    { operationId: `start-${day}` }
  );
  for (const [setIndex, minute] of [[0, '10'], [1, '20']]) {
    await putSetIdempotent(
      db,
      { sessionLogId: log.id, slotIndex: 0, setIndex, exerciseId: 'benchComp', load: 100, reps: 5, rpe: 8, timestampISO: `${day}T17:${minute}:00.000Z` },
      { operationId: `set-${day}-${setIndex}` }
    );
  }
  await softDeleteSession(db, log.id, { reason: 'discarded while active' });
  await put(db, 'settings', { key: 'activeSessionLogId', value: null });
  return log.id;
}

test('L2: a session discarded by mistake today comes back as the open session, not stuck', async () => {
  const db = await freshDb();
  const id = await discardedOpenSession(db);

  const result = await restoreSession(db, id, { today: '2026-08-18' });
  assert.equal(result.reopened, true);
  const settings = await getAll(db, 'settings');
  assert.equal(settings.find((row) => row.key === 'activeSessionLogId').value, id, 'it is the active session again');
  const log = (await getAll(db, 'sessionLogs')).find((row) => row.id === id);
  assert.equal(log.status, 'active');
  assert.equal(log.endedAt, null);
});

test('L2: a discarded session that cannot be reopened is restored finished, at its last set', async () => {
  // Discarded on an earlier day: reopening it would start a clock that has
  // been running for days. And if another session is open, two open sessions
  // is exactly what startSessionAtomic exists to prevent. Either way it comes
  // back finished, so it can be seen, counted and reopened from the Log.
  const db = await freshDb();
  const id = await discardedOpenSession(db);

  const result = await restoreSession(db, id, { today: '2026-08-25' });
  assert.equal(result.reopened, false);
  const log = (await getAll(db, 'sessionLogs')).find((row) => row.id === id);
  assert.equal(log.endedAt, '2026-08-18T17:20:00.000Z', 'ended at the last set logged');
  assert.equal(log.status, 'partial');
  const settings = await getAll(db, 'settings');
  assert.equal(settings.find((row) => row.key === 'activeSessionLogId').value, null, 'nothing was made active');

  const other = await freshDb();
  const discarded = await discardedOpenSession(other);
  const { log: open } = await startSessionAtomic(other, { dateISO: '2026-08-18', sessionId: 'B', endedAt: null }, { operationId: 'b' });
  const again = await restoreSession(other, discarded, { today: '2026-08-18' });
  assert.equal(again.reopened, false, 'another session is open, so it is not displaced');
  const pointer = (await getAll(other, 'settings')).find((row) => row.key === 'activeSessionLogId').value;
  assert.equal(pointer, open.id);
});

test('L2: the bin passes today to the restore and picks up a reopened session', () => {
  const app = source('../js/app.js');
  const body = app.slice(app.indexOf('async restoreEntry(store, rawKey)'));
  const restoreEntry = body.slice(0, body.indexOf('\n  },'));
  assert.match(restoreEntry, /restoreSession\(state\.db, key, \{ today: todayISO\(\) \}\)/);
  assert.match(restoreEntry, /reopened[\s\S]*restoreActiveSession\(\)/, 'a reopened session is put back on the Train screen');
});

/* ── C1: after a restore, the app kept running the plan it had before ── */

/** The body of one method or function in app.js, up to its closing brace. */
function bodyOf(app, signature, end = '\n  },') {
  const start = app.indexOf(signature);
  assert.ok(start > -1, `app.js no longer has ${signature}`);
  const rest = app.slice(start);
  return rest.slice(0, rest.indexOf(end));
}

test('C1: importing a backup re-reads the restored plan choice, rotation and settings before anything else runs', () => {
  // Restoring his FLOPIP 2 backup onto a fresh install left the app on FOPIP:
  // the next session was filed as FOPIP rotation 8, and that open session then
  // kept FOPIP active even across a reload. `loadEverything` reads the
  // rotation pointer for `state.plan`, and nothing re-read which plan that is.
  const app = source('../js/app.js');
  const adopt = bodyOf(app, 'async function adoptStoredState(', '\n}\n');
  assert.match(adopt, /readSettings\(state\.db\)/, 'it reads the settings the restore just wrote');
  assert.match(adopt, /state\.activePlanId = /, 'including which plan is active');
  assert.match(adopt, /state\.plan = state\.plans\[state\.activePlanId\]/);
  assert.match(adopt, /customExercises/, 'and the exercises you added, which every plan is merged with');
  assert.ok(adopt.indexOf('state.plan = ') < adopt.indexOf('loadEverything()'), 'before the rotation is worked out from it');
  assert.match(adopt, /state\.activeLog = null/, 'the open session held in memory belongs to the old data');
  assert.match(adopt, /restoreActiveSession\(\)/);

  const apply = bodyOf(app, 'async applyStagedImport(');
  assert.match(apply, /await adoptStoredState\(\)/, 'the import runs it');
  assert.doesNotMatch(apply, /await loadEverything\(\)/, 'rather than a partial reload that keeps the old plan');

  const boot = bodyOf(app, 'async function boot(', '\n}\n');
  assert.match(boot, /await adoptStoredState\(\)/, 'boot uses the same path, so the two cannot drift apart');
});

/* ── L5: "Erase all data" kept the rotation pointers ──────────────────── */

test('L5 and C1: erasing resets everything stored, the rotation pointers of both plans included', () => {
  // Settings were skipped, so after an erase the plan resumed at rotation N
  // with no history behind it, on whichever plan was last active.
  const app = source('../js/app.js');
  const erase = bodyOf(app, 'async eraseEverything(');
  assert.match(erase, /withTransaction\(state\.db, \[\.\.\.ALL_STORES\]/, 'every store, in one transaction');
  assert.doesNotMatch(erase, /settings/, 'settings are not spared');
  assert.match(erase, /await adoptStoredState\(\)/, 'and the app is left on the erased state, not the old plan');
});

test('L5: erasing a database leaves no rotation pointer for either plan', async () => {
  const db = await freshDb();
  for (const planId of ['fopip-v2', 'flopip-2']) {
    const keys = cycleSettingKeys(planId);
    await put(db, 'settings', { key: keys.sequence, value: 8 });
    await put(db, 'settings', { key: keys.startedDate, value: '2026-08-01' });
  }
  await put(db, 'settings', { key: 'activePlanId', value: 'flopip-2' });

  for (const store of ALL_STORES) await clearStore(db, store);

  const settings = await readSettings(db);
  for (const planId of ['fopip-v2', 'flopip-2']) {
    assert.equal(settings[cycleSettingKeys(planId).sequence], undefined, `${planId} starts again at rotation 1`);
  }
  assert.equal(settings.activePlanId, undefined, 'and the plan choice falls back to the default');
  assert.equal(settings.unit, 'kg', 'defaults still apply to what was erased');
});

/* ── L1: rotation correction accepted 0, fractions and out-of-range ──── */

test('L1: a rotation correction refuses 0, a blank, a fraction and a rotation past the end', () => {
  // A blank field is Number('') = 0, which was accepted and stored a cycle
  // with sequence 0 and no block; 7.5 gave a rotation with no effort mode.
  const correct = (to) =>
    planCorrection({ field: 'cycleSequence', from: 3, to, reason: 'trained away from the app', atISO: 'x', max: 33 });
  for (const bad of [0, Number(''), 7.5, -1, 34, NaN, Infinity]) {
    assert.equal(correct(bad).ok, false, `${bad} is refused`);
  }
  assert.equal(correct(4).ok, true);
  assert.equal(correct(33).ok, true, 'the last rotation is a rotation');
});

test('L1: the app passes the plan length to the correction, and moving a session validates the same way', () => {
  const app = source('../js/app.js');
  const correctCycle = bodyOf(app, 'async correctCycle(');
  assert.match(correctCycle, /max: state\.plan\.meta\.rotations/);

  const move = bodyOf(app, 'async moveSessionToCycle(');
  assert.match(move, /Number\.isInteger\(to\)/, 'a fraction is refused rather than clamped');
  assert.doesNotMatch(move, /Math\.max\(1, Number\(toSequence\)\)/, 'and 0 is refused rather than silently becoming 1');
});

/* ── L8: advancing could create a second cycle at the same sequence ──── */

test('L8: advancing reuses a rotation that a correction or a moved session already created', () => {
  // `moveSessionToCycle` and `correctCycle` both create the target cycle when
  // it does not exist. `advanceCycle` always wrote a new one, leaving two
  // cycles at one sequence, and loadEverything picked whichever sorted first.
  const app = source('../js/app.js');
  const advance = bodyOf(app, 'async advanceCycle(');
  const lookup = advance.indexOf('state.cycles.find((c) => c.sequence === to)');
  assert.ok(lookup > -1, 'it looks for an existing cycle at the target sequence');
  assert.ok(lookup < advance.indexOf('newCycle('), 'before it creates one');
});
