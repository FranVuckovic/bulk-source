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

import { e1rm, systemLoad, setDifficulty, noEstimateReason, roughE1rm, roughConfidence } from '../calc.js';
import { sessionTiming, sessionAnalysis } from '../analytics.js';
import { escape, fmtLoad, fmtNum, subnav, flag, openSheet, closeSheet } from './components.js';
import { measurementTimeLabel, scaleLabel, MEASUREMENT_SITES } from './body.js';
import { rowBars, barChart } from './charts.js';

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

/**
 * Every stored thing, flattened into one dated list.
 *
 * `deleted` asks for the soft-deleted rows instead of the live ones. They are
 * the same records — a delete in this app marks a row rather than removing it —
 * so the same shaping applies, and each carries `isDeleted` so a row can say
 * what it is rather than relying on which list it came from.
 */
export function entries(state, { deleted = false } = {}) {
  if (deleted) return deletedEntries(state);
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
        title: `${log.sessionId === 'custom' ? 'Custom' : log.sessionId} · ${
          session ? session.name : log.sessionId === 'custom' ? 'Custom workout' : 'Session'
        }`,
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
      // Keyed by the row, not by the day. Since v4 a day can hold several
      // weigh-ins, and both of these used to be the date: two entries on one
      // day collided on the same key, and `store.get('2026-08-22')` against a
      // store keyed by an auto-increment id matches nothing at all — so
      // deleting one from here threw instead of deleting it.
      key: `daily:${row.id}`,
      id: row.id,
      dateISO: dayOf(row.dateISO),
      title: 'Daily',
      summary: [
        row.bodyweight == null ? null : `${row.bodyweight} kg${scaleLabel(row) ? ` (${scaleLabel(row)})` : ''}`,
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
      key: `measurement:${row.id}`,
      id: row.id,
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

/**
 * The bin's contents, shaped like ordinary entries so one list can show both.
 *
 * `state.deleted` is what `deletedRecords` returns: the store it came from, its
 * key, when it was deleted, and the row itself.
 */
function deletedEntries(state) {
  const KIND_OF = { sessionLogs: 'session', daily: 'daily', measurements: 'measurement', niggles: 'niggle', media: 'media', sets: 'set' };

  return (state.deleted || [])
    .map((entry) => {
      const row = entry.row || {};
      const kind = KIND_OF[entry.store] || entry.store;
      const session = kind === 'session' ? state.plan.sessions.find((s) => s.id === row.sessionId) : null;
      const exercise = kind === 'set' ? state.plan.exercises[row.exerciseId] : null;

      const title =
        kind === 'session'
          ? `${row.sessionId === 'custom' ? 'Custom' : row.sessionId ?? '—'} · ${
              session ? session.name : row.sessionId === 'custom' ? 'Custom workout' : 'Session'
            }`
          : kind === 'set'
            ? `Set · ${exercise?.name || row.exerciseId || '—'}`
            : kind === 'measurement'
              ? 'Measurements'
              : kind === 'niggle'
                ? `Niggle · ${row.site ?? ''}`
                : kind === 'media'
                  ? row.kind === 'physique' ? 'Physique photo' : 'Form check'
                  : 'Daily';

      return {
        kind,
        key: `deleted:${entry.store}:${entry.id}`,
        id: entry.id,
        store: entry.store,
        isDeleted: true,
        deletedAtISO: entry.deletedAtISO,
        dateISO: dayOf(row.dateISO || row.localDate || entry.deletedAtISO),
        title,
        summary: `deleted ${dayOf(entry.deletedAtISO)}${
          row.bodyweight != null ? ` · ${fmtNum(row.bodyweight, 1)} kg` : ''
        }${row.waist != null ? ` · waist ${row.waist}` : ''}`,
        record: row,
        sets: [],
      };
    })
    .sort((a, b) => b.deletedAtISO.localeCompare(a.deletedAtISO));
}

export function view(ctx) {
  const { state } = ctx;
  const section = state.logSection || 'entries';
  const tabs = subnav(SECTIONS(state), section, 'log-section');

  // The session screen replaces the tabs rather than sitting under them: it is
  // one thing looked at closely, not a fourth tab you switch between.
  if (section === 'session') return sessionScreen(ctx);
  if (section === 'backups') return tabs + backupsView(state);
  if (section === 'bin') return tabs + binView(state);
  return tabs + entriesView(state);
}

function entriesView(state) {
  const filter = state.historyFilter || 'all';
  // `active` and `deleted` are a different axis from the kind filter: one says
  // which sort of record, the other says whether it is still live. Kept
  // separate so you can ask for "deleted measurements" and get them.
  const status = state.historyStatus || 'active';
  const all = entries(state, { deleted: status === 'deleted' });
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

  <div class="filterset">
    <span class="filterlab">Show</span>
    <div class="picker">
      <button class="pill ${status === 'active' ? 'on' : ''}" data-act="history-status" data-id="active">Active</button>
      <button class="pill ${status === 'deleted' ? 'on' : ''}" data-act="history-status" data-id="deleted">Deleted${
        (state.deleted || []).length ? ` · ${(state.deleted || []).length}` : ''
      }</button>
    </div>
  </div>

  <div class="filterset">
    <span class="filterlab">Of what kind</span>
    <div class="picker">${KINDS.map(
    ([id, label]) =>
      `<button class="pill ${filter === id ? 'on' : ''}" data-act="history-filter" data-id="${id}">${escape(
        label
      )}</button>`
  ).join('')}</div>
  </div>

  ${
    status === 'deleted'
      ? flag(
          'info',
          'i',
          `<b>Showing deleted entries.</b> They are excluded from every chart and average, and stay here until you
           empty the Bin. Tap one to put it back.`
        )
      : ''
  }

  ${
    shown.length
      ? [...byDate.entries()]
          .map(
            ([date, rows]) => `<h3>${escape(longDate(date))}</h3>
        <div class="card flush">${rows
          .map(
            (row) =>
              row.isDeleted
                ? `<div class="big-row" style="cursor:default"><div class="ic">\u21ba</div>
                    <div class="m"><b>${escape(row.title)}</b><span>${escape(row.summary)}</span></div>
                    <button class="setok" data-act="history-restore" data-store="${escape(
                      row.store
                    )}" data-id="${escape(String(row.id))}" aria-label="Restore">\u21ba</button></div>`
                : `<div class="big-row" data-act="history-open" data-key="${escape(row.key)}">
            <div class="ic">${escape(row.kind === 'session' ? row.title.slice(0, 1) : row.kind.slice(0, 1).toUpperCase())}</div>
            <div class="m"><b>${escape(row.title)}</b><span>${escape(row.summary)}</span></div>
            <div class="car">\u203a</div></div>`
          )
          .join('')}</div>`
          )
          .join('')
      : `<div class="card"><p style="margin:0">${
          status === 'deleted' ? 'Nothing deleted under that filter.' : 'Nothing stored under that filter yet.'
        }</p></div>`
  }

  <p class="hint" style="margin:14px 2px">${all.length} ${status === 'deleted' ? 'deleted' : ''} entries in total. Deleting removes an entry from every
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
    ${timingSection(ctx, log, row.sets)}
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

    <div class="mt"><label for="fix-rotation">The rotation it belongs to</label>
      <input id="fix-rotation" type="number" min="1" max="${state.plan.meta.rotations}" value="${escape(
        String(log.cycleSequence ?? state.cycle.sequence)
      )}">
      <p class="hint">A session trained after a rotation finished, but before the plan was moved on, is filed against
      the rotation that had already finished. Moving it changes only which rotation it counts towards — every set
      stays exactly as logged.</p></div>
    <button class="big mt" data-act="repair-rotation" data-id="${log.id}">Move it to that rotation</button>

    ${startRepair(ctx, log)}

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

/** Offer to move a start time that plainly predates the training. */
function startRepair(ctx, log) {
  const sets = ctx.state.sets.filter((set) => set.sessionLogId === log.id);
  const t = sessionTiming(log, sets);
  if (!t.startLooksWrong) return '';

  return `<h3>Started too early?</h3>
    ${flag(
      'warn',
      '!',
      `This session says it began <b>${Math.round(t.startedBeforeFirstSetSeconds / 60)} minutes</b> before its first
       set, which makes every duration it reports wrong. Moving the start to the first set makes it
       <b>${escape(clock(t.workingSpanSeconds))}</b>.`
    )}
    <button class="big ghost" data-act="repair-start" data-id="${log.id}">Move the start to the first set</button>
    <p class="hint">Only the start instant changes. No set is touched, and the correction is recorded like every
    other.</p>`;
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

/** A duration a person would say out loud: 45s, 7m 28s, 2h 44m. */
const clock = (seconds) => {
  if (seconds == null) return '\u2014';
  const value = Math.round(seconds);
  if (value < 60) return `${value}s`;
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (hours) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${minutes}m ${String(value % 60).padStart(2, '0')}s`;
};

const timeOfDay = (iso) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/* ═══════════════════════════════════════════════════════════════════════
   One session, looked at closely
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * The whole of one workout: what it cost, where the work went, what the rests
 * looked like, every set with its own numbers, and what changed since the last
 * time you did this session.
 *
 * Everything here is derived from rows the app already stored. Nothing new had
 * to be recorded to answer any of it — it was simply never asked.
 */
function sessionScreen(ctx) {
  const { state } = ctx;
  const log = state.logs.find((row) => row.id === state.logSessionId);
  if (!log) {
    return `<button class="back" data-act="log-section" data-id="entries">\u2039 The log</button>
      <div class="card"><p style="margin:0">That session is no longer here. It may have been deleted \u2014 the Bin
      will have it.</p></div>`;
  }

  const unit = state.settings.unit;
  const sets = state.sets.filter((set) => set.sessionLogId === log.id);
  const session = state.plan.sessions.find((s) => s.id === log.sessionId);
  const a = sessionAnalysis(log, sets, {
    exercises: state.plan.exercises,
    logs: state.logs,
    allSets: state.sets,
  });
  const t = sessionTiming(log, sets);
  // A start instant that predates the training makes the raw span nonsense, so
  // the header shows what the work actually occupied and the Timing card
  // explains the difference. See `startLooksWrong`.
  const durationSeconds = t.startLooksWrong ? t.workingSpanSeconds : t.totalSeconds;
  const minutes = durationSeconds != null ? Math.round(durationSeconds / 60) : minutesBetween(log.startedAt, log.endedAt);
  const notes = log.deviations?.exerciseNotes || {};

  const tile = (value, label) => `<div class="tstat"><b>${escape(String(value))}</b><span>${escape(label)}</span></div>`;

  return `
  <button class="back" data-act="log-section" data-id="entries">\u2039 The log</button>

  <div class="shead">
    <div class="lbl">${escape(longDate(log.dateISO))}${
      log.readiness && log.readiness !== 'normal' ? ` \u00b7 ${escape(log.readiness)} day` : ''
    }</div>
    <div class="nm">${escape(log.sessionId === 'custom' ? 'Custom' : log.sessionId)} \u00b7 ${escape(
      session ? session.name : log.sessionId === 'custom' ? 'Custom workout' : 'Session'
    )}</div>
    <div class="meta">
      <span>rotation ${log.cycleSequence ?? '\u2014'}</span>
      ${minutes ? `<span>${minutes} min${t.startLooksWrong ? ' of work' : ''}</span>` : ''}
      ${log.sessionRpe ? `<span>sRPE ${log.sessionRpe}</span>` : ''}
      ${log.bodyweight ? `<span>${fmtLoad(log.bodyweight, unit)} ${escape(unit)}</span>` : ''}
      ${log.endedAt ? '' : '<span style="color:var(--warn)">never finished</span>'}
    </div>
  </div>

  ${log.note ? `<div class="cue" style="margin-bottom:11px">${escape(log.note)}</div>` : ''}

  <div class="card"><div class="g2">
    ${tile(`${Math.round(a.tonnage).toLocaleString('en-GB')} ${unit}`, 'total load moved')}
    ${tile(a.reps, 'reps')}
  </div><div class="g2 mt">
    ${tile(`${a.workingSets}${log.prescribedSets ? ` / ${log.prescribedSets}` : ''}`, 'sets logged')}
    ${tile(a.failureSets, 'to failure')}
  </div>
  <p class="hint" style="margin:9px 0 0">Load moved counts bodyweight on pull-ups and dips, because your muscles
  did. It is exact arithmetic on what you logged, not an estimate.</p></div>

  <h3>Where the work went</h3>
  <div class="card">${rowBars(
    a.exercises.map((e) => ({
      label: e.name.split(' (')[0].split(' \u2014 ')[0],
      value: Math.round(e.tonnage),
      display: `${Math.round(e.tonnage).toLocaleString('en-GB')}`,
    })),
    { unit, caption: `Load moved per exercise, in ${unit} \u2014 sets \u00d7 reps \u00d7 weight.` }
  )}</div>

  ${restSection(t)}

  ${timingSection(ctx, log, sets)}

  <h3>Every set</h3>
  ${a.exercises
    .map((entry) => {
      const slotIndex = entry.sets[0]?.slotIndex;
      const note = notes[String(slotIndex)];
      return `<div class="card">
        <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:2px">
          <b style="font-size:14.5px;flex:1">${escape(entry.name)}</b>
          <span style="font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums">${Math.round(
            entry.tonnage
          )} ${escape(unit)}</span></div>
        ${note ? `<div class="exnote" style="margin:6px 0 8px">${escape(note)}</div>` : ''}
        ${setLines(state, entry, unit)}
        ${
          entry.bestEstimate
            ? `<p class="hint" style="margin:8px 0 0">Best estimate this session <b>${fmtLoad(
                entry.bestEstimate,
                unit
              )} ${escape(unit)}</b>${
                entry.bestDifficulty
                  ? ` \u00b7 hardest set worth <b>${fmtLoad(entry.bestDifficulty, unit)} ${escape(unit)}</b>`
                  : ''
              }</p>`
            : ''
        }
      </div>`;
    })
    .join('')}

  ${comparisonSection(a.previous, unit)}

  <button class="big ghost mt" data-act="repair-session" data-id="${log.id}">Fix something about this session</button>
  <button class="big danger mt" data-act="history-delete" data-key="session:${log.id}">Delete this session</button>`;
}

/** Every set of one exercise, with what each was worth. */
function setLines(state, entry, unit) {
  return entry.sets
    .slice()
    .sort((a, b) => (a.setIndex ?? 0) - (b.setIndex ?? 0))
    .map((set) => {
      const total = systemLoad(set.load, set.bodyweightUsed || 0);
      const estimate = set.reps ? e1rm(total, set.reps, Math.min(10, set.rpe ?? 8)) : null;
      const hard = set.reps ? setDifficulty(total, set.reps) : null;
      const why = estimate == null ? noEstimateReason(total, set.reps, Math.min(10, set.rpe ?? 8), { short: true }) : null;
      const rough = estimate == null ? roughE1rm(total, set.reps, Math.min(10, set.rpe ?? 8)) : null;

      const marks = [
        set.isAmrap ? 'AMRAP' : null,
        set.isIndexSet ? 'index' : null,
        set.isMyoRep ? 'myo' : null,
        set.toFailure ? 'to failure' : null,
        set.pauseStyle || null,
        set.gripWidth || null,
      ].filter(Boolean);

      return `<div class="setline">
        <span class="n">${(set.setIndex ?? 0) + 1}</span>
        <span class="w">${set.bodyweightUsed ? '+' : ''}${fmtLoad(set.load, unit)} \u00d7 ${set.reps ?? '\u2014'} @ ${
          set.rpe ?? '\u2014'
        }</span>
        <span class="e">${
          estimate
            ? `${fmtLoad(estimate, unit)}<small> e1RM</small> \u00b7 ${fmtLoad(hard, unit)}<small> diff</small>`
            : rough
              ? `~${fmtLoad(rough, unit)}<small> ${escape(roughConfidence(set.reps))}</small>`
              : `<small style="color:var(--muted)">no estimate \u00b7 ${escape(why || '')}</small>`
        }</span>
        ${marks.length ? `<span class="m">${escape(marks.join(' \u00b7 '))}</span>` : ''}
        ${set.note ? `<span class="nt">${escape(set.note)}</span>` : ''}
      </div>`;
    })
    .join('');
}

/** How long the rests actually were, when the clock can be believed. */
function restSection(t) {
  if (!t.reliable || t.countedRests < 2) return '';
  const gaps = t.entries.filter((entry) => !entry.isFirst && !entry.isLongGap && entry.gapSeconds != null);
  return `<h3>Rest between sets</h3>
  <div class="card">${barChart(
    gaps.map((entry, i) => ({ label: String(i + 1), value: Math.round(entry.gapSeconds / 6) / 10 })),
    { unit: ' min', average: true }
  )}
  <p class="hint">Every gap between one set and the next, in minutes, in the order they happened. The dashed line is
  the average. Gaps over twenty minutes are left out — those are interruptions, not rest intervals.</p></div>`;
}

/** What changed since the last time this session was trained. */
function comparisonSection(previous, unit) {
  if (!previous || !previous.rows.length) {
    return `<h3>Compared with last time</h3>
      <div class="card"><p style="margin:0">No earlier session with this letter to compare against yet. From the
      next one, this is where the change on every lift appears.</p></div>`;
  }
  return `<h3>Compared with last time</h3>
  <div class="card">
    <p style="margin:0 0 10px">Against <b>${escape(longDate(previous.dateISO))}</b>, ${previous.daysBefore} day${
      previous.daysBefore === 1 ? '' : 's'
    } earlier. Change in the heaviest set of each lift.</p>
    ${rowBars(
      previous.rows.map((row) => {
        const change = Math.round(row.topLoadChange * 10) / 10;
        return {
          label: row.name.split(' (')[0].split(' \u2014 ')[0],
          value: change,
          display: `${change > 0 ? '+' : ''}${change}`,
        };
      }),
      { unit }
    )}
  </div>`;
}

/**
 * What the session actually looked like in time.
 *
 * Every set has stored the moment it was ticked since the first version and
 * nothing ever read it back. This is that data, finally shown: when each set
 * went in, how long since the one before it, and what the whole thing took.
 *
 * It declines to draw conclusions when it should. A session logged from memory
 * afterwards has ticks seconds apart, and "8s rest" from that is not a
 * measurement — it is an artefact that looks like one. The report says so and
 * stops, whether you told it or it worked it out from the gaps.
 */
function timingSection(ctx, log, sets) {
  const t = sessionTiming(log, sets);
  if (!t.setCount) return '';

  const timeline = t.entries
    .map((entry) => {
      const name = ctx.state.plan.exercises[entry.exerciseId]?.name || entry.exerciseId;
      return `<div class="tl-row${entry.isLongGap ? ' gap' : ''}">
        <span class="t">${escape(timeOfDay(entry.atISO))}</span>
        <span class="n">${escape(name.split(' (')[0])}</span>
        <span class="r">${entry.isFirst ? 'start' : escape(clock(entry.gapSeconds))}</span></div>`;
    })
    .join('');

  /*
   * A start instant that plainly predates the training. The log opens on the
   * first thing you do, and un-ticking a set deletes the set but not the log —
   * so a tap that was undone can stamp the start hours early and make every
   * duration derived from it wrong. Reported rather than quietly corrected:
   * which instant is right is the owner's to say.
   */
  const startWarning = t.startLooksWrong
    ? flag(
        'warn',
        '!',
        `<b>Opened ${Math.round(t.startedBeforeFirstSetSeconds / 60)} minutes before its first set.</b>
         The work itself spanned <b>${escape(clock(t.workingSpanSeconds))}</b>, first set to last, and that is the
         figure shown. <b>Fix something about this session</b> below can move the start to the first set.`
      )
    : '';

  if (!t.reliable) {
    return `<h3>Timing</h3>
      <div class="card">
        ${startWarning}
        ${flag(
          'warn',
          '!',
          t.statedUnreliable
            ? `<b>Marked as logged after the fact.</b> The times below are when the rows were filled in, not when the
               work happened, so no rest or duration is reported from them. Everything else about this session is
               exactly as it was.`
            : `<b>These look like they were filled in together.</b> Most of the gaps are under
               ${escape(String(20))} seconds, which is not rest between working sets. Rest and duration are not
               reported rather than reported wrongly.`
        )}
        <div class="timeline">${timeline}</div>
      </div>`;
  }

  return `<h3>Timing</h3>
    <div class="card">
      ${startWarning}
      <div class="g3">
        <div class="tstat"><b>${escape(clock(t.startLooksWrong ? t.workingSpanSeconds : t.totalSeconds))}</b><span>${
          t.startLooksWrong ? 'first to last' : 'total'
        }</span></div>
        <div class="tstat"><b>${escape(clock(t.medianRestSeconds))}</b><span>typical rest</span></div>
        <div class="tstat"><b>${escape(clock(t.longestRestSeconds))}</b><span>longest rest</span></div>
      </div>
      <div class="timeline mt">${timeline}</div>
      <p class="hint">Time of day, exercise, and the gap since the previous set. ${
        t.countedRests
          ? `${t.countedRests} gap${t.countedRests === 1 ? '' : 's'} counted as rest.`
          : 'Not enough gaps to call anything typical.'
      }${
        t.longGaps
          ? ` ${t.longGaps} gap${t.longGaps === 1 ? '' : 's'} over 20 minutes ${
              t.longGaps === 1 ? 'is' : 'are'
            } shown but left out of the rest figures — that is a queue or an interruption, not a rest interval.`
          : ''
      }</p>
    </div>`;
}

/**
 * What a replacement replaced.
 *
 * `daily` and `measurements` are keyed by their date, so writing the same day
 * twice replaces the row. That is right — a weigh-in you re-enter is the same
 * weigh-in — but the previous numbers used to disappear with nothing to notice
 * them by. They are kept now, and this is where you read them.
 */
function replacedValues(state, row) {
  const store = { daily: 'daily', measurement: 'measurements', niggle: 'niggles', media: 'media' }[row.kind];
  if (!store) return '';

  // Entries written before v4 are filed under the date, and everything since
  // under the row id. Both are this row's history.
  const identities = [row.record.id, row.record.dateISO].filter((value) => value != null);
  const history = (state.auditLog || [])
    .filter(
      (entry) =>
        ['overwrite', 'edit'].includes(entry.action) &&
        entry.entity === store &&
        identities.includes(entry.entityId)
    )
    .sort((a, b) => b.atISO.localeCompare(a.atISO));
  if (!history.length) return '';

  return `<details class="card" style="margin-top:12px"><summary>Earlier values · ${history.length}</summary><div class="c">
    <p class="hint" style="margin:0 0 8px">Every time this entry was changed, and what it held before.</p>
    ${history
      .map(
        (entry) => `<div style="margin:0 0 10px">
          <b style="font-size:12.5px">${entry.action === 'edit' ? 'Edited' : 'Written over'} on ${escape(
            longDate(entry.atISO.slice(0, 10))
          )}</b>
          <table><tbody>${Object.entries(entry.previous || {})
            .map(([field, value]) => `<tr><td>${escape(field)}</td><td>${escape(value)}</td></tr>`)
            .join('')}</tbody></table></div>`
      )
      .join('')}
  </div></details>`;
}

export function plainDetail(state, row) {
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
    ${replacedValues(state, row)}
    ${
      EDITABLE[row.kind]
        ? `<button class="big mt" data-act="history-edit" data-key="${escape(row.key)}">Edit this entry</button>`
        : ''
    }
    <button class="big danger mt" data-act="history-delete" data-key="${escape(row.key)}">Delete this entry</button>
    <button class="big ghost mt" data-act="sheet-close">Close</button>`;
}

/* ═══════════════════════════════════════════════════════════════════════
   Editing an entry
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Which entries can be corrected here, and what they are made of.
 *
 * Only the body entries. A session is not edited from a sheet — it has its own
 * screen, where the sets, the date and the start time each have their own
 * repair with their own explanation, because getting one of those wrong means
 * something different every time.
 */
const EDITABLE = {
  daily: {
    store: 'daily',
    what: 'weigh-in',
    fields: [
      ['bodyweight', 'Bodyweight', 'kg'],
      ['bodyfatPct', 'Body fat', '%'],
      ['sleepHours', 'Sleep', 'h'],
      ['steps', 'Steps', ''],
    ],
  },
  measurement: {
    store: 'measurements',
    what: 'set of measurements',
    fields: MEASUREMENT_SITES.map(([key, label]) => [key, label, 'cm']),
  },
};

/**
 * The correction form.
 *
 * Every field the entry can hold, filled in with what it holds now — including
 * the blank ones, because "I forgot to write my neck down" is as much a
 * correction as "I typed 9.2 for 92". The date is editable too: the whole
 * reason this screen exists is that a reading once landed on the wrong day.
 *
 * Nothing here writes. The button leads to a confirmation that shows exactly
 * what is about to change, and that confirmation is what writes.
 */
export function editSheet(state, row) {
  const spec = EDITABLE[row.kind];
  if (!spec) return plainDetail(state, row);
  const value = (key) => {
    const held = row.record[key];
    return held == null || held === '' ? '' : String(held);
  };

  return `<div class="ttl">Edit this ${escape(spec.what)}</div>
    <p class="hint" style="text-align:center;margin:8px 0 14px">Logged on ${escape(longDate(row.dateISO))}. Change
    what is wrong and leave the rest alone — nothing is saved until you confirm it.</p>

    <label class="editf wide"><span>Date</span>
      <input type="date" data-edit-field="dateISO" value="${escape(value('dateISO'))}"></label>

    <div class="editgrid">${spec.fields
      .map(
        ([key, label, unit]) => `<label class="editf"><span>${escape(label)}${
          unit ? ` <i>${escape(unit)}</i>` : ''
        }</span>
        <input type="number" inputmode="decimal" step="0.1" data-edit-field="${escape(key)}" value="${escape(
          value(key)
        )}"></label>`
      )
      .join('')}</div>

    <label class="editf wide"><span>Note</span>
      <input type="text" data-edit-field="note" value="${escape(value('note'))}"></label>

    <button class="big mt" data-act="history-edit-review" data-key="${escape(row.key)}">Review the change</button>
    <button class="big ghost mt" data-act="history-open" data-key="${escape(row.key)}">Cancel</button>`;
}

/** What the form currently holds, as a patch against the row. */
function readEditForm(row) {
  const spec = EDITABLE[row.kind];
  const patch = {};
  for (const input of document.querySelectorAll('[data-edit-field]')) {
    const key = input.dataset.editField;
    const raw = input.value.trim();
    if (key === 'dateISO' || key === 'note') {
      patch[key] = raw === '' ? null : raw;
      continue;
    }
    if (!spec.fields.some(([field]) => field === key)) continue;
    patch[key] = raw === '' ? null : Number(raw);
  }
  return patch;
}

/** Only what actually differs, so the confirmation is about the change itself. */
function diffOf(row, patch) {
  return Object.entries(patch)
    .filter(([key, next]) => {
      const held = row.record[key] ?? null;
      const value = next ?? null;
      return String(held) !== String(value);
    })
    .map(([key, next]) => ({ key, from: row.record[key] ?? null, to: next ?? null }));
}

export const actions = {
  /*
   * A session gets a screen, not a sheet. There is too much worth seeing about
   * one — where the work went, what the rests looked like, how it compares with
   * the last time — to fit in a panel you have to scroll inside a page you are
   * already scrolling. Everything else is still a sheet, because everything
   * else really is a handful of fields.
   */
  'history-open'(ctx, data) {
    const row = entries(ctx.state).find((entry) => entry.key === data.key);
    if (!row) return;
    if (row.kind !== 'session') {
      openSheet(plainDetail(ctx.state, row));
      return;
    }
    ctx.state.logSessionId = row.id;
    ctx.goTo({ tab: 'log', logSection: 'session' });
  },

  /* ── Correcting an entry, in three deliberate steps ──────────────────
     open the form → review exactly what changes → write it. The middle step
     is not decoration: overwriting a logged measurement without being asked
     is what destroyed the 20 August readings. */

  'history-edit'(ctx, data) {
    const row = entries(ctx.state).find((entry) => entry.key === data.key);
    if (row) openSheet(editSheet(ctx.state, row));
  },

  'history-edit-review'(ctx, data) {
    const row = entries(ctx.state).find((entry) => entry.key === data.key);
    if (!row) return;
    const patch = readEditForm(row);
    const changes = diffOf(row, patch);

    if (!changes.length) {
      openSheet(`<div class="ttl">Nothing changed</div>
        <p style="text-align:center;font-size:13.5px;margin:14px 0">Every field still holds what it held before, so
        there is nothing to save.</p>
        <button class="big mt" data-act="history-edit" data-key="${escape(row.key)}">Back to the form</button>
        <button class="big ghost mt" data-act="sheet-close">Close</button>`);
      return;
    }

    const show = (value) => (value == null || value === '' ? '<i>blank</i>' : escape(String(value)));
    openSheet(`<div class="ttl">Save this change?</div>
      <p style="text-align:center;font-size:13.5px;margin:12px 0 4px">This rewrites the ${escape(
        EDITABLE[row.kind].what
      )} logged on ${escape(longDate(row.dateISO))}.</p>
      <p class="hint" style="text-align:center;margin:0 0 12px">${changes.length} field${
        changes.length === 1 ? '' : 's'
      } will change. What is there now is kept in this entry's history, so this is reversible.</p>
      <table><tbody>${changes
        .map(
          (change) =>
            `<tr><td>${escape(change.key)}</td><td>${show(change.from)} → <b>${show(change.to)}</b></td></tr>`
        )
        .join('')}</tbody></table>
      <button class="big mt" data-act="history-edit-save" data-key="${escape(row.key)}" data-patch="${escape(
        JSON.stringify(patch)
      )}">Yes, save it</button>
      <button class="big ghost mt" data-act="history-edit" data-key="${escape(row.key)}">Back to the form</button>`);
  },

  async 'history-edit-save'(ctx, data) {
    const row = entries(ctx.state).find((entry) => entry.key === data.key);
    if (!row) return;
    const spec = EDITABLE[row.kind];
    // Returned, not fired and forgotten: a write that fails has to reach the
    // central handler and be shown, or a correction silently does not land.
    const result = await ctx.editEntry(spec.store, row.id, JSON.parse(data.patch));
    ctx.render();
    openSheet(`<div class="ttl">Saved</div>
      <p style="text-align:center;font-size:13.5px;margin:14px 0">${
        result?.changed?.length
          ? `${result.changed.length} field${result.changed.length === 1 ? '' : 's'} updated: ${escape(
              result.changed.map((change) => change.field).join(', ')
            )}. The previous values are kept in this entry's history.`
          : 'Nothing needed changing.'
      }</p>
      <button class="big mt" data-act="sheet-close">Close</button>`);
  },

  'history-filter'(ctx, data) {
    ctx.state.historyFilter = data.id;
    ctx.render();
    window.scrollTo(0, 0);
  },

  'history-status'(ctx, data) {
    ctx.state.historyStatus = data.id;
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

  async 'repair-rotation'(ctx, data) {
    const to = document.getElementById('fix-rotation')?.value;
    const result = await ctx.moveSessionToCycle(Number(data.id), Number(to));
    closeSheet();
    ctx.render();
    openSheet(`<div class="ttl">${result.moved ? 'Moved' : 'Not changed'}</div>
      <p style="text-align:center;font-size:13.5px;margin:14px 0">${
        result.moved
          ? `Session ${escape(String(result.sessionId))} now counts towards <b>rotation ${result.to}</b>${
              result.from ? `, not rotation ${result.from}` : ''
            }. Its sets are untouched.`
          : escape(result.reason || 'Nothing to do.')
      }</p>
      <button class="big mt" data-act="sheet-close">Close</button>`);
  },

  async 'repair-start'(ctx, data) {
    const result = await ctx.repairSessionStart(Number(data.id));
    closeSheet();
    ctx.render();
    openSheet(`<div class="ttl">${result.moved ? 'Start corrected' : 'Not changed'}</div>
      <p style="text-align:center;font-size:13.5px;margin:14px 0">${
        result.moved
          ? `The session now starts at its first set. It reports ${escape(clock(result.spanSeconds))} instead of ${escape(
              clock(result.wasSeconds)
            )}.`
          : 'There was nothing to move it to.'
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
