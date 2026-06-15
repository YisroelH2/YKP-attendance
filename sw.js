/* YKP Attendance service worker — caches the app shell so it loads offline
   and makes the app installable. Live data (Supabase) always goes to the
   network; full offline data sync is a separate, upcoming feature. */
const CACHE = 'ykp-shell-v2';
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // never intercept writes or auth
  const url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co')) return; // live data: always network

  // Page loads: always pull a fresh copy from the server (bypass HTTP cache),
  // update the shell, fall back to cache only when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req, { cache: 'reload' }).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put('./index.html', cp)); return r; })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Library, fonts, icons: serve from cache first, then network (and cache it)
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(r => {
      if (r && (r.ok || r.type === 'opaque')) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
      return r;
    }))
  );
});
