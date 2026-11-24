// sw.js — caches the app shell so the app opens offline.
// Models are downloaded from Hugging Face and stored by transformers.js
// in its own 'transformers-cache' — the service worker never touches it.
const CACHE = 'primary-school-ai-v1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './rag.js',
  './ai.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './vendor/transformers.web.min.js',
  './vendor/ort/ort.bundle.min.mjs',
  './vendor/ort/ort-wasm-simd-threaded.wasm',
  './vendor/ort/ort-wasm-simd-threaded.mjs',
  './vendor/ort/ort-wasm-simd-threaded.jsep.wasm',
  './vendor/ort/ort-wasm-simd-threaded.jsep.mjs',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      // Delete ONLY old shell caches of this app. NEVER touch
      // 'transformers-cache' (the models) or any other cache — the
      // translator app v6 wiped it on every activation and forced a
      // full re-download each time.
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('primary-school-ai-') && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Same-origin files only (index + quiz data are cached on first fetch).
  // Hugging Face model files are left alone.
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then(
      (cached) =>
        cached ||
        fetch(e.request).then((resp) => {
          if (resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return resp;
        }),
    ),
  );
});
