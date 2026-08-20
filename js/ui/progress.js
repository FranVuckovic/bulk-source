/**
 * ui/progress.js — the Progress screen.
 *
 * This screen calculates nothing. Every number on it comes from `analytics.js`
 * as a metric object that carries its own evidence: the window it used, how
 * many samples it had, what it excluded and why. The screen's whole job is to
 * render those objects and to refuse to render the ones that say `ok: false`.
 *
 * That split is deliberate. v1 computed metrics inside the drawing code, which
 * is how it ended up asserting things its own numbers contradicted — a rate
 * called "on target" while outside the band, a four-week change measured from
 * an all-time best, a block comparison that turned regressions into gains.
 *
 * Two older rules still run through it:
 *
 *   Indicative maxes (maxConf 'ind') prescribe loads but never appear in a
 *   chart or a record claim. Prediction equations are known to fail on
 *   isolation work, and a record you did not really set is worse than none.
 *
 *   Nothing advances by itself. Reaching a block's session target opens the
 *   review; confirming each proposed working max is a deliberate tap.
 */

import { pct, systemLoad, proposeBlockBoundaryMax, proposeMidBlockBump } from '../calc.js';
import {
  strengthSeries,
  bestPerCycle,
  alignByDate,
  trend,
  rollingMean,
  changeOver,
  gainRateVerdict,
  goalProgress,
  blockComparison as blockChanges,
  records as recordsFor,
  recordHistory,
  GAIN_TARGETS,
} from '../analytics.js';
import { weeklyLoads, decisionFlags, weekStartISO, daysBetween, shouldDeload } from '../progress.js';
import { rollUpFromSets, plannedVsCompleted } from '../volume.js';
import { resolveSession, toDisplaySession } from '../plan.js';
import { alive } from '../db.js';
import { addDays } from '../dates.js';
import { escape, fmtLoad, fmtNum, toDisplay, flag, subnav, openSheet, closeSheet } from './components.js';
import {
  barChart,
  heatmap,
  scatterIso,
  stackedBars,
  emptyChart,
  timeChart,
  groupedBars,
  indexedByDate,
  rowBars,
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

const GOAL_BENCH_KG = 140;
const CONFIDENCE_WORD = { good: 'a good fit', fair: 'a fair fit', weak: 'a weak fit' };

/* ═══════════════════════════════════════════════════════════════════════
   The pipeline, run once per render
   ═══════════════════════════════════════════════════════════════════════ */

/** Soft-deleted rows are not evidence. They are recoverable, not present. */
const liveRecords = (state) => ({ logs: alive(state.logs), sets: alive(state.sets) });

function bodyweightSeries(state) {
  return state.daily
    .filter((d) => Number.isFinite(d.bodyweight))
    .map((d) => ({ dateISO: d.dateISO, value: d.bodyweight }))
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
}

/** The gain-rate targets are training content, so they come from the plan. */
function gainTargets(state) {
  const fromPlan = state.plan.meta?.nutrition?.gainRateKgPerWeek;
  return fromPlan?.early && fromPlan?.late ? fromPlan : GAIN_TARGETS;
}

/**
 * Lifts whose estimated max is trustworthy enough to chart or claim from.
 *
 * High confidence is necessary but not sufficient — the lift also has to have a
 * max to talk about, either seeded, stored, or observed from its own index
 * sets. A row of three dashes is noise.
 */
export const trackedLifts = (state) => {
  const hasIndexSets = new Set(
    alive(state.sets).filter((set) => set.isIndexSet && set.load != null).map((set) => set.exerciseId)
  );
  return Object.entries(state.plan.exercises)
    .filter(([id, x]) => {
      if (!x.tracksMax || x.maxConf !== 'high') return false;
      return state.maxes.has(id) || state.plan.meta.seedWorkingMaxes[id] != null || hasIndexSets.has(id);
    })
    .map(([id, x]) => ({ id, name: x.name, short: x.name.split(' (')[0] }));
};

/** Kept for the working-max review, which reasons about single observations. */
export function e1rmPoints(state, exerciseId) {
  const { logs, sets } = liveRecords(state);
  return strengthSeries(sets, { exercises: state.plan.exercises, logs, exerciseId }).points;
}

/**
 * Everything the screen renders, computed once from the records.
 *
 * Built here rather than in each card so that two cards can never disagree
 * about the same number — which is exactly how v1's tile said one thing and its
 * verdict said another.
 */
function metrics(state) {
  const { logs, sets } = liveRecords(state);
  const exercises = state.plan.exercises;
  const focus = state.progressLift || 'benchComp';

  const series = strengthSeries(sets, { exercises, logs, exerciseId: focus });
  const perCycle = bestPerCycle(series.points);
  const strength = trend(perCycle.length >= 3 ? perCycle : series.points, { label: 'strength' });
  const change = changeOver(series.points, { weeks: 4 });
  const best = series.points.length ? Math.max(...series.points.map((p) => p.value)) : null;

  const bodyweight = bodyweightSeries(state);
  const averaged = rollingMean(bodyweight, 7);
  const latestAverage = averaged.length ? averaged[averaged.length - 1].value : null;
  const calendarWeek = state.planProgress.calendarWeek ?? 1;
  const gain = gainRateVerdict(bodyweight, { calendarWeek, targets: gainTargets(state) });

  const waist = state.measurements
    .filter((m) => Number.isFinite(m.waist))
    .map((m) => ({ dateISO: m.dateISO, value: m.waist }));

  return {
    focus,
    logs,
    sets,
    exercises,
    series,
    perCycle,
    strength,
    change,
    best,
    bodyweight,
    averaged,
    latestAverage,
    calendarWeek,
    gain,
    waist,
    waistTrend: trend(waist, { label: 'waist' }),
    goal: focus === 'benchComp' ? goalProgress(series.points, { goalKg: GOAL_BENCH_KG }) : null,
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   View
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Progress, in four parts.
 *
 * This was one column of twenty headings: the verdict, then every strength
 * chart, then bodyweight, then volume, then records, then the tape, then a link
 * to History at the very bottom. Nothing told you what was down there, and
 * anything you wanted twice you had to scroll to twice.
 *
 * The parts are the questions you actually arrive with. Summary answers "is
 * this working"; Strength, Body and Volume are the three things being asked
 * about, each with its own charts.
 */
const SECTIONS = [
  ['summary', 'Summary'],
  ['strength', 'Strength'],
  ['body', 'Body'],
  ['volume', 'Volume'],
];

export function view(ctx) {
  const { state } = ctx;
  const unit = state.settings.unit;
  const m = metrics(state);
  const section = state.progressSection || 'summary';
  const tabs = subnav(SECTIONS, section, 'prog-section');

  if (section === 'strength') return tabs + strengthView(ctx, state, m, unit);
  if (section === 'body') return tabs + bodyView(state, m, unit);
  if (section === 'volume') return tabs + volumeView(state, m);
  return tabs + summaryView(state, m, unit);
}

function summaryView(state, m, unit) {
  return `
  ${tiles(state, m, unit)}

  <h3>Is this going to plan?</h3>
  ${verdict(state, m, unit)}

  <h3>What to do about it</h3>
  ${flagsSection(state, m)}
  ${deloadCard(state, m)}

  <h3>Consistency</h3>
  <div class="card">${consistency(state)}
    <p class="hint">${consistencySummary(state)} One cell per day, coloured by session. Your single biggest risk is
    not finishing 33 rotations, and this is the only view that makes adherence visible.</p></div>

  <h3>Work done</h3>
  ${tonnageCard(state)}`;
}

function strengthView(ctx, state, m, unit) {
  const liftName = state.plan.exercises[m.focus].name;
  return `
  ${liftPicker(state, m.focus)}

  <h3>Estimated 1RM — ${escape(liftName.split(' (')[0])}</h3>
  ${strengthCard(state, m, unit)}

  <h3>Load and reps — every set of ${escape(liftName.split(' (')[0])}</h3>
  <div class="card">${scatter(state, m.focus, unit)}
    <p class="hint">Every set you have logged, plotted as the load against the reps you got. The dashed curves join
    loads worth the <b>same estimated max</b> — a set sitting on a higher curve is a better set, whatever the rep
    count. Orange is the last fortnight: if it sits above the faded dots, you are getting stronger at every rep
    range. Rising only on the low-rep side means strength is outpacing work capacity.</p></div>

  <h3>Records</h3>
  ${recordsCard(state, m, unit)}

  <h3>Block comparison</h3>
  ${blockCard(state, m, unit)}

  <h3>Strength against bodyweight</h3>
  ${strengthVsBodyweight(m)}

  <h3>Working maxes</h3>
  ${workingMaxes(ctx)}`;
}

function bodyView(state, m, unit) {
  return `
  <h3 style="margin-top:0">Bodyweight — 7-day average</h3>
  ${bodyweightCard(state, m, unit)}

  <h3>Waist at navel</h3>
  ${waistCard(m)}

  <h3>Tape measurements</h3>
  ${measurementsCard(state)}`;
}

function volumeView(state, m) {
  return `
  <h3 style="margin-top:0">This rotation — planned against logged</h3>
  ${plannedCard(state, m)}

  <h3>Volume by muscle, rotation by rotation</h3>
  ${volumeCard(state, m)}

  <h3>Weekly session load</h3>
  <div class="card">${sessionLoadChart(state)}
    <p class="hint">Session RPE × duration, summed per week, with a three-week average. It usually climbs for a week
    or two <b>before</b> you consciously feel run down.</p></div>`;
}

/* ═══════════════════════════════════════════════════════════════════════
   The verdict — every line states what was measured and what to do
   ═══════════════════════════════════════════════════════════════════════ */

const evidence = (metric) =>
  metric.sampleCount == null
    ? ''
    : ` <span style="color:var(--muted)">(${metric.sampleCount} readings${
        metric.spanDays ? ` over ${metric.spanDays} days` : ''
      }${metric.confidence ? `, ${CONFIDENCE_WORD[metric.confidence] || metric.confidence}` : ''})</span>`;

function verdict(state, m, unit) {
  const rows = [];

  // 1 · is the bulk running at the intended rate
  if (m.gain.ok) {
    const band = `${m.gain.target.lo}–${m.gain.target.hi} kg/week`;
    // Off the band is not the same as off the rails: the severity follows the
    // action, so a line that says "nothing to do yet" does not wear a warning.
    const acting = /kcal/.test(m.gain.action);
    rows.push([
      m.gain.status === 'in' ? 'ok' : acting ? 'warn' : 'info',
      m.gain.status === 'in'
        ? 'Gaining at the intended rate'
        : m.gain.status === 'under'
          ? 'Gaining slower than the band'
          : 'Gaining faster than the band',
      `${fmtNum(m.gain.perWeek, 2)} kg/week against a ${band} target for week ${m.calendarWeek}. ${m.gain.action}`,
      m.gain,
    ]);
  }

  // 2 · is the gain running lean
  if (m.gain.ok && m.waistTrend.ok) {
    const ratio = m.gain.perWeek > 0 ? m.waistTrend.perWeek / m.gain.perWeek : null;
    rows.push(
      ratio == null
        ? ['info', 'Lean-bulk ratio', 'Bodyweight is not rising, so there is no ratio to take.', m.waistTrend]
        : ratio < 0.35
          ? ['ok', 'The gain is running lean', `Waist rising ${fmtNum(m.waistTrend.perWeek, 2)} cm/week against ${fmtNum(m.gain.perWeek, 2)} kg/week — about ${Math.round(ratio * 100)}% as fast. Weight up, waist nearly flat, is what it is supposed to look like.`, m.waistTrend]
          : ['warn', 'Waist rising fast relative to bodyweight', `${fmtNum(m.waistTrend.perWeek, 2)} cm per ${fmtNum(m.gain.perWeek, 2)} kg. Slow the bulk regardless of what the scale says.`, m.waistTrend]
    );
  }

  // 3 · is strength moving
  if (m.strength.ok) {
    rows.push(
      m.strength.perWeek <= 0
        ? ['bad', 'Estimated max is not trending up', `${fmtNum(toDisplay(m.strength.perWeek, unit), 2)} ${unit} per week across ${m.strength.spanDays} days. Flat while gaining is a recovery or programming problem, not a food problem.`, m.strength]
        : ['ok', 'Strength is trending up', `About ${fmtNum(toDisplay(m.strength.perWeek, unit), 2)} ${unit} of estimated max per week. At this rate you add ${fmtNum(toDisplay(m.strength.perWeek * 12, unit), 1)} ${unit} over the next twelve weeks.`, m.strength]
    );
  } else {
    rows.push(['info', 'Not enough index sets to call a strength trend', `${escape(m.strength.reason)}. Index sets are the only ones that count, and only from the standard technique.`, {}]);
  }

  // 4 · the four-week change, measured at both ends
  if (m.change.ok) {
    rows.push([
      m.change.change >= 0 ? 'ok' : 'warn',
      `${m.change.change >= 0 ? 'Up' : 'Down'} ${fmtLoad(Math.abs(m.change.change), unit)} ${unit} in ${Math.round(m.change.actualDays / 7)} weeks`,
      `From ${fmtLoad(m.change.from, unit)} on ${escape(m.change.fromDateISO)} to ${fmtLoad(m.change.to, unit)} on ${escape(m.change.toDateISO)} — both ends are real index sets, not a best-ever compared against a recent one.`,
      {},
    ]);
  }

  // 5 · are you training often enough
  const pace = state.planProgress.pace;
  if (pace != null) {
    rows.push(
      pace >= 4.5
        ? ['ok', 'Training often enough', `${fmtNum(pace, 1)} sessions a week. The rotation needs about 5 to stay on the calendar.`, {}]
        : ['warn', 'Below the pace the calendar needs', `${fmtNum(pace, 1)} sessions a week. Rotations advance on sessions, so nothing is lost — but the finish date moves.`, {}]
    );
  }

  // 6 · the goal, always in kilograms
  if (m.goal?.ok && m.goal.projection) {
    rows.push([
      'info',
      `${GOAL_BENCH_KG} kg bench in ${m.goal.projection.lowWeeks}–${m.goal.projection.highWeeks} weeks`,
      `${fmtNum(m.goal.remaining, 1)} kg to go at ${fmtNum(m.goal.perWeek, 2)} kg/week. The goal is a weight on a bar, so it stays in kilograms whatever the display unit says. It is a range because a slope from ${m.goal.sampleCount} readings is not a date.`,
      m.goal,
    ]);
  } else if (m.goal?.ok && m.goal.remaining > 0) {
    rows.push(['info', `${fmtNum(m.goal.remaining, 1)} kg from the ${GOAL_BENCH_KG} kg bench`, `No projection: ${escape(m.goal.reason || 'nothing is rising yet')}.`, {}]);
  }

  if (!rows.length) {
    return flag('info', 'i', 'Log a few weeks and this becomes a straight answer about whether the bulk is working.');
  }
  return rows
    .map(([kind, title, detail, metric]) =>
      flag(kind, kind === 'ok' ? '✓' : kind === 'info' ? 'i' : '!', `<b>${escape(title)}.</b> ${escape(detail)}${evidence(metric || {})}`)
    )
    .join('');
}

function tiles(state, m, unit) {
  const strengthPerKg = m.best != null && m.latestAverage ? m.best / m.latestAverage : null;
  const change = m.change.ok ? m.change.change : null;

  return `<div class="tiles">
    <div class="tile"><div class="k">Estimated 1RM</div><div class="v">${
      m.best == null ? '—' : fmtLoad(m.best, unit)
    }<small> ${unit}</small></div><div class="d${m.best != null ? ' up' : ''}">${escape(
      state.plan.exercises[m.focus].name.split(' (')[0].toLowerCase()
    )}${m.best == null ? ' · no index sets yet' : ` · best of ${m.series.sampleCount}`}</div></div>
    <div class="tile"><div class="k">4-week change</div><div class="v">${
      change == null ? '—' : `${change >= 0 ? '+' : ''}${fmtLoad(change, unit)}`
    }<small> ${unit}</small></div><div class="d">${
      m.change.ok ? `over ${m.change.actualDays} days` : escape(m.change.reason)
    }</div></div>
    <div class="tile"><div class="k">Bodyweight 7d</div><div class="v">${
      m.latestAverage == null ? '—' : fmtLoad(m.latestAverage, unit)
    }<small> ${unit}</small></div><div class="d${m.gain.ok && m.gain.perWeek > 0 ? ' up' : ''}">${
      m.gain.ok ? `${m.gain.perWeek >= 0 ? '+' : ''}${fmtNum(m.gain.perWeek, 2)} kg/wk` : 'needs a few weigh-ins'
    }</div></div>
    <div class="tile"><div class="k">Strength / kg</div><div class="v">${
      strengthPerKg == null ? '—' : fmtNum(strengthPerKg, 2)
    }<small> ×BW</small></div><div class="d">rising = real strength</div></div>
  </div>`;
}

function flagsSection(state, m) {
  const flags = decisionFlags({
    bodyweight: m.bodyweight,
    e1rmWeekly: m.perCycle.map((p) => ({ weekISO: p.dateISO, value: p.value })),
    sleep: state.daily.filter((d) => Number.isFinite(d.sleepHours)).map((d) => ({ dateISO: d.dateISO, value: d.sleepHours })),
    niggles: state.niggles.filter((n) => daysBetween(state.cycle.localStartDate || state.todayISO, n.dateISO) >= 0),
    calendarWeek: m.calendarWeek,
  });

  if (!flags.length) {
    return flag('info', 'i', 'Nothing to report yet. Flags appear once there is enough logged to say something honest.');
  }
  return flags
    .map((f) =>
      flag(
        f.kind === 'ok' ? 'ok' : f.kind === 'bad' ? 'bad' : f.kind === 'info' ? 'info' : 'warn',
        f.kind === 'ok' ? '✓' : f.kind === 'info' ? 'i' : '!',
        `<b>${escape(f.title)}.</b> ${escape(f.detail)}`
      )
    )
    .join('');
}

function liftPicker(state, focus) {
  return `<div class="picker">${trackedLifts(state)
    .map(
      (lift) =>
        `<button class="pill ${lift.id === focus ? 'on' : ''}" data-act="focus-lift" data-id="${lift.id}">${escape(
          lift.short
        )}</button>`
    )
    .join('')}</div>`;
}

/* ═══════════════════════════════════════════════════════════════════════
   Charts
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * The exclusions worth mentioning.
 *
 * Every set that is not an index set is excluded by design, so counting those
 * would report six hundred "problems" on a healthy database. What is worth
 * saying is the set that looked eligible and was not.
 */
function notableExclusions(excluded) {
  const notable = excluded.filter((row) => row.reason !== 'not an index set');
  if (!notable.length) return '';
  const reasons = [...new Set(notable.map((row) => row.reason))].slice(0, 3).join(', ');
  return ` <b>${notable.length}</b> index set${notable.length === 1 ? '' : 's'} could not be used: ${escape(reasons)}.`;
}

function strengthCard(state, m, unit) {
  if (!m.series.points.length) {
    const why = m.series.excluded.length
      ? ` ${m.series.excluded.length} set${m.series.excluded.length === 1 ? ' was' : 's were'} set aside — most often: ${escape(
          m.series.excluded[0].reason
        )}.`
      : '';
    return `<div class="card">${emptyChart('No index sets on this lift yet.')}<p class="hint">Only index sets count, and only from the standard technique.${why}</p></div>`;
  }

  const points = m.perCycle.length >= 2 ? m.perCycle : m.series.points;
  const grouped = m.perCycle.length >= 2;

  // The fitted line is drawn from the same object the prose quotes, so the
  // picture and the sentence can never disagree.
  const fit =
    m.strength.ok && points.length >= 3
      ? (() => {
          const first = points[0];
          const firstDay = Math.round(Date.parse(`${first.dateISO}T00:00:00Z`) / 86400000);
          return {
            ok: true,
            at: (day) => first.value + m.strength.perWeek * ((day - firstDay) / 7),
          };
        })()
      : null;

  return `<div class="card">
    ${timeChart(points.map((p) => ({ ...p, value: toDisplay(p.value, unit) })), {
      color: 'var(--s1)',
      unit: ` ${unit}`,
      fit,
      label: (p) =>
        `${p.dateISO}${p.cycleSequence ? ` · rotation ${p.cycleSequence}` : ''} · ${fmtLoad(p.load, unit)}×${p.reps}${
          p.rpe ? ` @${p.rpe}` : ''
        } → ${fmtNum(p.value, 1)} ${unit}`,
    })}
    <p class="hint">${
      grouped
        ? `Best index set per rotation — that is the resolution the signal has. Spaced by date, so a gap looks like a gap.`
        : 'Every eligible index set, spaced by date.'
    } ${
      m.strength.ok
        ? `The dashed line is the fitted trend: <b>${fmtNum(toDisplay(m.strength.perWeek, unit), 2)} ${unit}/week</b>, ${
            CONFIDENCE_WORD[m.strength.confidence]
          } across ${m.strength.sampleCount} points.`
        : escape(m.strength.reason) + '.'
    }${notableExclusions(m.series.excluded)}</p></div>`;
}

function bodyweightCard(state, m, unit) {
  const targets = gainTargets(state);
  const target = m.calendarWeek <= targets.early.throughWeek ? targets.early : targets.late;

  // The corridor is anchored at the start of the phase whose band it draws, so
  // the shaded area means "where you should be by now", not a strip painted
  // around wherever you happen to be.
  const anchor =
    m.calendarWeek <= targets.early.throughWeek
      ? m.averaged[0]
      : m.averaged.find((p) => daysBetween(m.averaged[0].dateISO, p.dateISO) >= 84) || m.averaged[0];

  return `<div class="card">
    ${timeChart(m.averaged.map((p) => ({ ...p, value: toDisplay(p.value, unit) })), {
      color: 'var(--s2)',
      unit: ` ${unit}`,
      corridor: anchor
        ? { fromDateISO: anchor.dateISO, value: toDisplay(anchor.value, unit), lo: target.lo, hi: target.hi }
        : null,
      label: (p) => `${p.dateISO} · ${fmtNum(p.value, 1)} ${unit} (${p.samples}-day average)`,
    })}
    <p class="hint">${
      m.gain.ok
        ? `Gaining <b>${fmtNum(m.gain.perWeek, 2)} kg/week</b> over the last ${m.gain.spanDays} days, ${
            CONFIDENCE_WORD[m.gain.confidence]
          }. The shaded corridor is the ${target.lo}–${target.hi} kg/week target running from ${escape(
            anchor?.dateISO || ''
          )} — being inside it means you are where the plan expects, not merely moving at a plausible speed.`
        : `The corridor is the ${target.lo}–${target.hi} kg/week target. A rate needs ${escape(m.gain.reason || 'more weigh-ins')}.`
    }</p></div>`;
}

function waistCard(m) {
  return `<div class="card">
    ${timeChart(m.waist, { color: 'var(--s3)', unit: ' cm', label: (p) => `${p.dateISO} · ${fmtNum(p.value, 1)} cm` })}
    <p class="hint">Waist against bodyweight is the lean-bulk discriminator. Weight up, waist flat, lifts up is what
    it is supposed to look like.${
      m.waistTrend.ok ? ` Currently <b>${fmtNum(m.waistTrend.perWeek, 2)} cm/week</b> over ${m.waistTrend.spanDays} days.` : ''
    }</p></div>`;
}

function strengthVsBodyweight(m) {
  const rows = alignByDate(
    m.perCycle.length ? m.perCycle : m.series.points,
    m.averaged.map((p) => ({ dateISO: p.dateISO, value: p.value }))
  );

  // Index sets and weigh-ins rarely fall on the same day, so each strength
  // point takes the nearest weigh-in within three days rather than being
  // dropped — a gap in the join is honest, but a join that never happens is
  // just an empty chart.
  const byDate = new Map(m.averaged.map((p) => [p.dateISO, p.value]));
  const filled = rows.map((row) => {
    if (row.b != null) return row;
    for (let offset = 1; offset <= 3; offset++) {
      const before = byDate.get(addDays(row.dateISO, -offset));
      const after = byDate.get(addDays(row.dateISO, offset));
      if (before != null) return { ...row, b: before };
      if (after != null) return { ...row, b: after };
    }
    return row;
  });

  return `<div class="card">
    ${indexedByDate(filled, {
      names: { a: 'Strength', b: 'Bodyweight' },
      colors: { a: 'var(--s1)', b: 'var(--s2)' },
    })}
    <p class="hint">Both indexed to 100 at their first reading and joined on <b>dates</b>, not on positions — a week
    with no weigh-in leaves a gap rather than pairing your bodyweight with the wrong week's strength. If the strength
    line pulls away from bodyweight, the bulk is working.</p></div>`;
}

/**
 * What this rotation asked for against what was logged, counted the same way.
 *
 * Both sides come from `plannedVsCompleted`, so neither can be measured with a
 * different ruler — which is the bug that made v1's two volume figures
 * incomparable.
 */
function plannedCard(state, m) {
  const plannedSessions = state.plan.meta.rotationOrder.map((sessionId) =>
    toDisplaySession(resolveSession(state.plan, { rotation: state.cycle.sequence, sessionId }))
  );
  const cycleLogIds = new Set(m.logs.filter((log) => log.cycleId === state.cycle.id).map((log) => log.id));
  const loggedSets = m.sets.filter((set) => cycleLogIds.has(set.sessionLogId));

  const rows = plannedVsCompleted({
    plannedSessions,
    loggedSets,
    exercises: state.plan.exercises,
    muscles: state.plan.muscles,
  }).filter((row) => row.planned > 0 || row.completed > 0);

  if (!rows.length) return `<div class="card">${emptyChart('Nothing logged in this rotation yet.')}</div>`;

  const behind = rows.filter((row) => row.share != null && row.share < 0.7);

  return `<div class="card">
    ${groupedBars(
      rows.map((row) => ({ label: row.roll, values: { planned: row.planned, completed: row.completed } })),
      {
        series: [
          { key: 'planned', name: 'planned', color: 'var(--axis)' },
          { key: 'completed', name: 'logged', color: 'var(--s1)' },
        ],
      }
    )}
    <p class="hint">Rotation ${state.cycle.sequence}, whole-muscle sets. Both bars are counted the same way —
    largest head per set, a myo-rep cluster worth two — so they can actually be compared.${
      behind.length
        ? ` <b>${escape(behind.map((row) => row.roll).join(', '))}</b> ${behind.length === 1 ? 'is' : 'are'} under 70% of plan so far.`
        : ' Every muscle is at or near its planned volume.'
    }</p></div>`;
}

function volumeCard(state, m) {
  const byCycle = new Map();
  const logById = new Map(m.logs.map((log) => [log.id, log]));

  for (const set of m.sets) {
    const log = logById.get(set.sessionLogId);
    if (!log) continue;
    const key = log.cycleSequence ?? null;
    if (key == null) continue;
    if (!byCycle.has(key)) byCycle.set(key, []);
    byCycle.get(key).push(set);
  }
  if (!byCycle.size) return `<div class="card">${emptyChart('Nothing logged yet.')}</div>`;

  const groups = [...byCycle.entries()]
    .sort(([a], [b]) => a - b)
    .slice(-14)
    .map(([sequence, sets]) => ({
      label: String(sequence),
      values: rollUpFromSets(sets, state.plan.exercises, state.plan.muscles),
    }));

  return `<div class="card">
    ${stackedBars(groups, { keys: Object.keys(ROLL_COLORS), colors: ROLL_COLORS })}
    <p class="hint">One bar per <b>rotation</b>, not per calendar week — a rotation that took nine days is still one
    training unit. Whole-muscle roll-ups from the sets you actually logged, which is what catches the accessories
    that quietly stopped happening a month ago.</p></div>`;
}

function sessionLoadChart(state) {
  const loads = weeklyLoads(alive(state.logs));
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

/**
 * Records as concrete categories rather than dots on an axis.
 *
 * v1 drew every record as a dot on a shared timeline, which told you a record
 * happened without telling you what it was. What you actually want to know is:
 * the heaviest thing you have picked up, and the best estimate on each lift
 * that supports one.
 */
function recordsCard(state, m, unit) {
  const result = recordsFor(m.sets, { exercises: m.exercises, logs: m.logs });
  const tracked = new Set(trackedLifts(state).map((lift) => lift.id));

  const estimated = result.estimated
    .filter((row) => tracked.has(row.exerciseId))
    .sort((a, b) => b.value - a.value);
  const heaviest = result.heaviest
    .filter((row) => state.plan.exercises[row.exerciseId]?.tracksMax)
    .sort((a, b) => b.load - a.load)
    .slice(0, 8);

  if (!estimated.length && !heaviest.length) {
    return `<div class="card">${emptyChart('No records yet — they appear after a few index sets.')}</div>`;
  }

  const history = recordHistory(m.sets, { exercises: m.exercises, logs: m.logs });

  /**
   * The staircase behind a record.
   *
   * A record with only its current value tells you nothing about whether it is
   * three days old or four months old, or whether it has been creeping up or
   * jumped once and stalled. Every previous best is listed newest first, each
   * with what it gained and how long it took.
   */
  const progression = (kind, exerciseId) => {
    const steps = history[kind]?.[exerciseId] || [];
    if (steps.length < 2) {
      return steps.length === 1
        ? '<div class="rec-hist"><span>First one on record — nothing to compare it with yet.</span></div>'
        : '';
    }
    return `<div class="rec-hist">${[...steps]
      .reverse()
      .map((step, i) => {
        const isCurrent = i === 0;
        return `<div class="rec-step${isCurrent ? ' now' : ''}">
          <span class="d">${escape(step.dateISO)}</span>
          <span class="v">${fmtLoad(step.value, unit)} ${escape(unit)}</span>
          <span class="g">${
            step.gain == null
              ? 'first'
              : `+${fmtNum(step.gain, 1)} after ${step.daysSince} day${step.daysSince === 1 ? '' : 's'}`
          }</span></div>`;
      })
      .join('')}
      <p class="hint" style="margin:6px 0 0">${steps.length} record${steps.length === 1 ? '' : 's'} on this lift,
      ${fmtNum(steps[steps.length - 1].value - steps[0].value, 1)} ${escape(unit)} from the first to the latest over
      ${Math.round(
        (Date.parse(`${steps[steps.length - 1].dateISO}T00:00:00Z`) -
          Date.parse(`${steps[0].dateISO}T00:00:00Z`)) /
          86400000
      )} days.</p></div>`;
  };

  const row = (label, sub, value, small, hist = '') =>
    `<details class="rec-wrap"><summary class="rec"><div class="lb"><b>${escape(label)}</b><span>${escape(
      sub
    )}</span></div>
      <div class="vl">${escape(value)}<small> ${escape(small)}</small></div></summary>${hist}</details>`;

  // On a dip or a pull-up the stored load is what was added, but the estimate
  // is of the whole system. Printing "5.0 kg × 10 → 139.7" without saying so
  // reads like an error.
  const setLine = (r) => {
    const exercise = state.plan.exercises[r.exerciseId];
    if (!exercise?.bodyweightLoaded) return `${fmtLoad(r.load, unit)} ${unit} × ${r.reps}`;
    const bodyweight = state.settings.bodyweight;
    return `+${fmtLoad(r.load, unit)} × ${r.reps}, ${fmtLoad(systemLoad(r.load, bodyweight), unit)} ${unit} with bodyweight`;
  };

  return `<div class="card">
    ${estimated.length ? '<p class="hint" style="margin:0 0 8px">Best estimated max</p>' : ''}
    <div class="records">${estimated
      .map((r) =>
        row(
          state.plan.exercises[r.exerciseId].name.split(' (')[0],
          `${setLine(r)} on ${r.dateISO}`,
          fmtLoad(r.value, unit),
          unit,
          progression('estimated', r.exerciseId)
        )
      )
      .join('')}</div>
    ${heaviest.length ? '<p class="hint" style="margin:14px 0 8px">Heaviest load handled</p>' : ''}
    <div class="records">${heaviest
      .map((r) =>
        row(
          state.plan.exercises[r.exerciseId].name.split(' (')[0],
          `${state.plan.exercises[r.exerciseId].bodyweightLoaded ? 'added, ' : ''}for ${r.reps} rep${
            r.reps === 1 ? '' : 's'
          } on ${r.dateISO}`,
          fmtLoad(r.load, unit),
          unit,
          progression('heaviest', r.exerciseId)
        )
      )
      .join('')}</div>
    <p class="hint">Tap any record to see how it got there — every previous best, what it gained, and how long it took.</p>
    <p class="hint">Estimated maxes come only from index sets on lifts where the estimate means something — no curl
    record, because the equations are known to fail on isolation work. Heaviest load is a fact about every lift, so
    it needs no estimate at all. On pull-ups, chin-ups and dips the load shown is what was added to the bar.</p></div>`;
}

function blockCard(state, m, unit) {
  const lifts = trackedLifts(state);
  const rows = blockChanges(m.sets, { exercises: m.exercises, logs: m.logs, lifts }).filter((r) => r.change != null);

  if (!rows.length) {
    return `<div class="card">${emptyChart('Needs two index sets on the same lift within one block.')}
      <p class="hint">Each block is compared using its own first and last observation, in date order.</p></div>`;
  }

  const blockName = (id) => state.plan.blocks.find((b) => b.id === id)?.name ?? `Block ${id}`;

  // One chart per block, so the row labels are lift names rather than a block
  // name repeated down the left-hand side and cut off at the edge.
  const byBlock = new Map();
  for (const r of rows) {
    if (!byBlock.has(r.blockId)) byBlock.set(r.blockId, []);
    byBlock.get(r.blockId).push(r);
  }

  const losses = rows.filter((r) => r.change < 0);

  return `<div class="card">
    ${[...byBlock.entries()]
      .sort(([a], [b]) => a - b)
      .map(
        ([blockId, blockRows], index) => `<p class="hint" style="margin:${
          index ? '14px' : '0'
        } 0 4px"><b>${escape(blockName(blockId))}</b></p>
        ${rowBars(
          blockRows.map((r) => ({
            label: r.name.split(' (')[0],
            value: toDisplay(r.change, unit),
            display: `${r.change >= 0 ? '+' : ''}${fmtNum(toDisplay(r.change, unit), 1)}`,
          })),
          // Only the last group carries the caption; the same sentence under
          // each of three charts is noise.
          { unit: `${unit} of estimated max`, caption: index === byBlock.size - 1 ? null : false }
        )}`
      )
      .join('')}
    <p class="hint">First observation to last, <b>in date order</b> — so a block where you went backwards reads as a
    loss instead of being flipped into a gain. Every tracked lift gets its own bar.${
      losses.length
        ? ` ${losses.length} went down; a single bad index set can do that, so read it against the trend line above.`
        : ''
    }</p></div>`;
}

/* ═══════════════════════════════════════════════════════════════════════
   Cards carried over from v1, on v2 records
   ═══════════════════════════════════════════════════════════════════════ */

function consistency(state) {
  const logs = alive(state.logs);
  if (!logs.length) return emptyChart('Nothing logged yet.');

  const first = weekStartISO(logs[0].localDate || logs[0].dateISO);
  const total = Math.max(7, daysBetween(first, state.todayISO) + 1);
  const byDate = new Map(logs.map((log) => [(log.localDate || log.dateISO).slice(0, 10), log.sessionId]));

  const days = Array.from({ length: Math.ceil(total / 7) * 7 }, (_, i) => {
    const iso = addDays(first, i);
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
  const logs = alive(state.logs);
  if (!logs.length) return '';
  const first = (logs[0].localDate || logs[0].dateISO).slice(0, 10);
  const days = Math.max(1, daysBetween(first, state.todayISO) + 1);
  const trained = new Set(logs.map((log) => (log.localDate || log.dateISO).slice(0, 10))).size;
  const perWeek = (trained / days) * 7;
  return `<b>${trained} training days in the last ${days}</b> — ${fmtNum(perWeek, 1)} a week.`;
}

function scatter(state, exerciseId, unit) {
  const logs = alive(state.logs);
  const byLog = new Map(logs.map((log) => [log.id, log]));
  const points = alive(state.sets)
    .filter((set) => set.exerciseId === exerciseId && set.load != null && set.reps > 0 && set.reps <= 12)
    .map((set) => {
      const log = byLog.get(set.sessionLogId);
      if (!log) return null;
      const dateISO = (log.localDate || log.dateISO).slice(0, 10);
      return {
        reps: set.reps,
        load: toDisplay(systemLoad(set.load, set.bodyweightUsed || 0), unit),
        dateISO,
        recent: daysBetween(dateISO, state.todayISO) <= 14,
      };
    })
    .filter(Boolean);

  if (!points.length) return emptyChart('No sets logged for this lift yet.');

  const max = Math.max(...points.map((p) => p.load));
  const curves = [max * 0.85, max, max * 1.15].map((v) => Math.round(v / 5) * 5);
  return scatterIso(points, { curves, pctFor: pct, unit });
}

/** Tape measurements are the other half of a bulk — and the whole story on a cut. */
function measurementsCard(state) {
  const unit = state.settings.unit;
  const sites = [
    ['waist', 'Waist'], ['chest', 'Chest'], ['shoulders', 'Shoulders'],
    ['armL', 'Arm L'], ['armR', 'Arm R'], ['quadL', 'Quad L'], ['quadR', 'Quad R'], ['neck', 'Neck'],
  ];

  const rows = sites
    .map(([id, label]) => {
      const points = state.measurements
        .filter((m) => Number.isFinite(m[id]))
        .map((m) => ({ dateISO: m.dateISO, value: m[id] }))
        .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
      if (points.length < 2) return null;

      const firstPoint = points[0];
      const lastPoint = points[points.length - 1];
      const rate = trend(points, { label });
      return {
        id,
        label,
        points,
        first: firstPoint.value,
        firstDate: firstPoint.dateISO,
        last: lastPoint.value,
        lastDate: lastPoint.dateISO,
        change: lastPoint.value - firstPoint.value,
        rate: rate.ok ? rate.perWeek : null,
      };
    })
    .filter(Boolean);

  if (!rows.length) {
    return '<div class="card"><p style="margin:0">Two sets of measurements and this fills in. Waist at the navel is the one that matters most — it is what separates a lean bulk from a fat one.</p></div>';
  }

  const requestedFocus = state.measurementFocus || 'chest';
  const focus = rows.find((row) => row.id === requestedFocus) || rows[0];
  const bodyweight = state.daily
    .filter((d) => Number.isFinite(d.bodyweight))
    .map((d) => ({ dateISO: d.dateISO, value: d.bodyweight }))
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  const weightByDate = new Map(bodyweight.map((point) => [point.dateISO, point.value]));
  const comparison = focus.points.map((point) => {
    let weight = weightByDate.get(point.dateISO) ?? null;
    for (let offset = 1; weight == null && offset <= 3; offset++) {
      weight = weightByDate.get(addDays(point.dateISO, -offset)) ?? weightByDate.get(addDays(point.dateISO, offset)) ?? null;
    }
    return { dateISO: point.dateISO, a: point.value, b: weight };
  });
  const firstWeight = comparison.find((row) => row.b != null)?.b ?? null;
  const lastWeight = [...comparison].reverse().find((row) => row.b != null)?.b ?? null;
  const bwChange = firstWeight != null && lastWeight != null && firstWeight !== lastWeight ? lastWeight - firstWeight : null;
  const direction = focus.change === 0 ? 'held steady' : `${focus.change > 0 ? 'rose' : 'fell'} ${fmtNum(Math.abs(focus.change), 1)} cm`;

  return `<div class="card">
    <div class="measure-picks">${rows
      .map(
        (row) => `<button class="pill ${row.id === focus.id ? 'on' : ''}" data-act="measurement-focus" data-id="${row.id}">${escape(
          row.label
        )}</button>`
      )
      .join('')}</div>
    <p class="chart-title">${escape(focus.label)} · ${escape(focus.firstDate)} to ${escape(focus.lastDate)}</p>
    ${timeChart(focus.points, {
      color: 'var(--s3)',
      unit: ' cm',
      label: (point) => `${point.dateISO} · ${fmtNum(point.value, 1)} cm`,
    })}
    <p class="measure-readout"><b>${escape(focus.label)} ${direction}</b> across ${focus.points.length} readings.${
      focus.rate == null ? '' : ` The fitted rate is ${focus.rate >= 0 ? '+' : ''}${fmtNum(focus.rate, 2)} cm/week.`
    }${
      bwChange == null
        ? ''
        : ` Over matched dates, bodyweight changed <b>${bwChange >= 0 ? '+' : ''}${fmtLoad(bwChange, unit)} ${unit}</b>.`
    }</p>
    <details class="measure-compare"><summary>Compare ${escape(focus.label.toLowerCase())} with bodyweight</summary><div class="c">
      ${indexedByDate(comparison, {
        names: { a: focus.label, b: 'Bodyweight' },
        colors: { a: 'var(--s3)', b: 'var(--s2)' },
      })}
      <p class="hint">Both lines start at 100, so their directions can be compared despite using centimetres and ${escape(
        unit
      )}. A weigh-in may match a tape date by up to three days; no farther date is substituted.</p>
    </div></details>
    <table class="measure-table"><thead><tr><th>Site</th><th>First</th><th>Latest</th><th>Change</th></tr></thead><tbody>
      ${rows
        .map(
          (row) => `<tr><td>${escape(row.label)}${
            row.rate == null
              ? ''
              : `<small>${row.rate >= 0 ? '+' : ''}${fmtNum(row.rate, 2)} cm/wk</small>`
          }</td><td>${fmtNum(row.first, 1)}<small>${escape(row.firstDate)}</small></td><td>${fmtNum(row.last, 1)}<small>${escape(
            row.lastDate
          )}</small></td>
          <td style="color:${row.change > 0 ? 'var(--goodtx)' : 'var(--ink2)'};font-weight:650">${row.change >= 0 ? '+' : ''}${fmtNum(
            row.change,
            1
          )}</td></tr>`
        )
        .join('')}
    </tbody></table>
    <p class="hint">All tape values are centimetres. A rate needs at least three readings across fourteen days. Tape changes describe circumference, not body composition: repeat the same landmarks and tension before treating a difference as real.</p></div>`;
}

/** Total weight moved — useless for programming, oddly compelling at 6am. */
const TONNAGE_COMPARISONS = [
  // UK Department for Transport: the maximum fully laden weight of a
  // six-axle articulated lorry is 44 tonnes. The previous 500-tonne value was
  // more than eleven lorries accidentally treated as one.
  [44000, 'a fully laden articulated lorry'],
  [12000, 'an African elephant'],
  [1500, 'a small car'],
  [400, 'a grand piano'],
];

export function tonnageComparison(totalKg) {
  const [weightKg, thing] =
    TONNAGE_COMPARISONS.find(([kg]) => totalKg >= kg * 1.5) || TONNAGE_COMPARISONS[TONNAGE_COMPARISONS.length - 1];
  return { weightKg, thing, count: Math.max(1, Math.round(totalKg / weightKg)) };
}

function tonnageCard(state) {
  const unit = state.settings.unit;
  const logs = alive(state.logs);
  let total = 0;
  let reps = 0;
  for (const set of alive(state.sets)) {
    if (set.load == null || !set.reps) continue;
    total += systemLoad(set.load, set.bodyweightUsed || 0) * set.reps;
    reps += set.reps;
  }
  if (!total) return '<div class="card"><p style="margin:0">Nothing logged yet.</p></div>';

  const comparison = tonnageComparison(total);

  return `<div class="card">
    <p style="margin:0 0 4px;font-size:30px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums">${
      Math.round(total / 1000)
    } tonnes</p>
    <p style="margin:0">lifted across ${logs.length} sessions and ${reps.toLocaleString('en-GB')} reps — about
    <b>${escape(String(comparison.count))} × ${escape(comparison.thing)}</b>.</p>
    <p class="hint">Bodyweight counts on pull-ups, chin-ups and dips, because you lifted it.</p></div>`;
}

/** A deload is offered, never imposed — and only when two triggers agree. */
function deloadCard(state, m) {
  const sleep = state.daily.filter((d) => Number.isFinite(d.sleepHours)).slice(-7);
  const sleepMean = sleep.length >= 3 ? sleep.reduce((a, b) => a + b.sleepHours, 0) / sleep.length : null;

  // Measured against the same per-rotation series the strength chart draws, so
  // "your top set is down" means down against your own recent rotations.
  let topSetDrop = 0;
  if (m.perCycle.length >= 4) {
    const recent = m.perCycle.slice(-4);
    const average = recent.reduce((a, b) => a + b.value, 0) / recent.length;
    const last = recent[recent.length - 1].value;
    if (last < average) topSetDrop = (average - last) / average;
  }

  const start = state.cycle.localStartDate || state.todayISO;
  const verdictOnFatigue = shouldDeload({
    topSetDrop,
    sleepMean,
    nigglesThisBlock: state.niggles.filter((n) => daysBetween(start, n.dateISO) >= 0).length,
    sessionsSinceDeload: state.blockProgress.blockDone,
  });

  if (!verdictOnFatigue.recommended) return '';

  return flag(
    'warn',
    '!',
    `<b>Consider pulling a deload forward.</b> ${escape(verdictOnFatigue.reasons.join(', '))} — two triggers together.
     Nothing here is scheduled: the evidence for calendar deloads is weak, and a planned one at a programme's midpoint
     has been found to slightly reduce strength gains. This is the other case — the one where your own log says stop.
     Keep all six sessions, cut volume about 45%, drop to RPE 7, nothing to failure, for one rotation.`
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Working maxes and the block review
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * The proposals, each with the observations that produced it.
 *
 * Scoped to the current block and counted in rotations, because a rotation is
 * the training unit: "two consecutive weeks over threshold" means two
 * consecutive rotations, not two calendar weeks that may hold one session or
 * four.
 */
export function maxRows(state) {
  const blockFrom = state.block.from ?? 1;
  const blockTo = state.block.to ?? state.cycle.sequence;

  return trackedLifts(state).map((lift) => {
    const stored = state.maxes.get(lift.id)?.workingMax ?? state.plan.meta.seedWorkingMaxes[lift.id] ?? null;
    const points = e1rmPoints(state, lift.id);

    const inBlock = points
      .filter((point) => point.cycleSequence != null && point.cycleSequence >= blockFrom && point.cycleSequence <= blockTo)
      .map((point) => ({
        e1rm: point.value,
        // The "week" the protocol counts in is a rotation of the plan.
        weekIndex: point.cycleSequence - blockFrom,
        isDeload: false,
        dateISO: point.dateISO,
        cycleSequence: point.cycleSequence,
        load: point.load,
        reps: point.reps,
        rpe: point.rpe,
      }));

    const observed = inBlock.length ? Math.max(...inBlock.map((o) => o.e1rm)) : null;

    return {
      ...lift,
      workingMax: stored,
      observed,
      observations: inBlock,
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
    <table><thead><tr><th>Lift</th><th>Working</th><th>Observed</th><th>Δ</th><th>Sets</th></tr></thead><tbody>
      ${rows
        .map(
          (row) =>
            `<tr><td>${escape(row.short)}</td><td>${
              row.workingMax == null ? '—' : fmtLoad(row.workingMax, unit)
            }</td><td>${row.observed == null ? '—' : fmtLoad(row.observed, unit)}</td><td>${
              row.overBy == null ? '—' : `${row.overBy >= 0 ? '+' : ''}${fmtNum(row.overBy, 1)}%`
            }</td><td>${row.observations.length}</td></tr>`
        )
        .join('')}
    </tbody></table>
    <p class="hint">Observed is the best index set in <b>this block</b> (${escape(state.block.name)}, rotations ${
      state.block.from ?? 1
    }–${state.block.to ?? state.cycle.sequence}) — an all-time best from four blocks ago is not evidence about
    today. ${
      bumpable.length
        ? `<b>${bumpable.length} lift${bumpable.length === 1 ? '' : 's'} cleared 5% for two consecutive rotations</b> — the mid-block exception applies, so an early bump is offered.`
        : 'Working maxes change at block boundaries, never mid-session. A mid-block bump needs observed to exceed working by more than 5% for two consecutive rotations — one good day is noise.'
    }</p>
    ${
      state.blockProgress.readyForReview
        ? flag(
            'warn',
            '!',
            `<b>Block ${escape(state.block.name)} has reached its ${
              state.blockProgress.sessionTarget
            }-session target.</b> The review proposes new working maxes; nothing changes until you confirm each one.`
          )
        : ''
    }
    <div class="mini"><button data-act="open-review">Review working maxes</button></div>
  </div>`;
}

export const actions = {
  'prog-section'(ctx, data) {
    ctx.goTo({ tab: 'prog', progressSection: data.id });
  },

  /** History is its own bottom section now, not a room off the back of this one. */
  'history-open-screen'(ctx) {
    ctx.goTo({ tab: 'log', logSection: 'entries' });
  },

  'focus-lift'(ctx, data) {
    ctx.state.progressLift = data.id;
    ctx.render();
  },

  'measurement-focus'(ctx, data) {
    ctx.state.measurementFocus = data.id;
    ctx.render();
  },

  'open-review'(ctx) {
    const { state } = ctx;
    const unit = state.settings.unit;
    const atBoundary = state.blockProgress.readyForReview;
    const rows = maxRows(state).map((row) => ({ ...row, proposal: atBoundary ? row.boundary : row.midBlock }));
    const actionable = rows.filter((r) => r.proposal.requiresConfirmation);

    // Every proposal shows the sets it rests on. A number you are asked to
    // confirm without being shown where it came from is not a decision.
    const workings = (row) =>
      row.observations.length
        ? `<div class="hint" style="margin:2px 0 0">${row.observations
            .slice(-4)
            .map(
              (o) =>
                `r${o.cycleSequence} · ${fmtLoad(o.load, unit)}×${o.reps}${o.rpe ? `@${o.rpe}` : ''} → ${fmtNum(
                  toDisplay(o.e1rm, unit),
                  1
                )}`
            )
            .join(' · ')}</div>`
        : '<div class="hint" style="margin:2px 0 0">no index sets in this block</div>';

    openSheet(`<div class="ttl">${atBoundary ? 'Block review' : 'Working maxes'}</div>
      <p style="font-size:13px;margin:12px 0 8px;color:var(--ink2)">${
        atBoundary
          ? 'Each proposal is the best observed estimate from this block’s index sets, with those sets listed under it. Confirm the ones you accept — nothing is applied on its own.'
          : 'Mid-block, a max only rises, and only when observed beat it by more than 5% in two consecutive rotations.'
      }</p>
      ${
        actionable.length
          ? actionable
              .map(
                (row) => `<div class="big-row" style="cursor:default;align-items:flex-start">
                  <div class="m"><b>${escape(row.short)}</b>
                    <span>${row.workingMax == null ? '—' : fmtLoad(row.workingMax, unit)} → <strong style="color:var(--ink);font-weight:700">${fmtLoad(
                      row.proposal.proposed,
                      unit
                    )} ${unit}</strong>${row.proposal.capped ? ' · capped at the 5% maximum drop' : ''}${
                      row.proposal.change === 'lower' ? ' · this is a decrease' : ''
                    }</span>${workings(row)}</div>
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
