/**
 * library.js — the exercises the app knows beyond the plans, and how alike
 * two of them are.
 *
 * The swap sheet used to know only the plans' own exercises, ranked by muscle
 * map alone, and the moment you typed it threw the ranking away and showed an
 * alphabetical list. So the T-bar row he actually did, which the app had never
 * heard of, went into the log as "Machine row", and a curl machine went in as
 * "High-cable curl" — 36 times in 67 sessions, each one written up in a note
 * because the data had no way to say it.
 *
 * Two things fix that, and both live here:
 *
 *   A library of the exercises his gym can actually do (Technogym
 *   selectorised and plate-loaded machines, Kingsbox racks and free weights,
 *   a Smith machine, a dual-cable station and a single stack), merged into
 *   every plan at boot. Library ids only ever add: an id a plan defines keeps
 *   the plan's definition, so nothing already logged changes meaning.
 *
 *   One ranking — `rankSwaps` — used with and without a search query. Typing
 *   filters it; it never reorders it.
 *
 * Pure: no DOM, no storage, no clock.
 */

/** Where the library lives. Part of the offline shell (see `sw.js`). */
export const LIBRARY_URL = './data/exercise-library.json';

/** Every movement pattern an exercise may declare. */
export const PATTERNS = Object.freeze([
  'horizontal-press',
  'incline-press',
  'vertical-press',
  'fly',
  'dip',
  'vertical-pull',
  'straight-arm',
  'horizontal-row',
  'elbow-flexion',
  'elbow-extension',
  'lateral-raise',
  'rear-delt',
  'squat',
  'lunge',
  'hinge',
  'knee-extension',
  'knee-flexion',
  'hip-thrust',
  'hip-abduction',
  'hip-adduction',
  'calf',
  'core-flexion',
  'anti-extension',
  'anti-rotation',
  'core-rotation',
  'lateral-flexion',
  'carry',
  'shrug',
  'forearm',
  'jump',
]);

/** Every kind of equipment an exercise may declare. */
export const EQUIPMENT = Object.freeze([
  'barbell',
  'dumbbell',
  'smith',
  'cable',
  'machine-selectorised',
  'machine-plate',
  'bodyweight',
  'ez-bar',
  'band',
  'other',
]);

/**
 * Patterns that are not the same movement but do overlapping work: a dip is
 * half a bench press, a lunge most of a squat. Anything not listed scores 0.
 */
const PATTERN_KIN = new Map(
  Object.entries({
    'horizontal-press|incline-press': 0.5,
    'horizontal-press|dip': 0.5,
    'horizontal-press|fly': 0.3,
    'incline-press|fly': 0.3,
    'incline-press|vertical-press': 0.4,
    'dip|elbow-extension': 0.3,
    'vertical-pull|horizontal-row': 0.4,
    'vertical-pull|straight-arm': 0.5,
    'horizontal-row|rear-delt': 0.3,
    'horizontal-row|shrug': 0.2,
    'rear-delt|lateral-raise': 0.2,
    'elbow-flexion|forearm': 0.3,
    'squat|lunge': 0.7,
    'squat|knee-extension': 0.3,
    'lunge|knee-extension': 0.2,
    'squat|hip-thrust': 0.2,
    'lunge|hip-thrust': 0.2,
    'hinge|hip-thrust': 0.5,
    'hinge|knee-flexion': 0.3,
    'hip-thrust|hip-abduction': 0.2,
    'core-flexion|anti-extension': 0.5,
    'anti-rotation|core-rotation': 0.5,
    'anti-rotation|lateral-flexion': 0.5,
    'core-rotation|lateral-flexion': 0.3,
    'anti-rotation|carry': 0.4,
    'carry|forearm': 0.3,
    'carry|shrug': 0.2,
    'jump|squat': 0.2,
  })
);

/**
 * How interchangeable two kinds of equipment are, for the same movement. A
 * Smith bench is closer to a barbell bench than a machine press is; the two
 * Technogym lines are closer to each other than either is to a cable.
 */
const EQUIPMENT_KIN = new Map(
  Object.entries({
    'barbell|smith': 0.7,
    'barbell|ez-bar': 0.7,
    'barbell|dumbbell': 0.5,
    'dumbbell|ez-bar': 0.5,
    'smith|machine-plate': 0.6,
    'smith|machine-selectorised': 0.4,
    'machine-plate|machine-selectorised': 0.8,
    'cable|machine-selectorised': 0.6,
    'cable|machine-plate': 0.4,
    'cable|band': 0.5,
    'cable|dumbbell': 0.4,
    'bodyweight|band': 0.5,
  })
);

const kin = (table, a, b, unknown) => {
  if (!a || !b) return unknown;
  if (a === b) return 1;
  return table.get(`${a}|${b}`) ?? table.get(`${b}|${a}`) ?? 0;
};

export const patternCloseness = (a, b) => kin(PATTERN_KIN, a, b, 0);
/** Unknown equipment is neither a match nor a mismatch. */
export const equipmentCloseness = (a, b) => (!a || !b ? 0.5 : a === b ? 1 : kin(EQUIPMENT_KIN, a, b, 0.5) || 0.2);

/** The weights of the three parts of `similarity`. */
export const WEIGHTS = Object.freeze({ muscle: 0.6, pattern: 0.3, equipment: 0.1 });

/**
 * How much of the same muscular work two exercises do, 0–1.
 *
 * The mean of cosine (do they point the same way?) and weighted Jaccard
 * (Σmin / Σmax: do they do the same *amount*?). Cosine alone called box jumps
 * `{quads: 0.3}` a 0.98 match for a hack squat `{quads: 1, hams: 0.3}`;
 * Jaccard alone is too harsh on a close-grip bench against a competition one.
 */
export function muscleOverlap(a, b) {
  const left = a?.m || {};
  const right = b?.m || {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  let dot = 0;
  let leftLen = 0;
  let rightLen = 0;
  let mins = 0;
  let maxes = 0;
  for (const key of keys) {
    const l = Math.max(0, left[key] || 0);
    const r = Math.max(0, right[key] || 0);
    dot += l * r;
    leftLen += l * l;
    rightLen += r * r;
    mins += Math.min(l, r);
    maxes += Math.max(l, r);
  }
  if (!leftLen || !rightLen) return 0;
  const cosine = dot / (Math.sqrt(leftLen) * Math.sqrt(rightLen));
  return (cosine + mins / maxes) / 2;
}

const hasMuscles = (exercise) => Object.values(exercise?.m || {}).some((w) => w > 0);

/**
 * How well `b` stands in for `a`, 0–1.
 *
 *   0.6 × muscle overlap  +  0.3 × same pattern  +  0.1 × equipment closeness
 *
 * Two exercises that both have a muscle map and share no muscle at all score
 * 0, whatever their pattern or equipment: a lateral raise is never a squat.
 * An exercise with no counted stimulus (speed bench, a static hold) is
 * compared on pattern and equipment alone.
 */
export function similarity(a, b) {
  if (!a || !b) return 0;
  const muscle = muscleOverlap(a, b);
  if (hasMuscles(a) && hasMuscles(b) && muscle === 0) return 0;
  const score =
    WEIGHTS.muscle * muscle +
    WEIGHTS.pattern * patternCloseness(a.pattern, b.pattern) +
    WEIGHTS.equipment * equipmentCloseness(a.equipment, b.equipment);
  return Math.round(score * 1e6) / 1e6;
}

/* ═══════════════════════════════════════════════════════════════════════
   Search
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Lower case, accents off, punctuation to spaces. "Čučanj" finds "cucanj",
 * "T-bar" finds "t bar", and "đ" — which has no decomposition — becomes "d".
 */
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Extra words each kind of equipment answers to, so "db" or "sajla" works. */
const EQUIPMENT_TERMS = {
  barbell: ['barbell', 'bb', 'sipka'],
  dumbbell: ['dumbbell', 'db', 'bucice'],
  smith: ['smith'],
  cable: ['cable', 'pulley', 'sajla'],
  'machine-selectorised': ['machine', 'selectorised', 'stack', 'technogym', 'sprava'],
  'machine-plate': ['machine', 'plate', 'plate loaded', 'technogym', 'sprava'],
  bodyweight: ['bodyweight', 'bw'],
  'ez-bar': ['ez', 'ez bar'],
  band: ['band', 'guma'],
  other: [],
};

/**
 * Everything a search can match an exercise on, as one normalized string:
 * its name, its aliases, its equipment's words, and the names of the muscles
 * it mainly trains when the muscle table is given.
 *
 * Adjacent words are also glued, so "tbar", "legpress" and "pecdeck" find
 * what "t bar", "leg press" and "pec deck" do.
 */
export function searchKey(exercise, { muscles = null } = {}) {
  const phrases = [exercise?.name, ...(exercise?.aliases || []), ...(EQUIPMENT_TERMS[exercise?.equipment] || [])];
  if (muscles) {
    for (const [id, weight] of Object.entries(exercise?.m || {})) {
      if (weight >= 0.5 && muscles[id]?.label) phrases.push(muscles[id].label);
    }
  }
  const words = new Set();
  for (const phrase of phrases) {
    const parts = normalize(phrase).split(' ').filter(Boolean);
    parts.forEach((word, i) => {
      words.add(word);
      if (parts[i + 1]) words.add(word + parts[i + 1]);
    });
  }
  return ` ${[...words].join(' ')} `;
}

/**
 * Does a search key match a query? Every word of the query has to start a
 * word of the key, in any order: "curl mach" finds "Machine curl", "t bar"
 * finds "T-bar row", and "row" does not find "Narrow-grip" anything because
 * it has to start a word, not sit inside one.
 */
export function matchesQuery(key, query) {
  const words = normalize(query).split(' ').filter(Boolean);
  if (!words.length) return true;
  // A single letter has to be a whole word: the "t" of "t bar" is the T of
  // T-bar, not the start of every "Technogym" and "tempo" in the app.
  return words.every((word) => key.includes(word.length === 1 ? ` ${word} ` : ` ${word}`));
}

const isRetired = (exercise) => !!exercise?.retired || /\(retired/i.test(exercise?.name || '');

/**
 * Pattern and equipment for an exercise, borrowing from the one it was based
 * on when it has none of its own — which is how a custom exercise added "in
 * place of a T-bar row" ranks like a row.
 */
export function tagsOf(exercise, exercises = {}) {
  if (!exercise) return { pattern: null, equipment: null };
  const base = exercise.basedOn ? exercises[exercise.basedOn] : null;
  return {
    pattern: exercise.pattern ?? base?.pattern ?? null,
    equipment: exercise.equipment ?? base?.equipment ?? null,
  };
}

const withTags = (exercise, exercises) => ({ ...exercise, ...tagsOf(exercise, exercises) });

/**
 * Every exercise that could stand in for `exerciseId`, most similar first.
 *
 * Without a query: the suggestions — anything scoring at least `floor`, at
 * most `limit` of them.
 *
 * With a query: every exercise whose name, aliases or equipment match, in the
 * same similarity order. No floor, because you typed it — but a lateral raise
 * you searched for while swapping a squat still sorts below every squat you
 * also matched. The order never becomes alphabetical; that is the defect this
 * exists to fix.
 *
 * Retired exercises and the exercise itself are never offered. `exclude` drops
 * ids the caller is already showing (the plan's options, its listed subs).
 *
 * Returns `[{ id, exercise, score }]`.
 */
export function rankSwaps(exerciseId, exercises, { query = '', floor = 0.35, limit = Infinity, exclude = [], muscles = null } = {}) {
  const all = exercises || {};
  const source = all[exerciseId] ? withTags(all[exerciseId], all) : null;
  const skip = new Set([exerciseId, ...exclude]);
  const searching = normalize(query).length > 0;

  const ranked = [];
  for (const [id, exercise] of Object.entries(all)) {
    if (skip.has(id) || !exercise?.name || isRetired(exercise)) continue;
    if (searching && !matchesQuery(searchKey(exercise, { muscles }), query)) continue;
    const score = source ? similarity(source, withTags(exercise, all)) : 0;
    if (!searching && score < floor) continue;
    ranked.push({ id, exercise, score });
  }
  ranked.sort((a, b) => b.score - a.score || a.exercise.name.localeCompare(b.exercise.name));
  return ranked.slice(0, limit);
}

/**
 * The plan's own suggestions for an exercise, resolved to real exercises.
 *
 * A plan's `subs` are free text written before most of them existed in the
 * app. Matched on name or alias, so "Reverse pec deck" finds the reverse
 * pec-deck rear-delt fly. Unmatched ones come back in `unlisted`, named
 * rather than dropped.
 */
export function listedSubs(exerciseId, exercises) {
  const source = exercises?.[exerciseId];
  const listed = [];
  const unlisted = [];
  if (!source) return { listed, unlisted };

  const byName = new Map();
  const byAlias = new Map();
  for (const [id, exercise] of Object.entries(exercises)) {
    if (!exercise?.name || isRetired(exercise)) continue;
    byName.set(normalize(exercise.name), byName.get(normalize(exercise.name)) ?? id);
    for (const alias of exercise.aliases || []) if (!byAlias.has(normalize(alias))) byAlias.set(normalize(alias), id);
  }
  const seen = new Set([exerciseId]);
  for (const text of source.subs || []) {
    const key = normalize(text);
    const id = byName.get(key) ?? byAlias.get(key);
    if (id && !seen.has(id)) {
      seen.add(id);
      listed.push({ id, exercise: exercises[id], name: text });
    } else if (!id) unlisted.push(text);
  }
  return { listed, unlisted };
}

/**
 * The closest exercise to a name you typed, for a quick-created exercise
 * that has nothing to be swapped from. "Machine curl X" → Machine curl.
 *
 * Equipment words alone ("machine", "cable") are not enough: "Cable thing"
 * guessing the cable fly would put chest volume on an unknown exercise. Null
 * when nothing beyond the equipment matches, which leaves the new exercise
 * with no counted muscles rather than wrong ones.
 */
const beats = (a, b) => {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
};

export function guessBasedOn(name, exercises) {
  const generic = new Set(Object.values(EQUIPMENT_TERMS).flat().flatMap((term) => normalize(term).split(' ')));
  const words = normalize(name).split(' ').filter((word) => word.length > 1 && !generic.has(word));
  if (!words.length) return null;

  let best = null;
  for (const [id, exercise] of Object.entries(exercises || {})) {
    if (!exercise?.name || exercise.custom || isRetired(exercise) || !hasMuscles(exercise)) continue;
    const key = searchKey(exercise);
    const nameKey = ` ${normalize(exercise.name)} `;
    const hits = words.filter((word) => key.includes(` ${word}`)).length;
    if (!hits) continue;
    // Then how much of the whole typed name matches, equipment included, and
    // a match on the exercise's own name beats one through an alias.
    const all = normalize(name).split(' ').filter((word) => key.includes(` ${word}`)).length;
    const own = normalize(name).split(' ').filter((word) => nameKey.includes(` ${word}`)).length;
    const rank = [hits, all, own, -exercise.name.length];
    if (!best || beats(rank, best.rank)) best = { id, rank };
  }
  return best?.id ?? null;
}

/* ═══════════════════════════════════════════════════════════════════════
   Merging into a plan
   ═══════════════════════════════════════════════════════════════════════ */

/** Rest when a library entry does not say: compounds longer than isolation. */
const COMPOUND = new Set(['horizontal-press', 'incline-press', 'vertical-press', 'dip', 'vertical-pull', 'horizontal-row', 'squat', 'lunge', 'hinge', 'hip-thrust']);

/** A library entry, with every field the screens read. */
function asExercise(entry) {
  return {
    tracksMax: false,
    maxConf: 'low',
    how: [],
    why: 'From the exercise library: not part of the plan, here so you can log what you actually did.',
    subs: [],
    watch: null,
    grips: null,
    unit: 'kg',
    defaultRestSec: COMPOUND.has(entry.pattern) ? 150 : 90,
    refPhotoId: null,
    bodyweightLoaded: false,
    ...entry,
    aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
    m: entry.m || {},
    library: true,
  };
}

/**
 * A plan, plus the library.
 *
 * The plan's own exercises are kept exactly as defined — only `pattern`,
 * `equipment` and `aliases` are added from the library's `tags`, and only
 * where the plan does not set them itself. Library exercises are added under
 * ids the plan does not use; an id the plan has keeps the plan's definition.
 */
export function withExerciseLibrary(plan, library) {
  if (!plan || !library?.exercises) return plan;
  const tags = library.tags || {};
  const exercises = {};
  for (const [id, exercise] of Object.entries(plan.exercises || {})) {
    const tag = tags[id];
    exercises[id] = tag
      ? {
          ...exercise,
          pattern: exercise.pattern ?? tag.pattern ?? null,
          equipment: exercise.equipment ?? tag.equipment ?? null,
          aliases: exercise.aliases ?? tag.aliases ?? [],
        }
      : exercise;
  }
  for (const [id, entry] of Object.entries(library.exercises)) {
    if (!exercises[id]) exercises[id] = asExercise(entry);
  }
  return { ...plan, exercises };
}
