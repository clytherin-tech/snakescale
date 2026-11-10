/*
  SnakeScale Notes: this file is one part of the
  multi-file split of the app that shipped as a single
  index.html through v2.112.0. The split is mechanical:
  every line here stood in the single file, in this order,
  and the parts load as classic scripts (or one stylesheet)
  in the order the shell names them, sharing one global
  scope, exactly as the single file ran. The bundle script
  in the split's harness folder reassembles the parts
  into the standalone single file copy.
*/
"use strict";
/* --------------------------------------------------------------------------
   11. Attachments: storage providers, upload flow, hydration, settings
   Design in one paragraph: binaries never enter the notes store. A
   note stores small attachment metadata in its front matter
   (section 7) and clean placeholder elements in its body. The bytes
   live in an "attachments" subfolder of the same SnakeScale Notes
   folder that holds the notes, in the user's own Google Drive
   (before v2.0 they lived in a separate top level folder; see the
   one time consolidation in the connect flow). Google is the only
   provider: the user clicks Sign in with Google and approves access
   on Google's own site, and that one sign in covers notes and
   attachments alike. SnakeScale never sees the user's Google
   password. Since v2.79.0 the sign in itself runs through the
   publisher's ssnotes-auth Cloudflare Worker (see the Worker
   sign in block below): the Worker holds the Google client and
   its secret, keeps the sign in's refresh token in its own
   store, and hands this app a 30 day session in exchange.
   End users never register anything.

   Token safety: the Google access token and the Worker
   session token are encrypted with AES-GCM under
   state.sessionKey, the random device key from section 4,
   and localStorage holds only ciphertext. That key is not a login
   and does not lock the browser profile. Access tokens still
   live about an hour, but the Worker holds a refresh token
   server side, so a fresh access token is one quiet fetch
   away and signing in again is a 30 day event, not an hourly
   one. Signing out drops every plaintext token from memory.

   Attachment records written by older versions can name a provider
   this build no longer has (pCloud, removed in v2.0). Those records
   resolve to no driver in the registry below, and every consumer
   treats a missing driver as "that provider is not available",
   which renders the graceful not available message on the record
   instead of an error; the note around it opens, edits, and saves
   normally.
   -------------------------------------------------------------------------- */
/* ----- provider token store (encrypted under the device key) ------- */

function loadProviderTokenBlob() {
  try { return JSON.parse(localStorage.getItem(LS_PROVIDERS) || "{}"); }
  catch (e) { return {}; }
}

async function storeProviderToken(provider, token) {
  if (!state.sessionKey) {
    throw new Error("SnakeScale Notes is not ready to save a provider sign in on this device yet.");
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    state.sessionKey,
    new TextEncoder().encode(token)
  );
  const all = loadProviderTokenBlob();
  all[provider] = {
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(cipher))
  };
  localStorage.setItem(LS_PROVIDERS, JSON.stringify(all));
  state.providerTokens[provider] = token;
}

/* Read a provider token: memory first, then decrypt the stored blob with
   the session key. Returns null when signed out, locked, or damaged. */
async function getProviderToken(provider) {
  if (state.providerTokens[provider]) { return state.providerTokens[provider]; }
  const rec = loadProviderTokenBlob()[provider];
  if (!rec || !state.sessionKey) { return null; }
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(rec.iv) },
      state.sessionKey,
      base64ToBytes(rec.data)
    );
    state.providerTokens[provider] = new TextDecoder().decode(plain);
    /* v2.24.6: a token that becomes active by being restored
       from the encrypted store never ran googleConnect, so
       nothing scheduled its proactive renewal. The boot path
       is the case that mattered: the gate finds the stored
       token still live and enters without a fresh connect,
       and through v2.24.5 that session then had no timer at
       all. Schedule here, at the one moment every restore
       funnels through, so a restored session carries the
       timer from the start. (scheduleGoogleRenewal is
       defined in the renewal block below; this line only
       ever runs once the app is up, long after the whole
       script has been evaluated.) */
    if (provider === "google") { scheduleGoogleRenewal(); }
    return state.providerTokens[provider];
  } catch (e) {
    return null;
  }
}

function clearProviderToken(provider) {
  const all = loadProviderTokenBlob();
  if (all[provider]) {
    delete all[provider];
    localStorage.setItem(LS_PROVIDERS, JSON.stringify(all));
  }
  state.providerTokens[provider] = null;
}

/* v1.4: THE single Google token source. The attachments driver and the
   Google Drive notes driver both call this helper; neither reads the
   provider token store directly. It returns a live token, or throws an
   error marked needsGoogleReconnect so storage callers can preserve the
   pending work in the offline queue and ask for a one click sign in. */
async function getGoogleAccessToken() {
  const status = await googleGetStatus();
  if (status.connected) {
    const token = await getProviderToken("google");
    if (token) { return token; }
  }
  /* v2.79.0: a standing Worker session renews the access
     token quietly right here, at the one source every Drive
     call shares, before any caller is told to reconnect.
     A transient failure (the fetch failed, the Worker
     answered 5xx) is the reconnect error, so the pending
     work queues exactly as it does for an expired token,
     and the session stands for the next attempt. A session
     the Worker reports dead (no_session or reauth) is the
     plain sign in error instead: no token is coming until
     the user signs in again. */
  if (await getWorkerSession()) {
    const fetched = await workerFetchAccessToken();
    if (fetched.ok) {
      const fresh = await getProviderToken("google");
      if (fresh) { return fresh; }
    }
    if (fetched.kind === "network" || fetched.kind === "worker") {
      throw googleReconnectError(
        "The sign in service could not be reached just now. " +
        "Your notes and queued changes are saved on this " +
        "device; try again in a moment.");
    }
    const dead = new Error("Sign in with Google first.");
    dead.code = "GOOGLE_SIGN_IN_REQUIRED";
    dead.needsGoogleReconnect = true;
    throw dead;
  }
  const err = new Error(status.reason === "expired"
    ? "Your Google sign in expired. Use Refresh connection in " +
      "Settings to reconnect."
    : "Sign in with Google first.");
  err.code = status.reason === "expired"
    ? "GOOGLE_TOKEN_EXPIRED" : "GOOGLE_SIGN_IN_REQUIRED";
  err.needsGoogleReconnect = true;
  throw err;
}

function googleReconnectError(message) {
  /* v2.2: the default message names the remedy Chris can act on from
     inside the app, the Refresh connection action, instead of
     sending him back through the browser to the gate. v2.7: the
     wording followed the action into the sidebar footer menu.
     v2.8: it follows it again, into Settings, where the action
     lives now. */
  const err = new Error(message ||
    "Your Google sign in expired. Use Refresh connection in " +
    "Settings to reconnect.");
  err.code = "GOOGLE_TOKEN_EXPIRED";
  err.needsGoogleReconnect = true;
  return err;
}

/* ----- small attachment utilities -------------------------------------- */
function humanSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) { return n + " B"; }
  if (n < 1024 * 1024) { return (n / 1024).toFixed(1) + " KB"; }
  if (n < 1024 * 1024 * 1024) { return (n / (1024 * 1024)).toFixed(1) + " MB"; }
  return (n / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

/* Make an original file name safe as the tail of a storage file name. */
function sanitizeFileName(name) {
  const clean = String(name || "file")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return clean || "file";
}

/* Release every blob URL created for the currently open note. Called on
   note switches and on lock, so a long session cannot pile them up. */
function revokeAttachmentUrls() {
  (state.objectUrls || []).forEach(function (u) {
    try { URL.revokeObjectURL(u); } catch (e) { /* already gone */ }
  });
  state.objectUrls = [];
}

/* ----- Google sign in: the ssnotes-auth Worker (v2.79.0) --------------
   Sign in runs through the publisher's Cloudflare Worker,
   ssnotes-auth. The Worker holds the Google client secret and,
   after the one sign in, the account's Google refresh token in
   its own KV store; this app never sees either. What the app
   holds is a Worker session token (30 days, server side),
   encrypted on this device exactly like a provider token.

   The flow, in the order the pieces below run it:

   - The gate's Sign in button navigates the browser to the
     Worker's /login route (navigateToWorkerLogin, the one
     navigation seam). Google signs the user in there, and the
     Worker sends the browser back to this app's address with
     the outcome in the URL fragment.
   - At boot, before any gate logic, readWorkerAuthFragment
     lifts that fragment out of the address bar and scrubs it:
     a session token must never linger in the URL, in history,
     or in a screenshot. The gate then persists the session
     (persistPendingWorkerSession) and enters.
   - Whenever the app needs a Google access token and the
     recorded one has expired, workerFetchAccessToken trades
     the session at the Worker's /token route and records the
     fresh token through the same plumbing every Drive call
     already consumes (recordGoogleAccessToken). The renewal
     ladder below calls the same trade. No code path in this
     app can open a Google window anymore: the only navigation
     is the deliberate Sign in click (and Refresh connection
     with no live session, the same deliberate gesture it has
     always been), and automatic triggers only ever fetch.
   - The Worker's answers decide what a failure means:
     401 no_session clears the local session and lands on the
     gate; 401 reauth does the same and arms the fresh flag,
     so the next Sign in goes to /login?fresh=1, the only
     route that mints a new refresh token; a network failure
     or a Worker 5xx clears NOTHING, because a transient
     outage must never log the user out.
   Scope is drive.file only, as it has been since v1.4: the
   app can see and manage just the files it creates (plus
   files the user picks), never the whole Drive.            */
const WORKER_AUTH_BASE = "https://ssnotes-auth.clytherin.workers.dev";

/* The session token in memory, the boot fragment's held
   outcome, the fresh flag a reauth answer arms, and the
   account email the Worker reports (shown in Settings).
   The token's durable copy is the encrypted blob under
   LS_WORKER_SESSION; memory is only its working copy. */
let workerSessionToken = null;
let pendingWorkerAuth = null;
let workerReauthNeeded = false;
let workerAccountEmail = "";

function loadWorkerSessionBlob() {
  try { return JSON.parse(localStorage.getItem(LS_WORKER_SESSION) || "null"); }
  catch (e) { return null; }
}

/* Store the session token: AES-GCM under the device key,
   the provider token store's own recipe (storeProviderToken),
   so the session is held to the same standard as every
   other credential on this device. */
async function storeWorkerSession(token) {
  if (!state.sessionKey) {
    throw new Error("SnakeScale Notes is not ready to save a provider sign in on this device yet.");
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    state.sessionKey,
    new TextEncoder().encode(token)
  );
  localStorage.setItem(LS_WORKER_SESSION, JSON.stringify({
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(cipher))
  }));
  workerSessionToken = token;
}

/* Read the session token: memory first, then decrypt the
   stored blob with the device key. Returns null when there
   is no session, the key is not ready, or the blob is
   damaged. The client keeps no local expiry for the
   session: it is dead when the Worker says so (a 401),
   not when a local clock decides. */
async function getWorkerSession() {
  if (workerSessionToken) { return workerSessionToken; }
  const rec = loadWorkerSessionBlob();
  if (!rec || !state.sessionKey) { return null; }
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(rec.iv) },
      state.sessionKey,
      base64ToBytes(rec.data)
    );
    workerSessionToken = new TextDecoder().decode(plain);
    return workerSessionToken;
  } catch (e) {
    return null;
  }
}

/* Drop the session everywhere it lives on this device.
   Runs when the Worker reports it dead, and on sign out
   and disconnect beside the provider token's own clear. */
function clearWorkerSession() {
  workerSessionToken = null;
  try { localStorage.removeItem(LS_WORKER_SESSION); }
  catch (e) { /* storage can refuse; memory is already clear */ }
}

/* Remove the auth fragment from the address bar without
   touching anything else in the URL, the web clip strip's
   own recipe (stripWebClipFragment): a history replace to
   the same path and query, so a ?task= or ?noteReminder=
   return trip sharing the URL survives. Falls back to
   clearing the hash where the history call is refused. */
function scrubWorkerAuthFragment() {
  try {
    window.history.replaceState(null, document.title,
      window.location.pathname + window.location.search);
  } catch (err) {
    try { window.location.hash = ""; } catch (e) { /* no-op */ }
  }
}

/* The boot fragment reader. A fragment that is not a Worker
   auth fragment is left entirely alone (a web clip fragment
   is the clip reader's business, and it runs after this
   one). A Worker fragment is scrubbed at once, whatever it
   carries, and its outcome is held in pendingWorkerAuth for
   the gate: a session token (also held in memory at once,
   so nothing downstream can lose it before the encrypted
   store is ready), or the plain word error or denied. */
function readWorkerAuthFragment() {
  let hash = "";
  try { hash = window.location.hash || ""; }
  catch (e) { return null; }
  let out = null;
  if (hash.indexOf("#ssnotes_session=") === 0) {
    const token = hash.slice("#ssnotes_session=".length);
    if (token) { out = { kind: "session", token: token }; }
  } else if (hash.indexOf("#ssnotes_auth=") === 0) {
    const word = hash.slice("#ssnotes_auth=".length);
    out = { kind: word === "denied" ? "denied" : "error" };
  }
  if (!out) { return null; }
  pendingWorkerAuth = out;
  if (out.kind === "session") { workerSessionToken = out.token; }
  scrubWorkerAuthFragment();
  return out;
}

/* Persist the held session outcome into the encrypted
   store. Runs at the head of the gate's preparation, once
   the device key exists; the memory copy bridges the gap
   between the fragment read and this write. A persisted
   session also spends the fresh flag: the sign in that
   just landed is the freshest one there is. */
async function persistPendingWorkerSession() {
  if (!pendingWorkerAuth || pendingWorkerAuth.kind !== "session") {
    return false;
  }
  const token = pendingWorkerAuth.token;
  pendingWorkerAuth = null;
  if (!state.sessionKey) { await loadOrCreateDeviceKey(); }
  await storeWorkerSession(token);
  workerReauthNeeded = false;
  /* v2.81: the sign in that just landed may carry a
     wider grant than the standing access token was
     minted under (the calendar consent upgrades are the
     case in point), and a recorded token cannot gain a
     permission after the fact: when the Phase 1 consent
     landed on 2026-11-01, the app kept entering on its
     pre-consent token, and the new permission reached
     it only when the user signed out by hand. Drop the
     standing provider token and its expiry here, on the
     one path where a new session has actually been
     persisted, so the gate's preparation falls through
     to its silent Worker trade and the app enters on a
     token minted under the new grant. If that trade
     fails, the gate stands, exactly as it does today. */
  clearProviderToken("google");
  state.attach.googleExpiresAt = 0;
  /* v2.80: a sign in just completed, and a consent may
     have changed what the Calendar API will answer:
     forget the calendar module's cache and state so the
     next calendar surface asks fresh. */
  resetGcalState();
  /* v2.82: the same landing forgets the mail
     module's caches and state: a consent may have
     just granted (or changed) the mail permission. */
  resetMailState();
  /* v2.95: and the landing asks for the Inbox unread
     count on its own light read, so the sidebar
     badge is alive from the first screen, before
     any mail surface is opened. */
  mailFetchInboxUnread();
  /* v2.85: the same landing forgets the people
     module's state: the Contacts consent is the one
     this reset exists for, since a normal sign in
     reuses the standing grant and only the consent
     forcing one widens it, and the module's latched
     forbidden state must not outlive the landing
     that cured it. */
  resetPeopleState();
  /* v2.86: the same landing forgets the push module's
     state: the registration below belongs to the
     session that just landed, and a standing auth stop
     from a dead session must not outlive it. */
  resetPushState();
  return true;
}

/* Where Sign in navigates. The fresh flag, armed only by a
   Worker reauth answer, asks the Worker to force Google's
   consent screen: a plain /login reuses the standing grant
   and cannot mint a replacement refresh token. */
function workerLoginUrl() {
  return WORKER_AUTH_BASE + "/login" +
    (workerReauthNeeded ? "?fresh=1" : "");
}

/* The one navigation the auth model performs, kept as a
   named seam the way the update reload is kept
   (reloadForUpdate): the decision logic around it is the
   app's own and runs for real everywhere; the seam is the
   single line that sends the browser to the Worker. Only
   deliberate gestures call it (the gate's Sign in button,
   and Refresh connection when no session stands). */
function navigateToWorkerLogin() {
  window.location.assign(workerLoginUrl());
}

/* The providers registry's connect entry: signing in IS
   the navigation above, nothing else. */
function workerSignIn() {
  navigateToWorkerLogin();
}

/* The Settings Connection tab's account line, filled from
   the email the Worker's /token answers carry (the same
   value its /me route reports). Rendered whenever Settings
   syncs its controls and whenever a token lands. */
function renderWorkerAccountLine() {
  const el = document.getElementById("settingsAccountLine");
  if (!el) { return; }
  if (workerAccountEmail) {
    el.textContent = "Signed in as " + workerAccountEmail + ".";
  } else if (workerSessionToken || loadWorkerSessionBlob()) {
    el.textContent = "Signed in with Google.";
  } else {
    el.textContent = "";
  }
}

/* Record a fresh Google access token: the one landing
   every successful token acquisition shares, with exactly
   the effects a successful connect has always had (the
   expiry on state.attach, the folder and notes caches
   re-resolved for the account, the recorded renewal
   failure cleared, settings saved, the token into the
   encrypted provider store, and the proactive renewal
   rescheduled). Resolves once the token is stored. */
async function recordGoogleAccessToken(accessToken, expiresInSeconds, email) {
  state.attach.googleExpiresAt =
    Date.now() + (Number(expiresInSeconds) || 3600) * 1000;
  state.attach.googleFolderId = null;   /* re-resolve for this account */
  resetDriveNotesCache();               /* notes folders too */
  state.attach.googleRenewalFailure = null;
  renderRenewalFailureLine();
  if (email) { workerAccountEmail = String(email); }
  renderWorkerAccountLine();
  saveSettings();
  await storeProviderToken("google", accessToken);
  /* v2.15: every fresh token (re)schedules the automatic
     renewal below, so the session rolls forward on its own
     instead of lapsing while the app sits open. */
  scheduleGoogleRenewal();
}

/* The token trade itself: POST the session to the Worker's
   /token route and settle the outcome into one of four
   shapes, so every caller (the gate, the renewal ladder,
   the Drive 401 retry, Refresh connection, and the token
   source below) reads the same answer:
     { ok: true }                 a fresh access token is recorded
     { ok: false, kind: "no_session" }
                                  the Worker has no session for
                                  this token (missing or expired);
                                  the local copy is cleared
     { ok: false, kind: "reauth" }
                                  no usable refresh token stands;
                                  the local copy is cleared and
                                  the fresh flag is armed
     { ok: false, kind: "network" }  the fetch itself failed
     { ok: false, kind: "worker", status }
                                  the Worker answered something
                                  else (a 5xx, a malformed 200);
                                  the session is RETAINED in both
                                  transient shapes, by design */
async function workerFetchAccessToken() {
  const session = await getWorkerSession();
  if (!session) { return { ok: false, kind: "no_session" }; }
  let res;
  try {
    res = await fetch(WORKER_AUTH_BASE + "/token", {
      method: "POST",
      headers: { "Authorization": "Bearer " + session }
    });
  } catch (e) {
    return { ok: false, kind: "network" };
  }
  if (res.status === 200) {
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (data && data.access_token) {
      await recordGoogleAccessToken(
        data.access_token, data.expires_in, data.email);
      return { ok: true };
    }
    return { ok: false, kind: "worker", status: res.status };
  }
  if (res.status === 401) {
    let code = "";
    try {
      const j = await res.json();
      code = j && j.error ? String(j.error) : "";
    } catch (e) { /* an unreadable body reads as no_session */ }
    clearWorkerSession();
    if (code === "reauth") {
      workerReauthNeeded = true;
      return { ok: false, kind: "reauth" };
    }
    return { ok: false, kind: "no_session" };
  }
  return { ok: false, kind: "worker", status: res.status };
}

/* One silent renewal attempt for a returning user: the
   Worker trade above, which can only fetch, never navigate
   and never prompt. The detailed form reports WHY a failed
   attempt failed (the trade's kind, or worker_<status>),
   which is what the renewal block records for the sidebar
   menu line; the plain boolean form keeps its exact old
   contract for its old callers (the gate's background
   attempt, the manual Refresh flow). */
async function googleTrySilentSignIn() {
  const detailed = await googleTrySilentSignInDetailed();
  return detailed.ok;
}

async function googleTrySilentSignInDetailed() {
  try {
    const r = await workerFetchAccessToken();
    if (r.ok) { return { ok: true, errorType: null }; }
    return {
      ok: false,
      errorType: r.kind === "worker" ? "worker_" + r.status : r.kind
    };
  } catch (e) {
    return { ok: false, errorType: "unknown" };
  }
}

/* Tell the Worker the session is over: POST /logout with
   the session, best effort. Only the session dies server
   side; the stored refresh token stays, so the next sign
   in is quick. A failed call changes nothing locally: the
   local copies are cleared by the caller regardless, and
   an orphaned session simply expires on its own clock. */
async function workerLogout() {
  const session = await getWorkerSession();
  if (!session) { return; }
  try {
    await fetch(WORKER_AUTH_BASE + "/logout", {
      method: "POST",
      headers: { "Authorization": "Bearer " + session }
    });
  } catch (e) { /* best effort, as the old revoke was */ }
}

/* v2.79.0 migration: a stored GIS era provider token cannot
   become a Worker session, and left in place it would let
   the gate enter on a credential this build no longer
   renews, then strand the user at its expiry. When no
   Worker session stands (stored, held from the fragment,
   or in memory), the legacy token is dropped once, here,
   and the user signs in once through the Worker instead.
   Notes data and the local snapshot cache are untouched:
   only the dead credential goes. */
function migrateLegacyGoogleToken() {
  if (workerSessionToken || loadWorkerSessionBlob()) { return; }
  if (pendingWorkerAuth && pendingWorkerAuth.kind === "session") {
    return;
  }
  if (!loadProviderTokenBlob().google) { return; }
  clearProviderToken("google");
  state.attach.googleExpiresAt = 0;
  saveSettings();
}

/* v2.15: automatic silent renewal. Google's browser token flow
   hands out no refresh token, so an access token lives about an
   hour; until this build the session simply lapsed at the hour
   and the next Drive call surfaced the "sign in expired" path
   until the user pressed Refresh connection by hand. Renewal is
   still the same silent ask (googleTrySilentSignIn), attempted
   on its own in three places. v2.79.0: the ask itself is the
   Worker token trade now, not a GIS prompt: the Worker holds
   the refresh token the browser flow never had, so the ask is
   a plain fetch that can neither show an interaction nor fail
   for want of one:
     - a timer set for a few minutes ahead of the recorded
       expiry after every successful connect;
     - a return to the tab when the token is expired or inside
       that same margin (browsers throttle timers in background
       tabs, so the timer alone cannot be trusted), throttled to
       one attempt a minute;
     - a Drive request answered 401 (gdriveFetch), which retries
       the request once with the fresh token.
   All three run through renewGoogleSilently, one shared in
   flight guard, so they can never race each other into parallel
   token requests, and none of them can ever raise an
   interactive prompt: the interactive consent attempt belongs
   to the manual Refresh connection flow alone.
   v2.24.6: a failed automatic renewal is no longer the end of
   the matter. Through v2.24.5 the failure changed nothing: no
   timer was rescheduled (googleConnect did not run), so a
   session whose one scheduled ask failed coasted to expiry
   with only the visibility and 401 triggers left, which may
   never fire for a user sitting in the tab, and the error
   type behind the failure was discarded. Now every automatic
   failure settles in one place, onGoogleRenewalFailure below:
   the failure's type and time are recorded in settings (and
   shown in the sidebar menu until the next successful
   connect clears them), an expiry episode opens, a backoff
   ladder keeps retrying while the session lives, and the
   next genuine user gesture re-runs the renewal from inside
   itself. See the recovery notes below. */
const GOOGLE_RENEW_MARGIN_MS = 5 * 60 * 1000;
let googleRenewalTimer = null;
let googleRenewalInFlight = null;
let googleRenewalLastAttemptAt = 0;
/* v2.24.6: the renewal recovery state. The ladder delays:
   after a failed automatic attempt, follow ups are armed at
   about a minute, then two minutes, then five, then every
   five minutes for as long as the session lives and the
   token is inside the margin or past it. The step counts
   the retries armed in the current cycle and resets
   whenever a fresh proactive schedule is set. The episode:
   non null while this expiry cycle has seen an automatic
   failure and no success since. Through v2.24.7 it also
   carried an escalated flag, spent by the one interactive
   request a gesture was allowed to make; v2.24.8 removed
   automatic escalation outright (the app never opens
   Google's window on its own), so the flag and the code
   that spent it are gone and the episode is a plain
   marker. The armed flag tracks the gesture listener,
   which now stays armed for the episode's whole life. */
const GOOGLE_RENEWAL_RETRY_DELAYS_MS = [60 * 1000, 2 * 60 * 1000,
  5 * 60 * 1000];
let googleRenewalRetryStep = 0;
let googleRenewalEpisode = null;
let googleRenewalGestureArmed = false;

/* When the next renewal should fire, in milliseconds from now.
   The plain rule is expiry minus the five minute margin. When
   that moment is already past, or less than a minute away (a
   very short lived token, a clock that jumped), firing at half
   the remaining life keeps the renewal ahead of the expiry
   instead of hard on its heels; the one second floor keeps a
   nearly dead token from spinning the timer. */
function googleRenewalDelayMs() {
  const remaining = state.attach.googleExpiresAt - Date.now();
  let delay = remaining - GOOGLE_RENEW_MARGIN_MS;
  if (delay < 60 * 1000) {
    delay = Math.max(1000, Math.floor(remaining / 2));
  }
  return delay;
}

function clearGoogleRenewalTimer() {
  if (googleRenewalTimer !== null) {
    clearTimeout(googleRenewalTimer);
    googleRenewalTimer = null;
  }
}

function scheduleGoogleRenewal() {
  clearGoogleRenewalTimer();
  /* v2.24.6: a fresh proactive schedule is a fresh cycle: the
     ladder, the episode, and any armed gesture reset with it.
     Every successful connect lands here through googleConnect,
     and so does every token restore (see getProviderToken),
     which is what closes the gap, open since v2.15, where a
     session restored at boot carried no timer at all. */
  resetGoogleRenewalRecovery();
  if (!state.providerTokens.google || !state.attach.googleExpiresAt) {
    return;
  }
  googleRenewalTimer = setTimeout(fireGoogleRenewalTimer,
    googleRenewalDelayMs());
}

/* The proactive timer firing: exactly the v2.15 behavior, one
   silent renewal through the shared in flight guard. */
function fireGoogleRenewalTimer() {
  googleRenewalTimer = null;
  renewGoogleSilently().catch(function () { return false; });
}

/* A ladder timer firing: the same silent renewal, but a
   ladder only runs while its session lives. The token can be
   gone by firing time without the timer having been
   cancelled (the 401 path clears the token itself, for one),
   and then the ladder ends quietly instead of asking Google
   about a session that no longer exists. */
function fireGoogleRenewalRetry() {
  googleRenewalTimer = null;
  if (!googleRenewalSessionLive()) {
    resetGoogleRenewalRecovery();
    return;
  }
  renewGoogleSilently().catch(function () { return false; });
}

/* Arm the next ladder retry at the current step's backoff
   delay. One timer only: the ladder goes through the same
   googleRenewalTimer as the proactive schedule, clearing
   whatever it held, so the two schedules can never multiply
   or race. Arming is a no op unless a session exists and the
   token is inside the margin or already past its expiry:
   outside that window a failure leaves the standing
   proactive schedule untouched. */
function scheduleGoogleRenewalRetry() {
  if (!googleRenewalSessionLive() || !googleRenewalDue()) { return; }
  const idx = Math.min(googleRenewalRetryStep,
    GOOGLE_RENEWAL_RETRY_DELAYS_MS.length - 1);
  const delay = GOOGLE_RENEWAL_RETRY_DELAYS_MS[idx];
  googleRenewalRetryStep += 1;
  clearGoogleRenewalTimer();
  googleRenewalTimer = setTimeout(fireGoogleRenewalRetry, delay);
}

/* Whether a session exists for renewal purposes: the same
   test the visibility trigger makes. Since v2.79.0 the
   session that matters is the Worker session (memory or
   its encrypted store); a standing access token counts
   too, as it did before, for the span it is still live. */
function googleRenewalSessionLive() {
  return !!(workerSessionToken || loadWorkerSessionBlob() ||
    state.providerTokens.google || loadProviderTokenBlob().google);
}

/* Whether the token is inside the renewal margin or already
   past its expiry: the window the ladder and the gesture
   healing exist for. */
function googleRenewalDue() {
  return !!state.attach.googleExpiresAt &&
    Date.now() > state.attach.googleExpiresAt - GOOGLE_RENEW_MARGIN_MS;
}

/* Close the recovery state: the ladder back to its first
   step, the episode closed, the gesture disarmed. Runs when
   a fresh cycle is scheduled (scheduleGoogleRenewal, so on
   every successful connect and every restore) and when the
   session ends (both sign out paths call it beside
   clearGoogleRenewalTimer). */
function resetGoogleRenewalRecovery() {
  googleRenewalRetryStep = 0;
  googleRenewalEpisode = null;
  disarmGoogleRenewalGesture();
  /* v2.79.0: through v2.78.0 this reset also cleared the
     one shot UI gesture token the GIS choke point spent.
     That machinery is retired with the token client
     itself: no request in this app can raise a Google
     window at all now, so there is no mint left to clear. */
}

/* The one silent renewal every automatic trigger shares. A
   trigger that arrives while a renewal is already running gets
   that renewal's promise instead of starting a second one.
   Resolves true when a fresh token was recorded (which also
   rescheduled the timer, through googleConnect), false when
   the silent ask failed. Never throws. */
function renewGoogleSilently() {
  if (googleRenewalInFlight) { return googleRenewalInFlight; }
  googleRenewalLastAttemptAt = Date.now();
  googleRenewalInFlight = (async function () {
    let result;
    try {
      result = await googleTrySilentSignInDetailed();
    } catch (e) {
      result = { ok: false, errorType: "unknown" };
    } finally {
      googleRenewalInFlight = null;
    }
    /* v2.24.6: every automatic failure settles in one place
       (the record, the episode, the ladder), so the timer,
       the tab return, and the 401 recovery all leave the
       same recovery state behind. A success needs nothing
       here: googleConnect already rescheduled the proactive
       timer, reset the recovery state, and cleared the
       recorded failure. */
    if (!result.ok) { onGoogleRenewalFailure(result.errorType); }
    return result.ok;
  })();
  return googleRenewalInFlight;
}

/* v2.24.6: where an automatic renewal failure lands. The
   failure is recorded first (it stands even when nothing
   more can be done), then, while the session lives and the
   token is inside its margin or past it, the episode opens
   if this cycle has none yet, and the ladder arms its next
   retry. */
function onGoogleRenewalFailure(errorType) {
  recordGoogleRenewalFailure(errorType);
  if (!googleRenewalSessionLive() || !googleRenewalDue()) { return; }
  if (!googleRenewalEpisode) {
    googleRenewalEpisode = {};
    armGoogleRenewalGesture();
  }
  scheduleGoogleRenewalRetry();
}

/* v2.24.6: the failure record. The last automatic renewal
   failure, its failure type and when it happened, kept in
   settings (state.attach rides along in the settings record)
   so it survives a reload, and cleared by the next
   successful connect in googleConnect. Nothing about the
   session or the account goes in it: a type string and a
   time, nothing else. */
function recordGoogleRenewalFailure(errorType) {
  state.attach.googleRenewalFailure = {
    type: String(errorType || "unknown"),
    at: Date.now()
  };
  saveSettings();
  renderRenewalFailureLine();
}

/* The record's one rendering: a muted line in the sidebar
   menu under Refresh connection, present only while a
   failure stands. */
function renderRenewalFailureLine() {
  const el = document.getElementById("sidebarRenewalFailure");
  if (!el) { return; }
  const rec = state.attach.googleRenewalFailure;
  if (!rec || typeof rec.type !== "string" || !rec.type) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  const when = rec.at ? new Date(rec.at) : null;
  el.textContent = "Last automatic renewal failed: " + rec.type +
    (when && !isNaN(when.getTime())
      ? " \u00b7 " + when.toLocaleTimeString([],
          { hour: "numeric", minute: "2-digit" })
      : "");
  el.classList.remove("hidden");
}

/* v2.24.6: gesture healing. v2.24.8: silent only, and the
   listener stays armed for the episode's whole life.
   While an episode is open, genuine user gestures in the
   app (pointer presses and key presses) keep re-running
   the silent renewal: the user is already here and active,
   which is exactly when a lapsed connection hurts, and a
   silent ask costs the gesture nothing. The listener
   never touches the event (no preventDefault, no
   stopPropagation, no delay): the gesture's own control
   receives it and acts exactly as it would have anyway.
   Attempts ride the same one attempt a minute throttle as
   the visibility trigger, off the same last attempt stamp
   every trigger shares, and a failed attempt leaves the
   listener armed for the next gesture; only the episode
   closing disarms it (a successful renewal starting a
   fresh cycle, a sign out, or a fresh schedule, all
   through resetGoogleRenewalRecovery). It never arms on
   the sign in gate or while signed out: episodes only
   open on a live session's failure inside the app, and
   the handler re-checks all of that when a gesture lands.
   Through v2.24.7 the first gesture in an episode could
   also escalate, inside that same gesture, to the
   interactive token request. Chris rejected the result:
   Google's window opening off an ordinary click is the
   popup he hates, whatever the intention. So no
   automatic path in this app ever raises the interactive
   request now: automatic renewal is the silent ask alone,
   and a Google window appears only when the user presses
   Sign in or Refresh connection themselves. */
function armGoogleRenewalGesture() {
  if (googleRenewalGestureArmed) { return; }
  googleRenewalGestureArmed = true;
  document.addEventListener("pointerdown", onGoogleRenewalGesture);
  document.addEventListener("keydown", onGoogleRenewalGesture);
}

function disarmGoogleRenewalGesture() {
  if (!googleRenewalGestureArmed) { return; }
  googleRenewalGestureArmed = false;
  document.removeEventListener("pointerdown", onGoogleRenewalGesture);
  document.removeEventListener("keydown", onGoogleRenewalGesture);
}

function onGoogleRenewalGesture(ev) {
  /* A gesture aimed at signing out, or at the gate itself,
     is not a healing gesture: signing out ends the episode
     through its own cancel path, and the gate is where the
     ordinary sign in belongs. The listener stays armed
     either way; only the episode closing disarms it. */
  if (ev && ev.target && ev.target.closest &&
      ev.target.closest("#sidebarSignOutItem, #repoLockBtn, " +
        "#setupScreen, #repoScreen")) {
    return;
  }
  const appEl = document.getElementById("app");
  if (!appEl || appEl.classList.contains("hidden")) { return; }
  if (!googleRenewalEpisode) { return; }
  if (!googleRenewalSessionLive() || !googleRenewalDue()) { return; }
  /* The one attempt a minute throttle every automatic
     trigger shares, off the same last attempt stamp. A
     gesture inside the minute is simply not an attempt;
     the next one, a minute on, is. */
  if (Date.now() - googleRenewalLastAttemptAt < 60 * 1000) { return; }
  renewGoogleSilently().catch(function () { return false; });
}

/* The visibility trigger: the tab came back to the foreground.
   Renew only when a session exists on this device (a token in
   memory or in the encrypted store) and the token is expired or
   inside the renewal margin, and at most once a minute: the
   timer and the 401 recovery stamp the same last attempt time,
   so a tab return right after either of them renewed does not
   immediately ask again. */
function maybeRenewGoogleOnVisible() {
  if (document.visibilityState !== "visible") { return; }
  if (!googleRenewalSessionLive()) {
    return;
  }
  if (state.attach.googleExpiresAt &&
      Date.now() <= state.attach.googleExpiresAt - GOOGLE_RENEW_MARGIN_MS) {
    return;
  }
  if (Date.now() - googleRenewalLastAttemptAt < 60 * 1000) { return; }
  renewGoogleSilently().catch(function () { return false; });
}

/* --------------------------------------------------------------------------
   v2.16: idle auto-sync on Drive changes

   Until this build, a change made outside this tab (the same
   account on a phone, a second browser, another tool writing to
   a file this app owns) only appeared here when the user
   pressed Sync now or reloaded. The watcher below closes that
   gap the cheap way: it polls the Drive change feed, one small
   call about every 30 seconds, and runs the ordinary sync only
   when the feed reports a change that touches this store.

   The pieces, in the order a tick meets them:

   - The change token. getStartPageToken hands out a token
     meaning "now"; changes.list from that token reports only
     what changed since. The token lives in memory only and is
     re-baselined at every boot, after the boot sync (which has
     just loaded the whole store anyway, so nothing is missed),
     and whenever the toggle is switched back on. A 410 from
     changes.list means the token went stale; the answer is a
     fresh baseline and no sync from that poll.
   - The corpus test. A change counts only when it touches the
     SnakeScale tree: its file id is in the known id set (the
     notes root, the folder ids, index.json, every note file,
     and attachment files, rebuilt by loadAllFromRepo after
     every load), or it is a live file whose parent is a known
     folder (which is how a file newly adopted into the tree
     announces itself). Removed changes for known files count.
     One refinement: the feed also reports this app's own
     saves, so a change naming a loaded note file whose
     reported revision is the revision already held is not a
     change for us and never triggers a reload on its own.
   - The gates. A sync runs only when the user has been idle
     for AUTO_SYNC_IDLE_MS (activity is keydown, pointerdown,
     and input events on the document, stamped by
     noteUserActivity), the tab is visible, no sync is running,
     no voice recording is in progress, and no overlay is open
     (anyOverlayOpen: the modals, the image editor, the link
     bar and its menus, the mention popup, and both drags,
     block and note). A change noticed while a gate is shut
     sets autoSyncPendingChange and the same 30 second tick
     runs it once the gates open.
   - The sync itself is the existing syncNow(false): the same
     flush before load order, no toast, the pill showing the
     activity as usual. While it runs, the editor guard
     (autoSyncEditorGuard) remembers the open note's id and
     storage revision; renderEditor compares and, when the
     reload brought that note back unchanged, leaves the
     editor exactly as it stood, DOM and selection alike.

   Every failure here is quiet by design: a poll that errors
   (beyond the 410 re-baseline) syncs nothing, toasts nothing,
   and simply tries again at the next tick, and the changes
   calls ride gdriveFetch, so a 401 takes the v2.15 silent
   renewal path like any other Drive call. Nothing here can
   raise an interactive prompt.
   -------------------------------------------------------------------------- */
const AUTO_SYNC_POLL_MS = 30 * 1000;
const AUTO_SYNC_IDLE_MS = 10 * 1000;
let autoSyncTimer = null;          /* the 30 second interval, or null */
let autoSyncPageToken = null;      /* in memory only, see above */
let autoSyncPendingChange = false; /* a change is waiting on the gates */
let autoSyncPollRunning = false;   /* one poll (or its sync) at a time */
let autoSyncKnownIds = new Set();  /* the corpus, rebuilt per load */
let autoSyncNoteIdByFileId = Object.create(null); /* file id -> note id */
let autoSyncEditorGuard = null;    /* {id, sha} during an auto-sync */
let lastUserActivityAt = Date.now();

/* The idle clock's stamp, wired in wireEvents. */
function noteUserActivity() {
  lastUserActivityAt = Date.now();
}

/* Rebuild the corpus from the store as just loaded. The Drive
   driver's own caches carry every id a load resolved: the root,
   the folder ids by path, and the file ids by path (index.json
   and every note file among them). Attachment file ids ride in
   the loaded notes' records. The reverse map from a note's
   Drive file id back to the note id (the file name without its
   .md) is what the already reflected test below looks up. */
function rebuildAutoSyncKnownIds() {
  const ids = new Set();
  if (driveCache.rootId) { ids.add(driveCache.rootId); }
  Object.keys(driveCache.folderIds).forEach(function (path) {
    ids.add(driveCache.folderIds[path]);
  });
  const byFile = Object.create(null);
  Object.keys(driveCache.fileIds).forEach(function (path) {
    const id = driveCache.fileIds[path];
    ids.add(id);
    const m = /([^/]+)\.md$/i.exec(path);
    if (m) { byFile[id] = m[1]; }
  });
  [state.notes, state.trash, state.archive].forEach(function (list) {
    (list || []).forEach(function (note) {
      (note.attachments || []).forEach(function (att) {
        if (att && att.fileId) { ids.add(att.fileId); }
      });
    });
  });
  autoSyncKnownIds = ids;
  autoSyncNoteIdByFileId = byFile;
}

/* The corpus test for one change record, as described above. */
function autoSyncChangeTouchesStore(change) {
  if (!change || !change.fileId) { return false; }
  /* v2.20: the two store root bookkeeping files get their own
     answers, ahead of the corpus test. A catalog change never
     triggers a sync: the catalog is a cache this device rebuilds
     and reconciles on its own schedule, and reacting to it would
     loop on the app's own catalog writes. A drop box change does
     trigger one (an outside writer may have added notes to
     import), except the echo of this device's own cleanup
     write, recognized by its token being the last processed
     one. Both ids are read live from the driver's resolution
     cache, where every load leaves them. */
  const catalogFileId = driveCache.fileIds[CATALOG_FILE];
  if (catalogFileId && change.fileId === catalogFileId) {
    return false;
  }
  /* v2.24: tasks.json joins the store's triggers. Another
     device's task change syncs like a drop box change; this
     device's own write is recognized by its token being the
     last one read or written here, and skipped, so our own
     writes never loop a sync. */
  const tasksFileId = driveCache.fileIds[TASKS_FILE];
  if (tasksFileId && change.fileId === tasksFileId) {
    if (change.removed) { return true; }
    if (change.file && lastTasksToken &&
        driveTokenFromMetadata(change.file) === lastTasksToken) {
      return false;
    }
    return true;
  }
  const incomingFileId = driveCache.fileIds[INCOMING_FILE];
  if (incomingFileId && change.fileId === incomingFileId) {
    if (change.removed) { return true; }
    if (incomingProcessedToken && change.file &&
        driveTokenFromMetadata(change.file) ===
          incomingProcessedToken) {
      return false;
    }
    return true;
  }
  let inCorpus = autoSyncKnownIds.has(change.fileId);
  if (!inCorpus && !change.removed && change.file &&
      Array.isArray(change.file.parents)) {
    inCorpus = change.file.parents.some(function (parentId) {
      return autoSyncKnownIds.has(parentId);
    });
  }
  if (!inCorpus) { return false; }
  if (change.removed) { return true; }
  /* Already reflected: our own save echoing back, or any write
     whose revision is the one this device already holds. */
  const noteId = autoSyncNoteIdByFileId[change.fileId];
  if (noteId && change.file) {
    const note = findNoteById(noteId);
    const token = driveTokenFromMetadata(change.file);
    if (note && token && note.sha === token) { return false; }
  }
  return true;
}

/* Ask Drive for a fresh "now" token. Failures stay quiet and
   leave the token null; the next tick baselines again. */
async function baselineAutoSync() {
  try {
    const data = await gdriveJson(
      "https://www.googleapis.com/drive/v3/changes/startPageToken");
    if (data && data.startPageToken) {
      autoSyncPageToken = data.startPageToken;
    }
  } catch (e) { /* quiet by design; retried at the next tick */ }
}

/* (Re)start the poller: any running interval is replaced, the
   token re-baselines, and ticks begin. With the setting off
   this only stops, so callers (the connect flow, the refresh
   flow, the toggle) can call it unconditionally. */
function startAutoSync() {
  if (autoSyncTimer !== null) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
  if (!state.autoSync) { return; }
  baselineAutoSync();
  autoSyncTimer = setInterval(autoSyncTick, AUTO_SYNC_POLL_MS);
}

/* Stop the poller outright and forget its token and any
   pending change: sign out, disconnect, and the toggle's off
   all land here. */
function stopAutoSync() {
  if (autoSyncTimer !== null) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
  autoSyncPageToken = null;
  autoSyncPendingChange = false;
}

/* May an auto-sync run right now? Every condition from the
   section comment, in one place so the tick has one question
   to ask. */
function autoSyncGatesOpen() {
  if (document.visibilityState !== "visible") { return false; }
  if (state.syncing) { return false; }
  if (voiceCapture) { return false; }
  if (anyOverlayOpen()) { return false; }
  if (Date.now() - lastUserActivityAt < AUTO_SYNC_IDLE_MS) {
    return false;
  }
  return true;
}

/* One pass over the change feed from the stored token,
   following its pages. Resolves true when any change touched
   the store. The stored token advances only when the whole
   pass succeeds; a 410 re-baselines instead (the caller's
   token is stale, and a fresh one makes this poll a no-op). */
async function pollAutoSyncChanges() {
  let token = autoSyncPageToken;
  let touches = false;
  for (;;) {
    let res;
    try {
      res = await gdriveFetch(
        "https://www.googleapis.com/drive/v3/changes?pageToken=" +
        encodeURIComponent(token) + "&pageSize=100&fields=" +
        encodeURIComponent(
          "nextPageToken,newStartPageToken,changes(fileId,removed," +
          "file(id,name,mimeType,parents,trashed,headRevisionId," +
          "modifiedTime))"));
    } catch (e) {
      /* A failed renewal's reconnect error and plain network
         failures both land here; both are quiet at this level. */
      return false;
    }
    if (res.status === 410) {
      await baselineAutoSync();
      return false;
    }
    if (!res.ok) { return false; }
    const data = await res.json();
    (data.changes || []).forEach(function (change) {
      if (autoSyncChangeTouchesStore(change)) { touches = true; }
    });
    if (data.nextPageToken) { token = data.nextPageToken; continue; }
    if (data.newStartPageToken) {
      autoSyncPageToken = data.newStartPageToken;
    }
    return touches;
  }
}

/* Run the sync an auto-sync owes, with the editor guard armed
   for its render (see renderEditor). The pending flag clears
   as the sync starts: a change that lands during the sync is
   a new debt, collected by a later poll. */
async function runAutoSync() {
  const open = currentNote();
  autoSyncEditorGuard = open ? { id: open.id, sha: open.sha } : null;
  autoSyncPendingChange = false;
  try {
    await syncNow(false);
  } finally {
    autoSyncEditorGuard = null;
  }
}

/* One poll tick. Polling itself needs the setting on, a ready
   store, a visible tab, and no sync already running; a tick
   that finds a pending change and open gates spends itself on
   the sync instead of a feed call. */
async function autoSyncTick() {
  if (!state.autoSync) { return; }
  if (autoSyncPollRunning) { return; }
  if (!storeSyncReady()) { return; }
  if (document.visibilityState !== "visible") { return; }
  if (state.syncing) { return; }
  autoSyncPollRunning = true;
  try {
    if (autoSyncPendingChange) {
      if (autoSyncGatesOpen()) { await runAutoSync(); }
      return;
    }
    if (!autoSyncPageToken) {
      await baselineAutoSync();
      return;
    }
    const touches = await pollAutoSyncChanges();
    if (touches) {
      autoSyncPendingChange = true;
      if (autoSyncGatesOpen()) { await runAutoSync(); }
    }
  } catch (e) {
    /* A tick never surfaces an error; the next one retries. */
  } finally {
    autoSyncPollRunning = false;
    /* v2.95: the tick is the app's standing thirty
       second cadence while the page stands visible;
       the mail badge's count rides it on its light
       read, so new mail shows in the sidebar without
       a mail surface ever being opened. The read
       guards itself (signed in, no consent state,
       not already in flight). */
    mailFetchInboxUnread();
    /* v2.100: the snooze schedule reconciles on the
       same cadence (its own guards are the same
       shape), so a return that comes due while the
       app stands open lands without waiting for
       the Worker's next pass or a reopen. */
    mailSnoozeReconcile();
  }
}

/* v2.2: Refresh connection. Through v2.6.0 it was a standalone
   sidebar button next to Sign out; v2.7 moved it into the sidebar
   footer's three dot menu, and v2.8 moved it again, into the
   Settings modal, and the working label below is set on that
   modal's button (settingsRefreshBtn and its label span). The
   elements are looked up once here and restored in the finally
   block, so the working state lands correctly even if the modal
   is closed while a refresh is still running. The icon rail's
   refresh button calls this same function directly. v2.15 added
   a labeled button in the sidebar footer running this flow too;
   v2.17 removed that button and put Refresh connection back in
   the sidebar three dot menu, as the item under Sync now
   (sidebarRefreshItem). A menu item carries no busy label: the
   menu closes the moment it is chosen, and the run's feedback
   is the Synced pill (the refresh ends in a sync) and the
   closing "Connection refreshed." toast, the same feedback
   Sync now has always given from that menu.
   Chris reached this build the hard way: his Google token expired
   mid session (browser token flows hand out no refresh token, so
   tokens live about an hour), the app told him to sign in again,
   and the only visible route was a page refresh he was afraid to
   make with unsaved typing on screen. This handler never reloads
   the page, never changes screens, never reseeds, and never wipes
   the cache, the queue, the device key, or settings, and it is safe
   to press at any time, signed in, expired, or mid edit.
   What it reuses, deliberately, instead of duplicating token logic:
   googleTrySilentSignIn (the Worker token trade) for the token
   attempt, driveEnsureNotesRoot to prove the fresh
   token against Drive, and syncNow for the established flush then
   load sequence a gate sign in runs (flushQueue, flushIndexWrites,
   loadAllFromRepo, renderAll). v2.79.0: when the trade reports
   the session dead, or none stands, this deliberate gesture
   navigates to the Worker's sign in instead; a transient
   failure keeps the session and earns the toast, as before.
   Failure honesty: if both token attempts fail, or the Drive proof
   or the sync throws, the toast says plainly that the connection
   could not be refreshed and that his notes and queued changes are
   saved on this device, which is true: step (a) put the open note
   into the encrypted local cache (and into the sync queue whenever
   the old token was already dead), and nothing in this function
   ever deletes local state. */
let refreshConnectionRunning = false;
async function refreshGoogleConnection() {
  if (refreshConnectionRunning) { return; }
  refreshConnectionRunning = true;
  const busyControls = [
    { btn: document.getElementById("settingsRefreshBtn"),
      label: document.getElementById("settingsRefreshLabel"),
      original: null }
  ];
  busyControls.forEach(function (c) {
    if (c.btn) { c.btn.disabled = true; }
    if (c.label) {
      c.original = c.label.textContent;
      c.label.textContent = "Refreshing...";
    }
  });
  try {
    /* (a) Persist the open note locally before touching the token,
       through the same local save path the app uses before locking:
       collectEditor folds everything on screen into the note object
       and saveCache writes the encrypted local cache. The follow up
       save through the normal per note path matters just as much:
       with an already expired token that path queues the note's full
       current text in the offline queue (and saves the cache again),
       and with a live token it simply saves, so the newest text is
       never held only in the cache copy that the load in step (c)
       is about to replace. A locked note (Trash or Archive) is
       skipped: it is not editable, so there is nothing typed to
       protect, and its editor fields are disabled anyway. */
    const open = currentNote();
    if (open && !open.trashed && !open.archived &&
        renderEditor._forId === open.id) {
      collectEditor(open);
      saveCache();
      /* v2.22: this save is ambient (see the worker's ambient
         gate): it exists to protect a genuinely dirty editor's
         text (queued in full when the token is already dead),
         not to persist a note nobody edited. Through v2.21 it
         ran ungated, so Refresh on a device merely holding a
         note open with a stale revision saved that stale text
         through the full write path and forked a conflict
         copy of it (the 2026-10-22 iPad incident). Marked
         ambient, an untouched open note now costs this save
         nothing at all, and a dirty one still saves (or
         queues) exactly as before. */
      await saveNoteToRepo(open, { ambient: true })
        .catch(function () { return null; });
    }
    /* (b) A fresh token through the Worker trade
       (googleTrySilentSignIn, which records the token exactly
       as a normal sign in does: expiry on state.attach, provider
       token store, settings saved), so nothing after this step
       can tell the difference between a refresh and a sign in.
       v2.79.0: when the trade reports the session dead
       (no_session, reauth) or none stands, this deliberate
       gesture navigates to the Worker's sign in, the fresh
       route when the reauth flag stands. A transient failure
       (network, Worker 5xx) keeps the session, and the run
       ends on the toast below, exactly as a failed refresh
       always has. */
    const attempt = await googleTrySilentSignInDetailed();
    if (!attempt.ok) {
      if (attempt.errorType === "no_session" ||
          attempt.errorType === "reauth") {
        navigateToWorkerLogin();
        return;
      }
      toast("Could not refresh the connection. Your notes and queued " +
        "changes are saved on this device; try again in a moment.", true);
      return;
    }
    /* (c) The same load and sync sequence a gate sign in runs, minus
       everything that belongs only to the gate: no screen change, no
       loading overlay, no seeding check, no consolidation (that one
       time move already ran, or runs on a later real sign in), and
       nothing wiped. driveEnsureNotesRoot proves the token against
       Drive before the sync trusts it, exactly as connectAndLoad
       does. syncNow flushes the queue first and then loads, in the
       established order; if a sync is already running it returns
       early and that sync owns the same work. */
    await driveEnsureNotesRoot();
    state.repoExists = true;
    await syncNow(false);
    /* v2.16: a proved connection restarts the auto-sync
       watcher on a fresh baseline, so a refresh also heals a
       watcher whose polls have been failing quietly. */
    startAutoSync();
    refreshSyncPill();
    toast("Connection refreshed.");
  } catch (err) {
    toast("Could not refresh the connection. Your notes and queued " +
      "changes are saved on this device; try again in a moment.", true);
  } finally {
    refreshConnectionRunning = false;
    busyControls.forEach(function (c) {
      if (c.btn) { c.btn.disabled = false; }
      if (c.label && c.original !== null) {
        c.label.textContent = c.original;
      }
    });
  }
}

async function googleDisconnect() {
  const token = await getProviderToken("google");
  /* v2.79.0: the Worker session dies with the disconnect
     too: the Worker's own logout first (best effort), then
     the local session store. */
  /* v2.86: the disconnect ends the session too, so
     this device's push registration goes with it,
     best effort, exactly as at sign out. */
  await pushSignOutCleanup();
  await workerLogout();
  clearWorkerSession();
  workerReauthNeeded = false;
  clearProviderToken("google");
  /* v2.15: the session this disconnect drops is the one the
     renewal timer serves; cancel the timer with the token. */
  clearGoogleRenewalTimer();
  /* v2.24.6: the recovery state (ladder, episode, gesture)
     serves that same session; it is cancelled with it. */
  resetGoogleRenewalRecovery();
  /* v2.16: the auto-sync watcher serves the same session. */
  stopAutoSync();
  /* v2.17.1: and so does the divergence state. */
  clearAllDivergenceState();
  state.attach.googleExpiresAt = 0;
  state.attach.googleFolderId = null;
  resetDriveNotesCache();
  saveSettings();
  /* v2.79.0: through v2.78.0 the dropped access token was
     also revoked with Google here, best effort, through
     the GIS client. There is no GIS client anymore; the
     Worker logout above is the server side sign out, and
     the access token simply expires on its own clock. */
}

async function googleGetStatus() {
  const token = await getProviderToken("google");
  if (!token) {
    /* v2.79.0: no access token in hand is not yet signed
       out when a Worker session stands: the session can
       mint one on the spot (the gate's silent attempt, the
       token source, and the renewal ladder all do exactly
       that), so the honest word for this state is expired,
       the state those paths already know how to heal. */
    if (await getWorkerSession()) {
      return { connected: false, reason: "expired" };
    }
    return { connected: false, reason: "signed-out" };
  }
  if (!state.attach.googleExpiresAt ||
      Date.now() > state.attach.googleExpiresAt - 30000) {
    /* Expired (or expiry unknown). Through v2.78.0 the dead
       token was dropped here and the user signed in again:
       the browser token flow had no refresh token. Since
       v2.79.0 a standing Worker session renews the token
       instead, so with one the token stays where it is and
       the renewal paths replace it; without one the old
       behavior stands, word for word. */
    if (!(await getWorkerSession())) {
      clearProviderToken("google");
      state.attach.googleExpiresAt = 0;
      saveSettings();
    }
    return { connected: false, reason: "expired" };
  }
  return { connected: true };
}

/* Shared Drive fetch: attaches the token, converts a 401 into the
   readable "sign in expired" path, and normalizes network failures.
   v2.15: a first 401 no longer gives up on the spot. One silent
   renewal is attempted (renewGoogleSilently, the shared guard,
   empty prompt only), and when it lands a fresh token the
   request is retried exactly once with it: every caller through
   here sends a string body or no body, so a retry replays the
   request faithfully. Only when the renewal fails, or the
   retry is answered 401 as well, does the established path run:
   token cleared, expiry zeroed, the reconnect error thrown.
   One renewal and one retry per call, never a loop. */
async function gdriveFetch(url, options) {
  options = options || {};
  async function attempt() {
    const token = await getGoogleAccessToken();
    const headers = Object.assign({}, options.headers || {},
      { "Authorization": "Bearer " + token });
    try {
      return await fetch(url, Object.assign({}, options, { headers: headers }));
    } catch (e) {
      const err = new Error("Network error talking to Google Drive. You appear to be offline.");
      err.offline = true;
      throw err;
    }
  }
  let res = await attempt();
  if (res.status === 401) {
    const renewed = await renewGoogleSilently();
    if (renewed) {
      res = await attempt();
      if (res.status !== 401) { return res; }
    }
    clearProviderToken("google");
    state.attach.googleExpiresAt = 0;
    saveSettings();
    throw googleReconnectError();
  }
  return res;
}

async function gdriveErrorMessage(res, fallback) {
  let msg = fallback || ("Google Drive error " + res.status);
  try {
    const j = await res.json();
    if (j && j.error && j.error.message) { msg = j.error.message; }
  } catch (e) { /* keep the fallback */ }
  return msg;
}

async function gdriveJson(url, options) {
  const res = await gdriveFetch(url, options);
  if (!res.ok) { throw new Error(await gdriveErrorMessage(res)); }
  if (res.status === 204) { return null; }
  return res.json();
}

/* Find or create the attachments folder: the "attachments" child of
   the SnakeScale Notes root. v2.0 layout: attachments share the one
   notes folder instead of living in a separate top level folder.
   The notes root and the child are resolved through the notes Drive
   driver (driveEnsureNotesRoot, driveResolveFolder, and their
   shared cache), never through a second independent lookup, so
   there is exactly one root resolution and one root. The resolved
   subfolder ID is also cached in settings; a cached ID is
   revalidated once, including a parent check, because the user
   could have deleted or moved the folder in Drive between
   sessions, and because a cache written before v2.0 points at the
   OLD top level folder, whose parent is not the notes root. */
async function googleEnsureAttachmentsFolder() {
  const rootId = await driveEnsureNotesRoot();
  if (state.attach.googleFolderId) {
    try {
      const info = await gdriveJson(
        "https://www.googleapis.com/drive/v3/files/" +
        encodeURIComponent(state.attach.googleFolderId) +
        "?fields=" + encodeURIComponent("id,trashed,mimeType,parents"));
      if (info && !info.trashed &&
          info.mimeType === DRIVE_FOLDER_MIME &&
          (info.parents || []).indexOf(rootId) >= 0) {
        driveCache.folderIds[ATTACH_SUBFOLDER_NAME] = info.id;
        return info.id;
      }
    } catch (e) { /* fall through and resolve the folder again */ }
    state.attach.googleFolderId = null;
  }
  const folderId = await driveResolveFolder(ATTACH_SUBFOLDER_NAME, true);
  state.attach.googleFolderId = folderId;
  saveSettings();
  return folderId;
}

/* v2.0 one time consolidation: before v2.0, attachments lived in a
   top level folder named "SnakeScale Notes Attachments". Attachment
   records reference Drive file IDs and every read fetches by ID, so
   files in the old folder keep working exactly where they sit. This
   pass simply tidies up: when the legacy folder exists, each file
   in it is moved into the notes folder's attachments subfolder by
   updating its parents. It runs at most once per profile (the
   settings flag is set and saved before any work happens), every
   failure is ignored (a failed move is harmless), the legacy folder
   itself is deliberately left in place for its owner to remove,
   and the whole pass is wrapped so it can never block or fail the
   connect flow that calls it. */
async function maybeConsolidateLegacyAttachments() {
  if (state.attach.legacyConsolidated) { return; }
  state.attach.legacyConsolidated = true;
  saveSettings();
  try {
    const q = "name = '" + driveEscapeQueryValue(ATTACH_ROOT_NAME) +
      "' and mimeType = '" + DRIVE_FOLDER_MIME +
      "' and 'root' in parents and trashed = false";
    const data = await gdriveJson(
      "https://www.googleapis.com/drive/v3/files?q=" +
      encodeURIComponent(q) + "&fields=" +
      encodeURIComponent("files(id,name)"));
    if (!data.files || !data.files.length) { return; }
    const legacyId = data.files[0].id;
    const targetId = await googleEnsureAttachmentsFolder();
    if (legacyId === targetId) { return; }
    const children = await driveListChildren(legacyId);
    for (const child of children) {
      if (child.mimeType === DRIVE_FOLDER_MIME) { continue; }
      try {
        await gdriveJson(
          "https://www.googleapis.com/drive/v3/files/" +
          encodeURIComponent(child.id) +
          "?addParents=" + encodeURIComponent(targetId) +
          "&removeParents=" + encodeURIComponent(legacyId) +
          "&fields=id,parents",
          { method: "PATCH" });
      } catch (e) { /* one failed move is harmless; keep going */ }
    }
  } catch (e) { /* consolidation is best effort, always */ }
}


/* Resumable upload, per Google's protocol: one POST opens a session,
   then the bytes go up in 8 MiB chunks (a multiple of the required
   256 KiB). A 308 answer means "resume incomplete"; its Range header
   says how many bytes Google actually holds, which is where the next
   chunk starts. A 200 or 201 carries the finished file resource. */
async function googleUpload(file, storageName, onProgress) {
  const folderId = await googleEnsureAttachmentsFolder();
  const token = await getGoogleAccessToken();
  let initRes;
  try {
    initRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": file.type || "application/octet-stream",
          "X-Upload-Content-Length": String(file.size)
        },
        body: JSON.stringify({ name: storageName, parents: [folderId] })
      });
  } catch (e) {
    throw new Error("Network error starting the Google Drive upload.");
  }
  if (initRes.status === 401) {
    clearProviderToken("google");
    state.attach.googleExpiresAt = 0;
    saveSettings();
    throw googleReconnectError();
  }
  if (!initRes.ok) {
    throw new Error(await gdriveErrorMessage(initRes,
      "Google Drive refused to start the upload (status " + initRes.status + ")"));
  }
  const sessionUrl = initRes.headers.get("Location");
  if (!sessionUrl) {
    throw new Error("Google Drive did not return an upload session address.");
  }
  if (file.size === 0) {
    const emptyRes = await fetch(sessionUrl, {
      method: "PUT",
      headers: { "Content-Range": "bytes */0" }
    });
    if (emptyRes.status === 200 || emptyRes.status === 201) {
      const doneEmpty = await emptyRes.json();
      return { fileId: doneEmpty.id };
    }
    throw new Error(await gdriveErrorMessage(emptyRes,
      "Google Drive upload of the empty file failed (status " + emptyRes.status + ")"));
  }
  const CHUNK = 8 * 1024 * 1024;
  let offset = 0;
  while (offset < file.size) {
    const end = Math.min(offset + CHUNK, file.size);
    let res;
    try {
      res = await fetch(sessionUrl, {
        method: "PUT",
        headers: {
          "Content-Range": "bytes " + offset + "-" + (end - 1) + "/" + file.size
        },
        body: file.slice(offset, end)
      });
    } catch (e) {
      throw new Error("Network error during the Google Drive upload of " + file.name + ".");
    }
    if (res.status === 200 || res.status === 201) {
      const done = await res.json();
      if (onProgress) { onProgress(100); }
      return { fileId: done.id };
    }
    if (res.status === 308) {
      const range = res.headers.get("Range");
      const m = range ? range.match(/bytes=0-(\d+)/) : null;
      offset = m ? (Number(m[1]) + 1) : end;
      if (onProgress) { onProgress(Math.round(offset / file.size * 100)); }
      continue;
    }
    throw new Error(await gdriveErrorMessage(res,
      "Google Drive upload failed with status " + res.status));
  }
  throw new Error("Google Drive upload did not complete.");
}

async function googleDownload(fileId) {
  const res = await gdriveFetch(
    "https://www.googleapis.com/drive/v3/files/" +
    encodeURIComponent(fileId) + "?alt=media");
  if (!res.ok) {
    throw new Error(await gdriveErrorMessage(res,
      "Google Drive download failed with status " + res.status));
  }
  return res.blob();
}

async function googleDelete(fileId) {
  const res = await gdriveFetch(
    "https://www.googleapis.com/drive/v3/files/" +
    encodeURIComponent(fileId), { method: "DELETE" });
  if (res.status === 204 || res.status === 404) { return; }
  if (!res.ok) {
    throw new Error(await gdriveErrorMessage(res,
      "Google Drive delete failed with status " + res.status));
  }
}

/* v2.66: move one Drive file into the owner's Drive
   trash instead of deleting it outright: a metadata
   update that sets trashed, the Drive API's own
   recoverable removal. The file keeps its id but
   leaves every listing (this app's listings all ask
   for trashed = false, the orphan scan's included),
   and the owner can restore it, or delete it for
   good, from Drive's own trash. A 404 answers the
   way googleDelete's does: the file is already gone,
   which is the state the caller wants, so it counts
   as success. Every other failure throws, so the
   callers' failure handling is unchanged. Attachment
   deletions route here (see the provider registry);
   note files never do: they keep the permanent
   delete through the store. */
async function googleTrash(fileId) {
  const res = await gdriveFetch(
    "https://www.googleapis.com/drive/v3/files/" +
    encodeURIComponent(fileId) + "?fields=id,trashed", {
      method: "PATCH",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ trashed: true })
    });
  if (res.status === 404) { return; }
  if (!res.ok) {
    throw new Error(await gdriveErrorMessage(res,
      "Google Drive trash failed with status " + res.status));
  }
}

/* v2.11: rename one Drive file through its metadata. The name set
   here is the file's storage name (the attId__name form uploads
   create), so a rename from the image menu keeps the Drive file's
   name in step with the record's storageName. */
async function googleRename(fileId, newName) {
  await gdriveJson(
    "https://www.googleapis.com/drive/v3/files/" +
    encodeURIComponent(fileId) + "?fields=id,name", {
      method: "PATCH",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ name: newName })
    });
}

/* ----- Google Drive NOTES driver (new in v1.4) ---------------------------
   This driver implements the neutral store operations from section 6
   on Google Drive. The layout:

     SnakeScale Notes/
       index.json
       notebooks/<slug>/<noteId>.md
       notebooks/<slug>/.gitkeep
       trash/<noteId>.md
       archive/<noteId>.md
       attachments/<attachment files>

   Attachments live in an attachments subfolder of this same root
   folder (see googleEnsureAttachmentsFolder above). Every file and
   folder here is created by this app, so the drive.file scope can
   see the whole tree. All calls use getGoogleAccessToken through
   gdriveFetch and gdriveJson: the notes driver and the attachments
   driver share one Google sign in and one encrypted token.

   Drive has real folders, not just paths. The one semantic gap is
   that an empty Drive folder continues to exist after its last file
   is deleted, where a purely path based store would lose the folder
   with the file. driveStoreDeleteFile
   closes that gap for notebook folders by removing a notebook folder
   once it is empty, which keeps folder listings equivalent.
   -------------------------------------------------------------------------- */
const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
const driveCache = {
  rootId: null,
  rootCreated: false,
  folderIds: Object.create(null),
  fileIds: Object.create(null)
};

/* Forget every resolved Drive ID. Called on Google sign in and sign out,
   so a different Google account in the same browser session can never be
   handed folder IDs from the previous account. */
function resetDriveNotesCache() {
  driveCache.rootId = null;
  driveCache.rootCreated = false;
  driveCache.folderIds = Object.create(null);
  driveCache.fileIds = Object.create(null);
}

/* Escape one value for a Drive query string. Drive query strings are
   single quoted; backslashes and quotes inside names must be escaped. */
function driveEscapeQueryValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/* The optimistic concurrency token for one Drive file. The head revision
   is preferred because it changes exactly when the file content changes.
   Files that do not expose one fall back to their modified time. */
function driveTokenFromMetadata(meta) {
  if (!meta) { return null; }
  if (meta.headRevisionId) { return "rev:" + meta.headRevisionId; }
  if (meta.modifiedTime) { return "mtime:" + meta.modifiedTime; }
  return meta.id ? "id:" + meta.id : null;
}

/* The Drive conflict decision, kept pure and separate so it can be unit
   tested: a null expected token means the caller is creating or does not
   claim to know the current revision, so the write may proceed. Any
   other mismatch means the file changed first and must not be touched. */
function assertDriveToken(expectedToken, currentToken, path) {
  if (expectedToken != null && expectedToken !== currentToken) {
    throw new StoreConflict(path);
  }
}

async function driveGetFileMeta(fileId) {
  return gdriveJson(
    "https://www.googleapis.com/drive/v3/files/" +
    encodeURIComponent(fileId) +
    "?fields=" + encodeURIComponent("id,name,mimeType,headRevisionId,modifiedTime,trashed"));
}

/* List every child of one Drive folder, following pagination. */
async function driveListChildren(parentId) {
  const all = [];
  let pageToken = "";
  do {
    const q = "'" + parentId + "' in parents and trashed = false";
    let url = "https://www.googleapis.com/drive/v3/files?q=" +
      encodeURIComponent(q) + "&fields=" + encodeURIComponent(
        "nextPageToken,files(id,name,mimeType,size,headRevisionId,modifiedTime,trashed)") +
      "&pageSize=1000";
    if (pageToken) { url += "&pageToken=" + encodeURIComponent(pageToken); }
    const data = await gdriveJson(url);
    (data.files || []).forEach(function (f) { all.push(f); });
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return all;
}

async function driveFindChild(parentId, name, wantFolder) {
  const children = await driveListChildren(parentId);
  return children.find(function (child) {
    return child.name === name &&
      ((child.mimeType === DRIVE_FOLDER_MIME) === !!wantFolder);
  }) || null;
}

async function driveCreateFolder(name, parentId) {
  const body = { name: name, mimeType: DRIVE_FOLDER_MIME };
  if (parentId) { body.parents = [parentId]; }
  return gdriveJson("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

/* Find or create the SnakeScale Notes root folder. rootCreated records
   whether THIS call created it. Before v1.4.3 the connect flow used it
   as the first run seeding signal; seeding is now decided from the
   store contents in connectGoogleAndLoad, and rootCreated remains only
   as a record of how the root was found on this visit. */
async function driveEnsureNotesRoot() {
  if (driveCache.rootId) {
    try {
      const info = await driveGetFileMeta(driveCache.rootId);
      if (info && !info.trashed && info.mimeType === DRIVE_FOLDER_MIME) {
        return info.id;
      }
    } catch (err) {
      if (err.needsGoogleReconnect || err.offline) { throw err; }
      /* A deleted or unreadable cached root falls through to a fresh
         lookup instead of failing the whole connect. */
    }
    driveCache.rootId = null;
    driveCache.rootCreated = false;
  }
  const q = "name = '" + driveEscapeQueryValue(NOTES_ROOT_NAME) +
    "' and mimeType = '" + DRIVE_FOLDER_MIME +
    "' and 'root' in parents and trashed = false";
  const data = await gdriveJson(
    "https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent(q) +
    "&fields=" + encodeURIComponent("files(id,name,mimeType,trashed)"));
  if (data.files && data.files.length) {
    driveCache.rootId = data.files[0].id;
    driveCache.rootCreated = false;
    return driveCache.rootId;
  }
  const created = await driveCreateFolder(NOTES_ROOT_NAME, null);
  driveCache.rootId = created.id;
  driveCache.rootCreated = true;
  return created.id;
}

/* Resolve a store folder path to a Drive folder ID, creating each missing
   folder when create is true. Returns null for a missing folder when
   create is false. */
async function driveResolveFolder(path, create) {
  if (!path) { return driveEnsureNotesRoot(); }
  if (driveCache.folderIds[path]) { return driveCache.folderIds[path]; }
  let currentId = await driveEnsureNotesRoot();
  let currentPath = "";
  const segments = splitStorePath(path);
  for (const segment of segments) {
    currentPath = currentPath ? currentPath + "/" + segment : segment;
    if (driveCache.folderIds[currentPath]) {
      currentId = driveCache.folderIds[currentPath];
      continue;
    }
    let child = await driveFindChild(currentId, segment, true);
    if (!child) {
      if (!create) { return null; }
      child = await driveCreateFolder(segment, currentId);
    }
    driveCache.folderIds[currentPath] = child.id;
    currentId = child.id;
  }
  return currentId;
}

async function driveResolveFileMeta(path, createParents) {
  const segments = splitStorePath(path);
  if (!segments.length) { return null; }
  const parentPath = segments.slice(0, -1).join("/");
  const parentId = await driveResolveFolder(parentPath, createParents);
  if (!parentId) { return null; }
  const meta = await driveFindChild(parentId, segments[segments.length - 1], false);
  if (meta) { driveCache.fileIds[path] = meta.id; }
  return meta;
}

async function driveStoreGetFile(path) {
  const meta = await driveResolveFileMeta(path, false);
  if (!meta) { return null; }
  const res = await gdriveFetch(
    "https://www.googleapis.com/drive/v3/files/" +
    encodeURIComponent(meta.id) + "?alt=media");
  if (res.status === 404) { return null; }
  if (!res.ok) {
    throw new Error(await gdriveErrorMessage(res,
      "Google Drive read failed with status " + res.status));
  }
  const text = await res.text();
  return { text: text, token: driveTokenFromMetadata(meta) };
}

async function driveStoreListDir(path) {
  const folderId = await driveResolveFolder(path, false);
  if (!folderId) { return null; }
  const children = await driveListChildren(folderId);
  return children.map(function (child) {
    return {
      name: child.name,
      path: path ? path + "/" + child.name : child.name,
      isDir: child.mimeType === DRIVE_FOLDER_MIME,
      /* v2.20: the listing already fetched this metadata (it is
         what driveTokenFromMetadata reads); carrying it lets the
         loader reconcile the catalog against the store's shape
         without a single extra call. Folders carry neither. */
      fileId: child.mimeType === DRIVE_FOLDER_MIME ? null : child.id,
      token: child.mimeType === DRIVE_FOLDER_MIME
        ? null : driveTokenFromMetadata(child)
    };
  });
}

async function driveStorePutFile(path, text, expectedToken, options) {
  options = options || {};
  const segments = splitStorePath(path);
  if (!segments.length) {
    throw new Error("Cannot write a file without a file name.");
  }
  const fileName = segments[segments.length - 1];
  const parentPath = segments.slice(0, -1).join("/");
  const parentId = await driveResolveFolder(parentPath, true);
  /* v1.4.4: a fresh put is the caller promising this file does not
     exist yet (a brand new note, a new notebook marker, a seed file)
     and holding no concurrency token for it. That promise lets this
     driver skip the existence check listing, one full Drive round
     trip, and go straight to the create below. The shortcut is taken
     ONLY when the flag is set AND no expected token is held; any
     caller holding a token, and every rename or move, keeps the
     checked path, so the conflict rule is untouched. */
  const existing = (options.fresh && expectedToken == null)
    ? null
    : await driveFindChild(parentId, fileName, false);

  if (existing) {
    /* Optimistic concurrency, the Drive half of the conflict rule: the
       expected token must still be the file's current token, checked
       before a single byte is sent. */
    const currentToken = driveTokenFromMetadata(existing);
    assertDriveToken(expectedToken || null, currentToken, path);
    const res = await gdriveFetch(
      "https://www.googleapis.com/upload/drive/v3/files/" +
      encodeURIComponent(existing.id) +
      "?uploadType=media&fields=" +
      encodeURIComponent("id,headRevisionId,modifiedTime"), {
        method: "PATCH",
        headers: { "Content-Type": "text/markdown; charset=UTF-8" },
        body: String(text)
      });
    if (!res.ok) {
      throw new Error(await gdriveErrorMessage(res,
        "Google Drive write failed with status " + res.status));
    }
    const data = await res.json();
    driveCache.fileIds[path] = existing.id;
    return driveTokenFromMetadata(data) ||
      driveTokenFromMetadata(await driveGetFileMeta(existing.id)) ||
      currentToken;
  }

  /* A caller holding a token for a file that no longer exists is in the
     same position as a caller holding a stale token: refuse, rather
     than silently recreating over someone else's delete. */
  if (expectedToken != null) { throw new StoreConflict(path); }

  /* Create with one multipart request: JSON metadata plus the text body.
     Note files are small Markdown documents, far below Drive's 5 MB
     simple and multipart upload limit. */
  const boundary = "snakescale-" + Date.now().toString(36) + "-" +
    Math.random().toString(36).slice(2);
  const metadata = JSON.stringify({
    name: fileName,
    parents: [parentId],
    mimeType: "text/markdown"
  });
  const body = "--" + boundary + "\r\n" +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    metadata + "\r\n" +
    "--" + boundary + "\r\n" +
    "Content-Type: text/markdown; charset=UTF-8\r\n\r\n" +
    String(text) + "\r\n" +
    "--" + boundary + "--";
  const res = await gdriveFetch(
    "https://www.googleapis.com/upload/drive/v3/files" +
    "?uploadType=multipart&fields=" +
    encodeURIComponent("id,headRevisionId,modifiedTime"), {
      method: "POST",
      headers: { "Content-Type": "multipart/related; boundary=" + boundary },
      body: body
    });
  if (!res.ok) {
    throw new Error(await gdriveErrorMessage(res,
      "Google Drive create failed with status " + res.status));
  }
  const data = await res.json();
  driveCache.fileIds[path] = data.id;
  return driveTokenFromMetadata(data) ||
    driveTokenFromMetadata(await driveGetFileMeta(data.id));
}

async function driveStoreDeleteFile(path, token) {
  const meta = await driveResolveFileMeta(path, false);
  if (!meta) { return; }
  assertDriveToken(token || null, driveTokenFromMetadata(meta), path);
  const res = await gdriveFetch(
    "https://www.googleapis.com/drive/v3/files/" +
    encodeURIComponent(meta.id), { method: "DELETE" });
  if (res.status !== 204 && res.status !== 404 && !res.ok) {
    throw new Error(await gdriveErrorMessage(res,
      "Google Drive delete failed with status " + res.status));
  }
  delete driveCache.fileIds[path];

  /* Close the real folder gap described at the top of this driver: when
     a notebook folder under notebooks/ becomes empty, remove the folder
     itself, the way a purely path based store would lose it. The index
     still names the notebook, so an intentionally empty notebook keeps
     working; this only stops deleted or renamed folders reappearing in
     folder listings. */
  const segments = splitStorePath(path);
  if (segments.length >= 3 && segments[0] === "notebooks") {
    const parentPath = segments.slice(0, 2).join("/");
    const parentId = driveCache.folderIds[parentPath];
    if (parentId) {
      const remaining = await driveListChildren(parentId);
      if (!remaining.length) {
        const del = await gdriveFetch(
          "https://www.googleapis.com/drive/v3/files/" +
          encodeURIComponent(parentId), { method: "DELETE" });
        if (del.ok || del.status === 204 || del.status === 404) {
          delete driveCache.folderIds[parentPath];
        }
      }
    }
  }
}
/* --------------------------------------------------------------------------
   v2.121: Doc-backed notes (Stage 3 of the Google Docs conversion)

   A note whose catalog entry marks it backend "doc" keeps its
   content in an individual Google Doc in the store instead of
   in a note file: notebooks and tags stay in the app catalog,
   editing happens in this app's own editor with its own
   toolbar, and saving writes the edited content back into
   that same Doc. This section is the whole transport and
   conversion layer for that shape; the routing that calls it
   lives with the note load and save machinery in tasks.js,
   and the catalog plumbing with the catalog writer in
   sync.js and the shell builder in tasks.js.

   Transport: everything rides the Drive driver above (the
   app's own Google token from getGoogleAccessToken, through
   gdriveFetch). A Doc is created with a Drive files create
   carrying the document mime type, its content is read with
   a Drive export to HTML, and it is written with a Drive
   upload of HTML that Google converts, the same conversion
   family the coordinator's own Period C test proved reads
   right. The auth Worker v6 adds the documents scope for
   this stage; any 403 from a Doc call is read the way the
   calendar and mail modules read theirs, as a consent the
   stored sign in does not carry yet, and lands in the
   module's needs-consent status (see docNotesSetStatus),
   which the open and save paths surface as a plain failure
   with the note left untouched, never as an app error.
   -------------------------------------------------------------------------- */

const DOC_FILE_MIME = "application/vnd.google-apps.document";

/* The module's status word, on the calendar and mail
   pattern: "idle" before any Doc call, "ok" after one
   succeeds, "needs-consent" after a 403, "unavailable"
   after a network or unexpected failure. The note paths
   read it through docNotesNeedsConsent(); the status
   itself is kept for the report and for tests. */
let docNotesStatus = "idle";

function docNotesSetStatus(next) {
  const prev = docNotesStatus;
  docNotesStatus = next;
  if (next === "needs-consent" && prev !== "needs-consent") {
    /* One plain toast on the transition, so the state is
       visible without a surface of its own: the notebook
       is never broken by it, the note simply will not
       open or save until the permission is granted. */
    toast("Doc-backed notes need a Google permission this" +
      " sign in does not have yet. They will work after" +
      " the sign in update is deployed and you use" +
      " Refresh connection in Settings.");
  }
}

function docNotesNeedsConsent() {
  return docNotesStatus === "needs-consent";
}

/* Sign out clears the status with the other runtime
   state; resetDocNotesState is called from
   resetCatalogRuntimeState in tasks.js. */
function resetDocNotesState() {
  docNotesStatus = "idle";
}

/* An Error carrying the HTTP status a Doc call met, and
   the needs-consent flag when that status was a 403, so
   callers can tell a permission state apart from a plain
   failure without parsing the message. */
function docHttpError(status, message) {
  const err = new Error(message);
  err.docHttpStatus = status || 0;
  if (status === 403) { err.docNeedsConsent = true; }
  return err;
}

function isDocNeedsConsentError(err) {
  return !!err && err.docNeedsConsent === true;
}

/* One Doc API fetch on the calendar pattern: gdriveFetch
   supplies the token and its one silent renewal; a 403
   becomes the module's needs-consent state and a consent
   error; any other non-ok response becomes an error
   carrying the status and Google's own message when it
   sent one. */
async function docApiFetch(url, options) {
  const res = await gdriveFetch(url, options);
  if (res.status === 403) {
    docNotesSetStatus("needs-consent");
    throw docHttpError(403,
      "Google refused this Doc request: Doc-backed notes" +
      " need a permission this sign in does not have yet.");
  }
  if (!res.ok) {
    if (docNotesStatus === "idle" ||
        docNotesStatus === "ok") {
      docNotesSetStatus("unavailable");
    }
    throw docHttpError(res.status,
      await gdriveErrorMessage(res,
        "Google Doc request failed with status " +
        res.status));
  }
  /* A success is the latest word on the module's state:
     when the permission lands (the sign in update
     deployed, the connection refreshed), the next good
     call clears the needs-consent state it replaces. */
  docNotesSetStatus("ok");
  return res;
}

async function docApiJson(url, options) {
  const res = await docApiFetch(url, options);
  if (res.status === 204) { return null; }
  return res.json();
}

/* Create the Google Doc backing a new Doc-backed note, in
   the notebook's own store folder (the folder every note
   file of that notebook lives in; folder listings only
   ever read note files, so the Doc resting there is never
   mistaken for one). Returns the new Doc's file id. */
async function docCreateDocument(note) {
  const folderId = await driveResolveFolder(
    "notebooks/" + note.notebook, true);
  const created = await docApiJson(
    "https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: note.title || "Untitled note",
        mimeType: DOC_FILE_MIME,
        parents: folderId ? [folderId] : []
      })
    });
  if (!created || typeof created.id !== "string" ||
      !created.id) {
    throw docHttpError(0,
      "Google did not return the new Doc's id.");
  }
  return { id: created.id };
}

/* Fetch a Doc's content: its metadata first (which also
   proves the file is still the Doc this note points at),
   then an export to HTML. Returns the export HTML, the
   Doc's file name as the store knows it (kept on the note
   so a later title edit can rename the Doc on save), and
   the revision token the load should hold, the same
   driveTokenFromMetadata the file driver uses. */
async function docFetchDocument(docId) {
  const meta = await docApiJson(
    "https://www.googleapis.com/drive/v3/files/" +
    encodeURIComponent(docId) +
    "?fields=" + encodeURIComponent(
      "id,name,mimeType,headRevisionId,modifiedTime,trashed"));
  if (!meta || meta.trashed === true ||
      meta.mimeType !== DOC_FILE_MIME) {
    throw docHttpError(404,
      "That note's Google Doc could not be found.");
  }
  const res = await docApiFetch(
    "https://www.googleapis.com/drive/v3/files/" +
    encodeURIComponent(docId) +
    "/export?mimeType=" + encodeURIComponent("text/html"));
  const html = await res.text();
  return {
    html: html,
    name: typeof meta.name === "string" ? meta.name : "",
    token: driveTokenFromMetadata(meta)
  };
}

/* Write a Doc-backed note's content back into its own
   Doc: an upload of the upload HTML (built by
   docBuildUploadHtml) that Google converts, addressed to
   the note's existing Doc id, so a save never creates a
   second Doc. A title that changed since the Doc was
   fetched is carried onto the Doc's file name with a
   small metadata update after the content lands; that
   rename is best effort, because the content save is the
   save. Returns the Doc's new revision token. */
async function docSaveDocument(note, uploadHtml) {
  const docId = sanitizeDocId(note.docId);
  if (!docId) {
    throw docHttpError(0,
      "This Doc-backed note has no Google Doc to save to.");
  }
  const res = await docApiFetch(
    "https://www.googleapis.com/upload/drive/v3/files/" +
    encodeURIComponent(docId) +
    "?uploadType=media&fields=" + encodeURIComponent(
      "id,headRevisionId,modifiedTime"), {
      method: "PATCH",
      headers: { "Content-Type": "text/html; charset=UTF-8" },
      body: uploadHtml
    });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  let token = driveTokenFromMetadata(data);
  if (typeof note.docName === "string" && note.title &&
      note.docName !== note.title) {
    try {
      await docApiJson(
        "https://www.googleapis.com/drive/v3/files/" +
        encodeURIComponent(docId), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: note.title })
        });
      note.docName = note.title;
    } catch (e) { /* the content save stands */ }
  }
  if (!token) {
    try {
      const meta = await docApiJson(
        "https://www.googleapis.com/drive/v3/files/" +
        encodeURIComponent(docId) +
        "?fields=" + encodeURIComponent(
          "id,headRevisionId,modifiedTime"));
      token = driveTokenFromMetadata(meta);
    } catch (e) { token = null; }
  }
  return { token: token };
}

/* ----- export HTML to editor body ------------------------------
   A Google Docs export expresses nearly all formatting as
   classes whose declarations live in the export's own style
   element (a span of class c3 is bold because the export
   says .c3 carries font-weight 700), so a faithful read
   resolves those classes back into the emphasis the editor
   itself carries. The converter below is the sanitizer for
   this route, in place of the web clip sanitizer (which
   strips style attributes and knows nothing of classes,
   and would flatten a Doc's formatting to plain text): it
   emits only the editor's own vocabulary (paragraphs,
   headings, lists and checklists, tables, block quotes,
   links, emphasis, text and highlight colors, and image
   tokens the adoption pass below turns into real image
   figures), and nothing scriptable can survive it, because
   no element, attribute, or address is ever copied across
   without being judged here first. */

/* One style declaration block ("font-weight:700;color:#111")
   as a plain map of property to value. */
function docParseStyleDecls(text) {
  const out = {};
  String(text || "").split(";").forEach(function (decl) {
    const i = decl.indexOf(":");
    if (i < 0) { return; }
    out[decl.slice(0, i).trim().toLowerCase()] =
      decl.slice(i + 1).trim();
  });
  return out;
}

/* A color as the editor writes one (lowercase six digit
   hex), or null when the value is not a plain color the
   app can carry. Handles the hex and rgb forms a Google
   export uses. */
function docNormalizeColor(value) {
  if (!value) { return null; }
  const v = String(value).trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) { return v; }
  if (/^#[0-9a-f]{3}$/.test(v)) {
    return "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
  }
  const rgb = v.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) {
    const hex = function (n) {
      const s = Math.min(255, Number(n)).toString(16);
      return s.length < 2 ? "0" + s : s;
    };
    return "#" + hex(rgb[1]) + hex(rgb[2]) + hex(rgb[3]);
  }
  return null;
}

/* The emphasis one declaration map asks for, as the flat
   record the converter threads down the tree. Default
   black text and paper white (or transparent) backgrounds
   carry no emphasis, matching how the editor leaves
   uncolored text bare. */
function docEmphasisFromDecls(decls) {
  const e = { b: false, i: false, u: false, s: false,
    color: null, bg: null };
  if (!decls) { return e; }
  const w = String(decls["font-weight"] || "").toLowerCase();
  if (w === "bold" || w === "bolder" ||
      (parseInt(w, 10) || 0) >= 600) { e.b = true; }
  const fs = String(decls["font-style"] || "").toLowerCase();
  if (fs === "italic" || fs === "oblique") { e.i = true; }
  const td = String(decls["text-decoration"] || "") + " " +
    String(decls["text-decoration-line"] || "");
  if (td.indexOf("underline") >= 0) { e.u = true; }
  if (td.indexOf("line-through") >= 0) { e.s = true; }
  const color = docNormalizeColor(decls["color"]);
  if (color && color !== "#000000") { e.color = color; }
  const bg = docNormalizeColor(decls["background-color"]);
  if (bg && bg !== "#ffffff") { e.bg = bg; }
  return e;
}

/* Merge a child's own emphasis over its parent's: flags
   accumulate, colors are the child's when it sets one. */
function docMergeEmphasis(parent, own) {
  return {
    b: parent.b || own.b,
    i: parent.i || own.i,
    u: parent.u || own.u,
    s: parent.s || own.s,
    color: own.color || parent.color,
    bg: own.bg || parent.bg
  };
}

/* The emphasis one element asks for: its tag first
   (b, strong, i, em, u, s), then each of its classes as
   the export's style element defines them, then its own
   inline style, which wins where both speak. */
function docElementEmphasis(el, classStyles) {
  let e = { b: false, i: false, u: false, s: false,
    color: null, bg: null };
  const tag = el.tagName;
  if (tag === "B" || tag === "STRONG") { e.b = true; }
  if (tag === "I" || tag === "EM") { e.i = true; }
  if (tag === "U") { e.u = true; }
  if (tag === "S" || tag === "STRIKE" || tag === "DEL") {
    e.s = true;
  }
  const classes = (el.getAttribute &&
    el.getAttribute("class")) || "";
  classes.split(/\s+/).forEach(function (cls) {
    if (cls && classStyles[cls]) {
      e = docMergeEmphasis(e,
        docEmphasisFromDecls(classStyles[cls]));
    }
  });
  const inline = el.getAttribute &&
    el.getAttribute("style");
  if (inline) {
    e = docMergeEmphasis(e,
      docEmphasisFromDecls(docParseStyleDecls(inline)));
  }
  return e;
}

/* The class to declarations map of one export document,
   read from its style elements. Only simple class rules
   are read; pseudo rules (list markers, link hovers) hold
   nothing the editor carries. */
function docExportClassStyles(doc) {
  const map = Object.create(null);
  let css = "";
  doc.querySelectorAll("style").forEach(function (s) {
    css += (s.textContent || "") + "\n";
  });
  const ruleRe = /\.([A-Za-z0-9_-]+)\s*\{([^}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(css)) !== null) {
    map[m[1]] = docParseStyleDecls(m[2]);
  }
  return map;
}

/* Render one text leaf under an emphasis: bare when the
   emphasis is empty, else wrapped in the editor's own
   emphasis elements, with a styled span for a color or a
   highlight. */
function docRenderText(text, emph) {
  let out = escapeHtml(text);
  if (!out) { return ""; }
  if (emph.color || emph.bg) {
    let style = "";
    if (emph.color) { style += "color: " + emph.color + ";"; }
    if (emph.bg) {
      style += "background-color: " + emph.bg + ";";
    }
    out = "<span style=\"" + style + "\">" + out + "</span>";
  }
  if (emph.s) { out = "<s>" + out + "</s>"; }
  if (emph.u) { out = "<u>" + out + "</u>"; }
  if (emph.i) { out = "<i>" + out + "</i>"; }
  if (emph.b) { out = "<b>" + out + "</b>"; }
  return out;
}

/* Whether an address may cross into the editor as a
   link: the same scheme judgment the external image gate
   makes (http, https, mailto), plus the app's own note
   links. */
function docSafeLinkHref(href) {
  if (typeof href !== "string" || !href) { return null; }
  if (/^https?:\/\//i.test(href) ||
      /^mailto:/i.test(href) ||
      /^ssnote:/i.test(href)) {
    return href;
  }
  return null;
}

const DOC_BLOCK_TAGS = {
  P: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1,
  UL: 1, OL: 1, TABLE: 1, BLOCKQUOTE: 1, HR: 1, PRE: 1,
  DIV: 1, SECTION: 1, ARTICLE: 1, HEADER: 1, FOOTER: 1,
  FIGURE: 1, FIGCAPTION: 1
};

/* The block alignment an element asks for (its own inline
   style, then its classes), kept only for the values the
   editor's alignment carries. */
function docBlockAlignStyle(el, classStyles) {
  let align = null;
  const inline = el.getAttribute &&
    el.getAttribute("style");
  if (inline) {
    align = docParseStyleDecls(inline)["text-align"] || null;
  }
  if (!align) {
    const classes = (el.getAttribute &&
      el.getAttribute("class")) || "";
    classes.split(/\s+/).forEach(function (cls) {
      if (!align && cls && classStyles[cls]) {
        align = classStyles[cls]["text-align"] || null;
      }
    });
  }
  align = String(align || "").toLowerCase();
  if (align === "center" || align === "right" ||
      align === "justify") {
    return " style=\"text-align: " + align + ";\"";
  }
  return "";
}

/* Inline rendering: the children of one element under an
   emphasis, recursively. Text leaves carry the emphasis;
   elements merge their own over it and recurse; a link
   wraps its rendered children when its address is one the
   editor may carry; an image becomes a token the adoption
   pass replaces; a block element met inside an inline
   context is flattened to its inline content, so no block
   markup is ever nested where the editor forbids it. */
function docConvertInlineChildren(el, emph, ctx) {
  let out = "";
  el.childNodes.forEach(function (child) {
    out += docConvertInlineNode(child, emph, ctx);
  });
  return out;
}

function docConvertInlineNode(node, emph, ctx) {
  if (node.nodeType === 3) {
    return docRenderText(node.nodeValue, emph);
  }
  if (node.nodeType !== 1) { return ""; }
  const tag = node.tagName;
  if (tag === "BR") { return "<br>"; }
  if (tag === "IMG") {
    const idx = ctx.images.length;
    ctx.images.push({
      src: node.getAttribute("src") || "",
      alt: node.getAttribute("alt") || ""
    });
    return "<span data-doc-img=\"" + idx + "\"></span>";
  }
  if (tag === "SCRIPT" || tag === "STYLE" ||
      tag === "HEAD" || tag === "TITLE" ||
      tag === "META" || tag === "LINK") {
    return "";
  }
  const own = docMergeEmphasis(emph,
    docElementEmphasis(node, ctx.classStyles));
  if (tag === "A") {
    const href = docSafeLinkHref(node.getAttribute("href"));
    const inner = docConvertInlineChildren(node, own, ctx);
    if (!href) { return inner; }
    return "<a href=\"" + escapeHtml(href) + "\">" +
      inner + "</a>";
  }
  if (DOC_BLOCK_TAGS[tag] || tag === "LI" ||
      tag === "TR" || tag === "TD" || tag === "TH") {
    /* A block inside an inline context: its own content,
       flattened, with the lists and tables that can
       legitimately nest (inside a list item or a cell the
       block converter itself does the calling, so this
       path is only the stray case). */
    return docConvertInlineChildren(node, own, ctx);
  }
  return docConvertInlineChildren(node, own, ctx);
}

/* Block flow: the children of a block container (the
   export body, a div, a quote, a cell), where runs of
   inline content gather into paragraphs and block
   elements convert one by one. */
function docConvertBlocks(el, emph, ctx) {
  let html = "";
  let inlineBuf = "";
  const flush = function () {
    const textOnly = inlineBuf.replace(/<[^>]*>/g, "")
      .replace(/&[a-z]+;/g, " ").trim();
    if (inlineBuf.indexOf("data-doc-img") >= 0 ||
        inlineBuf.indexOf("<a ") >= 0 || textOnly) {
      html += "<p>" + inlineBuf + "</p>";
    }
    inlineBuf = "";
  };
  el.childNodes.forEach(function (child) {
    if (child.nodeType === 1 &&
        DOC_BLOCK_TAGS[child.tagName]) {
      flush();
      html += docConvertBlock(child, emph, ctx);
    } else {
      inlineBuf += docConvertInlineNode(child, emph, ctx);
    }
  });
  flush();
  return html;
}

/* One block element to the editor's vocabulary. */
function docConvertBlock(el, emph, ctx) {
  const tag = el.tagName;
  const own = docMergeEmphasis(emph,
    docElementEmphasis(el, ctx.classStyles));
  if (tag === "HR") { return "<hr>"; }
  if (tag === "PRE") {
    return "<pre>" +
      escapeHtml(el.textContent || "") + "</pre>";
  }
  if (tag === "UL" || tag === "OL") {
    return docConvertList(el, own, ctx);
  }
  if (tag === "TABLE") {
    return docConvertTable(el, own, ctx);
  }
  if (tag === "BLOCKQUOTE") {
    return "<blockquote>" +
      docConvertBlocks(el, own, ctx) + "</blockquote>";
  }
  if (tag === "P" || tag === "H1" || tag === "H2" ||
      tag === "H3" || tag === "H4" || tag === "H5" ||
      tag === "H6") {
    const inner = docConvertInlineChildren(el, own, ctx);
    if (!inner.trim() &&
        inner.indexOf("data-doc-img") < 0) {
      return "";
    }
    return "<" + tag.toLowerCase() +
      docBlockAlignStyle(el, ctx.classStyles) + ">" +
      inner + "</" + tag.toLowerCase() + ">";
  }
  /* DIV and the sectioning containers are transparent:
     their children are the content. A figure holding an
     image reaches the same end through the image token
     its inline child leaves behind. */
  return docConvertBlocks(el, own, ctx);
}

/* Whether one list item begins with a checkbox glyph, and
   its state: the forms a Google checklist takes when the
   glyphs ride in the text itself (a Doc written by an
   import, or a checklist typed with the glyphs). The
   glyph is consumed by the check, never left in the
   text. */
function docLiGlyphState(li) {
  const first = li.firstChild;
  if (!first || first.nodeType !== 3) { return null; }
  const text = first.nodeValue || "";
  const m = text.match(/^\s*(☐|☑|✓|✔)\s?/);
  if (!m) { return null; }
  return { checked: m[1] !== "☐", rest: text.slice(m[0].length) };
}

/* One list: an ordered list stays ordered; a list the
   export marks as a checklist (its class names it), or
   whose every item carries a checkbox glyph, becomes the
   editor's checklist form, the saved shape the checklist
   machinery round trips. A nested list stays inside its
   item, as the editor nests them. */
function docConvertList(listEl, emph, ctx) {
  const ordered = listEl.tagName === "OL";
  const classAttr = (listEl.getAttribute &&
    listEl.getAttribute("class")) || "";
  const items = [];
  listEl.childNodes.forEach(function (child) {
    if (child.nodeType === 1 && child.tagName === "LI") {
      items.push(child);
    }
  });
  let checklist = !ordered &&
    classAttr.indexOf("checklist") >= 0;
  const glyphs = items.map(function (li) {
    return docLiGlyphState(li);
  });
  if (!checklist && !ordered && items.length &&
      glyphs.every(function (g) { return g !== null; })) {
    checklist = true;
  }
  const out = [];
  items.forEach(function (li, i) {
    out.push(docConvertListItem(li, emph, ctx,
      checklist, glyphs[i]));
  });
  if (checklist) {
    return "<ul class=\"ss-checklist\">" + out.join("") +
      "</ul>";
  }
  const tag = ordered ? "ol" : "ul";
  return "<" + tag + ">" + out.join("") + "</" + tag + ">";
}

function docConvertListItem(li, emph, ctx, checklist,
    glyph) {
  const own = docMergeEmphasis(emph,
    docElementEmphasis(li, ctx.classStyles));
  let inner = "";
  li.childNodes.forEach(function (child, idx) {
    if (glyph && idx === 0 && child.nodeType === 3) {
      inner += docRenderText(glyph.rest, own);
      return;
    }
    if (child.nodeType === 1 &&
        (child.tagName === "UL" ||
         child.tagName === "OL")) {
      inner += docConvertList(child,
        docMergeEmphasis(own,
          docElementEmphasis(child, ctx.classStyles)),
        ctx);
      return;
    }
    if (child.nodeType === 1 &&
        DOC_BLOCK_TAGS[child.tagName]) {
      /* A paragraph or other block inside an item flattens
         to its inline content, which is where the editor
         keeps item text. */
      inner += docConvertInlineChildren(child,
        docMergeEmphasis(own,
          docElementEmphasis(child, ctx.classStyles)),
        ctx);
      return;
    }
    inner += docConvertInlineNode(child, own, ctx);
  });
  let box = "";
  if (checklist) {
    box = "<input type=\"checkbox\"" +
      (glyph && glyph.checked ? " checked" : "") + ">";
  }
  return "<li" +
    (checklist && glyph && glyph.checked
      ? " class=\"done\"" : "") + ">" + box + inner +
    "</li>";
}

/* One table: rows keep their section (head, body) when
   the export has one; cells keep their spans and their
   block content, with a single paragraph wrapper shed,
   the shape the app's own tables take. */
function docConvertTable(tableEl, emph, ctx) {
  const own = docMergeEmphasis(emph,
    docElementEmphasis(tableEl, ctx.classStyles));
  let out = "<table>";
  const rowsOf = function (parent) {
    let rows = "";
    parent.childNodes.forEach(function (tr) {
      if (tr.nodeType === 1 && tr.tagName === "TR") {
        rows += docConvertTableRow(tr, own, ctx);
      }
    });
    return rows;
  };
  tableEl.childNodes.forEach(function (child) {
    if (child.nodeType !== 1) { return; }
    if (child.tagName === "THEAD") {
      out += "<thead>" + rowsOf(child) + "</thead>";
    } else if (child.tagName === "TBODY") {
      out += "<tbody>" + rowsOf(child) + "</tbody>";
    } else if (child.tagName === "TFOOT") {
      out += "<tfoot>" + rowsOf(child) + "</tfoot>";
    } else if (child.tagName === "TR") {
      out += docConvertTableRow(child, own, ctx);
    }
  });
  return out + "</table>";
}

function docConvertTableRow(tr, emph, ctx) {
  let out = "<tr>";
  tr.childNodes.forEach(function (cell) {
    if (cell.nodeType !== 1 ||
        (cell.tagName !== "TD" && cell.tagName !== "TH")) {
      return;
    }
    const tag = cell.tagName.toLowerCase();
    let attrs = "";
    const span = function (name) {
      const v = parseInt(cell.getAttribute(name), 10);
      return (v && v > 1) ? v : 0;
    };
    if (span("colspan")) {
      attrs += " colspan=\"" + span("colspan") + "\"";
    }
    if (span("rowspan")) {
      attrs += " rowspan=\"" + span("rowspan") + "\"";
    }
    let inner = docConvertBlocks(cell,
      docMergeEmphasis(emph,
        docElementEmphasis(cell, ctx.classStyles)), ctx);
    const single = inner.match(/^<p>([\s\S]*)<\/p>$/);
    if (single &&
        single[1].indexOf("</p>") < 0 &&
        single[1].indexOf("<table") < 0) {
      inner = single[1];
    }
    out += "<" + tag + attrs + ">" + inner + "</" + tag + ">";
  });
  return out + "</tr>";
}

/* The whole export to an editor body plus the images it
   carried, as tokens in the body and records in the list
   the adoption pass reads. This function is the fetch
   route's sanitizer: its output is built only from the
   vocabulary above. */
function docExportHtmlToBody(exportHtml) {
  const parsed = new DOMParser().parseFromString(
    String(exportHtml || ""), "text/html");
  const ctx = {
    classStyles: docExportClassStyles(parsed),
    images: []
  };
  if (!parsed.body) { return { html: "", images: [] }; }
  const empty = { b: false, i: false, u: false, s: false,
    color: null, bg: null };
  return {
    html: docConvertBlocks(parsed.body, empty, ctx),
    images: ctx.images
  };
}

/* ----- export images become the note's images ------------------
   Images inside the Doc arrive inside the export: inline
   ones as data URIs, linked ones at web addresses. Inline
   ones are adopted as stored attachments, on the drop box
   attachment pattern (the provider driver uploads the
   file, the note gains a record, the body gains the
   canonical figure shell), so the full editor treats them
   exactly like any stored image. A web addressed image
   becomes an external image figure, the v2.120 shape. An
   image that can be neither (an unreadable payload, a
   refused upload, an address the gates reject) becomes
   visible text saying an image stood there: an image is
   never silently dropped. */

/* Session reuse: opening the same Doc again in one session
   (after it changed elsewhere, say) re-exports the same
   image bytes; keyed by the note and a cheap hash of the
   payload, the adoption reuses the record it already made
   instead of uploading a second copy of the same image.
   Across sessions an image is adopted afresh; the earlier
   uploaded copy stays in the attachments folder unlinked,
   the same standing tradeoff the format already accepts
   for superseded attachment files. */
const docAdoptedImageCache = {};

function docDataUriHash(text) {
  let h1 = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h1 ^= text.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
  }
  return text.length + ":" + h1.toString(16);
}

function docDataUriParts(src) {
  const m = String(src || "").match(
    /^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!m) { return null; }
  return {
    mime: (m[1] || "application/octet-stream")
      .toLowerCase(),
    base64: !!m[2],
    data: m[3]
  };
}

async function docAdoptOneImage(note, img) {
  const src = String((img && img.src) || "");
  const label = String((img && img.alt) || "").trim();
  const fallback = "[Image: " + (label || "in the Doc") + "]";
  const parts = docDataUriParts(src);
  if (parts && parts.base64 &&
      parts.mime.indexOf("image/") === 0) {
    const cacheKey = note.id + "|" + docDataUriHash(src);
    const cached = docAdoptedImageCache[cacheKey];
    if (cached) {
      note.attachments.push(cached);
      return "<figure class=\"ss-attachment\"" +
        " data-attachment-id=\"" + cached.id + "\"" +
        " contenteditable=\"false\"></figure>";
    }
    try {
      const bytes = decodeDropboxBase64(parts.data);
      if (!bytes || !bytes.length ||
          bytes.length > DROPBOX_ATT_MAX_BYTES) {
        return fallback;
      }
      const attachCfg = state.attach || {};
      const svc = attachCfg.defaultProvider || "google";
      const driver = providers[svc];
      if (!driver || typeof driver.upload !== "function") {
        return fallback;
      }
      const ext = parts.mime === "image/png" ? ".png"
        : parts.mime === "image/gif" ? ".gif"
        : parts.mime === "image/bmp" ? ".bmp"
        : parts.mime === "image/webp" ? ".webp"
        : ".jpg";
      const attId = newNoteId() + "a";
      const name = (label || "image") +
        (label.toLowerCase().endsWith(ext) ? "" : ext);
      const storageName = attId + "__" +
        sanitizeFileName(name);
      const file = new File([bytes], name,
        { type: parts.mime });
      const uploaded = await driver.upload(file, storageName,
        function () {});
      if (!uploaded || !uploaded.fileId) { return fallback; }
      const record = {
        id: attId, provider: svc, fileId: uploaded.fileId,
        name: name, storageName: storageName,
        mime: parts.mime, size: bytes.length,
        created: new Date().toISOString()
      };
      docAdoptedImageCache[cacheKey] = record;
      note.attachments.push(record);
      return "<figure class=\"ss-attachment\"" +
        " data-attachment-id=\"" + attId + "\"" +
        " contenteditable=\"false\"></figure>";
    } catch (e) {
      return fallback;
    }
  }
  if (/^https?:\/\//i.test(src) && !extImageUrlError(src)) {
    return buildExternalImageFigure(src, label).outerHTML;
  }
  return fallback;
}

/* Replace every image token in a converted body with its
   adopted form, in place, and return the finished body
   string. The note's attachment list is reset first: a
   Doc-backed note's attachments are exactly the images
   its Doc currently carries, adopted by this pass. */
async function docAdoptImages(note, converted) {
  note.attachments = [];
  if (!converted.images.length) { return converted.html; }
  const holder = document.createElement("div");
  holder.innerHTML = converted.html;
  const tokens = holder.querySelectorAll("[data-doc-img]");
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const idx = Number(token.getAttribute("data-doc-img"));
    const img = converted.images[idx];
    token.outerHTML = await docAdoptOneImage(note, img);
  }
  return holder.innerHTML;
}

/* ----- the body load ----------------------------------------------
   Fill a Doc-backed shell from its Doc: fetch, convert,
   adopt its images, and hold the Doc's revision token and
   file name on the note. Title, tags, and notebook stay
   the catalog's, which is where they live for this shape.
   Any failure throws to the caller (ensureNoteBodyLoaded),
   whose standing contract leaves the note a shell. */
async function docLoadNoteBody(note) {
  const docId = sanitizeDocId(note.docId);
  if (!docId) {
    throw docHttpError(0,
      "This note's Google Doc link is missing or damaged," +
      " so its content cannot be loaded.");
  }
  bootCountNoteDownload();
  const fetched = await docFetchDocument(docId);
  const converted = docExportHtmlToBody(fetched.html);
  note.body = await docAdoptImages(note, converted);
  note.sha = fetched.token;
  note.docName = fetched.name;
  /* A chosen card thumbnail names an attachment record;
     a fresh adoption mints fresh records, so a thumbnail
     naming none of them is cleared to the automatic
     choice, the same judgment the file save makes of a
     dangling choice. */
  if (note.thumbnail &&
      !(note.attachments || []).some(function (a) {
        return a && a.id === note.thumbnail;
      })) {
    note.thumbnail = null;
  }
  note.previewText = htmlToText(note.body).slice(0, 140);
}

/* ----- editor body to upload HTML ---------------------------------
   The save payload: the editor's canonical body with its
   image figures hydrated inline, wrapped as a small HTML
   document Google's converter reads. Stored attachment
   images embed as data URIs (inside this payload only;
   the note's own saved form is never a data URI), fetched
   through the provider driver like any attachment
   download. An attachment that is not an image, or whose
   bytes cannot be fetched, crosses as a link to its Drive
   file, so its presence survives in the Doc even when its
   bytes cannot embed. An external image is fetched and
   embedded the same way when the fetch succeeds, and
   crosses at its web address when it does not (Google's
   importer may or may not fetch a remote image; that is
   the named gap for external images). */

function blobToDataUri(blob) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () { resolve(reader.result); };
    reader.onerror = function () {
      reject(reader.error ||
        new Error("Reading an image for the Doc failed."));
    };
    reader.readAsDataURL(blob);
  });
}

/* The width an image figure carries, as a style for the
   payload image, or empty when it carries none. */
function docFigureWidthStyle(el) {
  const m = String(el.getAttribute("style") || "")
    .match(/width:\s*([0-9]+(?:\.[0-9]+)?)px/);
  return m ? " style=\"width: " + m[1] + "px;\"" : "";
}

async function docBuildUploadHtml(note) {
  const holder = document.createElement("div");
  holder.innerHTML = note.body || "";
  const figures = holder.querySelectorAll(
    "figure.ss-attachment, div.ss-attachment");
  for (let i = 0; i < figures.length; i++) {
    const el = figures[i];
    const widthStyle = docFigureWidthStyle(el);
    if (el.hasAttribute("data-ss-ext")) {
      const src = el.getAttribute("data-ss-ext-src") || "";
      const alt = el.getAttribute("data-ss-ext-alt") || "";
      let payloadSrc = src;
      try {
        const fetched = await fetch(src);
        if (fetched && fetched.ok) {
          payloadSrc = await blobToDataUri(
            await fetched.blob());
        }
      } catch (e) { /* the web address crosses instead */ }
      el.outerHTML = "<img src=\"" +
        escapeHtml(String(payloadSrc)) + "\" alt=\"" +
        escapeHtml(alt) + "\"" + widthStyle + ">";
      continue;
    }
    const attId = el.getAttribute("data-attachment-id");
    const record = (note.attachments || []).find(
      function (a) { return a && a.id === attId; });
    if (!record) {
      el.outerHTML = "[Image]";
      continue;
    }
    const driver = providers[record.provider || "google"];
    if (String(record.mime || "")
        .toLowerCase().indexOf("image/") === 0 && driver &&
        typeof driver.download === "function" &&
        record.fileId) {
      try {
        const blob = await driver.download(record.fileId);
        const uri = await blobToDataUri(blob);
        el.outerHTML = "<img src=\"" + uri + "\" alt=\"" +
          escapeHtml(record.name || "image") + "\"" +
          widthStyle + ">";
        continue;
      } catch (e) { /* the Drive link crosses instead */ }
    }
    el.outerHTML = record.fileId
      ? "<a href=\"https://drive.google.com/file/d/" +
        encodeURIComponent(record.fileId) + "/view\">" +
        escapeHtml(record.name || "Attachment") + "</a>"
      : "[Attachment: " +
        escapeHtml(record.name || "file") + "]";
  }
  return "<!DOCTYPE html><html><head>" +
    "<meta charset=\"utf-8\"></head><body>" +
    holder.innerHTML + "</body></html>";
}


/* ----- provider registry ----------------------------------------------
   One consistent internal shape over the attachment services.
   Everything that touches attachments goes through this table,
   never through provider specific code directly. v2.0 has exactly
   one provider, Google Drive. Attachment records written by older
   versions can name a provider that is no longer here (pCloud);
   those lookups return undefined, and every consumer treats a
   missing driver as "that provider is not available", which is
   what renders the graceful not available message on those records
   instead of an error. */
const providers = {
  google: {
    label: "Google Drive",
    getStatus: googleGetStatus,
    connect: workerSignIn,
    disconnect: googleDisconnect,
    upload: googleUpload,
    download: googleDownload,
    delete: googleDelete,
    trash: googleTrash,   /* v2.66 */
    rename: googleRename   /* v2.11 */
  }
};


function providerLabel(name) {
  return providers[name] ? providers[name].label : String(name || "storage provider");
}

/* ----- placeholder hydration -------------------------------------------
   When a note opens, each canonical placeholder in the body is filled
   with live content: the real image for image attachments (through
   the authenticated Google Drive download and a blob URL), or a file
   card for everything else. A record whose provider is not in the
   registry (a pre-v2.0 pCloud record) gets a plain not available
   message instead of content. Hydration writes ONLY into the live
   DOM; the save path canonicalizes placeholders back to empty
   shells, so nothing hydrated is ever persisted. */
function makeAttButton(label, handler) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn small";
  b.textContent = label;
  /* Keep editor focus and caret logic out of attachment controls. */
  b.addEventListener("mousedown", function (ev) { ev.preventDefault(); });
  b.addEventListener("click", function (ev) {
    ev.preventDefault();
    ev.stopPropagation();
    handler();
  });
  return b;
}

/* v1.7: an attachment record counts as an image by its mime type,
   the same test hydration has always used. */
function isImageAttachment(att) {
  return !!att && (att.mime || "").indexOf("image/") === 0;
}

/* v1.7: the ONE decoration pass for attachment placeholders. Every
   placeholder, however it got into the body, ends up with the same
   runtime shape: the shell attributes (contenteditable false, the
   attachment id), the inline image presentation class when its
   record is an image (see the ss-att-image CSS), and the draggable
   flag in live notes. The upload flow calls it when a placeholder is
   born, hydration calls it before filling a block, and rendering
   calls it on a freshly rendered body. Before v1.7 each of those
   moments decorated by hand and they drifted apart: the upload path
   built one shape and hydration another, so a freshly pasted image
   was not the DOM the selection handler expected, and it could not
   be selected, moved, or resized until the note was reopened. The
   saved placeholder is untouched by this: canonicalization still
   rebuilds the plain shell, and this pass reapplies the runtime
   shape from the record every time.
   v1.7.2: for image records the pass also normalizes the chosen
   size onto the block itself (normalizeImageFigureSize), which is
   what makes this the single place every placeholder's sizing is
   settled, however the block was built. */
/* v1.7.2: a plain pixel width: the only form a chosen image size
   ever takes, in a saved note and in the live DOM alike. Anything
   else (a percentage, auto, a calc) is not a chosen size and is
   ignored rather than carried around. Shared by the decoration
   pass below and by canonicalization's width reader. */
function imagePixelWidth(raw) {
  return /^\d+(\.\d+)?px$/.test(raw || "") ? raw : "";
}

/* v1.7.2: normalize one image block's size onto the block itself.
   The block (the figure) is where a chosen size lives; the <img>
   inside is width:100% of the block by CSS, so it always fills the
   block exactly and the selection frame anchored to the block is
   always the image's real frame. Three cases:
     - The block already carries a pixel width (the saved form
       since v1.6): that IS the size. Any width still sitting on
       the <img> is a stale leftover and is removed.
     - The block carries no width but the <img> does: that is a
       live DOM built by v1.6 or v1.7 (their resize wrote to the
       image; it happens when a block is restored from captured
       HTML, for one). The width migrates onto the block and comes
       off the image, so the note saves forward in the new form.
     - Neither carries a width: the block is unsized and keeps the
       stylesheet's fit-content, column capped presentation.
   A sized block also gets an inline max-width of none: the
   stylesheet caps image blocks at the column width, and a chosen
   size, narrower or wider than the column, must not be capped.
   The override is applied here at runtime, like the ss-att-image
   class, so stored notes need no other change. */
function normalizeImageFigureSize(el) {
  const img = el.querySelector("img.ss-att-img");
  let width = imagePixelWidth(el.style ? el.style.width : "");
  if (!width && img && img.style) {
    width = imagePixelWidth(img.style.width);
    if (width) { el.style.width = width; }
  }
  if (img && img.style) { img.style.removeProperty("width"); }
  if (width) { el.style.maxWidth = "none"; }
}

/* v1.7.2: give an image block a chosen size, in pixels: the width
   lands on the block, and the block's inline max-width is lifted
   so the stylesheet's column cap cannot fight the choice. Grip
   drags land here (through v2.11 the menu's size presets did too),
   so there is exactly one way a size is ever applied. */
function applyImageFigureWidth(el, px) {
  el.style.width = Math.round(px) + "px";
  el.style.maxWidth = "none";
}

function decorateAttachmentPlaceholder(note, el, att) {
  if (!el) { return; }
  el.setAttribute("contenteditable", "false");
  if (isExternalImageFigure(el)) {
    /* v2.120: an external image block decorates like
       an image attachment (the inline image class, its
       size normalized onto the block, the draggable
       flag in live notes) but never takes an attachment
       id: it has no record, and the id is what would
       route it into the record keyed machinery. */
    el.classList.add("ss-att-image");
    normalizeImageFigureSize(el);
    if (note && !note.trashed && !note.archived) {
      el.setAttribute("draggable", "true");
    } else {
      el.removeAttribute("draggable");
    }
    return;
  }
  if (att && att.id) { el.setAttribute("data-attachment-id", att.id); }
  if (isImageAttachment(att)) {
    el.classList.add("ss-att-image");
    /* v1.7.2: the block carries the image's size; normalize
       wherever a previous version left it (see above). */
    normalizeImageFigureSize(el);
  }
  else { el.classList.remove("ss-att-image"); }
  if (note && !note.trashed && !note.archived) {
    el.setAttribute("draggable", "true");
  } else {
    el.removeAttribute("draggable");
  }
}

async function hydrateAttachments(note) {
  const bodyEl = document.getElementById("noteBody");
  if (!bodyEl || renderEditor._forId !== note.id) { return; }
  const holders = bodyEl.querySelectorAll(".ss-attachment");
  for (const el of holders) {
    /* The user may switch notes mid hydration; stop quietly. */
    if (renderEditor._forId !== note.id) { return; }
    await hydrateOneAttachment(note, el);
  }
}

/* v2.11: the Title view face's image icon, in the same inline SVG
   style as the menu icons. */
const IMAGE_FACE_ICON = "<svg viewBox=\"0 0 24 24\" width=\"16\" height=\"16\" " +
  "fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" " +
  "stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">" +
  "<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/>" +
  "<circle cx=\"9\" cy=\"9\" r=\"2\"/><path d=\"m21 15-4.5-4.5L6 21\"/></svg>";

/* v2.11: apply (or remove) the runtime Title face on an image
   block, from its saved data-ss-view state. The face is a slim bar
   with an image icon and the attachment's name, standing in for
   the image while the mode is Title; the image element itself
   stays in the block, hidden by CSS, so flipping back to Preview
   is instant and nothing about the face ever reaches the saved
   note (canonicalization rebuilds the shell without it). Called at
   the end of hydration, the one moment a block's contents are
   complete. */
function applyImageTitleFace(el, att) {
  if (!el) { return; }
  const old = el.querySelector(".ss-att-title-face");
  if (!att || imageViewOf(el) !== "title") {
    if (old) { old.remove(); }
    return;
  }
  if (old) {
    const nameEl = old.querySelector(".ss-att-title-name");
    if (nameEl) { nameEl.textContent = att.name; }
    return;
  }
  const face = document.createElement("div");
  face.className = "ss-att-title-face";
  face.innerHTML = IMAGE_FACE_ICON;
  const name = document.createElement("span");
  name.className = "ss-att-title-name";
  name.textContent = att.name;
  face.appendChild(name);
  el.appendChild(face);
}

/* v2.11: re-append an image block's caption after hydration has
   rebuilt the block's contents. The caption's text was captured
   before the wipe (see hydrateOneAttachment); a caption that has
   never had its text set in this session falls back to the
   record's name, which is also what toggling the caption on
   creates it with. No-op while the caption is off. */
function appendImageCaption(el, att, capText) {
  if (!el || el.getAttribute("data-ss-caption") !== "1") { return; }
  const cap = document.createElement("figcaption");
  cap.setAttribute("class", "ss-caption");
  cap.textContent = (capText !== null && capText !== undefined)
    ? capText : (att ? att.name : "");
  el.appendChild(cap);
}

/* ----- v2.120: external (web hosted) images -------------------
   A second kind of image block, beside stored attachments.
   A stored attachment's bytes live in the user's Drive and
   its figure is an empty shell keyed by data-attachment-id;
   an external image's bytes never enter the store at all:
   the figure carries the image's own http(s) address in
   data-ss-ext-src (with data-ss-ext="1" as the kind mark),
   the note body is the only place the address lives, and
   the block renders straight from that address. Chris
   approved the trade on 2026-11-10 for the movie catalog
   notes (a table per title, a poster thumbnail per row):
   a poster breaks if its source address changes and there
   is no offline copy, in exchange for hundreds of posters
   costing no Drive space at all. This is a deliberate step
   away from strict Evernote behavior (Evernote stores its
   images), stated to Chris up front and accepted.

   The saved shell is the attachment shell's sibling:
     <figure class="ss-attachment" data-ss-ext="1"
       data-ss-ext-src="URL" contenteditable="false"
       style="width: 70px;"></figure>
   with data-ss-align riding exactly as it does on an
   attachment figure, and data-ss-ext-alt carrying the
   image's alt text when it has any. Canonicalization
   (editor.js) rebuilds that shell and nothing else;
   hydration (fillExternalImage below) fills it with a
   live <img>, or, when the source will not load, a quiet
   placeholder that carries the address. Because the
   figure has no data-attachment-id, every record keyed
   path (the body deletion reconciliation, the orphan
   repair, attachment counts, the missing record
   furniture) passes it by, by construction.

   Only http and https addresses are ever accepted: typed
   into the insert dialog, adopted from a bare <img>, or
   kept by canonicalization. No data: URLs, no file:, no
   blob: as a saved form, and no scriptable scheme can
   stand as an external image source, ever. (http is let
   in beside https because poster and reference hosts in
   the wild still serve plain http images; the address is
   only ever an <img> source, never a navigation or a
   script, so the risk it carries is a broken or swapped
   picture, which the placeholder reports honestly.) */
function isExternalImageFigure(el) {
  return !!el && !!el.classList &&
    el.classList.contains("ss-attachment") &&
    el.getAttribute("data-ss-ext") === "1" &&
    !!el.getAttribute("data-ss-ext-src");
}

function externalImageSrcOf(el) {
  return el ? (el.getAttribute("data-ss-ext-src") || "") : "";
}

/* The one scheme gate every external source passes:
   the insert dialog before it builds a block, adoption
   before it wraps an <img>, and canonicalization before
   it keeps a shell. Returns an empty string when the
   address may stand, else a sentence for the dialog. */
function extImageUrlError(raw) {
  const url = String(raw == null ? "" : raw).trim();
  if (!url) { return "Enter the image's web address."; }
  let parsed = null;
  try { parsed = new URL(url); } catch (e) { parsed = null; }
  if (!parsed) {
    return "That is not a complete web address. " +
      "Include the https:// part.";
  }
  if (parsed.protocol !== "https:" &&
      parsed.protocol !== "http:") {
    return "Only http and https image addresses can be used.";
  }
  return "";
}

/* Build one external image figure in its saved shell
   form (the runtime fill is fillExternalImage's work,
   so a fresh block and a reopened one are filled by
   the same hands). */
function buildExternalImageFigure(url, alt) {
  const fig = document.createElement("figure");
  fig.setAttribute("class", "ss-attachment");
  fig.setAttribute("data-ss-ext", "1");
  fig.setAttribute("data-ss-ext-src", String(url));
  if (alt) {
    fig.setAttribute("data-ss-ext-alt", String(alt));
  }
  fig.setAttribute("contenteditable", "false");
  return fig;
}

/* Fill one external figure with its live content: the
   image itself, loaded straight from its address, or
   the quiet placeholder when the address will not
   load. The placeholder is runtime furniture only;
   canonicalization rebuilds the shell from the
   figure's attributes, so it never reaches the file,
   and a source that comes back is picked up on the
   next open with no repair step. */
function fillExternalImage(el) {
  if (!el) { return; }
  const url = externalImageSrcOf(el);
  el.innerHTML = "";
  if (extImageUrlError(url)) {
    showExternalImageBroken(el);
    return;
  }
  const img = document.createElement("img");
  img.className = "ss-att-img";
  img.alt = el.getAttribute("data-ss-ext-alt") || "";
  /* The block owns dragging, like an attachment image. */
  img.setAttribute("draggable", "false");
  img.setAttribute("loading", "lazy");
  img.addEventListener("error", function () {
    showExternalImageBroken(el);
  });
  img.src = url;
  el.appendChild(img);
  /* A failure the browser already holds (a cached
     refusal) can finish before the listener above is
     attached; the completed and empty read catches it. */
  if (img.complete && img.naturalWidth === 0) {
    showExternalImageBroken(el);
  }
}

/* The broken source face: a quiet box naming the
   failure and showing the address it could not load
   (and carrying it as a tooltip), in the figure's own
   frame, so a table of posters keeps its shape with
   one cell reporting its dead source. Never an app
   error, never a modal. */
function showExternalImageBroken(el) {
  if (!el) { return; }
  const url = externalImageSrcOf(el);
  el.innerHTML = "";
  const ph = document.createElement("div");
  ph.className = "ss-ext-broken";
  ph.setAttribute("title", url);
  const label = document.createElement("div");
  label.className = "ss-ext-broken-label";
  label.textContent = "Image could not be loaded";
  const addr = document.createElement("div");
  addr.className = "ss-ext-broken-url";
  addr.textContent = url;
  ph.appendChild(label);
  ph.appendChild(addr);
  el.appendChild(ph);
}

/* Wrap every bare <img> in root whose source passes
   the scheme gate into an external image figure, in
   place: a paste, a web clip, or a hand written note
   file that arrives carrying plain image tags becomes
   the one canonical block, keeping the image's own
   width (the figure form) and alt text. Images inside
   an attachment figure are the attachment machinery's,
   and sources that fail the gate (data:, blob:, a
   relative path) are left exactly as they stand. Run
   by canonicalization on every save and by both fill
   sequences on every open. */
function adoptBareExternalImages(root) {
  if (!root || !root.querySelectorAll) { return; }
  root.querySelectorAll("img").forEach(function (img) {
    if (img.closest(".ss-attachment")) { return; }
    const src = img.getAttribute("src") || "";
    if (extImageUrlError(src)) { return; }
    const fig = buildExternalImageFigure(
      src, img.getAttribute("alt") || "");
    let width = imagePixelWidth(
      img.style ? img.style.width : "");
    if (!width) {
      const attr = img.getAttribute("width") || "";
      if (/^\d+(\.\d+)?$/.test(attr)) {
        width = imagePixelWidth(attr + "px");
      }
    }
    if (width) { fig.style.width = width; }
    img.replaceWith(fig);
  });
}

/* ----- v2.120: the external image menu -------------------------
   The selected external figure's three dot menu is its
   own small card (#extMenu beside #attMenu in the
   shell): the actions an address backed image can
   honestly offer. Full screen preview (the shared
   lightbox, fed the address), Open in new tab, Image
   alignment (the shared #attAlignMenu: attMenuEl is
   pointed at the figure, and runAttAlignChoice reads
   only the element), and Remove, a plain block removal
   through the ordinary dirty path (there is no file
   anywhere to delete, so the undoable attachment
   deletion engine is not involved). */
let extMenuEl = null;

function openExternalImageMenu(anchorBtn, el) {
  const menu = document.getElementById("extMenu");
  if (!menu || !anchorBtn || !el) { return; }
  if (extMenuEl === el &&
      !menu.classList.contains("hidden")) {
    closeExtMenu();
    return;
  }
  closeAttMenu();
  extMenuEl = el;
  attMenuEl = el;
  menu.classList.remove("hidden");
  const rect = anchorBtn.getBoundingClientRect();
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  let left = Math.min(rect.right - width,
    window.innerWidth - width - 8);
  left = Math.max(8, left);
  let top = rect.bottom + 6;
  if (top + height > window.innerHeight - 8) {
    top = Math.max(8, rect.top - height - 6);
  }
  menu.style.left = left + "px";
  menu.style.top = top + "px";
}

function closeExtMenu() {
  const menu = document.getElementById("extMenu");
  if (menu) { menu.classList.add("hidden"); }
  extMenuEl = null;
  const item = document.getElementById("extAlignItem");
  if (item) { item.setAttribute("aria-expanded", "false"); }
}

/* The shared alignment submenu, opened from the
   external menu: the same card #attMenu uses, dotted
   from the figure's own alignment and positioned off
   the external menu's frame. */
function showExtAlignMenu() {
  const menu = document.getElementById("extMenu");
  const sub = document.getElementById("attAlignMenu");
  const item = document.getElementById("extAlignItem");
  if (!menu || !sub || !item || !extMenuEl) { return; }
  const current = imageAlignOf(extMenuEl);
  sub.querySelectorAll("button[data-align]")
    .forEach(function (btn) {
      btn.classList.toggle("current",
        btn.getAttribute("data-align") === current);
    });
  sub.classList.remove("hidden");
  item.setAttribute("aria-expanded", "true");
  const mRect = menu.getBoundingClientRect();
  const iRect = item.getBoundingClientRect();
  const width = sub.offsetWidth;
  const height = sub.offsetHeight;
  let left = mRect.right + 6;
  if (left + width > window.innerWidth - 8) {
    left = Math.max(8, mRect.left - width - 6);
  }
  let top = iRect.top - 6;
  if (top + height > window.innerHeight - 8) {
    top = Math.max(8, window.innerHeight - height - 8);
  }
  sub.style.left = left + "px";
  sub.style.top = top + "px";
}

function toggleExtAlignMenu() {
  if (attAlignMenuOpen()) { closeAttAlignMenu(); }
  else { showExtAlignMenu(); }
}

function runExtMenuAction(action) {
  const el = extMenuEl;
  if (action === "align") { toggleExtAlignMenu(); return; }
  closeExtMenu();
  closeAttMenu();
  if (!el) { return; }
  if (action === "preview") {
    openExternalImageLightbox(el);
  } else if (action === "open") {
    window.open(externalImageSrcOf(el), "_blank", "noopener");
  } else if (action === "remove") {
    deselectAttachment();
    el.remove();
    if (typeof editorHistorySignal === "function") {
      editorHistorySignal("op");
    }
    markDirty();
  }
}

/* The full screen preview for an external image: the
   shared lightbox, with the address itself as the
   picture source (no blob to own or revoke, so
   closeImageLightbox's plain src clear is the whole
   teardown). */
function openExternalImageLightbox(el) {
  const box = document.getElementById("imgLightbox");
  const img = document.getElementById("imgLightboxImg");
  if (!box || !img || !el) { return; }
  img.src = externalImageSrcOf(el);
  img.alt = el.getAttribute("data-ss-ext-alt") ||
    externalImageSrcOf(el);
  box.classList.remove("hidden");
}

/* ----- v2.120: insert an image from the web --------------------
   The Insert menu's "Image from web" entry: the same
   preflight shape as the attach flow (an open, live
   note; the caret captured before the dialog can steal
   it), then a themed dialog asking for the address.
   The scheme gate judges the typed address; a refusal
   is a line in the dialog and nothing is inserted. A
   good address builds the shell, fills it, and lands
   it at the caret through the shared placeholder
   inserter, one editor history step like every other
   discrete insert. */
function openExtImageDialog() {
  const note = currentNote();
  if (!note) {
    toast("Open a note first.", true);
    return;
  }
  if (note.trashed) {
    toast("That note is in the Trash. Restore it to " +
      "add an image.", true);
    return;
  }
  if (note.archived) {
    toast("That note is archived. Unarchive it to " +
      "add an image.", true);
    return;
  }
  captureCaret();
  const dlg = document.getElementById("extImgDialog");
  const input = document.getElementById("extImgUrl");
  const err = document.getElementById("extImgError");
  if (!dlg || !input) { return; }
  input.value = "";
  if (err) {
    err.textContent = "";
    err.classList.add("hidden");
  }
  dlg.classList.remove("hidden");
  setTimeout(function () { input.focus(); }, 30);
}

function closeExtImageDialog() {
  const dlg = document.getElementById("extImgDialog");
  if (dlg) { dlg.classList.add("hidden"); }
}

function submitExtImageDialog() {
  const input = document.getElementById("extImgUrl");
  const err = document.getElementById("extImgError");
  if (!input) { return; }
  const url = input.value.trim();
  const problem = extImageUrlError(url);
  if (problem) {
    if (err) {
      err.textContent = problem;
      err.classList.remove("hidden");
    }
    input.focus();
    return;
  }
  const note = currentNote();
  const fig = buildExternalImageFigure(url, "");
  decorateAttachmentPlaceholder(note, fig, null);
  fillExternalImage(fig);
  insertPlaceholderAtCaret(fig);
  closeExtImageDialog();
  markDirty();
}

async function hydrateOneAttachment(note, el) {
  /* v2.120: an external image fills from its own
     address, with no record lookup at all: the missing
     record branch below is for attachment figures whose
     record was lost, and an external figure must never
     land there (on v2.119.0 it did, and wore the missing
     details furniture with a Remove placeholder button
     over a poster that was never missing). */
  if (isExternalImageFigure(el)) {
    decorateAttachmentPlaceholder(note, el, null);
    fillExternalImage(el);
    return;
  }
  const attId = el.getAttribute("data-attachment-id");
  const att = (note.attachments || []).find(function (a) { return a.id === attId; });
  /* v2.11: capture the caption before anything rebuilds the
     block's children: the caption element lives inside the figure,
     and hydration below wipes innerHTML as it always has. Its
     on/off state rides on the figure's own attribute, which the
     wipe never touches. */
  const capEl = el.querySelector("figcaption.ss-caption");
  const capText = capEl ? capEl.textContent : null;
  /* v1.7.2: there is deliberately no width handling here. A resized
     image's chosen width rides on the block's own style (it has
     since v1.6 in the saved file), the decoration call just below
     normalizes it (and lifts the block's column cap), and clearing
     innerHTML never touches the block's own attributes, so the
     size simply stays where it belongs while the block's contents
     are rebuilt. Before v1.7.2 this function copied the width onto
     the hydrated <img>; that second home for the size is exactly
     what made the selection frame stop tracking the image. */
  /* v1.7: every placeholder passes through the one decoration
     function, so an element built by the upload flow, an element
     rebuilt here, and an element decorated at render all carry the
     same classes and flags: the inline image presentation for image
     records, and the draggable flag for live notes. Before v1.7 the
     upload path decorated its own element by hand and the versions
     drifted apart, which is why a freshly pasted image could not be
     selected, moved, or resized until the note was reopened. */
  decorateAttachmentPlaceholder(note, el, att);
  el.innerHTML = "";
  if (!att) {
    const msg = document.createElement("div");
    msg.className = "ss-att-msg";
    msg.textContent = "This attachment's details are missing from the note, so it cannot be loaded.";
    el.appendChild(msg);
    if (!note.trashed && !note.archived) {
      const actions = document.createElement("div");
      actions.className = "ss-att-actions";
      actions.appendChild(makeAttButton("Remove placeholder", function () {
        el.remove();
        markDirty();
      }));
      el.appendChild(actions);
    }
    return;
  }

  const isImage = isImageAttachment(att);
  const driver = providers[att.provider];
  const status = driver ? await driver.getStatus() : { connected: false };

  /* v1.7: an image attachment is just the image. No name bar, no
     provider chip, no buttons row under it: file cards carry those,
     and an image's actions (Open, Download, sizes, Remove) live on
     the three dot menu that appears when the image is selected. When
     the image cannot be shown, a plain message stands in its place;
     the block can still be selected and deleted like any other. */
  if (isImage) {
    if (driver && status.connected) {
      const loading = document.createElement("div");
      loading.className = "ss-att-msg";
      loading.textContent = "Loading image...";
      el.appendChild(loading);
      try {
        const blob = await driver.download(att.fileId);
        const url = URL.createObjectURL(blob);
        if (!el.isConnected) {
          /* Editor moved on meanwhile; a blob URL nobody will
             display is revoked at once. */
          URL.revokeObjectURL(url);
          return;
        }
        state.objectUrls.push(url);
        const img = document.createElement("img");
        img.className = "ss-att-img";
        img.alt = att.name;
        img.src = url;
        /* The block owns dragging; a natively draggable image inside
           it would start the browser's own image drag instead. */
        img.setAttribute("draggable", "false");
        /* v1.7.2: no width is set on the fresh <img>: CSS makes it
           fill the block, and the block carries the chosen size. */
        el.innerHTML = "";
        el.appendChild(img);
      } catch (err) {
        if (!el.isConnected) { return; }
        el.innerHTML = "";
        const fail = document.createElement("div");
        fail.className = "ss-att-msg";
        fail.textContent = "This image could not be loaded: " + err.message;
        el.appendChild(fail);
      }
      /* v2.11: the block's contents are complete: the Title face
         (when the view mode is Title) and the caption (when on)
         go back on, in that order, under the image. */
      applyImageTitleFace(el, att);
      appendImageCaption(el, att, capText);
      return;
    }
    const note1 = document.createElement("div");
    note1.className = "ss-att-msg";
    note1.textContent = driver
      ? "Sign in with " + providerLabel(att.provider) + " to view this image."
      : "The storage provider for this image is not available in this version.";
    el.appendChild(note1);
    applyImageTitleFace(el, att);
    appendImageCaption(el, att, capText);
    return;
  }

  /* v2.14.1: whether this card is the audio card, whose actions
     live on a three dot menu instead of inline buttons (see the
     actions branch below). The app's one audio test decides, the
     mime type with the file name extension as its fallback, so a
     card and its inline player always agree about what it is.
     The class dresses the card: its head keeps clear of the menu
     button parked at the top right corner. */
  const audioCard = isAudioAttachment(att);
  if (audioCard) { el.classList.add("ss-att-audio"); }

  const head = document.createElement("div");
  if (audioCard) { head.classList.add("ss-att-head"); }
  const nameSpan = document.createElement("span");
  nameSpan.className = "ss-att-name";
  nameSpan.textContent = att.name;
  head.appendChild(nameSpan);
  const chip = document.createElement("span");
  chip.className = "ss-att-provider";
  chip.textContent = providerLabel(att.provider);
  head.appendChild(chip);

  const meta = document.createElement("div");
  meta.className = "ss-att-meta";
  meta.textContent = humanSize(att.size) + (att.mime ? " - " + att.mime : "");

  el.appendChild(head);
  el.appendChild(meta);
  if (audioCard) {
    /* v2.14.1: an audio card renders no Download and no Remove
       buttons. Its actions live on the three dot menu button at
       the card's top right corner (see the audio card menu
       section below): Download, Rename, Delete (the same
       undoable delete the Remove button ran), and Transcribe.
       The button is on the card in read only notes too, because
       Download stays available there, exactly as it did on the
       buttons row; the menu itself decides which of its items
       are enabled when it opens. */
    el.appendChild(buildAttCardMenuButton(note, att, el));
  } else {
    const actions = document.createElement("div");
    actions.className = "ss-att-actions";
    actions.appendChild(makeAttButton("Download", function () {
      downloadAttachment(att);
    }));
    /* Trashed and archived notes are read only: Download still works,
       Remove does not (restore or unarchive the note first). This keeps
       Trash and Archive state consistent, since such notes never
       autosave. */
    if (!note.trashed && !note.archived) {
      actions.appendChild(makeAttButton("Remove", function () {
        removeAttachment(note, att);
      }));
    }
    /* v1.6: PDF attachments can be read in line. The Preview toggle
       sits with the other card actions (and, like Download, stays
       available in Trash and Archive, which are read only but still
       readable). The document itself is fetched only when the toggle
       is expanded; see togglePdfPreview. A fetch that fails shows the
     existing style error toast and leaves the card collapsed, with the
     Download button working exactly as before. */
    if (isPdfAttachment(att)) {
      const previewBtn = makeAttButton("Preview", function () {
        togglePdfPreview(note, att, el, previewBtn);
      });
      actions.appendChild(previewBtn);
    }
    el.appendChild(actions);
  }
  /* v2.14: an audio card (a voice note, or any audio file) gains
     an inline player under its name, so a recording can be
     played where it sits. The bytes come down the same provider
     download path as an image's, and the object URL joins
     state.objectUrls, so it is revoked on note switch and sign
     out exactly like the image URLs. */
  if (isAudioAttachment(att) && driver && status.connected) {
    appendAudioPlayer(el, att, driver);
  }
  /* v2.76: an audio card whose record carries a
     transcript shows it in the card's own collapsible
     section, built from the record (never from the
     body: canonicalization strips the card's contents
     on save, and the section is rebuilt here on every
     render). It stands whether or not the player could
     load, and in read only notes too: reading a
     transcript changes nothing there. */
  if (audioCard) { renderTranscriptSection(el, att); }
}

/* v2.14: audio attachments, by mime type with the file name
   extension as a fallback, the same shape as isPdfAttachment. */
function isAudioAttachment(att) {
  if (!att) { return false; }
  if ((att.mime || "").toLowerCase().indexOf("audio/") === 0) { return true; }
  return /\.(webm|ogg|opus|mp3|m4a|wav|aac)$/i.test(att.name || "");
}

/* v2.14: fetch an audio attachment's bytes and put a player on
   its card. Fire and forget from hydration, with the same guards
   as the image path: a card the editor has moved on from is left
   alone, and a failed fetch says so on the card itself. */
async function appendAudioPlayer(el, att, driver) {
  try {
    const blob = await driver.download(att.fileId);
    if (!el.isConnected) { return; }
    const url = URL.createObjectURL(blob);
    state.objectUrls.push(url);
    const audio = document.createElement("audio");
    audio.className = "ss-att-audio";
    audio.controls = true;
    audio.preload = "metadata";
    audio.src = url;
    /* v2.76: the transcript section's seek and highlight
       reach the player through the card (see
       seekTranscriptUnit); the highlight follows the
       player's own clock. */
    el._ssAudioEl = audio;
    audio.addEventListener("timeupdate", function () {
      syncTranscriptHighlight(el);
    });
    /* v2.76: the player stands above the transcript section
       when the card carries one: hydration starts this load
       without awaiting it, so the section may already stand
       by the time the player lands. */
    const sec = el.querySelector(".ss-att-transcript");
    if (sec) {
      el.insertBefore(audio, sec);
    } else {
      el.appendChild(audio);
    }
  } catch (err) {
    if (!el.isConnected) { return; }
    const fail = document.createElement("div");
    fail.className = "ss-att-msg";
    fail.textContent = "This recording could not be loaded: " + err.message;
    el.appendChild(fail);
  }
}

/* ----- v2.76: the transcript section in the audio card ------
   A recording's transcript lives on its attachment record
   (att.transcript, see sanitizeTranscript), not in the note
   body, and the card renders it as a collapsible section
   under the player: a Transcript header (a real button
   wearing the sidebar chevron, collapsed by default) over
   the words. When the run captured timings, each unit is a
   button that seeks the card's own player to the unit's
   start and plays from there, and the unit sounding now is
   highlighted as the player runs. With no timings the
   words stand as plain text with no click targets. The
   section is editor furniture like the player:
   canonicalization rebuilds placeholders as empty shells
   on save, so it never reaches the note file; it is rebuilt
   from the record on every hydration, and rebuilt in place
   by the transcription landing when a run finishes on the
   open note. */
/* v2.77: the pause, in seconds, that starts a new
   paragraph in a timed transcript when the silence
   between one unit's end and the next unit's start
   exceeds it. A second is about a breath between
   thoughts: the gaps inside a fluent sentence, whose
   word ends and starts sit nearly back to back in the
   model's timings, stay well under it, and a deliberate
   pause crosses it. */
const TRANSCRIPT_PARAGRAPH_PAUSE_S = 1;

/* v2.77: the render time paragraph grouping for a timed
   transcript, layout only: the stored record never
   changes, so transcripts stored by earlier builds gain
   the layout too. Two rules start a new paragraph
   before a unit. A segment boundary, when the
   transcript is segment grained: any unit holding more
   than one word marks the set as segments (a live
   capture's turns, a chunk run's pieces), and every
   segment then stands as its own paragraph. And the
   pause rule above, for word grained sets. Within a
   paragraph the units flow as prose with a normal space
   between them, so sentences read by the punctuation
   the units themselves carry: a sentence ends after a
   unit whose text ends with terminal punctuation
   (. ? !, a closing quote or bracket after it allowed).
   A lone one word segment in a word grained set groups
   by the same pause rule. */
function transcriptParagraphUnits(units) {
  const segmentGrained = units.some(function (u) {
    return /\s/.test(u.text);
  });
  const groups = [];
  let cur = [];
  units.forEach(function (u, i) {
    if (i > 0) {
      const prev = units[i - 1];
      const prevEnd = typeof prev.end === "number"
        ? prev.end : prev.start;
      if (segmentGrained ||
          u.start - prevEnd > TRANSCRIPT_PARAGRAPH_PAUSE_S) {
        groups.push(cur);
        cur = [];
      }
    }
    cur.push(u);
  });
  if (cur.length) { groups.push(cur); }
  return groups;
}

/* v2.77: the plain text fallback's sentences, for a
   stored transcript with no usable timings: the text is
   split after terminal punctuation (. ? !, a closing
   quote or bracket riding with its sentence, a decimal
   point between digits never terminal), and each
   sentence stands as its own paragraph, the only
   structure a timingless transcript honestly has. The
   split only decides where paragraphs break: the words
   and punctuation are the stored text's own, untouched.
   A text with no sentence end stands as one paragraph,
   as before. */
function splitTranscriptSentences(text) {
  const s = String(text || "");
  const out = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    cur += ch;
    if (ch !== "." && ch !== "?" && ch !== "!") { continue; }
    if (ch === "." && i > 0 && i + 1 < s.length &&
        /\d/.test(s.charAt(i - 1)) && /\d/.test(s.charAt(i + 1))) {
      continue;
    }
    let j = i + 1;
    let closers = "";
    while (j < s.length &&
        "\"'\u201d\u2019)]".indexOf(s.charAt(j)) >= 0) {
      closers += s.charAt(j);
      j++;
    }
    if (j < s.length && !/\s/.test(s.charAt(j))) { continue; }
    cur += closers;
    const done = cur.trim();
    if (done) { out.push(done); }
    cur = "";
    i = j - 1;
  }
  const tail = cur.trim();
  if (tail) { out.push(tail); }
  if (!out.length && s.trim()) { out.push(s.trim()); }
  return out;
}

/* One paragraph of a timed transcript: its units as
   buttons in prose order, a normal space between them,
   each button seeking the card's player to its unit's
   start (see seekTranscriptUnit). The buttons are the
   same elements the sounding unit highlight looks up
   across the whole card, so the paragraph wrappers
   change nothing for it. */
function transcriptUnitParagraph(el, att, units) {
  const para = document.createElement("p");
  para.className = "ss-att-transcript-text";
  units.forEach(function (u, idx) {
    if (idx > 0) {
      para.appendChild(document.createTextNode(" "));
    }
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ss-att-unit";
    b.textContent = u.text;
    b.setAttribute("data-start", String(u.start));
    b.setAttribute("data-end", String(u.end));
    /* The card sits inside the contenteditable body; the
       press is swallowed on the way down so a seek never
       moves the editor caret, the card buttons' own rule. */
    b.addEventListener("mousedown", function (ev) {
      ev.preventDefault();
    });
    b.addEventListener("click", function () {
      seekTranscriptUnit(el, att, u.start);
    });
    para.appendChild(b);
  });
  return para;
}

function renderTranscriptSection(el, att) {
  if (!el) { return; }
  const old = el.querySelector(".ss-att-transcript");
  if (old) { old.remove(); }
  const tr = att ? sanitizeTranscript(att.transcript) : null;
  if (!tr) { return; }
  const wrap = document.createElement("div");
  wrap.className = "ss-att-transcript";
  const head = document.createElement("button");
  head.type = "button";
  head.className = "ss-att-transcript-head";
  head.setAttribute("aria-expanded", "false");
  const chev = document.createElement("span");
  chev.className = "ss-att-transcript-chevron";
  chev.setAttribute("aria-hidden", "true");
  chev.innerHTML = "<svg viewBox=\"0 0 16 16\" width=\"12\" " +
    "height=\"12\" aria-hidden=\"true\"><path d=\"M6 3l5 5-5 5\" " +
    "stroke=\"currentColor\" stroke-width=\"1.8\" " +
    "stroke-linecap=\"round\" stroke-linejoin=\"round\" " +
    "fill=\"none\"/></svg>";
  head.appendChild(chev);
  const label = document.createElement("span");
  label.textContent = "Transcript";
  head.appendChild(label);
  const body = document.createElement("div");
  body.className = "ss-att-transcript-body hidden";
  /* v2.77: the words are laid out as sentences and
     paragraphs at render time (see
     transcriptParagraphUnits for the timed rules and
     splitTranscriptSentences for the plain fallback);
     the stored record is never rewritten for layout. */
  if (tr.units && tr.units.length) {
    transcriptParagraphUnits(tr.units).forEach(function (group) {
      body.appendChild(transcriptUnitParagraph(el, att, group));
    });
  } else {
    splitTranscriptSentences(tr.text).forEach(function (s) {
      const para = document.createElement("p");
      para.className = "ss-att-transcript-text";
      para.textContent = s;
      body.appendChild(para);
    });
  }
  head.addEventListener("mousedown", function (ev) {
    ev.preventDefault();
  });
  head.addEventListener("click", function () {
    const open = body.classList.toggle("hidden") === false;
    wrap.classList.toggle("ss-open", open);
    head.setAttribute("aria-expanded", open ? "true" : "false");
  });
  wrap.appendChild(head);
  wrap.appendChild(body);
  el.appendChild(wrap);
}

/* One timed unit's click: the card's own player goes to
   the unit's start and plays from there. A player that has
   not been built yet (its fetch is still in flight, or the
   note rendered while signed out) is built through the
   player's own load path first, and the seek lands when it
   stands; a player that cannot be built that way (signed
   out, or its load failed onto the card as a message)
   leaves the click a quiet no-op rather than an error. */
async function seekTranscriptUnit(el, att, start) {
  if (!el || !att) { return; }
  let audio = el.querySelector("audio.ss-att-audio");
  if (!audio) {
    const driver = providers[att.provider];
    if (!driver) { return; }
    const status = await driver.getStatus();
    if (!status || !status.connected) { return; }
    if (!el._ssAudioLoading) {
      el._ssAudioLoading = true;
      try {
        await appendAudioPlayer(el, att, driver);
      } finally {
        el._ssAudioLoading = false;
      }
    }
    audio = el.querySelector("audio.ss-att-audio");
    if (!audio) { return; }
  }
  try {
    audio.currentTime = start;
  } catch (e) { /* a player with no media yet keeps its place */ }
  const played = audio.play && audio.play();
  if (played && typeof played.catch === "function") {
    played.catch(function () {
      /* the browser may refuse until a fuller gesture; the
         seek itself stands either way. */
    });
  }
  syncTranscriptHighlight(el);
}

/* The sounding unit's highlight, driven by the player's
   timeupdate (wired in appendAudioPlayer) and by a seek:
   the lit unit is the last one whose start the playhead
   has reached, so a gap between units keeps the most
   recent one lit, a seek lights its target at once, and
   before the first unit nothing is lit. Pure class
   changes on standing buttons: no layout moves. */
function syncTranscriptHighlight(el) {
  if (!el) { return; }
  const audio = el.querySelector("audio.ss-att-audio");
  if (!audio) { return; }
  const units = el.querySelectorAll(".ss-att-unit");
  if (!units.length) { return; }
  const t = Number(audio.currentTime) || 0;
  let active = null;
  units.forEach(function (b) {
    const s = parseFloat(b.getAttribute("data-start"));
    if (isFinite(s) && s <= t) { active = b; }
  });
  units.forEach(function (b) {
    b.classList.toggle("ss-att-unit-now", b === active);
  });
}

/* ----- v1.6: inline PDF preview ---------------------------------------
   A PDF attachment (by mime type, with the file name extension as a
   fallback for providers that stored a generic type) can be read
   without leaving the note. Expanding the Preview toggle downloads
   the bytes on demand through the same provider download path as the
   Download button, wraps them in a PDF typed blob (some browsers
   will only render a blob in a frame when its type says PDF), and
   shows the blob in an iframe inside the placeholder, in the spot
   where the attachment sits in the note. The object URL joins
   state.objectUrls, so it is revoked on note switch and sign out
   exactly like image URLs; collapsing the preview revokes it
   immediately. Preview state is editor only:
   canonicalizeAttachmentPlaceholders rebuilds placeholders as empty
   shells on save, so the iframe, the preview box, and the blob URL
   can never reach the saved file. */
function isPdfAttachment(att) {
  if (!att) { return false; }
  if ((att.mime || "").toLowerCase() === "application/pdf") { return true; }
  return /\.pdf$/i.test(att.name || "");
}

async function togglePdfPreview(note, att, el, btn) {
  const existing = el.querySelector(".ss-att-preview");
  if (existing) {
    /* Blank the frame before the box goes away so it stops loading
       at once; the preview's object URL is revoked just below. */
    const oldFrame = existing.querySelector("iframe");
    if (oldFrame) { oldFrame.src = "about:blank"; }
    if (existing._pdfUrl) {
      const at = state.objectUrls.indexOf(existing._pdfUrl);
      if (at >= 0) { state.objectUrls.splice(at, 1); }
      try { URL.revokeObjectURL(existing._pdfUrl); } catch (e) { /* already gone */ }
    }
    existing.remove();
    btn.textContent = "Preview";
    return;
  }
  const driver = providers[att.provider];
  if (!driver) {
    toast("Unknown storage provider for this attachment.", true);
    return;
  }
  if (!state.online) {
    toast("Previews need an internet connection: the file is fetched from your storage provider. You appear to be offline.", true);
    return;
  }
  btn.disabled = true;
  btn.textContent = "Loading...";
  try {
    const blob = await driver.download(att.fileId);
    if (!el.isConnected) { return; }   /* editor moved on meanwhile */
    const pdfBlob = blob && blob.type === "application/pdf"
      ? blob : new Blob([blob], { type: "application/pdf" });
    const url = URL.createObjectURL(pdfBlob);
    state.objectUrls.push(url);
    const box = document.createElement("div");
    box.className = "ss-att-preview";
    box._pdfUrl = url;
    const frame = document.createElement("iframe");
    frame.className = "ss-att-pdf-frame";
    frame.title = att.name;
    frame.src = url;
    box.appendChild(frame);
    el.appendChild(box);
    btn.textContent = "Hide preview";
  } catch (err) {
    toast("Could not preview " + att.name + ": " + err.message, true);
    btn.textContent = "Preview";
  } finally {
    btn.disabled = false;
  }
}

/* ----- v1.6: moving attachments within a note, resizing images --------
   Placeholders are contenteditable=false islands in the note body.
   Since v1.6 they are also draggable in live notes: dragging one
   moves the real DOM node, and the following autosave stores the new
   order like any other edit. HTML5 drag and drop does not run on
   touch screens; there, the same move is still available by cutting
   and pasting the block, which contenteditable islands support.

   Clicking an inline image selects its block (outline plus a corner
   handle); dragging the handle resizes the image, keeping its aspect
   ratio because only the width is set. The width lands as an inline
   style on the <img>, and canonicalizeAttachmentPlaceholders carries
   it into the saved placeholder, so the size is part of the note.

   Locked notes (Trash and Archive) get none of this: their
   placeholders never become draggable, and every handler below checks
   the open note's state before acting. */

/* The placeholder element containing a DOM node, or null. Shared by
   the drop position math and the drop indicator. */
function attachmentHolderOf(node) {
  let el = node;
  if (el && el.nodeType !== 1) { el = el.parentNode; }
  return el && el.closest ? el.closest(".ss-attachment") : null;
}

/* A collapsed caret range for a screen point, through whichever of
   the two historical APIs the browser offers. Also used by the file
   drop handler (wireEvents) so dropped files land at the drop point. */
function caretRangeFromPoint(x, y) {
  if (document.caretRangeFromPoint) {
    return document.caretRangeFromPoint(x, y);
  }
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    if (pos && pos.offsetNode) {
      const range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
      return range;
    }
  }
  return null;
}

/* Move a dragged placeholder to a screen point: before or after the
   placeholder under the pointer (by which half of it the pointer is
   in), at a plain text caret otherwise, or to the end of the note
   when the point maps to no caret at all. */
function moveAttachmentToPoint(el, x, y) {
  const bodyEl = document.getElementById("noteBody");
  const range = caretRangeFromPoint(x, y);
  if (range && bodyEl.contains(range.startContainer)) {
    const holder = attachmentHolderOf(range.startContainer);
    if (holder === el) { return; }   /* dropped back onto itself */
    if (holder) {
      const rect = holder.getBoundingClientRect();
      if (y < rect.top + rect.height / 2) { holder.before(el); }
      else { holder.after(el); }
      return;
    }
    range.insertNode(el);
    return;
  }
  bodyEl.appendChild(el);
}

/* ----- v2.25: Free move drops ----------------------------------
   A figure whose alignment is Free move can be dropped at any
   caret point in the text flow, not only before or after whole
   blocks. The figure always lands as a sibling of the block
   the caret sits in: when that block is a splittable text
   block (a paragraph, a div line, a heading, a blockquote, a
   pre block), it splits at the caret into two blocks of the
   same tag with the figure between them, and a half left
   empty by the split is removed. When the caret sits in a
   list item, the list splits around the figure the same way.
   Points that cannot resolve to a split (inside an attachment
   or a caption, inside a table, in the body's own gaps, or no
   caret at all) fall back to the ordinary block move above,
   byte for byte in effect; a drop back inside the dragged
   figure itself is that move's own no-op. The moved figure
   keeps its id, width, caption, and view mode, because the
   very element moves; the drop handler's markDirty saves it. */
function moveFreeAttachmentToPoint(el, x, y) {
  const bodyEl = document.getElementById("noteBody");
  const range = caretRangeFromPoint(x, y);
  if (!range || !bodyEl.contains(range.startContainer)) {
    moveAttachmentToPoint(el, x, y);
    return;
  }
  if (attachmentHolderOf(range.startContainer)) {
    moveAttachmentToPoint(el, x, y);
    return;
  }
  let host = range.startContainer;
  if (host.nodeType !== 1) { host = host.parentNode; }
  const SPLITTABLE = { P: 1, DIV: 1, H1: 1, H2: 1, H3: 1, H4: 1,
    H5: 1, H6: 1, BLOCKQUOTE: 1, PRE: 1, LI: 1 };
  while (host && host !== bodyEl && !SPLITTABLE[host.tagName]) {
    host = host.parentNode;
  }
  if (!host || host === bodyEl || host.closest("table")) {
    moveAttachmentToPoint(el, x, y);
    return;
  }
  /* The split: everything from the caret to the host's end
     moves into a shallow clone of the host (same tag, same
     classes), and the figure lands between the two halves. */
  const afterRange = document.createRange();
  afterRange.setStart(range.startContainer, range.startOffset);
  afterRange.setEnd(host, host.childNodes.length);
  const frag = afterRange.extractContents();
  const host2 = host.cloneNode(false);
  host2.removeAttribute("id");
  host2.appendChild(frag);
  if (host.tagName === "LI") {
    /* A list item's halves stay list items, so the list
       itself splits: the second list carries the second half
       and every item that followed the first. */
    const list = host.parentNode;
    const parent = list.parentNode;
    if (!parent) { moveAttachmentToPoint(el, x, y); return; }
    const list2 = list.cloneNode(false);
    list2.removeAttribute("id");
    list2.appendChild(host2);
    const movers = [];
    let sib = host.nextSibling;
    while (sib) { movers.push(sib); sib = sib.nextSibling; }
    movers.forEach(function (n) { list2.appendChild(n); });
    parent.insertBefore(el, list.nextSibling);
    parent.insertBefore(list2, el.nextSibling);
    if (clearBlockIsEmpty(host)) { host.remove(); }
    if (!list.children.length) { list.remove(); }
    if (clearBlockIsEmpty(host2)) { host2.remove(); }
    if (!list2.children.length) { list2.remove(); }
    deselectAttachment();
    return;
  }
  const parent = host.parentNode;
  if (!parent) { moveAttachmentToPoint(el, x, y); return; }
  parent.insertBefore(el, host.nextSibling);
  parent.insertBefore(host2, el.nextSibling);
  if (clearBlockIsEmpty(host)) { host.remove(); }
  if (clearBlockIsEmpty(host2)) { host2.remove(); }
  deselectAttachment();
}

/* The placeholder currently being dragged, and the indicator
   bookkeeping shared by the drag handlers in wireEvents. */
let attachmentDragEl = null;

function updateAttachmentDropIndicator(ev) {
  const bodyEl = document.getElementById("noteBody");
  bodyEl.querySelectorAll(".ss-drop-before, .ss-drop-after")
    .forEach(function (n) {
      n.classList.remove("ss-drop-before");
      n.classList.remove("ss-drop-after");
    });
  const range = caretRangeFromPoint(ev.clientX, ev.clientY);
  if (!range) { return; }
  const holder = attachmentHolderOf(range.startContainer);
  if (!holder || holder === attachmentDragEl) { return; }
  const rect = holder.getBoundingClientRect();
  holder.classList.add(
    ev.clientY < rect.top + rect.height / 2
      ? "ss-drop-before" : "ss-drop-after");
}

function clearAttachmentDrag() {
  if (attachmentDragEl) {
    attachmentDragEl.classList.remove("ss-dragging");
  }
  attachmentDragEl = null;
  const bodyEl = document.getElementById("noteBody");
  if (bodyEl) {
    bodyEl.querySelectorAll(".ss-drop-before, .ss-drop-after")
      .forEach(function (n) {
        n.classList.remove("ss-drop-before");
        n.classList.remove("ss-drop-after");
      });
  }
}

/* Image selection: corner grips, a three dot menu, and resizing.
   Exactly one block can be selected; the grips and the menu button
   live inside the selected block and, like all hydrated content, are
   stripped by canonicalization on save. v1.7 replaces the single
   bottom right handle of v1.6 with four corner grips (the layout in
   the reference screenshot Chris supplied) and adds a three dot menu
   button at the block's top right corner. The menu itself is one
   shared element, #attMenu, that lives outside #noteBody next to the
   link popup, so it can never be saved into a note either. */
let selectedAttachmentEl = null;

/* The attachment the open #attMenu refers to: the note, the record,
   and the placeholder element, kept in variables like the link
   popup's target, so the menu always acts on the image it was opened
   from. Cleared whenever the menu closes. */
let attMenuNote = null;
let attMenuAtt = null;
let attMenuEl = null;

function selectAttachment(el) {
  if (selectedAttachmentEl === el) { return; }
  deselectAttachment();
  selectedAttachmentEl = el;
  el.classList.add("ss-selected");
  /* Four corner grips; dragging any of them resizes the image. */
  ["nw", "ne", "sw", "se"].forEach(function (corner) {
    const grip = document.createElement("div");
    grip.className = "ss-grip";
    grip.setAttribute("data-corner", corner);
    grip.title = "Drag to resize the image";
    grip.setAttribute("aria-hidden", "true");
    grip.addEventListener("pointerdown", function (ev) {
      startAttachmentResize(ev, corner);
    });
    el.appendChild(grip);
  });
  /* The three dot menu button at the block's top right corner. Its
     dots are plain spans styled by CSS, so no icon font or special
     glyph is needed. mousedown is swallowed like the attachment card
     buttons, so opening the menu never moves the editor caret. */
  const menuBtn = document.createElement("button");
  menuBtn.type = "button";
  menuBtn.className = "ss-att-menu-btn";
  menuBtn.title = "Image options";
  menuBtn.setAttribute("aria-label", "Image options");
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement("span");
    dot.className = "ss-dot";
    menuBtn.appendChild(dot);
  }
  menuBtn.addEventListener("mousedown", function (ev) { ev.preventDefault(); });
  menuBtn.addEventListener("click", function (ev) {
    ev.preventDefault();
    ev.stopPropagation();
    const note = currentNote();
    if (!note || note.trashed || note.archived) { return; }
    /* v2.120: an external figure's button opens its
       own menu; the record lookup below is not for it. */
    if (isExternalImageFigure(el)) {
      openExternalImageMenu(menuBtn, el);
      return;
    }
    const attId = el.getAttribute("data-attachment-id");
    const att = (note.attachments || []).find(function (a) {
      return a.id === attId;
    });
    if (!att) { return; }
    const menu = document.getElementById("attMenu");
    if (attMenuEl === el && menu && !menu.classList.contains("hidden")) {
      closeAttMenu();
      return;
    }
    attMenuNote = note;
    attMenuAtt = att;
    attMenuEl = el;
    showAttMenu(menuBtn);
  });
  el.appendChild(menuBtn);
}

function deselectAttachment() {
  closeAttMenu();
  if (!selectedAttachmentEl) { return; }
  selectedAttachmentEl.classList.remove("ss-selected");
  selectedAttachmentEl.querySelectorAll(".ss-grip, .ss-att-menu-btn")
    .forEach(function (n) { n.remove(); });
  selectedAttachmentEl = null;
}

/* Show the shared image menu under its button, clamped into the
   viewport the way the link popup is. The caller unhides it first
   only through here, so the size measured is the size on screen. */
function showAttMenu(anchor) {
  /* v2.14.1: the two attachment menus never stack; opening one
     closes the other. */
  closeAttCardMenu();
  const menu = document.getElementById("attMenu");
  if (!menu || !anchor) { return; }
  /* v2.11: the menu's stateful rows (the caption check, the
     thumbnail label, the view mode dots) are refreshed from the
     figure and the note every time it opens. */
  refreshAttMenuStates();
  menu.classList.remove("hidden");
  const rect = anchor.getBoundingClientRect();
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  let left = Math.min(rect.right - width, window.innerWidth - width - 8);
  left = Math.max(8, left);
  let top = rect.bottom + 6;
  if (top + height > window.innerHeight - 8) {
    top = Math.max(8, rect.top - height - 6);
  }
  menu.style.left = left + "px";
  menu.style.top = top + "px";
}

function closeAttMenu() {
  closeAttAlignMenu();
  /* v2.120: the external image menu is the image
     menu's sibling; closing the one closes the other,
     so the two never stack. */
  closeExtMenu();
  const menu = document.getElementById("attMenu");
  if (menu) { menu.classList.add("hidden"); }
  attMenuNote = null;
  attMenuAtt = null;
  attMenuEl = null;
}

/* v2.11: refresh the image menu's stateful rows from the figure
   the menu was opened from and its note: Show caption carries its
   dot while the caption is on, the thumbnail row names the action
   that applies (set, or remove when this image already is the
   note's thumbnail), and the VIEW AS rows dot the current mode. */
function refreshAttMenuStates() {
  const note = attMenuNote;
  const att = attMenuAtt;
  const el = attMenuEl;
  if (!note || !att || !el) { return; }
  const capItem = document.getElementById("attCaptionItem");
  if (capItem) {
    capItem.classList.toggle("current",
      el.getAttribute("data-ss-caption") === "1");
  }
  const thumbLabel = document.getElementById("attThumbnailLabel");
  if (thumbLabel) {
    thumbLabel.textContent = note.thumbnail === att.id
      ? "Remove note thumbnail" : "Set as note thumbnail";
  }
  /* v2.46: Edit sketch shows only for a marked sketch
     (see isSketchAttachment); every other image keeps the
     menu it has always had. */
  const sketchItem = document.getElementById("attSketchItem");
  if (sketchItem) {
    sketchItem.classList.toggle("hidden",
      !isSketchAttachment(att, el));
  }
  const view = imageViewOf(el);
  const titleItem = document.getElementById("attViewTitleItem");
  const previewItem = document.getElementById("attViewPreviewItem");
  if (titleItem) { titleItem.classList.toggle("current", view === "title"); }
  if (previewItem) { previewItem.classList.toggle("current", view === "preview"); }
}

/* ----- v2.11: the alignment submenu --------------------------------
   A second fixed card beside the image menu, listing the
   alignments with a dot on the current one (read through
   imageAlignOf, so a figure with no saved alignment dots Left).
   Escape closes the submenu before the menu (see the keydown
   wiring), and choosing an alignment applies it, closes both
   menus, and saves through the ordinary dirty path.
   v2.25: a seventh entry, Free move, joins the six placement
   alignments. It is a saved data-ss-align value like the
   others; what it changes is the figure's drag, which can
   then drop at any caret point in the text flow (see
   moveFreeAttachmentToPoint). */
function attAlignMenuOpen() {
  const sub = document.getElementById("attAlignMenu");
  return !!sub && !sub.classList.contains("hidden");
}

function showAttAlignMenu() {
  const menu = document.getElementById("attMenu");
  const sub = document.getElementById("attAlignMenu");
  const item = document.getElementById("attAlignItem");
  if (!menu || !sub || !item || !attMenuEl) { return; }
  const current = imageAlignOf(attMenuEl);
  sub.querySelectorAll("button[data-align]").forEach(function (btn) {
    btn.classList.toggle("current",
      btn.getAttribute("data-align") === current);
  });
  sub.classList.remove("hidden");
  item.setAttribute("aria-expanded", "true");
  const mRect = menu.getBoundingClientRect();
  const iRect = item.getBoundingClientRect();
  const width = sub.offsetWidth;
  const height = sub.offsetHeight;
  let left = mRect.right + 6;
  if (left + width > window.innerWidth - 8) {
    left = Math.max(8, mRect.left - width - 6);
  }
  let top = iRect.top - 6;
  if (top + height > window.innerHeight - 8) {
    top = Math.max(8, window.innerHeight - height - 8);
  }
  sub.style.left = left + "px";
  sub.style.top = top + "px";
}

function closeAttAlignMenu() {
  const sub = document.getElementById("attAlignMenu");
  if (sub) { sub.classList.add("hidden"); }
  const item = document.getElementById("attAlignItem");
  if (item) { item.setAttribute("aria-expanded", "false"); }
}

function toggleAttAlignMenu() {
  if (attAlignMenuOpen()) { closeAttAlignMenu(); }
  else { showAttAlignMenu(); }
}

/* Apply one alignment choice to a figure. The attribute is the
   saved state; two conversions are deliberate:
     - Fill width discards the figure's chosen pixel width (and the
       max-width lift a chosen size carries): filling the column IS
       the size choice while Fill is on. Coming back out, starting
       a grip drag converts a Fill figure to Center at its current
       rendered width (see startAttachmentResize). (Through
       v2.11 the size presets did this too; v2.12 removed them.)
     - Left align is stored as ABSENCE of the attribute, the
       original rendering; the value "left" is still honored when a
       file carries it (see the CSS), it is just never written. */
function applyImageAlign(el, mode) {
  if (!el) { return; }
  if (mode === "left") { el.removeAttribute("data-ss-align"); }
  else { el.setAttribute("data-ss-align", mode); }
  if (mode === "fill") {
    el.style.removeProperty("width");
    el.style.removeProperty("max-width");
  }
}

/* Convert a Fill width figure back to a sized one, at the width it
   currently renders, centered. The grip drag calls this first: it
   is about to set an explicit pixel width, which Fill's full
   column rule would otherwise fight. */
function convertFillFigureToSized(el) {
  if (!el || el.getAttribute("data-ss-align") !== "fill") { return; }
  const px = el.getBoundingClientRect().width;
  el.setAttribute("data-ss-align", "center");
  if (px) { applyImageFigureWidth(el, px); }
}

function runAttAlignChoice(mode) {
  const el = attMenuEl;
  closeAttMenu();
  if (!el || IMAGE_ALIGN_VALUES.indexOf(mode) < 0) { return; }
  applyImageAlign(el, mode);
  markDirty();
  /* v2.25: choosing Free move explains itself in one toast:
     the figure stays in the text flow and can now be dragged
     to any spot in it. */
  if (mode === "free") {
    toast("Free move is on: drag the image to any spot in the text.");
  }
}

/* v1.7.2: the sanity ceiling for a grip drag, in pixels. Sizing is
   free (an image may be narrower or wider than the note column;
   that freedom is the point of the v1.7.2 rework), so there is no
   column clamp anymore. This ceiling only stops a wild pointer
   excursion from producing an absurd stored width. */
const ATTACHMENT_RESIZE_MAX_PX = 6000;

/* The resize width rule, kept pure and side effect free so it can be
   unit tested on its own: east side grips (ne, se) add the pointer's
   horizontal travel to the starting width, west side grips (nw, sw)
   subtract it, and the result is clamped between the 40px floor and
   the ATTACHMENT_RESIZE_MAX_PX ceiling. Only the block's width is
   ever set, so the aspect ratio is preserved by the image's
   automatic height. (Before v1.7.2 the caller passed the editor
   column width as a fourth argument, and the result could never
   exceed the column.) */
function resizedImageWidth(startWidth, dx, corner) {
  const signed = (corner === "ne" || corner === "se") ? dx : -dx;
  const next = Math.round(startWidth + signed);
  return Math.max(40, Math.min(ATTACHMENT_RESIZE_MAX_PX, next));
}

/* Dragging any grip resizes the image live, through the BLOCK's
   width (applyImageFigureWidth): since v1.7.2 the block carries
   the size and the image fills it, so the selection frame, which
   anchors to the block, tracks the image exactly at every moment
   of the drag, growing past the column or shrinking inside it.
   The note is marked dirty once, on release, not on every
   pointer move. */
function startAttachmentResize(ev, corner) {
  ev.preventDefault();
  ev.stopPropagation();
  const el = selectedAttachmentEl;
  if (!el) { return; }
  /* v2.119: the history suspends BEFORE the drag's
     first mutation (the Fill conversion below), so
     the whole drag lands as one step at its end. */
  editorHistorySuspend();
  /* v2.11: a grip drag on a Fill width figure converts it to a
     sized, centered figure at its rendered width first, so the
     drag has a pixel width to work from (see applyImageAlign). */
  convertFillFigureToSized(el);
  const img = el.querySelector("img.ss-att-img");
  /* v2.120: an external figure whose source failed
     carries its placeholder instead of an <img>; its
     grips still resize the block, which is all the
     drag ever sets. Attachment blocks keep the
     standing rule. */
  if (!img && !isExternalImageFigure(el)) { return; }
  const startX = ev.clientX;
  /* The block's rendered width is the size being dragged: for a
     sized block it is the chosen width; for an unsized one it is
     the image's natural rendered width, which the first move then
     turns into a chosen size on the block. */
  const startWidth = el.getBoundingClientRect().width ||
    (el.style && el.style.width ? parseFloat(el.style.width) : 0) || 200;
  function onMove(e2) {
    applyImageFigureWidth(el,
      resizedImageWidth(startWidth, e2.clientX - startX, corner));
  }
  function onUp() {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    markDirty();
    /* v2.119: the drag was one change, so the
       history resumes with one signal for it. */
    editorHistoryResume(true);
  }
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
}

/* Open one attachment in a new browser tab through its provider,
   following the same guards as the Download path below. The bytes
   are fetched with the user's own sign in and shown from a
   temporary object URL, revoked a minute later (a fresh tab needs
   time to load it; the note itself keeps no reference to it). */
async function openAttachment(att) {
  if (!state.online) {
    toast("Opening an attachment needs an internet connection. You appear to be offline.", true);
    return;
  }
  const driver = providers[att.provider];
  if (!driver) {
    toast("Unknown storage provider for this attachment.", true);
    return;
  }
  const status = await driver.getStatus();
  if (!status.connected) {
    toast("Sign in with " + providerLabel(att.provider) +
      " to open \"" + att.name + "\".", true);
    return;
  }
  try {
    const blob = await driver.download(att.fileId);
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  } catch (err) {
    toast("Open failed: " + err.message, true);
  }
}

/* One click in the shared image menu. v2.11 rebuilt the menu to
   the full feature set; the dispatch below routes each item to its
   section. Delete file routes through the undoable deletion
   engine (see the attachments section below) and drops the
   selection, since the block is leaving the note. The Image
   alignment item is the one action that does NOT close the menu:
   it opens the alignment submenu beside it instead.
   v2.12: the Small, Medium, Large, and Original size items (and
   their branches here) are removed at Chris's direction: resizing
   an image is the corner grips' job now. */
function runAttMenuAction(action) {
  if (action === "align") {
    toggleAttAlignMenu();
    return;
  }
  const note = attMenuNote;
  const att = attMenuAtt;
  const el = attMenuEl;
  closeAttMenu();
  if (!note || !att) { return; }
  if (action === "preview") {
    openImageLightbox(note, att, el).catch(function (err) {
      toast(err.message, true);
    });
    return;
  }
  if (action === "sketchEdit") {
    openSketchEditorFor(note, att, el).catch(function (err) {
      toast(err.message, true);
    });
    return;
  }
  if (action === "edit") {
    openImageEditor(note, att, el, "annotate").catch(function (err) {
      toast(err.message, true);
    });
    return;
  }
  if (action === "crop") {
    openImageEditor(note, att, el, "crop").catch(function (err) {
      toast(err.message, true);
    });
    return;
  }
  if (action === "download") {
    downloadAttachment(att).catch(function (err) { toast(err.message, true); });
    return;
  }
  if (action === "print") {
    printImage(note, att).catch(function (err) { toast(err.message, true); });
    return;
  }
  if (action === "transcribe") {
    transcribeImage(note, att, el).catch(function (err) {
      toast("Transcribe failed: " + err.message, true);
    });
    return;
  }
  if (action === "caption") {
    toggleImageCaption(el, att);
    return;
  }
  if (action === "rename") {
    renameAttachment(note, att, el).catch(function (err) {
      toast(err.message, true);
    });
    return;
  }
  if (action === "thumbnail") {
    toggleNoteThumbnail(note, att);
    return;
  }
  if (action === "viewTitle") {
    setImageView(note, att, el, "title");
    return;
  }
  if (action === "viewPreview") {
    setImageView(note, att, el, "preview");
    return;
  }
  if (action === "remove") {
    deselectAttachment();
    scheduleAttachmentDelete(note, att);
  }
}

/* v2.11: fetch one attachment's bytes through its provider, with
   the guards the Open and Download paths have always applied
   (the app must be online, the provider must exist and be signed
   in), as a thrown Error with a user ready message. Shared by the
   lightbox, the image editor, image printing, and transcribe,
   which each present the failure their own way. */
async function fetchAttachmentBlob(att) {
  if (!state.online) {
    throw new Error("This needs an internet connection. You appear to be offline.");
  }
  const driver = providers[att.provider];
  if (!driver) {
    throw new Error("Unknown storage provider for this attachment.");
  }
  const status = await driver.getStatus();
  if (!status.connected) {
    throw new Error("Sign in with " + providerLabel(att.provider) +
      " to use \"" + att.name + "\".");
  }
  return driver.download(att.fileId);
}

/* ----- v2.11: full screen preview --------------------------------
   A dark lightbox showing the image contained in the viewport.
   The already hydrated image's own blob URL is reused when there
   is one (it is owned by the note's URL set and revoked by the
   note switch, so the lightbox never revokes it); otherwise the
   bytes are fetched and the fresh URL is the lightbox's own,
   revoked when it closes. */
let lightboxOwnUrl = null;

async function openImageLightbox(note, att, el) {
  const box = document.getElementById("imgLightbox");
  const img = document.getElementById("imgLightboxImg");
  if (!box || !img) { return; }
  const liveImg = el ? el.querySelector("img.ss-att-img") : null;
  const liveSrc = liveImg && liveImg.src &&
    liveImg.src.indexOf("blob:") === 0 ? liveImg.src : null;
  if (liveSrc) {
    img.src = liveSrc;
  } else {
    let blob;
    try {
      blob = await fetchAttachmentBlob(att);
    } catch (err) {
      toast(err.message, true);
      return;
    }
    lightboxOwnUrl = URL.createObjectURL(blob);
    img.src = lightboxOwnUrl;
  }
  img.alt = att.name;
  box.classList.remove("hidden");
}

function closeImageLightbox() {
  const box = document.getElementById("imgLightbox");
  if (box) { box.classList.add("hidden"); }
  const img = document.getElementById("imgLightboxImg");
  if (img) { img.removeAttribute("src"); }
  if (lightboxOwnUrl) {
    URL.revokeObjectURL(lightboxOwnUrl);
    lightboxOwnUrl = null;
  }
}

function imageLightboxOpen() {
  const box = document.getElementById("imgLightbox");
  return !!box && !box.classList.contains("hidden");
}

/* ----- v2.11: captions --------------------------------------------
   Toggling the caption on creates the figcaption with the
   record's name as its first text; toggling off removes the
   attribute and the element together, so an off caption leaves
   nothing behind in the saved note. The caption text itself is
   edited by clicking it (see the wiring), never by typing in
   place: the figure is contenteditable false by design. */
function toggleImageCaption(el, att) {
  if (!el) { return; }
  if (el.getAttribute("data-ss-caption") === "1") {
    el.removeAttribute("data-ss-caption");
    const cap = el.querySelector("figcaption.ss-caption");
    if (cap) { cap.remove(); }
  } else {
    el.setAttribute("data-ss-caption", "1");
    appendImageCaption(el, att, null);
  }
  markDirty();
}

function editImageCaption(figEl) {
  const note = currentNote();
  if (!note || note.trashed || note.archived) { return; }
  const next = prompt("Caption", figEl.textContent);
  if (next === null || next === undefined) { return; }
  if (next === figEl.textContent) { return; }
  figEl.textContent = next;
  markDirty();
}

/* ----- v2.11: view as (Title and Preview) --------------------------
   The mode is the data-ss-view attribute: "title" is stored,
   Preview is its absence (the ordinary image, byte identical to
   what earlier versions saved). Switching rebuilds the runtime
   face and saves through the ordinary dirty path. */
function setImageView(note, att, el, mode) {
  if (!el) { return; }
  if (mode === "title") { el.setAttribute("data-ss-view", "title"); }
  else { el.removeAttribute("data-ss-view"); }
  applyImageTitleFace(el, att);
  markDirty();
}

/* ----- v2.11: note thumbnail ---------------------------------------
   The choice lives on the note object and in its front matter
   (the thumbnail line, see serializeNote). The list card shows it
   while the id resolves to an image record on the note; removing
   the choice, or the attachment going away, quietly ends it. */
function toggleNoteThumbnail(note, att) {
  if (!note || !att) { return; }
  note.thumbnail = note.thumbnail === att.id ? null : att.id;
  if (currentNote() === note) { markDirty(); }
  renderNoteList();
}

/* ----- v2.11: rename ------------------------------------------------
   The record's name is what captions start from, what the Title
   face shows, and what downloads are called. The Drive file is
   renamed to the new storage name on a best effort basis: a Drive
   failure never rolls the record back, and no toast reports the
   Drive part. The caption text is the note's own content by now
   and is deliberately NOT rewritten when it happens to match the
   old name. */
async function renameAttachment(note, att, el) {
  /* v2.14.1: the prompt names the general thing, since the audio
     card menu runs this same flow for recordings now. */
  const next = prompt("Rename attachment", att.name);
  if (next === null || next === undefined) { return; }
  const name = String(next).trim();
  if (!name || name === att.name) { return; }
  att.name = name;
  att.storageName = att.id + "__" + sanitizeFileName(name);
  if (el) {
    const img = el.querySelector("img.ss-att-img");
    if (img) { img.alt = name; }
    applyImageTitleFace(el, att);
  }
  if (currentNote() === note) { markDirty(); }
  const driver = providers[att.provider];
  if (driver && typeof driver.rename === "function" && state.online) {
    try {
      await driver.rename(att.fileId, att.storageName);
    } catch (err) { /* best effort, see the section comment */ }
  }
}

/* ----- v2.11: print one image ---------------------------------------
   The single image counterpart of the note print view: the same
   one named builder shape (a whole standalone document string,
   unit testable), opened through the same window mechanism
   exportNotePdf uses. The image rides a fresh object URL from the
   fetched bytes; the parent revokes it a minute later, the same
   patience openAttachment gives a fresh tab, since the print
   window needs time to load and print it. */
function buildImagePrintDocument(note, att, imgUrl) {
  const title = escapeHtml(note.title || "Untitled note");
  return "<!DOCTYPE html>\n<html><head><meta charset=\"UTF-8\">" +
    "<title>" + title + "</title>" +
    "<style>" +
    "body{font-family:Georgia,'Times New Roman',serif;color:#10231A;" +
    "max-width:720px;margin:40px auto;padding:0 24px;line-height:1.55;}" +
    "h1{font-size:22px;margin:0 0 16px;}" +
    "img{max-width:100%;height:auto;display:block;}" +
    "@media print{body{margin:0 auto;}}" +
    "</style></head><body>" +
    "<h1>" + title + "</h1>" +
    "<img src=\"" + imgUrl + "\" alt=\"" + escapeHtml(att.name) + "\">" +
    "<script>window.addEventListener('load',function(){" +
    "setTimeout(function(){window.print();},60);});</scr" + "ipt>" +
    "</body></html>";
}

async function printImage(note, att) {
  let blob;
  try {
    blob = await fetchAttachmentBlob(att);
  } catch (err) {
    toast(err.message, true);
    return;
  }
  const url = URL.createObjectURL(blob);
  const win = window.open("", "_blank");
  if (!win) {
    URL.revokeObjectURL(url);
    toast("The print window was blocked by the browser. Allow popups " +
      "for this site, then choose Print again.", true);
    return;
  }
  win.document.open();
  win.document.write(buildImagePrintDocument(note, att, url));
  win.document.close();
  try { win.focus(); } catch (err) { /* focus is best effort */ }
  setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
}

/* ----- v2.11: transcribe (image text recognition) -------------------
   Reading the text out of an image needs a real OCR engine; the
   app ships none, so Tesseract.js is loaded from its CDN the
   first time Transcribe is used, and only then. Nothing is fetched
   at startup, the service worker never sees the traffic (cross
   origin requests pass it by, as always), and signing out or
   closing the app leaves nothing behind: the worker is terminated
   after every run. The one outside dependency in this menu, and
   it fails closed: offline, a failed load, or a failed read shows
   an error and inserts nothing. */
const TESSERACT_SCRIPT_URL =
  "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
const TESSERACT_WORKER_URL =
  "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js";
const TESSERACT_CORE_URL =
  "https://cdn.jsdelivr.net/npm/tesseract.js-core@5/";

let tesseractLoadPromise = null;

function loadTesseract() {
  if (window.Tesseract && window.Tesseract.createWorker) {
    return Promise.resolve(window.Tesseract);
  }
  if (tesseractLoadPromise) { return tesseractLoadPromise; }
  tesseractLoadPromise = new Promise(function (resolve, reject) {
    const script = document.createElement("script");
    script.src = TESSERACT_SCRIPT_URL;
    script.onload = function () {
      if (window.Tesseract && window.Tesseract.createWorker) {
        resolve(window.Tesseract);
      } else {
        reject(new Error("The text recognition library did not initialize."));
      }
    };
    script.onerror = function () {
      reject(new Error("The text recognition library could not be loaded."));
    };
    document.head.appendChild(script);
  });
  /* A failed load may be retried on the next Transcribe. */
  tesseractLoadPromise.catch(function () { tesseractLoadPromise = null; });
  return tesseractLoadPromise;
}

/* Start a worker, tolerating the v5 API's argument shapes: the
   documented createWorker(languages, oem, options) first, then the
   plainer forms. The first shape that yields a worker with a
   recognize method wins; anything else is a load failure. */
async function createTesseractWorker(T, onProgress) {
  const options = {
    workerPath: TESSERACT_WORKER_URL,
    corePath: TESSERACT_CORE_URL,
    logger: onProgress
  };
  const attempts = [];
  const oem = T.OEM ? (T.OEM.DEFAULT !== undefined
    ? T.OEM.DEFAULT : T.OEM.LSTM_ONLY) : undefined;
  if (oem !== undefined) {
    attempts.push(function () { return T.createWorker("eng", oem, options); });
  }
  attempts.push(function () { return T.createWorker("eng", options); });
  attempts.push(function () { return T.createWorker("eng"); });
  let lastErr = null;
  for (const attempt of attempts) {
    try {
      const worker = await attempt();
      if (worker && typeof worker.recognize === "function") { return worker; }
    } catch (err) { lastErr = err; }
  }
  throw lastErr || new Error("The text recognition worker could not start.");
}

/* The transcribe run's own status line in the toast box, updated
   as the OCR logger reports progress and removed when the run
   ends, however it ends. */
let transcribeStatusEl = null;
function showTranscribeStatus(text) {
  const box = document.getElementById("toastBox");
  if (!box) { return; }
  if (!transcribeStatusEl) {
    transcribeStatusEl = document.createElement("div");
    transcribeStatusEl.className = "toast";
    box.appendChild(transcribeStatusEl);
  }
  transcribeStatusEl.textContent = text;
}
function hideTranscribeStatus() {
  if (transcribeStatusEl && transcribeStatusEl.parentNode) {
    transcribeStatusEl.parentNode.removeChild(transcribeStatusEl);
  }
  transcribeStatusEl = null;
}

/* ----- v2.73: background transcription -----------------------
   A transcription used to be a page errand: the recognized
   text was inserted at the attachment's live element, and if
   the note had been left by the time the engine finished,
   the guard at the end of each transcribe run threw the text
   away ("no longer in the open note"). Chris asked not to
   have to wait on the page, so a finished transcription is
   now a JOB, bound to the note and the attachment by id, and
   its landing (attemptTranscriptLanding) puts the text after
   the attachment's card in that note, wherever the editor
   has gone:

   - The note is open and its editor is settled: the text is
     inserted at the card's live element, exactly as before,
     and the ordinary autosave carries it to the store.
   - The note is open with unsaved edits: the job PARKS. The
     editor is never rewritten under the user's fingers, and
     the note's stored object is never touched either (the
     next collect would overwrite it from the editor and lose
     the text). The parked job is retried at the moments the
     editor provably settles: the end of every autosave pass
     and the end of every note switch. Once the user's own
     save has landed, the editor is clean and the first case
     applies; if the user has switched away by then, the
     third case does.
   - The note is not open: the text is inserted into the
     note's stored body, after the attachment's placeholder,
     and saved through saveNoteToRepo, the ordinary save,
     with its conflict rules, so the text is there on return
     and survives a reload.

   Three guarantees the seam is built to keep: the user's
   edits are never overwritten (a dirty editor and its note
   object are both left strictly alone); the transcript is
   never discarded (a job stays registered until it lands or
   fails honestly); and the text lands exactly once (the
   registry entry is claimed, deleted, in the same breath as
   the insertion, and landings for one note are serialized
   on a per note chain, so two jobs for the same note can
   never read-modify-write its body over each other).

   The only failures to land: the note was deleted, moved to
   Trash, or archived while the engine ran (trashed and
   archived notes are read only to every save this app
   makes, so a background save follows the same rule), the
   attachment record was removed, or the card itself is no
   longer in the note's text. Each is reported by a toast
   that says what happened; the text is never inserted into
   a different note.

   v2.76 addendum: an AUDIO job's payload changed shape.
   The transcript no longer lands as body paragraphs; it
   is written onto the attachment's record (its text, its
   timed units, and the model that read it), and the card
   renders it in its own section (see the transcript
   section block). The seam, the parking, the claiming,
   and the failure rules are unchanged; only what is
   written differs, and only for audio. Image jobs still
   land their lines as a body paragraph, exactly as above.

   Concurrency: one transcription per attachment at a time
   (a second start is refused while one runs or is parked).
   The Whisper pipeline is a single shared instance, so
   audio jobs are serialized through runSpeechJob; Tesseract
   builds a worker per run, so image jobs run independently,
   and an image job and an audio job may overlap. The shared
   status line is held by count (acquireTranscribeStatus /
   releaseTranscribeStatus): the latest update wins the
   text, and the line stands until the last running job
   ends.

   The platform boundary, stated plainly: a job lives in
   this page's memory. Leaving the note, moving around the
   app, or switching tabs with the app open are all covered;
   closing the app still ends a run, and nothing persists
   partway. */
const transcriptionJobs = new Map();
const activeTranscriptions = new Set();
const transcriptLandingChains = new Map();
let transcribeStatusHolds = 0;

function transcriptionKey(noteId, attId) {
  return noteId + "\n" + attId;
}

function acquireTranscribeStatus() {
  transcribeStatusHolds++;
}

function releaseTranscribeStatus() {
  transcribeStatusHolds = Math.max(0, transcribeStatusHolds - 1);
  if (transcribeStatusHolds === 0) { hideTranscribeStatus(); }
}

/* The transcript paragraph, one shape for both engines and
   both landing paths: plain text lines in one paragraph,
   <br> between lines, built from text nodes only, because
   recognized words are data, never markup. */
function buildTranscriptParagraph(lines) {
  const p = document.createElement("p");
  lines.forEach(function (line, idx) {
    p.appendChild(document.createTextNode(line));
    if (idx < lines.length - 1) {
      p.appendChild(document.createElement("br"));
    }
  });
  return p;
}

/* Serialize the Whisper pipeline's runs (see the block
   head): fn runs when every earlier speech job's run has
   settled, and the chain survives a failed run. */
let speechJobChain = Promise.resolve();
function runSpeechJob(fn) {
  const run = speechJobChain.then(fn, fn);
  speechJobChain = run.then(function () {}, function () {});
  return run;
}

/* Serialize one note's landings (see the block head): each
   attempt runs after the previous attempt for the same
   note settles, so two stored body rewrites for one note
   can never interleave. Resolves with the attempt's
   outcome: "landed", "parked", "failed", or "gone" (the
   job was already claimed by an earlier attempt). */
function queueTranscriptLanding(job) {
  const prev = transcriptLandingChains.get(job.noteId) ||
    Promise.resolve();
  const run = prev.then(function () {
    return attemptTranscriptLanding(job);
  }, function () {
    return attemptTranscriptLanding(job);
  });
  const tail = run.then(function () {}, function () {});
  transcriptLandingChains.set(job.noteId, tail);
  tail.then(function () {
    if (transcriptLandingChains.get(job.noteId) === tail) {
      transcriptLandingChains.delete(job.noteId);
    }
  });
  return run;
}

async function attemptTranscriptLanding(job) {
  if (transcriptionJobs.get(job.key) !== job) { return "gone"; }
  job.parked = false;
  const isAudio = job.kind === "audio";
  const thing = isAudio ? "recording" : "image";
  const titleOf = function (n) {
    return n.title || "Untitled note";
  };
  const fail = function (reason) {
    transcriptionJobs.delete(job.key);
    toast("The text from \"" + job.attName + "\" could not be " +
      "inserted: " + reason, true);
    return "failed";
  };
  const note = findNoteById(job.noteId);
  if (!note) {
    return fail("its note was deleted while the transcription " +
      "was running.");
  }
  if (note.trashed) {
    return fail("its note was moved to Trash while the " +
      "transcription was running, and trashed notes are read " +
      "only.");
  }
  if (note.archived) {
    return fail("its note was archived while the transcription " +
      "was running, and archived notes are read only.");
  }
  const att = (note.attachments || []).find(function (a) {
    return a.id === job.attId;
  });
  if (!att) {
    return fail("the " + thing + " was removed from the note " +
      "while the transcription was running.");
  }
  if (currentNote() === note) {
    /* The editor is showing this note. A switch settle in
       flight, or edits the autosave has not landed yet, both
       mean hands off: park, and the drains retry when the
       editor settles. */
    if (noteSettleInFlight || swEditorUnsettled()) {
      job.parked = true;
      return "parked";
    }
    const bodyEl = document.getElementById("noteBody");
    const el = bodyEl ? bodyEl.querySelector(
      ".ss-attachment[data-attachment-id=\"" + job.attId + "\"]")
      : null;
    if (!el) {
      return fail("the " + thing + " is no longer in the " +
        "note's text.");
    }
    if (isAudio) {
      /* v2.76: an audio job lands on the record, not in
         the body: the transcript is written onto the
         note's own record for the attachment (replacing
         any earlier one), the open card's section is
         rebuilt from it in place, and the dirty mark
         carries the record into the note's next save
         like any attachment edit. The editor's text is
         never touched. */
      att.transcript = sanitizeTranscript(job.transcript);
      renderTranscriptSection(el, att);
    } else {
      el.after(buildTranscriptParagraph(job.lines));
    }
    transcriptionJobs.delete(job.key);
    markDirty();
    toast("Text inserted below the " + thing + " in \"" +
      titleOf(note) + "\".");
    return "landed";
  }
  /* The note is not open: its stored body is the text of
     record. Insert after the attachment's placeholder and
     save through the ordinary save. The registry entry is
     claimed in the same breath as the body changes, before
     the save is awaited, so no second attempt can insert
     the text again; if the save itself then fails, the text
     stands in the note on this device exactly once and the
     failure is reported as a save failure, the way a failed
     save anywhere in this app is reported. */
  let claimed = false;
  try {
    await ensureNoteBodyLoaded(note);
    if (note.trashed || note.archived) {
      return fail("its note left the notebook while the " +
        "transcription was running, and it is read only now.");
    }
    const rec = (note.attachments || []).find(function (a) {
      return a.id === job.attId;
    });
    if (!rec) {
      return fail("the " + thing + " was removed from the " +
        "note while the transcription was running.");
    }
    const holder = document.createElement("div");
    holder.innerHTML = note.body || "";
    const ph = holder.querySelector(
      ".ss-attachment[data-attachment-id=\"" + job.attId + "\"]");
    if (!ph) {
      return fail("the " + thing + " is no longer in the " +
        "note's text.");
    }
    if (isAudio) {
      /* v2.76: the stored body is not touched at all: the
         transcript goes onto the loaded note's record for
         the attachment, and the save below writes the
         file with it, the record carrying it exactly the
         way serializeNote writes every record field. The
         registry entry is claimed in the same breath,
         before the save is awaited, exactly as the body
         path claims it. */
      rec.transcript = sanitizeTranscript(job.transcript);
    } else {
      ph.after(buildTranscriptParagraph(job.lines));
      note.body = canonicalizeAttachmentPlaceholders(holder.innerHTML);
      note.previewText = htmlToText(note.body).slice(0, 140);
    }
    transcriptionJobs.delete(job.key);
    claimed = true;
    await saveNoteToRepo(note);
    renderAll();
    toast("Text inserted below the " + thing + " in \"" +
      titleOf(note) + "\".");
    return "landed";
  } catch (err) {
    if (claimed) {
      /* The text is in the note on this device, exactly
         once; only its save failed. */
      toast("The text was added to \"" + titleOf(note) +
        "\" on this device, but its save failed: " +
        err.message, true);
      return "landed";
    }
    return fail("the note's stored text could not be updated: " +
      err.message);
  }
}

/* Retry every parked job. Called where the editor provably
   settles: at the end of every autosave pass (the user's own
   save just landed) and at the end of every note switch
   (the note that was left is no longer open, so its stored
   body can take the text). Attempts are guarded inside
   attemptTranscriptLanding, so a drain that arrives early
   simply parks the job again. */
function drainParkedTranscripts() {
  transcriptionJobs.forEach(function (job) {
    if (job.parked) { void queueTranscriptLanding(job); }
  });
}

async function transcribeImage(note, att, el) {
  /* v2.73: one transcription per attachment at a time (see
     the background transcription block above); a second
     start while one is running or parked is refused, so a
     result can never land twice. */
  const key = transcriptionKey(note.id, att.id);
  if (activeTranscriptions.has(key) || transcriptionJobs.has(key)) {
    toast("\"" + att.name + "\" is already being transcribed.", true);
    return;
  }
  activeTranscriptions.add(key);
  try {
    if (!state.online) {
      toast("Transcribing needs an internet connection: the text " +
        "recognition library loads on first use. You appear to be offline.", true);
      return;
    }
    let blob;
    try {
      blob = await fetchAttachmentBlob(att);
    } catch (err) {
      toast(err.message, true);
      return;
    }
    acquireTranscribeStatus();
    showTranscribeStatus("Loading text recognition...");
    let worker = null;
    try {
      const T = await loadTesseract();
      worker = await createTesseractWorker(T, function (m) {
        if (m && m.status === "recognizing text" &&
            typeof m.progress === "number") {
          showTranscribeStatus("Reading the text in \"" + att.name +
            "\": " + Math.round(m.progress * 100) + "%");
        }
      });
      const result = await worker.recognize(blob);
      const text = result && result.data &&
        typeof result.data.text === "string" ? result.data.text : "";
      const trimmed = text.trim();
      if (!trimmed) {
        toast("No text found in the image.");
        return;
      }
      /* v2.73: the words are a job now, not a page errand: the
         landing puts them after the image in the note they
         belong to, wherever the editor has gone (see
         attemptTranscriptLanding in the background block). */
      const job = { key: key, noteId: note.id, attId: att.id,
        kind: "image", attName: att.name,
        lines: trimmed.split(/\r?\n/), parked: false };
      transcriptionJobs.set(key, job);
      const outcome = await queueTranscriptLanding(job);
      if (outcome === "parked") {
        toast("The text from \"" + att.name + "\" will be added " +
          "to \"" + (note.title || "Untitled note") + "\" as soon " +
          "as its current edits have saved.");
      }
    } catch (err) {
      toast("Transcribe failed: " + err.message, true);
    } finally {
      releaseTranscribeStatus();
      if (worker && typeof worker.terminate === "function") {
        try { await worker.terminate(); } catch (e) { /* already gone */ }
      }
    }
  } finally {
    activeTranscriptions.delete(key);
  }
}

/* ----- v2.14.1: the audio card menu --------------------------------
   An audio attachment's card carries no inline buttons (see
   hydrateOneAttachment): a three dot button at its top right
   opens this one shared menu, #attCardMenu, a fixed card outside
   #noteBody like the image menu, so it can never be saved into a
   note. The menu remembers the note, the record, and the card it
   was opened from, the image menu's own pattern. Download runs
   the ordinary download path; Rename runs the image menu's
   rename flow and repaints the name the card shows; Delete is
   the undoable attachment delete, the very call the card's old
   Remove button made; Transcribe reads the saved recording's
   words on device (the section after this one). In a read only
   note (Trash, Archive) the menu still opens, with Download
   alone enabled: the file card rule has always been that
   Download works there while anything that changes the note or
   the record does not, and the disabled rows wear the menu's
   existing disabled style. */
let attCardMenuNote = null;
let attCardMenuAtt = null;
let attCardMenuEl = null;

/* The card's three dot button, wearing the image button's pill
   look under its own class (see the CSS note), so no image
   selection wiring can mistake a file card for an image. Its
   mousedown is swallowed like the card buttons', so opening the
   menu never moves the editor caret. */
function buildAttCardMenuButton(note, att, el) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ss-card-menu-btn";
  btn.title = "Audio options";
  btn.setAttribute("aria-label", "Audio options");
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement("span");
    dot.className = "ss-dot";
    btn.appendChild(dot);
  }
  btn.addEventListener("mousedown", function (ev) { ev.preventDefault(); });
  btn.addEventListener("click", function (ev) {
    ev.preventDefault();
    ev.stopPropagation();
    const menu = document.getElementById("attCardMenu");
    if (attCardMenuEl === el && menu &&
        !menu.classList.contains("hidden")) {
      closeAttCardMenu();
      return;
    }
    attCardMenuNote = note;
    attCardMenuAtt = att;
    attCardMenuEl = el;
    showAttCardMenu(btn);
  });
  return btn;
}

function attCardMenuIsOpen() {
  const menu = document.getElementById("attCardMenu");
  return !!menu && !menu.classList.contains("hidden");
}

/* Show the card menu under its button, clamped into the viewport
   the way the image menu is; opening it closes the image menu,
   and the two never stack. The read only state of the note the
   menu was opened from is applied to the items here, at open
   time: in Trash and Archive only Download stays enabled. */
function showAttCardMenu(anchor) {
  closeAttMenu();
  const menu = document.getElementById("attCardMenu");
  if (!menu || !anchor) { return; }
  const readOnly = !attCardMenuNote || attCardMenuNote.trashed ||
    attCardMenuNote.archived;
  menu.querySelectorAll("button[data-card-action]").forEach(
    function (btn) {
      btn.disabled = readOnly &&
        btn.getAttribute("data-card-action") !== "download";
    });
  menu.classList.remove("hidden");
  const rect = anchor.getBoundingClientRect();
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  let left = Math.min(rect.right - width, window.innerWidth - width - 8);
  left = Math.max(8, left);
  let top = rect.bottom + 6;
  if (top + height > window.innerHeight - 8) {
    top = Math.max(8, rect.top - height - 6);
  }
  menu.style.left = left + "px";
  menu.style.top = top + "px";
}

function closeAttCardMenu() {
  const menu = document.getElementById("attCardMenu");
  if (menu) { menu.classList.add("hidden"); }
  attCardMenuNote = null;
  attCardMenuAtt = null;
  attCardMenuEl = null;
}

/* One click in the card menu: capture the target, close, then
   run, the image menu's dispatch shape. */
function runAttCardMenuAction(action) {
  const note = attCardMenuNote;
  const att = attCardMenuAtt;
  const el = attCardMenuEl;
  closeAttCardMenu();
  if (!note || !att) { return; }
  if (action === "download") {
    downloadAttachment(att).catch(function (err) {
      toast(err.message, true);
    });
    return;
  }
  if (action === "rename") {
    renameAttachment(note, att, el).then(function () {
      /* The card's name is its own DOM, built at hydration; the
         rename flow updates the record (and an image's alt text
         and Title face), so repaint the name the card shows. */
      if (el && el.isConnected) {
        const nameSpan = el.querySelector(".ss-att-name");
        if (nameSpan) { nameSpan.textContent = att.name; }
      }
    }).catch(function (err) { toast(err.message, true); });
    return;
  }
  if (action === "delete") {
    scheduleAttachmentDelete(note, att);
    return;
  }
  if (action === "transcribe") {
    transcribeAudioAttachment(note, att, el).catch(function (err) {
      toast("Transcribe failed: " + err.message, true);
    });
  }
}

/* ----- v2.14.1: transcribe a saved recording -----------------------
   The browser's live speech recognition (the one a voice note
   records with) cannot read a saved file, so a recording's words
   are read by a real speech model instead: transformers.js with
   a Whisper model (v2.76: the Settings choice below; Fast is
   the whisper-tiny.en every earlier build used), loaded from
   its CDN the first time Transcribe is used, and only then,
   exactly the bargain the
   image Transcribe made with Tesseract. Everything after the
   load happens on the device: the model files come down from
   the model host once (the library caches them), the recording
   is fetched through the attachment's own provider download and
   decoded in the browser, and no audio ever leaves the device.
   It fails closed, like the image run: offline, a failed load,
   or a failed read shows an error and inserts nothing. */
const SPEECH_LIB_URL =
  "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js";
const SPEECH_LIB_DIST =
  "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/";
/* v2.76: the transcription model is a Settings choice
   (Settings, Editor), in Chris's labels: Fast, Normal,
   Best. The ids are the Xenova Whisper builds the pinned
   transformers.js loads; Fast is the model every build
   through v2.75.0 used. The choice is per device (the
   model files cache on the device that downloads them),
   governs audio transcription only, and a run uses the
   model chosen when it started: the choice is read once
   at the run's start and rides its job and its stored
   transcript, so changing the setting mid run changes
   neither. */
const SPEECH_MODELS = {
  fast: "Xenova/whisper-tiny.en",
  normal: "Xenova/whisper-base.en",
  best: "Xenova/whisper-small.en"
};
function speechModelKey() {
  return SPEECH_MODELS[state.transcriptionModel]
    ? state.transcriptionModel : "fast";
}
function speechModelId() {
  return SPEECH_MODELS[speechModelKey()];
}
const SPEECH_SAMPLE_RATE = 16000;

let speechLibPromise = null;

/* Load the speech library and hand back its namespace. The
   package ships only a module build, so it is imported
   dynamically; a library already present on window under the
   Transformers name is used as is (the test seam, the Tesseract
   check's shape). The ONNX runtime's wasm binaries live in the
   same CDN folder as the bundle, so the runtime is pointed at
   that folder explicitly rather than left to look beside the
   page. */
function loadSpeechLib() {
  if (window.Transformers && window.Transformers.pipeline) {
    return Promise.resolve(window.Transformers);
  }
  if (speechLibPromise) { return speechLibPromise; }
  speechLibPromise = (async function () {
    const lib = await import(SPEECH_LIB_URL);
    if (!lib || typeof lib.pipeline !== "function") {
      throw new Error("The speech recognition library did not initialize.");
    }
    try {
      lib.env.backends.onnx.wasm.wasmPaths = SPEECH_LIB_DIST;
    } catch (e) { /* a runtime without the knob keeps its default */ }
    return lib;
  })();
  /* A failed load may be retried on the next Transcribe. */
  speechLibPromise.catch(function () { speechLibPromise = null; });
  return speechLibPromise;
}

/* One transcription run's options, shared by every
   engine that can serve a run (the worker's pipeline and
   the page's, below): 30 second chunks with a 5 second
   stride, and word level timestamps, the finest the
   pinned library produces (see
   transcriptUnitsFromResult). One constant, so the paths
   can never drift apart. */
const SPEECH_RUN_OPTIONS = {
  chunk_length_s: 30,
  stride_length_s: 5,
  return_timestamps: "word"
};

/* A pipeline build's download progress, as the status
   line reports it. The page pipeline's build calls it
   directly; the worker relays the same progress objects
   as messages and the page hands them here, so a model
   download reads identically whichever thread runs it. */
function speechProgressStatus(info) {
  if (info && info.status === "progress" &&
      typeof info.progress === "number") {
    showTranscribeStatus("Downloading the speech model: " +
      Math.round(info.progress) + "%");
  }
}

/* The transcription pipelines, one built and kept per
   model: a model's download rides its first build (the
   status line reports it: the standing Loading line first,
   then the download's percentage, so a long first download
   for a bigger model reads as loading, never as stuck),
   and later runs with that model reuse its pipeline. A
   failed build is not kept, so the next Transcribe with
   that model tries again. */
const speechPipelinePromises = {};
function speechTranscriber(modelId) {
  if (speechPipelinePromises[modelId]) {
    return speechPipelinePromises[modelId];
  }
  const built = (async function () {
    const lib = await loadSpeechLib();
    return lib.pipeline("automatic-speech-recognition", modelId, {
      progress_callback: speechProgressStatus
    });
  })();
  speechPipelinePromises[modelId] = built;
  built.catch(function () {
    if (speechPipelinePromises[modelId] === built) {
      delete speechPipelinePromises[modelId];
    }
  });
  return built;
}

/* ----- v2.78: the speech engine runs in a Web Worker -------
   Through v2.77.0 the Whisper pipeline ran on the page's
   main thread, and a transcription locked the app while
   it processed: the same thread draws the screen and
   answers taps, and inference held it for seconds at a
   time. The pipeline now runs in a module Web Worker
   built from an inline Blob, so the single file app (and
   a standalone copy opened on its own) needs no extra
   hosted file. The worker imports the pinned library
   build from the same CDN the page uses, points its ONNX
   wasm paths at the same CDN folder in absolute terms
   (relative resolution differs inside a worker), builds
   and caches one pipeline per model exactly as the page
   does, and returns the same raw result shape the page
   normalizes. GitHub Pages sends no cross origin
   isolation headers, so the runtime has no
   SharedArrayBuffer and no wasm multithreading to reach
   for; one thread inside the worker is the whole point,
   because it is not the page's thread.

   The protocol is one job in flight, which the page's
   own serialization (runSpeechJob) already guarantees,
   and the worker chains its runs the same way on its
   side: the page posts {type: "run", id, modelId,
   samples, options}, sending a COPY of the samples with
   the copy's buffer transferred (the page keeps its own
   samples whole, because the fallback below may still
   need them). The worker posts {type: "progress", id,
   info} while its model downloads, relayed to the same
   status callback the page pipeline uses, then
   {type: "ready", id} once the model stands built, then
   exactly one of {type: "result", id, result} with the
   raw recognition result, or {type: "error", id, stage,
   message} naming the stage that failed: "load" (the
   library import), "build" (the pipeline build), or
   "run" (the recognition itself). The worker loads its
   library by dynamic import, so a failed import is an
   ordinary protocol error it can report, never a silent
   death.

   The fallback is the hard requirement: the page
   pipeline above stays in the code, fully working, and
   ANY worker failure hands the job to it, mid run
   failures included. Construction failing, the worker
   erroring outside the protocol (a crash), or a "load"
   stage failure retires the worker for the rest of the
   session: a worker that cannot even load its library
   will not heal between jobs. A "build" or "run" stage
   failure leaves the worker standing (its failed build
   is already evicted from its own cache) and falls back
   for that job only. The job fails only when the page
   pipeline also fails, and then with the page's own
   error, exactly as before this build. */
let speechWorker = null;
let speechWorkerRetired = false;
let speechWorkerSeq = 0;
let speechWorkerPending = null;

/* The worker's source. Its only generated lines are the
   two library addresses, injected from the page's own
   constants so the worker can never point anywhere the
   page does not. */
function speechWorkerSource() {
  const head = "const SPEECH_WORKER_LIB_URL = " +
    JSON.stringify(SPEECH_LIB_URL) + ";\n" +
    "const SPEECH_WORKER_LIB_DIST = " +
    JSON.stringify(SPEECH_LIB_DIST) + ";\n";
  return head + [
    '"use strict";',
    "/* The transcription worker: the Whisper pipeline",
    "   lives here, off the page's main thread, so a",
    "   transcription no longer locks the app while it",
    "   runs. The page above this worker's source (in",
    "   speechWorkerSource) documents the protocol both",
    "   sides speak. */",
    "const pipelines = {};",
    "let libPromise = null;",
    "let chain = Promise.resolve();",
    "function loadLib() {",
    "  if (!libPromise) {",
    "    libPromise = import(SPEECH_WORKER_LIB_URL)",
    "      .then(function (lib) {",
    "        if (!lib || typeof lib.pipeline !== 'function') {",
    "          throw new Error('The speech recognition ' +",
    "            'library did not initialize.');",
    "        }",
    "        try {",
    "          lib.env.backends.onnx.wasm.wasmPaths =",
    "            SPEECH_WORKER_LIB_DIST;",
    "        } catch (e) { /* a runtime without the knob",
    "           keeps its default */ }",
    "        return lib;",
    "      });",
    "  }",
    "  return libPromise;",
    "}",
    "function transcriber(modelId, jobId) {",
    "  let built = pipelines[modelId];",
    "  if (!built) {",
    "    built = loadLib().then(function (lib) {",
    "      return lib.pipeline(",
    "        'automatic-speech-recognition', modelId, {",
    "          progress_callback: function (info) {",
    "            self.postMessage({ type: 'progress',",
    "              id: jobId, info: info });",
    "          }",
    "        });",
    "    });",
    "    pipelines[modelId] = built;",
    "    built.catch(function () {",
    "      if (pipelines[modelId] === built) {",
    "        delete pipelines[modelId];",
    "      }",
    "    });",
    "  }",
    "  return built;",
    "}",
    "function fail(id, stage, err) {",
    "  self.postMessage({ type: 'error', id: id,",
    "    stage: stage,",
    "    message: err && err.message ? err.message",
    "      : String(err) });",
    "}",
    "async function runJob(msg) {",
    "  const id = msg.id;",
    "  try { await loadLib(); }",
    "  catch (err) { fail(id, 'load', err); return; }",
    "  let fn = null;",
    "  try { fn = await transcriber(msg.modelId, id); }",
    "  catch (err) { fail(id, 'build', err); return; }",
    "  self.postMessage({ type: 'ready', id: id });",
    "  try {",
    "    const result = await fn(msg.samples, msg.options);",
    "    self.postMessage({ type: 'result', id: id,",
    "      result: result });",
    "  } catch (err) { fail(id, 'run', err); }",
    "}",
    "self.addEventListener('message', function (ev) {",
    "  const msg = ev && ev.data;",
    "  if (!msg || msg.type !== 'run') { return; }",
    "  chain = chain.then(function () {",
    "    return runJob(msg);",
    "  }, function () { return runJob(msg); });",
    "});",
    "self.postMessage({ type: 'boot' });"
  ].join("\n");
}

/* Build the worker on first use and keep it for the
   session. Returns null when this session has no worker
   (none could be built, or it was retired): the caller
   then runs the job on the page pipeline. */
function startSpeechWorker() {
  if (speechWorkerRetired) { return null; }
  if (speechWorker) { return speechWorker; }
  if (typeof Worker !== "function" ||
      typeof Blob !== "function" ||
      typeof URL === "undefined" ||
      typeof URL.createObjectURL !== "function") {
    speechWorkerRetired = true;
    return null;
  }
  let url = null;
  let worker = null;
  try {
    url = URL.createObjectURL(new Blob([speechWorkerSource()],
      { type: "text/javascript" }));
    worker = new Worker(url, { type: "module" });
  } catch (err) {
    speechWorkerRetired = true;
    if (url) {
      try { URL.revokeObjectURL(url); } catch (e) { /* no-op */ }
    }
    return null;
  }
  worker.addEventListener("message", onSpeechWorkerMessage);
  worker.addEventListener("error", onSpeechWorkerCrash);
  speechWorker = worker;
  return worker;
}

function retireSpeechWorker() {
  speechWorkerRetired = true;
  if (speechWorker) {
    try { speechWorker.terminate(); } catch (e) { /* gone */ }
    speechWorker = null;
  }
}

function onSpeechWorkerMessage(ev) {
  const msg = ev && ev.data;
  if (!msg) { return; }
  const pending = speechWorkerPending;
  if (msg.type === "progress") {
    if (pending && msg.id === pending.id) {
      pending.hooks.onProgress(msg.info);
    }
    return;
  }
  if (!pending || msg.id !== pending.id) { return; }
  if (msg.type === "ready") {
    pending.hooks.onReady();
    return;
  }
  if (msg.type === "result") {
    speechWorkerPending = null;
    pending.resolve(msg.result);
    return;
  }
  if (msg.type === "error") {
    speechWorkerPending = null;
    if (msg.stage === "load") { retireSpeechWorker(); }
    pending.reject(new Error(msg.message ||
      "The transcription worker could not run."));
  }
}

/* The worker died outside the protocol (an uncaught
   error, a crash): the pending job, if any, falls back
   like any other worker failure, and the worker is
   retired for the session. */
function onSpeechWorkerCrash() {
  const pending = speechWorkerPending;
  speechWorkerPending = null;
  retireSpeechWorker();
  if (pending) {
    pending.reject(new Error(
      "The transcription worker stopped unexpectedly."));
  }
}

/* Post one job to the worker and await its word. The
   job's hooks hear the relayed download progress and
   the model ready moment on the way. */
function runSpeechInWorker(worker, modelId, samples, hooks) {
  return new Promise(function (resolve, reject) {
    const id = ++speechWorkerSeq;
    speechWorkerPending = { id: id, resolve: resolve,
      reject: reject, hooks: hooks };
    /* A copy travels, its buffer transferred (see the
       block head): the transfer detaches the copy, and
       the page's own samples stay whole for the
       fallback. */
    const copy = samples.slice();
    try {
      worker.postMessage({ type: "run", id: id,
        modelId: modelId, samples: copy,
        options: SPEECH_RUN_OPTIONS }, [copy.buffer]);
    } catch (err) {
      speechWorkerPending = null;
      retireSpeechWorker();
      reject(err);
    }
  });
}

/* Run one transcription, wherever the engine can: the
   worker first, the page pipeline on any worker
   failure. Resolves with the raw recognition result
   the caller normalizes; rejects only when the page
   pipeline itself fails, with its error. */
async function runSpeechTranscription(modelId, samples, hooks) {
  hooks = hooks || {};
  const wired = {
    onProgress: typeof hooks.onProgress === "function"
      ? hooks.onProgress : function () {},
    onReady: typeof hooks.onReady === "function"
      ? hooks.onReady : function () {}
  };
  const worker = startSpeechWorker();
  if (worker) {
    try {
      return await runSpeechInWorker(worker, modelId,
        samples, wired);
    } catch (err) {
      /* The worker could not serve this job (the block
         head says how each failure is told apart): fall
         through to the page pipeline, whose outcome is
         the job's outcome. */
    }
  }
  const transcriber = await speechTranscriber(modelId);
  wired.onReady();
  return transcriber(samples, SPEECH_RUN_OPTIONS);
}

/* Decode a recording's bytes to the mono 16 kHz samples the
   model expects. The bytes decode at the browser's own rate
   first; anything not already single channel 16 kHz is rendered
   through an offline context at 16 kHz, which resamples and
   mixes down in the one render. Kept as its own named door,
   like the image editor's helpers, so tests can stand in for
   the browser's audio stack. */
async function decodeSpeechAudio(blob) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) {
    throw new Error("This browser cannot decode audio for transcription.");
  }
  const arrayBuffer = await blob.arrayBuffer();
  const decodeCtx = new AC();
  let decoded;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuffer);
  } finally {
    if (decodeCtx.close) {
      try { decodeCtx.close(); } catch (e) { /* already closed */ }
    }
  }
  if (decoded.sampleRate === SPEECH_SAMPLE_RATE) {
    if (decoded.numberOfChannels === 1) {
      return decoded.getChannelData(0);
    }
    const mono = new Float32Array(decoded.length);
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const data = decoded.getChannelData(c);
      for (let i = 0; i < decoded.length; i++) { mono[i] += data[i]; }
    }
    for (let i = 0; i < mono.length; i++) {
      mono[i] = mono[i] / decoded.numberOfChannels;
    }
    return mono;
  }
  const targetLength = Math.max(1,
    Math.ceil(decoded.duration * SPEECH_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, targetLength,
    SPEECH_SAMPLE_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

/* v2.76: the timed units in one Whisper result, in the
   record's shape ({start, end, text}, seconds). The pinned
   transformers.js (2.17.2) answers return_timestamps:
   "word" with segment chunks that each carry a words
   array of {text, timestamp: [start, end]} at absolute
   times across the whole recording (its tokenizer collates
   token timings into words, strides already resolved);
   those words are the units when they exist. A result
   whose chunks carry no words falls back to the chunks
   themselves (the segment level the same library returns
   for return_timestamps: true), and a result with no
   usable chunks at all yields no units: the transcript
   then stores and shows as plain text. Entries without a
   usable start, or with no words of their own, are
   skipped; an end that is missing or before its start
   collapses to the start. */
function transcriptUnitsFromResult(result) {
  const chunks = result && Array.isArray(result.chunks)
    ? result.chunks : [];
  const units = [];
  function pushUnit(item) {
    if (!item || typeof item.text !== "string") { return; }
    const ts = item.timestamp;
    if (!Array.isArray(ts)) { return; }
    const start = Number(ts[0]);
    if (!isFinite(start) || start < 0) { return; }
    let end = Number(ts[1]);
    if (!isFinite(end) || end < start) { end = start; }
    const t = item.text.trim();
    if (!t) { return; }
    units.push({ start: start, end: end, text: t });
  }
  chunks.forEach(function (c) {
    if (c && Array.isArray(c.words)) {
      c.words.forEach(pushUnit);
    }
  });
  if (!units.length) {
    chunks.forEach(pushUnit);
  }
  return units;
}

async function transcribeAudioAttachment(note, att, el) {
  /* v2.73: one transcription per attachment at a time, the
     image run's rule (see the background block above). */
  const key = transcriptionKey(note.id, att.id);
  if (activeTranscriptions.has(key) || transcriptionJobs.has(key)) {
    toast("\"" + att.name + "\" is already being transcribed.", true);
    return;
  }
  activeTranscriptions.add(key);
  /* v2.76: the model is the Settings choice as it stands
     at the run's start, and it rides the job (and the
     stored transcript) from here: flipping the choice
     while a run is in flight changes neither the model
     that run transcribes with nor the one its transcript
     credits. */
  const modelId = speechModelId();
  try {
    if (!state.online) {
      toast("Transcribing needs an internet connection: the speech " +
        "model loads on first use. You appear to be offline.", true);
      return;
    }
    let blob;
    try {
      blob = await fetchAttachmentBlob(att);
    } catch (err) {
      toast(err.message, true);
      return;
    }
    acquireTranscribeStatus();
    showTranscribeStatus("Loading the speech model " +
      "(the first use downloads it)...");
    try {
      /* v2.78: the samples are decoded before the run
         rather than after the build, because the build
         now happens wherever the engine lives: inside
         the worker when it serves (its download progress
         relayed to the same status callback), or in the
         runner's page pipeline when it falls back. The
         status story is unchanged either way: the
         Loading line above, download percentages as the
         model arrives, and "Transcribing ..." the
         moment the model stands ready, which the ready
         hook reports on both paths. */
      const samples = await decodeSpeechAudio(blob);
      /* v2.73: the one Whisper pipeline is shared, so its runs
         are serialized through runSpeechJob: two recordings
         transcribe one after the other, never inside the same
         pipeline at once (see the background block). v2.78:
         the serialization wraps the whole run, model build
         included, because the build is part of the worker's
         one job in flight. */
      const result = await runSpeechJob(function () {
        return runSpeechTranscription(modelId, samples, {
          onProgress: speechProgressStatus,
          onReady: function () {
            showTranscribeStatus("Transcribing \"" + att.name +
              "\"...");
          }
        });
      });
      const text = result && typeof result.text === "string"
        ? result.text.trim() : "";
      if (!text) {
        toast("No speech was recognized in this recording.");
        return;
      }
      /* v2.73: the words are a job now, not a page errand:
         the landing puts them in the note they belong to,
         wherever the editor has gone (see
         attemptTranscriptLanding in the background block).
         v2.76: an audio job carries a transcript for the
         attachment record, not lines for the body: the
         text, its timed units, the model that read it,
         and the moment the run finished. */
      const job = { key: key, noteId: note.id, attId: att.id,
        kind: "audio", attName: att.name, parked: false,
        transcript: { text: text,
          units: transcriptUnitsFromResult(result),
          model: modelId, at: new Date().toISOString() } };
      transcriptionJobs.set(key, job);
      const outcome = await queueTranscriptLanding(job);
      if (outcome === "parked") {
        toast("The words from \"" + att.name + "\" will be added " +
          "to \"" + (note.title || "Untitled note") + "\" as soon " +
          "as its current edits have saved.");
      }
    } catch (err) {
      toast("Transcribe failed: " + err.message, true);
    } finally {
      releaseTranscribeStatus();
    }
  } finally {
    activeTranscriptions.delete(key);
  }
}

/* ----- v2.11: the image editor (Edit & Annotate, and Crop) ----------
   One overlay, two modes, both working on a canvas copy of the
   image loaded from its own blob (an object URL from the
   attachment fetch), so the canvas is never tainted and the
   original is never touched until Save.

   Annotate draws freehand strokes and text labels over the image.
   Every mark (a stroke or a label) lands in one list, so Undo
   always takes back the most recent mark, whatever kind it was.
   Crop keeps a rectangle in fractions of the image and maps it to
   source pixels only at Apply time, so the box can be dragged
   freely at any display size.

   Save flattens the result (PNG, or JPEG at quality 0.92 when the
   original record is a JPEG) and uploads it as a NEW Drive file
   through the ordinary attachment upload path; only when the
   upload has succeeded does the record swap to the new file in
   place (same attachment id, same block). The old Drive file is
   deliberately NOT deleted: it stays in the attachments folder as
   the only copy of the unedited image, which is the protection
   Chris approved against a bad edit. Any failure before the swap
   leaves the note, the block, and the record exactly as they were,
   and the editor stays open so the work is not lost.

   The three small helpers below are the editor's only doors to
   the canvas and image machinery; they exist so the behavior can
   be exercised in tests that stub them. */
function imageEditorContext(canvas) {
  return canvas ? canvas.getContext("2d") : null;
}

function imageEditorLoadImage(url) {
  return new Promise(function (resolve, reject) {
    const img = new Image();
    img.onload = function () { resolve(img); };
    img.onerror = function () {
      reject(new Error("The image could not be loaded for editing."));
    };
    img.src = url;
  });
}

function imageEditorToBlob(canvas, type, quality) {
  return new Promise(function (resolve, reject) {
    if (typeof canvas.toBlob === "function") {
      canvas.toBlob(function (blob) {
        if (blob) { resolve(blob); }
        else { reject(new Error("The edited image could not be prepared.")); }
      }, type, quality);
      return;
    }
    try {
      const url = canvas.toDataURL(type, quality);
      const comma = url.indexOf(",");
      const bin = atob(url.slice(comma + 1));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) { bytes[i] = bin.charCodeAt(i); }
      resolve(new Blob([bytes], { type: type }));
    } catch (err) { reject(err); }
  });
}

/* The yellow pen color is a highlighter: it draws translucent. */
const IMAGE_HIGHLIGHT_COLOR = "#FFD83D";

let imgEditorState = null;

function imageEditorOpen() {
  const modal = document.getElementById("imgEditorModal");
  return !!modal && !modal.classList.contains("hidden") && !!imgEditorState;
}

async function openImageEditor(note, att, el, mode) {
  if (!state.online) {
    toast("Editing an image needs an internet connection: the new " +
      "version is uploaded when you save. You appear to be offline.", true);
    return;
  }
  let blob;
  try {
    blob = await fetchAttachmentBlob(att);
  } catch (err) {
    toast(err.message, true);
    return;
  }
  const url = URL.createObjectURL(blob);
  let img;
  try {
    img = await imageEditorLoadImage(url);
  } catch (err) {
    URL.revokeObjectURL(url);
    toast(err.message, true);
    return;
  }
  imgEditorState = {
    note: note, att: att, el: el, mode: mode,
    img: img, url: url,
    marks: [], current: null,
    color: "#111111", widthPx: 3, tool: "pen",
    crop: { fx: 0.1, fy: 0.1, fw: 0.8, fh: 0.8 },
    saving: false
  };
  const canvas = document.getElementById("imgEditorCanvas");
  canvas.width = img.naturalWidth || img.width || 1;
  canvas.height = img.naturalHeight || img.height || 1;
  document.getElementById("imgEditorTitle").textContent =
    mode === "crop" ? "Crop image" : "Edit & Annotate";
  document.getElementById("imgEditorSub").textContent = att.name +
    ". Saving replaces the image in this note; the original file " +
    "stays in your Drive attachments folder.";
  document.getElementById("imgEditorTools")
    .classList.toggle("hidden", mode !== "annotate");
  document.getElementById("imgCropBox")
    .classList.toggle("hidden", mode !== "crop");
  const saveBtn = document.getElementById("imgEditorSaveBtn");
  saveBtn.disabled = false;
  saveBtn.textContent = mode === "crop" ? "Apply" : "Save";
  document.getElementById("imgEditorModal").classList.remove("hidden");
  if (mode === "crop") { positionImageCropBox(); }
  else { redrawImageEditor(); }
}

function closeImageEditor() {
  const modal = document.getElementById("imgEditorModal");
  if (modal) { modal.classList.add("hidden"); }
  if (imgEditorState && imgEditorState.url) {
    URL.revokeObjectURL(imgEditorState.url);
  }
  imgEditorState = null;
}

/* --- annotate drawing --- */
function drawImageMark(ctx, mark) {
  if (mark.kind === "label") {
    ctx.fillStyle = mark.color;
    ctx.font = "600 " + mark.size + "px sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(mark.text, mark.x, mark.y);
    return;
  }
  const pts = mark.points;
  if (!pts.length) { return; }
  ctx.strokeStyle = mark.color;
  ctx.lineWidth = mark.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = mark.highlight ? 0.45 : 1;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) { ctx.lineTo(pts[i].x, pts[i].y); }
  if (pts.length === 1) { ctx.lineTo(pts[0].x + 0.1, pts[0].y + 0.1); }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function redrawImageEditor() {
  const st = imgEditorState;
  if (!st) { return; }
  const canvas = document.getElementById("imgEditorCanvas");
  const ctx = imageEditorContext(canvas);
  if (!ctx) { return; }
  ctx.drawImage(st.img, 0, 0, canvas.width, canvas.height);
  st.marks.forEach(function (mark) { drawImageMark(ctx, mark); });
  if (st.current) { drawImageMark(ctx, st.current); }
}

function imageEditorPoint(ev) {
  const canvas = document.getElementById("imgEditorCanvas");
  const rect = canvas.getBoundingClientRect();
  const sx = rect.width ? canvas.width / rect.width : 1;
  const sy = rect.height ? canvas.height / rect.height : 1;
  return {
    x: (ev.clientX - rect.left) * sx,
    y: (ev.clientY - rect.top) * sy
  };
}

function onImageEditorPointerDown(ev) {
  const st = imgEditorState;
  if (!st || st.mode !== "annotate" || st.saving) { return; }
  ev.preventDefault();
  const pt = imageEditorPoint(ev);
  if (st.tool === "text") {
    const text = prompt("Label text");
    if (text && text.trim()) {
      st.marks.push({
        kind: "label", text: text.trim(), x: pt.x, y: pt.y,
        color: st.color,
        size: Math.max(14, Math.round(
          (document.getElementById("imgEditorCanvas").width * 0.028) *
          (st.widthPx / 3)))
      });
      redrawImageEditor();
    }
    return;
  }
  st.current = {
    kind: "stroke", color: st.color, width: st.widthPx,
    highlight: st.color === IMAGE_HIGHLIGHT_COLOR,
    points: [pt]
  };
  const canvas = document.getElementById("imgEditorCanvas");
  if (canvas.setPointerCapture && ev.pointerId !== undefined) {
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* ok */ }
  }
  redrawImageEditor();
}

function onImageEditorPointerMove(ev) {
  const st = imgEditorState;
  if (!st || !st.current) { return; }
  st.current.points.push(imageEditorPoint(ev));
  redrawImageEditor();
}

function onImageEditorPointerUp() {
  const st = imgEditorState;
  if (!st || !st.current) { return; }
  st.marks.push(st.current);
  st.current = null;
  redrawImageEditor();
}

/* --- crop --- */
/* The crop box's geometry, in fractions of the displayed canvas.
   Displayed size falls back to the canvas's own pixel size when
   the browser has not laid the stage out. */
function imageEditorDisplaySize() {
  const canvas = document.getElementById("imgEditorCanvas");
  const w = (canvas.clientWidth || canvas.width || 1);
  const h = (canvas.clientHeight || canvas.height || 1);
  return { w: w, h: h };
}

function positionImageCropBox() {
  const st = imgEditorState;
  const box = document.getElementById("imgCropBox");
  if (!st || !box) { return; }
  const size = imageEditorDisplaySize();
  box.style.left = (st.crop.fx * size.w) + "px";
  box.style.top = (st.crop.fy * size.h) + "px";
  box.style.width = (st.crop.fw * size.w) + "px";
  box.style.height = (st.crop.fh * size.h) + "px";
}

let imgCropDrag = null;

function onImageCropPointerDown(ev) {
  const st = imgEditorState;
  if (!st || st.mode !== "crop" || st.saving) { return; }
  ev.preventDefault();
  ev.stopPropagation();
  const handle = ev.target && ev.target.closest ?
    ev.target.closest(".img-crop-handle") : null;
  imgCropDrag = {
    kind: handle ? handle.getAttribute("data-corner") : "move",
    startX: ev.clientX, startY: ev.clientY,
    crop0: { fx: st.crop.fx, fy: st.crop.fy, fw: st.crop.fw, fh: st.crop.fh }
  };
  const box = document.getElementById("imgCropBox");
  if (box.setPointerCapture && ev.pointerId !== undefined) {
    try { box.setPointerCapture(ev.pointerId); } catch (e) { /* ok */ }
  }
}

function onImageCropPointerMove(ev) {
  const st = imgEditorState;
  if (!st || !imgCropDrag) { return; }
  const size = imageEditorDisplaySize();
  const dx = (ev.clientX - imgCropDrag.startX) / size.w;
  const dy = (ev.clientY - imgCropDrag.startY) / size.h;
  const c0 = imgCropDrag.crop0;
  const c = { fx: c0.fx, fy: c0.fy, fw: c0.fw, fh: c0.fh };
  const MIN = 0.05;
  const kind = imgCropDrag.kind;
  if (kind === "move") {
    c.fx = Math.max(0, Math.min(1 - c.fw, c0.fx + dx));
    c.fy = Math.max(0, Math.min(1 - c.fh, c0.fy + dy));
  } else {
    if (kind.indexOf("e") >= 0) {
      c.fw = Math.max(MIN, Math.min(1 - c.fx, c0.fw + dx));
    }
    if (kind.indexOf("s") >= 0) {
      c.fh = Math.max(MIN, Math.min(1 - c.fy, c0.fh + dy));
    }
    if (kind.indexOf("w") >= 0) {
      const right = c0.fx + c0.fw;
      c.fx = Math.max(0, Math.min(right - MIN, c0.fx + dx));
      c.fw = right - c.fx;
    }
    if (kind.indexOf("n") >= 0) {
      const bottom = c0.fy + c0.fh;
      c.fy = Math.max(0, Math.min(bottom - MIN, c0.fy + dy));
      c.fh = bottom - c.fy;
    }
  }
  st.crop = c;
  positionImageCropBox();
}

function onImageCropPointerUp() { imgCropDrag = null; }

/* The source rectangle, in image pixels, that the crop fractions
   select. Kept separate and pure so it can be checked directly. */
function imageCropSourceRect(crop, imgWidth, imgHeight) {
  const sx = Math.max(0, Math.round(crop.fx * imgWidth));
  const sy = Math.max(0, Math.round(crop.fy * imgHeight));
  const sw = Math.max(1, Math.min(imgWidth - sx,
    Math.round(crop.fw * imgWidth)));
  const sh = Math.max(1, Math.min(imgHeight - sy,
    Math.round(crop.fh * imgHeight)));
  return { sx: sx, sy: sy, sw: sw, sh: sh };
}

/* --- save --- */
/* The swap itself, run only after the new file exists in Drive.
   See the section comment for the never delete the original rule. */
async function replaceAttachmentImage(st, blob) {
  const note = st.note;
  const att = st.att;
  const driver = providers[att.provider];
  if (!driver) {
    throw new Error("Unknown storage provider for this attachment.");
  }
  const status = await driver.getStatus();
  if (!status.connected) {
    throw new Error("Sign in with " + providerLabel(att.provider) +
      " to save the edited image.");
  }
  const storageName = att.id + "__" + sanitizeFileName(att.name);
  const file = typeof File === "function"
    ? new File([blob], att.name, { type: blob.type || att.mime })
    : blob;
  const result = await driver.upload(file, storageName, null);
  att.fileId = String(result.fileId);
  att.storageName = storageName;
  att.size = blob.size;
  att.mime = blob.type || att.mime;
  if (currentNote() === note) { markDirty(); }
  if (st.el && st.el.isConnected) {
    await hydrateOneAttachment(note, st.el);
    /* Hydration rebuilt the block's contents, which takes the
       selection furniture (the grips and the menu button) with
       it. If this block was the selected one, clear that now
       stale selection, so the next click selects the image afresh
       instead of landing on a selection with no controls. */
    if (selectedAttachmentEl === st.el) { deselectAttachment(); }
  }
}

async function saveImageEditor() {
  const st = imgEditorState;
  if (!st || st.saving) { return; }
  const isJpeg = st.att.mime === "image/jpeg";
  const outType = isJpeg ? "image/jpeg" : "image/png";
  const stage = document.getElementById("imgEditorCanvas");
  let outCanvas = stage;
  if (st.mode === "crop") {
    const rect = imageCropSourceRect(st.crop, stage.width, stage.height);
    outCanvas = document.createElement("canvas");
    outCanvas.width = rect.sw;
    outCanvas.height = rect.sh;
    const ctx = imageEditorContext(outCanvas);
    if (!ctx) {
      toast("The edited image could not be prepared.", true);
      return;
    }
    ctx.drawImage(st.img, rect.sx, rect.sy, rect.sw, rect.sh,
      0, 0, rect.sw, rect.sh);
  } else {
    redrawImageEditor();
  }
  st.saving = true;
  const saveBtn = document.getElementById("imgEditorSaveBtn");
  const saveLabel = saveBtn.textContent;
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";
  try {
    const blob = await imageEditorToBlob(outCanvas, outType,
      isJpeg ? 0.92 : undefined);
    await replaceAttachmentImage(st, blob);
    closeImageEditor();
    toast("Image updated.");
  } catch (err) {
    /* The editor stays open with its marks intact; nothing about
       the note, the block, or the record has changed. */
    toast("The edited image could not be saved: " + err.message, true);
  } finally {
    st.saving = false;
    if (imgEditorState === st) {
      saveBtn.disabled = false;
      saveBtn.textContent = saveLabel;
    }
  }
}

/* Download one attachment through its provider and hand it to the
   browser as a normal file download under its original name. */
async function downloadAttachment(att) {
  if (!state.online) {
    toast("Downloads need an internet connection. You appear to be offline.", true);
    return;
  }
  const driver = providers[att.provider];
  if (!driver) {
    toast("Unknown storage provider for this attachment.", true);
    return;
  }
  const status = await driver.getStatus();
  if (!status.connected) {
    toast("Sign in with " + providerLabel(att.provider) +
      " to download \"" + att.name + "\".", true);
    return;
  }
  try {
    toast("Downloading " + att.name + "...");
    const blob = await driver.download(att.fileId);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = att.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  } catch (err) {
    toast("Download failed: " + err.message, true);
  }
}

/* ----- v1.7: undoable attachment deletion ------------------------------
   Removing an attachment used to be a cliff edge: the Remove button
   asked for confirmation, deleted the cloud file immediately, and
   that was that. Deleting the block from the note text with the
   Delete or Backspace key was the opposite problem: nothing happened
   to the cloud file at all, so it stayed in the user's storage
   forever, pointed at by a metadata record whose block was gone.

   Now every removal path runs through one engine:
     - scheduleAttachmentDelete takes the block out of the note right
       away and opens a five second undo window, announced by a toast
       at the TOP of the window (its own box, #undoToastBox, separate
       from the bottom #toastBox) naming the file and offering Undo.
     - The metadata record stays in note.attachments for the whole
       window. That is what makes Undo and failure recovery exact:
       the note's saved shape does not change until the cloud delete
       has actually succeeded, and filename search and attachment
       counts keep treating the record normally meanwhile.
     - When the timer fires, the cloud file is deleted first; only
       then is the record dropped and the note persisted. If the app
       is offline, the provider is signed out, or the delete fails,
       the block is restored exactly as Undo would restore it, and an
       error toast says the attachment was kept.
     - Undo (or the block reappearing on its own, for example through
       the editor's own Ctrl+Z) cancels the pending delete: the timer
       is cleared and the toast dismissed, and for Undo the captured
       block is also reinserted where it was and rehydrated.
     - Signing out cancels every pending deletion WITHOUT deleting
       anything: the block is already out of the note body (and
       that body state is what the sign out flow saves),
       but the record stays in the note and the file stays in the
       cloud, so the two never disagree about a file that exists. */
const PENDING_DELETE_MS = 5000;

/* Pending entries, keyed by note id + "|" + attachment id. An entry
   holds everything needed to finish the deletion or to take it
   back: { key, note, att, html, anchorId, toastEl, timer }. */
const pendingAttachmentDeletes = new Map();

function pendingDeleteKey(note, att) {
  return note.id + "|" + att.id;
}

/* v2.75: the live pair for an attachment deletion. A library
   load (Sync now, an auto sync, the sign in sync) replaces
   every note object wholesale, and the open editor is
   deliberately left unfilled when the note did not change
   remotely, so a reference captured earlier can name a note
   object the app no longer holds: a card's three dot menu
   button and a file card's Remove button both close over
   the note and the record from hydration time. The deletion
   engine's live branch tests identity against currentNote(),
   so a stale pair silently skipped the block's removal and
   the dirty mark while the undo toast still announced the
   deletion, and the firing then completed against the dead
   object (the file trashed, the dead object's copy saved),
   leaving the live note with its record, its body block,
   and its card, ready to repeat the announcement forever.
   The engine therefore resolves the pair by id before it
   acts: the note the app holds now (findNoteById searches
   the library, Trash, and Archive), and that note's record
   for the attachment. When nothing has been swapped, the
   resolved pair IS the passed pair and behaviour is
   unchanged; when the note or the record can no longer be
   found, the passed pair stands, exactly as before. */
function liveAttachmentPair(note, att) {
  if (!note || !att) { return { note: note, att: att }; }
  const liveNote = findNoteById(note.id) || note;
  const liveAtt = (liveNote.attachments || []).find(function (a) {
    return a.id === att.id;
  }) || att;
  return { note: liveNote, att: liveAtt };
}

/* The attachment id of the NEXT placeholder still in the body after
   the given element, so a restore can go back in front of the same
   neighbor it sat in front of when it was removed. */
function followingAttachmentId(el) {
  let sib = el ? el.nextElementSibling : null;
  while (sib) {
    if (sib.classList && sib.classList.contains("ss-attachment")) {
      return sib.getAttribute("data-attachment-id");
    }
    sib = sib.nextElementSibling;
  }
  return null;
}

/* Build a placeholder element from a captured outerHTML string when
   it still describes this attachment; otherwise build the canonical
   empty shell for the record (figure for images, div for files),
   which hydration fills in either way. Editor furniture that may
   ride along in a capture (grips, the menu button, a PDF preview
   box) is stripped, and so are transient drag and selection
   classes. */
function attachmentElementFromHtml(html, att) {
  if (html) {
    const holder = document.createElement("div");
    holder.innerHTML = html;
    const el = holder.firstElementChild;
    if (el && el.classList && el.classList.contains("ss-attachment") &&
        el.getAttribute("data-attachment-id") === att.id) {
      el.querySelectorAll(".ss-grip, .ss-att-menu-btn, .ss-att-preview")
        .forEach(function (n) { n.remove(); });
      el.classList.remove("ss-selected", "ss-dragging",
        "ss-drop-before", "ss-drop-after");
      return el;
    }
  }
  const el = document.createElement(isImageAttachment(att) ? "figure" : "div");
  el.setAttribute("class", "ss-attachment");
  el.setAttribute("data-attachment-id", att.id);
  el.setAttribute("contenteditable", "false");
  return el;
}

/* Put an attachment block back into a note: into the live body when
   the note is open (in front of its old neighbor when that neighbor
   is still around, at the end of the body otherwise), followed by
   hydration so the block is live again. When the note is not open,
   the captured HTML is stashed on the note object (a runtime only
   field, never serialized) and the next openNote puts the block
   back at the end of the body instead; see
   finishNoteOpenAttachments. */
function restoreAttachmentPlaceholder(note, entry) {
  const att = entry.att;
  /* v2.75: the restore (Undo, or a firing that failed)
     belongs to the live note object too, for the same
     reason: a swapped object would take the stash
     branch and put the block back nowhere the user
     can see. */
  note = liveAttachmentPair(note, att).note;
  if (currentNote() !== note || note.trashed || note.archived) {
    note._restoredAttachmentHtml = note._restoredAttachmentHtml || {};
    note._restoredAttachmentHtml[att.id] = entry.html || null;
    return;
  }
  const bodyEl = document.getElementById("noteBody");
  if (!bodyEl) { return; }
  if (bodyEl.querySelector(
      ".ss-attachment[data-attachment-id=\"" + att.id + "\"]")) {
    return;   /* already back: the user undid the edit themselves */
  }
  const el = attachmentElementFromHtml(entry.html, att);
  decorateAttachmentPlaceholder(note, el, att);
  let anchor = null;
  if (entry.anchorId) {
    anchor = bodyEl.querySelector(
      ".ss-attachment[data-attachment-id=\"" + entry.anchorId + "\"]");
  }
  if (anchor) { bodyEl.insertBefore(el, anchor); }
  else { bodyEl.appendChild(el); }
  /* Keep the deletion reconciliation's snapshot honest about the
     restored block, so deleting it again later is noticed. */
  attachSnapshotIds.add(att.id);
  if (attachSnapshotOrder.indexOf(att.id) === -1) {
    attachSnapshotOrder.push(att.id);
  }
  attachSnapshotHtml.set(att.id, el.outerHTML);
  hydrateOneAttachment(note, el).catch(function (err) {
    console.warn("Attachment restore hydration failed:", err);
  });
  markDirty();
}

/* The top toast for one pending deletion: the words Attachment
   deleted, the file name, and an Undo button. It lives exactly as
   long as its undo window; the firing and cancel paths remove it.
   Multiple pending deletions stack independently in the same box. */
function showUndoToast(entry) {
  const box = document.getElementById("undoToastBox");
  if (!box) { return; }
  const el = document.createElement("div");
  el.className = "undo-toast";
  const text = document.createElement("span");
  text.className = "undo-toast-text";
  text.textContent = "Attachment deleted: " + entry.att.name;
  el.appendChild(text);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "undo-toast-btn";
  btn.textContent = "Undo";
  btn.addEventListener("click", function () {
    undoAttachmentDelete(entry.key);
  });
  el.appendChild(btn);
  box.appendChild(el);
  entry.toastEl = el;
}

function dismissUndoToast(entry) {
  if (entry.toastEl && entry.toastEl.parentNode) {
    entry.toastEl.parentNode.removeChild(entry.toastEl);
  }
  entry.toastEl = null;
}

/* Start the undo window for one attachment. The block leaves the
   note immediately: the capture happens first, from the live element
   when the block is on screen, or from the caller supplied capture
   (the keyboard reconciliation passes the body snapshot's last known
   HTML for a block that is already out of the DOM). The record stays
   in note.attachments until the timer fires. */
function scheduleAttachmentDelete(note, att, captured) {
  /* v2.75: act on the live pair, never a stale capture
     (see liveAttachmentPair). */
  const livePair = liveAttachmentPair(note, att);
  note = livePair.note;
  att = livePair.att;
  const key = pendingDeleteKey(note, att);
  if (pendingAttachmentDeletes.has(key)) {
    return pendingAttachmentDeletes.get(key);
  }
  const entry = {
    key: key, note: note, att: att,
    html: null, anchorId: null, toastEl: null, timer: null
  };
  if (captured && (captured.html || captured.anchorId)) {
    entry.html = captured.html || null;
    entry.anchorId = captured.anchorId || null;
  } else if (currentNote() === note) {
    const bodyEl = document.getElementById("noteBody");
    const el = bodyEl ? bodyEl.querySelector(
      ".ss-attachment[data-attachment-id=\"" + att.id + "\"]") : null;
    if (el) {
      entry.html = el.outerHTML;
      entry.anchorId = followingAttachmentId(el);
      if (selectedAttachmentEl === el) { deselectAttachment(); }
      el.remove();
    }
  }
  pendingAttachmentDeletes.set(key, entry);
  showUndoToast(entry);
  entry.timer = setTimeout(function () {
    firePendingAttachmentDelete(key).catch(function (err) {
      console.warn("Attachment deletion failed:", err);
    });
  }, PENDING_DELETE_MS);
  /* The block leaving the note is an edit like any other; autosave
     persists the body without it while the record (and the file)
     still exist, which is exactly the state Undo expects to find. */
  if (currentNote() === note) { markDirty(); }
  return entry;
}

/* Take a pending deletion back: clear the timer, dismiss the toast,
   and put the block back where it was. */
function undoAttachmentDelete(key) {
  const entry = pendingAttachmentDeletes.get(key);
  if (!entry) { return; }
  if (entry.timer) { clearTimeout(entry.timer); }
  pendingAttachmentDeletes.delete(key);
  dismissUndoToast(entry);
  restoreAttachmentPlaceholder(entry.note, entry);
}

/* Cancel a pending deletion WITHOUT restoring anything: used when
   the block reappeared in the body on its own (the editor's own
   Ctrl+Z, noticed by the reconciliation below), and on lock or sign
   out, where the note body already carries the removal and only the
   cloud delete must not happen. */
function cancelPendingAttachmentDelete(key) {
  const entry = pendingAttachmentDeletes.get(key);
  if (!entry) { return; }
  if (entry.timer) { clearTimeout(entry.timer); }
  pendingAttachmentDeletes.delete(key);
  dismissUndoToast(entry);
}

function cancelAllPendingAttachmentDeletes() {
  Array.from(pendingAttachmentDeletes.keys()).forEach(function (key) {
    cancelPendingAttachmentDelete(key);
  });
}

/* Remove one attachment block from a note's stored body text. The
   stored body is canonical (empty placeholder shells), so this is a
   small DOM walk, used when a pending deletion fires for a note
   that is not currently open and its body string still carries the
   block. */
function stripAttachmentFromBodyText(note, attId) {
  if (!note.body || note.body.indexOf(attId) === -1) { return; }
  const holder = document.createElement("div");
  holder.innerHTML = note.body;
  const el = holder.querySelector(
    ".ss-attachment[data-attachment-id=\"" + attId + "\"]");
  if (el) { el.remove(); note.body = holder.innerHTML; }
}

/* The undo window closed: delete the cloud file, and only then drop
   the record and persist the note. Every failure path restores the
   block and keeps the record, with the same protective wording the
   old immediate flow used: the attachment was kept. The guards that
   used to run before the old immediate delete (the provider must
   exist, the app must be online, the provider must be signed in)
   run here instead, at firing time, so the removal itself always
   feels instant.
   v2.66: the firing runs the provider's trash, not its
   delete, so the file moves to Drive trash and stays
   recoverable by the owner. The failure paths are
   unchanged: a trash that fails restores the block and
   keeps the record, exactly as a failed delete did. */
async function firePendingAttachmentDelete(key) {
  const entry = pendingAttachmentDeletes.get(key);
  if (!entry) { return; }
  pendingAttachmentDeletes.delete(key);
  dismissUndoToast(entry);
  /* v2.75: a load can swap the objects again inside the
     undo window, so the firing resolves the live pair
     the same way the scheduling did. */
  const livePair = liveAttachmentPair(entry.note, entry.att);
  const note = livePair.note;
  const att = livePair.att;
  const driver = providers[att.provider];
  function restoreWithError(message) {
    restoreAttachmentPlaceholder(note, entry);
    toast(message, true);
  }
  if (!driver) {
    restoreWithError("The cloud file for \"" + att.name +
      "\" could not be deleted (unknown storage provider), so the attachment was kept.");
    return;
  }
  if (!state.online) {
    restoreWithError("The cloud file for \"" + att.name +
      "\" could not be deleted while offline, so the attachment was kept.");
    return;
  }
  let status = null;
  try { status = await driver.getStatus(); } catch (e) { status = null; }
  if (!status || !status.connected) {
    restoreWithError("The cloud file for \"" + att.name +
      "\" could not be deleted because " + providerLabel(att.provider) +
      " is not signed in, so the attachment was kept.");
    return;
  }
  try {
    await driver.trash(att.fileId);
  } catch (err) {
    restoreWithError("The cloud file could not be deleted, so the attachment was kept: " +
      err.message);
    return;
  }
  note.attachments = (note.attachments || []).filter(function (a) {
    return a.id !== att.id;
  });
  /* v2.11: a thumbnail pointing at a file that no longer exists
     is cleared in the same save, so the choice never dangles. */
  if (note.thumbnail === att.id) { note.thumbnail = null; }
  if (currentNote() === note) {
    /* Autosave persists the record drop alongside the body, which
       already lost the block when the window opened. */
    markDirty();
  } else {
    /* The note is not open: make sure its stored body no longer
       carries the block either, then save it through the per note
       operation chain like every other background write.
       v2.20: a catalog shell's body is fetched first, so the
       strip below has the real text to work on. */
    if (note.bodyLoaded === false) {
      await ensureNoteBodyLoaded(note);
    }
    stripAttachmentFromBodyText(note, att.id);
    try {
      await saveNoteToRepo(note);
    } catch (err) {
      toast("The cloud file for \"" + att.name +
        "\" was deleted, but the note could not be saved: " + err.message, true);
    }
    saveCache();
  }
}

/* Remove one attachment (the Remove button on a file card, and the
   image menu's Remove item): the undoable engine above does the
   work. The block leaves the note at once and the cloud delete
   waits out the undo window. The old confirm() dialog and immediate
   delete are gone; Undo is the confirmation now. The name and
   signature are unchanged for the existing caller in hydration. */
function removeAttachment(note, att) {
  scheduleAttachmentDelete(note, att);
}

/* ----- v1.7: watching the note body for keyboard deleted blocks -------
   The Delete and Backspace keys edit the body directly, so no
   attachment code runs when a block disappears that way. This
   reconciliation pass closes the gap for the open, editable note:
   it remembers which attachment blocks the body held, and what each
   one looked like, and after each burst of body input it compares.
   A block that vanished and is not already pending enters the
   undoable deletion engine with its last known HTML as the restore
   capture, anchored to the next surviving block. A block that came
   back while its deletion was pending (the editor's own Ctrl+Z)
   cancels that deletion. The pass never runs while a note is being
   opened or rendered (the guard flag renderEditor raises), and
   never for Trash or Archive, which are read only. */
let attachBodyGuard = true;
let attachSnapshotIds = new Set();
let attachSnapshotOrder = [];
let attachSnapshotHtml = new Map();

function snapshotAttachmentBody(note) {
  if (!note || renderEditor._forId !== note.id || currentNote() !== note) {
    return;
  }
  attachSnapshotIds = new Set();
  attachSnapshotOrder = [];
  attachSnapshotHtml = new Map();
  const bodyEl = document.getElementById("noteBody");
  if (bodyEl) {
    bodyEl.querySelectorAll(".ss-attachment[data-attachment-id]")
      .forEach(function (el) {
        const id = el.getAttribute("data-attachment-id");
        attachSnapshotIds.add(id);
        attachSnapshotOrder.push(id);
        attachSnapshotHtml.set(id, el.outerHTML);
      });
  }
  attachBodyGuard = false;
}

function checkAttachmentBody() {
  const note = currentNote();
  if (!note || note.trashed || note.archived) { return; }
  if (attachBodyGuard) { return; }
  if (renderEditor._forId !== note.id) { return; }
  const bodyEl = document.getElementById("noteBody");
  if (!bodyEl) { return; }
  const present = new Map();
  bodyEl.querySelectorAll(".ss-attachment[data-attachment-id]")
    .forEach(function (el) {
      present.set(el.getAttribute("data-attachment-id"), el);
    });
  /* Present blocks: refresh their restore captures, and cancel any
     pending deletion whose block has come back on its own. */
  present.forEach(function (el, id) {
    attachSnapshotHtml.set(id, el.outerHTML);
    const key = pendingDeleteKey(note, { id: id });
    if (pendingAttachmentDeletes.has(key)) {
      cancelPendingAttachmentDelete(key);
    }
  });
  /* Missing blocks that were here at the last pass and are not
     already pending: schedule their undoable deletion, anchored to
     the next block after them (in the last known order) that is
     still present. */
  attachSnapshotOrder.forEach(function (id, idx) {
    if (present.has(id) || !attachSnapshotIds.has(id)) { return; }
    const key = pendingDeleteKey(note, { id: id });
    if (pendingAttachmentDeletes.has(key)) { return; }
    const att = (note.attachments || []).find(function (a) {
      return a.id === id;
    });
    if (!att) { return; }
    let anchorId = null;
    for (let j = idx + 1; j < attachSnapshotOrder.length; j++) {
      if (present.has(attachSnapshotOrder[j])) {
        anchorId = attachSnapshotOrder[j];
        break;
      }
    }
    scheduleAttachmentDelete(note, att, {
      html: attachSnapshotHtml.get(id) || null,
      anchorId: anchorId
    });
  });
  /* The snapshot becomes this pass's present set; captures for
     blocks that are neither present nor pending are dropped. */
  attachSnapshotIds = new Set(present.keys());
  attachSnapshotOrder = Array.from(present.keys());
  attachSnapshotHtml.forEach(function (html, id) {
    if (!present.has(id) &&
        !pendingAttachmentDeletes.has(pendingDeleteKey(note, { id: id }))) {
      attachSnapshotHtml.delete(id);
    }
  });
}

const queueAttachmentBodyCheck = debounce(checkAttachmentBody, 400);

/* After a note opens, in place of the bare hydration call render
   used before: hydrate its blocks, put back any blocks whose undo
   was stashed while the note was closed, then take the body
   snapshot the keyboard reconciliation compares against. */
async function finishNoteOpenAttachments(note) {
  await hydrateAttachments(note);
  await insertRestoredAttachments(note);
  snapshotAttachmentBody(note);
}

async function insertRestoredAttachments(note) {
  const stash = note._restoredAttachmentHtml;
  if (!stash) { return; }
  delete note._restoredAttachmentHtml;
  if (note.trashed || note.archived) { return; }
  if (currentNote() !== note || renderEditor._forId !== note.id) { return; }
  const bodyEl = document.getElementById("noteBody");
  if (!bodyEl) { return; }
  let inserted = false;
  for (const attId of Object.keys(stash)) {
    const att = (note.attachments || []).find(function (a) {
      return a.id === attId;
    });
    if (!att) { continue; }
    if (bodyEl.querySelector(
        ".ss-attachment[data-attachment-id=\"" + attId + "\"]")) { continue; }
    const el = attachmentElementFromHtml(stash[attId], att);
    decorateAttachmentPlaceholder(note, el, att);
    bodyEl.appendChild(el);
    inserted = true;
    await hydrateOneAttachment(note, el);
  }
  if (inserted) { markDirty(); }
}

/* Delete Forever helper: best effort deletion of a note's cloud files.
   Returns the names of files that could NOT be deleted (provider signed
   out, offline, or an API failure), so the caller can warn the user
   that those files remain in their cloud accounts.
   v2.66: each file goes through the provider's trash
   rather than its delete, so a Delete Forever's
   attachment files land in Drive trash, recoverable
   by the owner. The note's own file still deletes
   permanently through the store, and the failure
   contract here is unchanged. */
async function deleteAttachmentsBestEffort(note) {
  const failed = [];
  const atts = note.attachments || [];
  for (const att of atts) {
    const driver = providers[att.provider];
    if (!driver) { failed.push(att.name); continue; }
    try {
      const status = await driver.getStatus();
      if (!status.connected) { failed.push(att.name); continue; }
      await driver.trash(att.fileId);
    } catch (e) {
      failed.push(att.name);
    }
  }
  return failed;
}

/* ----- upload flow -------------------------------------------------------
   Files arrive from the file picker (opened by startAttachFlow from
   the Insert menu), from drag and drop onto the editor, or from
   pasting an image. Uploads run one at a time, in
   order, with the progress panel showing the active file. A temporary
   placeholder marks the spot in the note while bytes are moving; on
   success it is finalized (hydrated), on failure it is removed.      */
const uploadUi = { total: 0, index: 0 };

function setUploadProgress(name, pct) {
  const panel = document.getElementById("uploadPanel");
  const text = document.getElementById("uploadText");
  const fill = document.getElementById("uploadBarFill");
  panel.classList.remove("hidden");
  text.textContent = "Uploading " + name +
    (uploadUi.total > 1 ? " (" + uploadUi.index + " of " + uploadUi.total + ")" : "") +
    ": " + pct + "%";
  fill.style.width = pct + "%";
}
function hideUploadProgress() {
  document.getElementById("uploadPanel").classList.add("hidden");
}

/* Caret memory: the file picker and drag and drop steal focus, so the
   editor selection is captured before they open and restored when the
   placeholder is inserted. */
let savedCaretRange = null;
function captureCaret() {
  const bodyEl = document.getElementById("noteBody");
  const sel = window.getSelection();
  if (sel && sel.rangeCount && bodyEl.contains(sel.anchorNode)) {
    savedCaretRange = sel.getRangeAt(0).cloneRange();
  }
}
function insertPlaceholderAtCaret(el) {
  const bodyEl = document.getElementById("noteBody");
  bodyEl.focus();
  let placed = false;
  let range = null;
  if (savedCaretRange && bodyEl.contains(savedCaretRange.startContainer)) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedCaretRange);
    range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(el);
    range.setStartAfter(el);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    placed = true;
  }
  if (!placed) { bodyEl.appendChild(el); }
  /* v1.6: after a placement, the saved caret moves to just after the
     inserted placeholder instead of being cleared, so a multi file
     attach inserts its placeholders in order, one after another at
     the spot the user picked, rather than scattering later files to
     the end of the note. An append (no usable caret) still clears
     the memory, and later files append in order behind it. */
  savedCaretRange = placed ? range.cloneRange() : null;
  /* v2.25: the trailing empty paragraph is no longer added
     after every insertion. Through v2.24.9 each inserted block
     left a fresh empty <p><br></p> behind it, so a run of
     inserted images stacked image, empty line, image, empty
     line (the big spaces Chris reported), and deleting one of
     those empty lines took the image beside it with it (see
     the empty line delete guard below). One trailing line is
     still added, but only when the block lands as a direct
     child of the body and is its last element, so a note that
     ends in an image keeps somewhere to type. A following
     sibling of any kind, an existing empty paragraph
     included, is reused as it stands and never duplicated,
     so sequential inserts land directly one after another;
     and a block inserted inside a line of text adds nothing
     at all. */
  if (el.parentNode === bodyEl && !el.nextElementSibling) {
    const p = document.createElement("p");
    p.appendChild(document.createElement("br"));
    el.after(p);
  }
}

/* ----- v2.25: the empty line delete guard -------------------------
   A caret sitting in an empty line next to an image, pressing
   Backspace or Delete to clear the space the line holds, used
   to delete the image instead: the empty block is a sibling
   of a contenteditable=false figure, and the browser's own
   merge across that boundary removes the figure. This guard
   takes exactly that one case: a collapsed caret inside an
   EMPTY top level text block (a P or DIV that is a direct
   child of the body and holds nothing but whitespace or a
   lone BR, the strict clearBlockIsEmpty test), with an
   attachment block on the side the key reaches toward. The
   keypress then removes ONLY the empty block, parks the caret
   where the block stood, and counts as handled. Every other
   case (real text in the block, a block inside a list, a
   table, or an attachment, a neighbour that is not an
   attachment, a selection that is not collapsed) returns
   false and the key keeps its native behavior, including the
   deliberate keyboard deletion of an image block itself,
   which the body input watch still reconciles into the
   undoable deletion engine exactly as before. */
function emptyLineDeleteGuard(ev) {
  if (!ev || (ev.key !== "Backspace" && ev.key !== "Delete")) {
    return false;
  }
  if (ev.ctrlKey || ev.metaKey || ev.altKey) { return false; }
  const note = currentNote();
  if (!note || note.trashed || note.archived) { return false; }
  const bodyEl = document.getElementById("noteBody");
  if (!bodyEl) { return false; }
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) { return false; }
  const range = sel.getRangeAt(0);
  if (!range.collapsed) { return false; }
  let block = range.startContainer;
  if (!block || block === bodyEl) { return false; }
  if (block.nodeType !== 1) { block = block.parentNode; }
  while (block && block.parentNode && block.parentNode !== bodyEl) {
    block = block.parentNode;
  }
  if (!block || block.parentNode !== bodyEl) { return false; }
  if (block.tagName !== "P" && block.tagName !== "DIV") { return false; }
  if (!clearBlockIsEmpty(block)) { return false; }
  const neighbor = ev.key === "Backspace"
    ? block.previousElementSibling : block.nextElementSibling;
  if (!neighbor || !neighbor.classList ||
      !neighbor.classList.contains("ss-attachment")) { return false; }
  const prev = block.previousElementSibling;
  const next = block.nextElementSibling;
  block.remove();
  const r = document.createRange();
  if (next) { r.setStartBefore(next); }
  else if (prev) { r.setStartAfter(prev); }
  else { r.setStart(bodyEl, 0); }
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  markDirty();
  return true;
}

/* ----- v2.45: document scan ----------------------------------------------
   Phase 4 release 1, built to the shape of Evernote's scan
   flow: capture pages, adjust the crop corners, enhance,
   review the pages, and save into the note. Evernote's
   scanner is a native camera with live edge detection;
   this app runs in a browser, so the camera arrives
   through a capture file input on mobile and an ordinary
   image pick anywhere, and the crop is adjusted after the
   shot instead of live. The flow's shape is the parity;
   the native viewfinder is the named deviation.

   A page is a decoded image plus four corners in fractions
   of the image (top left, top right, bottom right, bottom
   left). The corners start where the auto guess puts them
   (scanGuessCorners over a downscaled luminance grid: a
   page that differs from its surround gets its corners,
   anything else gets the inset default) and the user drags
   them on the stage. Confirming exports each page through
   a perspective warp (a homography onto the quad's own
   rectangle, drawn as an affine mesh) plus the session's
   enhancement, encodes it as a JPEG, and hands the files
   to handleIncomingFiles: the scan inserts through the
   app's REAL attachment upload path, so a scan page is an
   ordinary image attachment in every system after that
   (same records, same placeholders, same image menus,
   thumbnail, and Transcribe). Nothing is uploaded before
   confirm, and Cancel discards every page. No body format
   changes and no new placeholder kinds exist for scans.

   The small helpers scanDecodeImage, scanCanvasContext,
   and scanCanvasToBlob are the flow's only doors to the
   browser's image and canvas machinery, the image
   editor's seam pattern, so the behavior can be exercised
   in tests that stub them. The math (scanQuadDestSize,
   scanHomography, scanMapPoint, scanEnhancePixels,
   scanGuessCorners) is pure and proven directly. */

/* The export's long edge cap: a phone photo of a page is
   commonly 4000 px on its long edge, and a flattened scan
   stays legible far below that; 2000 keeps pages sharp
   (about 250 dpi on a letter page) without ballooning
   uploads. The JPEG quality matches the image editor's
   0.92 only in spirit: scans are documents, and 0.85
   keeps text edges clean at a much smaller size. */
const SCAN_MAX_EDGE = 2000;
const SCAN_JPEG_QUALITY = 0.85;
/* Corner placement when no page edge can be guessed: the
   page inset 6% from each edge of the photo. */
const SCAN_DEFAULT_INSET = 0.06;
/* The warp mesh density: the homography is drawn as this
   many affine cells per side. 10 by 10 reads as a true
   perspective flatten on real pages and stays cheap. */
const SCAN_WARP_MESH = 10;
/* v2.74.0: the bleed on each warp cell's clip triangle,
   in destination pixels. A cell is painted clipped to
   its own triangle, and the browser antialiases that
   clip edge against the empty canvas beneath rather
   than against the neighbour cell, so every shared edge
   used to land at partial coverage and read as a faint
   dark grid over the flattened page (measured on a flat
   field in the real browser: the seam lines sat 17 to
   21 luminance points below the cell interiors, the
   worst seam pixel 55 below, and seam alpha bottomed
   at 196 of 255). The clip triangle is therefore grown
   by this much, each vertex pushed away from the
   triangle's centroid, which carries every edge
   outward by about a pixel, so neighbours overlap and
   every seam is covered by real image. The cell's
   transform and source triangle are NOT touched: the
   two cells sharing an edge interpolate the same two
   source endpoints along it, so their samplings agree
   exactly on the edge itself, and the overlap paints
   the same image the seam would have hidden. */
const SCAN_WARP_BLEED = 3;

let scanState = null;
let scanDrag = null;

function scanCanvasContext(canvas) {
  try { return canvas ? canvas.getContext("2d") : null; }
  catch (err) { return null; }
}

function scanDecodeImage(url) {
  return new Promise(function (resolve, reject) {
    const img = new Image();
    img.onload = function () { resolve(img); };
    img.onerror = function () {
      reject(new Error("The photo could not be read."));
    };
    img.src = url;
  });
}

function scanCanvasToBlob(canvas) {
  return new Promise(function (resolve, reject) {
    if (typeof canvas.toBlob === "function") {
      canvas.toBlob(function (blob) {
        if (blob) { resolve(blob); }
        else { reject(new Error("The scanned page could not be prepared.")); }
      }, "image/jpeg", SCAN_JPEG_QUALITY);
      return;
    }
    try {
      const url = canvas.toDataURL("image/jpeg", SCAN_JPEG_QUALITY);
      const comma = url.indexOf(",");
      const bin = atob(url.slice(comma + 1));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
      }
      resolve(new Blob([bytes], { type: "image/jpeg" }));
    } catch (err) { reject(err); }
  });
}

function scanDefaultCorners() {
  const i = SCAN_DEFAULT_INSET;
  return [
    { x: i, y: i }, { x: 1 - i, y: i },
    { x: 1 - i, y: 1 - i }, { x: i, y: 1 - i }
  ];
}

function scanClamp01(v) {
  return v < 0 ? 0 : (v > 1 ? 1 : v);
}

/* The corner guess over a luminance grid (values 0 to
   255, row major, gw by gh). The background is the mean
   of the four corner patches; a pixel belongs to the
   page when it differs from that background by more
   than the threshold, in either direction, so a bright
   page on a dark table and a dark page on a bright one
   both read. The corners are the mask's extreme points
   (smallest and largest x+y and x-y), returned in image
   fractions. A mask covering almost nothing or almost
   everything is no page at all: null, and the caller
   uses the inset default. Honest quality note: this is
   a starting placement, not edge detection. It works
   when the page contrasts with its surround and the
   surround is fairly even; clutter, shadows, and a page
   filling the frame all defeat it, and the inset
   default plus a drag is the answer there. */
function scanGuessCorners(lum, gw, gh) {
  if (!lum || !gw || !gh || gw < 4 || gh < 4) { return null; }
  function patchMean(cx, cy) {
    let sum = 0, n = 0;
    for (let y = Math.max(0, cy - 1); y <= Math.min(gh - 1, cy + 1); y++) {
      for (let x = Math.max(0, cx - 1); x <= Math.min(gw - 1, cx + 1); x++) {
        sum += lum[y * gw + x]; n++;
      }
    }
    return n ? sum / n : 0;
  }
  const bg = (patchMean(0, 0) + patchMean(gw - 1, 0) +
    patchMean(gw - 1, gh - 1) + patchMean(0, gh - 1)) / 4;
  let count = 0;
  let tl = null, tr = null, br = null, bl = null;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (Math.abs(lum[y * gw + x] - bg) <= 28) { continue; }
      count++;
      const sum = x + y, diff = x - y;
      if (!tl || sum < tl.sum) { tl = { x: x, y: y, sum: sum }; }
      if (!br || sum > br.sum) { br = { x: x, y: y, sum: sum }; }
      if (!tr || diff > tr.diff) { tr = { x: x, y: y, diff: diff }; }
      if (!bl || diff < bl.diff) { bl = { x: x, y: y, diff: diff }; }
    }
  }
  const frac = count / (gw * gh);
  if (!tl || !tr || !br || !bl || frac < 0.04 || frac > 0.97) {
    return null;
  }
  function norm(p) {
    return { x: (p.x + 0.5) / gw, y: (p.y + 0.5) / gh };
  }
  return [norm(tl), norm(tr), norm(br), norm(bl)];
}

/* The starting corners for a freshly decoded page: the
   guess over a 64 px luminance sampling of the image,
   or the inset default whenever any step is unavailable
   (no canvas context, a tainted or unreadable sampling).
   Never throws: a scan must always open. */
async function scanDetectCorners(img) {
  try {
    const iw = (img && (img.naturalWidth || img.width)) || 0;
    const ih = (img && (img.naturalHeight || img.height)) || 0;
    if (!iw || !ih) { return scanDefaultCorners(); }
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = Math.max(4, Math.round(64 * ih / iw));
    const ctx = scanCanvasContext(canvas);
    if (!ctx || typeof ctx.getImageData !== "function") {
      return scanDefaultCorners();
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0,
      canvas.width, canvas.height).data;
    const lum = new Float32Array(canvas.width * canvas.height);
    for (let i = 0; i < lum.length; i++) {
      lum[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] +
        0.114 * data[i * 4 + 2];
    }
    return scanGuessCorners(lum, canvas.width, canvas.height) ||
      scanDefaultCorners();
  } catch (err) {
    return scanDefaultCorners();
  }
}

/* The warp's destination size: the quad's own edge
   lengths in source pixels (the longer of each opposite
   pair), so a page photographed at an angle keeps the
   proportions the paper had, capped at SCAN_MAX_EDGE on
   the long edge with the proportions held. */
function scanQuadDestSize(corners, srcW, srcH) {
  function dist(a, b) {
    const dx = (a.x - b.x) * srcW, dy = (a.y - b.y) * srcH;
    return Math.sqrt(dx * dx + dy * dy);
  }
  let w = Math.max(dist(corners[0], corners[1]),
    dist(corners[3], corners[2]));
  let h = Math.max(dist(corners[0], corners[3]),
    dist(corners[1], corners[2]));
  w = Math.max(2, Math.round(w));
  h = Math.max(2, Math.round(h));
  const longest = Math.max(w, h);
  if (longest > SCAN_MAX_EDGE) {
    const s = SCAN_MAX_EDGE / longest;
    w = Math.max(2, Math.round(w * s));
    h = Math.max(2, Math.round(h * s));
  }
  return { w: w, h: h };
}

/* The 3 by 3 homography (as 9 numbers, last one 1) that
   maps each point of `from` onto the matching point of
   `to`, solved by Gauss-Jordan elimination. Null when
   the system is degenerate (a self crossing quad). */
function scanHomography(from, to) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const x = from[i].x, y = from[i].y;
    const u = to[i].x, v = to[i].y;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const n = 8;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) { piv = r; }
    }
    if (Math.abs(A[piv][col]) < 1e-12) { return null; }
    if (piv !== col) {
      const ta = A[piv]; A[piv] = A[col]; A[col] = ta;
      const tb = b[piv]; b[piv] = b[col]; b[col] = tb;
    }
    const d = A[col][col];
    for (let c = col; c < n; c++) { A[col][c] /= d; }
    b[col] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col || A[r][col] === 0) { continue; }
      const f = A[r][col];
      for (let c = col; c < n; c++) { A[r][c] -= f * A[col][c]; }
      b[r] -= f * b[col];
    }
  }
  return [b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], 1];
}

function scanMapPoint(H, x, y) {
  const den = H[6] * x + H[7] * y + H[8];
  return {
    x: (H[0] * x + H[1] * y + H[2]) / den,
    y: (H[3] * x + H[4] * y + H[5]) / den
  };
}

/* The enhancement as a pure pixel transform over an
   ImageData style array (RGBA quads, mutated in place).
   Color is the identity: the photo stands as shot.
   Document is the scanner's black and white: grayscale
   by luminance with a levels lift (16 to 239 stretched
   to 0 to 255), which drops gray paper toward white and
   gray print toward black the way Evernote's document
   enhancement reads. Alpha is never touched. */
function scanEnhancePixels(data, mode) {
  if (mode !== "document") { return data; }
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] +
      0.114 * data[i + 2];
    let v = (lum - 16) * 255 / 223;
    v = v < 0 ? 0 : (v > 255 ? 255 : v);
    data[i] = v; data[i + 1] = v; data[i + 2] = v;
  }
  return data;
}

/* One affine cell of the warp: the canvas transform that
   carries the source triangle (s0, s1, s2) onto the
   destination triangle (d0, d1, d2), drawn clipped to
   the destination triangle grown by SCAN_WARP_BLEED
   (see its note: the growth is clip only, so the
   painted sampling is the plain cell's own). Null
   transform (a degenerate source triangle) draws
   nothing. */
function scanDrawWarpCell(ctx, img, s0, s1, s2, d0, d1, d2) {
  const det = (s1.x - s0.x) * (s2.y - s0.y) -
    (s2.x - s0.x) * (s1.y - s0.y);
  if (!det) { return; }
  const m11 = ((d1.x - d0.x) * (s2.y - s0.y) -
    (d2.x - d0.x) * (s1.y - s0.y)) / det;
  const m12 = ((d2.x - d0.x) * (s1.x - s0.x) -
    (d1.x - d0.x) * (s2.x - s0.x)) / det;
  const m21 = ((d1.y - d0.y) * (s2.y - s0.y) -
    (d2.y - d0.y) * (s1.y - s0.y)) / det;
  const m22 = ((d2.y - d0.y) * (s1.x - s0.x) -
    (d1.y - d0.y) * (s2.x - s0.x)) / det;
  const e = d0.x - m11 * s0.x - m12 * s0.y;
  const f = d0.y - m21 * s0.x - m22 * s0.y;
  /* The clip points: the destination triangle with
     each vertex pushed SCAN_WARP_BLEED destination
     pixels away from the centroid, so the painted
     cell overlaps its neighbours along every edge.
     A vertex sitting on the centroid (a degenerate
     destination) stays where it is. */
  const ccx = (d0.x + d1.x + d2.x) / 3;
  const ccy = (d0.y + d1.y + d2.y) / 3;
  function clipPoint(d) {
    const dx = d.x - ccx, dy = d.y - ccy;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (!len) { return { x: d.x, y: d.y }; }
    const k = SCAN_WARP_BLEED / len;
    return { x: d.x + dx * k, y: d.y + dy * k };
  }
  const c0 = clipPoint(d0), c1 = clipPoint(d1),
    c2 = clipPoint(d2);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(c0.x, c0.y);
  ctx.lineTo(c1.x, c1.y);
  ctx.lineTo(c2.x, c2.y);
  ctx.closePath();
  ctx.clip();
  ctx.setTransform(m11, m21, m12, m22, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

/* Draws the page's quad flattened onto an outW by outH
   rectangle in the given context: the destination to
   source homography places a mesh of destination cells,
   each drawn as two affine triangles. A degenerate quad
   (no homography) falls back to a plain stretch draw, so
   a flattened page always comes out. */
function scanDrawWarped(ctx, img, page, outW, outH) {
  const srcW = (img && (img.naturalWidth || img.width)) || 0;
  const srcH = (img && (img.naturalHeight || img.height)) || 0;
  if (!srcW || !srcH) { return; }
  const srcQuad = page.corners.map(function (c) {
    return { x: c.x * srcW, y: c.y * srcH };
  });
  const dstQuad = [
    { x: 0, y: 0 }, { x: outW, y: 0 },
    { x: outW, y: outH }, { x: 0, y: outH }
  ];
  const back = scanHomography(dstQuad, srcQuad);
  if (!back) {
    ctx.drawImage(img, 0, 0, outW, outH);
    return;
  }
  const mesh = SCAN_WARP_MESH;
  for (let gy = 0; gy < mesh; gy++) {
    for (let gx = 0; gx < mesh; gx++) {
      const x0 = outW * gx / mesh, x1 = outW * (gx + 1) / mesh;
      const y0 = outH * gy / mesh, y1 = outH * (gy + 1) / mesh;
      const s00 = scanMapPoint(back, x0, y0);
      const s10 = scanMapPoint(back, x1, y0);
      const s11 = scanMapPoint(back, x1, y1);
      const s01 = scanMapPoint(back, x0, y1);
      scanDrawWarpCell(ctx, img, s00, s10, s01,
        { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x0, y: y1 });
      scanDrawWarpCell(ctx, img, s10, s11, s01,
        { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 });
    }
  }
}

/* Applies the session's enhancement to a warped canvas
   in place. Guarded throughout: an enhancement failure
   leaves the warped page as it stands rather than
   losing the scan over it. */
function scanApplyEnhancement(canvas, ctx, mode) {
  if (mode !== "document") { return; }
  if (typeof ctx.getImageData !== "function" ||
      typeof ctx.putImageData !== "function") { return; }
  try {
    const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
    scanEnhancePixels(id.data, mode);
    ctx.putImageData(id, 0, 0);
  } catch (err) { /* the unenhanced page stands */ }
}

/* One page, flattened and enhanced, as a JPEG blob: the
   export the confirm path uploads. The mode is the
   session's, read from the live dialog state. */
async function scanExportPageToBlob(page) {
  const img = page.img;
  const srcW = (img && (img.naturalWidth || img.width)) || 0;
  const srcH = (img && (img.naturalHeight || img.height)) || 0;
  if (!srcW || !srcH) {
    throw new Error("A scan page had no readable image.");
  }
  const size = scanQuadDestSize(page.corners, srcW, srcH);
  const canvas = document.createElement("canvas");
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = scanCanvasContext(canvas);
  if (!ctx) {
    throw new Error("This browser could not prepare the scanned page.");
  }
  scanDrawWarped(ctx, img, page, size.w, size.h);
  scanApplyEnhancement(canvas, ctx,
    (scanState && scanState.mode) || "color");
  return scanCanvasToBlob(canvas);
}

function scanCurrentPage() {
  if (!scanState || !scanState.pages.length) { return null; }
  const i = Math.min(Math.max(scanState.current, 0),
    scanState.pages.length - 1);
  return scanState.pages[i];
}

/* The stage's quad furniture (outline and handles)
   follows the current page's corners. A corner fraction
   renders as its percent number (0.5 as "50"), rounded
   to two decimals so equal corners render byte equal
   strings; the outline's viewBox is 0 to 100, so the
   same numbers serve it and the handle styles. */
function scanPercent(v) {
  return String(Math.round(v * 10000) / 100);
}

function positionScanQuad() {
  const page = scanCurrentPage();
  if (!page) { return; }
  const poly = document.getElementById("scanQuadPoly");
  poly.setAttribute("points", page.corners.map(function (c) {
    return scanPercent(c.x) + "," + scanPercent(c.y);
  }).join(" "));
  document.querySelectorAll("#scanStage .scan-handle")
    .forEach(function (h) {
      const c = page.corners[Number(h.getAttribute("data-corner"))];
      if (!c) { return; }
      h.style.left = scanPercent(c.x) + "%";
      h.style.top = scanPercent(c.y) + "%";
    });
}

/* The flattened preview under the stage: the same warp
   and enhancement the export runs, drawn at the preview
   canvas's own size. Where the browser offers no canvas
   the preview simply does not show; the stage above it
   still carries the page. */
function scanRenderPreview() {
  const wrap = document.getElementById("scanPreviewWrap");
  const canvas = document.getElementById("scanPreviewCanvas");
  const page = scanCurrentPage();
  if (!page || !page.w || !page.h) {
    wrap.classList.add("hidden");
    return;
  }
  const size = scanQuadDestSize(page.corners, page.w, page.h);
  const scale = Math.min(1, 480 / size.w);
  canvas.width = Math.max(2, Math.round(size.w * scale));
  canvas.height = Math.max(2, Math.round(size.h * scale));
  const ctx = scanCanvasContext(canvas);
  if (!ctx) {
    wrap.classList.add("hidden");
    return;
  }
  wrap.classList.remove("hidden");
  /* v2.74.0: the warp is drawn at the preview canvas's
     own size, never at the export size under a scaled
     context. A warp cell paints through setTransform,
     which replaces the current transform outright
     instead of composing with it, so the old scaled
     draw painted the full size output, at full scale,
     into the small canvas's clip tiling: for any page
     wider than the preview cap the flattened preview
     showed the export's top left corner region instead
     of the flattened page (measured in the real
     browser against the export drawn at the same
     size: whole quadrants of the page missing from
     the preview while the inserted page was correct).
     Drawn at canvas size, the preview is the export's
     own geometry at preview resolution. */
  scanDrawWarped(ctx, page.img, page, canvas.width,
    canvas.height);
  scanApplyEnhancement(canvas, ctx,
    (scanState && scanState.mode) || "color");
}

function renderScanDialog() {
  if (!scanState) { return; }
  const pages = scanState.pages;
  const page = scanCurrentPage();
  document.getElementById("scanStageEmpty").classList
    .toggle("hidden", !!page);
  document.getElementById("scanStage").classList
    .toggle("hidden", !page);
  if (page) {
    const img = document.getElementById("scanStageImg");
    if (img.getAttribute("src") !== page.url) {
      img.setAttribute("src", page.url);
    }
    positionScanQuad();
  }
  const strip = document.getElementById("scanPageStrip");
  strip.innerHTML = "";
  pages.forEach(function (p, i) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "scan-page-chip" +
      (i === scanState.current ? " current" : "");
    chip.setAttribute("role", "option");
    chip.setAttribute("aria-selected",
      i === scanState.current ? "true" : "false");
    chip.setAttribute("aria-label", "Page " + (i + 1) + ": " + p.name);
    const thumb = document.createElement("img");
    thumb.setAttribute("src", p.url);
    thumb.setAttribute("alt", "");
    const label = document.createElement("span");
    label.textContent = "Page " + (i + 1);
    chip.appendChild(thumb);
    chip.appendChild(label);
    chip.addEventListener("click", function () {
      if (!scanState) { return; }
      scanState.current = i;
      scanState.replaceArmed = false;
      renderScanDialog();
    });
    strip.appendChild(chip);
  });
  document.getElementById("scanPageCount").textContent =
    !pages.length ? "No pages yet" :
      pages.length + (pages.length === 1 ? " page" : " pages");
  document.getElementById("scanRetakeBtn").disabled = !page;
  document.getElementById("scanRemovePageBtn").disabled = !page;
  const insertBtn = document.getElementById("scanInsertBtn");
  insertBtn.disabled = !pages.length || scanState.busy;
  insertBtn.textContent = !pages.length ? "Insert pages" :
    pages.length === 1 ? "Insert page" :
      "Insert " + pages.length + " pages";
  document.getElementById("scanModeColorBtn")
    .setAttribute("aria-pressed",
      scanState.mode === "color" ? "true" : "false");
  document.getElementById("scanModeDocumentBtn")
    .setAttribute("aria-pressed",
      scanState.mode === "document" ? "true" : "false");
  scanRenderPreview();
}

/* Opens the scan dialog over the open note. The guards
   are the attach flow's own (a live note, online),
   because the pages upload the same way at confirm. The
   caret is captured first, exactly as startAttachFlow
   does, so the inserted pages land where the caret was. */
function openScanDialog() {
  const note = currentNote();
  if (!note) {
    toast("Open a note first, then scan a document into it.", true);
    return;
  }
  if (note.trashed) {
    toast("A document cannot be scanned into a note in Trash. Restore it first.", true);
    return;
  }
  if (note.archived) {
    toast("A document cannot be scanned into an archived note. Unarchive it first.", true);
    return;
  }
  if (!state.online) {
    toast("Scanning needs an internet connection: the pages are uploaded to your storage provider when you insert them. You appear to be offline.", true);
    return;
  }
  captureCaret();
  scanState = {
    pages: [], current: 0, mode: "color",
    busy: false, replaceArmed: false
  };
  renderScanDialog();
  document.getElementById("scanModal").classList.remove("hidden");
}

/* Discards the whole scan: every page's object URL is
   revoked and nothing is uploaded, ever, on this path. */
function closeScanDialog() {
  if (scanState) {
    scanState.pages.forEach(function (p) {
      try { URL.revokeObjectURL(p.url); } catch (err) { /* gone */ }
    });
  }
  scanState = null;
  scanDrag = null;
  document.getElementById("scanModal").classList.add("hidden");
}

/* Feeds picked or photographed files into the dialog as
   pages. With replace set (a Retake), the first file
   replaces the current page in place; the rest append.
   A file that is not an image, is over the attachment
   cap, or cannot be decoded is named and skipped, never
   silently swallowed. */
async function scanAddFiles(files, replace) {
  if (!scanState) { return; }
  for (const file of files) {
    if (!file) { continue; }
    if ((file.type || "").indexOf("image/") !== 0) {
      toast("\"" + (file.name || "That file") +
        "\" is not an image and was skipped.", true);
      continue;
    }
    if (file.size > ATTACH_MAX_BYTES) {
      toast("\"" + file.name +
        "\" is larger than the 100 MB per file limit and was skipped.", true);
      continue;
    }
    const url = URL.createObjectURL(file);
    let img;
    try {
      img = await scanDecodeImage(url);
    } catch (err) {
      try { URL.revokeObjectURL(url); } catch (e) { /* gone */ }
      toast("That photo could not be read: " + err.message, true);
      continue;
    }
    const page = {
      id: newNoteId(),
      name: file.name || "Photo",
      url: url, img: img,
      w: (img && (img.naturalWidth || img.width)) || 0,
      h: (img && (img.naturalHeight || img.height)) || 0,
      corners: await scanDetectCorners(img)
    };
    if (!scanState) {
      try { URL.revokeObjectURL(url); } catch (e) { /* gone */ }
      return;
    }
    if (replace && scanState.pages.length) {
      const old = scanState.pages[scanState.current];
      if (old) {
        try { URL.revokeObjectURL(old.url); } catch (e) { /* gone */ }
      }
      scanState.pages[scanState.current] = page;
      replace = false;
    } else {
      scanState.pages.push(page);
      scanState.current = scanState.pages.length - 1;
    }
    renderScanDialog();
  }
}

/* The two capture inputs share one change path (the
   attach picker's discipline: copy the list, clear the
   input so the same photo can be picked again). */
function onScanInputChange(ev) {
  const files = Array.prototype.slice.call(ev.target.files || []);
  ev.target.value = "";
  if (!scanState || !files.length) { return; }
  const replace = scanState.replaceArmed;
  scanState.replaceArmed = false;
  scanAddFiles(files, replace).catch(function (err) {
    toast("Scan failed: " + err.message, true);
  });
}

/* Confirm: export EVERY page first, so an export failure
   leaves the dialog open with the scan intact and
   nothing uploaded; only then hand the JPEG files to
   the ordinary attachment flow, which rechecks the note
   and the provider itself, inserts at the captured
   caret in order, and owns every failure message after
   this point. */
async function confirmScanDialog() {
  if (!scanState || scanState.busy) { return; }
  if (!scanState.pages.length) {
    toast("Add at least one page first.", true);
    return;
  }
  scanState.busy = true;
  renderScanDialog();
  const files = [];
  try {
    for (let i = 0; i < scanState.pages.length; i++) {
      const blob = await scanExportPageToBlob(scanState.pages[i]);
      files.push(new File([blob],
        "Scanned page " + (i + 1) + ".jpg",
        { type: "image/jpeg" }));
    }
  } catch (err) {
    if (scanState) {
      scanState.busy = false;
      renderScanDialog();
    }
    toast("The scan could not be prepared: " + err.message, true);
    return;
  }
  closeScanDialog();
  try {
    await handleIncomingFiles(files);
  } catch (err) {
    toast("Attach failed: " + err.message, true);
  }
}

/* The corner drag: a press on a handle tracks that
   corner by pointer id until the pointer lifts, the
   reorder drag's discipline in miniature (window level
   move and up listeners, the stage's own rect as the
   coordinate frame, fractions clamped to the image).
   Only the furniture moves during the drag; the page's
   corners are the model and the preview follows. */
function onScanHandlePointerDown(ev) {
  if (!scanState || !scanCurrentPage()) { return; }
  if (ev.pointerType === "mouse" && ev.button !== 0) { return; }
  const handle = ev.currentTarget;
  scanDrag = {
    pointerId: ev.pointerId,
    corner: Number(handle.getAttribute("data-corner"))
  };
  if (handle.setPointerCapture && ev.pointerId !== undefined) {
    try { handle.setPointerCapture(ev.pointerId); }
    catch (err) { /* capture is a nicety, not the drag */ }
  }
  window.addEventListener("pointermove", onScanDragMove);
  window.addEventListener("pointerup", onScanDragUp);
  window.addEventListener("pointercancel", onScanDragUp);
  ev.preventDefault();
}

function onScanDragMove(ev) {
  if (!scanDrag || ev.pointerId !== scanDrag.pointerId) { return; }
  const page = scanCurrentPage();
  if (!page) { return; }
  const rect = document.getElementById("scanStage")
    .getBoundingClientRect();
  if (!rect.width || !rect.height) { return; }
  page.corners[scanDrag.corner] = {
    x: scanClamp01((ev.clientX - rect.left) / rect.width),
    y: scanClamp01((ev.clientY - rect.top) / rect.height)
  };
  positionScanQuad();
  scanRenderPreview();
}

function onScanDragUp(ev) {
  if (!scanDrag || (ev && ev.pointerId !== scanDrag.pointerId)) {
    return;
  }
  scanDrag = null;
  window.removeEventListener("pointermove", onScanDragMove);
  window.removeEventListener("pointerup", onScanDragUp);
  window.removeEventListener("pointercancel", onScanDragUp);
}

/* ----- v2.46: sketch block ------------------------------------------------
   Phase 4 release 2 of the Evernote parity program, built to
   Evernote's sketch (its help and release coverage agree on the
   shape): from an open note, the Insert menu (desktop) or the pen
   item (mobile) opens a canvas over the note; the tools are a pen
   and a highlighter (each with colors and thicknesses to pick), an
   eraser, and a selection tool; finger or stylus draws; Done saves
   the canvas into the note as an image that sizes to fit, and
   tapping that image later reopens it in the sketch editor, on
   every device the note syncs to.

   This build, in that shape and with the deviations named in the
   header history: one canvas in a themed dialog; a pen (eight
   colors, three thicknesses), an eraser, Undo, and Clear; no
   highlighter, lasso, or redo. Saving exports the canvas as a PNG
   (the standing format rule: PNG first, never WebP; line art
   belongs in PNG) through the app's real attachment path.

   The marking, chosen light and doubled so each half backs the
   other: a sketch's attachment record carries sketch:true (the
   sanitizer keeps the field only when it is exactly true, and it
   is written only for sketches, so every other record serializes
   byte identically to before), and its placeholder carries
   data-ss-sketch="1", which the save funnel preserves the way it
   preserves the alignment and view attributes. isSketchAttachment
   reads either half. The image menu shows Edit sketch only for a
   marked image; that action reopens this dialog with the saved
   PNG loaded as the canvas's base image, and Save replaces the
   attachment's file in place through the image editor's own
   replaceAttachmentImage (same record, same block, same spot in
   the note; the record keeps sketch:true untouched). Duplicate
   and merge copies carry the field to the new records (see
   copyAttachmentsForNewNote), so a copied sketch stays a sketch;
   the placeholder attribute rides the copied body the same way.
   Exports meet only the PNG: the marking lives in the note file
   (the front matter JSON and the body placeholder) and grants
   nothing outside this app.

   The stroke model is the session's truth: a list of strokes,
   each a tool, a color, a width, and its points in canvas pixels.
   The base (a reopened sketch's saved drawing, or nothing) is NOT
   part of the model: it is drawn under a transparent stroke
   layer, and the eraser lifts paint from that layer only. In a
   fresh sketch the layer is the whole drawing, so the eraser
   erases; in a reopened sketch the eraser and Undo reach only the
   new session's strokes, never the saved drawing flattened under
   them. That is the honest cost of storing a PNG instead of
   Evernote's vector ink, and it is named in the header history
   as a deviation.

   The canvas doors are the image editor's small helpers (its
   context getter, image loader, and blob exporter), so tests
   that stub them still exercise the real dialog, handlers, model,
   and upload path; jsdom has no rasterizer, so no test here can
   prove a pixel.
   -------------------------------------------------------------------------- */
const SKETCH_NEW_WIDTH = 1200;
const SKETCH_NEW_HEIGHT = 800;
/* The eraser runs broader than the pen at the same thickness
   choice: erasing with a hairline is miserable on a finger. */
const SKETCH_ERASER_SCALE = 4;

let sketchState = null;

/* A marked image, by either half of the marking (see the section
   head): the record's sketch flag, or the saved placeholder
   attribute on the figure itself. */
function isSketchAttachment(att, el) {
  if (att && att.sketch === true) { return true; }
  if (el && el.getAttribute &&
      el.getAttribute("data-ss-sketch") === "1") { return true; }
  return false;
}

function sketchCanvasEl() {
  return document.getElementById("sketchCanvas");
}

/* Opens the dialog for a NEW sketch over the open note. The
   guards are the attach flow's own (a live note, online),
   because the drawing uploads the same way at Save. The caret
   is captured first, exactly as startAttachFlow does, so the
   inserted sketch lands where the caret was. */
function openSketchDialog() {
  const note = currentNote();
  if (!note) {
    toast("Open a note first, then add a sketch to it.", true);
    return;
  }
  if (note.trashed) {
    toast("A sketch cannot be added to a note in Trash. Restore it first.", true);
    return;
  }
  if (note.archived) {
    toast("A sketch cannot be added to an archived note. Unarchive it first.", true);
    return;
  }
  if (!state.online) {
    toast("Sketching needs an internet connection: the sketch is uploaded to your storage provider when you save it. You appear to be offline.", true);
    return;
  }
  captureCaret();
  sketchOpenWith({
    note: note, att: null, el: null,
    baseImg: null, baseUrl: null,
    width: SKETCH_NEW_WIDTH, height: SKETCH_NEW_HEIGHT
  });
}

/* Opens the dialog on an EXISTING sketch: the saved PNG is
   fetched through the shared attachment reader and loaded as
   the canvas's base image, at its own pixel size, so new
   strokes land on the drawing exactly where they are drawn.
   Any failure leaves the note untouched and the dialog shut. */
async function openSketchEditorFor(note, att, el) {
  if (!note || !att) { return; }
  if (!isSketchAttachment(att, el)) {
    toast("That image is not a sketch and cannot be edited as one.", true);
    return;
  }
  let blob;
  try {
    blob = await fetchAttachmentBlob(att);
  } catch (err) {
    toast(err.message, true);
    return;
  }
  const url = URL.createObjectURL(blob);
  let img;
  try {
    img = await imageEditorLoadImage(url);
  } catch (err) {
    try { URL.revokeObjectURL(url); } catch (e) { /* gone */ }
    toast(err.message, true);
    return;
  }
  sketchOpenWith({
    note: note, att: att, el: el || null,
    baseImg: img, baseUrl: url,
    width: (img && (img.naturalWidth || img.width)) || SKETCH_NEW_WIDTH,
    height: (img && (img.naturalHeight || img.height)) || SKETCH_NEW_HEIGHT
  });
}

/* Shared open: fresh session state (the pen in black at the
   thin width, an empty stroke list, an offscreen stroke layer
   the size of the canvas), the canvas sized, the dialog
   rendered and shown. */
function sketchOpenWith(spec) {
  const canvas = sketchCanvasEl();
  canvas.width = spec.width;
  canvas.height = spec.height;
  const layer = document.createElement("canvas");
  layer.width = spec.width;
  layer.height = spec.height;
  sketchState = {
    note: spec.note, att: spec.att, el: spec.el,
    baseImg: spec.baseImg, baseUrl: spec.baseUrl,
    strokes: [], current: null,
    tool: "pen", color: "#111111", widthPx: 3,
    saving: false, layer: layer
  };
  renderSketchDialog();
  document.getElementById("sketchModal").classList.remove("hidden");
}

/* Discards the session whole: the base image's object URL is
   revoked (a new sketch has none) and nothing is uploaded,
   ever, on this path. */
function closeSketchDialog() {
  if (sketchState && sketchState.baseUrl) {
    try { URL.revokeObjectURL(sketchState.baseUrl); }
    catch (err) { /* gone */ }
  }
  sketchState = null;
  document.getElementById("sketchModal").classList.add("hidden");
}

/* Renders the dialog's stateful controls from the session: the
   title and sub (a new sketch, or the one being edited, with
   the eraser's reach stated where it matters), the Save label,
   the tool segmented control's pressed side, the current
   color's ring and the current thickness's fill (the visibly
   obvious choice rule), and Undo and Clear enabled only while
   strokes exist. Then the canvas itself. */
function renderSketchDialog() {
  const st = sketchState;
  if (!st) { return; }
  document.getElementById("sketchModalTitle").textContent =
    st.att ? "Edit sketch" : "Sketch";
  document.getElementById("sketchModalSub").textContent = st.att
    ? st.att.name + ". Saving replaces the sketch in this note, " +
      "in the same place; the eraser and Undo reach only the " +
      "strokes you add now."
    : "Draw with the pen, erase with the eraser, then save the " +
      "sketch into this note as an image you can reopen and " +
      "keep editing.";
  const saveBtn = document.getElementById("sketchSaveBtn");
  saveBtn.textContent = st.att ? "Save changes" : "Save sketch";
  saveBtn.disabled = !!st.saving;
  document.getElementById("sketchPenBtn").setAttribute("aria-pressed",
    st.tool === "pen" ? "true" : "false");
  document.getElementById("sketchEraserBtn").setAttribute("aria-pressed",
    st.tool === "eraser" ? "true" : "false");
  document.querySelectorAll("#sketchTools .sketch-color")
    .forEach(function (btn) {
      btn.classList.toggle("current",
        btn.getAttribute("data-sketch-color") === st.color);
    });
  document.querySelectorAll("#sketchTools .sketch-width-btn")
    .forEach(function (btn) {
      btn.classList.toggle("current",
        Number(btn.getAttribute("data-sketch-width")) === st.widthPx);
    });
  document.getElementById("sketchUndoBtn").disabled =
    !st.strokes.length || !!st.saving;
  document.getElementById("sketchClearBtn").disabled =
    !st.strokes.length || !!st.saving;
  sketchRedraw();
}

/* One stroke onto a context: a round capped polyline through
   its points (a lone point draws as a dot). Eraser strokes run
   under destination-out, which is only ever applied to the
   stroke layer, so they lift session paint and can never touch
   the base under it. */
function sketchDrawStroke(ctx, stroke) {
  const pts = stroke.points;
  if (!pts || !pts.length) { return; }
  ctx.save();
  if (stroke.tool === "eraser") {
    ctx.globalCompositeOperation = "destination-out";
  }
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) { ctx.lineTo(pts[i].x, pts[i].y); }
  if (pts.length === 1) { ctx.lineTo(pts[0].x + 0.1, pts[0].y + 0.1); }
  ctx.stroke();
  ctx.restore();
}

/* The canvas, repainted whole from the model on every change:
   white paper, the base image if this session edits one, then
   the stroke layer (the session's strokes, the current one
   included, rendered onto the transparent offscreen layer).
   Guarded: where the browser offers no canvas context the
   model still records every stroke, and only the paint is
   skipped. */
function sketchRedraw() {
  const st = sketchState;
  if (!st) { return; }
  const canvas = sketchCanvasEl();
  const ctx = imageEditorContext(canvas);
  if (!ctx) { return; }
  const lctx = imageEditorContext(st.layer);
  if (lctx) {
    lctx.clearRect(0, 0, st.layer.width, st.layer.height);
    st.strokes.forEach(function (s) { sketchDrawStroke(lctx, s); });
    if (st.current) { sketchDrawStroke(lctx, st.current); }
  }
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (st.baseImg) {
    ctx.drawImage(st.baseImg, 0, 0, canvas.width, canvas.height);
  }
  if (lctx) { ctx.drawImage(st.layer, 0, 0); }
}

/* A pointer position in canvas pixels: the displayed size
   scales to the bitmap size, the image editor's own mapping. */
function sketchPoint(ev) {
  const canvas = sketchCanvasEl();
  const rect = canvas.getBoundingClientRect();
  const sx = rect.width ? canvas.width / rect.width : 1;
  const sy = rect.height ? canvas.height / rect.height : 1;
  return {
    x: (ev.clientX - rect.left) * sx,
    y: (ev.clientY - rect.top) * sy
  };
}

/* The drawing handlers: one Pointer Events path for mouse,
   touch, and stylus, the canvas holding the capture so a
   stroke survives leaving its edge mid drag. A press starts a
   stroke in the active tool (the eraser at its broadened
   width), moves extend it, and a lift commits it to the model
   and re-renders the controls (Undo wakes). */
function onSketchPointerDown(ev) {
  const st = sketchState;
  if (!st || st.saving) { return; }
  if (ev.pointerType === "mouse" && ev.button !== 0) { return; }
  ev.preventDefault();
  st.current = {
    tool: st.tool,
    color: st.color,
    width: st.tool === "eraser"
      ? st.widthPx * SKETCH_ERASER_SCALE : st.widthPx,
    points: [sketchPoint(ev)]
  };
  const canvas = sketchCanvasEl();
  if (canvas.setPointerCapture && ev.pointerId !== undefined) {
    try { canvas.setPointerCapture(ev.pointerId); }
    catch (err) { /* capture is a nicety, not the stroke */ }
  }
  sketchRedraw();
}

function onSketchPointerMove(ev) {
  const st = sketchState;
  if (!st || !st.current) { return; }
  st.current.points.push(sketchPoint(ev));
  sketchRedraw();
}

function onSketchPointerUp() {
  const st = sketchState;
  if (!st || !st.current) { return; }
  st.strokes.push(st.current);
  st.current = null;
  renderSketchDialog();
}

/* Undo takes back the last committed stroke, pen or eraser
   alike; with the model as truth, the repaint is the undo. */
function sketchUndoLast() {
  const st = sketchState;
  if (!st || st.saving || !st.strokes.length) { return; }
  st.strokes.pop();
  renderSketchDialog();
}

/* Clear empties the session's strokes. A reopened sketch keeps
   its base: Clear there removes only what this session added,
   the same reach as the eraser and Undo. */
function sketchClearStrokes() {
  const st = sketchState;
  if (!st || st.saving || !st.strokes.length) { return; }
  st.strokes = [];
  st.current = null;
  renderSketchDialog();
}

/* The export seam: the flattened canvas as a PNG blob, through
   the image editor's blob door. */
function sketchExportToBlob() {
  sketchRedraw();
  return imageEditorToBlob(sketchCanvasEl(), "image/png");
}

/* Save. A new sketch must hold at least one stroke; an edited
   one may save with none added (the drawing stands as it was).
   The new sketch exports first, then the dialog closes and the
   PNG goes through the ordinary attachment flow marked as a
   sketch, landing at the captured caret. The edited sketch
   replaces its attachment's file in place through the image
   editor's replace path (which rehydrates the block and marks
   the note dirty); the dialog closes only once the replacement
   has landed. Any failure before the swap leaves the note, the
   block, and the record exactly as they were, and the dialog
   stays open so the drawing is not lost. */
async function saveSketchDialog() {
  const st = sketchState;
  if (!st || st.saving) { return; }
  if (!st.att && !st.strokes.length) {
    toast("Draw something first, or Cancel to add no sketch.", true);
    return;
  }
  st.saving = true;
  renderSketchDialog();
  const saveBtn = document.getElementById("sketchSaveBtn");
  saveBtn.textContent = "Saving...";
  try {
    const blob = await sketchExportToBlob();
    if (st.att) {
      await replaceAttachmentImage(
        { note: st.note, att: st.att, el: st.el }, blob);
      if (st.el && st.el.isConnected) {
        st.el.setAttribute("data-ss-sketch", "1");
      }
      closeSketchDialog();
      toast("Sketch updated.");
    } else {
      const file = new File([blob], "Sketch.png",
        { type: "image/png" });
      closeSketchDialog();
      await handleIncomingFiles([file], { sketch: true });
    }
  } catch (err) {
    toast("The sketch could not be saved: " + err.message, true);
  } finally {
    if (sketchState === st) {
      st.saving = false;
      renderSketchDialog();
    }
  }
}

/* ----- v2.47: web clipper bookmarklet -------------------------------------
   Phase 4 release 3 of the Evernote parity program, the approved
   substitute for Evernote's Web Clipper. Evernote's clipper is a
   browser extension: it offers clip modes (Article, Simplified
   article, Full page, Bookmark, Screenshot, and PDF clipping),
   lets the user choose the notebook and tags and add a remark
   at clip time, highlights before saving, and files the result
   as a note carrying the source URL. A true extension with full
   page serialization, screenshot and PDF clipping, and server
   side simplification is impossible in this free, serverless,
   single file design, so the substitute keeps the shape a
   bookmarklet honestly allows:

     - Settings holds a "Web clipper" section presenting a
       bookmarklet link the app generates for its own origin.
       The user drags it to the bookmarks bar (or copies its
       code into a bookmark by hand).
     - The bookmarklet, running on an arbitrary page, clips the
       current text selection when one exists; otherwise it runs
       a small self contained article extraction (headline plus
       readable paragraphs, images referenced by absolute URL).
       It never sends the whole raw page, chrome included.
     - It opens this app in a new tab with the clip payload in
       the URL fragment: base64url encoded JSON, dependency
       free (btoa over the UTF-8 percent encoding), carrying
       the payload version, page title, source URL, HTML, the
       mode (selection or article), and a shortened flag.
     - The app, at the very start of boot, reads and strips
       that fragment before anything else can trip over it,
       validates the payload strictly (it is untrusted input
       from arbitrary pages), sanitizes the HTML through a
       strict clip sanitizer built on the paste cleaning path,
       holds the result in memory only (never localStorage),
       and once sign in and the store load have completed,
       files ONE note: the page title as its title, a source
       line linking the original URL at the top of the body,
       then the clip, into the first notebook, with a toast
       naming where it went. A user who never signs in simply
       loses the held clip; nothing was ever written anywhere.

   Size honesty: fragment payloads have practical limits, so
   the caps below are named and enforced on BOTH sides.
   WEBCLIP_MAX_HTML_CHARS caps the clip HTML itself. When a
   clip exceeds it, the bookmarklet truncates at a block
   boundary and flags the payload shortened; the app truncates
   the same way at a top level block boundary when a payload
   still arrives over the cap, and either way the filed body
   carries a short note saying the clip was shortened, rather
   than the clip failing silently. WEBCLIP_MAX_FRAGMENT_CHARS
   caps the encoded fragment the app will even try to decode.

   Auth sequencing: through v2.78.0 sign in was the GIS token
   client, a popup flow whose token arrived through a callback,
   never through a URL fragment. Since v2.79.0 sign in DOES
   return through a fragment (the Worker session fragment),
   and boot reads that fragment first, ahead of this reader;
   the two prefixes cannot collide (ssnotes_ against the clip
   prefix), each reader acts only on its own fragment, and
   the notification return trips still ride the query string
   (?task= and ?noteReminder=), never the fragment. A clip
   fragment therefore can neither be mistaken for an auth
   response nor destroy one: the reader below acts only on a
   fragment beginning with the clip prefix, leaves every
   other fragment and the whole query string untouched, and
   strips only the clip fragment, by a history replace that
   preserves the query string exactly. The read itself runs
   at the head of boot(), just after the auth fragment read
   and ahead of the sign in routing, so the payload is safely
   in memory whatever route the boot then takes, and filing
   waits for connectAndLoad,
   the one funnel every signed in arrival passes through.
   -------------------------------------------------------------------------- */
const WEBCLIP_FRAGMENT_PREFIX = "clip=";
const WEBCLIP_PAYLOAD_VERSION = 1;
const WEBCLIP_MAX_HTML_CHARS = 60000;
const WEBCLIP_MAX_TITLE_CHARS = 300;
const WEBCLIP_MAX_URL_CHARS = 2048;
const WEBCLIP_MAX_FRAGMENT_CHARS = 120000;
const WEBCLIP_SHORTENED_HTML =
  "<p><em>This clip was shortened to fit the web clipper " +
  "size limit.</em></p>";

/* The held clip, memory only by design (see the section
   head): a parsed, validated payload waiting for the store,
   or null. webClipFiling is the once only guard that keeps a
   double call from ever filing two notes for one clip. */
let pendingWebClip = null;
let webClipFiling = false;

/* The app's own origin and path, the address the bookmarklet
   opens. Derived from this page's location, so a fork hosted
   elsewhere generates a bookmarklet pointing at itself. */
function webClipAppUrl() {
  try {
    return window.location.origin + window.location.pathname;
  } catch (err) {
    return "https://clytherin-tech.github.io/snakescale/";
  }
}

/* Dependency free UTF-8 safe base64url, the payload encoding
   both sides speak: the text is percent encoded to its UTF-8
   bytes, carried through btoa, and made URL safe. The decoder
   is its exact inverse. */
function webClipEncodeText(text) {
  return btoa(unescape(encodeURIComponent(String(text))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function webClipDecodeText(data) {
  let b64 = String(data).replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) { b64 += "="; }
  return decodeURIComponent(escape(atob(b64)));
}

/* The bookmarklet's readable source, one line per array entry.
   This is the maintainable form of the code the Settings link
   carries: buildWebClipBookmarkletHref joins these lines and
   percent encodes the result behind "javascript:". The
   bookmarklet is deliberately small (a bookmarklet must be);
   everything heavy (validation, sanitizing, filing) lives on
   the app side below. Its jobs, in order: read the selection;
   fall back to the article extraction; truncate at a block
   boundary over the shared cap and flag it; pack the payload;
   open the app with it in the fragment. */
function webClipBookmarkletLines(appUrl) {
  return [
    "(function () {",
    "  var APP = " + JSON.stringify(appUrl) + ";",
    "  var MAX_HTML = " + WEBCLIP_MAX_HTML_CHARS + ";",
    "  function esc(s) {",
    "    return String(s).replace(/&/g, '&amp;')",
    "      .replace(/</g, '&lt;').replace(/>/g, '&gt;')",
    "      .replace(/\"/g, '&quot;');",
    "  }",
    "  function abs(u) {",
    "    try { return new URL(u, document.baseURI).href; }",
    "    catch (e) { return ''; }",
    "  }",
    "  function selHtml() {",
    "    var s = window.getSelection && window.getSelection();",
    "    if (!s || s.isCollapsed || !s.rangeCount) { return ''; }",
    "    var d = document.createElement('div');",
    "    for (var i = 0; i < s.rangeCount; i++) {",
    "      d.appendChild(s.getRangeAt(i).cloneContents());",
    "    }",
    "    return d.innerHTML;",
    "  }",
    "  function articleHtml() {",
    "    var root = document.querySelector('article') ||",
    "      document.querySelector('main') || document.body;",
    "    if (!root) { return ''; }",
    "    var out = [];",
    "    var h = root.querySelector('h1') ||",
    "      document.querySelector('h1');",
    "    if (h && h.textContent.trim()) {",
    "      out.push('<h1>' + esc(h.textContent.trim()) + '</h1>');",
    "    }",
    "    var nodes = root.querySelectorAll(",
    "      'h2,h3,p,li,blockquote,pre,img');",
    "    for (var i = 0; i < nodes.length; i++) {",
    "      var n = nodes[i];",
    "      var tag = n.tagName.toLowerCase();",
    "      if (tag === 'img') {",
    "        var src = abs(n.getAttribute('src') ||",
    "          n.getAttribute('data-src') || '');",
    "        if (src && /^https?:/i.test(src)) {",
    "          out.push('<p><img src=\"' + esc(src) + '\" alt=\"' +",
    "            esc(n.getAttribute('alt') || '') + '\"></p>');",
    "        }",
    "        continue;",
    "      }",
    "      var t = (n.textContent || '').trim();",
    "      if (!t) { continue; }",
    "      if (tag === 'li') { tag = 'p'; }",
    "      out.push('<' + tag + '>' + esc(t) + '</' + tag + '>');",
    "    }",
    "    return out.join('');",
    "  }",
    "  var picked = selHtml();",
    "  var mode = picked ? 'selection' : 'article';",
    "  var html = picked || articleHtml();",
    "  if (!html) {",
    "    html = '<p>' + esc(document.title || location.href) + '</p>';",
    "  }",
    "  var shortened = false;",
    "  if (html.length > MAX_HTML) {",
    "    var cut = html.slice(0, MAX_HTML);",
    "    var lt = cut.lastIndexOf('</');",
    "    var gt = lt >= 0 ? cut.indexOf('>', lt) : -1;",
    "    if (gt > 0) { cut = cut.slice(0, gt + 1); }",
    "    html = cut;",
    "    shortened = true;",
    "  }",
    "  var payload = { v: 1, t: document.title || location.href,",
    "    u: location.href, h: html, m: mode,",
    "    s: shortened ? 1 : 0 };",
    "  var data = btoa(unescape(encodeURIComponent(",
    "    JSON.stringify(payload))))",
    "    .replace(/\\+/g, '-').replace(/\\//g, '_')",
    "    .replace(/=+$/, '');",
    "  window.open(APP + '#clip=' + data, '_blank');",
    "})();"
  ];
}

/* The href the Settings surface presents: the readable source
   above, joined and percent encoded behind the javascript:
   scheme, so the anchor can be dragged to a bookmarks bar as
   it stands, and its value is also what the copy box shows. */
function buildWebClipBookmarkletHref(appUrl) {
  const url = appUrl || webClipAppUrl();
  return "javascript:" +
    encodeURIComponent(webClipBookmarkletLines(url).join("\n"));
}

/* Pack a payload object into a clip fragment, the exact shape
   the bookmarklet emits; the app's own tests and any future
   in app clip door speak through this one packer, so the
   format has exactly one writer per side. */
function buildWebClipFragment(payload) {
  const obj = {
    v: WEBCLIP_PAYLOAD_VERSION,
    t: payload && payload.title != null ? String(payload.title) : "",
    u: payload && payload.url != null ? String(payload.url) : "",
    h: payload && payload.html != null ? String(payload.html) : "",
    m: payload && payload.mode === "selection"
      ? "selection" : "article",
    s: payload && payload.shortened ? 1 : 0
  };
  return "#" + WEBCLIP_FRAGMENT_PREFIX +
    webClipEncodeText(JSON.stringify(obj));
}

/* Validate one encoded payload strictly and return the clip
   it carries, or null for anything malformed: the fragment
   is untrusted input from arbitrary pages, so every field is
   type checked, the URL must be an http or https address
   within its cap, the title is cut to its cap, and the HTML
   must be a non empty string (its own cap is applied by the
   sanitizer at filing time, which is where truncation can be
   done cleanly). Nothing here touches the DOM or the store. */
function parseWebClipPayload(data) {
  if (!data || typeof data !== "string") { return null; }
  if (data.length > WEBCLIP_MAX_FRAGMENT_CHARS) { return null; }
  if (!/^[A-Za-z0-9_-]+$/.test(data)) { return null; }
  let obj = null;
  try { obj = JSON.parse(webClipDecodeText(data)); }
  catch (err) { return null; }
  if (!obj || typeof obj !== "object") { return null; }
  if (obj.v !== WEBCLIP_PAYLOAD_VERSION) { return null; }
  if (typeof obj.u !== "string" || !obj.u ||
      obj.u.length > WEBCLIP_MAX_URL_CHARS) { return null; }
  if (!/^https?:\/\//i.test(obj.u)) { return null; }
  if (typeof obj.h !== "string" || !obj.h.trim()) { return null; }
  const title = typeof obj.t === "string" && obj.t.trim()
    ? obj.t.trim().slice(0, WEBCLIP_MAX_TITLE_CHARS) : obj.u;
  return {
    title: title,
    url: obj.u,
    html: obj.h,
    mode: obj.m === "selection" ? "selection" : "article",
    shortened: obj.s === 1 || obj.s === true
  };
}

/* The strict clip sanitizer's vocabulary: the note body's own
   readable elements, nothing active, nothing embedded, no
   forms. Tags outside it are unwrapped (their text survives);
   the drop list is removed with its contents. Attributes are
   stripped wholesale except a link's href and an image's src
   and alt (each address checked http or https) and a table
   cell's span counts. The cleaned fragment then passes the
   paste path's background cleaning (stripPastedBackgrounds),
   so a clip is cleaned the way a paste is, plus this strict
   vocabulary a paste never needed. */
const WEBCLIP_ALLOWED_TAGS = {
  P: 1, DIV: 1, BR: 1, STRONG: 1, B: 1, EM: 1, I: 1, U: 1,
  S: 1, STRIKE: 1, UL: 1, OL: 1, LI: 1, A: 1, H1: 1, H2: 1,
  H3: 1, H4: 1, BLOCKQUOTE: 1, PRE: 1, CODE: 1, IMG: 1,
  TABLE: 1, THEAD: 1, TBODY: 1, TR: 1, TH: 1, TD: 1, HR: 1,
  FIGURE: 1, FIGCAPTION: 1
};
const WEBCLIP_DROP_TAGS = {
  SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1,
  FORM: 1, INPUT: 1, BUTTON: 1, TEXTAREA: 1, SELECT: 1,
  LINK: 1, META: 1, SVG: 1, VIDEO: 1, AUDIO: 1, CANVAS: 1,
  NOSCRIPT: 1
};

function cleanWebClipChildren(parent) {
  Array.prototype.slice.call(parent.childNodes)
    .forEach(function (node) {
      if (node.nodeType === 3) { return; }
      if (node.nodeType !== 1) { node.remove(); return; }
      const tag = node.tagName;
      if (WEBCLIP_DROP_TAGS[tag]) { node.remove(); return; }
      if (tag === "A") {
        const href = node.getAttribute("href") || "";
        cleanWebClipChildren(node);
        if (!/^https?:\/\//i.test(href)) {
          unwrapTaskDescElement(node);
          return;
        }
        Array.prototype.slice.call(node.attributes)
          .forEach(function (attr) {
            node.removeAttribute(attr.name);
          });
        node.setAttribute("href", href);
        return;
      }
      if (tag === "IMG") {
        const src = node.getAttribute("src") || "";
        if (!/^https?:\/\//i.test(src)) { node.remove(); return; }
        const alt = node.getAttribute("alt") || "";
        Array.prototype.slice.call(node.attributes)
          .forEach(function (attr) {
            node.removeAttribute(attr.name);
          });
        node.setAttribute("src", src);
        if (alt) { node.setAttribute("alt", alt); }
        return;
      }
      if (WEBCLIP_ALLOWED_TAGS[tag]) {
        const keep = {};
        if (tag === "TD" || tag === "TH") {
          ["colspan", "rowspan"].forEach(function (name) {
            const v = node.getAttribute(name);
            if (v && /^\d{1,2}$/.test(v)) { keep[name] = v; }
          });
        }
        Array.prototype.slice.call(node.attributes)
          .forEach(function (attr) {
            node.removeAttribute(attr.name);
          });
        Object.keys(keep).forEach(function (name) {
          node.setAttribute(name, keep[name]);
        });
        cleanWebClipChildren(node);
        return;
      }
      cleanWebClipChildren(node);
      unwrapTaskDescElement(node);
    });
}

/* Truncate an already sanitized fragment at a top level block
   boundary: whole blocks are kept while they fit, so the cut
   never lands inside a tag or a paragraph, and the shortened
   note rides at the end. A fragment whose first block alone
   exceeds the cap falls back to that block's plain text cut
   to the cap, so something readable always survives. */
function truncateWebClipHtml(html) {
  const holder = document.createElement("div");
  holder.innerHTML = String(html || "");
  let out = "";
  const nodes = Array.prototype.slice.call(holder.childNodes);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const piece = node.nodeType === 1
      ? node.outerHTML
      : escapeHtml(node.textContent || "");
    if (!piece) { continue; }
    if (out && out.length + piece.length >
        WEBCLIP_MAX_HTML_CHARS) { break; }
    out += piece;
    if (out.length >= WEBCLIP_MAX_HTML_CHARS) { break; }
  }
  if (!out) {
    out = "<p>" + escapeHtml(htmlToText(html)
      .slice(0, WEBCLIP_MAX_HTML_CHARS)) + "</p>";
  }
  return out + WEBCLIP_SHORTENED_HTML;
}

/* Sanitize one clip's HTML and apply the size cap. Returns
   { html, shortened }: shortened is true when THIS pass cut
   the content (the shortened note is already appended then);
   a payload that arrived flagged shortened keeps its flag on
   the payload itself, and the body builder adds the note for
   that case. */
function sanitizeWebClipHtml(html) {
  const holder = document.createElement("div");
  holder.innerHTML = String(html == null ? "" : html);
  cleanWebClipChildren(holder);
  let clean = stripPastedBackgrounds(holder.innerHTML);
  let shortened = false;
  if (clean.length > WEBCLIP_MAX_HTML_CHARS) {
    clean = truncateWebClipHtml(clean);
    shortened = true;
  }
  return { html: clean, shortened: shortened };
}

/* The filed note's body: the source line first (Evernote
   clips carry their source URL; here it is a real link at
   the top of the body, where the note itself shows it), then
   the sanitized clip, then the shortened note when the
   bookmarklet flagged the clip and this pass did not already
   append it by truncating. */
function webClipBodyFor(payload, cleanResult) {
  const source = "<p>Source: <a href=\"" +
    escapeHtml(payload.url) + "\">" +
    escapeHtml(payload.url) + "</a></p>";
  let body = source + cleanResult.html;
  if (payload.shortened && !cleanResult.shortened) {
    body += WEBCLIP_SHORTENED_HTML;
  }
  return body;
}

/* Remove the clip fragment from the address bar without
   touching anything else in the URL: a history replace to
   the same path and the same query string, so a ?task= or
   ?noteReminder= return trip sharing the URL survives the
   strip exactly. Falls back to clearing the hash where the
   history call itself is refused. */
function stripWebClipFragment() {
  try {
    window.history.replaceState(null, document.title,
      window.location.pathname + window.location.search);
  } catch (err) {
    try { window.location.hash = ""; } catch (e) { /* no-op */ }
  }
}

/* The boot reader, the first thing boot() runs: a fragment
   that is not a clip fragment is left entirely alone (it is
   not this reader's business; see the auth note in the
   section head). A clip fragment is stripped at once, valid
   or not, so the payload never lingers in the address bar,
   never replays on a reload, and never reaches any other
   reader. A malformed payload is refused with a toast and
   no note and nothing held; a valid one is held in memory
   (pendingWebClip) for filePendingWebClip, which
   connectAndLoad calls once the store is in. */
function readWebClipFromUrl() {
  let hash = "";
  try { hash = window.location.hash || ""; }
  catch (err) { return null; }
  if (!hash ||
      hash.indexOf("#" + WEBCLIP_FRAGMENT_PREFIX) !== 0) {
    return null;
  }
  const data = hash.slice(1 + WEBCLIP_FRAGMENT_PREFIX.length);
  stripWebClipFragment();
  const payload = data ? parseWebClipPayload(data) : null;
  if (!payload) {
    toast("That web clip could not be read, so no note " +
      "was made.", true);
    return null;
  }
  pendingWebClip = payload;
  return payload;
}

/* File the held clip as ONE note, through the instant create
   pattern of createNoteInRepo and the template apply: the
   note is in state and cache at once, the write runs through
   the real save funnel as a fresh note, and the note opens
   so the user sees what arrived. The notebook is the
   default notebook (v2.72: fallbackNotebookSlug; the
   first notebook while no default is set), since the
   bookmarklet cannot ask (Evernote's clip time notebook
   choice remains a named deviation), created as Personal
   first when the store somehow has none, the create
   flow's own rule. The held payload is spent before the work
   starts and the filing guard refuses a second run, so no
   path can file the same clip twice. Returns the note, or
   null when there is nothing held or a filing is already in
   flight. Failures keep the app's create wording: the note
   exists locally and the toast names the save failure. */
async function filePendingWebClip() {
  if (!pendingWebClip || webClipFiling) { return null; }
  webClipFiling = true;
  const payload = pendingWebClip;
  pendingWebClip = null;
  try {
    if (!state.notebooks.length) {
      await createNotebook("Personal");
    }
    const notebook = state.notebooks.find(function (nb) {
      return nb.slug === fallbackNotebookSlug();
    }) || state.notebooks[0];
    const cleanResult = sanitizeWebClipHtml(payload.html);
    const note = makeNote(notebook.slug, payload.title,
      canonicalizeAttachmentPlaceholders(
        webClipBodyFor(payload, cleanResult)));
    state.notes.unshift(note);
    saveCache();
    renderAll();
    openNote(note.id);
    await saveNoteToRepo(note,
      { skipConflictCheck: true, fresh: true })
      .then(function () { saveCache(); })
      .catch(function (err) {
        toast("Web clip created locally; save failed: " +
          err.message, true);
      });
    toast("Web clip saved to " + notebook.name + ": \"" +
      payload.title + "\"");
    return note;
  } finally {
    webClipFiling = false;
    /* v2.50: a held clip is unsaved state a waiting self
       update reload waits for; its filing finishing is
       one of the reload's landing moments. */
    maybeReloadForUpdate();
  }
}

/* The Settings surface's fill: the bookmarklet link's href
   and the copy box's value are the generated bookmarklet for
   this app's own address. Called from syncSettingsControls
   (so every Settings open shows the current build's link)
   and once at boot, so the link exists before Settings is
   ever opened. */
function renderWebClipSettings() {
  const href = buildWebClipBookmarkletHref(webClipAppUrl());
  const link = document.getElementById(
    "webClipBookmarkletLink");
  if (link) { link.setAttribute("href", href); }
  const text = document.getElementById(
    "webClipBookmarkletText");
  if (text) { text.value = href; }
}

/* The copy button: the bookmarklet code to the clipboard
   through the same clipboard seam the app copies with
   elsewhere, with the box selection as the fallback where
   the clipboard write is refused, and the feedback line
   saying which happened. */
function copyWebClipBookmarklet() {
  const text = document.getElementById(
    "webClipBookmarkletText");
  const feedback = document.getElementById("webClipFeedback");
  if (!text) { return; }
  const done = function () {
    if (feedback) {
      feedback.textContent = "Bookmarklet code copied. " +
        "Paste it as the URL of a new bookmark named " +
        "Clip to SnakeScale Notes.";
    }
  };
  if (navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function") {
    navigator.clipboard.writeText(text.value)
      .then(done)
      .catch(function () {
        text.select();
        if (feedback) {
          feedback.textContent = "The code is selected " +
            "in the box; copy it from there.";
        }
      });
    return;
  }
  text.select();
  done();
}

/* ----- attach entry point ------------------------------------------------
   v1.3.4: startAttachFlow() is the single entry point for attaching
   files with the picker. The Insert menu's "Attach file or image"
   item calls it. Before v1.3.4 a standalone Attach button in the
   toolbar ran this same code as its click handler; the button was
   removed as redundant, and the checks, messages, and order below are
   unchanged from that handler: a note must be open, it must not be in
   Trash, and the app must be online, because the file is uploaded to
   the user's storage provider. The caret is captured before the
   picker opens, because the picker steals focus, and the placeholder
   lands where the caret was. The picker's change handler (wired in
   wireEvents) feeds the chosen files to handleIncomingFiles.        */
function startAttachFlow() {
  const note = currentNote();
  if (!note) {
    toast("Open a note first, then attach files to it.", true);
    return;
  }
  if (note.trashed) {
    toast("Attachments cannot be added while a note is in Trash. Restore it first.", true);
    return;
  }
  if (note.archived) {
    toast("Attachments cannot be added while a note is archived. Unarchive it first.", true);
    return;
  }
  if (!state.online) {
    toast("Attachments need an internet connection: the file is uploaded to your storage provider. You appear to be offline.", true);
    return;
  }
  captureCaret();
  document.getElementById("attachFileInput").click();
}

async function handleIncomingFiles(fileList, opts) {
  const incomingFiles = Array.prototype.slice.call(fileList || []);
  const note = currentNote();
  if (!note) {
    toast("Open a note first, then attach files to it.", true);
    return;
  }
  if (note.trashed) {
    toast("Attachments cannot be added while a note is in Trash. Restore it first.", true);
    return;
  }
  if (note.archived) {
    toast("Attachments cannot be added while a note is archived. Unarchive it first.", true);
    return;
  }
  if (!state.online) {
    toast("Attachments need an internet connection: the file is uploaded to your storage provider. You appear to be offline.", true);
    return;
  }
  const providerName = state.attach.defaultProvider;
  if (!providerName || !providers[providerName]) {
    toast("Sign in with Google before adding attachments.", true);
    return;
  }
  const driver = providers[providerName];
  const status = await driver.getStatus();
  if (!status.connected) {
    toast("Sign in with " + providerLabel(providerName) +
      " before adding attachments.", true);
    return;
  }
  const accepted = [];
  incomingFiles.forEach(function (f) {
    if (f.size > ATTACH_MAX_BYTES) {
      toast("\"" + f.name + "\" is larger than the 100 MB per file limit and was skipped.", true);
    } else {
      accepted.push(f);
    }
  });
  if (!accepted.length) { return; }
  uploadUi.total = accepted.length;
  uploadUi.index = 0;
  for (const file of accepted) {
    uploadUi.index++;
    await uploadOneAttachment(note, providerName, driver, file, opts);
  }
  hideUploadProgress();
}

async function uploadOneAttachment(note, providerName, driver, file, opts) {
  const attId = newNoteId() + "a";
  const storageName = attId + "__" + sanitizeFileName(file.name);
  const isImage = (file.type || "").indexOf("image/") === 0;
  const el = document.createElement(isImage ? "figure" : "div");
  el.setAttribute("class", "ss-attachment");
  el.setAttribute("data-attachment-id", attId);
  el.setAttribute("contenteditable", "false");
  /* v2.46: a sketch upload is born marked on its block as
     well as on its record (below), so the note's first save
     already carries both halves of the marking in step. */
  if (opts && opts.sketch) {
    el.setAttribute("data-ss-sketch", "1");
  }
  /* v1.7: decorated by the shared decoration function, with the
     file's type standing in for the record that does not exist yet,
     so the block is born with the inline image class and the
     draggable flag already in place, exactly like a hydrated one. */
  decorateAttachmentPlaceholder(note, el, { id: attId, mime: file.type || "" });
  const uploading = document.createElement("div");
  uploading.className = "ss-att-msg";
  uploading.textContent = "Uploading " + file.name + "...";
  el.appendChild(uploading);
  captureCaret();
  insertPlaceholderAtCaret(el);
  setUploadProgress(file.name, 0);
  try {
    const result = await driver.upload(file, storageName, function (pct) {
      setUploadProgress(file.name, pct);
    });
    const att = {
      id: attId,
      provider: providerName,
      fileId: String(result.fileId),
      name: file.name,
      storageName: storageName,
      mime: file.type || "application/octet-stream",
      size: file.size,
      created: new Date().toISOString()
    };
    /* v2.46: the record half of the sketch marking. */
    if (opts && opts.sketch) { att.sketch = true; }
    note.attachments = note.attachments || [];
    note.attachments.push(att);
    await hydrateOneAttachment(note, el);
    markDirty();
    toast("Attached " + file.name + ".");
  } catch (err) {
    el.remove();
    toast("Upload failed for " + file.name + ": " + err.message, true);
  }
}

/* --------------------------------------------------------------------------
   v2.14: block drag grips.

   Resting the pointer over a block in the note body floats a six dot
   grip in the left margin beside the block's first line (the grip is
   positioned from the block's on screen rectangle and lives, with
   its drop line, as a sibling of #noteBody in .editor-inner, so it
   scrolls with the column and can never be saved into a note:
   collectEditor reads only #noteBody's innerHTML).

   Draggable blocks are the body's top level blocks (paragraphs,
   headings, lists, quotes, code blocks, tables, dividers, div
   lines, and attachment blocks) plus list items, which reorder
   within their own list only, checklist items included: the node
   itself moves, so a checklist item's checkbox and done state
   travel with it.

   The drag follows the note drag's shape: a press on the grip arms
   it, a few pixels of travel engage it, the dragged block dims, and
   the drop line tracks the insertion point among the allowed
   siblings. Nothing moves during the drag itself; pointerup commits
   the move as one DOM operation and runs markDirty, so a move saves
   and versions like any other edit. Escape or a pointer cancel ends
   the drag with the original order untouched, because the node never
   moved, and a press with no travel changes nothing.
   -------------------------------------------------------------------------- */
let blockDrag = null;
let blockGripBlock = null;

const BLOCK_DRAG_TAGS = { P: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1,
  H6: 1, UL: 1, OL: 1, BLOCKQUOTE: 1, PRE: 1, TABLE: 1, HR: 1, DIV: 1 };

/* The block a pointer position belongs to: the list item when the
   pointer is inside one, otherwise the top level block holding it.
   Null for anything that is not a draggable block (the body's own
   padding, a non-attachment figure, content outside the body). */
function blockGripTargetBlock(node) {
  const bodyEl = document.getElementById("noteBody");
  if (!node || !bodyEl.contains(node)) { return null; }
  const el = node.nodeType === 1 ? node : node.parentNode;
  if (!el || el === bodyEl) { return null; }
  const li = el.closest ? el.closest("li") : null;
  if (li && bodyEl.contains(li)) { return li; }
  let top = el;
  while (top.parentNode && top.parentNode !== bodyEl) {
    top = top.parentNode;
  }
  if (top.parentNode !== bodyEl) { return null; }
  if (top.tagName === "FIGURE") {
    return top.classList.contains("ss-attachment") ? top : null;
  }
  return BLOCK_DRAG_TAGS[top.tagName] ? top : null;
}

/* The block a pointer POSITION belongs to, for pointers that are
   not over a block descendant of the note body: over the body
   element itself, over the scroll strip beside the column, or
   over other editor furniture. v2.14.1 introduced this geometric
   resolution because the hover tracker used to judge purely by
   event target and hid the grip mid crossing on the way to grab
   it; v2.14.2 corrects where the grip's territory actually is.
   The grip renders at left:-20px relative to .editor-inner, so it
   floats over .editor-scroll, left of the column's own left
   edge, and the body's left edge is the column's left edge. A
   guard that admitted only points at or right of the column edge
   therefore rejected the grip's entire zone. The X range now
   runs from 28px left of the body's left edge (the 16px grip,
   its 6px gap, and 6px of slack) to the body's right edge; the
   Y range stays the editor column's vertical span. The block is
   resolved geometrically: list items first (an item's span wins
   over the list that contains it), then the top level blocks,
   each in document order, the winner being the block whose on
   screen vertical span holds the pointer's Y. Above the first
   block or below the last one there is no block, and the grip
   hides, exactly as a target over the body's own empty space
   has always hidden it. */
function blockGripBlockAtPoint(clientX, clientY) {
  const bodyEl = document.getElementById("noteBody");
  const inner = document.querySelector(".editor-inner");
  if (!bodyEl || !inner) { return null; }
  const ir = inner.getBoundingClientRect();
  const br = bodyEl.getBoundingClientRect();
  if (clientY < ir.top || clientY > ir.bottom) { return null; }
  if (clientX < br.left - 28 || clientX > br.right) { return null; }
  const items = bodyEl.querySelectorAll("li");
  for (let i = 0; i < items.length; i++) {
    const r = items[i].getBoundingClientRect();
    if (clientY >= r.top && clientY <= r.bottom) { return items[i]; }
  }
  const kids = bodyEl.children;
  for (let i = 0; i < kids.length; i++) {
    const el = kids[i];
    let block = null;
    if (el.tagName === "FIGURE") {
      block = el.classList.contains("ss-attachment") ? el : null;
    } else if (BLOCK_DRAG_TAGS[el.tagName]) {
      block = el;
    }
    if (!block) { continue; }
    const r = el.getBoundingClientRect();
    if (clientY >= r.top && clientY <= r.bottom) { return block; }
  }
  /* v2.14.3: no span held the pointer, so it sits in one of
     the collapsed margin gaps between lines, which used to
     resolve to no block at all: a hover dead band over exactly
     the spaced lines. Assign the gap by the same boundary the
     block drag commits on, the midpoint of the gap between
     the two border boxes: at or above it the block above owns
     the pointer, below it the block below does. The units are
     the lines of the note in document order: a list's items
     stand for the list, every other top level block stands
     for itself. Above the first line and below the last one
     there is still no block, as there has always been. */
  const units = [];
  Array.prototype.forEach.call(bodyEl.children, function (child) {
    if (child.tagName === "UL" || child.tagName === "OL") {
      Array.prototype.forEach.call(child.children, function (li) {
        if (li.tagName === "LI") { units.push(li); }
      });
    } else if (child.tagName === "FIGURE") {
      if (child.classList.contains("ss-attachment")) {
        units.push(child);
      }
    } else if (BLOCK_DRAG_TAGS[child.tagName]) {
      units.push(child);
    }
  });
  let aboveUnit = null;
  for (let i = 0; i < units.length; i++) {
    const r = units[i].getBoundingClientRect();
    if (clientY < r.top) {
      if (!aboveUnit) { return null; }
      const ar = aboveUnit.getBoundingClientRect();
      return clientY <= (ar.bottom + r.top) / 2 ? aboveUnit : units[i];
    }
    if (clientY <= r.bottom) { return units[i]; }
    aboveUnit = units[i];
  }
  return null;
}

function hideBlockGrip() {
  const grip = document.getElementById("blockGrip");
  if (grip) { grip.classList.add("hidden"); }
  if (!blockDrag) {
    const line = document.getElementById("blockDropLine");
    if (line) { line.classList.add("hidden"); }
  }
}

/* Position the grip in the margin beside the block's first line.
   Coordinates are relative to .editor-inner, the grip's positioned
   ancestor, computed from the on screen rectangles, the same seam
   every floating editor surface uses.
   v2.14.3: the X comes from the block's TOP LEVEL ancestor, not
   from the block itself, so every grip shares the one margin
   column. A list item's own box starts 24px right of its list's
   edge (the lists' padding, where the bullet or number lives),
   and a grip placed from the item's box landed on the marker:
   at the standard geometry a paragraph's grip sits at left
   -20px and an item's sat at 4px, inside the marker strip.
   The ancestor walk ends at the outermost list for a nested
   item, at the blockquote for a list inside one, at the table
   for a list in a cell. The Y still comes from the named
   block itself: the grip tracks the item's own first line;
   only the column is shared. What the grip drags (the named
   block) does not change. */
function positionBlockGrip(block) {
  const grip = document.getElementById("blockGrip");
  const inner = document.querySelector(".editor-inner");
  if (!grip || !inner || !block) { return; }
  const bodyEl = document.getElementById("noteBody");
  const ir = inner.getBoundingClientRect();
  const br = block.getBoundingClientRect();
  let anchor = block;
  if (bodyEl) {
    while (anchor.parentNode && anchor.parentNode !== bodyEl) {
      anchor = anchor.parentNode;
    }
    if (anchor.parentNode !== bodyEl) { anchor = block; }
  }
  const ar = anchor === block ? br : anchor.getBoundingClientRect();
  const gw = grip.offsetWidth || 16;
  grip.style.left = (ar.left - ir.left - gw - 6) + "px";
  grip.style.top = (br.top - ir.top + 2) + "px";
  grip.classList.remove("hidden");
}

function onGripHoverPointerMove(ev) {
  const grip = document.getElementById("blockGrip");
  if (grip && ev.target && grip.contains(ev.target)) { return; }
  if (blockDrag || noteDrag || cellDragState) { hideBlockGrip(); return; }
  /* A press in progress (a text selection drag, an image resize)
     is not a hover: the grip stays out of its way. */
  if (ev.buttons) { hideBlockGrip(); return; }
  const bodyEl = document.getElementById("noteBody");
  if (!bodyEl || bodyEl.contentEditable === "false") {
    hideBlockGrip();
    return;
  }
  let block;
  if (ev.target !== bodyEl && bodyEl.contains(ev.target)) {
    block = blockGripTargetBlock(ev.target);
  } else {
    /* v2.14.2: the pointer is not over a block descendant of the
       body: it is over the body element itself (its thin padding
       strip used to resolve to no block and kill the grip mid
       reach), over the scroll strip the grip floats in, or over
       the column's other furniture. Resolve the block by
       position, so the crossing keeps the grip for the block
       whose line the pointer is level with, and blockGripBlock
       names that block when the press lands. */
    block = blockGripBlockAtPoint(ev.clientX, ev.clientY);
  }
  if (!block) {
    blockGripBlock = null;
    hideBlockGrip();
    return;
  }
  blockGripBlock = block;
  positionBlockGrip(block);
}

function onGripPointerDown(ev) {
  if (blockDrag) { return; }
  if (ev.pointerType === "mouse" && ev.button !== 0) { return; }
  const bodyEl = document.getElementById("noteBody");
  if (!bodyEl || bodyEl.contentEditable === "false") { return; }
  const block = blockGripBlock;
  if (!block || !bodyEl.contains(block)) { return; }
  ev.preventDefault();
  blockDrag = {
    node: block,
    container: block.parentNode,
    pointerId: ev.pointerId,
    startY: ev.clientY,
    engaged: false,
    insertBefore: null
  };
  const grip = document.getElementById("blockGrip");
  if (grip && grip.setPointerCapture && ev.pointerId !== undefined) {
    try { grip.setPointerCapture(ev.pointerId); } catch (e) { /* ok */ }
  }
  window.addEventListener("pointermove", onBlockDragMove);
  window.addEventListener("pointerup", onBlockDragUp);
  window.addEventListener("pointercancel", onBlockDragCancel);
  document.addEventListener("keydown", onBlockDragKeydown, true);
}

/* The siblings a dragged block may land among: the draggable top
   level blocks for a body drag, the items of the same list for an
   item drag. The dragged node itself is never its own landmark. */
function blockDragSiblings() {
  const drag = blockDrag;
  if (!drag || !drag.container) { return []; }
  const inBody = drag.container.id === "noteBody";
  return Array.prototype.filter.call(drag.container.children,
    function (el) {
      if (el === drag.node) { return false; }
      if (inBody) {
        if (el.tagName === "FIGURE") {
          return el.classList.contains("ss-attachment");
        }
        return !!BLOCK_DRAG_TAGS[el.tagName];
      }
      return el.tagName === "LI";
    });
}

/* The sibling list with the dragged node left in, in document
   order. The dragged block still occupies its slot for the
   whole drag (nothing moves until pointerup), so this is the
   list the insertion geometry is measured on: the boundaries
   between consecutive blocks as they actually lie. */
function blockDragFullSiblings() {
  const drag = blockDrag;
  if (!drag || !drag.container) { return []; }
  const inBody = drag.container.id === "noteBody";
  return Array.prototype.filter.call(drag.container.children,
    function (el) {
      if (inBody) {
        if (el.tagName === "FIGURE") {
          return el.classList.contains("ss-attachment");
        }
        return !!BLOCK_DRAG_TAGS[el.tagName];
      }
      return el.tagName === "LI";
    });
}

function updateBlockDropLine(clientY) {
  const drag = blockDrag;
  const line = document.getElementById("blockDropLine");
  const inner = document.querySelector(".editor-inner");
  if (!drag || !line || !inner) { return; }
  const ir = inner.getBoundingClientRect();
  /* v2.14.3: margin aware insertion. The target used to be the
     first sibling whose own box midpoint sat below the pointer,
     which charged a block the whole width of its margins as
     extra travel: the boundary a spaced block (a paragraph, a
     heading) had to cross lay a full collapsed margin deeper
     than a marginless block's, so a short drag committed it
     back where it started (44px to move a paragraph where a
     div line needed 28, in the diagnosis' margin faithful
     measurements), and the drop line drew at the target's top
     edge, inside the empty gap, away from the boundary the
     commit actually used. Now the boundary between two
     consecutive blocks is the midpoint of the gap between
     their border boxes (for blocks that touch, their shared
     edge), measured on the sibling list as it lies, dragged
     block included: the pointer's slot is the number of those
     boundaries it has crossed, and the insertion target is
     that slot in the sibling list with the dragged block
     taken out. */
  const full = blockDragFullSiblings();
  const sibs = blockDragSiblings();
  const rects = full.map(function (el) {
    return el.getBoundingClientRect();
  });
  let crossed = 0;
  for (let i = 0; i + 1 < full.length; i++) {
    if (clientY >= (rects[i].bottom + rects[i + 1].top) / 2) {
      crossed++;
    }
  }
  const before = crossed < sibs.length ? sibs[crossed] : null;
  drag.insertBefore = before;
  /* The line renders AT the chosen boundary, so the feedback
     and the commit can never disagree again: the gap midpoint
     above the block the dragged block will land before (the
     first block's top edge when it lands at the start), or
     the last block's bottom edge when it lands at the end. */
  let lineY;
  if (before) {
    const k = full.indexOf(before);
    if (k > 0) {
      lineY = (rects[k - 1].bottom + rects[k].top) / 2;
    } else {
      lineY = rects[0].top;
    }
  } else if (full.length) {
    lineY = rects[rects.length - 1].bottom;
  } else {
    lineY = drag.node.getBoundingClientRect().bottom;
  }
  const cr = drag.container.getBoundingClientRect();
  line.style.left = (cr.left - ir.left) + "px";
  line.style.width = cr.width + "px";
  line.style.top = (lineY - ir.top - 1) + "px";
  line.classList.remove("hidden");
}

function onBlockDragMove(ev) {
  if (!blockDrag || ev.pointerId !== blockDrag.pointerId) { return; }
  if (!blockDrag.engaged) {
    if (Math.abs(ev.clientY - blockDrag.startY) < 4) { return; }
    blockDrag.engaged = true;
    blockDrag.node.classList.add("ss-block-dragging");
  }
  ev.preventDefault();
  updateBlockDropLine(ev.clientY);
}

function cleanupBlockDrag() {
  if (!blockDrag) { return; }
  const drag = blockDrag;
  blockDrag = null;
  if (drag.node) { drag.node.classList.remove("ss-block-dragging"); }
  const line = document.getElementById("blockDropLine");
  if (line) { line.classList.add("hidden"); }
  window.removeEventListener("pointermove", onBlockDragMove);
  window.removeEventListener("pointerup", onBlockDragUp);
  window.removeEventListener("pointercancel", onBlockDragCancel);
  document.removeEventListener("keydown", onBlockDragKeydown, true);
}

function onBlockDragUp(ev) {
  if (!blockDrag || ev.pointerId !== blockDrag.pointerId) { return; }
  const drag = blockDrag;
  const wasEngaged = drag.engaged;
  const before = drag.insertBefore;
  cleanupBlockDrag();
  if (!wasEngaged) { return; }
  const parent = drag.node.parentNode;
  if (!parent) { return; }
  /* Committing is one DOM move. Landing exactly where the block
     already sits leaves its next sibling unchanged, and only a
     real change of order runs the edit pipeline. */
  const oldNext = drag.node.nextSibling;
  if (before) { parent.insertBefore(drag.node, before); }
  else { parent.appendChild(drag.node); }
  if (drag.node.nextSibling !== oldNext) { markDirty(); }
}

function onBlockDragCancel() {
  cleanupBlockDrag();
}

function onBlockDragKeydown(ev) {
  if (ev.key === "Escape") { cleanupBlockDrag(); }
}

/* --------------------------------------------------------------------------
   v2.14: voice notes.

   The Voice note button beside Insert records from the microphone
   while the browser's built in speech recognition transcribes
   alongside it (Edge and Chrome offer it; the recognition service
   is the browser maker's own, and the app only reads the words
   back). The voice bar above the body shows the elapsed time and
   the words as they land, final ones at full strength and the ones
   still being recognized dimmed.

   Stop ends the recording and saves it through the exact path any
   attached file takes (uploadOneAttachment: a placeholder at the
   caret saved when recording started, a resumable upload into the
   attachments subfolder, a normal attachment record), then writes
   the transcript as plain paragraphs right after the audio card.
   Cancel throws the recording and the words away. Escape while
   recording means Cancel, and the bar counts as an overlay, so
   that Escape never also exits Maximize.
   -------------------------------------------------------------------------- */
let voiceCapture = null;

function voiceSleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

/* "Voice note 2026-10-21 9-52 AM": the recording's file name, so a
   note's attachments read in the order they were dictated. */
function voiceNoteFileName(date) {
  const pad = function (n) { return (n < 10 ? "0" : "") + n; };
  let hours = date.getHours();
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) { hours = 12; }
  return "Voice note " + date.getFullYear() + "-" +
    pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + " " +
    hours + "-" + pad(date.getMinutes()) + " " + ampm;
}

function voiceAudioExtension(mime) {
  const base = (mime || "").split(";")[0].trim().toLowerCase();
  if (base === "audio/webm") { return ".webm"; }
  if (base === "audio/ogg") { return ".ogg"; }
  if (base === "audio/mp4") { return ".m4a"; }
  if (base === "audio/mpeg") { return ".mp3"; }
  if (base === "audio/wav" || base === "audio/x-wav") { return ".wav"; }
  return ".webm";
}

/* Prefer audio/webm, the brief's first choice, then the other
   types a recorder might offer; an empty answer lets the browser
   pick its own default. */
function pickVoiceRecorderMime() {
  if (typeof MediaRecorder === "undefined") { return ""; }
  if (typeof MediaRecorder.isTypeSupported !== "function") { return ""; }
  const candidates = ["audio/webm;codecs=opus", "audio/webm",
    "audio/ogg;codecs=opus", "audio/mp4"];
  for (let i = 0; i < candidates.length; i++) {
    if (MediaRecorder.isTypeSupported(candidates[i])) {
      return candidates[i];
    }
  }
  return "";
}

function formatVoiceTimer(ms) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
}

function renderVoiceTranscript() {
  if (!voiceCapture) { return; }
  const finalEl = document.getElementById("voiceFinalText");
  const interimEl = document.getElementById("voiceInterimText");
  if (!finalEl || !interimEl) { return; }
  const finalText = voiceCapture.segments.map(function (s) {
    return s.text;
  }).join(" ");
  const interimText = voiceCapture.interimText;
  finalEl.textContent = finalText;
  interimEl.textContent =
    (finalText && interimText) ? " " + interimText : interimText;
}

function showVoiceRecNote(text) {
  const el = document.getElementById("voiceRecNote");
  if (!el) { return; }
  if (text) {
    el.textContent = text;
    el.classList.remove("hidden");
  } else {
    el.textContent = "";
    el.classList.add("hidden");
  }
}

/* v2.77: a segment is {text, start}, not a bare string:
   its start is the offset in seconds from the capture's
   start at which the recognition first surfaced that
   result (its first interim, ordinarily; a result that
   only ever surfaces as a final is stamped as it lands).
   The stamp is taken the first time a result index is
   seen and dropped when the result finalizes, because a
   finalized result never changes again in its session;
   the table itself is reset at every recognition start
   (see startVoiceNote), because a fresh session's
   results list starts again at index 0. The precision is
   the recognition service's own delivery: a start names
   when the words reached the app, not the acoustic
   instant they were spoken. */
function onVoiceResult(capture, ev) {
  if (voiceCapture !== capture) { return; }
  let interim = "";
  const now = (Date.now() - capture.startedAt) / 1000;
  for (let i = ev.resultIndex; i < ev.results.length; i++) {
    const res = ev.results[i];
    const text = (res[0] && res[0].transcript) || "";
    if (capture.segmentStarts[i] === undefined) {
      capture.segmentStarts[i] = now;
    }
    if (res.isFinal) {
      const start = capture.segmentStarts[i];
      delete capture.segmentStarts[i];
      const piece = text.trim();
      if (piece) {
        capture.segments.push({ text: piece, start: start });
      }
    } else {
      interim += text;
    }
  }
  capture.interimText = interim.trim();
  renderVoiceTranscript();
}

/* A recognition error ends transcription, never the recording:
   the bar says so, and Stop will attach the audio on its own. */
function onVoiceRecognitionError(capture, ev) {
  if (voiceCapture !== capture || capture.stopping) { return; }
  capture.recognitionFailed = true;
  showVoiceRecNote("Transcription stopped (" +
    (ev && ev.error ? ev.error : "error") +
    "). The recording continues; only the audio will be attached.");
}

/* v2.14.1: park the recording bar at the caret's line. The saved
   format range is the caret the recording will land at, saved at
   the top of startVoiceNote before the microphone prompt can
   steal focus; its rectangle is read the way the mention popup
   reads its range's. The bar goes just under the caret's line,
   at the caret's left edge, flipped above the line when it would
   spill past the window's bottom, and clamped inside the
   viewport: the mention popup's own rules. A saved range whose
   rectangle reads as all zeros (no measurable caret), or no
   saved range at all, falls back to the top of the note body.
   The bar is position:fixed and is placed once, here: it stays
   anchored where the recording started and never chases the
   caret afterwards. */
function positionVoiceBar() {
  const bar = document.getElementById("voiceBar");
  const bodyEl = document.getElementById("noteBody");
  if (!bar) { return; }
  const width = bar.offsetWidth;
  const height = bar.offsetHeight;
  let rect = null;
  if (savedFormatRange && bodyEl &&
      bodyEl.contains(savedFormatRange.startContainer)) {
    /* The rectangle read is a nicety, never a gate: a range that
       cannot be measured, for any reason, falls back to the body
       anchor below instead of breaking the recording's start. */
    try {
      const r = savedFormatRange.getBoundingClientRect();
      if (r && (r.top || r.bottom || r.left || r.right)) { rect = r; }
    } catch (e) { rect = null; }
  }
  let left;
  let top;
  if (rect) {
    left = Math.min(rect.left, window.innerWidth - width - 8);
    left = Math.max(8, left);
    top = rect.bottom + 6;
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - height - 6);
    }
  } else if (bodyEl) {
    const br = bodyEl.getBoundingClientRect();
    left = Math.min(br.left, window.innerWidth - width - 8);
    left = Math.max(8, left);
    top = br.top + 8;
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - height - 8);
    }
  } else { return; }
  /* v2.102.0: the rectangle reads above are visual
     viewport coordinates, but a fixed element is placed
     against the layout viewport. The two agree except
     while the phone keyboard is up or a pinch zoom
     stands, which is exactly when a recording starts:
     there the visual viewport sits offset inside the
     layout one, and a bar placed by the raw rectangle
     paints where the caret is while its tap region is
     computed from the other origin. Adding the offset
     back when one stands puts the paint and the tap
     region in the same rectangle; at rest the offsets
     are zero and the placement is unchanged. */
  const vv = window.visualViewport;
  if (vv && (vv.offsetLeft || vv.offsetTop)) {
    left += vv.offsetLeft;
    top += vv.offsetTop;
  }
  bar.style.left = left + "px";
  bar.style.top = top + "px";
}

async function startVoiceNote() {
  if (voiceCapture) { return; }
  /* The same guards as the attach flow, run before anything is
     recorded, so a voice note is never made that cannot be saved:
     a note must be open and live, the app must be online, and the
     storage provider must be signed in. */
  const note = currentNote();
  if (!note) {
    toast("Open a note first, then record a voice note in it.", true);
    return;
  }
  if (note.trashed) {
    toast("Voice notes cannot be added while a note is in Trash. Restore it first.", true);
    return;
  }
  if (note.archived) {
    toast("Voice notes cannot be added while a note is archived. Unarchive it first.", true);
    return;
  }
  if (!state.online) {
    toast("Voice notes need an internet connection: the recording is uploaded to your storage provider. You appear to be offline.", true);
    return;
  }
  const providerName = state.attach.defaultProvider;
  if (!providerName || !providers[providerName]) {
    toast("Sign in with Google before recording voice notes.", true);
    return;
  }
  const driver = providers[providerName];
  const status = await driver.getStatus();
  if (!status.connected) {
    toast("Sign in with " + providerLabel(providerName) +
      " before recording voice notes.", true);
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia ||
      typeof MediaRecorder === "undefined") {
    toast("Microphone access is needed for voice notes, and this browser does not offer it.", true);
    return;
  }
  /* The caret the recording and the transcript will land at, saved
     through the same machinery the toolbar uses before the
     microphone prompt can steal focus. */
  saveFormatSelection();
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    toast("Microphone access is needed for voice notes. Allow the microphone for this site, then try again.", true);
    return;
  }
  const capture = {
    noteId: note.id,
    note: note,
    providerName: providerName,
    driver: driver,
    stream: stream,
    recorder: null,
    chunks: [],
    mime: "",
    recognition: null,
    hadRecognition: false,
    recognitionRunning: false,
    recognitionFailed: false,
    endResolve: null,
    segments: [],
    segmentStarts: {},
    interimText: "",
    startedAt: Date.now(),
    timer: null,
    stopping: false
  };
  voiceCapture = capture;
  try {
    const mime = pickVoiceRecorderMime();
    capture.recorder = mime
      ? new MediaRecorder(stream, { mimeType: mime })
      : new MediaRecorder(stream);
    capture.mime = capture.recorder.mimeType || mime || "audio/webm";
  } catch (err) {
    voiceCapture = null;
    stream.getTracks().forEach(function (t) { t.stop(); });
    toast("This browser could not start recording: " + err.message, true);
    return;
  }
  capture.recorder.ondataavailable = function (ev) {
    if (ev.data && ev.data.size) { capture.chunks.push(ev.data); }
  };
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    try {
      const rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = navigator.language || "en-US";
      capture.recognition = rec;
      capture.hadRecognition = true;
      rec.onresult = function (ev) { onVoiceResult(capture, ev); };
      rec.onerror = function (ev) { onVoiceRecognitionError(capture, ev); };
      rec.onstart = function () {
        capture.recognitionRunning = true;
        /* v2.77: a fresh session's results list starts
           again at index 0, so the first appearance
           stamps keyed to the old session's indexes are
           dropped with it (see onVoiceResult). */
        capture.segmentStarts = {};
      };
      rec.onend = function () {
        capture.recognitionRunning = false;
        /* Recognition ends itself on long silences in some
           browsers; while the recording is wanted and healthy, it
           is simply started again. */
        if (voiceCapture === capture && !capture.stopping &&
            !capture.recognitionFailed) {
          try { rec.start(); } catch (e) { /* already running */ }
        }
        if (capture.endResolve) {
          const resolve = capture.endResolve;
          capture.endResolve = null;
          resolve();
        }
      };
      rec.start();
    } catch (err) {
      capture.recognition = null;
      capture.hadRecognition = false;
    }
  }
  showVoiceRecNote(capture.hadRecognition ? "" :
    "Transcription is not available in this browser; the recording will be attached on its own.");
  document.getElementById("voiceFinalText").textContent = "";
  document.getElementById("voiceInterimText").textContent = "";
  document.getElementById("voiceTimer").textContent = "00:00";
  document.getElementById("voiceBar").classList.remove("hidden");
  /* v2.102.0: a fresh bar is a fresh press: the buttons'
     single-fire stamps (see wireVoiceBarButton) are
     cleared as the capture starts, so the guard can
     only ever dedupe the two event forms of one press
     on THIS bar, never the first press on the next
     recording, however soon it is stopped. */
  ["voiceStopBtn", "voiceCancelBtn"].forEach(function (id) {
    const b = document.getElementById(id);
    if (b) { b.__ssVoiceFiredAt = 0; }
  });
  /* v2.14.1: the bar opens at the caret's line, not in the flow
     above the body. It is unhidden first so the size positionVoiceBar
     measures is the size on screen. */
  positionVoiceBar();
  document.getElementById("voiceNoteBtn").disabled = true;
  capture.timer = setInterval(function () {
    const el = document.getElementById("voiceTimer");
    if (el) {
      el.textContent = formatVoiceTimer(Date.now() - capture.startedAt);
    }
  }, 1000);
  capture.recorder.start(250);
}

/* v2.102.0: the bar's two buttons, wired to answer a
   press in whichever event form the engine delivers
   first. A healthy engine synthesizes a click from a
   tap; the engines where the phone report came from
   can let that synthesis go astray while the touch
   itself lands true, so a touchend runs the press too
   (suppressing its own default, so no synthesized
   click follows it), and the stamp keeps one physical
   press to exactly one run when both forms arrive.
   A mouse or keyboard press still arrives as the plain
   click it has always been. */
function wireVoiceBarButton(id, fn) {
  const el = document.getElementById(id);
  if (!el) { return; }
  const run = function (ev) {
    const now = Date.now();
    if (now - (el.__ssVoiceFiredAt || 0) < 700) { return; }
    el.__ssVoiceFiredAt = now;
    if (ev && ev.type === "touchend" &&
        typeof ev.preventDefault === "function") {
      ev.preventDefault();
    }
    fn();
  };
  el.addEventListener("click", run);
  el.addEventListener("touchend", run);
}

/* Stop everything about a capture without saving any of it: the
   chunks and the words die with the capture object. */
function endVoiceCapture(capture) {
  if (capture.timer) { clearInterval(capture.timer); capture.timer = null; }
  capture.recognitionFailed = true;
  if (capture.recognition) {
    try { capture.recognition.abort(); } catch (e) { /* ok */ }
    capture.recognition = null;
  }
  if (capture.recorder && capture.recorder.state !== "inactive") {
    try { capture.recorder.stop(); } catch (e) { /* ok */ }
  }
  if (capture.stream) {
    capture.stream.getTracks().forEach(function (t) { t.stop(); });
  }
  document.getElementById("voiceBar").classList.add("hidden");
  document.getElementById("voiceNoteBtn").disabled = false;
  if (voiceCapture === capture) { voiceCapture = null; }
}

function cancelVoiceNote() {
  const capture = voiceCapture;
  if (!capture) { return; }
  capture.stopping = true;
  endVoiceCapture(capture);
}

async function stopVoiceNote() {
  const capture = voiceCapture;
  if (!capture || capture.stopping) { return; }
  capture.stopping = true;
  if (capture.timer) { clearInterval(capture.timer); capture.timer = null; }
  /* Recognition gets the chance to deliver its last words before
     the transcript is read: stop it and wait for its end, with a
     timeout so a speech service that never answers cannot hang
     the save. */
  if (capture.recognition && capture.recognitionRunning) {
    const ended = new Promise(function (resolve) {
      capture.endResolve = resolve;
    });
    try { capture.recognition.stop(); } catch (e) { capture.endResolve = null; }
    if (capture.endResolve) {
      await Promise.race([ended, voiceSleep(1200)]);
      capture.endResolve = null;
    }
  }
  capture.recognition = null;
  /* v2.102.0: the wait for the recorder's own stop
     event is raced against a timeout. An engine that
     takes the stop() call and never answers it (the
     mobile engines are the ones that do this) would
     otherwise leave this promise, the bar, and the
     recording standing forever. On the timeout the
     capture finishes with whatever chunks had already
     arrived, the teardown below runs exactly as it
     does on a clean stop, and the user is told the
     stop was not answered. A recording can therefore
     never be left running by a failed stop. */
  const blob = await new Promise(function (resolve) {
    if (!capture.recorder) { resolve(null); return; }
    if (capture.recorder.state === "inactive") {
      resolve(new Blob(capture.chunks, { type: capture.mime }));
      return;
    }
    let settled = false;
    const finish = function (unanswered) {
      if (settled) { return; }
      settled = true;
      if (unanswered) {
        toast("The recorder did not answer Stop, so " +
          "the recording was finished with what had " +
          "been captured.", true);
      }
      resolve(new Blob(capture.chunks,
        { type: capture.mime }));
    };
    capture.recorder.onstop = function () {
      finish(false);
    };
    try { capture.recorder.stop(); }
    catch (e) { finish(false); return; }
    setTimeout(function () { finish(true); }, 1500);
  });
  if (capture.stream) {
    capture.stream.getTracks().forEach(function (t) { t.stop(); });
  }
  document.getElementById("voiceBar").classList.add("hidden");
  document.getElementById("voiceNoteBtn").disabled = false;
  voiceCapture = null;
  const note = currentNote();
  if (!note || note.id !== capture.noteId) {
    toast("The note changed while recording, so the voice note was discarded.", true);
    return;
  }
  if (!blob || !blob.size) {
    toast("The recording came out empty, so nothing was attached.", true);
    return;
  }
  const segments = capture.segments.filter(function (s) {
    return s && s.text && s.text.replace(/\s+/g, "") !== "";
  });
  const name = voiceNoteFileName(new Date()) +
    voiceAudioExtension(capture.mime);
  const file = new File([blob], name, {
    type: (capture.mime || "audio/webm").split(";")[0]
  });
  await saveVoiceNoteToNote(capture, note, file, segments);
}

/* v2.77: the transcript a live capture stores on its
   recording's record, in the exact shape the card reads
   (see sanitizeTranscript): the segments joined with a
   space as the text (the way the voice bar showed them),
   one timed unit per segment, and the model credit
   "live-speech-recognition", which names the browser's
   live recognition and can never be mistaken for one of
   the Whisper model ids the Transcribe menu stores. A
   unit's start is the offset at which the recognition
   first surfaced the segment (see onVoiceResult); its
   end is the next segment's start, and the last
   segment's end is its own start, because the capture
   tracks no segment end and never reads the recording's
   duration back. sanitizeTranscript coerces the shape
   like any other transcript's, so a malformed value
   degrades to no transcript rather than a broken
   record. */
function liveVoiceTranscript(segments) {
  const units = segments.map(function (s, i) {
    const next = segments[i + 1];
    return { start: s.start,
      end: next ? next.start : s.start, text: s.text };
  });
  return sanitizeTranscript({
    text: segments.map(function (s) { return s.text; }).join(" "),
    units: units,
    model: "live-speech-recognition",
    at: new Date().toISOString()
  });
}

/* The Stop landing: the recording goes through the one upload path
   every attachment takes, then its live transcript is stored on
   the recording's own record as the card's transcript (v2.77;
   see liveVoiceTranscript). A failed upload keeps the words: the
   failure toast uploadOneAttachment already gave stands, and the
   transcript is added as text at the saved caret instead, so a
   dictated note is never lost with its recording. */
async function saveVoiceNoteToNote(capture, note, file, segments) {
  restoreFormatSelection();
  const beforeIds = {};
  (note.attachments || []).forEach(function (a) { beforeIds[a.id] = true; });
  await uploadOneAttachment(note, capture.providerName, capture.driver, file);
  hideUploadProgress();
  let record = null;
  (note.attachments || []).forEach(function (a) {
    if (!beforeIds[a.id]) { record = a; }
  });
  const bodyEl = document.getElementById("noteBody");
  if (!record) {
    if (segments.length) {
      insertVoiceTranscript(null, segments);
      markDirty();
      toast("The recording could not be saved, but your words were added as text.", true);
    }
    return;
  }
  if (!segments.length) {
    toast(capture.hadRecognition
      ? "No speech was recognized, so the recording was attached on its own."
      : "Transcription is not available in this browser, so the recording was attached on its own.", true);
    return;
  }
  const el = bodyEl.querySelector(
    ".ss-attachment[data-attachment-id=\"" + record.id + "\"]");
  /* v2.77: the live transcript lands on the recording's
     own record as the card's transcript, and the open
     card's section is rebuilt from it in place; no
     transcript paragraphs enter the body. The dirty
     mark carries the record into the note's next save
     like any attachment edit. */
  record.transcript = liveVoiceTranscript(segments);
  if (el) { renderTranscriptSection(el, record); }
  markDirty();
  toast("Voice note added.");
}

/* v2.77: this paragraph landing remains only for the failed
   upload fallback in saveVoiceNoteToNote, where the recording
   itself could not be saved and no card exists to hold the
   words; a saved recording's transcript goes on its record
   instead (see liveVoiceTranscript). The paragraphs are built
   with textContent assignment only: dictated words are data,
   never markup, so speech that happens to sound like HTML
   lands as plain text. With an anchor
   (the audio card) they go directly after it; without one they go
   at the saved caret when it sits on a block boundary, and at the
   end of the note otherwise, rather than splitting a paragraph
   open around them. */
function insertVoiceTranscript(anchorEl, segments) {
  const bodyEl = document.getElementById("noteBody");
  const nodes = segments.map(function (seg) {
    const p = document.createElement("p");
    p.textContent = seg.text;
    return p;
  });
  if (!nodes.length) { return; }
  if (anchorEl && anchorEl.isConnected) {
    let ref = anchorEl;
    nodes.forEach(function (p) {
      ref.after(p);
      ref = p;
    });
    return;
  }
  if (savedCaretRange && savedCaretRange.startContainer === bodyEl &&
      bodyEl.contains(savedCaretRange.startContainer)) {
    const frag = document.createDocumentFragment();
    nodes.forEach(function (p) { frag.appendChild(p); });
    const range = savedCaretRange.cloneRange();
    range.deleteContents();
    range.insertNode(frag);
    return;
  }
  nodes.forEach(function (p) { bodyEl.appendChild(p); });
}

