/**
 * ui/body.js — the Body screen: daily numbers, weekly tape, photos, form-check
 * references and the niggle log.
 *
 * Every field is optional and every blank stays blank. A missing weigh-in is
 * information; a zero is a lie that drags an average down.
 */

import { rollingAverage, weeklySlope } from '../progress.js';
import { preparePhoto, imageUrl, releaseImageUrl, formatBytes } from '../photos.js';
import { escape, fmtLoad, fmtNum, toDisplay, section, openSheet, closeSheet, parseNumber } from './components.js';

export const MEASUREMENT_SITES = [
  ['waist', 'Waist'],
  ['chest', 'Chest'],
  ['shoulders', 'Shoulders'],
  ['armL', 'Arm L'],
  ['armR', 'Arm R'],
  ['quadL', 'Quad L'],
  ['quadR', 'Quad R'],
  ['neck', 'Neck'],
];

/**
 * When the tape was read.
 *
 * The plan asks for the waist at the navel, relaxed, *at the same time of day*,
 * because that is the measurement that separates a lean bulk from a fat one and
 * it moves by more than a week's real change between waking and bedtime. Two
 * readings taken at different times are not comparable, and until now nothing
 * recorded which was which.
 *
 * Waking is the default because it is the one that is reliably repeatable:
 * before food, before water, before training.
 */
/**
 * Which scale the weight came off.
 *
 * Two scales rarely agree, and a bulk is read from a trend of a few hundred
 * grams a week — so a week logged on the gym scale next to a week logged at
 * home can invent a gain or hide one. Recording which is what makes that
 * visible instead of silent.
 *
 * Deliberately optional, with no default. Most weigh-ins are on the same scale
 * and asking every morning would be noise; a blank means "not recorded", which
 * is honest, rather than "home", which would be a guess.
 */
export const SCALES = [
  ['home', 'Home scale'],
  ['gym', 'Gym scale'],
  ['other', 'Other'],
];

export const scaleLabel = (row) => {
  if (!row?.scale) return null;
  if (row.scale === 'other') return row.scaleNote || 'Other scale';
  return (SCALES.find(([id]) => id === row.scale) || [])[1] || row.scale;
};

export const MEASUREMENT_TIMES = [
  ['waking', 'After waking up'],
  ['pre-gym', 'Before gym'],
  ['post-gym', 'After gym'],
  ['pre-sleep', 'Before sleep'],
  ['other', 'Other'],
];

export const DEFAULT_MEASUREMENT_TIME = 'waking';

export const measurementTimeLabel = (row) => {
  if (!row?.timeOfDay) return null;
  if (row.timeOfDay === 'other') return row.timeOfDayNote || 'Other time';
  return (MEASUREMENT_TIMES.find(([id]) => id === row.timeOfDay) || [])[1] || row.timeOfDay;
};

export const NIGGLE_SITES = [
  'Left elbow',
  'Right elbow',
  'Left shoulder',
  'Right shoulder',
  'Lower back',
  'Wrist',
  'Knee',
  'Hip',
];

const shortDate = (iso) => {
  if (!iso) return '';
  const [, month, day] = iso.split('-');
  return `${Number(day)} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(month) - 1]}`;
};

const field = (id, label, value, { step = '0.1', type = 'number', placeholder = '—' } = {}) =>
  `<div><label for="b-${id}">${escape(label)}</label>
    <input id="b-${id}" type="${type}" inputmode="decimal" step="${step}" placeholder="${escape(placeholder)}"
      value="${value == null ? '' : escape(value)}" data-body-field="${id}"></div>`;


/* ═══════════════════════════════════════════════════════════════════════
   Photos
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * The gallery, newest first, drawn from stored thumbnails.
 *
 * In compare mode a tap selects rather than opens: two photos months apart,
 * side by side, is the only view that shows what a bulk actually did.
 */
function gallery(state, photos) {
  if (!photos.length) {
    return '<p style="margin:0 0 10px">No check-ins yet. Front, side and back, same spot and same light each time.</p>';
  }

  const comparing = state.compare != null;
  const chosen = new Set(state.compare || []);

  const tiles = [...photos]
    .sort((a, b) => b.dateISO.localeCompare(a.dateISO))
    .slice(0, 24)
    .map((photo) => {
      const url = imageUrl(`m${photo.id}`, photo.thumbBytes || photo.imageBytes, photo.thumbType || photo.imageType);
      const on = chosen.has(photo.id);
      return `<div class="ph${on ? ' on' : ''}" data-act="${comparing ? 'pick-compare' : 'view-photo'}" data-id="${photo.id}"${
        url ? ` style="background-image:url(${url})"` : ''
      }><span>${escape(shortDate(photo.dateISO))}${on ? ' ✓' : ''}</span></div>`;
    })
    .join('');

  const banner = comparing
    ? `<p class="hint" style="margin:0 0 8px">${
        chosen.size === 0 ? 'Pick the first photo.' : chosen.size === 1 ? 'Now pick the second.' : ''
      }</p>`
    : '';

  return `${banner}<div class="gal">${tiles}</div>${
    photos.length > 24 ? `<p class="hint" style="margin:8px 0 0">Showing the 24 most recent of ${photos.length}.</p>` : ''
  }`;
}

export function view(ctx) {
  const { state } = ctx;
  const unit = state.settings.unit;
  const draft = state.bodyDraft;

  const weights = state.daily
    .filter((d) => Number.isFinite(d.bodyweight))
    .map((d) => ({ dateISO: d.dateISO, value: d.bodyweight }));
  const averaged = rollingAverage(weights, 7);
  const latestAverage = averaged.length ? averaged[averaged.length - 1].value : null;
  const rate = weeklySlope(averaged.slice(-21));

  const photos = state.media.filter((m) => m.kind === 'physique');
  const videos = state.media.filter((m) => m.kind === 'formcheck');

  return `
  ${section(
    'today',
    'Today · about 8 seconds',
    shortDate(draft.dateISO),
    `<div class="card"><div class="g3">
      ${field('bodyweight', `Weight (${unit})`, draft.bodyweight)}
      ${field('bodyfatPct', 'Body fat %', draft.bodyfatPct)}
      ${field('sleepHours', 'Sleep h', draft.sleepHours, { step: '0.5' })}
    </div>
    <div class="g3 mt">
      ${field('steps', 'Steps', draft.steps, { step: '100' })}
      ${field('mood', 'Mood 1–5', draft.mood, { step: '1' })}
      <div><label for="b-caffeine">Caffeine</label>
        <select id="b-caffeine" data-body-field="caffeine">
          <option value="" ${!draft.caffeine ? 'selected' : ''}>—</option>
          <option value="yes" ${draft.caffeine === 'yes' ? 'selected' : ''}>Yes</option>
          <option value="no" ${draft.caffeine === 'no' ? 'selected' : ''}>No</option>
        </select></div>
    </div>
    <div class="mt"><label>Which scale (optional)</label>
      <div class="picker" style="padding-bottom:2px">${SCALES.map(
        ([id, label]) =>
          `<button class="pill ${draft.scale === id ? 'on' : ''}" data-act="daily-scale" data-id="${id}">${escape(
            label
          )}</button>`
      ).join('')}${
        draft.scale
          ? `<button class="pill" data-act="daily-scale" data-id="">Clear</button>`
          : ''
      }</div>
      ${
        draft.scale === 'other'
          ? `<input id="b-scaleNote" type="text" placeholder="Which scale?" value="${escape(
              draft.scaleNote || ''
            )}" data-body-field="scaleNote" style="margin-top:8px">`
          : ''
      }
      <p class="hint">Leave it blank unless it changes. Two scales rarely agree, and this bulk is read from a trend
      of a few hundred grams a week — so a stretch weighed at the gym next to a stretch weighed at home can invent a
      gain or hide one.</p></div>

    <div class="mt"><label for="b-note">Note</label>
      <input id="b-note" type="text" value="${escape(draft.note ?? '')}" data-body-field="note" placeholder="Anything worth remembering…"></div>
    <p class="hint">${
      latestAverage == null
        ? 'The 7-day average appears once there are a few weigh-ins. Only the average counts — a single morning reading is mostly water.'
        : `7-day average <b>${fmtLoad(latestAverage, unit)} ${unit}</b>${
            rate == null ? '' : ` · ${rate >= 0 ? '+' : ''}${fmtNum(toDisplay(rate, unit), 2)} ${unit}/week`
          } · body fat is a low-trust number, the trend is what counts</p>`
    }
    <button class="big mt" data-act="save-daily">Save today</button></div>`,
    state.shut
  )}

  ${section(
    'week',
    'This week · about a minute',
    '',
    `<div class="card"><div class="g3">
      ${MEASUREMENT_SITES.slice(0, 3).map(([id, label]) => field(`m-${id}`, label, draft[`m-${id}`])).join('')}
    </div><div class="g3 mt">
      ${MEASUREMENT_SITES.slice(3, 6).map(([id, label]) => field(`m-${id}`, label, draft[`m-${id}`])).join('')}
    </div><div class="g2 mt">
      ${MEASUREMENT_SITES.slice(6).map(([id, label]) => field(`m-${id}`, label, draft[`m-${id}`])).join('')}
    </div>
    <div class="mt"><label>When these were taken</label>
      <div class="picker" style="padding-bottom:2px">${MEASUREMENT_TIMES.map(
        ([id, label]) =>
          `<button class="pill ${
            (draft.measureTime || DEFAULT_MEASUREMENT_TIME) === id ? 'on' : ''
          }" data-act="measure-time" data-id="${id}">${escape(label)}</button>`
      ).join('')}</div>
      ${
        (draft.measureTime || DEFAULT_MEASUREMENT_TIME) === 'other'
          ? `<input id="b-measureTimeNote" type="text" placeholder="When, exactly?" value="${escape(
              draft.measureTimeNote || ''
            )}" data-body-field="measureTimeNote" style="margin-top:8px">`
          : ''
      }
    </div>
    <button class="big mt" data-act="save-measurements">Save measurements</button>
    <p class="hint">Leave anything blank. Empty is stored as empty, never as zero. Waist at the navel, relaxed — it is the lean-bulk discriminator, so consistency matters more than precision. <b>Same time of day, every time</b>: the waist moves more between waking and bedtime than it does in a good week, so two readings taken at different times are not comparable. Anything recorded before this was added has no time against it and says so rather than guessing.</p></div>`,
    state.shut
  )}

  ${section(
    'photos',
    'Physique check-ins',
    photos.length ? `${photos.length} photo${photos.length === 1 ? '' : 's'}` : '',
    `<div class="card">${gallery(state, photos)}
      <div class="mini"><button data-act="add-photo">+ Add photos</button>${
        photos.length >= 2
          ? `<button data-act="compare-photos">${state.compare?.length ? 'Cancel compare' : 'Compare two'}</button>`
          : ''
      }</div>
      <input type="file" id="photo-input" accept="image/*" multiple hidden data-act-file="photo">
      <p class="hint">Stored in the app: rotated upright from the photo's own orientation flag, resized to 1280 px
      on the long edge and re-encoded to about ${formatBytes(260 * 1024)} each, with a small thumbnail beside it so
      a full gallery does not have to decode every full-size image. The originals are never kept — there is no point
      holding eight megabytes of something you look at on a phone. They go in the export, which is how they reach a
      bigger screen.${
        photos.length
          ? ` <b>${photos.length} check-in${photos.length === 1 ? '' : 's'}</b> using about ${formatBytes(
              photos.reduce((total, p) => total + (p.bytes || p.imageBytes?.length || 0), 0)
            )}.`
          : ''
      }</p></div>`,
    state.shut
  )}

  ${section(
    'forms',
    'Form checks',
    videos.length ? `${videos.length} video${videos.length === 1 ? '' : 's'}` : '',
    `<div class="card">${
      videos.length
        ? videos
            .slice(-6)
            .reverse()
            .map(
              (v) =>
                `<div class="big-row"><div class="ic">▶</div><div class="m"><b>${escape(v.note || 'Form check')}</b><span>${escape(
                  v.dateISO
                )} · ${escape(v.fileRef || 'no filename')}</span></div></div>`
            )
            .join('')
        : '<p style="margin:0 0 10px">Nothing referenced yet.</p>'
    }
      <div class="mini"><button data-act="add-formcheck">+ Reference a video</button></div>
      <p class="hint">Reference only — the app stores the filename, date, lift and load, not the file. Videos are 50–200 MB and storing them would make the app a liability.</p></div>`,
    state.shut
  )}

  ${section(
    'niggles',
    'Niggles',
    state.niggles.length ? `${state.niggles.length} logged` : '',
    `<div class="card">
      <div class="g2">
        <div><label for="n-site">Site</label>
          <select id="n-site" data-body-field="niggleSite">
            <option value="">—</option>
            ${NIGGLE_SITES.map(
              (s) => `<option value="${escape(s)}" ${draft.niggleSite === s ? 'selected' : ''}>${escape(s)}</option>`
            ).join('')}
          </select></div>
        <div><label for="n-sev">Severity</label>
          <select id="n-sev" data-body-field="niggleSeverity">
            <option value="1" ${draft.niggleSeverity === '1' ? 'selected' : ''}>1 · noticed it</option>
            <option value="2" ${draft.niggleSeverity === '2' ? 'selected' : ''}>2 · annoying</option>
            <option value="3" ${draft.niggleSeverity === '3' ? 'selected' : ''}>3 · changed what I did</option>
          </select></div>
      </div>
      <div class="mt"><label for="n-context">What provoked it</label>
        <input id="n-context" type="text" value="${escape(draft.niggleContext ?? '')}" data-body-field="niggleContext" placeholder="Which lift, which set…"></div>
      <button class="big mt" data-act="save-niggle">Log niggle</button>
      ${
        state.niggles.length
          ? `<table style="margin-top:12px"><tbody>${state.niggles
              .slice(-5)
              .reverse()
              .map(
                (n) =>
                  `<tr><td>${escape(n.site)}</td><td>${escape(n.context || '')}</td><td>${escape(
                    n.dateISO
                  )}</td><td>${n.severity}</td></tr>`
              )
              .join('')}</tbody></table>`
          : ''
      }
      <p class="hint">Two or more in a block is the trigger to rotate the aggravating variation out. Logging what provoked it is the part that makes it useful later.</p></div>`,
    state.shut
  )}`;
}

/** Blank means blank — only fields with something in them are written. */
const parse = parseNumber;

const countBlanks = (values) => values.filter((v) => v == null).length;

export const actions = {
  section(ctx, data) {
    ctx.state.shut.has(data.id) ? ctx.state.shut.delete(data.id) : ctx.state.shut.add(data.id);
    ctx.render();
  },

  'save-daily'(ctx) {
    const draft = ctx.state.bodyDraft;
    const unit = ctx.state.settings.unit;
    const row = {
      dateISO: draft.dateISO,
      bodyweight: ctx.toKg(parse(draft.bodyweight)),
      bodyfatPct: parse(draft.bodyfatPct),
      sleepHours: parse(draft.sleepHours),
      steps: parse(draft.steps),
      mood: parse(draft.mood),
      caffeine: draft.caffeine || null,
      scale: draft.scale || null,
      scaleNote: draft.scale === 'other' ? draft.scaleNote?.trim() || null : null,
      note: draft.note || null,
    };
    const blanks = countBlanks([row.bodyweight, row.bodyfatPct, row.sleepHours]);
    confirmBlanks(ctx, blanks, 'daily', () => ctx.saveDaily(row));
  },

  'daily-scale'(ctx, data) {
    // Tapping the one already chosen clears it, because "not recorded" has to
    // stay reachable once something has been picked.
    ctx.state.bodyDraft.scale = ctx.state.bodyDraft.scale === data.id ? '' : data.id;
    ctx.render();
  },

  'measure-time'(ctx, data) {
    ctx.state.bodyDraft.measureTime = data.id;
    ctx.render();
  },

  'save-measurements'(ctx) {
    const draft = ctx.state.bodyDraft;
    const timeOfDay = draft.measureTime || DEFAULT_MEASUREMENT_TIME;
    const row = {
      dateISO: draft.dateISO,
      timeOfDay,
      // Only meaningful for "other", and stored as null otherwise rather than
      // left holding whatever was typed before the choice changed.
      timeOfDayNote: timeOfDay === 'other' ? draft.measureTimeNote?.trim() || null : null,
    };
    for (const [id] of MEASUREMENT_SITES) row[id] = parse(draft[`m-${id}`]);

    const blanks = countBlanks(MEASUREMENT_SITES.map(([id]) => row[id]));
    confirmBlanks(ctx, blanks, 'measurements', () => ctx.saveMeasurements(row));
  },

  'save-niggle'(ctx) {
    const draft = ctx.state.bodyDraft;
    if (!draft.niggleSite) {
      openSheet(`<div class="ttl">Nothing to log</div>
        <p style="text-align:center;margin:14px 0 4px;font-size:14px;color:var(--ink)">Pick a site first.</p>
        <button class="big mt" data-act="sheet-close">Close</button>`);
      return;
    }
    ctx.saveNiggle({
      dateISO: draft.dateISO,
      site: draft.niggleSite,
      severity: Number(draft.niggleSeverity || 1),
      context: draft.niggleContext || null,
      note: null,
    });
  },

  'confirm-body-save'(ctx) {
    closeSheet();
    const pending = ctx.state.pendingSave;
    ctx.state.pendingSave = null;
    pending?.();
  },

  'add-photo'() {
    document.getElementById('photo-input')?.click();
  },

  /** Opens one check-in full size, with what it cost and how to remove it. */
  'view-photo'(ctx, data) {
    const photo = ctx.state.media.find((m) => String(m.id) === String(data.id));
    if (!photo) return;
    const url = imageUrl(`f${photo.id}`, photo.imageBytes, photo.imageType);

    openSheet(`<div class="ttl">${escape(shortDate(photo.dateISO))}</div>
      ${url ? `<img src="${url}" alt="Physique check-in from ${escape(photo.dateISO)}" style="width:100%;border-radius:12px;margin:12px 0 6px">` : '<p style="text-align:center;margin:16px 0">This entry has no image stored.</p>'}
      <p class="hint" style="text-align:center;margin:0 0 4px">${escape(photo.dateISO)}${
        photo.note ? ` · ${escape(photo.note)}` : ''
      }${photo.width ? ` · ${photo.width}×${photo.height}` : ''}${
        photo.bytes ? ` · ${escape(formatBytes(photo.bytes))}` : ''
      }</p>
      <button class="big ghost mt" data-act="sheet-close">Close</button>
      <button class="big danger mt" data-act="delete-photo" data-id="${photo.id}">Delete this check-in</button>`);
  },

  /**
   * A photo goes to the bin like everything else. The bytes are the record and
   * there is no second copy, so it still asks and still offers the export —
   * but the answer to a mis-tap is one tap in History, not an apology.
   */
  'delete-photo'(ctx, data) {
    const photo = ctx.state.media.find((m) => String(m.id) === String(data.id));
    if (!photo) return;
    openSheet(`<div class="ttl">Delete this check-in?</div>
      <p style="text-align:center;margin:14px 0 4px;font-size:14px;color:var(--ink)">${escape(shortDate(photo.dateISO))}</p>
      <p style="font-size:13px;text-align:center">It moves to <b>Recently deleted</b> at the foot of History, where
      you can put it back. It is only destroyed when you empty the bin in Settings.</p>
      <button class="big ghost mt" data-act="history-backup">Export everything first</button>
      <button class="big danger mt" data-act="confirm-delete-photo" data-id="${photo.id}">Delete it</button>
      <button class="big ghost mt" data-act="sheet-close">Keep it</button>`);
  },

  async 'confirm-delete-photo'(ctx, data) {
    // The blob URLs go now; a restore mints new ones from the same bytes.
    releaseImageUrl(`m${data.id}`);
    releaseImageUrl(`f${data.id}`);
    await ctx.deleteMedia(Number(data.id));
    closeSheet();
    ctx.render();
  },

  'compare-photos'(ctx) {
    ctx.state.compare = ctx.state.compare ? null : [];
    ctx.render();
  },

  'pick-compare'(ctx, data) {
    const id = Number(data.id);
    const chosen = ctx.state.compare || [];
    const next = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id].slice(-2);
    ctx.state.compare = next;

    if (next.length === 2) {
      const [a, b] = next
        .map((pid) => ctx.state.media.find((m) => m.id === pid))
        .filter(Boolean)
        .sort((x, y) => x.dateISO.localeCompare(y.dateISO));
      const days = Math.round((Date.parse(b.dateISO) - Date.parse(a.dateISO)) / 86400000);
      const weightAt = (iso) => ctx.state.daily.find((d) => d.dateISO === iso)?.bodyweight ?? null;
      const from = weightAt(a.dateISO);
      const to = weightAt(b.dateISO);

      openSheet(`<div class="ttl">${escape(shortDate(a.dateISO))} → ${escape(shortDate(b.dateISO))}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0 6px">
          <img src="${imageUrl(`f${a.id}`, a.imageBytes, a.imageType)}" alt="Check-in from ${escape(a.dateISO)}" style="width:100%;border-radius:10px">
          <img src="${imageUrl(`f${b.id}`, b.imageBytes, b.imageType)}" alt="Check-in from ${escape(b.dateISO)}" style="width:100%;border-radius:10px">
        </div>
        <p class="hint" style="text-align:center;margin:0">${days} days apart${
          from != null && to != null
            ? ` · ${fmtNum(from, 1)} → ${fmtNum(to, 1)} kg, ${to - from >= 0 ? '+' : ''}${fmtNum(to - from, 1)} kg`
            : ''
        }. Same light and same spot is what makes two photos comparable; a different room is a different photo.</p>
        <button class="big ghost mt" data-act="sheet-close">Close</button>`);
      ctx.state.compare = [];
    }
    ctx.render();
  },

  'add-formcheck'(ctx) {
    openSheet(`<div class="ttl">Reference a form check</div>
      <p style="font-size:12.5px;margin:12px 0 4px;color:var(--ink2)">The app stores the filename and what the set was, not the video. Tap it later and your gallery opens.</p>
      <div class="mt"><label for="fc-file">Filename</label><input id="fc-file" type="text" placeholder="IMG_4417.mov"></div>
      <div class="mt"><label for="fc-note">What it was</label><input id="fc-note" type="text" placeholder="Bench AMRAP · 95 kg × 6"></div>
      <button class="big mt" data-act="save-formcheck">Save reference</button>
      <button class="big ghost mt" data-act="sheet-close">Cancel</button>`);
  },

  'save-formcheck'(ctx) {
    const fileRef = document.getElementById('fc-file')?.value?.trim();
    const note = document.getElementById('fc-note')?.value?.trim();
    closeSheet();
    if (!fileRef && !note) return;
    ctx.saveMedia({
      dateISO: ctx.state.bodyDraft.dateISO,
      kind: 'formcheck',
      exerciseId: null,
      load: null,
      reps: null,
      note: note || null,
      fileRef: fileRef || null,
      imageBlob: null,
    });
  },
};

function confirmBlanks(ctx, blanks, what, save) {
  if (!blanks) {
    save();
    return;
  }
  ctx.state.pendingSave = save;
  openSheet(`<div class="ttl">Empty values</div>
    <p style="text-align:center;margin:14px 0 4px;font-size:14px;color:var(--ink)"><b>${blanks} field${
      blanks === 1 ? '' : 's'
    }</b> ${blanks === 1 ? 'is' : 'are'} empty.</p>
    <p style="text-align:center;font-size:13px">Save anyway? Blank stays blank — it is never recorded as zero, and gaps do not break the trend lines.</p>
    <button class="big mt" data-act="confirm-body-save">Save anyway</button>
    <button class="big ghost mt" data-act="sheet-close">Go back</button>`);
}

/**
 * The picked files, handled on change.
 *
 * Each photo is prepared and stored on its own: one unreadable HEIC among six
 * should not lose the other five, so failures are collected and reported at
 * the end rather than thrown at the first one.
 */
export const files = {
  async photo(ctx, fileList) {
    const chosen = [...(fileList || [])];
    if (!chosen.length) return;

    openSheet(`<div class="ttl">Adding ${chosen.length} photo${chosen.length === 1 ? '' : 's'}</div>
      <p style="text-align:center;margin:18px 0;font-size:13px">Resizing and compressing…</p>`);

    const failed = [];
    let added = 0;
    for (const file of chosen) {
      try {
        const prepared = await preparePhoto(file);
        await ctx.saveMedia({
          dateISO: ctx.state.bodyDraft.dateISO,
          localDate: ctx.state.bodyDraft.dateISO,
          kind: 'physique',
          exerciseId: null,
          load: null,
          reps: null,
          note: null,
          fileRef: prepared.originalName,
          ...prepared,
        });
        added += 1;
      } catch (error) {
        failed.push(error.message);
      }
    }

    if (!failed.length) {
      closeSheet();
      ctx.render();
      return;
    }

    openSheet(`<div class="ttl">${added} added, ${failed.length} could not be read</div>
      <ul style="font-size:13px;color:var(--ink2);line-height:1.6;margin:14px 0">${failed
        .slice(0, 6)
        .map((message) => `<li>${escape(message)}</li>`)
        .join('')}</ul>
      <button class="big mt" data-act="sheet-close">Close</button>`);
    ctx.render();
  },
};
