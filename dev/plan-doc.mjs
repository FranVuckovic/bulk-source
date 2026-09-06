/**
 * Generate docs/training-plan.md from data/plan-fopip-v2.json.
 *
 * The plan document is generated, not written, because the hand-written one
 * went stale and nobody noticed. `docs/bulk-plan.md` still describes v1's
 * session letters — C as bench volume, D as speed, E as the variation and
 * AMRAP — which have all moved. Following it would send him to the wrong
 * session on the wrong day.
 *
 * `test/plan-doc.test.js` fails if the committed file is not what this script
 * produces, so the document cannot drift from the plan again.
 *
 *   node dev/plan-doc.mjs          # write docs/training-plan.md
 *   node dev/plan-doc.mjs --check  # exit 1 if it is out of date
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolveSession, toDisplaySession } from '../js/plan.js';
import { prescribedLoad, roundToIncrement, pct, AMRAP_FRACTION } from '../js/calc.js';
import { weeklyVolume } from '../js/volume.js';

const ROOT = new URL('..', import.meta.url);
const PLAN = JSON.parse(readFileSync(new URL('data/plan-fopip-v2.json', ROOT), 'utf8'));

/** The rotation this document is written against, and the max it prices. */
const ROTATION = 3;
const MAX = 120;

const ex = (id) => PLAN.exercises[id];
const round = (v) => roundToIncrement(v, 2.5);
const kg = (v) => (v == null ? '—' : `${round(v).toFixed(1)} kg`);

/** What this lift's own max is, at the reference competition max. */
function ownMax(id) {
  const from = ex(id)?.maxFrom;
  if (from) return MAX * from.ratio;
  return PLAN.meta.seedWorkingMaxes[id] != null ? MAX : null;
}

function loadFor(slot) {
  if (slot.role === 'attempt') return `${kg(slot.attemptStart ?? MAX)} · +2.5 kg a week`;
  if (Number.isFinite(slot.fixedLoad)) return `${kg(slot.fixedLoad)} · fixed`;
  if (Number.isFinite(slot.pct) && slot.pctBasis === 'workingMax') return `${kg(MAX * slot.pct)} · ${(slot.pct * 100).toFixed(0)}%`;
  if (slot.pctBasis === 'topSingleRpe') return "from the day's single";
  const own = ownMax(slot.ex);
  if (own == null) return '*by RPE*';
  const load = prescribedLoad(slot, own, 2.5);
  return load == null ? '*by RPE*' : kg(load);
}

const reps = (s) => (s.amrap ? 'max' : s.repsLow === s.repsHigh ? `${s.repsLow}` : `${s.repsLow}–${s.repsHigh}`);
const rest = (s) => (!s.restSec ? '' : s.restSec < 120 ? `${s.restSec} s` : `${(s.restSec / 60).toFixed(s.restSec % 60 ? 1 : 0)} min`);

const badges = (s) =>
  [s.amrap ? 'AMRAP' : null, s.idx ? 'index' : null, s.role === 'attempt' ? 'ATTEMPT' : null, s.myoOption ? 'myo' : null]
    .filter(Boolean)
    .join(', ');

function sessionTable(sessionId) {
  const resolved = toDisplaySession(resolveSession(PLAN, { rotation: ROTATION, sessionId }));
  const rows = resolved.slots.map((s) => {
    const name = ex(s.ex)?.name ?? s.ex;
    return `| ${s.id} | ${name} | ${s.sets} × ${reps(s)} @ RPE ${s.rpe} | ${loadFor(s)} | ${rest(s)} | ${badges(s)} |`;
  });
  const sets = resolved.slots.reduce((t, s) => t + s.sets, 0);
  return { rows, sets, resolved };
}

const order = PLAN.meta.rotationOrder;
const restBefore = 'C';
const week = [];
for (const id of order) {
  if (id === restBefore) week.push('rest');
  week.push(id);
}

const out = [];
const w = (...lines) => out.push(...lines);

w(`# ${PLAN.meta.longName ?? PLAN.meta.name} — the training plan`, '');
w('> **Generated from `data/plan-fopip-v2.json` by `dev/plan-doc.mjs`. Do not edit by hand.**',
  `> Regenerate with \`node dev/plan-doc.mjs\`. Loads are shown for **rotation ${ROTATION}** at a **${MAX} kg** competition max.`, '');
w(PLAN.meta.sub ?? '', '');

/* ── the week ───────────────────────────────────────────────────────────── */
w('## How to run it', '');
w(`The rotation is **${order.join(' · ')}**, and it repeats. It is a training unit, not a calendar week — you always just do the next one.`, '');
w('The recommended week, which is how it is actually run:', '');
w('| day | session | |', '|---|---|---|');
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
week.forEach((id, i) => {
  const s = id === 'rest' ? null : PLAN.sessions.find((x) => x.id === id);
  w(`| ${DAYS[i] ?? ''} | ${id === 'rest' ? '**rest**' : `**${id}**`} | ${s ? s.name : 'The rest day goes immediately before C — C is the measurement session and a tired reading is a corrupted reading.'} |`);
});
w('');
w('Four pressing days in seven means at least one adjacent pair, always. This order leaves exactly one, E → F, in that direction: the speed work is the most fatigue-sensitive thing in the plan so it takes the tired slot, and E\'s volume is RPE-autoregulated so it degrades gracefully. A gets two clear days behind it, and C gets the rest day.', '');

/* ── the bench map ──────────────────────────────────────────────────────── */
w('## The bench: five lifts, five numbers', '');
w('Every variation has its own 1RM, stated as a fraction of the competition max. The app multiplies to get the variation\'s max, then applies the RPE table to get the working weight. Confirm a real max for a lift and the ratio stops being used.', '');
w('| lift | ratio | band | its max | where |', '|---|---|---|---|---|');
const homes = {};
for (const s of PLAN.sessions) for (const sl of s.slots) if (/^bench/.test(sl.ex)) (homes[sl.ex] ??= []).push(sl.id);
const benchIds = ['benchComp', 'benchSpeed', ...Object.keys(PLAN.exercises).filter((k) => /^bench/.test(k) && !['benchComp', 'benchSpeed'].includes(k) && !/retired/i.test(PLAN.exercises[k].name))];
for (const id of benchIds) {
  const e = ex(id);
  const from = e.maxFrom;
  const band = from?.range ? `${(from.range[0] * 100).toFixed(0)}–${(from.range[1] * 100).toFixed(0)}%` : '—';
  const ratio = from
    ? `${(from.ratio * 100).toFixed(0)}%`
    : id === 'benchComp'
      ? '**the anchor**'
      : 'n/a — a stated % of the competition max';
  const where = homes[id]?.join(', ') ?? '*substitute only*';
  w(`| ${e.name} | ${ratio} | ${band} | ${kg(ownMax(id))} | ${where} |`);
}
w('');
w('**The competition bench is always controlled touch-and-go.** All paused competition-grip work lives in the long-pause lift, so the two keep separate numbers and neither pollutes the other.', '');
w(`**The attempt** opens at ${kg(PLAN.sessions.find((s) => s.id === 'C').slots.find((s) => s.role === 'attempt')?.attemptStart)} and adds 2.5 kg after every one you make. A miss repeats the same weight. Made writes it as the new working max, and everything above recalculates from it.`, '');
w(`**The AMRAP** is a fixed 100 kg, paused style logged, so it measures reps at a constant load rather than estimating a max the attempt already measures directly.`, '');

/* ── the sessions ───────────────────────────────────────────────────────── */
w('## The sessions', '');
let total = 0;
for (const id of order) {
  const session = PLAN.sessions.find((s) => s.id === id);
  const { rows, sets } = sessionTable(id);
  total += sets;
  w(`### ${id} — ${session.name}`, '');
  w(`*${session.purpose}*`, '');
  w('| | exercise | sets × reps @ RPE | load | rest | |', '|---|---|---|---|---|---|');
  w(...rows);
  w('', `**${sets} sets.** ${session.key}`, '');
}
w(`**${total} sets a rotation.**`, '');

/* ── blocks ─────────────────────────────────────────────────────────────── */
w('## The blocks', '');
w('Blocks change sets, reps, RPE and how much accessory volume runs. They no longer change *which* variation you do — that is fixed now, one per session.', '');
w('| # | rotations | block | accessory | what changes |', '|---|---|---|---|---|');
for (const b of PLAN.blocks) {
  w(`| ${b.id} | ${b.from === b.to ? b.from : `${b.from}–${b.to}`} | **${b.name}** | ${(b.accessoryMultiplier * 100).toFixed(0)}% | ${(b.changes ?? []).join('; ')} |`);
}
w('');

/* ── volume ─────────────────────────────────────────────────────────────── */
w('## Weekly volume', '');
w('Fractional sets: a set counts for each muscle in proportion to how much it does. The band is 10–20 sets a week.', '');
const sessions = PLAN.sessions.map((s) => resolveSession(PLAN, { rotation: ROTATION, sessionId: s.id }));
const v = weeklyVolume(sessions, PLAN.exercises);
w('| muscle | sets | sessions | |', '|---|---|---|---|');
for (const [m, n] of Object.entries(v.volume).sort((a, b) => b[1] - a[1])) {
  const flag = n > 20 ? 'above the band — deliberate, this is a bench plan' : n < 10 ? 'below the band' : '';
  w(`| ${m} | ${n.toFixed(1)} | ${v.frequency[m] ?? 0} | ${flag} |`);
}
w('');

/* ── how the numbers work ───────────────────────────────────────────────── */
w('## Where every number comes from', '');
w('- **Working load** = the lift\'s own max × the RPE table\'s percentage for that slot\'s reps and RPE. Nothing is a fixed percentage of anything except the AMRAP and the speed work.',
  `- **Speed work** is a stated percentage of the competition max (${(PLAN.blocks[1].bench.F.speed.pct * 100).toFixed(0)}% in Accumulation I), not an RPE lookup, because the point is bar speed rather than effort.`,
  `- **The AMRAP** is a fixed load. It used to be ${(AMRAP_FRACTION * 100).toFixed(0)}% of the working max; it is a constant weight now so the rep count is the measurement.`,
  '- **Back-offs** are taken from the day\'s actual top single and the target RPE, not from a fixed share of the working max.',
  '- **Recalibrating a ratio**: set the weight from the percentage, log the RPE as information, and after three or four exposures move the ratio 0.02 if the RPE is consistently a point high or low. Sanity-check the *working weight*, never the derived max — a small ratio error is multiplied twice before it reaches the bar.',
  '- **The fastest way out of guessing** is to confirm a real max for each variation. One heavy set of each and the ratios stop being used at all.', '');

writeFileSync(new URL('docs/training-plan.md', ROOT), out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n');
console.log('docs/training-plan.md written');
