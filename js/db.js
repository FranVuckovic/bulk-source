/**
 * db.js — IndexedDB wrapper, schema and migrations.
 *
 * The only stateful module in the logic layer. Everything it knows how to do is
 * store and fetch; nothing derived is ever written. e1RM, rolling averages,
 * volume totals, PRs and flags are computed on read, because a stored derived
 * value is a value that goes stale without telling you.
 *
 * The IndexedDB implementation is injected rather than reached for, so the
 * schema and the migrations can be tested without a browser.
 */

export const DB_NAME = 'bulk';

/**
 * Demo mode's database. A different name is a different database: IndexedDB
 * gives no way for one to read, write or even see the other, so the real log is
 * not protected by care taken here — it is out of reach.
 */
export const DEMO_DB_NAME = 'bulk-demo';

/** Bump this and add a migration. Never edit an existing migration. */
export const DB_VERSION = 3;

/** Written into settings so a future version can recognise this data. */
export const FORMAT_VERSION = 3;

export const DEFAULT_SETTINGS = Object.freeze({
  unit: 'kg',
  increment: 2.5,
  lastBackupISO: null,
  formatVersion: FORMAT_VERSION,
});

/* ═══════════════════════════════════════════════════════════════════════
   Schema
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Every store, with the indexes the app actually queries by. Dates are stored
 * as ISO strings, which sort lexicographically — so a plain index gives ranged
 * date queries for free.
 *
 * Always store date AND time: startedAt/endedAt give session duration free, and
 * that is the instrument that catches rushing.
 */
const STORES_V1 = [
  {
    name: 'sessionLogs',
    keyPath: 'id',
    autoIncrement: true,
    indexes: [
      { name: 'dateISO', keyPath: 'dateISO' },
      { name: 'sessionId', keyPath: 'sessionId' },
      { name: 'blockId', keyPath: 'blockId' },
    ],
  },
  {
    name: 'sets',
    keyPath: 'id',
    autoIncrement: true,
    indexes: [
      { name: 'sessionLogId', keyPath: 'sessionLogId' },
      { name: 'exerciseId', keyPath: 'exerciseId' },
      { name: 'timestampISO', keyPath: 'timestampISO' },
    ],
  },
  { name: 'daily', keyPath: 'dateISO', indexes: [] },
  { name: 'measurements', keyPath: 'dateISO', indexes: [] },
  {
    name: 'media',
    keyPath: 'id',
    autoIncrement: true,
    indexes: [
      { name: 'dateISO', keyPath: 'dateISO' },
      { name: 'kind', keyPath: 'kind' },
      { name: 'exerciseId', keyPath: 'exerciseId' },
    ],
  },
  {
    name: 'niggles',
    keyPath: 'id',
    autoIncrement: true,
    indexes: [
      { name: 'dateISO', keyPath: 'dateISO' },
      { name: 'site', keyPath: 'site' },
    ],
  },
  {
    name: 'maxes',
    keyPath: 'exerciseId',
    indexes: [{ name: 'setAtISO', keyPath: 'setAtISO' }],
  },
  { name: 'settings', keyPath: 'key', indexes: [] },
];

/**
 * v2 — working-max history.
 *
 * `maxes` holds one current row per exercise, so confirming a block-boundary
 * update overwrites the number that produced every load in the block just
 * finished. The protocol says changes are explicit and dated; that is only true
 * if the old value survives somewhere, so v2 adds an append-only history and
 * seeds it from whatever is already stored.
 */
const STORES_V2 = [
  {
    name: 'maxHistory',
    keyPath: 'id',
    autoIncrement: true,
    indexes: [
      { name: 'exerciseId', keyPath: 'exerciseId' },
      { name: 'setAtISO', keyPath: 'setAtISO' },
    ],
  },
];

function createStores(db, stores) {
  for (const spec of stores) {
    if (db.objectStoreNames.contains(spec.name)) continue;
    const store = db.createObjectStore(spec.name, {
      keyPath: spec.keyPath,
      autoIncrement: !!spec.autoIncrement,
    });
    for (const index of spec.indexes || []) {
      store.createIndex(index.name, index.keyPath, { unique: !!index.unique });
    }
  }
}

/**
 * Migrations run inside the versionchange transaction, in order, for every
 * version above the one on disk. A migration that touches data uses the
 * transaction it is given — opening a new one would deadlock.
 */
export const MIGRATIONS = [
  {
    version: 1,
    upgrade(db, tx) {
      createStores(db, STORES_V1);
      tx.objectStore('settings').put({ key: 'formatVersion', value: 1 });
      tx.objectStore('settings').put({ key: 'unit', value: DEFAULT_SETTINGS.unit });
      tx.objectStore('settings').put({ key: 'increment', value: DEFAULT_SETTINGS.increment });
    },
  },
  {
    version: 2,
    upgrade(db, tx) {
      createStores(db, STORES_V2);

      const maxes = tx.objectStore('maxes');
      const history = tx.objectStore('maxHistory');
      const request = maxes.getAll();
      request.onsuccess = () => {
        for (const max of request.result || []) {
          history.put({
            exerciseId: max.exerciseId,
            workingMax: max.workingMax,
            conf: max.conf ?? null,
            setAtISO: max.setAtISO ?? null,
            sourceSetId: max.sourceSetId ?? null,
            blockId: max.blockId ?? null,
            reason: 'migrated-v2',
          });
        }
      };

      tx.objectStore('settings').put({ key: 'formatVersion', value: 2 });
    },
  },
  {
    version: 3,
    upgrade(db, tx) {
      createStores(db, STORES_V3);

      // New indexes on existing stores.
      for (const [storeName, indexes] of Object.entries(INDEXES_V3)) {
        const store = tx.objectStore(storeName);
        for (const index of indexes) {
          if (!store.indexNames.contains(index.name)) {
            store.createIndex(index.name, index.keyPath, { unique: !!index.unique });
          }
        }
      }

      // Backfill: existing rows need the identities the new indexes require, or
      // the unique constraint rejects the first write after the upgrade.
      const sets = tx.objectStore('sets');
      const setsRequest = sets.getAll();
      setsRequest.onsuccess = () => {
        for (const set of setsRequest.result || []) {
          const patched = { ...set };
          patched.logicalKey ??= `${set.sessionLogId}:${set.slotIndex ?? 0}:${set.setIndex ?? 0}`;
          patched.operationId ??= `migrated-v3-set-${set.id}`;
          patched.localDate ??= (set.timestampISO || '').slice(0, 10) || null;
          patched.deletedAtISO ??= null;
          sets.put(patched);
        }
      };

      const logs = tx.objectStore('sessionLogs');
      const logsRequest = logs.getAll();
      logsRequest.onsuccess = () => {
        for (const log of logsRequest.result || []) {
          const patched = { ...log };
          patched.cycleId ??= null;
          patched.localDate ??= (log.dateISO || '').slice(0, 10) || null;
          patched.status ??= log.endedAt ? (log.isPartial ? 'partial' : 'complete') : 'active';
          patched.deletedAtISO ??= null;
          logs.put(patched);
        }
      };

      tx.objectStore('settings').put({ key: 'formatVersion', value: 3 });
    },
  },
];

/**
 * v3 — cycles, idempotency and recoverable deletion.
 *
 * Three v1 defects shared one cause: nothing had a stable identity beyond an
 * auto-increment integer.
 *
 *   Two rapid taps both saw "no set logged here" and inserted two rows. No key
 *   said they were the same logical set.
 *   Deleting was permanent the instant it committed.
 *   A rotation had no identity at all, so a partial cycle could not be told
 *   from a complete one.
 *
 * `logicalKey` and `operationId` are unique indexes rather than conventions, so
 * a duplicate is refused by the database itself and not by a UI lock that a
 * fast thumb can beat.
 */
const STORES_V3 = [
  {
    name: 'cycles',
    keyPath: 'id',
    indexes: [
      { name: 'sequence', keyPath: 'sequence' },
      { name: 'status', keyPath: 'status' },
      { name: 'blockId', keyPath: 'blockId' },
    ],
  },
  {
    name: 'auditLog',
    keyPath: 'id',
    autoIncrement: true,
    indexes: [
      { name: 'atISO', keyPath: 'atISO' },
      { name: 'entity', keyPath: 'entity' },
    ],
  },
];

/** Indexes added to existing stores in v3. */
const INDEXES_V3 = {
  sets: [
    { name: 'logicalKey', keyPath: 'logicalKey', unique: true },
    { name: 'operationId', keyPath: 'operationId', unique: true },
    { name: 'localDate', keyPath: 'localDate' },
  ],
  sessionLogs: [
    { name: 'cycleId', keyPath: 'cycleId' },
    { name: 'localDate', keyPath: 'localDate' },
    { name: 'status', keyPath: 'status' },
  ],
};

/** Applies every migration newer than what is on disk. Exported for tests. */
export function runMigrations(db, tx, oldVersion, newVersion = DB_VERSION) {
  for (const migration of MIGRATIONS) {
    if (migration.version > oldVersion && migration.version <= newVersion) {
      migration.upgrade(db, tx);
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   Opening and the request/transaction plumbing
   ═══════════════════════════════════════════════════════════════════════ */

/** Promise wrapper for an IDBRequest. */
export function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
  });
}

export function openDatabase({
  indexedDB = globalThis.indexedDB,
  name = DB_NAME,
  version = DB_VERSION,
} = {}) {
  if (!indexedDB) return Promise.reject(new Error('IndexedDB is not available'));

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);

    req.onupgradeneeded = (event) => {
      runMigrations(req.result, req.transaction, event.oldVersion || 0, version);
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab opening a newer version must not be blocked by this one.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('Could not open the database'));
    req.onblocked = () => reject(new Error('The database is blocked by another open tab'));
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   The write lock
   ═══════════════════════════════════════════════════════════════════════ */

/*
 * Every write in this app — a set, a setting, a soft delete, an import, a
 * cascade — reaches IndexedDB through `withTransaction` and nothing else.
 * `writeSetting` goes through `put`, `put` goes through here; there is exactly
 * one `db.transaction(` call in the codebase and it is eleven lines below.
 *
 * That is what makes this lock worth having rather than decorative. Demo mode
 * needs writing to be *impossible*, not hidden: a screen that merely stops
 * drawing its save buttons is one forgotten button away from being wrong, and
 * the thing on the other side of that mistake is months of training. Refusing
 * at the only door means a write attempted from anywhere fails loudly, whether
 * or not anyone remembered this feature existed.
 *
 * Demo mode also runs against a different database entirely, so this is the
 * second of two independent guarantees rather than the only one.
 */
let writesBlocked = null;

/** Refuse every write until `allowWrites()`. The reason is what the user sees. */
export function blockWrites(reason) {
  writesBlocked = reason || 'Writing is switched off.';
}

export function allowWrites() {
  writesBlocked = null;
}

export const writesAreBlocked = () => writesBlocked;

/**
 * Runs `body` inside one transaction and resolves when the transaction
 * completes — not when the last request succeeds. Anything that writes must
 * wait for the commit, or a reload straight after logging a set can lose it.
 */
export function withTransaction(db, storeNames, mode, body) {
  if (mode === 'readwrite' && writesBlocked) {
    return Promise.reject(new Error(writesBlocked));
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result;
    let failed;

    tx.oncomplete = () => (failed ? reject(failed) : resolve(result));
    tx.onerror = () => reject(tx.error || new Error('Transaction failed'));
    tx.onabort = () => reject(failed || tx.error || new Error('Transaction aborted'));

    try {
      const stores = [].concat(storeNames).map((n) => tx.objectStore(n));
      const outcome = body(stores.length === 1 ? stores[0] : stores, tx);
      Promise.resolve(outcome).then(
        (value) => (result = value),
        (error) => {
          failed = error;
          tx.abort();
        }
      );
    } catch (error) {
      failed = error;
      tx.abort();
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   Generic access
   ═══════════════════════════════════════════════════════════════════════ */

export function put(db, storeName, value) {
  return withTransaction(db, storeName, 'readwrite', (store) => request(store.put(value)));
}

export function putAll(db, storeName, values) {
  return withTransaction(db, storeName, 'readwrite', async (store) => {
    const keys = [];
    for (const value of values) keys.push(await request(store.put(value)));
    return keys;
  });
}

export function get(db, storeName, key) {
  return withTransaction(db, storeName, 'readonly', (store) => request(store.get(key)));
}

export function getAll(db, storeName) {
  return withTransaction(db, storeName, 'readonly', (store) => request(store.getAll()));
}

export function getAllByIndex(db, storeName, indexName, query) {
  return withTransaction(db, storeName, 'readonly', (store) =>
    request(store.index(indexName).getAll(query))
  );
}

export function remove(db, storeName, key) {
  return withTransaction(db, storeName, 'readwrite', (store) => request(store.delete(key)));
}

export function clearStore(db, storeName) {
  return withTransaction(db, storeName, 'readwrite', (store) => request(store.clear()));
}

export function count(db, storeName) {
  return withTransaction(db, storeName, 'readonly', (store) => request(store.count()));
}

/* ═══════════════════════════════════════════════════════════════════════
   The app's own reads and writes
   ═══════════════════════════════════════════════════════════════════════ */

export const ALL_STORES = Object.freeze([
  ...STORES_V1.map((s) => s.name),
  ...STORES_V2.map((s) => s.name),
  ...STORES_V3.map((s) => s.name),
]);

export function setsForSession(db, sessionLogId) {
  return getAllByIndex(db, 'sets', 'sessionLogId', sessionLogId);
}

export function setsForExercise(db, exerciseId) {
  return getAllByIndex(db, 'sets', 'exerciseId', exerciseId);
}

/** Session logs for a date range, both ends inclusive. */
export function logsBetween(db, fromISO, toISO, { IDBKeyRange = globalThis.IDBKeyRange } = {}) {
  return getAllByIndex(db, 'sessionLogs', 'dateISO', IDBKeyRange.bound(fromISO, `${toISO}￿`));
}

/**
 * Writes a session and its sets in ONE transaction, so a crash mid-write cannot
 * leave sets attached to a session that does not exist.
 */
export function saveSession(db, sessionLog, sets) {
  return withTransaction(db, ['sessionLogs', 'sets'], 'readwrite', async ([logs, setStore]) => {
    const sessionLogId = await request(logs.put(sessionLog));
    const setIds = [];
    for (const set of sets || []) {
      setIds.push(await request(setStore.put({ ...set, sessionLogId })));
    }
    return { sessionLogId, setIds };
  });
}

/**
 * Confirming a working max writes the new value and appends to the history in
 * one transaction. The history is append-only — it is the audit trail for a
 * number that drives every prescription.
 */
export function confirmWorkingMax(db, max, reason = 'block-boundary') {
  return withTransaction(db, ['maxes', 'maxHistory'], 'readwrite', async ([maxes, history]) => {
    await request(maxes.put(max));
    await request(history.put({ ...max, reason }));
    return max;
  });
}

export function maxHistoryFor(db, exerciseId) {
  return getAllByIndex(db, 'maxHistory', 'exerciseId', exerciseId);
}

export async function readSettings(db) {
  const rows = await getAll(db, 'settings');
  const settings = { ...DEFAULT_SETTINGS };
  for (const row of rows) settings[row.key] = row.value;
  return settings;
}

export function writeSetting(db, key, value) {
  return put(db, 'settings', { key, value });
}

/* ═══════════════════════════════════════════════════════════════════════
   Storage and integrity
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Ask the browser to keep this data. Android grants it to installed PWAs; the
 * answer is reported in Settings either way, because a "no" is exactly the
 * thing the owner needs to know before three months of training goes in.
 */
export async function requestPersistentStorage(navigatorRef = globalThis.navigator) {
  if (!navigatorRef?.storage?.persist) return { supported: false, persisted: false };
  const already = navigatorRef.storage.persisted ? await navigatorRef.storage.persisted() : false;
  const persisted = already || (await navigatorRef.storage.persist());
  return { supported: true, persisted };
}

export async function storageEstimate(navigatorRef = globalThis.navigator) {
  if (!navigatorRef?.storage?.estimate) return { supported: false, usage: null, quota: null };
  const { usage = null, quota = null } = await navigatorRef.storage.estimate();
  return { supported: true, usage, quota };
}

/**
 * Read the database and say whether it looks sane. Silent corruption found
 * three months later is the worst possible outcome; this makes it a same-day
 * problem, which is the whole reason it runs at launch.
 */
export async function checkIntegrity(db) {
  const problems = [];

  for (const name of ALL_STORES) {
    if (!db.objectStoreNames.contains(name)) problems.push(`missing store: ${name}`);
  }
  if (problems.length) return { ok: false, problems, counts: {}, formatVersion: null };

  const counts = {};
  for (const name of ALL_STORES) counts[name] = await count(db, name);

  const logs = await getAll(db, 'sessionLogs');
  const sets = await getAll(db, 'sets');
  const logIds = new Set(logs.map((log) => log.id));

  const orphans = sets.filter((set) => !logIds.has(set.sessionLogId));
  if (orphans.length) problems.push(`${orphans.length} sets with no session`);

  const undated = logs.filter((log) => !log.dateISO);
  if (undated.length) problems.push(`${undated.length} sessions with no date`);

  const settings = await readSettings(db);
  if (settings.formatVersion > FORMAT_VERSION) {
    problems.push(`data was written by a newer version (format ${settings.formatVersion})`);
  }

  return { ok: problems.length === 0, problems, counts, formatVersion: settings.formatVersion };
}

/**
 * Delete a session and every set attached to it, in one transaction. A session
 * removed on its own would leave orphaned sets behind, which is exactly what
 * the integrity check complains about.
 */
export function deleteSessionCascade(db, sessionLogId) {
  return withTransaction(db, ['sessionLogs', 'sets'], 'readwrite', async ([logs, sets]) => {
    const attached = await request(sets.index('sessionLogId').getAll(sessionLogId));
    for (const set of attached) await request(sets.delete(set.id));
    await request(logs.delete(sessionLogId));
    return { deletedSets: attached.length };
  });
}

/**
 * Everything in the database as one plain object — the backup offered before a
 * deletion. The zip export in export.js is the real thing; this exists so that
 * "export first" is a genuine offer rather than a promise, and so a restore is
 * possible from a file the owner already has.
 */
export async function snapshot(db) {
  const data = {};
  for (const store of ALL_STORES) data[store] = await getAll(db, store);
  return {
    format: FORMAT_VERSION,
    takenAtISO: new Date().toISOString(),
    kind: 'json-snapshot',
    data,
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   Idempotent, atomic operations (schema v3)
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * A stable identity for one logical set: this session, this slot, this ordinal.
 * Two taps on the same tick produce the same key, and the unique index refuses
 * the second one — correctness lives in the database, not in a UI lock.
 */
export const logicalSetKey = (sessionLogId, slotIndex, setIndex) => `${sessionLogId}:${slotIndex}:${setIndex}`;

/** Find a set by its logical identity, deleted rows included. */
function findByIndex(store, indexName, value) {
  return request(store.index(indexName).get(value));
}

/**
 * Write a set exactly once.
 *
 * Repeating the same command — a double tap, a retried save, a replayed import
 * — returns the existing row instead of inserting a second one. The whole
 * operation is a single transaction, so a set and its session's updated
 * timestamp either both exist or neither does.
 */
export function putSetIdempotent(db, record, { operationId }) {
  return withTransaction(db, ['sets', 'sessionLogs'], 'readwrite', async ([sets, logs]) => {
    if (operationId) {
      const already = await findByIndex(sets, 'operationId', operationId);
      if (already) return { set: already, created: false, duplicate: true };
    }

    const logicalKey = record.logicalKey || logicalSetKey(record.sessionLogId, record.slotIndex, record.setIndex);
    const existing = await findByIndex(sets, 'logicalKey', logicalKey);

    const row = {
      ...record,
      logicalKey,
      operationId: operationId ?? record.operationId ?? `op-${logicalKey}-${Date.now()}`,
      deletedAtISO: null,
      ...(existing ? { id: existing.id, createdAtISO: existing.createdAtISO ?? record.createdAtISO } : {}),
    };

    const id = await request(sets.put(row));

    // Touch the session so its updated time reflects the work, in the same
    // transaction as the set itself.
    const log = await request(logs.get(record.sessionLogId));
    if (log) await request(logs.put({ ...log, updatedAtISO: row.timestampISO ?? log.updatedAtISO }));

    return { set: { ...row, id }, created: !existing, duplicate: false };
  });
}

/**
 * Start a session, or return the one already running.
 *
 * v1 could create two active logs if the first two taps of a session raced,
 * because both saw a null active pointer. Here the check and the write share
 * one transaction, and an already-active session wins.
 */
export function startSessionAtomic(db, sessionLog, { operationId }) {
  return withTransaction(db, ['sessionLogs', 'settings'], 'readwrite', async ([logs, settings]) => {
    const pointer = await request(settings.get('activeSessionLogId'));
    if (pointer?.value != null) {
      const active = await request(logs.get(pointer.value));
      // An ended session must never be restored as active.
      if (active && !active.endedAt && !active.deletedAtISO) {
        return { log: active, created: false };
      }
    }

    if (operationId) {
      const all = await request(logs.getAll());
      const already = all.find((log) => log.operationId === operationId);
      if (already) return { log: already, created: false };
    }

    const id = await request(logs.put({ ...sessionLog, operationId, status: 'active', deletedAtISO: null }));
    await request(settings.put({ key: 'activeSessionLogId', value: id }));
    return { log: { ...sessionLog, id }, created: true };
  });
}

/**
 * Finish a session and release the active pointer in one transaction.
 *
 * v1 wrote the end time and cleared the pointer separately. A failure between
 * them left the pointer aimed at a finished session, which the next launch
 * reopened — and more sets could then be appended to history.
 */
export function finishSessionAtomic(db, sessionLogId, patch) {
  return withTransaction(db, ['sessionLogs', 'settings', 'cycles'], 'readwrite', async ([logs, settings, cycles]) => {
    const log = await request(logs.get(sessionLogId));
    if (!log) throw new Error('that session no longer exists');
    if (log.endedAt) return { log, alreadyFinished: true };

    const finished = { ...log, ...patch, status: patch.status ?? 'complete' };
    await request(logs.put(finished));
    await request(settings.put({ key: 'activeSessionLogId', value: null }));

    if (finished.cycleId) {
      const cycle = await request(cycles.get(finished.cycleId));
      if (cycle) await request(cycles.put({ ...cycle, updatedAtISO: patch.endedAt ?? cycle.updatedAtISO }));
    }

    return { log: finished, alreadyFinished: false };
  });
}

/**
 * Soft delete: the row stays, marked, until it is purged.
 *
 * Deleting is the only irreversible thing the app does, and a mis-tap in a
 * list should not be able to destroy a session permanently.
 */
export function softDeleteSession(db, sessionLogId, { reason = null } = {}) {
  return withTransaction(db, ['sessionLogs', 'sets', 'auditLog'], 'readwrite', async ([logs, sets, audit]) => {
    const log = await request(logs.get(sessionLogId));
    if (!log) return { deletedSets: 0 };

    const atISO = new Date().toISOString();
    const attached = await request(sets.index('sessionLogId').getAll(sessionLogId));
    for (const set of attached) {
      if (!set.deletedAtISO) await request(sets.put({ ...set, deletedAtISO: atISO }));
    }
    // The status before the delete is kept, so a restore puts back the record
    // that was there rather than promoting a partial session to a complete one.
    await request(
      logs.put({ ...log, deletedAtISO: atISO, statusBeforeDelete: log.status ?? null, status: 'deleted' })
    );
    await request(
      audit.put({ atISO, entity: 'sessionLog', entityId: sessionLogId, action: 'delete', reason, restorable: true })
    );

    return { deletedSets: attached.length };
  });
}

/** Undo a soft delete, sets included. */
export function restoreSession(db, sessionLogId) {
  return withTransaction(db, ['sessionLogs', 'sets', 'auditLog'], 'readwrite', async ([logs, sets, audit]) => {
    const log = await request(logs.get(sessionLogId));
    if (!log) throw new Error('that session no longer exists');

    const attached = await request(sets.index('sessionLogId').getAll(sessionLogId));
    for (const set of attached) await request(sets.put({ ...set, deletedAtISO: null }));
    const restored = {
      ...log,
      deletedAtISO: null,
      status: log.statusBeforeDelete ?? (log.endedAt ? 'complete' : 'active'),
      statusBeforeDelete: null,
    };
    await request(logs.put(restored));
    await request(
      audit.put({ atISO: new Date().toISOString(), entity: 'sessionLog', entityId: sessionLogId, action: 'restore' })
    );

    return { log: restored, restoredSets: attached.length };
  });
}

/** Live rows only — everything the app reads should come through here. */
export const alive = (rows) => (rows || []).filter((row) => !row.deletedAtISO);

/* ═══════════════════════════════════════════════════════════════════════
   Soft deletion for the plain stores
   ═══════════════════════════════════════════════════════════════════════ */

/** Stores whose rows can be soft-deleted and brought back. */
export const RECOVERABLE_STORES = Object.freeze(['daily', 'measurements', 'niggles', 'media']);

/*
 * Not every store is keyed by an autoincrementing id: a weigh-in is keyed by
 * its date, because there is one per day and that is the fact worth enforcing.
 * Anything that addresses a row generically has to ask which.
 */
export const KEY_PATHS = Object.freeze({
  sessionLogs: 'id',
  sets: 'id',
  daily: 'dateISO',
  measurements: 'dateISO',
  niggles: 'id',
  media: 'id',
  cycles: 'id',
});

export const storeKeyOf = (storeName, row) => row?.[KEY_PATHS[storeName] ?? 'id'];

/** A key that came back through the DOM as a string, restored to its own type. */
export const parseStoreKey = (storeName, value) =>
  (KEY_PATHS[storeName] ?? 'id') === 'id' && storeName !== 'cycles' ? Number(value) : String(value);

/**
 * Mark a row deleted rather than removing it, and say so in the audit log.
 *
 * A weigh-in deleted because it was typed as 9.2 instead of 92 is a mistake
 * that is noticed a week later, by which time a hard delete has nothing left
 * to notice with.
 */
export async function softDeleteRow(db, storeName, id, { reason = null } = {}) {
  if (!RECOVERABLE_STORES.includes(storeName)) throw new Error(`${storeName} is not a recoverable store`);
  return withTransaction(db, [storeName, 'auditLog'], 'readwrite', async ([store, audit]) => {
    const row = await request(store.get(id));
    if (!row) throw new Error('that entry no longer exists');
    const atISO = new Date().toISOString();
    await request(store.put({ ...row, deletedAtISO: atISO }));
    await request(audit.put({ atISO, entity: storeName, entityId: id, action: 'delete', reason, restorable: true }));
    return { row };
  });
}

export async function restoreRow(db, storeName, id) {
  if (!RECOVERABLE_STORES.includes(storeName)) throw new Error(`${storeName} is not a recoverable store`);
  return withTransaction(db, [storeName, 'auditLog'], 'readwrite', async ([store, audit]) => {
    const row = await request(store.get(id));
    if (!row) throw new Error('that entry no longer exists');
    await request(store.put({ ...row, deletedAtISO: null }));
    await request(
      audit.put({ atISO: new Date().toISOString(), entity: storeName, entityId: id, action: 'restore' })
    );
    return { row };
  });
}

/** Everything currently in the bin, newest deletion first. */
export async function deletedRecords(db) {
  const out = [];
  for (const store of ['sessionLogs', ...RECOVERABLE_STORES]) {
    for (const row of await getAll(db, store)) {
      if (row.deletedAtISO) {
        out.push({ store, id: storeKeyOf(store, row), deletedAtISO: row.deletedAtISO, row });
      }
    }
  }
  return out.sort((a, b) => b.deletedAtISO.localeCompare(a.deletedAtISO));
}


/* ═══════════════════════════════════════════════════════════════════════
   One tab at a time
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Two tabs of the same app, both logging, are a data-loss shape rather than a
 * conflict shape: each holds its own idea of the active session and its own
 * in-memory draft, and the second one to write wins without either noticing.
 *
 * The database itself is already safe — `logicalKey` and `operationId` are
 * unique, so nothing can be written twice. What this adds is the part the
 * database cannot know: which tab the person is actually looking at. The
 * newest tab takes the lock and the older ones go read-only, which is the
 * right way round, because the newest one is the one in front of them.
 *
 * Best effort by design. If BroadcastChannel is missing the app still works —
 * it just cannot warn about a second tab, and the unique indexes still hold.
 */
export function claimSingleTab({ onLost, channelName = 'bulk-tabs' } = {}) {
  if (typeof BroadcastChannel !== 'function') return { ok: true, release() {}, id: null };

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const channel = new BroadcastChannel(channelName);

  channel.onmessage = (event) => {
    const message = event.data;
    // A newer tab announcing itself takes over; an older one stays put.
    if (message?.type === 'claim' && message.id !== id && message.at >= 0) onLost?.(message.id);
    if (message?.type === 'who') channel.postMessage({ type: 'here', id });
  };

  channel.postMessage({ type: 'claim', id, at: Date.now() });

  return {
    ok: true,
    id,
    release() {
      try {
        channel.postMessage({ type: 'release', id });
        channel.close();
      } catch {
        /* a closing tab cannot be helped */
      }
    },
  };
}
