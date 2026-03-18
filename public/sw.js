const CACHE_NAME = 'second-brain-v3';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first: always try fresh content, fall back to cache for offline
self.addEventListener('fetch', (e) => {
  // Skip Firebase and D3 CDN requests
  if (e.request.url.includes('gstatic.com') || e.request.url.includes('d3js.org') || e.request.url.includes('googleapis.com') || e.request.url.includes('firebaseapp.com')) return;

  e.respondWith(
    fetch(e.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
