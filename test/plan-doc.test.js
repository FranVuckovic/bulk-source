/**
 * The plan document is generated, and must match the plan it documents.
 *
 * `docs/bulk-plan.md` was hand-written for v1 and went stale without anyone
 * noticing: it still calls C the volume session, D the speed session and E the
 * variation-and-AMRAP session, all of which moved. Following it sends you to
 * the wrong session on the wrong day — the same defect class as the in-app text
 * that told him to rest before the wrong day, which `plan-text.test.js` exists
 * to catch.
 *
 * So the live document is generated from `data/plan-fopip-v2.json`, and this
 * test fails if the committed file is not what the generator produces. Change
 * the plan, run `node dev/plan-doc.mjs`, commit both.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url);
const DOC = new URL('docs/training-plan.md', ROOT);

test('docs/training-plan.md is up to date with the plan', () => {
  const committed = readFileSync(DOC, 'utf8');
  execFileSync(process.execPath, [new URL('dev/plan-doc.mjs', ROOT).pathname], { cwd: ROOT.pathname });
  const regenerated = readFileSync(DOC, 'utf8');

  assert.equal(
    regenerated,
    committed,
    'docs/training-plan.md is stale — run `node dev/plan-doc.mjs` and commit the result'
  );
});

test('it states the rotation and the rest day the plan actually runs', () => {
  const PLAN = JSON.parse(readFileSync(new URL('data/plan-fopip-v2.json', ROOT), 'utf8'));
  const doc = readFileSync(DOC, 'utf8');

  assert.ok(doc.includes(PLAN.meta.rotationOrder.join(' · ')), 'the rotation is written out');
  const week = doc.slice(doc.indexOf('| day | session'), doc.indexOf('Four pressing days'));
  const rest = week.split('\n').findIndex((l) => l.includes('**rest**'));
  const after = week.split('\n')[rest + 1];
  assert.match(after, /\*\*C\*\*/, 'the rest day sits immediately before C');
});

test('the superseded v1 document says so, at the top', () => {
  const old = readFileSync(new URL('docs/bulk-plan.md', ROOT), 'utf8');
  assert.match(old.slice(0, 900), /Superseded/i);
  assert.match(old.slice(0, 900), /training-plan\.md/);
});
