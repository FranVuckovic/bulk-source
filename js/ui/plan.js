/**
 * ui/plan.js — the Plan screen: where you are, the exercises, the workouts,
 * the knowledge base, the weekly stimulus and the block progression.
 *
 * The plan is data. Everything on this screen is rendered from the JSON file,
 * which is why adding a second programme later is a file rather than a feature.
 */

import { weeklyVolume, sessionVolume, rollUp, bandStatus, DIMINISHING_RETURNS_SETS } from '../volume.js';
import { escape } from './components.js';

const VOLUME_SCALE = 24;

export function view(ctx) {
  const { state } = ctx;
  if (state.planSection === 'exercises') return exercisesView(state);
  if (state.planSection === 'workouts') return workoutsView(state);
  if (state.planSection === 'tips') return tipsView(state);
  return overview(state);
}

function overview(state) {
  const { volume, frequency } = weeklyVolume(state.plan.sessions, state.plan.exercises);
  const done = state.blockProgress.blockDone;
  const target = state.blockProgress.sessionTarget;
  const pace = state.planProgress.pace;
  const week = state.planProgress.calendarWeek ?? 1;
  const totalWeeks = state.plan.blocks.reduce((sum, b) => sum + b.weeks, 0);
  const nextSession = state.plan.sessions.find((s) => s.id === state.position.nextSessionId);

  return `
  <div class="shead"><div class="lbl">Active plan</div><div class="nm">${escape(state.plan.meta.name)}</div>
    <p class="why">${escape(state.plan.meta.sub)}</p>
    <div class="bar"><i style="width:${Math.min(100, (week / totalWeeks) * 100)}%"></i></div>
    <div class="meta"><span>Block ${escape(state.block.label)} · week ${week}</span><span>Rotation ${state.plan.meta.rotation.join(
      ' → '
    )}</span></div></div>

  <h3>Where you are</h3>
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
      <b style="font-size:15px">${escape(state.block.n)}</b>
      <span style="font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums">${done} / ${target} sessions</span></div>
    <div class="bar"><i style="width:${target ? Math.min(100, (done / target) * 100) : 0}%"></i></div>
    <table style="margin-top:12px"><tbody>
      <tr><td>Sessions logged, all time</td><td>${state.planProgress.sessionsDone}</td></tr>
      <tr><td>Next in rotation</td><td><b>${escape(state.position.nextSessionId ?? '—')}</b>${
        nextSession ? ` — ${escape(nextSession.name)}` : ''
      }</td></tr>
      <tr><td>Calendar week</td><td>${week} of ${totalWeeks}</td></tr>
      <tr><td>Actual pace</td><td>${pace == null ? '—' : `${pace.toFixed(1)} sessions / week`}</td></tr>
    </tbody></table>
    ${paceFlag(state, pace, totalWeeks)}
    <p class="hint">Nothing advances silently. When you reach ${target} sessions the app opens a block review: your best lifts, the proposed working-max updates, and what changes next block. You confirm it.</p>
  </div>

  <div class="card flush">
    <div class="big-row" data-act="plan-section" data-id="exercises"><div class="ic">1</div><div class="m"><b>Exercises</b><span>${
      Object.keys(state.plan.exercises).length
    } exercises · how to perform, muscles worked, why it is here, substitutes</span></div><div class="car">›</div></div>
    <div class="big-row" data-act="plan-section" data-id="workouts"><div class="ic">2</div><div class="m"><b>Workouts</b><span>All six sessions · purpose, exercises, and the muscle stimulus each one delivers</span></div><div class="car">›</div></div>
    <div class="big-row" data-act="plan-section" data-id="tips"><div class="ic">3</div><div class="m"><b>General tips</b><span>How to execute, what matters most, and the mistakes that cost the most</span></div><div class="car">›</div></div>
  </div>

  <h3>Weekly stimulus · all six sessions</h3>
  <div class="lg"><span><i style="background:var(--s3)"></i>in range</span><span><i style="background:var(--warn)"></i>below target</span><span><i style="background:var(--s2)"></i>above target</span><span><i style="background:var(--axis);opacity:.5"></i>target band</span></div>
  ${volumeBars(state, volume, frequency)}
  <p class="hint" style="margin:0 2px 14px">Fractional sets — a set where the muscle is the main mover counts 1.0, a meaningful supporting role counts 0.5, and anything under 0.3 is not counted at all. Speed bench counts <b>zero</b>: at RPE 5–6 it is motor-pattern practice, not a growth stimulus.</p>

  <h3>Blocks through March — what changes and when</h3>
  <div class="card">${state.plan.blocks
    .map(
      (block, i) => `<details ${i === state.block.idx ? 'open' : ''}><summary>${escape(block.n)} <span style="font-weight:500;color:var(--muted);font-size:12px">wk ${escape(
        block.w
      )}</span></summary><div class="c">
      <p style="margin:0 0 10px">${escape(block.theme)}</p>
      <table style="margin-bottom:10px"><tbody>
        <tr><td>Bench top set</td><td>${escape(block.top)}</td></tr>
        <tr><td>Bench volume</td><td>${escape(block.vol)}</td></tr>
        <tr><td>Variation</td><td>${escape(block.v)}</td></tr>
        <tr><td>Incline</td><td>${escape(block.incline)}</td></tr>
        <tr><td>Effort cap</td><td>${escape(block.cap)}</td></tr>
        <tr><td>Session target</td><td>${block.sessionTarget} sessions</td></tr>
      </tbody></table>
      <p style="margin:0 0 4px"><strong>What is different this block</strong></p>
      <ul>${block.changes.map((c) => `<li>${escape(c)}</li>`).join('')}</ul>
    </div></details>`
    )
    .join('')}</div>

  <h3>If six sessions is not possible</h3>
  <div class="card">
    <p style="margin:0 0 8px"><strong>Four days</strong> — you lose the speed day and session F. Bench drops to three exposures, volume by about 20%. Sustainable indefinitely.</p>
    ${state.plan.fallbacks.fourDay
      .map((d) => `<div class="big-row" style="cursor:default"><div class="ic">${d.n}</div><div class="m"><b>${escape(d.contents)}</b></div></div>`)
      .join('')}
    <p style="margin:12px 0 8px"><strong>Three days</strong> — Christmas and travel. A maintenance dose: you will not gain much, and you will not lose anything either.</p>
    ${state.plan.fallbacks.threeDay
      .map((d) => `<div class="big-row" style="cursor:default"><div class="ic">${d.n}</div><div class="m"><b>${escape(d.contents)}</b></div></div>`)
      .join('')}
    <p class="hint">Only switch when you know in advance you will be limited for two weeks or more. A single missed day is not a decision — the rotation just slides.</p>
  </div>`;
}

function paceFlag(state, pace, totalWeeks) {
  if (pace == null) {
    return `<div class="flag f-info" style="margin-top:11px"><i>i</i><span>Pace appears once a few sessions are logged. Blocks advance on <b>sessions completed</b>, never on dates.</span></div>`;
  }
  if (state.blockProgress.behind) {
    const finishWeek = Math.round((totalWeeks * 6) / pace);
    return `<div class="flag f-warn" style="margin-top:11px"><i>!</i><span><b>Running behind the calendar.</b> Blocks advance on <b>sessions completed</b>, not on dates — so nothing is lost and nothing gets skipped. But at ${pace.toFixed(
      1
    )} sessions/week the plan finishes around <b>week ${finishWeek}</b> rather than ${totalWeeks}, which puts the March target at risk. Train more often, or accept a later date.</span></div>`;
  }
  return `<div class="flag f-ok" style="margin-top:11px"><i>✓</i><span><b>On pace.</b> ${pace.toFixed(
    1
  )} sessions per week. Blocks advance on sessions completed, so the calendar and your training are still in step.</span></div>`;
}

function volumeBars(state, volume, frequency) {
  const groups = [...new Set(Object.values(state.plan.muscles).map((m) => m.grp))];

  return groups
    .map((group) => {
      const ids = Object.keys(state.plan.muscles).filter((id) => state.plan.muscles[id].grp === group);
      const rolls = rollUp(
        Object.fromEntries(ids.map((id) => [id, volume[id] || 0])),
        state.plan.muscles
      );
      const rollText = Object.entries(rolls)
        .map(
          ([name, value]) =>
            `<b>${escape(name)} ${value.toFixed(1)}</b>${
              value >= DIMINISHING_RETURNS_SETS
                ? ' — past the point where returns flatten'
                : value >= 14
                  ? ' — in the productive range'
                  : ''
            }`
        )
        .join(' · ');

      const bars = ids
        .map((id) => {
          const muscle = state.plan.muscles[id];
          const value = volume[id] || 0;
          const status = bandStatus(value, muscle);
          const color = status === 'under' ? 'var(--warn)' : status === 'over' ? 'var(--s2)' : 'var(--s3)';
          return `<div class="vol"><div class="r1"><b>${escape(muscle.label)}</b>
            <em>${value.toFixed(1)} sets <span class="f">· ${frequency[id] || 0}×/wk</span></em></div>
            <div class="track"><div class="band" style="left:${(muscle.lo / VOLUME_SCALE) * 100}%;width:${
              ((muscle.hi - muscle.lo) / VOLUME_SCALE) * 100
            }%"></div><div class="fill" style="width:${Math.min(100, (value / VOLUME_SCALE) * 100)}%;background:${color}"></div></div></div>`;
        })
        .join('');

      return `<h3>${escape(group)}</h3><div class="card">${bars}${
        rollText
          ? `<p class="hint" style="margin-top:11px">Counted the way the research does — whole muscle, not per head — that is ${rollText}. The familiar <b>~20 sets/week</b> figure uses those units, not the split ones above.</p>`
          : ''
      }</div>`;
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

  return `<button class="back" data-act="plan-back">‹ ${escape(state.plan.meta.name)}</button>
  <h3 style="margin-top:0">Exercises</h3>
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

function workoutsView(state) {
  return `<button class="back" data-act="plan-back">‹ ${escape(state.plan.meta.name)}</button>
  <h3 style="margin-top:0">Workouts</h3>
  <p style="margin:0 2px 12px">Run in order: <b>${state.plan.meta.rotation.join(
    ' → '
  )} → repeat</b>. Train when you can and always just do the next one — missing a day is not a decision, the rotation simply slides.</p>
  ${state.plan.sessions
    .map((session) => {
      const volume = sessionVolume(session, state.plan.exercises);
      const total = session.slots.reduce((sum, slot) => sum + slot.sets, 0);
      const top = Object.entries(volume)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 6);

      return `<div class="card"><div style="display:flex;align-items:baseline;gap:9px;margin-bottom:6px">
        <span style="font-size:19px;font-weight:800;color:var(--s1)">${escape(session.id)}</span>
        <b style="font-size:16px;font-weight:700;flex:1">${escape(session.name)}</b>
        <span style="font-size:11.5px;color:var(--muted);white-space:nowrap">${total} sets · ~${escape(session.mins)} min</span></div>
        <p style="font-size:13px">${escape(session.purpose)}</p>
        <p style="font-size:12.5px;padding:9px 11px;background:var(--sunk);border-radius:9px;border-left:3px solid var(--s1);color:var(--ink2);margin-bottom:12px">${escape(
          session.key
        )}</p>

        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin-bottom:6px">What this session hits</div>
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

        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin:14px 0 4px">Exercises</div>
        ${session.slots
          .map((slot) => {
            const exercise = state.plan.exercises[slot.ex];
            const movers = Object.entries(exercise.m)
              .filter(([, w]) => w >= 0.9)
              .map(([m]) => state.plan.muscles[m].label.split(' — ')[0]);
            return `<div style="display:flex;gap:9px;padding:7px 0;border-bottom:1px solid var(--grid);font-size:13px">
            <div style="flex:1"><b style="font-weight:600">${escape(exercise.name)}${
              slot.label ? ` — ${escape(slot.label)}` : ''
            }</b>
            <div style="font-size:11.5px;color:var(--muted);margin-top:1px">${
              movers.join(' · ') || 'skill / speed work'
            }</div></div>
            <div style="font-size:12px;color:var(--ink2);white-space:nowrap;font-variant-numeric:tabular-nums;font-weight:600">${
              slot.sets
            }×${slot.amrap ? 'max' : slot.reps} @${slot.rpe}</div></div>`;
          })
          .join('')}
      </div>`;
    })
    .join('')}`;
}

function tipsView(state) {
  const sections = [...new Set(state.plan.knowledge.map((t) => t.s))];
  return `<button class="back" data-act="plan-back">‹ ${escape(state.plan.meta.name)}</button>
  <h3 style="margin-top:0">General tips</h3>
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
  'plan-section'(ctx, data) {
    ctx.state.planSection = data.id;
    ctx.render();
    window.scrollTo(0, 0);
  },
  'plan-back'(ctx) {
    ctx.state.planSection = null;
    ctx.state.exerciseSearch = '';
    ctx.render();
    window.scrollTo(0, 0);
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
