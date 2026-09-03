/**
 * The in-app guidance must name the sessions the plan actually has.
 *
 * v1 and v2 use the same six letters for different sessions: C and E are
 * swapped, and so are D and F. Several knowledge entries were written against
 * v1 and survived the rewrite, so the app told you to rest before Session E for
 * the AMRAP, to skip the AMRAP in Session E, and that Session C was bench
 * volume. The AMRAP is in C. Following that advice meant resting before the
 * wrong day and skipping nothing.
 *
 * The plan file states where the AMRAP is twice — in the session's name and in
 * the slot itself — so the text was the only thing disagreeing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PLAN = JSON.parse(readFileSync(new URL('../data/plan-fopip-v2.json', import.meta.url), 'utf8'));
const knowledge = PLAN.knowledge.map((entry) => `${entry.t}\n${entry.c}`).join('\n\n');

/** The session that actually holds the bench AMRAP, read from the slots. */
const amrapSession = PLAN.sessions.find((session) => session.slots.some((slot) => slot.amrap));

test('the plan has exactly one bench AMRAP, and its session name says so', () => {
  const withAmrap = PLAN.sessions.filter((session) => session.slots.some((slot) => slot.amrap));
  assert.equal(withAmrap.length, 1, 'one AMRAP session');
  assert.equal(amrapSession.id, 'C');
  assert.match(amrapSession.name, /AMRAP/i, 'and the name agrees with the slot');
});

test('no knowledge entry attaches the AMRAP to a different session', () => {
  const wrong = [];
  for (const entry of PLAN.knowledge) {
    for (const match of entry.c.matchAll(/Session ([A-F])[^.<]{0,80}AMRAP|AMRAP[^.<]{0,40}Session ([A-F])/g)) {
      const letter = match[1] || match[2];
      if (letter !== amrapSession.id) wrong.push(`${entry.t}: Session ${letter}`);
    }
    for (const match of entry.c.matchAll(/([A-F]) \(AMRAP\)/g)) {
      if (match[1] !== amrapSession.id) wrong.push(`${entry.t}: ${match[1]} (AMRAP)`);
    }
  }
  assert.deepEqual(wrong, [], 'the AMRAP is in Session C');
});

test('the session-length guidance states the set count the plan actually prescribes', () => {
  const entry = PLAN.knowledge.find((k) => k.t === 'How long each session should take');
  assert.ok(entry, 'the entry still exists');

  for (const session of PLAN.sessions) {
    const planned = session.slots.reduce((total, slot) => total + slot.sets, 0);
    const stated = entry.c.match(new RegExp(`<strong>${session.id} \u00b7 [^<]*?\u2014 (\\d+) sets`));
    assert.ok(stated, `session ${session.id} is described`);
    assert.equal(
      Number(stated[1]),
      planned,
      `session ${session.id}: the text says ${stated[1]} sets, the plan prescribes ${planned}`
    );
  }
});

test('the baseline rotation is described the way the engine actually behaves', async () => {
  // The text used to tell you to skip the AMRAP in rotation 1. The engine
  // already substitutes technique work for it, so the instruction was both
  // pointed at the wrong session and asking for something already done.
  const { resolveSession } = await import('../js/plan.js');

  // By slot id, not by exercise: session C now opens with the weekly attempt,
  // which is also benchComp, so matching on the exercise finds the wrong slot.
  const amrapSlot = (session) => session.slots.find((slot) => slot.id === 'C1');

  const first = resolveSession(PLAN, { rotation: 1, sessionId: 'C' });
  const firstBench = amrapSlot(first);
  assert.equal(firstBench.amrap, false, 'rotation 1 runs no AMRAP');
  assert.equal(firstBench.rpe, 7, 'it is technique volume');

  const second = resolveSession(PLAN, { rotation: 2, sessionId: 'C' });
  const secondBench = amrapSlot(second);
  assert.equal(secondBench.amrap, true, 'and rotation 2 is the first real one');
  assert.equal(secondBench.rpe, 10);

  assert.match(knowledge, /No AMRAP this rotation/, 'and the text says so');
});
