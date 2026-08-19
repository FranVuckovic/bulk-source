/**
 * ui/history.js — every entry, newest first, the only place anything can be
 * deleted, and the bin it goes to.
 *
 * Deletion is deliberately slow: open the entry, read what it actually
 * contains, confirm, and take a backup on the way past if you want one. A
 * mis-tap on a list row must never be able to remove a session.
 *
 * Nothing here is destroyed. A delete marks the record and writes an audit
 * entry; the recovery list below puts it back. The mistake worth designing for
 * is not the one you notice immediately — it is the weigh-in typed as 9.2
 * instead of 92 and spotted a week later.
 */

import { e1rm, systemLoad } from '../calc.js';
import { escape, fmtLoad, fmtNum, openSheet, closeSheet } from './components.js';

const KINDS = [
  ['all', 'All'],
  ['session', 'Sessions'],
  ['daily', 'Daily'],
  ['measurement', 'Measurements'],
  ['niggle', 'Niggles'],
  ['media', 'Media'],
];

const dayOf = (iso) => (iso || '').slice(0, 10);

const longDate = (iso) => {
  const [year, month, day] = dayOf(iso).split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(day)} ${months[Number(month) - 1]} ${year}`;
};

const minutesBetween = (from, to) =>
  from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 60000) : null;

/** Every stored thing, flattened into one dated list. */
export function entries(state) {
  const setsByLog = new Map();
  for (const set of state.sets) {
    if (!setsByLog.has(set.sessionLogId)) setsByLog.set(set.sessionLogId, []);
    setsByLog.get(set.sessionLogId).push(set);
  }

  const rows = [
    ...state.logs.map((log) => {
      const sets = setsByLog.get(log.id) || [];
      const session = state.plan.sessions.find((s) => s.id === log.sessionId);
      const minutes = minutesBetween(log.startedAt, log.endedAt);
      return {
        kind: 'session',
        key: `session:${log.id}`,
        id: log.id,
        dateISO: dayOf(log.dateISO),
        title: `${log.sessionId} · ${session ? session.name : 'Session'}`,
        summary: [
          `${sets.length} sets`,
          minutes ? `${minutes} min` : null,
          log.sessionRpe ? `sRPE ${log.sessionRpe}` : null,
          log.isPartial ? 'partial' : null,
          log.endedAt ? null : 'unfinished',
        ]
          .filter(Boolean)
          .join(' · '),
        record: log,
        sets,
      };
    }),
    ...state.daily.map((row) => ({
      kind: 'daily',
      key: `daily:${row.dateISO}`,
      id: row.dateISO,
      dateISO: dayOf(row.dateISO),
      title: 'Daily',
      summary: [
        row.bodyweight == null ? null : `${row.bodyweight} kg`,
        row.bodyfatPct == null ? null : `${row.bodyfatPct}% bf`,
        row.sleepHours == null ? null : `${row.sleepHours} h sleep`,
        row.steps == null ? null : `${row.steps} steps`,
      ]
        .filter(Boolean)
        .join(' · ') || 'all fields blank',
      record: row,
    })),
    ...state.measurements.map((row) => ({
      kind: 'measurement',
      key: `measurement:${row.dateISO}`,
      id: row.dateISO,
      dateISO: dayOf(row.dateISO),
      title: 'Measurements',
      summary:
        [row.waist == null ? null : `waist ${row.waist}`, row.chest == null ? null : `chest ${row.chest}`]
          .filter(Boolean)
          .join(' · ') || 'all fields blank',
      record: row,
    })),
    ...state.niggles.map((row) => ({
      kind: 'niggle',
      key: `niggle:${row.id}`,
      id: row.id,
      dateISO: dayOf(row.dateISO),
      title: `Niggle · ${row.site}`,
      summary: [`severity ${row.severity}`, row.context].filter(Boolean).join(' · '),
      record: row,
    })),
    ...state.media.map((row) => ({
      kind: 'media',
      key: `media:${row.id}`,
      id: row.id,
      dateISO: dayOf(row.dateISO),
      title: row.kind === 'physique' ? 'Physique photo' : 'Form check',
      summary: [row.note, row.fileRef].filter(Boolean).join(' · ') || '—',
      record: row,
    })),
  ];

  return rows.sort((a, b) => b.dateISO.localeCompare(a.dateISO) || a.kind.localeCompare(b.kind));
}

export function view(ctx) {
  const { state } = ctx;
  const filter = state.historyFilter || 'all';
  const all = entries(state);
  const shown = filter === 'all' ? all : all.filter((row) => row.kind === filter);

  const byDate = new Map();
  for (const row of shown) {
    if (!byDate.has(row.dateISO)) byDate.set(row.dateISO, []);
    byDate.get(row.dateISO).push(row);
  }

  return `
  <button class="back" data-act="history-close">‹ Progress</button>
  <h3 style="margin-top:0">History</h3>
  <p style="margin:0 2px 12px">Everything the app has stored, newest first. Tap an entry to see exactly what is
  in it, or to delete it.</p>

  <div class="picker">${KINDS.map(
    ([id, label]) =>
      `<button class="pill ${filter === id ? 'on' : ''}" data-act="history-filter" data-id="${id}">${escape(
        label
      )}</button>`
  ).join('')}</div>

  ${
    shown.length
      ? [...byDate.entries()]
          .map(
            ([date, rows]) => `<h3>${escape(longDate(date))}</h3>
        <div class="card flush">${rows
          .map(
            (row) => `<div class="big-row" data-act="history-open" data-key="${escape(row.key)}">
            <div class="ic">${escape(row.kind === 'session' ? row.title.slice(0, 1) : row.kind.slice(0, 1).toUpperCase())}</div>
            <div class="m"><b>${escape(row.title)}</b><span>${escape(row.summary)}</span></div>
            <div class="car">›</div></div>`
          )
          .join('')}</div>`
          )
          .join('')
      : '<div class="card"><p style="margin:0">Nothing stored under that filter yet.</p></div>'
  }

  ${recoveryList(state)}

  <p class="hint" style="margin:14px 2px">${all.length} entries in total. Deleting removes an entry from every
  chart and average straight away, and keeps it in the recovery list until you empty the bin.</p>`;
}

/**
 * The bin. Every soft-deleted record, newest deletion first, with one tap to
 * put it back.
 */
function recoveryList(state) {
  const deleted = state.deleted || [];
  if (!deleted.length) return '';

  const label = (entry) => {
    const row = entry.row;
    if (entry.store === 'sessionLogs') return `Session ${row.sessionId ?? '—'}${row.cycleSequence ? ` · rotation ${row.cycleSequence}` : ''}`;
    if (entry.store === 'daily') return `Weigh-in${Number.isFinite(row.bodyweight) ? ` · ${fmtNum(row.bodyweight, 1)} kg` : ''}`;
    if (entry.store === 'measurements') return 'Tape measurements';
    if (entry.store === 'niggles') return `Niggle · ${row.site ?? ''}`;
    return `${row.kind === 'physique' ? 'Physique photo' : 'Form check'}`;
  };

  return `<h3>Recently deleted</h3>
  <div class="card flush">${deleted
    .slice(0, 30)
    .map(
      (entry) => `<div class="big-row" style="cursor:default"><div class="ic">↺</div>
        <div class="m"><b>${escape(label(entry))}</b><span>from ${escape(longDate(entry.row.dateISO || entry.row.localDate || ''))} · deleted ${escape(
          entry.deletedAtISO.slice(0, 10)
        )}</span></div>
        <button class="setok" data-act="history-restore" data-store="${escape(entry.store)}" data-id="${escape(
          String(entry.id)
        )}">↺</button></div>`
    )
    .join('')}</div>
  <p class="hint" style="margin:8px 2px 0">${deleted.length} deleted record${
    deleted.length === 1 ? '' : 's'
  }${deleted.length > 30 ? ', 30 shown' : ''}. They are excluded from every chart and average, and still travel in a
  backup — so restoring an export restores the bin with it. Emptying the bin, in Settings, is the only thing in this
  app that destroys data.</p>`;
}

/* ═══════════════════════════════════════════════════════════════════════
   Detail and deletion
   ═══════════════════════════════════════════════════════════════════════ */

function sessionDetail(ctx, row) {
  const { state } = ctx;
  const unit = state.settings.unit;
  const log = row.record;
  const minutes = minutesBetween(log.startedAt, log.endedAt);

  const bySlot = [...row.sets].sort((a, b) => (a.slotIndex - b.slotIndex) || (a.setIndex - b.setIndex));
  const grouped = new Map();
  for (const set of bySlot) {
    const name = state.plan.exercises[set.exerciseId]?.name || set.exerciseId;
    if (!grouped.has(name)) grouped.set(name, []);
    grouped.get(name).push(set);
  }

  return `<div class="ttl">${escape(row.title)}</div>
    <p style="text-align:center;font-size:13px;margin:10px 0 12px">${escape(longDate(row.dateISO))}${
      minutes ? ` · ${minutes} min` : ''
    }${log.sessionRpe ? ` · session RPE ${log.sessionRpe}` : ''}${
      log.bodyweight ? ` · ${fmtLoad(log.bodyweight, unit)} ${unit}` : ''
    }${log.isPartial ? ' · logged as partial' : ''}</p>
    ${log.note ? `<div class="cue">${escape(log.note)}</div>` : ''}
    <div style="max-height:42vh;overflow:auto;margin-top:10px">
      ${[...grouped.entries()]
        .map(
          ([name, sets]) => `<div style="padding:8px 0;border-bottom:1px solid var(--grid)">
          <b style="font-size:13.5px">${escape(name)}</b>
          <div style="font-size:12.5px;color:var(--ink2);margin-top:3px;font-variant-numeric:tabular-nums">${sets
            .map((set) => {
              const total = systemLoad(set.load, set.bodyweightUsed || 0);
              const estimate = set.reps ? e1rm(total, set.reps, set.rpe ?? 8) : null;
              return `${set.load == null ? '—' : `${set.bodyweightUsed ? '+' : ''}${fmtLoad(set.load, unit)}`} × ${
                set.reps ?? '—'
              } @ ${set.rpe ?? '—'}${estimate ? ` <span style="color:var(--muted)">(e1RM ${fmtLoad(estimate, unit)})</span>` : ''}`;
            })
            .join('<br>')}</div></div>`
        )
        .join('')}
    </div>
    <button class="big danger mt" data-act="history-delete" data-key="${escape(row.key)}">Delete this session</button>
    <button class="big ghost mt" data-act="sheet-close">Close</button>`;
}

function plainDetail(row) {
  const fields = Object.entries(row.record)
    .filter(([key, value]) => !['id', 'imageBlob'].includes(key) && value != null && value !== '')
    .map(
      ([key, value]) =>
        `<tr><td>${escape(key)}</td><td>${escape(typeof value === 'object' ? JSON.stringify(value) : value)}</td></tr>`
    )
    .join('');

  return `<div class="ttl">${escape(row.title)}</div>
    <p style="text-align:center;font-size:13px;margin:10px 0 12px">${escape(longDate(row.dateISO))}</p>
    <table><tbody>${fields || '<tr><td>Every field is blank</td><td></td></tr>'}</tbody></table>
    <button class="big danger mt" data-act="history-delete" data-key="${escape(row.key)}">Delete this entry</button>
    <button class="big ghost mt" data-act="sheet-close">Close</button>`;
}

export const actions = {
  'history-open'(ctx, data) {
    const row = entries(ctx.state).find((entry) => entry.key === data.key);
    if (!row) return;
    openSheet(row.kind === 'session' ? sessionDetail(ctx, row) : plainDetail(row));
  },

  'history-filter'(ctx, data) {
    ctx.state.historyFilter = data.id;
    ctx.render();
    window.scrollTo(0, 0);
  },

  'history-close'(ctx) {
    ctx.state.progressSection = null;
    ctx.render();
    window.scrollTo(0, 0);
  },

  /** Step one of two: say exactly what will go, and offer the backup. */
  'history-delete'(ctx, data) {
    const row = entries(ctx.state).find((entry) => entry.key === data.key);
    if (!row) return;

    const what =
      row.kind === 'session'
        ? `<b>${escape(row.title)}</b> from ${escape(longDate(row.dateISO))}, and the <b>${row.sets.length} sets</b> logged in it`
        : `this <b>${escape(row.title.toLowerCase())}</b> entry from ${escape(longDate(row.dateISO))}`;

    openSheet(`<div class="ttl">Delete this?</div>
      <p style="text-align:center;margin:14px 0 6px;font-size:14px;color:var(--ink)">This removes ${what}.</p>
      <p style="text-align:center;font-size:13px">It comes out of every chart and average immediately. It is
      <b>not</b> destroyed — it moves to the recovery list at the bottom of this screen, where you can put it back.
      Take a backup too if there is any doubt.</p>
      <button class="big ghost mt" data-act="history-backup">Export a backup first</button>
      <button class="big danger mt" data-act="history-delete-confirm" data-key="${escape(row.key)}">Delete it</button>
      <button class="big ghost mt" data-act="sheet-close">Keep it</button>`);
  },

  async 'history-backup'(ctx) {
    await ctx.downloadBackup();
  },

  async 'history-restore'(ctx, data) {
    await ctx.restoreEntry(data.store, data.id);
    ctx.render();
  },

  async 'history-delete-confirm'(ctx, data) {
    const row = entries(ctx.state).find((entry) => entry.key === data.key);
    if (!row) return;
    await ctx.deleteEntry(row.kind, row.id);
    closeSheet();
    ctx.render();
  },
};
