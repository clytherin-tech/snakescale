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
/* ---------------- v2.84: the Email polish round ------
   Six pieces ride beside the mail module, in its own
   discipline (reads through gmailRead, writes through
   gmailWrite, page memory only):

   - Drag and drop triage (Part 3): a dragged message
     row dropped on All Mail archives it, on Trash
     trashes it, and on a user label applies the label,
     removing the source label when the drag started
     in another label's list (Gmail's move).
   - The undo toast (Part 4): an archive or a trash of
     one message, from any surface, stands a pill toast
     at the top center with an Undo button and a five
     second life; Undo reverses the write through the
     same transports and restores the row where it
     stood. A newer archive or trash replaces the
     standing toast, and the older action is then no
     longer undoable from the UI.
   - The label context menu (Part 6): Rename and
     Delete for user labels, through labels.update and
     labels.delete.
   - Contacts autocomplete (Part 7): the People API
     module below, and its dropdown on the compose
     dialog's three recipient fields.
   - Email link chips (Part 8): the chip the @@ popup
     inserts into a note, and the travel its click
     makes. */

/* Any cached copy of a message, by id (the lists hold
   a copy each; the first found speaks for all, since
   the apply path moves every copy by id). */
function mailRowById(id) {
  const keys = Object.keys(mailLists);
  for (let i = 0; i < keys.length; i++) {
    const rows = mailLists[keys[i]].rows;
    for (let j = 0; j < rows.length; j++) {
      if (rows[j].id === id) { return rows[j]; }
    }
  }
  if (mailOpenFull && mailOpenFull.id === id) {
    return mailOpenFull;
  }
  return null;
}

/* ----- Part 3 and 4: triage with an undo ---------- */

let mailDragState = null;
let mailUndoState = null;

/* Where a message stands in every cached list, taken
   before a triage write, so an Undo can put its row
   back at the very place it stood. */
function mailCaptureRowPositions(id) {
  const pos = [];
  Object.keys(mailLists).forEach(function (key) {
    const list = mailLists[key];
    const at = list.rows.findIndex(function (r) {
      return r.id === id;
    });
    if (at !== -1) { pos.push({ key: key, index: at }); }
  });
  return pos;
}

/* Put a message's row back at its captured places:
   a fresh copy in every list the captured record
   belongs to (by the membership rule, read off the
   record itself) that no longer holds it. Returns the
   list keys a copy landed in, so a failed reversal
   can take them back out. */
function mailRestoreRowPositions(clone, positions) {
  const landed = [];
  positions.forEach(function (p) {
    const list = mailLists[p.key];
    if (!list || !list.loaded) { return; }
    const held = list.rows.some(function (r) {
      return r.id === clone.id;
    });
    if (held) { return; }
    if (!mailRowInSelection(clone, list.sel || mailFolder)) {
      return;
    }
    const copy = JSON.parse(JSON.stringify(clone));
    list.rows.splice(Math.min(p.index, list.rows.length),
      0, copy);
    landed.push(p.key);
  });
  return landed;
}

function dismissMailUndoToast() {
  if (!mailUndoState) { return; }
  clearTimeout(mailUndoState.timer);
  if (mailUndoState.el && mailUndoState.el.parentNode) {
    mailUndoState.el.parentNode.removeChild(mailUndoState.el);
  }
  mailUndoState = null;
}

/* The undo toast itself: the shared pill form in the
   top center box, its saved tone and green dot like
   every completion there, plus the Undo button. It
   lives exactly five seconds; a newer triage replaces
   it wholesale. */
function showMailUndoToast(kind, snap) {
  dismissMailUndoToast();
  const box = document.getElementById("toastBoxTop");
  if (!box) { return; }
  const el = document.createElement("div");
  el.className = "pill-form move-done mail-undo-toast";
  el.setAttribute("data-state", "saved");
  const dot = document.createElement("span");
  dot.className = "save-pill-dot";
  dot.setAttribute("aria-hidden", "true");
  el.appendChild(dot);
  const label = document.createElement("span");
  /* v2.107: a batch snapshot carries its own words
     (its counts, its return time); the single kinds
     keep theirs below. */
  /* v2.95: a label move names its label. */
  label.textContent = snap && snap.text ? snap.text
    : kind === "archive"
    ? "Archived"
    : kind === "label"
      ? "Moved to " + (snap.labelName || "label")
      : kind === "snooze"
        ? "Snoozed until " + (snap.untilText || "")
        : "Moved to Trash";
  el.appendChild(label);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mail-undo-btn";
  btn.textContent = "Undo";
  btn.addEventListener("click", function () {
    const reversal = snap && snap.batch
      ? mailUndoBatch(snap) : mailUndoTriage(snap);
    reversal.catch(function () {
      /* the reversal reports through the write paths */
    });
  });
  el.appendChild(btn);
  box.appendChild(el);
  const timer = setTimeout(dismissMailUndoToast, 5000);
  mailUndoState = { el: el, timer: timer, snap: snap };
}

/* Reverse one triage: the row copies go back at their
   captured places first (so the apply that follows
   the API's answer settles the counts off a standing
   copy), then the reversing write runs; a refused
   reversal takes the restored copies back out and the
   write path's own toast names the failure. */
async function mailUndoTriage(snap) {
  dismissMailUndoToast();
  const clone = JSON.parse(JSON.stringify(snap.clone));
  const landed = mailRestoreRowPositions(clone,
    snap.positions);
  let ok = false;
  if (snap.kind === "archive") {
    ok = await mailModifyMessage(clone, ["INBOX"], [],
      "mark");
  } else if (snap.kind === "snooze") {
    /* v2.100: a snooze's Undo is the return with the
       snapshot's own label: the Inbox comes back, the
       Snoozed label comes off, and the registry entry
       comes out, on the modify's acceptance alone. */
    ok = await mailModifyMessage(clone, ["INBOX"],
      [snap.labelId], "mark");
    if (ok) { await mailSnoozeRemoveEntry(snap.id); }
  } else if (snap.kind === "label") {
    /* v2.95: a label move's Undo restores the exact
       label set the snapshot carried: the labels the
       move took off and the message held go back on,
       and the labels the move put on and the message
       did not hold come off. Nothing is inferred
       from where the drag started, so an undo never
       hands a message an Inbox it did not have, nor
       takes one it did. */
    ok = await mailModifyMessage(clone, snap.undoAdd,
      snap.undoRemove, "mark");
  } else {
    ok = await mailTrashMessage(clone, true);
  }
  if (!ok) {
    landed.forEach(function (key) {
      const list = mailLists[key];
      if (list) {
        list.rows = list.rows.filter(function (r) {
          return r.id !== snap.id;
        });
      }
    });
    if (state.view && state.view.kind === "email") {
      renderMail();
    }
    return;
  }
  if (state.view && state.view.kind === "email") {
    renderMail();
  }
}

/* Archive one message behind the undo toast: the
   snapshot (the record as it stood, and its place in
   every list) is taken before the write, and the
   toast stands only on the API's acceptance. */
async function mailArchiveWithUndo(rec) {
  if (!rec) { return false; }
  const snap = {
    kind: "archive", id: rec.id,
    clone: JSON.parse(JSON.stringify(rec)),
    positions: mailCaptureRowPositions(rec.id)
  };
  const ok = await mailModifyMessage(rec, [], ["INBOX"],
    "archive");
  if (ok) { showMailUndoToast("archive", snap); }
  return ok;
}

/* Trash one message behind the undo toast, the same
   shape. (Moving a message OUT of Trash is a plain
   untrash and carries no toast: the toast belongs to
   the archive and the trash, per the round's brief.) */
async function mailTrashWithUndo(rec) {
  if (!rec) { return false; }
  const snap = {
    kind: "trash", id: rec.id,
    clone: JSON.parse(JSON.stringify(rec)),
    positions: mailCaptureRowPositions(rec.id)
  };
  const ok = await mailTrashMessage(rec, false);
  if (ok) { showMailUndoToast("trash", snap); }
  return ok;
}

/* v2.95: a label move behind the undo toast: the
   snapshot (the record as it stood, its place in
   every list, and the exact label arithmetic an
   Undo must run) is taken before the write, and the
   toast stands only on the API's acceptance. The
   arithmetic is computed against the label set the
   message held before the move, so the Undo restores
   that set exactly, from whatever list the drag
   started in. */
async function mailLabelMoveWithUndo(rec, target, add,
    remove, nameOverride) {
  if (!rec) { return false; }
  const prior = rec.labelIds.slice();
  let labelName = target.id;
  (mailLabels || []).forEach(function (l) {
    if (l.id === target.id) { labelName = l.name; }
  });
  /* v2.103: a caller naming its own destination
     (the move to the Inbox) speaks for the
     toast, since the labels map calls the
     Inbox INBOX. */
  if (nameOverride) { labelName = nameOverride; }
  const snap = {
    kind: "label", id: rec.id,
    clone: JSON.parse(JSON.stringify(rec)),
    positions: mailCaptureRowPositions(rec.id),
    labelName: labelName,
    undoAdd: remove.filter(function (l) {
      return prior.indexOf(l) !== -1;
    }),
    undoRemove: add.filter(function (l) {
      return prior.indexOf(l) === -1;
    })
  };
  const ok = await mailModifyMessage(rec, add, remove,
    "label");
  if (ok) { showMailUndoToast("label", snap); }
  return ok;
}

/* v2.103: the move back to the Inbox, behind
   the undo toast: INBOX goes on, and a message
   sitting in the Trash loses TRASH as it comes
   back (it leaves the Trash); every other label
   it holds stays on. The write is the label
   move aimed home: the same snapshot and the
   same Undo arithmetic, so an Undo restores
   exactly the label set the message held (a
   message brought out of the Trash goes back
   to the Trash on Undo, with no INBOX). A
   message already in the Inbox and not in the
   Trash is already home: no write is made and
   no toast stands. The drop on the Inbox
   folder row and the More menu's Move to
   Inbox item both land here. */
async function mailMoveToInboxWithUndo(rec) {
  if (!rec) { return false; }
  const prior = rec.labelIds.slice();
  const inTrash = prior.indexOf("TRASH") !== -1;
  if (prior.indexOf("INBOX") !== -1 && !inTrash) {
    return false;
  }
  const remove = inTrash ? ["TRASH"] : [];
  /* A detached copy of the row as it stands, taken
     before the write: the apply path settles the
     copies standing in lists and lifts a row out
     of any list it stops belonging to, and a
     message whose only standing copy is filtered
     out of its old list by this very move (the
     Trash copy, say) would otherwise leave no row
     behind to bring home below. */
  const homeward = JSON.parse(JSON.stringify(rec));
  const ok = await mailLabelMoveWithUndo(rec,
    { id: "INBOX" }, ["INBOX"], remove, "Inbox");
  if (ok) {
    mailSeatRowInInbox(homeward, ["INBOX"], remove);
  }
  return ok;
}

/* Seat a moved message's row in the Inbox list's
   cache, at its date place among the rows standing
   there: the apply path settles the copies that
   stand in lists, but it never seats a row in a
   list the message newly belongs to, so without
   this the Inbox list would not show the message
   home until a reload refetched it. A copy already
   standing is left alone (the apply path settled
   it in place), and an Inbox list that was never
   loaded needs nothing (its first load reads the
   server's truth). The move itself is applied to
   the copy here for the same reason: its standing
   originals may already have been filtered away. */
function mailSeatRowInInbox(copy, add, remove) {
  const key = mailListKey({ kind: "folder", id: "inbox" });
  const list = mailLists[key];
  if (!list || !list.loaded) { return; }
  const held = list.rows.some(function (r) {
    return r.id === copy.id;
  });
  if (held) { return; }
  add.forEach(function (l) {
    if (copy.labelIds.indexOf(l) === -1) {
      copy.labelIds.push(l);
    }
  });
  remove.forEach(function (l) {
    const at = copy.labelIds.indexOf(l);
    if (at !== -1) { copy.labelIds.splice(at, 1); }
  });
  copy.unread = copy.labelIds.indexOf("UNREAD") !== -1;
  let at = list.rows.length;
  for (let i = 0; i < list.rows.length; i++) {
    if (list.rows[i].dateMs < copy.dateMs) {
      at = i; break;
    }
  }
  list.rows.splice(at, 0, copy);
}

/* ----- v2.100: snooze --------------------------------
   Gmail has no snooze of its own; the app manages it,
   per message (the module is message based, so a
   thread's messages snooze one at a time). Snoozing
   a message does three things, in this order:

     1. the return is written into a small schedule
        file in the store root, mail-snooze.json,
        holding one entry per snoozed message: its
        id, its thread id, the Snoozed label's id,
        and the instant it should come back;
     2. the message itself is modified: the Snoozed
        label goes on and INBOX comes off, through
        the standing modify path;
     3. the standing undo toast offers the reversal
        for five seconds.

   The order is the safety: the schedule is written
   BEFORE the message moves, so a message can never
   be hidden without its return standing in the
   file. If the modify is refused, the entry just
   written is rolled back out to exactly what stood
   before it; if the schedule write itself fails,
   the message is never touched at all. The Snoozed
   label is an ordinary user label named "Snoozed",
   found by name or created once, and it stands in
   the folder column like any other label, so what
   is sleeping is always one click away.

   The file is schedule state, not mail content: no
   subject, sender, or body ever stands in it, only
   ids and a time. It is the one mail related thing
   the app persists, and it has to be: the return
   must survive the app closing, and the push
   Worker reads the same file to bring due mail
   back on time with the app closed. The app also
   reconciles due entries itself whenever it is
   open (the sign in landing and the auto sync
   tick), as a safety net; the two restorers are
   idempotent, and every write of the file re-reads
   it fresh from Drive first and merges by message
   id, so the app and the Worker never clobber
   each other's entries. */

const MAIL_SNOOZE_FILE = "mail-snooze.json";
const MAIL_SNOOZE_LABEL_NAME = "Snoozed";
/* Snooze times are computed in Chris's own zone,
   whatever zone the device happens to be in. */
const MAIL_SNOOZE_ZONE = "America/New_York";

/* The registry as this page holds it: a working
   copy for the reading pane's line and the flows
   below. The file on Drive is the truth; every
   write re-reads it (mailSnoozeWriteEntries). */
let mailSnoozeEntries = [];
let mailSnoozeLoaded = false;
let mailSnoozeReconcileRunning = false;
let mailSnoozeMenuCtx = null;
let mailSnoozePickCtx = null;

/* The stored entries, cleaned to the shape the
   flows read: an entry stands only when it carries
   a message id, a label id, and a return instant
   that parses. Anything else in the file is not
   this module's to keep, and a write drops it. */
function mailSnoozeSanitizeEntries(raw) {
  if (!Array.isArray(raw)) { return []; }
  const out = [];
  raw.forEach(function (e) {
    if (!e || typeof e !== "object") { return; }
    const id = typeof e.messageId === "string"
      ? e.messageId : "";
    const labelId = typeof e.labelId === "string"
      ? e.labelId : "";
    const until = typeof e.snoozeUntil === "string"
      ? e.snoozeUntil : "";
    if (!id || !labelId || !isFinite(Date.parse(until))) {
      return;
    }
    out.push({
      messageId: id,
      threadId: typeof e.threadId === "string"
        ? e.threadId : "",
      labelId: labelId,
      snoozeUntil: until,
      createdAt: typeof e.createdAt === "string"
        ? e.createdAt : ""
    });
  });
  return out;
}

/* Read the registry file fresh from Drive. A missing
   file is an empty registry. A file that does not
   parse, or parses to the wrong shape, is broken:
   writers refuse rather than overwrite a schedule
   they cannot read, and the reconcile leaves it
   alone, the same discipline the push Worker
   keeps toward the same file. */
async function mailSnoozeReadFresh() {
  const file = await storeGetFile(MAIL_SNOOZE_FILE);
  if (!file) {
    return { entries: [], token: null, broken: false };
  }
  try {
    const parsed = JSON.parse(file.text);
    if (!parsed || typeof parsed !== "object" ||
        !Array.isArray(parsed.entries)) {
      return { entries: [], token: file.token,
        broken: true };
    }
    return {
      entries: mailSnoozeSanitizeEntries(parsed.entries),
      token: file.token, broken: false
    };
  } catch (e) {
    return { entries: [], token: file.token,
      broken: true };
  }
}

/* One registry write, under the merge discipline:
   the file is re-read fresh, the caller's change is
   applied to THAT list (never to the page's possibly
   stale copy), and the result is written back under
   the fresh read's token. A lost token race is
   retried once over a second fresh read, so an
   entry the Worker dropped, or another device
   added, between this page's last look and this
   write is merged, never clobbered. The page's
   working copy follows the winning write. Returns
   true when the change stands in the file. */
async function mailSnoozeWriteEntries(change) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let fresh = null;
    try {
      fresh = await mailSnoozeReadFresh();
    } catch (e) { return false; }
    if (fresh.broken) { return false; }
    const next = change(fresh.entries.slice());
    if (JSON.stringify(next) ===
        JSON.stringify(fresh.entries)) {
      mailSnoozeEntries = fresh.entries;
      mailSnoozeLoaded = true;
      return true;
    }
    const text = JSON.stringify(
      { version: 1, entries: next }, null, 2);
    try {
      await storePutFile(MAIL_SNOOZE_FILE, text,
        fresh.token, "Update the mail snooze schedule");
      mailSnoozeEntries = next;
      mailSnoozeLoaded = true;
      return true;
    } catch (e) {
      if (!isStoreConflict(e)) { return false; }
      /* A conflict means the file moved between the
         read and the write (the Worker restoring due
         mail is the standing case): loop once over a
         fresh read and merge again. */
    }
  }
  return false;
}

/* Load the working copy once, for the surfaces that
   only read it (the reading pane's snoozed line).
   A broken file leaves the copy unloaded, so the
   next look asks again. */
async function mailSnoozeEnsureLoaded() {
  if (mailSnoozeLoaded) { return; }
  try {
    const fresh = await mailSnoozeReadFresh();
    if (!fresh.broken) {
      mailSnoozeEntries = fresh.entries;
      mailSnoozeLoaded = true;
    }
  } catch (e) { /* the next use asks again */ }
}

function mailSnoozeEntryFor(messageId) {
  for (let i = 0; i < mailSnoozeEntries.length; i++) {
    if (mailSnoozeEntries[i].messageId === messageId) {
      return mailSnoozeEntries[i];
    }
  }
  return null;
}

/* Take one message's entry out of the registry, on
   the same merge discipline as every write. */
function mailSnoozeRemoveEntry(messageId) {
  return mailSnoozeWriteEntries(function (entries) {
    return entries.filter(function (e) {
      return e.messageId !== messageId;
    });
  });
}

/* ----- Snooze times, in the home zone --------------
   The same Intl arithmetic the push Worker uses:
   format the instant in the zone, read the parts
   back as if they were UTC, and the difference is
   the offset; a wall time becomes an instant by
   subtracting the offset, corrected once at the
   corrected instant. */

const mailSnoozeZoneFormat = new Intl.DateTimeFormat(
  "en-US", {
    timeZone: MAIL_SNOOZE_ZONE, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });

function mailSnoozeZoneParts(ms) {
  const parts = {};
  mailSnoozeZoneFormat.formatToParts(new Date(ms))
    .forEach(function (p) { parts[p.type] = p.value; });
  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    hour: parseInt(parts.hour, 10) % 24,
    minute: parseInt(parts.minute, 10),
    second: parseInt(parts.second, 10)
  };
}

function mailSnoozeZoneOffsetMs(ms) {
  const p = mailSnoozeZoneParts(ms);
  const readBack = Date.UTC(p.year, p.month - 1,
    p.day, p.hour, p.minute, p.second);
  return readBack - Math.floor(ms / 1000) * 1000;
}

function mailSnoozeWallToUtcMs(year, month, day,
    hour, minute) {
  const wallAsUtc = Date.UTC(year, month - 1, day,
    hour, minute, 0);
  let utc = wallAsUtc - mailSnoozeZoneOffsetMs(wallAsUtc);
  utc = wallAsUtc - mailSnoozeZoneOffsetMs(utc);
  return utc;
}

/* The menu's three standing choices, computed as
   the menu opens: three hours on, tomorrow at
   8:00 AM, and next Monday at 8:00 AM, all in the
   home zone. The day arithmetic runs on the zone's
   own calendar date, where adding days is exact. */
function mailSnoozeChoices(nowMs) {
  const p = mailSnoozeZoneParts(nowMs);
  const DAY = 24 * 60 * 60000;
  const todayUtc = Date.UTC(p.year, p.month - 1, p.day);
  const atEight = function (dayUtc) {
    const d = new Date(dayUtc);
    return mailSnoozeWallToUtcMs(d.getUTCFullYear(),
      d.getUTCMonth() + 1, d.getUTCDate(), 8, 0);
  };
  const dow = new Date(todayUtc).getUTCDay();
  const toMonday = ((8 - dow) % 7) || 7;
  return [
    { key: "later", name: "Later today",
      until: nowMs + 3 * 60 * 60000 },
    { key: "tomorrow", name: "Tomorrow",
      until: atEight(todayUtc + DAY) },
    { key: "nextweek", name: "Next week",
      until: atEight(todayUtc + toMonday * DAY) }
  ];
}

/* A return instant in words, in the home zone: the
   form the menu rows, the undo toast, and the
   reading pane's line all speak. */
const mailSnoozeUntilFormat = new Intl.DateTimeFormat(
  "en-US", {
    timeZone: MAIL_SNOOZE_ZONE, weekday: "short",
    month: "short", day: "numeric", hour: "numeric",
    minute: "2-digit"
  });

function mailSnoozeFormatUntil(ms) {
  return mailSnoozeUntilFormat.format(new Date(ms));
}

/* The Snoozed label: an ordinary user label, found
   by name in the loaded list, or created once
   through the labels API and stood in the list, so
   the folder column picks it up on its next render
   like any label. Returns its id, or null when the
   label can neither be found nor made (the snooze
   then does not happen at all). */
async function mailSnoozeLabelId() {
  const byName = function () {
    if (!mailLabels) { return null; }
    for (let i = 0; i < mailLabels.length; i++) {
      if (mailLabels[i].type === "user" &&
          mailLabels[i].name === MAIL_SNOOZE_LABEL_NAME) {
        return mailLabels[i].id;
      }
    }
    return null;
  };
  let id = byName();
  if (id) { return id; }
  if (!mailLabels) {
    await loadMailLabels();
    id = byName();
    if (id) { return id; }
  }
  const out = await gmailWrite("POST",
    "/users/me/labels", {
      name: MAIL_SNOOZE_LABEL_NAME,
      labelListVisibility: "labelShow",
      messageListVisibility: "show"
    });
  if (out.outcome !== "ok" || !out.data ||
      !out.data.id) {
    return null;
  }
  const rec = {
    id: String(out.data.id),
    name: String(out.data.name || MAIL_SNOOZE_LABEL_NAME),
    type: "user",
    messagesUnread: 0
  };
  if (mailLabels) { mailLabels.push(rec); }
  return rec.id;
}

/* Snooze one message until one instant. The
   registry entry is written FIRST; only then does
   the message move; and a refused modify rolls the
   entry back out to exactly what stood before
   (nothing, or the entry this snooze replaced).
   The undo toast stands only on the API's
   acceptance, like every triage here. Snoozing an
   already snoozed message replaces its entry: one
   entry per message, newest wins. The accepted
   write's own tail asks for the Inbox unread count
   again (mailApplyLabelChange), as after every
   mail action. */
async function mailSnoozeMessage(rec, untilMs) {
  if (!rec) { return false; }
  const labelId = await mailSnoozeLabelId();
  if (!labelId) {
    toast("Could not snooze that message.", true);
    return false;
  }
  const entry = {
    messageId: rec.id,
    threadId: rec.threadId || "",
    labelId: labelId,
    snoozeUntil: new Date(untilMs).toISOString(),
    createdAt: new Date().toISOString()
  };
  let prior = null;
  const written = await mailSnoozeWriteEntries(
    function (entries) {
      const next = entries.filter(function (e) {
        if (e.messageId === rec.id) { prior = e; }
        return e.messageId !== rec.id;
      });
      next.push(entry);
      return next;
    });
  if (!written) {
    toast("Could not snooze that message.", true);
    return false;
  }
  const snap = {
    kind: "snooze", id: rec.id,
    clone: JSON.parse(JSON.stringify(rec)),
    positions: mailCaptureRowPositions(rec.id),
    labelId: labelId,
    untilText: mailSnoozeFormatUntil(untilMs)
  };
  const out = await gmailWrite("POST",
    "/users/me/messages/" + encodeURIComponent(rec.id) +
    "/modify", { addLabelIds: [labelId],
      removeLabelIds: ["INBOX"] });
  if (out.outcome !== "ok") {
    await mailSnoozeWriteEntries(function (entries) {
      const next = entries.filter(function (e) {
        return e.messageId !== rec.id;
      });
      if (prior) { next.push(prior); }
      return next;
    });
    mailToastWriteFailure(out,
      "Could not snooze that message.");
    return false;
  }
  mailApplyLabelChange(rec.id, [labelId], ["INBOX"],
    false);
  if (state.view && state.view.kind === "email") {
    renderMail();
  }
  showMailUndoToast("snooze", snap);
  return true;
}

/* Bring one snoozed message back now: the modify
   first, and the registry entry comes out only on
   its acceptance, so a refused return leaves the
   message honestly still snoozed. */
async function mailUnsnoozeMessage(rec) {
  if (!rec) { return false; }
  await mailSnoozeEnsureLoaded();
  const entry = mailSnoozeEntryFor(rec.id);
  let labelId = entry ? entry.labelId : null;
  if (!labelId && mailLabels) {
    for (let i = 0; i < mailLabels.length; i++) {
      if (mailLabels[i].type === "user" &&
          mailLabels[i].name ===
            MAIL_SNOOZE_LABEL_NAME) {
        labelId = mailLabels[i].id;
      }
    }
  }
  const ok = await mailModifyMessage(rec, ["INBOX"],
    labelId ? [labelId] : [], "mark");
  if (ok) { await mailSnoozeRemoveEntry(rec.id); }
  return ok;
}

/* The app side restore pass, the push Worker's twin
   and safety net: every entry whose moment has come
   is put back in the Inbox and dropped from the
   file. A message Google says is gone (a 404) drops
   its entry too; any other refusal keeps the entry
   for the next pass. Quiet by design: a background
   pass never toasts, and one that cannot run leaves
   everything standing for the next landing or tick. */
async function mailSnoozeReconcile() {
  if (mailSnoozeReconcileRunning) { return; }
  if (!mailSignedInAble()) { return; }
  if (mailStatus === "needs-consent") { return; }
  if (!state.repoExists) { return; }
  mailSnoozeReconcileRunning = true;
  try {
    const fresh = await mailSnoozeReadFresh();
    if (fresh.broken) { return; }
    mailSnoozeEntries = fresh.entries;
    mailSnoozeLoaded = true;
    const now = Date.now();
    const due = fresh.entries.filter(function (e) {
      return Date.parse(e.snoozeUntil) <= now;
    });
    if (!due.length) { return; }
    const dropped = [];
    for (const e of due) {
      const out = await gmailWrite("POST",
        "/users/me/messages/" +
        encodeURIComponent(e.messageId) + "/modify",
        { addLabelIds: ["INBOX"],
          removeLabelIds: [e.labelId] });
      if (out.outcome === "ok") {
        dropped.push(e.messageId);
        mailApplyLabelChange(e.messageId, ["INBOX"],
          [e.labelId], false);
      } else if (out.status === 404) {
        dropped.push(e.messageId);
      }
    }
    if (dropped.length) {
      await mailSnoozeWriteEntries(
        function (entries) {
          return entries.filter(function (x) {
            return dropped.indexOf(x.messageId) === -1;
          });
        });
      if (state.view && state.view.kind === "email") {
        renderMail();
      }
    }
  } catch (e) {
    /* The next landing or tick retries. */
  } finally {
    mailSnoozeReconcileRunning = false;
  }
}

/* ----- The snooze choices menu -------------------- */

function closeMailSnoozeMenu() {
  const menu = mailEl("mailSnoozeMenu");
  if (menu) { menu.classList.add("hidden"); }
  mailSnoozeMenuCtx = null;
  document.removeEventListener("pointerdown",
    onMailSnoozeMenuDocPointerDown, true);
  document.removeEventListener("keydown",
    onMailSnoozeMenuDocKeydown, true);
}

function onMailSnoozeMenuDocPointerDown(ev) {
  const menu = mailEl("mailSnoozeMenu");
  if (menu && ev.target && menu.contains(ev.target)) {
    return;
  }
  closeMailSnoozeMenu();
}

function onMailSnoozeMenuDocKeydown(ev) {
  if (ev.key === "Escape") {
    ev.preventDefault();
    closeMailSnoozeMenu();
  }
}

/* The choices for one message, each row naming the
   exact return its choice will use, computed as
   the menu opens. Opened from the reading pane's
   Snooze button and from a row's quick action
   alike; it stands at the press point, clamped to
   the viewport like the app's other floating
   menus, and closes on an outside press or
   Escape, the label menu's own discipline. */
function openMailSnoozeMenu(rec, x, y) {
  if (!rec) { return; }
  openMailSnoozeMenuFor([rec], x, y);
}

/* v2.107: the same menu for a list of targets (a
   selection, from the bar or the row menu): the
   choices and their computed returns are the
   standing ones; the pick runs the batch through
   mailSnoozeRun, which keeps a single target on the
   standing single path. */
function openMailSnoozeMenuFor(recs, x, y) {
  closeMailSnoozeMenu();
  const menu = mailEl("mailSnoozeMenu");
  const rows = mailEl("mailSnoozeMenuRows");
  if (!menu || !rows || !recs || !recs.length) {
    return;
  }
  mailSnoozeMenuCtx = { recs: recs.slice() };
  rows.innerHTML = "";
  mailSnoozeChoices(Date.now()).forEach(
    function (choice) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mail-snooze-item";
      btn.setAttribute("data-snooze-key", choice.key);
      btn.setAttribute("data-until",
        String(choice.until));
      const name = document.createElement("span");
      name.textContent = choice.name;
      btn.appendChild(name);
      const when = document.createElement("span");
      when.className = "mail-snooze-when";
      when.textContent =
        mailSnoozeFormatUntil(choice.until);
      btn.appendChild(when);
      btn.addEventListener("click", function () {
        const ctx = mailSnoozeMenuCtx;
        closeMailSnoozeMenu();
        if (ctx) {
          mailSnoozeRun(ctx.recs, choice.until);
        }
      });
      rows.appendChild(btn);
    });
  const pick = document.createElement("button");
  pick.type = "button";
  pick.className = "mail-snooze-item";
  pick.setAttribute("data-snooze-key", "pick");
  const pickName = document.createElement("span");
  pickName.textContent = "Pick a date and time";
  pick.appendChild(pickName);
  pick.addEventListener("click", function () {
    const ctx = mailSnoozeMenuCtx;
    closeMailSnoozeMenu();
    if (ctx) { openMailSnoozePickFor(ctx.recs); }
  });
  rows.appendChild(pick);
  menu.classList.remove("hidden");
  placeNoteContextMenu(menu, x, y);
  document.addEventListener("pointerdown",
    onMailSnoozeMenuDocPointerDown, true);
  document.addEventListener("keydown",
    onMailSnoozeMenuDocKeydown, true);
  const first = rows.querySelector(".mail-snooze-item");
  if (first) { first.focus(); }
}

/* Open the menu under one pressed control: the
   reading pane's Snooze button, or a row's quick
   action button. */
function openMailSnoozeMenuAt(rec, anchorEl) {
  if (!anchorEl) { return; }
  const r = anchorEl.getBoundingClientRect();
  openMailSnoozeMenu(rec, r.left, r.bottom + 4);
}

/* ----- The custom return ---------------------------
   A datetime-local field, read as a wall time in
   the snooze zone and prefilled with tomorrow's
   standing choice. A time that is not in the
   future is refused in the dialog, with nothing
   changed: no entry written, no modify sent. */

function openMailSnoozePick(rec) {
  if (!rec) { return; }
  openMailSnoozePickFor([rec]);
}

/* v2.107: the custom return for a target list, the
   dialog itself unchanged. */
function openMailSnoozePickFor(recs) {
  if (!recs || !recs.length) { return; }
  mailSnoozePickCtx = { recs: recs.slice() };
  const input = mailEl("mailSnoozePickInput");
  const err = mailEl("mailSnoozePickError");
  if (err) {
    err.textContent = "";
    err.classList.add("hidden");
  }
  if (input) {
    const t = mailSnoozeChoices(Date.now())[1].until;
    const p = mailSnoozeZoneParts(t);
    const pad = function (n) {
      return (n < 10 ? "0" : "") + n;
    };
    input.value = p.year + "-" + pad(p.month) + "-" +
      pad(p.day) + "T" + pad(p.hour) + ":" +
      pad(p.minute);
  }
  mailEl("mailSnoozePickModal")
    .classList.remove("hidden");
  if (input) { input.focus(); }
}

function closeMailSnoozePick() {
  mailEl("mailSnoozePickModal")
    .classList.add("hidden");
  mailSnoozePickCtx = null;
}

async function confirmMailSnoozePick() {
  const ctx = mailSnoozePickCtx;
  const input = mailEl("mailSnoozePickInput");
  if (!ctx || !input) { return; }
  const err = mailEl("mailSnoozePickError");
  const refuse = function (text) {
    if (err) {
      err.textContent = text;
      err.classList.remove("hidden");
    }
  };
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/
    .exec(String(input.value || ""));
  if (!m) {
    refuse("Pick a date and time first.");
    return;
  }
  const until = mailSnoozeWallToUtcMs(
    parseInt(m[1], 10), parseInt(m[2], 10),
    parseInt(m[3], 10), parseInt(m[4], 10),
    parseInt(m[5], 10));
  if (!(until > Date.now())) {
    refuse("That time has already passed. " +
      "Pick a future time.");
    return;
  }
  const recs = ctx.recs;
  closeMailSnoozePick();
  await mailSnoozeRun(recs, until);
}

/* A drop lands: the message the drag carried, acted on
   by the target it fell on. The Inbox moves the
   message back home (v2.103, behind the undo
   toast); All Mail archives and Trash trashes
   (both behind the undo toast); a user
   label is a move (v2.95, Chris's rule, widened by
   him the same day): from whatever list the drag
   started in, the label applies AND the message
   leaves the Inbox, landing in All Mail under that
   label; a drag that started in another label's list
   removes that label too, the standing Gmail move.
   The whole move stands behind the undo toast. A
   drop on the very label whose list stands open is
   no move at all. A refused write leaves the row
   standing and the write path's toast says the move
   did not happen. */
function mailDropOnTarget(target) {
  const drag = mailDragState;
  mailDragState = null;
  if (!drag) { return; }
  /* v2.107: a drag that carried a selection moves
     the whole selection as one batch. */
  if (drag.ids && drag.ids.length > 1) {
    mailDropBatchOnTarget(drag, target);
    return;
  }
  const rec = mailRowById(drag.id);
  if (!rec) { return; }
  if (target.kind === "folder" && target.id === "inbox") {
    mailMoveToInboxWithUndo(rec);
    return;
  }
  if (target.kind === "folder" && target.id === "all") {
    mailArchiveWithUndo(rec);
    return;
  }
  if (target.kind === "folder" && target.id === "trash") {
    mailTrashWithUndo(rec);
    return;
  }
  if (target.kind === "label") {
    if (mailFolder.kind === "label" &&
        mailFolder.id === target.id) {
      return;
    }
    const add = [target.id];
    /* v2.95: the Inbox comes off on every label
       drop, whatever list the drag started in; a
       drag out of another label's list takes that
       label off too. A drop on a label the message
       already holds stays harmless: the add is a
       no-op on the API's side and the archive half
       is the move asked for. */
    const remove = ["INBOX"];
    if (drag.fromSel &&
        drag.fromSel.kind === "label" &&
        drag.fromSel.id !== target.id) {
      remove.push(drag.fromSel.id);
    }
    mailLabelMoveWithUndo(rec, target, add, remove);
  }
}

/* The drop dress on one folder column row: the drag
   over lights it, the leave and the drop take the
   light back. The folder rows and the label
   rows wear it (the Inbox included, v2.103). */
function mailArmDropTarget(el, target) {
  el.addEventListener("dragover", function (ev) {
    if (!mailDragState) { return; }
    ev.preventDefault();
    if (ev.dataTransfer) {
      ev.dataTransfer.dropEffect = "move";
    }
    el.classList.add("mail-drop-on");
  });
  el.addEventListener("dragleave", function () {
    el.classList.remove("mail-drop-on");
  });
  el.addEventListener("drop", function (ev) {
    ev.preventDefault();
    el.classList.remove("mail-drop-on");
    mailDropOnTarget(target);
  });
}

/* ----- v2.107: list selection, batch actions, ----
   ------- and the row context menu -----------------
   Chris's ask, in his words: select more than one
   email to drag and drop, and a right click menu on
   the list (one or many selected) with Archive,
   Delete, and Snooze. His amendment, also his
   words: "No checkboxes! I just want to use Ctrl
   and Shift to select."

   The selection is a set of message ids held in
   page memory only, living with the list that
   stands (a folder, a label, or a search). A plain
   click opens a message exactly as it always has
   and never touches the set; Ctrl+click (Cmd+click
   on a Mac) toggles one row; Shift+click takes the
   range from the anchor (the last plainly clicked
   or Ctrl-clicked row) to the pressed row, and
   Shift+Ctrl+click adds that range to what stands.
   Draft rows never join: a draft opens its
   composer, it does not triage, the standing rule
   its drag already keeps. Touch has no Ctrl or
   Shift, so on touch the set simply never forms
   and single message behavior is untouched; no
   substitute was added, per Chris's word.

   The batch actions are shared by the selection
   bar, the row menu, and multi drags. One target
   always runs the standing single paths, so a lone
   action is byte for byte the action it was; two
   or more run the batch paths below, which mirror
   the singles' discipline at batch grain: a
   snapshot (the record as it stood, its place in
   every list, and each message's own undo
   arithmetic) taken before the first write, one
   modify per message through the standing
   transport, the apply path settling each accepted
   write, one undo toast covering the messages that
   moved, and a refused message staying put and
   standing outside the undo. Archive and Snooze
   skip a message standing in the Trash (it has no
   Inbox to leave, and a snooze return could never
   surface it), and Delete skips one already there
   (the permission cannot delete forever, so there
   is nothing further for it to do). */

let mailSelection = new Set();
let mailSelectionAnchorId = null;
let mailRowMenuCtx = null;

/* The selected records standing in the current
   list, in the list's own order: the order every
   batch runs in, and the drag's carried order. */
function mailSelectedRecords() {
  const list = mailLists[mailListKey()];
  if (!list || !list.loaded) { return []; }
  return list.rows.filter(function (r) {
    return !r.draftId && mailSelection.has(r.id);
  });
}

/* Forget the selection's members the current list
   no longer holds (a reload, a triage of the
   opened message, a sync refresh): the set lives
   with the list, so what left the list leaves the
   set, and an anchor that left goes with it. */
function mailPruneSelection() {
  if (!mailSelection.size && !mailSelectionAnchorId) {
    return;
  }
  const list = mailLists[mailListKey()];
  if (!list || !list.loaded) { return; }
  const present = {};
  list.rows.forEach(function (r) {
    present[r.id] = true;
  });
  let changed = false;
  mailSelection.forEach(function (id) {
    if (!present[id]) {
      mailSelection.delete(id);
      changed = true;
    }
  });
  if (mailSelectionAnchorId &&
      !present[mailSelectionAnchorId]) {
    mailSelectionAnchorId = null;
    changed = true;
  }
  if (changed) { closeMailRowMenu(); }
}

/* The bar above the list: the count and the three
   actions stand only while a selection stands. */
function renderMailSelBar() {
  const bar = mailEl("mailSelBar");
  if (!bar) { return; }
  const n = mailSelection.size;
  bar.classList.toggle("hidden", n === 0);
  const text = mailEl("mailSelBarText");
  if (text) {
    text.textContent = n + " selected";
  }
}

/* Repaint the picked rows and the bar from the set,
   without a list render: a Ctrl or Shift press
   moves no other furniture. */
function mailPaintSelection() {
  const listEl = mailEl("mailList");
  if (listEl) {
    listEl.querySelectorAll(".mail-row")
      .forEach(function (el) {
        el.classList.toggle("picked",
          mailSelection.has(
            el.getAttribute("data-mail-id")));
      });
  }
  renderMailSelBar();
}

function mailClearSelection() {
  const had = mailSelection.size > 0 ||
    mailSelectionAnchorId !== null;
  mailSelection.clear();
  mailSelectionAnchorId = null;
  if (had) { closeMailRowMenu(); }
  mailPaintSelection();
}

/* Shift's range: from the anchor to the pressed
   row over the list's standing rows, draft rows
   passed over (they never join). With no anchor
   standing, the pressed row anchors and the range
   is itself alone. A plain Shift press replaces
   the set; Shift with Ctrl or Cmd adds to it. The
   anchor itself never moves on a Shift press, so
   repeated presses re-measure from the same row,
   the way Ctrl and Shift behave everywhere. */
function mailSelectRangeTo(id, add) {
  const list = mailLists[mailListKey()];
  if (!list || !list.loaded) { return; }
  const ids = [];
  list.rows.forEach(function (r) {
    if (!r.draftId) { ids.push(r.id); }
  });
  const to = ids.indexOf(id);
  if (to === -1) { return; }
  let from = mailSelectionAnchorId
    ? ids.indexOf(mailSelectionAnchorId) : -1;
  if (from === -1) {
    from = to;
    mailSelectionAnchorId = id;
  }
  if (!add) { mailSelection.clear(); }
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  for (let i = lo; i <= hi; i++) {
    mailSelection.add(ids[i]);
  }
  closeMailRowMenu();
  mailPaintSelection();
}

/* One message's batch snapshot: the record as it
   stood and its place in every list, the undo's
   raw material, exactly the single paths' own. */
function mailBatchSnapItem(rec) {
  return {
    id: rec.id,
    clone: JSON.parse(JSON.stringify(rec)),
    positions: mailCaptureRowPositions(rec.id)
  };
}

/* Run one write per snapshot item, in order,
   collecting the items whose write the API
   accepted. The write answers for itself: it runs
   the transport and, on acceptance, the apply
   path, and reports {ok} or {ok:false, out} with
   the refusal kept for the summary toast. A
   refused message has not moved: its caches stand
   as they stood, so it stays put and stays out of
   the undo. */
async function mailBatchWrite(items, writeOne) {
  const done = [];
  let lastFailOut = null;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const rec = mailRowById(item.id) || item.clone;
    let res = null;
    try {
      res = await writeOne(rec, item);
    } catch (e) { res = null; }
    if (res && res.ok) { done.push(item); }
    else if (res && res.out) { lastFailOut = res.out; }
  }
  return { done: done, lastFailOut: lastFailOut };
}

/* Settle a finished batch: the view re-renders,
   the selection clears (its rows have moved; the
   set would be stale), and the one undo toast
   stands with the counts in its words. When
   nothing moved there is no toast to stand: the
   write path's failure words speak, and the
   selection stays for another try. */
function mailBatchSettle(snap, total, failOut,
    failText) {
  if (state.view && state.view.kind === "email") {
    renderMail();
  }
  if (!snap) {
    mailToastWriteFailure(failOut, failText);
    return false;
  }
  mailClearSelection();
  showMailUndoToast("batch", snap);
  return true;
}

function mailBatchCountText(verb, done, total, tail) {
  return verb + " " + done +
    (done < total ? " of " + total : "") +
    (total === 1 ? " message" : " messages") +
    (tail || "");
}

/* Archive a batch: INBOX comes off each message
   that is not standing in the Trash, one modify
   apiece, one undo restoring each message's
   Inbox exactly as the single archive's does. */
async function mailBatchArchive(recs) {
  const targets = recs.filter(function (r) {
    return r.labelIds.indexOf("TRASH") === -1;
  });
  if (!targets.length) {
    toast("Nothing to archive there.", true);
    return false;
  }
  const items = targets.map(mailBatchSnapItem);
  const res = await mailBatchWrite(items,
    async function (rec) {
      const out = await gmailWrite("POST",
        "/users/me/messages/" +
        encodeURIComponent(rec.id) + "/modify",
        { addLabelIds: [], removeLabelIds: ["INBOX"] });
      if (out.outcome !== "ok") {
        return { ok: false, out: out };
      }
      mailApplyLabelChange(rec.id, [], ["INBOX"],
        false);
      return { ok: true };
    });
  const snap = res.done.length ? {
    batch: true, kind: "batch-archive",
    items: res.done,
    text: mailBatchCountText("Archived",
      res.done.length, items.length)
  } : null;
  return mailBatchSettle(snap, items.length,
    res.lastFailOut,
    "Could not archive those messages.");
}

/* Trash a batch: the trash endpoint per message
   (never a delete), skipping any message already
   standing in the Trash. One undo untrashes the
   whole batch. */
async function mailBatchTrash(recs) {
  const targets = recs.filter(function (r) {
    return r.labelIds.indexOf("TRASH") === -1;
  });
  if (!targets.length) {
    toast("Nothing to move to Trash there.", true);
    return false;
  }
  const items = targets.map(mailBatchSnapItem);
  const res = await mailBatchWrite(items,
    async function (rec) {
      const out = await gmailWrite("POST",
        "/users/me/messages/" +
        encodeURIComponent(rec.id) + "/trash", null);
      if (out.outcome !== "ok") {
        return { ok: false, out: out };
      }
      mailApplyLabelChange(rec.id, ["TRASH"],
        ["INBOX"], true);
      return { ok: true };
    });
  const snap = res.done.length ? {
    batch: true, kind: "batch-trash",
    items: res.done,
    text: mailBatchCountText("Moved",
      res.done.length, items.length, " to Trash")
  } : null;
  return mailBatchSettle(snap, items.length,
    res.lastFailOut,
    "Could not move those messages to trash.");
}

/* A label move for a batch, a multi drag's landing
   on a label: the v2.95 arithmetic per message
   (the label goes on, INBOX comes off, plus the
   source label when the drag started in another
   label's list), each message's undo restoring
   its own exact prior set. */
async function mailBatchLabelMove(recs, target,
    remove) {
  let labelName = target.id;
  (mailLabels || []).forEach(function (l) {
    if (l.id === target.id) { labelName = l.name; }
  });
  const add = [target.id];
  const items = recs.map(function (rec) {
    const item = mailBatchSnapItem(rec);
    const prior = rec.labelIds.slice();
    item.undoAdd = remove.filter(function (l) {
      return prior.indexOf(l) !== -1;
    });
    item.undoRemove = add.filter(function (l) {
      return prior.indexOf(l) === -1;
    });
    return item;
  });
  const res = await mailBatchWrite(items,
    async function (rec) {
      const out = await gmailWrite("POST",
        "/users/me/messages/" +
        encodeURIComponent(rec.id) + "/modify",
        { addLabelIds: add, removeLabelIds: remove });
      if (out.outcome !== "ok") {
        return { ok: false, out: out };
      }
      mailApplyLabelChange(rec.id, add, remove,
        false);
      return { ok: true };
    });
  const snap = res.done.length ? {
    batch: true, kind: "batch-label",
    items: res.done,
    text: mailBatchCountText("Moved",
      res.done.length, items.length,
      " to " + labelName)
  } : null;
  return mailBatchSettle(snap, items.length,
    res.lastFailOut, "That move did not happen.");
}

/* The move back to the Inbox for a batch, a multi
   drag's landing on the Inbox folder: per message
   the v2.103 arithmetic (INBOX goes on, a message
   in the Trash loses TRASH as it comes home,
   every other label stays), a message already
   home is passed over in silence like the
   single's, and each landed message is seated in
   the Inbox list at its date place, the v2.103
   seating repair at batch grain. */
async function mailBatchMoveToInbox(recs) {
  const items = [];
  recs.forEach(function (rec) {
    const prior = rec.labelIds.slice();
    const inTrash = prior.indexOf("TRASH") !== -1;
    if (prior.indexOf("INBOX") !== -1 && !inTrash) {
      return;
    }
    const item = mailBatchSnapItem(rec);
    item.remove = inTrash ? ["TRASH"] : [];
    item.undoAdd = item.remove.filter(function (l) {
      return prior.indexOf(l) !== -1;
    });
    item.undoRemove = ["INBOX"].filter(function (l) {
      return prior.indexOf(l) === -1;
    });
    item.homeward = JSON.parse(JSON.stringify(rec));
    items.push(item);
  });
  if (!items.length) { return false; }
  const res = await mailBatchWrite(items,
    async function (rec, item) {
      const out = await gmailWrite("POST",
        "/users/me/messages/" +
        encodeURIComponent(rec.id) + "/modify",
        { addLabelIds: ["INBOX"],
          removeLabelIds: item.remove });
      if (out.outcome !== "ok") {
        return { ok: false, out: out };
      }
      mailApplyLabelChange(rec.id, ["INBOX"],
        item.remove, false);
      mailSeatRowInInbox(item.homeward, ["INBOX"],
        item.remove);
      return { ok: true };
    });
  const snap = res.done.length ? {
    batch: true, kind: "batch-inbox",
    items: res.done,
    text: mailBatchCountText("Moved",
      res.done.length, items.length, " to Inbox")
  } : null;
  return mailBatchSettle(snap, items.length,
    res.lastFailOut, "That move did not happen.");
}

/* Snooze a batch until one instant, the single
   snooze's discipline at batch grain: ONE merged
   registry write upserts an entry per target
   (every write re-reads the file fresh and merges
   by message id, the standing rule, so the batch
   lands as one change), then one modify per
   message (the Snoozed label on, INBOX off). A
   message whose modify is refused has its entry
   rolled back individually, a replaced prior
   restored, exactly as the single's refusal rolls
   its one entry back. The undo toast names the
   count and the return, and its Undo brings the
   whole batch home. */
async function mailSnoozeMessages(recs, untilMs) {
  const targets = recs.filter(function (r) {
    return r.labelIds.indexOf("TRASH") === -1;
  });
  if (!targets.length) {
    toast("Nothing to snooze there.", true);
    return false;
  }
  const labelId = await mailSnoozeLabelId();
  if (!labelId) {
    toast("Could not snooze those messages.", true);
    return false;
  }
  const entryBase = {
    labelId: labelId,
    snoozeUntil: new Date(untilMs).toISOString(),
    createdAt: new Date().toISOString()
  };
  const ids = targets.map(function (r) { return r.id; });
  const priors = {};
  const written = await mailSnoozeWriteEntries(
    function (entries) {
      const next = entries.filter(function (e) {
        if (ids.indexOf(e.messageId) !== -1) {
          priors[e.messageId] = e;
          return false;
        }
        return true;
      });
      targets.forEach(function (rec) {
        next.push({
          messageId: rec.id,
          threadId: rec.threadId || "",
          labelId: entryBase.labelId,
          snoozeUntil: entryBase.snoozeUntil,
          createdAt: entryBase.createdAt
        });
      });
      return next;
    });
  if (!written) {
    toast("Could not snooze those messages.", true);
    return false;
  }
  ids.forEach(function (id) {
    if (!(id in priors)) { priors[id] = null; }
  });
  const items = targets.map(mailBatchSnapItem);
  const res = await mailBatchWrite(items,
    async function (rec) {
      const out = await gmailWrite("POST",
        "/users/me/messages/" +
        encodeURIComponent(rec.id) + "/modify",
        { addLabelIds: [labelId],
          removeLabelIds: ["INBOX"] });
      if (out.outcome !== "ok") {
        return { ok: false, out: out };
      }
      mailApplyLabelChange(rec.id, [labelId],
        ["INBOX"], false);
      return { ok: true };
    });
  const failedIds = items.filter(function (item) {
    return res.done.indexOf(item) === -1;
  }).map(function (item) { return item.id; });
  if (failedIds.length) {
    await mailSnoozeWriteEntries(
      function (entries) {
        const next = entries.filter(function (e) {
          return failedIds.indexOf(e.messageId) === -1;
        });
        failedIds.forEach(function (id) {
          if (priors[id]) { next.push(priors[id]); }
        });
        return next;
      });
  }
  const donePriors = {};
  res.done.forEach(function (item) {
    donePriors[item.id] = priors[item.id];
  });
  const untilText = mailSnoozeFormatUntil(untilMs);
  const snap = res.done.length ? {
    batch: true, kind: "batch-snooze",
    items: res.done, labelId: labelId,
    priors: donePriors,
    text: mailBatchCountText("Snoozed",
      res.done.length, items.length,
      " until " + untilText)
  } : null;
  return mailBatchSettle(snap, items.length,
    res.lastFailOut,
    "Could not snooze those messages.");
}

/* One snooze ask, any count: a single target runs
   the standing single path; a list runs the
   batch. The snooze menu and its pick dialog both
   land here. */
function mailSnoozeRun(recs, untilMs) {
  if (!recs || !recs.length) {
    return Promise.resolve(false);
  }
  if (recs.length === 1) {
    return mailSnoozeMessage(recs[0], untilMs);
  }
  return mailSnoozeMessages(recs, untilMs);
}

/* Reverse a whole batch: every item's row copies
   go back at their captured places first (so the
   applies that follow settle off standing copies),
   then each reversing write runs; a refused
   reversal takes that message's restored copies
   back out and the summary at the end counts what
   came back honestly. A snooze batch's registry
   follows the modifies, as the single's does: the
   entries the batch wrote come out and the priors
   it replaced go back, in one merged write, for
   the messages whose return the API accepted. */
async function mailUndoBatch(snap) {
  dismissMailUndoToast();
  const landedById = {};
  snap.items.forEach(function (item) {
    const clone = JSON.parse(JSON.stringify(
      item.clone));
    landedById[item.id] = mailRestoreRowPositions(
      clone, item.positions);
  });
  let restored = 0;
  const restoredIds = [];
  for (let i = 0; i < snap.items.length; i++) {
    const item = snap.items[i];
    const path = "/users/me/messages/" +
      encodeURIComponent(item.id);
    let ok = false;
    if (snap.kind === "batch-archive") {
      const out = await gmailWrite("POST",
        path + "/modify",
        { addLabelIds: ["INBOX"],
          removeLabelIds: [] });
      if (out.outcome === "ok") {
        mailApplyLabelChange(item.id, ["INBOX"], [],
          false);
        ok = true;
      }
    } else if (snap.kind === "batch-trash") {
      const out = await gmailWrite("POST",
        path + "/untrash", null);
      if (out.outcome === "ok") {
        mailApplyLabelChange(item.id, [],
          ["TRASH"], true);
        ok = true;
      }
    } else if (snap.kind === "batch-label" ||
        snap.kind === "batch-inbox") {
      const out = await gmailWrite("POST",
        path + "/modify",
        { addLabelIds: item.undoAdd,
          removeLabelIds: item.undoRemove });
      if (out.outcome === "ok") {
        mailApplyLabelChange(item.id, item.undoAdd,
          item.undoRemove, false);
        ok = true;
      }
    } else if (snap.kind === "batch-snooze") {
      const out = await gmailWrite("POST",
        path + "/modify",
        { addLabelIds: ["INBOX"],
          removeLabelIds: [snap.labelId] });
      if (out.outcome === "ok") {
        mailApplyLabelChange(item.id, ["INBOX"],
          [snap.labelId], false);
        ok = true;
      }
    }
    if (ok) {
      restored++;
      restoredIds.push(item.id);
    } else {
      (landedById[item.id] || []).forEach(
        function (key) {
          const list = mailLists[key];
          if (list) {
            list.rows = list.rows.filter(
              function (r) { return r.id !== item.id; });
          }
        });
    }
  }
  if (snap.kind === "batch-snooze" &&
      restoredIds.length) {
    await mailSnoozeWriteEntries(
      function (entries) {
        const next = entries.filter(function (e) {
          return restoredIds.indexOf(e.messageId) === -1;
        });
        restoredIds.forEach(function (id) {
          const prior = snap.priors
            ? snap.priors[id] : null;
          if (prior) { next.push(prior); }
        });
        return next;
      });
  }
  if (state.view && state.view.kind === "email") {
    renderMail();
  }
  if (restored < snap.items.length) {
    toast("Undo restored " + restored + " of " +
      snap.items.length + " messages.", true);
  }
}

/* Run one of the three actions over a target list:
   the bar, the row menu, and nothing else. A lone
   target runs the standing single path, so its
   toast and its undo are the ones it always had. */
function mailRunTargets(recs, action, x, y) {
  if (!recs || !recs.length) { return; }
  if (action === "archive") {
    if (recs.length === 1) {
      mailArchiveWithUndo(recs[0]);
    } else { mailBatchArchive(recs); }
  } else if (action === "trash") {
    if (recs.length === 1) {
      mailTrashWithUndo(recs[0]);
    } else { mailBatchTrash(recs); }
  } else if (action === "snooze") {
    openMailSnoozeMenuFor(recs, x, y);
  }
}

/* A multi drag lands: the whole selection moves by
   the target it fell on, under the standing drop
   semantics per target (the Inbox brings the batch
   home, All Mail archives it, Trash trashes it, a
   label moves it), one undo toast covering the
   batch. A drop on the very label whose list
   stands open is no move at all, as a single's is. */
function mailDropBatchOnTarget(drag, target) {
  const recs = [];
  (drag.ids || []).forEach(function (id) {
    const rec = mailRowById(id);
    if (rec) { recs.push(rec); }
  });
  if (!recs.length) { return; }
  if (target.kind === "folder" &&
      target.id === "inbox") {
    mailBatchMoveToInbox(recs);
    return;
  }
  if (target.kind === "folder" && target.id === "all") {
    mailBatchArchive(recs);
    return;
  }
  if (target.kind === "folder" &&
      target.id === "trash") {
    mailBatchTrash(recs);
    return;
  }
  if (target.kind === "label") {
    if (mailFolder.kind === "label" &&
        mailFolder.id === target.id) {
      return;
    }
    const remove = ["INBOX"];
    if (drag.fromSel &&
        drag.fromSel.kind === "label" &&
        drag.fromSel.id !== target.id) {
      remove.push(drag.fromSel.id);
    }
    mailBatchLabelMove(recs, target, remove);
  }
}

/* ----- The row context menu ------------------------
   A right click on a message row opens the app's
   own menu at the pointer (the browser's never
   stands here; the app suppresses it everywhere):
   Archive, Delete, and Snooze, Chris's three. When
   the pressed row stands in the selection the menu
   acts on the whole selection and its head counts
   it; when it does not, the menu acts on that row
   alone and the standing selection is untouched.
   An action whose whole target set stands in the
   Trash has no meaning (Archive and Snooze need an
   Inbox to leave, and Delete cannot delete
   forever), so a press on trashed mail only opens
   no menu at all. The menu closes on an outside
   press, on Escape, on the list scrolling, on the
   selection changing, and on the view changing,
   the label menu's own discipline throughout. */

function closeMailRowMenu() {
  const menu = mailEl("mailRowMenu");
  if (menu) { menu.classList.add("hidden"); }
  mailRowMenuCtx = null;
  document.removeEventListener("pointerdown",
    onMailRowMenuDocPointerDown, true);
  document.removeEventListener("keydown",
    onMailRowMenuDocKeydown, true);
  const list = mailEl("mailList");
  if (list) {
    list.removeEventListener("scroll",
      onMailRowMenuListScroll);
  }
}

function onMailRowMenuDocPointerDown(ev) {
  const menu = mailEl("mailRowMenu");
  if (menu && ev.target && menu.contains(ev.target)) {
    return;
  }
  closeMailRowMenu();
}

function onMailRowMenuDocKeydown(ev) {
  if (ev.key === "Escape") {
    ev.preventDefault();
    closeMailRowMenu();
  }
}

function onMailRowMenuListScroll() {
  closeMailRowMenu();
}

function openMailRowMenu(rec, x, y) {
  closeMailRowMenu();
  const menu = mailEl("mailRowMenu");
  if (!menu || !rec) { return; }
  const targets = mailSelection.has(rec.id)
    ? mailSelectedRecords() : [rec];
  if (!targets.length) { return; }
  const anyLive = targets.some(function (r) {
    return r.labelIds.indexOf("TRASH") === -1;
  });
  if (!anyLive) { return; }
  const head = mailEl("mailRowMenuHead");
  if (head) {
    head.textContent = targets.length > 1
      ? targets.length + " messages" : "";
    head.classList.toggle("hidden",
      targets.length <= 1);
  }
  /* v2.115: Copy link stands in this menu only when
     it acts on a single message; a selection of two
     or more has no one link to copy, so the item is
     absent there, not merely disabled. */
  const copyBtn = mailEl("mailRowMenuCopyLinkBtn");
  if (copyBtn) {
    copyBtn.classList.toggle("hidden",
      targets.length !== 1);
  }
  mailRowMenuCtx = {
    ids: targets.map(function (r) { return r.id; }),
    x: x, y: y
  };
  menu.classList.remove("hidden");
  placeNoteContextMenu(menu, x, y);
  document.addEventListener("pointerdown",
    onMailRowMenuDocPointerDown, true);
  document.addEventListener("keydown",
    onMailRowMenuDocKeydown, true);
  const list = mailEl("mailList");
  if (list) {
    list.addEventListener("scroll",
      onMailRowMenuListScroll);
  }
  const first = menu.querySelector(".list-menu-item");
  if (first) { first.focus(); }
}

/* One of the menu's three, over the menu's targets:
   the records resolve in the menu's own order, and
   the run goes through mailRunTargets, so a lone
   target keeps its standing single path and its
   standing toast. Snooze opens the standing
   snooze menu where the row menu stood. */
function mailRowMenuRun(action) {
  const ctx = mailRowMenuCtx;
  closeMailRowMenu();
  if (!ctx) { return; }
  const recs = [];
  ctx.ids.forEach(function (id) {
    const rec = mailRowById(id);
    if (rec) { recs.push(rec); }
  });
  mailRunTargets(recs, action, ctx.x, ctx.y);
}

/* v2.115: the row menu's Copy link. The menu's own
   context names its one message (the item stands
   only for a single target; see openMailRowMenu);
   the copy itself is the shared chip copy, carrying
   the @@ chip's own element as the HTML payload. */
function mailRowMenuCopyLink() {
  const ctx = mailRowMenuCtx;
  closeMailRowMenu();
  if (!ctx || ctx.ids.length !== 1) { return; }
  const rec = mailRowById(ctx.ids[0]);
  if (rec) { copyLinkForMail(rec); }
}

/* Copy link for one message: the chip HTML is exactly
   what the @@ mention inserter produces
   (buildMailChipEl, serialized), and the plain text
   is the subject line, the chip's own title. */
function copyLinkForMail(rec) {
  if (!rec) { return; }
  copyChipLink(buildMailChipEl(rec).outerHTML,
    rec.subject || "(No subject)");
}

/* ----- Part 6: the label context menu ------------- */

let mailLabelMenuCtx = null;

function closeMailLabelMenu() {
  const menu = mailEl("mailLabelMenu");
  if (menu) { menu.classList.add("hidden"); }
  mailLabelMenuCtx = null;
  document.removeEventListener("pointerdown",
    onMailLabelMenuDocPointerDown, true);
  document.removeEventListener("keydown",
    onMailLabelMenuDocKeydown, true);
}

function onMailLabelMenuDocPointerDown(ev) {
  const menu = mailEl("mailLabelMenu");
  if (menu && ev.target && menu.contains(ev.target)) {
    return;
  }
  closeMailLabelMenu();
}

function onMailLabelMenuDocKeydown(ev) {
  if (ev.key === "Escape") {
    ev.preventDefault();
    closeMailLabelMenu();
  }
}

function openMailLabelMenu(label, x, y) {
  closeMailLabelMenu();
  const menu = mailEl("mailLabelMenu");
  if (!menu) { return; }
  mailLabelMenuCtx = { id: label.id, name: label.name };
  menu.classList.remove("hidden");
  placeNoteContextMenu(menu, x, y);
  document.addEventListener("pointerdown",
    onMailLabelMenuDocPointerDown, true);
  document.addEventListener("keydown",
    onMailLabelMenuDocKeydown, true);
  const first = menu.querySelector(".list-menu-item");
  if (first) { first.focus(); }
}

/* Rename: the dialog's Save runs labels.update with
   the label's own id and the new name (the id is the
   label's identity; its messages keep it). On the
   API's acceptance the standing record takes the name
   and every surface that speaks it re-renders: the
   folder column, an open list of that label (its
   standing selection and its row chips read the same
   records). A 403 keeps the mail consent handling the
   write paths already speak. */
function openMailLabelRename() {
  const ctx = mailLabelMenuCtx;
  closeMailLabelMenu();
  if (!ctx) { return; }
  mailLabelMenuCtx = ctx;
  const input = mailEl("mailLabelRenameInput");
  if (input) { input.value = ctx.name; }
  mailEl("mailLabelRenameModal").classList.remove("hidden");
  if (input) { input.focus(); }
}

async function saveMailLabelRename() {
  const ctx = mailLabelMenuCtx;
  const input = mailEl("mailLabelRenameInput");
  const name = input ? input.value.trim() : "";
  if (!ctx || !name) { return; }
  const out = await gmailWrite("PUT",
    "/users/me/labels/" + encodeURIComponent(ctx.id),
    { id: ctx.id, name: name });
  mailEl("mailLabelRenameModal").classList.add("hidden");
  mailLabelMenuCtx = null;
  if (out.outcome !== "ok") {
    mailToastWriteFailure(out, "Could not rename that label.");
    return;
  }
  if (mailLabels) {
    mailLabels.forEach(function (l) {
      if (l.id === ctx.id) { l.name = name; }
    });
  }
  if (mailFolder.kind === "label" &&
      mailFolder.id === ctx.id) {
    mailFolder.name = name;
    const list = mailLists[mailListKey()];
    if (list && list.sel && list.sel.kind === "label") {
      list.sel.name = name;
    }
  }
  renderMail();
}

/* Delete: the confirmation names the label and says
   plainly that messages keep their content and only
   lose the label. Confirming runs labels.delete; the
   column forgets the label, its cached list goes with
   it, and an open list of that label falls back to
   the Inbox. */
function openMailLabelDelete() {
  const ctx = mailLabelMenuCtx;
  closeMailLabelMenu();
  if (!ctx) { return; }
  mailLabelMenuCtx = ctx;
  const text = mailEl("mailLabelDeleteText");
  if (text) {
    text.textContent = "Delete the label \"" + ctx.name +
      "\"? Its messages keep their content and only " +
      "lose the label.";
  }
  mailEl("mailLabelDeleteModal").classList.remove("hidden");
}

async function confirmMailLabelDelete() {
  const ctx = mailLabelMenuCtx;
  if (!ctx) { return; }
  const out = await gmailWrite("DELETE",
    "/users/me/labels/" + encodeURIComponent(ctx.id), null);
  mailEl("mailLabelDeleteModal").classList.add("hidden");
  mailLabelMenuCtx = null;
  if (out.outcome !== "ok") {
    mailToastWriteFailure(out, "Could not delete that label.");
    return;
  }
  if (mailLabels) {
    mailLabels = mailLabels.filter(function (l) {
      return l.id !== ctx.id;
    });
  }
  delete mailLists["label:" + ctx.id];
  if (mailFolder.kind === "label" &&
      mailFolder.id === ctx.id) {
    mailChooseSelection({ kind: "folder", id: "inbox" });
    return;
  }
  renderMail();
}

/* ----- Part 7: contacts, the People module -------- */

/* The People API, in the mail module's discipline:
   one base literal, one read transport, the app's own
   Google token. A 401 renews once and retries once
   (through the shared gmailCall-shaped settle below);
   a 403 is this module's own state, independent of
   mail's: contacts are simply not connected yet.
   Contacts live in page memory only: the loaded list
   stands here and nowhere else, never in a Drive
   payload, a store file, or the device snapshot. */
/* v2.90.0: the People API lives on its own host.
   Through v2.89.0 this base put the People path
   on the www.googleapis.com host, which answers
   Google's HTML 404 page for it, so every
   contacts call failed no matter what was
   granted. The Drive, Gmail, and Calendar APIs
   do live under that host, which is how the
   pattern slipped in; the People API does not,
   and its own host is the literal below. */
const PEOPLE_API_BASE = "https://people.googleapis.com/v1";

let peopleStatus = "idle";
let peopleContacts = null;
let peopleLoading = false;

async function peopleApiGet(path, token) {
  const res = await fetch(PEOPLE_API_BASE + path, {
    method: "GET",
    headers: { "Authorization": "Bearer " + token }
  });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { status: res.status, data: data };
}

async function peopleRead(path) {
  let token = null;
  try {
    token = await getGoogleAccessToken();
  } catch (e) {
    if (e && e.code === "GOOGLE_SIGN_IN_REQUIRED") {
      return { outcome: "signed-out", status: 0, data: null };
    }
    return { outcome: "bad", status: 0, data: null };
  }
  let res = null;
  try {
    res = await peopleApiGet(path, token);
    if (res.status === 401) {
      const renewed = await googleTrySilentSignIn();
      if (renewed) {
        const fresh = await getProviderToken("google");
        if (fresh) { res = await peopleApiGet(path, fresh); }
      }
    }
  } catch (e) {
    return { outcome: "bad", status: 0, data: null };
  }
  if (res.status >= 200 && res.status < 300) {
    return { outcome: "ok", status: res.status, data: res.data };
  }
  if (res.status === 403) {
    return { outcome: "forbidden", status: 403, data: res.data };
  }
  return { outcome: "bad", status: res.status, data: res.data };
}

/* Load the contacts once, lazily (the recipient
   fields' first focus or typing asks), paging the
   connections list through to its end with a hard cap
   of three thousand entries. A person stands in the
   list by their first email address; a person with no
   email cannot be a recipient and is skipped. A 403
   settles the module into its not connected state; a
   network failure simply leaves the fields manual and
   lets the next focus ask again. */
async function ensurePeopleContacts() {
  if (peopleContacts || peopleLoading ||
      peopleStatus === "forbidden") {
    return;
  }
  peopleLoading = true;
  const collected = [];
  let pageToken = "";
  let failed = "";
  while (collected.length < 3000) {
    let path = "/people/me/connections" +
      "?personFields=names,emailAddresses&pageSize=1000" +
      "&sortOrder=LAST_MODIFIED_DESCENDING";
    if (pageToken) {
      path += "&pageToken=" + encodeURIComponent(pageToken);
    }
    const out = await peopleRead(path);
    if (out.outcome === "forbidden") {
      failed = "forbidden";
      break;
    }
    if (out.outcome !== "ok" || !out.data) {
      failed = "bad";
      break;
    }
    const conns = Array.isArray(out.data.connections)
      ? out.data.connections : [];
    conns.forEach(function (c) {
      const emails = Array.isArray(c.emailAddresses)
        ? c.emailAddresses : [];
      if (!emails.length || !emails[0].value) { return; }
      const names = Array.isArray(c.names) ? c.names : [];
      collected.push({
        name: names.length && names[0].displayName
          ? String(names[0].displayName) : "",
        email: String(emails[0].value)
      });
    });
    pageToken = out.data.nextPageToken
      ? String(out.data.nextPageToken) : "";
    if (!pageToken) { break; }
  }
  peopleLoading = false;
  if (failed === "forbidden") {
    peopleStatus = "forbidden";
    renderMailContactMenu();
    renderPeopleSettingsRow();
    return;
  }
  if (failed) {
    /* v2.85: a network class failure is its own
       standing state now (the Settings row's
       Unavailable, with its Retry), where through
       v2.84 it simply left the module idle. It does
       not latch: the next ask tries again, exactly
       as it did. */
    peopleStatus = "unavailable";
    renderPeopleSettingsRow();
    return;
  }
  peopleContacts = collected.slice(0, 3000);
  peopleStatus = "ok";
  renderMailContactMenu();
  renderPeopleSettingsRow();
}

/* Forget everything the people module holds: the
   loaded contacts and the standing state, a latched
   forbidden above all. A completed sign in calls it
   (the Contacts consent may have just been granted:
   through v2.84 the forbidden state latched for the
   whole session, so even a cured grant could not
   take effect short of a full reload), and signing
   out calls it (the contacts belong to the account
   that loaded them). */
function resetPeopleState() {
  peopleContacts = null;
  peopleLoading = false;
  peopleStatus = "idle";
  renderPeopleSettingsRow();
}

/* The Settings Contacts row: the calendar and mail
   rows' sibling. Not signed in stands plain, with no
   button and no fetch behind it; Connected counts
   the loaded contacts; the forbidden state reads
   Not connected; a network failure reads Unavailable
   with its Retry standing. Unlike its siblings, its
   Connect button ALWAYS stands while signed in:
   the Contacts permission postdates the standing
   grant on installs that predate it, and this
   button, running the consent forcing sign in, is
   the repair path the module's own surfaces could
   not offer through v2.84. */
function renderPeopleSettingsRow() {
  const statusEl = document.getElementById(
    "settingsPeopleStatus");
  if (!statusEl) { return; }
  const btn = document.getElementById(
    "settingsPeopleConnectBtn");
  const retryBtn = document.getElementById(
    "settingsPeopleRetryBtn");
  if (!mailSignedInAble()) {
    statusEl.textContent = "Not signed in";
    if (btn) { btn.classList.add("hidden"); }
    if (retryBtn) { retryBtn.classList.add("hidden"); }
    return;
  }
  let text = "Not connected";
  let label = "Connect Contacts";
  let showRetry = false;
  if (peopleStatus === "ok" && peopleContacts) {
    const n = peopleContacts.length;
    text = "Connected (" + n +
      (n === 1 ? " contact)" : " contacts)");
    label = "Reconnect Contacts";
  } else if (peopleStatus === "unavailable") {
    text = "Unavailable right now";
    label = "Reconnect Contacts";
    showRetry = true;
  }
  statusEl.textContent = text;
  if (btn) {
    btn.textContent = label;
    btn.classList.remove("hidden");
  }
  if (retryBtn) {
    retryBtn.classList.toggle("hidden", !showRetry);
  }
}

/* The Contacts consent sign in: the one seam every
   Google connection shares (the calendar module's
   connect is the same two lines, and the mail row's
   button calls that one). Arm the fresh flag, so
   the gate goes to /login?fresh=1 and Google's
   consent screen mints a refresh token that carries
   the Contacts scope, then run the navigation. */
function connectPeopleContacts() {
  workerReauthNeeded = true;
  navigateToWorkerLogin();
}

/* The row's Retry: lift the unavailable state and
   ask again. A forbidden state is not retried here;
   its cure is the Connect button's consent. */
function retryPeopleContacts() {
  if (peopleStatus === "unavailable") {
    peopleStatus = "idle";
  }
  renderPeopleSettingsRow();
  ensurePeopleContacts();
}

/* ----- Push notifications: the ssnotes-push module ----------- */

/* Web Push, the app half (v2.86). A second small Worker,
   ssnotes-push, is the server half: it holds the push
   subscriptions of the account's devices in the sign in
   helper's own storage, reads the store's tasks file and
   notes catalog from Drive every five minutes with the
   sign in's stored token, and sends a push when a
   reminder moment arrives, so a notification can reach
   this device with the app closed. This module owns the
   device side of that: registering this device with the
   Worker, the Settings row that reports and tests the
   registration, and the registration's removal when the
   session ends. The service worker owns the display
   and the click (see sw.js). The reminder notifications
   the app raises itself while it is open are untouched
   by all of this.
   Discipline, in the sibling modules' shape: one base
   literal, one transport, and everything page memory
   only. The subscription, its endpoint, and its keys
   are never written to a Drive payload, a store file,
   or the device snapshot; they travel only between the
   browser's own push store and the push Worker's own
   storage. The Worker is spoken to with the session
   token alone, never the Google access token. */
const PUSH_WORKER_BASE = "https://ssnotes-push.clytherin.workers.dev";

/* The module's standing state, in the sibling modules'
   vocabulary: idle (nothing asked yet), registered
   (this device stands registered at the Worker),
   unregistered (this device holds no registration the
   Worker knows), unavailable (the Worker could not be
   reached; the row offers a retry and nothing latches),
   auth (the Worker refused the session; the app's own
   auth paths own what happens next and this module
   simply stops, as the sibling modules stop at a 401),
   unsupported (this browser offers no push). */
let pushStatus = "idle";
let pushWorking = false;

function pushSupported() {
  return "serviceWorker" in navigator &&
    "PushManager" in window && "Notification" in window;
}

function pushPermission() {
  try {
    return String(window.Notification.permission || "default");
  } catch (e) { return "default"; }
}

/* Forget the module's standing state: a completed sign
   in calls it beside its sibling resets (a landing may
   have changed which account, and which session, the
   registration belongs to), and the session end cleanup
   below calls it as it leaves. */
function resetPushState() {
  pushStatus = "idle";
  pushWorking = false;
  renderPushSettingsRow();
}

/* The Settings Push notifications row, the Contacts
   row's sibling in the Connection tab. Not signed in
   stands plain, with no button and no fetch behind it;
   On for this device stands with its Send test; a
   device that can still be registered offers Enable;
   a blocked permission is plain text, since no button
   in the app can lift a browser block; an unreachable
   Worker reads Unavailable with its Retry standing. */
function renderPushSettingsRow() {
  const statusEl = document.getElementById(
    "settingsPushStatus");
  if (!statusEl) { return; }
  const enableBtn = document.getElementById(
    "settingsPushEnableBtn");
  const testBtn = document.getElementById(
    "settingsPushTestBtn");
  const retryBtn = document.getElementById(
    "settingsPushRetryBtn");
  function show(el, on) {
    if (el) { el.classList.toggle("hidden", !on); }
  }
  show(enableBtn, false);
  show(testBtn, false);
  show(retryBtn, false);
  if (!mailSignedInAble()) {
    statusEl.textContent = "Not signed in";
    return;
  }
  if (!pushSupported()) {
    statusEl.textContent = "Not supported in this browser";
    return;
  }
  const perm = pushPermission();
  if (perm === "denied") {
    statusEl.textContent =
      "Blocked in this browser's site settings";
    return;
  }
  if (pushStatus === "unavailable") {
    statusEl.textContent = "Unavailable right now";
    show(retryBtn, true);
    return;
  }
  if (pushStatus === "auth") {
    statusEl.textContent = "Not connected";
    return;
  }
  if (perm === "granted" && pushStatus === "registered") {
    statusEl.textContent = "On for this device";
    show(testBtn, true);
    return;
  }
  statusEl.textContent = "Not enabled on this device";
  show(enableBtn, true);
}

/* One call to the push Worker, under the session token
   (the credential the sign in helper minted; the Google
   access token never speaks to this Worker). Settles
   into the sibling modules' outcome vocabulary; a 401
   is "auth" and stops the module, with no retry loop. */
async function pushWorkerCall(path, body) {
  const session = await getWorkerSession();
  if (!session) {
    return { outcome: "signed-out", status: 0, data: null };
  }
  let res = null;
  try {
    res = await fetch(PUSH_WORKER_BASE + path, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + session,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body || {})
    });
  } catch (e) {
    return { outcome: "bad", status: 0, data: null };
  }
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (res.status >= 200 && res.status < 300) {
    return { outcome: "ok", status: res.status, data: data };
  }
  if (res.status === 401) {
    return { outcome: "auth", status: 401, data: data };
  }
  return { outcome: "bad", status: res.status, data: data };
}

/* The Worker's VAPID public key, the one unauthenticated
   read it offers: the key pushManager.subscribe must be
   handed, as base64url text. Null when the Worker cannot
   be reached or answers nonsense. */
async function pushFetchVapidKey() {
  try {
    const res = await fetch(PUSH_WORKER_BASE + "/vapid");
    if (!res || res.status !== 200) { return null; }
    const data = await res.json();
    return data && typeof data.publicKey === "string" &&
      data.publicKey ? data.publicKey : null;
  } catch (e) { return null; }
}

/* base64url to bytes, the dialect every push value
   travels in (the raw VAPID key above all). */
function pushBase64UrlToBytes(text) {
  let b64 = String(text).replace(/-/g, "+")
    .replace(/_/g, "/");
  while (b64.length % 4) { b64 += "="; }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

/* Whether a standing subscription was made under the
   key the Worker currently offers: a subscription under
   any other key can never be delivered to, so the
   registration flow replaces it. */
function pushServerKeyMatches(subscription, keyBytes) {
  try {
    const current = subscription && subscription.options
      ? subscription.options.applicationServerKey : null;
    if (!current) { return false; }
    const cur = new Uint8Array(current);
    if (cur.length !== keyBytes.length) { return false; }
    for (let i = 0; i < cur.length; i++) {
      if (cur[i] !== keyBytes[i]) { return false; }
    }
    return true;
  } catch (e) { return false; }
}

/* The honest short label the registration carries, so
   the Worker's records (and its test answers) can say
   which device a subscription belongs to. */
function pushDeviceLabel() {
  const ua = String(navigator.userAgent || "");
  if (/iPhone/.test(ua)) { return "iPhone"; }
  if (/iPad/.test(ua)) { return "iPad"; }
  if (/Android/.test(ua)) { return "Android"; }
  return "Desktop";
}

/* The service worker registration the push calls use:
   the app's own cached lookup first (the one its
   notifications already ride), then the browser's
   ready promise, which waits out a first install. */
async function pushGetRegistration() {
  let reg = null;
  try { reg = await getSwRegistration(); }
  catch (e) { reg = null; }
  if (!reg && "serviceWorker" in navigator &&
      navigator.serviceWorker.ready) {
    try { reg = await navigator.serviceWorker.ready; }
    catch (e) { reg = null; }
  }
  return reg;
}

/* Register this device with the push Worker: the flow
   the sign in landing, the connected boot, Settings
   opening, and the row's own buttons all share. It
   proceeds only when the browser offers push and the
   notification permission already stands granted: an
   automatic run never prompts, ever (the row's Enable
   is the one place a prompt may be asked, from its
   click, before it calls this). Idempotent: a standing
   subscription under the Worker's current key is
   simply re-posted, so storage the Worker has lost
   heals on the next landing; a subscription under any
   other key is replaced. A network failure settles the
   module unavailable and never disturbs the boot or
   the sign in that called it; a 401 stops the module
   until the next landing resets it. */
async function ensurePushRegistration() {
  if (pushWorking || pushStatus === "auth") { return; }
  if (!mailSignedInAble()) { return; }
  if (!pushSupported()) {
    if (pushStatus !== "unsupported") {
      pushStatus = "unsupported";
      renderPushSettingsRow();
    }
    return;
  }
  if (pushPermission() !== "granted") {
    if (pushStatus === "registered") {
      pushStatus = "unregistered";
      renderPushSettingsRow();
    }
    return;
  }
  pushWorking = true;
  try {
    const reg = await pushGetRegistration();
    if (!reg || !reg.pushManager) {
      pushStatus = "unsupported";
      return;
    }
    const keyText = await pushFetchVapidKey();
    if (!keyText) { pushStatus = "unavailable"; return; }
    const keyBytes = pushBase64UrlToBytes(keyText);
    let sub = null;
    try { sub = await reg.pushManager.getSubscription(); }
    catch (e) { sub = null; }
    if (sub && !pushServerKeyMatches(sub, keyBytes)) {
      try { await sub.unsubscribe(); }
      catch (e) { /* it is replaced below regardless */ }
      sub = null;
    }
    if (!sub) {
      try {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes
        });
      } catch (e) {
        pushStatus = "unavailable";
        return;
      }
    }
    const out = await pushWorkerCall("/subscribe", {
      subscription: sub.toJSON ? sub.toJSON() : sub,
      label: pushDeviceLabel()
    });
    if (out.outcome === "ok") {
      pushStatus = "registered";
    } else if (out.outcome === "auth") {
      pushStatus = "auth";
    } else if (out.outcome === "signed-out") {
      /* The session went away mid flight; the next
         landing asks again, and nothing here latches. */
    } else {
      pushStatus = "unavailable";
    }
  } catch (e) {
    pushStatus = "unavailable";
  } finally {
    pushWorking = false;
    renderPushSettingsRow();
  }
}

/* The row's Enable: the one place a permission prompt
   may be asked, from this click, as a permission
   request must be (the app's own ask pattern). Granted
   runs the shared registration; any other answer
   simply re-renders the row to the state the browser
   reports. */
async function enablePushFromSettings() {
  if (pushSupported() && pushPermission() === "default") {
    try {
      const pending = window.Notification.requestPermission(
        function () { /* the render reads the outcome */ });
      if (pending && typeof pending.then === "function") {
        await pending;
      }
    } catch (e) {
      /* The render below reports the state as it stands. */
    }
  }
  await ensurePushRegistration();
  renderPushSettingsRow();
}

/* The row's Retry: lift nothing, latch nothing; the
   shared registration simply runs again. */
function retryPushRegistration() {
  if (pushStatus === "unavailable") { pushStatus = "idle"; }
  renderPushSettingsRow();
  ensurePushRegistration();
}

/* The row's Send test: the Worker pushes a test to
   every device this account has registered, and the
   answer is reported plainly: no devices yet, a
   delivery count, or a failure. */
async function sendPushTest() {
  const out = await pushWorkerCall("/test", {});
  if (out.outcome === "ok" && out.data) {
    const n = typeof out.data.subscriptions === "number"
      ? out.data.subscriptions : 0;
    if (n === 0) {
      toast("No devices are registered for push yet.");
      return;
    }
    const results = Array.isArray(out.data.results)
      ? out.data.results : [];
    let accepted = 0;
    results.forEach(function (r) {
      if (r && r.outcome === "accepted") { accepted++; }
    });
    if (accepted > 0) {
      toast("Test notification sent to " + accepted +
        (accepted === 1 ? " device." : " devices."));
    } else {
      toast("The test notification could not be " +
        "delivered.", true);
    }
    return;
  }
  if (out.outcome === "auth") {
    pushStatus = "auth";
    renderPushSettingsRow();
    toast("Push is not connected right now.", true);
    return;
  }
  if (out.outcome === "signed-out") {
    toast("Push is not connected right now.", true);
    return;
  }
  pushStatus = "unavailable";
  renderPushSettingsRow();
  toast("The push service could not be reached.", true);
}

/* The session's end drops this device's push
   registration: the Worker forgets the subscription
   and the browser unsubscribes it locally, both best
   effort. Sign out and Disconnect both run it, while
   the session token still stands to make the call; a
   failure anywhere changes nothing about either. */
async function pushSignOutCleanup() {
  try {
    if (pushSupported()) {
      const reg = await pushGetRegistration();
      if (reg && reg.pushManager) {
        let sub = null;
        try { sub = await reg.pushManager.getSubscription(); }
        catch (e) { sub = null; }
        if (sub) {
          try {
            await pushWorkerCall("/unsubscribe",
              { endpoint: sub.endpoint });
          } catch (e) { /* best effort, like the logout */ }
          try { await sub.unsubscribe(); }
          catch (e) { /* best effort */ }
        }
      }
    }
  } catch (e) { /* best effort throughout */ }
  resetPushState();
}

/* The dropdown's standing state: the field it serves,
   its rows (contacts, or the one not connected note),
   and the highlighted row. */
let mailContactField = null;
let mailContactRows = [];
let mailContactHighlight = 0;

function mailContactFragment(input) {
  const caret = typeof input.selectionStart === "number"
    ? input.selectionStart : input.value.length;
  const upto = input.value.slice(0, caret);
  const comma = upto.lastIndexOf(",");
  const start = comma === -1 ? 0 : comma + 1;
  const raw = upto.slice(start);
  const lead = raw.length - raw.replace(/^\s+/, "").length;
  return {
    text: raw.trim(), fragStart: start + lead,
    caret: caret
  };
}

function closeMailContactMenu() {
  const menu = mailEl("mailContactMenu");
  if (menu) { menu.classList.add("hidden"); }
  mailContactField = null;
  mailContactRows = [];
  mailContactHighlight = 0;
}

/* Paint the dropdown for the standing field: the not
   connected note when the People grant is missing,
   nothing at all while contacts load or the fragment
   is empty (manual typing is never blocked), and up
   to eight matches once they stand. A match is a name
   or an email containing the fragment, case folded. */
function renderMailContactMenu() {
  const menu = mailEl("mailContactMenu");
  const input = mailContactField;
  if (!menu || !input) { return; }
  const frag = mailContactFragment(input);
  if (!frag.text) { closeMailContactMenu(); return; }
  if (peopleStatus === "forbidden") {
    mailContactRows = [];
    menu.innerHTML = "";
    const note = document.createElement("div");
    note.className = "mail-contact-note";
    note.textContent = "Contacts are not connected yet";
    menu.appendChild(note);
    menu.classList.remove("hidden");
    return;
  }
  if (!peopleContacts) {
    menu.classList.add("hidden");
    return;
  }
  const needle = frag.text.toLowerCase();
  mailContactRows = peopleContacts.filter(function (c) {
    return c.name.toLowerCase().indexOf(needle) !== -1 ||
      c.email.toLowerCase().indexOf(needle) !== -1;
  }).slice(0, 8);
  if (!mailContactRows.length) {
    menu.classList.add("hidden");
    return;
  }
  if (mailContactHighlight >= mailContactRows.length) {
    mailContactHighlight = 0;
  }
  menu.innerHTML = "";
  mailContactRows.forEach(function (c, i) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "mail-contact-row" +
      (i === mailContactHighlight ? " current" : "");
    row.setAttribute("data-mail-contact", String(i));
    const nm = document.createElement("span");
    nm.className = "mail-contact-name";
    nm.textContent = c.name || c.email;
    row.appendChild(nm);
    if (c.name) {
      const em = document.createElement("span");
      em.className = "mail-contact-email";
      em.textContent = c.email;
      row.appendChild(em);
    }
    row.addEventListener("mousedown", function (ev) {
      ev.preventDefault();
      pickMailContact(i);
    });
    menu.appendChild(row);
  });
  menu.classList.remove("hidden");
}

/* Stand the dropdown in the field being edited: the
   menu element moves into the field's own wrapper (it
   is styled to park under that field), the load is
   asked for, and the rows paint. */
function mailContactShowFor(input) {
  const menu = mailEl("mailContactMenu");
  if (!menu) { return; }
  const wrap = input.closest(".mail-recip-field");
  if (wrap && menu.parentElement !== wrap) {
    wrap.appendChild(menu);
  }
  mailContactField = input;
  mailContactHighlight = 0;
  ensurePeopleContacts();
  renderMailContactMenu();
}

/* Pick a suggestion: the fragment being typed is
   replaced by the frozen format, a named contact as
   Name <email> and an unnamed one as the bare email,
   with the manual separator after it, and the caret
   lands past the separator ready for the next name. */
function pickMailContact(i) {
  const input = mailContactField;
  const c = mailContactRows[i];
  if (!input || !c) { return; }
  const frag = mailContactFragment(input);
  const insert = (c.name
    ? c.name + " <" + c.email + ">" : c.email) + ", ";
  input.value = input.value.slice(0, frag.fragStart) +
    insert + input.value.slice(frag.caret);
  const at = frag.fragStart + insert.length;
  closeMailContactMenu();
  input.focus();
  if (input.setSelectionRange) {
    input.setSelectionRange(at, at);
  }
}

/* The recipient fields' keys: while the dropdown
   stands, the arrows walk it, Enter and Tab pick, and
   Escape closes; every other key is the field's own,
   and the compose dialog's keys never see the ones
   the dropdown took. Runs on the capture phase at the
   field, ahead of the dialog's own handlers. */
function onMailContactKeydown(ev) {
  const menu = mailEl("mailContactMenu");
  if (!menu || menu.classList.contains("hidden") ||
      !mailContactRows.length) {
    if (ev.key === "Escape") { closeMailContactMenu(); }
    return;
  }
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    ev.stopPropagation();
    const n = mailContactRows.length;
    mailContactHighlight =
      ((mailContactHighlight +
        (ev.key === "ArrowDown" ? 1 : -1)) % n + n) % n;
    renderMailContactMenu();
  } else if (ev.key === "Enter" || ev.key === "Tab") {
    ev.preventDefault();
    ev.stopPropagation();
    pickMailContact(mailContactHighlight);
  } else if (ev.key === "Escape") {
    ev.preventDefault();
    ev.stopPropagation();
    closeMailContactMenu();
  }
}

/* Wire the three recipient fields once: focus and
   typing stand the dropdown (and ask the lazy load),
   and a blur that is not a pick lets it close. */
function initMailContactFields() {
  ["mailToInput", "mailCcInput", "mailBccInput"]
    .forEach(function (id) {
      const input = mailEl(id);
      if (!input) { return; }
      input.addEventListener("focus", function () {
        mailContactShowFor(input);
      });
      input.addEventListener("input", function () {
        mailContactShowFor(input);
      });
      input.addEventListener("keydown", onMailContactKeydown,
        true);
      input.addEventListener("blur", function () {
        setTimeout(function () {
          if (mailContactField === input) {
            closeMailContactMenu();
          }
        }, 120);
      });
    });
}

/* ----- Part 8: email link chips ------------------- */

const MAIL_CHIP_ICON =
  "<svg viewBox=\"0 0 20 20\" width=\"13\" height=\"13\" " +
  "fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" " +
  "stroke-linecap=\"round\" stroke-linejoin=\"round\" " +
  "aria-hidden=\"true\"><rect x=\"2.5\" y=\"4\" width=\"15\" " +
  "height=\"12\" rx=\"1.6\"/><path d=\"M3 5.5l7 5.5 7-5.5\"/>" +
  "</svg>";

/* Build an email chip: an atomic island in the note
   body carrying the message id alone as data; its face
   is the envelope glyph, the sender's display name,
   and the subject. The face is only what the note knew
   when the chip was made; no mail content is copied. */
function buildMailChipEl(rec) {
  const chip = document.createElement("span");
  chip.className = "ss-mail-chip";
  chip.setAttribute("contenteditable", "false");
  chip.setAttribute("data-ss-mail-id", rec.id);
  chip.title = rec.subject || "(No subject)";
  const icon = document.createElement("span");
  icon.className = "ss-mail-chip-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = MAIL_CHIP_ICON;
  chip.appendChild(icon);
  const label = document.createElement("span");
  label.className = "ss-mail-chip-label";
  label.textContent =
    (rec.fromName || rec.fromAddress || "") + " · " +
    (rec.subject || "(No subject)");
  chip.appendChild(label);
  return chip;
}

/* Pick from the @@ popup: the chip replaces the @@
   token, with the trailing space every mention insert
   leaves, and the editor's dirty flag is the receipt. */
function insertMentionMailChip(rec) {
  const trig = mentionTrigger;
  /* v2.105.0: the chip lands in the token's host, the
     Scratch Pad included; there the pad persist is
     the receipt instead of a note's dirty flag. */
  const bodyEl = trig && trig.host === "scratch"
    ? scratchPadEl()
    : document.getElementById("noteBody");
  closeMentionPopup();
  if (!trig || !bodyEl || !bodyEl.contains(trig.node)) {
    return;
  }
  const chip = buildMailChipEl(rec);
  const end = Math.min(trig.caretOffset,
    trig.node.nodeValue ? trig.node.nodeValue.length : 0);
  const range = document.createRange();
  range.setStart(trig.node, trig.atOffset);
  range.setEnd(trig.node, end);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  range.deleteContents();
  range.insertNode(chip);
  const space = document.createTextNode(" ");
  chip.after(space);
  placeCaretIn(space, 1);
  if (trig.host === "scratch") {
    persistScratchPadFromDom();
  } else {
    markDirty();
  }
}

/* v2.86 (Part E): where an opened message lives, in
   the reading pane's own words: the Inbox when it
   carries INBOX, else a standing system folder when
   one applies (Sent, Drafts, Spam, Trash), then one
   chip per user label the message carries, and All
   Mail only when nothing else applies. Read off the
   open record's standing labels on every render, so
   the words follow an archive, a trash, or a label
   change made from the pane itself. */
function mailLocationNames(full) {
  const names = [];
  const ids = full && full.labelIds ? full.labelIds : [];
  const has = function (x) {
    return ids.indexOf(x) !== -1;
  };
  if (has("INBOX")) { names.push("Inbox"); }
  else if (has("SENT")) { names.push("Sent"); }
  else if (has("DRAFT")) { names.push("Drafts"); }
  else if (has("SPAM")) { names.push("Spam"); }
  else if (has("TRASH")) { names.push("Trash"); }
  mailUserLabels().forEach(function (l) {
    if (has(l.id)) { names.push(l.name); }
  });
  if (!names.length) { names.push("All Mail"); }
  return names;
}

/* v2.86 (Part E): the selection an email chip's
   message opens under: the message's first user
   label (in the label list's own order) when it
   carries one, else All Mail when it is not in the
   Inbox, else the Inbox. Chip only: opening from a
   list or a search keeps the standing selection. */
function mailChipTargetSelection(rec) {
  const ids = rec && rec.labelIds ? rec.labelIds : [];
  const labels = mailUserLabels();
  for (let i = 0; i < labels.length; i++) {
    if (ids.indexOf(labels[i].id) !== -1) {
      return { kind: "label", id: labels[i].id,
        name: labels[i].name };
    }
  }
  if (ids.indexOf("INBOX") === -1) {
    return { kind: "folder", id: "all" };
  }
  return { kind: "folder", id: "inbox" };
}

/* Follow an email chip: the message is fetched
   directly by its id first, so a message that is gone
   is a plain toast and the note is left exactly as it
   stands; a standing message opens in the Email view,
   under the selection its own location names (Part
   E): its first user label, else All Mail when it is
   not in the Inbox, else the Inbox. */
async function followMailChip(chip) {
  const id = chip.getAttribute("data-ss-mail-id") || "";
  if (!id) { return; }
  const out = await gmailRead("/users/me/messages/" +
    encodeURIComponent(id) + "?format=metadata");
  if (out.status === 404) {
    toast("That email no longer exists");
    return;
  }
  if (out.outcome !== "ok") {
    mailSettleLoadOutcome(out);
    toast("Could not load that email.", true);
    return;
  }
  const rec = normalizeMailRow(out.data);
  if (!mailLabels && !mailLabelsLoading) {
    await loadMailLabels();
  }
  state.view = { kind: "email", value: null };
  renderAll();
  setMobileView("list");
  mailChooseSelection(mailChipTargetSelection(rec));
  openMailMessage(id);
}

/* The @@ popup's search: one messages.list ask with
   the typed words as its q (no q while nothing is
   typed, so the popup opens on the newest mail), then
   each answer read in metadata form, the list loader's
   own shape. Resolves the rows, or the consent word
   when the standing grant does not cover mail.
   v2.105.0: the words are also matched against the
   user's label names (the label list is loaded first
   when it has not been): every label whose name
   contains the words earns its own ask, by labelIds,
   and its carriers join the rows, so searching a
   label's name lists the mail carrying it. The asks
   merge by message id, the rows sort newest first as
   they always have, and the picker keeps its eight. */
async function mentionMailSearch(query) {
  if (!mailLabels && !mailLabelsLoading) {
    await loadMailLabels();
  }
  const asks = [];
  let rawPath = "/users/me/messages?maxResults=8";
  if (query) {
    rawPath += "&q=" + encodeURIComponent(query);
  }
  asks.push(rawPath);
  if (query) {
    const needle = String(query).toLowerCase();
    mailUserLabels().forEach(function (l) {
      if (l.name.toLowerCase().indexOf(needle) !== -1) {
        asks.push("/users/me/messages?maxResults=8" +
          "&labelIds=" + encodeURIComponent(l.id));
      }
    });
  }
  const ids = [];
  let sawOk = false;
  for (const path of asks) {
    const out = await gmailRead(path);
    if (out.outcome === "forbidden") {
      mailSettleLoadOutcome(out);
      return { outcome: "consent", rows: [] };
    }
    if (out.outcome !== "ok" || !out.data) { continue; }
    sawOk = true;
    const items = Array.isArray(out.data.messages)
      ? out.data.messages : [];
    items.forEach(function (m) {
      if (m && m.id && ids.indexOf(m.id) === -1) {
        ids.push(m.id);
      }
    });
  }
  if (!sawOk) { return { outcome: "bad", rows: [] }; }
  const rows = [];
  await Promise.all(ids.map(async function (id) {
    const got = await gmailRead("/users/me/messages/" +
      encodeURIComponent(id) +
      "?format=metadata&metadataHeaders=From" +
      "&metadataHeaders=Subject&metadataHeaders=Date");
    if (got.outcome !== "ok" || !got.data) { return; }
    const rec = normalizeMailRow(got.data);
    if (rec) { rows.push(rec); }
  }));
  rows.sort(function (a, b) { return b.dateMs - a.dateMs; });
  return { outcome: "ok", rows: rows.slice(0, 8) };
}

/* ---------------- the Home Email widget ------------- */

/* Stand in the Email view at the Inbox (the widget
   header's destination, and the message rows' first
   step). */
function openMailInbox() {
  state.view = { kind: "email", value: null };
  renderAll();
  setMobileView("list");
  mailChooseSelection({ kind: "folder", id: "inbox" });
}

/* Open one message in the Email view (a widget row's
   destination). */
function openMailOnMessage(id) {
  openMailInbox();
  openMailMessage(id);
}

/* The Home Email widget: the card the v2.82.0 workshop
   drew and that build's brief left out. The header
   carries the Inbox unread count and opens the Email
   view at the Inbox; the body lists the five most
   recent unread Inbox messages (a click opens the
   message), or the state's own words: the not
   connected line with its Connect button, the
   unavailable line, the quiet loading line, or No
   unread mail. Mail is asked for through the mail
   module's lazy load and read from its page memory
   caches; signed out, nothing is fetched and no error
   shows, only the sign in hint. */
function buildHomeEmailWidget() {
  const parts = homeWidgetShell("email", "Email");
  parts.head.classList.add("home-email-head");
  parts.head.title = "Open Email";
  parts.head.addEventListener("click", function () {
    if (homeCustomSession) { return; }
    openMailInbox();
  });
  if (mailStatus === "ok") {
    const unread = mailInboxUnread();
    if (typeof unread === "number" && unread > 0) {
      const pill = document.createElement("span");
      pill.className = "home-mail-count";
      pill.textContent = unread + " unread";
      parts.head.appendChild(pill);
    }
  }
  if (!mailSignedInAble()) {
    parts.body.appendChild(
      homeHint("Sign in to see your mail."));
    return parts.widget;
  }
  if (mailStatus === "needs-consent") {
    const line = document.createElement("div");
    line.className = "home-mail-connect";
    const text = document.createElement("span");
    text.textContent = "Gmail is not connected";
    line.appendChild(text);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn small";
    btn.textContent = "Connect";
    btn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      connectGoogleCalendar();
    });
    line.appendChild(btn);
    parts.body.appendChild(line);
    return parts.widget;
  }
  if (mailStatus === "unavailable") {
    parts.body.appendChild(homeHint("Gmail unavailable"));
    return parts.widget;
  }
  const inboxKey = mailListKey({ kind: "folder", id: "inbox" });
  const inboxList = mailLists[inboxKey];
  if (!inboxList || !inboxList.loaded) {
    if (mailFolder.kind === "folder" &&
        mailFolder.id === "inbox") {
      ensureMailLoaded();
    } else {
      mailChooseSelection({ kind: "folder", id: "inbox" });
    }
    parts.body.appendChild(homeHint("Loading..."));
    return parts.widget;
  }
  const unreadRows = inboxList.rows.filter(function (r) {
    return r.unread;
  }).slice(0, 5);
  if (!unreadRows.length) {
    parts.body.appendChild(homeHint("No unread mail"));
    return parts.widget;
  }
  unreadRows.forEach(function (rec) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "home-mail-row";
    row.setAttribute("data-mail-id", rec.id);
    const from = document.createElement("span");
    from.className = "home-mail-from";
    from.textContent = rec.fromName || rec.fromAddress;
    row.appendChild(from);
    const subj = document.createElement("span");
    subj.className = "home-mail-subject";
    subj.textContent = rec.subject || "(No subject)";
    row.appendChild(subj);
    const time = document.createElement("span");
    time.className = "home-mail-time";
    time.textContent = mailRowTimeLabel(rec);
    row.appendChild(time);
    row.addEventListener("click", function () {
      openMailOnMessage(rec.id);
    });
    parts.body.appendChild(row);
  });
  return parts.widget;
}

/* ---------------- v2.82: Email, the Gmail client ----
   The Email view: a full Gmail client inside the app,
   designed with Chris in his 2026-11-01 workshop and
   built on the calendar connection's rails. The sidebar
   gains an Email entry directly under Home; the view
   keeps the app sidebar standing and carries its own
   folder column (a folder picker on the phone), a
   message list, and a reading pane. It reads, searches,
   triages (mark read or unread, archive, labels, trash;
   never a permanent delete, which the sign in's
   gmail.modify permission cannot perform anyway),
   composes, replies, forwards, keeps drafts on Gmail,
   sends, and can file one message as a note.

   The rules, mirroring the calendar module's:

   - The token is the app's own Google access token,
     from the one token source (getGoogleAccessToken).
     Every read goes through gmailApiGet and every
     write through gmailApiSend, both against the one
     API base below; a static scan of this file (part
     of the build's test record) proves the Gmail write
     verbs reach the API only through gmailApiSend. A
     401 runs the standing silent renewal once and
     retries once. A 403 is this module's own consent
     state, distinct from the calendar's: either can be
     connected while the other is not. Anything else
     failed is the unavailable state.
   - Mail data lives in page memory only: the label
     list, the per-folder and per-search list caches,
     the open message, and the account's own address
     (asked for once, for Reply all). Nothing
     mail-shaped is written to Drive, to the notes
     store's files, or to the device snapshot; the one
     exception is Save to note, which files a message
     as a note through the ordinary creation path when,
     and only when, its button is clicked.
   - Message bodies are shown only after the app's own
     web clip sanitizer has cleaned them, and remote
     images stay blocked until the message's own Show
     images action loads them.
   - The consent route is the calendar module's seam
     (connectGoogleCalendar): it arms the fresh flag
     and runs the one navigation, and the sign in it
     starts asks for every permission the sign-in
     helper offers, mail included. Nothing in this
     module ever navigates on its own. */

const GMAIL_API_BASE = "https://www.googleapis.com/gmail/v1";

/* The standing folders, in the column's order. Each
   maps to the messages.list labelIds it stands for;
   All Mail names none (the API's default listing
   already leaves spam and trash out, which is the
   all-mail reading). Drafts lists through the drafts
   endpoints instead (see mailFetchListPage). */
const MAIL_FOLDERS = [
  { id: "inbox", name: "Inbox", label: "INBOX" },
  { id: "sent", name: "Sent", label: "SENT" },
  { id: "drafts", name: "Drafts", label: "DRAFT" },
  { id: "all", name: "All Mail", label: null },
  { id: "trash", name: "Trash", label: "TRASH" }
];

/* The module's standing state. mailStatus is one of
   "idle" (nothing asked yet, or signed out), "ok",
   "needs-consent", or "unavailable". mailFolder is
   the standing selection: {kind: "folder", id} for a
   standing folder, {kind: "label", id, name} for one
   of the user's labels, {kind: "search", q} for a
   search. The rest is page memory only, per the
   header: the label list once loaded, the account's
   own address, the list caches by their key, the
   open message and its reading state, and the load
   guards that keep renders from multiplying fetches. */
let mailStatus = "idle";
let mailLabels = null;
/* v2.95: the Inbox unread count, held on its own:
   the number the badge, the folder column, the
   Settings row, and the Home widget all speak. It
   is written by the one read that carries it (a
   labels.get on the INBOX label, see
   mailFetchInboxUnread) and by the label change
   accounting beside an accepted write, and by
   nothing else. Null while no true number stands:
   never loaded, or the last ask failed. */
let mailUnreadCount = null;
let mailUnreadFetchInFlight = false;
let mailOwnAddress = "";
let mailFolder = { kind: "folder", id: "inbox" };
let mailLists = {};
let mailOpenId = null;
let mailOpenFull = null;
let mailShowImages = false;
let mailLabelsLoading = false;
let mailListLoadingKey = "";
let mailCompose = null;

/* A mail credential stands when the same trio the
   calendar module reads stands: a Worker session in
   memory or in its store, or a recorded provider
   token. When none stands the user is signed out and
   the module stays silent. */
function mailSignedInAble() {
  if (workerSessionToken || loadWorkerSessionBlob()) {
    return true;
  }
  const blob = loadProviderTokenBlob();
  return !!(blob && blob.google);
}

function mailFolderDef(id) {
  for (let i = 0; i < MAIL_FOLDERS.length; i++) {
    if (MAIL_FOLDERS[i].id === id) { return MAIL_FOLDERS[i]; }
  }
  return MAIL_FOLDERS[0];
}

/* The cache key a selection's list stands under. */
function mailListKey(sel) {
  if (!sel) { sel = mailFolder; }
  if (sel.kind === "label") { return "label:" + sel.id; }
  if (sel.kind === "search") { return "search:" + sel.q; }
  return "folder:" + sel.id;
}

/* The selection's display name (a folder's own name,
   a label's name, or the search's wording). */
function mailSelectionName(sel) {
  if (!sel) { sel = mailFolder; }
  if (sel.kind === "label") { return sel.name || "Label"; }
  if (sel.kind === "search") {
    return "Search: " + sel.q;
  }
  return mailFolderDef(sel.id).name;
}

/* The one label a selection lists by, or null for the
   selections that list without one (All Mail, a
   search): the standing folder's label, or a user
   label's own id. */
function mailSelectionLabel(sel) {
  if (!sel) { sel = mailFolder; }
  if (sel.kind === "label") { return sel.id; }
  if (sel.kind === "folder") {
    return mailFolderDef(sel.id).label;
  }
  return null;
}

/* Whether a message record belongs in a selection's
   list, from its standing labels: a labelled selection
   holds the messages carrying its label; All Mail
   holds everything the API's default listing holds
   (nothing in spam or trash); a search's membership
   is the API's own answer and is not re-derived here
   (search rows stand as fetched). */
function mailRowInSelection(rec, sel) {
  if (!rec) { return false; }
  if (sel.kind === "search") { return true; }
  const label = mailSelectionLabel(sel);
  if (label) {
    if (rec.labelIds.indexOf(label) === -1) {
      return false;
    }
    /* v2.84 (Part 5): a labelled list, like
       Gmail's own label views, never shows a
       trashed message: the label alone used to
       decide membership, so a message trashed
       from a label's list still belonged there
       and its row never left, which read as a
       dead Trash button. The Trash folder's own
       label is the one exception. */
    if (label !== "TRASH" &&
        rec.labelIds.indexOf("TRASH") !== -1) {
      return false;
    }
    return true;
  }
  return rec.labelIds.indexOf("TRASH") === -1 &&
    rec.labelIds.indexOf("SPAM") === -1;
}

/* The Inbox label record, standing in the loaded
   label list, or null before it loads. */
function mailInboxLabel() {
  if (!mailLabels) { return null; }
  for (let i = 0; i < mailLabels.length; i++) {
    if (mailLabels[i].id === "INBOX") {
      return mailLabels[i];
    }
  }
  return null;
}

/* The Inbox unread count the badge and the folder
   column speak. Through v2.94.0 this read the INBOX
   label record's messagesUnread as the label list
   load had mapped it, and that mapping defaulted
   the field to zero: the labels.list answer does
   not carry the counts at all (Google's reference
   for users.labels.list gives each label only an
   id, name, messageListVisibility,
   labelListVisibility, and type, and names
   labels.get as the read that fetches the rest),
   so the count stood at zero however much unread
   mail stood in the Inbox, and the badge, written
   only for a nonzero count, never showed. The
   count now lives in its own store (mailUnreadCount
   above), fed by the labels.get read below; the
   label record still mirrors it for any reader of
   the record itself. Null while unknown. */
function mailInboxUnread() {
  if (typeof mailUnreadCount === "number") {
    return mailUnreadCount;
  }
  const lab = mailInboxLabel();
  return lab ? lab.messagesUnread : null;
}

function mailSetInboxUnread(n) {
  const value = Math.max(0, n || 0);
  mailUnreadCount = value;
  const lab = mailInboxLabel();
  if (lab) {
    lab.messagesUnread = value;
  }
}

/* v2.95: ask for the Inbox unread count on its own:
   one labels.get on the INBOX label, the light read
   that carries the counts, with no message list
   loaded and no label list needed. It is asked for
   at the sign in landing, on the auto-sync tick's
   cadence, at every completed sync, inside the
   label list load (to correct the figure that load
   cannot carry), and after a mail action's accepted
   write settles, so the number follows the API's
   word. A forbidden answer raises the module's
   consent state like any load; a failed ask clears
   the standing number, so the badge shows nothing
   rather than a stale count. */
async function mailFetchInboxUnread() {
  if (mailUnreadFetchInFlight) { return; }
  if (!mailSignedInAble()) { return; }
  if (mailStatus === "needs-consent") { return; }
  mailUnreadFetchInFlight = true;
  const out = await gmailRead("/users/me/labels/INBOX");
  mailUnreadFetchInFlight = false;
  if (out.outcome === "ok" && out.data &&
      typeof out.data.messagesUnread === "number") {
    mailSetInboxUnread(out.data.messagesUnread);
    updateMailBadge();
    renderMailSettingsRow();
    return;
  }
  if (out.outcome === "forbidden") {
    mailSetStatus("needs-consent");
    return;
  }
  if (out.outcome === "signed-out") {
    mailSetStatus("idle");
    return;
  }
  if (mailUnreadCount !== null) {
    mailUnreadCount = null;
    updateMailBadge();
    renderMailSettingsRow();
  }
}

/* One Gmail API read. Resolves with the status and
   the parsed body (null when the body does not
   parse); a network failure rejects, and the caller
   reads that as the unavailable outcome. */
async function gmailApiGet(path, token) {
  const res = await fetch(GMAIL_API_BASE + path, {
    method: "GET",
    headers: { "Authorization": "Bearer " + token }
  });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { status: res.status, data: data };
}

/* One Gmail API write, the transport every triage,
   compose, draft, and send goes through: the method,
   a JSON body when the call carries one, and the
   same lenient answer reading as the read transport.
   Resolves with the status and the parsed body; a
   network failure rejects, and the caller reads that
   as its bad outcome. */
async function gmailApiSend(method, path, bodyObj, token) {
  const opts = {
    method: method,
    headers: { "Authorization": "Bearer " + token }
  };
  if (bodyObj) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(bodyObj);
  }
  const res = await fetch(GMAIL_API_BASE + path, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { status: res.status, data: data };
}

/* One Gmail call, settled into the module's outcome
   words: "ok" (a success status), "forbidden" (a
   403: the standing grant does not cover mail, this
   module's consent state), "signed-out" (no token is
   coming until a sign in), or "bad" (a network
   failure or any other answer). A 401 runs the
   standing silent renewal once and retries once, the
   calendar loader's own discipline; a second 401 is
   bad. Reads ride gmailApiGet and writes gmailApiSend,
   so the scan's rule (write verbs only through
   gmailApiSend) holds by construction. */
async function gmailCall(method, path, bodyObj) {
  let token = null;
  try {
    token = await getGoogleAccessToken();
  } catch (e) {
    if (e && e.code === "GOOGLE_SIGN_IN_REQUIRED") {
      return { outcome: "signed-out", status: 0, data: null };
    }
    return { outcome: "bad", status: 0, data: null };
  }
  const attempt = function (tok) {
    return method === "GET"
      ? gmailApiGet(path, tok)
      : gmailApiSend(method, path, bodyObj, tok);
  };
  let res = null;
  try {
    res = await attempt(token);
    if (res.status === 401) {
      const renewed = await googleTrySilentSignIn();
      if (renewed) {
        const fresh = await getProviderToken("google");
        if (fresh) { res = await attempt(fresh); }
      }
    }
  } catch (e) {
    return { outcome: "bad", status: 0, data: null };
  }
  if (res.status >= 200 && res.status < 300) {
    return { outcome: "ok", status: res.status, data: res.data };
  }
  if (res.status === 403) {
    return { outcome: "forbidden", status: 403, data: res.data };
  }
  if (res.status === 401) {
    return { outcome: "bad", status: 401, data: res.data };
  }
  return { outcome: "bad", status: res.status, data: res.data };
}

function gmailRead(path) {
  return gmailCall("GET", path, null);
}

function gmailWrite(method, path, bodyObj) {
  return gmailCall(method, path, bodyObj || null);
}

/* Settle a load outcome into the standing state: a
   forbidden answer raises this module's consent
   state, a bad one the unavailable state, and a
   signed-out answer returns the module to its idle
   silence (the gate owns sign in). Returns true when
   the caller may go on (its answer was ok). */
function mailSettleLoadOutcome(outcome) {
  if (outcome.outcome === "ok") { return true; }
  if (outcome.outcome === "forbidden") {
    mailSetStatus("needs-consent");
  } else if (outcome.outcome === "signed-out") {
    mailSetStatus("idle");
  } else {
    mailSetStatus("unavailable");
  }
  return false;
}

function mailSetStatus(next) {
  if (mailStatus === next) {
    renderMailSettingsRow();
    return;
  }
  mailStatus = next;
  renderMailSettingsRow();
  updateMailBadge();
  if (state.view && state.view.kind === "email") {
    renderMail();
  }
  if (state.view && state.view.kind === "home") {
    renderAll();
  }
}

/* Forget everything the module holds. A completed
   sign in calls it (a consent may have just changed
   what the API will answer), and a sync calls the
   refresh below. The standing selection survives: it
   names where the user is standing, not what Google
   answered. */
function resetMailState() {
  mailLabels = null;
  /* v2.95: the count belongs to the account and the
     landing that loaded it; a reset forgets it too. */
  mailUnreadCount = null;
  mailOwnAddress = "";
  mailLists = {};
  mailOpenId = null;
  mailOpenFull = null;
  mailShowImages = false;
  mailLabelsLoading = false;
  mailListLoadingKey = "";
  /* v2.100: the snooze registry's working copy
     belongs to the account too; a landing forgets
     it, and the next read asks Drive again. */
  mailSnoozeEntries = [];
  mailSnoozeLoaded = false;
  if (mailStatus !== "idle") {
    mailStatus = "idle";
    renderMailSettingsRow();
    updateMailBadge();
  }
}

/* A completed sync refreshes the mail with everything
   else: forget the caches and, when the Email view
   stands, ask again. The consent state is left
   standing: only a sign in reopens it, and its
   Connect button is the path. */
function refreshMailAfterSync() {
  if (mailStatus === "needs-consent") { return; }
  const wasOpen = state.view && state.view.kind === "email";
  resetMailState();
  if (wasOpen) { ensureMailLoaded(); }
  /* v2.95: open view or not, the badge's count is
     asked for again on its own light read, so a
     completed sync leaves a live number standing. */
  mailFetchInboxUnread();
  /* v2.100: and the snooze schedule reconciles with
     the same landing: this hook is where a sign in's
     load settles, with the store standing, so due
     returns are restored as the app opens. */
  mailSnoozeReconcile();
}

/* The surfaces' one ask: make sure the labels and the
   standing selection's list are on their way. Starts
   the loads unless they stand, are already in flight,
   the consent state stands (only a sign in reopens
   it), or nobody is signed in. */
function ensureMailLoaded() {
  if (!mailSignedInAble()) { return; }
  if (mailStatus === "needs-consent") { return; }
  if (!mailLabels) {
    loadMailLabels();
    return;
  }
  const key = mailListKey();
  const list = mailLists[key];
  if ((!list || !list.loaded) &&
      mailListLoadingKey !== key) {
    loadMailList(key, false);
  }
}

/* The label list (the folder column's user labels and
   the badge's unread count ride on it), then the
   account's own address, asked for once per session
   and non-fatally (Reply all simply keeps every
   recipient until it is known), then the standing
   list. */
async function loadMailLabels() {
  if (mailLabelsLoading) { return; }
  mailLabelsLoading = true;
  const out = await gmailRead("/users/me/labels");
  mailLabelsLoading = false;
  if (!mailSettleLoadOutcome(out)) { return; }
  const items = out.data && Array.isArray(out.data.labels)
    ? out.data.labels : [];
  mailLabels = items.map(function (raw) {
    return {
      id: String(raw.id || ""),
      name: String(raw.name || raw.id || ""),
      type: String(raw.type || ""),
      messagesUnread: typeof raw.messagesUnread === "number"
        ? raw.messagesUnread : 0
    };
  }).filter(function (l) { return !!l.id; });
  /* v2.95: the list answer carries no counts (see
     mailInboxUnread), so the INBOX figure the map
     just defaulted is corrected from the one read
     that carries it, before the state settles and
     the badge is written. */
  await mailFetchInboxUnread();
  mailSetStatus("ok");
  updateMailBadge();
  if (state.view && state.view.kind === "email") {
    renderMail();
  }
  /* v2.83: the Home Email widget reads these caches;
     a landing load repaints Home too. */
  if (state.view && state.view.kind === "home") {
    renderHome();
  }
  if (!mailOwnAddress) {
    gmailRead("/users/me/profile").then(function (prof) {
      if (prof.outcome === "ok" && prof.data &&
          prof.data.emailAddress) {
        mailOwnAddress = String(prof.data.emailAddress);
      }
    }).catch(function () { /* non-fatal, per the header */ });
  }
  const key = mailListKey();
  if (!mailLists[key] || !mailLists[key].loaded) {
    loadMailList(key, false);
  }
}

/* One page of a selection's list: the messages (or,
   in Drafts, the drafts, whose rows are their
   messages in metadata form), each settled into the
   module's row shape. Appending keeps the standing
   rows and adds the page's; a fresh load replaces
   them. The page token the API returns is the Load
   more button's standing. */
async function loadMailList(key, append) {
  if (mailListLoadingKey === key) { return; }
  mailListLoadingKey = key;
  const sel = mailFolder;
  let list = mailLists[key];
  if (!list) {
    list = mailLists[key] = {
      rows: [], nextPageToken: null, loaded: false,
      sel: sel
    };
  }
  list.sel = sel;
  const pageToken = append ? list.nextPageToken : null;
  const out = await mailFetchListPage(sel, pageToken);
  if (mailListLoadingKey === key) { mailListLoadingKey = ""; }
  if (!out) { return; }
  if (!append) { list.rows = []; }
  out.rows.forEach(function (rec) {
    const at = list.rows.findIndex(function (r) {
      return r.id === rec.id;
    });
    if (at === -1) { list.rows.push(rec); }
    else { list.rows[at] = rec; }
  });
  list.nextPageToken = out.nextPageToken;
  list.loaded = true;
  if (state.view && state.view.kind === "email" &&
      mailListKey() === key) {
    renderMail();
  }
  /* v2.83: the Home Email widget, as above. */
  if (state.view && state.view.kind === "home") {
    renderHome();
  }
  updateMailBadge();
}

/* The API half of one list page, or null when the
   load settled into a standing state instead (the
   outcome rules above). The Drafts folder lists
   drafts and reads each draft's message in metadata
   form, so its rows carry the draft id beside the
   message id (opening one opens the draft, not the
   message). Every other selection lists messages by
   its label or its search words, then reads each in
   metadata form with the three headers the rows
   speak. */
async function mailFetchListPage(sel, pageToken) {
  const isDrafts = sel.kind === "folder" && sel.id === "drafts";
  let ids = [];
  let nextPageToken = null;
  if (isDrafts) {
    let path = "/users/me/drafts?maxResults=50";
    if (pageToken) {
      path += "&pageToken=" + encodeURIComponent(pageToken);
    }
    const out = await gmailRead(path);
    if (!mailSettleLoadOutcome(out)) { return null; }
    const items = out.data && Array.isArray(out.data.drafts)
      ? out.data.drafts : [];
    ids = items.map(function (d) {
      return {
        draftId: String(d.id || ""),
        messageId: d.message ? String(d.message.id || "") : ""
      };
    }).filter(function (x) { return !!x.messageId; });
    nextPageToken = out.data && out.data.nextPageToken
      ? String(out.data.nextPageToken) : null;
  } else {
    let path = "/users/me/messages?maxResults=50";
    const label = mailSelectionLabel(sel);
    if (sel.kind === "search") {
      path += "&q=" + encodeURIComponent(sel.q);
    } else if (label) {
      path += "&labelIds=" + encodeURIComponent(label);
    }
    if (pageToken) {
      path += "&pageToken=" + encodeURIComponent(pageToken);
    }
    const out = await gmailRead(path);
    if (!mailSettleLoadOutcome(out)) { return null; }
    const items = out.data && Array.isArray(out.data.messages)
      ? out.data.messages : [];
    ids = items.map(function (m) {
      return { draftId: null, messageId: String(m.id || "") };
    }).filter(function (x) { return !!x.messageId; });
    nextPageToken = out.data && out.data.nextPageToken
      ? String(out.data.nextPageToken) : null;
  }
  const rows = [];
  await Promise.all(ids.map(async function (entry) {
    const path = isDrafts
      ? "/users/me/drafts/" + encodeURIComponent(entry.draftId) +
        "?format=metadata&metadataHeaders=From" +
        "&metadataHeaders=Subject&metadataHeaders=Date"
      : "/users/me/messages/" +
        encodeURIComponent(entry.messageId) +
        "?format=metadata&metadataHeaders=From" +
        "&metadataHeaders=Subject&metadataHeaders=Date";
    const out = await gmailRead(path);
    if (out.outcome !== "ok" || !out.data) { return; }
    const raw = isDrafts ? out.data.message : out.data;
    if (!raw) { return; }
    const rec = normalizeMailRow(raw);
    if (!rec) { return; }
    rec.draftId = entry.draftId;
    rows.push(rec);
  }));
  /* The list answer's order is the API's (newest
     first); Promise.all settles its reads in its own
     order, so the page is re-sorted by the messages'
     own internal dates, newest first. */
  rows.sort(function (a, b) { return b.dateMs - a.dateMs; });
  return { rows: rows, nextPageToken: nextPageToken };
}

/* A message's headers as a name-to-value map, names
   lowercased (the API's casing is its own). */
function mailHeaderMap(raw) {
  const map = {};
  const headers = raw && raw.payload &&
    Array.isArray(raw.payload.headers)
    ? raw.payload.headers : [];
  headers.forEach(function (h) {
    if (h && h.name) {
      map[String(h.name).toLowerCase()] =
        String(h.value || "");
    }
  });
  return map;
}

/* A From header's display name and address: the name
   the sender wrote (quotes stripped), falling back
   to the address itself, which is also the fallback
   when the header is a bare address. */
function mailParseFrom(value) {
  const text = String(value || "").trim();
  const m = /^(.*)<([^>]+)>\s*$/.exec(text);
  if (m) {
    const name = m[1].trim()
      .replace(/^"|"$/g, "").trim();
    return {
      name: name || m[2].trim(),
      address: m[2].trim()
    };
  }
  return { name: text, address: text };
}

/* Whether any part of the payload carries a filename
   (the row's paperclip), walking the part tree. */
function mailPayloadHasAttachment(part) {
  if (!part) { return false; }
  if (part.filename) { return true; }
  const parts = Array.isArray(part.parts) ? part.parts : [];
  return parts.some(mailPayloadHasAttachment);
}

/* Settle one raw message (metadata or full form) into
   the module's row shape, or null when it carries no
   id. The date is the API's internalDate (its own
   arrival order), the snippet its own words. */
function normalizeMailRow(raw) {
  if (!raw || !raw.id) { return null; }
  const headers = mailHeaderMap(raw);
  const from = mailParseFrom(headers.from || "");
  const labelIds = Array.isArray(raw.labelIds)
    ? raw.labelIds.map(String) : [];
  return {
    id: String(raw.id),
    draftId: null,
    threadId: String(raw.threadId || ""),
    snippet: String(raw.snippet || ""),
    labelIds: labelIds,
    fromName: from.name,
    fromAddress: from.address,
    subject: headers.subject || "",
    dateMs: Number(raw.internalDate) || 0,
    unread: labelIds.indexOf("UNREAD") !== -1,
    hasAttachment: mailPayloadHasAttachment(raw.payload)
  };
}

/* A row's time words: the local time of day on the
   day itself, the app's date words on any other day
   (the calendar module's label helpers, reused). */
function mailRowTimeLabel(rec) {
  const d = new Date(rec.dateMs);
  const today = taskTodayParts();
  if (d.getFullYear() === today.y &&
      d.getMonth() + 1 === today.m &&
      d.getDate() === today.d) {
    return gcalTimeOfDayLabel(rec.dateMs);
  }
  return taskDateLabel(gcalLocalDayStr(d));
}

/* The user's own labels (type "user"), sorted the
   way the sidebar sorts names. */
function mailUserLabels() {
  if (!mailLabels) { return []; }
  return mailLabels.filter(function (l) {
    return l.type === "user";
  }).sort(function (a, b) {
    return compareSidebarNames(a.name, b.name);
  });
}

/* A message's chips: its user labels' names, in the
   label list's own order. */
function mailRowLabelNames(rec) {
  const users = mailUserLabels();
  const names = [];
  users.forEach(function (l) {
    if (rec.labelIds.indexOf(l.id) !== -1) {
      names.push(l.name);
    }
  });
  return names;
}

/* The sidebar badge and the rail dot: the Inbox
   unread count once a true number stands, nothing
   while signed out or in the consent state. Through
   v2.94.0 the gate also demanded the module's ok
   state, which only a mail surface's load raises,
   so a count could not stand at the landing even
   had one been fetched; the number is now asked for
   at the landing itself (mailFetchInboxUnread),
   and the gate asks only that somebody is signed in
   and no consent state stands. Called whenever the
   counts or the state move. */
function updateMailBadge() {
  const pill = document.getElementById("countEmail");
  const dot = document.getElementById("railEmailDot");
  const n = mailSignedInAble() &&
      mailStatus !== "needs-consent"
    ? mailInboxUnread() : null;
  if (pill) {
    /* v2.84 (Part 1): the expanded item reads
       Email - (n) beside its label, the suffix
       standing where the count pill stood; at
       zero the item is plain Email again. */
    pill.textContent = n ? " - (" + n + ")" : "";
  }
  if (dot) {
    dot.classList.toggle("hidden", !n);
  }
}

/* The Settings Connection row's standing state,
   mirroring the calendar row: Connected with the
   Inbox unread count, Not connected (its Connect
   button standing only in the consent state, where a
   click is the cure), or Unavailable. */
function renderMailSettingsRow() {
  const statusEl = document.getElementById(
    "settingsMailStatus");
  if (!statusEl) { return; }
  const btn = document.getElementById(
    "settingsMailConnectBtn");
  let text = "Not connected";
  let showBtn = false;
  if (mailStatus === "ok") {
    const n = mailInboxUnread();
    text = "Connected" + (n === null ? ""
      : " (" + n + " unread)");
  } else if (mailStatus === "needs-consent") {
    text = "Not connected";
    showBtn = true;
  } else if (mailStatus === "unavailable") {
    text = "Unavailable right now";
  }
  statusEl.textContent = text;
  if (btn) { btn.classList.toggle("hidden", !showBtn); }
}

function mailEl(id) { return document.getElementById(id); }

/* The Email view's render: the panel states (signed
   out, not connected) stand in place of the layout;
   every other state renders the layout, with the
   unavailable line standing over it when the last
   load failed. Renders are cheap and idempotent: the
   loaders guard the fetches, so a render never
   multiplies them. */
function renderMail() {
  const pane = mailEl("mailpane");
  if (!pane) { return; }
  const signedIn = mailSignedInAble();
  const panel = mailEl("mailPanel");
  const layout = mailEl("mailLayout");
  const showPanel = !signedIn ||
    mailStatus === "needs-consent";
  if (panel) {
    panel.classList.toggle("hidden", !showPanel);
  }
  if (layout) {
    layout.classList.toggle("hidden", showPanel);
  }
  if (showPanel) {
    const text = mailEl("mailPanelText");
    const connect = mailEl("mailPanelConnectBtn");
    if (text) {
      text.textContent = signedIn
        ? "Gmail is not connected"
        : "Sign in to see your mail.";
    }
    if (connect) {
      connect.classList.toggle("hidden", !signedIn);
    }
    return;
  }
  const statusLine = mailEl("mailStatusLine");
  if (statusLine) {
    const un = mailStatus === "unavailable";
    statusLine.classList.toggle("hidden", !un);
    if (un) {
      const span = mailEl("mailStatusText");
      if (span) { span.textContent = "Gmail unavailable"; }
    }
  }
  renderMailFolders();
  renderMailList();
  renderMailRead();
}

/* The folder column and the phone's folder picker:
   the standing folders (Inbox with its unread
   count), a divider, then the user's labels. The
   active selection carries the highlight; a search
   leaves nothing highlighted, standing in the picker
   as its own line. */
function renderMailFolders() {
  const list = mailEl("mailFolderList");
  const picker = mailEl("mailFolderPicker");
  const sel = mailFolder;
  function activeFolder(id) {
    return sel.kind === "folder" && sel.id === id;
  }
  function activeLabel(id) {
    return sel.kind === "label" && sel.id === id;
  }
  if (list) {
    list.innerHTML = "";
    MAIL_FOLDERS.forEach(function (f) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mail-folder" +
        (activeFolder(f.id) ? " active" : "");
      btn.setAttribute("data-mail-folder", f.id);
      const name = document.createElement("span");
      name.textContent = f.name;
      btn.appendChild(name);
      if (f.id === "inbox") {
        const n = mailInboxUnread();
        if (n) {
          const count = document.createElement("span");
          count.className = "count count-pill";
          count.textContent = String(n);
          btn.appendChild(count);
        }
      }
      btn.addEventListener("click", function () {
        mailChooseSelection({ kind: "folder", id: f.id });
      });
      /* v2.103: the Inbox is a drop target too: a
         drop on it moves the message back home. */
      mailArmDropTarget(btn,
        { kind: "folder", id: f.id });
      list.appendChild(btn);
    });
    const labels = mailUserLabels();
    if (labels.length) {
      const div = document.createElement("div");
      div.className = "mail-folder-divider";
      list.appendChild(div);
      labels.forEach(function (l) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "mail-folder" +
          (activeLabel(l.id) ? " active" : "");
        btn.setAttribute("data-mail-label", l.id);
        btn.textContent = l.name;
        btn.addEventListener("click", function () {
          mailChooseSelection({ kind: "label", id: l.id,
            name: l.name });
        });
        btn.addEventListener("contextmenu",
          function (ev) {
            ev.preventDefault();
            openMailLabelMenu(l, ev.clientX, ev.clientY);
          });
        mailArmDropTarget(btn,
          { kind: "label", id: l.id });
        list.appendChild(btn);
      });
    }
  }
  if (picker) {
    picker.innerHTML = "";
    if (sel.kind === "search") {
      const opt = document.createElement("option");
      opt.value = "__search";
      opt.textContent = "Search results";
      picker.appendChild(opt);
    }
    MAIL_FOLDERS.forEach(function (f) {
      const opt = document.createElement("option");
      opt.value = "folder:" + f.id;
      opt.textContent = f.name;
      picker.appendChild(opt);
    });
    mailUserLabels().forEach(function (l) {
      const opt = document.createElement("option");
      opt.value = "label:" + l.id;
      opt.textContent = l.name;
      picker.appendChild(opt);
    });
    picker.value = sel.kind === "search" ? "__search"
      : sel.kind === "label" ? "label:" + sel.id
      : "folder:" + sel.id;
  }
}

/* Stand in a selection: the standing folder, label,
   or search changes; its list loads if it has not;
   the view re-renders. Choosing the selection that
   already stands just re-renders. */
function mailChooseSelection(sel) {
  mailFolder = sel;
  mailOpenId = null;
  mailOpenFull = null;
  /* v2.107: standing somewhere new ends the
     selection that lived with the old list. */
  mailClearSelection();
  closeMailLabelsMenu();
  const pane = mailEl("mailpane");
  if (pane) { pane.classList.remove("mail-show-read"); }
  renderMail();
  ensureMailLoaded();
}

/* The list pane: the standing selection's rows, its
   loading and empty words, and the Load more button
   while a further page stands. The search field is
   static furniture above it and is not touched here,
   so a render never eats what is being typed. */
function renderMailList() {
  const listEl = mailEl("mailList");
  if (!listEl) { return; }
  /* v2.107: the selection lives with this list:
     what a reload, a triage, or a refresh took out
     of it leaves the set, and the bar follows. */
  mailPruneSelection();
  renderMailSelBar();
  const clearBtn = mailEl("mailSearchClearBtn");
  if (clearBtn) {
    clearBtn.classList.toggle("hidden",
      mailFolder.kind !== "search");
  }
  const key = mailListKey();
  const list = mailLists[key];
  listEl.innerHTML = "";
  const empty = mailEl("mailEmpty");
  const more = mailEl("mailLoadMoreBtn");
  if (!list || !list.loaded) {
    if (empty) {
      empty.textContent = mailListLoadingKey === key
        ? "Loading..." : "";
      empty.classList.toggle("hidden",
        mailListLoadingKey !== key);
    }
    if (more) { more.classList.add("hidden"); }
    return;
  }
  list.rows.forEach(function (rec) {
    listEl.appendChild(buildMailRowEl(rec));
  });
  if (empty) {
    empty.textContent = "No messages here.";
    empty.classList.toggle("hidden", list.rows.length > 0);
  }
  if (more) {
    more.classList.toggle("hidden", !list.nextPageToken);
  }
}

/* One message row: the unread dot and bold words, the
   sender, the subject (its fallback is the display's,
   like the calendar's), the snippet, the time, the
   paperclip when a part carries a filename, and the
   message's user label chips. On desktop the hover
   quick actions stand at the row's right: archive,
   trash, and mark read or unread. A click opens the
   message (in Drafts, the draft). */
function buildMailRowEl(rec) {
  const el = document.createElement("div");
  el.className = "mail-row" + (rec.unread ? " unread" : "") +
    (mailOpenId === rec.id ? " selected" : "") +
    /* v2.107: a row standing in the Ctrl/Shift
       selection wears the picked dress. */
    (mailSelection.has(rec.id) ? " picked" : "");
  el.setAttribute("data-mail-id", rec.id);
  /* v2.84 (Part 3): a message row drags (a draft
     row does not: it opens the composer, it does
     not triage). The drag carries the message id
     and the selection it started in, which the
     label move reads. */
  if (!rec.draftId) {
    el.setAttribute("draggable", "true");
    el.addEventListener("dragstart", function (ev) {
      /* v2.107: dragging a row that stands in the
         selection carries the whole selection, in
         the list's order, and the drag's picture is
         a badge counting the messages; dragging any
         other row carries that row alone, exactly
         as it always has, and the selection is
         untouched. */
      const multi = mailSelection.has(rec.id) &&
        mailSelection.size > 1;
      mailDragState = {
        id: rec.id,
        ids: multi
          ? mailSelectedRecords().map(function (r) {
              return r.id;
            })
          : [rec.id],
        fromSel: {
          kind: mailFolder.kind,
          id: mailFolder.id || null
        }
      };
      if (ev.dataTransfer) {
        ev.dataTransfer.effectAllowed = "move";
        try {
          ev.dataTransfer.setData("text/plain", rec.id);
        } catch (e) { /* the state above is the record */ }
        if (multi &&
            typeof ev.dataTransfer.setDragImage ===
              "function") {
          const badge = document.createElement("div");
          badge.className = "mail-drag-badge";
          badge.id = "mailDragBadge";
          badge.textContent = mailSelection.size +
            " messages";
          document.body.appendChild(badge);
          try {
            ev.dataTransfer.setDragImage(badge, 0, 0);
          } catch (e) { /* the row's own ghost serves */ }
        }
      }
    });
    el.addEventListener("dragend", function () {
      mailDragState = null;
      const badge = document.getElementById(
        "mailDragBadge");
      if (badge && badge.parentNode) {
        badge.parentNode.removeChild(badge);
      }
      document.querySelectorAll(
        ".mail-folder.mail-drop-on")
        .forEach(function (t) {
          t.classList.remove("mail-drop-on");
        });
    });
  }
  const dot = document.createElement("span");
  dot.className = "mail-dot" + (rec.unread ? "" : " off");
  dot.setAttribute("aria-hidden", "true");
  el.appendChild(dot);
  const main = document.createElement("div");
  main.className = "mail-row-main";
  const top = document.createElement("div");
  top.className = "mail-row-top";
  const from = document.createElement("span");
  from.className = "mail-row-from";
  from.textContent = rec.fromName || rec.fromAddress;
  top.appendChild(from);
  const time = document.createElement("span");
  time.className = "mail-row-time";
  time.textContent = mailRowTimeLabel(rec);
  top.appendChild(time);
  main.appendChild(top);
  const subject = document.createElement("div");
  subject.className = "mail-row-subject";
  subject.textContent = rec.subject || "(No subject)";
  main.appendChild(subject);
  const snippet = document.createElement("div");
  snippet.className = "mail-row-snippet";
  snippet.textContent = rec.snippet;
  main.appendChild(snippet);
  const names = mailRowLabelNames(rec);
  if (names.length || rec.hasAttachment) {
    const chips = document.createElement("div");
    chips.className = "mail-row-chips";
    names.forEach(function (n) {
      const chip = document.createElement("span");
      chip.className = "mail-chip";
      chip.textContent = n;
      chips.appendChild(chip);
    });
    if (rec.hasAttachment) {
      const clip = document.createElement("span");
      clip.className = "mail-clip";
      clip.title = "Has attachments";
      clip.setAttribute("aria-label", "Has attachments");
      clip.innerHTML = "<svg viewBox=\"0 0 24 24\" " +
        "width=\"13\" height=\"13\" fill=\"none\" " +
        "stroke=\"currentColor\" stroke-width=\"2\" " +
        "stroke-linecap=\"round\" stroke-linejoin=\"round\" " +
        "aria-hidden=\"true\"><path d=\"M21 12.5l-8.5 8.5" +
        "a5.5 5.5 0 0 1-7.8-7.8L13 5a3.7 3.7 0 0 1 5.2 " +
        "5.2l-8.2 8.2a1.85 1.85 0 0 1-2.6-2.6L15.5 7\"/>" +
        "</svg>";
      chips.appendChild(clip);
    }
    main.appendChild(chips);
  }
  el.appendChild(main);
  const actions = document.createElement("span");
  actions.className = "mail-row-actions";
  [["archive", "Archive", mailIconArchive()],
   ["trash", "Move to trash", mailIconTrash()],
   ["snooze", "Snooze", mailIconClock()],
   ["mark", rec.unread ? "Mark as read" : "Mark as unread",
     mailIconMail()]].forEach(function (spec) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mail-row-action";
    btn.setAttribute("data-mail-act", spec[0]);
    btn.title = spec[1];
    btn.setAttribute("aria-label", spec[1]);
    btn.innerHTML = spec[2];
    btn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      mailRowQuickAction(rec, spec[0], btn);
    });
    actions.appendChild(btn);
  });
  el.appendChild(actions);
  el.addEventListener("click", function (ev) {
    /* v2.107: a Shift press takes the range from
       the anchor (adding, with Ctrl or Cmd held
       too); a Ctrl or Cmd press without Shift
       toggles the row in the selection without
       opening it, and anchors the ranges there; a
       plain press opens the message exactly as it
       always has, never touching the selection,
       and anchors. Draft rows keep their plain
       behavior throughout: they open the composer
       and never select. */
    if (!rec.draftId && ev.shiftKey) {
      /* Shift leads: with Ctrl or Cmd held too the
         range adds, without it replaces. */
      ev.preventDefault();
      mailSelectRangeTo(rec.id,
        !!(ev.ctrlKey || ev.metaKey));
      return;
    }
    if (!rec.draftId && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      mailSelectionAnchorId = rec.id;
      if (mailSelection.has(rec.id)) {
        mailSelection.delete(rec.id);
      } else {
        mailSelection.add(rec.id);
      }
      closeMailRowMenu();
      mailPaintSelection();
      return;
    }
    if (!rec.draftId) {
      mailSelectionAnchorId = rec.id;
    }
    if (rec.draftId) { openMailDraft(rec); }
    else { openMailMessage(rec.id); }
  });
  /* v2.107: a right press on the row opens the row
     menu at the pointer; a draft row answers with
     silence (it has no triage to offer), and the
     browser's own menu never stands here. */
  el.addEventListener("contextmenu", function (ev) {
    ev.preventDefault();
    if (rec.draftId) { return; }
    openMailRowMenu(rec, ev.clientX, ev.clientY);
  });
  return el;
}

function mailIconArchive() {
  return "<svg viewBox=\"0 0 20 20\" width=\"15\" " +
    "height=\"15\" fill=\"none\" stroke=\"currentColor\" " +
    "stroke-width=\"1.6\" stroke-linecap=\"round\" " +
    "stroke-linejoin=\"round\" aria-hidden=\"true\">" +
    "<rect x=\"2.5\" y=\"3\" width=\"15\" height=\"4\" " +
    "rx=\"1\"/><path d=\"M4 7v8a1.5 1.5 0 0 0 1.5 1.5h9" +
    "A1.5 1.5 0 0 0 16 15V7M8 10h4\"/></svg>";
}

function mailIconTrash() {
  return "<svg viewBox=\"0 0 20 20\" width=\"15\" " +
    "height=\"15\" fill=\"none\" stroke=\"currentColor\" " +
    "stroke-width=\"1.6\" stroke-linecap=\"round\" " +
    "stroke-linejoin=\"round\" aria-hidden=\"true\">" +
    "<path d=\"M3 5h14M8 5V3.5A.5.5 0 0 1 8.5 3h3a.5.5 " +
    "0 0 1 .5.5V5M5 5l.8 11a1.5 1.5 0 0 0 1.5 1.4h5.4" +
    "A1.5 1.5 0 0 0 14.2 16L15 5M8.3 8.5v5M11.7 " +
    "8.5v5\"/></svg>";
}

function mailIconClock() {
  return "<svg viewBox=\"0 0 20 20\" width=\"15\" " +
    "height=\"15\" fill=\"none\" stroke=\"currentColor\" " +
    "stroke-width=\"1.6\" stroke-linecap=\"round\" " +
    "stroke-linejoin=\"round\" aria-hidden=\"true\">" +
    "<circle cx=\"10\" cy=\"10\" r=\"7.5\"/>" +
    "<path d=\"M10 5.8V10l3 2\"/></svg>";
}

function mailIconMail() {
  return "<svg viewBox=\"0 0 20 20\" width=\"15\" " +
    "height=\"15\" fill=\"none\" stroke=\"currentColor\" " +
    "stroke-width=\"1.6\" stroke-linecap=\"round\" " +
    "stroke-linejoin=\"round\" aria-hidden=\"true\">" +
    "<rect x=\"2.5\" y=\"4\" width=\"15\" height=\"12\" " +
    "rx=\"1.6\"/><path d=\"M3 5.5l7 5.5 7-5.5\"/></svg>";
}

/* A row's hover quick action, run against the row's
   own record through the same write paths the
   reading view uses. */
function mailRowQuickAction(rec, act, anchorEl) {
  if (act === "archive") {
    mailArchiveWithUndo(rec);
  } else if (act === "trash") {
    mailTrashWithUndo(rec);
  } else if (act === "snooze") {
    openMailSnoozeMenuAt(rec, anchorEl);
  } else if (act === "mark") {
    if (rec.unread) {
      mailModifyMessage(rec, [], ["UNREAD"], "mark");
    } else {
      mailModifyMessage(rec, ["UNREAD"], [], "mark");
    }
  }
}

/* Apply a label change the API has accepted to every
   cached copy of a message, and to the standing
   counts: its label set moves, its unread flag
   follows, and rows fall out of the lists they no
   longer belong to (a search's rows stand as
   fetched, per mailRowInSelection, except when the
   change was a trash or an untrash, which visibly
   moves the message out of wherever it stood). */
function mailApplyLabelChange(id, add, remove, dropFromSearch) {
  /* The Inbox unread count moves once per change,
     however many cached lists carry a copy of the
     message: the first copy settles it, from whether
     the message stood unread in the Inbox before the
     change and stands so after (a mark, an archive,
     a trash, an untrash all read off that one
     before and after). */
  let countSettled = false;
  Object.keys(mailLists).forEach(function (key) {
    const list = mailLists[key];
    list.rows.forEach(function (rec) {
      if (rec.id !== id) { return; }
      const wasUnreadInInbox = rec.unread &&
        rec.labelIds.indexOf("INBOX") !== -1;
      add.forEach(function (l) {
        if (rec.labelIds.indexOf(l) === -1) {
          rec.labelIds.push(l);
        }
      });
      remove.forEach(function (l) {
        const at = rec.labelIds.indexOf(l);
        if (at !== -1) { rec.labelIds.splice(at, 1); }
      });
      rec.unread = rec.labelIds.indexOf("UNREAD") !== -1;
      if (!countSettled) {
        countSettled = true;
        const isUnreadInInbox = rec.unread &&
          rec.labelIds.indexOf("INBOX") !== -1;
        if (wasUnreadInInbox && !isUnreadInInbox) {
          mailSetInboxUnread((mailInboxUnread() || 0) - 1);
        } else if (!wasUnreadInInbox && isUnreadInInbox) {
          mailSetInboxUnread((mailInboxUnread() || 0) + 1);
        }
      }
    });
    list.rows = list.rows.filter(function (rec) {
      if (rec.id !== id) { return true; }
      if (list.sel && list.sel.kind === "search") {
        return !dropFromSearch;
      }
      return mailRowInSelection(rec, list.sel || mailFolder);
    });
  });
  if (mailOpenFull && mailOpenFull.id === id) {
    add.forEach(function (l) {
      if (mailOpenFull.labelIds.indexOf(l) === -1) {
        mailOpenFull.labelIds.push(l);
      }
    });
    remove.forEach(function (l) {
      const at = mailOpenFull.labelIds.indexOf(l);
      if (at !== -1) { mailOpenFull.labelIds.splice(at, 1); }
    });
    mailOpenFull.unread =
      mailOpenFull.labelIds.indexOf("UNREAD") !== -1;
  }
  updateMailBadge();
  /* v2.95: the local accounting above moves the
     count beside the accepted write; the API's own
     word is then asked for on the light read, so
     the standing number settles to the truth after
     every mail action (an open's mark read, a
     triage, a label change, an undo). */
  mailFetchInboxUnread();
}

/* messages.modify over one record, settled honestly:
   on acceptance the caches move (above); on failure
   a toast names it and nothing has moved, so the
   rows already told the truth. */
async function mailModifyMessage(rec, add, remove, kind) {
  const out = await gmailWrite("POST",
    "/users/me/messages/" + encodeURIComponent(rec.id) +
    "/modify", { addLabelIds: add, removeLabelIds: remove });
  if (out.outcome === "ok") {
    mailApplyLabelChange(rec.id, add, remove, false);
    if (state.view && state.view.kind === "email") {
      renderMail();
    }
    return true;
  }
  mailToastWriteFailure(out,
    kind === "archive" ? "Could not archive that message."
      : kind === "label" ? "That move did not happen."
      : "Could not update that message.");
  return false;
}

/* Trash or untrash one record (the trash endpoints,
   never a delete: the permission cannot permanently
   delete, by design). Trashing also lifts the
   message out of the Inbox locally, as Gmail does;
   untrashing hands it back its place in the Trash
   list's opposite. */
async function mailTrashMessage(rec, untrash) {
  const out = await gmailWrite("POST",
    "/users/me/messages/" + encodeURIComponent(rec.id) +
    (untrash ? "/untrash" : "/trash"), null);
  if (out.outcome === "ok") {
    if (untrash) {
      mailApplyLabelChange(rec.id, [], ["TRASH"], true);
    } else {
      mailApplyLabelChange(rec.id, ["TRASH"], ["INBOX"],
        true);
    }
    if (state.view && state.view.kind === "email") {
      renderMail();
    }
    return true;
  }
  mailToastWriteFailure(out, untrash
    ? "Could not move that message to the Inbox."
    : "Could not move that message to trash.");
  return false;
}

/* A failed triage write, in words: the consent line
   for a grant that does not cover mail yet, the
   plain failure otherwise. */
function mailToastWriteFailure(out, fallback) {
  if (out.outcome === "forbidden") {
    toast("Google has not granted mail permission yet. " +
      "Use the Connect button to grant it.", true);
  } else {
    toast(fallback || "That did not go through.", true);
  }
}

/* Decode one MIME body part's data (base64url) to
   text. */
function mailDecodeBase64Url(data) {
  const b64 = String(data || "").replace(/-/g, "+")
    .replace(/_/g, "/");
  const padded = b64 + "=".repeat(
    (4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/* Walk a message payload once, gathering what the
   reading view and the composer's quoting need: the
   first HTML part, the first plain text part, and
   every attachment (a part carrying a filename and
   an attachment id). */
function mailWalkPayload(payload) {
  const found = { html: null, text: null, attachments: [] };
  function walk(part) {
    if (!part) { return; }
    const mime = String(part.mimeType || "");
    if (part.filename && part.body &&
        part.body.attachmentId) {
      found.attachments.push({
        attachmentId: String(part.body.attachmentId),
        filename: String(part.filename),
        mimeType: mime,
        size: Number(part.body.size) || 0
      });
    } else if (part.body && part.body.data) {
      if (mime === "text/html" && found.html === null) {
        found.html = mailDecodeBase64Url(part.body.data);
      } else if (mime === "text/plain" &&
          found.text === null) {
        found.text = mailDecodeBase64Url(part.body.data);
      }
    }
    const parts = Array.isArray(part.parts) ? part.parts : [];
    parts.forEach(walk);
  }
  walk(payload);
  return found;
}

/* Settle a full message into the reading shape: the
   row's facts plus its headers, its decoded parts,
   and the address lists the reply paths read. */
function normalizeMailFull(raw) {
  const row = normalizeMailRow(raw);
  if (!row) { return null; }
  const headers = mailHeaderMap(raw);
  const parts = mailWalkPayload(raw.payload);
  row.messageIdHeader = headers["message-id"] || "";
  row.references = headers.references || "";
  row.toHeader = headers.to || "";
  row.ccHeader = headers.cc || "";
  row.dateHeader = headers.date || "";
  row.html = parts.html;
  row.text = parts.text;
  row.attachments = parts.attachments;
  row.cleanHtml = null;
  row.hasRemoteImages = false;
  return row;
}

/* The display HTML for a message body: the web clip
   sanitizer's cleaning first (scripts, handlers, and
   foreign attributes never survive it), then, while
   images are blocked, every remote image's source
   set aside (held on the element, so Show images is
   a re-render, not a refetch). The cleaned form is
   cached on the message; the blocked form is derived
   from it per render. */
function mailCleanHtml(full, showImages) {
  if (full.cleanHtml === null) {
    full.cleanHtml = sanitizeWebClipHtml(
      full.html || "").html;
    const probe = document.createElement("div");
    probe.innerHTML = full.cleanHtml;
    full.hasRemoteImages = Array.prototype.some.call(
      probe.querySelectorAll("img"), function (img) {
        return /^https?:\/\//i.test(
          img.getAttribute("src") || "");
      });
  }
  if (showImages || !full.hasRemoteImages) {
    return full.cleanHtml;
  }
  const holder = document.createElement("div");
  holder.innerHTML = full.cleanHtml;
  holder.querySelectorAll("img").forEach(function (img) {
    const src = img.getAttribute("src") || "";
    if (/^https?:\/\//i.test(src)) {
      img.setAttribute("data-mail-blocked-src", src);
      img.removeAttribute("src");
      img.classList.add("mail-blocked-img");
      if (!img.getAttribute("alt")) {
        img.setAttribute("alt", "Image blocked");
      }
    }
  });
  return holder.innerHTML;
}

/* A plain text body as display HTML: escaped, its
   line breaks kept, paragraph-shaped like the
   app's other plain text. */
function mailTextToHtml(text) {
  return "<p>" + escapeHtml(String(text || ""))
    .replace(/\n/g, "<br>") + "</p>";
}

/* Open a message: fetch it in full, stand it in the
   reading pane, and mark it read (the modify call,
   the row and the badge following only on the API's
   acceptance). A read that settles into a standing
   state (consent, unavailable) leaves the list as it
   stood. */
async function openMailMessage(id) {
  const out = await gmailRead("/users/me/messages/" +
    encodeURIComponent(id) + "?format=full");
  if (!mailSettleLoadOutcome(out)) { return; }
  const full = normalizeMailFull(out.data);
  if (!full) { return; }
  mailOpenFull = full;
  mailOpenId = id;
  mailShowImages = false;
  /* v2.104.0: a new message standing in the
     pane dismisses the labels dropdown; its
     checkboxes belonged to the message that
     stood before. */
  closeMailLabelsMenu();
  const pane = mailEl("mailpane");
  if (pane) { pane.classList.add("mail-show-read"); }
  renderMail();
  if (full.unread) {
    const marked = await gmailWrite("POST",
      "/users/me/messages/" + encodeURIComponent(id) +
      "/modify", { addLabelIds: [],
        removeLabelIds: ["UNREAD"] });
    if (marked.outcome === "ok") {
      mailApplyLabelChange(id, [], ["UNREAD"], false);
      renderMail();
    }
  }
}

/* The reading pane: the empty words until a message
   stands; then its subject, its header lines, its
   action bar (the Trash action reading Move to
   Inbox while the message stands in Trash, the mark
   action naming the state it would leave), its
   attachments, its Show images offer while remote
   images are blocked, and its cleaned body. */
function renderMailRead() {
  const empty = mailEl("mailReadEmpty");
  const read = mailEl("mailRead");
  if (!read) { return; }
  const full = mailOpenFull;
  if (!full) {
    if (empty) { empty.classList.remove("hidden"); }
    read.classList.add("hidden");
    return;
  }
  if (empty) { empty.classList.add("hidden"); }
  read.classList.remove("hidden");
  mailEl("mailReadSubject").textContent =
    full.subject || "(No subject)";
  const meta = mailEl("mailReadMeta");
  meta.innerHTML = "";
  [["From", full.fromName &&
      full.fromName !== full.fromAddress
      ? full.fromName + " <" + full.fromAddress + ">"
      : full.fromAddress],
   ["To", full.toHeader],
   ["Date", full.dateHeader]].forEach(function (pair) {
    if (!pair[1]) { return; }
    const line = document.createElement("div");
    const label = document.createElement("span");
    label.className = "mail-meta-label";
    label.textContent = pair[0] + ": ";
    line.appendChild(label);
    line.appendChild(document.createTextNode(pair[1]));
    meta.appendChild(line);
  });
  /* v2.86 (Part E): the opened message's location
     stands at the head of its action bar, rebuilt
     from the record's standing labels on every
     render, so it follows the message. While the
     label list has never loaded, ask for it; its
     landing re-renders and the label chips join. */
  const locEl = mailEl("mailReadLocation");
  if (locEl) {
    locEl.innerHTML = "";
    mailLocationNames(full).forEach(function (name) {
      const chip = document.createElement("span");
      chip.className = "mail-loc-chip";
      chip.textContent = name;
      locEl.appendChild(chip);
    });
  }
  if (!mailLabels && !mailLabelsLoading) {
    loadMailLabels();
  }
  /* v2.100: a snoozed message says when it comes
     back, with the way back standing beside it,
     wherever the message is opened. The registry
     is asked for once if it has not landed yet;
     its landing re-renders this pane. */
  const snoozedLine = mailEl("mailSnoozedLine");
  if (snoozedLine) {
    const szEntry = mailSnoozeEntryFor(full.id);
    if (szEntry) {
      mailEl("mailSnoozedText").textContent =
        "Snoozed until " + mailSnoozeFormatUntil(
          Date.parse(szEntry.snoozeUntil));
      snoozedLine.classList.remove("hidden");
    } else {
      snoozedLine.classList.add("hidden");
    }
    if (!mailSnoozeLoaded) {
      const openId = full.id;
      mailSnoozeEnsureLoaded().then(function () {
        if (mailOpenFull &&
            mailOpenFull.id === openId) {
          renderMailRead();
        }
      });
    }
  }
  const inTrash = full.labelIds.indexOf("TRASH") !== -1;
  /* v2.84 (Part 2): the Trash icon button speaks
     its state in its tooltip, and the More menu's
     mark item names the state it would leave. */
  const trashBtn = mailEl("mailTrashBtn");
  trashBtn.title = inTrash ? "Move to Inbox" : "Trash";
  trashBtn.setAttribute("aria-label", trashBtn.title);
  mailEl("mailMoreMarkLabel").textContent = full.unread
    ? "Mark as read" : "Mark as unread";
  /* v2.103: the More menu's Move to Inbox
     stands only while the open message is
     away from the Inbox (it lacks INBOX, or
     it sits in the Trash); a message at home
     gives it nothing to do. */
  const moveInboxItem = mailEl("mailMoreMoveInboxBtn");
  if (moveInboxItem) {
    moveInboxItem.classList.toggle("hidden",
      full.labelIds.indexOf("INBOX") !== -1 &&
        !inTrash);
  }
  const labelsMenu = mailEl("mailLabelsMenu");
  if (labelsMenu &&
      !labelsMenu.classList.contains("hidden")) {
    buildMailLabelsMenu(full);
  }
  const attWrap = mailEl("mailAttachments");
  attWrap.innerHTML = "";
  attWrap.classList.toggle("hidden",
    !full.attachments.length);
  full.attachments.forEach(function (att) {
    const row = document.createElement("div");
    row.className = "mail-att-row";
    const name = document.createElement("span");
    name.className = "mail-att-name";
    name.textContent = att.filename + " (" +
      humanSize(att.size) + ")";
    row.appendChild(name);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn small";
    btn.textContent = "Download";
    btn.setAttribute("data-mail-att",
      att.attachmentId);
    btn.addEventListener("click", function () {
      mailDownloadAttachment(full, att);
    });
    row.appendChild(btn);
    attWrap.appendChild(row);
  });
  const bodyHtml = full.html !== null
    ? mailCleanHtml(full, mailShowImages)
    : mailTextToHtml(full.text || "");
  const showBtn = mailEl("mailShowImagesBtn");
  if (showBtn) {
    showBtn.classList.toggle("hidden",
      !(full.hasRemoteImages && !mailShowImages));
  }
  mailEl("mailBody").innerHTML = bodyHtml;
}

/* Download one attachment: the API hands its bytes
   back base64url-encoded; the browser saves them
   under the part's own filename. */
async function mailDownloadAttachment(full, att) {
  const out = await gmailRead("/users/me/messages/" +
    encodeURIComponent(full.id) + "/attachments/" +
    encodeURIComponent(att.attachmentId));
  if (out.outcome !== "ok" || !out.data ||
      !out.data.data) {
    toast("Could not download that attachment.", true);
    return;
  }
  try {
    const b64 = String(out.data.data).replace(/-/g, "+")
      .replace(/_/g, "/");
    const padded = b64 + "=".repeat(
      (4 - (b64.length % 4)) % 4);
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    const blob = new Blob([bytes],
      { type: att.mimeType || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = att.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 4000);
  } catch (e) {
    toast("Could not download that attachment.", true);
  }
}

/* v2.104.0: the picker stands as a dropdown
   under its button (see the stylesheet), so its
   opening and closing run through these two
   hands alone: every path that stands it or
   dismisses it (the button itself, an outside
   press, Escape, a new message, a new
   selection, leaving the Email view) keeps the
   button's expanded word and open face in step
   with the menu, and nothing else reaches for
   the menu's hidden class. */
function closeMailLabelsMenu() {
  const menu = mailEl("mailLabelsMenu");
  if (menu) {
    menu.classList.add("hidden");
    menu.classList.remove("flip-x", "flip-y");
  }
  const btn = mailEl("mailLabelsBtn");
  if (btn) {
    btn.setAttribute("aria-expanded", "false");
  }
}

function openMailLabelsMenu() {
  if (!mailOpenFull) { return; }
  const menu = mailEl("mailLabelsMenu");
  const btn = mailEl("mailLabelsBtn");
  if (!menu || !btn) { return; }
  buildMailLabelsMenu(mailOpenFull);
  menu.classList.remove("flip-x", "flip-y");
  menu.classList.remove("hidden");
  btn.setAttribute("aria-expanded", "true");
  placeMailLabelsMenu();
}

/* Keep the dropdown inside the reading pane:
   if its natural hang would cross the pane's
   right edge it flips to hang from the wrap's
   right instead, and if it would cross the
   pane's foot while the room above the button
   is the larger, it opens upward. Measured
   after the menu stands, against the pane's
   own box (the viewport when the pane is not
   laid out), and worked purely as class
   changes, so the pane's layout never feels
   it. */
function placeMailLabelsMenu() {
  const menu = mailEl("mailLabelsMenu");
  const btn = mailEl("mailLabelsBtn");
  const pane = mailEl("mailReadPane");
  if (!menu || !btn ||
      menu.classList.contains("hidden")) { return; }
  const box = pane ? pane.getBoundingClientRect() : {
    left: 0, top: 0,
    right: window.innerWidth || 0,
    bottom: window.innerHeight || 0
  };
  let r = menu.getBoundingClientRect();
  if (r.right > box.right - 4) {
    menu.classList.add("flip-x");
    r = menu.getBoundingClientRect();
  }
  if (r.bottom > box.bottom - 4) {
    const b = btn.getBoundingClientRect();
    if (b.top - box.top > box.bottom - b.bottom) {
      menu.classList.add("flip-y");
    }
  }
}

/* The labels menu's contents for the open message:
   one checkbox per user label, checked where the
   message carries it; a change runs one modify with
   exactly that label's move. */
function buildMailLabelsMenu(full) {
  const menu = mailEl("mailLabelsMenu");
  if (!menu) { return; }
  menu.innerHTML = "";
  const labels = mailUserLabels();
  if (!labels.length) {
    const none = document.createElement("div");
    none.className = "mail-labels-none";
    none.textContent = "No labels yet.";
    menu.appendChild(none);
    return;
  }
  labels.forEach(function (l) {
    const row = document.createElement("label");
    row.className = "settings-check mail-label-row";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = full.labelIds.indexOf(l.id) !== -1;
    box.setAttribute("data-mail-label-id", l.id);
    box.addEventListener("change", function () {
      mailToggleLabel(full, l.id, box.checked);
    });
    row.appendChild(box);
    const span = document.createElement("span");
    span.textContent = l.name;
    row.appendChild(span);
    menu.appendChild(row);
  });
}

async function mailToggleLabel(full, labelId, on) {
  const add = on ? [labelId] : [];
  const remove = on ? [] : [labelId];
  const out = await gmailWrite("POST",
    "/users/me/messages/" + encodeURIComponent(full.id) +
    "/modify", { addLabelIds: add, removeLabelIds: remove });
  if (out.outcome === "ok") {
    mailApplyLabelChange(full.id, add, remove, false);
    renderMail();
    return;
  }
  mailToastWriteFailure(out, "Could not update labels.");
  renderMail();
}

/* Save to note: the one place mail content is
   copied, on this explicit click alone. The note is
   made through the ordinary creation pieces (the
   made note, the default notebook, the fresh save),
   titled with the subject, holding the cleaned body
   (or the plain text), and the user stays in the
   Email view, told where it landed. */
async function mailSaveOpenToNote() {
  const full = mailOpenFull;
  if (!full) { return; }
  const body = full.html !== null
    ? mailCleanHtml(full, true)
    : mailTextToHtml(full.text || "");
  const slug = fallbackNotebookSlug();
  const note = makeNote(slug,
    full.subject || "(No subject)", body);
  state.notes.unshift(note);
  saveCache();
  renderSidebar();
  try {
    await saveNoteToRepo(note,
      { skipConflictCheck: true, fresh: true });
    saveCache();
    const nb = notebookForSlug(slug);
    toastTopCenter("Saved to " +
      (nb ? nb.name : "your notebook"));
  } catch (err) {
    toast("Note created locally; save failed: " +
      err.message, true);
  }
}

/* An address list header (To, Cc) as its entries:
   each formatted as the sender wrote it (a name and
   address, or a bare address), with the address
   beside it for the reply paths' own-address
   exclusion. A simple comma split: quoted names
   carrying commas are vanishingly rare in the lists
   this reads, and a split inside one still yields
   entries the user can see and fix in the compose
   fields before sending. */
function mailParseAddressList(value) {
  return String(value || "").split(",")
    .map(function (piece) { return piece.trim(); })
    .filter(function (piece) { return !!piece; })
    .map(function (piece) {
      const parsed = mailParseFrom(piece);
      return {
        formatted: parsed.name &&
            parsed.name !== parsed.address
          ? parsed.name + " <" + parsed.address + ">"
          : parsed.address,
        address: parsed.address
      };
    });
}

function mailFormattedFrom(full) {
  return full.fromName &&
      full.fromName !== full.fromAddress
    ? full.fromName + " <" + full.fromAddress + ">"
    : full.fromAddress;
}

/* Open the compose dialog: a new message, a reply or
   reply all, a forward, or a draft reopened. The
   state stands beside the fields (mode, draft id,
   threading), and the field snapshot taken here is
   the close prompt's measure: the dialog asks before
   closing only when the fields have moved from the
   snapshot (a save refreshes it). */
function openMailCompose(opts) {
  opts = opts || {};
  mailCompose = {
    mode: opts.mode || "new",
    draftId: opts.draftId || null,
    threadId: opts.threadId || "",
    inReplyTo: opts.inReplyTo || "",
    references: opts.references || "",
    saving: false,
    savedSnapshot: ""
  };
  const titles = { "new": "New mail", reply: "Reply",
    replyall: "Reply all", forward: "Forward",
    draft: "Draft" };
  mailEl("mailComposeTitle").textContent =
    titles[mailCompose.mode] || "New mail";
  mailEl("mailToInput").value = opts.to || "";
  mailEl("mailCcInput").value = opts.cc || "";
  mailEl("mailBccInput").value = opts.bcc || "";
  mailEl("mailSubjectInput").value = opts.subject || "";
  mailEl("mailBodyInput").value = opts.body || "";
  mailEl("mailCcRow").classList.toggle("hidden",
    !(opts.cc || opts.bcc));
  mailComposeSetError(null);
  mailCompose.savedSnapshot = mailComposeSnapshot();
  mailEl("mailComposeModal").classList.remove("hidden");
  const to = mailEl("mailToInput");
  if (to) { to.focus(); }
}

function mailComposeFields() {
  return {
    to: mailEl("mailToInput").value,
    cc: mailEl("mailCcInput").value,
    bcc: mailEl("mailBccInput").value,
    subject: mailEl("mailSubjectInput").value,
    body: mailEl("mailBodyInput").value
  };
}

function mailComposeSnapshot() {
  return JSON.stringify(mailComposeFields());
}

function mailComposeDirty() {
  if (!mailCompose) { return false; }
  return mailComposeSnapshot() !==
    mailCompose.savedSnapshot;
}

/* The compose error line: cleared with null; the
   consent wording with its Connect button when the
   grant does not cover mail; the could-not-reach
   wording (with the entry still standing) otherwise,
   the event editor's own pair. */
function mailComposeSetError(out) {
  const wrap = mailEl("mailComposeError");
  const text = mailEl("mailComposeErrorText");
  const btn = mailEl("mailComposeConnectBtn");
  if (!wrap) { return; }
  if (!out) {
    wrap.classList.add("hidden");
    if (btn) { btn.classList.add("hidden"); }
    return;
  }
  wrap.classList.remove("hidden");
  if (out.outcome === "forbidden") {
    text.textContent =
      "Google has not granted mail permission yet.";
    if (btn) { btn.classList.remove("hidden"); }
  } else {
    text.textContent = "Could not reach Gmail. " +
      "Your message is still here.";
    if (btn) { btn.classList.add("hidden"); }
  }
}

/* The RFC 822 text of the compose fields: the
   address and subject headers, the threading
   headers on a reply, and the plain text body. */
function mailBuildRaw(fields, st) {
  const lines = [];
  lines.push("To: " + fields.to);
  if (fields.cc) { lines.push("Cc: " + fields.cc); }
  if (fields.bcc) { lines.push("Bcc: " + fields.bcc); }
  lines.push("Subject: " + fields.subject);
  if (st && st.inReplyTo) {
    lines.push("In-Reply-To: " + st.inReplyTo);
  }
  if (st && st.references) {
    lines.push("References: " + st.references);
  }
  lines.push("MIME-Version: 1.0");
  lines.push("Content-Type: text/plain; charset=\"UTF-8\"");
  return lines.join("\r\n") + "\r\n\r\n" +
    String(fields.body || "").replace(/\n/g, "\r\n");
}

/* base64url of a text's UTF-8 bytes, the raw shape
   the send and draft calls carry. */
function mailBase64UrlEncode(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  bytes.forEach(function (b) {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, "-")
    .replace(/\//g, "_").replace(/=+$/, "");
}

/* Send from the compose dialog. A reopened draft is
   updated first, then sent as the draft it is (so
   what sends is what stands in the fields); anything
   else sends as a new message, threaded when the
   state carries a thread. A failure keeps the dialog
   open over the fields exactly as typed. */
async function sendMailFromCompose() {
  const st = mailCompose;
  if (!st || st.saving) { return; }
  st.saving = true;
  mailComposeSetError(null);
  const fields = mailComposeFields();
  const raw = mailBase64UrlEncode(
    mailBuildRaw(fields, st));
  let out = null;
  if (st.draftId) {
    out = await gmailWrite("PUT",
      "/users/me/drafts/" +
        encodeURIComponent(st.draftId),
      { message: { raw: raw,
        threadId: st.threadId || undefined } });
    if (out.outcome === "ok") {
      out = await gmailWrite("POST",
        "/users/me/drafts/send", { id: st.draftId });
    }
  } else {
    const body = { raw: raw };
    if (st.threadId) { body.threadId = st.threadId; }
    out = await gmailWrite("POST",
      "/users/me/messages/send", body);
  }
  st.saving = false;
  if (!mailCompose) { return; }
  if (out.outcome === "ok") {
    const wasDraft = !!st.draftId;
    closeMailCompose();
    toastTopCenter("Message sent");
    if (wasDraft) {
      delete mailLists["folder:drafts"];
    }
    delete mailLists["folder:sent"];
    if (state.view && state.view.kind === "email") {
      const key = mailListKey();
      if (mailLists[key]) {
        mailLists[key].loaded = false;
      }
      renderMail();
      ensureMailLoaded();
    }
    return;
  }
  mailComposeSetError(out);
}

/* Save the compose fields as a draft on Gmail: a
   create, or an update of the draft this dialog
   already stands for. Success refreshes the field
   snapshot (closing afterwards asks nothing) and
   drops the Drafts list's cache, so the folder
   shows the draft when it is next opened. */
async function saveMailDraftFromCompose() {
  const st = mailCompose;
  if (!st || st.saving) { return false; }
  st.saving = true;
  mailComposeSetError(null);
  const fields = mailComposeFields();
  const message = { raw: mailBase64UrlEncode(
    mailBuildRaw(fields, st)) };
  if (st.threadId) { message.threadId = st.threadId; }
  const out = st.draftId
    ? await gmailWrite("PUT", "/users/me/drafts/" +
        encodeURIComponent(st.draftId),
        { message: message })
    : await gmailWrite("POST", "/users/me/drafts",
        { message: message });
  st.saving = false;
  if (!mailCompose) { return false; }
  if (out.outcome === "ok") {
    if (out.data && out.data.id) {
      st.draftId = String(out.data.id);
      st.mode = "draft";
    }
    st.savedSnapshot = mailComposeSnapshot();
    delete mailLists["folder:drafts"];
    toastTopCenter("Draft saved");
    return true;
  }
  mailComposeSetError(out);
  return false;
}

/* Close the compose dialog outright: the caller has
   already settled the content (sent, saved by the
   prompt's own save, discarded, or never dirty). */
function closeMailCompose() {
  const modal = mailEl("mailComposeModal");
  if (modal) { modal.classList.add("hidden"); }
  const close = mailEl("mailCloseModal");
  if (close) { close.classList.add("hidden"); }
  mailCompose = null;
}

/* Ask before closing when the fields have moved:
   the prompt offers Save draft, Discard, and Keep
   writing, so nothing typed is ever lost silently.
   A dialog whose fields stand as opened (or as last
   saved) closes without asking. */
function requestCloseMailCompose() {
  if (!mailCompose || mailCompose.saving) { return; }
  if (mailComposeDirty()) {
    mailEl("mailCloseModal").classList.remove("hidden");
    return;
  }
  closeMailCompose();
}

/* The prompt's Save draft: save, and close on the
   save's success (a failure keeps the compose open
   with its error line, the prompt already gone). */
async function mailClosePromptSave() {
  mailEl("mailCloseModal").classList.add("hidden");
  const saved = await saveMailDraftFromCompose();
  if (saved) { closeMailCompose(); }
}

/* The prompt's Discard: an existing draft is
   deleted from Gmail (draft deletion only, never a
   message delete); a never-saved compose simply
   closes. Either way the dialog closes: the words
   were the draft's own, or were never saved anywhere
   and the Discard was the user's explicit word. */
async function mailClosePromptDiscard() {
  const st = mailCompose;
  mailEl("mailCloseModal").classList.add("hidden");
  if (st && st.draftId) {
    const out = await gmailWrite("DELETE",
      "/users/me/drafts/" +
        encodeURIComponent(st.draftId), null);
    if (out.outcome === "ok") {
      delete mailLists["folder:drafts"];
    } else {
      mailToastWriteFailure(out,
        "Could not delete that draft.");
    }
  }
  closeMailCompose();
}

/* Reply and Reply all, from the reading view: the
   sender becomes the recipient; Reply all adds the
   original To and Cc recipients, minus the
   account's own address and minus repeats. The
   original stands quoted under its On line, and the
   threading headers ride along so Gmail threads the
   answer. */
function mailOpenReply(all) {
  const full = mailOpenFull;
  if (!full) { return; }
  let cc = "";
  if (all) {
    const list = [];
    const seen = {};
    [full.toHeader, full.ccHeader].forEach(
      function (header) {
        mailParseAddressList(header).forEach(
          function (entry) {
            const key = entry.address.toLowerCase();
            if (!entry.address || seen[key]) { return; }
            if (mailOwnAddress &&
                key === mailOwnAddress.toLowerCase()) {
              return;
            }
            seen[key] = true;
            list.push(entry.formatted);
          });
      });
    cc = list.join(", ");
  }
  const subject = /^re:\s*/i.test(full.subject || "")
    ? full.subject
    : "Re: " + (full.subject || "");
  const body = "\n\nOn " +
    (full.dateHeader ||
      new Date(full.dateMs).toString()) + ", " +
    (full.fromName || full.fromAddress) + " wrote:\n" +
    (full.text !== null ? full.text
      : htmlToText(full.html || ""));
  openMailCompose({
    mode: all ? "replyall" : "reply",
    to: mailFormattedFrom(full),
    cc: cc,
    subject: subject,
    body: body,
    threadId: full.threadId,
    inReplyTo: full.messageIdHeader,
    references: ((full.references || "") + " " +
      (full.messageIdHeader || "")).trim()
  });
}

/* Forward, from the reading view: the forwarded
   block (its own marker line and header lines) over
   the original's plain text. */
function mailOpenForward() {
  const full = mailOpenFull;
  if (!full) { return; }
  const subject = /^fwd:\s*/i.test(full.subject || "")
    ? full.subject
    : "Fwd: " + (full.subject || "");
  const body = "\n\n---------- Forwarded message ---------\n" +
    "From: " + mailFormattedFrom(full) + "\n" +
    "Date: " + (full.dateHeader || "") + "\n" +
    "Subject: " + (full.subject || "") + "\n" +
    "To: " + (full.toHeader || "") + "\n\n" +
    (full.text !== null ? full.text
      : htmlToText(full.html || ""));
  openMailCompose({ mode: "forward", subject: subject,
    body: body });
}

/* Open a draft in the compose dialog, populated from
   the draft itself (its own get, in full form): the
   fields are the draft's message's headers and plain
   text, and the dialog stands as a draft (Send sends
   the draft, Save updates it, Discard deletes it). */
async function openMailDraft(rec) {
  const out = await gmailRead("/users/me/drafts/" +
    encodeURIComponent(rec.draftId) + "?format=full");
  if (!mailSettleLoadOutcome(out)) { return; }
  const msg = out.data && out.data.message;
  if (!msg) { return; }
  const full = normalizeMailFull(msg);
  if (!full) { return; }
  const headers = mailHeaderMap(msg);
  openMailCompose({
    mode: "draft",
    draftId: rec.draftId,
    threadId: full.threadId,
    to: full.toHeader,
    cc: full.ccHeader,
    bcc: headers.bcc || "",
    subject: full.subject,
    body: full.text !== null ? full.text
      : htmlToText(full.html || "")
  });
}

/* The unavailable state's Retry, from the panel line
   or the view's status line: re-ask for whichever
   load is missing (the labels, or the standing
   list). */
function mailRetryLoad() {
  if (mailStatus === "needs-consent") { return; }
  if (!mailLabels) {
    mailSetStatus("idle");
    loadMailLabels();
    return;
  }
  const key = mailListKey();
  if (mailLists[key]) { mailLists[key].loaded = false; }
  mailSetStatus("idle");
  loadMailList(key, false);
}

/* The Email view's static wiring, called once from
   wireEvents beside the calendar day menu's init:
   the sidebar entry, the panel and status buttons,
   the search field, the reading action bar, and the
   compose dialog with its close prompt. The dynamic
   furniture (folder rows, message rows, label
   checkboxes, attachment buttons) wires itself at
   render, in the module above. */
function initMailBindings() {
  mailEl("navEmail").addEventListener("click",
    function () {
      state.view = { kind: "email", value: null };
      renderAll();
      setMobileView("list");
    });
  mailEl("settingsMailConnectBtn").addEventListener(
    "click", function () { connectGoogleCalendar(); });
  mailEl("mailPanelConnectBtn").addEventListener(
    "click", function () { connectGoogleCalendar(); });
  mailEl("mailPanelRetryBtn").addEventListener(
    "click", function () { mailRetryLoad(); });
  mailEl("mailStatusRetryBtn").addEventListener(
    "click", function () { mailRetryLoad(); });
  mailEl("mailNewBtn").addEventListener("click",
    function () { openMailCompose({ mode: "new" }); });
  mailEl("mailFolderPicker").addEventListener(
    "change", function (ev) {
      const v = ev.target.value || "";
      if (v.indexOf("folder:") === 0) {
        mailChooseSelection({ kind: "folder",
          id: v.slice(7) });
      } else if (v.indexOf("label:") === 0) {
        const id = v.slice(6);
        const found = mailUserLabels().filter(
          function (l) { return l.id === id; })[0];
        mailChooseSelection({ kind: "label", id: id,
          name: found ? found.name : "Label" });
      }
    });
  const searchInput = mailEl("mailSearchInput");
  searchInput.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter") { return; }
    ev.preventDefault();
    const q = searchInput.value.trim();
    if (q) {
      mailChooseSelection({ kind: "search", q: q });
    }
  });
  mailEl("mailSearchClearBtn").addEventListener(
    "click", function () {
      searchInput.value = "";
      mailChooseSelection({ kind: "folder", id: "inbox" });
    });
  mailEl("mailLoadMoreBtn").addEventListener("click",
    function () { loadMailList(mailListKey(), true); });
  /* v2.107: the selection bar's three actions run
     over the standing selection (a lone selected
     message keeps its standing single path, through
     the same dispatcher the row menu uses), Snooze
     opens the standing snooze menu under the bar's
     own button, and Clear ends the selection. */
  mailEl("mailSelArchiveBtn").addEventListener(
    "click", function () {
      mailRunTargets(mailSelectedRecords(), "archive");
    });
  mailEl("mailSelTrashBtn").addEventListener(
    "click", function () {
      mailRunTargets(mailSelectedRecords(), "trash");
    });
  mailEl("mailSelSnoozeBtn").addEventListener(
    "click", function () {
      const btn = mailEl("mailSelSnoozeBtn");
      const r = btn.getBoundingClientRect();
      mailRunTargets(mailSelectedRecords(), "snooze",
        r.left, r.bottom + 4);
    });
  mailEl("mailSelClearBtn").addEventListener(
    "click", function () { mailClearSelection(); });
  /* v2.107: the row menu's three items. */
  mailEl("mailRowMenuArchiveBtn").addEventListener(
    "click", function () { mailRowMenuRun("archive"); });
  mailEl("mailRowMenuDeleteBtn").addEventListener(
    "click", function () { mailRowMenuRun("trash"); });
  mailEl("mailRowMenuSnoozeBtn").addEventListener(
    "click", function () { mailRowMenuRun("snooze"); });
  /* v2.115: the row menu's Copy link item. */
  mailEl("mailRowMenuCopyLinkBtn").addEventListener(
    "click", function () { mailRowMenuCopyLink(); });
  /* v2.107: Escape ends a standing selection, once
     the menus and the snooze pick have had theirs
     (each closes on its own Escape first). */
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape") { return; }
    if (!state.view || state.view.kind !== "email") {
      return;
    }
    if (!mailSelection.size) { return; }
    const stands = function (id) {
      const el = mailEl(id);
      return el && !el.classList.contains("hidden");
    };
    if (stands("mailRowMenu") || stands("mailSnoozeMenu") ||
        stands("mailLabelsMenu") ||
        stands("mailMoreMenu") ||
        stands("mailSnoozePickModal")) {
      return;
    }
    mailClearSelection();
  });
  mailEl("mailBackBtn").addEventListener("click",
    function () {
      const pane = mailEl("mailpane");
      if (pane) {
        pane.classList.remove("mail-show-read");
      }
    });
  mailEl("mailReplyBtn").addEventListener("click",
    function () { mailOpenReply(false); });
  mailEl("mailReplyAllBtn").addEventListener("click",
    function () { mailOpenReply(true); });
  mailEl("mailForwardBtn").addEventListener("click",
    function () { mailOpenForward(); });
  mailEl("mailArchiveBtn").addEventListener("click",
    function () {
      if (mailOpenFull) {
        mailArchiveWithUndo(mailOpenFull);
      }
    });
  mailEl("mailTrashBtn").addEventListener("click",
    function () {
      if (!mailOpenFull) { return; }
      const inTrash = mailOpenFull.labelIds
        .indexOf("TRASH") !== -1;
      /* v2.84 (Part 4): a trash from the bar stands
         the undo toast; the move back to the Inbox
         is the plain untrash it always was. */
      if (inTrash) {
        mailTrashMessage(mailOpenFull, true);
      } else {
        mailTrashWithUndo(mailOpenFull);
      }
    });
  mailEl("mailSnoozeBtn").addEventListener("click",
    function () {
      if (!mailOpenFull) { return; }
      openMailSnoozeMenuAt(mailOpenFull,
        mailEl("mailSnoozeBtn"));
    });
  mailEl("mailUnsnoozeBtn").addEventListener("click",
    function () {
      if (mailOpenFull) {
        mailUnsnoozeMessage(mailOpenFull);
      }
    });
  mailEl("mailSnoozePickBtn").addEventListener("click",
    function () {
      confirmMailSnoozePick().catch(function () {
        /* reported in the dialog and the flows */
      });
    });
  mailEl("mailSnoozePickCancelBtn").addEventListener(
    "click", function () { closeMailSnoozePick(); });
  mailEl("mailMoreMarkBtn").addEventListener("click",
    function () {
      mailEl("mailMoreMenu").classList.add("hidden");
      if (!mailOpenFull) { return; }
      if (mailOpenFull.unread) {
        mailModifyMessage(mailOpenFull, [], ["UNREAD"],
          "mark");
      } else {
        mailModifyMessage(mailOpenFull, ["UNREAD"], [],
          "mark");
      }
    });
  /* v2.103: Labels is its own button in the
     action row, no longer an item inside the
     More menu. v2.104.0: the picker it opens
     stands as a dropdown under the button, and
     the toggle runs through the open and close
     hands so the button's face follows. */
  mailEl("mailLabelsBtn").addEventListener("click",
    function () {
      const menu = mailEl("mailLabelsMenu");
      if (!menu || !mailOpenFull) { return; }
      if (menu.classList.contains("hidden")) {
        openMailLabelsMenu();
      } else {
        closeMailLabelsMenu();
      }
    });
  mailEl("mailMoreMoveInboxBtn").addEventListener(
    "click", function () {
      mailEl("mailMoreMenu").classList.add("hidden");
      if (!mailOpenFull) { return; }
      mailMoveToInboxWithUndo(mailOpenFull);
    });
  document.addEventListener("click", function (ev) {
    const t = ev.target;
    if (!t || !t.closest) { return; }
    const menu = mailEl("mailLabelsMenu");
    if (menu && !menu.classList.contains("hidden") &&
        !t.closest("#mailLabelsMenu") &&
        !t.closest("#mailLabelsBtn")) {
      closeMailLabelsMenu();
    }
    /* v2.84 (Part 2): the More menu closes on an
       outside click the same way. */
    const more = mailEl("mailMoreMenu");
    if (more && !more.classList.contains("hidden") &&
        !t.closest("#mailMoreMenu") &&
        !t.closest("#mailMoreBtn")) {
      more.classList.add("hidden");
    }
  });
  mailEl("mailMoreSaveBtn").addEventListener("click",
    function () {
      mailEl("mailMoreMenu").classList.add("hidden");
      mailSaveOpenToNote().catch(function () {
        /* reported in the function's own words */
      });
    });
  /* v2.84 (Part 2): the More menu's own toggle, and
     its Escape. */
  mailEl("mailMoreBtn").addEventListener("click",
    function () {
      const menu = mailEl("mailMoreMenu");
      if (menu) { menu.classList.toggle("hidden"); }
    });
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape") { return; }
    /* v2.104.0: the labels dropdown takes the
       same Escape as the More menu, focus back
       to its own button. */
    const labels = mailEl("mailLabelsMenu");
    if (labels &&
        !labels.classList.contains("hidden")) {
      closeMailLabelsMenu();
      const lbtn = mailEl("mailLabelsBtn");
      if (lbtn) { lbtn.focus(); }
    }
    const menu = mailEl("mailMoreMenu");
    if (menu && !menu.classList.contains("hidden")) {
      menu.classList.add("hidden");
      const btn = mailEl("mailMoreBtn");
      if (btn) { btn.focus(); }
    }
  });
  /* v2.84 (Parts 6 and 7): the label menu's items,
     its two dialogs, and the recipient fields'
     autocomplete. */
  mailEl("mailLabelRenameBtn").addEventListener("click",
    openMailLabelRename);
  mailEl("mailLabelDeleteBtn").addEventListener("click",
    openMailLabelDelete);
  mailEl("mailLabelRenameSaveBtn").addEventListener(
    "click", function () {
      saveMailLabelRename().catch(function () {
        /* reported in the function's own words */
      });
    });
  mailEl("mailLabelRenameCancelBtn").addEventListener(
    "click", function () {
      mailEl("mailLabelRenameModal")
        .classList.add("hidden");
      mailLabelMenuCtx = null;
    });
  mailEl("mailLabelDeleteConfirmBtn").addEventListener(
    "click", function () {
      confirmMailLabelDelete().catch(function () {
        /* reported in the function's own words */
      });
    });
  mailEl("mailLabelDeleteCancelBtn").addEventListener(
    "click", function () {
      mailEl("mailLabelDeleteModal")
        .classList.add("hidden");
      mailLabelMenuCtx = null;
    });
  initMailContactFields();
  mailEl("mailShowImagesBtn").addEventListener("click",
    function () {
      mailShowImages = true;
      renderMailRead();
    });
  /* The compose dialog and its close prompt. */
  mailEl("mailSendBtn").addEventListener("click",
    function () {
      sendMailFromCompose().catch(function () {
        /* reported in the dialog */
      });
    });
  mailEl("mailSaveDraftBtn").addEventListener("click",
    function () {
      saveMailDraftFromCompose().catch(function () {
        /* reported in the dialog */
      });
    });
  mailEl("mailDiscardBtn").addEventListener("click",
    function () {
      if (!mailCompose) { return; }
      if (mailCompose.draftId || mailComposeDirty()) {
        mailEl("mailCloseModal")
          .classList.remove("hidden");
      } else {
        closeMailCompose();
      }
    });
  mailEl("mailComposeCancelBtn").addEventListener(
    "click", function () { requestCloseMailCompose(); });
  mailEl("mailComposeModal").addEventListener("click",
    function (ev) {
      if (ev.target === ev.currentTarget) {
        requestCloseMailCompose();
      }
    });
  mailEl("mailCcToggleBtn").addEventListener("click",
    function () {
      mailEl("mailCcRow").classList.toggle("hidden");
    });
  mailEl("mailComposeConnectBtn").addEventListener(
    "click", function () { connectGoogleCalendar(); });
  mailEl("mailCloseSaveBtn").addEventListener("click",
    function () {
      mailClosePromptSave().catch(function () {
        /* reported in the dialog */
      });
    });
  mailEl("mailCloseDiscardBtn").addEventListener(
    "click", function () {
      mailClosePromptDiscard().catch(function () {
        /* reported in its own words */
      });
    });
  mailEl("mailCloseKeepBtn").addEventListener("click",
    function () {
      mailEl("mailCloseModal").classList.add("hidden");
    });
}

/* ---------------- v2.82: the calendar day menu ----
   A custom right click menu for calendar days, on
   both calendar surfaces (the Tasks calendar's month
   grid and the Home widget's grid), at Chris's word
   on 2026-11-01. Two actions: New task, opening the
   task editor as a create with the clicked day
   preset as its due date (the editor's one new
   optional preset), and New event, opening the
   calendar module's event editor as a create on the
   clicked day, through its existing seam. The menu
   is the note context menu's pattern (its placement
   helper, its document listeners, its close rules:
   an outside press or Escape closes it), and the
   cells it serves include the neighbouring month's
   filler days, acting on each cell's own date. A
   press on an entry inside a cell keeps the entry's
   standing answer (the suppression guard's first
   branch) and opens nothing; the cells are not text
   surfaces, so the app wide suppression keeps the
   browser's menu away while this one shows. A right
   click never selects: the day selection stays
   exactly where the last ordinary click left it. */

let calDayMenuDate = null;

function openCalDayMenu(dateStr, x, y) {
  closeCalDayMenu();
  const menu = document.getElementById("calDayMenu");
  if (!menu) { return; }
  calDayMenuDate = dateStr;
  menu.classList.remove("hidden");
  placeNoteContextMenu(menu, x, y);
  document.addEventListener("pointerdown",
    onCalDayMenuDocPointerDown, true);
  document.addEventListener("keydown",
    onCalDayMenuDocKeydown, true);
  const first = menu.querySelector(".list-menu-item");
  if (first) { first.focus(); }
}

function closeCalDayMenu() {
  const menu = document.getElementById("calDayMenu");
  if (menu) { menu.classList.add("hidden"); }
  calDayMenuDate = null;
  document.removeEventListener("pointerdown",
    onCalDayMenuDocPointerDown, true);
  document.removeEventListener("keydown",
    onCalDayMenuDocKeydown, true);
}

function onCalDayMenuDocPointerDown(ev) {
  const menu = document.getElementById("calDayMenu");
  if (menu && ev.target && menu.contains(ev.target)) {
    return;
  }
  closeCalDayMenu();
}

function onCalDayMenuDocKeydown(ev) {
  if (ev.key === "Escape") {
    ev.preventDefault();
    closeCalDayMenu();
  }
}

/* Wire the day menu once, from wireEvents beside the
   mail bindings: one delegated contextmenu listener
   per calendar pane (both grids rebuild their cells
   on every render, so only delegation survives),
   plus the menu's own two items. */
function initCalDayMenus() {
  const onContext = function (ev) {
    const t = ev.target;
    if (!t || !t.closest) { return; }
    if (t.closest(".task-cal-entry")) { return; }
    const cell = t.closest(".task-cal-day, .home-cal-day");
    if (!cell) { return; }
    const dateStr = cell.getAttribute("data-date");
    if (!dateStr || !parseTaskDate(dateStr)) { return; }
    ev.preventDefault();
    openCalDayMenu(dateStr, ev.clientX, ev.clientY);
  };
  ["taskspane", "homepane"].forEach(function (id) {
    const pane = document.getElementById(id);
    if (pane) {
      pane.addEventListener("contextmenu", onContext);
    }
  });
  document.getElementById("calDayNewTaskBtn")
    .addEventListener("click", function () {
      const day = calDayMenuDate;
      closeCalDayMenu();
      if (day) { openTaskEditor(null, null, null, day); }
    });
  document.getElementById("calDayNewEventBtn")
    .addEventListener("click", function () {
      const day = calDayMenuDate;
      closeCalDayMenu();
      if (day) {
        openGcalEventEditor(null, day)
          .catch(function () { /* the editor reports */ });
      }
    });
}

/* ---------------- v2.43: the Calendar widget ----------
   Evernote's Home calendar widget renders a connected
   calendar account's events. This app has no calendar
   account and connects none, so this widget is a calendar
   over the app's own dated items, and is never presented
   as an events calendar: tasks with a due date (open and
   completed) and live notes with an unfinished reminder.
   A compact month grid, Sunday first like the Tasks
   calendar (v2.34), marks each day that holds an item;
   under it, the selected day's agenda in the same entry
   language the Tasks calendar speaks. The derivation is
   shared where the code honestly allows: the day strings
   and date math are the task system's (parseTaskDate,
   formatTaskDateParts, taskTodayParts, TASK_CAL_WEEKDAYS),
   a task's moment is taskDueMoment (its dueTime, else
   09:00), a reminder's day and time come from
   noteReminderInputParts (the reminder panel's own
   derivation), and a task's agenda entry is the Tasks
   calendar's own element (buildTaskCalEntryEl), so its
   checkbox completes through the one completion path and
   its click opens the task editor the same way. What is
   NOT shared: the month cursor and the selected day are
   this widget's session state, not the Tasks view's
   (state.tasksView keeps its own), and the item pool is
   every dated task and reminder note, not the Tasks
   view's filtered list. Sources are the data already
   loaded: state.tasks and the note shells in state.notes
   (the catalog carries the reminder pair at shape 3), so
   no note body is ever loaded for this widget. A done
   reminder is not an item, and a trashed or archived
   note's reminder is not either: state.notes holds live
   notes only, which is the Reminders view's own pool. Since v2.80 the widget also renders the user's Google Calendar events beside those items: the calendar module (its own section above) pools its events into the same day buckets, so an event-only day earns a dot and the agenda merges all three kinds by the module header's pinned order. */

let homeCalCursor = null;    /* {y, m} or null: the month
                                the grid shows; null is the
                                current month. Session only. */
let homeCalSelected = null;  /* "YYYY-MM-DD" or null: the
                                agenda's day; null is today.
                                Session only. */

/* The month the Home grid shows: its own cursor, or the
   current month until the user navigates. Mirrors the
   Tasks calendar's calendarCursorParts, over this
   widget's own state. */
function homeCalCursorParts() {
  if (homeCalCursor && homeCalCursor.y && homeCalCursor.m) {
    return { y: homeCalCursor.y, m: homeCalCursor.m };
  }
  const t = taskTodayParts();
  return { y: t.y, m: t.m };
}

function homeCalSelectedStr() {
  if (homeCalSelected && parseTaskDate(homeCalSelected)) {
    return homeCalSelected;
  }
  const t = taskTodayParts();
  return formatTaskDateParts(t.y, t.m, t.d);
}

function shiftHomeCalMonth(delta) {
  const c = homeCalCursorParts();
  let y = c.y, m = c.m + delta;
  if (m < 1) { m = 12; y -= 1; }
  if (m > 12) { m = 1; y += 1; }
  homeCalCursor = { y: y, m: m };
  renderHome();
}

/* The widget's items, grouped by day: {kind: "task",
   task, moment} and {kind: "note", note, moment},
   each day's list in agenda order (by moment; a task
   before a note at the same moment; then by title).
   v2.80 adds {kind: "event", event, allDay, moment}
   pooled from the calendar module's day
   buckets, merged by the module header's pinned order:
   all day events first (by calendar name, then title),
   then timed items by moment, an event before a task or
   a note at the same moment. An event's moment is its
   start, held to the day's start when it began on an
   earlier day. */
function homeCalItemsByDay() {
  const byDay = {};
  function push(day, item) {
    (byDay[day] = byDay[day] || []).push(item);
  }
  state.tasks.forEach(function (t) {
    if (!t.dueDate) { return; }
    push(t.dueDate, { kind: "task", task: t,
      moment: taskDueMoment(t) });
  });
  state.notes.forEach(function (n) {
    if (!n.reminderAt || n.reminderDoneAt) { return; }
    const parts = noteReminderInputParts(n);
    if (!parts.date) { return; }
    push(parts.date, { kind: "note", note: n,
      moment: new Date(n.reminderAt) });
  });
  Object.keys(gcalEventsByDay).forEach(function (day) {
    const dayStart = gcalDayStartMs(day);
    gcalEventsByDay[day].forEach(function (ev) {
      push(day, { kind: "event", event: ev,
        allDay: ev.allDay,
        moment: new Date(Math.max(ev.startMs, dayStart)) });
    });
  });
  Object.keys(byDay).forEach(function (day) {
    byDay[day].sort(function (a, b) {
      const aAllDay = a.kind === "event" && a.allDay;
      const bAllDay = b.kind === "event" && b.allDay;
      if (aAllDay !== bAllDay) { return aAllDay ? -1 : 1; }
      if (aAllDay && bAllDay) {
        const ac = a.event.calendarName || "";
        const bc = b.event.calendarName || "";
        if (ac !== bc) { return ac.localeCompare(bc); }
        return a.event.title.localeCompare(b.event.title);
      }
      const am = a.moment ? a.moment.getTime() : 0;
      const bm = b.moment ? b.moment.getTime() : 0;
      if (am !== bm) { return am - bm; }
      if (a.kind !== b.kind) {
        const rank = { event: 0, task: 1, note: 2 };
        return rank[a.kind] - rank[b.kind];
      }
      const at = a.kind === "task" ? a.task.title
        : a.kind === "note" ? a.note.title : a.event.title;
      const bt = b.kind === "task" ? b.task.title
        : b.kind === "note" ? b.note.title : b.event.title;
      return String(at || "").localeCompare(String(bt || ""));
    });
  });
  return byDay;
}

/* One note reminder's agenda entry: the bell (the note
   card's own glyph), the reminder's time in the task
   system's time words, and the note's title, wearing
   the danger bar while the reminder's moment has passed
   (the card marker's overdue rule). A click opens the
   note the way every Home surface opens one. */
function buildHomeCalNoteEntryEl(note) {
  const el = document.createElement("div");
  el.className = "home-cal-note";
  el.setAttribute("data-note-id", note.id);
  el.title = note.title || "Untitled note";
  if (new Date(note.reminderAt).getTime() <= Date.now()) {
    el.classList.add("overdue");
  }
  const bell = document.createElement("span");
  bell.className = "home-cal-note-bell";
  bell.innerHTML = '<svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true" focusable="false"><path d="M10 2.5a5.5 5.5 0 0 0-5.5 5.5c0 4-1.2 5.2-2 6h14c-.8-.8-2-2-2-6A5.5 5.5 0 0 0 10 2.5zM8.4 16.8a1.8 1.8 0 0 0 3.2 0" fill="currentColor" stroke="none"/></svg>';
  el.appendChild(bell);
  const main = document.createElement("span");
  main.className = "home-cal-note-main";
  const parts = noteReminderInputParts(note);
  if (parts.time) {
    const time = document.createElement("span");
    time.className = "home-cal-note-time";
    time.textContent = taskTimeLabel(parts.time);
    main.appendChild(time);
    main.appendChild(document.createTextNode(" "));
  }
  const title = document.createElement("span");
  title.className = "home-cal-note-title";
  title.textContent = note.title || "Untitled note";
  main.appendChild(title);
  el.appendChild(main);
  el.addEventListener("click", function () {
    openNoteFromHome(note.id);
  });
  return el;
}

function buildHomeCalendarWidget() {
  const parts = homeWidgetShell("calendar", "Calendar");
  const cursor = homeCalCursorParts();
  const y = cursor.y, m = cursor.m;
  const today = taskTodayParts();
  const todayStr = formatTaskDateParts(today.y, today.m, today.d);
  const selectedStr = homeCalSelectedStr();
  const byDay = homeCalItemsByDay();
  /* v2.80: ask the calendar module for this
     month's events (lazy, cached, silent when signed
     out; see the module's header). */
  ensureGcalMonth(y, m);

  const head = document.createElement("div");
  head.className = "home-cal-head";
  const prev = document.createElement("button");
  prev.type = "button";
  prev.className = "btn small";
  prev.id = "homeCalPrev";
  prev.textContent = "‹";
  prev.setAttribute("aria-label", "Previous month");
  prev.addEventListener("click", function () {
    shiftHomeCalMonth(-1);
  });
  head.appendChild(prev);
  const title = document.createElement("div");
  title.className = "home-cal-title";
  title.textContent = new Date(y, m - 1, 1).toLocaleDateString(
    undefined, { month: "long", year: "numeric" });
  head.appendChild(title);
  const next = document.createElement("button");
  next.type = "button";
  next.className = "btn small";
  next.id = "homeCalNext";
  next.textContent = "›";
  next.setAttribute("aria-label", "Next month");
  next.addEventListener("click", function () {
    shiftHomeCalMonth(1);
  });
  head.appendChild(next);
  const todayBtn = document.createElement("button");
  todayBtn.type = "button";
  /* v2.86 (Part F): an icon button now, in the app's
     icon button dress (the mail reading pane's
     mail-icon-btn class, themed by its variables in
     both themes): a calendar carrying a centered
     dot. Its name stands in its tooltip and its
     aria-label, and its click is the one it always
     had. */
  todayBtn.className = "mail-icon-btn home-cal-today";
  todayBtn.id = "homeCalToday";
  todayBtn.title = "Today";
  todayBtn.setAttribute("aria-label", "Today");
  todayBtn.innerHTML = "<svg viewBox=\"0 0 24 24\" " +
    "width=\"17\" height=\"17\" fill=\"none\" " +
    "stroke=\"currentColor\" stroke-width=\"1.8\" " +
    "stroke-linecap=\"round\" stroke-linejoin=\"round\" " +
    "aria-hidden=\"true\"><rect x=\"3.5\" y=\"5\" " +
    "width=\"17\" height=\"16\" rx=\"2\"/>" +
    "<path d=\"M3.5 10h17M8 3v4M16 3v4\"/>" +
    "<circle cx=\"12\" cy=\"15.5\" r=\"1.4\" " +
    "fill=\"currentColor\" stroke=\"none\"/></svg>";
  todayBtn.addEventListener("click", function () {
    homeCalCursor = null;
    homeCalSelected = todayStr;
    renderHome();
  });
  head.appendChild(todayBtn);
  /* v2.81: the New event button: opens the calendar
     module's event editor for the selected day. */
  const newEventBtn = document.createElement("button");
  newEventBtn.type = "button";
  /* v2.86 (Part F): an icon button too, a calendar
     with a plus, in the same dress as Today's; its
     name stands in its tooltip and its aria-label,
     and its click is the one it always had. */
  newEventBtn.className = "mail-icon-btn";
  newEventBtn.id = "homeCalNewEventBtn";
  newEventBtn.title = "New event";
  newEventBtn.setAttribute("aria-label", "New event");
  newEventBtn.innerHTML = "<svg viewBox=\"0 0 24 24\" " +
    "width=\"17\" height=\"17\" fill=\"none\" " +
    "stroke=\"currentColor\" stroke-width=\"1.8\" " +
    "stroke-linecap=\"round\" stroke-linejoin=\"round\" " +
    "aria-hidden=\"true\"><rect x=\"3.5\" y=\"5\" " +
    "width=\"17\" height=\"16\" rx=\"2\"/>" +
    "<path d=\"M3.5 10h17M8 3v4M16 3v4M12 13v6M9 16h6\"/></svg>";
  newEventBtn.addEventListener("click", function () {
    openGcalEventEditor(null, homeCalSelectedStr());
  });
  head.appendChild(newEventBtn);
  /* v2.87 (Part C): the New task button, a third icon
     button in the same dress: a checkbox carrying its
     check, the app's own task mark. Its click mirrors
     New event's selected day courtesy through the
     standing task creation path (openTaskEditor's due
     date preset; the selected day falls back to today
     in homeCalSelectedStr, as it does for events). */
  const newTaskBtn = document.createElement("button");
  newTaskBtn.type = "button";
  newTaskBtn.className = "mail-icon-btn";
  newTaskBtn.id = "homeCalNewTaskBtn";
  newTaskBtn.title = "New task";
  newTaskBtn.setAttribute("aria-label", "New task");
  newTaskBtn.innerHTML = "<svg viewBox=\"0 0 24 24\" " +
    "width=\"17\" height=\"17\" fill=\"none\" " +
    "stroke=\"currentColor\" stroke-width=\"1.8\" " +
    "stroke-linecap=\"round\" stroke-linejoin=\"round\" " +
    "aria-hidden=\"true\"><rect x=\"4\" y=\"4\" " +
    "width=\"16\" height=\"16\" rx=\"3\"/>" +
    "<path d=\"M8.5 12.5l2.5 2.5 4.5-5.5\"/></svg>";
  newTaskBtn.addEventListener("click", function () {
    openTaskEditor(null, null, null,
      homeCalSelectedStr());
  });
  head.appendChild(newTaskBtn);
  parts.body.appendChild(head);

  const week = document.createElement("div");
  week.className = "home-cal-week";
  TASK_CAL_WEEKDAYS.forEach(function (name) {
    const wd = document.createElement("div");
    wd.className = "home-cal-wd";
    wd.textContent = name;
    week.appendChild(wd);
  });
  parts.body.appendChild(week);

  const grid = document.createElement("div");
  grid.className = "home-cal-grid";
  const firstDow = new Date(y, m - 1, 1).getDay();
  const daysInMonth = new Date(y, m, 0).getDate();
  const cellCount = Math.ceil((firstDow + daysInMonth) / 7) * 7;
  for (let i = 0; i < cellCount; i++) {
    const date = new Date(y, m - 1, 1 - firstDow + i);
    const dateStr = formatTaskDateParts(date.getFullYear(),
      date.getMonth() + 1, date.getDate());
    const cellEl = document.createElement("div");
    cellEl.className = "home-cal-day" +
      (date.getMonth() !== m - 1 ? " outside" : "") +
      (dateStr === todayStr ? " today" : "") +
      (dateStr === selectedStr ? " selected" : "");
    cellEl.setAttribute("data-date", dateStr);
    const num = document.createElement("div");
    num.className = "home-cal-daynum";
    num.textContent = String(date.getDate());
    cellEl.appendChild(num);
    if ((byDay[dateStr] || []).length) {
      const dot = document.createElement("span");
      dot.className = "home-cal-dot";
      cellEl.appendChild(dot);
    }
    cellEl.addEventListener("click", function () {
      homeCalSelected = dateStr;
      renderHome();
    });
    grid.appendChild(cellEl);
  }
  parts.body.appendChild(grid);

  /* The selected day's agenda, under the grid, in the
     Tasks calendar detail strip's shape: the day's full
     date, its item count, and the items themselves.
     Selecting a day in a neighbouring month (the muted
     cells) shows that day's agenda here without moving
     the grid, the Tasks calendar's own cell rule. */
  const selParts = parseTaskDate(selectedStr);
  if (selParts) {
    const agenda = document.createElement("div");
    agenda.className = "home-cal-agenda";
    const label = document.createElement("div");
    label.className = "home-cal-agenda-label";
    label.textContent = new Date(selParts.y, selParts.m - 1,
      selParts.d).toLocaleDateString(undefined,
      { weekday: "long", month: "long", day: "numeric" });
    const items = byDay[selectedStr] || [];
    const count = document.createElement("span");
    count.className = "home-cal-agenda-count";
    count.textContent = items.length === 0 ? "No items"
      : items.length + (items.length === 1 ? " item" : " items");
    label.appendChild(count);
    agenda.appendChild(label);
    if (!items.length) {
      agenda.appendChild(
        homeHint("No tasks or reminders on this day."));
    }
    items.forEach(function (item) {
      agenda.appendChild(item.kind === "task"
        ? buildTaskCalEntryEl(item.task)
        : item.kind === "event"
          ? buildGcalEventEl(item.event)
          : buildHomeCalNoteEntryEl(item.note));
    });
    parts.body.appendChild(agenda);
  }
  /* v2.80: the calendar module's one caption line, when
     its state carries one (see buildGcalStatusEl). */
  const gcalStatusEl = buildGcalStatusEl();
  if (gcalStatusEl) { parts.body.appendChild(gcalStatusEl); }
  return parts.widget;
}

/* The Shortcuts widget: the sidebar's Shortcuts section
   on Home. Rows are built from the same facts the
   sidebar rows are (shortcutTarget: the target's current
   name read at render, a Trash or Archive note kept and
   muted with the place named in its label, a target that
   exists nowhere rendering no row), in the stored list's
   order, and a click performs the sidebar shortcut's own
   open action by calling followShortcut itself, so the
   two surfaces can never drift apart. */
function buildHomeShortcutsWidget() {
  const parts = homeWidgetShell("shortcuts", "Shortcuts");
  let shown = 0;
  state.shortcuts.forEach(function (entry) {
    const target = shortcutTarget(entry);
    if (target.state === "missing") { return; }
    shown += 1;
    const row = document.createElement("button");
    row.type = "button";
    row.className = "home-shortcut-row" +
      (target.state === "live" ? "" : " dead");
    row.setAttribute("data-kind", entry.kind);
    row.setAttribute("data-target", entry.id);
    const icon = document.createElement("span");
    icon.className = "home-shortcut-icon";
    icon.innerHTML = SHORTCUT_ICONS[entry.kind] || "";
    row.appendChild(icon);
    const label = document.createElement("span");
    label.className = "home-shortcut-label";
    label.textContent = (entry.kind === "tag" ? "# " : "") +
      target.label;
    if (target.state === "trash" ||
        target.state === "archive") {
      const where = document.createElement("span");
      where.className = "home-shortcut-where";
      where.textContent = target.state === "trash"
        ? " (in Trash)" : " (in Archive)";
      label.appendChild(where);
    }
    row.appendChild(label);
    row.addEventListener("click", function () {
      followShortcut(entry);
    });
    parts.body.appendChild(row);
  });
  if (!shown) {
    parts.body.appendChild(homeHint("No shortcuts yet."));
  }
  return parts.widget;
}

/* ------------------------------------------------------------------
   v2.55: customize sessions (the owner's direction,
   2026-10-29: the Customize button becomes a pencil;
   Done and Cancel replace it in its place, Done
   saves the widgets and Cancel cancels any changes;
   and the huge list at the top for choosing widgets
   needs a more compact way).

   Opening a session snapshots the stored layout as a
   deep copy, twice over: the snapshot (what Cancel
   restores and what Done compares against) and the
   working copy (what every layout edit stages into
   and what Home renders from while the session is
   open). state.home itself is never touched by a
   layout edit during a session, so nothing about the
   layout can reach the persist path: the coalesced
   index writer only ever sees state.home, and the
   one write of a session is Done's, through the same
   persistHome the single edits used to call. Content
   is not layout and keeps its own behavior inside a
   session: a task checked in the Tasks widget still
   completes through the task funnel, and the Scratch
   Pad still saves its text through its own write,
   whose home field carries the pre session layout
   because state.home's layout has not moved; Cancel
   reverts arrangement and visibility only, never a
   completion or a scratch word. If a store load
   lands mid session and replaces state.home, the
   session renders on from its working copy (the copy
   is the session's whole world); Done after it
   writes the session's layout over the loaded one,
   the last writer winning as it does between two
   devices today, and Cancel simply reveals the
   loaded layout.
   ------------------------------------------------------------------ */

/* Deep copy a layout entries list. Entries are flat
   ({ type } or { type, searchId }), so a field by
   field copy is a true copy: the working copy can be
   reordered, shrunk, and discarded without ever
   touching the stored entry objects. */
function homeCopyLayout(list) {
  return list.map(function (e) {
    const copy = { type: e.type };
    if (e.type === "filtered") {
      copy.searchId = typeof e.searchId === "string" &&
        e.searchId ? e.searchId : null;
    }
    return copy;
  });
}

/* Open a customize session (the pencil). */
function enterHomeCustomize() {
  if (homeCustomSession) { return; }
  homeCustomSession = {
    snapshot: homeCopyLayout(state.home.widgets),
    work: homeCopyLayout(state.home.widgets)
  };
  homeCustomizeOpen = true;
  homeWidgetsPopoverOpen = false;
  renderHome();
}

/* Whether the working copy differs from the snapshot:
   the same types in the same order with the same
   bindings (visibility is membership, so the type
   sequence carries it). */
function homeSessionDirty() {
  const sess = homeCustomSession;
  if (!sess) { return false; }
  if (sess.work.length !== sess.snapshot.length) {
    return true;
  }
  return sess.work.some(function (e, i) {
    const o = sess.snapshot[i];
    return e.type !== o.type ||
      (e.type === "filtered" &&
        (e.searchId || null) !== (o.searchId || null));
  });
}

/* Close the session. Done assigns the working copy to
   the stored layout and persists it, exactly once,
   through the one home persist path; a session that
   changed nothing is a no-op even at Done, so the
   stored layout array is not even replaced. Cancel
   drops the working copy where it stands. Either way
   the pencil returns and Home re-renders from the
   stored layout. */
function exitHomeCustomize(commit) {
  if (!homeCustomSession) { return; }
  const work = homeCustomSession.work;
  const dirty = homeSessionDirty();
  homeCustomSession = null;
  homeCustomizeOpen = false;
  homeWidgetsPopoverOpen = false;
  if (commit && dirty) {
    state.home.widgets = work;
    persistHome();
  }
  renderHome();
}

/* The customize bar and the widget popover. Outside a
   session the bar shows the pencil alone; inside one
   the pencil hides and Widgets, Done, and Cancel show
   in its place. renderHome calls this on every
   render, so the bar and the popover always describe
   the session as it stands. The popover (the compact
   replacement for the stacked panel) lists every
   widget type: the visible ones in their working
   order, carrying the Move up and Move down buttons
   the panel's rows carried, the hidden ones after,
   and every row a switch showing its shown or hidden
   state. Its rows are rebuilt on every render while
   it is open and not built at all while it is
   closed. */
function renderHomeCustomize() {
  const inSession = !!homeCustomSession;
  const pencil = document.getElementById("homeCustomizeBtn");
  if (pencil) {
    pencil.classList.toggle("hidden", inSession);
  }
  ["homeWidgetsBtn", "homeCustomizeDoneBtn",
   "homeCustomizeCancelBtn"].forEach(function (id) {
    const btn = document.getElementById(id);
    if (btn) { btn.classList.toggle("hidden", !inSession); }
  });
  const widgetsBtn = document.getElementById("homeWidgetsBtn");
  if (widgetsBtn) {
    widgetsBtn.setAttribute("aria-expanded",
      homeWidgetsPopoverOpen ? "true" : "false");
  }
  renderHomeWidgetsPopover();
}

function renderHomeWidgetsPopover() {
  const pop = document.getElementById("homeWidgetsPopover");
  if (!pop) { return; }
  const open = !!homeCustomSession && homeWidgetsPopoverOpen;
  pop.classList.toggle("hidden", !open);
  if (!open) { pop.innerHTML = ""; return; }
  pop.innerHTML = "";
  const head = document.createElement("div");
  head.className = "home-cust-head";
  head.textContent = "Choose your widgets";
  pop.appendChild(head);
  homeActiveWidgets().forEach(function (entry) {
    pop.appendChild(homeWidgetsRow(entry.type, true));
  });
  HOME_WIDGET_TYPES.forEach(function (type) {
    if (!homeWidgetEntry(type)) {
      pop.appendChild(homeWidgetsRow(type, false));
    }
  });
  positionHomeWidgetsPopover();
}

function homeWidgetsRow(type, isVisible) {
  const row = document.createElement("div");
  row.className = "home-cust-row";
  row.setAttribute("data-widget-type", type);
  const label = document.createElement("span");
  label.className = "home-cust-label";
  label.textContent = HOME_WIDGET_LABELS[type];
  row.appendChild(label);
  function opBtn(op, text, fn) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn small home-cust-op";
    btn.setAttribute("data-cust-op", op);
    btn.textContent = text;
    btn.addEventListener("click", fn);
    row.appendChild(btn);
  }
  if (isVisible) {
    opBtn("up", "Move up", function () {
      homeMoveWidget(type, -1);
    });
    opBtn("down", "Move down", function () {
      homeMoveWidget(type, 1);
    });
  }
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "home-cust-toggle";
  toggle.setAttribute("data-cust-op", "toggle");
  toggle.setAttribute("role", "switch");
  toggle.setAttribute("aria-checked",
    isVisible ? "true" : "false");
  toggle.setAttribute("aria-label",
    (isVisible ? "Hide " : "Show ") +
      HOME_WIDGET_LABELS[type]);
  toggle.title = isVisible ? "Hide widget" : "Show widget";
  toggle.addEventListener("click", function () {
    if (homeWidgetEntry(type)) { homeRemoveWidget(type); }
    else { homeAddWidget(type); }
  });
  row.appendChild(toggle);
  return row;
}

function toggleHomeWidgetsPopover() {
  if (!homeCustomSession) { return; }
  homeWidgetsPopoverOpen = !homeWidgetsPopoverOpen;
  renderHomeCustomize();
}

function closeHomeWidgetsPopover() {
  if (!homeWidgetsPopoverOpen) { return; }
  homeWidgetsPopoverOpen = false;
  renderHomeCustomize();
}

/* v2.72 (Chris's Testing Checklist, Home section): the
   Widgets popover sits at the bottom of the Widgets
   button, aligned with it. Through v2.71 the stylesheet
   hung it from the HEADER (top: the header's bottom
   plus 8px, right: the header's padding edge), so it
   opened offset from the button that summoned it,
   lower and further right. The popover's offset parent
   is still the header (its parent element); what
   changes is the measurement: its top edge lands 6px
   under the BUTTON's bottom edge and its right edge
   flush with the button's right edge, recomputed on
   every render while it stands open and on window
   resize, so it tracks the button if the header
   reflows. Then the viewport guard: if the anchored
   box would cross either viewport edge it is shifted
   back inside by the overflow (at phone widths its
   width is already capped by the stylesheet's
   max-width, so the shift is the rare case, not the
   rule). */
function positionHomeWidgetsPopover() {
  const pop = document.getElementById("homeWidgetsPopover");
  const btn = document.getElementById("homeWidgetsBtn");
  if (!pop || !btn || pop.classList.contains("hidden")) {
    return;
  }
  const head = pop.parentElement;
  if (!head) { return; }
  const b = btn.getBoundingClientRect();
  const h = head.getBoundingClientRect();
  pop.style.top = Math.round(b.bottom - h.top + 6) + "px";
  pop.style.left = "auto";
  let right = Math.round(h.right - b.right);
  pop.style.right = right + "px";
  const r = pop.getBoundingClientRect();
  const vw = (typeof window !== "undefined" &&
    window.innerWidth) || 0;
  if (r && r.width) {
    if (r.left < 8) {
      right -= Math.ceil(8 - r.left);
      pop.style.right = right + "px";
    } else if (vw && r.right > vw - 8) {
      right += Math.ceil(r.right - (vw - 8));
      pop.style.right = right + "px";
    }
  }
}

/* Render Home: the greeting and date over the widget
   grid, the widgets in the stored layout's order. The
   one element a render must never rebuild is the
   scratch pad while it is being typed in: a render
   landing then (a sync's, above all) would drop the
   caret and any not yet persisted keystroke, so the
   live widget is lifted out of the old grid and set
   into the new one untouched. */
function renderHome() {
  const pane = document.getElementById("homepane");
  if (!pane) { return; }
  /* v2.68.0: hold the pane's visibility until the first
     packed layout lands (see releaseHomeHold); visibility
     hidden keeps every widget measurable, so the pack
     below runs at full speed while held. */
  if (!homeHoldReleased) { pane.classList.add("home-hold"); }
  const greet = document.getElementById("homeGreeting");
  if (greet) {
    greet.textContent = homeGreetingText(new Date());
  }
  const dateEl = document.getElementById("homeDate");
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString(
      undefined, { weekday: "long", month: "long",
        day: "numeric", year: "numeric" });
  }
  renderHomeCustomize();
  const grid = document.getElementById("homeGrid");
  if (!grid) { return; }
  /* v2.60.1: the height capture's pointer and hide
     feeders hang off the grid (see
     ensureHomeScratchFeeders); registering is a
     one-time act, done here because the grid is this
     function's own surface. */
  ensureHomeScratchFeeders(grid);
  let liveScratch = null;
  const active = document.activeElement;
  const scratchNow = grid.querySelector(
    ".home-widget[data-widget-type=\"scratch\"]");
  if (scratchNow && active && scratchNow.contains(active)) {
    liveScratch = scratchNow;
  }
  grid.innerHTML = "";
  homeActiveWidgets().forEach(function (entry) {
    let el = null;
    if (entry.type === "scratch" && liveScratch) {
      el = liveScratch;
    } else if (entry.type === "pinned") {
      el = buildHomePinnedWidget();
    } else if (entry.type === "recent") {
      el = buildHomeRecentWidget();
    } else if (entry.type === "shortcuts") {
      el = buildHomeShortcutsWidget();
    } else if (entry.type === "tasks") {
      el = buildHomeTasksWidget();
    } else if (entry.type === "calendar") {
      el = buildHomeCalendarWidget();
    } else if (entry.type === "scratch") {
      el = buildHomeScratchWidget();
    } else if (entry.type === "filtered") {
      el = buildHomeFilteredWidget();
    } else if (entry.type === "tags") {
      el = buildHomeTagsWidget();
    } else if (entry.type === "notebooks") {
      el = buildHomeNotebooksWidget();
    } else if (entry.type === "email") {
      el = buildHomeEmailWidget();
    }
    if (el) { grid.appendChild(el); }
  });
  const empty = document.getElementById("homeEmpty");
  if (empty) {
    empty.classList.toggle("hidden",
      homeActiveWidgets().length > 0);
  }
  /* v2.42: the widgets' drag handles follow the
     Customize mode (see syncHomeWidgetDragHandles). */
  syncHomeWidgetDragHandles();
  /* v2.52: the packing pass places the widgets (see
     layoutHomeWidgets); it runs after the handles so
     a handle's presence is already settled when the
     heights are measured. */
  layoutHomeWidgets();
}

/* --------------------------------------------------------------------------
   v2.38: note templates (Evernote parity, phase 3
   release 3).

   Evernote's model (its help pages "Use templates",
   "Create your own templates", and "Edit your
   templates", read at build time):
   - Templates come in two kinds: a gallery of ready
     made templates, and the user's own, saved from any
     note through the note's More actions menu (Save as
     template), which collects the template's name.
   - Applying a template, from the new note flow or
     from the Templates section itself, generates a NEW
     note whose title and body start from the
     template's, in the notebook in play. The template
     and any note it came from are never touched.
   - A saved template is a snapshot: editing the source
     note afterwards does not change it.
   - Saved templates sync across devices, live in a
     Templates gallery surface (not scattered through
     notebooks), and can be renamed and deleted;
     deleting one never touches a note made from it.
   - Creating custom templates sat in Evernote's paid
     tiers historically; this app has no tiers, so
     saving a template is simply free here.

   Built here: four built in gallery templates in code
   (never stored, never manageable), the user's customs
   in index.json's templates field ({id, name, title,
   body, created, updated}), the notes list menu's Save
   as Template item, and one gallery modal reached from
   the sidebar's Templates button, listing built ins
   and customs with rename and delete on the customs.

   The attachment rule: a template body cannot carry an
   .ss-attachment block honestly, because the block's
   data-attachment-id names a file that belongs to the
   SOURCE note's attachment records; a note made from
   the template would point at a file it does not own.
   So at save time each attachment block becomes its
   labeled line, "[Attachment: name]", exactly the
   label the body shows for the file today, and the
   applied note's attachments stay empty. Everything
   else in the body (headings, checklists, tables, and
   any self contained content) rides as it is, through
   the same canonicalization a saved body passes.

   Named deviations from Evernote: the gallery ships
   four built ins (Evernote's is dozens, imported from
   its website one by one; these are always present and
   cannot be removed, pinned, or imported); rows show a
   text preview rather than a preview image, and a
   click applies at once rather than opening a preview
   page; there is no pinning a template as a new note
   suggestion, no daily note template setting, and no
   standalone template editor (shape a note, save it as
   the new template, delete the old one); Save as
   Template lives in the notes list menu, this app's
   note actions surface, because the editor has no
   three dot menu; and the name prompt and the delete
   confirm are the app's native prompt and confirm
   flow, the dialog deviation the earlier parity
   releases already carry.
   -------------------------------------------------------------------------- */

const BUILTIN_TEMPLATES = [
  {
    id: "builtin-meeting-notes",
    name: "Meeting Notes",
    title: "Meeting Notes",
    body: "<h1>Meeting Notes</h1>" +
      "<p><strong>Date:</strong> </p>" +
      "<p><strong>Attendees:</strong> </p>" +
      "<h2>Agenda</h2>" +
      "<ul><li>Topic one</li><li>Topic two</li></ul>" +
      "<h2>Discussion</h2>" +
      "<p>Notes from the discussion.</p>" +
      "<h2>Decisions</h2>" +
      "<ul><li>Decision one</li></ul>" +
      "<h2>Action items</h2>" +
      "<ul class=\"ss-checklist\">" +
      "<li><input type=\"checkbox\">Follow up item</li>" +
      "</ul>"
  },
  {
    id: "builtin-weekly-planner",
    name: "Weekly Planner",
    title: "Weekly Planner",
    body: "<h1>Weekly Planner</h1>" +
      "<p><strong>Week of:</strong> </p>" +
      "<h2>Top priorities</h2>" +
      "<ul class=\"ss-checklist\">" +
      "<li><input type=\"checkbox\">Priority one</li>" +
      "<li><input type=\"checkbox\">Priority two</li>" +
      "<li><input type=\"checkbox\">Priority three</li>" +
      "</ul>" +
      "<h2>Monday</h2>" +
      "<ul class=\"ss-checklist\">" +
      "<li><input type=\"checkbox\">Task</li></ul>" +
      "<h2>Tuesday</h2>" +
      "<ul class=\"ss-checklist\">" +
      "<li><input type=\"checkbox\">Task</li></ul>" +
      "<h2>Wednesday</h2>" +
      "<ul class=\"ss-checklist\">" +
      "<li><input type=\"checkbox\">Task</li></ul>" +
      "<h2>Thursday</h2>" +
      "<ul class=\"ss-checklist\">" +
      "<li><input type=\"checkbox\">Task</li></ul>" +
      "<h2>Friday</h2>" +
      "<ul class=\"ss-checklist\">" +
      "<li><input type=\"checkbox\">Task</li></ul>"
  },
  {
    id: "builtin-project-plan",
    name: "Project Plan",
    title: "Project Plan",
    body: "<h1>Project Plan</h1>" +
      "<h2>Overview</h2>" +
      "<p>What this project is and why it matters.</p>" +
      "<h2>Goals</h2>" +
      "<ul><li>Goal one</li><li>Goal two</li></ul>" +
      "<h2>Milestones</h2>" +
      "<ul><li>Milestone one</li><li>Milestone two</li></ul>" +
      "<h2>Tasks</h2>" +
      "<ul class=\"ss-checklist\">" +
      "<li><input type=\"checkbox\">First task</li>" +
      "<li><input type=\"checkbox\">Second task</li>" +
      "</ul>" +
      "<h2>Notes</h2>" +
      "<p>Open questions and things to watch.</p>"
  },
  {
    id: "builtin-daily-journal",
    name: "Daily Journal",
    title: "Daily Journal",
    body: "<h1>Daily Journal</h1>" +
      "<p><strong>Date:</strong> </p>" +
      "<h2>Grateful for</h2>" +
      "<ul><li>One thing</li></ul>" +
      "<h2>Highlights</h2>" +
      "<p>The best parts of the day.</p>" +
      "<h2>Notes</h2>" +
      "<p>Anything else worth remembering.</p>" +
      "<h2>Tomorrow</h2>" +
      "<ul class=\"ss-checklist\">" +
      "<li><input type=\"checkbox\">One thing to do</li>" +
      "</ul>"
  }
];

/* sanitizeTemplates(raw): the read side's one
   definition of a usable custom template, applied by
   every load path (sync load, cache apply) before the
   list is trusted, the sanitizeSavedSearches shape: a
   template needs a nonblank id and name plus a string
   title and body (either may be empty text; a titleless
   snapshot is still a snapshot), duplicate ids lose,
   and created and updated pass through as strings,
   blank when the source never said. */
function sanitizeTemplates(raw) {
  if (!Array.isArray(raw)) { return []; }
  const out = [];
  const seenIds = {};
  raw.forEach(function (t) {
    if (!t || typeof t !== "object") { return; }
    const id = typeof t.id === "string" ? t.id : "";
    const name = typeof t.name === "string" ? t.name : "";
    if (!id.trim() || !name.trim()) { return; }
    if (typeof t.title !== "string" ||
        typeof t.body !== "string") { return; }
    if (seenIds[id]) { return; }
    seenIds[id] = true;
    out.push({
      id: id,
      name: name,
      title: t.title,
      body: t.body,
      created: typeof t.created === "string" ? t.created : "",
      updated: typeof t.updated === "string" ? t.updated : ""
    });
  });
  return out;
}

/* persistTemplates(): the custom templates persist
   exactly the way the saved searches do, because they
   live in the same place: the queued index write (the
   single writer discipline; debounce-safe at sign out)
   while connected with a repo, then the cache snapshot,
   which carries them to the next cache first paint. */
function persistTemplates() {
  if (state.online && state.repoExists) { saveIndex(); }
  saveCache();
}

/* customTemplateById(id): a custom lookup helper. Only
   state.templates is searched: a built in answering to
   the management paths at all would be a bug, so the
   management paths each start here and a built in id
   simply is not found. */
function customTemplateById(id) {
  return state.templates.find(function (t) {
    return t.id === id;
  }) || null;
}

/* templateById(id): the lookup apply uses: customs
   first, then the built ins. Returns the entry itself
   (both kinds carry the same {id, name, title, body}
   shape), or null. */
function templateById(id) {
  const custom = customTemplateById(id);
  if (custom) { return custom; }
  return BUILTIN_TEMPLATES.find(function (t) {
    return t.id === id;
  }) || null;
}

/* templateNameTaken(name, exceptId): a template's name
   is its identity in the gallery, so a new or renamed
   custom may not reuse the name of another custom OR
   of a built in (a custom called Meeting Notes next to
   the built in Meeting Notes would be
   indistinguishable). The comparison is trimmed and
   case-insensitive, so near duplicates are refused
   too. exceptId spares the entry being renamed. */
function templateNameTaken(name, exceptId) {
  const wanted = String(name || "").trim().toLowerCase();
  if (!wanted) { return false; }
  const clash = function (t) {
    return t.id !== exceptId &&
      t.name.trim().toLowerCase() === wanted;
  };
  return state.templates.some(clash) ||
    BUILTIN_TEMPLATES.some(clash);
}

/* templateBodyFromNote(note): the snapshot body. The
   note's body first passes the same canonicalization
   every save passes (attachment blocks become their
   saved shells, table of contents blocks their
   canonical form), then each attachment shell is
   replaced with its labeled line, because the file it
   names belongs to the source note (see the section
   header for the rule). The label is the attachment
   record's name where one is on the note, and the
   generic word otherwise. */
function templateBodyFromNote(note) {
  const holder = document.createElement("div");
  holder.innerHTML = canonicalizeAttachmentPlaceholders(
    note.body || "");
  holder.querySelectorAll(".ss-attachment").forEach(
    function (el) {
      const rec = (note.attachments || []).find(
        function (a) {
          return a.id ===
            el.getAttribute("data-attachment-id");
        });
      const p = document.createElement("p");
      p.textContent = "[Attachment: " +
        (rec ? rec.name : "attachment") + "]";
      el.replaceWith(p);
    });
  return holder.innerHTML;
}

/* saveNoteAsTemplate(note, name): the store path
   behind Save as Template. Refuses an untaken name
   check exactly the way Save search refuses a duplicate
   (a toast naming the collision, no entry saved), and
   snapshots the note's CURRENT title and body into a
   new entry: the body is copied through
   templateBodyFromNote, so nothing later done to the
   note can reach the template (the snapshot rule).
   Persists and re-renders on success. Returns the new
   entry, or null when refused. */
function saveNoteAsTemplate(note, name) {
  const nm = String(name || "").trim();
  if (!note || !nm) { return null; }
  if (templateNameTaken(nm, null)) {
    toast("A template named \"" + nm +
      "\" already exists.", true);
    return null;
  }
  const now = new Date().toISOString();
  const entry = {
    id: newNoteId(),
    name: nm,
    title: note.title || "Untitled note",
    body: templateBodyFromNote(note),
    created: now,
    updated: now
  };
  state.templates.push(entry);
  persistTemplates();
  renderAll();
  toast("Saved as template \"" + nm + "\".");
  return entry;
}

/* renameTemplate(id, name): the entry menu's Rename.
   Store rules: only a custom can be renamed (a built
   in id is not found, so it returns false untouched);
   a blank name is refused; a name taken by another
   custom or a built in is refused with the same toast
   the save path gives, the stacks and saved searches
   refusal wording. A case only change of the entry's
   own name is fine. Returns whether the rename landed. */
function renameTemplate(id, name) {
  const entry = customTemplateById(id);
  if (!entry) { return false; }
  const nm = String(name || "").trim();
  if (!nm) { return false; }
  if (templateNameTaken(nm, entry.id)) {
    toast("A template named \"" + nm +
      "\" already exists.", true);
    return false;
  }
  entry.name = nm;
  entry.updated = new Date().toISOString();
  persistTemplates();
  renderAll();
  return true;
}

/* deleteTemplate(id): the entry menu's Delete. Only a
   custom can be deleted (a built in id is not found and
   returns false). The notes are never consulted: a note
   made from the template carries its own copied body,
   so deleting the template cannot reach it, the
   Evernote rule. Persists and re-renders. */
function deleteTemplate(id) {
  const before = state.templates.length;
  state.templates = state.templates.filter(function (t) {
    return t.id !== id;
  });
  if (state.templates.length === before) { return false; }
  persistTemplates();
  renderAll();
  return true;
}

/* createNoteFromTemplate(tpl): applying, which is note
   creation, so it mirrors createNoteInRepo step for
   step (the same notebook choice the New Note button
   makes, the same background save with the same
   failure toast), with the template's title and
   canonicalized body as the starting content. The body
   passes canonicalizeAttachmentPlaceholders the way an
   imported body does: a body saved before the
   attachment rule, or one holding a labeled line only,
   comes out as a valid saved body, and no attachment
   records are created (the applied note owns none). */
async function createNoteFromTemplate(tpl) {
  let notebookSlug = state.view.kind === "notebook"
    ? state.view.value
    : fallbackNotebookSlug();
  if (!state.notebooks.length) {
    await createNotebook("Personal");
    notebookSlug = state.notebooks[0].slug;
  }
  const note = makeNote(notebookSlug || fallbackNotebookSlug(),
    tpl.title || "Untitled note",
    canonicalizeAttachmentPlaceholders(tpl.body || ""));
  /* v2.121: a template note created in a notebook whose
     Doc switch is on is Doc-backed, on the New Note rule
     (see createNoteInRepo): its content saves into a new
     Google Doc. */
  if (notebookDocStoreEnabled(note.notebook)) {
    note.backend = "doc";
    note.docId = null;
  }
  state.notes.unshift(note);
  saveCache();
  renderAll();
  openNote(note.id);
  saveNoteToRepo(note, { skipConflictCheck: true, fresh: true })
    .then(function () { saveCache(); })
    .catch(function (err) {
      toast("Note created locally; save failed: " +
        err.message, true);
    });
  return note;
}

/* applyTemplate(id): the gallery row click. Resolves
   the template (custom or built in), closes the
   gallery, and creates the note. Returns the creation
   promise (resolving to the note), or a resolved null
   for an unknown id, so no caller has to care which. */
function applyTemplate(id) {
  const tpl = templateById(id);
  if (!tpl) { return Promise.resolve(null); }
  closeTemplateGallery();
  return createNoteFromTemplate(tpl);
}

/* promptSaveNoteAsTemplate(): the notes list menu's
   Save as Template item. The snapshot must be of the
   note as the user sees it, so the body is completed
   first when the note is still a shell (the move to
   trash shell rule), and the open editor's live content
   is collected when the note is the one on screen,
   before the name prompt opens with the note's title
   as the default, Evernote's save flow. A refused load
   says so plainly and saves nothing. */
async function promptSaveNoteAsTemplate(targetNote) {
  /* v2.58: an optional target note (the context menu's
     Save as Template passes its card's note); with none,
     the selected note, as always. */
  const note = targetNote || currentNote();
  if (!note || state.notes.indexOf(note) < 0) { return; }
  if (note.bodyLoaded === false) {
    await ensureNoteBodyLoaded(note);
    if (note.bodyLoaded === false) {
      toast("That note has not loaded on this device " +
        "yet, so it cannot be saved as a template.", true);
      return;
    }
  }
  const editor = document.getElementById("noteBody");
  const pane = document.getElementById("editorpane");
  if (state.selectedId === note.id && editor && pane &&
      !pane.classList.contains("hidden")) {
    collectEditor(note);
  }
  const name = prompt("Save as template",
    note.title || "Untitled note");
  if (name === null) { return; }
  saveNoteAsTemplate(note, name);
}

/* templatePreviewText(body): the row's preview line:
   the body's own text, tags stripped by a parse (never
   a regex over markup), whitespace collapsed, cut to a
   scannable length. A template with no text at all
   previews as its title's promise instead: the words
   say the note starts empty. */
function templatePreviewText(body) {
  const holder = document.createElement("div");
  holder.innerHTML = body || "";
  const text = (holder.textContent || "")
    .replace(/\s+/g, " ").trim();
  if (!text) { return "Blank body"; }
  return text.length > 140 ? text.slice(0, 140) + "..." : text;
}

/* templateMenuFor: the custom template id the open
   gallery entry menu acts on, or null, the saved search
   menu's one variable. */
let templateMenuFor = null;

function closeTemplateMenu() {
  templateMenuFor = null;
  const menu = document.getElementById("templateMenu");
  if (menu) { menu.classList.add("hidden"); }
}

/* openTemplateMenu(entry, rowEl): positions the shared
   entry menu under its row, the saved search menu's
   geometry (row offset top plus its height, in the
   positioned gallery wrap's coordinates). Opening a
   second row's menu simply moves the one card. */
function openTemplateMenu(entry, rowEl) {
  const menu = document.getElementById("templateMenu");
  if (!menu) { return; }
  if (templateMenuFor === entry.id &&
      !menu.classList.contains("hidden")) {
    closeTemplateMenu();
    return;
  }
  templateMenuFor = entry.id;
  menu.style.top = (rowEl.offsetTop + rowEl.offsetHeight + 2) + "px";
  menu.classList.remove("hidden");
}

/* buildTemplateRow(tpl, isBuiltin): one gallery row: a
   main button (the name over its preview, the
   preview muted so the name leads, the saved search
   row's hierarchy) whose click applies the template,
   plus, for customs only, the three dot entry menu
   button. Built in rows get no menu button at all:
   a gallery's stock items are not the user's to
   rename or delete. */
function buildTemplateRow(tpl, isBuiltin) {
  const row = document.createElement("div");
  row.className = "template-row";
  row.setAttribute("data-id", tpl.id);
  if (isBuiltin) { row.setAttribute("data-builtin", "1"); }
  const main = document.createElement("button");
  main.type = "button";
  main.className = "template-main";
  const nameEl = document.createElement("span");
  nameEl.className = "template-name";
  nameEl.textContent = tpl.name;
  const previewEl = document.createElement("span");
  previewEl.className = "template-preview";
  previewEl.textContent = templatePreviewText(tpl.body);
  main.appendChild(nameEl);
  main.appendChild(previewEl);
  main.addEventListener("click", function () {
    applyTemplate(tpl.id);
  });
  row.appendChild(main);
  if (!isBuiltin) {
    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "template-menu-btn";
    menuBtn.textContent = "\u22EE"; /* the vertical
       ellipsis, the saved search menu button's glyph,
       written as an escape like the rest of the file */
    menuBtn.setAttribute("aria-label",
      "Actions for template " + tpl.name);
    menuBtn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      openTemplateMenu(tpl, row);
    });
    row.appendChild(menuBtn);
  }
  return row;
}

/* renderTemplateGallery(): rebuilds both groups from
   state: the built ins in their code order, then the
   customs in saved order, or the empty line Evernote's
   empty gallery answers with in spirit (here: how to
   make the first one). Any open entry menu closes,
   since its row is about to be replaced. */
function renderTemplateGallery() {
  const builtinList = document.getElementById(
    "templateBuiltinList");
  const customList = document.getElementById(
    "templateCustomList");
  if (!builtinList || !customList) { return; }
  closeTemplateMenu();
  builtinList.innerHTML = "";
  BUILTIN_TEMPLATES.forEach(function (tpl) {
    builtinList.appendChild(buildTemplateRow(tpl, true));
  });
  customList.innerHTML = "";
  if (!state.templates.length) {
    const empty = document.createElement("div");
    empty.className = "template-empty";
    empty.textContent = "No custom templates yet. Open a " +
      "note and choose Save as Template in the notes " +
      "list menu to make one.";
    customList.appendChild(empty);
  }
  state.templates.forEach(function (tpl) {
    customList.appendChild(buildTemplateRow(tpl, false));
  });
}

function openTemplateGallery() {
  renderTemplateGallery();
  document.getElementById("templateModal")
    .classList.remove("hidden");
}

function closeTemplateGallery() {
  closeTemplateMenu();
  const modal = document.getElementById("templateModal");
  if (modal) { modal.classList.add("hidden"); }
}

/* --------------------------------------------------------------------------
   Note operations: create, trash, restore, delete forever, archive
   Moving a note between the notebooks tree, trash/, and archive/ is a
   write to the new path plus a delete of the old path. Offline, both
   halves are queued.

   v1.5: every operation in this section updates state and re-renders
   FIRST, so the screen changes the instant the user acts, and runs its
   storage work afterwards through the per note operation chain (see
   chainNoteOp). Each function still returns the promise of its storage
   work: click handlers let it run in the background, while composite
   callers such as deleteNotebook keep awaiting it exactly as before.
   The file text and both paths are captured at action time, so a
   later operation on the same note can never change what an earlier,
   still queued operation writes.
   -------------------------------------------------------------------------- */
function makeNote(notebookSlug, title, body) {
  const now = new Date().toISOString();
  return {
    id: newNoteId(),
    title: title || "Untitled note",
    notebook: notebookSlug,
    tags: [],
    created: now,
    updated: now,
    pinned: false,
    body: body || "",
    bodyLoaded: true,  /* v2.20: a made note's body is right here */
    previewText: null, /* v2.20: only catalog shells use this field */
    attachments: [],   /* v1.2: new notes start with no attachments */
    thumbnail: null,   /* v2.11: no thumbnail until one is chosen */
    reminderAt: null,  /* v2.35: no reminder until one is set */
    reminderDoneAt: null,
    sha: null,
    fileId: null,      /* v2.20: assigned by the first store write or load */
    backend: "file",   /* v2.121: an ordinary note file; the notebook
                          create flows in this file mark a new note
                          "doc" when its notebook's Doc switch is on */
    docId: null,       /* v2.121: a Doc-backed note's Google Doc id */
    trashed: false,
    trashedFrom: null,
    archived: false,        /* v1.5 */
    archivedFrom: null      /* v1.5 */
  };
}

async function createNoteInRepo(notebookSlug) {
  if (!state.notebooks.length) {
    await createNotebook("Personal");
    notebookSlug = state.notebooks[0].slug;
  }
  /* v2.72: a create naming no notebook takes the
     default notebook (fallbackNotebookSlug). */
  const note = makeNote(notebookSlug || fallbackNotebookSlug());
  /* v2.121: when the target notebook's Doc switch is on,
     the new note is Doc-backed: its first save (the
     background save below) creates its Google Doc and
     every later save writes into that same Doc. The note
     opens empty in the editor exactly like a file note. */
  if (notebookDocStoreEnabled(note.notebook)) {
    note.backend = "doc";
    note.docId = null;
  }
  state.notes.unshift(note);
  /* v1.4.4: the note opens immediately. Before this change the editor
     waited for the full upload chain (on Drive: resolve the folder,
     list it, upload the file), so a new note took a few seconds to
     appear. The note is already in state and in the local cache, so
     the upload now runs in the background. Failure handling matches
     the old blocking version: saveNoteToRepo itself queues the write
     when offline, when the Google sign in expired, and on conflict
     paths, and any other failure surfaces with the same toast wording
     as before. The fresh flag tells the Drive driver this file is
     brand new, so it may skip its existence check listing. Per path
     serialization inside saveNoteToRepo keeps a first autosave from
     overtaking this create while it is still in flight. */
  saveCache();
  renderAll();
  openNote(note.id);
  saveNoteToRepo(note, { skipConflictCheck: true, fresh: true })
    .then(function () {
      /* The background write assigned the note its storage token
         (note.sha). Persist it, so later conflict checks compare
         against the token this create returned. */
      saveCache();
    })
    .catch(function (err) {
      toast("Note created locally; save failed: " + err.message, true);
    });
  return note;
}

/* --------------------------------------------------------------------------
   v2.39: Duplicate note and Merge notes (Evernote parity, phase 3
   release 4), modeled on Evernote's own flows (its help article
   "Merge multiple notes into a single note" and the Evernote 10
   release notes for Duplicate):

   - Duplicate, from the notes list menu's Duplicate note item,
     makes a fully independent copy in the same notebook. The
     title gains " copy" (Evernote 10's convention), and when
     that title is already taken in the notebook the number
     increments: " copy 2", " copy 3", and so on, the way
     Evernote increments its copy numbers. The copy opens in
     the editor, as a fresh duplicate does in Evernote.
   - Merge, from the same menu's Merge Selected item, runs on
     the live list's checked notes (the checkbox selection the
     Trash and Archive views have always had, extended to the
     live views for this): one new note titled after the FIRST
     note in the list's current order, holding each source's
     content in that order under its own title heading with a
     divider line between sections (Evernote's merge offers
     titles in the merged content and divider lines as its
     advanced options; SnakeScale always applies both), tags
     unioned, and the originals then moved to Trash, where
     they can be restored, exactly as Evernote's merge leaves
     them when its keep-a-copy option is off.

   Both operations copy attachments as TRUE copies: every
   attachment file a copied body references is downloaded and
   re-uploaded as a brand new file under a brand new record,
   and the copied body's placeholders are remapped to the new
   records, so no two notes ever share one attachment file and
   deleting either note's files can never break the other. A
   copy operation that cannot complete (a body that will not
   load, a file that will not download or upload) stops before
   anything is created or moved and names what failed.

   Two deliberate departures from a blind copy, both about
   schedules rather than content: a duplicate or merged note
   never inherits a reminder (the original keeps its own; two
   notes on one reminder would fire twice for one obligation,
   in the app and in the chat watcher alike), and it is never
   born pinned (the pin is the original's place in the list,
   not part of its content). Tags, the body, the attachments,
   and a thumbnail whose image is among the copied records DO
   carry over, the thumbnail remapped to the new record.
   -------------------------------------------------------------------------- */

/* Fold the editor's live content into note when note is the
   one on screen, the guard the template save and the notebook
   move both apply before acting on the open note: a copy made
   from the note as the user sees it, unsaved words included. */
function collectIfOpen(note) {
  const editor = document.getElementById("noteBody");
  const pane = document.getElementById("editorpane");
  if (state.selectedId === note.id && editor && pane &&
      !pane.classList.contains("hidden")) {
    collectEditor(note);
  }
}

/* The title a duplicate of source gets: Evernote 10 appends
   " copy" and increments the copy number when the plain copy
   title is taken. Taken is judged among the live notes of the
   source's own notebook, the list the copy will land in. */
function duplicateCopyTitle(source) {
  const base = source.title || "Untitled note";
  const taken = {};
  state.notes.forEach(function (n) {
    if (n.notebook === source.notebook) {
      taken[n.title || "Untitled note"] = true;
    }
  });
  let candidate = base + " copy";
  let n = 2;
  while (taken[candidate]) {
    candidate = base + " copy " + n;
    n++;
  }
  return candidate;
}

/* Copy one attachment record as a true copy (the per file
   half of copyAttachmentsForNewNote below): download its
   file and re-upload the bytes as a new file under a new
   record, through the same provider driver the original
   upload used. Resolves to { record, uploaded } (uploaded:
   the { driver, fileId } pair a rollback needs). Throws an
   Error naming the file when any step cannot run (a
   provider that is unavailable or signed out, offline, a
   failed download or upload). */
async function copyOneAttachment(source, att) {
  const providerName = att.provider || state.attach.defaultProvider;
  const driver = providers[providerName];
  if (!driver) {
    throw new Error("the file \"" + att.name + "\" could not be " +
      "copied because its storage provider is not available.");
  }
  if (!state.online) {
    throw new Error("the file \"" + att.name + "\" could not be " +
      "copied because you appear to be offline.");
  }
  const status = await driver.getStatus();
  if (!status || !status.connected) {
    throw new Error("the file \"" + att.name + "\" could not be " +
      "copied because " + providerLabel(providerName) +
      " is not signed in.");
  }
  /* The copy is fed from the downloaded BYTES, read
     through the app's own blob reader, never from the
     blob object itself: the upload then carries exactly
     the bytes the download produced, in any browser (and
     in the test harness, whose cross realm blobs a File
     constructor would otherwise stringify). */
  let bytes;
  try {
    const blob = await driver.download(att.fileId);
    bytes = new Uint8Array(await readBlobArrayBuffer(blob));
  } catch (e) {
    throw new Error("the file \"" + att.name + "\" could not " +
      "be copied: " + e.message);
  }
  const newId = newNoteId() + "a";
  const storageName = newId + "__" + sanitizeFileName(att.name);
  const file = new File([bytes], att.name,
    { type: att.mime || "application/octet-stream" });
  let result;
  try {
    result = await driver.upload(file, storageName,
      function () { });
  } catch (e) {
    throw new Error("the file \"" + att.name + "\" could not " +
      "be copied: " + e.message);
  }
  if (!result || !result.fileId) {
    throw new Error("the file \"" + att.name +
      "\" could not be copied.");
  }
  const newRec = {
    id: newId,
    provider: providerName,
    fileId: String(result.fileId),
    name: att.name,
    storageName: storageName,
    mime: att.mime || "application/octet-stream",
    size: bytes.length,
    created: new Date().toISOString()
  };
  /* v2.46: a copied sketch stays a sketch: the marking
     rides to the new record, and the placeholder
     attribute rides the copied body, so the copy's
     image menu offers Edit sketch like the original's. */
  if (att.sketch === true) { newRec.sketch = true; }
  /* v2.76: a copied recording keeps its transcript: the
     words describe the copied bytes exactly as they
     described the original's, timings included, so the
     copy's card shows the section and its words seek
     the copy's own player. Sanitized into fresh
     objects, so the two records never share one. */
  if (att.transcript) {
    const trCopy = sanitizeTranscript(att.transcript);
    if (trCopy) { newRec.transcript = trCopy; }
  }
  return {
    record: newRec,
    uploaded: { driver: driver, fileId: String(result.fileId) }
  };
}

/* Copy every attachment a body references as a true copy:
   for each record on source whose id appears among the
   body's attachment placeholders, a copyOneAttachment runs.
   Records the body does not reference are not copied: the
   save funnel's reconciliation drops a record with no block
   on the note's first save anyway, so copying one would
   only orphan its new file.
   Resolves to { records, idMap } (idMap: source record id to
   new record id), the records in the source's own order.
   Throws an Error naming the file when any step cannot run;
   files already uploaded for this copy are deleted again
   best effort, so a stopped copy leaves behind nothing that
   it made.
   v2.69: the per file copies run concurrently under the
   bulk pool (a fresh one bounds this call on its own when
   the caller passes none). Each copy resolves to an outcome
   instead of throwing, so one failure cannot strand the
   others mid flight, and a copy that has not started when a
   failure lands copies nothing. The error thrown is the
   earliest failing file's in the source's order, word for
   word what the one at a time copy threw, so every caller's
   message is unchanged. */
async function copyAttachmentsForNewNote(source, bodyHtml, pool) {
  const referenced = {};
  const holder = document.createElement("div");
  holder.innerHTML = bodyHtml || "";
  holder.querySelectorAll(".ss-attachment").forEach(function (el) {
    const id = el.getAttribute("data-attachment-id");
    if (id) { referenced[id] = true; }
  });
  const wanted = (source.attachments || []).filter(function (a) {
    return referenced[a.id];
  });
  const records = [];
  const idMap = {};
  if (!wanted.length) { return { records: records, idMap: idMap }; }
  const usePool = pool || makeBulkPool(BULK_OP_CONCURRENCY);
  let failureSeen = false;
  const outcomes = await Promise.all(wanted.map(function (att) {
    return usePool.run(async function () {
      if (failureSeen) { return { skipped: true }; }
      try {
        return await copyOneAttachment(source, att);
      } catch (err) {
        failureSeen = true;
        return { error: err };
      }
    });
  }));
  const uploaded = [];   /* { driver, fileId }, for the cleanup below */
  let firstError = null;
  outcomes.forEach(function (outcome, i) {
    if (outcome.record) {
      uploaded.push(outcome.uploaded);
      records.push(outcome.record);
      idMap[wanted[i].id] = outcome.record.id;
    } else if (outcome.error && !firstError) {
      firstError = outcome.error;
    }
  });
  if (firstError) {
    for (const up of uploaded) {
      try {
        await up.driver.trash(up.fileId);
      } catch (e) { /* best effort, like every attachment cleanup */ }
    }
    throw firstError;
  }
  return { records: records, idMap: idMap };
}

/* Point a copied body's attachment placeholders at the new
   records a copy made: each placeholder's data-attachment-id
   is swapped through idMap. A placeholder whose record was
   not copied keeps its id, and the save funnel's
   reconciliation settles it like any orphan block. */
function remapBodyAttachmentIds(bodyHtml, idMap) {
  if (!bodyHtml) { return ""; }
  if (!Object.keys(idMap).length) { return bodyHtml; }
  const holder = document.createElement("div");
  holder.innerHTML = bodyHtml;
  holder.querySelectorAll(".ss-attachment").forEach(function (el) {
    const oldId = el.getAttribute("data-attachment-id");
    if (oldId && idMap[oldId]) {
      el.setAttribute("data-attachment-id", idMap[oldId]);
    }
  });
  return holder.innerHTML;
}

/* Build a duplicate of source without placing it (v2.69
   splits this out of duplicateNote so the bulk duplicate
   can build its copies concurrently and place them
   together): load the body if source is a shell, collect
   the editor if source is the open note, and make the
   attachment true copies under the given pool. Resolves to
   { copy } (still titleless: the title is judged against
   state at placement time, as it was when the build and
   the placement were one flow) or { error } carrying the
   exact message the single duplicate toasts, so the bulk
   path reports a copy it could not build in the same
   words. A stopped build changes nothing. */
async function tryBuildDuplicateCopy(source, pool) {
  if (source.bodyLoaded === false) {
    await ensureNoteBodyLoaded(source);
    if (source.bodyLoaded === false) {
      return { error: "That note is not loaded on this device " +
        "yet, so it could not be duplicated." };
    }
  }
  collectIfOpen(source);
  let copied;
  try {
    copied = await copyAttachmentsForNewNote(source,
      source.body || "", pool);
  } catch (err) {
    return { error: "Duplicate stopped: " + err.message };
  }
  const copy = makeNote(source.notebook, "", "");
  copy.tags = (source.tags || []).slice();
  copy.attachments = copied.records;
  copy.body = canonicalizeAttachmentPlaceholders(
    remapBodyAttachmentIds(source.body || "", copied.idMap));
  if (source.thumbnail && copied.idMap[source.thumbnail]) {
    copy.thumbnail = copied.idMap[source.thumbnail];
  }
  return { copy: copy };
}

/* Duplicate the live note source in its own notebook (see the
   section header for the full rule). The copy is built
   detached and only joins state once its attachment copies
   have all landed, so a stopped copy changes nothing; then
   it is created through the same unshift, cache, render,
   open, and background save flow as a brand new note (the
   createNoteFromTemplate pattern), the copy's birth as an
   ordinary note creation, never a shared twin. */
async function duplicateNote(source) {
  if (!source || state.notes.indexOf(source) < 0) { return null; }
  const built = await tryBuildDuplicateCopy(source, null);
  if (!built.copy) {
    toast(built.error, true);
    return null;
  }
  const copy = built.copy;
  copy.title = duplicateCopyTitle(source);
  state.notes.unshift(copy);
  saveCache();
  renderAll();
  openNote(copy.id);
  saveNoteToRepo(copy, { skipConflictCheck: true, fresh: true })
    .then(function () { saveCache(); })
    .catch(function (err) {
      toast("Note created locally; save failed: " + err.message, true);
    });
  toast("Duplicated as \"" + copy.title + "\".");
  return copy;
}

/* --------------------------------------------------------------------------
   v2.42: the merge order dialog. Through v2.41 the merge
   ran behind a plain confirm and always combined in
   list order. Evernote's merge opens a pop up listing
   the notes to be merged, draggable into a chosen
   order, the new note taking the title of the note
   listed at the top. This dialog is that shape, order
   only: the Advanced options Evernote offers beside
   the order (keep a copy of the originals, divider and
   title toggles) stay unbuilt, a named deviation, and
   everything past the order (title headings, dividers,
   tag union, attachment true copies, originals to
   Trash) is the merge machinery it always was.

   openMergeOrderDialog resolves with the chosen order
   (an array of the same note objects), or null when the
   dialog is cancelled: Cancel, a click on the backdrop,
   or Escape. While the dialog is open nothing in state
   has changed; the rows' order lives in the DOM and in
   mergeOrderPending.notes, and Merge reads the DOM's
   final order, so what the user sees is what merges.
   -------------------------------------------------------------------------- */
let mergeOrderPending = null;   /* { notes, resolve } */

function openMergeOrderDialog(notes) {
  return new Promise(function (resolve) {
    const modal = document.getElementById("mergeOrderModal");
    const list = document.getElementById("mergeOrderList");
    if (!modal || !list) {
      /* Without the dialog there is no order to choose;
         the list order the caller holds is the merge. */
      resolve(notes.slice());
      return;
    }
    mergeOrderPending = { notes: notes.slice(),
      resolve: resolve };
    renderMergeOrderRows();
    modal.classList.remove("hidden");
    const firstHandle = list.querySelector(".merge-order-drag");
    if (firstHandle) { firstHandle.focus(); }
  });
}

function renderMergeOrderRows() {
  const list = document.getElementById("mergeOrderList");
  const pending = mergeOrderPending;
  if (!list || !pending) { return; }
  list.innerHTML = "";
  pending.notes.forEach(function (note) {
    const row = document.createElement("div");
    row.className = "merge-order-row";
    row.setAttribute("data-note-id", note.id);
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "merge-order-drag ss-drag-handle";
    handle.setAttribute("aria-label",
      "Drag to reorder " + (note.title || "Untitled note"));
    handle.title = "Drag to reorder";
    handle.innerHTML = SS_DRAG_GRIP_ICON;
    row.appendChild(handle);
    const text = document.createElement("div");
    text.className = "merge-order-text";
    const title = document.createElement("span");
    title.className = "merge-order-title";
    title.textContent = note.title || "Untitled note";
    text.appendChild(title);
    const nb = document.createElement("span");
    nb.className = "merge-order-nb";
    nb.textContent = notebookNameForSlug(note.notebook);
    text.appendChild(nb);
    row.appendChild(text);
    list.appendChild(row);
    attachReorderDrag(handle, row, {
      itemSelector: ".merge-order-row",
      keyOf: function (el) {
        return el.getAttribute("data-note-id");
      },
      scrollEl: list,
      onCommit: function (keys) {
        if (!mergeOrderPending) { return; }
        const byId = {};
        mergeOrderPending.notes.forEach(function (n) {
          byId[n.id] = n;
        });
        const seq = keys.map(function (k) {
          return byId[k];
        });
        if (seq.some(function (n) { return !n; })) {
          return;
        }
        mergeOrderPending.notes = seq;
        updateMergeOrderResultTitle();
      }
    });
  });
  updateMergeOrderResultTitle();
}

/* The result line names the title the merged note will
   take: the first row's, updated as the order changes. */
function updateMergeOrderResultTitle() {
  const el = document.getElementById("mergeOrderResultTitle");
  const pending = mergeOrderPending;
  if (!el || !pending || !pending.notes.length) { return; }
  el.textContent = pending.notes[0].title || "Untitled note";
}

function closeMergeOrderDialog(ordered) {
  const pending = mergeOrderPending;
  if (!pending) { return; }
  mergeOrderPending = null;
  const modal = document.getElementById("mergeOrderModal");
  if (modal) { modal.classList.add("hidden"); }
  pending.resolve(ordered || null);
}

function confirmMergeOrderDialog() {
  const pending = mergeOrderPending;
  if (!pending) { return; }
  const list = document.getElementById("mergeOrderList");
  const byId = {};
  pending.notes.forEach(function (n) { byId[n.id] = n; });
  const ordered = Array.prototype.map.call(
    list.querySelectorAll(".merge-order-row"),
    function (r) {
      return byId[r.getAttribute("data-note-id")];
    }).filter(function (n) { return !!n; });
  closeMergeOrderDialog(
    ordered.length === pending.notes.length
      ? ordered : pending.notes.slice());
}

/* Merge the live list's checked notes into one new note (see
   the section header). Validation and every fallible step run
   BEFORE anything in state changes: the selection resolves
   and is checked live, every body loads, the open editor is
   collected when a source is on screen, the user confirms,
   and every attachment copy lands; only then is the merged
   note created and the originals moved to Trash through the
   real trash path. A refusal or a failure at any earlier step
   names itself and leaves the notes, the trash, and the
   selection exactly as they were. */
async function mergeSelectedNotes() {
  const ids = state.listSelection.slice();
  if (ids.length < 2) {
    toast("Select at least two notes to merge.", true);
    return null;
  }
  const sources = [];
  for (const id of ids) {
    const live = state.notes.find(function (n) { return n.id === id; });
    if (live) { sources.push(live); continue; }
    const inTrash = state.trash.some(function (n) { return n.id === id; });
    const inArchive = state.archive.some(function (n) {
      return n.id === id;
    });
    toast("Merge stopped: one of the selected notes is " +
      (inTrash ? "in the Trash" : inArchive ? "in the Archive"
        : "no longer available") +
      ", and merging works on live notes only. " +
      "Nothing was changed.", true);
    return null;
  }
  /* The merge starts in the list's current order: what
     visibleNotes shows, filtered to the selection. A selected
     note the current filters hide keeps its place at the end,
     in selection order, rather than dropping out of the merge
     it was checked for. The order dialog below may then
     reorder the merge; its choice replaces this order. */
  let chosen = visibleNotes().filter(function (n) {
    return ids.indexOf(n.id) >= 0;
  });
  sources.forEach(function (n) {
    if (chosen.indexOf(n) < 0) { chosen.push(n); }
  });
  /* v2.69: the body loads run concurrently under the bulk
     pool instead of one at a time; the verdict below is
     still read in the chosen order, so the note a stopped
     merge names is the same one the serial loads named. */
  const mergeLoadPool = makeBulkPool(BULK_OP_CONCURRENCY);
  await runPooledOutcomes(mergeLoadPool, chosen, function (note) {
    return ensureNoteBodyLoaded(note);
  });
  for (const note of chosen) {
    if (note.bodyLoaded === false) {
      toast("Merge stopped: \"" + (note.title || "Untitled note") +
        "\" could not be loaded on this device, so nothing was " +
        "merged and no notes were moved.", true);
      return null;
    }
  }
  chosen.forEach(function (note) { collectIfOpen(note); });
  /* v2.42: the plain confirm is the merge order dialog
     now (Evernote's shape): it lists the chosen notes in
     this order, the user may drag them into a new one,
     and Merge runs in the order it returns. Cancelling
     it leaves the notes, the trash, and the selection
     exactly as they were, as the old confirm's No did. */
  const ordered = await openMergeOrderDialog(chosen);
  if (!ordered) { return null; }
  chosen = ordered;
  /* One copy pass per source into one shared map, so every
     placeholder in every section can be remapped below; the
     same records list carries all of them. v2.69: the passes
     run concurrently, every source's copies drawing on one
     bulk pool; the results still assemble in the chosen
     order, and the failure a stopped merge reports is the
     earliest failing source's in that order, the one the
     serial passes reported. */
  const records = [];
  const idMap = {};
  const pool = makeBulkPool(BULK_OP_CONCURRENCY);
  const copyOutcomes = await Promise.all(chosen.map(function (note) {
    return copyAttachmentsForNewNote(note, note.body || "", pool)
      .then(function (copied) { return { copied: copied }; },
        function (err) { return { error: err }; });
  }));
  const copyFailure = copyOutcomes.find(function (outcome) {
    return outcome.error;
  });
  if (copyFailure) {
    toast("Merge stopped: " + copyFailure.error.message +
      " Nothing was changed.", true);
    return null;
  }
  copyOutcomes.forEach(function (outcome) {
    outcome.copied.records.forEach(function (r) { records.push(r); });
    Object.keys(outcome.copied.idMap).forEach(function (k) {
      idMap[k] = outcome.copied.idMap[k];
    });
  });
  /* Point of no return: the selection empties, the merged
     note is created, and the originals move to Trash. */
  state.listSelection = [];
  const parts = [];
  chosen.forEach(function (note, i) {
    if (i > 0) { parts.push("<hr>"); }
    parts.push("<h2>" + escapeHtml(note.title || "Untitled note") +
      "</h2>");
    parts.push(remapBodyAttachmentIds(note.body || "", idMap));
  });
  const tags = [];
  chosen.forEach(function (note) {
    (note.tags || []).forEach(function (t) {
      const dupe = tags.some(function (x) {
        return x.toLowerCase() === t.toLowerCase();
      });
      if (!dupe) { tags.push(t); }
    });
  });
  const first = chosen[0];
  const merged = makeNote(first.notebook,
    first.title || "Untitled note", "");
  merged.body = canonicalizeAttachmentPlaceholders(parts.join(""));
  merged.tags = tags;
  merged.attachments = records;
  if (first.thumbnail && idMap[first.thumbnail]) {
    merged.thumbnail = idMap[first.thumbnail];
  }
  /* v2.69: the catalog hold spans the landing (the merged
     note's arrival and the originals' moves), so it lands
     as one coalesced catalog write. The merged note's own
     save still completes before any original moves: that
     dependency is the merge's safety, and it stays serial. */
  holdCatalogWrites();
  state.notes.unshift(merged);
  saveCache();
  renderAll();
  try {
    await saveNoteToRepo(merged, { skipConflictCheck: true, fresh: true });
  } catch (err) {
    /* The merged note exists locally but is not stored, so the
       originals stay exactly where they were rather than the
       merge half landing: the user keeps every note, and the
       unstored merged note can be deleted or retried like any
       failed save. */
    toast("The merged note was created locally, but its save " +
      "failed: " + err.message + " The original notes were left " +
      "where they were.", true);
    releaseCatalogWrites();
    openNote(merged.id);
    return merged;
  }
  saveCache();
  await runPooledOutcomes(pool, chosen, function (note) {
    return moveNoteToTrash(note, true);
  });
  saveCache();
  releaseCatalogWrites();
  openNote(merged.id);
  toast("Merged " + chosen.length + " notes into \"" +
    (merged.title || "Untitled note") +
    "\". The originals are in Trash.");
  return merged;
}

/* --------------------------------------------------------------------------
   v2.41: Create Table of Contents Note (Evernote parity, phase 3
   closing extra), modeled on Evernote's classic multi select
   command of the same name: select notes, choose the command,
   and Evernote makes ONE new note inside the notebook the
   selection was made in, titled "Table of Contents", whose body
   is one internal note link per selected note, in list order,
   each labeled with the note's title. (Evernote's current help
   center covers only the in-note table of contents, the v2.37
   block; the multi note command is documented by Evernote's
   older help and a decade of consistent accounts.) The selected
   notes are not modified, moved, or trashed, and the new note
   is an ordinary note from birth: it is made by makeNote, saved
   through the same funnel, and read by search, the catalog,
   templates, shortcuts, and the backlink graph exactly like
   any other note, so each target's Backlinks panel counts it
   as a source the moment it exists, and it can itself be an
   entry in a later table of contents note.

   The command needs a multi selection (in Evernote the options
   panel offering it only replaces the editor when more than
   one note is selected), so the menu item enables at two or
   more checked live notes, like Merge Selected. The notebook
   rule follows the selection's list order, the merge
   convention: the new note lands in the notebook of the FIRST
   selected note in the list's current order, which is the
   notebook of the selection whenever the selection sits in one
   notebook, as Evernote's does by construction.

   One deliberate departure from Merge's validated selection
   discipline, stated plainly: a selected note that has left
   the live notes since it was checked (trashed, archived, or
   deleted elsewhere) is left out rather than stopping the
   whole action. Merging moves the originals, so a stale member
   there is a stop; this action moves nothing, so the stale
   member is simply skipped and the completion toast names how
   many were left out. When fewer than two valid notes remain,
   nothing is created and the toast says so. The selection
   clears when the note is created, exactly as Merge leaves
   it. -------------------------------------------------------------------------- */

/* One table of contents entry: the app's own note link anchor,
   born in Mention view with the target's title as its label
   and tooltip, exactly the shape Link to Note and the "@"
   popup insert (see pickNoteLinkTarget), wrapped in its own
   paragraph so each entry stands on its own line. */
function tocNoteLinkParagraph(note) {
  const title = note.title || "Untitled note";
  return "<p><a href=\"" + SSNOTE_HREF_PREFIX + note.id +
    "\" class=\"ss-note-link\" title=\"" + escapeHtml(title) +
    "\" data-ss-link-view=\"mention\">" + escapeHtml(title) +
    "</a></p>";
}

/* Create the table of contents note for the live list's
   checked notes (see the section header). Nothing fallible
   stands between the validation and the creation: the note
   needs no source body and copies no file, so once the
   selection resolves to two or more live notes the note is
   made and opened at once, its save running through the
   real funnel behind it; a failed save keeps the local
   note and names itself, the create flow's shape. */
async function createTableOfContentsNote() {
  const ids = state.listSelection.slice();
  if (ids.length < 2) {
    toast("Select at least two notes to make a table of " +
      "contents note.", true);
    return null;
  }
  /* Resolve the selection against the live notes, in the
     list's current order, the merge order rule: what
     visibleNotes shows, filtered to the selection, then any
     selected live note the current filters hide, in
     selection order. Members that are no longer live notes
     are counted and left out (see the header). */
  const chosen = visibleNotes().filter(function (n) {
    return ids.indexOf(n.id) >= 0;
  });
  ids.forEach(function (id) {
    const live = state.notes.find(function (n) {
      return n.id === id;
    });
    if (live && chosen.indexOf(live) < 0) { chosen.push(live); }
  });
  const leftOut = ids.length - chosen.length;
  if (chosen.length < 2) {
    toast("Table of contents stopped: fewer than two of the " +
      "selected notes are still in the live list, so no note " +
      "was created.", true);
    return null;
  }
  const first = chosen[0];
  const toc = makeNote(first.notebook, "Table of Contents", "");
  toc.body = canonicalizeAttachmentPlaceholders(
    chosen.map(tocNoteLinkParagraph).join(""));
  /* Point of no return: the selection empties and the new
     note joins the notes, exactly the merge flow's shape,
     minus anything being moved anywhere. */
  state.listSelection = [];
  state.notes.unshift(toc);
  saveCache();
  renderAll();
  /* v2.69: the note opens the moment it exists, the create
     flow's shape (through v2.68 the open waited on the
     save); the save completes behind it and the success
     toast fires from its completion, so what the toast
     reports is still a landed save. */
  openNote(toc.id);
  try {
    await saveNoteToRepo(toc, { skipConflictCheck: true, fresh: true });
  } catch (err) {
    /* The note exists locally but is not stored; it can be
       edited, retried, or deleted like any failed save, and
       no source note was ever touched. */
    toast("The table of contents note was created locally, " +
      "but its save failed: " + err.message, true);
    return toc;
  }
  saveCache();
  toast("Created \"Table of Contents\" linking " + chosen.length +
    " notes." + (leftOut > 0
      ? " " + leftOut + " selected " +
        (leftOut === 1 ? "note was" : "notes were") +
        " no longer in the live list and left out."
      : ""));
  return toc;
}

/* v2.20: the four placement operations whose implementations
   follow (trash, restore, archive, unarchive) capture the note's
   file text synchronously at action time, so a catalog shell,
   whose body is not on this device, is completed before the
   operation runs. The deferred operation then proceeds exactly
   as it always has and its promise is the one returned, so
   awaiting callers (notebook deletion above all) keep their
   timing. A shell whose file cannot be fetched keeps its place
   and says so, rather than moving an empty body over the stored
   note. */
function moveNoteToTrash(note, quiet) {
  if (note && note.bodyLoaded === false) {
    return ensureNoteBodyLoaded(note).then(function () {
      if (note.bodyLoaded === false) {
        toast("That note is not loaded on this device yet, so it " +
          "could not be moved to Trash.", true);
        return null;
      }
      return moveNoteToTrashNow(note, quiet);
    });
  }
  /* v2.51: moving the OPEN note to Trash serializes the
     note object, so its unsettled editor edits settle
     first (see settleOpenNoteEdits): the copy that lands
     in Trash then carries the final text, and the settle's
     save is chained ahead of the move's own writes on the
     note's operation chain. The settle's verdict is not
     consulted here: landed is the ordinary case, a pause
     still leaves the collected object for the move's
     unconditional write (and the move clears the
     divergence mark, as it always has), and even a hard
     failure leaves the collected text in the object the
     move writes and caches. The move is its own
     preservation, so it proceeds in every case. */
  if (note && state.selectedId === note.id && swEditorUnsettled()) {
    return settleOpenNoteEdits().then(function () {
      return moveNoteToTrashNow(note, quiet);
    });
  }
  return moveNoteToTrashNow(note, quiet);
}

function restoreNote(note, quiet) {
  if (note && note.bodyLoaded === false) {
    return ensureNoteBodyLoaded(note).then(function () {
      if (note.bodyLoaded === false) {
        toast("That note is not loaded on this device yet, so it " +
          "could not be restored.", true);
        return null;
      }
      return restoreNoteNow(note, quiet);
    });
  }
  return restoreNoteNow(note, quiet);
}

function archiveNote(note, quiet) {
  if (note && note.bodyLoaded === false) {
    return ensureNoteBodyLoaded(note).then(function () {
      if (note.bodyLoaded === false) {
        toast("That note is not loaded on this device yet, so it " +
          "could not be archived.", true);
        return null;
      }
      return archiveNoteNow(note, quiet);
    });
  }
  /* v2.51: the archive move serializes the note object
     exactly as the trash move does, so the open note's
     unsettled edits settle first the same way, and the
     archived copy carries the final text. See the matching
     block in moveNoteToTrash above for the full reasoning;
     as there, the move proceeds on its own preservation
     whatever the settle's verdict. */
  if (note && state.selectedId === note.id && swEditorUnsettled()) {
    return settleOpenNoteEdits().then(function () {
      return archiveNoteNow(note, quiet);
    });
  }
  return archiveNoteNow(note, quiet);
}

function unarchiveNote(note, quiet) {
  if (note && note.bodyLoaded === false) {
    return ensureNoteBodyLoaded(note).then(function () {
      if (note.bodyLoaded === false) {
        toast("That note is not loaded on this device yet, so it " +
          "could not be unarchived.", true);
        return null;
      }
      return unarchiveNoteNow(note, quiet);
    });
  }
  return unarchiveNoteNow(note, quiet);
}

/* Move a note to Trash. quiet=true is used by deleteNotebook, which moves
   many notes at once and renders once at the end.
   v1.5: the state change, the cache write, and the render all happen
   immediately; the file move runs afterwards through the per note
   operation chain and this function returns that work's promise.
   v1.5 also lets an archived note be trashed directly from the Archive
   view: it leaves the archive list, its archivedFrom notebook becomes
   its trashedFrom (so Restore still returns it to the notebook it
   originally came from), and its file moves out of archive/. */
function moveNoteToTrashNow(note, quiet) {
  /* v2.121: trashing a Doc-backed note continues it as a
     file note: this function's flow below writes the note
     file at the trash path (the wrapper above completed
     the shell from the Doc, so the body is here to
     write), and clearing the backend pair here is what
     makes every later step, restore included, treat it
     as the file note it now is. The Google Doc itself is
     left in Drive, unlinked from the app: a named Stage
     3 limitation, not a silent deletion. */
  if (isDocBackedNote(note)) {
    note.backend = "file";
    note.docId = null;
    note.docName = undefined;
    note.fileId = null;
    note.sha = null;
  }
  const oldPath = notePath(note);
  const wasArchived = !!note.archived;
  const online = state.online && state.repoExists;
  note.trashed = true;
  note.trashedFrom = wasArchived
    ? (note.archivedFrom || note.notebook)
    : note.notebook;
  note.archived = false;
  note.archivedFrom = null;
  note.pinned = false;
  note.updated = new Date().toISOString();
  const newPath = notePath(note);
  const text = serializeNote(note);
  state.notes = state.notes.filter(function (n) { return n.id !== note.id; });
  state.archive = state.archive.filter(function (n) { return n.id !== note.id; });
  state.trash.unshift(note);
  /* v2.17.1: the trash move re-paths the note with its own
     unconditional write, so any divergence mark is moot. */
  clearNoteDivergence(note.id);
  if (state.selectedId === note.id) { state.selectedId = null; }
  if (!online) {
    /* Offline (or the store is not connected): queue both halves, in
       order, exactly as before. The note keeps no storage token until
       the flush writes it. */
    queueOp({ kind: "put", path: newPath, content: text, noteId: note.id });
    queueOp({ kind: "delete", path: oldPath, noteId: note.id });
    note.sha = null;
  }
  saveCache();
  if (!quiet) { renderAll(); }
  if (!online) { return Promise.resolve(); }
  return chainNoteOp(note, async function () {
    try {
      note.sha = await storePutFile(newPath, text, null, "Move note to trash");
      const oldFile = await storeGetFile(oldPath);
      if (oldFile) {
        await storeDeleteFile(oldPath, oldFile.token,
          wasArchived ? "Remove note from archive" : "Remove note from notebook");
      }
      /* The put assigned the note its new storage token. Persist it,
         so later conflict checks compare against the right token. */
      saveCache();
    } catch (err) {
      toast("Trash move failed on " + storageDisplayName() + ": " + err.message, true);
    }
  });
}

/* Restore a note from Trash back to its notebook.
   v1.5: same instant pattern as moveNoteToTrash. The target notebook
   is settled synchronously: createNotebook updates state before it
   returns its promise, so the fallback below never has to wait. */
function restoreNoteNow(note, quiet) {
  const oldPath = notePath(note);
  const online = state.online && state.repoExists;
  let target = note.trashedFrom || note.notebook || "personal";
  if (!state.notebooks.some(function (nb) { return nb.slug === target; })) {
    /* The notebook it came from is gone. Put it in the first notebook
       that exists, creating Personal if there are none at all. */
    if (!state.notebooks.length) { createNotebook("Personal"); }
    target = state.notebooks[0].slug;
  }
  note.trashed = false;
  note.trashedFrom = null;
  note.notebook = target;
  note.updated = new Date().toISOString();
  const newPath = notePath(note);
  const text = serializeNote(note);
  state.trash = state.trash.filter(function (n) { return n.id !== note.id; });
  state.notes.unshift(note);
  /* v2.17.1: the restore re-paths the note with its own
     unconditional write, so any divergence mark is moot. */
  clearNoteDivergence(note.id);
  if (!online) {
    queueOp({ kind: "put", path: newPath, content: text, noteId: note.id });
    queueOp({ kind: "delete", path: oldPath, noteId: note.id });
    note.sha = null;
  }
  saveCache();
  if (!quiet) { renderAll(); }
  if (!online) { return Promise.resolve(); }
  return chainNoteOp(note, async function () {
    try {
      note.sha = await storePutFile(newPath, text, null, "Restore note from trash");
      const oldFile = await storeGetFile(oldPath);
      if (oldFile) { await storeDeleteFile(oldPath, oldFile.token, "Remove note from trash"); }
      saveCache();
    } catch (err) {
      toast("Restore failed on " + storageDisplayName() + ": " + err.message, true);
    }
  });
}

/* Delete a trashed note's file for good.
   v1.5: the note leaves the screen immediately and the delete runs
   through the operation chain. The storage token is read inside the
   chain, not at click time: if the trash move that put the file there
   is still in flight ahead of this delete, the token it assigns is
   the one this delete must present. */
function deleteNoteForever(note) {
  const path = notePath(note);
  const online = state.online && state.repoExists;
  state.trash = state.trash.filter(function (n) { return n.id !== note.id; });
  /* v2.58: an archived note deleted forever through the
     Archive selection's context menu leaves the Archive
     list the same way; for a trashed note this is a no-op. */
  state.archive = state.archive.filter(function (n) { return n.id !== note.id; });
  if (state.selectedId === note.id) { state.selectedId = null; }
  /* v2.49.0: the note's linked tasks outlive it (they are
     citizens of the Tasks view in their own right), but
     their link pointed here, so it is cleared at this one
     site, the path every Delete Forever flow runs
     through, via the task mutation funnel. Trash and
     Archive never come here: they keep the link, so a
     restored note gets its tasks back. */
  clearTaskNoteLinks(note.id);
  /* v2.31: the note's shortcut goes with it (trashing kept
     it, rendered unavailable; forever is forever). This
     flow writes no index of its own, so a changed list is
     persisted through the ordinary index save. */
  if (shortcutsDrop("note", note.id) && state.online && state.repoExists) {
    saveIndex();
  }
  /* v2.17.1: the note is gone for good; its divergence mark,
     and the banner if it pointed here, go with it. */
  clearNoteDivergence(note.id);
  if (!online) {
    queueOp({ kind: "delete", path: path, noteId: note.id });
    /* v2.8: the note's version history is deleted with it. Offline
       that is a second queued delete, right behind the note's own,
       so the flush removes the history in the same pass. */
    queueOp({ kind: "delete", path: versionHistoryPath(note.id), noteId: note.id });
    forgetLastSavedContent(note.id);
    delete versionHistoryCache[note.id];
    versionHistoryPruneNeeded.delete(note.id);
  }
  saveCache();
  renderAll();
  if (!online) { return Promise.resolve(); }
  return chainNoteOp(note, async function () {
    let noteError = null;
    try {
      const file = note.sha ? { token: note.sha } : await storeGetFile(path);
      if (file && file.token) {
        await storeDeleteFile(path, file.token, "Delete note forever");
      }
    } catch (err) {
      noteError = err;
    }
    /* v2.8: the history file goes too, best effort and independent
       of the note delete above: its own failure never blocks or
       masks the note deletion. This is the one central path, so
       the single Delete Forever button, Delete Selected, and
       Empty Trash (all of which run through deleteNotesForever
       into here) all clean up history the same way. */
    await deleteVersionHistoryBestEffort(note.id);
    forgetLastSavedContent(note.id);
    versionHistoryPruneNeeded.delete(note.id);
    if (noteError) {
      toast("Delete failed on " + storageDisplayName() + ": " + noteError.message, true);
    }
  });
}

/* v2.58: Delete Forever for one note, with its
   confirmation. Through v2.57 this body was the editor's
   Delete Forever button handler itself; the button still
   runs exactly it, and the Trash context menu's Delete
   Forever item runs it too, so the confirmation, the
   attachment cleanup, the delete, and the warnings are
   one flow, never two. */
async function confirmDeleteNoteForever(note) {
  if (!note) { return; }
  /* v1.2: the confirmation also covers the note's cloud files. They
     are deleted best effort BEFORE the note file goes, and anything
     that could not be deleted is named in a warning afterwards, so the
     user knows exactly what remains in their cloud accounts. */
  const atts = note.attachments || [];
  let confirmText = "Delete \"" + (note.title || "Untitled note") +
    "\" forever? This removes the file from your " +
    storageDeletePhrase() +
    " and cannot be undone from inside the app.";
  if (atts.length) {
    confirmText += " Its " + atts.length + " attachment file(s) will also be " +
      "deleted from their cloud storage where that provider is signed in. " +
      "Files whose provider is not signed in cannot be deleted by the app " +
      "and will be left behind in that cloud account.";
  }
  if (!confirm(confirmText)) { return; }
  let failed = [];
  if (atts.length) {
    failed = state.online
      ? await deleteAttachmentsBestEffort(note)
      : atts.map(function (a) { return a.name; });
  }
  try {
    await deleteNoteForever(note);
    toast("Deleted forever.");
  } catch (err) {
    toast(err.message, true);
  }
  if (failed.length) {
    toast("Warning: these cloud files could not be deleted and remain in " +
      "their storage accounts: " + failed.join(", "), true);
  }
}

/* Archive a note (v1.5): tuck it out of its notebook into the archive
   folder without deleting it. Mirrors moveNoteToTrash exactly: the
   note leaves the regular lists the moment it is archived, and its
   file move finishes in the background through the operation chain.
   archivedFrom remembers the notebook, so Unarchive is a plain
   restore under another name. Pinned is cleared, as with Trash. */
function archiveNoteNow(note, quiet) {
  /* v2.121: archiving a Doc-backed note continues it as
     a file note, on the trash rule (see
     moveNoteToTrashNow): the flow below writes the note
     file at the archive path, and the Google Doc is left
     in Drive unlinked. */
  if (isDocBackedNote(note)) {
    note.backend = "file";
    note.docId = null;
    note.docName = undefined;
    note.fileId = null;
    note.sha = null;
  }
  const oldPath = notePath(note);
  const online = state.online && state.repoExists;
  note.archived = true;
  note.archivedFrom = note.notebook;
  note.pinned = false;
  note.updated = new Date().toISOString();
  const newPath = notePath(note);
  const text = serializeNote(note);
  state.notes = state.notes.filter(function (n) { return n.id !== note.id; });
  state.archive.unshift(note);
  /* v2.17.1: the archive move re-paths the note with its own
     unconditional write, so any divergence mark is moot. */
  clearNoteDivergence(note.id);
  if (state.selectedId === note.id) { state.selectedId = null; }
  if (!online) {
    queueOp({ kind: "put", path: newPath, content: text, noteId: note.id });
    queueOp({ kind: "delete", path: oldPath, noteId: note.id });
    note.sha = null;
  }
  saveCache();
  if (!quiet) { renderAll(); }
  if (!online) { return Promise.resolve(); }
  return chainNoteOp(note, async function () {
    try {
      note.sha = await storePutFile(newPath, text, null, "Archive note");
      const oldFile = await storeGetFile(oldPath);
      if (oldFile) { await storeDeleteFile(oldPath, oldFile.token, "Remove note from notebook"); }
      saveCache();
    } catch (err) {
      toast("Archive move failed on " + storageDisplayName() + ": " + err.message, true);
    }
  });
}

/* Unarchive a note (v1.5): return it to the notebook it was archived
   from, with restoreNote's fallback when that notebook is gone (the
   first notebook that exists, creating Personal if there are none). */
function unarchiveNoteNow(note, quiet) {
  const oldPath = notePath(note);
  const online = state.online && state.repoExists;
  let target = note.archivedFrom || note.notebook || "personal";
  if (!state.notebooks.some(function (nb) { return nb.slug === target; })) {
    if (!state.notebooks.length) { createNotebook("Personal"); }
    target = state.notebooks[0].slug;
  }
  note.archived = false;
  note.archivedFrom = null;
  note.notebook = target;
  note.updated = new Date().toISOString();
  const newPath = notePath(note);
  const text = serializeNote(note);
  state.archive = state.archive.filter(function (n) { return n.id !== note.id; });
  state.notes.unshift(note);
  /* v2.17.1: the unarchive re-paths the note with its own
     unconditional write, so any divergence mark is moot. */
  clearNoteDivergence(note.id);
  if (!online) {
    queueOp({ kind: "put", path: newPath, content: text, noteId: note.id });
    queueOp({ kind: "delete", path: oldPath, noteId: note.id });
    note.sha = null;
  }
  saveCache();
  if (!quiet) { renderAll(); }
  if (!online) { return Promise.resolve(); }
  return chainNoteOp(note, async function () {
    try {
      note.sha = await storePutFile(newPath, text, null, "Unarchive note");
      const oldFile = await storeGetFile(oldPath);
      if (oldFile) { await storeDeleteFile(oldPath, oldFile.token, "Remove note from archive"); }
      saveCache();
    } catch (err) {
      toast("Unarchive failed on " + storageDisplayName() + ": " + err.message, true);
    }
  });
}

/* --------------------------------------------------------------------------
   v2.13: the starter note, defined once and used in two places:
   seedInitialStore creates it in a brand new store, and the
   Settings Getting started section's Add the starter note button
   creates (or opens) it on any store. The body demonstrates the
   app instead of describing it: headings, bold, italic, and
   highlighted text (the highlight color is the highlight palette's
   own custom default, #FFF3A3, carried as an inline background
   color so it saves and renders like a highlight a user makes), a
   working checklist whose first item is already done in the v2.7
   shape (the done class plus the checked attribute, so it opens
   ticked), a small table, and an ordinary Text mode web link. The
   note is pinned and carries the welcome and examples tags.
   -------------------------------------------------------------------------- */
const STARTER_NOTE_TITLE = "Start here: see what SnakeScale Notes can do";
const STARTER_NOTE_TAGS = ["welcome", "examples"];
const STARTER_NOTE_BODY =
  "<p>Welcome to <b>SnakeScale Notes</b>. This note lives in your own " +
  "Google Drive, in the SnakeScale Notes folder, and so does everything " +
  "else you write here. It is also a tour: each part below is a real, " +
  "working example you can edit, tick, or delete.</p>" +
  "<h2>Headings and formatted text</h2>" +
  "<p>Notes can hold <b>bold</b>, <i>italic</i>, and " +
  "<span style=\"background-color:#FFF3A3\">highlighted</span> text, in " +
  "the sizes and colors the toolbar offers. Headings like the one above " +
  "keep longer notes easy to scan.</p>" +
  "<h2>A working checklist</h2>" +
  "<p>Tick these off. A ticked box stays ticked when the note saves and " +
  "reopens:</p>" +
  "<ul class=\"ss-checklist\">" +
  "<li class=\"done\"><input type=\"checkbox\" checked>Make your first " +
  "note with New Note</li>" +
  "<li><input type=\"checkbox\">Try the Checklist button in the " +
  "toolbar</li>" +
  "<li><input type=\"checkbox\">Pin a note so it stays at the top of " +
  "the list</li></ul>" +
  "<h2>Tables</h2>" +
  "<table class=\"ss-table\"><thead><tr><th>Thing</th><th>Where it " +
  "lives</th></tr></thead><tbody>" +
  "<tr><td>Your notes</td><td>Your Google Drive</td></tr>" +
  "<tr><td>This tour</td><td>The starter note, in Personal</td></tr>" +
  "</tbody></table>" +
  "<h2>Links that show more</h2>" +
  "<p>The SnakeScale Notes home page: <a href=\"https://nine34.com/snakescale\">" +
  "SnakeScale Notes, in one page</a>. Rest the mouse on any link in a " +
  "note (or tap it) and a small bar appears: from its menu you can " +
  "switch the link between Text, Mention, and Preview views, and " +
  "Preview shows the page's real title and picture.</p>" +
  "<h2>Connect your notes</h2>" +
  "<p>Type @ while you write and pick another note to link to it, or " +
  "use Insert, then Link to Note. Notes that point at each other are " +
  "much easier to find again than notes that sit alone.</p>" +
  "<p>Pictures get their own three dot menu inside a note: full screen " +
  "preview, Edit &amp; Annotate, Crop, and Transcribe, which reads the " +
  "words in a picture and types them into the note.</p>" +
  "<h2>Your history is kept</h2>" +
  "<p>Every note keeps past versions of itself. The History button at " +
  "the bottom of a note previews and restores them, and Settings " +
  "chooses how many to keep. Settings is also where this tour lives: " +
  "under Getting started you can replay the walkthrough any time, and " +
  "add this starter note again if you deleted it.</p>" +
  "<p>Delete this note whenever you are ready. It goes to Trash first, " +
  "and only disappears for good when you choose Delete Forever.</p>";

/* Build a starter note object from the shared constants above. The
   one place both creators go through, so the seeded note and the
   Settings added note can never drift apart. */
function makeStarterNote(notebookSlug) {
  const note = makeNote(notebookSlug, STARTER_NOTE_TITLE, STARTER_NOTE_BODY);
  note.pinned = true;
  note.tags = STARTER_NOTE_TAGS.slice();
  return note;
}

/* Build the first store through the neutral store layer: the Personal
   notebook, the trash and archive folders, index.json, and exactly one
   starter note. Seeding runs only when the store itself is empty
   (v1.4.3: no index.json and a missing or empty notebooks listing),
   so a store holding any data is never seeded, returning users never
   get a second starter note, and an interrupted first attempt is
   repaired on the next connect instead of staying empty forever. */

async function seedInitialStore() {
  const personal = {
    slug: "personal",
    name: "Personal",
    created: new Date().toISOString()
  };
  state.notebooks = [personal];
  state.notes = [];
  state.trash = [];
  state.archive = [];

  /* v1.4.4: the folder markers are flagged fresh. Seeding only ever
     runs against a store that holds nothing, so these files cannot
     exist yet, and the Drive driver may skip its existence check
     listing for them. */
  await storePutFile("notebooks/personal/.gitkeep", "", null,
    "Create notebooks folder", { fresh: true });
  await storePutFile("trash/.gitkeep", "", null, "Create trash folder",
    { fresh: true });
  /* v1.5: the archive folder marker, fresh for the same reason. */
  await storePutFile("archive/.gitkeep", "", null, "Create archive folder",
    { fresh: true });

  const starter = makeStarterNote("personal");
  /* v1.4.4: fresh, for the same reason as the folder markers above:
     the starter note's id was just generated into an empty store. */
  starter.sha = await storePutFile(notePath(starter), serializeNote(starter),
    null, "Create starter note", { fresh: true });
  /* v2.20: the drop box is born with the store, empty. It must be
     a file the app created (the drive.file visibility rule is
     the whole reason it exists), and creating it here means a
     brand new store has one before any outside writer looks.
     Best effort: loadIncomingStash creates it lazily on any load
     that finds it missing, so a failure here cannot fail seeding. */
  try {
    await storePutFile(INCOMING_FILE, emptyIncomingText(), null,
      "Create drop box", { fresh: true });
  } catch (err) { /* retried lazily by the first load */ }
  state.notes = [starter];
  /* v2.8: the seeded note was written directly, not through
     saveNoteToRepo, so record its baseline here: its first later
     edit can then snapshot this original state. */
  rememberLastSavedContent(starter);
  await saveIndex();
  /* v1.4.4: saveIndex() only schedules the coalesced index write now.
     Seeding must not return until the seeded index is physically on
     disk: the connect flow syncs immediately after seeding, and its
     load reads index.json. Flush the pending write first. */
  await flushIndexWrites();
  saveCache();
  return starter;
}

/* The Google sign in gate: the app's only sign in screen.
   it appears after setup, on a returning visit when no live token or
   silent renewal is available, and after sign out. There is no unlock
   step before or after it. It is not a settings corner: signing in is the
   step the user must complete before notes can load. */
function showGoogleConnectScreen(message) {
  const repoError = document.getElementById("repoError");
  repoError.textContent = "";
  document.getElementById("connectScreenTitle").textContent =
    "Sign in with Google";
  document.getElementById("repoScreenText").textContent = message ||
    "Sign in with Google to load the SnakeScale Notes folder in your " +
    "Google Drive. This is the only sign in for Drive storage, and the " +
    "same sign in also covers attachments.";
  document.getElementById("repoLockBtn").textContent = "Sign out";
  /* v1.4.2: the panel is just text plus the sign in button now. The
     publisher client ID is built into the app, so there is no field
     here to fill in or to prefill. */
  document.getElementById("googleConnectPanel").classList.remove("hidden");
  showScreen("repo");
  /* v1.6: the gate is interactive again, so the loading overlay goes
     away. Every path that lands on this gate (expired sign in, errors,
     sign out) gets the hide for free by coming through here. */
  hideLoading();
}

async function connectAndLoad() {
  showLoading("Connecting to Google Drive...");
  const repoError = document.getElementById("repoError");
  repoError.textContent = "";
  document.getElementById("googleConnectPanel").classList.add("hidden");

  let status = await providers.google.getStatus();
  if (!status.connected && (await getWorkerSession())) {
    /* v2.79.0: a standing Worker session mints the access
       token on the spot, so a stale status (an expired
       recorded token, none recorded yet after a fragment
       landing) heals here instead of bouncing to the gate.
       A failed trade leaves the status exactly as it was,
       and the gate below speaks for it as it always has. */
    const fetched = await workerFetchAccessToken();
    if (fetched.ok) {
      status = await providers.google.getStatus();
    }
  }
  if (!status.connected) {
    state.repoExists = false;
    showGoogleConnectScreen(status.reason === "expired"
      ? "Your Google sign in expired. Sign in with Google again; it takes " +
        "one click. Your notes and any queued edits are still safe."
      : "Sign in with Google to connect the SnakeScale Notes folder in " +
        "your Google Drive. The same sign in also covers attachments.");
    return;
  }
  /* v2.86: entering with a live sign in also settles
     this device's push registration (the flow the sign
     in landing and the already signed in boot share;
     the module's own guards keep it silent, prompt
     free, and harmless to the load). */
  ensurePushRegistration();
  /* v2.24.6: entering with a live sign in schedules the
     proactive renewal here as well, so the guarantee does not
     rest on which restore path produced the token (the
     encrypted store restore in getProviderToken schedules it
     too; scheduling twice simply re-sets the same timer). */
  scheduleGoogleRenewal();
  /* v2.21: the boot report's first stage. The sign in is live
     in memory from here on, which is also the standard the
     cache paint below is gated on: this function is only ever
     reached with a live sign in (the gate's silent renewal or
     a still live token), the store root is ensured next, and
     the seeding decision reads the store itself before any
     cached state is painted. */
  bootMark("signInReady");

  /* v2.0: Google is the only attachment provider. Settings written
     by an older build may still carry another value in this field;
     pin it to Google. */
  if (state.attach.defaultProvider !== "google") {
    state.attach.defaultProvider = "google";
    saveSettings();
  }
  try {
    await driveEnsureNotesRoot();
    state.repoExists = true;
    /* v2.0: the one time, best effort consolidation of pre-v2.0
       attachments into the notes folder. It swallows its own
       errors, so it can neither block nor fail this connect. */
    await maybeConsolidateLegacyAttachments();
    setLoadingStatus("Loading your notes...");
    /* v1.4.3: first run seeding is decided from the store itself, not
       from whether this visit happened to create the notes root
       folder. The old rule seeded only when driveCache.rootCreated
       was set, so if the folder had been created in any earlier or
       interrupted attempt (an easy thing to do while Google sign in
       itself was being set up), seeding was skipped on every later
       visit and the user signed in to a permanently empty app. The
       store counts as a first run only when it holds nothing at all:
       no index.json and a missing or empty notebooks listing.
       seedInitialStore writes index.json, so a seeded store can never
       look empty again, and a store holding any real data is never
       seeded. */
    const existingIndex = await storeGetFile("index.json");
    const notebookEntries = await storeListDir("notebooks");
    const storeIsEmpty = !existingIndex &&
      (!notebookEntries || notebookEntries.length === 0);
    let starter = null;
    if (storeIsEmpty) {
      starter = await seedInitialStore();
      state.selectedId = starter.id;
    }
    /* v1.6 background population: when this device holds a cache for
       the Google store, paint the app from it now. The sync below
       then replaces the state with the fresh library and re renders.
       The cache is a display shortcut only: the seeding decision
       above already read the store itself, and the sync still owns
       the final state, so conflict, queue, and seeding behavior are
       unchanged.
       v2.21: that paint is now the boot's first paint. The overlay
       comes down on it, and the sync finishes behind the sync pill
       (state.syncing drives the pill for exactly this span) instead
       of behind the overlay. The reconciliation lands through the
       ordinary sync machinery, with its ordinary protections: the
       open note snapshot in syncNow predates the load, and an
       editor holding unsaved typing is never refilled (v2.16.1),
       so acting on the painted app is the same exposure as
       pressing Sync now while working, which the app has always
       supported. A device with no readable cache paints nothing
       and waits for the sync with the overlay up, exactly as
       before v2.21. */
    /* v2.33: the landing. A returning boot opens on
       Home (or on the notes list, when this device's
       When opening choice says so), from the cache paint
       onward, so the first thing rendered is already the
       landing view. A first run is the one exception:
       its seeded starter note opens below, as it always
       has, so the landing applies only when this boot
       did not seed. */
    if (!starter) { applyStartView(); }
    const paintedFromCache = await loadCacheWithKey();
    if (paintedFromCache) {
      renderAll();
      bootMark("cachePainted");
    } else {
      bootCacheSkipped();
    }
    showScreen("app");
    if (paintedFromCache) {
      bootMark("firstPaint");
      hideLoading();
    }
    await syncNow(false);
    bootMark("synced");
    /* v2.16: the boot sync just refreshed the store in memory,
       so the auto-sync watcher baselines its change token from
       this moment and starts polling (when the setting is on).
       Changes from before this boot are already in hand. */
    startAutoSync();
    if (!paintedFromCache) { bootMark("firstPaint"); }
    hideLoading();
    finalizeBootReport();
    /* v2.47: the store is loaded and signed in here, so a
       web clip held from this boot's fragment files now,
       before any starter note opens over it. A clip whose
       filing fails keeps the create flow's own wording;
       the held payload is spent either way, so it can
       never file twice. */
    await filePendingWebClip();
    if (starter) {
      openNote(starter.id);
      toast("Google Drive connected. Welcome to SnakeScale Notes.");
      /* v2.13: the first run walkthrough opens over the freshly
         seeded app. The trigger is this seeding itself, in this
         boot: no settings flag is consulted, so an existing or
         upgraded store (where starter is null here) can never
         spring it, and a store seeded in an earlier boot does not
         repeat it. */
      openOnboarding(false, starter.id);
    }
  } catch (err) {
    if (err.needsGoogleReconnect) {
      state.repoExists = false;
      showGoogleConnectScreen(
        "Your Google sign in expired. Sign in with Google again; it takes " +
        "one click. Your notes and any queued edits are still safe.");
      return;
    }
    if (await loadCacheWithKey()) {
      state.repoExists = true;
      showScreen("app");
      renderAll();
      /* v2.21: this offline paint is a first paint too, and
         the boot report freezes here: the synced stage stays
         skipped, which is the readout's honest word for a
         boot that never reached Drive. */
      bootMark("cachePainted");
      bootMark("firstPaint");
      /* v2.16: the cached app is still a connected app once the
         store is reachable again; the watcher's ticks simply
         no-op until storeSyncReady passes. */
      startAutoSync();
      hideLoading();
      finalizeBootReport();
      toast("Could not reach Google Drive (" + err.message +
        "). Showing your cached notes.", true);
      refreshSyncPill();
      return;
    }
    state.repoExists = false;
    showGoogleConnectScreen();
    repoError.textContent = err.message;
  }
}

