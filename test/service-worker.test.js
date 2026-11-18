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
  // fetchShell refetches past the HTTP cache and the CDN; see the L6 test.
  assert.ok(repair.includes('fetchShell(cache, missing)'), 'and refetches rather than trusting the HTTP cache');

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

test('L6: the shell is fetched for this version, so a CDN-stale copy cannot be cached under it', async () => {
  // `cache: 'reload'` skips the browser's HTTP cache but not GitHub Pages' CDN,
  // which serves for about ten minutes after a publish. A new sw.js arriving
  // before the CDN had refreshed the modules installed the OLD modules under
  // the NEW version, and they stayed until the next bump. A per-version query
  // is a URL the CDN has never cached; the copy is stored under the plain path
  // the app asks for.
  const start = source.indexOf('function withVersion(');
  const end = source.indexOf('\n}', source.indexOf('async function fetchShell(')) + 2;
  assert.ok(start > -1 && end > start, 'sw.js defines withVersion and fetchShell');
  const build = (fakeFetch) =>
    // eslint-disable-next-line no-new-func
    new Function('VERSION', 'fetch', 'Request', `${source.slice(start, end)}; return fetchShell;`)(
      'v9.9.9',
      fakeFetch,
      class {
        constructor(url, init) {
          this.url = url;
          this.cache = init?.cache;
        }
      }
    );

  const fetched = [];
  const stored = [];
  const fetchShell = build(async (request) => {
    fetched.push(request);
    return { ok: true, status: 200, blob: async () => new Blob(['x']) };
  });
  await fetchShell({ put: async (key) => stored.push(key) }, ['./js/app.js', './']);

  assert.deepEqual(fetched.map((r) => r.url), ['./js/app.js?v=v9.9.9', './?v=v9.9.9']);
  assert.ok(fetched.every((r) => r.cache === 'reload'), 'and still past the HTTP cache');
  assert.deepEqual(stored, ['./js/app.js', './'], 'stored under the path the app requests');

  // Nothing is stored unless everything arrived: a half shell is a half app.
  const none = [];
  const failing = build(async (request) => ({ ok: !request.url.includes('app.js'), status: 404, blob: async () => new Blob(['x']) }));
  await assert.rejects(failing({ put: async (key) => none.push(key) }, ['./js/app.js', './']));
  assert.deepEqual(none, []);

  const install = source.slice(source.indexOf("addEventListener('install'"), source.indexOf("addEventListener('activate'"));
  assert.match(install, /fetchShell\(cache, SHELL\)/, 'install uses it');
  assert.doesNotMatch(source, /cache\.addAll\(/, 'and nothing fills the cache with unversioned fetches');
  const shellBranch = source.slice(source.indexOf('shellPaths.has('));
  assert.match(shellBranch, /fetch\(withVersion\(/, 'nor does the miss repair in the fetch handler');
});

test('N3: the shell installs over a six-connection HTTP/1.1 host, a few files at a time', async () => {
  // All 34 fetches started at once and no body was read until every one had
  // arrived. Chrome gives HTTP/1.1 six connections per host and an unread
  // response keeps its connection, so files seven onward never got one and the
  // worker stayed `installing` forever on the dev server that `?sw=1` uses.
  //
  // The fake host below behaves like that: six connections, each held until
  // its response body has been read.
  const start = source.indexOf('function withVersion(');
  const end = source.indexOf('\n}', source.indexOf('async function fetchShell(')) + 2;
  const shell = source.slice(source.indexOf('const SHELL = ['), source.indexOf('];', source.indexOf('const SHELL = [')) + 2);
  // eslint-disable-next-line no-new-func
  const SHELL = new Function(`${shell}; return SHELL;`)();
  assert.ok(SHELL.length > 6, 'the shell is bigger than one host’s connection limit');

  let free = 6;
  let inFlight = 0;
  let mostInFlight = 0;
  const waiting = [];
  const release = () => {
    free++;
    waiting.shift()?.();
  };
  const host = async (request) => {
    if (free === 0) await new Promise((resolve) => waiting.push(resolve));
    free--;
    inFlight++;
    mostInFlight = Math.max(mostInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    return {
      ok: true,
      status: 200,
      url: request.url,
      blob: async () => {
        inFlight--;
        release();
        return new Blob([request.url]);
      },
    };
  };
  // eslint-disable-next-line no-new-func
  const fetchShell = new Function('VERSION', 'fetch', 'Request', `${source.slice(start, end)}; return fetchShell;`)(
    'v9.9.9',
    host,
    class {
      constructor(url) {
        this.url = url;
      }
    }
  );

  const stored = new Map();
  const install = fetchShell({ put: async (key, response) => stored.set(key, await response.text()) }, SHELL);
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('install never finished')), 2000));
  await Promise.race([install, timeout]);

  assert.equal(stored.size, SHELL.length, 'every shell file is cached');
  assert.equal(stored.get('./js/app.js'), './js/app.js?v=v9.9.9', 'with the body that was downloaded for it');
  assert.ok(mostInFlight <= 4, `at most four downloads at once, saw ${mostInFlight}`);
});

test('N3: a file that fails stops the install and stores nothing', async () => {
  const start = source.indexOf('function withVersion(');
  const end = source.indexOf('\n}', source.indexOf('async function fetchShell(')) + 2;
  const requested = [];
  // eslint-disable-next-line no-new-func
  const fetchShell = new Function('VERSION', 'fetch', 'Request', `${source.slice(start, end)}; return fetchShell;`)(
    'v9.9.9',
    async (request) => {
      requested.push(request.url);
      return { ok: !request.url.includes('b.js'), status: 404, blob: async () => new Blob(['x']) };
    },
    class {
      constructor(url) {
        this.url = url;
      }
    }
  );
  const paths = ['./a.js', './b.js', ...Array.from({ length: 30 }, (_, i) => `./later-${i}.js`)];
  const stored = [];
  await assert.rejects(fetchShell({ put: async (key) => stored.push(key) }, paths), /b\.js could not be fetched/);
  assert.deepEqual(stored, [], 'all or nothing: a half shell is a half app');
  assert.ok(requested.length < paths.length, 'and the rest of the downloads were not started after the failure');
});
