/**
 * ui/charts.js — every chart, as inline SVG. No library, no canvas.
 *
 * Colours are CSS variables, so light and dark are handled by the stylesheet
 * rather than by any of this code. Charts take plain arrays and return a
 * string; they hold no state and read nothing from the DOM.
 *
 * Every chart returns an honest empty state rather than an empty axis: an
 * axis with no data on it reads like a bug.
 */

import { escape } from './components.js';

const W = 680;
const PAD = { left: 44, right: 14, top: 12, bottom: 24 };

const num = (n) => (Math.round(n * 10) / 10).toFixed(1);
const shortDate = (iso) => (iso || '').slice(5).replace('-', '/');

export const emptyChart = (message) =>
  `<div class="chart-empty">${escape(message)}</div>`;

const svg = (height, inner) =>
  `<svg class="ch" viewBox="0 0 ${W} ${height}" preserveAspectRatio="xMidYMid meet" role="img">${inner}</svg>`;

/** Horizontal grid lines with value labels, shared by the line and bar charts. */
function gridLines(y0, y1, height, toY, lines = 3) {
  let out = '';
  for (let i = 0; i <= lines; i++) {
    const value = y0 + ((y1 - y0) * i) / lines;
    const y = toY(value);
    out += `<line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${W - PAD.right}" y2="${y.toFixed(1)}" stroke="var(--grid)"/>
      <text x="${PAD.left - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--muted)">${
        Math.round(value * 10) / 10
      }</text>`;
  }
  return out;
}

/**
 * A line over time, optionally with a shaded target band behind it.
 * Points are [{ label, value }] in order.
 */
export function lineChart(points, { color = 'var(--s1)', unit = '', band = null, height = 170 } = {}) {
  if (!points?.length) return emptyChart('Nothing logged yet.');
  if (points.length === 1) {
    return `<div class="chart-empty">One point so far — <b>${num(points[0].value)}${escape(unit)}</b> on ${escape(
      points[0].label
    )}. A trend needs two.</div>`;
  }

  const values = points.map((p) => p.value);
  let y0 = Math.min(...values, band ? band.lo : Infinity);
  let y1 = Math.max(...values, band ? band.hi : -Infinity);
  const pad = (y1 - y0) * 0.2 || 1;
  y0 -= pad;
  y1 += pad;

  const toX = (i) => PAD.left + (i / (points.length - 1)) * (W - PAD.left - PAD.right);
  const toY = (v) => PAD.top + (1 - (v - y0) / (y1 - y0)) * (height - PAD.top - PAD.bottom);

  const bandRect = band
    ? `<rect x="${PAD.left}" y="${toY(band.hi).toFixed(1)}" width="${W - PAD.left - PAD.right}" height="${(
        toY(band.lo) - toY(band.hi)
      ).toFixed(1)}" fill="var(--s3)" opacity="0.13"/>`
    : '';

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${toX(i).toFixed(1)},${toY(p.value).toFixed(1)}`).join(' ');
  const dots = points
    .map(
      (p, i) =>
        `<circle cx="${toX(i).toFixed(1)}" cy="${toY(p.value).toFixed(1)}" r="3.6" fill="${color}" stroke="var(--surface)" stroke-width="2"/>`
    )
    .join('');
  const last = points[points.length - 1];

  return svg(
    height,
    `${gridLines(y0, y1, height, toY)}${bandRect}
     <line x1="${PAD.left}" y1="${height - PAD.bottom}" x2="${W - PAD.right}" y2="${height - PAD.bottom}" stroke="var(--axis)"/>
     <path d="${path}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>${dots}
     <text x="${W - PAD.right}" y="${(toY(last.value) - 10).toFixed(1)}" text-anchor="end" font-size="12.5" font-weight="700" fill="var(--ink)">${num(
       last.value
     )}${escape(unit)}</text>
     <text x="${PAD.left}" y="${height - 6}" font-size="11" fill="var(--muted)">${escape(points[0].label)}</text>
     <text x="${W - PAD.right}" y="${height - 6}" text-anchor="end" font-size="11" fill="var(--muted)">${escape(
       last.label
     )}</text>`
  );
}

/**
 * Two series indexed to 100 at their first point. The whole question on a bulk
 * is whether strength is outpacing mass — which only one axis can answer.
 */
export function indexedChart(series, { height = 190 } = {}) {
  const usable = series.filter((s) => s.points.length >= 2);
  if (usable.length < 2) return emptyChart('Needs a few weeks of both bodyweight and index sets.');

  const indexed = usable.map((s) => ({
    ...s,
    points: s.points.map((p) => ({ ...p, value: (p.value / s.points[0].value) * 100 })),
  }));

  const all = indexed.flatMap((s) => s.points.map((p) => p.value));
  let y0 = Math.min(...all, 100);
  let y1 = Math.max(...all, 100);
  const pad = (y1 - y0) * 0.25 || 2;
  y0 -= pad;
  y1 += pad;

  const longest = Math.max(...indexed.map((s) => s.points.length));
  const toX = (i) => PAD.left + (i / (longest - 1)) * (W - PAD.left - PAD.right);
  const toY = (v) => PAD.top + (1 - (v - y0) / (y1 - y0)) * (height - PAD.top - PAD.bottom);

  const lines = indexed
    .map(
      (s) =>
        `<path d="${s.points
          .map((p, i) => `${i ? 'L' : 'M'}${toX(i).toFixed(1)},${toY(p.value).toFixed(1)}`)
          .join(' ')}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round"/>`
    )
    .join('');

  const legend = indexed
    .map(
      (s, i) =>
        `<g transform="translate(${PAD.left + i * 170},${height - 4})"><rect width="10" height="10" y="-9" rx="3" fill="${
          s.color
        }"/><text x="15" font-size="11.5" fill="var(--muted)">${escape(s.name)} ${num(
          s.points[s.points.length - 1].value
        )}</text></g>`
    )
    .join('');

  return svg(
    height + 8,
    `${gridLines(y0, y1, height, toY)}
     <line x1="${PAD.left}" y1="${toY(100).toFixed(1)}" x2="${W - PAD.right}" y2="${toY(100).toFixed(
       1
     )}" stroke="var(--axis)" stroke-dasharray="4 3"/>
     ${lines}${legend}`
  );
}

/** Vertical bars with an optional rolling-average line over the top. */
export function barChart(items, { color = 'var(--s1)', unit = '', height = 180, average = false } = {}) {
  if (!items?.length) return emptyChart('Nothing logged yet.');

  const values = items.map((i) => i.value);
  const y1 = Math.max(...values) * 1.15 || 1;
  const toY = (v) => PAD.top + (1 - v / y1) * (height - PAD.top - PAD.bottom);
  const slot = (W - PAD.left - PAD.right) / items.length;
  const barWidth = Math.min(38, slot * 0.62);

  const bars = items
    .map((item, i) => {
      const x = PAD.left + slot * i + (slot - barWidth) / 2;
      const y = toY(item.value);
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${(
        height - PAD.bottom - y
      ).toFixed(1)}" rx="3" fill="${item.color || color}"/>
      <text x="${(x + barWidth / 2).toFixed(1)}" y="${(y - 5).toFixed(
        1
      )}" text-anchor="middle" font-size="10.5" font-weight="700" fill="var(--ink)">${escape(
        item.display ?? Math.round(item.value)
      )}</text>
      <text x="${(x + barWidth / 2).toFixed(1)}" y="${height - 8}" text-anchor="middle" font-size="10" fill="var(--muted)">${escape(
        item.label
      )}</text>`;
    })
    .join('');

  let trend = '';
  if (average && items.length > 2) {
    const path = items
      .map((item, i) => {
        const window = items.slice(Math.max(0, i - 2), i + 1);
        const mean = window.reduce((a, b) => a + b.value, 0) / window.length;
        const x = PAD.left + slot * i + slot / 2;
        return `${i ? 'L' : 'M'}${x.toFixed(1)},${toY(mean).toFixed(1)}`;
      })
      .join(' ');
    trend = `<path d="${path}" fill="none" stroke="var(--ink2)" stroke-width="1.8" stroke-dasharray="5 3"/>`;
  }

  return svg(
    height,
    `${gridLines(0, y1, height, toY)}
     <line x1="${PAD.left}" y1="${height - PAD.bottom}" x2="${W - PAD.right}" y2="${height - PAD.bottom}" stroke="var(--axis)"/>
     ${trend}${bars}
     <text x="${W - PAD.right}" y="${PAD.top + 2}" text-anchor="end" font-size="11.5" fill="var(--muted)">${escape(unit)}</text>`
  );
}

/**
 * The consistency heatmap: one cell per day, coloured by which session it was.
 * Adherence is the single biggest risk to finishing 33 weeks, and this is the
 * only view that makes it visible.
 */
export function heatmap(days, { sessionColors } = {}) {
  if (!days?.length) return emptyChart('Nothing logged yet.');

  const cell = 15;
  const gap = 3;
  const weeks = Math.ceil(days.length / 7);
  const left = 22;
  const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  const cells = days
    .map((day, i) => {
      const x = left + Math.floor(i / 7) * (cell + gap);
      const y = 4 + (i % 7) * (cell + gap);
      const fill = day.sessionId ? sessionColors[day.sessionId] || 'var(--s1)' : 'var(--grid)';
      return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3.5" fill="${fill}" ${
        day.sessionId ? '' : 'opacity="0.55"'
      }><title>${escape(day.dateISO)}${day.sessionId ? ` · session ${escape(day.sessionId)}` : ' · rest'}</title></rect>`;
    })
    .join('');

  const rowLabels = labels
    .map(
      (l, i) =>
        `<text x="${left - 6}" y="${4 + i * (cell + gap) + 11}" text-anchor="end" font-size="9.5" fill="var(--muted)">${l}</text>`
    )
    .join('');

  const width = left + weeks * (cell + gap) + 4;
  const height = 8 + 7 * (cell + gap);

  // Sized in real pixels rather than stretched to the card: a five-week grid
  // blown up to full width looks like a bug, and a year of cells has to stay
  // legible. The legend is HTML so it wraps like text instead of overflowing.
  const legend = Object.keys(sessionColors)
    .map((id) => `<span><i style="background:${sessionColors[id]}"></i>${escape(id)}</span>`)
    .join('');

  return `<div style="overflow-x:auto">
    <svg class="ch" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"
      style="width:${width}px;max-width:100%;height:auto" preserveAspectRatio="xMinYMin meet" role="img">${rowLabels}${cells}</svg>
  </div><div class="lg" style="margin-top:9px">${legend}</div>`;
}

/**
 * Load against reps for every set of one lift, with iso-e1RM curves behind it.
 * One number moving tells you less than the whole cloud of your capability
 * shifting up and to the right.
 */
export function scatterIso(points, { curves = [], pctFor, unit = 'kg', height = 210 } = {}) {
  if (!points?.length) return emptyChart('No sets logged for this lift yet.');

  const maxReps = Math.max(12, ...points.map((p) => p.reps));
  const maxLoad = Math.max(...points.map((p) => p.load), ...curves) * 1.08;
  const toX = (reps) => PAD.left + ((reps - 1) / (maxReps - 1)) * (W - PAD.left - PAD.right);
  const toY = (load) => PAD.top + (1 - load / maxLoad) * (height - PAD.top - PAD.bottom);

  const isoCurves = curves
    .map((e1rm, index) => {
      // The table stops at twelve reps. Past that there is no percentage to
      // draw, so the curve stops too rather than running off as NaN.
      const path = [];
      for (let reps = 1; reps <= maxReps; reps++) {
        const percent = pctFor(reps, 10);
        if (percent == null) break;
        const load = (e1rm * percent) / 100;
        path.push(`${reps === 1 ? 'M' : 'L'}${toX(reps).toFixed(1)},${toY(load).toFixed(1)}`);
      }
      if (path.length < 2) return '';
      // Labelled at the right-hand end, where the curves are furthest apart and
      // clear of both the y-axis numbers and the cloud of sets.
      const labelReps = Math.min(maxReps, 10);
      if (pctFor(labelReps, 10) == null) return `<path d="${path.join(' ')}" fill="none" stroke="var(--axis)" stroke-width="1.2" stroke-dasharray="4 4"/>`;
      return `<path d="${path.join(' ')}" fill="none" stroke="var(--axis)" stroke-width="1.2" stroke-dasharray="4 4"/>
        <text x="${(toX(labelReps) + 6).toFixed(1)}" y="${(toY((e1rm * pctFor(labelReps, 10)) / 100) - 4).toFixed(
          1
        )}" font-size="9.5" fill="var(--muted)">${index === curves.length - 1 ? 'e1RM ' : ''}${Math.round(e1rm)}</text>`;
    })
    .join('');

  const dots = points
    .map(
      (p) =>
        `<circle cx="${toX(p.reps).toFixed(1)}" cy="${toY(p.load).toFixed(1)}" r="${p.recent ? 5 : 3.6}" fill="${
          p.recent ? 'var(--s2)' : 'var(--s1)'
        }" opacity="${p.recent ? 0.95 : 0.5}"><title>${num(p.load)} ${escape(unit)} × ${p.reps}${
          p.dateISO ? ` · ${escape(p.dateISO)}` : ''
        }</title></circle>`
    )
    .join('');

  const xLabels = [1, 3, 5, 8, 12]
    .filter((r) => r <= maxReps)
    .map(
      (r) =>
        `<text x="${toX(r).toFixed(1)}" y="${height - 7}" text-anchor="middle" font-size="10.5" fill="var(--muted)">${r}</text>`
    )
    .join('');

  const chart = svg(
    height,
    `${gridLines(0, maxLoad, height, toY)}
     <line x1="${PAD.left}" y1="${height - PAD.bottom}" x2="${W - PAD.right}" y2="${height - PAD.bottom}" stroke="var(--axis)"/>
     ${isoCurves}${dots}${xLabels}
     <text x="${(W - PAD.right).toFixed(1)}" y="${PAD.top + 2}" text-anchor="end" font-size="10.5" fill="var(--muted)">${escape(
       unit
     )} against reps</text>`
  );

  // A touch device has no hover, so the legend has to carry what the colours mean.
  return `${chart}<div class="lg" style="margin-top:6px">
    <span><i style="background:var(--s2)"></i>last 14 days</span>
    <span><i style="background:var(--s1);opacity:.5"></i>earlier</span>
    <span><i style="background:var(--axis)"></i>equal e1RM</span></div>`;
}

/** Stacked bars over time — volume per muscle, week by week. */
export function stackedBars(weeks, { keys, colors, height = 200, unit = 'sets' } = {}) {
  if (!weeks?.length) return emptyChart('Nothing logged yet.');

  const totals = weeks.map((w) => keys.reduce((sum, k) => sum + (w.values[k] || 0), 0));
  const y1 = Math.max(...totals) * 1.12 || 1;
  const toY = (v) => PAD.top + (1 - v / y1) * (height - PAD.top - PAD.bottom);
  const slot = (W - PAD.left - PAD.right) / weeks.length;
  const barWidth = Math.min(40, slot * 0.66);

  const bars = weeks
    .map((week, i) => {
      const x = PAD.left + slot * i + (slot - barWidth) / 2;
      let cursor = 0;
      const stack = keys
        .map((key) => {
          const value = week.values[key] || 0;
          if (!value) return '';
          const y = toY(cursor + value);
          const barHeight = toY(cursor) - y;
          cursor += value;
          return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(
            1
          )}" fill="${colors[key]}"><title>${escape(key)} ${num(value)} ${escape(unit)}</title></rect>`;
        })
        .join('');
      return `${stack}<text x="${(x + barWidth / 2).toFixed(1)}" y="${height - 8}" text-anchor="middle" font-size="10" fill="var(--muted)">${escape(
        week.label
      )}</text>`;
    })
    .join('');

  const legend = keys
    .map(
      (key, i) =>
        `<g transform="translate(${PAD.left + i * 92},${PAD.top + 2})"><rect width="9" height="9" rx="2.5" fill="${
          colors[key]
        }"/><text x="13" y="8.5" font-size="10.5" fill="var(--muted)">${escape(key)}</text></g>`
    )
    .join('');

  return svg(height, `${gridLines(0, y1, height, toY)}${bars}${legend}`);
}

/** Every PR as a dot on a time axis, coloured by lift. */
export function timeline(events, { colors = {}, height = 150 } = {}) {
  if (!events?.length) return emptyChart('No records yet — they start appearing after a few index sets.');

  const lifts = [...new Set(events.map((e) => e.lift))];
  const first = Date.parse(events[0].dateISO);
  const last = Date.parse(events[events.length - 1].dateISO);
  const span = Math.max(1, last - first);
  const toX = (iso) => PAD.left + ((Date.parse(iso) - first) / span) * (W - PAD.left - PAD.right);
  const rowHeight = Math.max(20, (height - PAD.top - PAD.bottom) / Math.max(1, lifts.length));

  const rows = lifts
    .map((lift, i) => {
      const y = PAD.top + i * rowHeight + rowHeight / 2;
      const rowEvents = events.filter((e) => e.lift === lift);
      const dots = rowEvents
        .map((e, i) => {
          const isLast = i === rowEvents.length - 1;
          // The most recent record on each row carries its value. Near the right
          // edge the label flips to the left of the dot so it cannot run off.
          const x = toX(e.dateISO);
          const flip = x > W - PAD.right - 46;
          const label =
            isLast && e.kind !== 'tie'
              ? `<text x="${(flip ? x - 8 : x + 8).toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${
                  flip ? 'end' : 'start'
                }" font-size="10.5" font-weight="700" fill="var(--ink)">${num(e.value)}</text>`
              : '';
          return `<circle cx="${toX(e.dateISO).toFixed(1)}" cy="${y.toFixed(1)}" r="${e.kind === 'tie' ? 3.4 : 5}" fill="${
            colors[lift] || 'var(--s1)'
          }" opacity="${e.kind === 'tie' ? 0.45 : 1}"><title>${escape(e.dateISO)} · ${num(e.value)} kg${
            e.kind === 'tie' ? ' (tie)' : ''
          }</title></circle>${label}`;
        })
        .join('');
      return `<line x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${W - PAD.right}" y2="${y.toFixed(
        1
      )}" stroke="var(--grid)"/><text x="${PAD.left - 6}" y="${(y + 4).toFixed(
        1
      )}" text-anchor="end" font-size="10.5" fill="var(--muted)">${escape(lift)}</text>${dots}`;
    })
    .join('');

  return svg(
    height,
    `${rows}
     <text x="${PAD.left}" y="${height - 6}" font-size="11" fill="var(--muted)">${escape(shortDate(events[0].dateISO))}</text>
     <text x="${W - PAD.right}" y="${height - 6}" text-anchor="end" font-size="11" fill="var(--muted)">${escape(
       shortDate(events[events.length - 1].dateISO)
     )}</text>`
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   v2 charts — real time axes, tappable points, and stated evidence
   ═══════════════════════════════════════════════════════════════════════ */

const DAY = 86400000;
const dayOf = (iso) => Math.round(Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`) / DAY);

/**
 * A tappable point. Touch devices have no hover, so an SVG <title> is invisible
 * to the only device this app runs on. Every point carries a data-tip that the
 * app's delegated handler prints into the caption strip under the chart.
 */
const tip = (text) => `data-tip="${escape(text)}"`;

/** Wraps a chart so the tip strip has somewhere to appear. */
export const chartFrame = (inner, hint = 'Tap any point for its details.') =>
  `<div class="ch-wrap">${inner}<div class="ch-tip" data-tip-slot>${escape(hint)}</div></div>`;

/** Month boundaries as x-axis ticks — dates spaced by time, labelled by month. */
function timeAxis(firstDay, lastDay, toX, height) {
  const out = [];
  const start = new Date(firstDay * DAY);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  while (cursor.getTime() / DAY <= lastDay) {
    const day = cursor.getTime() / DAY;
    if (day >= firstDay) {
      const x = toX(day);
      out.push(`<line x1="${x.toFixed(1)}" y1="${PAD.top}" x2="${x.toFixed(1)}" y2="${height - PAD.bottom}" stroke="var(--grid)" stroke-dasharray="2 4"/>
        <text x="${x.toFixed(1)}" y="${height - 8}" text-anchor="middle" font-size="10" fill="var(--muted)">${
          months[cursor.getUTCMonth()]
        }</text>`);
    }
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out.join('');
}

/**
 * A series over a real date axis: gaps look like gaps.
 *
 * v1 spaced every point equally, so three weigh-ins in a week and one a month
 * later drew the same shape as four evenly spaced ones — and the slope you read
 * off the picture was not the slope the numbers had.
 */
export function timeChart(points, {
  color = 'var(--s1)',
  unit = '',
  band = null,
  corridor = null,
  goal = null,
  height = 180,
  fit = null,
  label = (p) => `${shortDate(p.dateISO)} · ${num(p.value)}${unit}`,
} = {}) {
  const clean = (points || []).filter((p) => Number.isFinite(p.value) && p.dateISO);
  if (!clean.length) return emptyChart('Nothing logged yet.');
  if (clean.length === 1) {
    return `<div class="chart-empty">One point so far — <b>${num(clean[0].value)}${escape(unit)}</b> on ${escape(
      shortDate(clean[0].dateISO)
    )}. A trend needs two.</div>`;
  }

  const days = clean.map((p) => dayOf(p.dateISO));
  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  const span = Math.max(1, lastDay - firstDay);

  // A gain-rate target is a corridor, not a horizontal strip: it starts where
  // you were and widens at the target rate. v1 drew a flat band around the
  // latest reading, which made any rate at all look like it was inside it.
  const corridorAt = corridor
    ? (day) => {
        const weeks = (day - dayOf(corridor.fromDateISO)) / 7;
        return { lo: corridor.value + corridor.lo * weeks, hi: corridor.value + corridor.hi * weeks };
      }
    : null;

  const values = clean.map((p) => p.value);
  const corridorAnchorDay = corridor ? Math.max(days[0], dayOf(corridor.fromDateISO)) : null;
  const corridorValues = corridorAt
    ? [
        corridorAt(corridorAnchorDay).lo,
        corridorAt(corridorAnchorDay).hi,
        corridorAt(days[days.length - 1]).lo,
        corridorAt(days[days.length - 1]).hi,
      ]
    : [];
  let y0 = Math.min(...values, ...corridorValues, band ? band.lo : Infinity, goal ?? Infinity);
  let y1 = Math.max(...values, ...corridorValues, band ? band.hi : -Infinity, goal ?? -Infinity);
  const pad = (y1 - y0) * 0.15 || 1;
  y0 -= pad;
  y1 += pad;

  const toX = (day) => PAD.left + ((day - firstDay) / span) * (W - PAD.left - PAD.right);
  const toY = (v) => PAD.top + (1 - (v - y0) / (y1 - y0)) * (height - PAD.top - PAD.bottom);

  const bandRect = band
    ? `<rect x="${PAD.left}" y="${toY(band.hi).toFixed(1)}" width="${W - PAD.left - PAD.right}" height="${Math.max(
        1,
        toY(band.lo) - toY(band.hi)
      ).toFixed(1)}" fill="var(--s3)" opacity="0.13"/>`
    : '';

  // Drawn only from its anchor onward. Extrapolating a target backwards past
  // the point it was set from would put the corridor above history it was
  // never meant to describe.
  const corridorStart = corridorAt ? Math.max(firstDay, dayOf(corridor.fromDateISO)) : firstDay;
  const corridorShape = corridorAt
    ? `<polygon points="${[
        `${toX(corridorStart).toFixed(1)},${toY(corridorAt(corridorStart).hi).toFixed(1)}`,
        `${toX(lastDay).toFixed(1)},${toY(corridorAt(lastDay).hi).toFixed(1)}`,
        `${toX(lastDay).toFixed(1)},${toY(corridorAt(lastDay).lo).toFixed(1)}`,
        `${toX(corridorStart).toFixed(1)},${toY(corridorAt(corridorStart).lo).toFixed(1)}`,
      ].join(' ')}" fill="var(--s3)" opacity="0.14"/>
      <text x="${(toX(corridorStart) + 4).toFixed(1)}" y="${(toY(corridorAt(corridorStart).hi) - 5).toFixed(
        1
      )}" font-size="10" fill="var(--muted)">target ${corridor.lo}–${corridor.hi}/wk</text>`
    : '';

  const goalLine =
    goal == null
      ? ''
      : `<line x1="${PAD.left}" y1="${toY(goal).toFixed(1)}" x2="${W - PAD.right}" y2="${toY(goal).toFixed(
          1
        )}" stroke="var(--s2)" stroke-width="1.5" stroke-dasharray="6 4"/>
        <text x="${W - PAD.right}" y="${(toY(goal) - 5).toFixed(1)}" text-anchor="end" font-size="10.5" fill="var(--s2)" font-weight="700">goal ${num(
          goal
        )}${escape(unit)}</text>`;

  // The fitted line, when the pipeline says the fit is worth drawing. A slope
  // asserted in prose and absent from the picture is the easiest kind of claim
  // to get wrong without noticing.
  const fitLine =
    fit && fit.ok
      ? `<line x1="${toX(firstDay).toFixed(1)}" y1="${toY(fit.at(firstDay)).toFixed(1)}" x2="${toX(lastDay).toFixed(
          1
        )}" y2="${toY(fit.at(lastDay)).toFixed(1)}" stroke="${color}" stroke-width="1.4" stroke-dasharray="5 4" opacity="0.65"/>`
      : '';

  const path = clean
    .map((p, i) => `${i ? 'L' : 'M'}${toX(days[i]).toFixed(1)},${toY(p.value).toFixed(1)}`)
    .join(' ');

  const dots = clean
    .map(
      (p, i) =>
        `<circle class="pt" cx="${toX(days[i]).toFixed(1)}" cy="${toY(p.value).toFixed(1)}" r="3.6" fill="${color}"
          stroke="var(--surface)" stroke-width="2" ${tip(label(p))}/>
         <circle class="hit" cx="${toX(days[i]).toFixed(1)}" cy="${toY(p.value).toFixed(
           1
         )}" r="13" fill="transparent" ${tip(label(p))}/>`
    )
    .join('');

  const last = clean[clean.length - 1];

  return chartFrame(
    svg(
      height,
      `${gridLines(y0, y1, height, toY)}${bandRect}${corridorShape}${timeAxis(firstDay, lastDay, toX, height)}
       <line x1="${PAD.left}" y1="${height - PAD.bottom}" x2="${W - PAD.right}" y2="${
         height - PAD.bottom
       }" stroke="var(--axis)"/>
       ${goalLine}${fitLine}
       <path d="${path}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>${dots}
       <text x="${W - PAD.right}" y="${Math.max(PAD.top + 10, toY(last.value) - 10).toFixed(
         1
       )}" text-anchor="end" font-size="12.5" font-weight="700" fill="var(--ink)">${num(last.value)}${escape(unit)}</text>`
    ),
    `${clean.length} points from ${shortDate(clean[0].dateISO)} to ${shortDate(last.dateISO)}. Tap one for its details.`
  );
}

/**
 * Two bars per group — what the plan asked for against what was logged.
 *
 * Planned and completed have to be counted with the same ruler, so both come
 * from `plannedVsCompleted` in volume.js rather than being derived here.
 */
export function groupedBars(groups, { series, height = 210, unit = 'sets' } = {}) {
  if (!groups?.length) return emptyChart('Nothing logged yet.');

  const all = groups.flatMap((g) => series.map((s) => g.values[s.key] || 0));
  const y1 = Math.max(...all, 1) * 1.18;
  const toY = (v) => PAD.top + (1 - v / y1) * (height - PAD.top - PAD.bottom);
  const slot = (W - PAD.left - PAD.right) / groups.length;
  const barWidth = Math.min(20, (slot * 0.72) / series.length);

  const bars = groups
    .map((group, i) => {
      const base = PAD.left + slot * i + (slot - barWidth * series.length) / 2;
      const stack = series
        .map((s, j) => {
          const value = group.values[s.key] || 0;
          const x = base + j * barWidth;
          const y = toY(value);
          return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(barWidth - 2).toFixed(1)}" height="${Math.max(
            0,
            height - PAD.bottom - y
          ).toFixed(1)}" rx="2.5" fill="${s.color}" ${tip(`${group.label} · ${s.name} ${num(value)} ${unit}`)}/>`;
        })
        .join('');
      return `${stack}<text x="${(base + (barWidth * series.length) / 2).toFixed(1)}" y="${
        height - 8
      }" text-anchor="middle" font-size="10" fill="var(--muted)">${escape(group.label)}</text>`;
    })
    .join('');

  const legend = series
    .map(
      (s, i) =>
        `<g transform="translate(${PAD.left + i * 120},${PAD.top + 2})"><rect width="9" height="9" rx="2.5" fill="${
          s.color
        }"/><text x="13" y="8.5" font-size="10.5" fill="var(--muted)">${escape(s.name)}</text></g>`
    )
    .join('');

  return chartFrame(svg(height, `${gridLines(0, y1, height, toY)}${bars}${legend}`), 'Tap a bar for its exact count.');
}

/**
 * Two series indexed to 100, joined on dates rather than positions.
 *
 * Rows come from `alignByDate`, so a missing weigh-in leaves a gap in the
 * bodyweight line instead of pairing it with the wrong week's strength.
 */
export function indexedByDate(rows, { names, colors, height = 200 } = {}) {
  const usable = rows.filter((row) => row.a != null || row.b != null);
  if (usable.length < 3) return emptyChart('Needs a few weeks of both bodyweight and index sets.');

  const baseA = usable.find((r) => r.a != null)?.a;
  const baseB = usable.find((r) => r.b != null)?.b;
  if (!baseA || !baseB) return emptyChart('Needs a few weeks of both bodyweight and index sets.');

  const scaled = usable.map((row) => ({
    day: dayOf(row.dateISO),
    dateISO: row.dateISO,
    a: row.a == null ? null : (row.a / baseA) * 100,
    b: row.b == null ? null : (row.b / baseB) * 100,
  }));

  const values = scaled.flatMap((r) => [r.a, r.b]).filter((v) => v != null);
  let y0 = Math.min(...values, 100);
  let y1 = Math.max(...values, 100);
  const pad = (y1 - y0) * 0.2 || 2;
  y0 -= pad;
  y1 += pad;

  const firstDay = scaled[0].day;
  const span = Math.max(1, scaled[scaled.length - 1].day - firstDay);
  const toX = (day) => PAD.left + ((day - firstDay) / span) * (W - PAD.left - PAD.right);
  const toY = (v) => PAD.top + (1 - (v - y0) / (y1 - y0)) * (height - PAD.top - PAD.bottom);

  // Each key draws only over the points it has; a gap breaks the line rather
  // than being bridged by an invented value.
  const lineFor = (key, color) => {
    const present = scaled.filter((r) => r[key] != null);
    if (present.length < 2) return '';
    const path = present.map((r, i) => `${i ? 'L' : 'M'}${toX(r.day).toFixed(1)},${toY(r[key]).toFixed(1)}`).join(' ');
    const dots = present
      .map(
        (r) =>
          `<circle class="hit" cx="${toX(r.day).toFixed(1)}" cy="${toY(r[key]).toFixed(1)}" r="12" fill="transparent" ${tip(
            `${shortDate(r.dateISO)} · ${names[key]} at ${num(r[key])} of 100`
          )}/>`
      )
      .join('');
    return `<path d="${path}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>${dots}`;
  };

  const legend = ['a', 'b']
    .map((key, i) => {
      const present = scaled.filter((r) => r[key] != null);
      const latest = present.length ? num(present[present.length - 1][key]) : '—';
      return `<g transform="translate(${PAD.left + i * 180},${height - 4})"><rect width="10" height="10" y="-9" rx="3" fill="${
        colors[key]
      }"/><text x="15" font-size="11.5" fill="var(--muted)">${escape(names[key])} ${latest}</text></g>`;
    })
    .join('');

  return chartFrame(
    svg(
      height + 8,
      `${gridLines(y0, y1, height, toY)}${timeAxis(firstDay, scaled[scaled.length - 1].day, toX, height)}
       <line x1="${PAD.left}" y1="${toY(100).toFixed(1)}" x2="${W - PAD.right}" y2="${toY(100).toFixed(
         1
       )}" stroke="var(--axis)" stroke-dasharray="4 3"/>
       ${lineFor('a', colors.a)}${lineFor('b', colors.b)}${legend}`
    ),
    'Both indexed to 100 at their first reading. Tap a point to read it.'
  );
}

/** Horizontal bars, for comparisons where the labels are words not dates. */
export function rowBars(items, { unit = '', height = null, color = 'var(--s1)' } = {}) {
  if (!items?.length) return emptyChart('Nothing to compare yet.');

  const rowHeight = 30;
  const total = items.length * rowHeight + 16;
  const left = 132;
  const magnitude = Math.max(...items.map((i) => Math.abs(i.value)), 0.1);
  const zero = items.some((i) => i.value < 0) ? left + (W - left - 60) / 2 : left;
  const scale = (W - left - 60) / (items.some((i) => i.value < 0) ? magnitude * 2 : magnitude);

  const rows = items
    .map((item, i) => {
      const y = 8 + i * rowHeight;
      const width = Math.abs(item.value) * scale;
      const x = item.value < 0 ? zero - width : zero;
      const fill = item.value < 0 ? 'var(--badtx)' : item.color || color;
      return `<text x="${left - 8}" y="${(y + 15).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--ink2)">${escape(
        item.label
      )}</text>
      <rect x="${x.toFixed(1)}" y="${y + 4}" width="${Math.max(1, width).toFixed(1)}" height="16" rx="3" fill="${fill}" ${tip(
        `${item.label} · ${item.display ?? num(item.value)} ${unit}`
      )}/>
      <text x="${(item.value < 0 ? x - 6 : x + width + 6).toFixed(1)}" y="${(y + 16).toFixed(1)}" text-anchor="${
        item.value < 0 ? 'end' : 'start'
      }" font-size="10.5" font-weight="700" fill="var(--ink)">${escape(item.display ?? num(item.value))}</text>`;
    })
    .join('');

  const axis = items.some((i) => i.value < 0)
    ? `<line x1="${zero}" y1="4" x2="${zero}" y2="${total - 8}" stroke="var(--axis)"/>`
    : '';

  return chartFrame(
    `<svg class="ch" viewBox="0 0 ${W} ${height || total}" preserveAspectRatio="xMidYMid meet" role="img">${axis}${rows}</svg>`,
    `${unit}. Tap a bar for the exact figure.`
  );
}
