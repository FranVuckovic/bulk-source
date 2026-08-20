/**
 * sw.js — the offline shell.
 *
 * Three rules this file exists to honour:
 *
 *   IndexedDB is never touched. Only the shell is cached, so an update can
 *   never take your training data with it.
 *
 *   An update is atomic. Every shell file is served out of one versioned
 *   cache, so the app is always running one complete build — never yesterday's
 *   progress screen against today's analytics module. A new build is fetched
 *   in the background, kept aside until every file has arrived, and only swaps
 *   in when the app asks it to.
 *
 *   An update never interrupts a session. The new worker waits; the app offers
 *   it, and applying it is a tap. Losing a set to a reload mid-session is a
 *   worse failure than running yesterday's build for another hour.
 *
 * Bump VERSION when anything in SHELL changes. It is shown in Settings, so it
 * is obvious from inside the app whether an update actually landed.
 */

const VERSION = 'v2.5.0';
const CACHE = `bulk-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/analytics.js',
  './js/calc.js',
  './js/cycle.js',
  './js/dates.js',
  './js/db.js',
  './js/demo.js',
  './js/export.js',
  './js/photos.js',
  './js/plan.js',
  './js/progress.js',
  './js/volume.js',
  './js/ui/body.js',
  './js/ui/charts.js',
  './js/ui/components.js',
  './js/ui/history.js',
  './js/ui/plan.js',
  './js/ui/progress.js',
  './js/ui/settings.js',
  './js/ui/train.js',
  './data/plan-fopip-v2.json',
  './icons/icon-192-v2.png',
  './icons/icon-512-v2.png',
  './icons/icon-maskable-512-v2.png',
];

const shellPaths = new Set(SHELL.map((path) => new URL(path, self.registration.scope).pathname));

/**
 * Is the worker we are replacing from a build generation that predates this
 * cache-naming scheme?
 *
 * v1 named its cache `bulk-v2`; every version since is `bulk-v<major>.<minor>.<patch>`.
 * The distinction matters because v1's worker answered a failed fetch with
 * `index.html` whatever had been asked for — including a JavaScript module,
 * which Chrome then refuses to execute as `text/html`. On a device holding that
 * worker the app cannot start at all, so it can never reach the point of
 * offering an update, and waiting politely would mean waiting forever.
 */
function precedesVersionedCaches(cacheNames) {
  return cacheNames.some((name) => name.startsWith('bulk-') && !/^bulk-v\d+\.\d+\.\d+$/.test(name));
}

/**
 * Install fails loudly if any one file cannot be fetched.
 *
 * That is the point: a cache holding nineteen of twenty files is a build that
 * will half-work offline, which is harder to diagnose than one that plainly
 * did not install.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL.map((path) => new Request(path, { cache: 'reload' })));

      // Normally: no skipWaiting. The new build waits until the app says it is
      // safe, because losing a set to a reload mid-session is worse than
      // running yesterday's build for another hour.
      //
      // The exception is a device whose current worker cannot run the app at
      // all. There is no safe moment to wait for on a blank screen.
      if (precedesVersionedCaches(await caches.keys())) await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

/**
 * Put back anything missing from the shell.
 *
 * Install runs once. If the cache is emptied afterwards — browser eviction
 * under storage pressure, or site data cleared — nothing refills the parts the
 * app does not happen to request, so the icons and the manifest stay missing
 * and the app is quietly no longer installable or fully offline. Cheap enough
 * to check on every start: one cache read, and a fetch only for what is gone.
 */
async function repairShell() {
  const cache = await caches.open(CACHE);
  const present = new Set((await cache.keys()).map((request) => new URL(request.url).pathname));
  const missing = SHELL.filter((path) => !present.has(new URL(path, self.registration.scope).pathname));

  if (missing.length) {
    await cache.addAll(missing.map((path) => new Request(path, { cache: 'reload' })));
  }
  return { checked: SHELL.length, restored: missing.length };
}

self.addEventListener('message', (event) => {
  if (event.data === 'version') event.source?.postMessage({ version: VERSION });

  // Asked of the *waiting* worker, by a page the active worker is still
  // serving. The reply is deliberately a different key from `version`: the page
  // has one field for the build it is running and another for the build queued
  // behind it, and an update banner that named the wrong one would be worse
  // than one that named neither.
  if (event.data === 'waiting-version') event.source?.postMessage({ waitingVersion: VERSION });

  // Sent only when the app has confirmed with the user that now is a safe
  // moment — no active session, nothing half-logged.
  if (event.data === 'apply-update') self.skipWaiting();

  if (event.data === 'verify-shell') {
    event.waitUntil(
      repairShell()
        .then((report) => event.source?.postMessage({ shell: report }))
        // Offline, there is nothing to repair with. The app still runs on what
        // is cached; this is a top-up, not a precondition.
        .catch(() => event.source?.postMessage({ shell: { checked: SHELL.length, restored: 0, offline: true } }))
    );
  }
});

/**
 * Shell files come from this version's cache, always.
 *
 * That is what makes an update atomic: while one version is the active worker,
 * every module the page imports is that version's copy, even if the server has
 * already moved on. Anything outside the shell goes to the network first and falls back
 * to whatever was cached.
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Only the app's own entry point falls back to the cached shell. A blanket
  // navigation fallback would answer every page on the origin with index.html,
  // which is how the sample-data tool started rendering the app instead.
  if (request.mode === 'navigate') {
    const appRoot = new URL('./', self.registration.scope).pathname;
    const isAppEntry = url.pathname === appRoot || url.pathname === `${appRoot}index.html`;
    event.respondWith(
      isAppEntry
        ? caches.open(CACHE).then((cache) => cache.match('./index.html').then((hit) => hit || fetch(request)))
        : fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  if (shellPaths.has(url.pathname)) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(request, { ignoreSearch: true });
        if (hit) return hit;

        // A miss here means the cache was emptied under us — browser eviction
        // under storage pressure, or the user clearing site data — while this
        // worker stayed active. Install only runs once, so without this the app
        // would quietly stop being offline-capable and only find out in a gym
        // with no signal. Put it back on the way past.
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone()).catch(() => {});
        return response;
      })
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(request))
  );
});
