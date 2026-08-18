/**
 * A small in-memory IndexedDB, good enough to test js/db.js under node:test.
 *
 * It implements only what db.js uses: open with versionchange upgrades,
 * object stores with key paths and auto-increment, indexes, getAll with a key
 * range, and transactions that commit once their requests have drained.
 *
 * Two behaviours matter for the tests to mean anything:
 *
 *   Requests resolve in a MICROTASK and transactions commit from a MACROTASK,
 *   which is what lets `await request(...)` chain inside one transaction the way
 *   it does in a real browser without the transaction committing underneath it.
 *
 *   Values are structured-cloned on the way in and out, so a test cannot hold a
 *   live reference to stored data — the same as the real thing.
 *
 * The real implementation is exercised for real in the Playwright verification.
 */

const clone = (value) => (value === undefined ? undefined : structuredClone(value));

const typeRank = (key) => (typeof key === 'number' ? 0 : 1);

const compareKeys = (a, b) => {
  if (typeRank(a) !== typeRank(b)) return typeRank(a) - typeRank(b);
  if (typeof a === 'number') return a - b;
  return String(a).localeCompare(String(b));
};

export class FakeIDBKeyRange {
  constructor(lower, upper, lowerOpen = false, upperOpen = false) {
    this.lower = lower;
    this.upper = upper;
    this.lowerOpen = lowerOpen;
    this.upperOpen = upperOpen;
  }

  static only(value) {
    return new FakeIDBKeyRange(value, value);
  }
  static bound(lower, upper, lowerOpen, upperOpen) {
    return new FakeIDBKeyRange(lower, upper, lowerOpen, upperOpen);
  }
  static lowerBound(lower, open) {
    return new FakeIDBKeyRange(lower, undefined, open, false);
  }
  static upperBound(upper, open) {
    return new FakeIDBKeyRange(undefined, upper, false, open);
  }

  includes(key) {
    if (this.lower !== undefined) {
      const c = compareKeys(key, this.lower);
      if (c < 0 || (c === 0 && this.lowerOpen)) return false;
    }
    if (this.upper !== undefined) {
      const c = compareKeys(key, this.upper);
      if (c > 0 || (c === 0 && this.upperOpen)) return false;
    }
    return true;
  }
}

class FakeRequest {
  constructor(transaction) {
    this.transaction = transaction || null;
    this.result = undefined;
    this.error = null;
    this.onsuccess = null;
    this.onerror = null;
    this.onupgradeneeded = null;
    this.onblocked = null;
  }

  succeed(result) {
    this.result = result;
    if (this.onsuccess) this.onsuccess({ target: this });
  }

  fail(error) {
    this.error = error;
    if (this.onerror) this.onerror({ target: this });
  }
}

class StoreData {
  constructor(name, { keyPath = null, autoIncrement = false } = {}) {
    this.name = name;
    this.keyPath = keyPath;
    this.autoIncrement = autoIncrement;
    this.records = new Map();
    this.indexes = new Map();
    this.nextKey = 1;
  }
}

class DatabaseData {
  constructor(name) {
    this.name = name;
    this.version = 0;
    this.stores = new Map();
  }
}

class FakeObjectStore {
  constructor(data, transaction) {
    this.data = data;
    this.transaction = transaction;
    this.name = data.name;
    this.keyPath = data.keyPath;
  }

  createIndex(name, keyPath, options = {}) {
    this.data.indexes.set(name, { name, keyPath, unique: !!options.unique });
    return { name, keyPath };
  }

  get indexNames() {
    const names = this.data.indexes;
    return { contains: (name) => names.has(name), get length() { return names.size; } };
  }

  index(name) {
    const spec = this.data.indexes.get(name);
    if (!spec) throw new Error(`no index "${name}" on ${this.data.name}`);
    return new FakeIndex(this.data, spec, this.transaction);
  }

  put(value) {
    return this.transaction.enqueue(() => {
      const stored = clone(value);
      let key = this.data.keyPath ? stored?.[this.data.keyPath] : undefined;

      // Unique indexes are enforced here, exactly as a real one would: a second
      // row carrying an existing unique value is rejected, not merged.
      for (const spec of this.data.indexes.values()) {
        if (!spec.unique) continue;
        const value = stored?.[spec.keyPath];
        if (value === undefined || value === null) continue;
        for (const [otherKey, other] of this.data.records) {
          if (otherKey !== key && other?.[spec.keyPath] === value) {
            const error = new Error(`unique constraint failed on index ${spec.name}`);
            error.name = 'ConstraintError';
            throw error;
          }
        }
      }

      if (key === undefined || key === null) {
        if (!this.data.autoIncrement) throw new Error(`${this.data.name} requires a key`);
        key = this.data.nextKey++;
        if (this.data.keyPath) stored[this.data.keyPath] = key;
      } else if (typeof key === 'number' && key >= this.data.nextKey) {
        this.data.nextKey = key + 1;
      }

      this.data.records.set(key, stored);
      return key;
    });
  }

  get(key) {
    return this.transaction.enqueue(() => clone(this.data.records.get(key)));
  }

  getAll() {
    return this.transaction.enqueue(() => sortedValues(this.data));
  }

  delete(key) {
    return this.transaction.enqueue(() => {
      this.data.records.delete(key);
      return undefined;
    });
  }

  clear() {
    return this.transaction.enqueue(() => {
      this.data.records.clear();
      return undefined;
    });
  }

  count() {
    return this.transaction.enqueue(() => this.data.records.size);
  }
}

class FakeIndex {
  constructor(storeData, spec, transaction) {
    this.storeData = storeData;
    this.spec = spec;
    this.transaction = transaction;
    this.name = spec.name;
  }

  /** First match for a key — what a unique-index lookup uses. */
  get(query) {
    return this.transaction.enqueue(() => {
      for (const value of sortedValues(this.storeData)) {
        const key = value?.[this.spec.keyPath];
        if (key !== undefined && key !== null && compareKeys(key, query) === 0) return clone(value);
      }
      return undefined;
    });
  }

  getAll(query) {
    return this.transaction.enqueue(() => {
      const matches = [...this.storeData.records.entries()].filter(([, value]) => {
        const key = value?.[this.spec.keyPath];
        if (key === undefined || key === null) return false;
        if (query === undefined || query === null) return true;
        if (query instanceof FakeIDBKeyRange) return query.includes(key);
        return compareKeys(key, query) === 0;
      });

      matches.sort(
        ([keyA, a], [keyB, b]) =>
          compareKeys(a?.[this.spec.keyPath], b?.[this.spec.keyPath]) || compareKeys(keyA, keyB)
      );
      return matches.map(([, value]) => clone(value));
    });
  }
}

const sortedValues = (storeData) =>
  [...storeData.records.entries()]
    .sort(([a], [b]) => compareKeys(a, b))
    .map(([, value]) => clone(value));

class FakeTransaction {
  constructor(db, storeNames, mode) {
    this.db = db;
    this.mode = mode;
    this.storeNames = [].concat(storeNames);
    this.error = null;
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    this.pending = 0;
    this.finished = false;
    this.commitScheduled = false;

    /*
     * IndexedDB serialises readwrite transactions whose scopes overlap: the
     * second cannot see a half-finished first. Without modelling that, two
     * concurrent "log this set" calls both read an empty store and both write,
     * and a test for idempotency would be testing this file's shortcut rather
     * than the application's correctness.
     */
    this.ready = Promise.resolve();
    if (mode === 'readwrite' && db?.data) {
      const previous = db.data.writeChain || Promise.resolve();
      let release;
      const mine = new Promise((resolve) => {
        release = resolve;
      });
      this.ready = previous;
      this.release = release;
      db.data.writeChain = previous.then(() => mine);
    }
  }

  /** Let the next queued readwrite transaction start. */
  releaseLock() {
    if (this.release) {
      this.release();
      this.release = null;
    }
  }

  objectStore(name) {
    if (!this.storeNames.includes(name)) {
      throw new Error(`${name} is not in this transaction's scope`);
    }
    const data = this.db.data.stores.get(name);
    if (!data) throw new Error(`no object store "${name}"`);
    return new FakeObjectStore(data, this);
  }

  /** Requests resolve in a microtask; the commit check waits for a macrotask. */
  enqueue(work) {
    if (this.finished) throw new Error('transaction has already finished');
    const req = new FakeRequest(this);
    this.pending += 1;

    this.ready.then(() => {
      if (this.finished) return;
      try {
        const result = work();
        this.pending -= 1;
        req.succeed(result);
      } catch (error) {
        this.pending -= 1;
        this.error = error;
        req.fail(error);
        this.abort();
      }
      this.scheduleCommit();
    });

    return req;
  }

  scheduleCommit() {
    if (this.commitScheduled || this.finished) return;
    this.commitScheduled = true;
    setTimeout(() => {
      this.commitScheduled = false;
      if (this.finished) return;
      if (this.pending > 0) return this.scheduleCommit();
      this.finished = true;
      this.releaseLock();
      if (this.oncomplete) this.oncomplete({ target: this });
    }, 0);
  }

  abort() {
    if (this.finished) return;
    this.finished = true;
    this.releaseLock();
    if (this.onabort) this.onabort({ target: this });
  }
}

class FakeDatabase {
  constructor(data) {
    this.data = data;
    this.name = data.name;
    this.version = data.version;
    this.closed = false;
    this.onversionchange = null;
    this.objectStoreNames = {
      contains: (name) => this.data.stores.has(name),
      get length() {
        return data.stores.size;
      },
      [Symbol.iterator]: () => data.stores.keys(),
    };
  }

  createObjectStore(name, options) {
    const store = new StoreData(name, options);
    this.data.stores.set(name, store);
    return new FakeObjectStore(store, this.upgradeTransaction);
  }

  deleteObjectStore(name) {
    this.data.stores.delete(name);
  }

  transaction(storeNames, mode = 'readonly') {
    if (this.closed) throw new Error('the database is closed');
    const tx = new FakeTransaction(this, storeNames, mode);
    // Nothing may have been requested — commit anyway, like the real thing.
    tx.scheduleCommit();
    return tx;
  }

  close() {
    this.closed = true;
  }
}

export class FakeIndexedDB {
  constructor() {
    this.databases = new Map();
  }

  open(name, version = 1) {
    const req = new FakeRequest(null);

    if (!this.databases.has(name)) this.databases.set(name, new DatabaseData(name));
    const data = this.databases.get(name);
    const oldVersion = data.version;

    setTimeout(() => {
      if (version < oldVersion) {
        return req.fail(new Error(`cannot open ${name} at version ${version}`));
      }

      const db = new FakeDatabase(data);

      if (version > oldVersion) {
        const tx = new FakeTransaction(db, [...data.stores.keys()], 'versionchange');
        db.upgradeTransaction = tx;
        req.transaction = tx;
        data.version = version;
        db.version = version;

        // A versionchange transaction may create stores as it goes, so its
        // scope is whatever exists at the moment objectStore() is called.
        tx.objectStore = (storeName) => {
          const storeData = data.stores.get(storeName);
          if (!storeData) throw new Error(`no object store "${storeName}"`);
          return new FakeObjectStore(storeData, tx);
        };

        tx.oncomplete = () => {
          req.transaction = null;
          db.upgradeTransaction = null;
          req.succeed(db);
        };

        // The database is available on the request during the upgrade, as in
        // the real thing — that is how upgrade handlers reach createObjectStore.
        req.result = db;
        if (req.onupgradeneeded) req.onupgradeneeded({ target: req, oldVersion, newVersion: version });
        tx.scheduleCommit();
        return;
      }

      db.version = data.version;
      req.succeed(db);
    }, 0);

    return req;
  }

  deleteDatabase(name) {
    const req = new FakeRequest(null);
    setTimeout(() => {
      this.databases.delete(name);
      req.succeed(undefined);
    }, 0);
    return req;
  }
}

/** A fresh, empty IndexedDB plus the matching key-range constructor. */
export function createFakeEnv() {
  return { indexedDB: new FakeIndexedDB(), IDBKeyRange: FakeIDBKeyRange };
}
