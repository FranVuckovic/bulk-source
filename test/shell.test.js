/**
 * The offline shell has to hold the whole module graph.
 *
 * A file that is imported but not precached works perfectly in development,
 * works on the first online load, and then fails the first time the app is
 * opened in a gym with no signal — which is the one time it matters. This is
 * exactly what happened to `photos.js`: added after the shell list was
 * written, and invisible until this test existed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), 'utf8');

/** Every path listed in the service worker's SHELL array. */
function shellPaths() {
  const source = read('sw.js');
  const block = source.slice(source.indexOf('const SHELL = ['), source.indexOf('];', source.indexOf('const SHELL = [')));
  return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1].replace(/^\.\//, ''));
}

/** Walk the import graph from index.html's entry point. */
function moduleGraph() {
  const entry = 'js/app.js';
  const seen = new Set();
  const queue = [entry];

  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);

    for (const match of read(file).matchAll(/from\s+'(\.[^']+)'/g)) {
      queue.push(normalize(join(dirname(file), match[1])));
    }
  }
  return seen;
}

test('every module the app imports is in the offline shell', () => {
  const shell = new Set(shellPaths());
  const missing = [...moduleGraph()].filter((file) => !shell.has(file));
  assert.deepEqual(missing, [], `not precached: ${missing.join(', ')}`);
});

test('the shell lists nothing that does not exist', () => {
  const missing = shellPaths().filter((path) => {
    if (path === '' || path.endsWith('/')) return false;
    try {
      readFileSync(join(root, path));
      return false;
    } catch {
      return true;
    }
  });
  assert.deepEqual(missing, [], `listed but absent: ${missing.join(', ')}`);
});

test('the shell holds the plan the app actually loads, and not the one it does not', () => {
  const shell = new Set(shellPaths());
  const planUrl = read('js/app.js').match(/PLAN_URL\s*=\s*'\.\/([^']+)'/)?.[1];
  assert.ok(planUrl, 'app.js still names a plan file');
  assert.ok(shell.has(planUrl), `${planUrl} is loaded at startup but not precached`);
});

test('every js file in the project is reachable from the entry point', () => {
  // A module nothing imports is either dead or a missing wire-up. Either way
  // it should be noticed rather than shipped.
  const graph = moduleGraph();
  const files = [];
  for (const dir of ['js', 'js/ui']) {
    for (const name of readdirSync(join(root, dir))) {
      if (name.endsWith('.js')) files.push(relative(root, join(root, dir, name)));
    }
  }
  const orphans = files.filter((file) => !graph.has(file));
  assert.deepEqual(orphans, [], `imported by nothing: ${orphans.join(', ')}`);
});


test('the app opens sessions only through the atomic path', () => {
  // The guarantee is only worth as much as the call site. `startSessionAtomic`
  // was written, tested and then not used: `ensureActiveLog` wrote the log and
  // the active pointer separately, so five taps in one turn of the event loop
  // opened five sessions for the same slot.
  const app = read('js/app.js');
  const starter = app.slice(app.indexOf('async function ensureActiveLog'), app.indexOf('async function saveSet'));

  assert.ok(starter.includes('startSessionAtomic('), 'ensureActiveLog must go through startSessionAtomic');
  assert.ok(starter.includes('operationId'), 'and must pass a stable operation id');
  assert.ok(!starter.includes('saveSession('), 'a plain saveSession here bypasses the active-pointer check');
});

test('deletion in the app is recoverable, not a raw remove', () => {
  const app = read('js/app.js');
  const deleter = app.slice(app.indexOf('async deleteEntry('), app.indexOf('async emptyBin('));
  assert.ok(deleter.includes('softDeleteSession('), 'sessions are soft-deleted');
  assert.ok(deleter.includes('softDeleteRow('), 'so is everything else');
  assert.ok(!deleter.includes('deleteSessionCascade('), 'the cascade belongs to emptying the bin only');
});
