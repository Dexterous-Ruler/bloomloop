/* The student phone's service worker (Phase 7, "First"). Built into /sw.js by
   sw/plugin.js, which fills in VERSION and SHELL; registered by the phone with
   scope /join, so the console and every staff screen never have one.

   It does one job: a phone that reloads with no network still opens. The /join
   page and the files it needs to start are kept, per build. Nothing the server
   says is kept: /api and /socket.io always go to the network, and the answers
   a phone is holding live in its own outbox (lib/outbox.js), not here. The one
   exception (Phase 7, "Next"): the pictures of packed questions, which the
   page itself keeps in the `bloomloop-media` cache while online, are served
   from there, so a question answered offline still shows its image. A picture
   at /api/media/<id> never changes its bytes. A response marked no-store (a
   student's drawing, batch 9) is never kept here, nor served from a cache. */

const VERSION = '__VERSION__';
const SHELL = __SHELL__;
const CACHE = `bloomloop-join-${VERSION}`;
const PAGE = '/join';
// A hall's wifi that hangs rather than fails: give the network this long to
// start answering before the kept page is used instead.
const PATIENCE = 4000;
// The server varies every response on Origin (its CORS), and a page's module
// scripts are fetched with one while the install's were not: matched on the URL
// alone, which for a file named by its own hash is exact.
const ANY = { ignoreVary: true };

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll([new Request(PAGE, { cache: 'reload' }), ...SHELL])),
  );
});

// Old builds go once this one is in charge. No skipWaiting: a phone with the
// room open keeps the build it started with until it is closed, so a lazy file
// it asks for later is still in the cache it came from.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('bloomloop-join-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const noStore = (res) => /no-store/i.test(res.headers.get('cache-control') || '');

function pageFromNetwork(request) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('slow')), PATIENCE);
    fetch(request).then((res) => { clearTimeout(t); resolve(res); }, (err) => { clearTimeout(t); reject(err); });
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/media/')) {
    event.respondWith(caches.match(request, ANY).then((kept) => (kept && !noStore(kept) ? kept : fetch(request))));
    return;
  }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return;

  // The page: the network first, so a phone online always gets today's build;
  // the kept copy when the network is down or too slow.
  if (request.mode === 'navigate') {
    if (url.pathname !== PAGE && !url.pathname.startsWith(`${PAGE}/`)) return;
    event.respondWith(
      pageFromNetwork(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(PAGE, copy));
          }
          return res;
        })
        .catch(() => caches.match(PAGE, ANY).then((kept) => kept || Response.error())),
    );
    return;
  }

  // Built files carry their content hash in the name, so a kept copy is
  // always right. Anything the phone loads later (a lazy chunk, a font in
  // another script) is kept the first time it arrives.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request, ANY).then((kept) => kept || fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return res;
      })),
    );
  }
});
