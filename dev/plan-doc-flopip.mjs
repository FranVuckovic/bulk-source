/**
 * Generate docs/training-plan-flopip-2.md from data/plan-flopip-2.json.
 *
 * Generated rather than written for the same reason as the original plan's
 * document: a hand-written one goes stale and nobody notices. The test in
 * `test/plan-doc.test.js` fails if the committed file is not what this
 * produces.
 *
 *   node dev/plan-doc-flopip.mjs   # write docs/training-plan-flopip-2.md
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolveSession, toDisplaySession, isAmrapRotation } from '../js/plan.js';
import { prescribedLoad, roundToIncrement } from '../js/calc.js';
import { weeklyVolume, weeklyRollUp } from '../js/volume.js';

const ROOT = new URL('..', import.meta.url);
const PLAN = JSON.parse(readFileSync(new URL('data/plan-flopip-2.json', ROOT), 'utf8'));

/** The rotation the session tables are written against, and the bench max they price. */
const ROTATION = 4;
const MAX = PLAN.meta.seedWorkingMaxes.benchComp;

const ex = (id) => PLAN.exercises[id];
const kg = (v) => (v == null ? '—' : `${roundToIncrement(v, 2.5).toFixed(1)} kg`);

function ownMax(id) {
  const from = ex(id)?.maxFrom;
  if (from) return (from.exerciseId === 'benchComp' ? MAX : PLAN.meta.seedWorkingMaxes[from.exerciseId]) * from.ratio;
  return PLAN.meta.seedWorkingMaxes[id] ?? null;
}

function loadFor(slot) {
  if (Number.isFinite(slot.fixedLoad)) return `${kg(slot.fixedLoad)} · fixed`;
  if (slot.pctBasis === 'topSingleRpe') return "from the day's single";
  if (slot.role === 'attempt') return 'test — work up';
  const own = ownMax(slot.ex);
  if (own == null) return '*by feel*';
  const load = prescribedLoad(slot, own, 2.5, { bodyweight: ex(slot.ex)?.bodyweightLoaded ? PLAN.meta.referenceBodyweightKg : 0 });
  if (load == null) return '*by feel*';
  return ex(slot.ex)?.bodyweightLoaded ? (load > 0 ? `+${kg(load)}` : 'bodyweight') : kg(load);
}

const reps = (s) => (s.amrap ? 'max' : s.repsLow === s.repsHigh ? `${s.repsLow}` : `${s.repsLow}–${s.repsHigh}`);
const effort = (s) => (s.failLast >= s.sets && s.sets > 0 ? 'to failure' : `RPE ${s.rpe}`);
const rest = (s) => (!s.restSec ? '' : s.restSec < 120 ? `${s.restSec} s` : `${(s.restSec / 60).toFixed(s.restSec % 60 ? 1 : 0)} min`);
const options = (s) =>
  (s.options || []).length > 1
    ? s.options.map((id, n) => `${String.fromCharCode(65 + n)}: ${ex(id).name}`).join(' / ')
    : '';
const strip = (html) =>
  html
    .replace(/<\/p>\s*<p>/g, '\n\n')
    .replace(/<strong>(.*?)<\/strong>/g, '**$1**')
    .replace(/<[^>]+>/g, '')
    .replace(/&mdash;/g, '—')
    .trim();

const out = [];
const push = (...lines) => out.push(...lines);

push(
  `# ${PLAN.meta.name} — the training plan`,
  '',
  '> **Generated from `data/plan-flopip-2.json` by `dev/plan-doc-flopip.mjs`. Do not edit by hand.**',
  `> Loads are shown for **rotation ${ROTATION}** at a **${MAX} kg** competition max. In the app they come from your own working maxes.`,
  '',
  `${PLAN.meta.longName}. ${PLAN.meta.sub}.`,
  '',
  '## The week',
  '',
  `Five workouts, always in this order: **${PLAN.meta.rotationOrder.join(' → ')}**. Rest **${PLAN.meta.restDays.fixed}** every week and one more day — the order never changes, the days can.`,
  '',
  '| | workout | day | trains |',
  '|---|---|---|---|'
);
for (const session of PLAN.sessions) push(`| **${session.id}** | ${session.name} | ${session.day} | ${session.trains} |`);
push('', '| rest days | the week |', '|---|---|');
for (const option of PLAN.meta.restDays.options) {
  push(`| ${option.label}${option.best ? ' **(best)**' : ''} | ${option.week.join(' · ')} |`);
}
push(
  '',
  'Bench days (B, D, E) are never back to back in any of these, and Friday — the heaviest bench — always follows the Thursday rest. Miss a day: do the next workout in the order, never two in one day.',
  ''
);

push('## The workouts', '');
for (const session of PLAN.sessions) {
  const resolved = toDisplaySession(resolveSession(PLAN, { rotation: ROTATION, sessionId: session.id }));
  push(`### ${session.id} — ${session.name}`, '', `**${session.day}.** ${session.purpose}`, '', `*${session.key}*`, '');
  push('| | exercise | sets × reps | effort | load | rest | options |', '|---|---|---|---|---|---|---|');
  for (const slot of resolved.slots) {
    push(
      `| ${slot.id} | ${ex(slot.ex).name}${slot.label ? ` — ${slot.label}` : ''} | ${slot.sets} × ${reps(slot)} | ${effort(slot)} | ${loadFor(
        slot
      )} | ${rest(slot)} | ${options(slot)} |`
    );
  }
  const total = resolved.slots.reduce((sum, slot) => sum + slot.sets, 0);
  push('', `**${total} sets.**`, '');
}

push(
  '## The blocks',
  '',
  'A rotation is one week. The blocks change the bench work; the accessories stay. In an AMRAP week the back-offs drop by one set.',
  '',
  '| rotations | block | Friday single | back-offs | Sunday paused bench | variation | Wednesday long-pause | AMRAP |',
  '|---|---|---|---|---|---|---|---|'
);
for (const block of PLAN.blocks) {
  // A week without an AMRAP where the block has one, so the back-offs read at
  // their full count — in an AMRAP week they drop by one set.
  let r = block.from;
  while (r < block.to && isAmrapRotation(PLAN, r)) r += 1;
  const get = (sessionId, slotId) => resolveSession(PLAN, { rotation: r, sessionId }).slots.find((s) => s.id === slotId);
  const e1 = get('E', 'E1');
  const e3 = get('E', 'E3');
  const b1 = get('B', 'B1');
  const b2 = get('B', 'B2');
  const d1 = get('D', 'D1');
  const amraps = [];
  for (let n = block.from; n <= block.to; n += 1) if (isAmrapRotation(PLAN, n)) amraps.push(n);
  push(
    `| ${block.from === block.to ? block.from : `${block.from}–${block.to}`} | **${block.name}** | ${
      e1?.role === 'attempt' ? 'paused max test' : `1 @ ${e1?.rpe}`
    } | ${e3 ? `${e3.sets} × ${e3.repsLow} @ ${e3.rpe}` : '—'} | ${b1 ? `${b1.sets} × ${b1.repsLow} @ ${b1.rpe}` : '—'} | ${
      b2 ? `${b2.sets} × ${b2.repsLow} @ ${b2.rpe}` : '—'
    } | ${d1 ? `${d1.sets} × ${d1.repsLow} @ ${d1.rpe}` : '—'} | ${amraps.length ? amraps.join(', ') : '—'} |`
  );
}
push('');
for (const block of PLAN.blocks) {
  push(`- **${block.name}** (${block.from === block.to ? `rotation ${block.from}` : `rotations ${block.from}–${block.to}`}): ${block.theme}`);
}
const start = new Date(`${PLAN.meta.startDateISO}T12:00:00Z`);
const fridayOf = (rotation) => {
  const date = new Date(start);
  date.setUTCDate(date.getUTCDate() + (rotation - 1) * 7 + 6);
  return date.toISOString().slice(0, 10);
};
push(
  '',
  `Rotation 1 starts on ${PLAN.meta.startDateISO}. On that calendar the tests fall on ${PLAN.blocks
    .filter((block) => block.type === 'test')
    .map((block) => `**${fridayOf(block.from)}**`)
    .join(', ')}, and the AMRAPs on ${PLAN.meta.amrapRotations.map(fridayOf).join(', ')}. The plan advances on sessions done, so a missed week moves these.`,
  ''
);

const sessions = PLAN.meta.rotationOrder.map((id) => toDisplaySession(resolveSession(PLAN, { rotation: ROTATION, sessionId: id })));
const { volume } = weeklyVolume(sessions, PLAN.exercises);
const roll = weeklyRollUp(sessions, PLAN.exercises, PLAN.muscles);
push('## Weekly volume', '', 'Fractional sets, myo-reps counted as two. The research band is roughly 10–20 sets a week.', '');
push('| muscle | sets |', '|---|---|');
for (const [id, sets] of Object.entries(volume).sort((a, b) => b[1] - a[1])) {
  push(`| ${PLAN.muscles[id]?.label || id} | ${sets.toFixed(1)} |`);
}
push('', `Whole-muscle: ${Object.entries(roll).map(([name, sets]) => `${name} ${sets.toFixed(1)}`).join(' · ')}.`, '');

push('## How it works, and what to do when it does not', '');
for (const tip of PLAN.knowledge.filter((t) => t.s === 'How this plan works')) {
  push(`### ${tip.t}`, '', strip(tip.c), '');
}

writeFileSync(new URL('docs/training-plan-flopip-2.md', ROOT), out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n');
console.log('docs/training-plan-flopip-2.md written');
