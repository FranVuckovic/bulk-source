/**
 * ui/plan.js — the Plan screen: where you are, the exercises, the workouts,
 * the knowledge base, the weekly stimulus and the block progression.
 *
 * The plan is data. Everything on this screen is rendered from the JSON file,
 * which is why adding a second programme later is a file rather than a feature.
 */

import { weeklyVolume, sessionVolume, rollUp, weeklyRollUp, bandStatus, DIMINISHING_RETURNS_SETS } from '../volume.js';
import { resolveSession, toDisplaySession } from '../plan.js';
import { escape, subnav } from './components.js';
import { estimateMinutes } from './train.js';

const VOLUME_SCALE = 24;

/**
 * The Plan screen's parts, across the top.
 *
 * Exercises, Workouts and the tips used to be a list of three rows part-way
 * down the overview: you had to scroll past the whole plan summary to discover
 * that the exercise reference existed at all, and every trip between them went
 * back through the overview. They are tabs now.
 */
const SECTIONS = (state) => [
  ['overview', 'Overview'],
  ['workouts', 'Workouts', String(state.plan.sessions.length)],
  ['exercises', 'Exercises', String(Object.keys(state.plan.exercises).length)],
  ['blocks', 'Blocks'],
  ['tips', 'Tips'],
];

export function view(ctx) {
  const { state } = ctx;
  const current = state.planSection || 'overview';
  const tabs = subnav(SECTIONS(state), current, 'plan-section', 'plan-tabs');

  if (current === 'exercises') return tabs + exercisesView(state);
  if (current === 'workouts') return tabs + workoutsView(state);
  if (current === 'tips') return tabs + tipsView(state);
  if (current === 'blocks') return tabs + blocksView(state);
  return tabs + overview(state);
}

/**
 * The six sessions of the rotation you are actually on.
 *
 * The static definitions in the plan file are the shape of a session; what you
 * will really do depends on the block — its accessory multiplier, its bench
 * variation, its failure wave. Reading volume off the static file would report
 * the same stimulus in a recovery rotation as in an intensification one.
 */
function rotationSessions(state) {
  return state.plan.meta.rotationOrder.map((sessionId) =>
    toDisplaySession(resolveSession(state.plan, { rotation: state.cycle.sequence, sessionId }))
  );
}

function overview(state) {
  const sessions = rotationSessions(state);
  const { volume, frequency } = weeklyVolume(sessions, state.plan.exercises);
  const wholeMuscle = weeklyRollUp(sessions, state.plan.exercises, state.plan.muscles);
  const done = state.blockProgress.blockDone;
  const target = state.blockProgress.sessionTarget;
  const pace = state.planProgress.pace;
  const week = state.planProgress.calendarWeek ?? 1;
  // The plan is measured in rotations. Calendar weeks are a report, not a
  // schedule — v1 summed a `weeks` field the v2 blocks do not have, and
  // printed "week 14 of NaN".
  const rotation = state.cycle.sequence;
  const totalRotations = state.plan.meta.rotations;
  const nextSession = state.plan.sessions.find((s) => s.id === state.position.nextSessionId);

  return `
  <div class="shead"><div class="lbl">Active plan</div><div class="nm">${escape(state.plan.meta.name)}</div>
    <p class="why" style="margin-bottom:6px"><b>${escape(state.plan.meta.longName)}</b></p>
    <p class="why">${escape(state.plan.meta.sub)}</p>
    <div class="bar"><i style="width:${Math.min(100, (rotation / totalRotations) * 100)}%"></i></div>
    <div class="meta"><span>Rotation ${rotation} of ${totalRotations} · ${escape(state.block.name)}</span><span>${state.plan.meta.rotationOrder.join(
      ' → '
    )}</span></div></div>

  <details class="card overview-fold" open><summary>Where you are <span>${done} / ${target} sessions</span></summary><div class="c">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
      <b style="font-size:15px">${escape(state.block.name)}</b>
      <span style="font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums">${done} / ${target} sessions</span></div>
    <div class="bar"><i style="width:${target ? Math.min(100, (done / target) * 100) : 0}%"></i></div>
    <table style="margin-top:12px"><tbody>
      <tr><td>Sessions logged, all time</td><td>${state.planProgress.sessionsDone}</td></tr>
      <tr><td>Next in rotation</td><td><b>${escape(state.position.nextSessionId ?? '—')}</b>${
        nextSession ? ` — ${escape(nextSession.name)}` : ''
      }</td></tr>
      <tr><td>Rotation</td><td>${rotation} of ${totalRotations}</td></tr>
      <tr><td>Calendar week</td><td>${week}${
        state.projection?.weeksTotal ? ` · on this pace the 33 rotations take about ${state.projection.weeksTotal} weeks` : ''
      }</td></tr>
      <tr><td>Actual pace</td><td>${pace == null ? '—' : `${pace.toFixed(1)} sessions / week`}</td></tr>
    </tbody></table>
    ${paceFlag(state, pace, totalRotations)}
    <p class="hint">Nothing advances silently. When you reach ${target} sessions the app opens a block review: your best lifts, the proposed working-max updates, and what changes next block. You confirm it.</p>
  </div></details>

  <h3>Stimulus this rotation · all six sessions</h3>
  <div class="lg"><span><i style="background:var(--s3)"></i>in range</span><span><i style="background:var(--warn)"></i>below</span><span><i style="background:var(--s1)"></i>slightly above</span><span><i style="background:var(--s2)"></i>materially above</span></div>
  <p class="hint stimulus-intro">The target bands are guardrails, not pass/fail boundaries. A value up to 15% or two
  fractional sets above its band is shown as <b>slightly above</b>; orange is reserved for a material overage. Neither
  colour changes the programme on its own — performance, joints, soreness and recovery decide whether volume is too high.</p>
  ${volumeBars(state, volume, frequency, wholeMuscle)}
  <p class="hint" style="margin:0 2px 14px">Fractional sets — a set where the muscle is the main mover counts 1.0, a meaningful supporting role counts 0.5, and anything under 0.3 is not counted at all. Speed bench counts <b>zero</b>: at RPE 5–6 it is motor-pattern practice, not a growth stimulus.</p>

  <details class="card overview-fold"><summary>If six sessions is not possible</summary><div class="c">
    <p style="margin:0 0 8px"><strong>Four days</strong> — you lose the speed day and session F. Bench drops to three exposures, volume by about 20%. Sustainable indefinitely.</p>
    ${state.plan.fallbacks.fourDay
      .map((d) => `<div class="big-row" style="cursor:default"><div class="ic">${d.n}</div><div class="m"><b>${escape(d.contents)}</b></div></div>`)
      .join('')}
    <p style="margin:12px 0 8px"><strong>Three days</strong> — Christmas and travel. A maintenance dose: you will not gain much, and you will not lose anything either.</p>
    ${state.plan.fallbacks.threeDay
      .map((d) => `<div class="big-row" style="cursor:default"><div class="ic">${d.n}</div><div class="m"><b>${escape(d.contents)}</b></div></div>`)
      .join('')}
    <p class="hint">Only switch when you know in advance you will be limited for two weeks or more. A single missed day is not a decision — the rotation just slides.</p>
  </div></details>`;
}

/**
 * Periodisation — what changes and when.
 *
 * Reached from the tabs above and from the rotation chip in the header, which
 * is exactly the question the chip raises: rotation 12 of 33, of what?
 */
function blocksView(state) {
  return `
  <div class="shead"><div class="lbl">Periodisation</div><div class="nm">Rotation ${state.cycle.sequence} of ${
    state.plan.meta.rotations
  }</div>
    <p class="why">${escape(state.block.name)} — ${escape(state.block.theme)}</p>
    <div class="bar"><i style="width:${Math.min(100, (state.cycle.sequence / state.plan.meta.rotations) * 100)}%"></i></div>
    <div class="meta"><span>${state.blockProgress.blockDone} / ${
    state.blockProgress.sessionTarget
  } sessions this rotation</span></div></div>

  <h3 id="periodisation">Blocks through March — what changes and when</h3>
  <div class="card">${state.plan.blocks
    .map(
      (block) => `<details ${block.id === state.block.idx ? 'open' : ''}><summary>${escape(block.name)} <span style="font-weight:500;color:var(--muted);font-size:12px">rotations ${block.from}–${block.to}</span></summary><div class="c">
      <p style="margin:0 0 10px">${escape(block.theme)}</p>
      <table style="margin-bottom:10px"><tbody>
        <tr><td>Rotations</td><td>${block.from}–${block.to}</td></tr>
        <tr><td>Type</td><td>${escape(block.type)}</td></tr>
        <tr><td>Bench variation</td><td>${escape(block.variation)}</td></tr>
        <tr><td>Accessory volume</td><td>${Math.round(block.accessoryMultiplier * 100)}%</td></tr>
        <tr><td>Failure mode</td><td>${escape(block.effortWave || 'none')}</td></tr>
      </tbody></table>
      <p style="margin:0 0 4px"><strong>What is different this block</strong></p>
      <ul>${block.changes.map((c) => `<li>${escape(c)}</li>`).join('')}</ul>
    </div></details>`
    )
    .join('')}</div>`;
}

function paceFlag(state, pace, totalRotations) {
  if (pace == null) {
    return `<div class="flag f-info" style="margin-top:11px"><i>i</i><span>Pace appears once a few sessions are logged. Rotations advance on <b>sessions completed</b>, never on dates.</span></div>`;
  }
  if (state.blockProgress.behind) {
    // Six sessions per rotation, so the finish date follows from the pace and
    // the rotations left — not from a week count the plan does not have.
    const weeksLeft = Math.round(((totalRotations - state.cycle.sequence + 1) * 6) / pace);
    return `<div class="flag f-warn" style="margin-top:11px"><i>!</i><span><b>Running behind the calendar.</b> Rotations advance on <b>sessions completed</b>, not on dates — so nothing is lost and nothing gets skipped. But at ${pace.toFixed(
      1
    )} sessions/week the ${totalRotations - state.cycle.sequence + 1} rotations left take about <b>${weeksLeft} more weeks</b>. Train more often, or accept a later date.</span></div>`;
  }
  return `<div class="flag f-ok" style="margin-top:11px"><i>✓</i><span><b>On pace.</b> ${pace.toFixed(
    1
  )} sessions per week. Blocks advance on sessions completed, so the calendar and your training are still in step.</span></div>`;
}

function volumeBars(state, volume, frequency, wholeMuscle = null) {
  const groups = [...new Set(Object.values(state.plan.muscles).map((m) => m.grp))];

  return groups
    .map((group) => {
      const ids = Object.keys(state.plan.muscles).filter((id) => state.plan.muscles[id].grp === group);
      // The whole-muscle figure counts the largest head per set, not the sum of
      // the heads. Summing them is how one incline fly became 1.3 sets of chest.
      const rollNames = new Set(ids.map((id) => state.plan.muscles[id].roll).filter(Boolean));
      const rolls = wholeMuscle
        ? Object.fromEntries([...rollNames].map((name) => [name, wholeMuscle[name] || 0]))
        : rollUp(
            Object.fromEntries(ids.map((id) => [id, volume[id] || 0])),
            state.plan.muscles
          );
      const rollText = Object.entries(rolls)
        .map(
          ([name, value]) =>
            `<b>${escape(name)} ${value.toFixed(1)}</b>${
              value >= DIMINISHING_RETURNS_SETS
                ? ' — specialisation volume; additional returns are likely smaller'
                : value >= 14
                  ? ' — in the productive range'
                  : ''
            }`
        )
        .join(' · ');

      const presentations = ids.map((id) => {
        const muscle = state.plan.muscles[id];
        const value = volume[id] || 0;
        const status = bandStatus(value, muscle);
        const allowance = Math.max(2, muscle.hi * 0.15);
        const tone = status === 'over' && value - muscle.hi <= allowance ? 'slightly-over' : status;
        return { id, muscle, value, status, tone };
      });
      const counts = presentations.reduce((result, row) => {
        result[row.tone] = (result[row.tone] || 0) + 1;
        return result;
      }, {});
      const summary = [
        counts.in ? `${counts.in} in range` : '',
        counts['slightly-over'] ? `${counts['slightly-over']} slightly above` : '',
        counts.over ? `${counts.over} materially above` : '',
        counts.under ? `${counts.under} below` : '',
      ]
        .filter(Boolean)
        .join(' · ');

      const bars = presentations
        .map((id) => {
          const { muscle, value, status, tone } = id;
          const color =
            tone === 'under' ? 'var(--warn)' : tone === 'over' ? 'var(--s2)' : tone === 'slightly-over' ? 'var(--s1)' : 'var(--s3)';
          const stateText =
            status === 'under'
              ? `${(muscle.lo - value).toFixed(1)} below`
              : status === 'over'
                ? `+${(value - muscle.hi).toFixed(1)} ${tone === 'slightly-over' ? 'slightly above' : 'above'}`
                : 'in range';
          return `<div class="vol"><div class="r1"><b>${escape(muscle.label)}</b>
            <em>${value.toFixed(1)} sets <span class="f">· ${frequency[id.id] || 0}×/wk · ${stateText}</span></em></div>
            <div class="track"><div class="band" style="left:${(muscle.lo / VOLUME_SCALE) * 100}%;width:${
              ((muscle.hi - muscle.lo) / VOLUME_SCALE) * 100
            }%"></div><div class="fill" style="width:${Math.min(100, (value / VOLUME_SCALE) * 100)}%;background:${color}"></div></div></div>`;
        })
        .join('');

      return `<details class="card stimulus-group"><summary>${escape(group)} <span>${escape(summary)}</span></summary><div class="c">${bars}${
        rollText
          ? `<p class="hint" style="margin-top:11px">Counted the way the research does — whole muscle, not per head — that is ${rollText}. The familiar <b>~20 sets/week</b> figure uses those units, not the split ones above.</p>`
          : ''
      }</div></details>`;
    })
    .join('');
}

/* ═══════════════════════════════════════════════════════════════════════
   Sub-sections
   ═══════════════════════════════════════════════════════════════════════ */

function exercisesView(state) {
  const usedIn = (id) => state.plan.sessions.filter((s) => s.slots.some((slot) => slot.ex === id)).map((s) => s.id);
  const search = state.exerciseSearch || '';
  const entries = Object.entries(state.plan.exercises).filter(([, x]) =>
    x.name.toLowerCase().includes(search.toLowerCase())
  );

  return `<h3 style="margin-top:0">Exercises</h3>
  <p style="margin:0 2px 12px">How to perform it, what it trains, why it is in the plan, and what to use instead if the equipment is taken.</p>
  <div style="margin:0 0 11px"><input type="search" placeholder="Search ${
    Object.keys(state.plan.exercises).length
  } exercises…" value="${escape(search)}" data-act-input="exercise-search"></div>
  <div class="card">${
    entries.length
      ? entries
          .map(([id, x]) => {
            const primary = Object.entries(x.m)
              .filter(([, w]) => w >= 0.9)
              .map(([m]) => state.plan.muscles[m].label);
            const secondary = Object.entries(x.m)
              .filter(([, w]) => w < 0.9 && w >= 0.3)
              .map(([m, w]) => `${state.plan.muscles[m].label} (${w})`);

            return `<details id="x-${escape(id)}"><summary>${escape(x.name)}</summary><div class="c">
              <div>${primary.map((p) => `<span class="tag p">${escape(p)}</span>`).join('')}${secondary
                .map((p) => `<span class="tag">${escape(p)}</span>`)
                .join('')}${
              !primary.length && !secondary.length ? '<span class="tag">no counted hypertrophy stimulus by design</span>' : ''
            }</div>
              <p style="margin:10px 0 4px"><strong>Why it is in the plan.</strong> ${escape(x.why)}</p>
              <p style="margin:0 0 4px"><strong>Used in:</strong> ${
                usedIn(id).map((s) => `Session ${s}`).join(', ') || '—'
              }</p>
              <p style="margin:10px 0 4px"><strong>How to perform it</strong></p>
              <ul>${x.how.map((h) => `<li>${escape(h)}</li>`).join('')}</ul>
              <p style="margin:8px 0 4px"><strong>If you cannot do it:</strong> ${x.subs.map(escape).join(' · ')}</p>
              <p style="margin:8px 0 4px"><strong>Rest:</strong> ${x.defaultRestSec} seconds${
                x.bodyweightLoaded ? ' · bodyweight counts as part of the load' : ''
              }</p>
              ${
                x.watch
                  ? `<p style="margin:10px 0 0;padding:9px 11px;background:var(--sunk);border-radius:8px;border-left:3px solid var(--s2)"><strong>Watch out.</strong> ${escape(
                      x.watch
                    )}</p>`
                  : ''
              }
              ${
                x.tracksMax
                  ? `<p style="margin:10px 0 0;font-size:12px;color:var(--muted)"><strong style="color:var(--ink2)">Stored max:</strong> yes — ${
                      x.maxConf === 'high'
                        ? '<span style="color:var(--goodtx);font-weight:650">trustworthy</span>, low-rep compound'
                        : '<span style="color:var(--s2);font-weight:650">indicative only</span>. Used to prescribe loads, never to claim progress'
                    }</p>`
                  : ''
              }
              <div style="display:flex;gap:10px;align-items:center;margin-top:12px;padding:10px;background:var(--sunk);border-radius:10px">
                <div style="width:54px;height:54px;border-radius:9px;background:linear-gradient(150deg,var(--grid),var(--axis));display:grid;place-items:center;font-size:19px;color:var(--ink2);flex:0 0 auto">＋</div>
                <div style="flex:1;font-size:12px;color:var(--ink2);line-height:1.5"><b style="color:var(--ink)">Your reference form photo</b><br>Add one photo of yourself in the key position. It becomes the picture for this exercise everywhere in the app.</div>
              </div>
            </div></details>`;
          })
          .join('')
      : '<p style="margin:0">Nothing matches that search.</p>'
  }</div>`;
}

/**
 * Workouts.
 *
 * This was one continuous scroll: purpose, then the key idea, then a stimulus
 * chart, then every exercise, then the next session's purpose, six times over.
 * Finding session D meant travelling through A, B and C, and nothing about a
 * session could be taken in at a glance.
 *
 * Each session is a card that opens. Shut, it is one line you can read the
 * whole rotation from — letter, name, sets, minutes, what it is for. Open, it
 * is what it always was. The session you are about to do is open to begin with,
 * because that is the one you came here for.
 */
function workoutsView(state) {
  const next = state.position.nextSessionId;
  // Undefined means the screen has not been visited and should helpfully open
  // the next session. Null is deliberate: the user tapped that card shut.
  const open = state.planOpenSession === undefined ? next : state.planOpenSession;

  return `<h3 style="margin-top:0">Workouts</h3>
  <p style="margin:0 2px 12px">Run in order: <b>${state.plan.meta.rotationOrder.join(
    ' \u2192 '
  )} \u2192 repeat</b>. Train when you can and always just do the next one \u2014 missing a day is not a decision, the rotation simply slides.</p>
  ${state.plan.sessions
    .map((session) => {
      // Numbers come from the plan engine for the rotation you are actually on,
      // never from the static definition. The static file is the shape of a
      // session; the block decides its bench variation, its failure permission
      // and its accessory volume, so reading set counts off the file would
      // report a recovery rotation as a full one.
      const resolved = toDisplaySession(
        resolveSession(state.plan, { rotation: state.cycle.sequence, sessionId: session.id })
      );
      return sessionCard(state, session, resolved, session.id === open, session.id === next);
    })
    .join('')}`;
}

/** One session: a readable line when shut, everything about it when open. */
function sessionCard(state, session, resolved, isOpen, isNext) {
  const slots = resolved.slots || [];
  const total = slots.reduce((sum, slot) => sum + slot.sets, 0);

  const head = `<div class="wo-head" data-act="plan-session" data-id="${escape(session.id)}">
    <span class="wo-id">${escape(session.id)}</span>
    <div class="wo-nm"><b>${escape(session.name)}</b>
      <span>${total} sets \u00b7 ~${escape(estimateMinutes(state, slots))} min${
        isNext ? ' \u00b7 next up' : ''
      }</span></div>
    <div class="car">\u203a</div></div>`;

  if (!isOpen) return `<div class="card wo${isNext ? ' next' : ''}">${head}</div>`;

  const volume = sessionVolume(resolved, state.plan.exercises);
  const top = Object.entries(volume)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6);

  return `<div class="card wo open${isNext ? ' next' : ''}">${head}
    <p style="font-size:13px;margin-top:11px">${escape(session.purpose)}</p>
    <p style="font-size:12.5px;padding:9px 11px;background:var(--sunk);border-radius:9px;border-left:3px solid var(--s1);color:var(--ink2);margin-bottom:12px">${escape(
      session.key
    )}</p>

    <div class="wo-lbl">What this session hits</div>
    ${top
      .map(
        ([id, value]) =>
          `<div class="vol" style="padding:6px 0;border:0"><div class="r1"><b style="font-size:12px">${escape(
            state.plan.muscles[id].label
          )}</b><em style="font-size:12px">${value.toFixed(1)}</em></div>
      <div class="track" style="height:7px"><div class="fill" style="width:${Math.min(
        100,
        (value / 8) * 100
      )}%;background:var(--s1)"></div></div></div>`
      )
      .join('')}

    <div class="wo-lbl" style="margin-top:14px">Exercises · as prescribed in rotation ${state.cycle.sequence}</div>
    ${slots
      .map((slot) => {
        const exercise = state.plan.exercises[slot.ex];
        const movers = Object.entries(exercise.m)
          .filter(([, w]) => w >= 0.9)
          .map(([m]) => state.plan.muscles[m].label.split(' \u2014 ')[0]);
        return `<div style="display:flex;gap:9px;padding:7px 0;border-bottom:1px solid var(--grid);font-size:13px">
        <div style="flex:1"><b style="font-weight:600">${escape(exercise.name)}${
          slot.label ? ` \u2014 ${escape(slot.label)}` : ''
        }</b>
        <div style="font-size:11.5px;color:var(--muted);margin-top:1px">${
          movers.join(' \u00b7 ') || 'skill / speed work'
        }</div></div>
        <div style="font-size:12px;color:var(--ink2);white-space:nowrap;font-variant-numeric:tabular-nums;font-weight:600">${
          slot.sets
        }\u00d7${slot.amrap ? 'max' : slot.reps} @${slot.rpe}</div></div>`;
      })
      .join('')}
  </div>`;
}

function tipsView(state) {
  const sections = [...new Set(state.plan.knowledge.map((t) => t.s))];
  return `<h3 style="margin-top:0">General tips</h3>
  <p style="margin:0 2px 12px">Everything that decides whether this works, in the order it tends to matter.</p>
  ${sections
    .map(
      (section) => `<h3>${escape(section)}</h3><div class="card">${state.plan.knowledge
        .filter((t) => t.s === section)
        .map((t) => `<details><summary>${escape(t.t)}</summary><div class="c">${t.c}</div></details>`)
        .join('')}</div>`
    )
    .join('')}`;
}

export const actions = {
  /** Open one session card, closing whichever was open. */
  'plan-session'(ctx, data) {
    ctx.state.planOpenSession = ctx.state.planOpenSession === data.id ? null : data.id;
    ctx.render();
  },

  'plan-section'(ctx, data) {
    ctx.state.exerciseSearch = '';
    ctx.goTo({ tab: 'plan', planSection: data.id });
  },
};

export const inputs = {
  'exercise-search'(ctx, value) {
    ctx.state.exerciseSearch = value;
    const view = document.getElementById('view');
    const scroll = window.scrollY;
    ctx.render();
    window.scrollTo(0, scroll);
    const input = view.querySelector('[data-act-input="exercise-search"]');
    if (input) {
      input.focus();
      input.setSelectionRange(value.length, value.length);
    }
  },
};
