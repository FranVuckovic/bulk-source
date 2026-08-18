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

/** Bump this and add a migration. Never edit an existing migration. */
export const DB_VERSION = 2;

/** Written into settings so a future version can recognise this data. */
export const FORMAT_VERSION = 2;

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
];

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

/**
 * Runs `body` inside one transaction and resolves when the transaction
 * completes — not when the last request succeeds. Anything that writes must
 * wait for the commit, or a reload straight after logging a set can lose it.
 */
export function withTransaction(db, storeNames, mode, body) {
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
