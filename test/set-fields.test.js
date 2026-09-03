/**
 * Every field the set sheet sends must be a field the set record reads.
 *
 * This is a wiring test, and it exists because of a defect that shipped in
 * v2.21.0: the "Form broke" button set `formBreakdown` on the sheet, the sheet
 * passed it to `saveSet`, and `saveSet`'s record never mentioned it. The button
 * worked, the analytics that honoured the flag worked, and there were five
 * tests proving the flag was respected — and none of it mattered, because the
 * value was dropped between the two. Tapping the button and logging the set
 * left no trace that it had ever been tapped.
 *
 * The same shape as `js/photos.js` being absent from the offline shell, and
 * `startSessionAtomic` existing while `ensureActiveLog` went around it: code
 * that is written, tested, and then not called.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const train = readFileSync(new URL('../js/ui/train.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

/** The object literal passed to `ctx.saveSet(...)`, as its top-level keys. */
function saveSetCallKeys(source) {
  const calls = [];
  const re = /ctx\.saveSet\([^,]+,[^,]+,\s*\{/g;
  let match;
  while ((match = re.exec(source))) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      i++;
    }
    const body = source.slice(re.lastIndex, i - 1);
    // Top-level keys only: skip anything nested inside a brace or a call.
    const keys = [];
    let nesting = 0;
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      const key = nesting === 0 && trimmed.match(/^([A-Za-z_$][\w$]*)\s*:/);
      if (key) keys.push(key[1]);
      for (const ch of line) {
        if ('{(['.includes(ch)) nesting++;
        else if ('})]'.includes(ch)) nesting--;
      }
    }
    calls.push(keys);
  }
  return calls;
}

test('the set sheet and the one-tap path both send fields, and they are found', () => {
  const calls = saveSetCallKeys(train);
  assert.ok(calls.length >= 2, `expected the sheet and the one-tap call, found ${calls.length}`);
  for (const keys of calls) assert.ok(keys.length > 3, `a saveSet call with only ${keys.length} fields`);
});

test('every field sent to saveSet is read by saveSet', () => {
  const sent = new Set(saveSetCallKeys(train).flat());
  // `operationId` is read off `values` for idempotency rather than stored.
  const dropped = [...sent].filter((key) => !app.includes(`values.${key}`));

  assert.deepEqual(
    dropped,
    [],
    `these are passed to saveSet and never read from it: ${dropped.join(', ')}`
  );
});

test('the flags that change what a set MEANS are stored, named', () => {
  // Named individually because these are the ones whose loss is silent: the
  // set still saves, still shows in the Log, and quietly claims a record or a
  // working max it should not have.
  for (const field of ['formBreakdown', 'attemptResult', 'isIndexSet', 'toFailure', 'isAmrap', 'pauseStyle']) {
    assert.match(app, new RegExp(`\\b${field}:`), `saveSet's record is missing ${field}`);
  }
});

test('and they survive an export', () => {
  const exporter = readFileSync(new URL('../js/export.js', import.meta.url), 'utf8');
  const columns = exporter.match(/\n {2}sets: \[([^\]]+)\]/);
  assert.ok(columns, 'the sets CSV column list is still there');

  for (const field of ['formBreakdown', 'attemptResult', 'isIndexSet', 'pauseStyle']) {
    assert.match(columns[1], new RegExp(`'${field}'`), `${field} is missing from the sets CSV`);
  }
});
