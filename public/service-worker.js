const CACHE_NAME = 'bracket10-70d08e7346444f8d';
const CACHE_PREFIX = 'bracket10-';
const OFFLINE_PAGE = '/offline.html';

// Only public files may survive a session in Cache Storage.
const STATIC_ASSETS = [
  OFFLINE_PAGE,
  '/style.css',
  '/tokens.css',
  '/bracket.css',
  '/playground.css',
  '/table-styles.css',
  '/logo.png',
  '/favicon.ico',
  '/manifest.json',
  '/blank-bracket.jpg',
  '/gold.png',
  '/silver.png',
  '/bronze.png',
  '/teams.webp',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME,
            )
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function staticResponse(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  const cacheControl = response.headers.get('Cache-Control') || '';
  if (
    response.status === 200 &&
    !response.redirected &&
    !/\b(private|no-store|no-cache)\b/i.test(cacheControl)
  ) {
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.method !== 'GET') return;

  // A file extension or image destination is not proof that a route is public.
  if (
    request.mode !== 'navigate' &&
    !url.search &&
    STATIC_ASSETS.includes(url.pathname)
  ) {
    event.respondWith(staticResponse(request));
    return;
  }

  // Never persist or replay dynamic HTML/JSON, including the signed-in homepage.
  // Bypass the HTTP cache too: a previous session's response is not a fallback.
  event.respondWith(
    fetch(request, { cache: 'no-store' }).catch(async (error) => {
      if (request.mode !== 'navigate') throw error;
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(OFFLINE_PAGE)) || Response.error();
    }),
  );
});
