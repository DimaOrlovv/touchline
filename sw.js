const VERSION = 'touchline-v19';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/styles.css',
  './src/app.js',
  './src/state/api.js',
  './src/engine/util.js',
  './src/engine/coach.js',
  './src/engine/styles.js',
  './src/engine/text.js',
  './src/engine/match.js',
  './src/engine/season.js',
  './src/engine/llm.js',
  './src/ui/dom.js',
  './src/ui/icons.js',
  './src/ui/feedback.js',
  './src/ui/screens.js',
  './src/ui/live.js',
  './src/data/squads.json',
  './icons/app-icon.svg',
  './icons/app-icon-192.png',
  './icons/app-icon-512.png',
  './icons/app-icon-maskable-512.png',
  './icons/logos/psg.png',
  './icons/logos/barcelona.png',
  './icons/logos/real_madrid.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // запросы к OpenRouter не перехватываем

  // network-first: всегда отдаём свежий код, кэш страхует офлайн-режим
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : hit)))
  );
});
