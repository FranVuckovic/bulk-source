/**
 * The service worker's takeover rule.
 *
 * A worker that waits politely for a safe moment is right for an update
 * between two working builds, and wrong for a device whose current worker
 * cannot start the app. v1's worker answered any failed fetch with index.html
 * — including a request for a JavaScript module, which Chrome refuses to
 * execute as text/html. The page then never runs, so it can never offer the
 * update, so the wait never ends.
 *
 * The predicate is pulled out of sw.js and run directly: the file is a classic
 * worker script rather than a module, so there is nothing to import.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start > -1, `sw.js no longer defines ${name}`);
  const end = source.indexOf('\n}', start) + 2;
  // eslint-disable-next-line no-new-func
  return new Function(`${source.slice(start, end)}; return ${name};`)();
}

const precedesVersionedCaches = extract('precedesVersionedCaches');

test('a v1 cache triggers an immediate takeover', () => {
  assert.equal(precedesVersionedCaches(['bulk-v2']), true, 'the name v1 actually shipped');
  assert.equal(precedesVersionedCaches(['bulk-v1']), true);
  assert.equal(precedesVersionedCaches(['bulk-v2', 'bulk-v2.1.0']), true, 'the old one is still there to break things');
});

test('a current cache does not — the update waits for a safe moment', () => {
  assert.equal(precedesVersionedCaches(['bulk-v2.1.0']), false);
  assert.equal(precedesVersionedCaches(['bulk-v2.0.9', 'bulk-v2.1.0']), false);
  assert.equal(precedesVersionedCaches(['bulk-v10.20.30']), false);
});

test('a first install has nothing to take over from', () => {
  assert.equal(precedesVersionedCaches([]), false);
});

test('caches belonging to something else are none of our business', () => {
  assert.equal(precedesVersionedCaches(['workbox-precache', 'other-app-v1']), false);
});

test('the worker never answers a module request with the shell', () => {
  // The actual v1 defect: `hit || caches.match('./index.html')` as a blanket
  // fallback. The current fetch handler falls back to index.html only for a
  // navigation to the app's own entry point.
  const fetchHandler = source.slice(source.indexOf("addEventListener('fetch'"));
  const fallbacks = [...fetchHandler.matchAll(/match\('\.\/index\.html'\)/g)];
  assert.equal(fallbacks.length, 1, 'exactly one index.html fallback in the whole fetch handler');
  assert.ok(
    fetchHandler.indexOf("request.mode === 'navigate'") < fetchHandler.indexOf("match('./index.html')"),
    'and it sits inside the navigation branch, after the mode check'
  );

  // The shell branch and the catch-all branch must fall back to the network or
  // to nothing — never to a document.
  const shellBranch = fetchHandler.slice(fetchHandler.indexOf('shellPaths.has('));
  assert.ok(!shellBranch.includes("index.html"), 'a module request can never be answered with the shell');
});


test('the worker repairs a shell the browser has evicted', () => {
  // Install runs once. Without a repair pass, a cache emptied afterwards stays
  // half-empty for everything the app does not happen to request — the icons
  // and the manifest — so the app is quietly no longer installable or offline.
  assert.match(source, /function repairShell\(/, 'sw.js defines a repair pass');
  assert.match(source, /event\.data === 'verify-shell'/, 'and the app can ask for it');

  const repair = source.slice(source.indexOf('async function repairShell('), source.indexOf("self.addEventListener('message'"));
  assert.ok(repair.includes('SHELL.filter'), 'it works out what is missing rather than re-adding everything');
  assert.ok(repair.includes("cache: 'reload'"), 'and refetches rather than trusting the HTTP cache');

  // The app has to actually send it, or the pass never runs.
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /postMessage\('verify-shell'\)/, 'app.js asks the worker to verify the shell at startup');
});

test('a failed repair cannot stop the app', () => {
  // Offline there is nothing to repair with, and that is not an error worth
  // showing: the app runs on whatever is already cached.
  const handler = source.slice(source.indexOf("event.data === 'verify-shell'"));
  assert.ok(handler.includes('.catch('), 'the repair is caught');
  assert.ok(handler.includes('offline: true'), 'and reports the offline case rather than throwing');
});
