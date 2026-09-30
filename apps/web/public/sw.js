// Service worker розписного покера: застосунок відкривається навіть без мережі
// (грати можна лише онлайн, але екран і повідомлення про звʼязок доступні).
const CACHE = 'poker-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Socket.IO, чужі адреси й зміни на сервері — завжди напряму в мережу.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/socket.io/')) return;
  // Усі сторінки застосунку (/, /r/КОД) — той самий index.html.
  if (request.mode === 'navigate') event.respondWith(networkFirst(request, '/'));
  // Зібрані файли мають хеш у назві й не змінюються.
  else if (url.pathname.startsWith('/assets/')) event.respondWith(cacheFirst(request));
  else event.respondWith(networkFirst(request, request));
});

/** Спершу мережа (і оновлення кешу), без мережі — кеш. */
async function networkFirst(request, key) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(key, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(key);
    if (cached) return cached;
    throw error;
  }
}

/** Спершу кеш, інакше мережа з записом у кеш. */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}
