/**
 * The form-breakdown flag.
 *
 * Written after the owner's own diagnosis: an AMRAP ground out with a bounce
 * and a broken pause claimed +12 kg of estimated max over a week of consistent
 * data, and the number then justified loads that were too heavy for weeks.
 *
 * The flag exists so a set like that can be logged honestly — it happened, it
 * was work, it belongs in the Log and in the volume count — without being
 * allowed to speak for his strength.
 *
 * The defects these prevent:
 *
 *  - a flag that is stored and then ignored, which is worse than no flag: it
 *    reads as protection that is not there.
 *  - a flagged set silently disappearing. Every exclusion in this app is
 *    reported with its reason.
 *  - the flag deleting the set, or removing it from volume. It is not a
 *    deletion and the work still counted.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { eligibleForStrength, records, bestEstimates } from '../js/analytics.js';

const exercises = {
  benchComp: { name: 'Competition bench press', tracksMax: true, maxConf: 'high' },
};
const logs = [{ id: 1, localDate: '2026-08-28', dateISO: '2026-08-28' }];
const base = {
  id: 1, sessionLogId: 1, exerciseId: 'benchComp',
  load: 100, reps: 8, rpe: 10, isIndexSet: true,
};

test('a flagged set cannot move a working max, and says why', () => {
  const { included, excluded } = eligibleForStrength([{ ...base, formBreakdown: true }], { exercises, logs });

  assert.equal(included.length, 0, 'a form-breakdown set reached the working-max proposal');
  assert.equal(excluded.length, 1);
  assert.equal(excluded[0].reason, 'form breakdown', 'the exclusion is silent');
});

test('the same set without the flag is eligible — the flag is what excludes it', () => {
  const { included, excluded } = eligibleForStrength([{ ...base }], { exercises, logs });
  assert.equal(included.length, 1, 'nothing else about this set disqualifies it');
  assert.equal(excluded.length, 0);
});

test('a flagged set cannot claim a record', () => {
  const heavy = { ...base, formBreakdown: true, load: 200, reps: 1, rpe: 10 };
  const honest = { ...base, id: 2, load: 100, reps: 5, rpe: 8 };
  const out = records([heavy, honest], { exercises, logs });

  assert.equal(out.heaviest.length, 1, 'the flagged set claimed the heaviest-ever load');
  assert.equal(out.heaviest[0].load, 100);
  assert.ok(!out.estimated.some((row) => row.load === 200));
});

test('a flagged set is excluded from the best-estimate list, with the reason kept', () => {
  const rows = bestEstimates(
    [{ ...base, formBreakdown: true }, { ...base, id: 2, load: 100, reps: 5, rpe: 8 }],
    { exercises, logs }
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].samples, 2, 'the flagged set is still counted as a sample');
  assert.equal(rows[0].estimable, 1);
  assert.ok(rows[0].excluded.includes('form breakdown'), 'the reason was dropped');
  // 100 x 5 @ 8 is 81.1% -> 123.3. The 8-rep flagged set would have given 127.2.
  assert.ok(rows[0].value < 124, 'the flagged set still set the best estimate');
});

test('the flag is not a deletion', () => {
  // It must never write deletedAtISO, and the set must stay in the store.
  const set = { ...base, formBreakdown: true };
  assert.equal(set.deletedAtISO, undefined);
  const rows = bestEstimates([set], { exercises, logs });
  assert.equal(rows.length, 0, 'no usable estimate, which is correct');
  // but the set was seen, not skipped:
  const { excluded } = eligibleForStrength([set], { exercises, logs });
  assert.equal(excluded[0].id, 1);
});
