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
/* ---------------- v2.80: Google Calendar; v2.81: writes ----
   The app's calendars (the Home Calendar widget and the
   Tasks view's calendar mode) gain the user's Google
   Calendar events, displayed beside the app's own dated
   items. Through v2.80 the connection was read only in
   the permission itself (the calendar.readonly scope);
   since v2.81 the sign in asks for the write capable
   calendar.events scope instead, and the module's
   second half (its own section, after the Settings row
   below) adds the event editor: creating, editing, and
   deleting events on the user's writable calendars,
   through the one write transport a static scan of this
   file (part of the build's test record) proves is the
   only path a calendar write verb can take.

   How it works, in the order the pieces run:

   - The token is the app's own Google access token, from
     the one token source every Drive call uses
     (getGoogleAccessToken, which renews quietly at the
     sign in Worker when the recorded token has lapsed).
     There is no second auth path for the calendar.
   - Fetching is lazy and month shaped. A calendar surface
     names the month it is showing (ensureGcalMonth) and
     the module fetches that month's visible grid range
     once: the calendar list first (once per session, or
     until a reset), then each participating calendar's
     events inside the range. A calendar participates when
     Google Calendar itself shows it (its selected flag is
     not false). Results are cached per range in page
   memory, in-flight requests for a range are shared, and
     nothing about an event is ever written to Drive, to
     the notes index, to tasks, or to the local snapshot:
     events live in this page's memory only and are gone
     when the app closes.
   - Days are local days, the task system's own convention
     (formatTaskDateParts over local date parts, never a
     UTC string slice). An event stands on every local day
     it touches: an all day event on each day from its
     start date to the day before its end date (the API's
     end date is exclusive), and a timed event on each day
     from its local start day to its local end day, where
     an end exactly at midnight belongs to the day before.
   - The standing states, each a first class outcome and
     never a toast: "ok" (events stand), "needs-consent"
     (the Calendar API answered 403, which is what a sign
     in without the calendar scope, or a project without
     the Calendar API enabled, produces; the surfaces show
     one caption line, "Google Calendar is not connected",
     with a Connect button that runs the consent forcing
     sign in, and nothing retries on its own until a sign
     in lands or a sync resets the module), and
     "unavailable" (a network failure or an unexpected
     answer; the surfaces show a subtle caption with a
     Retry button, tasks and reminders render exactly as
     they always have, and a later success clears it). A
     401 runs the standing silent renewal once and retries
     the load once; a second 401 reads as unavailable for
     that load, because session death is the auth layer's
     business, not this module's. While signed out the
     module never fetches and shows nothing.
   - Display order, pinned here because two surfaces share
     it. In a day bucket, and in the Home agenda which
     reads the same buckets: all day events first (by
     calendar name, then title), then timed items by their
     moment, an event's moment being its start held to the
     day's start when it began on an earlier day. The Home
     agenda merges tasks and note reminders into the timed
     group by the agenda's standing rules (a task before a
     note at the same moment); an event at the same moment
     stands before both, as the day's fixed appointments.
     In the Tasks month grid, a day's tasks stand first in
     their own order and the day's events follow, sharing
     the cell's visible entry limit and its expander. */

const GCAL_API_BASE = "https://www.googleapis.com/calendar/v3";

/* How long a failed range rests before a surface showing
   it may ask again on its own. The Retry button and a
   sync ignore the rest; it exists so a broken network
   cannot turn every render into a fetch. */
const GCAL_RETRY_REST_MS = 60 * 1000;

/* The module's standing state. gcalStatus is one of
   "idle" (nothing asked yet, or signed out), "ok",
   "needs-consent", or "unavailable". The rest is the
   page memory cache the header describes: the calendar
   list once loaded, the events by their unique key, the
   day buckets rebuilt from them, the ranges that stand
   fetched, in flight, or resting after a failure, and
   the months any surface has named (the Retry button's
   and the sync refresh's working set). */
let gcalStatus = "idle";
let gcalCalendars = null;
let gcalEventsByKey = {};
let gcalEventsByDay = {};
let gcalRangesDone = {};
let gcalRangesInFlight = {};
let gcalRangeFailedAt = {};
let gcalVisibleMonths = {};
let gcalCaptionDirty = false;

/* A calendar credential stands when a Worker session or
   a recorded provider token does: the same trio the
   v2.79 migration reads. When none stands the user is
   signed out, and the module stays silent. */
function gcalSignedInAble() {
  if (workerSessionToken || loadWorkerSessionBlob()) {
    return true;
  }
  const blob = loadProviderTokenBlob();
  return !!(blob && blob.google);
}

/* The local day string for a Date, in the task system's
   own parts form. */
function gcalLocalDayStr(date) {
  return formatTaskDateParts(date.getFullYear(),
    date.getMonth() + 1, date.getDate());
}

/* The local start of a day string, as a timestamp. */
function gcalDayStartMs(dayStr) {
  const p = parseTaskDate(dayStr);
  if (!p) { return 0; }
  return new Date(p.y, p.m - 1, p.d).getTime();
}

/* The range a month grid actually shows: the Sunday on
   or before the first of the month through the Saturday
   completing its last week, the two calendar builders'
   own cell math, as a half open interval of instants
   plus the cache key that names it. */
function gcalMonthRange(y, m) {
  const firstDow = new Date(y, m - 1, 1).getDay();
  const daysInMonth = new Date(y, m, 0).getDate();
  const cellCount = Math.ceil((firstDow + daysInMonth) / 7) * 7;
  const start = new Date(y, m - 1, 1 - firstDow);
  const end = new Date(y, m - 1, 1 - firstDow + cellCount);
  return {
    key: gcalLocalDayStr(start) + "/" + gcalLocalDayStr(end),
    timeMin: start.toISOString(),
    timeMax: end.toISOString()
  };
}

/* One Calendar API read. Resolves with the status and the
   parsed body (null when the body does not parse); a
   network failure rejects, and the caller reads that as
   the unavailable state. */
async function gcalApiGet(path, token) {
  const res = await fetch(GCAL_API_BASE + path, {
    method: "GET",
    headers: { "Authorization": "Bearer " + token }
  });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { status: res.status, data: data };
}

/* Settle one raw API event into the module's own shape,
   or return null for an event that does not stand
   (cancelled, or carrying no usable start). Days are
   computed once, here, by the header's local day rules;
   the iteration is capped at a generous year so a
   pathological span cannot flood the buckets. */
function normalizeGcalEvent(raw, cal) {
  if (!raw || raw.status === "cancelled" || !raw.start) {
    return null;
  }
  const ev = {
    uid: cal.id + "|" + String(raw.id || ""),
    id: String(raw.id || ""),
    calendarId: cal.id,
    calendarName: cal.summary || "",
    color: cal.color || "",
    title: raw.summary ? String(raw.summary) : "(No title)",
    summary: raw.summary ? String(raw.summary) : "",
    location: raw.location ? String(raw.location) : "",
    description: raw.description ? String(raw.description) : "",
    recurring: !!(raw.recurrence || raw.recurringEventId),
    /* v2.87: the series' own identity and rule. An
       expanded instance names its master in
       recurringEventId (the master names itself); the
       master record carries the recurrence rule, an
       instance does not, so recurrence stands null on
       an instance until its master is fetched. Delete
       series and the view's Repeats line read these. */
    masterId: raw.recurringEventId
      ? String(raw.recurringEventId)
      : String(raw.id || ""),
    recurrence: Array.isArray(raw.recurrence)
      ? raw.recurrence.map(function (r) {
          return String(r);
        })
      : null,
    /* v2.87 Part D: the event's reminders, as the
       API carries them: useDefault, with the
       calendar's own defaults standing behind it,
       or the overrides themselves. An answer with
       no reminders object reads as the defaults
       case, which is the API's own default. */
    reminders: {
      useDefault: raw.reminders
        ? raw.reminders.useDefault !== false
        : true,
      overrides: raw.reminders &&
        Array.isArray(raw.reminders.overrides)
        ? raw.reminders.overrides.map(function (r) {
            return {
              method: r && r.method === "email"
                ? "email" : "popup",
              minutes: Number(r && r.minutes) || 0
            };
          })
        : []
    },
    htmlLink: raw.htmlLink ? String(raw.htmlLink) : "",
    linkNoteIds: gcalLinkNoteIdsOf(raw),
    allDay: !!raw.start.date,
    startMs: 0,
    endMs: 0,
    days: []
  };
  if (!raw.id) { return null; }
  const days = [];
  if (ev.allDay) {
    const startParts = parseTaskDate(String(raw.start.date));
    if (!startParts) { return null; }
    const endParts = raw.end && raw.end.date
      ? parseTaskDate(String(raw.end.date)) : null;
    const cur = new Date(startParts.y, startParts.m - 1,
      startParts.d);
    let end = endParts
      ? new Date(endParts.y, endParts.m - 1, endParts.d)
      : new Date(startParts.y, startParts.m - 1,
        startParts.d + 1);
    if (end.getTime() <= cur.getTime()) {
      end = new Date(cur.getTime() + 86400000);
    }
    while (cur.getTime() < end.getTime() && days.length < 370) {
      days.push(gcalLocalDayStr(cur));
      cur.setDate(cur.getDate() + 1);
    }
    ev.startMs = gcalDayStartMs(days[0]);
    ev.endMs = end.getTime();
  } else {
    const startMs = Date.parse(String(raw.start.dateTime || ""));
    if (!isFinite(startMs)) { return null; }
    let endMs = raw.end ? Date.parse(String(raw.end.dateTime || "")) : NaN;
    if (!isFinite(endMs) || endMs < startMs) { endMs = startMs; }
    ev.startMs = startMs;
    ev.endMs = endMs;
    const cur = new Date(startMs);
    cur.setHours(0, 0, 0, 0);
    let last = new Date(endMs);
    /* An end exactly at local midnight belongs to the
       day before: the event never touches that day. */
    if (endMs > startMs && last.getHours() === 0 &&
        last.getMinutes() === 0 && last.getSeconds() === 0 &&
        last.getMilliseconds() === 0) {
      last = new Date(endMs - 86400000);
    }
    last.setHours(0, 0, 0, 0);
    while (cur.getTime() <= last.getTime() && days.length < 370) {
      days.push(gcalLocalDayStr(cur));
      cur.setDate(cur.getDate() + 1);
    }
  }
  if (!days.length) { return null; }
  ev.days = days;
  return ev;
}

/* Rebuild the day buckets from every event the module
   holds, in the header's display order: all day events
   first (calendar name, then title), then timed events
   by their start held to the day's start, then title. */
function gcalRebuildDayBuckets() {
  const byDay = {};
  Object.keys(gcalEventsByKey).forEach(function (uid) {
    const ev = gcalEventsByKey[uid];
    ev.days.forEach(function (day) {
      (byDay[day] = byDay[day] || []).push(ev);
    });
  });
  Object.keys(byDay).forEach(function (day) {
    const dayStart = gcalDayStartMs(day);
    byDay[day].sort(function (a, b) {
      if (a.allDay !== b.allDay) { return a.allDay ? -1 : 1; }
      if (a.allDay) {
        const ac = a.calendarName || "";
        const bc = b.calendarName || "";
        if (ac !== bc) { return ac.localeCompare(bc); }
        return a.title.localeCompare(b.title);
      }
      const am = Math.max(a.startMs, dayStart);
      const bm = Math.max(b.startMs, dayStart);
      if (am !== bm) { return am - bm; }
      return a.title.localeCompare(b.title);
    });
  });
  gcalEventsByDay = byDay;
}

/* The day's events, in display order (empty when the
   module holds none for it). */
function gcalEventsForDay(dayStr) {
  return gcalEventsByDay[dayStr] || [];
}

/* How many calendars participate (shown names and the
   Settings count read it). Zero until the list stands. */
function gcalParticipatingCount() {
  return gcalCalendars ? gcalCalendars.length : 0;
}

/* Record a status change. A change in whether a caption
   stands (into or out of the two captioned states) is
   remembered, so the settle pass re-renders the surfaces
   that must gain or lose the line. */
function gcalSetStatus(next) {
  if (gcalStatus === next) { return; }
  const wasCaption = gcalStatus === "needs-consent" ||
    gcalStatus === "unavailable";
  gcalStatus = next;
  const isCaption = next === "needs-consent" ||
    next === "unavailable";
  if (wasCaption !== isCaption) { gcalCaptionDirty = true; }
}

/* Forget everything the module holds: the calendar list,
   the events, the range cache, and the standing state.
   A completed sign in calls it (a consent may have just
   changed what the API will answer), and a sync calls
   it before re-asking for the visible months. */
function resetGcalState() {
  gcalCalendars = null;
  gcalEventsByKey = {};
  gcalEventsByDay = {};
  gcalRangesDone = {};
  gcalRangeFailedAt = {};
  if (gcalStatus !== "idle") {
    gcalSetStatus("idle");
  }
}

/* One full load attempt for a range with a token in
   hand: the calendar list first when it does not stand
   yet, then every participating calendar's events in
   the range, in parallel. Resolves with an outcome word
   ("ok" with the settled events, "unauthorized",
   "forbidden", or "bad"); only a network failure
   rejects. An answer's outcome outranks another's in
   that order: a 401 may heal on the caller's retry, a
   403 is the consent state, anything else unexpected is
   simply bad. */
async function gcalLoadAttempt(range, token) {
  if (!gcalCalendars) {
    const listRes = await gcalApiGet(
      "/users/me/calendarList?minAccessRole=reader", token);
    if (listRes.status === 401) {
      return { outcome: "unauthorized" };
    }
    if (listRes.status === 403) {
      return { outcome: "forbidden" };
    }
    if (listRes.status !== 200 || !listRes.data) {
      return { outcome: "bad" };
    }
    const items = Array.isArray(listRes.data.items)
      ? listRes.data.items : [];
    gcalCalendars = gcalSanitizeCalendarList(items);
  }
  let sawUnauthorized = false;
  let sawForbidden = false;
  let sawBad = false;
  const collected = [];
  await Promise.all(gcalCalendars.map(function (cal) {
    const path = "/calendars/" + encodeURIComponent(cal.id) +
      "/events?singleEvents=true&orderBy=startTime" +
      "&maxResults=250" +
      "&timeMin=" + encodeURIComponent(range.timeMin) +
      "&timeMax=" + encodeURIComponent(range.timeMax);
    return gcalApiGet(path, token).then(function (res) {
      if (res.status === 401) { sawUnauthorized = true; return; }
      if (res.status === 403) { sawForbidden = true; return; }
      if (res.status !== 200 || !res.data) { sawBad = true; return; }
      const items = Array.isArray(res.data.items)
        ? res.data.items : [];
      items.forEach(function (raw) {
        const ev = normalizeGcalEvent(raw, cal);
        if (ev) { collected.push(ev); }
      });
    });
  }));
  if (sawUnauthorized) { return { outcome: "unauthorized" }; }
  if (sawForbidden) { return { outcome: "forbidden" }; }
  if (sawBad) { return { outcome: "bad" }; }
  return { outcome: "ok", events: collected };
}

/* Load one range and settle the outcome into the
   module's standing state, per the header: the token
   from the app's one token source, one renewal and one
   retry behind a 401, the consent state behind a 403,
   the unavailable state behind a network failure or an
   unexpected answer, and events merged into the page
   memory cache behind a success. */
async function fetchGcalRange(range) {
  let token = null;
  try {
    token = await getGoogleAccessToken();
  } catch (e) {
    if (e && e.code === "GOOGLE_SIGN_IN_REQUIRED") {
      /* No credential stands after all: the signed out
         state, which the gate owns. Stay silent. */
      gcalSetStatus("idle");
    } else {
      gcalRangeFailedAt[range.key] = Date.now();
      gcalSetStatus("unavailable");
    }
    gcalAfterSettle(false);
    return;
  }
  let attempt = null;
  try {
    attempt = await gcalLoadAttempt(range, token);
    if (attempt.outcome === "unauthorized") {
      const renewed = await googleTrySilentSignIn();
      if (renewed) {
        const fresh = await getProviderToken("google");
        if (fresh) {
          attempt = await gcalLoadAttempt(range, fresh);
        }
      }
    }
  } catch (e) {
    gcalRangeFailedAt[range.key] = Date.now();
    gcalSetStatus("unavailable");
    gcalAfterSettle(false);
    return;
  }
  if (attempt.outcome === "forbidden") {
    gcalSetStatus("needs-consent");
    gcalAfterSettle(false);
    return;
  }
  if (attempt.outcome !== "ok") {
    gcalRangeFailedAt[range.key] = Date.now();
    gcalSetStatus("unavailable");
    gcalAfterSettle(false);
    return;
  }
  let changed = false;
  attempt.events.forEach(function (ev) {
    if (!gcalEventsByKey[ev.uid]) { changed = true; }
    gcalEventsByKey[ev.uid] = ev;
  });
  if (changed) { gcalRebuildDayBuckets(); }
  gcalRangesDone[range.key] = true;
  delete gcalRangeFailedAt[range.key];
  gcalSetStatus("ok");
  gcalAfterSettle(changed);
}

/* The surfaces' one ask: make sure this month's events
   are on their way. Records the month as visible (the
   Retry button and the sync refresh work from that
   set), then starts the load unless the range stands
   fetched, is already in flight, is resting after a
   recent failure, the consent state stands (only a sign
   in or a reset reopens it), or nobody is signed in. */
function ensureGcalMonth(y, m) {
  gcalVisibleMonths[y + "-" + m] = { y: y, m: m };
  if (!gcalSignedInAble()) { return; }
  if (gcalStatus === "needs-consent") { return; }
  const range = gcalMonthRange(y, m);
  if (gcalRangesDone[range.key] ||
      gcalRangesInFlight[range.key]) {
    return;
  }
  const failedAt = gcalRangeFailedAt[range.key];
  if (failedAt && Date.now() - failedAt < GCAL_RETRY_REST_MS) {
    return;
  }
  gcalRangesInFlight[range.key] = true;
  const settle = function () {
    delete gcalRangesInFlight[range.key];
  };
  fetchGcalRange(range).then(settle, settle);
}

/* The unavailable caption's Retry: lift every failure
   rest and ask for the visible months again. */
function gcalRetryVisible() {
  gcalRangeFailedAt = {};
  Object.keys(gcalVisibleMonths).forEach(function (k) {
    const vm = gcalVisibleMonths[k];
    ensureGcalMonth(vm.y, vm.m);
  });
}

/* A completed sync refreshes the events with everything
   else: forget the cache and re-ask for the visible
   months (the current month when none has been named).
   The consent state is left standing: only a sign in
   reopens it, and its Connect button is the path. */
function refreshGcalAfterSync() {
  if (gcalStatus === "needs-consent") { return; }
  resetGcalState();
  const keys = Object.keys(gcalVisibleMonths);
  if (!keys.length) {
    const t = taskTodayParts();
    ensureGcalMonth(t.y, t.m);
    return;
  }
  keys.forEach(function (k) {
    const vm = gcalVisibleMonths[k];
    ensureGcalMonth(vm.y, vm.m);
  });
}

/* The consent sign in, from the captions and Settings:
   arm the fresh flag (the consent screen is the only
   route to a grant the standing sign in does not hold,
   the flag's own meaning since v2.79) and run the one
   navigation seam. Nothing else in this module ever
   navigates. */
function connectGoogleCalendar() {
  workerReauthNeeded = true;
  navigateToWorkerLogin();
}

/* After a load settles: the Settings row always follows
   the state, and the calendar surfaces re-render when
   what they show could have changed (events landed, or
   a caption must appear or clear). */
function gcalAfterSettle(eventsChanged) {
  renderGcalSettingsRow();
  if (!eventsChanged && !gcalCaptionDirty) { return; }
  gcalCaptionDirty = false;
  if (state.view && state.view.kind === "home") {
    renderHome();
  }
  if (state.view && state.view.kind === "tasks" &&
      state.tasksView.mode === "calendar") {
    fillTasksBody();
  }
}

/* "9:00 AM" for an instant, the task system's own time
   words over the instant's local time of day. */
function gcalTimeOfDayLabel(ms) {
  const d = new Date(ms);
  function pad(n) {
    const s = String(n);
    return s.length < 2 ? "0" + s : s;
  }
  return taskTimeLabel(pad(d.getHours()) + ":" +
    pad(d.getMinutes()));
}

/* An event's time words: "All day", a same day range, or
   a range whose end day is named (a timed event that
   runs past midnight shows its true range). */
function gcalEventTimeLabel(ev) {
  if (ev.allDay) { return "All day"; }
  const start = gcalTimeOfDayLabel(ev.startMs);
  const end = gcalTimeOfDayLabel(ev.endMs);
  const startDay = gcalLocalDayStr(new Date(ev.startMs));
  const endDay = gcalLocalDayStr(new Date(ev.endMs));
  if (startDay === endDay) { return start + " - " + end; }
  return start + " - " + taskDateLabel(endDay) + " " + end;
}

/* One event's row, shared by both calendar surfaces in
   the Tasks calendar entry's own shape (see
   buildTaskCalEntryEl): a head row with the calendar's
   color chip, the time words, and the calendar's name
   at the right when more than one calendar participates,
   over the title at the card's full width. There is no
   checkbox on it: an event is never a task. Since v2.81
   its click opens the event editor (the module's second
   half), stopping the click from reaching the day cell
   under it; through v2.80 the click opened the event in
   Google Calendar instead, and that link now lives
   inside the editor. v2.83: a past event wears the
   faded dress (gcal-past), and the click's destination
   follows the routing rule: the editor for a single,
   future, writable event, the read only event view for
   the rest (see the links section below). */
function buildGcalEventEl(ev) {
  const el = document.createElement("div");
  el.className = "task-cal-entry gcal-entry" +
    (gcalEventIsPast(ev) ? " gcal-past" : "");
  el.setAttribute("data-gcal-id", ev.uid);
  el.title = ev.title;
  const head = document.createElement("span");
  head.className = "task-cal-entry-head";
  const chip = document.createElement("span");
  chip.className = "gcal-chip";
  chip.setAttribute("aria-hidden", "true");
  if (ev.color) { chip.style.backgroundColor = ev.color; }
  head.appendChild(chip);
  const time = document.createElement("span");
  time.className = "task-cal-entry-time";
  time.textContent = gcalEventTimeLabel(ev);
  head.appendChild(time);
  if (gcalParticipatingCount() > 1 && ev.calendarName) {
    const name = document.createElement("span");
    name.className = "gcal-cal-name";
    name.textContent = ev.calendarName;
    head.appendChild(name);
  }
  el.appendChild(head);
  const title = document.createElement("span");
  title.className = "task-cal-entry-title";
  title.textContent = ev.title;
  el.appendChild(title);
  el.addEventListener("click", function (clickEv) {
    clickEv.stopPropagation();
    openGcalEventEditor(ev, ev.days[0]);
  });
  return el;
}

/* The one caption line the surfaces show for the two
   captioned states (null in every other state, signed
   out included): the consent state's line carries its
   Connect button, the unavailable state's its Retry.
   Deliberately quiet: muted words, a small button, no
   toast, and never more than this one line per surface. */
function buildGcalStatusEl() {
  if (gcalStatus !== "needs-consent" &&
      gcalStatus !== "unavailable") {
    return null;
  }
  const el = document.createElement("div");
  el.className = "gcal-status";
  el.setAttribute("data-gcal-status", gcalStatus);
  const text = document.createElement("span");
  text.className = "gcal-status-text";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn small";
  if (gcalStatus === "needs-consent") {
    text.textContent = "Google Calendar is not connected";
    btn.className += " gcal-connect-btn";
    btn.textContent = "Connect";
    btn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      connectGoogleCalendar();
    });
  } else {
    text.textContent = "Google Calendar unavailable";
    btn.className += " gcal-retry-btn";
    btn.textContent = "Retry";
    btn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      gcalRetryVisible();
    });
  }
  el.appendChild(text);
  el.appendChild(btn);
  return el;
}

/* The Settings Connection row's standing state, filled
   whenever Settings syncs its controls and whenever a
   load settles: Connected with the participating
   calendar count, Not connected (its Connect button
   standing only in the consent state, the one state
   where a click is the cure), or Unavailable. */
function renderGcalSettingsRow() {
  const statusEl = document.getElementById(
    "settingsGcalStatus");
  if (!statusEl) { return; }
  const btn = document.getElementById(
    "settingsGcalConnectBtn");
  let text = "Not connected";
  let showBtn = false;
  if (gcalStatus === "ok") {
    const n = gcalParticipatingCount();
    text = "Connected (" + n + (n === 1
      ? " calendar)" : " calendars)");
  } else if (gcalStatus === "needs-consent") {
    text = "Not connected";
    showBtn = true;
  } else if (gcalStatus === "unavailable") {
    text = "Unavailable right now";
  }
  statusEl.textContent = text;
  if (btn) { btn.classList.toggle("hidden", !showBtn); }
}

/* ---------------- v2.81: calendar writes, the event editor ----
   Phase 2 of the calendar connection: the user can
   create, edit, and delete Google Calendar events from
   inside the app, in one editor dialog both calendar
   surfaces open (their New event buttons, and a click
   on any event row, which through v2.80 opened the
   event in Google Calendar instead; that link now lives
   inside the editor). The sign in's calendar permission
   grows from read only to the write capable
   calendar.events scope at the Worker (Worker v3,
   console work beside this build); this module behaves
   correctly on either grant, because a write the grant
   does not cover answers 403 and lands in the editor as
   its own state (below), never as the read side's
   consent state.

   The write rules, in the order the pieces run:

   - Every write goes through the one transport,
     gcalApiSend, against the same API base the reads
     use, with the token from the app's one token
     source. A static scan of this file (part of the
     build's test record) proves the calendar write
     verbs reach the API only through it. The outcome
     discipline mirrors the read loader's: a 401 runs
     the standing silent renewal once and retries once;
     a 403 is the distinct "forbidden-write" outcome; a
     network failure or any other answer is "bad".
   - Events still live in page memory only. A write
     sends the event to Google and nothing event shaped
     is ever written to Drive, to the notes index, to
     tasks, or to the local snapshot: on success the
     module forgets its cache and re-asks for the
     visible months, so what the surfaces show is what
     Google answered, never a local edit.
   - The editor never loses input. A failed save or
     delete leaves the dialog open with every field
     exactly as typed and the reason in its inline error
     line: the write permission line, with a Connect
     button that runs the consent forcing sign in, for
     forbidden-write; a could-not-reach line for the
     rest, where saving again is the retry.
   - Two kinds of event open in a limited mode, fields
     disabled, no Save and no Delete, a note saying why,
     and the Open in Google Calendar link: a repeating
     event (the fetched record carries a recurrence or
     a recurring event id; this build does not edit
     recurrence, an intended limitation), and an event
     on a calendar the sign in may only read (its access
     role is neither owner nor writer). Editing never
     moves an event between calendars: the calendar
     select is disabled on edit. */

/* Settle the calendar list's raw records into the
   module's own shape: identity and display, and the
   facts the event editor needs, the access role that
   says whether the sign in may write to the calendar
   (owner or writer) and the primary flag that picks
   the create default. Only calendars Google Calendar
   itself shows (selected not false) participate, the
   read side's standing rule. */
function gcalSanitizeCalendarList(items) {
  return (items || []).filter(function (c) {
    return c && c.id && c.selected !== false;
  }).map(function (c) {
    return {
      id: String(c.id),
      summary: String(c.summary || ""),
      color: String(c.backgroundColor || ""),
      accessRole: String(c.accessRole || ""),
      /* v2.87 Part D: the calendar's own default
         reminders, which the calendarList answers
         already carry (no fields mask is in play on
         either calendarList read in this app, so the
         request itself needed no change), settled to
         the shape the events' overrides wear. */
      defaultReminders: Array.isArray(c.defaultReminders)
        ? c.defaultReminders.map(function (r) {
            return {
              method: r && r.method === "email"
                ? "email" : "popup",
              minutes: Number(r && r.minutes) || 0
            };
          })
        : [],
      primary: c.primary === true
    };
  });
}

/* The calendars the editor may write to: access role
   owner or writer. Everything else the list holds is
   read only for this sign in. */
function gcalWritableCalendars() {
  if (!gcalCalendars) { return []; }
  return gcalCalendars.filter(function (c) {
    return c.accessRole === "owner" || c.accessRole === "writer";
  });
}

function gcalCalendarIsWritable(calId) {
  return gcalWritableCalendars().some(function (c) {
    return c.id === calId;
  });
}

/* Make sure the calendar list stands before the editor
   opens. The surfaces' lazy month fetch is what usually
   loads it; the editor asks for the list alone when it
   has not landed yet, with the read loader's own 401
   discipline. Resolves false when the list could not be
   had; the editor still opens (an edit carries its own
   calendar facts, and a create then has no calendar to
   offer, which its error line says). */
async function gcalEnsureCalendarList() {
  if (gcalCalendars) { return true; }
  let token = null;
  try { token = await getGoogleAccessToken(); }
  catch (e) { return false; }
  let res = null;
  try {
    res = await gcalApiGet(
      "/users/me/calendarList?minAccessRole=reader", token);
    if (res.status === 401) {
      const renewed = await googleTrySilentSignIn();
      if (renewed) {
        const fresh = await getProviderToken("google");
        if (fresh) {
          res = await gcalApiGet(
            "/users/me/calendarList?minAccessRole=reader",
            fresh);
        }
      }
    }
  } catch (e) { return false; }
  if (!res || res.status !== 200 || !res.data) {
    return false;
  }
  gcalCalendars = gcalSanitizeCalendarList(
    Array.isArray(res.data.items) ? res.data.items : []);
  return true;
}

/* One Calendar API write, the transport every create,
   edit, and delete goes through: the method, a JSON
   body when the call carries one, and the same lenient
   answer reading as the read transport (a 204 delete
   answer parses to null). Resolves with the status and
   the parsed body; a network failure rejects, and the
   caller reads that as its bad outcome. */
async function gcalApiSend(method, path, bodyObj, token) {
  const opts = {
    method: method,
    headers: { "Authorization": "Bearer " + token }
  };
  if (bodyObj) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(bodyObj);
  }
  const res = await fetch(GCAL_API_BASE + path, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { status: res.status, data: data };
}

/* One write, settled into the module's outcome words:
   "ok" (the answer is a success status), "forbidden-
   write" (a 403: the standing grant does not cover
   writing, which since Phase 2 is a state of the grant,
   not of the read connection, and never touches the
   read side's consent state), or "bad" (a network
   failure or any other answer). A 401 runs the standing
   silent renewal once and retries the write once, the
   read loader's own discipline; a second 401 is bad. */
async function gcalSendWithRenewal(method, path, bodyObj) {
  let token = null;
  try { token = await getGoogleAccessToken(); }
  catch (e) { return { outcome: "bad", data: null }; }
  let res = null;
  try {
    res = await gcalApiSend(method, path, bodyObj, token);
    if (res.status === 401) {
      const renewed = await googleTrySilentSignIn();
      if (renewed) {
        const fresh = await getProviderToken("google");
        if (fresh) {
          res = await gcalApiSend(method, path, bodyObj,
            fresh);
        }
      }
    }
  } catch (e) {
    return { outcome: "bad", data: null };
  }
  if (res.status === 200 || res.status === 201 ||
      res.status === 204) {
    return { outcome: "ok", data: res.data };
  }
  if (res.status === 403) {
    return { outcome: "forbidden-write", data: res.data };
  }
  return { outcome: "bad", data: res.data };
}

/* "HH:MM" for an instant's local time of day, the time
   input's own value shape. */
function gcalTimeInputValue(ms) {
  const d = new Date(ms);
  function p2(n) {
    const s = String(n);
    return s.length < 2 ? "0" + s : s;
  }
  return p2(d.getHours()) + ":" + p2(d.getMinutes());
}

/* The instant a date input's day and a time input's
   value name together, in local time (an empty time
   reads as midnight). NaN when the date does not
   parse. */
function gcalDateTimeMs(dateStr, timeStr) {
  const p = parseTaskDate(dateStr);
  if (!p) { return NaN; }
  const t = /^(\d{1,2}):(\d{2})/.exec(String(timeStr || ""));
  const hh = t ? Number(t[1]) : 0;
  const mm = t ? Number(t[2]) : 0;
  return new Date(p.y, p.m - 1, p.d, hh, mm).getTime();
}

/* An instant as an RFC 3339 string in local time, with
   the device's own offset, the shape the API pairs with
   the timeZone field the editor sends beside it. */
function gcalRfc3339Local(ms) {
  const d = new Date(ms);
  function p2(n) {
    const s = String(n);
    return s.length < 2 ? "0" + s : s;
  }
  const offMin = -d.getTimezoneOffset();
  const sign = offMin < 0 ? "-" : "+";
  const abs = Math.abs(offMin);
  return d.getFullYear() + "-" + p2(d.getMonth() + 1) +
    "-" + p2(d.getDate()) + "T" + p2(d.getHours()) + ":" +
    p2(d.getMinutes()) + ":" + p2(d.getSeconds()) + sign +
    p2(Math.floor(abs / 60)) + ":" + p2(abs % 60);
}

/* A day string shifted by whole days, the all day
   editor's exclusive end conversion (the form's end
   date is the inclusive last day; the API's end date
   is the day after). */
function gcalShiftDayStr(dayStr, n) {
  const p = parseTaskDate(dayStr);
  if (!p) { return dayStr; }
  return gcalLocalDayStr(new Date(p.y, p.m - 1, p.d + n));
}

/* The next whole hour from now, the new event's default
   start time of day. */
function gcalNextWholeHour() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(),
    now.getDate(), now.getHours(), 0, 0, 0);
  if (start.getTime() <= now.getTime()) {
    start.setHours(start.getHours() + 1);
  }
  return start;
}

/* The editor's standing state: null while it is closed,
   else { mode ("create" or "edit"), eventId, calendarId,
   uid, title (the display title, for the delete
   confirmation), limited, saving, deleting }. */
let gcalEditorState = null;

function gcalEditorEl(id) {
  return document.getElementById(id);
}

/* Fill the editor's calendar select. On create it lists
   the writable calendars only (a read only calendar can
   never be a create target). On edit the event's own
   calendar stands at the head even when it is not
   writable, so the disabled select can show where the
   event lives. */
function fillGcalEditorCalendarSelect(st) {
  const sel = gcalEditorEl("gcalEvCalendarSelect");
  if (!sel) { return; }
  sel.innerHTML = "";
  let pool = gcalWritableCalendars();
  if (st.mode === "edit") {
    const own = (gcalCalendars || []).filter(function (c) {
      return c.id === st.calendarId;
    });
    if (own.length && !pool.some(function (c) {
      return c.id === st.calendarId;
    })) {
      pool = own.concat(pool);
    }
  }
  pool.forEach(function (c) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.summary || c.id;
    sel.appendChild(opt);
  });
  if (st.calendarId) { sel.value = st.calendarId; }
}

/* The editor's inline error line: a message, and the
   Connect button standing only when asked for (the
   write permission failure, whose cure is the consent
   forcing sign in). The line never carries a toast's
   job: it stays until the next save or a close. */
function showGcalEditorError(message, withConnect) {
  const box = gcalEditorEl("gcalEvError");
  const text = gcalEditorEl("gcalEvErrorText");
  const btn = gcalEditorEl("gcalEvConnectBtn");
  if (!box || !text) { return; }
  text.textContent = message;
  box.classList.remove("hidden");
  if (btn) {
    btn.classList.toggle("hidden", !withConnect);
  }
}

function clearGcalEditorError() {
  const box = gcalEditorEl("gcalEvError");
  if (box) { box.classList.add("hidden"); }
  const btn = gcalEditorEl("gcalEvConnectBtn");
  if (btn) { btn.classList.add("hidden"); }
}

/* The all day checkbox's one effect on the fields: the
   time inputs stand disabled while it is checked (the
   end date then reads as the inclusive last day). The
   limited mode's blanket disable outranks it. */
function gcalEditorSyncAllDay() {
  const allDay = gcalEditorEl("gcalEvAllDayInput");
  const dis = !!(allDay && allDay.checked);
  if (gcalEditorState && gcalEditorState.limited) { return; }
  ["gcalEvStartTimeInput", "gcalEvEndTimeInput"]
    .forEach(function (id) {
      const el = gcalEditorEl(id);
      if (el) { el.disabled = dis; }
    });
}

/* Put the editor into or out of its limited mode: every
   field disabled, Save and Delete hidden, and the note
   standing with its reason. Out of it, the fields
   enable again (the caller re-applies the edit mode's
   disabled calendar select and the all day time rule
   after this runs). */
function gcalEditorSetLimited(limited, noteText) {
  const note = gcalEditorEl("gcalEvNote");
  if (note) {
    note.textContent = noteText || "";
    note.classList.toggle("hidden", !limited);
  }
  ["gcalEvTitleInput", "gcalEvCalendarSelect",
   "gcalEvAllDayInput", "gcalEvStartDateInput",
   "gcalEvStartTimeInput", "gcalEvEndDateInput",
   "gcalEvEndTimeInput", "gcalEvLocationInput",
   "gcalEvDescInput", "gcalEvRepeatSelect",
   "gcalEvRepeatInterval", "gcalEvRepeatEndDate",
   "gcalEvRepeatEndCount"].forEach(function (id) {
    const el = gcalEditorEl(id);
    if (el) { el.disabled = !!limited; }
  });
  const save = gcalEditorEl("gcalEvSaveBtn");
  if (save) { save.classList.toggle("hidden", !!limited); }
  const del = gcalEditorEl("gcalEvDeleteBtn");
  if (del && limited) { del.classList.add("hidden"); }
}

/* Open the event editor: for a new event (ev null) on
   the given day, or for the given event. A new event
   defaults to the selected day, the primary writable
   calendar (else the first writable), timed, the next
   whole hour, one hour long. An edit loads the event's
   own facts; an all day event's end date shows as its
   inclusive last day. A repeating event, an event
   on a read only calendar, or a past event opens in
   the read only event view instead (v2.83). */
async function openGcalEventEditor(ev, dayStr) {
  const modal = gcalEditorEl("gcalEventModal");
  if (!modal) { return; }
  /* v2.83 routing: a past event, a repeating event, or
     an event on a calendar the sign in may only read
     opens in the read only event view, not here; the
     editor below serves single, future, writable
     events. Every caller (the surfaces' rows, the
     event chip's travel) comes through this door, so
     the rule stands in this one place. */
  if (ev && gcalEventOpensInView(ev)) {
    openGcalEventView(ev);
    return;
  }
  await gcalEnsureCalendarList();
  const st = {
    mode: ev ? "edit" : "create",
    eventId: ev ? ev.id : "",
    calendarId: ev ? ev.calendarId : "",
    uid: ev ? ev.uid : "",
    title: ev ? ev.title : "",
    ev: ev || null,
    limited: false,
    saving: false,
    deleting: false,
    /* v2.87: whether the user has picked the weekly
       repeat days by hand; until they do, the chips
       follow the start date (see gcalEditorResetRepeat). */
    repeatDaysTouched: false,
    /* v2.87 Part D: the Notifications section's seed
       state: whether any row has been touched, the
       event's own reminders kept verbatim (so an
       untouched save returns them exactly), and
       whether the standing seed came from the
       calendar's defaults. */
    notifTouched: false,
    notifOriginal: null,
    notifFromDefaults: false
  };
  gcalEditorState = st;
  const writable = gcalWritableCalendars();
  if (!ev) {
    const def = writable.filter(function (c) {
      return c.primary;
    })[0] || writable[0] || null;
    st.calendarId = def ? def.id : "";
  }
  fillGcalEditorCalendarSelect(st);
  gcalEditorEl("gcalEventModalTitle").textContent =
    ev ? "Edit event" : "New event";
  gcalEditorEl("gcalEvTitleInput").value =
    ev ? ev.summary : "";
  gcalEditorEl("gcalEvLocationInput").value =
    ev ? ev.location : "";
  gcalEditorEl("gcalEvDescInput").value =
    ev ? ev.description : "";
  const allDayInput = gcalEditorEl("gcalEvAllDayInput");
  if (ev && ev.allDay) {
    allDayInput.checked = true;
    gcalEditorEl("gcalEvStartDateInput").value = ev.days[0];
    gcalEditorEl("gcalEvStartTimeInput").value = "09:00";
    gcalEditorEl("gcalEvEndDateInput").value =
      ev.days[ev.days.length - 1];
    gcalEditorEl("gcalEvEndTimeInput").value = "10:00";
  } else if (ev) {
    allDayInput.checked = false;
    gcalEditorEl("gcalEvStartDateInput").value =
      gcalLocalDayStr(new Date(ev.startMs));
    gcalEditorEl("gcalEvStartTimeInput").value =
      gcalTimeInputValue(ev.startMs);
    gcalEditorEl("gcalEvEndDateInput").value =
      gcalLocalDayStr(new Date(ev.endMs));
    gcalEditorEl("gcalEvEndTimeInput").value =
      gcalTimeInputValue(ev.endMs);
  } else {
    allDayInput.checked = false;
    const day = dayStr || gcalLocalDayStr(new Date());
    const timeStr = gcalTimeInputValue(
      gcalNextWholeHour().getTime());
    const startMs = gcalDateTimeMs(day, timeStr);
    const endMs = startMs + 3600000;
    gcalEditorEl("gcalEvStartDateInput").value = day;
    gcalEditorEl("gcalEvStartTimeInput").value = timeStr;
    gcalEditorEl("gcalEvEndDateInput").value =
      gcalLocalDayStr(new Date(endMs));
    gcalEditorEl("gcalEvEndTimeInput").value =
      gcalTimeInputValue(endMs);
  }
  /* The Open in Google Calendar link stands on edit,
     carrying the event's own htmlLink in a new tab. */
  const link = gcalEditorEl("gcalEvOpenLink");
  const linkRow = gcalEditorEl("gcalEvOpenRow");
  if (ev && ev.htmlLink) {
    link.href = ev.htmlLink;
    if (linkRow) { linkRow.classList.remove("hidden"); }
  } else {
    link.removeAttribute("href");
    if (linkRow) { linkRow.classList.add("hidden"); }
  }
  gcalEditorEl("gcalEvDeleteBtn").classList
    .toggle("hidden", !ev);
  /* v2.83: the limited mode is retired. The routing
     at this function's head sends a past event, a
     repeating event, and an event on a read only
     calendar to the event view instead, so an event
     that reaches this point is single, future, and
     writable, and the limited state simply never
     stands; the call below keeps the fields enabled,
     as it always did out of the limited mode. */
  st.limited = false;
  gcalEditorSetLimited(false, "");
  if (ev) {
    /* Editing never moves an event between calendars:
       the select is disabled on edit, in every mode. */
    gcalEditorEl("gcalEvCalendarSelect").disabled = true;
  }
  gcalEditorSyncAllDay();
  /* v2.87: the Repeat controls start at Does not
     repeat for a create and for an edit alike (the
     editor serves single events only; a series is
     never edited here), the weekday chips standing on
     the start date's own weekday. */
  gcalEditorResetRepeat(
    gcalEditorEl("gcalEvStartDateInput").value);
  /* v2.87 Part D: the Notifications section seeds
     with the editor (the event's own overrides, or
     the calendar's defaults under their note). */
  gcalEditorSeedNotifications(ev);
  /* v2.83: the linked notes area: on an edit it lists
     the notes this event is linked to and offers the
     Link a note button; on a create there is no event
     to link yet, so the area stays hidden. */
  const evLinksWrap = gcalEditorEl("gcalEvLinksWrap");
  if (evLinksWrap) {
    evLinksWrap.classList.toggle("hidden", !ev);
  }
  if (ev) {
    fillGcalLinkedChips(gcalEditorEl("gcalEvLinks"), ev,
      function (id) {
        closeGcalEventEditor();
        followNoteLink(id);
      });
  }
  clearGcalEditorError();
  if (!ev && !writable.length) {
    showGcalEditorError(
      "No writable calendar is available.", false);
    const saveBtn = gcalEditorEl("gcalEvSaveBtn");
    if (saveBtn) { saveBtn.disabled = true; }
  } else {
    const saveBtn = gcalEditorEl("gcalEvSaveBtn");
    if (saveBtn) { saveBtn.disabled = false; }
  }
  modal.classList.remove("hidden");
  if (!st.limited) {
    const titleInput = gcalEditorEl("gcalEvTitleInput");
    if (titleInput) { titleInput.focus(); }
  }
}

function closeGcalEventEditor() {
  const modal = gcalEditorEl("gcalEventModal");
  if (modal) { modal.classList.add("hidden"); }
  closeGcalDeleteConfirm();
  gcalEditorState = null;
}

/* ---------------- v2.87: repeating events, creation --
   The editor gains the Repeat control Google
   Calendar's own editor carries: a pattern select
   (Does not repeat, Daily, Weekly, Monthly,
   Annually), a Repeat every interval, weekday chips
   for a weekly pattern, and an Ends group (Never, On
   a date, After a number of occurrences). Saving
   builds the one RRULE and sends it in the payload's
   recurrence through the standing write path, for a
   create and for an edit alike, so a single existing
   event can be given a pattern here. Monthly repeats
   by day of month only in this version; there is no
   "third Tuesday" mode. Editing an existing series
   (its pattern, or one instance of it) stays out of
   scope: a repeating event still opens in the view. */

/* The weekday chips' rule codes in week order, their
   short faces on the chips, and their summary names. */
const GCAL_DAY_CODES = ["SU", "MO", "TU", "WE",
  "TH", "FR", "SA"];
const GCAL_DAY_FACES = ["Su", "Mo", "Tu", "We",
  "Th", "Fr", "Sa"];
const GCAL_DAY_NAMES = ["Sun", "Mon", "Tue", "Wed",
  "Thu", "Fri", "Sat"];

/* Build the seven weekday chips once, on first use:
   toggle buttons in week order. A click (wired with
   the editor's own wiring) toggles its day and marks
   the set as the user's own. */
function ensureGcalRepeatDayChips() {
  const box = gcalEditorEl("gcalEvRepeatDays");
  if (!box || box.children.length) { return; }
  GCAL_DAY_CODES.forEach(function (code, dow) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gcal-ev-day-chip";
    b.setAttribute("data-dow", String(dow));
    b.setAttribute("aria-pressed", "false");
    b.textContent = GCAL_DAY_FACES[dow];
    box.appendChild(b);
  });
}

/* The weekday numbers the chips currently choose, in
   week order. */
function gcalEditorRepeatDays() {
  const box = gcalEditorEl("gcalEvRepeatDays");
  if (!box) { return []; }
  return Array.from(box.querySelectorAll(
    ".gcal-ev-day-chip.active")).map(function (b) {
    return Number(b.getAttribute("data-dow"));
  }).sort(function (a, b) { return a - b; });
}

/* Stand the chips on the given weekday numbers. */
function gcalEditorSetRepeatDays(dows) {
  const box = gcalEditorEl("gcalEvRepeatDays");
  if (!box) { return; }
  box.querySelectorAll(".gcal-ev-day-chip")
    .forEach(function (b) {
      const on = dows.indexOf(
        Number(b.getAttribute("data-dow"))) !== -1;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed",
        on ? "true" : "false");
    });
}

/* Which Ends choice stands: "never", "date", or
   "count". */
function gcalEditorRepeatEndsMode() {
  const on = gcalEditorEl("gcalEvRepeatEndOn");
  const after = gcalEditorEl("gcalEvRepeatEndAfter");
  if (on && on.checked) { return "date"; }
  if (after && after.checked) { return "count"; }
  return "never";
}

/* Each Ends input stands enabled only under its own
   radio, so the standing choice is the only one that
   can be typed into. */
function gcalEditorSyncRepeatEnds() {
  const mode = gcalEditorRepeatEndsMode();
  const dateInput = gcalEditorEl("gcalEvRepeatEndDate");
  const countInput = gcalEditorEl(
    "gcalEvRepeatEndCount");
  if (dateInput) { dateInput.disabled = mode !== "date"; }
  if (countInput) {
    countInput.disabled = mode !== "count";
  }
}

/* The pattern select's effect on the extras: they
   stand only under a pattern, the weekday chips only
   under Weekly, and the interval's unit word names
   the pattern's own unit. */
function gcalEditorSyncRepeat() {
  const sel = gcalEditorEl("gcalEvRepeatSelect");
  const extras = gcalEditorEl("gcalEvRepeatExtras");
  if (!sel || !extras) { return; }
  const freq = sel.value;
  extras.classList.toggle("hidden", freq === "none");
  const daysRow = gcalEditorEl("gcalEvRepeatDaysRow");
  if (daysRow) {
    daysRow.classList.toggle("hidden",
      freq !== "WEEKLY");
  }
  const unit = gcalEditorEl("gcalEvRepeatIntervalUnit");
  if (unit) {
    unit.textContent = freq === "DAILY" ? "days"
      : freq === "WEEKLY" ? "weeks"
      : freq === "MONTHLY" ? "months"
      : freq === "YEARLY" ? "years" : "days";
  }
  gcalEditorSyncRepeatEnds();
}

/* The Repeat controls at the editor's open: Does not
   repeat, every 1, ending Never, ten occurrences
   standing behind their radio, and the weekday chips
   on the start date's own weekday, untaken by hand, so
   they follow the start date until the user picks. */
function gcalEditorResetRepeat(startDayStr) {
  ensureGcalRepeatDayChips();
  const sel = gcalEditorEl("gcalEvRepeatSelect");
  if (sel) { sel.value = "none"; }
  const iv = gcalEditorEl("gcalEvRepeatInterval");
  if (iv) { iv.value = "1"; }
  const never = gcalEditorEl("gcalEvRepeatEndNever");
  if (never) { never.checked = true; }
  const endDate = gcalEditorEl("gcalEvRepeatEndDate");
  if (endDate) { endDate.value = ""; }
  const count = gcalEditorEl("gcalEvRepeatEndCount");
  if (count) { count.value = "10"; }
  if (gcalEditorState) {
    gcalEditorState.repeatDaysTouched = false;
  }
  const p = parseTaskDate(startDayStr);
  const dow = p
    ? new Date(p.y, p.m - 1, p.d).getDay() : 0;
  gcalEditorSetRepeatDays([dow]);
  gcalEditorSyncRepeat();
}

/* A start date change moves the weekday chips with
   it, until the user has picked days by hand. */
function gcalEditorRepeatDaysFollow() {
  const st = gcalEditorState;
  if (!st || st.repeatDaysTouched) { return; }
  const sel = gcalEditorEl("gcalEvRepeatSelect");
  if (!sel || sel.value !== "WEEKLY") { return; }
  const p = parseTaskDate(
    gcalEditorEl("gcalEvStartDateInput").value);
  if (!p) { return; }
  gcalEditorSetRepeatDays(
    [new Date(p.y, p.m - 1, p.d).getDay()]);
}

/* Build the RRULE for the editor's Repeat controls,
   or the validation error that stops the save in the
   editor's own error line rather than sending a bad
   rule: an interval under 1, an occurrences count
   under 1, a missing end date, and an end date before
   the start date. Resolves { rrule } (empty for Does
   not repeat) or { error }. UNTIL is exact: for an
   all day event the chosen end date itself (yyyyMMdd);
   for a timed event that date at the end of its local
   day, as a UTC timestamp (yyyyMMddTHHmmssZ). A
   weekly rule names BYDAY only when the chosen days
   are more than the start weekday alone, which Google
   infers from the event's start. */
function buildGcalRepeatRule(allDay, startDateStr) {
  const sel = gcalEditorEl("gcalEvRepeatSelect");
  const freq = sel ? sel.value : "none";
  if (freq === "none") { return { rrule: "" }; }
  const interval = Math.floor(Number(
    gcalEditorEl("gcalEvRepeatInterval").value));
  if (!isFinite(interval) || interval < 1) {
    return { error: "The repeat interval must be " +
      "at least 1." };
  }
  const parts = ["FREQ=" + freq];
  if (interval > 1) {
    parts.push("INTERVAL=" + interval);
  }
  if (freq === "WEEKLY") {
    const dows = gcalEditorRepeatDays();
    const sp = parseTaskDate(startDateStr);
    const startDow = sp
      ? new Date(sp.y, sp.m - 1, sp.d).getDay() : -1;
    const justStart = dows.length === 1 &&
      dows[0] === startDow;
    if (dows.length && !justStart) {
      parts.push("BYDAY=" + dows.map(function (d) {
        return GCAL_DAY_CODES[d];
      }).join(","));
    }
  }
  const mode = gcalEditorRepeatEndsMode();
  if (mode === "date") {
    const endStr = gcalEditorEl(
      "gcalEvRepeatEndDate").value;
    if (!endStr) {
      return { error: "Enter the date the repeat " +
        "ends on." };
    }
    if (endStr < startDateStr) {
      return { error: "The repeat end date cannot " +
        "be before the start date." };
    }
    if (allDay) {
      parts.push("UNTIL=" + endStr.replace(/-/g, ""));
    } else {
      const p = parseTaskDate(endStr);
      const endMs = new Date(p.y, p.m - 1, p.d,
        23, 59, 59).getTime();
      parts.push("UNTIL=" + new Date(endMs)
        .toISOString().replace(/[-:]/g, "")
        .replace(/\.\d{3}/, ""));
    }
  } else if (mode === "count") {
    const n = Math.floor(Number(
      gcalEditorEl("gcalEvRepeatEndCount").value));
    if (!isFinite(n) || n < 1) {
      return { error: "The number of occurrences " +
        "must be at least 1." };
    }
    parts.push("COUNT=" + n);
  }
  return { rrule: "RRULE:" + parts.join(";") };
}

/* ---------------- v2.87 Part D: event notifications --
   The editor's Notifications section, in Google
   Calendar's own shape: rows of a method select
   (Notification, the API's popup, or Email), an
   amount, and a unit select (minutes, hours, days,
   weeks), a remove button on each row, and an Add
   notification link under them, standing down at
   five rows, the API's override cap. It stands for
   new events and single event edits alike, and so
   covers a new repeating event too, whose reminders
   are the series' own by nature.

   The defaults model is frozen: rows seeded from a
   calendar's own defaultReminders carry a Calendar
   default note, which stands until any row is
   touched. An untouched save sends the reminders
   exactly as the event already had them (on a
   create, useDefault true and no overrides
   invented; on an edit, the event's own reminders
   verbatim). A touched save sends useDefault false
   with the rows as overrides. Switching a create's
   calendar reseeds an untouched section from the
   newly chosen calendar. Amounts ride the API's
   own model, raw minutes before the event's start
   (an all day event's start is its midnight),
   displayed in the largest unit they divide
   exactly. */

/* The unit words and their minutes, and the cap. */
const GCAL_NOTIF_UNIT_MINUTES = { minutes: 1,
  hours: 60, days: 1440, weeks: 10080 };
const GCAL_NOTIF_MAX_ROWS = 5;

/* A calendar's own default reminders, from the
   calendar list the module already holds. */
function gcalCalendarDefaultReminders(calId) {
  const cal = (gcalCalendars || []).filter(
    function (c) { return c.id === calId; })[0];
  if (!cal || !Array.isArray(cal.defaultReminders)) {
    return [];
  }
  return cal.defaultReminders.map(function (r) {
    return { method: r.method, minutes: r.minutes };
  });
}

/* Raw minutes in their display shape: the largest
   unit they divide exactly (weeks, then days, then
   hours), else minutes themselves; zero stands as
   zero minutes. */
function gcalNotifDisplayOf(minutes) {
  const m = Number(minutes) || 0;
  if (m > 0 && m % 10080 === 0) {
    return { amount: m / 10080, unit: "weeks" };
  }
  if (m > 0 && m % 1440 === 0) {
    return { amount: m / 1440, unit: "days" };
  }
  if (m > 0 && m % 60 === 0) {
    return { amount: m / 60, unit: "hours" };
  }
  return { amount: m, unit: "minutes" };
}

/* Raw minutes as plain words, for the view's
   Notifications line: "10 minutes before", "1 day
   before", "0 minutes before". */
function gcalNotifWords(minutes) {
  const d = gcalNotifDisplayOf(minutes);
  const unit = d.amount === 1
    ? d.unit.slice(0, -1) : d.unit;
  return d.amount + " " + unit + " before";
}

/* One Notifications row, in Google's shape. */
function buildGcalNotifRow(reminder) {
  const d = gcalNotifDisplayOf(reminder.minutes);
  const row = document.createElement("div");
  /* v2.88: the line class stands the row's four
     controls on one line (see the CSS beside the
     section's styles); the row class still names
     the row for every behavior that finds it. */
  row.className = "gcal-ev-notif-row gcal-ev-notif-line";
  const method = document.createElement("select");
  method.className = "gcal-ev-notif-method";
  [["popup", "Notification"], ["email", "Email"]]
    .forEach(function (pair) {
      const opt = document.createElement("option");
      opt.value = pair[0];
      opt.textContent = pair[1];
      method.appendChild(opt);
    });
  method.value = reminder.method === "email"
    ? "email" : "popup";
  row.appendChild(method);
  const amount = document.createElement("input");
  amount.type = "number";
  amount.className = "gcal-ev-notif-amount";
  amount.min = "0";
  amount.step = "1";
  amount.value = String(d.amount);
  row.appendChild(amount);
  const unit = document.createElement("select");
  unit.className = "gcal-ev-notif-unit";
  ["minutes", "hours", "days", "weeks"].forEach(
    function (u) {
      const opt = document.createElement("option");
      opt.value = u;
      opt.textContent = u;
      unit.appendChild(opt);
    });
  unit.value = d.unit;
  row.appendChild(unit);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "gcal-ev-notif-remove";
  remove.setAttribute("aria-label",
    "Remove notification");
  remove.textContent = "\u00d7";
  row.appendChild(remove);
  return row;
}

function gcalNotifRowCount() {
  const box = gcalEditorEl("gcalEvNotifRows");
  return box ? box.querySelectorAll(
    ".gcal-ev-notif-row").length : 0;
}

/* The Add notification link stands down at the
   five row cap. */
function gcalEditorSyncNotifAdd() {
  const add = gcalEditorEl("gcalEvNotifAdd");
  if (add) {
    add.classList.toggle("hidden",
      gcalNotifRowCount() >= GCAL_NOTIF_MAX_ROWS);
  }
}

/* Stand the section's rows on a seed list. */
function renderGcalNotifRows(list) {
  const box = gcalEditorEl("gcalEvNotifRows");
  if (!box) { return; }
  box.innerHTML = "";
  (list || []).slice(0, GCAL_NOTIF_MAX_ROWS)
    .forEach(function (r) {
      box.appendChild(buildGcalNotifRow(r));
    });
  gcalEditorSyncNotifAdd();
}

/* The Calendar default note stands while the
   section shows a calendar's own defaults and no
   row has been touched in this open. */
function gcalEditorSyncNotifNote() {
  const note = gcalEditorEl("gcalEvNotifNote");
  const st = gcalEditorState;
  if (!note || !st) { return; }
  note.classList.toggle("hidden",
    !(st.notifFromDefaults && !st.notifTouched));
}

/* The first touch of any row, in any form, drops
   the note and arms the overrides save. */
function gcalEditorNotifTouch() {
  const st = gcalEditorState;
  if (!st) { return; }
  st.notifTouched = true;
  gcalEditorSyncNotifNote();
}

/* Seed the section: an event's own overrides when
   it carries them, a calendar's defaults otherwise
   (the event's calendar on an edit, the chosen one
   on a create), the note standing on the defaults
   path. Runs at the editor's open, and again when
   a create's calendar changes under an untouched
   section. */
function gcalEditorSeedNotifications(ev) {
  const st = gcalEditorState;
  if (!st) { return; }
  st.notifTouched = false;
  st.notifOriginal = ev && ev.reminders ? {
    useDefault: ev.reminders.useDefault,
    overrides: ev.reminders.overrides.map(
      function (r) {
        return { method: r.method,
          minutes: r.minutes };
      })
  } : null;
  let seed, fromDefaults;
  if (ev && ev.reminders &&
      !ev.reminders.useDefault) {
    seed = st.notifOriginal.overrides;
    fromDefaults = false;
  } else {
    const sel = gcalEditorEl("gcalEvCalendarSelect");
    const calId = ev ? ev.calendarId
      : (sel ? sel.value : st.calendarId);
    seed = gcalCalendarDefaultReminders(calId);
    fromDefaults = true;
  }
  st.notifFromDefaults = fromDefaults;
  renderGcalNotifRows(seed);
  gcalEditorSyncNotifNote();
}

/* Read the section at save. Untouched: the
   reminders the event already had (a create takes
   useDefault true, nothing invented). Touched: the
   rows as overrides; an amount that is not a
   non-negative number stops the save here, in the
   editor's own validation pattern, and zero
   minutes is allowed, the notification at the
   event's start. */
function readGcalEditorReminders() {
  const st = gcalEditorState;
  if (!st || !st.notifTouched) {
    if (st && st.mode === "edit" &&
        st.notifOriginal) {
      if (st.notifOriginal.useDefault) {
        return { reminders: { useDefault: true } };
      }
      return { reminders: {
        useDefault: false,
        overrides: st.notifOriginal.overrides.map(
          function (r) {
            return { method: r.method,
              minutes: r.minutes };
          })
      } };
    }
    return { reminders: { useDefault: true } };
  }
  const box = gcalEditorEl("gcalEvNotifRows");
  const rows = box ? box.querySelectorAll(
    ".gcal-ev-notif-row") : [];
  const overrides = [];
  for (let i = 0; i < rows.length; i++) {
    const amountEl = rows[i].querySelector(
      ".gcal-ev-notif-amount");
    const raw = amountEl ? amountEl.value : "";
    const amount = Number(raw);
    if (raw === "" || !isFinite(amount) ||
        amount < 0) {
      return { error: "Enter a number for each " +
        "notification amount." };
    }
    const unitEl = rows[i].querySelector(
      ".gcal-ev-notif-unit");
    const methodEl = rows[i].querySelector(
      ".gcal-ev-notif-method");
    const factor = GCAL_NOTIF_UNIT_MINUTES[
      unitEl ? unitEl.value : "minutes"] || 1;
    overrides.push({
      method: methodEl && methodEl.value === "email"
        ? "email" : "popup",
      minutes: Math.round(amount * factor)
    });
  }
  return { reminders: { useDefault: false,
    overrides: overrides } };
}

/* Read the editor's fields into a create/edit payload,
   or the validation error that stops the save before
   any request is sent: a timed event's end must be
   after its start, an all day event's end date (the
   inclusive last day on the form) must not precede its
   start date, and the form's all day end converts to
   the API's exclusive end (the day after). An empty
   title is allowed: the display falls back to
   (No title), as it does for events made elsewhere. */
function readGcalEditorPayload() {
  const allDay = gcalEditorEl("gcalEvAllDayInput").checked;
  const sd = gcalEditorEl("gcalEvStartDateInput").value;
  const ed = gcalEditorEl("gcalEvEndDateInput").value;
  if (!sd || !ed) {
    return { error: "Enter the event's dates." };
  }
  let start, end;
  if (allDay) {
    if (ed < sd) {
      return { error: "The end date cannot be before " +
        "the start date." };
    }
    start = { date: sd };
    end = { date: gcalShiftDayStr(ed, 1) };
  } else {
    const sMs = gcalDateTimeMs(sd,
      gcalEditorEl("gcalEvStartTimeInput").value || "00:00");
    const eMs = gcalDateTimeMs(ed,
      gcalEditorEl("gcalEvEndTimeInput").value || "00:00");
    if (!(eMs > sMs)) {
      return { error: "The end must be after the start." };
    }
    const tz = Intl.DateTimeFormat().resolvedOptions()
      .timeZone || "UTC";
    start = { dateTime: gcalRfc3339Local(sMs),
      timeZone: tz };
    end = { dateTime: gcalRfc3339Local(eMs),
      timeZone: tz };
  }
  /* v2.87: the Repeat controls settle into the same
     read: a bad rule is a validation error here, a
     good one rides the payload's recurrence, and Does
     not repeat adds nothing at all. */
  const rep = buildGcalRepeatRule(allDay, sd);
  if (rep.error) { return { error: rep.error }; }
  const payload = {
    summary: gcalEditorEl("gcalEvTitleInput").value,
    location: gcalEditorEl("gcalEvLocationInput").value,
    description: gcalEditorEl("gcalEvDescInput").value,
    start: start,
    end: end
  };
  if (rep.rrule) { payload.recurrence = [rep.rrule]; }
  /* v2.87 Part D: the Notifications section settles
     into the same read: an invalid amount is a
     validation error here, and the reminders ride
     the payload in whichever of the section's two
     shapes the touch state names. */
  const nr = readGcalEditorReminders();
  if (nr.error) { return { error: nr.error }; }
  payload.reminders = nr.reminders;
  return { payload: payload };
}

/* A write landed: forget the module's cache and re-ask
   for the visible months, so the surfaces show what
   Google holds now, and say so in the established pill
   toast at the top center. */
function gcalAfterWriteSuccess(word) {
  resetGcalState();
  const keys = Object.keys(gcalVisibleMonths);
  if (!keys.length) {
    const t = taskTodayParts();
    ensureGcalMonth(t.y, t.m);
  } else {
    keys.forEach(function (k) {
      const vm = gcalVisibleMonths[k];
      ensureGcalMonth(vm.y, vm.m);
    });
  }
  toastTopCenter(word === "deleted"
    ? "Event deleted" : "Event saved");
}

/* A failed write settles into the editor's error line,
   the dialog standing open over the fields exactly as
   typed: the write permission line with its Connect
   button for forbidden-write, the could-not-reach line
   (saving again retries) for the rest. */
function gcalSettleWriteFailure(outcome) {
  if (outcome.outcome === "forbidden-write") {
    showGcalEditorError(
      "Google has not granted write permission yet.",
      true);
  } else {
    showGcalEditorError(
      "Could not reach Google Calendar. " +
      "Your entry is still here.", false);
  }
}

async function saveGcalEventEditor() {
  const st = gcalEditorState;
  if (!st || st.limited || st.saving) { return; }
  clearGcalEditorError();
  const read = readGcalEditorPayload();
  if (read.error) {
    showGcalEditorError(read.error, false);
    return;
  }
  const calId = st.mode === "edit" ? st.calendarId
    : gcalEditorEl("gcalEvCalendarSelect").value;
  if (!calId) {
    showGcalEditorError(
      "No writable calendar is available.", false);
    return;
  }
  st.saving = true;
  const saveBtn = gcalEditorEl("gcalEvSaveBtn");
  if (saveBtn) { saveBtn.disabled = true; }
  const path = "/calendars/" +
    encodeURIComponent(calId) + "/events" +
    (st.mode === "edit"
      ? "/" + encodeURIComponent(st.eventId) : "");
  const outcome = await gcalSendWithRenewal(
    st.mode === "edit" ? "PATCH" : "POST", path,
    read.payload);
  st.saving = false;
  if (saveBtn) { saveBtn.disabled = false; }
  if (outcome.outcome === "ok") {
    closeGcalEventEditor();
    gcalAfterWriteSuccess("saved");
    return;
  }
  gcalSettleWriteFailure(outcome);
}

/* The Delete button opens the confirmation over the
   editor; only its own Delete runs the write. */
function deleteGcalEventFromEditor() {
  const st = gcalEditorState;
  if (!st || st.mode !== "edit" || st.limited) { return; }
  /* v2.83: the confirmation's standing target, shared
     with the event view's Delete (see gcalDeleteCtx). */
  gcalDeleteCtx = {
    calendarId: st.calendarId, eventId: st.eventId,
    source: "editor"
  };
  const text = gcalEditorEl("gcalDeleteText");
  if (text) {
    text.textContent = "Delete the event \"" +
      (st.title || "(No title)") +
      "\"? This cannot be undone.";
  }
  const modal = gcalEditorEl("gcalDeleteModal");
  if (modal) { modal.classList.remove("hidden"); }
}

function closeGcalDeleteConfirm() {
  const modal = gcalEditorEl("gcalDeleteModal");
  if (modal) { modal.classList.add("hidden"); }
}

async function confirmGcalEventDelete() {
  /* v2.83: the confirmation serves both surfaces that
     can ask (the editor, and the event view); the
     standing context names the target and the asker,
     and each surface settles its own success and
     failure exactly as it did. With no context standing
     nothing runs, as it was when no editor stood. */
  const ctx = gcalDeleteCtx;
  gcalDeleteCtx = null;
  closeGcalDeleteConfirm();
  if (!ctx) { return; }
  const path = "/calendars/" +
    encodeURIComponent(ctx.calendarId) + "/events/" +
    encodeURIComponent(ctx.eventId);
  if (ctx.source === "view") {
    const vst = gcalViewState;
    if (!vst || vst.deleting) { return; }
    vst.deleting = true;
    const vOutcome = await gcalSendWithRenewal(
      "DELETE", path, null);
    vst.deleting = false;
    if (vOutcome.outcome === "ok") {
      closeGcalEventView();
      gcalAfterWriteSuccess("deleted");
      return;
    }
    toast("Could not delete that event.", true);
    return;
  }
  const st = gcalEditorState;
  if (!st || st.mode !== "edit" || st.deleting) { return; }
  st.deleting = true;
  const outcome = await gcalSendWithRenewal("DELETE",
    path, null);
  st.deleting = false;
  if (outcome.outcome === "ok") {
    closeGcalEventEditor();
    gcalAfterWriteSuccess("deleted");
    return;
  }
  gcalSettleWriteFailure(outcome);
}


/* ---------------- v2.83: links, the event view, and the
   Home Email widget -------------------------------------
   The links release, in Chris's frozen 2026-11-01
   design. Four pieces ride on the calendar and mail
   modules above:

   - Past events. An event is past when its end is not
     after now (an all day event for today is not past,
     and neither is an event still running). Past events
     render faded everywhere they render, and clicking
     one opens the event VIEW below, never the editor.
     The view is also where a repeating event and an
     event on a read only calendar land, at any time:
     the v2.81 editor's limited mode is retired, and the
     editor now serves single, future, writable events
     only. The view holds no input element: its facts
     stand as plain text, and its actions are following
     a linked note, opening the event in Google
     Calendar, and deleting it. Delete stands only for
     a single event on a writable calendar, behind the
     editor's own confirmation; a past event never
     offers Link a note (for a past event the only
     ability is Delete, plus navigation, at Chris's
     word).
   - Note and event links, both directions. Typing "^"
     in a note opens an event picker (the mention
     popup's machinery, a search field, and an Include
     past events checkbox that starts unchecked at
     every open); picking an event inserts an atomic
     event chip into the body and, when the event can
     carry it, writes this note's id into the event's
     private extended properties (the key ssnotes_notes,
     a JSON list of note ids, the app's own scratch
     space on the event that only this app reads).
     From an event, Link a note runs the same write and
     lands the chip in that note. A chip click travels:
     the Calendar surface, the event's month, a direct
     fetch of the event, and then the editor or the
     view by the routing rule above; an event that no
     longer exists answers with a plain toast and the
     note is left untouched. Event data still lives in
     page memory only; the one thing that persists is
     the link itself, as the chip in the note and the
     note id on the event.
   - Tag pills. Typing "#" in a note opens the tag
     picker on the same machinery; picking a tag (or
     the Create row, which names a new one) inserts an
     atomic pill and applies the tag to the note through
     the tags field, so the note files under it at once.
     Removing a pill from the body never untags the
     note; clicking a pill opens the notes list filtered
     by that tag.
   - The Home Email widget, the piece workshopped for
     v2.82.0 that that build's brief left out: an Email
     card for the Home layout, showing the Inbox unread
     count and the latest unread messages, fetched
     through the mail module and held in page memory
     only, like everything mail shaped. */

/* Whether an event is past: its end is not after now.
   The normalized end is the API's own (an all day
   event's exclusive end date at local midnight), so an
   all day event for today and an event still running
   both stand in the future by this measure. */
function gcalEventIsPast(ev) {
  return !!ev && ev.endMs <= Date.now();
}

/* The routing rule: the view takes a past event, a
   repeating event, and an event on a calendar the sign
   in may only read; the editor takes the rest. */
function gcalEventOpensInView(ev) {
  return gcalEventIsPast(ev) || !!ev.recurring ||
    !gcalCalendarIsWritable(ev.calendarId);
}

/* The linked note ids an event carries, from its
   private extended property: a JSON list of note id
   strings, read defensively (anything else is no
   links), capped at fifty. */
function gcalLinkNoteIdsOf(raw) {
  try {
    const priv = raw && raw.extendedProperties &&
      raw.extendedProperties.private;
    const text = priv ? priv.ssnotes_notes : null;
    if (typeof text !== "string" || !text) { return []; }
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) { return []; }
    return parsed.filter(function (x) {
      return typeof x === "string" && !!x;
    }).slice(0, 50);
  } catch (e) { return []; }
}

/* ---------------- the event view -------------------- */

/* The view's standing state: null while it is closed,
   else { ev, deleting }. */
let gcalViewState = null;

/* The view's When line: the day named, then the event's
   own time words (an all day event names its span, its
   last day being the exclusive end's day before). */
function gcalViewWhenText(ev) {
  if (ev.allDay) {
    const first = ev.days[0];
    const last = ev.days[ev.days.length - 1];
    if (first === last) {
      return taskDateLabel(first) + " · All day";
    }
    return taskDateLabel(first) + " - " +
      taskDateLabel(last) + " · All day";
  }
  return taskDateLabel(
    gcalLocalDayStr(new Date(ev.startMs))) + " · " +
    gcalEventTimeLabel(ev);
}

/* v2.87: one line of plain words for an event's
   recurrence, for the view's Repeats row: the pattern
   ("Repeats annually", "Repeats every 2 weeks"), a
   weekly rule's days ("on Mon, Wed"), and its end
   (", ends Dec 31, 2027", ", 10 times"). A rule this
   cannot read returns an empty string, and the view
   then shows no Repeats line at all rather than
   guessing. */
function gcalRepeatsSummary(recurrence) {
  if (!Array.isArray(recurrence)) { return ""; }
  let rule = null;
  for (let i = 0; i < recurrence.length; i++) {
    const s = String(recurrence[i] || "");
    if (s.indexOf("RRULE:") === 0) {
      rule = s.slice(6);
      break;
    }
  }
  if (!rule) { return ""; }
  const kv = {};
  rule.split(";").forEach(function (part) {
    const eq = part.indexOf("=");
    if (eq > 0) {
      kv[part.slice(0, eq).toUpperCase()] =
        part.slice(eq + 1).toUpperCase();
    }
  });
  const units = { DAILY: "days", WEEKLY: "weeks",
    MONTHLY: "months", YEARLY: "years" };
  if (!units[kv.FREQ]) { return ""; }
  const interval = kv.INTERVAL
    ? Number(kv.INTERVAL) : 1;
  if (!isFinite(interval) || interval < 1 ||
      Math.floor(interval) !== interval) {
    return "";
  }
  let text;
  if (interval === 1) {
    text = "Repeats " + { DAILY: "daily",
      WEEKLY: "weekly", MONTHLY: "monthly",
      YEARLY: "annually" }[kv.FREQ];
  } else {
    text = "Repeats every " + interval + " " +
      units[kv.FREQ];
  }
  if (kv.FREQ === "WEEKLY" && kv.BYDAY) {
    const found = [];
    const codes = kv.BYDAY.split(",");
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i].replace(/^[+-]?\d+/, "");
      const idx = GCAL_DAY_CODES.indexOf(code);
      if (idx === -1) { return ""; }
      found.push(idx);
    }
    found.sort(function (a, b) { return a - b; });
    text += " on " + found.map(function (idx) {
      return GCAL_DAY_NAMES[idx];
    }).join(", ");
  }
  if (kv.UNTIL) {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(kv.UNTIL);
    if (!m) { return ""; }
    const d = new Date(Number(m[1]),
      Number(m[2]) - 1, Number(m[3]));
    text += ", ends " + d.toLocaleDateString(
      undefined, { month: "short", day: "numeric",
        year: "numeric" });
  } else if (kv.COUNT) {
    const n = Number(kv.COUNT);
    if (!isFinite(n) || n < 1) { return ""; }
    text += ", " + n + (n === 1 ? " time" : " times");
  }
  return text;
}

/* Stand the view's Notifications line on the
   event's effective reminders: its overrides when
   it carries them, else its calendar's defaults
   under a calendar default marker. An event with
   neither shows no line. */
function fillGcalViewNotifications(ev) {
  const row = document.getElementById(
    "gcalViewNotifRow");
  const el = document.getElementById("gcalViewNotif");
  if (!row || !el) { return; }
  let list = [], marker = false;
  if (ev.reminders && !ev.reminders.useDefault &&
      ev.reminders.overrides.length) {
    list = ev.reminders.overrides;
  } else if (!ev.reminders || ev.reminders.useDefault) {
    list = gcalCalendarDefaultReminders(
      ev.calendarId);
    marker = list.length > 0;
  }
  if (!list.length) {
    el.textContent = "";
    row.classList.add("hidden");
    return;
  }
  el.textContent = list.map(function (r) {
    return (r.method === "email"
      ? "Email" : "Notification") + " " +
      gcalNotifWords(r.minutes);
  }).join(", ") + (marker
    ? " (calendar default)" : "");
  row.classList.remove("hidden");
}

/* Stand the view's Repeats row on the event's rule,
   or hide it when the rule says nothing this can
   read. */
function fillGcalViewRepeats(ev) {
  const row = document.getElementById(
    "gcalViewRepeatsRow");
  const el = document.getElementById("gcalViewRepeats");
  if (!row || !el) { return; }
  const text = ev
    ? gcalRepeatsSummary(ev.recurrence) : "";
  el.textContent = text;
  row.classList.toggle("hidden", !text);
}

/* Fill a linked notes chip row (the editor's and the
   view's share this): one chip per linked note, its
   current title resolved from the store; a note that
   exists nowhere renders as the muted line. Following
   a chip is the caller's closer plus followNoteLink. */
function fillGcalLinkedChips(box, ev, onFollow) {
  if (!box) { return; }
  box.innerHTML = "";
  (ev.linkNoteIds || []).forEach(function (id) {
    const note = findNoteById(id);
    if (!note) {
      const gone = document.createElement("span");
      gone.className = "gcal-linked-gone";
      gone.textContent = "A note that no longer exists";
      box.appendChild(gone);
      return;
    }
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "gcal-linked-chip";
    chip.setAttribute("data-note-id", id);
    chip.textContent = note.title || "Untitled note";
    chip.addEventListener("click", function () {
      onFollow(id);
    });
    box.appendChild(chip);
  });
}

/* Open the event view on an event: every fact as text,
   its linked notes, the Open in Google Calendar link,
   and Delete standing only under the rule in this
   section's header. */
function openGcalEventView(ev) {
  const modal = document.getElementById("gcalViewModal");
  if (!modal || !ev) { return; }
  gcalViewState = { ev: ev, deleting: false };
  document.getElementById("gcalViewTitle").textContent =
    ev.title;
  const calEl = document.getElementById("gcalViewCalendar");
  calEl.innerHTML = "";
  const dot = document.createElement("span");
  dot.className = "gcal-chip";
  dot.setAttribute("aria-hidden", "true");
  if (ev.color) { dot.style.backgroundColor = ev.color; }
  calEl.appendChild(dot);
  calEl.appendChild(document.createTextNode(
    ev.calendarName || ""));
  document.getElementById("gcalViewWhen").textContent =
    gcalViewWhenText(ev);
  /* v2.87: the Repeats line. A record that carries
     its own rule (the master, or an event fetched
     whole) fills it at once; an expanded instance
     carries none, so its master is fetched directly
     and the line fills when that lands, the view
     still standing on this event (a failed fetch
     simply leaves the line out). */
  fillGcalViewRepeats(ev);
  fillGcalViewNotifications(ev);
  if (ev.recurring && !ev.recurrence && ev.masterId &&
      ev.masterId !== ev.id) {
    const viewEv = ev;
    gcalFetchEventById(ev.calendarId, ev.masterId)
      .then(function (got) {
        if (!gcalViewState ||
            gcalViewState.ev !== viewEv) { return; }
        if (got.outcome === "ok" && got.ev &&
            got.ev.recurrence) {
          viewEv.recurrence = got.ev.recurrence;
          fillGcalViewRepeats(viewEv);
        }
      }).catch(function () { /* the line stays out */ });
  }
  const locRow = document.getElementById(
    "gcalViewLocationRow");
  if (ev.location) {
    document.getElementById("gcalViewLocation")
      .textContent = ev.location;
    locRow.classList.remove("hidden");
  } else {
    locRow.classList.add("hidden");
  }
  const descRow = document.getElementById("gcalViewDescRow");
  if (ev.description) {
    document.getElementById("gcalViewDesc")
      .textContent = ev.description;
    descRow.classList.remove("hidden");
  } else {
    descRow.classList.add("hidden");
  }
  fillGcalLinkedChips(
    document.getElementById("gcalViewLinks"), ev,
    function (id) {
      closeGcalEventView();
      followNoteLink(id);
    });
  const past = gcalEventIsPast(ev);
  const linkBtn = document.getElementById(
    "gcalViewLinkNoteBtn");
  if (linkBtn) {
    linkBtn.classList.toggle("hidden", past);
  }
  const wrap = document.getElementById("gcalViewLinksWrap");
  if (wrap) {
    wrap.classList.toggle("hidden",
      past && !(ev.linkNoteIds && ev.linkNoteIds.length));
  }
  const openRow = document.getElementById("gcalViewOpenRow");
  const openLink = document.getElementById("gcalViewOpenLink");
  if (ev.htmlLink) {
    openLink.href = ev.htmlLink;
    openRow.classList.remove("hidden");
  } else {
    openLink.removeAttribute("href");
    openRow.classList.add("hidden");
  }
  const del = document.getElementById("gcalViewDeleteBtn");
  if (del) {
    del.classList.toggle("hidden",
      !(!ev.recurring &&
        gcalCalendarIsWritable(ev.calendarId)));
  }
  /* v2.87: Delete series stands for a repeating event
     on a writable calendar, and nowhere else. */
  const delSeries = document.getElementById(
    "gcalViewDeleteSeriesBtn");
  if (delSeries) {
    delSeries.classList.toggle("hidden",
      !(ev.recurring &&
        gcalCalendarIsWritable(ev.calendarId)));
  }
  modal.classList.remove("hidden");
}

function closeGcalEventView() {
  const modal = document.getElementById("gcalViewModal");
  if (modal) { modal.classList.add("hidden"); }
  gcalViewState = null;
}

/* ---------------- linking notes and events ---------- */

/* The delete confirmation's standing target, set by
   whichever surface asks (the editor, or the view):
   { calendarId, eventId, source }. The confirmation
   and its outcomes read it, so both surfaces delete
   under the one dialog and the one success path. */
let gcalDeleteCtx = null;

/* The view's Delete button: the editor's confirmation,
   naming the event, over the view. */
function deleteGcalEventFromView() {
  const st = gcalViewState;
  if (!st || st.deleting) { return; }
  if (st.ev.recurring ||
      !gcalCalendarIsWritable(st.ev.calendarId)) { return; }
  gcalDeleteCtx = {
    calendarId: st.ev.calendarId, eventId: st.ev.id,
    source: "view"
  };
  const text = document.getElementById("gcalDeleteText");
  if (text) {
    text.textContent = "Delete the event \"" +
      (st.ev.title || "(No title)") +
      "\"? This cannot be undone.";
  }
  const modal = document.getElementById("gcalDeleteModal");
  if (modal) { modal.classList.remove("hidden"); }
}

/* The view's Delete series button: the shared delete
   confirmation, naming the event and saying plainly
   that every occurrence of the series will be
   deleted. The write targets the series' master
   record: deleting an expanded instance would remove
   only that one occurrence in the API's eyes, while
   the master takes the whole series with it. The
   shared confirmation's view branch then settles the
   outcome exactly as a single delete from the view
   does (the view closes, the caches forget, the
   deleted toast stands). */
function deleteGcalSeriesFromView() {
  const st = gcalViewState;
  if (!st || st.deleting) { return; }
  if (!st.ev.recurring ||
      !gcalCalendarIsWritable(st.ev.calendarId)) {
    return;
  }
  gcalDeleteCtx = {
    calendarId: st.ev.calendarId,
    eventId: st.ev.masterId || st.ev.id,
    source: "view"
  };
  const text = document.getElementById("gcalDeleteText");
  if (text) {
    text.textContent = "Delete the series \"" +
      (st.ev.title || "(No title)") +
      "\"? Every occurrence of this repeating " +
      "event will be deleted. This cannot be undone.";
  }
  const modal = document.getElementById(
    "gcalDeleteModal");
  if (modal) { modal.classList.remove("hidden"); }
}

/* Write a note's id onto an event's private extended
   property (the backlink), through the calendar write
   transport beside every other event write. Resolves
   "ok" (the property stands, the id appended without
   duplicating, the oldest dropped past fifty), "skipped"
   (a repeating event, or a calendar the sign in may
   only read: the event cannot carry the property), or
   "failed" (the write was refused or unreachable).
   The event's own record of its links moves with an ok. */
async function gcalAddNoteLinkToEvent(ev, noteId) {
  if (!ev || ev.recurring ||
      !gcalCalendarIsWritable(ev.calendarId)) {
    return "skipped";
  }
  const ids = (ev.linkNoteIds || []).slice();
  if (ids.indexOf(noteId) !== -1) { return "ok"; }
  ids.push(noteId);
  while (ids.length > 50) { ids.shift(); }
  const body = {
    extendedProperties: {
      private: { ssnotes_notes: JSON.stringify(ids) }
    }
  };
  const outcome = await gcalSendWithRenewal("PATCH",
    "/calendars/" + encodeURIComponent(ev.calendarId) +
      "/events/" + encodeURIComponent(ev.id), body);
  if (outcome.outcome === "ok") {
    ev.linkNoteIds = ids;
    return "ok";
  }
  return "failed";
}

/* One event fetched directly, by its calendar and id
   (a chip click's ask, independent of the month
   caches), settled into outcomes: "ok" with the
   normalized event, "gone" (a 404, or an answer that
   does not stand as an event), or "bad". The 401 runs
   the standing silent renewal once and retries once,
   like every other calendar read. */
async function gcalFetchEventById(calId, eventId) {
  await gcalEnsureCalendarList();
  let token = null;
  try { token = await getGoogleAccessToken(); }
  catch (e) { return { outcome: "bad", ev: null }; }
  const path = "/calendars/" + encodeURIComponent(calId) +
    "/events/" + encodeURIComponent(eventId);
  let res = null;
  try {
    res = await gcalApiGet(path, token);
    if (res.status === 401) {
      const renewed = await googleTrySilentSignIn();
      if (renewed) {
        const fresh = await getProviderToken("google");
        if (fresh) {
          res = await gcalApiGet(path, fresh);
        }
      }
    }
  } catch (e) { return { outcome: "bad", ev: null }; }
  if (res && res.status === 404) {
    return { outcome: "gone", ev: null };
  }
  if (!res || res.status !== 200 || !res.data) {
    return { outcome: "bad", ev: null };
  }
  const cal = (gcalCalendars || []).filter(function (c) {
    return c.id === calId;
  })[0] || {
    id: calId, summary: "", color: "",
    accessRole: "", primary: false
  };
  const ev = normalizeGcalEvent(res.data, cal);
  if (!ev) { return { outcome: "gone", ev: null }; }
  return { outcome: "ok", ev: ev };
}

/* An event chip's short face words: the day, then the
   time of day (or All day). The chip's face and the
   event picker's rows share these. */
function eventChipWhenLabel(ev) {
  const day = new Date(ev.startMs).toLocaleDateString(
    undefined, { month: "short", day: "numeric" });
  if (ev.allDay) { return day + ", All day"; }
  return day + ", " + gcalTimeOfDayLabel(ev.startMs);
}

/* Build an event chip: an atomic island in the note
   body (contenteditable false), carrying the calendar
   id, the event id, and the event's start as its data;
   its face is the calendar's color dot, the title, and
   the short day and time. The data is the link; the
   face is only what the note knew when it was made. */
function buildEventChipEl(ev) {
  const chip = document.createElement("span");
  chip.className = "ss-event-chip";
  chip.setAttribute("contenteditable", "false");
  chip.setAttribute("data-ss-event-cal", ev.calendarId);
  chip.setAttribute("data-ss-event-id", ev.id);
  chip.setAttribute("data-ss-event-start",
    new Date(ev.startMs).toISOString());
  chip.title = ev.title;
  const dot = document.createElement("span");
  dot.className = "ss-event-chip-dot";
  dot.setAttribute("aria-hidden", "true");
  if (ev.color) { dot.style.backgroundColor = ev.color; }
  chip.appendChild(dot);
  const label = document.createElement("span");
  label.className = "ss-event-chip-label";
  label.textContent = ev.title + " · " +
    eventChipWhenLabel(ev);
  chip.appendChild(label);
  return chip;
}

/* The chip as a paragraph of body HTML, for the path
   that lands a chip in a note that is not open (built
   as elements, serialized once, the codebase's string
   free construction rule kept). */
function eventChipParagraphHtml(ev) {
  const wrap = document.createElement("div");
  const p = document.createElement("p");
  p.appendChild(buildEventChipEl(ev));
  wrap.appendChild(p);
  return wrap.innerHTML;
}

/* Land an event chip in a note, from an event surface's
   Link a note: into the live editor at the caret when
   the note stands open there (appended at the end when
   the caret is not in the body), otherwise appended as
   a closing paragraph through the note's normal load
   and save path. */
async function addEventChipToNote(note, ev) {
  const open = currentNote();
  const bodyEl = document.getElementById("noteBody");
  if (open && open.id === note.id && bodyEl) {
    const sel = window.getSelection();
    let placed = false;
    if (sel && sel.rangeCount) {
      const range = sel.getRangeAt(0);
      if (bodyEl.contains(range.commonAncestorContainer)) {
        const chip = buildEventChipEl(ev);
        range.deleteContents();
        range.insertNode(chip);
        const space = document.createTextNode(" ");
        chip.after(space);
        placeCaretIn(space, 1);
        placed = true;
      }
    }
    if (!placed) {
      const p = document.createElement("p");
      p.appendChild(buildEventChipEl(ev));
      bodyEl.appendChild(p);
    }
    markDirty();
    return;
  }
  note.body = (note.body || "") + eventChipParagraphHtml(ev);
  try {
    await saveNoteToRepo(note);
    saveCache();
    renderNoteList();
  } catch (e) {
    toast("The event link could not be added to that " +
      "note: " + e.message, true);
  }
}

/* The Link a note context: the event surface (the
   editor, or the view) that opened the note picker, and
   its event. closeNoteLinkPicker clears it, so a
   cancelled pick can never leak into a later insert. */
let gcalNoteLinkCtx = null;

function openGcalLinkNotePicker(ev, surface) {
  if (!ev) { return; }
  gcalNoteLinkCtx = { ev: ev, surface: surface };
  noteLinkRetargetAnchor = null;
  noteLinkPending = null;
  const search = document.getElementById("noteLinkSearch");
  search.value = "";
  renderNoteLinkResults("");
  document.getElementById("noteLinkModal")
    .classList.remove("hidden");
  search.focus();
}

/* A pick in the event link mode: the chip lands in the
   chosen note, the backlink is written onto the event,
   and a backlink that could not be saved (skipped or
   failed alike) is said plainly. The surface that asked
   re-reads the event's links when it still stands. */
async function gcalPickEventNote(target) {
  const ctx = gcalNoteLinkCtx;
  gcalNoteLinkCtx = null;
  closeNoteLinkPicker();
  if (!ctx || !ctx.ev) { return; }
  const ev = ctx.ev;
  await addEventChipToNote(target, ev);
  const res = await gcalAddNoteLinkToEvent(ev, target.id);
  if (res !== "ok") {
    toast("The backlink could not be saved to the " +
      "event.", true);
  }
  if (ctx.surface === "editor" && gcalEditorState &&
      gcalEditorState.ev === ev) {
    fillGcalLinkedChips(
      document.getElementById("gcalEvLinks"), ev,
      function (id) {
        closeGcalEventEditor();
        followNoteLink(id);
      });
  }
  if (ctx.surface === "view" && gcalViewState &&
      gcalViewState.ev === ev) {
    openGcalEventView(ev);
  }
}

/* Follow an event chip (a click in a note body): travel
   to the Calendar surface standing on the event's
   month, fetch the event directly, and open it by the
   routing rule. A gone event is a plain toast, and the
   note is left exactly as it stands. */
async function followEventChip(chip) {
  const calId = chip.getAttribute("data-ss-event-cal") || "";
  const eventId = chip.getAttribute("data-ss-event-id") || "";
  const startIso = chip.getAttribute(
    "data-ss-event-start") || "";
  if (!calId || !eventId) { return; }
  const startMs = Date.parse(startIso);
  state.view = { kind: "tasks", value: null };
  state.tasksView.mode = "calendar";
  if (isFinite(startMs)) {
    const d = new Date(startMs);
    state.tasksView.calCursor = {
      y: d.getFullYear(), m: d.getMonth() + 1
    };
    state.tasksView.calSelected = gcalLocalDayStr(d);
  }
  renderAll();
  setMobileView("list");
  const got = await gcalFetchEventById(calId, eventId);
  if (got.outcome === "gone") {
    toast("That event no longer exists");
    return;
  }
  if (got.outcome !== "ok") {
    toast("Could not load that event.", true);
    return;
  }
  openGcalEventEditor(got.ev, got.ev.days[0]);
}

/* Open the notes list filtered by a tag (a tag pill's
   click): the tag view the sidebar's own rows open. */
function openTagFilter(tag) {
  if (!tag) { return; }
  state.view = { kind: "tag", value: tag };
  renderAll();
  setMobileView("list");
}

/* ---------------- the "^" event picker -------------- */

/* Search and list events for the picker, across every
   participating calendar: the window is now through
   sixty days out, widened to a year back when past
   events are included (the API's timeMin bounds an
   event's end, so the default window holds exactly the
   events that are not past, in progress ones included).
   A typed query rides the API's q parameter. Merged,
   ordered by start, capped at fifty. Outcomes mirror
   the read loader's: "ok", "consent" (a 403), or "bad". */
async function gcalSearchEvents(query, includePast) {
  if (!gcalSignedInAble()) {
    return { outcome: "bad", events: [] };
  }
  await gcalEnsureCalendarList();
  if (!gcalCalendars) {
    return { outcome: "bad", events: [] };
  }
  let token = null;
  try { token = await getGoogleAccessToken(); }
  catch (e) { return { outcome: "bad", events: [] }; }
  const nowMs = Date.now();
  const timeMin = new Date(includePast
    ? nowMs - 365 * 86400000 : nowMs).toISOString();
  const timeMax = new Date(
    nowMs + 60 * 86400000).toISOString();
  async function attempt(tok) {
    let saw401 = false, saw403 = false, sawBad = false;
    const collected = [];
    await Promise.all(gcalCalendars.map(function (cal) {
      let path = "/calendars/" +
        encodeURIComponent(cal.id) +
        "/events?singleEvents=true&orderBy=startTime" +
        "&maxResults=250" +
        "&timeMin=" + encodeURIComponent(timeMin) +
        "&timeMax=" + encodeURIComponent(timeMax);
      if (query) {
        path += "&q=" + encodeURIComponent(query);
      }
      return gcalApiGet(path, tok).then(function (res) {
        if (res.status === 401) { saw401 = true; return; }
        if (res.status === 403) { saw403 = true; return; }
        if (res.status !== 200 || !res.data) {
          sawBad = true; return;
        }
        const items = Array.isArray(res.data.items)
          ? res.data.items : [];
        items.forEach(function (raw) {
          const ev = normalizeGcalEvent(raw, cal);
          if (ev) { collected.push(ev); }
        });
      }).catch(function () { sawBad = true; });
    }));
    return {
      saw401: saw401, saw403: saw403, sawBad: sawBad,
      collected: collected
    };
  }
  let r = await attempt(token);
  if (r.saw401) {
    const renewed = await googleTrySilentSignIn();
    if (renewed) {
      const fresh = await getProviderToken("google");
      if (fresh) { r = await attempt(fresh); }
    }
  }
  if (r.saw403) { return { outcome: "consent", events: [] }; }
  if (r.saw401 || r.sawBad) {
    return { outcome: "bad", events: [] };
  }
  r.collected.sort(function (a, b) {
    return a.startMs - b.startMs;
  });
  return {
    outcome: "ok", events: r.collected.slice(0, 50)
  };
}

/* The picker's standing state, the mention popup's
   shape: the tracked "^" token, the rows (normalized
   events), the highlight, the search box's own query
   once it drives (null while the token drives), the
   last caret range, the load state ("", "loading",
   "consent", "bad"), and the run counter that keeps a
   stale answer from overwriting a newer ask. */
let eventLinkTrigger = null;
let eventLinkRows = [];
let eventLinkHighlight = 0;
let eventLinkBoxQuery = null;
let eventLinkListEl = null;
let eventLinkLastRange = null;
let eventLinkStatus = "";
let eventLinkRunId = 0;
let eventLinkSearchTimer = null;
let eventLinkLastQuery = null;

function eventLinkPopupOpen() {
  const popup = document.getElementById("eventLinkPopup");
  return !!popup && !popup.classList.contains("hidden");
}

function closeEventLinkPopup() {
  const popup = document.getElementById("eventLinkPopup");
  if (popup) { popup.classList.add("hidden"); }
  eventLinkTrigger = null;
  eventLinkRows = [];
  eventLinkHighlight = 0;
  eventLinkBoxQuery = null;
  eventLinkLastRange = null;
  eventLinkStatus = "";
  eventLinkLastQuery = null;
  eventLinkRunId++;
  if (eventLinkSearchTimer) {
    clearTimeout(eventLinkSearchTimer);
    eventLinkSearchTimer = null;
  }
  const searchEl = document.getElementById(
    "eventLinkSearch");
  if (searchEl) { searchEl.value = ""; }
}

function eventLinkEffectiveQuery() {
  if (eventLinkBoxQuery !== null) {
    return eventLinkBoxQuery;
  }
  return eventLinkTrigger ? eventLinkTrigger.query : "";
}

function eventLinkPastChecked() {
  const box = document.getElementById("eventLinkPastInput");
  return !!(box && box.checked);
}

/* The picker's fixed chrome, built once like the
   mention popup's: the search box, the Include past
   events checkbox under it (themed, and reset to
   unchecked at every open by the tracker), the Events
   header, and the list container. Only the rows are
   rebuilt per render. */
function ensureEventLinkChrome(popup) {
  if (eventLinkListEl && popup.contains(eventLinkListEl)) {
    return;
  }
  popup.innerHTML = "";
  const searchWrap = document.createElement("div");
  searchWrap.className = "mention-search";
  const input = document.createElement("input");
  input.type = "text";
  input.id = "eventLinkSearch";
  input.placeholder = "Search events";
  input.setAttribute("aria-label", "Search events");
  input.setAttribute("autocomplete", "off");
  input.addEventListener("input", onEventLinkSearchInput);
  searchWrap.appendChild(input);
  popup.appendChild(searchWrap);
  const pastRow = document.createElement("label");
  pastRow.className = "event-link-past";
  const pastBox = document.createElement("input");
  pastBox.type = "checkbox";
  pastBox.id = "eventLinkPastInput";
  pastBox.addEventListener("change", function () {
    runEventLinkSearch();
  });
  pastRow.appendChild(pastBox);
  const pastText = document.createElement("span");
  pastText.textContent = "Include past events";
  pastRow.appendChild(pastText);
  popup.appendChild(pastRow);
  const head = document.createElement("div");
  head.className = "mention-head";
  head.textContent = "Events";
  popup.appendChild(head);
  eventLinkListEl = document.createElement("div");
  eventLinkListEl.className = "mention-list";
  popup.appendChild(eventLinkListEl);
}

/* Typing in the picker's search box drives the same
   search the token drives (debounced, since every ask
   is an API round trip); the token, and so the
   insertion point, is untouched. */
function onEventLinkSearchInput() {
  const input = document.getElementById("eventLinkSearch");
  if (!input) { return; }
  eventLinkBoxQuery = input.value;
  scheduleEventLinkSearch();
}

function scheduleEventLinkSearch() {
  if (eventLinkSearchTimer) {
    clearTimeout(eventLinkSearchTimer);
  }
  eventLinkSearchTimer = setTimeout(function () {
    eventLinkSearchTimer = null;
    runEventLinkSearch();
  }, 200);
}

/* Ask for the standing query and paint what comes back,
   unless a newer ask has superseded this one or the
   popup has closed meanwhile. */
function runEventLinkSearch() {
  const query = eventLinkEffectiveQuery();
  const includePast = eventLinkPastChecked();
  const run = ++eventLinkRunId;
  eventLinkStatus = "loading";
  eventLinkRows = [];
  renderEventLinkPopup(null);
  gcalSearchEvents(query, includePast)
    .then(function (out) {
      if (run !== eventLinkRunId ||
          !eventLinkPopupOpen()) { return; }
      if (out.outcome === "ok") {
        eventLinkStatus = "";
        eventLinkRows = out.events;
      } else {
        eventLinkStatus = out.outcome;
        eventLinkRows = [];
      }
      eventLinkHighlight = 0;
      renderEventLinkPopup(null);
    });
}

/* The token both editor popups in this release share:
   the caret's text node in a live, unlocked note body,
   outside any code block, link, attachment, or island.
   Null everywhere else, which closes the popups.
   v2.105.0: the Scratch Pad is a host too (surface
   "scratch", its element the pad): the same caret
   rule, the same island exclusions, and no note
   standing behind it at all, which the picks read off
   the trigger's surface. */
function linkPopupHost() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) { return null; }
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (!range.collapsed || !node || node.nodeType !== 3) {
    return null;
  }
  const host = node.parentElement;
  if (!host || (host.closest && host.closest(
    "pre, a, .ss-attachment, .ss-event-chip, " +
    ".ss-tag-pill, .ss-mail-chip"))) {
    return null;
  }
  const padEl = document.getElementById("homeScratchText");
  if (padEl && padEl.contains(node)) {
    return { range: range, node: node, el: padEl,
      surface: "scratch" };
  }
  const bodyEl = document.getElementById("noteBody");
  const note = currentNote();
  if (!note || note.trashed || note.archived || !bodyEl ||
      bodyEl.contentEditable === "false") {
    return null;
  }
  if (!bodyEl.contains(node)) { return null; }
  return { range: range, node: node, el: bodyEl,
    surface: "note" };
}

/* The token under the caret for one trigger character,
   the mention popup's rule: the character at the start
   of its text node or after whitespace, and the query
   the run of non-whitespace characters to the caret. */
function linkTokenAt(node, caretOffset, ch) {
  const before = node.nodeValue.slice(0, caretOffset);
  const at = before.lastIndexOf(ch);
  if (at < 0) { return null; }
  if (at > 0 && !/\s/.test(before.charAt(at - 1))) {
    return null;
  }
  const query = before.slice(at + 1);
  if (/\s/.test(query)) { return null; }
  return {
    node: node, atOffset: at, caretOffset: caretOffset,
    query: query
  };
}

/* Park a fixed popup under the caret's line, the
   mention popup's placement (flipped above the line
   near the window's bottom). */
function positionLinkPopup(popup, range) {
  if (!popup || !range) { return; }
  let rect = null;
  if (typeof range.getBoundingClientRect === "function") {
    rect = range.getBoundingClientRect();
  }
  if (!rect) {
    const bodyEl = document.getElementById("noteBody");
    if (!bodyEl) { return; }
    rect = bodyEl.getBoundingClientRect();
  }
  const width = popup.offsetWidth;
  const height = popup.offsetHeight;
  let left = Math.min(rect.left,
    window.innerWidth - width - 8);
  left = Math.max(8, left);
  let top = rect.bottom + 6;
  if (top + height > window.innerHeight - 8) {
    top = Math.max(8, rect.top - height - 6);
  }
  popup.style.left = left + "px";
  popup.style.top = top + "px";
}

/* The event picker's tracker, on the mention popup's
   wiring: typing, deleting, and caret moves re-evaluate
   the "^" token; while the picker's search box holds
   focus it stands down, as the mention tracker does. A
   fresh token resets the filter to the token, restarts
   the highlight, unchecks Include past events (it
   starts unchecked at every open), and asks at once; a
   changed query on a standing token asks debounced. */
function updateEventLinkPopup() {
  const popup = document.getElementById("eventLinkPopup");
  if (!popup) { return; }
  const searchEl = document.getElementById(
    "eventLinkSearch");
  if (eventLinkPopupOpen() && searchEl &&
      document.activeElement === searchEl) {
    return;
  }
  const host = linkPopupHost();
  if (!host) { closeEventLinkPopup(); return; }
  const tok = linkTokenAt(host.node,
    host.range.startOffset, "^");
  if (!tok) { closeEventLinkPopup(); return; }
  tok.el = host.el;
  tok.surface = host.surface;
  const fresh = !eventLinkTrigger ||
    eventLinkTrigger.node !== tok.node ||
    eventLinkTrigger.atOffset !== tok.atOffset;
  eventLinkTrigger = tok;
  eventLinkLastRange = host.range;
  if (fresh) {
    ensureEventLinkChrome(popup);
    eventLinkBoxQuery = null;
    eventLinkHighlight = 0;
    eventLinkLastQuery = tok.query;
    const pastBox = document.getElementById(
      "eventLinkPastInput");
    if (pastBox) { pastBox.checked = false; }
    runEventLinkSearch();
    return;
  }
  if (tok.query !== eventLinkLastQuery) {
    eventLinkLastQuery = tok.query;
    eventLinkBoxQuery = null;
    scheduleEventLinkSearch();
  }
  renderEventLinkPopup(host.range);
}

function eventLinkStatusEl(text) {
  const el = document.createElement("div");
  el.className = "event-link-status";
  el.textContent = text;
  return el;
}

function renderEventLinkPopup(range) {
  const popup = document.getElementById("eventLinkPopup");
  if (!popup) { return; }
  ensureEventLinkChrome(popup);
  if (range) { eventLinkLastRange = range; }
  const searchEl = document.getElementById(
    "eventLinkSearch");
  if (searchEl && document.activeElement !== searchEl) {
    searchEl.value = eventLinkEffectiveQuery();
  }
  const list = eventLinkListEl;
  list.innerHTML = "";
  if (eventLinkStatus === "loading") {
    list.appendChild(eventLinkStatusEl("Loading events..."));
  } else if (eventLinkStatus === "consent") {
    list.appendChild(eventLinkStatusEl(
      "Google Calendar is not connected"));
  } else if (eventLinkStatus === "bad") {
    list.appendChild(eventLinkStatusEl(
      "Google Calendar unavailable"));
  } else if (!eventLinkRows.length) {
    list.appendChild(eventLinkStatusEl("No events found"));
  } else {
    eventLinkRows.forEach(function (ev, i) {
      const past = gcalEventIsPast(ev);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mention-row event-link-row" +
        (past ? " gcal-past" : "");
      btn.setAttribute("data-ei", String(i));
      btn.setAttribute("role", "option");
      const main = document.createElement("span");
      main.className = "event-link-row-main";
      const dot = document.createElement("span");
      dot.className = "ss-event-chip-dot";
      dot.setAttribute("aria-hidden", "true");
      if (ev.color) {
        dot.style.backgroundColor = ev.color;
      }
      main.appendChild(dot);
      const texts = document.createElement("span");
      texts.className = "mention-texts";
      const line1 = document.createElement("span");
      line1.className = "mention-title";
      line1.textContent = ev.title;
      const line2 = document.createElement("span");
      line2.className = "mention-nb";
      line2.textContent = eventChipWhenLabel(ev) +
        (ev.calendarName ? " · " + ev.calendarName : "");
      texts.appendChild(line1);
      texts.appendChild(line2);
      main.appendChild(texts);
      btn.appendChild(main);
      if (past) {
        const flag = document.createElement("span");
        flag.className = "event-link-past-label";
        flag.textContent = "Past Event";
        btn.appendChild(flag);
      }
      list.appendChild(btn);
    });
  }
  popup.classList.remove("hidden");
  setEventLinkHighlight(eventLinkHighlight);
  positionLinkPopup(popup, range || eventLinkLastRange);
}

function setEventLinkHighlight(i) {
  const popup = document.getElementById("eventLinkPopup");
  if (!popup || !eventLinkRows.length) { return; }
  eventLinkHighlight =
    ((i % eventLinkRows.length) + eventLinkRows.length) %
    eventLinkRows.length;
  popup.querySelectorAll(".event-link-row")
    .forEach(function (rowEl) {
      const mine = Number(
        rowEl.getAttribute("data-ei")) === eventLinkHighlight;
      rowEl.classList.toggle("current", mine);
      const old = rowEl.querySelector(".mention-hint");
      if (old) { old.remove(); }
      if (mine) {
        const hint = document.createElement("span");
        hint.className = "mention-hint";
        const label = document.createElement("span");
        label.textContent = "enter to add";
        hint.appendChild(label);
        const icon = document.createElement("span");
        icon.setAttribute("aria-hidden", "true");
        icon.innerHTML = MENTION_ENTER_ICON;
        hint.appendChild(icon);
        rowEl.appendChild(hint);
      }
    });
}

/* Replace the tracked token with an element and a
   trailing space, the mention insert's shape, shared by
   the event chip and the tag pill. False when the token
   no longer stands in its surface (the note body, or
   the Scratch Pad since v2.105.0: the trigger records
   the element it was tracked in). */
function replaceLinkToken(trig, el) {
  const bodyEl = trig && trig.el
    ? trig.el : document.getElementById("noteBody");
  if (!trig || !bodyEl || !bodyEl.contains(trig.node)) {
    return false;
  }
  const end = Math.min(trig.caretOffset,
    trig.node.nodeValue ? trig.node.nodeValue.length : 0);
  const range = document.createRange();
  range.setStart(trig.node, trig.atOffset);
  range.setEnd(trig.node, end);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  range.deleteContents();
  range.insertNode(el);
  const space = document.createTextNode(" ");
  el.after(space);
  placeCaretIn(space, 1);
  return true;
}

/* Pick an event row: the chip replaces the "^" token,
   and the backlink write follows (its failure is a
   plain toast; a repeating or read only event skips it
   silently, per the design). v2.105.0: in the Scratch
   Pad there is no note yet to dirty or to write the
   backlink for: the chip lands, the pad persists, and
   Create Note registers the link when the note is
   made (see createNoteFromScratchPad). */
function pickEventLinkRow(i) {
  const ev = eventLinkRows[i];
  if (!ev) { return; }
  const trig = eventLinkTrigger;
  const note = trig && trig.surface === "scratch"
    ? null : currentNote();
  closeEventLinkPopup();
  if (!replaceLinkToken(trig, buildEventChipEl(ev))) {
    return;
  }
  if (trig && trig.surface === "scratch") {
    persistScratchPadFromDom();
    return;
  }
  markDirty();
  if (note) {
    gcalAddNoteLinkToEvent(ev, note.id)
      .then(function (res) {
        if (res === "failed") {
          toast("Linked here. The backlink could not " +
            "be saved to the event.", true);
        }
      });
  }
}

/* The event picker's keys, on the capture phase like
   the mention popup's: Escape hands the caret back to
   the editor; the arrows walk; Enter and Tab pick. */
function onEventLinkPopupKeydown(ev) {
  if (!eventLinkPopupOpen()) { return; }
  if (ev.key === "Escape") {
    const trig = eventLinkTrigger;
    closeEventLinkPopup();
    const bodyEl = trig && trig.el
      ? trig.el : document.getElementById("noteBody");
    if (trig && bodyEl && bodyEl.contains(trig.node)) {
      bodyEl.focus();
      placeCaretIn(trig.node, Math.min(trig.caretOffset,
        trig.node.nodeValue ? trig.node.nodeValue.length : 0));
    }
    ev.preventDefault();
    ev.stopPropagation();
    return;
  }
  if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp" &&
      ev.key !== "Enter" && ev.key !== "Tab") { return; }
  const bodyEl = eventLinkTrigger && eventLinkTrigger.el
    ? eventLinkTrigger.el
    : document.getElementById("noteBody");
  const searchEl = document.getElementById(
    "eventLinkSearch");
  const fromSearch = !!searchEl && ev.target === searchEl;
  if (fromSearch && ev.key === "Tab") { return; }
  if (!bodyEl || !ev.target ||
      (!bodyEl.contains(ev.target) && !fromSearch)) {
    return;
  }
  ev.preventDefault();
  ev.stopPropagation();
  if (ev.key === "ArrowDown") {
    setEventLinkHighlight(eventLinkHighlight + 1);
  } else if (ev.key === "ArrowUp") {
    setEventLinkHighlight(eventLinkHighlight - 1);
  } else {
    pickEventLinkRow(eventLinkHighlight);
  }
}

/* ---------------- the "#" tag picker ---------------- */

/* The tag picker's standing state, the mention popup's
   shape again: the tracked "#" token, the rows (a tag,
   or the Create row naming a new tag), and the
   highlight. No fetch stands behind it: the app's tags
   are already in the room. */
let tagLinkTrigger = null;
let tagLinkRows = [];
let tagLinkHighlight = 0;
let tagLinkListEl = null;
let tagLinkLastRange = null;

function tagLinkPopupOpen() {
  const popup = document.getElementById("tagLinkPopup");
  return !!popup && !popup.classList.contains("hidden");
}

function closeTagLinkPopup() {
  const popup = document.getElementById("tagLinkPopup");
  if (popup) { popup.classList.add("hidden"); }
  tagLinkTrigger = null;
  tagLinkRows = [];
  tagLinkHighlight = 0;
  tagLinkLastRange = null;
}

/* The rows for one query: the known tags the query
   matches (a case insensitive substring, the mention
   rule), up to eight, then the Create row carrying the
   typed name while it names no existing tag exactly. */
function tagLinkCandidates(query) {
  const needle = String(query || "").toLowerCase();
  const rows = [];
  knownTags().filter(function (t) {
    return t.toLowerCase().indexOf(needle) >= 0;
  }).slice(0, 8).forEach(function (t) {
    rows.push({ kind: "tag", tag: t });
  });
  const q = String(query || "").trim();
  if (q && !knownTags().some(function (t) {
    return t.toLowerCase() === q.toLowerCase();
  })) {
    rows.push({ kind: "create", name: q });
  }
  return rows;
}

function ensureTagLinkChrome(popup) {
  if (tagLinkListEl && popup.contains(tagLinkListEl)) {
    return;
  }
  popup.innerHTML = "";
  const head = document.createElement("div");
  head.className = "mention-head";
  head.textContent = "Tags";
  popup.appendChild(head);
  tagLinkListEl = document.createElement("div");
  tagLinkListEl.className = "mention-list";
  popup.appendChild(tagLinkListEl);
}

/* The tag picker's tracker, the event picker's sibling:
   the "#" token under the caret in a live note, or the
   popup closes. */
function updateTagLinkPopup() {
  const popup = document.getElementById("tagLinkPopup");
  if (!popup) { return; }
  const host = linkPopupHost();
  if (!host) { closeTagLinkPopup(); return; }
  const tok = linkTokenAt(host.node,
    host.range.startOffset, "#");
  if (!tok) { closeTagLinkPopup(); return; }
  tok.el = host.el;
  tok.surface = host.surface;
  const fresh = !tagLinkTrigger ||
    tagLinkTrigger.node !== tok.node ||
    tagLinkTrigger.atOffset !== tok.atOffset ||
    tagLinkTrigger.query !== tok.query;
  tagLinkTrigger = tok;
  tagLinkRows = tagLinkCandidates(tok.query);
  if (!tagLinkRows.length) {
    closeTagLinkPopup();
    return;
  }
  if (fresh) { tagLinkHighlight = 0; }
  renderTagLinkPopup(host.range);
}

function renderTagLinkPopup(range) {
  const popup = document.getElementById("tagLinkPopup");
  if (!popup) { return; }
  ensureTagLinkChrome(popup);
  if (range) { tagLinkLastRange = range; }
  const list = tagLinkListEl;
  list.innerHTML = "";
  tagLinkRows.forEach(function (row, i) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mention-row" +
      (row.kind === "create" ? " mention-create" : "");
    btn.setAttribute("data-ti", String(i));
    btn.setAttribute("role", "option");
    const texts = document.createElement("span");
    texts.className = "mention-texts";
    const line1 = document.createElement("span");
    line1.className = "mention-title";
    const line2 = document.createElement("span");
    if (row.kind === "create") {
      line1.textContent = "#" + row.name;
      line2.className = "mention-create-sub";
      line2.textContent = "Create tag";
    } else {
      line1.textContent = "#" + row.tag;
      line2.className = "mention-nb";
      line2.textContent = "Tag";
    }
    texts.appendChild(line1);
    texts.appendChild(line2);
    btn.appendChild(texts);
    list.appendChild(btn);
  });
  popup.classList.remove("hidden");
  setTagLinkHighlight(tagLinkHighlight);
  positionLinkPopup(popup, range || tagLinkLastRange);
}

function setTagLinkHighlight(i) {
  const popup = document.getElementById("tagLinkPopup");
  if (!popup || !tagLinkRows.length) { return; }
  tagLinkHighlight =
    ((i % tagLinkRows.length) + tagLinkRows.length) %
    tagLinkRows.length;
  popup.querySelectorAll(".mention-row")
    .forEach(function (rowEl) {
      const mine = Number(
        rowEl.getAttribute("data-ti")) === tagLinkHighlight;
      rowEl.classList.toggle("current", mine);
      const old = rowEl.querySelector(".mention-hint");
      if (old) { old.remove(); }
      if (mine) {
        const hint = document.createElement("span");
        hint.className = "mention-hint";
        const label = document.createElement("span");
        label.textContent = "enter to add";
        hint.appendChild(label);
        const icon = document.createElement("span");
        icon.setAttribute("aria-hidden", "true");
        icon.innerHTML = MENTION_ENTER_ICON;
        hint.appendChild(icon);
        rowEl.appendChild(hint);
      }
    });
}

/* Apply a tag to the note being edited, through the
   tags field, the editor's own tag assignment path: the
   field gains the tag (a spelling already there, in any
   case, stands), and the save that follows files the
   note under it. A tag the app has never seen is born
   by this application, the Create row's whole job. */
function applyTagToCurrentNote(name) {
  const input = document.getElementById("noteTags");
  if (!input || input.disabled) { return; }
  const tags = input.value.split(",")
    .map(function (t) { return t.trim(); })
    .filter(function (t) { return t.length > 0; });
  if (tags.some(function (t) {
    return t.toLowerCase() === name.toLowerCase();
  })) {
    return;
  }
  tags.push(name);
  input.value = tags.join(", ");
}

/* Remove a tag from the note being edited, through
   the tags field: the mirror of applyTagToCurrentNote
   above. A spelling already there, in any case, is
   the one removed; a tag the field does not carry
   changes nothing. The save that follows files the
   note without it. Returns whether the field moved. */
function removeTagFromCurrentNote(name) {
  const input = document.getElementById("noteTags");
  if (!input || input.disabled) { return false; }
  const tags = input.value.split(",")
    .map(function (t) { return t.trim(); })
    .filter(function (t) { return t.length > 0; });
  const kept = tags.filter(function (t) {
    return t.toLowerCase() !== name.toLowerCase();
  });
  if (kept.length === tags.length) { return false; }
  input.value = kept.join(", ");
  return true;
}

/* The body's tag pills counted by folded tag name:
   the deletion watch reads the body through this
   lens before and after an edit. */
function tagPillCounts(bodyEl) {
  const counts = {};
  bodyEl.querySelectorAll(".ss-tag-pill")
    .forEach(function (el) {
      const name = (el.getAttribute("data-ss-tag") || "")
        .toLowerCase();
      if (!name) { return; }
      counts[name] = (counts[name] || 0) + 1;
    });
  return counts;
}

/* v2.85: pill deletion syncs the note's tags (Chris,
   2026-11-02: "When tags are deleted in-line, they
   also need removed from the note"), reversing the
   v2.83 rule that removing a pill never untagged.
   The watch is a before and after pair, the editor's
   own shape for keyboard deletions (the attachment
   reconciliation at v1.7 is its elder sibling): a
   deletion gesture's beforeinput (Backspace, Delete,
   a range deletion, a cut: every delete* input type)
   snapshots the body's pill counts against the open
   note, and the input event that follows reconciles.
   A tag whose count fell to zero in that gesture
   leaves the note through the tags field, the same
   path the pill's insertion applied it by. A tag
   with another pill standing keeps its place, and a
   tag the note never carried changes nothing. Only
   deletion gestures arm the watch: a wholesale
   programmatic rewrite of the body (an open, a
   render) fires no beforeinput and never untags.
   The tag field stands outside the body's undo
   stack, so undoing the body's deletion brings the
   pill back without re-applying the tag; the field
   is the record, and it can be retyped there. */
let tagPillDeleteWatch = null;

function captureTagPillsBeforeDelete(ev) {
  if (!ev || !ev.inputType ||
      ev.inputType.indexOf("delete") !== 0) { return; }
  const note = currentNote();
  if (!note || note.trashed || note.archived) { return; }
  const bodyEl = document.getElementById("noteBody");
  if (!bodyEl) { return; }
  tagPillDeleteWatch = {
    noteId: note.id,
    counts: tagPillCounts(bodyEl)
  };
}

function reconcileTagPillsAfterDelete() {
  const watch = tagPillDeleteWatch;
  tagPillDeleteWatch = null;
  if (!watch) { return; }
  const note = currentNote();
  if (!note || note.id !== watch.noteId ||
      note.trashed || note.archived) { return; }
  const bodyEl = document.getElementById("noteBody");
  if (!bodyEl) { return; }
  const now = tagPillCounts(bodyEl);
  let changed = false;
  Object.keys(watch.counts).forEach(function (key) {
    if (watch.counts[key] > 0 && !now[key]) {
      if (removeTagFromCurrentNote(key)) {
        changed = true;
      }
    }
  });
  if (changed) { markDirty(); }
}

/* Pick a tag row: the pill replaces the "#" token, and
   the tag is applied to the note at once. v2.105.0:
   in the Scratch Pad nothing is tagged yet (the pad
   is not a note): the pill lands and persists, and
   Create Note applies the pad's pills as the note's
   tags when the note is made. */
function pickTagLinkRow(i) {
  const row = tagLinkRows[i];
  if (!row) { return; }
  const name = row.kind === "create" ? row.name : row.tag;
  const trig = tagLinkTrigger;
  closeTagLinkPopup();
  const pill = document.createElement("span");
  pill.className = "ss-tag-pill";
  pill.setAttribute("contenteditable", "false");
  pill.setAttribute("data-ss-tag", name);
  pill.textContent = "#" + name;
  if (!replaceLinkToken(trig, pill)) { return; }
  if (trig && trig.surface === "scratch") {
    persistScratchPadFromDom();
    return;
  }
  applyTagToCurrentNote(name);
  markDirty();
}

/* The tag picker's keys, the event picker's twin. */
function onTagLinkPopupKeydown(ev) {
  if (!tagLinkPopupOpen()) { return; }
  if (ev.key === "Escape") {
    const trig = tagLinkTrigger;
    closeTagLinkPopup();
    const bodyEl = trig && trig.el
      ? trig.el : document.getElementById("noteBody");
    if (trig && bodyEl && bodyEl.contains(trig.node)) {
      bodyEl.focus();
      placeCaretIn(trig.node, Math.min(trig.caretOffset,
        trig.node.nodeValue ? trig.node.nodeValue.length : 0));
    }
    ev.preventDefault();
    ev.stopPropagation();
    return;
  }
  if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp" &&
      ev.key !== "Enter" && ev.key !== "Tab") { return; }
  const bodyEl = tagLinkTrigger && tagLinkTrigger.el
    ? tagLinkTrigger.el
    : document.getElementById("noteBody");
  if (!bodyEl || !ev.target || !bodyEl.contains(ev.target)) {
    return;
  }
  ev.preventDefault();
  ev.stopPropagation();
  if (ev.key === "ArrowDown") {
    setTagLinkHighlight(tagLinkHighlight + 1);
  } else if (ev.key === "ArrowUp") {
    setTagLinkHighlight(tagLinkHighlight - 1);
  } else {
    pickTagLinkRow(tagLinkHighlight);
  }
}

