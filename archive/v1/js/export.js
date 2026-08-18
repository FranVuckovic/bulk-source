/**
 * export.js — the zip, written by hand.
 *
 * One zip holds CSVs for reading, JSON for restoring losslessly, and the photos
 * as files. A store-only zip is about sixty lines of header writing, which is a
 * far better trade than a dependency this app would have to carry for years.
 *
 * Data outlives the app. That is the whole reason this file exists: CSV so you,
 * Excel and any future tool can read it; JSON so a restore is exact; a format
 * version so a later version knows what it is looking at.
 */

import { ALL_STORES, FORMAT_VERSION } from './db.js';

/* ═══════════════════════════════════════════════════════════════════════
   A store-only zip
   ═══════════════════════════════════════════════════════════════════════ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time, which is what a zip header wants. */
function dosStamp(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

const utf8 = (text) => new TextEncoder().encode(text);

/**
 * Build a zip from [{ name, data }] where data is a Uint8Array. Stored, not
 * deflated — the CSVs are small and a compressor is another thing to get wrong.
 */
export function makeZip(files, { date = new Date() } = {}) {
  const { time, day } = dosStamp(date);
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = utf8(file.name);
    const crc = crc32(file.data);
    const size = file.data.length;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // local file header
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);

    chunks.push(new Uint8Array(local.buffer), nameBytes, file.data);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true); // central directory header
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, time, true);
    entry.setUint16(14, day, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, size, true);
    entry.setUint32(24, size, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), nameBytes);

    offset += 30 + nameBytes.length + size;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // end of central directory
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const total = all.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of all) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

/** Read a stored zip back into { name → Uint8Array }. */
export function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = {};
  let cursor = 0;

  while (cursor + 4 <= bytes.length && view.getUint32(cursor, true) === 0x04034b50) {
    const method = view.getUint16(cursor + 8, true);
    const size = view.getUint32(cursor + 18, true);
    const nameLength = view.getUint16(cursor + 26, true);
    const extraLength = view.getUint16(cursor + 28, true);
    const nameStart = cursor + 30;
    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLength));
    const dataStart = nameStart + nameLength + extraLength;

    if (method !== 0) throw new Error(`${name} is compressed; this reader only handles stored entries`);
    files[name] = bytes.slice(dataStart, dataStart + size);
    cursor = dataStart + size;
  }
  return files;
}

/* ═══════════════════════════════════════════════════════════════════════
   CSV
   ═══════════════════════════════════════════════════════════════════════ */

/*
 * A blank cell is blank. It is never 0 and never the string "null" — the whole
 * point of storing blanks as blanks is that they survive the round trip out to
 * a spreadsheet and back.
 */
const cell = (value) => {
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function toCsv(rows, columns) {
  const header = columns.join(',');
  const body = rows.map((row) => columns.map((column) => cell(row[column])).join(','));
  return [header, ...body].join('\n') + '\n';
}

export const CSV_COLUMNS = Object.freeze({
  sessionLogs: ['id', 'dateISO', 'startedAt', 'endedAt', 'sessionId', 'blockId', 'rotationIndex', 'bodyweight', 'sessionRpe', 'note', 'isPartial'],
  sets: ['id', 'sessionLogId', 'exerciseId', 'slotIndex', 'setIndex', 'load', 'bodyweightUsed', 'reps', 'rpe', 'rir', 'toFailure', 'isAmrap', 'isIndexSet', 'isMyoRep', 'velocity', 'note', 'wasPrescribed', 'prescribedLoad', 'timestampISO', 'gripWidth', 'variantUsed', 'pauseStyle'],
  daily: ['dateISO', 'bodyweight', 'bodyfatPct', 'sleepHours', 'steps', 'mood', 'caffeine', 'note'],
  measurements: ['dateISO', 'waist', 'chest', 'shoulders', 'armL', 'armR', 'quadL', 'quadR', 'neck', 'note'],
  niggles: ['id', 'dateISO', 'site', 'severity', 'context', 'note'],
  media: ['id', 'dateISO', 'kind', 'exerciseId', 'load', 'reps', 'note', 'fileRef'],
  maxes: ['exerciseId', 'workingMax', 'conf', 'setAtISO', 'sourceSetId', 'blockId'],
  maxHistory: ['id', 'exerciseId', 'workingMax', 'conf', 'setAtISO', 'blockId', 'reason'],
});

/* ═══════════════════════════════════════════════════════════════════════
   Building and restoring
   ═══════════════════════════════════════════════════════════════════════ */

const inRange = (dateISO, from, to) => {
  const day = (dateISO || '').slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
};

/**
 * Everything selected, as a zip.
 *
 * `data` is the snapshot from db.snapshot(). Filtering happens here rather than
 * in the query so that a session and its sets can never be separated by a date
 * boundary — the sets go wherever their session goes.
 */
export function buildExport(snapshot, plan, { from = null, to = null, include = {} } = {}) {
  const want = {
    sets: true, daily: true, measurements: true, niggles: true,
    media: true, maxes: true, plan: true, ...include,
  };
  const data = snapshot.data;

  const logs = (data.sessionLogs || []).filter((log) => inRange(log.dateISO, from, to));
  const logIds = new Set(logs.map((log) => log.id));
  const sets = (data.sets || []).filter((set) => logIds.has(set.sessionLogId));

  const selected = {
    sessionLogs: want.sets ? logs : [],
    sets: want.sets ? sets : [],
    daily: want.daily ? (data.daily || []).filter((row) => inRange(row.dateISO, from, to)) : [],
    measurements: want.measurements ? (data.measurements || []).filter((row) => inRange(row.dateISO, from, to)) : [],
    niggles: want.niggles ? (data.niggles || []).filter((row) => inRange(row.dateISO, from, to)) : [],
    media: want.media ? (data.media || []).filter((row) => inRange(row.dateISO, from, to)) : [],
    maxes: want.maxes ? data.maxes || [] : [],
    maxHistory: want.maxes ? data.maxHistory || [] : [],
    settings: data.settings || [],
  };

  const meta = {
    format: FORMAT_VERSION,
    exportedAtISO: new Date().toISOString(),
    app: 'Bulk',
    range: { from, to },
    included: want,
    counts: Object.fromEntries(Object.entries(selected).map(([name, rows]) => [name, rows.length])),
  };

  const files = [
    { name: 'meta.json', data: utf8(JSON.stringify(meta, null, 2)) },
    // The lossless copy. The CSVs are for reading; this is what a restore uses.
    { name: 'data.json', data: utf8(JSON.stringify({ ...meta, data: selected }, null, 2)) },
  ];

  if (want.plan && plan) files.push({ name: 'plan.json', data: utf8(JSON.stringify(plan, null, 2)) });

  for (const [store, columns] of Object.entries(CSV_COLUMNS)) {
    if (!selected[store]?.length) continue;
    files.push({ name: `${store}.csv`, data: utf8(toCsv(selected[store], columns)) });
  }

  for (const item of selected.media) {
    if (item.imageBlob instanceof Uint8Array) {
      files.push({ name: `photos/${item.dateISO}-${item.id}.jpg`, data: item.imageBlob });
    }
  }

  return { zip: makeZip(files), meta, files: files.map((f) => f.name) };
}

/** Pull the lossless payload back out of a zip. */
export function parseImport(bytes) {
  const files = readZip(bytes);
  const payload = files['data.json'];
  if (!payload) throw new Error('This zip has no data.json — it was not exported by Bulk.');

  const parsed = JSON.parse(new TextDecoder().decode(payload));
  if (!parsed.data) throw new Error('data.json has no data in it.');
  if (parsed.format > FORMAT_VERSION) {
    throw new Error(`This export came from a newer version of the app (format ${parsed.format}).`);
  }
  return parsed;
}

/**
 * Restore into a database. Replaces the contents of every store the export
 * carries and leaves the rest alone, so a partial export cannot silently wipe
 * what it did not include.
 */
export async function restore(db, parsed, { put, clearStore }) {
  const restored = {};
  for (const store of ALL_STORES) {
    const rows = parsed.data[store];
    if (!rows) continue;
    await clearStore(db, store);
    for (const row of rows) await put(db, store, row);
    restored[store] = rows.length;
  }
  return restored;
}
