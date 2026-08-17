/**
 * ui/settings.js — units, load increment, bodyweight, storage health, privacy
 * and the erase-everything button.
 *
 * The kg/lb toggle is a rendering transform and nothing else. Data is stored in
 * kilograms whatever this says, so switching back and forth cannot introduce
 * rounding drift into a single stored number.
 */

import { escape, fmtNum, toDisplay, flag, openSheet, closeSheet } from './components.js';

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
    <button class="big mt" data-act="history-backup">Download a JSON backup now</button>
    <button class="big ghost mt" data-act="not-yet" data-what="Zip export">Export everything as a zip</button>
    <button class="big ghost mt" data-act="not-yet" data-what="Import">Import from a backup</button>
    <button class="big ghost mt" data-act="not-yet" data-what="Backup verification">Verify backup can be restored</button>
    <p class="hint">The JSON backup is a plain file with every record in it — enough to restore from by hand, and
    what the app offers you before any deletion. The zip export with CSVs and photos arrives with the export stage.</p>
    <p class="hint">The verify button restores your last export into a scratch copy and checks it matches, so you find out a backup is broken <b>before</b> you need it — not after.</p>
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
  <div class="card"><button class="big danger" data-act="erase">Erase all data</button>
    <p class="hint">Requires typing ERASE. Everything logged goes: sessions, sets, weigh-ins, measurements, photos and maxes. The plan file is untouched.</p></div>

  <h3>About</h3>
  <div class="card"><p style="margin:0">Bulk · plan format ${state.plan.format} · database v${
    state.integrity?.formatVersion ?? '—'
  } · ${escape(state.plan.meta.id)}</p></div>`;
}

export const actions = {
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
