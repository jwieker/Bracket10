const CACHE_NAME = 'admin-bracket10-v6';
const OFFLINE_PAGE = '/offline.html';

// Assets to cache on install
const STATIC_ASSETS = [
    '/',
    OFFLINE_PAGE,
    '/style.css',
    '/logo.png',
    '/favicon.ico',
    '/manifest.json',
    '/blank-bracket.jpg',
    '/gold.png',
    '/silver.png',
    '/bronze.png',
    '/teams.webp'
];

const DEBUG = self.location.hostname === 'localhost';

function log(...args) {
    if (DEBUG) {
        console.log(...args);
    }
}

// Install event - cache static assets
self.addEventListener('install', (event) => {
    log('[Service Worker] Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                log('[Service Worker] Caching static assets');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => self.skipWaiting())
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    log('[Service Worker] Activating...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        log('[Service Worker] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch event - implement caching strategies
self.addEventListener('fetch', (event) => {
    // DEVELOPMENT MODE: Temporarily disabled caching - all requests go to network
    // This allows you to see live changes without cache interference
    // To re-enable PWA caching, comment out the return below
    // return;

    const { request } = event;
    const url = new URL(request.url);

    // Skip cross-origin requests
    if (url.origin !== location.origin) {
        return;
    }

    // IMPORTANT: Skip POST requests (form submissions) - let them go directly to the server
    if (request.method !== 'GET') {
        return;
    }

    // Cache-first strategy for static assets (CSS, JS, images)
    if (request.destination === 'style' ||
        request.destination === 'script' ||
        request.destination === 'image' ||
        request.url.match(/\.(css|js|jpg|jpeg|png|gif|ico|webp|svg)$/)) {
        event.respondWith(
            caches.match(request)
                .then((cachedResponse) => {
                    if (cachedResponse) {
                        // Return cached version and update cache in background
                        fetch(request)
                            .then((networkResponse) => {
                                if (networkResponse && networkResponse.status === 200) {
                                    caches.open(CACHE_NAME).then((cache) => {
                                        cache.put(request, networkResponse.clone());
                                    });
                                }
                            })
                            .catch(() => {
                                // Network failed, cached version is still being served
                            });
                        return cachedResponse;
                    }
                    // Not in cache, fetch from network
                    return fetch(request)
                        .then((response) => {
                            if (response && response.status === 200) {
                                const responseToCache = response.clone();
                                caches.open(CACHE_NAME).then((cache) => {
                                    cache.put(request, responseToCache);
                                });
                            }
                            return response;
                        });
                })
        );
    }
    // Network-first strategy for pages and API calls
    else {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    // Clone the response
                    const responseToCache = response.clone();

                    // Cache successful responses
                    if (response && response.status === 200) {
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(request, responseToCache);
                        });
                    }

                    return response;
                })
                .catch(() => {
                    // Network failed, try cache
                    return caches.match(request)
                        .then((cachedResponse) => {
                            if (cachedResponse) {
                                return cachedResponse;
                            }
                            // If no cached version, return offline page for navigation requests
                            if (request.mode === 'navigate') {
                                return caches.match(OFFLINE_PAGE);
                            }
                        });
                })
        );
    }
});
