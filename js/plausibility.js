/**
 * plausibility.js — is a number worth a second look before it is saved?
 *
 * Pure. Never blocks anything: a caller asks "Save it anyway?" and saves
 * whatever the answer. From real use, 1025 typed for 102.5 was saved without
 * a word, showed an e1RM of 1304 kg, and went into every chart; a 1300 kg
 * working max prescribed 1197.5 kg that one tap would have logged.
 *
 * Minimal on purpose: the load against the best load ever logged for the same
 * exercise. Bodyweight lifts compare bodyweight + added, so a first weighted
 * dip is not mistaken for a typo.
 */

/** How far past the best logged load a set has to be to be questioned. */
export const LOAD_FACTOR = 1.5;

const total = (set) => (Number.isFinite(set?.load) ? set.load + (Number(set.bodyweightUsed) || 0) : null);
const kg = (value) => String(Math.round(value * 10) / 10);

/**
 * Null when the set looks like something that could have happened, otherwise
 * the question to ask about it.
 *
 * `history` is every stored set; the set itself (by id) and deleted rows are
 * left out, so editing an outlier compares it against the rest.
 */
export function checkSet(set, history) {
  const value = total(set);
  if (value == null || value <= 0 || !set.exerciseId) return null;

  let best = null;
  let bestRow = null;
  for (const row of history || []) {
    if (row.exerciseId !== set.exerciseId || row.deletedAtISO) continue;
    if (set.id != null && row.id === set.id) continue;
    const t = total(row);
    if (t != null && (best == null || t > best)) {
      best = t;
      bestRow = row;
    }
  }
  if (best == null || best <= 0 || value <= best * LOAD_FACTOR) return null;
  return `Save ${kg(set.load)} kg? Your best on this lift is ${kg(bestRow.load)} kg.`;
}
