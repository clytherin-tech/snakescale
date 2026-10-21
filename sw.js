/*
  ==========================================================================
  SnakeScale Notes service worker
  ==========================================================================
  BUILD STAMP: 2026-10-21-SSN-V2170
  Version: 2.11.0

  This worker exists for exactly one job: making SnakeScale Notes
  installable as an app, and keeping the app shell available when the
  network is not. It ships beside index.html in the repo and is
  registered by the page only over HTTPS (or localhost); see
  registerServiceWorker in index.html.

  What it caches: the app shell only. The page itself, the install
  manifest, and the app icons, under a cache name that carries the
  build stamp. Every release bumps the stamp, so every release gets
  a fresh cache, and the activate step below deletes the caches of
  all older versions.

  What it never does: it never caches API responses, access tokens,
  or note data. Notes live in the user's own Google Drive and are
  read and written by the page directly; nothing about them passes
  through a cache here. Cross origin requests (Google Identity
  Services, the Drive API, anything else) are not intercepted at
  all: the fetch handler below only answers same origin GET
  requests, and only two kinds of those:

    - The page itself (navigations and index.html): NETWORK FIRST.
      The network answer is returned whenever the network answers,
      and a copy is kept in the cache; the cache is served only
      when the network fails. An online user therefore always gets
      the newest build, exactly as before this worker existed, and
      no version of this worker can serve a stale app to an online
      user.
    - The manifest and the icons: cache first, because they change
      only when the cache name changes with a release.

  Everything else, including same origin requests that are not GET,
  falls through to the browser untouched.

  Updates: install precaches the new shell and skips waiting, and
  activate clears the old caches and claims the open pages. Claiming
  is not a reload: open pages keep running the build they loaded
  with, and the next navigation picks the new build up through the
  network first rule above.
  ==========================================================================
*/

"use strict";

const CACHE_NAME = "snakescale-shell-2026-10-21-SSN-V2170";

/* The shell, as paths relative to this worker's scope (the site
   root). "./" and "./index.html" are both listed: the first is the
   URL users actually open, the second is the name the fetch handler
   below normalizes page requests to. */
const SHELL_URLS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png"
];

/* The cache key the page is stored under and served from, whatever
   spelling the navigation used. */
const PAGE_KEY = "./index.html";

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(SHELL_URLS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (names) {
        return Promise.all(names.map(function (name) {
          if (name !== CACHE_NAME) { return caches.delete(name); }
          return Promise.resolve(false);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  const request = event.request;

  /* Only GET requests are ever answered, and only same origin ones.
     Everything else (every POST, every Google call, every cross
     origin read) is left to the browser, completely untouched. */
  if (request.method !== "GET") { return; }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) { return; }

  /* The page: network first. A navigation, a request for the root,
     and a request for index.html are all the same thing here. The
     fresh copy replaces the cached one (under the normalized key)
     so the offline fallback is as new as the last good load. Only
     successful responses are cached. */
  const isPage = request.mode === "navigate" ||
    url.pathname.endsWith("/") ||
    url.pathname.endsWith("/index.html");
  if (isPage) {
    event.respondWith(
      fetch(request).then(function (response) {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(PAGE_KEY, copy);
          });
        }
        return response;
      }).catch(function () {
        return caches.match(PAGE_KEY, { ignoreSearch: true })
          .then(function (hit) {
            if (hit) { return hit; }
            return caches.match("./", { ignoreSearch: true });
          });
      })
    );
    return;
  }

  /* The manifest and the icons: cache first. They are versioned by
     the cache name, so a cache hit is always the current release's
     file; a miss goes to the network and is kept for next time. */
  const isShellAsset = url.pathname.endsWith(".webmanifest") ||
    url.pathname.endsWith(".png");
  if (isShellAsset) {
    event.respondWith(
      caches.match(request, { ignoreSearch: true })
        .then(function (hit) {
          if (hit) { return hit; }
          return fetch(request).then(function (response) {
            if (response && response.ok) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then(function (cache) {
                cache.put(request, copy);
              });
            }
            return response;
          });
        })
    );
    return;
  }

  /* Any other same origin GET (there is currently nothing else in
     the repo, but future static files land here) passes through. */
});
