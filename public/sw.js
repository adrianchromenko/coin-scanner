/* CoinLens service worker. Plain JS, no build step.
 *
 * - Navigations: network first, falling back to the cached page, then to the
 *   cached "/" shell, so the app opens offline.
 * - /_next/static/*, icons, manifest and fonts: cache first (immutable builds).
 * - /api/* and anything that is not a same-origin GET: never touched.
 *
 * Bump VERSION whenever the caching rules change; old caches are removed on activate.
 */
var VERSION = "coinlens-v1";
var SHELL = "/";
var STATIC_PATHS = ["/icon.svg", "/apple-icon", "/favicon.ico", "/manifest.webmanifest"];

/** Decide how to handle a request. Pure, so it can be unit-tested. */
function strategyFor(request) {
  if (request.method !== "GET") return "bypass";
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return request.destination === "font" ? "static" : "bypass";
  if (url.pathname.indexOf("/api/") === 0) return "bypass";
  if (url.pathname === "/sw.js") return "bypass";
  if (request.mode === "navigate") return "navigate";
  if (url.pathname.indexOf("/_next/static/") === 0) return "static";
  if (STATIC_PATHS.indexOf(url.pathname) !== -1) return "static";
  if (request.destination === "font") return "static";
  return "bypass";
}

function cacheable(res) {
  return Boolean(res) && res.ok && (res.type === "basic" || res.type === "default" || res.type === "cors");
}

function navigate(request) {
  return fetch(request)
    .then(function (res) {
      if (cacheable(res)) {
        var copy = res.clone();
        // Lazily (re)cache the page; "/" doubles as the offline shell for other routes.
        caches.open(VERSION).then(function (c) {
          return c.put(request.url, copy);
        }).catch(function () {});
      }
      return res;
    })
    .catch(function () {
      return caches.open(VERSION).then(function (c) {
        return c.match(request.url, { ignoreSearch: true }).then(function (hit) {
          return hit || c.match(SHELL, { ignoreSearch: true });
        });
      }).then(function (hit) {
        return hit || new Response("You are offline and this page is not cached yet.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      });
    });
}

function cacheFirst(request) {
  return caches.open(VERSION).then(function (c) {
    return c.match(request).then(function (hit) {
      if (hit) return hit;
      return fetch(request).then(function (res) {
        if (cacheable(res)) c.put(request, res.clone()).catch(function () {});
        return res;
      });
    });
  });
}

self.addEventListener("install", function (event) {
  self.skipWaiting();
  // Best-effort shell precache; a failure must not block installation.
  event.waitUntil(
    caches.open(VERSION).then(function (c) {
      return c.add(SHELL).catch(function () {});
    }),
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== VERSION && k.indexOf("coinlens-") === 0; })
            .map(function (k) { return caches.delete(k); }),
      );
    }).then(function () { return self.clients.claim(); }),
  );
});

self.addEventListener("fetch", function (event) {
  var strategy = strategyFor(event.request);
  if (strategy === "navigate") event.respondWith(navigate(event.request));
  else if (strategy === "static") event.respondWith(cacheFirst(event.request));
  // "bypass": let the browser handle it (API calls, POSTs, RSC payloads, third parties).
});

self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

// Exposed for tests.
self.__coinlens = { VERSION: VERSION, strategyFor: strategyFor };
