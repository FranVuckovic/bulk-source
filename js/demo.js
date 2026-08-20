/**
 * demo.js — demo mode, and the invented history it shows.
 *
 * Demo mode exists so every screen and chart can be seen full rather than
 * empty, without the owner's real training log being anywhere near the risk.
 * Two independent guarantees hold that, either of which would be enough:
 *
 *   1. A different database. Demo data lives in `bulk-demo`; the real log lives
 *      in `bulk`. IndexedDB gives one database no way to read, write or even
 *      see another, so the real data is not merely left alone — it is not
 *      reachable from here. Nothing has to be remembered for that to hold.
 *
 *   2. A write lock in db.js. While demo mode is on, `withTransaction` refuses
 *      every readwrite transaction, and every write in this app goes through
 *      it. Logging is impossible rather than hidden: a save button someone
 *      forgot to disable fails loudly instead of quietly working.
 *
 * Turning demo mode off cannot lose anything, because nothing was ever written
 * to the real database while it was on — the app did not even have it open.
 *
 * The history itself is the generator that already existed in
 * `dev/sample-data.html`, moved here rather than rewritten. It resolves every
 * session through the real plan engine, so what it shows is what the app would
 * genuinely have prescribed on that rotation. A second generator would drift
 * from the first and one of them would start lying.
 */

import { openDatabase, put, saveSession, writeSetting, clearStore, getAll, ALL_STORES, logicalSetKey, DEMO_DB_NAME } from './db.js';
import { resolveSession, toDisplaySession, blockFor, effortModeFor } from './plan.js';
import { newCycle } from './cycle.js';
import { prescribedLoad, roundToIncrement } from './calc.js';
import { localDate, addDays } from './dates.js';

/* ═══════════════════════════════════════════════════════════════════════
   Is demo mode on?
   ═══════════════════════════════════════════════════════════════════════ */

const FLAG = 'bulk.demoMode';

/*
 * The flag lives in localStorage rather than in either database, because it has
 * to be read *before* deciding which database to open. It also fails in the
 * safe direction: if it is missing, unreadable, or storage is denied, the
 * answer is "no" and the app opens the real log. There is no failure of this
 * flag that puts demo data in front of you believing it is real.
 */
export function demoModeOn() {
  try {
    return globalThis.localStorage?.getItem(FLAG) === 'on';
  } catch {
    return false;
  }
}

export function setDemoMode(on) {
  try {
    if (on) globalThis.localStorage?.setItem(FLAG, 'on');
    else globalThis.localStorage?.removeItem(FLAG);
    return true;
  } catch {
    return false;
  }
}

/** The demo database, opened by name so it can never be the real one. */
export const openDemoDatabase = () => openDatabase({ name: DEMO_DB_NAME });

/* ═══════════════════════════════════════════════════════════════════════
   The invented history
   ═══════════════════════════════════════════════════════════════════════ */

export const DEMO_ROTATIONS = 12;
const INCREMENT = 2.5;

const ACCESSORY_KG = {
  benchSpeed: 75, inclineFly: 14, cableFly: 16, pulldown: 70, rowCSR: 60, rowOneArm: 34, rowMachine: 70,
  facepull: 22, reardelt: 14, reardeltPecDeck: 30, reardeltCable: 12, lateral: 12, triOH: 25, skull: 30,
  pushdown: 30, curlIncline: 16, curlBayesian: 14, curlEZ: 22, curlHammer: 16, curlHighCable: 12,
  curlReverse: 14, wrist: 20, wristRoller: 5, wristFlex: 12, wristExt: 8, cableCrunch: 40, cableRotation: 20,
  hangingRaise: null, abWheel: null, pallof: 20, hackBulg: 100, hipThrust: 120, legcurlSeat: 45,
  legcurlLie: 40, quadext: 55, calfStand: 80, calfSeat: 60, revhyper: 20, jumps: null,
};

// Deterministic jitter, so reloading the page produces the same history twice.
const wobble = (seed) => {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};
const round1 = (v) => Math.round(v * 10) / 10;

/**
 * Sessions are dated backwards from today so the history always ends now:
 * five sessions a week, then a two-day gap.
 */
function scheduleFor(count) {
  const days = [];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    days.push(cursor);
    cursor += i % 5 === 4 ? 3 : 1;
  }
  const span = days[days.length - 1];
  const today = localDate();
  return days.map((offset) => addDays(today, offset - span));
}


/**
 * A stand-in photo. Obviously synthetic — nobody should mistake one of these
 * for a real check-in — but a genuine JPEG of a realistic size, so storage,
 * the gallery and the export all behave the way they will with real ones.
 */
async function drawnPhoto(dateISO, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const c = canvas.getContext('2d');

  const gradient = c.createLinearGradient(0, 0, width, height);
  const seed = wobble(Date.parse(dateISO) / 86400000);
  gradient.addColorStop(0, `hsl(${Math.round(seed * 360)} 30% 26%)`);
  gradient.addColorStop(1, `hsl(${Math.round(seed * 360 + 40)} 24% 12%)`);
  c.fillStyle = gradient;
  c.fillRect(0, 0, width, height);

  c.fillStyle = 'rgba(255,255,255,.16)';
  c.beginPath();
  c.ellipse(width / 2, height * 0.55, width * 0.22, height * 0.3, 0, 0, Math.PI * 2);
  c.fill();

  c.fillStyle = 'rgba(255,255,255,.75)';
  c.font = `700 ${Math.round(width / 14)}px system-ui, sans-serif`;
  c.textAlign = 'center';
  c.fillText('SAMPLE', width / 2, height * 0.16);
  c.font = `500 ${Math.round(width / 22)}px system-ui, sans-serif`;
  c.fillText(dateISO, width / 2, height * 0.16 + width / 12);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.7));
  return { bytes: new Uint8Array(await blob.arrayBuffer()) };
}

async function generate(db, plan, ROTATIONS, INCREMENT) {
  const bodyweight = plan.meta.referenceBodyweightKg ?? 90;
  const order = plan.meta.rotationOrder;

  // One session is skipped in rotation 9, and the last rotation stops early —
  // both states the app has to handle without inventing a finished cycle.
  const skipped = new Set(['9:D']);
  const positions = [];
  for (let rotation = 1; rotation <= ROTATIONS; rotation++) {
    for (const sessionId of order) {
      if (skipped.has(`${rotation}:${sessionId}`)) continue;
      if (rotation === ROTATIONS && sessionId >= 'E') continue;
      positions.push({ rotation, sessionId });
    }
  }

  const dates = scheduleFor(positions.length);
  const firstDate = dates[0];

  // Working maxes climb about 0.8% a rotation, which is what makes the trend
  // lines, the records and the block comparison move.
  const maxAt = (exerciseId, rotation) => {
    const seed = plan.meta.seedWorkingMaxes[exerciseId];
    return seed == null ? null : roundToIncrement(seed * (1 + 0.008 * (rotation - 1)), INCREMENT);
  };

  const cycleIds = new Map();
  for (let rotation = 1; rotation <= ROTATIONS; rotation++) {
    const first = positions.findIndex((p) => p.rotation === rotation);
    const localStartDate = dates[first];
    const cycle = newCycle(plan, {
      sequence: rotation,
      startedAtISO: `${localStartDate}T17:30:00.000Z`,
      localStartDate,
    });
    const lastIndex = positions.map((p) => p.rotation).lastIndexOf(rotation);
    if (rotation < ROTATIONS) {
      cycle.status = 'finished';
      cycle.localEndDate = dates[lastIndex];
      cycle.endedAtISO = `${dates[lastIndex]}T19:00:00.000Z`;
    }
    await put(db, 'cycles', cycle);
    cycleIds.set(rotation, cycle.id);
  }

  for (const [index, position] of positions.entries()) {
    const { rotation, sessionId } = position;
    const localDate = dates[index];

    // Two sessions were logged on a yellow day, so the readiness trim is part
    // of the history rather than a state you have to go and create by hand.
    const readiness = index === positions.length - 4 || index === 22 ? 'yellow' : 'normal';
    // resolveSession applies readiness itself — doing it again would trim twice.
    const resolved = toDisplaySession(resolveSession(plan, { rotation, sessionId, readiness }));
    const block = blockFor(plan, rotation);

    const startedAt = `${localDate}T17:30:00.000Z`;
    const minutes = 62 + Math.round(wobble(index) * 26);
    const endedAt = new Date(Date.parse(startedAt) + minutes * 60000).toISOString();

    const sets = [];
    // Wall-clock position within the session, advanced as each set is written.
    let elapsedSeconds = 240 + Math.round(wobble(index * 5) * 180);
    resolved.slots.forEach((slot, slotIndex) => {
      const exercise = plan.exercises[slot.ex];
      if (!exercise) return;
      const workingMax = maxAt(slot.ex, rotation);
      const restSec = slot.restSec || exercise.defaultRestSec || 120;

      for (let setIndex = 0; setIndex < slot.sets; setIndex++) {
        // The odd set genuinely does not get logged — the app has to cope.
        if (wobble(index * 31 + slotIndex * 7 + setIndex) > 0.95) continue;

        let load;
        if (workingMax) {
          load = prescribedLoad(slot, workingMax, INCREMENT, {
            bodyweight: exercise.bodyweightLoaded ? bodyweight : 0,
          });
        } else if (exercise.bodyweightLoaded) {
          load = roundToIncrement(4 + rotation * 0.6, INCREMENT);
        } else {
          const base = ACCESSORY_KG[slot.ex];
          load = base == null ? null : roundToIncrement(base * (1 + 0.006 * (rotation - 1)), base >= 40 ? 5 : 2.5);
        }

        // An AMRAP is the one set where the rep count is the result, so it
        // climbs with the block rather than sitting at its nominal number.
        const reps = slot.amrap
          ? Math.max(1, slot.repsLow + Math.floor(rotation / 4))
          : slot.repsHigh ?? slot.reps ?? 8;
        const toFailure = setIndex >= slot.sets - (slot.failLast || 0);

        // The set itself, then the rest after it, with a little variation so the
        // gaps are not all identical.
        elapsedSeconds += 25 + Math.round(restSec * (0.85 + wobble(index * 13 + slotIndex * 3 + setIndex) * 0.4));

        sets.push({
          exerciseId: slot.ex,
          slotIndex,
          setIndex,
          load,
          reps,
          rpe: slot.amrap ? 10 : toFailure ? 10 : slot.rpe ?? 8,
          rir: null,
          toFailure,
          isAmrap: !!slot.amrap,
          isIndexSet: !!slot.idx,
          isMyoRep: !!slot.myoReps && setIndex === slot.sets - 1,
          velocity: null,
          note: null,
          wasPrescribed: true,
          prescribedLoad: load,
          // Spaced by the exercise's own rest interval plus the time the set
          // takes, so the demo exercises the timing report the way a real
          // session does. Writing them all at `startedAt` made every generated
          // session look bulk-entered — which it was, but it meant the rest
          // chart never appeared in the demo at all.
          timestampISO: new Date(Date.parse(startedAt) + elapsedSeconds * 1000).toISOString(),
          localDate,
          gripWidth: exercise.grips ? exercise.grips[0] : null,
          bodyweightUsed: exercise.bodyweightLoaded ? bodyweight : null,
          variantUsed: null,
          substitutionReason: null,
          pauseStyle: slot.ex.startsWith('bench') ? 'paused' : null,
        });
      }
    });

    // The same end state the app writes when you press Finish — without these
    // the cycle card would show a rotation with six sessions still owed.
    const prescribedSets = resolved.slots.reduce((total, slot) => total + slot.sets, 0);
    const ratio = Math.min(1, Math.round((sets.length / prescribedSets) * 100) / 100);

    const { sessionLogId } = await saveSession(
      db,
      {
        dateISO: localDate,
        status: ratio >= 0.5 ? 'complete' : 'partial',
        completionRatio: ratio,
        prescribedSets,
        loggedSets: sets.length,
        localEndDate: localDate,
        localDate,
        startedAt,
        endedAt,
        sessionId,
        rotationPosition: sessionId,
        rotationIndex: order.indexOf(sessionId),
        cycleId: cycleIds.get(rotation),
        cycleSequence: rotation,
        blockId: block ? block.id : null,
        effortMode: effortModeFor(plan, rotation),
        readiness,
        planVersion: plan.meta.planVersion,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        bodyweight: round1(88.6 + index * 0.062),
        sessionRpe: Math.round((6.5 + wobble(index * 3) * 2) * 2) / 2,
        note: null,
        isPartial: ratio < 0.5,
        deviations: { swaps: {}, extras: [], addedSets: {} },
        grips: {},
      },
      sets
    );

    // The unique index that makes a double tap impossible is only meaningful
    // if the sample data carries it too.
    const stored = (await getAll(db, 'sets')).filter((s) => s.sessionLogId === sessionLogId && !s.logicalKey);
    for (const set of stored) {
      await put(db, 'sets', { ...set, logicalKey: logicalSetKey(sessionLogId, set.slotIndex, set.setIndex) });
    }
  }

  // Working maxes confirmed at each block boundary, the way the review writes
  // them, so the Progress table has a history behind it.
  for (const exerciseId of Object.keys(plan.meta.seedWorkingMaxes)) {
    await put(db, 'maxes', {
      exerciseId,
      workingMax: maxAt(exerciseId, ROTATIONS),
      confirmedISO: `${dates[dates.length - 1]}T19:00:00.000Z`,
      reason: 'block-boundary',
      source: 'sample-data',
    });
  }

  const totalDays = 1 + Math.round((Date.parse(dates[dates.length - 1]) - Date.parse(firstDate)) / 86400000);
  for (let day = 0; day < totalDays; day++) {
    const dateISO = addDays(firstDate, day);
    await put(db, 'daily', {
      dateISO,
      localDate: dateISO,
      bodyweight: round1(88.4 + day * 0.064 + (wobble(day) - 0.5) * 0.5),
      bodyfatPct: round1(12.8 + day * 0.008),
      sleepHours: round1(6.6 + wobble(day * 2) * 1.7),
      steps: 8000 + Math.round(wobble(day * 5) * 5000),
      mood: 3 + Math.round(wobble(day * 9) * 2),
      caffeine: wobble(day * 11) > 0.5 ? 'yes' : 'no',
      note: null,
    });

    if (day % 7 === 0) {
      await put(db, 'measurements', {
        dateISO,
        localDate: dateISO,
        waist: round1(81.2 + day * 0.021),
        chest: round1(107.5 + day * 0.03),
        shoulders: round1(127.5 + day * 0.019),
        armL: round1(38.1 + day * 0.011),
        armR: round1(38.4 + day * 0.011),
        quadL: round1(61.5 + day * 0.008),
        quadR: round1(61.8 + day * 0.008),
        neck: 39.5,
        note: null,
      });
    }
    if (day % 28 === 0) {
      // Real bytes, not nulls: a placeholder photo exercises the gallery, the
      // viewer, the compare sheet and the export the same way a real one does.
      const image = await drawnPhoto(dateISO, 1280, 1707);
      const thumb = await drawnPhoto(dateISO, 320, 427);
      await put(db, 'media', {
        dateISO,
        localDate: dateISO,
        kind: 'physique',
        exerciseId: null,
        load: null,
        reps: null,
        note: 'Front relaxed',
        fileRef: `sample-${dateISO}.jpg`,
        imageBytes: image.bytes,
        imageType: 'image/jpeg',
        thumbBytes: thumb.bytes,
        thumbType: 'image/jpeg',
        width: 1280,
        height: 1707,
        bytes: image.bytes.length,
      });
    }
  }

  const daysAgo = (n) => addDays(localDate(), -n);
  await put(db, 'niggles', {
    dateISO: daysAgo(31), localDate: daysAgo(31), site: 'Left elbow', severity: 1,
    context: 'Second set of skullcrushers', note: null,
  });
  await put(db, 'niggles', {
    dateISO: daysAgo(9), localDate: daysAgo(9), site: 'Left elbow', severity: 2,
    context: 'Close-grip bench, top set', note: null,
  });
  await put(db, 'media', {
    dateISO: daysAgo(6), localDate: daysAgo(6), kind: 'formcheck', exerciseId: 'benchComp',
    load: 105, reps: 6, note: 'Bench AMRAP · 105 kg × 6', fileRef: 'IMG_4417.mov',
    imageBytes: null, imageType: null,
  });

  const lastRotationStart = dates[positions.findIndex((p) => p.rotation === ROTATIONS)];
  await writeSetting(db, 'cycleSequence', ROTATIONS);
  await writeSetting(db, 'cycleStartedAtISO', `${lastRotationStart}T17:30:00.000Z`);
  await writeSetting(db, 'cycleStartedDate', lastRotationStart);
  await writeSetting(db, 'activeSessionLogId', null);
}

/**
 * Fill a database with twelve rotations of invented history.
 *
 * Loading always clears first: sessions are keyed by an auto-incrementing id,
 * so seeding twice on top of itself would silently give every session twice.
 */
export async function seedDemoData(db, plan, { rotations = DEMO_ROTATIONS, increment = INCREMENT } = {}) {
  await eraseDemoData(db);
  await generate(db, plan, rotations, increment);
}

/** Empty a database completely, settings aside. */
export async function eraseDemoData(db) {
  for (const store of ALL_STORES) {
    if (store !== 'settings') await clearStore(db, store);
  }
  await writeSetting(db, 'activeSessionLogId', null);
  await writeSetting(db, 'cycleSequence', 1);
  await writeSetting(db, 'cycleStartedAtISO', null);
  await writeSetting(db, 'cycleStartedDate', null);
}
