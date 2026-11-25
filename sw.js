// Service worker for Ornate Chess. The CACHE name is the version: increment
// CACHE whenever shipped files change so older caches are dropped on activate.
// While online, responses are taken from the network first so a new deploy is
// not hidden by a stale cache. The cache is used only when the network fails.
const CACHE = 'ornate-chess-2026-11-24-r13';
const PRECACHE = [
  './',
  './index.html',
  './LICENSE',
  './manifest.webmanifest',
  './assets/favicon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
  './assets/apple-touch-icon.png',
  './src/styles/main.css',
  './src/styles/board.css',
  './src/styles/pages.css',
  './src/styles/mobile.css',
  './src/app.js',
  './src/engine.js',
  './src/ai.js',
  './src/ai-worker.js',
  './src/storage.js',
  './src/rating.js',
  './src/glicko.js',
  './src/online-ratings.js',
  './src/puzzles.js',
  './src/openings.js',
  './src/data/puzzles.js',
  './src/data/openings.js',
  './src/data/opening-library.js',
  './src/puzzle-gen.js',
  './src/puzzle-gen-worker.js',
  './src/puzzle-verify.js',
  './src/review.js',
  './src/mistake-insights.js',
  './src/review-worker.js',
  './src/review-storage.js',
  './src/endgames.js',
  './src/progress-stats.js',
  './src/data/endgames.js',
  './src/vendor/stockfish/stockfish-19-lite-single.js',
  './src/vendor/stockfish/stockfish-19-lite-single.wasm',
  './src/vendor/stockfish/COPYING.txt',
  './src/vendor/stockfish/README.txt',
  './src/ui/modules.js',
  './src/ui/state.js',
  './src/ui/dom.js',
  './src/ui/ornament.js',
  './src/ui/pieces.js',
  './src/ui/board.js',
  './src/ui/annotations.js',
  './src/ui/dialogs.js',
  './src/ui/sound.js',
  './src/ui/brilliant-sound.js',
  './src/ui/review-sound.js',
  './src/ui/bot.js',
  './src/ui/clock.js',
  './src/ui/gameview.js',
  './src/ui/rating-view.js',
  './src/ui/online-ratings-client.js',
  './src/ui/online-puzzles.js',
  './src/ui/shortcuts.js',
  './src/ui/page-home.js',
  './src/ui/page-play.js',
  './src/ui/online-game.js',
  './src/ui/page-local.js',
  './src/ui/page-game.js',
  './src/ui/page-puzzles.js',
  './src/ui/page-puzzle-gen.js',
  './src/ui/puzzle-gen-client.js',
  './src/ui/stockfish-client.js',
  './src/ui/review-client.js',
  './src/ui/page-review.js',
  './src/ui/review-badges.js',
  './src/ui/page-mistakes.js',
  './src/ui/page-endgames.js',
  './src/ui/page-stats.js',
  './src/ui/page-leaderboard.js',
  './src/ui/page-following.js',
  './src/ui/page-messages.js',
  './src/ui/message-notice.js',
  './src/ui/page-player.js',
  './src/ui/analysis-stockfish.js',
  './src/ui/dev-stubs.js',
  './src/ui/page-openings.js',
  './src/ui/page-saved.js',
  './src/ui/page-analysis.js',
  './src/account-sync.js',
  './src/ui/account-client.js',
  './src/ui/page-account.js',
  './src/ui/page-settings.js',
  './src/ui/page-learn.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Range requests (used by browsers to stream audio and video) and media
  // requests go straight to the network. A cached full response cannot answer
  // a range request, and a partial 206 response must never be cached.
  if (request.headers.has('range')) return;
  if (request.destination === 'audio' || request.destination === 'video') return;
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response && response.status === 200 && response.type === 'basic') {
        const copy = response.clone();
        const cache = await caches.open(CACHE);
        await cache.put(request, copy);
      }
      return response;
    } catch (err) {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const page = await caches.match('./index.html') || await caches.match('./');
        if (page) return page;
      }
      throw err;
    }
  })());
});
