import test from 'node:test';
import assert from 'node:assert/strict';

import { createFakeEnv, FakeIDBKeyRange } from './helpers/fake-indexeddb.js';
import {
  DB_NAME,
  DB_VERSION,
  FORMAT_VERSION,
  ALL_STORES,
  MIGRATIONS,
  openDatabase,
  put,
  putAll,
  get,
  getAll,
  getAllByIndex,
  remove,
  count,
  saveSession,
  deleteSessionCascade,
  putSetIdempotent,
  startSessionAtomic,
  finishSessionAtomic,
  softDeleteSession,
  restoreSession,
  logicalSetKey,
  alive,
  snapshot,
  setsForSession,
  setsForExercise,
  logsBetween,
  confirmWorkingMax,
  maxHistoryFor,
  readSettings,
  writeSetting,
  requestPersistentStorage,
  storageEstimate,
  checkIntegrity,
} from '../js/db.js';

const openAt = (env, version) =>
  openDatabase({ indexedDB: env.indexedDB, name: DB_NAME, version });

const freshDb = async () => {
  const env = createFakeEnv();
  return { env, db: await openAt(env, DB_VERSION) };
};

/* ── schema ──────────────────────────────────────────────────────────── */

test('opening creates every store in the schema', async () => {
  const { db } = await freshDb();

  for (const name of ALL_STORES) {
    assert.equal(db.objectStoreNames.contains(name), true, `missing ${name}`);
  }
  assert.equal(db.version, DB_VERSION);
});

test('settings start at the documented defaults', async () => {
  const { db } = await freshDb();
  const settings = await readSettings(db);

  assert.equal(settings.unit, 'kg');
  assert.equal(settings.increment, 2.5);
  assert.equal(settings.formatVersion, FORMAT_VERSION);
  assert.equal(settings.lastBackupISO, null);

  await writeSetting(db, 'unit', 'lb');
  assert.equal((await readSettings(db)).unit, 'lb');
});

/* ── round-tripping data ─────────────────────────────────────────────── */

test('a set survives a write, a close and a reopen', async () => {
  const env = createFakeEnv();
  const db = await openAt(env, DB_VERSION);

  const id = await put(db, 'sets', {
    sessionLogId: 1,
    exerciseId: 'benchComp',
    setIndex: 0,
    load: 92.5,
    reps: 5,
    rpe: 8,
    rir: null,
    toFailure: false,
    isAmrap: false,
    isIndexSet: true,
    isMyoRep: false,
    velocity: null,
    note: null,
    wasPrescribed: true,
    prescribedLoad: 92.5,
    timestampISO: '2026-08-20T18:04:00.000Z',
    gripWidth: 'rings',
    variantUsed: null,
    pauseStyle: 'paused',
  });
  db.close();

  const reopened = await openAt(env, DB_VERSION);
  const stored = await get(reopened, 'sets', id);

  assert.equal(stored.load, 92.5);
  assert.equal(stored.pauseStyle, 'paused');
  assert.equal(stored.isIndexSet, true);
});

test('blanks stay blank — nothing is coerced to zero', async () => {
  const { db } = await freshDb();
  const id = await put(db, 'sets', {
    sessionLogId: 1,
    exerciseId: 'lateral',
    load: null,
    reps: null,
    rpe: null,
  });

  const stored = await get(db, 'sets', id);
  assert.equal(stored.load, null);
  assert.equal(stored.reps, null);
  assert.notEqual(stored.reps, 0);
});

test('stored values are copies, not live references', async () => {
  const { db } = await freshDb();
  const row = { dateISO: '2026-08-20', bodyweight: 90.4 };
  const id = await put(db, 'daily', row);

  row.bodyweight = 999;
  assert.equal((await get(db, 'daily', id)).bodyweight, 90.4);
});

test('a session and its sets are written in one transaction', async () => {
  const { db } = await freshDb();

  const { sessionLogId, setIds } = await saveSession(
    db,
    {
      dateISO: '2026-08-20',
      startedAt: '2026-08-20T17:40:00.000Z',
      endedAt: '2026-08-20T18:55:00.000Z',
      sessionId: 'A',
      blockId: 1,
      rotationIndex: 0,
      bodyweight: 90.4,
      sessionRpe: 7,
      note: null,
      isPartial: false,
    },
    [
      { exerciseId: 'benchComp', setIndex: 0, load: 105, reps: 1, rpe: 8, isIndexSet: true },
      { exerciseId: 'benchComp', setIndex: 1, load: 90, reps: 3, rpe: 8 },
      { exerciseId: 'lateral', setIndex: 0, load: 12, reps: 15, rpe: 10 },
    ]
  );

  assert.equal(setIds.length, 3);
  const sets = await setsForSession(db, sessionLogId);
  assert.equal(sets.length, 3);
  assert.deepEqual(sets.map((s) => s.sessionLogId), [sessionLogId, sessionLogId, sessionLogId]);
  assert.equal((await setsForExercise(db, 'benchComp')).length, 2);
});

test('a failed write rolls the whole transaction back', async () => {
  const { db } = await freshDb();
  await put(db, 'sessionLogs', { dateISO: '2026-08-20', sessionId: 'A' });

  // `maxes` is keyed by exerciseId, so a row without one cannot be stored.
  // (`daily` stopped being a useful example at v4: it is keyed by an
  // auto-increment id now, so any row at all is storable.)
  await assert.rejects(() => put(db, 'maxes', { workingMax: 120 }));
  assert.equal(await count(db, 'maxes'), 0);
  assert.equal(await count(db, 'sessionLogs'), 1, 'the earlier write is untouched');
});

test('indexes answer the queries the app actually makes', async () => {
  const { env, db } = await freshDb();

  await putAll(db, 'sessionLogs', [
    { dateISO: '2026-08-18', sessionId: 'A', blockId: 1 },
    { dateISO: '2026-08-20', sessionId: 'B', blockId: 1 },
    { dateISO: '2026-09-02', sessionId: 'C', blockId: 2 },
  ]);

  assert.equal((await getAllByIndex(db, 'sessionLogs', 'blockId', 1)).length, 2);
  assert.equal((await getAllByIndex(db, 'sessionLogs', 'sessionId', 'C')).length, 1);

  const august = await logsBetween(db, '2026-08-01', '2026-08-31', {
    IDBKeyRange: env.IDBKeyRange,
  });
  assert.deepEqual(august.map((l) => l.sessionId), ['A', 'B']);

  // The range is inclusive of a full timestamp on the last day.
  await put(db, 'sessionLogs', { dateISO: '2026-08-31T22:00:00.000Z', sessionId: 'F', blockId: 1 });
  const withLastDay = await logsBetween(db, '2026-08-01', '2026-08-31', {
    IDBKeyRange: env.IDBKeyRange,
  });
  assert.equal(withLastDay.length, 3);
});

test('deleting removes only what was asked for', async () => {
  const { db } = await freshDb();
  const keep = await put(db, 'niggles', { dateISO: '2026-08-20', site: 'left elbow', severity: 1 });
  const drop = await put(db, 'niggles', { dateISO: '2026-08-21', site: 'right elbow', severity: 2 });

  await remove(db, 'niggles', drop);
  const rows = await getAll(db, 'niggles');
  assert.deepEqual(rows.map((r) => r.id), [keep]);
});

/* ── migrations ──────────────────────────────────────────────────────── */

test('the migration list is ordered, contiguous and ends at DB_VERSION', () => {
  assert.deepEqual(MIGRATIONS.map((m) => m.version), [1, 2, 3, 4]);
  assert.equal(MIGRATIONS[MIGRATIONS.length - 1].version, DB_VERSION);
});

test('v1 → v2 migrates a populated database without losing anything', async () => {
  const env = createFakeEnv();

  // ── a real v1 database, with data in every store ──
  const v1 = await openAt(env, 1);
  assert.equal(v1.version, 1);
  assert.equal(v1.objectStoreNames.contains('maxHistory'), false, 'v2 store does not exist yet');
  assert.equal((await readSettings(v1)).formatVersion, 1);

  const { sessionLogId } = await saveSession(
    v1,
    { dateISO: '2026-08-20', sessionId: 'E', blockId: 1, sessionRpe: 8, isPartial: false },
    [
      { exerciseId: 'benchComp', setIndex: 0, load: 95, reps: 6, rpe: 10, isAmrap: true, isIndexSet: true },
      { exerciseId: 'dip', setIndex: 0, load: 38, reps: 8, rpe: 8, isIndexSet: true },
    ]
  );
  await put(v1, 'daily', { dateISO: '2026-08-20', bodyweight: 90.4, sleepHours: 7.5 });
  await put(v1, 'measurements', { dateISO: '2026-08-20', waist: 82.3, chest: 108 });
  await put(v1, 'niggles', { dateISO: '2026-08-19', site: 'left elbow', severity: 1 });
  await put(v1, 'media', { dateISO: '2026-08-20', kind: 'physique', note: 'front' });
  await putAll(v1, 'maxes', [
    { exerciseId: 'benchComp', workingMax: 115, conf: 'high', setAtISO: '2026-08-20', blockId: 1 },
    { exerciseId: 'dip', workingMax: 38, conf: 'high', setAtISO: '2026-08-20', blockId: 1 },
  ]);
  const before = {
    logs: await getAll(v1, 'sessionLogs'),
    sets: await getAll(v1, 'sets'),
    daily: await getAll(v1, 'daily'),
    measurements: await getAll(v1, 'measurements'),
    niggles: await getAll(v1, 'niggles'),
    media: await getAll(v1, 'media'),
    maxes: await getAll(v1, 'maxes'),
  };
  v1.close();

  // ── reopen at v2 ──
  const v2 = await openAt(env, 2);
  assert.equal(v2.version, 2);
  assert.equal(v2.objectStoreNames.contains('maxHistory'), true);

  assert.deepEqual(await getAll(v2, 'sessionLogs'), before.logs);
  assert.deepEqual(await getAll(v2, 'sets'), before.sets);
  assert.deepEqual(await getAll(v2, 'daily'), before.daily);
  assert.deepEqual(await getAll(v2, 'measurements'), before.measurements);
  assert.deepEqual(await getAll(v2, 'niggles'), before.niggles);
  assert.deepEqual(await getAll(v2, 'media'), before.media);
  assert.deepEqual(await getAll(v2, 'maxes'), before.maxes);

  // the sets are still attached to their session
  assert.equal((await setsForSession(v2, sessionLogId)).length, 2);

  // ── and the v2 store is backfilled from the populated data ──
  const history = await getAll(v2, 'maxHistory');
  assert.equal(history.length, 2);
  assert.deepEqual(history.map((h) => h.exerciseId).sort(), ['benchComp', 'dip']);
  assert.equal(history.every((h) => h.reason === 'migrated-v2'), true);
  assert.equal(history.find((h) => h.exerciseId === 'benchComp').workingMax, 115);

  assert.equal((await readSettings(v2)).formatVersion, 2);
});

test('migrating an empty v1 database is a no-op beyond the schema', async () => {
  const env = createFakeEnv();
  (await openAt(env, 1)).close();

  const v2 = await openAt(env, 2);
  assert.equal(await count(v2, 'maxHistory'), 0);
  assert.equal((await readSettings(v2)).formatVersion, 2);
});

test('opening an already-current database runs no migration', async () => {
  const env = createFakeEnv();
  const first = await openAt(env, DB_VERSION);
  await confirmWorkingMax(first, {
    exerciseId: 'benchComp',
    workingMax: 118,
    conf: 'high',
    setAtISO: '2026-09-28',
    blockId: 1,
  });
  first.close();

  const second = await openAt(env, DB_VERSION);
  assert.equal((await getAll(second, 'maxHistory')).length, 1, 'no duplicate backfill');
});

/* ── working maxes ───────────────────────────────────────────────────── */

test('confirming a working max keeps an append-only history', async () => {
  const { db } = await freshDb();

  await confirmWorkingMax(db, {
    exerciseId: 'benchComp',
    workingMax: 115,
    conf: 'high',
    setAtISO: '2026-08-17',
    blockId: 0,
  });
  await confirmWorkingMax(
    db,
    { exerciseId: 'benchComp', workingMax: 121.5, conf: 'high', setAtISO: '2026-09-28', blockId: 1 },
    'block-boundary'
  );

  const current = await get(db, 'maxes', 'benchComp');
  assert.equal(current.workingMax, 121.5, 'one current row per exercise');

  const history = await maxHistoryFor(db, 'benchComp');
  assert.deepEqual(history.map((h) => h.workingMax), [115, 121.5]);
  assert.deepEqual(history.map((h) => h.setAtISO), ['2026-08-17', '2026-09-28']);
});

/* ── storage and integrity ───────────────────────────────────────────── */

test('persistent storage is requested and the answer reported either way', async () => {
  assert.deepEqual(await requestPersistentStorage({}), { supported: false, persisted: false });

  const granted = {
    storage: { persisted: async () => false, persist: async () => true },
  };
  assert.deepEqual(await requestPersistentStorage(granted), { supported: true, persisted: true });

  const refused = {
    storage: { persisted: async () => false, persist: async () => false },
  };
  assert.deepEqual(await requestPersistentStorage(refused), { supported: true, persisted: false });

  let persistCalls = 0;
  const already = {
    storage: {
      persisted: async () => true,
      persist: async () => (persistCalls++, true),
    },
  };
  assert.deepEqual(await requestPersistentStorage(already), { supported: true, persisted: true });
  assert.equal(persistCalls, 0, 'no need to ask twice');

  assert.deepEqual(await storageEstimate({}), { supported: false, usage: null, quota: null });
  assert.deepEqual(
    await storageEstimate({ storage: { estimate: async () => ({ usage: 12, quota: 100 }) } }),
    { supported: true, usage: 12, quota: 100 }
  );
});

test('the integrity check passes on a healthy database', async () => {
  const { db } = await freshDb();
  await saveSession(db, { dateISO: '2026-08-20', sessionId: 'A', blockId: 1 }, [
    { exerciseId: 'benchComp', setIndex: 0, load: 105, reps: 1, rpe: 8 },
  ]);

  const report = await checkIntegrity(db);
  assert.equal(report.ok, true, report.problems.join('; '));
  assert.equal(report.counts.sets, 1);
  assert.equal(report.formatVersion, FORMAT_VERSION);
});

test('the integrity check finds orphaned sets and undated sessions', async () => {
  const { db } = await freshDb();
  await put(db, 'sets', { sessionLogId: 999, exerciseId: 'benchComp', load: 100, reps: 3 });
  await put(db, 'sessionLogs', { sessionId: 'A', blockId: 1 });

  const report = await checkIntegrity(db);
  assert.equal(report.ok, false);
  assert.equal(report.problems.some((p) => p.includes('sets with no session')), true);
  assert.equal(report.problems.some((p) => p.includes('sessions with no date')), true);
});

test('the integrity check refuses data from a newer version of the app', async () => {
  const { db } = await freshDb();
  await writeSetting(db, 'formatVersion', FORMAT_VERSION + 1);

  const report = await checkIntegrity(db);
  assert.equal(report.ok, false);
  assert.equal(report.problems.some((p) => p.includes('newer version')), true);
});

/* ── the fake itself ─────────────────────────────────────────────────── */

test('key ranges bound both ends the way the queries assume', () => {
  const range = FakeIDBKeyRange.bound('2026-08-01', '2026-08-31');
  assert.equal(range.includes('2026-08-01'), true);
  assert.equal(range.includes('2026-08-31'), true);
  assert.equal(range.includes('2026-07-31'), false);
  assert.equal(range.includes('2026-09-01'), false);
});

test('deleting a session takes its sets with it', async () => {
  const { db } = await freshDb();

  const first = await saveSession(db, { dateISO: '2026-08-20', sessionId: 'A', blockId: 1 }, [
    { exerciseId: 'benchComp', setIndex: 0, load: 105, reps: 1, rpe: 8 },
    { exerciseId: 'benchComp', setIndex: 1, load: 90, reps: 3, rpe: 8 },
  ]);
  const second = await saveSession(db, { dateISO: '2026-08-22', sessionId: 'B', blockId: 1 }, [
    { exerciseId: 'legpress', setIndex: 0, load: 200, reps: 10, rpe: 9 },
  ]);

  const result = await deleteSessionCascade(db, first.sessionLogId);
  assert.equal(result.deletedSets, 2);

  assert.equal((await getAll(db, 'sessionLogs')).length, 1, 'only the other session is left');
  assert.equal((await setsForSession(db, first.sessionLogId)).length, 0);
  assert.equal((await setsForSession(db, second.sessionLogId)).length, 1, 'the other session is untouched');

  // No orphans is the point — that is exactly what the integrity check hunts for.
  const report = await checkIntegrity(db);
  assert.equal(report.ok, true, report.problems.join('; '));
});

test('a snapshot carries every store and can be read back', async () => {
  const { db } = await freshDb();
  await saveSession(db, { dateISO: '2026-08-20', sessionId: 'A', blockId: 1 }, [
    { exerciseId: 'benchComp', setIndex: 0, load: 105, reps: 1, rpe: 8 },
  ]);
  await put(db, 'daily', { dateISO: '2026-08-20', bodyweight: 90.4 });

  const backup = await snapshot(db);
  assert.equal(backup.format, FORMAT_VERSION);
  assert.equal(backup.kind, 'json-snapshot');
  assert.deepEqual(Object.keys(backup.data).sort(), [...ALL_STORES].sort());
  assert.equal(backup.data.sets.length, 1);
  assert.equal(backup.data.daily[0].bodyweight, 90.4);

  // It survives the round trip through a file.
  assert.deepEqual(JSON.parse(JSON.stringify(backup)), backup);
});

/* ── v3: identity, idempotency and recoverable deletion ─────────────── */

test('v2 → v3 backfills the identities the new unique indexes require', async () => {
  const env = createFakeEnv();

  const v2 = await openAt(env, 2);
  const { sessionLogId } = await saveSession(
    v2,
    { dateISO: '2026-08-20', sessionId: 'A', blockId: 1, startedAt: '2026-08-20T17:00:00.000Z', endedAt: '2026-08-20T18:15:00.000Z' },
    [
      { exerciseId: 'benchComp', slotIndex: 0, setIndex: 0, load: 105, reps: 1, rpe: 8 },
      { exerciseId: 'benchComp', slotIndex: 1, setIndex: 0, load: 90, reps: 3, rpe: 8 },
    ]
  );
  v2.close();

  const v3 = await openAt(env, 3);
  const sets = await getAll(v3, 'sets');

  assert.equal(sets.length, 2, 'nothing was lost');
  for (const set of sets) {
    assert.ok(set.logicalKey, 'every set gained a logical key');
    assert.ok(set.operationId, 'and an operation id');
    assert.equal(set.deletedAtISO, null);
  }
  assert.equal(new Set(sets.map((s) => s.logicalKey)).size, 2, 'the keys are distinct');

  const [log] = await getAll(v3, 'sessionLogs');
  assert.equal(log.status, 'complete', 'an ended session migrates as complete');
  assert.equal(log.deletedAtISO, null);

  // And the upgraded database still accepts writes under the new constraints.
  const written = await putSetIdempotent(
    v3,
    { sessionLogId, slotIndex: 2, setIndex: 0, exerciseId: 'lateral', load: 12, reps: 15, rpe: 10 },
    { operationId: 'after-migration' }
  );
  assert.equal(written.created, true);
});

test('the same set command twice creates one row', async () => {
  const { db } = await freshDb();
  const { log } = await startSessionAtomic(
    db,
    { dateISO: '2026-08-20', localDate: '2026-08-20', sessionId: 'A', blockId: 1, startedAt: '2026-08-20T17:00:00.000Z' },
    { operationId: 'start-1' }
  );

  const record = {
    sessionLogId: log.id, slotIndex: 0, setIndex: 0, exerciseId: 'benchComp',
    load: 105, reps: 1, rpe: 8, timestampISO: '2026-08-20T17:05:00.000Z',
  };

  // Two taps race: both see no logged set and both write.
  const [first, second] = await Promise.all([
    putSetIdempotent(db, record, { operationId: 'tap-1' }),
    putSetIdempotent(db, record, { operationId: 'tap-2' }),
  ]);

  const sets = await getAll(db, 'sets');
  assert.equal(sets.length, 1, 'one logical set, one row');
  assert.equal(sets[0].logicalKey, logicalSetKey(log.id, 0, 0));
  assert.equal(first.set.id, second.set.id, 'both calls describe the same row');
  assert.equal(first.created && second.created, false, 'only one of them created it');

  // Replaying the command that won is recognised rather than written again.
  const replay = await putSetIdempotent(db, record, { operationId: sets[0].operationId });
  assert.equal(replay.duplicate, true);
  assert.equal((await getAll(db, 'sets')).length, 1);

  // A genuine edit of the same logical set updates it rather than adding one.
  await putSetIdempotent(db, { ...record, reps: 2 }, { operationId: 'edit-1' });
  const afterEdit = await getAll(db, 'sets');
  assert.equal(afterEdit.length, 1, 'still one row');
  assert.equal(afterEdit[0].reps, 2, 'with the new value');
});

test('two starts cannot produce two active sessions', async () => {
  const { db } = await freshDb();
  const log = { dateISO: '2026-08-20', localDate: '2026-08-20', sessionId: 'A', blockId: 1, startedAt: '2026-08-20T17:00:00.000Z' };

  const [a, b] = await Promise.all([
    startSessionAtomic(db, log, { operationId: 'start-a' }),
    startSessionAtomic(db, log, { operationId: 'start-b' }),
  ]);

  const logs = await getAll(db, 'sessionLogs');
  const active = logs.filter((l) => !l.endedAt && !l.deletedAtISO);
  assert.equal(active.length, 1, 'exactly one active session');
  assert.ok(a.created || b.created, 'one of them created it');
  assert.equal(a.created && b.created, false, 'but not both');
});

test('a discarded session can be started again as a fresh session', async () => {
  const { db } = await freshDb();
  const row = { dateISO: '2026-08-20', localDate: '2026-08-20', sessionId: 'A', blockId: 1, startedAt: '2026-08-20T17:00:00.000Z' };
  const first = await startSessionAtomic(db, row, { operationId: 'first-attempt' });

  await softDeleteSession(db, first.log.id, { reason: 'started by mistake' });
  await writeSetting(db, 'activeSessionLogId', null);
  const second = await startSessionAtomic(db, { ...row, startedAt: '2026-08-20T17:05:00.000Z' }, { operationId: 'second-attempt' });

  assert.equal(second.created, true);
  assert.notEqual(second.log.id, first.log.id);
  assert.ok(!second.log.deletedAtISO);
});

test('finishing is atomic and a finished session never reopens', async () => {
  const { db } = await freshDb();
  const { log } = await startSessionAtomic(
    db,
    { dateISO: '2026-08-20', localDate: '2026-08-20', sessionId: 'A', blockId: 1, startedAt: '2026-08-20T17:00:00.000Z' },
    { operationId: 'start' }
  );

  const finished = await finishSessionAtomic(db, log.id, {
    endedAt: '2026-08-20T18:20:00.000Z',
    sessionRpe: 7,
    isPartial: false,
  });
  assert.equal(finished.alreadyFinished, false);

  const settings = await readSettings(db);
  assert.equal(settings.activeSessionLogId, null, 'the pointer is released in the same transaction');

  // Finishing twice is harmless, and starting again does not resurrect it.
  const again = await finishSessionAtomic(db, log.id, { endedAt: '2026-08-20T19:00:00.000Z' });
  assert.equal(again.alreadyFinished, true);
  assert.equal(again.log.endedAt, '2026-08-20T18:20:00.000Z', 'the original end time stands');

  const restarted = await startSessionAtomic(
    db,
    { dateISO: '2026-08-21', localDate: '2026-08-21', sessionId: 'B', blockId: 1, startedAt: '2026-08-21T17:00:00.000Z' },
    { operationId: 'start-2' }
  );
  assert.equal(restarted.created, true, 'a new session starts cleanly');
  assert.notEqual(restarted.log.id, log.id);
});

test('deleting is recoverable, and restores the sets with it', async () => {
  const { db } = await freshDb();
  const { sessionLogId } = await saveSession(db, { dateISO: '2026-08-20', sessionId: 'A', blockId: 1 }, [
    { exerciseId: 'benchComp', slotIndex: 0, setIndex: 0, load: 105, reps: 1, rpe: 8 },
    { exerciseId: 'benchComp', slotIndex: 1, setIndex: 0, load: 90, reps: 3, rpe: 8 },
  ]);

  const deleted = await softDeleteSession(db, sessionLogId, { reason: 'logged the wrong session' });
  assert.equal(deleted.deletedSets, 2);

  assert.equal(alive(await getAll(db, 'sessionLogs')).length, 0, 'gone from every live read');
  assert.equal(alive(await getAll(db, 'sets')).length, 0);
  assert.equal((await getAll(db, 'sets')).length, 2, 'but still on disk');

  const audit = await getAll(db, 'auditLog');
  assert.equal(audit[0].action, 'delete');
  assert.equal(audit[0].reason, 'logged the wrong session');

  const restored = await restoreSession(db, sessionLogId);
  assert.equal(restored.restoredSets, 2);
  assert.equal(alive(await getAll(db, 'sets')).length, 2, 'and it comes back');
});
