/**
 * ui/components.js — the pieces every screen shares.
 *
 * Units, formatting, the bottom sheet, the rest timer and the collapsible
 * section heading. No screen logic lives here.
 */

/* ═══════════════════════════════════════════════════════════════════════
   Units — display only
   ═══════════════════════════════════════════════════════════════════════ */

/*
 * Everything is stored in kilograms, always. Pounds is a rendering transform
 * applied on the way out and reversed on the way in, so switching units can
 * never round-trip a stored number into something slightly different.
 */
export const KG_PER_LB = 2.2046226218;

export const toDisplay = (kg, unit) => (unit === 'lb' ? kg * KG_PER_LB : kg);
export const fromDisplay = (value, unit) => (unit === 'lb' ? value / KG_PER_LB : value);

/** A load, formatted for display. Null renders as an em dash, never as 0. */
export const fmtLoad = (kg, unit) =>
  kg == null ? '—' : (Math.round(toDisplay(kg, unit) * 10) / 10).toFixed(1);

export const fmtNum = (value, digits = 1) =>
  value == null || Number.isNaN(value) ? '—' : Number(value).toFixed(digits);

/** The step the +/− buttons move by: plate size in kg, 5 lb in pounds. */
export const stepFor = (unit, increment) => (unit === 'lb' ? 5 : increment);

export const escape = (text) =>
  String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/* ═══════════════════════════════════════════════════════════════════════
   Bottom sheet
   ═══════════════════════════════════════════════════════════════════════ */

export function openSheet(html) {
  document.getElementById('pan').innerHTML = html;
  document.getElementById('sheet').classList.add('on');
}

export function closeSheet() {
  document.getElementById('sheet').classList.remove('on');
  document.getElementById('pan').innerHTML = '';
}

export const sheetIsOpen = () => document.getElementById('sheet').classList.contains('on');

/* ═══════════════════════════════════════════════════════════════════════
   Rest timer
   ═══════════════════════════════════════════════════════════════════════ */

let restTimer = null;
let restLeft = 0;

const paintRest = () => {
  const minutes = Math.floor(Math.max(0, restLeft) / 60);
  const seconds = Math.max(0, restLeft) % 60;
  document.getElementById('rt').textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
};

/** Rest comes from the exercise, not from a fixed three minutes. */
export function startRest(seconds) {
  restLeft = seconds;
  document.getElementById('rest').classList.add('on');
  paintRest();
  clearInterval(restTimer);
  restTimer = setInterval(() => {
    restLeft -= 1;
    paintRest();
    if (restLeft <= 0) stopRest();
  }, 1000);
}

export function stopRest() {
  clearInterval(restTimer);
  restTimer = null;
  document.getElementById('rest').classList.remove('on');
}

/* ═══════════════════════════════════════════════════════════════════════
   Layout helpers
   ═══════════════════════════════════════════════════════════════════════ */

/** A heading that opens and closes the card under it. State survives renders. */
export function section(id, title, count, body, shut) {
  const isShut = shut.has(id);
  return `<h3 class="tap ${isShut ? 'shut' : ''}" data-act="section" data-id="${id}">${escape(title)}${
    count ? `<span class="n">${escape(count)}</span>` : ''
  }</h3>${isShut ? '' : body}`;
}

export const flag = (kind, icon, html) =>
  `<div class="flag f-${kind}"><i>${icon}</i><span>${html}</span></div>`;

export const card = (inner, cls = '') => `<div class="card ${cls}">${inner}</div>`;
