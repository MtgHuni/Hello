// Without network: the app's files (page, scripts, styles, fonts, icons) are kept on the phone, so it
// opens in a dead zone. Always the network first (a new version arrives at once), the copy kept
// only when the network fails. The data is not here: api.js keeps the attendant's last answers.
const CACHE = 'station';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// The files the page has loaded (sent by main.js), kept once.
self.addEventListener('message', (e) => {
  const keep = Array.isArray(e.data?.keep) ? e.data.keep.filter((u) => typeof u === 'string' && u.startsWith(self.location.origin)) : [];
  e.waitUntil(caches.open(CACHE).then((cache) => Promise.all(keep.map((u) => cache.match(u).then((hit) => hit || cache.add(u).catch(() => {}))))));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || /\.(mp4|webm)$/.test(url.pathname) || req.headers.has('range')) return;
  // One page for the whole app (hash routes): every navigation is kept as « / ».
  const key = req.mode === 'navigate' ? '/' : req;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          e.waitUntil(caches.open(CACHE).then((cache) => cache.put(key, copy)));
        }
        return res;
      })
      .catch(async () => (await caches.match(key, { ignoreSearch: true })) || Response.error()),
  );
});
