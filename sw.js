/*
  ==========================================================================
  SnakeScale Notes service worker
  ==========================================================================
  BUILD STAMP: 2026-10-31-SSN-V2760
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

    - The page itself (navigations and index.html), the manifest,
      and the icons: CACHE FIRST. They change only when the cache
      name changes with a release, so a cache hit is always the
      current release's file; a miss goes to the network and is
      kept for next time. (Through v2.20 the page was network
      first, which re-downloaded the whole app file on every
      reload; the cache name mechanism below is what makes cache
      first safe for the page too, and the page additionally asks
      for an update check on every boot; see registerServiceWorker
      in index.html.)

  Everything else, including same origin requests that are not GET,
  falls through to the browser untouched.

  Notifications (v2.24): the page raises task reminder
  notifications through this worker's registration when it can
  (showNotification), and the notificationclick handler below
  is the return trip: it closes the notification, focuses a
  running app window and posts it the task id, or opens the app
  URL carrying the task id when no window is running. The page
  reads both arrivals the same way (see queueTaskOpen in
  index.html) and opens that task's editor. The worker stores
  nothing about tasks; the id travels in the notification's own
  data, set by the page when the notification was raised.

  Updates: install precaches the new shell (the new build's page
  included, fetched fresh from the network at install time) under
  the new cache name and skips waiting, and activate clears the
  old caches and claims the open pages. Claiming is not a reload:
  open pages keep running the build they loaded with. A
  navigation still served by the outgoing worker (the one that
  discovers the update) runs the old build once more, and every
  navigation after that is served the new build from the new
  cache. No version of this worker can strand a user on a stale
  build beyond that one navigation.
  v2.50 closes even that one navigation from the page side:
  the page asks this registration for an update check on boot
  and whenever the tab returns to visible, and when a new
  worker takes control of a page that had a controller at
  boot, the page reloads itself onto the new build, at most
  once per build and never over unsaved work (the page's
  v2.50 block at registerServiceWorker carries the rules).
  This worker's own behavior is unchanged: the reload is
  the page's doing, and it lands on the new cache this
  worker just installed.
  ==========================================================================
*/

"use strict";

const CACHE_NAME = "snakescale-shell-2026-10-31-SSN-V2760";

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

  /* The page: cache first, like the shell assets below. A
     navigation, a request for the root, and a request for
     index.html are all the same thing here, and all are answered
     from the normalized key the shell precache stores. The
     cached page is by construction the current release's page
     (see Updates in the header): install precaches it under
     this release's cache name, and activate deletes every older
     cache, so a hit can never be a stale build. Only a miss (a
     cache the browser evicted, say) goes to the network, and a
     successful answer is kept under the same key for next time;
     if the network fails on a miss, the root entry is the last
     fallback, as it was under the network first rule. */
  const isPage = request.mode === "navigate" ||
    url.pathname.endsWith("/") ||
    url.pathname.endsWith("/index.html");
  if (isPage) {
    event.respondWith(
      caches.match(PAGE_KEY, { ignoreSearch: true })
        .then(function (hit) {
          if (hit) { return hit; }
          return fetch(request).then(function (response) {
            if (response && response.ok) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then(function (cache) {
                cache.put(PAGE_KEY, copy);
              });
            }
            return response;
          }).catch(function () {
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

/* v2.24: a task reminder notification was clicked. The
   notification closes either way. When an app window is
   already running, it is focused and posted the task id (the
   page opens that task's editor on receipt); when none is
   running, the app opens at its URL with the task id as a
   query parameter, which the page reads at boot for the same
   purpose. A notification without a task id simply focuses or
   opens the app.
   v2.35: a note reminder notification rides the same handler
   through its own data key: the running window is posted the
   note id (type snakescale-open-note-reminder), and a cold
   open lands on ?noteReminder= for the page's boot reader. A
   notification carrying neither id behaves as before. */
self.addEventListener("notificationclick", function (event) {
  if (event.notification && event.notification.close) {
    event.notification.close();
  }
  const data = (event.notification && event.notification.data) || {};
  const taskId = typeof data.taskId === "string" && data.taskId
    ? data.taskId : null;
  const noteReminderId =
    typeof data.noteReminderId === "string" && data.noteReminderId
    ? data.noteReminderId : null;
  const targetUrl = taskId
    ? "./?task=" + encodeURIComponent(taskId)
    : (noteReminderId
      ? "./?noteReminder=" + encodeURIComponent(noteReminderId)
      : "./");
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true })
      .then(function (windowClients) {
        for (let i = 0; i < windowClients.length; i++) {
          const client = windowClients[i];
          if (client && "focus" in client) {
            if (taskId && "postMessage" in client) {
              client.postMessage({
                type: "snakescale-open-task",
                taskId: taskId
              });
            }
            if (noteReminderId && "postMessage" in client) {
              client.postMessage({
                type: "snakescale-open-note-reminder",
                noteReminderId: noteReminderId
              });
            }
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      })
  );
});
