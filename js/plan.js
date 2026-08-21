/**
 * plan.js — the plan compiler.
 *
 * v1's fatal flaw was that the 33-week periodisation existed only as prose in
 * the block descriptions. Forcing a later block changed almost nothing the
 * Train screen actually prescribed: the Peak block still resolved to 188 sets
 * of ordinary work with unchanged failure flags. Someone could believe they
 * were tapering while the app told them to do the full base plan.
 *
 * Everything the plan says now has to survive this module as data. Given a
 * rotation number and a session position it returns exactly what to do — sets,
 * reps, effort cap, failure permission, load basis — or it refuses to resolve
 * and says why. Train, Plan and the analytics all read the same output, so
 * they cannot disagree about what was prescribed.
 *
 * Pure: inputs in, outputs out. No DOM, no storage, no clock.
 */

/* ═══════════════════════════════════════════════════════════════════════
   Where you are
   ═══════════════════════════════════════════════════════════════════════ */

export function blockFor(plan, rotation) {
  return plan.blocks.find((b) => rotation >= b.from && rotation <= b.to) || null;
}

/** Position of this rotation inside its block, 1-based. */
export const rotationInBlock = (block, rotation) => rotation - block.from + 1;

/**
 * Effort mode for a rotation.
 *
 * Accumulation blocks run the failure experiment: two counterbalanced waves of
 * high, high, standard, standard and then standard, standard, high, high.
 * Reversing the second wave is what stops ordinary progression being mistaken
 * for an effort effect. Everything else has a fixed mode.
 */
export function effortModeFor(plan, rotation) {
  const block = blockFor(plan, rotation);
  if (!block) return null;
  if (block.type === 'baseline') return rotation === block.from ? 'baseline' : 'standard';
  if (block.effortWave !== 'counterbalanced') return block.effortWave === 'standard' ? 'standard' : 'none';

  const position = rotationInBlock(block, rotation); // 1..8
  const wave = position <= 4 ? ['high', 'high', 'standard', 'standard'] : ['standard', 'standard', 'high', 'high'];
  return wave[(position - 1) % 4];
}

/**
 * Static holds: optional, never before rotation 11, at most every other
 * eligible rotation, alternating variants, and never in recovery or the final
 * three rotations. Returns null when no hold is offered.
 */
export function staticHoldFor(plan, rotation) {
  const block = blockFor(plan, rotation);
  if (!block || rotation < 11) return null;
  if (['recovery', 'taper', 'test', 'bridge'].includes(block.type)) return null;

  const eligible = (rotation - 11) % 2 === 0; // every other eligible rotation
  if (!eligible) return null;

  const ordinal = Math.floor((rotation - 11) / 2);
  return ordinal % 2 === 0
    ? { variant: 'primer', pct: 1.08, seconds: '5–8', placement: 'before the top bench work', restAfterSec: 360 }
    : { variant: 'training', pct: 1.12, seconds: '10–15', placement: 'after all competition-bench work', restAfterSec: 240 };
}

/* ═══════════════════════════════════════════════════════════════════════
   Resolving a session
   ═══════════════════════════════════════════════════════════════════════ */

const clone = (slot) => ({ ...slot });

/** Roles whose prescription comes from the block, not from accessory scaling. */
const BENCH_ROLES = ['top_single', 'backoff', 'amrap', 'volume', 'speed', 'test', 'hold'];

/**
 * Accessory volume multiplier, applied across the whole session rather than
 * slot by slot.
 *
 * Rounding each slot on its own does not reach the target: at 85%, three sets
 * round back to three, and a block that promised a 15% cut delivers 4%. This
 * scales the session total and distributes the reduction by largest remainder,
 * so the resolved total actually equals the multiplier.
 *
 * No slot is silently removed — every surviving slot keeps at least one set,
 * and each records what it was scaled from so the screen can say so.
 */
function scaleAccessories(slots, multiplier, { scaleAll = false } = {}) {
  if (multiplier == null || multiplier >= 1) return slots;

  const scalable = slots.filter((slot) => (scaleAll ? !BENCH_ROLES.includes(slot.role) : slot.accessory));
  if (!scalable.length) return slots;

  const total = scalable.reduce((sum, slot) => sum + slot.sets, 0);
  const target = Math.max(scalable.length, Math.round(total * multiplier));

  const parts = scalable.map((slot) => {
    const exact = slot.sets * multiplier;
    const floored = Math.max(1, Math.floor(exact));
    return { slot, sets: floored, remainder: exact - floored };
  });

  // Largest remainder: one extra set per slot per pass, biggest shortfall
  // first. Without the per-pass cap a single slot absorbs every spare set and
  // comes back bigger than it started.
  let spare = target - parts.reduce((sum, part) => sum + part.sets, 0);
  const byRemainder = [...parts].sort((a, b) => b.remainder - a.remainder || b.slot.sets - a.slot.sets);
  while (spare > 0) {
    let gave = 0;
    for (const part of byRemainder) {
      if (spare <= 0) break;
      if (part.sets >= part.slot.sets) continue;
      part.sets += 1;
      spare -= 1;
      gave += 1;
    }
    if (!gave) break;
  }

  const scaled = new Map(parts.map((part) => [part.slot.id, part.sets]));
  return slots.map((slot) => {
    const sets = scaled.get(slot.id);
    if (sets == null || sets === slot.sets) return slot;
    return { ...slot, sets, scaledFrom: slot.sets, scaleReason: `${Math.round(multiplier * 100)}% volume this block` };
  });
}

/** In reduced-fatigue phases nothing goes to failure, whatever the slot says. */
const stripFailure = (slot) => ({ ...slot, failLast: 0, failLastHigh: 0, myoOption: false, failureRemoved: true });

/** Resolve the bench slots for a block. Bench work is entirely block-specific. */
function resolveBench(plan, session, slot, { rotation, block, mode }) {
  const spec = block.bench[session.id];
  if (!spec) return clone(slot);

  const isFirstRotation = rotation === block.from;

  if (slot.role === 'top_single' && session.id === 'A') {
    const single = spec.single;
    if (!single) return null;
    const resolved = {
      ...slot,
      sets: single.sets ?? 1,
      rpe: single.rpe,
      isTest: !!single.test,
      role: single.test ? 'test' : 'top_single',
    };
    if (single.sets === 2) {
      resolved.note = `Work up to one single at RPE ${single.firstRpe ?? single.rpe}, then a second at RPE ${single.rpe}. Never more than two above 90%.`;
    }
    if (single.test) {
      resolved.note =
        rotation === 1
          ? 'Informative paused 1RM test. Safeties and a competent spotter. Count only successful paused attempts; do not repeat a miss.'
          : 'Optional true 1RM attempt after two to four bench-free days. Spotted, with safeties.';
      resolved.repsLow = 1;
      resolved.repsHigh = 1;
    }
    return resolved;
  }

  if (slot.role === 'backoff') {
    const backoff = spec.backoff;
    if (!backoff) return null;
    return {
      ...slot,
      sets: backoff.sets,
      repsLow: backoff.reps,
      repsHigh: backoff.reps,
      rpe: backoff.rpe,
      // v1 fixed these at 85% of the day's single, which computed to an
      // effective RPE below 6 while the slot claimed RPE 8. The load now comes
      // from the day's observed single and the target RPE, not a fixed share.
      pctBasis: 'topSingleRpe',
      note:
        rotation === 1
          ? 'Autoregulated after the test: three triples at RPE 7.'
          : 'Choose the load from the day’s single and the target RPE. Below RPE 7 on the first back-off, add 2.5 kg; above 8.5, drop 2.5–5 kg or remove the last set.',
    };
  }

  if (slot.role === 'amrap') {
    // `amrap` is true, false, or { fromRotation } — the baseline block runs
    // technique work in rotation 1 and the first standardised AMRAP in 2.
    if (spec.amrap === false) return null;
    if (spec.amrap && typeof spec.amrap === 'object' && rotation < spec.amrap.fromRotation) {
      return {
        ...slot,
        role: 'volume',
        amrap: false,
        idx: false,
        sets: 3,
        repsLow: 5,
        repsHigh: 5,
        rpe: 7,
        note: 'Baseline rotation — technique work rather than an AMRAP. The first standardised AMRAP is the next rotation.',
      };
    }
    // Specificity runs the AMRAP only in its first and last rotations.
    if (block.type === 'specificity' && !(rotation === block.from || rotation === block.to)) {
      return {
        ...slot,
        role: 'volume',
        amrap: false,
        idx: false,
        sets: 1,
        repsLow: 3,
        repsHigh: 3,
        rpe: 8,
        note: 'No AMRAP this rotation — a single triple at RPE 8 instead, to keep heavy work the priority.',
      };
    }
    return { ...slot, note: 'Genuine RPE 10, safeties and a spotter. Stop when another clean paused rep is not available.' };
  }

  if (slot.role === 'volume' && session.id === 'C') {
    const variation = spec.variation;
    if (!variation) return null;
    return { ...slot, sets: variation.sets, repsLow: variation.reps, repsHigh: variation.reps, rpe: variation.rpe };
  }

  if (slot.role === 'top_single' && session.id === 'E') {
    const single = spec.single;
    if (!single) return null;
    return { ...slot, rpe: single.rpe, optional: !!single.optional };
  }

  if (slot.role === 'volume' && session.id === 'E') {
    const volume = spec.volume;
    if (!volume) return null;
    return {
      ...slot,
      sets: volume.sets,
      repsLow: volume.reps,
      repsHigh: volume.reps,
      rpe: volume.rpe,
      optional: !!volume.optional,
    };
  }

  if (slot.role === 'speed') {
    const speed = spec.speed;
    if (!speed) return null;
    return {
      ...slot,
      sets: speed.sets,
      repsLow: speed.reps,
      repsHigh: speed.reps,
      rpe: speed.rpe,
      pct: speed.pct,
      optional: !!speed.optional,
    };
  }

  return clone(slot);
}

/**
 * The whole prescription for one session of one rotation.
 *
 * `readiness` is 'normal' | 'yellow' | 'red' and is applied last, because it
 * describes today rather than the plan.
 */
export function resolveSession(plan, { rotation, sessionId, readiness = 'normal' }) {
  const block = blockFor(plan, rotation);
  const session = plan.sessions.find((s) => s.id === sessionId);
  if (!block || !session) {
    return { ok: false, reason: !block ? `no block covers rotation ${rotation}` : `no session ${sessionId}`, slots: [] };
  }

  const mode = effortModeFor(plan, rotation);
  const hold = staticHoldFor(plan, rotation);
  const reduced = ['recovery', 'taper', 'test'].includes(block.type);

  const slots = [];
  for (const raw of session.slots) {
    // The static-hold slot only exists when a hold is actually offered.
    if (raw.role === 'hold') {
      if (!hold) continue;
      slots.push({
        ...raw,
        sets: 2,
        pct: hold.pct,
        pctBasis: 'workingMax',
        restSec: hold.restAfterSec,
        holdVariant: hold.variant,
        note: `${hold.variant === 'primer' ? 'Primer' : 'Training'} hold — ${Math.round(hold.pct * 100)}% for ${hold.seconds} seconds, ${hold.placement}. Rack pins set, spotter present. Optional experiment.`,
      });
      continue;
    }

    let slot = ['top_single', 'backoff', 'amrap', 'volume', 'speed'].includes(raw.role)
      ? resolveBench(plan, session, raw, { rotation, block, mode })
      : clone(raw);
    if (!slot) continue;

    // Failure permission depends on the effort mode, and disappears entirely in
    // reduced-fatigue phases.
    const allowed = mode === 'high' ? slot.failLastHigh : mode === 'none' ? 0 : slot.failLast;
    slot = { ...slot, failSets: reduced || mode === 'none' ? 0 : allowed };
    if (reduced) slot = stripFailure(slot);

    slots.push(slot);
  }

  // In recovery, taper and test rotations the reduction applies to everything
  // that is not bench work, tracked lifts included — a 1RM test rotation with
  // four full sets of weighted pull-ups is not a test rotation.
  const scaledSlots = scaleAccessories(slots, block.accessoryMultiplier, { scaleAll: reduced });

  const resolved = {
    ok: true,
    rotation,
    sessionId,
    blockId: block.id,
    blockName: block.name,
    blockType: block.type,
    effortMode: mode,
    accessoryMultiplier: block.accessoryMultiplier,
    variation: block.variation,
    hold,
    readiness,
    isBaseline: block.type === 'baseline' && rotation === block.from,
    slots: scaledSlots,
  };

  return readiness === 'normal' ? resolved : applyReadiness(resolved);
}

/**
 * Readiness adjustments, applied to an already-resolved session.
 *
 * Yellow: keep the exercise, drop a little load or the last work set, replace
 * the AMRAP if readiness is clearly poor. Red: no AMRAP, no holds, no grinding,
 * bench becomes light triples and accessories run at half volume.
 */
export function applyReadiness(resolved) {
  if (resolved.readiness === 'normal') return resolved;
  const red = resolved.readiness === 'red';

  const slots = resolved.slots
    .map((slot) => {
      if (slot.role === 'hold') return red ? null : slot;

      if (slot.amrap) {
        return {
          ...slot,
          amrap: false,
          idx: false,
          sets: 1,
          repsLow: 3,
          repsHigh: 3,
          rpe: 8,
          failSets: 0,
          adjusted: resolved.readiness,
          note: red
            ? 'Red day — no AMRAP. A single triple at RPE 8, or end the bench work here.'
            : 'Yellow day — the AMRAP is replaced by 1×3 @8. A tired reading is a corrupted reading.',
        };
      }

      if (red) {
        if (['top_single', 'backoff', 'volume', 'test'].includes(slot.role)) {
          return { ...slot, sets: 3, repsLow: 3, repsHigh: 5, rpe: 6, failSets: 0, isTest: false, adjusted: 'red',
                   note: 'Red day — convert to 3×3–5 @6, or end the bench work.' };
        }
        return { ...slot, sets: Math.max(1, Math.round(slot.sets * 0.55)), failSets: 0, adjusted: 'red' };
      }

      // Yellow: drop the final work set from multi-set work, keep index sets.
      if (slot.sets > 2 && !slot.idx) {
        return { ...slot, sets: slot.sets - 1, adjusted: 'yellow', note: 'Yellow day — final work set removed.' };
      }
      return slot;
    })
    .filter(Boolean);

  return { ...resolved, slots, adjusted: resolved.readiness };
}

/* ═══════════════════════════════════════════════════════════════════════
   Validation
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Resolve every rotation × session and report anything that cannot be trained.
 *
 * This runs at startup. A plan that contradicts itself must stop the app with a
 * diagnostic rather than quietly prescribe the wrong session — which is exactly
 * what v1 did for 33 weeks.
 */
export function validatePlan(plan) {
  const problems = [];
  const total = plan.meta.rotations;

  for (let rotation = 1; rotation <= total; rotation++) {
    const block = blockFor(plan, rotation);
    if (!block) {
      problems.push(`rotation ${rotation} is not covered by any block`);
      continue;
    }
    for (const sessionId of plan.meta.rotationOrder) {
      const resolved = resolveSession(plan, { rotation, sessionId });
      if (!resolved.ok) {
        problems.push(`rotation ${rotation} ${sessionId}: ${resolved.reason}`);
        continue;
      }
      if (!resolved.slots.length) problems.push(`rotation ${rotation} ${sessionId} resolves to no work`);

      for (const slot of resolved.slots) {
        if (!plan.exercises[slot.ex]) problems.push(`rotation ${rotation} ${sessionId}: unknown exercise ${slot.ex}`);
        if (!(slot.sets > 0)) problems.push(`rotation ${rotation} ${sessionId} ${slot.ex}: ${slot.sets} sets`);
        if (slot.rpe != null && (slot.rpe < 5 || slot.rpe > 10)) {
          problems.push(`rotation ${rotation} ${sessionId} ${slot.ex}: RPE ${slot.rpe} outside 5–10`);
        }
        if (slot.repsLow != null && slot.repsHigh != null && slot.repsLow > slot.repsHigh) {
          problems.push(`rotation ${rotation} ${sessionId} ${slot.ex}: reps ${slot.repsLow}–${slot.repsHigh}`);
        }
        if (slot.failSets > slot.sets) {
          problems.push(`rotation ${rotation} ${sessionId} ${slot.ex}: ${slot.failSets} failure sets of ${slot.sets}`);
        }
      }
    }
  }

  // The plan's own promises about its shape.
  const r1 = resolveSession(plan, { rotation: 1, sessionId: 'C' });
  if (r1.slots.some((s) => s.amrap)) problems.push('rotation 1 must not contain a bench AMRAP');
  for (const rotation of [15, 31, 32, 33]) {
    if (staticHoldFor(plan, rotation)) problems.push(`rotation ${rotation} must not offer a static hold`);
  }
  for (let rotation = 1; rotation <= 10; rotation++) {
    if (staticHoldFor(plan, rotation)) problems.push(`static holds must not start before rotation 11 (found at ${rotation})`);
  }

  return { ok: problems.length === 0, problems };
}

/** Physical working sets in a resolved session. */
export const setCount = (resolved) => resolved.slots.reduce((total, slot) => total + slot.sets, 0);

/* ═══════════════════════════════════════════════════════════════════════
   Adapter for the screens
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * A resolved slot in the shape the Train screen already renders.
 *
 * The v2 resolver speaks in rep ranges, roles and failure permissions; the
 * screens were written against v1's single `reps` and `failLast`. Rather than
 * rewrite every view at the same time as the engine — which is how new bugs
 * get in — the engine output is adapted here, in one place, with the extra
 * fields carried through for the screens that want them.
 */
export function toDisplaySlot(slot, index) {
  const reps = slot.repsHigh ?? slot.repsLow ?? slot.reps ?? null;
  return {
    ...slot,
    // The rep target shown and prefilled is the top of the range: double
    // progression means you own the top before the load goes up.
    reps,
    repsLow: slot.repsLow ?? reps,
    repsHigh: slot.repsHigh ?? reps,
    failLast: slot.failSets ?? 0,
    myoReps: !!slot.myoOption,
    idx: !!slot.idx,
    amrap: !!slot.amrap,
    pctTop: null,
    slotIndex: index,
  };
}

/** The whole resolved session, ready for the Train screen. */
export function toDisplaySession(resolved) {
  return { ...resolved, slots: resolved.slots.map(toDisplaySlot) };
}

/* ═══════════════════════════════════════════════════════════════════════
   The same exercise, elsewhere in the plan
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * The fields that decide whether two rotations prescribe the same thing.
 *
 * Deliberately not everything on the slot: `id` and `ex` are constant, and
 * including them would make every run look different for no reason. Load is
 * absent because a load is computed from today's working max — the same
 * prescription resolves to a different weight in March than it does in August,
 * and putting a kilogram figure against rotation 24 would be a fiction.
 */
const PRESCRIPTION_FIELDS = [
  'role',
  'sets',
  'repsLow',
  'repsHigh',
  'rpe',
  'amrap',
  'idx',
  'myoOption',
  'failLast',
  'failSets',
  'pct',
  'pctTop',
  'pctBasis',
  'restSec',
  'effort',
  'note',
  'label',
];

/**
 * The fields a phase carries into the current session when you borrow one.
 *
 * Everything that describes the work, and nothing that describes the exercise:
 * `ex` and `id` stay whatever the slot already is, so borrowing rotation 24's
 * bench prescription cannot quietly turn your bench into something else.
 */
export const BORROWABLE_FIELDS = Object.freeze([...PRESCRIPTION_FIELDS]);

const prescriptionSignature = (slot) =>
  slot ? JSON.stringify(PRESCRIPTION_FIELDS.map((field) => slot[field] ?? null)) : null;

/**
 * Which session a slot id belongs to, and its authored form. Slot ids are
 * unique across the whole plan, which is what makes them usable as the anchor
 * here — slot *indices* are not, because readiness removes slots, extras are
 * appended, and the static hold appears in nine rotations out of thirty-three.
 */
export function slotById(plan, slotId) {
  for (const session of plan.sessions || []) {
    const slot = (session.slots || []).find((candidate) => candidate.id === slotId);
    if (slot) return { session, slot };
  }
  return null;
}

/**
 * How one slot's prescription changes across the whole plan.
 *
 * Returns consecutive rotations that prescribe the same thing collapsed into
 * one phase, in order, each carrying the blocks it spans. Derived rather than
 * authored, so it cannot drift from what the Train screen will actually show:
 * the block structure, the effort waves inside Accumulation I, specificity
 * running its AMRAP only at each end, and the rotations where a slot is not
 * prescribed at all all fall out of it.
 *
 * A phase with `slot: null` means the plan does not prescribe this exercise
 * that rotation. Those are real and are reported rather than skipped — "it is
 * not in the plan then" is an answer, and a gap in a list of rotation numbers
 * looks like a bug.
 */
export function exerciseAcrossPlan(plan, slotId) {
  const found = slotById(plan, slotId);
  if (!found) return [];

  const total = plan.meta?.rotations ?? 0;
  const phases = [];
  let signature;

  for (let rotation = 1; rotation <= total; rotation += 1) {
    const resolved = resolveSession(plan, { rotation, sessionId: found.session.id });
    const slot = resolved.ok ? resolved.slots.find((candidate) => candidate.id === slotId) || null : null;
    const next = prescriptionSignature(slot);

    if (next !== signature || !phases.length) {
      phases.push({ from: rotation, to: rotation, slot, blocks: [] });
      signature = next;
    } else {
      phases[phases.length - 1].to = rotation;
    }
  }

  for (const phase of phases) {
    const names = [];
    for (let rotation = phase.from; rotation <= phase.to; rotation += 1) {
      const block = blockFor(plan, rotation);
      if (block && !names.includes(block.name)) names.push(block.name);
    }
    phase.blocks = names;
  }

  return phases;
}

/**
 * The other slots in the same session that train the same exercise.
 *
 * Session A's bench is really two slots — the top single and the back-offs
 * that hang off it — and comparing one without the other says nothing about
 * how the day's bench work changes. Same for E's technique single and its
 * volume sets. Returned in the session's own order.
 */
export function companionSlots(plan, slotId) {
  const found = slotById(plan, slotId);
  if (!found) return [];
  return (found.session.slots || [])
    .filter((slot) => slot.id !== slotId && slot.ex === found.slot.ex)
    .map((slot) => slot.id);
}

/**
 * Everywhere else this exercise is prescribed in the same rotation.
 *
 * Bench appears six times across a rotation at different intensities, and until
 * now the only way to see that was to open five other sessions. `exclude` is a
 * slot id — the one you are standing in front of.
 */
export function sameExerciseElsewhere(plan, exerciseId, rotation, { exclude = null } = {}) {
  const out = [];
  for (const session of plan.sessions || []) {
    const resolved = resolveSession(plan, { rotation, sessionId: session.id });
    if (!resolved.ok) continue;
    for (const slot of resolved.slots) {
      if (slot.ex !== exerciseId || slot.id === exclude) continue;
      out.push({ sessionId: session.id, sessionName: session.name, slot });
    }
  }
  return out;
}
