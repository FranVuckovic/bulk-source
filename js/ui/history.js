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
import { escape, fmtLoad, fmtNum, subnav, flag, openSheet, closeSheet } from './components.js';
import { measurementTimeLabel } from './body.js';

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
        [
          row.waist == null ? null : `waist ${row.waist}`,
          row.chest == null ? null : `chest ${row.chest}`,
          // Two tape readings taken at different times of day are not
          // comparable, so which one this was belongs on the row rather than
          // two taps inside it.
          measurementTimeLabel(row) || 'time not recorded',
        ]
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

/**
 * The Log — a bottom section of its own.
 *
 * It used to be the foot of the Progress screen, reached by scrolling past ten
 * charts, and the export lived in Settings. Both are things you go looking for
 * deliberately, and both were somewhere you would only find by accident. The
 * record of what you did, the backups of it, and the bin it goes to when
 * deleted are one subject and they are together.
 */
const SECTIONS = (state) => [
  ['entries', 'Everything'],
  ['backups', 'Backups'],
  ['bin', 'Bin', (state.deleted || []).length ? String(state.deleted.length) : ''],
];

export function view(ctx) {
  const { state } = ctx;
  const section = state.logSection || 'entries';
  const tabs = subnav(SECTIONS(state), section, 'log-section');

  if (section === 'backups') return tabs + backupsView(state);
  if (section === 'bin') return tabs + binView(state);
  return tabs + entriesView(state);
}

function entriesView(state) {
  const filter = state.historyFilter || 'all';
  const all = entries(state);
  const shown = filter === 'all' ? all : all.filter((row) => row.kind === filter);

  const byDate = new Map();
  for (const row of shown) {
    if (!byDate.has(row.dateISO)) byDate.set(row.dateISO, []);
    byDate.get(row.dateISO).push(row);
  }

  const unfinished = state.logs.filter((log) => !log.endedAt);

  return `
  <h3 style="margin-top:0">Everything logged</h3>
  <p style="margin:0 2px 12px">Every record the app holds, newest first. Tap an entry to see exactly what is in it,
  to correct it, or to delete it.</p>

  ${
    unfinished.length
      ? flag(
          'warn',
          '!',
          `<b>${unfinished.length} session${unfinished.length === 1 ? '' : 's'} never finished.</b> ${
            unfinished.length === 1 ? 'It counts' : 'They count'
          } towards no rotation and ${
            unfinished.length === 1 ? 'its sets are' : 'their sets are'
          } still in every chart. Open ${
            unfinished.length === 1 ? 'it' : 'them'
          } below to finish or delete.`
        )
      : ''
  }

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
            <div class="car">\u203a</div></div>`
          )
          .join('')}</div>`
          )
          .join('')
      : '<div class="card"><p style="margin:0">Nothing stored under that filter yet.</p></div>'
  }

  <p class="hint" style="margin:14px 2px">${all.length} entries in total. Deleting removes an entry from every
  chart and average straight away, and keeps it in the Bin until you empty it.</p>`;
}

/**
 * Backups. The same export and import that live in Settings, put where the
 * record is — it is the record you are backing up.
 */
function backupsView(state) {
  const last = state.settings.lastBackupISO;
  return `
  <h3 style="margin-top:0">Backups</h3>
  ${
    last
      ? flag('ok', '\u2713', `<b>Last backup ${escape(last)}.</b> Taken from this device, into your downloads.`)
      : flag(
          'warn',
          '!',
          `<b>No backup taken yet.</b> Everything you have logged exists in exactly one place: this browser, on this
           device. A backup is one tap and it is the only thing standing between a cleared browser and starting again.`
        )
  }
  <div class="card">
    <p style="margin:0 0 10px">${state.logs.length} sessions \u00b7 ${state.sets.length} sets \u00b7 ${
    state.daily.length
  } daily \u00b7 ${state.measurements.length} measurements \u00b7 ${state.media.length} media.</p>
    <button class="big" data-act="open-export">Export a zip</button>
    <button class="big ghost mt" data-act="history-backup">Download a plain JSON backup</button>
    <button class="big ghost mt" data-act="pick-import">Import from a zip</button>
    <button class="big ghost mt" data-act="pick-verify">Verify a backup restores</button>
    <input type="file" id="import-file" accept=".zip,application/zip" hidden data-act-file="import">
    <input type="file" id="verify-file" accept=".zip,application/zip" hidden data-act-file="verify">
    <p class="hint">The zip holds CSVs you can open in anything, a lossless <b>data.json</b> for restoring, your plan,
    and your photos as real files.</p>
    <p class="hint"><b>Importing replaces.</b> Every store the backup carries is emptied and refilled from it \u2014 it is a
    restore, not a merge. A safety export of what is here downloads first, automatically.</p>
    <p class="hint">Verify reads a backup and checks it against what is stored, without touching your data \u2014 so you
    find out a backup is broken <b>before</b> you need it, not after.</p>
  </div>`;
}

function binView(state) {
  const deleted = state.deleted || [];
  return `
  <h3 style="margin-top:0">Bin</h3>
  <p style="margin:0 2px 12px">Deleting takes a record out of the way, not out of existence. Everything deleted
  waits here until you empty it, and travels in a backup meanwhile \u2014 so restoring an export restores the bin with it.</p>
  ${
    deleted.length
      ? recoveryList(state)
      : '<div class="card"><p style="margin:0">Nothing has been deleted, so there is nothing here.</p></div>'
  }`;
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

  return `<div class="card flush">${deleted
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
  }${deleted.length > 30 ? ', 30 shown' : ''}. They are excluded from every chart and average.</p>
  <button class="big ghost mt" data-act="empty-bin">Empty the bin — destroy these ${deleted.length}</button>
  <p class="hint">Emptying the bin is the only thing in this app that destroys data.</p>`;
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
    <p style="text-align:center;font-size:12px;color:var(--muted);margin:0 0 10px">${[
      log.cycleSequence ? `rotation ${log.cycleSequence}` : null,
      log.blockId != null ? `block ${log.blockId}` : null,
      log.readiness && log.readiness !== 'normal' ? `<b style="color:var(--warn)">${escape(log.readiness)} day</b>` : null,
      log.effortMode ? `${escape(log.effortMode)} failure` : null,
      log.completionRatio != null ? `${Math.round(log.completionRatio * 100)}% of prescribed` : null,
      log.endedAt ? null : '<b style="color:var(--warn)">never finished</b>',
    ]
      .filter(Boolean)
      .join(' · ')}</p>
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
              const marks = [
                set.isAmrap ? 'AMRAP' : null,
                set.isIndexSet ? 'index' : null,
                set.isMyoRep ? 'myo' : null,
                set.toFailure ? 'to failure' : null,
                set.gripWidth || null,
                set.pauseStyle || null,
              ].filter(Boolean);

              return `<div style="padding:2px 0">${
                set.load == null ? '—' : `${set.bodyweightUsed ? '+' : ''}${fmtLoad(set.load, unit)}`
              } × ${set.reps ?? '—'} @ ${set.rpe ?? '—'}${
                estimate ? ` <span style="color:var(--muted)">(e1RM ${fmtLoad(estimate, unit)})</span>` : ''
              }${
                marks.length
                  ? ` <span style="color:var(--muted);font-variant-numeric:normal">· ${escape(marks.join(' · '))}</span>`
                  : ''
              }${
                /*
                 * The note you typed when you logged the set. It has been
                 * stored since the first version and displayed nowhere at all —
                 * not here, not in the export preview, not on the Train screen
                 * after the fact. Writing something down and never being shown
                 * it again is worse than not offering the field.
                 */
                set.note
                  ? `<div style="color:var(--ink);font-variant-numeric:normal;font-size:12.5px;margin:3px 0 2px;padding-left:9px;border-left:2px solid var(--s1)">${escape(
                      set.note
                    )}</div>`
                  : ''
              }</div>`;
            })
            .join('')}</div></div>`
        )
        .join('')}
    </div>
    <button class="big ghost mt" data-act="repair-session" data-id="${log.id}">Fix something about this session</button>
    <button class="big danger mt" data-act="history-delete" data-key="${escape(row.key)}">Delete this session</button>
    <button class="big ghost mt" data-act="sheet-close">Close</button>`;
}

/**
 * The repair menu.
 *
 * Deleting has been recoverable since v2; editing was not recoverable and
 * mostly was not possible. A session on the wrong day stayed on the wrong day,
 * and the only fix was to delete the whole thing and log it again from memory —
 * which is not a repair, it is a re-enactment.
 */
function repairSheet(ctx, log) {
  const { state } = ctx;
  const sets = state.sets.filter((set) => set.sessionLogId === log.id);
  const date = (log.dateISO || '').slice(0, 10);

  const sameDay = state.logs.filter(
    (other) => other.id !== log.id && (other.dateISO || '').slice(0, 10) === date && other.sessionId === log.sessionId
  );

  return `<div class="ttl">Fix this session</div>
    <p style="text-align:center;font-size:13px;margin:10px 0 12px">${escape(log.sessionId)} \u00b7 ${escape(
      longDate(date)
    )} \u00b7 ${sets.length} sets</p>

    ${
      sameDay.length
        ? flag(
            'warn',
            '!',
            `<b>Logged twice.</b> There ${sameDay.length === 1 ? 'is' : 'are'} ${sameDay.length} other session${
              sameDay.length === 1 ? '' : 's'
            } marked <b>${escape(log.sessionId)}</b> on this date. If one of them is a duplicate, delete it \u2014 it
             goes to the Bin, so a wrong guess costs nothing.`
          )
        : ''
    }

    <div class="mt"><label for="fix-date">The date this was trained</label>
      <input id="fix-date" type="date" value="${escape(date)}">
      <p class="hint">Moves the session and all ${sets.length} of its sets together. They carry their own dates, and a
      session moved without them would sit on one day while its work sat on another.</p></div>
    <button class="big mt" data-act="repair-date" data-id="${log.id}">Move it to that date</button>

    ${
      log.endedAt
        ? `<h3>Finished too early?</h3>
           <button class="big ghost" data-act="repair-reopen" data-id="${log.id}">Reopen and carry on</button>
           <p class="hint">Puts it back as the session in progress so you can log the rest. Only one session can be
           open at a time, so this is refused while another one is.</p>`
        : flag('info', 'i', '<b>This session is still open.</b> It is on the Train screen where you left it.')
    }

    <h3>One set wrong?</h3>
    <p class="hint" style="margin-top:0">Tap a set to change its numbers, its note, or which exercise it was logged
    against \u2014 and to delete just that one. Deleted sets go to the Bin like everything else.</p>
    <div style="max-height:34vh;overflow:auto">${sets
      .slice()
      .sort((a, b) => a.slotIndex - b.slotIndex || a.setIndex - b.setIndex)
      .map((set) => {
        const name = state.plan.exercises[set.exerciseId]?.name || set.exerciseId;
        return `<div class="big-row" data-act="repair-set-open" data-id="${set.id}">
          <div class="ic">${set.setIndex + 1}</div>
          <div class="m"><b>${escape(name)}</b><span>${
            set.load == null ? '\u2014' : fmtLoad(set.load, state.settings.unit)
          } \u00d7 ${set.reps ?? '\u2014'} @ ${set.rpe ?? '\u2014'}${
            set.note ? ` \u00b7 ${escape(set.note)}` : ''
          }</span></div><div class="car">\u203a</div></div>`;
      })
      .join('')}</div>

    <button class="big ghost mt" data-act="sheet-close">Close</button>`;
}

/** One set, editable. */
function repairSetSheet(ctx, set) {
  const { state } = ctx;
  const unit = state.settings.unit;
  const name = state.plan.exercises[set.exerciseId]?.name || set.exerciseId;

  // Every exercise in the plan, so a set logged against the wrong one can be
  // moved to the right one rather than deleted and retyped.
  const options = Object.entries(state.plan.exercises)
    .map(([id, x]) => `<option value="${escape(id)}" ${id === set.exerciseId ? 'selected' : ''}>${escape(x.name)}</option>`)
    .join('');

  return `<div class="ttl">Fix this set</div>
    <p style="text-align:center;font-size:13px;margin:10px 0 12px">${escape(name)} \u00b7 set ${set.setIndex + 1}</p>

    <div class="g3">
      <div><label for="fix-load">Load (${escape(unit)})</label>
        <input id="fix-load" type="number" inputmode="decimal" step="0.5" value="${
          set.load == null ? '' : fmtLoad(set.load, unit)
        }"></div>
      <div><label for="fix-reps">Reps</label>
        <input id="fix-reps" type="number" inputmode="numeric" step="1" value="${set.reps ?? ''}"></div>
      <div><label for="fix-rpe">RPE</label>
        <input id="fix-rpe" type="number" inputmode="decimal" step="0.5" value="${set.rpe ?? ''}"></div>
    </div>

    <div class="mt"><label for="fix-ex">Exercise</label>
      <select id="fix-ex">${options}</select>
      <p class="hint">For a set logged against the wrong lift. The estimate is recomputed from the stored numbers
      every time it is read, so nothing derived needs correcting alongside this.</p></div>

    <div class="mt"><label for="fix-note">Note</label>
      <input id="fix-note" type="text" value="${escape(set.note || '')}" placeholder="What happened on this set"></div>

    <button class="big mt" data-act="repair-set-save" data-id="${set.id}">Save the correction</button>
    <button class="big danger mt" data-act="repair-set-delete" data-id="${set.id}">Delete just this set</button>
    <button class="big ghost mt" data-act="sheet-close">Cancel</button>
    <p class="hint">Every correction is recorded with the field, the old value and the new one.</p>`;
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

  'log-section'(ctx, data) {
    ctx.goTo({ tab: 'log', logSection: data.id });
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

  'repair-session'(ctx, data) {
    const log = ctx.state.logs.find((row) => row.id === Number(data.id));
    if (log) openSheet(repairSheet(ctx, log));
  },

  async 'repair-date'(ctx, data) {
    const dateISO = document.getElementById('fix-date')?.value;
    const result = await ctx.repairSessionDate(Number(data.id), dateISO);
    closeSheet();
    ctx.render();
    openSheet(`<div class="ttl">${result.moved ? 'Moved' : 'Not changed'}</div>
      <p style="text-align:center;font-size:13.5px;margin:14px 0">${
        result.moved
          ? `The session and its ${result.sets} sets moved from ${escape(longDate(result.from))} to ${escape(
              longDate(result.to)
            )}.`
          : 'That is the date it was already on.'
      }</p>
      <button class="big mt" data-act="sheet-close">Close</button>`);
  },

  async 'repair-reopen'(ctx, data) {
    const result = await ctx.reopenSession(Number(data.id));
    closeSheet();
    ctx.render();
    if (!result.ok) {
      openSheet(`<div class="ttl">Not reopened</div>
        <p style="text-align:center;font-size:13.5px;margin:14px 0">${escape(result.reason)}</p>
        <button class="big mt" data-act="sheet-close">Close</button>`);
      return;
    }
    openSheet(`<div class="ttl">Reopened</div>
      <p style="text-align:center;font-size:13.5px;margin:14px 0">Session ${escape(
        result.sessionId
      )} is open again on the Train screen, with everything you had already logged still in it.</p>
      <button class="big mt" data-act="sheet-close">Carry on</button>`);
  },

  'repair-set-open'(ctx, data) {
    const set = ctx.state.sets.find((row) => row.id === Number(data.id));
    if (set) openSheet(repairSetSheet(ctx, set));
  },

  async 'repair-set-save'(ctx, data) {
    const { state } = ctx;
    const num = (id) => {
      const raw = document.getElementById(id)?.value;
      if (raw == null || raw.trim() === '') return null;
      const parsed = Number(raw.replace(',', '.'));
      return Number.isFinite(parsed) ? parsed : null;
    };
    const load = num('fix-load');
    const note = document.getElementById('fix-note')?.value?.trim() || null;

    const result = await ctx.repairSet(Number(data.id), {
      // Typed in whatever unit is on display, stored in kilograms like
      // everything else.
      load: load == null ? null : ctx.toKg(load),
      reps: num('fix-reps'),
      rpe: num('fix-rpe'),
      exerciseId: document.getElementById('fix-ex')?.value,
      note,
    });
    closeSheet();
    ctx.render();
    openSheet(`<div class="ttl">${result.changed ? 'Corrected' : 'Nothing changed'}</div>
      <p style="text-align:center;font-size:13.5px;margin:14px 0">${
        result.changed
          ? `${result.changed} field${result.changed === 1 ? '' : 's'} updated, each one recorded with what it was before.`
          : 'Everything was already as you typed it.'
      }</p>
      <button class="big mt" data-act="sheet-close">Close</button>`);
  },

  async 'repair-set-delete'(ctx, data) {
    await ctx.deleteSet(Number(data.id), { reason: 'corrected from the log' });
    closeSheet();
    ctx.render();
    openSheet(`<div class="ttl">Set deleted</div>
      <p style="text-align:center;font-size:13.5px;margin:14px 0">It is out of every chart and average, and waiting
      in the Bin if you want it back.</p>
      <button class="big mt" data-act="sheet-close">Close</button>`);
  },

  async 'history-delete-confirm'(ctx, data) {
    const row = entries(ctx.state).find((entry) => entry.key === data.key);
    if (!row) return;
    await ctx.deleteEntry(row.kind, row.id);
    closeSheet();
    ctx.render();
  },
};
