/**
 * The exercise library, and finding a substitute in it.
 *
 * Two defects this exists to end. He logged what he did under the wrong name
 * — a T-bar row as "Machine row", a curl machine as "High-cable curl", 36
 * times in 67 sessions — because the exercise he did was not in the app or
 * could not be found. And the swap sheet ranked its suggestions, then threw
 * the ranking away the moment he typed and showed an alphabetical list.
 *
 * Each test names the defect it prevents.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { withSharedLibrary } from '../js/plans.js';
import { withCustomExercises } from '../js/plan.js';
import {
  LIBRARY_URL,
  PATTERNS,
  EQUIPMENT,
  similarity,
  muscleOverlap,
  rankSwaps,
  listedSubs,
  guessBasedOn,
  normalize,
  searchKey,
  matchesQuery,
  withExerciseLibrary,
} from '../js/library.js';
import { newCycle } from '../js/cycle.js';
import { actions, inputs, slotsFor } from '../js/ui/train.js';

const root = new URL('..', import.meta.url);
const text = (path) => readFileSync(new URL(path, root), 'utf8');
const load = (path) => JSON.parse(text(path));

const LIBRARY_TEXT = text('data/exercise-library.json');
const LIBRARY = JSON.parse(LIBRARY_TEXT);
const RAW = [load('data/plan-fopip-v2.json'), load('data/plan-flopip-2.json')];
const SHARED = withSharedLibrary(RAW);
const [V2, FLOPIP] = SHARED.map((plan) => withExerciseLibrary(plan, LIBRARY));
const ALL = V2.exercises;
const MUSCLES = V2.muscles;

const planIds = new Set(RAW.flatMap((plan) => Object.keys(plan.exercises)));
const libraryEntries = Object.entries(LIBRARY.exercises);
const ids = (ranked) => ranked.map((entry) => entry.id);
const idByName = (name) => Object.entries(ALL).find(([, x]) => x.name === name)?.[0];

/* ═══════════════════════════════════════════════════════════════════════
   The data
   ═══════════════════════════════════════════════════════════════════════ */

test('every library exercise uses only muscles the plans count', () => {
  // An unknown muscle id is volume that silently goes nowhere, and a label
  // lookup that renders "undefined" on the Plan screen.
  const known = new Set(RAW.flatMap((plan) => Object.keys(plan.muscles)));
  for (const [id, exercise] of libraryEntries) {
    assert.ok(exercise.m && typeof exercise.m === 'object', `${id} has no muscle map`);
    for (const [muscle, weight] of Object.entries(exercise.m)) {
      assert.ok(known.has(muscle), `${id} trains an unknown muscle "${muscle}"`);
      assert.ok(weight > 0 && weight <= 1.5, `${id} weights ${muscle} at ${weight}`);
    }
  }
});

test('every library id is written once, and none is a plan id', () => {
  // JSON.parse keeps the last of two equal keys without a word, so the check
  // is on the text. A library id equal to a plan id would be shadowed by the
  // plan anyway — but it means two definitions of one exercise in the repo.
  const section = LIBRARY_TEXT.slice(LIBRARY_TEXT.indexOf('"exercises"'), LIBRARY_TEXT.indexOf('"tags"'));
  const written = [...section.matchAll(/^\s{4}"([^"]+)":/gm)].map((match) => match[1]);
  assert.equal(written.length, libraryEntries.length, 'an id is written twice');
  assert.equal(new Set(written).size, written.length);

  const clashes = libraryEntries.map(([id]) => id).filter((id) => planIds.has(id));
  assert.deepEqual(clashes, [], 'library ids must only add');
});

test('no library exercise shares a name with another exercise', () => {
  // Adding a custom exercise refuses a name that exists, and two rows called
  // "Machine curl" in the swap sheet is the wrong-name problem again.
  const seen = new Map();
  for (const [id, exercise] of Object.entries(ALL)) {
    const key = normalize(exercise.name);
    assert.ok(!seen.has(key), `${id} and ${seen.get(key)} are both called ${exercise.name}`);
    seen.set(key, id);
  }
});

test('every pattern and equipment value is one the ranking knows', () => {
  for (const [id, exercise] of libraryEntries) {
    assert.ok(PATTERNS.includes(exercise.pattern), `${id}: pattern ${exercise.pattern}`);
    assert.ok(EQUIPMENT.includes(exercise.equipment), `${id}: equipment ${exercise.equipment}`);
    assert.ok(Array.isArray(exercise.aliases), `${id} has no aliases list`);
    if (exercise.station) assert.ok(['dual', 'single'].includes(exercise.station), `${id}: station ${exercise.station}`);
  }
  for (const [id, tag] of Object.entries(LIBRARY.tags)) {
    assert.ok(PATTERNS.includes(tag.pattern), `tag ${id}: pattern ${tag.pattern}`);
    assert.ok(EQUIPMENT.includes(tag.equipment), `tag ${id}: equipment ${tag.equipment}`);
  }
});

test('every plan exercise is tagged, and every tag names a plan exercise', () => {
  // An untagged plan exercise ranks on muscles alone and sorts below every
  // library entry that shares its pattern — the plan's own lifts would sink.
  const tagged = new Set(Object.keys(LIBRARY.tags));
  for (const id of planIds) assert.ok(tagged.has(id), `${id} has no pattern or equipment`);
  for (const id of tagged) assert.ok(planIds.has(id), `tag for ${id}, which no plan defines`);
});

test('the library is in the offline shell and published', () => {
  // Fetched at boot; absent from the shell, it works at home and the library
  // vanishes in a gym with no signal.
  const sw = text('sw.js');
  const shell = sw.slice(sw.indexOf('const SHELL = ['), sw.indexOf('];', sw.indexOf('const SHELL = [')));
  assert.ok(shell.includes(`'${LIBRARY_URL}'`), `${LIBRARY_URL} is not in SHELL`);
  assert.ok(shell.includes("'./js/library.js'"));
  assert.match(text('js/app.js'), /withExerciseLibrary\(plan, library\)/, 'app.js merges it into every plan at boot');
});

test('his gym is covered: the Technogym lines, both cable stations, the T-bar and the bench variations', () => {
  const finds = (query) => rankSwaps(null, ALL, { query, floor: -Infinity }).map((entry) => entry.exercise.name);
  for (const query of [
    'technogym chest press', 'incline chest press', 'technogym shoulder press', 'pectoral', 'technogym rear delt',
    'lat machine', 'vertical traction', 'low row', 'technogym upper back', 'arm curl', 'arm extension',
    'technogym leg press', 'technogym leg extension', 'seated leg curl', 'lying leg curl', 'glute machine',
    'adductor', 'abductor', 'abdominal crunch', 'lower back', 'rotary torso',
    't bar', 'chest supported t bar', 'spoto', 'larsen', 'pin press', 'board press', 'close grip',
    'smith bench', 'smith squat', 'ez curl', 'dumbbell row',
  ]) {
    assert.ok(finds(query).length, `nothing found for "${query}"`);
  }
  for (const pattern of ['lateral-raise', 'elbow-extension', 'elbow-flexion', 'rear-delt']) {
    const stations = new Set(libraryEntries.filter(([, x]) => x.pattern === pattern && x.station).map(([, x]) => x.station));
    assert.deepEqual([...stations].sort(), ['dual', 'single'], `${pattern} on both cable stations`);
  }
});

test('the library offers nothing the gym does not have', () => {
  const absent = libraryEntries.filter(([, x]) => /hack squat|pendulum/i.test(x.name)).map(([id]) => id);
  assert.deepEqual(absent, []);
});

/* ═══════════════════════════════════════════════════════════════════════
   Merging
   ═══════════════════════════════════════════════════════════════════════ */

test('merging the library never changes a plan exercise', () => {
  // Plan ids are in his logged history. Merging may add tags; it may not
  // alter a single field the plan wrote.
  for (const [index, plan] of SHARED.entries()) {
    const merged = [V2, FLOPIP][index];
    for (const [id, original] of Object.entries(plan.exercises)) {
      for (const [field, value] of Object.entries(original)) {
        assert.deepEqual(merged.exercises[id][field], value, `${id}.${field} changed`);
      }
    }
    assert.equal(merged.sessions, plan.sessions, 'sessions are untouched');
    assert.equal(merged.muscles, plan.muscles, 'muscles are untouched');
  }
});

test("a plan's definition wins over a library entry with the same id", () => {
  const plan = { exercises: { benchComp: { name: 'Competition bench press', m: { chestMid: 1 } } } };
  const library = { exercises: { benchComp: { name: 'Impostor', m: { quads: 1 }, pattern: 'squat', equipment: 'barbell' } } };
  const merged = withExerciseLibrary(plan, library);
  assert.equal(merged.exercises.benchComp.name, 'Competition bench press');
  assert.deepEqual(merged.exercises.benchComp.m, { chestMid: 1 });
});

test('a library entry has every field the screens read', () => {
  // The card renders `how[0]`, the Plan screen `why`, `subs` and rest; a
  // missing field reaches the page as "undefined".
  for (const [id] of libraryEntries) {
    const x = ALL[id];
    assert.equal(typeof x.why, 'string', id);
    assert.ok(Array.isArray(x.how) && Array.isArray(x.subs), id);
    assert.ok(x.defaultRestSec > 0, id);
    assert.equal(x.tracksMax, false, `${id} must not claim a trustworthy max`);
    assert.equal(x.unit, 'kg', `${id} is stored in kilograms`);
  }
});

test('without a library the plan is returned as it was', () => {
  assert.equal(withExerciseLibrary(SHARED[0], null), SHARED[0]);
});

/* ═══════════════════════════════════════════════════════════════════════
   Similarity
   ═══════════════════════════════════════════════════════════════════════ */

test('similarity is 1 for an exercise against itself and stays within 0–1', () => {
  const sample = Object.values(ALL).filter((x) => Object.keys(x.m || {}).length).slice(0, 60);
  for (const a of sample) {
    assert.equal(similarity(a, a), 1, a.name);
    for (const b of sample.slice(0, 20)) {
      const score = similarity(a, b);
      assert.ok(score >= 0 && score <= 1, `${a.name} / ${b.name}: ${score}`);
      assert.equal(score, similarity(b, a), 'it is symmetric');
    }
  }
});

test('a lateral raise is never suggested for a squat', () => {
  // They share no muscle. Pattern and equipment must not be able to make up
  // for that, or a cable lateral raise scores off "both use a cable".
  const lowerBody = Object.entries(ALL).filter(([, x]) => ['squat', 'lunge', 'knee-extension'].includes(x.pattern));
  assert.ok(lowerBody.length > 10);
  for (const [id] of lowerBody) {
    const suggested = rankSwaps(id, ALL);
    const raises = suggested.filter((entry) => entry.exercise.pattern === 'lateral-raise');
    assert.deepEqual(ids(raises), [], `${id} is offered a lateral raise`);
  }
  assert.equal(similarity(ALL.legpress, ALL.lateral), 0);
});

test('magnitude counts: box jumps are not a squat substitute', () => {
  // The defect substitutes.test.js names for the old score: `{quads: 0.3}`
  // points the same way as `{quads: 1, hams: 0.3}`, so cosine alone said 0.98.
  assert.ok(muscleOverlap(ALL.hackBulg, ALL.jumps) < 0.65);
  assert.ok(!ids(rankSwaps('hackBulg', ALL)).slice(0, 15).includes('jumps'));
});

test('swapping competition bench offers bench variations first', () => {
  // The audit's complaint was the opposite: flies and incline work between
  // him and the bench variation he wanted.
  const top = rankSwaps('benchComp', ALL).slice(0, 10);
  for (const entry of top) {
    assert.equal(entry.exercise.pattern, 'horizontal-press', `${entry.exercise.name} in the top ten`);
  }
  const names = top.map((entry) => entry.exercise.name);
  for (const expected of ['Spoto press', 'Larsen press', 'Long-pause bench press — 2–3 s', 'Feet-up bench press']) {
    assert.ok(names.includes(expected), `${expected} is not in the top ten`);
  }
  const fly = ids(rankSwaps('benchComp', ALL)).indexOf('pecDeck');
  const pause = ids(rankSwaps('benchComp', ALL)).indexOf('benchPause');
  assert.ok(pause >= 0 && (fly === -1 || fly > pause));
});

test('a machine row is replaced by rows, the T-bar among them', () => {
  const suggested = rankSwaps('rowMachine', ALL);
  const top = suggested.slice(0, 12);
  for (const entry of top) assert.equal(entry.exercise.pattern, 'horizontal-row', entry.exercise.name);
  assert.ok(ids(suggested).includes('tbarRow'));
  assert.ok(ids(suggested).includes('tbarChestSupported'));
});

test('the same equipment breaks a tie in muscles and pattern', () => {
  // A lateral raise on a cable is a closer stand-in for a cable lateral raise
  // than the same movement with dumbbells.
  const order = ids(rankSwaps('lateral', ALL));
  assert.ok(order.indexOf('lateralCableDual') < order.indexOf('lateralDB'));
});

test('a custom exercise ranks like the exercise it was based on', () => {
  // Custom exercises carry a muscle map but no pattern; without borrowing the
  // base's, a T-bar row added by hand would sink below every library row.
  const plan = withCustomExercises(V2, [{ id: 'custom-my-row', name: 'My row', basedOn: 'rowMachine' }]);
  const ranked = rankSwaps('rowCable', plan.exercises);
  const mine = ranked.find((entry) => entry.id === 'custom-my-row');
  const base = ranked.find((entry) => entry.id === 'rowMachine');
  assert.ok(mine, 'it is suggested at all');
  assert.equal(mine.score, base.score, 'with exactly the score of the exercise it copies');
});

test('retired exercises and the exercise itself are never offered', () => {
  for (const query of ['', 'bench']) {
    const offered = rankSwaps('benchComp', ALL, { query, floor: -Infinity });
    assert.ok(!offered.some((entry) => entry.id === 'benchComp'));
    assert.ok(!offered.some((entry) => /retired/i.test(entry.exercise.name)), `retired offered for "${query}"`);
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   Search
   ═══════════════════════════════════════════════════════════════════════ */

test('typing a query must not discard the similarity order', () => {
  // The defect in the audit: typing hid the ranked suggestions and filtered an
  // alphabetical list. Matches now come back in exactly the order the full
  // ranking has them.
  for (const [source, query] of [['rowMachine', 'row'], ['benchComp', 'press'], ['legpress', 'machine'], ['curlHighCable', 'curl']]) {
    const full = ids(rankSwaps(source, ALL, { floor: -Infinity }));
    const matched = ids(rankSwaps(source, ALL, { query }));
    assert.ok(matched.length > 3, `"${query}" matched too little to test`);
    const positions = matched.map((id) => full.indexOf(id));
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b), `"${query}" reordered the ranking`);
    const alphabetical = [...matched].sort((a, b) => ALL[a].name.localeCompare(ALL[b].name));
    assert.notDeepEqual(matched, alphabetical, `"${query}" came back alphabetical`);
  }
});

test('"t bar" finds the T-bar row, however it is typed', () => {
  for (const query of ['t bar', 'T-BAR', 'tbar', 't-bar row', 'row t']) {
    const found = ids(rankSwaps('rowMachine', ALL, { query }));
    assert.ok(found.includes('tbarRow'), `"${query}" missed the T-bar row`);
  }
  // A one-letter word is a word, not the start of every "Technogym".
  assert.ok(!ids(rankSwaps('rowMachine', ALL, { query: 't bar' })).includes('tgLowRow'));
});

test('search is accent- and case-insensitive and matches the start of words', () => {
  const squat = idByName('Barbell back squat');
  assert.ok(ids(rankSwaps('legpress', ALL, { query: 'čučanj' })).includes(squat));
  assert.ok(ids(rankSwaps('legpress', ALL, { query: 'CUCANJ' })).includes(squat));
  assert.ok(ids(rankSwaps('benchComp', ALL, { query: 'bučice' })).includes('benchDB'), 'Croatian equipment words work');
  assert.ok(matchesQuery(searchKey({ name: 'Machine curl' }), 'curl mach'), 'any word order, word prefixes');
  assert.ok(!matchesQuery(searchKey({ name: 'Narrow-grip press' }), 'row'), 'a word inside a word is not a match');
});

test('search reaches aliases, equipment and muscles, not only the name', () => {
  assert.ok(ids(rankSwaps('pulldown', ALL, { query: 'lat machine' })).includes('tgLatMachine'));
  assert.ok(ids(rankSwaps('cableFly', ALL, { query: 'pectoral' })).includes('pecDeck'), 'a plan exercise found by its tag alias');
  assert.ok(ids(rankSwaps('pushdown', ALL, { query: 'big cable' })).includes('pushdownDual'), 'his name for the dual-cable station');
  assert.ok(!ids(rankSwaps('pushdown', ALL, { query: 'big cable' })).includes('pushdownSingleStack'));
  const chest = rankSwaps('benchComp', ALL, { query: 'chest', muscles: MUSCLES });
  assert.ok(ids(chest).includes('cableFly'), 'a muscle name finds what trains it');
});

test("the plan's own subs resolve through names and aliases", () => {
  const { listed, unlisted } = listedSubs('reardelt', ALL);
  assert.deepEqual(ids(listed), ['reardeltPecDeck', 'facepull', 'reardeltDB']);
  assert.deepEqual(unlisted, []);
  // A suggestion the app still has no exercise for is named, not dropped.
  assert.ok(listedSubs('benchPause', ALL).unlisted.length >= 1);
});

test('a quick-created exercise guesses its muscles from its name, or counts none', () => {
  assert.equal(guessBasedOn('Machine curl X', ALL), 'curlMachine');
  assert.equal(guessBasedOn('Hammer curl on the rope', ALL), 'curlRopeHammer', 'the most words matched wins');
  // Equipment words alone would put a cable fly's chest volume on anything.
  assert.equal(guessBasedOn('Cable thing', ALL), null);
  assert.equal(guessBasedOn('', ALL), null);
});

/* ═══════════════════════════════════════════════════════════════════════
   The sheets
   ═══════════════════════════════════════════════════════════════════════ */

function trainState(plan, sessionId, extras = []) {
  return {
    plan,
    cycle: newCycle(plan, { sequence: 1, startedAtISO: null, localStartDate: null }),
    trainSessionId: sessionId,
    readiness: 'normal',
    deviations: { swaps: {}, extras, addedSets: {}, exerciseNotes: {}, phaseSwaps: {} },
    loggedSets: new Map(),
    exOpen: new Set(),
    cleared: new Set(),
    grips: {},
    settings: { unit: 'kg', increment: 2.5, bodyweight: 90, customExercises: [] },
    maxes: new Map(),
    sets: [],
    logs: [],
    todayISO: '2026-10-10',
    lastByExercise: new Map(),
    activeLog: { id: 99 },
  };
}

/** Enough of a page for a sheet to open, and for the search box to filter it. */
function withSheet(run) {
  const previous = globalThis.document;
  const sheetClasses = new Set();
  const pan = { innerHTML: '' };
  let rows = null;
  const parse = () => {
    // Rebuild the rows the filter works on from the sheet's HTML, in order.
    const html = pan.innerHTML;
    const group = (name) => {
      const at = html.indexOf(`data-filter-group="${name}"`);
      return at < 0 ? null : { hidden: html.slice(at, at + 80).includes(' hidden') };
    };
    const allAt = html.indexOf('data-filter-group="all"');
    const all = html.slice(allAt);
    const buttons = [...all.matchAll(/<button[^>]*data-id="([^"]+)"[^>]*data-search="([^"]*)"/g)].map((m) => ({
      id: m[1],
      dataset: { search: m[2] },
      hidden: false,
    }));
    const quickTag = all.match(/<button[^>]*data-quick-create[^>]*>/)?.[0];
    const quick = quickTag
      ? {
          hidden: true,
          dataset: quickTag.includes('data-si=') ? { si: quickTag.match(/data-si="(\d+)"/)[1] } : {},
          label: { textContent: '' },
          basis: { textContent: '' },
          querySelector(selector) {
            return selector === '[data-quick-label]' ? this.label : this.basis;
          },
        }
      : null;
    const empty = { hidden: true };
    const allGroup = {
      ...group('all'),
      querySelectorAll: () => buttons,
      querySelector: (selector) => (selector === '[data-quick-create]' ? quick : selector === '[data-filter-empty]' ? empty : null),
    };
    rows = { suggested: group('suggested'), all: allGroup, buttons, quick, empty };
  };
  globalThis.document = {
    getElementById: (id) =>
      id === 'pan'
        ? pan
        : id === 'sheet'
          ? { classList: { add: (c) => sheetClasses.add(c), remove: (c) => sheetClasses.delete(c), contains: (c) => sheetClasses.has(c) } }
          : null,
    querySelector: (selector) => {
      if (selector !== '.sheet') return null;
      if (!rows) parse();
      return {
        querySelector: (inner) =>
          inner === '[data-filter-group="suggested"]' ? rows.suggested : inner === '[data-filter-group="all"]' ? rows.all : null,
      };
    },
  };
  const sheet = {
    get html() {
      return pan.innerHTML;
    },
    type(ctx, value) {
      rows = null;
      inputs['exercise-filter'](ctx, value);
      return rows;
    },
  };
  return Promise.resolve(run(sheet)).finally(() => {
    globalThis.document = previous;
  });
}

const ctxFor = (state, created = []) => ({
  state,
  saveDeviations: async () => {},
  render() {},
  async addCustomExercise({ name, basedOn }) {
    const id = `custom-${normalize(name).replace(/ /g, '-')}`;
    created.push({ id, name, basedOn });
    state.plan = withCustomExercises(state.plan, created);
    return id;
  },
});

function slotOf(state, exerciseId) {
  const index = slotsFor(state).findIndex((slot) => slot.ex === exerciseId);
  assert.ok(index >= 0, `${exerciseId} is not in session ${state.trainSessionId}`);
  return index;
}

test("the swap sheet pins the plan's options first, then ranks the rest", async () => {
  const state = trainState(FLOPIP, 'A');
  const si = slotOf(state, 'rowMachine');
  await withSheet(async (sheet) => {
    actions['open-swap'](ctxFor(state), { si: String(si) });
    const html = sheet.html;
    const suggested = html.slice(0, html.indexOf('data-filter-group="all"'));
    const order = [...suggested.matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(order[0], 'rowOneArm', 'option B leads');
    assert.match(suggested, /option B/);
    assert.ok(order.indexOf('rowCSR') < order.indexOf('tbarChestSupported'), "the plan's listed subs before the ranking");
    assert.ok(order.includes('tbarRow'), 'the library is offered');
    assert.doesNotMatch(html, /NaN|undefined|\[object Object\]/);
  });
});

test('typing in the swap sheet keeps the rows in similarity order', async () => {
  const state = trainState(FLOPIP, 'A');
  const si = slotOf(state, 'rowMachine');
  await withSheet(async (sheet) => {
    actions['open-swap'](ctxFor(state), { si: String(si) });
    const rows = sheet.type(ctxFor(state), 't bar');
    assert.equal(rows.suggested.hidden, true, 'the suggestions give way to the search');
    const shown = rows.buttons.filter((b) => !b.hidden).map((b) => b.id);
    assert.deepEqual(shown, ids(rankSwaps('rowMachine', FLOPIP.exercises, { query: 't bar', exclude: ['rowOneArm', 'rowCSR', 'rowCable', 'rowDBChest'] })));
    assert.ok(shown.includes('tbarRow'));
    assert.equal(rows.quick.hidden, false, '"Other" is offered after the results');
    assert.equal(rows.quick.label.textContent, 't bar');

    const exact = sheet.type(ctxFor(state), 'T-bar row');
    assert.equal(exact.quick.hidden, true, 'not offered for a name that already exists');
  });
});

test('"Other" in Swap creates the typed exercise, counted like the one it replaces', async () => {
  const state = trainState(FLOPIP, 'A');
  const si = slotOf(state, 'rowMachine');
  const created = [];
  await withSheet(async () => {
    await actions['quick-exercise'](ctxFor(state, created), { si: String(si), quickName: 'Machine curl X' });
  });
  assert.deepEqual(created.map((c) => [c.name, c.basedOn]), [['Machine curl X', 'rowMachine']]);
  assert.equal(slotsFor(state)[si].ex, created[0].id, 'and it is in the slot now');
  assert.deepEqual(state.plan.exercises[created[0].id].m, FLOPIP.exercises.rowMachine.m, 'so volume still counts');
});

test('"Other" works from + Add exercise on the blank custom session', async () => {
  // The blank session has no slot to swap, so creating an exercise there used
  // to be impossible.
  const state = trainState(FLOPIP, 'custom');
  const created = [];
  await withSheet(async (sheet) => {
    actions['open-add'](ctxFor(state));
    assert.match(sheet.html, /data-quick-create/);
    const rows = sheet.type(ctxFor(state), 'Machine curl X');
    assert.equal(rows.quick.hidden, false);
    assert.match(rows.quick.basis.textContent, /counted like Machine curl/, 'it says what it will count as');
    await actions['quick-exercise'](ctxFor(state, created), { quickName: rows.quick.dataset.quickName });
  });
  assert.deepEqual(created.map((c) => [c.name, c.basedOn]), [['Machine curl X', 'curlMachine']]);
  const slots = slotsFor(state);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].ex, created[0].id);
});

test('a failed quick-create reaches the central action error handler', async () => {
  // An async save that is neither awaited nor returned fails without the user
  // seeing it.
  const state = trainState(FLOPIP, 'custom');
  const failure = new Error('There is already an exercise called that.');
  const ctx = { ...ctxFor(state), addCustomExercise: async () => { throw failure; } };
  await assert.rejects(actions['quick-exercise'](ctx, { quickName: 'Pec deck' }), failure);
});
