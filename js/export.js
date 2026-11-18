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

/**
 * Read a stored zip back into { name → Uint8Array }, verifying each entry.
 *
 * The CRC in the local header is checked against the bytes actually read. A
 * truncated or altered archive fails here rather than restoring silently
 * corrupted training history.
 */
export function readZip(bytes, { verify = true } = {}) {
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
    if (dataStart + size > bytes.length) throw new Error(`${name} runs past the end of the archive`);

    const content = bytes.slice(dataStart, dataStart + size);
    if (verify) {
      const declared = view.getUint32(cursor + 14, true);
      const actual = crc32(content);
      if (declared !== actual) throw new Error(`${name} is corrupted — its checksum does not match`);
    }
    files[name] = content;
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
  // An object goes out as JSON, and JSON is full of commas and quotes. It used
  // to be written unquoted, so `{"a":1,"b":2}` split into two columns and every
  // cell after it on that row moved one to the right.
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function toCsv(rows, columns) {
  const header = columns.join(',');
  const body = rows.map((row) => columns.map((column) => cell(row[column])).join(','));
  return [header, ...body].join('\n') + '\n';
}

export const CSV_COLUMNS = Object.freeze({
  /*
   * `deletedAtISO` is on every store that has a bin. The CSVs carry binned and
   * swap-displaced rows as well as live ones — they are a copy of what is
   * stored — and without the column a spreadsheet counted every binned set as
   * work done. Filter on an empty `deletedAtISO` to get what the app shows.
   * New columns go on the end, so a sheet built on the old layout still lines up.
   */
  sessionLogs: ['id', 'dateISO', 'startedAt', 'endedAt', 'planId', 'sessionId', 'blockId', 'rotationIndex', 'bodyweight', 'sessionRpe', 'note', 'isPartial', 'timingReliable', 'status', 'cycleSequence', 'rotationPosition', 'deletedAtISO'],
  sets: ['id', 'sessionLogId', 'exerciseId', 'slotIndex', 'setIndex', 'load', 'bodyweightUsed', 'reps', 'rpe', 'rir', 'toFailure', 'isAmrap', 'formBreakdown', 'attemptResult', 'isIndexSet', 'isMyoRep', 'velocity', 'note', 'wasPrescribed', 'prescribedLoad', 'timestampISO', 'gripWidth', 'variantUsed', 'pauseStyle', 'deletedAtISO'],
  daily: ['dateISO', 'savedAtISO', 'bodyweight', 'scale', 'scaleNote', 'bodyfatPct', 'sleepHours', 'steps', 'mood', 'caffeine', 'note', 'deletedAtISO'],
  /*
   * Every measurement site, in the order the Body screen shows them, plus the
   * columns around them. Sites are only ever added; a row written before a site
   * existed simply has no value for it and the cell comes out empty, which is
   * what a CSV of an optional reading should look like.
   *
   * `test/measurements.test.js` asserts this list covers every site the app
   * offers, so adding one to the screen and forgetting it here is a failing
   * test rather than a column that silently vanishes from your backups.
   */
  measurements: [
    'dateISO',
    'savedAtISO',
    'timeOfDay',
    'timeOfDayNote',
    'waist',
    'chest',
    'shoulders',
    'armL',
    'armR',
    'armLFlex',
    'armRFlex',
    'forearmL',
    'forearmR',
    'quadL',
    'quadR',
    'neck',
    'note',
    'deletedAtISO',
  ],
  niggles: ['id', 'dateISO', 'site', 'severity', 'context', 'note', 'deletedAtISO'],
  media: ['id', 'dateISO', 'kind', 'exerciseId', 'load', 'reps', 'note', 'fileRef', 'deletedAtISO'],
  maxes: ['exerciseId', 'workingMax', 'conf', 'setAtISO', 'sourceSetId', 'blockId'],
  maxHistory: ['id', 'exerciseId', 'workingMax', 'conf', 'setAtISO', 'blockId', 'reason'],
});

/* ═══════════════════════════════════════════════════════════════════════
   Building and restoring
   ═══════════════════════════════════════════════════════════════════════ */

/** The stores a date range filters; everything else always travels whole. */
const DATED_STORES = Object.freeze(['sessionLogs', 'sets', 'daily', 'measurements', 'niggles', 'media']);

/** Export checkbox → the stores it covers. */
const CATEGORY_STORES = Object.freeze({
  sets: ['sessionLogs', 'sets'],
  daily: ['daily'],
  measurements: ['measurements'],
  niggles: ['niggles'],
  media: ['media'],
  maxes: ['maxes', 'maxHistory'],
});

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
  const dated = (store) => (data[store] || []).filter((row) => inRange(row.dateISO, from, to));

  /*
   * A category that is not ticked is left OUT of the archive, not written as an
   * empty list. An empty list is a statement — "there are no sessions" — and a
   * restore believes it: unticking "Sets & sessions" produced a zip that, when
   * imported, deleted every session and set in the database.
   */
  const selected = {
    ...(want.sets ? { sessionLogs: logs, sets } : {}),
    ...(want.daily ? { daily: dated('daily') } : {}),
    ...(want.measurements ? { measurements: dated('measurements') } : {}),
    ...(want.niggles ? { niggles: dated('niggles') } : {}),
    ...(want.media ? { media: dated('media') } : {}),
    ...(want.maxes ? { maxes: data.maxes || [], maxHistory: data.maxHistory || [] } : {}),
    settings: data.settings || [],

    /*
     * Always, and never filtered by date.
     *
     * `cycles` is where you are in the 33 rotations. Without it a backup
     * restored onto a new phone has every session you have ever logged and no
     * idea which rotation you are on, so the plan starts again at 1.
     *
     * `auditLog` is the record of what was deleted and what a save replaced —
     * including the tape readings a wrongly dated write overwrote. Leaving it
     * out meant the one copy of a destroyed value lived only in the database it
     * was destroyed in.
     *
     * Both are small, and neither means anything sliced to a date range.
     */
    cycles: data.cycles || [],
    auditLog: data.auditLog || [],
  };

  /*
   * Which stores the archive holds only PART of, because the date range left
   * rows out. A restore merges these instead of replacing them, so a backup of
   * August cannot delete July. Worked out from what was actually dropped, not
   * from whether a range was typed: a range that happens to cover everything is
   * a complete backup and restores like one.
   */
  const partial = Object.keys(selected).filter(
    (store) => DATED_STORES.includes(store) && selected[store].length < (data[store] || []).length
  );

  const meta = {
    format: FORMAT_VERSION,
    exportedAtISO: new Date().toISOString(),
    app: 'Bulk',
    range: { from, to },
    included: want,
    partial,
    counts: Object.fromEntries(Object.entries(selected).map(([name, rows]) => [name, rows.length])),
  };

  /*
   * Photos are stored as bytes, never as a Blob: a Blob serialises to `{}` in
   * JSON, so v1's export dropped every image silently while reporting success.
   * The bytes become real files in the archive and data.json keeps only the
   * filename, which also keeps the JSON readable.
   */
  const photoFiles = [];
  const mediaForJson = (selected.media || []).map((item) => {
    const bytes = item.imageBytes instanceof Uint8Array ? item.imageBytes : null;
    const thumb = item.thumbBytes instanceof Uint8Array ? item.thumbBytes : null;
    const { imageBytes, imageBlob, thumbBytes, ...rest } = item;

    // The thumbnail is a separate file for the same reason as the full image:
    // a Uint8Array in JSON becomes {"0":255,"1":216,…}, which is roughly six
    // times the size and is not a JPEG when it comes back.
    const extension = (item.imageType || 'image/jpeg').includes('png') ? 'png' : 'jpg';
    let thumbFile = item.thumbFile ?? null;
    if (thumb) {
      thumbFile = `photos/${item.dateISO}-${item.id}-thumb.jpg`;
      photoFiles.push({ name: thumbFile, data: thumb });
    }

    if (!bytes) return { ...rest, photoFile: item.photoFile ?? null, thumbFile };

    const name = `photos/${item.dateISO}-${item.id}.${extension}`;
    photoFiles.push({ name, data: bytes });
    return { ...rest, photoFile: name, thumbFile };
  });

  const payload = { ...meta, data: { ...selected, ...(selected.media ? { media: mediaForJson } : {}) } };

  const files = [
    { name: 'meta.json', data: utf8(JSON.stringify(meta, null, 2)) },
    // The lossless copy. The CSVs are for reading; this is what a restore uses.
    { name: 'data.json', data: utf8(JSON.stringify(payload, null, 2)) },
    ...photoFiles,
  ];

  if (want.plan && plan) files.push({ name: 'plan.json', data: utf8(JSON.stringify(plan, null, 2)) });

  for (const [store, columns] of Object.entries(CSV_COLUMNS)) {
    if (!selected[store]?.length) continue;
    files.push({ name: `${store}.csv`, data: utf8(toCsv(selected[store], columns)) });
  }

  return { zip: makeZip(files), meta, files: files.map((f) => f.name), photos: photoFiles.length };
}

/*
 * A Uint8Array written with JSON.stringify comes out as {"0":255,"1":216,…}.
 * That is what the plain JSON backup holds for every photo, so reading one back
 * turns that shape into bytes again rather than storing an object where the
 * app expects an image.
 */
const BYTE_FIELDS = ['imageBytes', 'thumbBytes'];
function reviveBytes(value) {
  if (!value || typeof value !== 'object' || value instanceof Uint8Array || Array.isArray(value)) return value;
  const keys = Object.keys(value);
  if (!keys.length || !keys.every((key, index) => key === String(index))) return value;
  return Uint8Array.from(keys.map((key) => value[key]));
}

/**
 * The plain JSON backup — `db.snapshot()` written as a file.
 *
 * It is what the app downloads before an import, before an erase, and from
 * every "Export a backup first" button. Until it could be read here, the one
 * file taken to protect against a bad restore was a file the restore refused.
 */
function parseJsonSnapshot(bytes) {
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('That file is not a Bulk backup — it is neither a zip nor readable JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.data) {
    throw new Error('That JSON file has no data in it — it was not exported by Bulk.');
  }
  for (const rows of Object.values(parsed.data)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      for (const field of BYTE_FIELDS) if (field in row) row[field] = reviveBytes(row[field]);
    }
  }
  return parsed;
}

/** Pull the lossless payload back out of a zip, or out of a plain JSON backup. */
export function parseImport(bytes) {
  // A zip starts with "PK"; the JSON backup starts with "{" (after any
  // whitespace or a byte-order mark).
  const first = [...bytes.subarray(0, 8)].find((byte) => ![0x20, 0x09, 0x0a, 0x0d, 0xef, 0xbb, 0xbf].includes(byte));
  if (first === 0x7b) {
    const parsed = parseJsonSnapshot(bytes);
    if (parsed.format > FORMAT_VERSION) {
      throw new Error(`This backup came from a newer version of the app (format ${parsed.format}).`);
    }
    return parsed;
  }

  const files = readZip(bytes);
  const payload = files['data.json'];
  if (!payload) throw new Error('This zip has no data.json — it was not exported by Bulk.');

  const parsed = JSON.parse(new TextDecoder().decode(payload));
  if (!parsed.data) throw new Error('data.json has no data in it.');
  if (parsed.format > FORMAT_VERSION) {
    throw new Error(`This export came from a newer version of the app (format ${parsed.format}).`);
  }

  // Put the photo bytes back on their records, so a restore is byte-for-byte.
  // Only when the archive carries photos at all: an absent store stays absent.
  if (!Array.isArray(parsed.data.media)) return parsed;
  parsed.data.media = parsed.data.media.map((item) => {
    const restored = { ...item };
    if (item.photoFile) {
      const bytes = files[item.photoFile];
      if (!bytes) throw new Error(`${item.photoFile} is referenced by the data but missing from the archive.`);
      restored.imageBytes = bytes;
    }
    if (item.thumbFile) {
      const bytes = files[item.thumbFile];
      if (!bytes) throw new Error(`${item.thumbFile} is referenced by the data but missing from the archive.`);
      restored.thumbBytes = bytes;
    }
    return restored;
  });

  return parsed;
}

/**
 * Restore into a database. Replaces every store the export holds completely,
 * merges the ones it holds part of, and leaves the rest alone, so a partial
 * export cannot silently wipe what it did not include. See importModes.
 */
export async function restore(db, parsed, { put, clearStore }) {
  const restored = {};
  const modes = importModes(parsed);
  for (const store of ALL_STORES) {
    const rows = parsed.data[store];
    if (!rows || !modes[store]) continue;
    if (modes[store] === 'replace') await clearStore(db, store);
    for (const row of rows) await put(db, store, row);
    restored[store] = rows.length;
  }
  return restored;
}

/**
 * What a restore does to each store the archive carries: `replace` (empty it
 * and refill from the archive) or `merge` (write the archive's rows over the
 * same keys and leave every other row alone). A store missing from the result
 * is not touched at all.
 *
 * Only a store the archive holds COMPLETELY may replace. Two shapes of archive
 * hold less than that, and both used to be restored by clearing:
 *
 *   A date range. The sheet defaulted "From" to the first session, so the
 *   weigh-ins and tape readings from before it were not in the zip — and a
 *   restore emptied `daily` and kept only what was in range. Ranged stores now
 *   merge. Archives written before `partial` existed say only what range they
 *   were cut to, so any range on those makes every dated store merge.
 *
 *   An unticked category. Older archives wrote it as an empty list beside
 *   `included: { sets: false }`; that list is ignored rather than believed.
 */
export function importModes(parsed) {
  const data = parsed?.data || {};
  const included = parsed?.included || {};
  const skipped = new Set(
    Object.entries(CATEGORY_STORES).flatMap(([category, stores]) => (included[category] === false ? stores : []))
  );

  let partial;
  if (Array.isArray(parsed?.partial)) partial = new Set(parsed.partial);
  else if (parsed?.range?.from || parsed?.range?.to) partial = new Set(DATED_STORES);
  else partial = new Set();

  const modes = {};
  for (const store of ALL_STORES) {
    if (!Array.isArray(data[store]) || skipped.has(store)) continue;
    modes[store] = partial.has(store) ? 'merge' : 'replace';
  }
  return modes;
}

/* ═══════════════════════════════════════════════════════════════════════
   Staged restore
   ═══════════════════════════════════════════════════════════════════════ */

/*
 * v1 restored the moment a file was chosen: each store was cleared and
 * repopulated one at a time, with no validation, no preview and no way back.
 * Importing into a populated database silently replaced settings and any store
 * the archive happened to contain, and a failure part-way through left some
 * stores emptied and others untouched.
 *
 * Restoring is now four separate steps — parse, validate, preview, apply — and
 * the apply step is one transaction across every store.
 */

/** Rows the app knows how to store, with the shape each one must have. */
const REQUIRED_FIELDS = {
  sessionLogs: ['dateISO'],
  sets: ['sessionLogId'],
  daily: ['dateISO'],
  measurements: ['dateISO'],
  niggles: ['dateISO'],
  media: ['dateISO'],
  maxes: ['exerciseId'],
  settings: ['key'],
  maxHistory: ['exerciseId'],
  cycles: ['sequence'],
  auditLog: [],
};

const isFiniteOrNull = (value) => value == null || (typeof value === 'number' && Number.isFinite(value));

/**
 * Check an archive before anything is written.
 *
 * Returns what would change and everything wrong with it. Nothing here touches
 * the database.
 */
export function validateImport(parsed, { current = {} } = {}) {
  const problems = [];
  const warnings = [];

  if (!parsed || typeof parsed !== 'object') return { ok: false, problems: ['That file is not a Bulk export.'] };
  if (parsed.format > FORMAT_VERSION) {
    problems.push(`Exported by a newer version of the app (format ${parsed.format} against ${FORMAT_VERSION}).`);
  }

  const data = parsed.data || {};
  for (const store of Object.keys(data)) {
    if (!ALL_STORES.includes(store)) {
      warnings.push(`"${store}" is not a store this version knows about; it will be ignored.`);
      continue;
    }
    const rows = data[store];
    if (!Array.isArray(rows)) {
      problems.push(`${store} is not a list of records.`);
      continue;
    }
    for (const [index, row] of rows.entries()) {
      if (!row || typeof row !== 'object') {
        problems.push(`${store}[${index}] is not a record.`);
        continue;
      }
      for (const field of REQUIRED_FIELDS[store] || []) {
        if (row[field] == null) problems.push(`${store}[${index}] has no ${field}.`);
      }
    }
  }

  // Ranges, so a corrupt or hand-edited file cannot poison the maths.
  for (const [index, set] of (data.sets || []).entries()) {
    if (!isFiniteOrNull(set.load) || (set.load != null && set.load < 0)) problems.push(`sets[${index}] has an impossible load.`);
    if (!isFiniteOrNull(set.reps) || (set.reps != null && (set.reps < 0 || set.reps > 200))) {
      problems.push(`sets[${index}] has an impossible rep count.`);
    }
    if (set.rpe != null && (set.rpe < 1 || set.rpe > 10)) problems.push(`sets[${index}] has an RPE outside 1–10.`);
  }
  for (const [index, day] of (data.daily || []).entries()) {
    if (day.bodyweight != null && (day.bodyweight <= 0 || day.bodyweight > 400)) {
      problems.push(`daily[${index}] has an impossible bodyweight.`);
    }
    if (day.sleepHours != null && (day.sleepHours < 0 || day.sleepHours > 24)) {
      problems.push(`daily[${index}] has impossible sleep hours.`);
    }
  }

  // Referential integrity: a set must belong to a session in the same archive.
  const logIds = new Set((data.sessionLogs || []).map((log) => log.id));
  const orphans = (data.sets || []).filter((set) => !logIds.has(set.sessionLogId));
  if (orphans.length) problems.push(`${orphans.length} sets refer to a session the archive does not contain.`);

  // Duplicate logical sets would breach the unique index on apply.
  const keys = new Set();
  for (const set of data.sets || []) {
    const key = set.logicalKey ?? `${set.sessionLogId}:${set.slotIndex}:${set.setIndex}`;
    if (keys.has(key)) problems.push(`The archive contains two copies of set ${key}.`);
    keys.add(key);
  }

  const modes = importModes(parsed);
  const preview = ALL_STORES.map((store) => ({
    store,
    incoming: modes[store] ? data[store].length : null,
    existing: current[store] ?? 0,
    mode: modes[store] ?? null,
  })).filter((row) => row.incoming != null || row.existing);

  return {
    ok: problems.length === 0,
    problems,
    warnings,
    preview,
    modes,
    takenAtISO: parsed.takenAtISO ?? parsed.exportedAtISO ?? null,
    format: parsed.format,
    range: parsed.range ?? null,
    replaces: preview.filter((row) => row.mode === 'replace' && row.existing).map((row) => row.store),
    merges: preview.filter((row) => row.mode === 'merge').map((row) => row.store),
  };
}

/**
 * Apply a validated archive in one transaction across every affected store.
 *
 * Either the whole restore lands or the database is untouched. Photos come back
 * as real bytes; settings are restored too, because a backup that silently
 * dropped your unit and increment is not a backup.
 */
export function applyImport(db, parsed, { withTransaction, request, stores = ALL_STORES }) {
  const data = parsed.data || {};
  const modes = importModes(parsed);
  const affected = stores.filter((store) => modes[store]);
  if (!affected.length) return Promise.resolve({});

  return withTransaction(db, affected, 'readwrite', async (handles) => {
    const list = [].concat(handles);
    const restored = {};

    for (const [index, store] of affected.entries()) {
      const handle = list[index];
      // A store the archive holds only part of is merged: its rows land over
      // the same keys and nothing outside them is touched. See importModes.
      if (modes[store] === 'replace') await request(handle.clear());
      for (const row of data[store]) await request(handle.put(row));
      restored[store] = data[store].length;
    }
    return restored;
  });
}

/**
 * Compare an archive against what is stored, by content rather than by count.
 *
 * v1 compared row counts only, so a backup with the same number of sets but
 * altered loads, reps or dates passed verification. This hashes the canonical
 * form of every record.
 */
export function verifyAgainst(parsed, snapshot) {
  const problems = [];

  /*
   * Image bytes are compared by length and checksum, not by their JSON — a
   * Uint8Array stringifies to {"0":255,"1":216,…}, which would make the
   * comparison both enormous and, once the archive's own bookkeeping keys are
   * added, always unequal. The bookkeeping keys are dropped for the same
   * reason: photoFile exists only inside the zip.
   */
  const IGNORED = new Set(['imageBlob', 'photoFile', 'thumbFile']);
  const digest = (bytes) => (bytes?.length ? `bytes:${bytes.length}:${crc32(bytes)}` : null);

  const canonical = (row) => {
    const flat = {};
    for (const [key, value] of Object.entries(row)) {
      if (IGNORED.has(key)) continue;
      flat[key] =
        value instanceof Uint8Array ? digest(value) : ArrayBuffer.isView(value) ? digest(new Uint8Array(value.buffer)) : value;
    }
    // Both byte fields are always present, whether or not the record has them.
    // A stored `imageBytes: null` against a backup that simply omits the key is
    // the same record, and reporting it as a difference would train you to
    // ignore the one time the verification is right.
    for (const key of ['imageBytes', 'thumbBytes']) {
      if (flat[key] == null) flat[key] = null;
    }
    return JSON.stringify(flat, Object.keys(flat).sort());
  };

  const modes = importModes(parsed);
  for (const store of ALL_STORES) {
    const backup = parsed.data?.[store];
    const live = snapshot.data?.[store];
    if (!backup || !modes[store]) continue;
    if (!live) {
      problems.push(`${store} is in the backup but not in the database.`);
      continue;
    }

    // A ranged backup holds part of a store by design. Every row it has must
    // be here; the rows outside its range are not its business.
    if (modes[store] === 'merge') {
      const liveRows = new Set(live.map(canonical));
      const missing = backup.filter((row) => !liveRows.has(canonical(row)));
      if (missing.length) problems.push(`${store}: ${missing.length} records in the backup are not stored as they are there.`);
      continue;
    }

    if (backup.length !== live.length) {
      problems.push(`${store}: ${backup.length} records in the backup against ${live.length} stored.`);
      continue;
    }

    const backupRows = new Set(backup.map(canonical));
    const different = live.filter((row) => !backupRows.has(canonical(row)));
    if (different.length) problems.push(`${store}: ${different.length} records differ in their contents.`);
  }

  return { ok: problems.length === 0, problems };
}
