/**
 * ui/settings.js — units, load increment, bodyweight, storage health, privacy
 * and the erase-everything button.
 *
 * The kg/lb toggle is a rendering transform and nothing else. Data is stored in
 * kilograms whatever this says, so switching back and forth cannot introduce
 * rounding drift into a single stored number.
 */

import { escape, fmtNum, toDisplay, flag, deviceIsolationNote, openSheet, closeSheet } from './components.js';

const bytes = (n) =>
  n == null ? '—' : n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(0)} MB` : `${(n / 1e3).toFixed(0)} KB`;

export function view(ctx) {
  const { state } = ctx;
  const unit = state.settings.unit;

  const storage = state.storage.persisted
    ? flag('ok', '✓', "<b>Persistent storage granted.</b> The browser will not evict this app's data to reclaim space.")
    : flag(
        'warn',
        '!',
        `<b>Persistent storage not granted.</b> ${
          state.storage.supported
            ? 'Install the app to your home screen and it is usually granted automatically. Until then, export regularly.'
            : 'This browser does not support it. Export regularly.'
        }`
      );

  const integrity = state.integrity?.ok
    ? flag('ok', '✓', '<b>Database readable and consistent.</b> Checked at launch, every launch.')
    : flag('bad', '!', `<b>Data integrity problem.</b> ${escape((state.integrity?.problems || []).join('; '))}`);

  const backup = state.settings.lastBackupISO
    ? flag('ok', '✓', `<b>Last backup ${escape(state.settings.lastBackupISO)}.</b>`)
    : flag('warn', '!', '<b>No backup taken yet.</b> Export lands in the next stage; until then the data lives in one browser on one device.');

  return `
  <button class="back" data-act="tab" data-tab="train">‹ Back</button>

  <h3 style="margin-top:0">Units</h3>
  <div class="card"><div class="seg">
    <button class="${unit === 'kg' ? 'on' : ''}" data-act="unit" data-id="kg">Kilograms</button>
    <button class="${unit === 'lb' ? 'on' : ''}" data-act="unit" data-id="lb">Pounds</button></div>
    <p class="hint">Changes every number in the app, everywhere, instantly. <b>Data is always stored in kg</b> — this is a display setting only, so switching back and forth can never corrupt anything or introduce rounding drift.</p>

    <div class="mt"><label for="inc">Load increment</label>
      <select id="inc" data-act-change="increment">
        ${[2.5, 1, 5]
          .map(
            (i) =>
              `<option value="${i}" ${state.settings.increment === i ? 'selected' : ''}>${i.toFixed(1)} kg${
                i === 2.5 ? ' (standard plates)' : i === 1 ? ' (micro-plates)' : ''
              }</option>`
          )
          .join('')}
      </select>
      <p class="hint">Prescribed loads round to this. The effective RPE after rounding is always shown, so the deviation is visible rather than hidden.</p></div>

    <div class="mt"><label for="bw">Bodyweight for pull-ups and dips (${unit})</label>
      <input id="bw" type="number" inputmode="decimal" step="0.5" value="${fmtNum(
        toDisplay(state.settings.bodyweight, unit),
        1
      )}" data-act-change="bodyweight">
      <p class="hint">Pull-ups, chin-ups and dips lift your bodyweight plus whatever is on the belt, so this is part of every percentage, RPE and e1RM on those lifts. It is one deliberate number rather than the daily weigh-in — otherwise a 0.4 kg fluctuation would move every prescription.</p></div>
  </div>

  <h3>Your data</h3>
  <div class="card">
    ${storage}
    ${integrity}
    ${backup}
    <p class="hint">${state.logs.length} sessions · ${state.sets.length} sets · ${state.daily.length} daily entries · ${
      state.measurements.length
    } measurements · ${state.media.length} media · ${bytes(state.storage.usage)} used${
      state.storage.quota ? ` of ${bytes(state.storage.quota)} available` : ''
    }</p>
    <button class="big mt" data-act="open-export">Export a zip</button>
    <button class="big ghost mt" data-act="pick-import">Import from a zip</button>
    <button class="big ghost mt" data-act="pick-verify">Verify a backup restores</button>
    <button class="big ghost mt" data-act="history-backup">Download a plain JSON backup</button>
    <input type="file" id="import-file" accept=".zip,application/zip" hidden data-act-file="import">
    <input type="file" id="verify-file" accept=".zip,application/zip" hidden data-act-file="verify">
    <p class="hint">The zip holds CSVs you can open in anything, a lossless <b>data.json</b> for restoring, your plan,
    and your photos as real files. It is also how data moves between your phone and your laptop.</p>
    <p class="hint">Verify reads a backup and checks it against what is stored, without touching your data — so you
    find out a backup is broken <b>before</b> you need it, not after.</p>
  </div>

  <h3>Privacy &amp; permissions</h3>
  <div class="card">
    ${flag('ok', '✓', '<b>No network access.</b> The app makes zero requests. It cannot phone home because there is nothing to phone.')}
    ${flag('ok', '✓', '<b>No account, no login, no analytics.</b> Your data never leaves the device unless you export it yourself.')}
    ${flag(
      'ok',
      '✓',
      '<b>No permissions requested.</b> Adding photos goes through the standard file picker, which grants access to the one file you pick and nothing else. No camera, no location, no contacts.'
    )}
    <p class="hint">If the app ever asks for a permission, something is wrong — that is a good rule to hold it to.</p>
  </div>

  <h3>Danger zone</h3>
  <div class="card">
    <button class="big ghost" data-act="empty-bin">Empty the bin${
      state.deleted?.length ? ` · ${state.deleted.length}` : ''
    }</button>
    <p class="hint">${
      state.deleted?.length
        ? `Destroys the ${state.deleted.length} record${
            state.deleted.length === 1 ? '' : 's'
          } currently in the recovery list at the bottom of History. Everything else is untouched.`
        : 'Nothing is waiting in the recovery list. Deleted entries land there first and can be put back until this is used.'
    }</p>
    <button class="big danger mt" data-act="erase">Erase all data</button>
    <p class="hint">Requires typing ERASE. Everything logged goes: sessions, sets, weigh-ins, measurements, photos and maxes. The plan file is untouched.</p></div>

  <h3>Where this data lives</h3>
  <div class="card">
    ${deviceIsolationNote()}
  </div>

  <h3>About</h3>
  <div class="card">
    <p style="margin:0 0 2px;font-size:22px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums">${escape(
      state.buildVersion || 'not cached'
    )}${
      state.updateVersion && state.updateVersion !== state.buildVersion
        ? ` <span style="color:var(--s1);font-size:15px;font-weight:700">→ ${escape(state.updateVersion)}</span>`
        : ''
    }</p>
    <p style="margin:0 0 10px">${
      state.updateVersion && state.updateVersion !== state.buildVersion
        ? `You are running <b>${escape(state.buildVersion)}</b>. <b>${escape(
            state.updateVersion
          )}</b> is downloaded and waiting for you to take it.`
        : 'The build running on this device. The same number is in the header on every screen.'
    }</p>
    <p style="margin:0">Plan format ${state.plan.format} · database v${state.integrity?.formatVersion ?? '—'} ·
      ${escape(state.plan.meta.id)}</p>
    <p class="hint">The build number comes from the service worker's version. If you update the app and this does not
    change, the update has not reached this device — close every tab and reopen. It reads <b>not cached</b> when the
    app is being served from a development machine, where the offline shell is deliberately switched off so edits
    are visible immediately.</p></div>`;
}

/** File pickers, handled on change rather than click. */
export const files = {
  /**
   * Choosing a file reads and checks it. Nothing is written until the preview
   * below is confirmed.
   */
  async import(ctx, file) {
    const report = await ctx.stageImport(file);

    if (!report.ok) {
      openSheet(`<div class="ttl">That backup cannot be restored</div>
        <p style="text-align:center;margin:14px 0 8px;font-size:14px;color:var(--ink)">${escape(file.name)}</p>
        <p style="font-size:13px">Nothing has been changed. The archive has these problems:</p>
        <ul style="font-size:13px;color:var(--ink2);line-height:1.6">${report.problems
          .slice(0, 8)
          .map((problem) => `<li>${escape(problem)}</li>`)
          .join('')}</ul>
        <button class="big mt" data-act="sheet-close">Close</button>`);
      return;
    }

    const rows = report.preview
      .map(
        (row) => `<tr><td>${escape(row.store)}</td><td>${row.existing}</td><td>${
          row.incoming == null ? '<span style="color:var(--muted)">untouched</span>' : row.incoming
        }</td></tr>`
      )
      .join('');

    openSheet(`<div class="ttl">Restore this backup?</div>
      <p style="text-align:center;font-size:13px;margin:10px 0 4px">${escape(file.name)}${
        report.takenAtISO ? ` · taken ${escape(report.takenAtISO.slice(0, 10))}` : ''
      }</p>
      <table style="margin-top:10px"><thead><tr><th>Store</th><th>Now</th><th>After</th></tr></thead>
        <tbody>${rows}</tbody></table>
      ${
        report.replaces.length
          ? `<div class="flag f-warn" style="margin-top:12px"><i>!</i><span>This <b>replaces</b> ${escape(
              report.replaces.join(', ')
            )}. Anything in those stores that is not in the backup is lost.</span></div>`
          : ''
      }
      ${
        report.warnings.length
          ? `<p class="hint">${report.warnings.map(escape).join(' ')}</p>`
          : ''
      }
      <p class="hint">A safety export of your current data downloads first, automatically.</p>
      <button class="big danger mt" data-act="confirm-import">Replace my data</button>
      <button class="big ghost mt" data-act="sheet-close">Cancel</button>`);
  },

  async verify(ctx, file) {
    const report = await ctx.verifyBackup(file);
    openSheet(`<div class="ttl">${report.ok ? 'Backup verified' : 'Backup does not match'}</div>
      <p style="text-align:center;margin:14px 0 4px;font-size:14px;color:var(--ink)">${
        report.ok
          ? 'Every record in the backup is accounted for here.'
          : escape(report.problems.join('; '))
      }</p>
      <p style="text-align:center;font-size:13px">${
        report.ok
          ? 'It was read, parsed and counted against your live data. Nothing was changed.'
          : 'That is expected if the backup is older than your data. If it is not, take a fresh export now.'
      }</p>
      <button class="big mt" data-act="sheet-close">Close</button>`);
  },
};

export const actions = {
  /**
   * The one action in the app that destroys data, and the only one described
   * in those words. It offers the backup first, like every delete does.
   */
  'empty-bin'(ctx) {
    const count = ctx.state.deleted?.length || 0;
    if (!count) {
      openSheet(`<div class="ttl">The bin is empty</div>
        <p style="text-align:center;font-size:13px;margin:16px 0">Nothing has been deleted, so there is nothing to destroy.</p>
        <button class="big mt" data-act="sheet-close">Close</button>`);
      return;
    }
    openSheet(`<div class="ttl">Destroy ${count} deleted record${count === 1 ? '' : 's'}?</div>
      <p style="text-align:center;font-size:13px;margin:14px 0">This is the point of no return: after it, those
      records are not in the database, not in the recovery list, and not in any backup you take afterwards. Existing
      backup files still hold them.</p>
      <button class="big ghost mt" data-act="history-backup">Export a backup first</button>
      <button class="big danger mt" data-act="empty-bin-confirm">Destroy them</button>
      <button class="big ghost mt" data-act="sheet-close">Keep them</button>`);
  },

  async 'empty-bin-confirm'(ctx) {
    const removed = await ctx.emptyBin();
    closeSheet();
    ctx.render();
    openSheet(`<div class="ttl">Bin emptied</div>
      <p style="text-align:center;font-size:13px;margin:16px 0">${removed} record${
        removed === 1 ? '' : 's'
      } destroyed. Nothing else was touched.</p>
      <button class="big mt" data-act="sheet-close">Close</button>`);
  },

  async 'confirm-import'(ctx) {
    const restored = await ctx.applyStagedImport();
    openSheet(`<div class="ttl">Restored</div>
      <p style="text-align:center;font-size:13px;margin:14px 0">${Object.entries(restored)
        .filter(([, count]) => count)
        .map(([store, count]) => `${count} ${escape(store)}`)
        .join(' · ')}</p>
      <button class="big mt" data-act="sheet-close">Done</button>`);
  },

  'open-export'(ctx) {
    const today = new Date().toISOString().slice(0, 10);
    const earliest = ctx.state.logs[0]?.dateISO?.slice(0, 10) || today;

    openSheet(`<div class="ttl">Export</div>
      <p style="font-size:13px;margin:12px 0 8px;color:var(--ink2)">Pick a range and what to include. One zip comes
      out: CSVs for reading, JSON for restoring, photos as files.</p>
      <div class="g2">
        <div><label for="ex-from">From</label><input id="ex-from" type="date" value="${earliest}"></div>
        <div><label for="ex-to">To</label><input id="ex-to" type="date" value="${today}"></div>
      </div>
      <div style="margin-top:11px;font-size:13.5px;line-height:2.1">
        ${[
          ['sets', 'Sets &amp; sessions'],
          ['daily', 'Daily — weight, body fat, sleep'],
          ['measurements', 'Measurements'],
          ['niggles', 'Niggles'],
          ['media', 'Photos &amp; form-check references'],
          ['maxes', 'Working maxes'],
          ['plan', 'The plan itself'],
        ]
          .map(
            ([id, label]) =>
              `<label style="text-transform:none;letter-spacing:0;font-size:13.5px;color:var(--ink);font-weight:400">
                <input type="checkbox" id="ex-${id}" checked style="width:auto;margin-right:8px">${label}</label>`
          )
          .join('')}
      </div>
      <button class="big mt" data-act="do-export">Build the zip</button>
      <button class="big ghost mt" data-act="sheet-close">Cancel</button>`);
  },

  async 'do-export'(ctx) {
    const value = (id) => document.getElementById(id)?.value || null;
    const checked = (id) => !!document.getElementById(`ex-${id}`)?.checked;
    const include = Object.fromEntries(
      ['sets', 'daily', 'measurements', 'niggles', 'media', 'maxes', 'plan'].map((id) => [id, checked(id)])
    );

    const meta = await ctx.exportZip({ from: value('ex-from'), to: value('ex-to'), include });
    openSheet(`<div class="ttl">Exported</div>
      <p style="text-align:center;margin:14px 0 4px;font-size:14px;color:var(--ink)">Your zip is in your downloads.</p>
      <p style="text-align:center;font-size:13px">${meta.counts.sessionLogs} sessions · ${meta.counts.sets} sets ·
      ${meta.counts.daily} daily · ${meta.counts.measurements} measurements · ${meta.counts.media} media</p>
      <button class="big mt" data-act="sheet-close">Done</button>`);
  },

  'pick-import'() {
    document.getElementById('import-file')?.click();
  },

  'pick-verify'() {
    document.getElementById('verify-file')?.click();
  },

  'not-yet'(_ctx, data) {
    openSheet(`<div class="ttl">${escape(data.what)}</div>
      <p style="text-align:center;margin:14px 0 4px;font-size:14px;color:var(--ink)">Not built yet.</p>
      <p style="text-align:center;font-size:13px">${escape(data.what)} arrives with the export stage, along with the zip writer and the restore check.</p>
      <button class="big mt" data-act="sheet-close">Close</button>`);
  },

  erase(ctx) {
    openSheet(`<div class="ttl">Erase everything</div>
      <p style="text-align:center;margin:14px 0 4px;font-size:14px;color:var(--ink)">This deletes <b>${
        ctx.state.logs.length
      } sessions</b>, <b>${ctx.state.sets.length} sets</b> and every weigh-in, measurement, niggle and photo.</p>
      <p style="text-align:center;font-size:13px">It cannot be undone and there is no backup unless you made one. Type <b>ERASE</b> to confirm.</p>
      <input id="erase-confirm" type="text" placeholder="ERASE" style="text-align:center;text-transform:uppercase" autocomplete="off">
      <button class="big danger mt" data-act="erase-confirm">Erase all data</button>
      <button class="big ghost mt" data-act="sheet-close">Cancel</button>`);
  },

  async 'erase-confirm'(ctx) {
    const typed = document.getElementById('erase-confirm')?.value?.trim().toUpperCase();
    if (typed !== 'ERASE') {
      openSheet(`<div class="ttl">Not erased</div>
        <p style="text-align:center;margin:14px 0 4px;font-size:14px;color:var(--ink)">You have to type ERASE exactly.</p>
        <p style="text-align:center;font-size:13px">Nothing has been deleted.</p>
        <button class="big mt" data-act="sheet-close">Close</button>`);
      return;
    }
    await ctx.eraseEverything();
    closeSheet();
    ctx.render();
  },
};
