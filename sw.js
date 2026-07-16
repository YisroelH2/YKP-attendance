/* YKP Attendance service worker — kill switch.
   A previous version of this file got corrupted (accidentally overwritten with
   full page HTML instead of JS), which meant the browser could never install a
   replacement on devices that already had the old worker running — they stayed
   stuck serving whatever was cached back then, forever.
   This version's only job is to clear that stale cache and unregister itself so
   already-installed clients recover on their own. The app currently doesn't
   register a service worker at all, so nothing re-registers this afterward. */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.registration.unregister();
    const clientsList = await self.clients.matchAll({ type: 'window' });
    clientsList.forEach((client) => client.navigate(client.url));
  })());
});
