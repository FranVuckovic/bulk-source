/**
 * sw.js — the offline shell.
 *
 * Two rules this file exists to honour:
 *
 *   IndexedDB is never touched. Only the shell is cached, so an update can
 *   never take your training data with it.
 *
 *   The cache is versioned and old versions are deleted on activate. A
 *   cache-first shell with no version bump path is a shell that can never be
 *   updated again — the phone would hold the first build forever.
 *
 * Bump CACHE when anything in SHELL changes. The version is shown in Settings,
 * so it is obvious from inside the app whether an update actually landed.
 */

const CACHE = 'bulk-v2';

const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/calc.js',
  './js/db.js',
  './js/export.js',
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
  './data/plan-bulk-v1.json',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'version') {
    event.source?.postMessage({ version: CACHE });
  }
});

/**
 * Network first, falling back to the cache.
 *
 * The other way round would be faster, but it would also mean a new build only
 * appears after a second reload — and in a gym, on a bad connection, the
 * fallback fires immediately anyway. Correctness beats a few milliseconds.
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html')))
  );
});
