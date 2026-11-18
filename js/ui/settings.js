/**
 * ui/settings.js — units, load increment, bodyweight, storage health, privacy
 * and the erase-everything button.
 *
 * The kg/lb toggle is a rendering transform and nothing else. Data is stored in
 * kilograms whatever this says, so switching back and forth cannot introduce
 * rounding drift into a single stored number.
 */

import {
  escape,
  fmtNum,
  fmtLoad,
  toDisplay,
  fromDisplay,
  parseNumber,
  flag,
  deviceIsolationNote,
  openSheet,
  closeSheet,
  questionSheet,
  questionFmt,
} from './components.js';
import { workingMaxInfo } from './train.js';
import { localDate } from '../dates.js';
import { checkWorkingMax } from '../plausibility.js';

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

  <h3 style="margin-top:0">Demo data</h3>
  <div class="card">
    ${
      state.demo
        ? `${flag('warn', '!', `<b>Demo mode is on.</b> Everything on every screen is invented — twelve rotations of
             generated training. Nothing here is yours and nothing can be saved.`)}
           <button class="big mt" data-act="demo-off">Turn it off and go back to my data</button>
           <p class="hint">Your real log is in a different database and has not been opened since demo mode came on.
           Turning it off gives it back exactly as it was.</p>`
        : `<p style="margin:0 0 10px">Explore every screen with twelve rotations of invented training. This is the
             quickest way to learn the app before logging anything.</p>
           ${flag('ok', '✓', `<b>Your real data cannot be touched by it.</b> The demo runs on a separate database and
             writing is switched off entirely while it is on.`)}
           <button class="big ghost" data-act="demo-on">Explore the demo</button>`
    }
  </div>

  ${planChooser(state)}

  ${maxesCard(state)}

  <details class="card settings-group" open><summary><span>Training &amp; display<small>Units, plates and bodyweight</small></span></summary><div class="c"><div class="seg">
    <button class="${unit === 'kg' ? 'on' : ''}" data-act="unit" data-id="kg">Kilograms</button>
    <button class="${unit === 'lb' ? 'on' : ''}" data-act="unit" data-id="lb">Pounds</button></div>
    <p class="hint">Changes every number in the app, everywhere, instantly. <b>Data is always stored in kg</b> — this is a display setting only, so switching back and forth can never corrupt anything or introduce rounding drift.</p>

    <div class="seg mt">
      <button class="${state.settings.lengthUnit !== 'in' ? 'on' : ''}" data-act="lengthUnit" data-id="cm">Centimetres</button>
      <button class="${state.settings.lengthUnit === 'in' ? 'on' : ''}" data-act="lengthUnit" data-id="in">Inches</button></div>
    <p class="hint">For tape measurements. <b>Always written down in cm</b>, and the Body form stays in cm whichever
    this is — so a reading can never be typed into the wrong unit. This changes what you read on Progress and in the
    Log.</p>

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
  </div></div></details>

  <details class="card settings-group"><summary><span>Data &amp; backups<small>${state.integrity?.ok ? 'Healthy' : 'Needs attention'} · ${state.logs.length} sessions · ${state.sets.length} sets</small></span></summary><div class="c">
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
    <input type="file" id="import-file" accept=".zip,application/zip,.json,application/json" hidden data-act-file="import">
    <input type="file" id="verify-file" accept=".zip,application/zip,.json,application/json" hidden data-act-file="verify">
    <p class="hint">The zip holds CSVs you can open in anything, a lossless <b>data.json</b> for restoring, your plan,
    and your photos as real files. It is also how data moves between your phone and your laptop.</p>
    <p class="hint">Verify reads a backup and checks it against what is stored, without touching your data — so you
    find out a backup is broken <b>before</b> you need it, not after.</p>
  </div></details>

  <details class="card settings-group"><summary><span>Privacy &amp; storage<small>Device-only data and permissions</small></span></summary><div class="c">
    ${flag('ok', '✓', '<b>No network access.</b> The app makes zero requests. It cannot phone home because there is nothing to phone.')}
    ${flag('ok', '✓', '<b>No account, no login, no analytics.</b> Your data never leaves the device unless you export it yourself.')}
    ${flag(
      'ok',
      '✓',
      '<b>No permissions requested.</b> Adding photos goes through the standard file picker, which grants access to the one file you pick and nothing else. No camera, no location, no contacts.'
    )}
    <p class="hint">If the app ever asks for a permission, something is wrong — that is a good rule to hold it to.</p>
    <h3>Where this data lives</h3>
    ${deviceIsolationNote()}
  </div></details>

  <details class="card settings-group danger-settings"><summary><span>Deletion &amp; reset<small>${
    state.deleted?.length ? `${state.deleted.length} recoverable in the bin` : 'Bin empty'
  }</small></span></summary><div class="c">
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
    <p class="hint">Requires typing ERASE. Everything logged goes: sessions, sets, weigh-ins, measurements, photos and maxes, and your settings, including where you are in each plan. The app starts again as a fresh install; the plan files are untouched.</p>
  </div></details>

  <details class="card settings-group"><summary><span>About this build<small>${escape(
    state.buildVersion || 'development build'
  )}</small></span></summary><div class="c">
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
    are visible immediately.</p></div></details>`;
}

/**
 * Which plan the app runs.
 *
 * Switching keeps everything: sessions stay in History under the plan they were
 * trained in, and each plan keeps its own rotation, so going back resumes the
 * old one exactly where it was.
 */
function planChooser(state) {
  const plans = Object.values(state.plans || {});
  if (plans.length < 2) return '';
  const active = state.plan.meta.id;
  return `<details class="card settings-group" open><summary><span>Training plan<small>${escape(
    state.plan.meta.name
  )} \u00b7 rotation ${state.cycle?.sequence ?? 1} of ${state.plan.meta.rotations}</small></span></summary><div class="c">
    ${plans
      .map(
        (plan) => `<button class="plan-choice ${plan.meta.id === active ? 'on' : ''}" data-act="pick-plan" data-id="${escape(
          plan.meta.id
        )}">
          <div style="flex:1"><b>${plan.meta.id === active ? '\u2713 ' : ''}${escape(plan.meta.name)}</b>
          <span>${escape(plan.meta.sub || plan.meta.longName || '')}</span>
          <span>${plan.sessions.length} sessions \u00b7 ${plan.meta.rotations} rotations${
            plan.meta.id === active ? ' \u00b7 active' : ''
          }</span></div></button>`
      )
      .join('')}
    <p class="hint">Switching moves nothing and deletes nothing. Every session stays in your History under the plan
    it was trained in, and each plan keeps its own rotation — switch back and the old one carries on where you left
    it. Not possible while a session is open.</p>
  </div></details>`;
}

/**
 * Every working max the plan uses, where each one comes from, and a way to
 * change it.
 *
 * A max you set yourself is the strongest source and is shown as such. Without
 * one, the number is either what your recent sets show, a fraction of your
 * competition bench (for a bench variation), or the plan's starting estimate —
 * and the screen says which, because "why is it asking for 37.5 kg" has to be
 * answerable from the screen.
 */
export function maxRowsFor(state) {
  const used = new Set();
  for (const session of state.plan.sessions || []) {
    for (const slot of session.slots || []) {
      for (const id of [slot.ex, ...(slot.options || [])]) used.add(id);
    }
  }
  for (const id of state.maxes?.keys?.() || []) used.add(id);

  return [...used]
    .map((id) => ({ id, exercise: state.plan.exercises[id] }))
    .filter(({ exercise }) => exercise && exercise.tracksMax && exercise.maxConf === 'high')
    .map(({ id, exercise }) => ({ id, exercise, info: workingMaxInfo(state, id) }))
    .sort((a, b) => {
      const rank = (row) => (row.id === 'benchComp' ? 0 : row.exercise.maxFrom ? 1 : 2);
      return rank(a) - rank(b) || a.exercise.name.localeCompare(b.exercise.name);
    });
}

const SOURCE_TEXT = {
  confirmed: 'set by you',
  ratio: 'from your competition bench',
  evidence: 'from your recent sets',
  seed: 'plan starting estimate',
};

function sourceLine(state, row) {
  const info = row.info;
  if (!info) return 'no max yet — the first sets you log will set one';
  const unit = state.settings.unit;
  if (info.source === 'confirmed') return `set by you${info.setAtISO ? ` on ${escape(info.setAtISO.slice(0, 10))}` : ''}`;
  if (info.source === 'ratio') {
    return `${Math.round(info.ratio * 100)}% of your ${escape(fmtLoad(info.parent.value, unit))} ${escape(unit)} competition bench`;
  }
  if (info.source === 'evidence') {
    return `from ${info.evidence.sessions} session${info.evidence.sessions === 1 ? '' : 's'} since ${escape(
      info.evidence.fromISO
    )}`;
  }
  return 'the plan\u2019s starting estimate — set your own';
}

function maxesCard(state) {
  const rows = maxRowsFor(state);
  const unit = state.settings.unit;
  return `<details class="card settings-group"><summary><span>Working maxes<small>${rows.length} lifts \u00b7 ${
    rows.filter((row) => row.info?.source === 'confirmed').length
  } set by you</small></span></summary><div class="c">
    ${rows
      .map(
        (row) => `<div class="maxrow" data-act="open-max" data-id="${escape(row.id)}" style="cursor:pointer">
          <div class="m"><b>${escape(row.exercise.name)}</b><span>${sourceLine(state, row)}</span></div>
          <div class="v">${row.info ? `${escape(fmtLoad(row.info.value, unit))}<small>${escape(unit)}</small>` : '\u2014'}</div>
          <div class="car">\u203a</div></div>`
      )
      .join('')}
    <p class="hint">Every prescribed load is worked out from these. A max you set yourself always wins. Without one,
    a lift uses what your recent sets show (the middle of your best estimates over the last six weeks), a bench
    variation follows your competition bench, and only failing both does the plan's starting estimate apply. On
    pull-ups, chin-ups and dips the number includes your bodyweight.</p>
  </div></details>`;
}

/**
 * The export sheet's default range: everything stored, up to today.
 *
 * "From" used to be the first session's date, so weigh-ins, tape readings and
 * photos from before it were silently left out of the default export. "To" was
 * `toISOString()`, a UTC date, so for the first hour or two after local
 * midnight it was yesterday and left out the session just logged. Today is
 * `state.todayISO`, the local civil date the rest of the app uses.
 */
export function exportRangeDefaults(state) {
  const today = state.todayISO || localDate();
  const dates = [state.logs, state.daily, state.measurements, state.niggles, state.media]
    .flatMap((rows) => rows || [])
    .map((row) => String(row.localDate || row.dateISO || '').slice(0, 10))
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day))
    .sort();
  return { from: dates[0] && dates[0] < today ? dates[0] : today, to: today };
}

/**
 * What the restore will do, in the words of THE IMPORT POLICY in export.js.
 * Change one and change the other.
 */
export function importPolicyText(report) {
  if (report.complete) {
    return `<div class="flag f-warn" style="margin-top:12px"><i>!</i><span>This is a <b>complete backup</b>, so
      restoring it <b>replaces everything</b>: sessions, sets, body entries, maxes, rotations, settings and any open
      session become exactly what the backup holds, and anything logged after it was taken is lost (the safety copy
      keeps it). Custom exercises you added since are kept.</span></div>`;
  }
  return `<div class="flag f-ok" style="margin-top:12px"><i>✓</i><span>This is a <b>partial backup</b> (${escape(
    report.partialBecause.join('; ')
  )}), so it is <b>merged</b>: its sessions, sets, rotations and other entries are written over the same entries
    here, and nothing is removed. The active plan, the rotation each plan is on and any open session stay as they
    are now (taken from the backup only where this phone has none); its other settings are restored. Custom exercises
    from both are kept.</span></div>`;
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

    // A merged store keeps what it has and takes the backup's rows over the
    // same entries, so its final count is not known from counts alone — it is
    // said in words rather than guessed at.
    const rows = report.preview
      .map(
        (row) => `<tr><td>${escape(row.store)}</td><td>${row.existing}</td><td>${
          row.incoming == null
            ? '<span style="color:var(--muted)">untouched</span>'
            : row.mode === 'merge'
              ? `${row.existing} kept + ${row.incoming} from backup`
              : row.incoming
        }</td></tr>`
      )
      .join('');

    openSheet(`<div class="ttl">Restore this backup?</div>
      <p style="text-align:center;font-size:13px;margin:10px 0 4px">${escape(file.name)}${
        report.takenAtISO ? ` · taken ${escape(report.takenAtISO.slice(0, 10))}` : ''
      }</p>
      <table style="margin-top:10px"><thead><tr><th>Store</th><th>Now</th><th>After</th></tr></thead>
        <tbody>${rows}</tbody></table>
      ${importPolicyText(report)}
      ${
        report.warnings.length
          ? `<p class="hint">${report.warnings.map(escape).join(' ')}</p>`
          : ''
      }
      <p class="hint">A safety export of your current data downloads first, automatically.</p>
      <button class="big danger mt" data-act="confirm-import">${report.complete ? 'Replace my data' : 'Merge into my data'}</button>
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
  'pick-plan'(ctx, data) {
    const { state } = ctx;
    const target = state.plans?.[data.id];
    if (!target || data.id === state.plan.meta.id) return;
    if (state.activeLog) {
      openSheet(`<div class="ttl">A session is open</div>
        <p style="text-align:center;margin:14px 0;font-size:13px">Finish or discard session <b>${escape(
          state.activeLog.sessionId
        )}</b> first. Its sets belong to the plan it was started in.</p>
        <button class="big mt" data-act="sheet-close">OK</button>`);
      return;
    }
    openSheet(`<div class="ttl">Switch to ${escape(target.meta.name)}?</div>
      <p style="text-align:center;margin:14px 0 4px;font-size:14px;color:var(--ink)">${escape(target.meta.sub || '')}</p>
      <p style="text-align:center;font-size:13px">Nothing is moved or deleted. ${escape(
        state.plan.meta.name
      )} keeps its rotation and its sessions stay in your History; you can switch back at any time.</p>
      <button class="big mt" data-act="confirm-plan" data-id="${escape(data.id)}">Switch to ${escape(target.meta.name)}</button>
      <button class="big ghost mt" data-act="sheet-close">Stay on ${escape(state.plan.meta.name)}</button>`);
  },

  async 'confirm-plan'(ctx, data) {
    const result = await ctx.switchPlan(data.id);
    closeSheet();
    if (!result?.ok) {
      openSheet(`<div class="ttl">Not switched</div>
        <p style="text-align:center;margin:14px 0;font-size:13px">${escape(result?.reason || 'Nothing changed.')}</p>
        <button class="big mt" data-act="sheet-close">OK</button>`);
      return;
    }
    ctx.goTo({ tab: 'train' });
  },

  'open-max'(ctx, data) {
    const { state } = ctx;
    const row = maxRowsFor(state).find((candidate) => candidate.id === data.id);
    if (!row) return;
    const unit = state.settings.unit;
    const info = row.info;
    const evidence = info?.source === 'evidence' ? info.evidence : null;
    const history = (state.maxHistory || [])
      .filter((entry) => entry.exerciseId === row.id)
      .sort((a, b) => String(b.setAtISO).localeCompare(String(a.setAtISO)))
      .slice(0, 6);
    const shown = info ? Math.round(toDisplay(info.value, unit) * 10) / 10 : '';

    openSheet(`<div class="ttl">${escape(row.exercise.name)}</div>
      <p style="text-align:center;margin:10px 0 4px;font-size:28px;font-weight:800;font-variant-numeric:tabular-nums">${
        info ? `${escape(fmtLoad(info.value, unit))} ${escape(unit)}` : '\u2014'
      }</p>
      <p style="text-align:center;font-size:12.5px;margin:0 0 14px">${sourceLine(state, row)}</p>
      <label for="max-value">Working max (${escape(unit)})${row.exercise.bodyweightLoaded ? ' \u2014 bodyweight + added' : ''}</label>
      <input id="max-value" type="number" inputmode="decimal" step="0.5" value="${shown}" data-pick>
      <button class="big mt" data-act="save-max" data-id="${escape(row.id)}">Save as my working max</button>
      ${
        evidence
          ? `<p class="hint">Your recent sets: ${evidence.rows
              .slice(-5)
              .map((r) => `${escape(r.dateISO.slice(5))} \u2192 ${escape(fmtLoad(r.value, unit))}`)
              .join(' \u00b7 ')}. The middle of these is what the app is using now.</p>`
          : ''
      }
      ${
        history.length
          ? `<h4>History</h4><table><tbody>${history
              .map(
                (entry) => `<tr><td>${escape(String(entry.setAtISO || '').slice(0, 10))}</td><td>${
                  entry.workingMax == null ? '\u2014' : `${escape(fmtLoad(entry.workingMax, unit))} ${escape(unit)}`
                }</td><td>${escape(String(entry.reason || ''))}</td></tr>`
              )
              .join('')}</tbody></table>`
          : ''
      }
      <p class="hint">Saving writes a new working max and keeps the old one in the history above. Every load on this
      lift — and on the bench variations, if this is your competition bench — recalculates from it.</p>
      <button class="big ghost mt" data-act="sheet-close">Cancel</button>`);
  },

  async 'save-max'(ctx, data) {
    const { state } = ctx;
    const typed = parseNumber(document.getElementById('max-value')?.value);
    if (!(typed > 0)) {
      openSheet(`<div class="ttl">Not saved</div>
        <p style="text-align:center;margin:14px 0;font-size:13px">A working max has to be a weight above zero.</p>
        <button class="big mt" data-act="open-max" data-id="${escape(data.id)}">Back</button>`);
      return;
    }
    const kg = Math.round(fromDisplay(typed, state.settings.unit) * 100) / 100;
    const unit = state.settings.unit;
    const current = workingMaxInfo(state, data.id)?.value ?? null;
    const name = state.plan.exercises[data.id]?.name?.split(' (')[0] || 'this lift';
    const check = checkWorkingMax(kg, current, { name, fmt: questionFmt(unit) });
    if (!check.ok && !data.confirmed) {
      // Every load on the lift, and on the bench variations, is worked out
      // from this number: 1300 for 130 prescribed 1197.5 kg × 1. Asked once.
      openSheet(
        questionSheet([check.message], {
          save: `data-act="save-max-confirmed" data-id="${escape(data.id)}" data-value="${kg}"`,
          fix: `data-act="open-max" data-id="${escape(data.id)}"`,
        })
      );
      return;
    }
    await ctx.confirmMax(data.id, kg, 'set in Settings');
    closeSheet();
    ctx.render();
  },

  /** "Save" on the plausibility question: the number he typed, as typed. */
  async 'save-max-confirmed'(ctx, data) {
    const kg = Number(data.value);
    if (!(kg > 0)) return;
    await ctx.confirmMax(data.id, kg, 'set in Settings');
    closeSheet();
    ctx.render();
  },

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
    const { restored, modes = {} } = await ctx.applyStagedImport();
    openSheet(`<div class="ttl">Restored</div>
      <p style="text-align:center;font-size:13px;margin:14px 0">${Object.entries(restored)
        .filter(([, count]) => count)
        .map(([store, count]) => `${count} ${escape(store)}${modes[store] === 'merge' ? ' merged' : ''}`)
        .join(' · ')}</p>
      <button class="big mt" data-act="sheet-close">Done</button>`);
  },

  'open-export'(ctx) {
    const { from: earliest, to: today } = exportRangeDefaults(ctx.state);

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
      <p style="text-align:center;font-size:13px">${meta.counts.sessionLogs ?? 0} sessions · ${meta.counts.sets ?? 0} sets ·
      ${meta.counts.daily ?? 0} daily · ${meta.counts.measurements ?? 0} measurements · ${meta.counts.media ?? 0} media</p>
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

  /*
   * Erase offers the backup before it takes anything, the way deleting an entry
   * and emptying the bin already did. It was the one destructive path in the
   * app that told you a backup would have been a good idea instead of handing
   * you one — and it is the destructive path that takes everything.
   */
  erase(ctx) {
    openSheet(`<div class="ttl">Erase everything</div>
      <p style="text-align:center;margin:14px 0 4px;font-size:14px;color:var(--ink)">This deletes <b>${
        ctx.state.logs.length
      } sessions</b>, <b>${ctx.state.sets.length} sets</b> and every weigh-in, measurement, niggle and photo, and resets your settings and both plans to rotation 1.</p>
      <p style="text-align:center;font-size:13px">It cannot be undone, and unlike deleting an entry it does not go to
      the bin — it is gone. Take the backup first; it is one tap and it costs nothing.</p>
      <button class="big mt" data-act="history-backup">Export a backup first</button>
      <p style="text-align:center;font-size:13px;margin-top:14px">Then type <b>ERASE</b> to confirm.</p>
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
