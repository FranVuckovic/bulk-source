/**
 * The rotation order, and the in-app text that depends on it.
 *
 * `meta.rotationOrder` is the single source of truth for sequencing — every
 * screen, the next-session logic and the cycle progress all read it. Changing
 * it is a one-line edit, which is exactly why the guidance written against the
 * old order can be left behind silently.
 *
 * That has happened before in this plan. Two knowledge entries told you to drop
 * "the jump work from Session F" when the jumps have always been in D — a
 * leftover from v1, where D and F were the other way round. The advice was
 * unfollowable: there is nothing in F to drop.
 *
 * These tests fail when the order and the text disagree.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PLAN = JSON.parse(readFileSync(new URL('../data/plan-fopip-v2.json', import.meta.url), 'utf8'));
const ORDER = PLAN.meta.rotationOrder;
const text = PLAN.knowledge.map((k) => `${k.t}\n${k.c}`).join('\n\n');
const plain = text.replace(/<[^>]+>/g, ' ');

test('the rotation order is every session, once', () => {
  const ids = PLAN.sessions.map((s) => s.id).sort();
  assert.deepEqual([...ORDER].sort(), ids);
});

/** Sessions that follow each other, treating the rotation as a loop. */
const adjacent = (a, b) => {
  const i = ORDER.indexOf(a);
  return i !== -1 && ORDER[(i + 1) % ORDER.length] === b;
};

test('"never rest between X and Y" names a pair that is actually adjacent', () => {
  const claims = [...plain.matchAll(/rest between ([A-F]) and ([A-F])/g)];
  assert.ok(claims.length, 'the rest-day guidance still makes this claim');
  for (const [, a, b] of claims) {
    assert.ok(
      adjacent(a, b),
      `the text says never rest between ${a} and ${b}, but the rotation runs ${ORDER.join(' ')}`
    );
  }
});

test('the rest-day entry states the rotation the plan actually runs', () => {
  const entry = PLAN.knowledge.find((k) => k.t === 'Where to put rest days');
  assert.ok(entry, 'the entry still exists');
  const stated = entry.c.match(/([A-F](?:\s*·\s*(?:[A-F]|rest))+)/);
  assert.ok(stated, 'it writes the rotation out');

  const sessions = stated[1].split('·').map((s) => s.trim()).filter((s) => s !== 'rest');
  assert.deepEqual(sessions, ORDER, 'the written rotation matches meta.rotationOrder');
});

test('the rest day is written as sitting before the session it protects', () => {
  const entry = PLAN.knowledge.find((k) => k.t === 'Where to put rest days');
  const stated = entry.c.match(/([A-F](?:\s*·\s*(?:[A-F]|rest))+)/)[1].split('·').map((s) => s.trim());
  const rest = stated.indexOf('rest');
  assert.ok(rest > 0, 'the rotation includes a rest day');

  const protects = stated[(rest + 1) % stated.length];
  assert.match(entry.c, new RegExp(`Before ${protects}</strong>`), `the reasoning covers ${protects}`);
  assert.match(entry.c, new RegExp(`one rest day[^.]*before ${protects}`, 'i'));
});

test('the session named for the jumps is the session that has them', () => {
  const jumpSessions = PLAN.sessions
    .filter((s) => s.slots.some((slot) => (PLAN.exercises[slot.ex]?.name || '').match(/jump/i)))
    .map((s) => s.id);
  assert.deepEqual(jumpSessions, ['D'], 'the jumps are in D');

  for (const [, letter] of plain.matchAll(/jump[^.]{0,60}?Session ([A-F])|Session ([A-F])[^.]{0,40}?jump/g)) {
    assert.ok(jumpSessions.includes(letter), `the text puts the jumps in ${letter}`);
  }
  for (const [, letter] of plain.matchAll(/drop the jump work from Session ([A-F])/g)) {
    assert.ok(jumpSessions.includes(letter), `the text says to drop jump work from ${letter}, which has none`);
  }
});

test('nothing still claims the old alphabetical rotation', () => {
  assert.doesNotMatch(plain, /A\s*·\s*B\s*·\s*C\s*·\s*D/, 'a stale A · B · C · D rotation is written down');
});

test('the Train picker offers the sessions in rotation order', () => {
  // The Plan screen has always mapped `meta.rotationOrder`; the Train picker
  // mapped `plan.sessions`, the order they sit in the file. Identical until the
  // rotation became A D E F C B, at which point the two screens disagreed about
  // what order to train in.
  const train = readFileSync(new URL('../js/ui/train.js', import.meta.url), 'utf8');
  const picker = train.match(/<div class="picker">\$\{([\s\S]{0,120})/);
  assert.ok(picker, 'the picker is still built here');
  assert.match(picker[1], /rotationOrder/, 'the picker maps rotationOrder');
});
