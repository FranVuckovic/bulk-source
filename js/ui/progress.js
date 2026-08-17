/**
 * ui/progress.js — the Progress screen.
 *
 * Everything here is computed on read from the logs. Two rules run through it:
 *
 *   Indicative maxes (maxConf 'ind') prescribe loads but never appear in a
 *   chart or a PR claim. Prediction equations are known to fail on isolation
 *   work, and a PR you did not really set is worse than no PR at all.
 *
 *   Nothing advances by itself. Reaching a block's session target opens the
 *   review; confirming each proposed working max is a deliberate tap.
 */

import { e1rm, pct, systemLoad, proposeBlockBoundaryMax, proposeMidBlockBump } from '../calc.js';
import {
  rollingAverage,
  weeklySlope,
  weeklyBests,
  detectPRs,
  weeklyLoads,
  decisionFlags,
  weekStartISO,
  daysBetween,
} from '../progress.js';
import { rollUp, volumeFromSets } from '../volume.js';
import { escape, fmtLoad, fmtNum, toDisplay, flag, openSheet, closeSheet } from './components.js';
import {
  lineChart,
  barChart,
  indexedChart,
  heatmap,
  scatterIso,
  stackedBars,
  timeline,
  emptyChart,
} from './charts.js';

const SESSION_COLORS = {
  A: 'var(--s1)',
  B: 'var(--s2)',
  C: 'var(--s3)',
  D: 'var(--c4)',
  E: 'var(--c5)',
  F: 'var(--c6)',
};

const ROLL_COLORS = {
  Chest: 'var(--s1)',
  Triceps: 'var(--s2)',
  Back: 'var(--s3)',
  Biceps: 'var(--c4)',
  Core: 'var(--c5)',
};

/* ═══════════════════════════════════════════════════════════════════════
   Derived series
   ═══════════════════════════════════════════════════════════════════════ */

/** Index-set observations for one lift, as { dateISO, value } e1RM points. */
export function e1rmPoints(state, exerciseId) {
  const byLog = new Map(state.logs.map((log) => [log.id, log]));
  return state.sets
    .filter((set) => set.exerciseId === exerciseId && set.isIndexSet && set.reps && set.load != null)
    .map((set) => {
      const log = byLog.get(set.sessionLogId);
      const value = e1rm(systemLoad(set.load, set.bodyweightUsed || 0), set.reps, set.rpe ?? 8);
      return value == null || !log ? null : { dateISO: log.dateISO, value, setId: set.id };
    })
    .filter(Boolean)
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
}

/**
 * Lifts whose e1RM is trustworthy enough to chart or claim a record from.
 *
 * High confidence is necessary but not sufficient — the lift also has to have a
 * max to talk about, either seeded, stored, or observed from its own index
 * sets. Listing a lift with three dashes across the row is noise, and the
 * protocol names seven lifts, not twelve.
 */
export const trackedLifts = (state) => {
  const hasIndexSets = new Set(
    state.sets.filter((set) => set.isIndexSet && set.load != null).map((set) => set.exerciseId)
  );
  return Object.entries(state.plan.exercises)
    .filter(([id, x]) => {
      if (!x.tracksMax || x.maxConf !== 'high') return false;
      return (
        state.maxes.has(id) || state.plan.meta.seedWorkingMaxes[id] != null || hasIndexSets.has(id)
      );
    })
    .map(([id, x]) => ({ id, name: x.name }));
};

function bodyweightSeries(state) {
  return state.daily
    .filter((d) => Number.isFinite(d.bodyweight))
    .map((d) => ({ dateISO: d.dateISO, value: d.bodyweight }))
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
}

/* ═══════════════════════════════════════════════════════════════════════
   View
   ═══════════════════════════════════════════════════════════════════════ */

export function view(ctx) {
  const { state } = ctx;
  const unit = state.settings.unit;
  const focus = state.progressLift || 'benchComp';

  const bodyweight = bodyweightSeries(state);
  const averaged = rollingAverage(bodyweight, 7);
  const latestAverage = averaged.length ? averaged[averaged.length - 1].value : null;
  const gainRate = weeklySlope(averaged.slice(-21));

  const e1rms = e1rmPoints(state, focus);
  const weekly = weeklyBests(e1rms);
  const best = e1rms.length ? Math.max(...e1rms.map((p) => p.value)) : null;
  const fourWeeksAgo = weekly.length > 4 ? weekly[weekly.length - 5].value : weekly.length ? weekly[0].value : null;
  const change = best != null && fourWeeksAgo != null ? best - fourWeeksAgo : null;

  return `
  ${tiles(state, { best, change, latestAverage, gainRate, unit })}

  <h3>What to do about it</h3>
  ${flagsSection(state, { bodyweight, weekly })}

  ${liftPicker(state, focus)}

  <h3>Estimated 1RM — best per week</h3>
  <div class="card"><p>Index sets only, one point per week — that is the resolution the signal actually has. ${escape(
    state.plan.exercises[focus].name
  )}.</p>
    ${lineChart(
      weekly.map((w) => ({ label: w.weekISO.slice(5), value: toDisplay(w.value, unit) })),
      { color: 'var(--s1)', unit: ` ${unit}` }
    )}</div>

  <h3>Bodyweight — 7-day average</h3>
  <div class="card">
    ${lineChart(
      averaged.map((p) => ({ label: p.dateISO.slice(5), value: toDisplay(p.value, unit) })),
      {
        color: 'var(--s2)',
        unit: ` ${unit}`,
        band: bandFor(state, latestAverage, unit),
      }
    )}
    <p class="hint">${
      gainRate == null
        ? 'The shaded band is the target gain rate. It appears once there is enough history to draw it.'
        : `Gaining <b>${fmtNum(toDisplay(gainRate, unit), 2)} ${unit}/week</b>. The band is the target rate for where you are in the plan — adjust on 2–3 week trends, never on single readings.`
    }</p></div>

  <h3>Waist at navel</h3>
  <div class="card">
    ${lineChart(
      state.measurements
        .filter((m) => Number.isFinite(m.waist))
        .map((m) => ({ label: m.dateISO.slice(5), value: m.waist })),
      { color: 'var(--s3)', unit: ' cm' }
    )}
    <p class="hint">Waist against bodyweight is the lean-bulk discriminator. Weight up, waist flat, lifts up is what it is supposed to look like.</p></div>

  <h3>Consistency</h3>
  <div class="card">${consistency(state)}
    <p class="hint">${consistencySummary(state)} One cell per day, coloured by session. Your single biggest risk is
    not finishing 33 weeks, and this is the only view that makes adherence visible.</p></div>

  <h3>Load and reps — every set of ${escape(state.plan.exercises[focus].name)}</h3>
  <div class="card">${scatter(state, focus, unit)}
    <p class="hint">Every set you have logged, plotted as the load against the reps you got. The dashed curves join
    loads worth the <b>same estimated max</b> — a set sitting on a higher curve is a better set, whatever the rep
    count. Orange is the last fortnight: if it sits above the faded dots, you are getting stronger at every rep
    range. Rising only on the low-rep side means strength is outpacing work capacity.</p></div>

  <h3>Strength vs bodyweight</h3>
  <div class="card">${strengthVsBodyweight(weekly, averaged)}
    <p class="hint">Both indexed to 100 at the first week. If the strength line pulls away from bodyweight, the bulk is working.</p></div>

  <h3>Weekly session load</h3>
  <div class="card">${sessionLoadChart(state)}
    <p class="hint">Session RPE × duration, summed per week, with a three-week average. It usually climbs for a week or two <b>before</b> you consciously feel run down.</p></div>

  <h3>Volume by muscle</h3>
  <div class="card">${volumeOverTime(state)}
    <p class="hint">Whole-muscle roll-ups from the sets you actually logged. Catches the accessories that quietly stopped happening a month ago.</p></div>

  <h3>Records</h3>
  <div class="card">${prTimeline(state)}
    <p class="hint">Index sets on the tracked compounds only. Isolation lifts are excluded — prediction equations are known to fail on them, so a curl PR would not mean anything.</p></div>

  <h3>Block comparison</h3>
  <div class="card">${blockComparison(state)}
    <p class="hint">e1RM gained per block. After three blocks this says which structures actually worked for you, which is worth more than any general recommendation.</p></div>

  <h3>Working maxes</h3>
  ${workingMaxes(ctx)}

  <h3>Everything logged</h3>
  <div class="card flush">
    <div class="big-row" data-act="history-open-screen"><div class="ic">≡</div><div class="m"><b>History</b>
      <span>Every session, weigh-in, measurement and niggle by date — and the only place anything can be deleted</span></div>
      <div class="car">›</div></div>
  </div>

  <h3>Export</h3>
  <div class="card"><p style="margin:0">Selective export arrives with the export stage — one zip, CSV for reading and JSON for restoring. Until then, <button data-act="history-backup" style="background:none;border:0;color:var(--s1);font:inherit;font-weight:650;padding:0;cursor:pointer">download a JSON backup</button>.</p></div>`;
}

function tiles(state, { best, change, latestAverage, gainRate, unit }) {
  const strengthPerKg = best != null && latestAverage ? best / latestAverage : null;
  return `<div class="tiles">
    <div class="tile"><div class="k">Bench e1RM</div><div class="v">${
      best == null ? '—' : fmtLoad(best, unit)
    }<small> ${unit}</small></div><div class="d${best != null ? ' up' : ''}">${
      best == null ? 'no index sets yet' : 'all-time best'
    }</div></div>
    <div class="tile"><div class="k">4-week change</div><div class="v">${
      change == null ? '—' : `${change >= 0 ? '+' : ''}${fmtLoad(change, unit)}`
    }<small> ${unit}</small></div><div class="d">from index sets</div></div>
    <div class="tile"><div class="k">Bodyweight 7d</div><div class="v">${
      latestAverage == null ? '—' : fmtLoad(latestAverage, unit)
    }<small> ${unit}</small></div><div class="d${gainRate > 0 ? ' up' : ''}">${
      gainRate == null ? 'needs a few weigh-ins' : `${gainRate >= 0 ? '+' : ''}${fmtNum(toDisplay(gainRate, unit), 2)} ${unit}/wk`
    }</div></div>
    <div class="tile"><div class="k">Strength / kg</div><div class="v">${
      strengthPerKg == null ? '—' : fmtNum(strengthPerKg, 2)
    }<small> ×BW</small></div><div class="d">rising = real strength</div></div>
  </div>`;
}

function bandFor(state, latestAverage, unit) {
  if (latestAverage == null) return null;
  const week = (state.blockProgress.daysElapsed ?? 0) / 7 + 1;
  const target = week <= 12 ? { lo: 0.4, hi: 0.5 } : { lo: 0.2, hi: 0.25 };
  const start = latestAverage - target.hi * 2;
  return { lo: toDisplay(start, unit), hi: toDisplay(start + target.hi * 4, unit) };
}

function flagsSection(state, { bodyweight, weekly }) {
  const flags = decisionFlags({
    bodyweight,
    e1rmWeekly: weekly,
    sleep: state.daily.filter((d) => Number.isFinite(d.sleepHours)).map((d) => ({ dateISO: d.dateISO, value: d.sleepHours })),
    niggles: state.niggles.filter((n) => daysBetween(state.block.startedISO, n.dateISO) >= 0),
    calendarWeek: Math.floor((state.blockProgress.daysElapsed ?? 0) / 7) + 1,
  });

  if (!flags.length) {
    return flag('info', 'i', 'Nothing to report yet. Flags appear once there is enough logged to say something honest.');
  }
  return flags
    .map((f) => flag(f.kind === 'ok' ? 'ok' : f.kind === 'bad' ? 'bad' : 'warn', f.kind === 'ok' ? '✓' : '!', `<b>${escape(f.title)}.</b> ${escape(f.detail)}`))
    .join('');
}

function liftPicker(state, focus) {
  return `<div class="picker">${trackedLifts(state)
    .map(
      (lift) =>
        `<button class="pill ${lift.id === focus ? 'on' : ''}" data-act="focus-lift" data-id="${lift.id}">${escape(
          lift.name.split(' (')[0]
        )}</button>`
    )
    .join('')}</div>`;
}

function consistency(state) {
  if (!state.logs.length) return emptyChart('Nothing logged yet.');

  const first = weekStartISO(state.logs[0].dateISO);
  const today = state.todayISO;
  const total = Math.max(7, daysBetween(first, today) + 1);
  const byDate = new Map(state.logs.map((log) => [log.dateISO.slice(0, 10), log.sessionId]));

  const days = Array.from({ length: Math.ceil(total / 7) * 7 }, (_, i) => {
    const date = new Date(`${first}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + i);
    const iso = date.toISOString().slice(0, 10);
    return { dateISO: iso, sessionId: byDate.get(iso) || null };
  });

  // Column-major: the heatmap draws down each week, so rows are days.
  const columns = days.length / 7;
  const ordered = [];
  for (let col = 0; col < columns; col++) {
    for (let row = 0; row < 7; row++) ordered.push(days[col * 7 + row]);
  }
  return heatmap(ordered, { sessionColors: SESSION_COLORS });
}

/** The heatmap in one sentence, for the days you do not want to count squares. */
function consistencySummary(state) {
  if (!state.logs.length) return '';
  const first = state.logs[0].dateISO.slice(0, 10);
  const days = Math.max(1, daysBetween(first, state.todayISO) + 1);
  const trained = new Set(state.logs.map((log) => log.dateISO.slice(0, 10))).size;
  const perWeek = (trained / days) * 7;
  return `<b>${trained} training days in the last ${days}</b> — ${fmtNum(perWeek, 1)} a week.`;
}

function scatter(state, exerciseId, unit) {
  const byLog = new Map(state.logs.map((log) => [log.id, log]));
  const points = state.sets
    .filter((set) => set.exerciseId === exerciseId && set.load != null && set.reps > 0 && set.reps <= 12)
    .map((set) => {
      const log = byLog.get(set.sessionLogId);
      return {
        reps: set.reps,
        load: toDisplay(systemLoad(set.load, set.bodyweightUsed || 0), unit),
        dateISO: log?.dateISO,
        recent: log && daysBetween(log.dateISO, state.todayISO) <= 14,
      };
    });

  if (!points.length) return emptyChart('No sets logged for this lift yet.');

  const max = Math.max(...points.map((p) => p.load));
  const curves = [max * 0.85, max, max * 1.15].map((v) => Math.round(v / 5) * 5);
  return scatterIso(points, { curves, pctFor: pct, unit });
}

function strengthVsBodyweight(weekly, averaged) {
  const strength = weekly.map((w) => ({ label: w.weekISO, value: w.value }));
  const weight = weeklyBests(averaged).map((w) => ({ label: w.weekISO, value: w.value }));
  return indexedChart([
    { name: 'Strength', color: 'var(--s1)', points: strength },
    { name: 'Bodyweight', color: 'var(--s2)', points: weight },
  ]);
}

function sessionLoadChart(state) {
  const loads = weeklyLoads(state.logs);
  if (!loads.length) {
    return emptyChart('Needs a session RPE and a finish time — both come free once you finish a session.');
  }
  const items = loads.map((l) => ({ label: l.weekISO.slice(5), value: Math.round(l.value) }));
  const latest = items[items.length - 1];
  const previous = items.length > 1 ? items[items.length - 2] : null;
  const change =
    previous && previous.value
      ? `<p class="hint" style="margin-top:8px">This week <b>${latest.value}</b> against <b>${previous.value}</b> last
         week — ${
           latest.value > previous.value * 1.2
             ? 'a jump of more than 20%, which is the pattern that precedes feeling run down'
             : 'a normal week-to-week change'
         }.</p>`
      : '';

  return `${barChart(items, { color: 'var(--s1)', unit: 'sRPE × min', average: true })}${change}`;
}

function volumeOverTime(state) {
  const byLog = new Map(state.logs.map((log) => [log.id, log]));
  const byWeek = new Map();

  for (const set of state.sets) {
    const log = byLog.get(set.sessionLogId);
    if (!log) continue;
    const week = weekStartISO(log.dateISO);
    if (!byWeek.has(week)) byWeek.set(week, []);
    byWeek.get(week).push(set);
  }
  if (!byWeek.size) return emptyChart('Nothing logged yet.');

  const weeks = [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, sets]) => ({
      label: week.slice(5),
      values: rollUp(volumeFromSets(sets, state.plan.exercises), state.plan.muscles),
    }));

  return stackedBars(weeks, { keys: Object.keys(ROLL_COLORS), colors: ROLL_COLORS });
}

/**
 * Records, as a dated list with the size of each jump — plus the timeline for
 * the shape of it. A dot on an axis tells you a record happened; it does not
 * tell you what it was, and that is the part worth reading.
 */
function prTimeline(state) {
  const unit = state.settings.unit;
  const lifts = trackedLifts(state);
  const events = lifts.flatMap((lift) =>
    detectPRs(e1rmPoints(state, lift.id)).map((pr) => ({ ...pr, lift: lift.name.split(' (')[0] }))
  );
  if (!events.length) return emptyChart('No records yet — they start appearing after a few index sets.');

  events.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  const colors = Object.fromEntries(
    lifts.map((lift, i) => [lift.name.split(' (')[0], Object.values(SESSION_COLORS)[i % 6]])
  );

  // One row per lift per day: two index sets in the same session at the same
  // load are one event, not four. And the table lists records only — a tie is
  // worth plotting but a list of them buries the actual records.
  const perDay = new Map();
  for (const event of events) {
    const key = `${event.lift}:${event.dateISO}`;
    const held = perDay.get(key);
    if (!held || event.value > held.value || (event.kind === 'pr' && held.kind === 'tie')) {
      perDay.set(key, event);
    }
  }
  const deduped = [...perDay.values()].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  const records = deduped.filter((event) => event.kind === 'pr');
  const ties = deduped.length - records.length;

  const list = `<table style="margin-top:10px"><thead><tr><th>Date</th><th>Lift</th><th>e1RM</th><th>Gain</th></tr></thead><tbody>
    ${[...records]
      .reverse()
      .slice(0, 6)
      .map(
        (event) => `<tr><td>${escape(event.dateISO.slice(5))}</td><td>${escape(event.lift)}</td><td>${fmtLoad(
          event.value,
          unit
        )}</td><td>${
          event.previousBest == null
            ? '<span style="color:var(--muted)">first</span>'
            : `<span style="color:var(--goodtx);font-weight:650">+${fmtNum(event.value - event.previousBest, 1)}</span>`
        }</td></tr>`
      )
      .join('')}
  </tbody></table>
  <p class="hint" style="margin-top:8px">${records.length} record${records.length === 1 ? '' : 's'}${
    ties ? ` and ${ties} day${ties === 1 ? '' : 's'} matching a best` : ''
  } across ${new Set(deduped.map((e) => e.lift)).size} lifts. Matching your best is plotted faintly but not listed —
  it happened, and it is not progress.</p>`;

  return `${timeline(deduped, { colors })}${list}`;
}

function blockComparison(state) {
  const byBlock = new Map();
  const byLog = new Map(state.logs.map((log) => [log.id, log]));

  for (const lift of trackedLifts(state)) {
    for (const point of e1rmPoints(state, lift.id)) {
      const log = state.sets.find((s) => s.id === point.setId);
      const blockId = log ? byLog.get(log.sessionLogId)?.blockId : null;
      if (blockId == null) continue;
      if (!byBlock.has(blockId)) byBlock.set(blockId, { lift: lift.id, first: point.value, last: point.value });
      const entry = byBlock.get(blockId);
      if (entry.lift !== lift.id) continue;
      entry.first = Math.min(entry.first, point.value);
      entry.last = Math.max(entry.last, point.value);
    }
  }
  if (!byBlock.size) return emptyChart('Needs at least one finished block.');

  return barChart(
    [...byBlock.entries()]
      .sort(([a], [b]) => a - b)
      .map(([blockId, entry]) => {
        const gained = Math.round((entry.last - entry.first) * 10) / 10;
        return {
          label: state.plan.blocks[blockId]
            ? state.plan.blocks[blockId].n.split(' · ')[1] || state.plan.blocks[blockId].n
            : `Block ${blockId}`,
          value: gained,
          display: `+${gained}`,
        };
      }),
    { color: 'var(--s3)', unit: 'kg of e1RM gained' }
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Working maxes and the block review
   ═══════════════════════════════════════════════════════════════════════ */

export function maxRows(state) {
  return trackedLifts(state).map((lift) => {
    const stored = state.maxes.get(lift.id)?.workingMax ?? state.plan.meta.seedWorkingMaxes[lift.id] ?? null;
    const observations = e1rmPoints(state, lift.id).map((point) => ({
      e1rm: point.value,
      weekIndex: Math.floor(daysBetween(state.block.startedISO, point.dateISO) / 7),
      isDeload: false,
      dateISO: point.dateISO,
    }));
    const inBlock = observations.filter((o) => o.weekIndex >= 0);
    const observed = inBlock.length ? Math.max(...inBlock.map((o) => o.e1rm)) : null;

    return {
      ...lift,
      workingMax: stored,
      observed,
      overBy: stored && observed ? (observed / stored - 1) * 100 : null,
      boundary: proposeBlockBoundaryMax(stored, inBlock),
      midBlock: proposeMidBlockBump(stored, inBlock),
    };
  });
}

function workingMaxes(ctx) {
  const { state } = ctx;
  const unit = state.settings.unit;
  const rows = maxRows(state);
  const bumpable = rows.filter((r) => r.midBlock.change === 'raise');

  return `<div class="card">
    <table><thead><tr><th>Lift</th><th>Working</th><th>Observed</th><th>Δ</th></tr></thead><tbody>
      ${rows
        .map(
          (row) =>
            `<tr><td>${escape(row.name.split(' (')[0])}</td><td>${
              row.workingMax == null ? '—' : fmtLoad(row.workingMax, unit)
            }</td><td>${row.observed == null ? '—' : fmtLoad(row.observed, unit)}</td><td>${
              row.overBy == null ? '—' : `${row.overBy >= 0 ? '+' : ''}${fmtNum(row.overBy, 1)}%`
            }</td></tr>`
        )
        .join('')}
    </tbody></table>
    <p class="hint">${
      bumpable.length
        ? `<b>${bumpable.length} lift${bumpable.length === 1 ? '' : 's'} cleared 5% for two consecutive weeks</b> — the mid-block exception applies, so an early bump is offered.`
        : 'Working maxes change at block boundaries, never mid-session. A mid-block bump needs observed to exceed working by more than 5% for two consecutive weeks — one good day is noise.'
    }</p>
    ${
      state.blockProgress.readyForReview
        ? flag(
            'warn',
            '!',
            `<b>Block ${escape(state.block.label)} has reached its ${
              state.blockProgress.sessionTarget
            }-session target.</b> The review proposes new working maxes; nothing changes until you confirm each one.`
          )
        : ''
    }
    <div class="mini"><button data-act="open-review">Review working maxes</button></div>
  </div>`;
}

export const actions = {
  'history-open-screen'(ctx) {
    ctx.state.progressSection = 'history';
    ctx.render();
    window.scrollTo(0, 0);
  },

  'focus-lift'(ctx, data) {
    ctx.state.progressLift = data.id;
    ctx.render();
  },

  'open-review'(ctx) {
    const { state } = ctx;
    const unit = state.settings.unit;
    const atBoundary = state.blockProgress.readyForReview;
    const rows = maxRows(state).map((row) => ({ ...row, proposal: atBoundary ? row.boundary : row.midBlock }));
    const actionable = rows.filter((r) => r.proposal.requiresConfirmation);

    openSheet(`<div class="ttl">${atBoundary ? 'Block review' : 'Working maxes'}</div>
      <p style="font-size:13px;margin:12px 0 8px;color:var(--ink2)">${
        atBoundary
          ? 'Each proposal is the best observed e1RM from this block’s index sets. Confirm the ones you accept — nothing is applied on its own.'
          : 'Mid-block, a max only rises, and only when observed beat it by more than 5% in two consecutive weeks.'
      }</p>
      ${
        actionable.length
          ? actionable
              .map(
                (row) => `<div class="big-row" style="cursor:default">
                  <div class="m"><b>${escape(row.name.split(' (')[0])}</b>
                    <span>${row.workingMax == null ? '—' : fmtLoad(row.workingMax, unit)} → <strong style="color:var(--ink);font-weight:700">${fmtLoad(
                      row.proposal.proposed,
                      unit
                    )} ${unit}</strong>${row.proposal.capped ? ' · capped at the 5% maximum drop' : ''}${
                      row.proposal.change === 'lower' ? ' · this is a decrease' : ''
                    }</span></div>
                  <button class="setok" data-act="confirm-max" data-id="${row.id}" data-value="${
                    row.proposal.proposed
                  }" data-reason="${escape(row.proposal.reason)}">✓</button></div>`
              )
              .join('')
          : '<p style="text-align:center;font-size:13px;margin:18px 0">Nothing to change. Every working max is where the protocol says it should be.</p>'
      }
      ${
        rows.some((r) => r.proposal.change === 'lower')
          ? '<div class="flag f-warn" style="margin-top:10px"><i>!</i><span><b>A working max is going down.</b> At a block boundary it may drop by at most 5% at a time. Mid-block it never drops — a bad week is a bad week, not a strength loss.</span></div>'
          : ''
      }
      <button class="big ghost mt" data-act="sheet-close">Close</button>`);
  },

  async 'confirm-max'(ctx, data) {
    await ctx.confirmMax(data.id, Number(data.value), data.reason);
    closeSheet();
    ctx.render();
  },
};
