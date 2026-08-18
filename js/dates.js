/**
 * dates.js — local civil dates and UTC instants, kept apart on purpose.
 *
 * Two different questions need two different answers:
 *
 *   "Which day does this belong to?"  → a local civil date, YYYY-MM-DD, built
 *   from the device's own calendar fields. Training on Tuesday at 00:30 in
 *   Zagreb belongs to Tuesday, not to Monday.
 *
 *   "When exactly did this happen?"   → a UTC instant, for ordering and for
 *   surviving a move between time zones.
 *
 * v1 used `new Date().toISOString().slice(0, 10)` for the first question, which
 * is a UTC date. Between local midnight and 01:59 (summer) or 00:59 (winter)
 * every session, weigh-in, measurement and export filename was stamped with the
 * previous day. Nothing in here may use toISOString for a civil date.
 */

const pad = (n) => String(n).padStart(2, '0');

/** The device's civil date, as YYYY-MM-DD. Accepts an injected clock for tests. */
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The civil date an instant falls on, in the device's zone. */
export function localDateOf(iso, date = iso ? new Date(iso) : new Date()) {
  return Number.isNaN(date.getTime()) ? null : localDate(date);
}

/** The instant, for ordering. Always UTC, always with milliseconds. */
export const nowISO = (date = new Date()) => date.toISOString();

/** The device's IANA zone, stored alongside instants so history stays readable. */
export function timeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** Minutes east of UTC at that instant — the offset actually in force. */
export const utcOffsetMinutes = (date = new Date()) => -date.getTimezoneOffset();

/* ── arithmetic on civil dates ───────────────────────────────────────── */

/*
 * Civil-date maths is done at UTC noon. Midnight arithmetic lands exactly on
 * the discontinuity when a zone shifts its clocks, and a date can come back a
 * day early; noon has twelve hours of slack in either direction.
 */
const NOON = 'T12:00:00Z';
const asUtcNoon = (isoDate) => Date.parse(`${String(isoDate).slice(0, 10)}${NOON}`);

export function daysBetween(fromISO, toISO) {
  const from = asUtcNoon(fromISO);
  const to = asUtcNoon(toISO);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / 86400000);
}

export function addDays(isoDate, days) {
  const base = asUtcNoon(isoDate);
  if (Number.isNaN(base)) return null;
  return new Date(base + days * 86400000).toISOString().slice(0, 10);
}

/** Monday of the civil week a date falls in. Calendar grouping only. */
export function weekStart(isoDate) {
  const base = asUtcNoon(isoDate);
  if (Number.isNaN(base)) return null;
  const date = new Date(base);
  const day = (date.getUTCDay() + 6) % 7;
  return new Date(base - day * 86400000).toISOString().slice(0, 10);
}

/** "16 Aug 2026", for headings. */
export function formatLong(isoDate) {
  const parts = String(isoDate || '').slice(0, 10).split('-');
  if (parts.length !== 3) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(parts[2])} ${months[Number(parts[1]) - 1]} ${parts[0]}`;
}

/** Minutes between two instants, or null when either is missing. */
export function minutesBetween(fromISO, toISO) {
  if (!fromISO || !toISO) return null;
  const minutes = (Date.parse(toISO) - Date.parse(fromISO)) / 60000;
  return Number.isFinite(minutes) ? minutes : null;
}
