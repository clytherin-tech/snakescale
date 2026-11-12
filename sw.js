/*
  ==========================================================================
  SnakeScale Notes service worker
  ==========================================================================
  BUILD STAMP: 2026-11-05-SSN-V21140
  Version: 2.11.0

  This worker exists for exactly one job: making SnakeScale Notes
  installable as an app, and keeping the app shell available when the
  network is not. It ships beside index.html in the repo and is
  registered by the page only over HTTPS (or localhost); see
  registerServiceWorker in index.html.

  What it caches: the app shell only. The page itself, its
  stylesheet and scripts (the split parts, named in the shell
  list below), the install manifest, and the app icons, under
  a cache name that carries the build stamp. Every release
  bumps the stamp, so every release gets a fresh cache, and
  the activate step below deletes the caches of all older
  versions. Since this release the worker also carries a manifest
  of SHA-256 hashes, one per shell file (ASSET_HASHES below,
  generated from the shipped files, never edited by hand).
  The manifest is what lets an update tell, file by file,
  what actually changed: see Updates below.

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

  Push (v2.86): the push handler below shows the
  notifications the ssnotes-push Worker sends when a
  reminder's moment arrives with the app closed. The
  payload is JSON (title, body, url, tag); nothing in
  it is stored here either, and the click handler
  routes it like the page's own notifications,
  focusing a running window (navigating it to the
  payload's URL when it differs) or opening that URL.

  Updates (per-file cache versioning): install
  assembles the new release's cache completely before
  anything activates, file by file. For each shell file it
  first looks in the older caches for a copy whose bytes
  hash (SHA-256, computed here at install time) to the new
  manifest: a match is copied forward with no network fetch
  at all. A file with no matching copy is fetched from the
  network and stored only if its bytes hash to the manifest;
  a failed fetch or a failed verification fails the whole
  install and deletes the half-built cache, so the previous
  release keeps running whole, exactly the promise the old
  cache.addAll install made. Only when every file stands
  verified in the new cache does install skip waiting, and
  activate then clears the old caches and claims the open
  pages. An update therefore downloads only the files that
  changed (plus this worker itself, whose change is what
  makes the browser look), instead of the whole shell on
  every release. Claiming is not a reload:
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

const CACHE_NAME = "snakescale-shell-2026-11-12-SSN-V21420";

/* The shell, as paths relative to this worker's scope (the site
   root). "./" and "./index.html" are both listed: the first is the
   URL users actually open, the second is the name the fetch handler
   below normalizes page requests to. */
const SHELL_URLS = [
  "./",
  "./index.html",
  "./styles.css",
  "./version.js",
  "./core.js",
  "./store.js",
  "./sync.js",
  "./tasks.js",
  "./notebooks.js",
  "./home.js",
  "./calendar.js",
  "./mail.js",
  "./render.js",
  "./editor.js",
  "./editor-tools.js",
  "./media.js",
  "./app.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png"
];

/* The cache key the page is stored under and served from, whatever
   spelling the navigation used. */
const PAGE_KEY = "./index.html";

/* The generated per-file manifest: every unique
   shell asset's URL, spelled as in SHELL_URLS, mapped to the
   SHA-256 of its shipped bytes, in hex. "./" is not a key:
   it is the page under its other spelling, and the page's
   one entry here is "./index.html" (see installShell).
   This block is written by gen_asset_hashes.py in the
   build's harness folder, between the two marker lines,
   and the test suite recomputes every hash and fails the
   build if this block is stale. Never edit it by hand. */
// BEGIN GENERATED ASSET HASHES (gen_asset_hashes.py)
const ASSET_HASHES = {
  "./index.html": "9a71e813a2144a6343cc96334065dceaca79ea1ab769f54aba39943dba69061a",
  "./styles.css": "c9a30e9df09283f700736e3f4baf8cd9add03b14f7819dc145214c90f57e5b18",
  "./version.js": "924cdb3515cab4c6049853b4eba0378905265f573af13f30527cc2a15d6ca582",
  "./core.js": "762dd5d5d7d7ad502e9d673542c57775aa6eee12990d359b79ac150252855361",
  "./store.js": "7b823b256c17570015d20a46a4ba53eb2705a1b932a7f95c64791984179173f2",
  "./sync.js": "2fca595bab83e9da96893b311254296b77e982c29a21a5763da9babbb52fc02a",
  "./tasks.js": "9f91d476378d3374962d353aef52113eb8b1d757c4c435481eb6826c03616313",
  "./notebooks.js": "eed64ea414be4859d546d5c2d16f1e4218eba8dbffe244c2c92455408ed73f0a",
  "./home.js": "aca927050babf85001448052037b496cfcef68b5f9f63947373ae7a9cc52f948",
  "./calendar.js": "1d8926b971eecfa2a7cfd0e285272ad26bc8ff95a88138878f3dff1c078c79b4",
  "./mail.js": "cefa4870571d24fb66041e5bc6821f295ee2bf1cdce2219c7702dea7d2af17c1",
  "./render.js": "80d72c17c4ce020d1d74c8722f3ed5be58e92e38315579365cd8049ab08b3dfb",
  "./editor.js": "463274c1199f8055a81dc82d5319ff459d52dd809d3b39fe197e52be8a55f619",
  "./editor-tools.js": "d382ad2beb716c6684d92e78a694ef41ccef863b1fd1c7265122a72ca619161f",
  "./media.js": "39ac9aa6d587c989d60d62252a4a783561482cb8a470f7e62c7da146008dffbb",
  "./app.js": "772c78e87fc9c2f10c0b346bd08d2a2ea12100d2db9ad330cc2bf82a4d7e4c19",
  "./manifest.webmanifest": "3023da8f798f72a653465cd72fc269090e5c0e18dbc0d2f52afb0d54cda8c16c",
  "./icon-192.png": "d663e8dbb927453044a9760c7ed49d13d6be2c155ffff85245f09a02c319848e",
  "./icon-512.png": "0745bbae85b4dd2c4b726154c043022330ac2067e31944bc4db32e48352cb5f9",
  "./icon-maskable-512.png": "4a147e82c17ef92666fc5fa59dd06bf6b4bd844c072e62a2dc27d52d919faacf",
  "./apple-touch-icon.png": "fe3998937952e0dca681323b6471ccd40920aa3e55ac03c95581dbd064f74859"
};
// END GENERATED ASSET HASHES

/* SHA-256 of an ArrayBuffer, as lowercase hex, the same
   spelling the generator writes into ASSET_HASHES. */
function sha256Hex(buffer) {
  return crypto.subtle.digest("SHA-256", buffer)
    .then(function (digest) {
      const bytes = new Uint8Array(digest);
      let hex = "";
      for (let i = 0; i < bytes.length; i++) {
        hex += ("0" + bytes[i].toString(16)).slice(-2);
      }
      return hex;
    });
}

/* The storage keys a shell asset stands under in a cache:
   the page stands under both of its spellings, every other
   asset under its own URL alone. */
function assetKeys(url) {
  if (url === PAGE_KEY) { return [PAGE_KEY, "./"]; }
  return [url];
}

/* Look for a copy of url in any cache other than the one
   being built whose bytes verify against expectedHash.
   The page is also tried under its "./" spelling, because
   older caches may hold it under either key. Returns the
   verified Response, or null when no old copy verifies.
   Any error (a cache that will not open, a body that will
   not read, a digest that fails) reads as "no copy": the
   caller falls back to the network, never to unverified
   bytes. The body is read from a clone, so the response
   handed back is still whole for cache.put. */
async function findVerifiedCopy(url, expectedHash) {
  try {
    const names = await caches.keys();
    for (let i = 0; i < names.length; i++) {
      if (names[i] === CACHE_NAME) { continue; }
      const cache = await caches.open(names[i]);
      const keys = assetKeys(url);
      for (let k = 0; k < keys.length; k++) {
        const hit = await cache.match(keys[k],
          { ignoreSearch: true });
        if (!hit) { continue; }
        try {
          const bytes = await hit.clone().arrayBuffer();
          const hex = await sha256Hex(bytes);
          if (hex === expectedHash) { return hit; }
        } catch (e) { /* unreadable copy: keep looking */ }
      }
    }
  } catch (e) { /* no readable old caches: network path */ }
  return null;
}

/* Fetch url from the network and return a Response whose
   bytes are proven to hash to expectedHash. cache:
   "no-store" keeps a stale HTTP cache entry from standing
   in for the new release's file: if it somehow did, the
   hash check would fail the install, not serve the file.
   A not-ok response or a hash mismatch throws, which
   fails the install (see installShell). */
async function fetchVerified(url, expectedHash) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response || !response.ok) {
    throw new Error("shell fetch failed for " + url);
  }
  const bytes = await response.arrayBuffer();
  const hex = await sha256Hex(bytes);
  if (hex !== expectedHash) {
    throw new Error("shell hash mismatch for " + url);
  }
  return new Response(bytes, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

/* Assemble the new release's cache, file by file, in
   SHELL_URLS order, skipping "./" (the page is stored
   when its "./index.html" entry is processed, under both
   keys). Each file comes from a hash-verified old copy
   when one exists and from a hash-verified fetch when
   none does. The first failure of any kind aborts the
   assembly: the caller deletes this cache and fails the
   install, so no half-built or mixed set is ever served
   and the previous release keeps running whole. */
async function installShell(cache) {
  for (let i = 0; i < SHELL_URLS.length; i++) {
    const url = SHELL_URLS[i];
    if (url === "./") { continue; }
    const expected = ASSET_HASHES[url];
    if (!expected) {
      throw new Error("no manifest hash for " + url);
    }
    let response = await findVerifiedCopy(url, expected);
    if (!response) {
      response = await fetchVerified(url, expected);
    }
    const keys = assetKeys(url);
    /* Clone before any put: a put consumes its
       response's body, and cloning afterwards throws.
       The page's two keys each need their own copy. */
    const copies = [response];
    for (let k = 1; k < keys.length; k++) {
      copies.push(response.clone());
    }
    for (let k = 0; k < keys.length; k++) {
      await cache.put(keys[k], copies[k]);
    }
  }
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return installShell(cache); })
      .then(function () { return self.skipWaiting(); })
      .catch(function (err) {
        /* A failed assembly must leave nothing behind:
           delete the half-built cache, then fail the
           install so the old worker (and its whole,
           verified cache) keeps serving. */
        return caches.delete(CACHE_NAME)
          .then(function () { throw err; });
      })
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
      caches.match(PAGE_KEY, { ignoreSearch: true,
        cacheName: CACHE_NAME })
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
            return caches.match("./", { ignoreSearch: true,
              cacheName: CACHE_NAME });
          });
        })
    );
    return;
  }

  /* The manifest, the icons, and the app's own styles and
     scripts: cache first. They are versioned by the cache
     name, so a cache hit is always the current release's
     file; a miss goes to the network and is kept for next
     time. */
  const isShellAsset = url.pathname.endsWith(".webmanifest") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".js");
  if (isShellAsset) {
    event.respondWith(
      caches.match(request, { ignoreSearch: true,
        cacheName: CACHE_NAME })
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

/* v2.86: a push from the ssnotes-push Worker. The
   payload is JSON (title, body, url, tag), carried
   encrypted by the push service; a payload that does
   not parse still shows a plain notification rather
   than none at all. The data carries the URL alone:
   the click handler below routes it to the app.
   Nothing about it is stored here, like every other
   notification this worker shows. */
self.addEventListener("push", function (event) {
  let payload = {};
  if (event.data) {
    try {
      const parsed = event.data.json();
      if (parsed && typeof parsed === "object") {
        payload = parsed;
      }
    } catch (e) {
      try {
        const text = event.data.text();
        if (text) { payload = { body: String(text) }; }
      } catch (e2) { payload = {}; }
    }
  }
  const title = typeof payload.title === "string" &&
    payload.title ? payload.title : "SnakeScale Notes";
  const options = {
    body: typeof payload.body === "string"
      ? payload.body : "",
    icon: "icon-192.png",
    data: {
      url: typeof payload.url === "string" && payload.url
        ? payload.url : "./"
    }
  };
  if (typeof payload.tag === "string" && payload.tag) {
    options.tag = payload.tag;
  }
  event.waitUntil(
    self.registration.showNotification(title, options));
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
  const pushUrl = typeof data.url === "string" && data.url
    ? data.url : null;
  const targetUrl = pushUrl || (taskId
    ? "./?task=" + encodeURIComponent(taskId)
    : (noteReminderId
      ? "./?noteReminder=" + encodeURIComponent(noteReminderId)
      : "./"));
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
            if (pushUrl && "navigate" in client &&
                client.url !== pushUrl) {
              return client.navigate(pushUrl)
                .then(function (navigated) {
                  const landed = navigated || client;
                  return "focus" in landed
                    ? landed.focus() : undefined;
                })
                .catch(function () {
                  return client.focus();
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
