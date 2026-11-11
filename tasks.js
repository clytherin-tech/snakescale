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
   v2.24: tasks (tasks.json)

   Tasks are their own objects, modeled on Evernote Tasks and
   adapted to notebooks: a task belongs to a notebook (never to
   a folder of its own), and carries a title, a description, a
   due date with an optional time, a flag, a priority, a
   recurrence, and an optional reminder offset. They live in
   ONE new app owned file, tasks.json, in the store root beside
   catalog.json and incoming.json. Notebook folders gain no new
   files, and neither the note loader nor the catalog knows the
   file exists (the TK suite proves both load paths ignore it).

   The task object shape:
     {
       id:              string,   minted like a note id
       title:           string,
       description:     string,
       descriptionFormat: (v2.28) "text" or "html": a
                        text description is the plain
                        words themselves; an html one is
                        a sanitized rich fragment (see
                        sanitizeTaskDescriptionHtml).
                        Missing or invalid reads "text",
                        so every pre v2.28 task is a text
                        task and stays exact until it is
                        saved from the rich editor.
       notebook:        string,   notebook slug
       dueDate:         "YYYY-MM-DD" or null,
       dueTime:         "HH:MM" or null,
       flagged:         boolean,
       priority:        "low", "medium", or "high",
       recurrence:      "none", "daily", "weekly", "monthly",
                        or "yearly",
       reminderOffsetMin: null, or 0, 15, 60, or 1440 (notify
                        that many minutes before the due moment),
       status:          "open" or "completed",
       completedAt:     ISO string or null,
       created:         ISO string,
       updated:         ISO string,
       lastReminderFor: the due moment ISO the reminder last
                        fired for, or null
     }

   The writer is the catalog writer's twin: debounced, coalesced
   behind a running loop, flushed inside syncNow before its
   load, and forgiving: a StoreConflict is retried once over the
   winner's token (last writer wins; tasks carry no conflict
   copies), and every other failure is swallowed, because a
   tasks write must never fail a note operation; the next load
   reconciles. The load side reads the file beside the catalog:
   a missing file means an empty list (the file is created
   lazily by the first real write), and an unparseable or
   wrongly shaped file loads as empty in memory but is NOT
   overwritten until a real task mutation arms the writer
   (tasksWritable), so a damaged file is evidence, not a
   casualty. Reminder bookkeeping (lastReminderFor) also flows
   through this writer; it deliberately does not move the
   task's updated stamp, which records human edits.
   -------------------------------------------------------------------------- */
const TASKS_FILE = "tasks.json";
const TASKS_SHAPE_VERSION = 1;
const TASKS_WRITE_DEBOUNCE_MS = 800;

let tasksWriteTimer = null;      /* pending debounce timer, or null */
let tasksWritePromise = null;    /* the running write loop, or null */
let tasksWriteDirty = false;     /* state changed since the last write began */
let tasksFlushWaiters = [];      /* flushTasksWrites() resolvers */
let lastTasksToken = null;       /* token of the tasks file last read or written */
let tasksArmed = false;          /* true once a load completed this session */
let tasksFileBroken = false;     /* the stored file could not be used */
let tasksWritable = false;       /* a real mutation has armed overwriting */
let tasksLoadApplied = false;    /* v2.53: this load's tasks read has landed */
let tasksLoadGeneration = 0;     /* v2.53: per load stamp; a stale read's
                                    landing is refused (see applyLoadedTasks) */

/* One stored task, cleaned into the shape above. Entries with
   no usable id are dropped; every other field falls back to
   its default rather than failing the file, the same tolerance
   the note parser shows old notes. */
function sanitizeTask(raw) {
  if (!raw || typeof raw !== "object") { return null; }
  if (typeof raw.id !== "string" || !raw.id) { return null; }
  const dueDate = typeof raw.dueDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(raw.dueDate) ? raw.dueDate : null;
  const dueTime = typeof raw.dueTime === "string" &&
    /^\d{2}:\d{2}$/.test(raw.dueTime) ? raw.dueTime : null;
  const offsets = [0, 15, 60, 1440];
  return {
    id: raw.id,
    title: typeof raw.title === "string" && raw.title
      ? raw.title : "Untitled task",
    description: typeof raw.description === "string"
      ? raw.description : "",
    descriptionFormat: raw.descriptionFormat === "html"
      ? "html" : "text",
    notebook: typeof raw.notebook === "string" ? raw.notebook : "",
    dueDate: dueDate,
    dueTime: dueDate ? dueTime : null,
    flagged: !!raw.flagged,
    priority: ["low", "medium", "high"].indexOf(raw.priority) >= 0
      ? raw.priority : "medium",
    recurrence: ["none", "daily", "weekly", "monthly", "yearly"]
      .indexOf(raw.recurrence) >= 0 ? raw.recurrence : "none",
    reminderOffsetMin: offsets.indexOf(raw.reminderOffsetMin) >= 0
      ? raw.reminderOffsetMin : null,
    status: raw.status === "completed" ? "completed" : "open",
    completedAt: typeof raw.completedAt === "string"
      ? raw.completedAt : null,
    created: typeof raw.created === "string" && raw.created
      ? raw.created : new Date().toISOString(),
    updated: typeof raw.updated === "string" && raw.updated
      ? raw.updated : new Date().toISOString(),
    lastReminderFor: typeof raw.lastReminderFor === "string"
      ? raw.lastReminderFor : null,
    /* v2.49.0: the note this task belongs to, if any (the
       tasks in notes link; see the note tasks block
       section). Only a non empty string is a link; every
       other value is no link, so a task written before
       this field existed, or by a hand edit, loads
       unlinked rather than dangling. */
    noteId: typeof raw.noteId === "string" && raw.noteId
      ? raw.noteId : null
  };
}

/* The stored form of one task: the same fields, in the shape's
   order, nothing else (no runtime state ever reaches the file). */
function serializeTask(task) {
  const out = {
    id: task.id,
    title: task.title,
    description: task.description,
    descriptionFormat: task.descriptionFormat === "html"
      ? "html" : "text",
    notebook: task.notebook,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    flagged: !!task.flagged,
    priority: task.priority,
    recurrence: task.recurrence,
    reminderOffsetMin: task.reminderOffsetMin,
    status: task.status,
    completedAt: task.completedAt,
    created: task.created,
    updated: task.updated,
    lastReminderFor: task.lastReminderFor
  };
  /* v2.49.0: the note link is written only when set, the
     rule the note reminders' front matter follows (v2.35):
     an unlinked task's stored form is byte identical to
     the pre v2.49 shape. */
  if (typeof task.noteId === "string" && task.noteId) {
    out.noteId = task.noteId;
  }
  return out;
}

function buildTasksObject() {
  return {
    version: TASKS_SHAPE_VERSION,
    updated: new Date().toISOString(),
    tasks: state.tasks.map(serializeTask)
  };
}

/* ----- v2.28.0: rich task descriptions -------------------
   A task description is plain text until the task is saved
   from the description editor; that save stores a rich
   fragment under descriptionFormat "html". The fragment
   vocabulary is small on purpose: paragraphs, line breaks,
   the four inline marks (strong, emphasis, underline,
   strike), the two lists, and note links. Everything a
   rich description holds passes through the one sanitizer
   below: on save, on load into the editor, on paste, and
   on preview render, so nothing hostile, and nothing
   merely out of vocabulary, can persist in tasks.json or
   reach a row.
   The allowlist: P, DIV, BR, STRONG, B, EM, I, U, S,
   STRIKE, UL, OL, LI, A. An anchor survives only as a
   note link (its raw href passes the noteLinkIdOf test),
   keeping its class and its data-ss-link-view; every
   other anchor unwraps to its text. SCRIPT, STYLE,
   IFRAME, OBJECT, and EMBED are removed with their
   contents; every other element unwraps, keeping its
   cleaned children. All attributes are stripped, so no
   event handler, no style, and no class beyond the note
   link's own can ride along.
   Styled spans: the note editor runs with styleWithCSS
   on, so pasted or foreign rich text often carries its
   bold, italic, underline, and strike as span (or font)
   style attributes instead of elements. Those convert to
   the semantic wrappers before the element unwraps, so
   the formatting survives as real formatting: never as a
   raw style attribute, and never as lost plain text. */
const TASK_DESC_ALLOWED_TAGS = {
  P: 1, DIV: 1, BR: 1, STRONG: 1, B: 1, EM: 1, I: 1, U: 1,
  S: 1, STRIKE: 1, UL: 1, OL: 1, LI: 1, A: 1
};
const TASK_DESC_DROP_TAGS = {
  SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1
};

/* The semantic wrappers a styled span or font element
   stands for, read from its raw style attribute (the raw
   string, so the answer never depends on the CSSOM):
   a font-weight of bold or 700 and up reads STRONG, a
   font-style of italic EM, and a text-decoration naming
   underline or line-through U or S. Outermost first. */
function taskDescStyleWrappers(el) {
  const style = (el.getAttribute &&
    el.getAttribute("style")) || "";
  const wraps = [];
  if (/font-weight\s*:\s*(bold|[7-9]00)/i.test(style)) {
    wraps.push("STRONG");
  }
  if (/font-style\s*:\s*italic/i.test(style)) {
    wraps.push("EM");
  }
  const deco = /text-decoration(?:-line)?\s*:\s*([^;]+)/i
    .exec(style);
  if (deco) {
    if (/underline/i.test(deco[1])) { wraps.push("U"); }
    if (/line-through/i.test(deco[1])) { wraps.push("S"); }
  }
  return wraps;
}

/* Move an element's children out in its place, then drop
   the element itself: the unwrap every element outside
   the vocabulary gets. */
function unwrapTaskDescElement(el) {
  const parent = el.parentNode;
  if (!parent) { return; }
  while (el.firstChild) { parent.insertBefore(el.firstChild, el); }
  el.remove();
}

function cleanTaskDescChildren(parent) {
  Array.prototype.slice.call(parent.childNodes)
    .forEach(function (node) {
      if (node.nodeType === 3) { return; }
      if (node.nodeType !== 1) { node.remove(); return; }
      const tag = node.tagName;
      if (TASK_DESC_DROP_TAGS[tag]) { node.remove(); return; }
      if (tag === "SPAN" || tag === "FONT") {
        const wraps = taskDescStyleWrappers(node);
        cleanTaskDescChildren(node);
        if (wraps.length) {
          /* The wrapper chain goes around the children:
             wraps[0] outermost, the children landing in
             the deepest wrapper. */
          let chain = null, deepest = null;
          wraps.forEach(function (wtag) {
            const wEl = document.createElement(wtag);
            if (!chain) { chain = wEl; }
            else { deepest.appendChild(wEl); }
            deepest = wEl;
          });
          while (node.firstChild) {
            deepest.appendChild(node.firstChild);
          }
          node.parentNode.insertBefore(chain, node);
          node.remove();
        } else {
          unwrapTaskDescElement(node);
        }
        return;
      }
      if (tag === "A") {
        cleanTaskDescChildren(node);
        if (!noteLinkIdOf(node)) {
          unwrapTaskDescElement(node);
          return;
        }
        /* A note link keeps its address, its class, and
           its view mode; every other attribute goes. */
        const href = node.getAttribute("href");
        const view = node.getAttribute("data-ss-link-view");
        Array.prototype.slice.call(node.attributes)
          .forEach(function (attr) {
            node.removeAttribute(attr.name);
          });
        node.setAttribute("href", href);
        node.setAttribute("class", "ss-note-link");
        if (view) { node.setAttribute("data-ss-link-view", view); }
        return;
      }
      if (TASK_DESC_ALLOWED_TAGS[tag]) {
        Array.prototype.slice.call(node.attributes)
          .forEach(function (attr) {
            node.removeAttribute(attr.name);
          });
        cleanTaskDescChildren(node);
        return;
      }
      cleanTaskDescChildren(node);
      unwrapTaskDescElement(node);
    });
}

/* The one sanitizer: a fragment string in, the fragment
   the vocabulary above allows out. */
function sanitizeTaskDescriptionHtml(html) {
  const holder = document.createElement("div");
  holder.innerHTML = String(html == null ? "" : html);
  cleanTaskDescChildren(holder);
  return holder.innerHTML;
}

/* The plain words of a rich fragment: what the preview's
   hover names, and what the emptied test reads. */
function taskDescriptionTextOfHtml(html) {
  const holder = document.createElement("div");
  holder.innerHTML = String(html == null ? "" : html);
  return holder.textContent || "";
}

/* Read the description editor for a save: sanitize what
   it holds, and collapse a fragment carrying no words
   and no note link back to the empty plain text form, so
   an emptied rich description is just an empty one. */
function readTaskDescriptionEditor() {
  const el = document.getElementById("taskDescInput");
  const clean = sanitizeTaskDescriptionHtml(
    el ? el.innerHTML : "");
  const words = taskDescriptionTextOfHtml(clean);
  if (!words.trim() && clean.indexOf("ssnote:") < 0) {
    return { description: "", descriptionFormat: "text" };
  }
  return { description: clean, descriptionFormat: "html" };
}

/* Fill the description editor from a task: a rich
   description goes in through the sanitizer (the load
   side of the one funnel); a plain text description goes
   in as literal text, one paragraph per line, its words
   and its line breaks exact. */
function writeTaskDescriptionEditor(task) {
  const el = document.getElementById("taskDescInput");
  if (!el) { return; }
  el.innerHTML = "";
  const desc = task && typeof task.description === "string"
    ? task.description : "";
  if (!desc) { return; }
  if (task.descriptionFormat === "html") {
    el.innerHTML = sanitizeTaskDescriptionHtml(desc);
    return;
  }
  desc.split("\n").forEach(function (line) {
    const p = document.createElement("p");
    if (line) { p.textContent = line; }
    else { p.appendChild(document.createElement("br")); }
    el.appendChild(p);
  });
}

/* Schedule a tasks write from current state. Only mutation
   paths call this; calling it is itself the arming act, so a
   load that found a damaged file (which never calls it) can
   never overwrite the evidence. Inert until a load completed
   this session, like saveCatalog, so nothing can be built
   from pre load state and clobber a good file. */
function saveTasks() {
  if (!state.repoExists || !tasksArmed) { return; }
  tasksWritable = true;
  tasksWriteDirty = true;
  if (tasksWritePromise) { return; }
  if (tasksWriteTimer !== null) { return; }
  tasksWriteTimer = setTimeout(function () {
    tasksWriteTimer = null;
    runTasksWriteLoop();
  }, TASKS_WRITE_DEBOUNCE_MS);
}

/* One physical tasks write, from a snapshot of current state.
   A lost token race is retried once over the winner's token,
   and every failure is swallowed: the next load reconciles. */
async function writeTasksOnce() {
  if (tasksFileBroken && !tasksWritable) { return; }
  const text = JSON.stringify(buildTasksObject(), null, 2);
  try {
    lastTasksToken = await storePutFile(TASKS_FILE, text,
      lastTasksToken, "Update tasks");
    tasksFileBroken = false;
  } catch (err) {
    if (!isStoreConflict(err)) { return; }
    try {
      const fresh = await storeGetFile(TASKS_FILE);
      lastTasksToken = await storePutFile(TASKS_FILE, text,
        fresh ? fresh.token : null, "Update tasks");
      tasksFileBroken = false;
    } catch (err2) { /* swallowed: reconciled on the next load */ }
  }
}

function runTasksWriteLoop() {
  if (tasksWritePromise) { return tasksWritePromise; }
  tasksWritePromise = (async function () {
    while (tasksWriteDirty) {
      tasksWriteDirty = false;
      await writeTasksOnce();
    }
  })();
  tasksWritePromise.then(function () {
    tasksWritePromise = null;
    settleTasksFlushWaiters();
  });
  return tasksWritePromise;
}

function settleTasksFlushWaiters() {
  if (tasksWriteTimer !== null || tasksWritePromise ||
      tasksWriteDirty) {
    return;
  }
  const waiters = tasksFlushWaiters;
  tasksFlushWaiters = [];
  waiters.forEach(function (resolve) { resolve(); });
}

/* Resolve once every tasks write scheduled so far has landed
   (or failed safely). syncNow flushes before its load, the
   same discipline flushCatalogWrites gives catalog.json. */
function flushTasksWrites() {
  if (tasksWriteTimer !== null) {
    clearTimeout(tasksWriteTimer);
    tasksWriteTimer = null;
    runTasksWriteLoop();
  } else if (!tasksWritePromise && tasksWriteDirty) {
    runTasksWriteLoop();
  }
  if (!tasksWritePromise && !tasksWriteDirty &&
      tasksWriteTimer === null) {
    return Promise.resolve();
  }
  return new Promise(function (resolve) {
    tasksFlushWaiters.push(resolve);
  });
}

/* The tasks read for a load, lifted out of loadAllFromRepo so
   the load can start it on its own and apply the result the
   moment it lands (applyLoadedTasks, below). Returns null on
   a transport failure (the load keeps the tasks it already
   holds in memory), and otherwise {tasks, token, broken}: a
   missing file is an empty list and no token; an unparseable
   or wrongly shaped file is an empty list, its token kept
   (so an armed write replaces exactly it), and broken set. */
async function readTasksForLoad() {
  let file = null;
  try {
    file = await storeGetFile(TASKS_FILE);
  } catch (err) { return null; }
  if (!file) { return { tasks: [], token: null, broken: false }; }
  try {
    const parsed = JSON.parse(file.text);
    if (!parsed || typeof parsed !== "object" ||
        !Array.isArray(parsed.tasks)) {
      return { tasks: [], token: file.token, broken: true };
    }
    const tasks = [];
    parsed.tasks.forEach(function (raw) {
      const task = sanitizeTask(raw);
      if (task) { tasks.push(task); }
    });
    return { tasks: tasks, token: file.token, broken: false };
  } catch (err) {
    return { tasks: [], token: file.token, broken: true };
  }
}

/* The repaint half of afterTasksChanged, lifted out so the
   early tasks landing below can repaint the same surfaces
   without the mutation funnel's persistence and reminder
   side effects (the writer owns persistence; onTasksLoaded
   owns the post load reminder look). Every surface that
   displays tasks is here: the sidebar (the Tasks count),
   the list pane (the Tasks view renders through
   renderNoteList, and the Things to do tile rides the
   notes list), Home, and the Things page, which owns the
   editor pane while it is open (renderEditor there renders
   the page and touches no note fields, by its design), so
   a landing in the middle of a load can never refill a
   note being edited or move a selection. */
function repaintTaskSurfaces() {
  renderSidebar();
  if (state.view.kind === "tasks" || state.view.kind === "all" ||
      state.view.kind === "notebook") {
    renderNoteList();
  }
  /* v2.33: an open Home re-renders in place too, like the
     Things page below: a completion from its Tasks
     widget's own rows, an edit saved in the task editor
     over Home, or a sync's task reload lands on the
     dashboard at once. */
  if (state.view.kind === "home") { renderHome(); }
  /* v2.24.3: an open Things to do page re-renders in place,
     so a completion from its own rows, an edit saved in the
     task editor, or a quick add lands on the page at once.
     It also arrives here on a sync's task reload, which is
     how a remote change reaches the open page. */
  if (state.thingsNotebook) { renderEditor(); }
}

/* v2.53: the ONE apply path for a load's tasks read. The
   load calls it from the landing continuation the moment
   the read resolves, and again at its tail after awaiting
   the same promise; the first call wins and every later
   one is a no op, which is what makes onTasksLoaded run
   exactly once per load however the read is timed. The
   generation must still be the current one: a read
   orphaned by a newer load, or by a sign out while it was
   in flight, applies nothing. A null read (a transport
   failure) applies nothing either: the tasks already in
   memory (the cache paint's display only copy at boot,
   the live list on a later sync) stay exactly as they
   were, unarmed if they were unarmed. The previous
   updated stamps are captured from whatever list is in
   memory at the moment of landing, the cache copy at
   boot or the live list on a later sync, which is the
   honest comparison for the open editor's refresh rule
   in onTasksLoaded. The landing records the boot
   report's tasks stage, refreshes the local cache (the
   snapshot then holds the real tasks even if the rest of
   the load is still gathering), and repaints the task
   surfaces; the load around it never touches state.tasks
   again after this, so a mutation the user makes in the
   window between the landing and the load's end survives
   the load, and the load's own cache write at its end
   snapshots the list as it then stands. */
function applyLoadedTasks(tasksLoad, generation) {
  if (!tasksLoad) { return false; }
  if (generation !== tasksLoadGeneration) { return false; }
  if (tasksLoadApplied) { return false; }
  tasksLoadApplied = true;
  const prevTaskUpdatedById = {};
  state.tasks.forEach(function (t) {
    prevTaskUpdatedById[t.id] = t.updated;
  });
  state.tasks = tasksLoad.tasks;
  lastTasksToken = tasksLoad.token;
  tasksFileBroken = tasksLoad.broken;
  tasksArmed = true;
  bootMark("tasksReady");
  onTasksLoaded(prevTaskUpdatedById);
  saveCache();
  repaintTaskSurfaces();
  return true;
}

/* Sign out drops the tasks session state, mirroring
   resetCatalogRuntimeState: no token, no armed writer, and no
   fired reminder record may leak into the next sign in on this
   device. The tasks themselves live in Drive and stay there. */
function resetTasksRuntimeState() {
  if (tasksWriteTimer !== null) {
    clearTimeout(tasksWriteTimer);
    tasksWriteTimer = null;
  }
  tasksWriteDirty = false;
  /* v2.53: the landing state resets with the rest, and the
     generation bump orphans any tasks read still in flight
     from this session, so it can never arm the next one. */
  tasksLoadApplied = false;
  tasksLoadGeneration += 1;
  tasksArmed = false;
  tasksWritable = false;
  tasksFileBroken = false;
  lastTasksToken = null;
  taskReminderFiredKeys.clear();
  taskEditorState = null;
}

/* ---------------- task dates ----------------
   Due dates are plain "YYYY-MM-DD" strings and all day math is
   done on their parts, in local time, so a due date means the
   same calendar day on every device and no timezone can drift
   it. The due moment adds the time: dueTime when set, else
   09:00 local, the hour the reminder design promises. */
function parseTaskDate(str) {
  if (typeof str !== "string") { return null; }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!m) { return null; }
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function formatTaskDateParts(y, m, d) {
  function pad(n, w) {
    let s = String(n);
    while (s.length < w) { s = "0" + s; }
    return s;
  }
  return pad(y, 4) + "-" + pad(m, 2) + "-" + pad(d, 2);
}

function taskTodayParts() {
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
}

/* Whole days from today to the task's due date: negative when
   overdue, 0 today, null when the task has no due date. */
function taskDayDiff(task) {
  const due = parseTaskDate(task && task.dueDate);
  if (!due) { return null; }
  const today = taskTodayParts();
  const a = Date.UTC(today.y, today.m - 1, today.d);
  const b = Date.UTC(due.y, due.m - 1, due.d);
  return Math.round((b - a) / 86400000);
}

/* The due moment as a Date: the due date at its time, or at
   09:00 local when the task carries no time. Null when the
   task has no due date at all. */
function taskDueMoment(task) {
  const due = parseTaskDate(task && task.dueDate);
  if (!due) { return null; }
  let hh = 9, mm = 0;
  if (task.dueTime && /^\d{2}:\d{2}$/.test(task.dueTime)) {
    hh = Number(task.dueTime.slice(0, 2));
    mm = Number(task.dueTime.slice(3, 5));
  }
  return new Date(due.y, due.m - 1, due.d, hh, mm, 0, 0);
}

const TASK_MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* "Oct 24" for a due date string, in the reader's calendar. */
function taskDateLabel(str) {
  const p = parseTaskDate(str);
  if (!p) { return ""; }
  return TASK_MONTH_NAMES[p.m - 1] + " " + p.d;
}

/* "3:00 PM" for an "HH:MM" time string. */
function taskTimeLabel(str) {
  if (!str || !/^\d{2}:\d{2}$/.test(str)) { return ""; }
  let hh = Number(str.slice(0, 2));
  const mm = str.slice(3, 5);
  const suffix = hh >= 12 ? "PM" : "AM";
  hh = hh % 12;
  if (hh === 0) { hh = 12; }
  return hh + ":" + mm + " " + suffix;
}

/* The due chip for a task row: its text and its tone class.
   Overdue wins the red, today the accent fill, everything else
   the plain soft chip; a task with no due date gets no chip. */
function taskDueChip(task) {
  if (!task || !task.dueDate) { return null; }
  const diff = taskDayDiff(task);
  const time = task.dueTime ? " " + taskTimeLabel(task.dueTime) : "";
  if (diff !== null && diff < 0) {
    return { text: "Overdue " + taskDateLabel(task.dueDate), cls: "overdue" };
  }
  if (diff === 0) { return { text: "Today" + time, cls: "today" }; }
  if (diff === 1) { return { text: "Tomorrow" + time, cls: "" }; }
  return { text: taskDateLabel(task.dueDate) + time, cls: "" };
}

/* The short due phrase the notification body carries after the
   notebook name: "today 3:00 PM", "tomorrow", "Oct 24", in the
   same words the chip uses, lowercased to sit mid sentence. */
function taskDuePhrase(task) {
  if (!task || !task.dueDate) { return ""; }
  const diff = taskDayDiff(task);
  const time = task.dueTime ? " " + taskTimeLabel(task.dueTime) : "";
  if (diff !== null && diff < 0) {
    return taskDateLabel(task.dueDate) + time;
  }
  if (diff === 0) { return "today" + time; }
  if (diff === 1) { return "tomorrow" + time; }
  return taskDateLabel(task.dueDate) + time;
}

/* Advance a due date string by a recurrence interval. Monthly
   clamps to the target month's end (Jan 31 becomes Feb 28 or
   29), and yearly clamps the same way (Feb 29 becomes Feb 28),
   so a rolled task never lands on a day that does not exist. */
function advanceTaskDueDate(str, recurrence) {
  const p = parseTaskDate(str);
  if (!p) { return str; }
  if (recurrence === "daily" || recurrence === "weekly") {
    const dt = new Date(Date.UTC(p.y, p.m - 1,
      p.d + (recurrence === "daily" ? 1 : 7)));
    return formatTaskDateParts(dt.getUTCFullYear(),
      dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  if (recurrence === "monthly" || recurrence === "yearly") {
    let y = p.y, m = p.m;
    if (recurrence === "monthly") {
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    } else { y += 1; }
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return formatTaskDateParts(y, m, Math.min(p.d, lastDay));
  }
  return str;
}

/* ---------------- the task model ---------------- */
function findTaskById(id) {
  return state.tasks.find(function (t) { return t.id === id; }) || null;
}

/* --------------------------------------------------------------------------
   v2.72: the default notebook (Settings, Appearance)

   Evernote keeps a default notebook: the notebook new
   content lands in when the creation itself names none
   (Evernote's own emailed notes and quick captures land
   in it the same way). This app's is
   state.defaultNotebook (a slug, or "" for unset),
   remembered per device in settings, the way Evernote's
   own choice is per device. The rule, applied at every
   creation that names no notebook:
   fallbackNotebookSlug() answers the configured default
   while it still names a notebook, and the first
   notebook otherwise, which is exactly the pre-v2.72
   behavior, so an unset (or deleted) default changes
   nothing. Creations that DO name a notebook (a note
   made inside a notebook view, a duplicate or a merge,
   a drop box entry naming one, the mention create's
   host notebook) never consult it.
   -------------------------------------------------------------------------- */
function defaultNotebookSlug() {
  const slug = state.defaultNotebook;
  if (slug && state.notebooks.some(function (nb) {
    return nb.slug === slug;
  })) {
    return slug;
  }
  return null;
}

/* The notebook a creation that names none files into:
   the default notebook while one is set and standing,
   the first notebook otherwise (or null when the store
   somehow has no notebooks at all). */
function fallbackNotebookSlug() {
  return defaultNotebookSlug() ||
    (state.notebooks.length ? state.notebooks[0].slug : null);
}

function notebookNameForSlug(slug) {
  const nb = state.notebooks.find(function (n) {
    return n.slug === slug;
  });
  return nb ? nb.name : (slug || "");
}

/* The notebook a new task lands in when nothing better offers:
   the last one used when it still exists, else the first. */
function defaultTaskNotebook() {
  if (state.taskLastNotebook && state.notebooks.some(
      function (n) { return n.slug === state.taskLastNotebook; })) {
    return state.taskLastNotebook;
  }
  return state.notebooks.length ? state.notebooks[0].slug : "";
}

/* List order for task rows everywhere: open tasks first by due
   moment (no due date last), then by creation; completed tasks
   after, newest completion first. Used whole by the notebook
   groupings and per group by the due grouping. */
function sortTasksForList(tasks) {
  return tasks.slice().sort(function (a, b) {
    const aDone = a.status === "completed";
    const bDone = b.status === "completed";
    if (aDone !== bDone) { return aDone ? 1 : -1; }
    if (aDone && bDone) {
      return String(b.completedAt || "").localeCompare(
        String(a.completedAt || ""));
    }
    const am = taskDueMoment(a), bm = taskDueMoment(b);
    if (am && bm) {
      if (am.getTime() !== bm.getTime()) {
        return am.getTime() - bm.getTime();
      }
    } else if (am) { return -1; }
    else if (bm) { return 1; }
    return String(a.created).localeCompare(String(b.created));
  });
}

/* Every task change lands through here: persist through the
   writer, re-render the visible task surfaces, and give the
   reminder scheduler its post write look (a reopened or rolled
   task can already be due a reminder). */
function afterTasksChanged() {
  saveTasks();
  /* v2.44: and the local cache, the call every other
     mutation path already makes. The tasks path never
     made it, so before tasks rode the snapshot at all
     this only looked harmless; now it is what keeps the
     snapshot's tasks as fresh as its notes between
     loads. saveCache's catalog half stays inert until
     armed, exactly as on the other paths. */
  saveCache();
  /* v2.53: the renders live in repaintTaskSurfaces now,
     shared with the early tasks landing. */
  repaintTaskSurfaces();
  /* v2.49.0: an open note's tasks blocks are windows onto
     this same task state, so they repaint with every
     change too: a completion from a block itself, an edit
     saved in the task editor over the note, a create from
     the block's own Add task. The Things page above owns
     the editor pane while it is open and its render
     already ran, so the note body underneath it is left
     alone in that case. */
  if (!state.thingsNotebook) { refreshOpenNoteTaskBlocks(); }
  checkTaskReminders();
}

function createTask(fields) {
  /* v2.44: the pre load gate (see toggleTaskComplete). */
  if (!tasksArmed) { return null; }
  const now = new Date().toISOString();
  const task = sanitizeTask({
    id: newNoteId(),
    title: fields.title || "Untitled task",
    description: fields.description || "",
    descriptionFormat: fields.descriptionFormat || "text",
    notebook: fields.notebook || defaultTaskNotebook(),
    dueDate: fields.dueDate || null,
    dueTime: fields.dueTime || null,
    flagged: !!fields.flagged,
    priority: fields.priority || "medium",
    recurrence: fields.recurrence || "none",
    reminderOffsetMin: fields.reminderOffsetMin != null
      ? fields.reminderOffsetMin : null,
    status: "open",
    completedAt: null,
    created: now,
    updated: now,
    lastReminderFor: null,
    noteId: fields.noteId || null
  });
  state.tasks.push(task);
  if (task.notebook) { state.taskLastNotebook = task.notebook; }
  afterTasksChanged();
  return task;
}

function updateTask(id, patch) {
  /* v2.44: the pre load gate (see toggleTaskComplete). */
  if (!tasksArmed) { return null; }
  const task = findTaskById(id);
  if (!task) { return null; }
  ["title", "description", "descriptionFormat", "notebook",
   "dueDate", "dueTime",
   "flagged", "priority", "recurrence", "reminderOffsetMin",
   "noteId"]
    .forEach(function (key) {
      if (patch[key] !== undefined) { task[key] = patch[key]; }
    });
  const clean = sanitizeTask(task);
  Object.keys(clean).forEach(function (key) { task[key] = clean[key]; });
  task.updated = new Date().toISOString();
  if (task.notebook) { state.taskLastNotebook = task.notebook; }
  afterTasksChanged();
  return task;
}

function deleteTask(id) {
  /* v2.44: the pre load gate (see toggleTaskComplete). */
  if (!tasksArmed) { return; }
  const at = state.tasks.findIndex(function (t) { return t.id === id; });
  if (at < 0) { return; }
  state.tasks.splice(at, 1);
  afterTasksChanged();
}

/* v2.116: the task row's own right click menu. Task rows
   had no menu before this release: the app wide guard
   suppressed the browser's menu on them and the app
   offered nothing, so a task link could only be made
   from inside a note, never copied from the task
   itself. The menu is the calendar entries' menu's
   twin (the v2.115 gcalEventMenu discipline throughout):
   the app's own menu card (.note-ctx-menu), placed at
   the pointer by placeNoteContextMenu, closing on an
   outside press and on Escape, focusing its first item
   on open, with exactly two items: Open task (the row
   click's own door, the task editor) and Copy link
   (copyLinkForTask, in editor.js beside the task chip
   builder it copies). Rows inside the note body are
   excluded by the caller in buildTaskRowEl: the rows of
   a note's tasks block keep their standing no menu rule
   there, and the editor's own menu owns that surface. */
let taskRowMenuCtx = null;

function closeTaskRowMenu() {
  const menu = document.getElementById("taskRowMenu");
  if (menu) { menu.classList.add("hidden"); }
  taskRowMenuCtx = null;
  document.removeEventListener("pointerdown",
    onTaskRowMenuDocPointerDown, true);
  document.removeEventListener("keydown",
    onTaskRowMenuDocKeydown, true);
}

function onTaskRowMenuDocPointerDown(ev) {
  const menu = document.getElementById("taskRowMenu");
  if (menu && ev.target && menu.contains(ev.target)) {
    return;
  }
  closeTaskRowMenu();
}

function onTaskRowMenuDocKeydown(ev) {
  if (ev.key === "Escape") {
    ev.preventDefault();
    closeTaskRowMenu();
  }
}

function openTaskRowMenu(task, x, y) {
  closeTaskRowMenu();
  const menu = document.getElementById("taskRowMenu");
  if (!menu || !task) { return; }
  taskRowMenuCtx = { taskId: task.id };
  menu.classList.remove("hidden");
  placeNoteContextMenu(menu, x, y);
  document.addEventListener("pointerdown",
    onTaskRowMenuDocPointerDown, true);
  document.addEventListener("keydown",
    onTaskRowMenuDocKeydown, true);
  const first = menu.querySelector(".list-menu-item");
  if (first) { first.focus(); }
}

/* The menu's Open task: the row click's own door, the
   task editor over whatever surface the row stands on. */
function taskRowMenuOpen() {
  const ctx = taskRowMenuCtx;
  closeTaskRowMenu();
  if (ctx) { openTaskEditor(ctx.taskId); }
}

function taskRowMenuCopyLink() {
  const ctx = taskRowMenuCtx;
  closeTaskRowMenu();
  if (ctx) { copyLinkForTask(findTaskById(ctx.taskId)); }
}

/* v2.49.0: clear the note link from every task that
   points at a note being deleted forever, and return how
   many were cleared. The tasks themselves are untouched
   citizens of the Tasks view; only the dangling
   reference goes. The change flows through
   afterTasksChanged like every mutation, and, like the
   reminder bookkeeping in the tasks writer, it does not
   move the tasks' updated stamps: nothing a person chose
   about the task changed. Gated on tasksArmed like every
   task mutation: before the load lands, state.tasks is
   the cache paint's display only copy, and a clear
   written against it could never persist. */
function clearTaskNoteLinks(noteId) {
  if (!tasksArmed || !noteId) { return 0; }
  let cleared = 0;
  state.tasks.forEach(function (t) {
    if (t.noteId === noteId) { t.noteId = null; cleared++; }
  });
  if (cleared) { afterTasksChanged(); }
  return cleared;
}

/* Complete or reopen a task. Completing a recurring task with
   a due date does not close it: the due date rolls forward by
   the interval from the current due date, the reminder re-arms
   (lastReminderFor clears, so the new occurrence can remind),
   and a toast names the new date. Completing a plain task
   stamps it completed; unchecking a completed task reopens it
   with its due date as it was. */
function toggleTaskComplete(id) {
  /* v2.44: the pre load gate, shared by every task
     mutation below (toggle, create, update, delete, and
     the editor's open). Until this session's real load
     arms the tasks, state.tasks may be the cache paint's
     display only copy: a mutation applied to it could
     never be written (saveTasks refuses while unarmed)
     and would be silently discarded when the load
     replaces the list with the Drive copy. Refusing
     here keeps the painted copy honest; the surfaces
     render their controls disabled for the same span
     (buildTaskRowEl, buildTaskCalEntryEl, the quick
     adds), and the load's renderAll repaints them live. */
  if (!tasksArmed) { return; }
  const task = findTaskById(id);
  if (!task) { return; }
  const now = new Date().toISOString();
  if (task.status === "completed") {
    task.status = "open";
    task.completedAt = null;
    task.updated = now;
    afterTasksChanged();
    return;
  }
  if (task.recurrence !== "none" && task.dueDate) {
    task.dueDate = advanceTaskDueDate(task.dueDate, task.recurrence);
    task.lastReminderFor = null;
    task.updated = now;
    afterTasksChanged();
    toast("Task rolled forward: now due " +
      taskDateLabel(task.dueDate) + ".");
    return;
  }
  task.status = "completed";
  task.completedAt = now;
  task.updated = now;
  afterTasksChanged();
}

/* A note object built from one catalog entry: everything the list
   needs, and no body. bodyLoaded false is the shell mark every
   body consumer checks; previewText, shellCardAtt, and
   attachmentCount carry the card's facts until the real file is
   fetched and the full parse replaces them. v2.32: the shell
   also carries the entry's search facts (shellTodoChecked,
   shellTodoUnchecked, shellAttachmentMimes), so the todo: and
   resource: search operators judge it as they judge a loaded
   note. */
function noteFromCatalogEntry(entry, collection) {
  /* v2.121: the entry's backend pair, judged here like
     every other shell field, so a damaged entry degrades
     predictably: backend is "doc" only on the exact
     string, and docId only on the one sanitizer's pass
     (sanitizeDocId in store.js). A "doc" entry whose
     docId sanitizes away stays Doc-backed with no id,
     and its open and save fail soft in the Doc paths; it
     is never quietly read as a file note, which would
     have the file paths write a note file at the note's
     path that the catalog does not mean. */
  const shellBackend = (entry && entry.backend === "doc")
    ? "doc" : "file";
  const shellDocId = shellBackend === "doc"
    ? sanitizeDocId(entry && entry.docId) : null;
  /* v2.128: the entry's tick memory rides onto the shell
     with the pair, judged by its own sanitizer
     (sanitizeDocTicks in store.js), so a Doc-backed
     shell holds the record its first body build will
     reapply, and a catalog rebuilt over shells round
     trips it unchanged. A file entry never carries it:
     the sanitizer is not even consulted. */
  const shellDocTicks = shellBackend === "doc"
    ? sanitizeDocTicks(entry && entry.docTicks) : null;
  return {
    id: entry.id,
    title: entry.title || "Untitled note",
    notebook: entry.notebook || "",
    backend: shellBackend,
    docId: shellDocId,
    docTicks: shellDocTicks,
    tags: Array.isArray(entry.tags) ? entry.tags.slice() : [],
    created: entry.created || "",
    updated: entry.updated || "",
    pinned: !!entry.pinned,
    body: null,
    bodyLoaded: false,
    previewText: entry.preview || "",
    attachments: [],
    thumbnail: entry.thumbnail || null,
    /* v2.35: the entry's reminder pair rides onto the
       shell itself (see buildCatalogEntry), so the card
       marker, the Reminders view, and search all read the
       note's own fields whichever shape the note is in. */
    reminderAt: entry.reminderAt || null,
    reminderDoneAt: entry.reminderDoneAt || null,
    shellCardAtt: entry.cardAttachment || null,
    /* v2.120: the entry's external card image address
       rides onto the shell the same way (see
       buildCatalogEntry), judged by the one scheme
       gate and capped, so a hand edited catalog can
       never put an unusable address on a card. */
    shellCardExtImage: (typeof entry.cardExtImage === "string" &&
        entry.cardExtImage.length <= 2048 &&
        !extImageUrlError(entry.cardExtImage))
      ? entry.cardExtImage : null,
    attachmentCount: entry.attachmentCount || 0,
    /* v2.32: the entry's search facts ride onto the shell
       (see buildCatalogEntry): checklist state for todo:
       and the attachment MIME types for resource:. */
    shellTodoChecked: !!entry.todoChecked,
    shellTodoUnchecked: !!entry.todoUnchecked,
    shellAttachmentMimes: Array.isArray(entry.attachmentMimes)
      ? entry.attachmentMimes.slice() : [],
    sha: entry.token || null,
    fileId: entry.fileId || null,
    trashed: collection === "trash",
    trashedFrom: entry.trashedFrom || null,
    archived: collection === "archive",
    archivedFrom: entry.archivedFrom || null
  };
}

/* Fetch a shell note's one file and complete the note in place:
   the full parse replaces every field, the loaded content seeds
   the note's last saved baseline (it IS the last saved state),
   and the cache picks the completed note up. Concurrent callers
   share one in flight fetch. A failed fetch leaves the shell a
   shell (bodyLoaded still false) and resolves anyway, so UI
   callers can simply re-check the flag; the promise never
   rejects. */
function ensureNoteBodyLoaded(note) {
  if (!note || note.bodyLoaded !== false) {
    return Promise.resolve(note);
  }
  if (noteBodyLoads[note.id]) { return noteBodyLoads[note.id]; }
  const load = (async function () {
    try {
      if (isDocBackedNote(note)) {
        /* v2.121: a Doc-backed shell completes from its
           Google Doc, not from a note file (there is
           none): docLoadNoteBody (media.js) fetches the
           Doc, converts its export into the editor's
           body, adopts its images, and holds the Doc's
           revision token and file name on the note.
           Title, tags, and notebook stay the catalog's,
           which is where they live for this shape. A
           failure (including the Doc module's
           needs-consent state) throws into the same catch
           below, so the note stays a shell and the editor
           shows its standing could not load state: the
           notebook is never broken by it. */
        await docLoadNoteBody(note);
      } else {
      const file = await storeGetFile(notePath(note));
      if (file) {
        bootCountNoteDownload();   /* v2.21: the boot report's count */
        const parsed = parseNoteFile(file.text, file.token, note.id,
          note.trashed, note.archived);
        note.title = parsed.title;
        note.notebook = parsed.notebook;
        note.tags = parsed.tags;
        note.created = parsed.created;
        note.updated = parsed.updated;
        note.pinned = parsed.pinned;
        note.body = parsed.body;
        note.attachments = parsed.attachments;
        note.thumbnail = parsed.thumbnail;
        /* v2.35: the file's reminder pair replaces the
           catalog facts the shell carried, the same swap
           the thumbnail makes. */
        note.reminderAt = parsed.reminderAt;
        note.reminderDoneAt = parsed.reminderDoneAt;
        note.trashedFrom = parsed.trashedFrom;
        note.archivedFrom = parsed.archivedFrom;
        note.sha = file.token;
        note.previewText = htmlToText(parsed.body).slice(0, 140);
      } else {
        /* Listed a moment ago and already gone: the next load
           drops the note; until then it opens empty rather than
           not at all. */
        note.body = "";
      }
      }
    } catch (err) {
      return note;   /* still a shell; a later attempt can retry */
    }
    note.bodyLoaded = true;
    rememberLastSavedContent(note);
    saveCache();
    return note;
  })();
  noteBodyLoads[note.id] = load;
  load.then(function () {
    if (noteBodyLoads[note.id] === load) { delete noteBodyLoads[note.id]; }
  });
  return load;
}

/* The plain text the list shows and searches for one note: the
   body derived text for a loaded note, the catalog preview for a
   shell (which is the same derivation, capped the same way, made
   when the entry was built). */
function noteListText(note) {
  if (!note) { return ""; }
  if (note.bodyLoaded === false) { return note.previewText || ""; }
  return htmlToText(note.body);
}

/* The drop box in its empty form, as the app creates it. */
function emptyIncomingText() {
  return JSON.stringify({ notes: [], rejected: [] }, null, 2);
}

/* Read the drop box during a load: create it (best effort) when
   missing, and stash its contents for syncNow's processing step
   when its token moved past the last processed token. A malformed
   box is left exactly as found (the outside writer owns fixing
   it) and treated as processed at its current token, so a load
   never spins on it. Nothing here may fail the load around it. */
async function loadIncomingStash() {
  pendingIncoming = null;
  try {
    const file = await storeGetFile(INCOMING_FILE);
    if (!file) {
      try {
        incomingProcessedToken = await storePutFile(INCOMING_FILE,
          emptyIncomingText(), null, "Create drop box", { fresh: true });
      } catch (err) { /* best effort; retried by the next load */ }
      return;
    }
    let parsed = null;
    try { parsed = JSON.parse(file.text); } catch (err) { parsed = null; }
    if (!parsed || !Array.isArray(parsed.notes) ||
        !Array.isArray(parsed.rejected)) {
      incomingProcessedToken = file.token;
      return;
    }
    if (file.token !== incomingProcessedToken) {
      pendingIncoming = {
        token: file.token,
        notes: parsed.notes.slice(),
        rejected: parsed.rejected.slice()
      };
    }
  } catch (err) { /* a failed read idles the box for this load */ }
}

/* v2.23: the drop box caps for carried attachments, decoded
   sizes: one attachment may be at most 10 MB, and one entry's
   attachments together at most 25 MB. Single named constants:
   the import below and the README both answer to these. */
const DROPBOX_ATT_MAX_BYTES = 10 * 1024 * 1024;
const DROPBOX_ATT_TOTAL_BYTES = 25 * 1024 * 1024;

/* The identity of one drop box entry for cleanup subtraction:
   a type tagged key, so entries are told apart by what they
   are, not only by their text. A string entry keys on its
   text; an object entry on its note text (two object entries
   carrying the same note text are the same drop twice over,
   and the duplicate skip has already kept the second from
   importing or uploading anything); anything else keys on its
   string form, as the pre-v2.23 rejection path recorded it. */
function dropboxEntryKey(entry) {
  if (typeof entry === "string") { return "s:" + entry; }
  if (entry && typeof entry === "object" &&
      typeof entry.note === "string") {
    return "o:" + entry.note;
  }
  return "x:" + String(entry);
}

/* Remove from list exactly the entries whose keys are in
   removalKeys, one occurrence apiece (multiset subtraction):
   processed entries go, anything appended concurrently that
   was never processed stays. */
function subtractDropboxEntries(list, removalKeys) {
  const pending = removalKeys.slice();
  return (list || []).filter(function (item) {
    const idx = pending.indexOf(dropboxEntryKey(item));
    if (idx >= 0) {
      pending.splice(idx, 1);
      return false;
    }
    return true;
  });
}

/* Base64 to bytes for a carried attachment. Whitespace in the
   payload (line wraps from a mail or JSON writer) is ignored.
   Returns null on undecodable input; the caller counts the
   item as failed under its name. */
function decodeDropboxBase64(dataBase64) {
  try {
    const bin = atob(String(dataBase64).replace(/\s+/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
  } catch (err) { return null; }
}

/* v2.23: land one object entry's carried attachments on its
   note. Runs after the note text's own front matter records
   were stripped (see processIncomingBox) and before the note
   is saved, so the records and the body blocks are part of
   the note's first save and canonicalize exactly like any
   editor placed attachment. Items run in array order through
   the app's ordinary attachment upload (the current provider
   driver, the store attachments folder via the storage name
   convention), under the caps above: an item over a cap is
   skipped and named, an undecodable or failed item is counted
   and named, and neither stops the note or the items after
   it. Placement: each landed item appends its block at the
   end of the body, images as the inline image figure the
   editor itself inserts, other files as the attachment block;
   both are the bare shells the save funnel rebuilds, so the
   imported note is native from its first save. */
async function importDropboxAttachments(note, items) {
  const result = { imported: 0, skippedNames: [], failedNames: [] };
  const attachCfg = state.attach || {};
  const svc = attachCfg.defaultProvider || "google";
  const driver = (typeof providers !== "undefined" && providers)
    ? providers[svc] : null;
  let ready = false;
  if (driver && state.online) {
    try {
      const st = await driver.getStatus();
      ready = !!(st && st.connected);
    } catch (err) { ready = false; }
  }
  let totalBytes = 0;
  const shells = [];
  for (const item of items) {
    const name = (item && typeof item.name === "string" && item.name)
      ? item.name : "attachment";
    const mime = (item && typeof item.mimeType === "string" && item.mimeType)
      ? item.mimeType : "application/octet-stream";
    let bytes = null;
    if (item && typeof item.dataBase64 === "string") {
      bytes = decodeDropboxBase64(item.dataBase64);
    }
    if (!bytes) { result.failedNames.push(name); continue; }
    if (bytes.length > DROPBOX_ATT_MAX_BYTES ||
        totalBytes + bytes.length > DROPBOX_ATT_TOTAL_BYTES) {
      result.skippedNames.push(name);
      continue;
    }
    totalBytes += bytes.length;
    if (!ready || !driver) { result.failedNames.push(name); continue; }
    const attId = newNoteId() + "a";
    const storageName = attId + "__" + sanitizeFileName(name);
    const file = new File([bytes], name, { type: mime });
    /* The provider driver's upload is promise based, with a
       progress callback as its third argument, exactly as the
       docx image import beside this section calls it. */
    let uploaded = null;
    try {
      uploaded = await driver.upload(file, storageName,
        function () { });
    } catch (err) { uploaded = null; }
    if (!uploaded || !uploaded.fileId) {
      result.failedNames.push(name);
      continue;
    }
    note.attachments.push({
      id: attId,
      provider: svc,
      fileId: String(uploaded.fileId),
      name: name,
      storageName: storageName,
      mime: mime,
      size: bytes.length,
      created: new Date().toISOString()
    });
    shells.push({ id: attId, image: mime.indexOf("image/") === 0 });
    result.imported++;
  }
  if (shells.length) {
    let tail = "";
    shells.forEach(function (s) {
      tail += s.image
        ? '<figure class="ss-attachment" data-attachment-id="' + s.id +
          '" contenteditable="false"></figure>'
        : '<div class="ss-attachment" data-attachment-id="' + s.id +
          '" contenteditable="false"></div>';
    });
    note.body = (note.body || "") + tail;
  }
  return result;
}

/* Process the drop box stashed by the load. Runs inside syncNow,
   after the load and before its render, so an auto-sync cycle
   imports too. See the section comment for the rules; the one
   toast at the end is the report, and rejected entries stay in
   the file for the outside writer to see and fix. */
async function processIncomingBox() {
  const pending = pendingIncoming;
  pendingIncoming = null;
  if (!pending) { return; }
  if (!state.notebooks.length) { await createNotebook("Personal"); }
  let imported = 0;
  let duplicates = 0;
  let strippedNotes = 0;
  let fallbackName = null;
  /* v2.23: the attachment tallies for the report. */
  let attImported = 0;
  const attSkippedNames = [];
  const attFailedNames = [];
  const failed = [];
  const removalKeys = [];
  const batch = [];
  for (const rawEntry of pending.notes) {
    /* v2.23: two entry forms, told apart by type. A string is
       note file text, exactly as the box has always taken it.
       An object with a string note field is the same text
       plus carried attachments. Anything else (including an
       object without note text, and blank text either way) is
       rejected as not note file text, with the entry preserved
       in the rejected record in its own form: strings as they
       are, objects as the object, other values stringified,
       the pre-v2.23 behavior for each kind. */
    let entryText = null;
    let attItems = null;
    let rejectedEntry = rawEntry;
    if (typeof rawEntry === "string") {
      entryText = rawEntry;
    } else if (rawEntry && typeof rawEntry === "object" &&
        typeof rawEntry.note === "string") {
      entryText = rawEntry.note;
      attItems = Array.isArray(rawEntry.attachments)
        ? rawEntry.attachments : [];
    } else if (!rawEntry || typeof rawEntry !== "object") {
      rejectedEntry = String(rawEntry);
    }
    if (entryText === null || !entryText.trim()) {
      failed.push({
        entry: rejectedEntry,
        error: "The entry is not note file text."
      });
      removalKeys.push(dropboxEntryKey(rawEntry));
      continue;
    }
    const parsed = parseNoteFile(entryText, null, newNoteId(), false, false);
    if (findNoteById(parsed.id)) {
      /* The duplicate skip runs before any attachment work, so
         a reprocessed entry never uploads (and orphans) files. */
      duplicates++;
      removalKeys.push(dropboxEntryKey(rawEntry));
      continue;
    }
    let target = parsed.notebook;
    if (!target || !state.notebooks.some(function (nb) {
      return nb.slug === target;
    })) {
      /* v2.72: an entry naming no notebook (or one that
         does not exist) files in the default notebook,
         the first notebook while none is set. */
      target = fallbackNotebookSlug();
      fallbackName = notebookNameForSlug(target);
      parsed.notebook = target;
    }
    /* Attachment records name files this app has never seen and
       cannot see (the drive.file visibility rule the box exists
       to work around), so they are stripped and counted rather
       than left dangling into a broken note. v2.23: the files an
       object entry CARRIES are a different matter; they upload
       below and land as records of the app's own making. */
    if ((parsed.attachments || []).length) {
      strippedNotes++;
      parsed.attachments = [];
      parsed.thumbnail = null;
    }
    parsed.trashed = false;
    parsed.trashedFrom = null;
    parsed.archived = false;
    parsed.archivedFrom = null;
    parsed.sha = null;
    parsed.fileId = null;
    /* v2.130: a drop box import is a note born into its
       notebook, so it is Doc-backed like every newborn
       note: the save below creates its Google Doc
       through the same upload path a typed note takes.
       A stored attachment figure rides the Doc save's
       own figure handling (docBuildUploadHtml embeds
       it in the Doc); a figure that cannot ride crosses
       as its Drive link, the conversion design's
       fallback, and the import still completes. */
    markNoteDocBacked(parsed);
    parsed.bodyLoaded = true;
    if (attItems && attItems.length) {
      const attResult = await importDropboxAttachments(parsed, attItems);
      attImported += attResult.imported;
      attResult.skippedNames.forEach(function (n) {
        attSkippedNames.push(n);
      });
      attResult.failedNames.forEach(function (n) {
        attFailedNames.push(n);
      });
    }
    state.notes.unshift(parsed);
    try {
      await saveNoteToRepo(parsed, { skipConflictCheck: true, fresh: true });
      imported++;
      batch.push(parsed);
      removalKeys.push(dropboxEntryKey(rawEntry));
    } catch (err) {
      state.notes = state.notes.filter(function (n) {
        return n.id !== parsed.id;
      });
      failed.push({ entry: rejectedEntry, error: err.message });
      removalKeys.push(dropboxEntryKey(rawEntry));
    }
  }
  /* A batch lands at the head of the list in box order (the loop
     unshifted each note as its save ran, so the block is put back
     in entry order here). */
  if (batch.length > 1) {
    const batchIds = {};
    batch.forEach(function (n) { batchIds[n.id] = true; });
    state.notes = batch.concat(state.notes.filter(function (n) {
      return !batchIds[n.id];
    }));
  }
  /* Cleanup, with the race care from the section comment:
     re-read fresh, subtract exactly what was processed, move the
     failures to rejected, preserve everything else, and write
     back against the fresh token. A lost race or a failed write
     leaves the file (and the processed token) alone; the next
     sync retries, and the duplicate skip keeps a retry from
     importing anything twice. */
  try {
    const fresh = await storeGetFile(INCOMING_FILE);
    if (!fresh) {
      incomingProcessedToken = pending.token;
    } else {
      let freshParsed = null;
      try { freshParsed = JSON.parse(fresh.text); } catch (err) {
        freshParsed = null;
      }
      if (!freshParsed || !Array.isArray(freshParsed.notes) ||
          !Array.isArray(freshParsed.rejected)) {
        incomingProcessedToken = fresh.token;
      } else {
        const remaining = subtractDropboxEntries(freshParsed.notes,
          removalKeys);
        const newRejected = freshParsed.rejected.concat(failed.map(
          function (f) {
            return {
              entry: f.entry, error: f.error,
              at: new Date().toISOString()
            };
          }));
        if (remaining.length !== freshParsed.notes.length ||
            failed.length > 0) {
          incomingProcessedToken = await storePutFile(INCOMING_FILE,
            JSON.stringify({ notes: remaining, rejected: newRejected },
              null, 2),
            fresh.token, "Update drop box");
        } else {
          incomingProcessedToken = fresh.token;
        }
      }
    }
  } catch (err) { /* left for the next sync, by design */ }
  if (imported > 0) { saveCache(); }
  const total = imported + duplicates + failed.length;
  if (total > 0) {
    let message = "Imported " + imported +
      (imported === 1 ? " note" : " notes") + " from the drop box";
    if (duplicates > 0) {
      message += "; skipped " + duplicates +
        (duplicates === 1 ? " duplicate" : " duplicates");
    }
    if (failed.length > 0) {
      message += "; rejected " + failed.length;
    }
    if (fallbackName) {
      message += "; notes naming a missing notebook were placed in " +
        fallbackName;
    }
    if (strippedNotes > 0) {
      message += "; attachments were left off " + strippedNotes +
        (strippedNotes === 1 ? " note" : " notes");
    }
    /* v2.23: the carried attachments' own tallies. Skipped and
       failed items are named, so the report says which file
       did not land, not only that one did not. */
    if (attImported > 0) {
      message += "; attachments imported " + attImported;
    }
    if (attSkippedNames.length > 0) {
      message += "; attachments skipped " + attSkippedNames.length +
        " (too large): " + attSkippedNames.join(", ");
    }
    if (attFailedNames.length > 0) {
      message += "; attachments failed " + attFailedNames.length +
        ": " + attFailedNames.join(", ");
    }
    toast(message, failed.length > 0);
  }
}

/* Sign out drops the catalog and drop box session state, like the
   version runtime state beside it: tokens and stashes belong to
   the signed in account, and the write timer must not fire into
   the next session. */
function resetCatalogRuntimeState() {
  if (catalogWriteTimer !== null) {
    clearTimeout(catalogWriteTimer);
    catalogWriteTimer = null;
  }
  catalogWriteDirty = false;
  catalogArmed = false;
  /* v2.131: the catalog build's entry memory belongs
     to this session's state, like the tokens beside
     it; a new session rebuilds it from its own first
     build. */
  catalogEntryMemory = Object.create(null);
  lastCatalogToken = null;
  lastCatalogEntriesText = null;
  /* v2.121: the Doc entry stash and the Doc module's
     status reset with the rest of the runtime state. */
  lastCatalogDocEntries = [];
  resetDocNotesState();
  pendingIncoming = null;
  incomingProcessedToken = null;
  Object.keys(noteBodyLoads).forEach(function (id) {
    delete noteBodyLoads[id];
  });
}

/* A catalog problem the classic load should answer instead: the
   reconcile throws this (and only this) to ask for the fallback,
   and loadAllFromRepo honors exactly it. */
function catalogFallbackSignal(message) {
  const err = new Error(message);
  err.catalogFallback = true;
  return err;
}

/* v2.122: the load's listings already carry every child's
   CURRENT Drive token (driveStoreListDir maps each child's
   live metadata through driveTokenFromMetadata, head
   revision first), so a Google Doc sitting in any listed
   folder gives up its live revision token here with no
   extra call: file id to token, for every non-folder child
   of every listed folder (notebooks, trash, archive; a
   Doc-backed note's Doc stays in its creation folder even
   when the note itself moves notebooks, so the map spans
   them all). The reconcile's Doc pass below judges its
   body carry against this map. An id absent from the map
   (the Doc was moved out of every listed folder in Drive,
   or a listing could not see it) reads as no token, and
   the carry fails toward a refetch, never toward serving
   a body whose freshness cannot be proven. */
function docLiveTokenMap(listings) {
  const map = Object.create(null);
  if (!listings) { return map; }
  const takeList = function (entries) {
    (entries || []).forEach(function (entry) {
      if (!entry || entry.isDir) { return; }
      if (typeof entry.fileId === "string" && entry.fileId &&
          typeof entry.token === "string" && entry.token) {
        /* v2.127: the entry's modified time rides beside
           its token. A Doc's head revision lags its edits
           while its modified time moves at once, so the
           carry below judges the pair, not the token
           alone. */
        map[entry.fileId] = {
          token: entry.token,
          modifiedTime: entry.modifiedTime || null
        };
      }
    });
  };
  Object.keys(listings.notebooks || {}).forEach(function (slug) {
    takeList(listings.notebooks[slug]);
  });
  takeList(listings.trash);
  takeList(listings.archive);
  return map;
}

/* The fast path: reconcile the catalog against the gathered
   listings (one snapshot of the store's shape, taken by
   loadAllFromRepo). Trusted entries become shells, or full notes
   when this session already holds that note's body at the
   listing's token; everything else downloads only its own body,
   exactly as the classic load does. Falls back (via
   catalogFallbackSignal) on a malformed entry or a duplicate
   note id in the listings. */
async function reconcileCatalogListings(catalog, listings) {
  const entriesByKey = Object.create(null);
  (catalog.entries || []).forEach(function (entry) {
    if (!entry || typeof entry !== "object" ||
        typeof entry.id !== "string" || !entry.id ||
        typeof entry.collection !== "string") {
      throw catalogFallbackSignal("A catalog entry is malformed.");
    }
    /* An entry whose token or file id is unusable simply never
       matches a listing (below), which downloads that body and
       rebuilds the entry; it is not a reason to abandon the
       whole catalog. */
    if (typeof entry.token === "string" &&
        typeof entry.fileId === "string") {
      entriesByKey[entry.collection + "|" + entry.id] = entry;
    }
  });
  const prevById = Object.create(null);
  [state.notes, state.trash, state.archive].forEach(function (list) {
    (list || []).forEach(function (note) { prevById[note.id] = note; });
  });
  const seenIds = Object.create(null);
  const out = { notes: [], trash: [], archive: [] };

  async function take(collection, slug, entries) {
    const listName = collection === "notebook" ? "notes" : collection;
    for (const entry of (entries || [])) {
      if (entry.isDir || !/\.md$/i.test(entry.name)) { continue; }
      const fallbackId = entry.name.replace(/\.md$/i, "");
      if (seenIds[fallbackId]) {
        throw catalogFallbackSignal(
          "A note id appears twice in the store: " + fallbackId);
      }
      seenIds[fallbackId] = true;
      const path = collection === "notebook"
        ? "notebooks/" + slug + "/" + entry.name
        : collection + "/" + entry.name;
      const cat = entriesByKey[collection + "|" + fallbackId];
      if (cat && cat.token === entry.token &&
          cat.fileId === entry.fileId) {
        const note = noteFromCatalogEntry(cat, collection);
        const prev = prevById[fallbackId];
        if (prev && prev.sha === entry.token &&
            typeof prev.body === "string") {
          /* This session already holds the body at this exact
             revision (the boot cache, or the previous load a
             moment ago): keep it, so a sync costs the note
             nothing and everything downstream sees a full note. */
          note.body = prev.body;
          note.attachments = prev.attachments;
          note.bodyLoaded = true;
          note.previewText = htmlToText(prev.body).slice(0, 140);
        }
        note.sha = entry.token;
        note.fileId = entry.fileId;
        out[listName].push(note);
      } else {
        const file = await storeGetFile(path);
        if (!file) { continue; }   /* vanished mid load, as before */
        bootCountNoteDownload();   /* v2.21: the boot report's count */
        const note = parseNoteFile(file.text, file.token, fallbackId,
          collection === "trash", collection === "archive");
        if (!note.notebook && collection === "notebook") {
          note.notebook = slug;
        }
        note.fileId = entry.fileId;
        out[listName].push(note);
      }
    }
  }

  for (const nb of state.notebooks) {
    await take("notebook", nb.slug, listings.notebooks[nb.slug]);
  }
  await take("trash", null, listings.trash);
  await take("archive", null, listings.archive);
  /* v2.121: Doc-backed entries have no note file, so no
     listing above can ever take them: they ride the
     catalog alone. Each well formed Doc entry (sanitized
     backend "doc" with a Doc id that passes the one
     sanitizer) whose id no listing took joins its
     collection's list as a shell, through the same shell
     builder. When the previous state holds the same note
     still Doc-backed with a loaded body at the entry's
     revision, the body and its adopted attachments carry
     over, exactly as the listing branch above carries
     them; a revision that moved means the Doc changed
     elsewhere, and the shell refetches it on open.
     v2.122: the revision that last clause speaks of is
     the Doc's LIVE revision, read from this load's own
     listings (see docLiveTokenMap) and compared against
     the token the held body was fetched or saved at
     (prev.sha). The v2.121 test compared prev.sha
     against the catalog entry's token instead, and both
     of those were written by THIS app at its last fetch
     or save, so an edit made in Google Docs, which moves
     the Doc's real head revision and nothing the app
     recorded, could never fail it: the app compared
     itself against itself and carried the stale body
     through every reload, Sync Now, and reopen (Chris's
     device report). An entry whose Doc the listings
     cannot see now fails the same way a moved revision
     does, toward the refetch, never toward the stale
     body.
     v2.127: the pair the v2.122 pass judges is now both
     of the Doc's live markers, the token and the listing
     modified time, against both markers the held body
     was fetched or saved at (prev.sha, prev.docModifiedTime).
     The token alone re-opened the same stale window on
     the load path that the poll had: Google advances a
     Doc's head revision lazily, so a Google side edit
     could leave the live token equal to the recorded one
     while the Doc had already moved, and a body carrying
     no recorded modified time could adopt the moved one
     as its own baseline. Judged on the pair, the carry
     also records the live modified time on the shell. */
  const docLiveTokens = docLiveTokenMap(listings);
  (catalog.entries || []).forEach(function (entry) {
    if (!entry || entry.backend !== "doc") { return; }
    if (!sanitizeDocId(entry.docId)) { return; }
    if (seenIds[entry.id]) { return; }
    seenIds[entry.id] = true;
    const listName = entry.collection === "notebook"
      ? "notes" : entry.collection;
    if (!out[listName]) { return; }
    const shell = noteFromCatalogEntry(entry, entry.collection);
    const prev = prevById[entry.id];
    const liveMark = docLiveTokens[entry.docId] || null;
    const liveToken = liveMark ? liveMark.token : null;
    if (prev && isDocBackedNote(prev) &&
        typeof prev.body === "string" &&
        liveToken && prev.sha &&
        liveToken === prev.sha &&
        (!liveMark.modifiedTime || !prev.docModifiedTime ||
         liveMark.modifiedTime === prev.docModifiedTime)) {
      shell.body = prev.body;
      shell.bodyLoaded = true;
      shell.sha = liveToken;
      shell.docModifiedTime = liveMark.modifiedTime ||
        prev.docModifiedTime || null;
      /* v2.128: the carried body was built under the
         session note's tick memory, so the session's
         record (the fresher of the pair, captured by
         its saves) rides with it when it holds one; the
         entry's own record stands otherwise. */
      const prevTicks = sanitizeDocTicks(prev.docTicks);
      if (prevTicks) { shell.docTicks = prevTicks; }
      shell.attachments = prev.attachments || [];
      shell.docName = prev.docName;
      shell.previewText =
        htmlToText(prev.body).slice(0, 140);
    }
    out[listName].push(shell);
  });
  return out;
}

/* The classic load: every note body downloaded and parsed, as
   every load worked before v2.20. It runs when there is no
   usable catalog and whenever reconciliation declines, driven by
   the same gathered listings so the two paths can never disagree
   about which files exist. */
async function loadListingsClassic(listings) {
  const out = { notes: [], trash: [], archive: [] };
  for (const nb of state.notebooks) {
    const entries = listings.notebooks[nb.slug];
    for (const entry of (entries || [])) {
      if (entry.isDir || !/\.md$/i.test(entry.name)) { continue; }
      const file = await storeGetFile(
        "notebooks/" + nb.slug + "/" + entry.name);
      if (!file) { continue; }
      bootCountNoteDownload();   /* v2.21: the boot report's count */
      const fallbackId = entry.name.replace(/\.md$/i, "");
      const note = parseNoteFile(file.text, file.token, fallbackId, false);
      if (!note.notebook) { note.notebook = nb.slug; }
      note.fileId = entry.fileId;
      out.notes.push(note);
    }
  }
  const trashEntries = listings.trash;
  for (const entry of (trashEntries || [])) {
    if (entry.isDir || !/\.md$/i.test(entry.name)) { continue; }
    const file = await storeGetFile("trash/" + entry.name);
    if (!file) { continue; }
    bootCountNoteDownload();   /* v2.21: the boot report's count */
    const fallbackId = entry.name.replace(/\.md$/i, "");
    const note = parseNoteFile(file.text, file.token, fallbackId, true);
    note.fileId = entry.fileId;
    out.trash.push(note);
  }
  /* v1.5: the archive folder loads exactly like the trash folder.
     Stores created before archiving have no archive folder at all;
     the listing then comes back null and the archive is simply
     empty. The folder materializes on the first archive (the
     Drive driver creates folders on the way to a file). */
  const archiveEntries = listings.archive;
  for (const entry of (archiveEntries || [])) {
    if (entry.isDir || !/\.md$/i.test(entry.name)) { continue; }
    const file = await storeGetFile("archive/" + entry.name);
    if (!file) { continue; }
    bootCountNoteDownload();   /* v2.21: the boot report's count */
    const fallbackId = entry.name.replace(/\.md$/i, "");
    const note = parseNoteFile(file.text, file.token, fallbackId,
      false, true);
    note.fileId = entry.fileId;
    out.archive.push(note);
  }
  return out;
}

/* Load everything from the repo: index (or rebuild it), every
   notebook folder, every note file, the trash folder, and the
   archive folder. Results replace state and refresh the cache.
   Throws on hard failures so the caller can fall back to the
   cache and say so.
   v2.20: the folder listings are gathered once, with file ids
   and revision tokens, and the note files themselves load
   through the catalog fast path when a usable catalog exists
   (see the v2.20 section comment above), falling back to the
   classic full download otherwise. The drop box is read along
   the way; its import step runs in syncNow, after this load. */
/* v2.21: the catalog read, lifted out of loadAllFromRepo so
   the load can start it alongside the folder listings and
   await it where the old serial code read it. The body is
   the v2.20 read unchanged, failures and all: any failure
   here (a missing file, a transport error, unparseable JSON,
   a shape this build does not speak) simply means the classic
   load runs and the catalog is rebuilt from its result. */
/* v2.121: the Doc-backed entries of the most recent
   catalog read, sanitized to {entry, collection, listName}
   triples. They are stashed even from a catalog the load
   cannot use as a whole (a shape this build does not read,
   or entries that make the reconcile decline), because a
   Doc-backed note has no file for the classic load to
   find: without the stash, a damaged or older catalog
   would make Doc-backed notes vanish from the load even
   though their entries are sitting readable in the file.
   loadAllFromRepo merges them into a classic load only;
   the reconcile reads the entries itself when it runs.
   Cleared with the rest of the catalog runtime state. */
let lastCatalogDocEntries = [];

async function readCatalogForLoad() {
  let catalog = null;
  lastCatalogDocEntries = [];
  try {
    const catalogFile = await storeGetFile(CATALOG_FILE);
    if (catalogFile) {
      lastCatalogToken = catalogFile.token;
      /* The entries text resets BEFORE the parse: a catalog that
         cannot be used must not leave the writer believing its
         entries are current, or the rebuild after the classic
         load would be skipped as "unchanged" and the damaged
         file would never heal. */
      lastCatalogEntriesText = null;
      try {
        const parsedCatalog = JSON.parse(catalogFile.text);
        if (parsedCatalog &&
            Array.isArray(parsedCatalog.entries)) {
          /* v2.121: the Doc entry stash is taken from any
             parseable catalog, ahead of the shape judgment
             below, for the reason the declaration above
             gives. Every candidate is judged by the same
             sanitizers the shell builder applies. */
          parsedCatalog.entries.forEach(function (entry) {
            if (!entry || typeof entry !== "object" ||
                entry.backend !== "doc" ||
                typeof entry.id !== "string" || !entry.id ||
                !sanitizeDocId(entry.docId)) {
              return;
            }
            const collection = entry.collection === "trash" ||
              entry.collection === "archive"
              ? entry.collection : "notebook";
            lastCatalogDocEntries.push({
              entry: entry,
              collection: collection,
              listName: collection === "notebook"
                ? "notes" : collection
            });
          });
        }
        if (parsedCatalog &&
            parsedCatalog.version === CATALOG_SHAPE_VERSION &&
            Array.isArray(parsedCatalog.entries)) {
          catalog = parsedCatalog;
          lastCatalogEntriesText = JSON.stringify(parsedCatalog.entries);
        }
      } catch (e) { catalog = null; }
    } else {
      lastCatalogToken = null;
      lastCatalogEntriesText = null;
    }
  } catch (e) { catalog = null; lastCatalogEntriesText = null; }
  return catalog;
}

/* v2.121: merge the stashed Doc-backed entries into a
   classic load's lists as shells, skipping any id the
   listings already produced. Called by loadAllFromRepo
   only when the reconcile did not run. */
function mergeCatalogDocShells(loaded) {
  if (!loaded || !lastCatalogDocEntries.length) { return; }
  const have = Object.create(null);
  [loaded.notes, loaded.trash, loaded.archive].forEach(
    function (list) {
      (list || []).forEach(function (note) {
        have[note.id] = true;
      });
    });
  lastCatalogDocEntries.forEach(function (stashed) {
    if (have[stashed.entry.id]) { return; }
    have[stashed.entry.id] = true;
    loaded[stashed.listName].push(
      noteFromCatalogEntry(stashed.entry, stashed.collection));
  });
}

async function loadAllFromRepo() {
  attachmentParseWarnings = 0;   /* v1.2: reset the malformed metadata count */
  /* v2.53: the tasks read starts FIRST, before the index
     read, and lands the moment it resolves. tasks.json is
     a root level file and needs nothing from the index, so
     the read races nothing; until v2.52 its result waited
     at the load's tail, behind every folder listing and
     the catalog reconcile, and on the owner's device that
     was the visible gap between the notes painting from
     cache (2.5 s) and the tasks turning real at the full
     sync (6.6 s). The landing continuation applies a fast
     read while the load below is still gathering; the
     tail's own apply call (same function, same guard)
     covers a read so slow it arrives only there, and the
     per load generation keeps a superseded or signed out
     read from ever applying. A failure inside the landing
     is contained and warned about, never allowed to fail
     the load around it: the tail's apply call is the
     second chance, and the arming gates stay shut until
     an apply actually runs. */
  const tasksGeneration = ++tasksLoadGeneration;
  tasksLoadApplied = false;
  const tasksPromise = readTasksForLoad();
  tasksPromise.then(function (tasksLoad) {
    try {
      applyLoadedTasks(tasksLoad, tasksGeneration);
    } catch (err) {
      console.warn("Early tasks landing failed: " +
        (err && err.message));
    }
  });
  /* v2.21: the index read and the notebooks listing are
     independent; they run together now. Promise.all keeps the
     old failure surface: a rejection from either fails the
     load, as the serial order did. */
  const indexAndFolders = await Promise.all([
    storeGetFile("index.json"), storeListDir("notebooks")]);
  const indexFile = indexAndFolders[0];
  let index = null;
  if (indexFile) {
    try { index = JSON.parse(indexFile.text); } catch (e) { index = null; }
  }
  const folders = indexAndFolders[1];
  const folderSlugs = (folders || [])
    .filter(function (e) { return e.isDir; })
    .map(function (e) { return e.name; });

  if (!index || !Array.isArray(index.notebooks)) {
    /* v2.30: a parsed but unusable index can still carry the
       tag hierarchy; adopt it before the rebuild so the map
       is not lost with the notebooks list. */
    if (index && index.tagParents) {
      state.tagParents = sanitizeTagParents(index.tagParents);
    }
    /* v2.31: the shortcuts list is salvaged the same way. */
    if (index && index.shortcuts) {
      state.shortcuts = sanitizeShortcuts(index.shortcuts);
    }
    /* v2.32: the saved searches are salvaged the same way. */
    if (index && index.savedSearches) {
      state.savedSearches = sanitizeSavedSearches(index.savedSearches);
    }
    /* v2.33: the home field is salvaged the same way. */
    if (index && index.home) {
      state.home = sanitizeHome(index.home);
    }
    /* v2.38: the custom templates are salvaged the same
       way. */
    if (index && index.templates) {
      state.templates = sanitizeTemplates(index.templates);
    }
    index = buildIndexFromFolders(folderSlugs);
    state.notebooks = index.notebooks;
    /* v2.130: a stored docStore field (the retired
       per-notebook Doc switch) never rides into state;
       see the adoption below. */
    state.notebooks.forEach(function (nb) {
      if (nb) { delete nb.docStore; }
    });
    /* v2.63: the parent fields are sanitized on this
       adoption like every other load path (the rebuilt
       records preserve known notebooks whole, parents
       included, so the sanitize is what stands between
       a damaged stored parent and the sidebar). */
    sanitizeNotebookParents();
    state.index = index;
    /* Persist the rebuilt index so the next load is a single GET. */
    try {
      await storePutFile("index.json", JSON.stringify(index, null, 2),
        indexFile ? indexFile.token : null, "Rebuild index");
    } catch (err) { /* best effort, see saveIndex */ }
  } else {
    state.notebooks = index.notebooks;
    /* v2.130: a stored docStore field (the retired
       per-notebook Doc switch, v2.121 to v2.129) is
       stripped from the records as they are adopted,
       so no session carries it forward in state; the
       index writer drops it on write as well
       (buildIndexObject in sync.js). */
    state.notebooks.forEach(function (nb) {
      if (nb) { delete nb.docStore; }
    });
    /* v2.30: the tag parent map loads with the index and is
       sanitized on the way in; an index written before
       nested tags existed has no field and loads as an all
       top level hierarchy. */
    state.tagParents = sanitizeTagParents(index.tagParents);
    /* v2.31: the shortcuts list loads with the index too,
       sanitized on the way in; an index written before
       shortcuts existed has no field and loads as an empty
       Shortcuts section. */
    state.shortcuts = sanitizeShortcuts(index.shortcuts);
    /* v2.32: the saved searches load with the index too,
       sanitized on the way in; an index written before
       saved searches existed has no field and loads as an
       empty list. */
    state.savedSearches = sanitizeSavedSearches(index.savedSearches);
    /* v2.33: the home field loads with the index too,
       sanitized on the way in; an index written before
       Home existed has no field and loads as the default
       dashboard. */
    state.home = sanitizeHome(index.home);
    /* v2.38: the custom templates load with the index
       too, sanitized on the way in; an index written
       before templates existed has no field and loads
       as an empty My templates list. */
    state.templates = sanitizeTemplates(index.templates);
    state.index = index;
    /* A notebook folder with no index entry still gets listed, so notes
       are never hidden by a stale index. */
    folderSlugs.forEach(function (slug) {
      if (!state.notebooks.some(function (nb) { return nb.slug === slug; })) {
        state.notebooks.push(buildIndexFromFolders([slug]).notebooks[0]);
      }
    });
    /* v2.63: the parent fields are sanitized after this
       adoption like every other load path; a damaged
       parent degrades to top level here, never a lost
       notebook (see sanitizeNotebookParents). */
    sanitizeNotebookParents();
  }

  /* v2.20: the listings, gathered once for both load paths.
     v2.21: gathered CONCURRENTLY. Each notebook folder, the
     trash, and the archive are independent listings, and the
     catalog read and the drop box read depend on none of
     them, so all of it starts together and the load awaits
     the batch. Promise.all preserves the error semantics the
     serial code had (any listing's failure fails the load;
     the serial code simply stopped at the first). One known
     cost: racing folder resolutions can repeat a find child
     lookup for a shared parent before the folder id cache
     fills; the results are identical, only the call is
     duplicated. */
  const listings = { notebooks: {}, trash: null, archive: null };
  const listingJobs = state.notebooks.map(function (nb) {
    return storeListDir("notebooks/" + nb.slug).then(function (entries) {
      listings.notebooks[nb.slug] = entries;
    });
  });
  listingJobs.push(storeListDir("trash").then(function (entries) {
    listings.trash = entries;
  }));
  listingJobs.push(storeListDir("archive").then(function (entries) {
    listings.archive = entries;
  }));
  const catalogPromise = readCatalogForLoad();
  /* v2.53: the tasks read is not started here any more; it
     started at the top of this function and may already
     have landed (see applyLoadedTasks). */
  /* v2.20: the drop box rides along (creates itself if missing,
     stashes unprocessed contents for syncNow's import step). */
  const incomingPromise = loadIncomingStash();
  await Promise.all(listingJobs);
  bootMark("listingsDone");
  const catalog = await catalogPromise;
  bootMark("catalogRead");
  await incomingPromise;

  let loaded = null;
  if (catalog) {
    try {
      loaded = await reconcileCatalogListings(catalog, listings);
    } catch (err) {
      if (!err || !err.catalogFallback) { throw err; }
      loaded = null;   /* the catalog declined; the classic load runs */
    }
  }
  if (!loaded) {
    loaded = await loadListingsClassic(listings);
    /* v2.121: the classic load finds files only, so the
       Doc-backed notes ride in from the catalog read's
       stash (see readCatalogForLoad); when the reconcile
       ran it placed them itself and the stash stays
       unused. */
    mergeCatalogDocShells(loaded);
  }

  state.notes = loaded.notes;
  state.trash = loaded.trash;
  state.archive = loaded.archive;
  /* v2.53: the tasks were applied when their read landed
     (the top of this function); this await only settles
     the read before the load finishes, and the apply call
     is the tail's own landing for a read that arrives
     only now, a no op in every other run because the
     early landing already ran it. A failed read (null)
     keeps the tasks already in memory rather than
     emptying them on a transport hiccup, exactly as
     before. From here on the load never touches
     state.tasks again, so a task the user changed in the
     window since the early landing (tasks arm early now,
     so that window is real) survives this load untouched,
     and the saveCache below snapshots the list as it then
     stands. */
  const tasksLoad = await tasksPromise;
  applyLoadedTasks(tasksLoad, tasksGeneration);
  /* v2.16: the auto-sync corpus is whatever this load just
     resolved; see rebuildAutoSyncKnownIds. */
  rebuildAutoSyncKnownIds();
  /* v2.8: a fresh load is the last saved state, so it reseeds the
     version baselines; cached histories are dropped too, because
     another device may have written or pruned them since this
     device last read them. v2.20: shells carry no body, so they
     seed no baseline; ensureNoteBodyLoaded seeds theirs when
     their file is fetched (see rememberLastSavedContentForAllNotes). */
  rememberLastSavedContentForAllNotes();
  clearVersionHistoryCache();
  /* v2.20: from here on this session may maintain the catalog;
     the saveCache below schedules its first (re)build check. */
  catalogArmed = true;
  /* v2.53: the tasks' post load pass (open editor refresh
     under the untouched rule, the reminder catch up, and
     any notification click waiting to open its task) ran
     inside applyLoadedTasks, at the moment the read
     landed: early, or at the tail await above for a slow
     read, exactly once either way. */
  /* v2.35: the note reminders' post load pass: the boot
     catch up for moments missed while the app was closed,
     and any notification click still waiting to open its
     note. Unconditional (note reminders do not ride the
     tasks read). */
  checkNoteReminders();
  maybeOpenPendingNoteReminder();
  /* v2.31: with the whole library in memory, shortcuts whose
     targets exist nowhere (a notebook deleted on another
     device, a note deleted forever, a tag that left every
     note) are dropped from the stored list, so the section
     never accumulates ghosts. Entries pointing into Trash
     or Archive are NOT dropped: those notes still exist,
     and their shortcuts render as unavailable instead. */
  pruneShortcuts();
  saveCache();
  /* v1.2: one readable warning if any note file carried attachment
     metadata that could not be parsed. Those notes still loaded; they
     simply show no attachments until the line is repaired or the files
     are reattached. */
  if (attachmentParseWarnings > 0) {
    toast("Warning: " + attachmentParseWarnings + " note(s) had unreadable " +
      "attachment data and were opened without it. The notes themselves are fine.", true);
    attachmentParseWarnings = 0;
  }
}

/* v1.4.3: is the Google sign in live, judged from memory only? This is
   the synchronous twin of googleGetStatus below: a Google token is
   loaded in memory and its expiry is still ahead of the same 30 second
   safety margin googleGetStatus uses. It never decrypts the stored
   token blob, never prompts for sign in, and never touches the
   network, so it is safe to call from the sync guards, which must
   answer immediately. Callers that can await should still use
   googleGetStatus, which is the authoritative check. */
function googleSignInLiveInMemory() {
  if (!state.providerTokens.google) { return false; }
  if (!state.attach.googleExpiresAt) { return false; }
  return Date.now() <= state.attach.googleExpiresAt - 30000;
}

/* May a sync or a library load run against the store right now?
   Readiness is two facts: the Drive store is connected
   (state.repoExists), and a Google sign in is live in memory
   (googleSignInLiveInMemory above). This is the rule the v1.4.3
   fix established, kept as is: a stored or expired token is not
   readiness, only the live in memory sign in is. */
function storeSyncReady() {
  if (!state.repoExists) { return false; }
  return googleSignInLiveInMemory();
}


/* Full sync: flush queued offline edits first, then reload from the
   store, then re-render. Used by Sync now and automatically after
   sign in. Skipped unless storeSyncReady() says the store is
   connected and a Google sign in is live. */
async function syncNow(showToast) {
  if (!storeSyncReady()) { return; }
  if (state.syncing) { return; }
  state.syncing = true;
  refreshSyncPill();
  /* v2.16.1: snapshot the open note's pre-sync state (its last
     saved content baseline and its content as the sync found
     it), so the render below can refresh the open editor in
     place when the load brings a changed version of that note
     back and the editor holds nothing unsaved (see
     syncShouldRefillOpenNote). Captured here, before the
     flush: the flush itself can save, move, or fork the note
     and rewrite the baselines, and the snapshot must predate
     all of it to mean "what the user last saw saved". */
  const openNoteCtx = captureOpenNoteSyncContext();
  try {
    await flushQueue();
    /* v1.4.4: a coalesced index write may still be pending (its
       debounce is 800 ms). Flush it before the load reads index.json,
       so the load can never race or be confused by a stale index the
       app itself is about to replace. */
    await flushIndexWrites();
    /* v2.20: the same flush discipline for the catalog, so the
       load below reads this device's newest catalog, never one
       its own pending write is about to replace. */
    await flushCatalogWrites();
    /* v2.24: and the same for tasks.json, for the same reason. */
    await flushTasksWrites();
    await loadAllFromRepo();
  /* v2.80: a sync refreshes the calendar events with
     everything else (page memory only; a standing
     consent state is left to its Connect path). */
  refreshGcalAfterSync();
  refreshMailAfterSync();
    /* v2.20: if the load left the OPEN note as a catalog shell
       (its stored revision moved past the body this session
       held, so reconciliation trusted the listing and kept no
       body), complete its body before the render and before
       the open note restore reads it. The editor still shows
       the previous content at this point; leaving the note a
       shell here would let a dirty check read that stale
       editor content as the note's body and save it over the
       newer stored revision, the exact overwrite the conflict
       machinery exists to prevent. Every other note stays a
       shell; only the open one pays for its download, exactly
       as a full load always downloaded it. */
    const openAfterLoad = state.selectedId ?
      findNoteById(state.selectedId) : null;
    if (openAfterLoad && openAfterLoad.bodyLoaded === false) {
      await ensureNoteBodyLoaded(openAfterLoad);
    }
    syncOpenNoteRefresh = openNoteCtx;
    /* v2.112.0: the reader's place, captured with
       the load landed and the render about to run,
       and restored on the render's far side, so the
       sync leaves the reader where it found them
       (see the place block at captureSyncPlace). */
    const syncPlace = captureSyncPlace();
    try {
      renderAll();
    } finally {
      syncOpenNoteRefresh = null;
    }
    restoreSyncPlace(syncPlace);
    /* v2.131: the drop box drains AFTER the render now.
       It ran between the load and the render since
       v2.20, so a bulk import's serial saves held the
       library's repaint hostage for their whole length
       (the five note movie catalog import cost seconds
       of it), and each import's save scheduled its own
       catalog write behind the drain because the drain
       took no write hold. The loaded library paints
       first; the drain then runs under the bulk write
       hold (v2.69), so its imports land exactly one
       catalog write between them on the hold's
       release, and a second render shows what arrived,
       still inside this same pass. The open note's
       completion above still precedes the drain: an
       import is always a new note, so nothing the
       drain brings can be the open note, and the
       completion's overwrite guard keeps its place
       ahead of every render either way. The drain's
       failures stay contained inside it; a broken box
       must never fail the sync around it. */
    if (pendingIncoming) {
      holdCatalogWrites();
      try {
        await processIncomingBox();
      } catch (err) {
        console.warn("Drop box processing failed: " +
          (err && err.message));
      } finally {
        releaseCatalogWrites();
      }
      renderAll();
    }
    /* v2.36: the auto sync editor guard can let renderEditor
       return early when the OPEN note did not change, even
       when the sync rewrote a note that links to it; sweep
       the link graph once more here so the open note's
       backlinks bar follows arrivals either way. */
    refreshBacklinksPanel();
    refreshSyncPill();
    if (showToast) { toast("Synced with " + storageDisplayName() + "."); }
  } catch (err) {
    refreshSyncPill();
    toast("Sync failed: " + err.message, true);
  } finally {
    state.syncing = false;
    refreshSyncPill();
  }
}

/* The per note operation chain (v1.4.4, generalized in v1.5).
   Every storage operation that creates, rewrites, moves, or deletes
   one note's file goes through this chain, keyed by note id: saves,
   trash moves, restores, deletes forever, and (v1.5) archive and
   unarchive moves. Operations on the same note run one at a time in
   the exact order they were triggered; operations on different notes
   are unaffected and still run in parallel.

   Why it exists: since v1.4.4 the interface updates instantly and
   storage work finishes in the background, so two operations on one
   note can be in flight at once. On Google Drive an out of order pair
   is dangerous. A save that overtook the create it edits would find
   no file yet and create a second file with the same name, leaving a
   duplicate. A restore that overtook its own trash move would rewrite
   the notebook file and then watch the trash move delete it. The
   chain rules both out.

   The tail stored here never rejects, so one failed operation cannot
   poison later operations on the same note; each caller still
   receives its own result (or rejection) through the promise
   chainNoteOp returns, and operations that callers await today
   (deleteNotebook waiting on each trash move, for one) keep awaiting
   exactly as before. v1.4.4 keyed this chain by file path and used it
   for saves only; v1.5 keys it by note id, because a note's path
   changes as the note moves between folders, and shares it across
   every note operation. */
const noteOpChains = Object.create(null);

function chainNoteOp(note, opFn) {
  const key = note.id;
  const previous = noteOpChains[key] || Promise.resolve();
  const run = previous.then(function () { return opFn(); });
  const tail = run.catch(function () { return null; });
  noteOpChains[key] = tail;
  tail.then(function () {
    if (noteOpChains[key] === tail) { delete noteOpChains[key]; }
  });
  return run;
}

function saveNoteToRepo(note, options) {
  /* Callers use saveNoteToRepo; the chain runs the worker below. */
  return chainNoteOp(note, function () {
    return saveNoteToRepoNow(note, options);
  });
}

/* --------------------------------------------------------------------------
   v2.69: bounded concurrency for the bulk operations.

   BULK_OP_CONCURRENCY is the stated bound: at most this many
   leaf operations (one note's move chain, one attachment
   copy, one note save, one body load) are in flight at once
   while a bulk operation runs. makeBulkPool is a counting
   semaphore: leaf work runs inside pool.run and never
   acquires a second slot, so the bound is a hard ceiling on
   the operation's simultaneous store requests, and no slot
   holder can deadlock waiting for another slot. Work that
   does no store requests of its own (assembling a duplicate
   from its copied parts, collecting a merge's sections)
   runs outside the pool and draws on it only through the
   leaves. The per note operation chains above are untouched:
   operations on the SAME note still serialize exactly as
   they always have; the pool only lets DIFFERENT notes'
   chains run side by side, which the chain discipline
   already allowed any caller to do.

   runPooledOutcomes runs a worker over items with the
   worker itself holding a slot, and resolves with every
   item's outcome in input order: a failure comes back as
   data the caller surfaces, never a silent drop.
   ------------------------------------------------------------------------ */
const BULK_OP_CONCURRENCY = 4;

function makeBulkPool(limit) {
  let active = 0;
  const waiters = [];
  function acquire() {
    if (active < limit) {
      active++;
      return Promise.resolve();
    }
    return new Promise(function (resolve) {
      waiters.push(function () {
        active++;
        resolve();
      });
    });
  }
  function release() {
    active--;
    const next = waiters.shift();
    if (next) { next(); }
  }
  return {
    run: async function (fn) {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    }
  };
}

async function runPooledOutcomes(pool, items, worker) {
  return Promise.all(items.map(function (item, index) {
    return pool.run(function () { return worker(item, index); })
      .then(function (value) {
        return { status: "fulfilled", value: value };
      }, function (reason) {
        return { status: "rejected", reason: reason };
      });
  }));
}

/* --------------------------------------------------------------------------
   v2.17.1: divergence, one conflict copy per episode

   The conflict rule above forks a copy when a save finds the file
   changed since the editor loaded it. Before this fix nothing
   healed the editor afterward: the note kept its stale storage
   revision, so the next autosave forked again, one copy per save,
   for as long as the user kept typing in that note on that device
   (seven copies of one note in four minutes of two device editing
   prompted this fix). The rule itself is unchanged; only the
   repetition is treated.

   A save that forks a copy (the pre-write revision check, the
   409/422 catch, or a queued offline write conflicting at flush
   time) marks the note diverged in the map below, after its one
   copy is written. While a note is marked:
   - saveNoteToRepoNow returns a paused result up front: no Drive
     write, no queue entry, no version capture, and the editor's
     in-memory content is left exactly as it stands;
   - flushQueue holds the note's queued content puts (its trash
     and archive move puts are exempt, as moves, exactly as in
     the flush conflict branch) instead of flushing them;
   - the conflict banner stays up with no auto hide, explains
     the pause, and offers Reload note.
   Reload (reloadDivergedNote) fetches the note's current file,
   swaps the parsed note into state with its fresh revision and
   a fresh last saved baseline, clears the mark and any held
   queued put for the note, and re-renders (opening the note
   when it is not the one on screen). Editing then saves against
   the current revision again. A genuinely new external change
   after that starts a new episode and earns its one new copy.
   Trash, archive, restore, unarchive, delete forever, and
   notebook moves clear the mark (they re-path the note with
   their own unconditional writes or remove it, so divergence
   is moot); sign out and Google disconnect clear all of it.
   The map and the banner pointer are plain session state: they
   live in memory only and never reach the cache or the store.

   v2.26: this machinery is now the FALLBACK, not the primary
   flow. When the decision chain judges a divergence genuine,
   saveLocalOverStoredRevision first preserves the stored
   version as the conflict copy and lands the local version on
   the original path, so an ordinary diverged save never marks
   anything and never pauses (see the v2.26 paragraph in
   saveNoteToRepoNow's header comment). The mark, the pause,
   the held queue puts, and Reload remain exactly as described
   above for the one case that still reaches them: the stored
   version could not be preserved, so the local version forked
   instead (saveConflictCopy) and the stored original was left
   untouched.
   -------------------------------------------------------------------------- */
const divergedNotes = new Map();   /* noteId -> { text } */
let conflictBannerNoteId = null;

function isNoteDiverged(noteId) {
  return divergedNotes.has(noteId);
}

/* Record a fresh divergence and put its banner up. Called only
   after the episode's one conflict copy is safely written. */
function markNoteDiverged(noteId, bannerText) {
  divergedNotes.set(noteId, { text: bannerText });
  showConflictBanner(bannerText, noteId);
}

/* Clear one note's mark. dropQueuedPuts is Reload's alone: the
   held queued writes for the note belong to the divergence and
   go with it. The move operations clear the mark WITHOUT
   dropping anything, because the entries they just queued are
   the move itself. When the banner pointed at this note, the
   banner follows whatever divergence remains (or hides). */
function clearNoteDivergence(noteId, dropQueuedPuts) {
  const wasMarked = divergedNotes.delete(noteId);
  if (dropQueuedPuts) {
    const kept = loadQueue().filter(function (op) {
      return !(op.kind === "put" && op.noteId === noteId);
    });
    saveQueue(kept);
  }
  if (conflictBannerNoteId === noteId) {
    conflictBannerNoteId = null;
    refreshConflictBanner();
  }
  return wasMarked;
}

/* Keep the banner pointed at a live divergence: if the note it
   named has resolved, repoint it at the most recently marked
   note still diverged, or hide it when none remain. */
function refreshConflictBanner() {
  if (conflictBannerNoteId && divergedNotes.has(conflictBannerNoteId)) {
    return;
  }
  if (!divergedNotes.size) { hideConflictBanner(); return; }
  let lastId = null;
  divergedNotes.forEach(function (entry, id) { lastId = id; });
  showConflictBanner(divergedNotes.get(lastId).text, lastId);
}

/* Session teardown (sign out, Google disconnect): every mark
   and the banner go together. */
function clearAllDivergenceState() {
  divergedNotes.clear();
  conflictBannerNoteId = null;
  hideConflictBanner();
}

/* Reload a diverged note from the store: the divergence's exit.
   The current file is fetched fresh and parsed into a new note
   object, which replaces the stale one in whichever list holds
   it; the fresh parse carries the current storage revision, and
   rememberLastSavedContent gives it a matching last saved
   baseline, so the next save compares like against like. The
   mark and any held queued put for the note clear with it.
   The user's divergent version is not lost by this: it is the
   conflict copy the episode already wrote. When the note is
   the one on screen, clearing renderEditor's marker makes the
   render refill the fields from the reloaded note; when it is
   not, the note opens. */
async function reloadDivergedNote(noteId) {
  const note = findNoteById(noteId);
  if (!note) { clearNoteDivergence(noteId, true); return; }
  let file = null;
  try {
    file = await storeGetFile(notePath(note));
  } catch (err) {
    toast("Reload failed: " + err.message, true);
    return;
  }
  if (!file) {
    /* The file itself is gone from the store (deleted on
       another device, say). Divergence over a missing file is
       moot: clear the pause and let a sync reconcile the list. */
    clearNoteDivergence(noteId, true);
    toast("That note is no longer in " + storageDisplayName() +
      ", so its pause is cleared.", true);
    if (storeSyncReady()) { syncNow(false); }
    return;
  }
  const parsed = parseNoteFile(file.text, file.token, note.id,
    note.trashed, note.archived);
  if (!parsed.notebook) { parsed.notebook = note.notebook; }
  const lists = [state.notes, state.trash, state.archive];
  for (const list of lists) {
    const at = list.findIndex(function (n) { return n.id === noteId; });
    if (at >= 0) { list[at] = parsed; break; }
  }
  rememberLastSavedContent(parsed);
  clearNoteDivergence(noteId, true);
  saveCache();
  if (state.selectedId === noteId) {
    renderEditor._forId = null;
    renderAll();
  } else {
    openNote(noteId);
  }
  /* renderAll recomputed the pill; if other notes are still
     diverged, the conflict state is still the honest one. */
  if (divergedNotes.size) { setSyncPill("bad", "Conflict saved"); }
  toast("Note reloaded from " + storageDisplayName() + ".");
}

/* v2.19: the tail of a save whose content is current in the
   store, shared by the ordinary landed write in
   saveNoteToRepoNow and by the silent adoption below:
   version history maintenance for the content that just
   became current (it runs when this save changed content,
   when a lowered limit is waiting to prune this note, or
   when the note's history is already loaded in this
   session), then the baseline and cache updates every
   landed save performs. Maintenance is fail soft by
   design: a history that cannot be loaded safely is left
   untouched, and the note save still stands. Returns the
   version status the save result carries. saveFacts is
   the bundle saveNoteToRepoNow computed before its write:
   {previousSavedContent, candidateContent,
   versionContentChanged, suppressVersionCapture}. */
async function finishLandedNoteSave(note, path, saveFacts) {
  let versionStatus = null;
  if (!saveFacts.suppressVersionCapture && saveFacts.previousSavedContent &&
      (saveFacts.versionContentChanged ||
       versionHistoryPruneNeeded.has(note.id) ||
       versionHistoryCache[note.id])) {
    const versionResult = await maintainVersionHistory(note.id,
      saveFacts.previousSavedContent, {
        contentChanged: saveFacts.versionContentChanged,
        notePath: path
      });
    versionStatus = versionResult.status;
    if (versionStatus !== "skipped-load" &&
        versionStatus !== "write-failed" &&
        versionStatus !== "delete-failed") {
      versionHistoryPruneNeeded.delete(note.id);
    }
    if (versionStatus === "skipped-load" ||
        versionStatus === "write-failed" ||
        versionStatus === "delete-failed" ||
        versionStatus === "skipped-conflict") {
      console.warn("Version history was not updated for note " +
        note.id + " (" + versionStatus + ").");
    }
  }
  rememberLastSavedSnapshot(note.id, saveFacts.candidateContent);
  saveCache();
  return versionStatus;
}

/* v2.19: when a save finds the file's revision advanced,
   the question that decides between a conflict copy and a
   quiet finish is whether the CONTENT actually differs.
   Through v2.18 the revision alone decided, so a session
   saving exactly the words already stored (an idle device
   holding the note open while another device saved the
   same text, an unconditional save of an untouched note, a
   write that raced an identical save in the gap) forked a
   conflict copy for a divergence that never happened.
   This helper asks the content question: it compares the
   freshly fetched stored file against the note being
   saved with noteContentEquivalent (bookkeeping fields
   excluded; raw bytes could never answer, since every
   save re-stamps the updated field before serializing).
   When the contents are equivalent, the fresh revision
   token is adopted into note.sha and the save completes
   as a silent success through the same landed tail an
   ordinary write runs: NO write of its own, NO copy, NO
   diverged mark, NO banner. When they genuinely differ,
   or the current file cannot be read, it returns null
   and the caller runs the unchanged keep both copies
   rule. prefetched is a storeGetFile result the caller
   may already hold (the pre-write check fetches it
   anyway); the write conflict catch passes null and the
   current file is fetched here. */
async function adoptStoredRevisionIfContentEqual(note, path, saveFacts,
    prefetched) {
  let fresh = prefetched || null;
  if (!fresh) {
    try {
      fresh = await storeGetFile(path);
    } catch (err) {
      return null;
    }
  }
  if (!fresh) { return null; }
  const stored = parseNoteFile(fresh.text, fresh.token, note.id,
    note.trashed, note.archived);
  if (!noteContentEquivalent(stored, note)) { return null; }
  note.sha = fresh.token;
  const versionStatus = await finishLandedNoteSave(note, path, saveFacts);
  return { saved: true, adopted: true, versionStatus: versionStatus };
}

/* v2.22: the baseline test's predicate, in the saveFacts
   shape: does the content this save is making current equal
   the baseline snapshot this session loaded (or last saved)
   the note at, in full (title, body, tags, attachment
   records, pin, thumbnail: the same fields
   noteMatchesLastSaved compares)? Bookkeeping fields are
   not content: updated is re-stamped by every save, the id
   and revision are the file's, and the notebook placement
   travels its own settle path. */
function saveFactsContentEqualsBaseline(saveFacts) {
  const baseline = saveFacts.previousSavedContent;
  const candidate = saveFacts.candidateContent;
  if (!baseline || !candidate) { return false; }
  return versionContentEqual(candidate, baseline) &&
    candidate.pinned === baseline.pinned &&
    candidate.thumbnail === baseline.thumbnail &&
    /* v2.35: the reminder pair joins the baseline verdict,
       with the same old baseline guard as
       noteMatchesLastSaved. */
    candidate.reminderAt === (baseline.reminderAt || null) &&
    candidate.reminderDoneAt === (baseline.reminderDoneAt || null);
}

/* v2.22: the ancestor test's reader: does a content snapshot
   canonically match ANY entry in the note's captured version
   history? Version entries carry title, body, tags, and
   attachment records (their four fields), and
   versionContentEqual compares exactly those, so a staged
   snapshot and a stored entry compare field for field with
   nothing left over. The history is read through the one
   existing loader (the History view's own), cache included;
   any failure to read it (a damaged history, a store error)
   answers false, and the caller falls through to the older
   rules: a history that cannot be read must never become a
   reason to fork OR to adopt on a guess. The check runs
   only on the mismatch path below, never on an ordinary
   save, so its cost stays bounded to saves that already
   know the file moved. */
async function noteContentMatchesVersionHistory(noteId, candidate) {
  if (!candidate) { return false; }
  let loaded;
  try {
    loaded = await loadVersionHistory(noteId);
  } catch (err) {
    return false;
  }
  if (!loaded || !loaded.ok || !loaded.data) { return false; }
  return (loaded.data.versions || []).some(function (entry) {
    return versionContentEqual(candidate, entry);
  });
}

/* v2.22: the mismatch decision chain, run at both of
   saveNoteToRepoNow's decision points (the pre-write
   revision comparison and the 409/422/StoreConflict catch)
   before anything may fork a conflict copy. v2.19 asked
   only whether the content being saved equals the CURRENT
   stored content; that cannot see the stale holder whose
   text is an older state of the same note (everything it
   holds is in the stored note's past, so it reads as
   "different" and forked, which is the 2026-10-22 Refresh
   incident). The question that actually decides a conflict
   is whether THIS session contributed anything the store
   does not already have, so the order is:
   (1) the baseline test: the content being saved equals
       the baseline this session loaded the note at, so the
       session made no edits at all since loading (typing
       that was never collected into the note is not a save
       and never reaches here; anything collected differs
       from baseline by construction). Nothing here is
       unique: adopt the current stored revision silently.
   (2) the ancestor test: the content matches a captured
       version history entry, so it is a state this note
       genuinely held before; whatever the store holds now
       grew from it or past it, and this session's copy of
       it carries no unique work either. Adopt silently.
   (3) the v2.19 content equality adoption, unchanged.
   Only when all three say no does the caller run the
   genuine rule (one copy, the mark, the pause).
   Adoption here means: the freshly fetched stored file's
   revision becomes note.sha, the note object itself takes
   the stored content (the model must describe the note as
   it now stands, or the note list would keep previewing
   the stale text and the model baseline pair would
   disagree), the baseline becomes the STORED content's
   snapshot (that is the note's last saved state now, and
   the landed tail's candidate baseline would misdescribe
   it), the cache is saved, and the result is the adoption
   shape the v2.19 path returns. No write, no copy, no
   mark, no banner, no pause, and no version maintenance:
   this session changed nothing, and the session that did
   change the note ran its own maintenance when its save
   landed. When the adopted note is the open one and the
   editor still shows exactly the content this save just
   adjudicated (the common case: an idle autosave debounce,
   a Refresh tap), the editor is refilled from the adopted
   content on the spot, the same clear the marker refill
   Reload uses; the sync load's own refill guard would
   otherwise read that editor as holding unsaved edits
   (it no longer matches the baseline the adoption just
   moved) and strand the stale text on screen. Typing that
   raced this save is left alone in the editor and simply
   becomes the next edit of the adopted note: that edit's
   own save captures the adopted content into the version
   history first, because the baseline is the stored
   snapshot, so nothing the store held is lost either
   way. */
async function adoptStoredRevisionOnMismatch(note, path, saveFacts,
    prefetched) {
  const contributedNothing = saveFactsContentEqualsBaseline(saveFacts);
  let matchesAncestor = false;
  if (!contributedNothing) {
    matchesAncestor = await noteContentMatchesVersionHistory(
      note.id, saveFacts.candidateContent);
  }
  if (!contributedNothing && !matchesAncestor) {
    return adoptStoredRevisionIfContentEqual(note, path, saveFacts,
      prefetched);
  }
  let fresh = prefetched || null;
  if (!fresh) {
    try {
      fresh = await storeGetFile(path);
    } catch (err) {
      fresh = null;
    }
  }
  if (!fresh) { return null; }
  const stored = parseNoteFile(fresh.text, fresh.token, note.id,
    note.trashed, note.archived);
  note.sha = fresh.token;
  /* Whether the open editor still shows exactly the
     adjudicated content decides the refill below, so it is
     read BEFORE the model swap (the swap does not touch the
     editor fields, but the comparison reads cleanest
     against the pre-adoption state). */
  let editorHoldsAdjudicated = false;
  if (state.selectedId === note.id && renderEditor._forId === note.id) {
    try {
      editorHoldsAdjudicated = versionContentEqual(
        editorContentSnapshot(note), saveFacts.candidateContent);
    } catch (err) {
      editorHoldsAdjudicated = false;
    }
  }
  note.title = stored.title;
  note.body = stored.body;
  note.tags = stored.tags.slice();
  note.attachments = sanitizeAttachments(
    cloneVersionValue(stored.attachments || []));
  note.pinned = stored.pinned;
  note.thumbnail = stored.thumbnail;
  /* v2.35: the stored version's reminder pair is adopted
     with its pin and thumbnail, the same stored fields. */
  note.reminderAt = stored.reminderAt;
  note.reminderDoneAt = stored.reminderDoneAt;
  note.updated = stored.updated;
  note.fileId = stored.fileId || note.fileId;
  note.bodyLoaded = true;
  rememberLastSavedSnapshot(note.id, noteContentSnapshot(stored));
  saveCache();
  if (editorHoldsAdjudicated) {
    renderEditor._forId = null;
    renderAll();
  }
  return { saved: true, adopted: true, versionStatus: null };
}

/* Save one note to the repo, with the critical conflict rule:
   BEFORE writing, fetch the file fresh and compare its sha with the sha
   the editor loaded. If they differ, someone (or another device) changed
   the note first. A 409 or 422 from the PUT is handled the same way.
   Nothing is ever silently overwritten: a stored version is only ever
   replaced once a copy of it exists (see the v2.26 paragraph below).
   v2.17.1: a save that forks a copy also marks the note diverged
   (see the divergence block above), so its later saves pause
   instead of forking a copy per save. Since v2.26 that fork is
   the fallback; the primary flow is the inversion below.
   v2.19: a differing sha is a question, not a verdict: at both
   decision points (the pre-write comparison and the 409/422
   catch) the freshly fetched stored content is compared
   against the content being saved first, and identical
   content adopts the fresh revision silently instead of
   forking a copy (see adoptStoredRevisionIfContentEqual).
   v2.22: the verdict now comes from the decision chain in
   adoptStoredRevisionOnMismatch (baseline test, ancestor
   test, then the v2.19 content equality), because equality
   with the current content cannot acquit a stale holder
   whose text is an older state of the same note; and saves
   marked ambient return before any of this when the note
   still equals its baseline (see the ambient gate below).
   v2.26: when the chain judges the divergence genuine, the
   fork direction inverts (saveLocalOverStoredRevision):
   the freshly fetched STORED version is written out as the
   new note titled "<stored title> (conflict copy)" first,
   and only once that write lands does this save take the
   original path as an ordinary landed save, with the stored
   version also captured into the note's version history.
   The note being edited is never forked, marked, or paused
   on this path, and a toast names the kept copy. If the
   stored version cannot be preserved, the save falls back
   to the pre-v2.26 behavior exactly (saveConflictCopy: the
   local version forks, the note is marked and paused). The
   flushQueue conflict branch inverts the same way, with the
   same fallback.
   When offline, the write is queued instead and the note keeps a dirty
   marker in the cache.
   This is the worker behind saveNoteToRepo above, which serializes
   calls per note through the operation chain. Callers use
   saveNoteToRepo. */
/* --------------------------------------------------------------------------
   v2.24.9: attachment record reconciliation at save time

   The card thumbnail resolves from the note's attachment
   RECORDS (cardThumbnailAttachment: the chosen thumbnail
   record when it is still among the note's attachments,
   else the first record), never from the body. A record
   was dropped, and a dangling thumbnail choice cleared,
   only inside the undoable delete completion (the tail of
   firePendingAttachmentDelete), after the undo window and
   a successful cloud delete. Any removal whose completion
   step never ran to the end (the app closed or reloaded
   inside the undo window, the note saved through another
   path first, a sync landing from another device) left
   an orphaned record in the saved note indefinitely, and
   the card kept showing an image the note no longer
   contains. Nothing ever rechecked the records against
   the body afterward.

   The audit behind this build: every path that creates a
   record pairs it with a block in the body. The editor
   insert, the file paste, the drag and drop, and the
   voice note flows all run through uploadOneAttachment,
   which puts the .ss-attachment block into the body
   BEFORE the upload and pushes the record only on
   success; a failed upload removes the block and pushes
   nothing. The drop box import of an object entry
   uploads each carried file and appends the new record's
   shell to the body in the same step (and plain entries
   have foreign records stripped, never created). The
   Word import pre places its image placeholders and
   pushes a record only for an upload that landed,
   removing the placeholder of one that did not. A
   version restore applies the version's body and its
   records together, out of the one snapshot they were
   captured in. The image editor's annotate and crop
   replace mutates the record in place, under the same
   id and block. So a record with no block in the
   canonical body is always damage, never a legitimate
   state, and the funnel below repairs it: drop the
   record, and clear a thumbnail choice that named it
   (or names no surviving record).

   The hook sits in saveNoteToRepoNow, the one funnel
   every content save passes through, after the catalog
   shell completion and before the ambient gate and the
   save facts, under three exclusions:
     - a note that ENTERED the funnel as a catalog shell
       is not reconciled by the save that completed it:
       its body became authoritative only by being
       fetched here, and repair belongs to a save of the
       note as this session already holds it loaded
       (opening it loads it; any later save reconciles);
     - Trash and Archive notes are never reconciled
       here: their views are read only, and the repair
       of a live note's damage is not theirs to make;
     - a record with a deletion pending in the undo
       engine is owned by that flow: its block is out of
       the body by design for the whole undo window (the
       engine counts on the record, and the thumbnail
       choice, surviving exactly those saves), and Undo
       must find both untouched.

   Baseline consistency (the v2.19 / v2.22 machinery):
   the repair is applied to the note AND, computed
   against the baseline's OWN saved body, to the last
   saved baseline snapshot, before the ambient gate or
   any save fact reads either one. The baseline is the
   record of the same saved state the damage lives in,
   so repairing it by the same rule keeps every equality
   the machinery computes (the untouched note gate, the
   mismatch chain's baseline test, the save facts'
   content snapshots) seeing the repair on both sides of
   the comparison: it can never read as this session's
   edit, never provoke a conflict fork, and a landed save
   carries the repaired note and the repaired baseline
   forward together. The catalog rides the same save
   (saveCache schedules its writer, which snapshots the
   note object when it runs), so the corrected
   cardAttachment is written by the save that healed
   the note.
   -------------------------------------------------------------------------- */

/* The attachment ids that carry a block in one body HTML
   string, read the way canonicalizeAttachmentPlaceholders
   reads them: the .ss-attachment placeholders and their
   data-attachment-id values. */
function attachmentBlockIdsInBody(bodyHtml) {
  const ids = {};
  if (!bodyHtml) { return ids; }
  const holder = document.createElement("div");
  holder.innerHTML = bodyHtml;
  holder.querySelectorAll(".ss-attachment").forEach(function (el) {
    const id = el.getAttribute("data-attachment-id");
    if (id) { ids[id] = true; }
  });
  return ids;
}

/* The repair itself, over one { attachments, thumbnail }
   field pair against one body: drop every record whose
   id has no block in the body and no deletion pending
   for noteId, then clear a thumbnail that names no
   surviving record. Mutates the pair and returns true
   when anything changed. Shared by the note and, against
   its own saved body, the note's baseline snapshot, so
   both sides of every comparison in the save machinery
   are repaired by exactly the same rule. */
function reconcileAttachmentFields(fields, bodyHtml, noteId) {
  if (!fields) { return false; }
  const atts = Array.isArray(fields.attachments)
    ? fields.attachments : [];
  let changed = false;
  if (atts.length) {
    const blockIds = attachmentBlockIdsInBody(bodyHtml);
    const kept = atts.filter(function (a) {
      return blockIds[a.id] ||
        pendingAttachmentDeletes.has(
          pendingDeleteKey({ id: noteId }, a));
    });
    if (kept.length !== atts.length) {
      fields.attachments = kept;
      changed = true;
    }
  }
  const thumb = fields.thumbnail || null;
  if (thumb && !(fields.attachments || []).some(function (a) {
        return a.id === thumb;
      })) {
    fields.thumbnail = null;
    changed = true;
  }
  return changed;
}

/* Reconcile one loaded note at save time (see the
   section comment above), and its last saved baseline
   with it. Never runs on a shell: a note whose body is
   not loaded has no authoritative body to reconcile
   against. Returns true when the note itself changed. */
function reconcileNoteAttachments(note) {
  if (!note || note.bodyLoaded === false) { return false; }
  const changed = reconcileAttachmentFields(note, note.body, note.id);
  const baseline = lastSavedContentByNoteId[note.id];
  if (baseline) {
    reconcileAttachmentFields(baseline, baseline.body, note.id);
  }
  return changed;
}

async function saveNoteToRepoNow(note, options) {
  options = options || {};
  /* v2.24.9: whether the note entered this save already
     holding its body on this device. The shell completion
     below makes a shell's body authoritative by fetching
     it, but the attachment reconciliation further down
     deliberately does not run for a note that entered as
     a shell (see the v2.24.9 section above): repair
     belongs to saves of a note this session already
     holds loaded. */
  const enteredAsShell = note.bodyLoaded === false;
  /* v2.17.1: a diverged note's saves pause (see the divergence
     block above). The check sits ahead of every branch, online
     and offline alike, so a paused save neither writes, nor
     queues, nor captures a version, and the editor's in-memory
     content is left exactly as it stands. The deliberate
     conflict check bypasses (fresh creates, which mint a new id
     that can never be marked) keep their exemption. */
  if (!options.skipConflictCheck && isNoteDiverged(note.id)) {
    setSyncPill("bad", "Conflict saved");
    return { paused: true, diverged: true };
  }
  /* v2.20: a save serializes the note's body, so a catalog shell
     (body not on this device yet) is completed first, through
     the same single fetch opening it would have made. If the
     fetch cannot complete the note (offline, signed out), the
     save fails honestly here rather than writing an empty body
     over the stored note. Fresh creates mint their note in
     memory and are never shells, so they pass straight through. */
  if (note.bodyLoaded === false) {
    await ensureNoteBodyLoaded(note);
    if (note.bodyLoaded === false) {
      throw new Error("The note's content is not loaded on this " +
        "device yet, so it cannot be saved.");
    }
  }
  /* v2.24.9: attachment record reconciliation (see the
     section above this function). Runs after the shell
     completion, before the ambient gate and the save
     facts, so the gate and every comparison below see
     the note and its baseline already repaired, on both
     sides alike. A note that entered as a shell, and
     Trash and Archive notes, are excluded (the section
     comment gives the reasons). */
  if (!enteredAsShell && !note.trashed && !note.archived) {
    reconcileNoteAttachments(note);
  }
  /* v2.22: the ambient save gate. A save marked ambient
     (options.ambient) exists only to persist whatever the
     session currently holds; no discrete user mutation stands
     behind it. Refresh connection's pre refresh save of the
     open note is the caller: through v2.21 it ran ungated, so
     a device merely holding a note open with a stale revision
     (an iPad asleep since last night, say) ran the full write
     path on Refresh and forked a conflict copy of text it had
     never edited. The v2.19 gate covered the editor autosave
     at its caller; this is the same predicate
     (noteMatchesLastSaved: the full snapshot against the last
     saved baseline) enforced in the worker for every ambient
     caller, present and future: when the note still equals
     its baseline, an ambient save writes nothing, queues
     nothing, captures no version, and reports itself saved
     and unchanged. Deliberate saves never pass the flag: a
     pin toggle, a tag or title edit, a checklist toggle, an
     attachment change, a move, a restore all mutate the note
     before saving, so their content differs from baseline
     and they write exactly as before (a baseline equal
     deliberate save has nothing to persist either, but no
     deliberate caller is ever gated, so none can be
     swallowed by construction). A note with no baseline (a
     first save) is never gated. The gate sits ahead of the
     updated re-stamp below so an unchanged note keeps its
     stored timestamps untouched. */
  if (options.ambient && noteMatchesLastSaved(note)) {
    return { saved: true, unchanged: true };
  }
  /* v2.121: a Doc-backed note saves into its Google Doc
     (see saveDocBackedNote below) and never touches the
     file machinery under this line: no note file is
     serialized, no revision check runs against a file,
     no version is captured (the Doc keeps its own
     revision history in Google Docs). The branch sits
     after the divergence pause, the shell completion, the
     attachment reconciliation, and the ambient gate, so
     those standing behaviors hold for Doc-backed notes
     exactly as they do for file notes. */
  if (isDocBackedNote(note)) {
    return saveDocBackedNote(note, options);
  }
  /* v2.8: capture the version history facts BEFORE anything in
     this save can move them. previousSavedContent is the note's
     last saved state, held in the baseline map precisely because
     callers have already mutated the note object by the time this
     runs; candidateContent is the state this save is about to make
     current. History maintenance runs only after the note write
     itself has landed (or been durably queued), inside this same
     per note chain step, so a version is never written for a save
     that failed, and never ahead of the save it belongs to.
     options.suppressVersionCapture is the restore flow's flag: it
     has already preserved the pre restore state itself. */
  const previousSavedContent = lastSavedContentByNoteId[note.id]
    ? cloneVersionValue(lastSavedContentByNoteId[note.id]) : null;
  const candidateContent = noteContentSnapshot(note);
  const versionContentChanged = !!previousSavedContent &&
    !versionTextContentEqual(previousSavedContent, candidateContent);
  const suppressVersionCapture = !!options.suppressVersionCapture;
  /* v2.19: the facts the landed tail and the silent
     adoption share, bundled once (see finishLandedNoteSave
     and adoptStoredRevisionIfContentEqual above). */
  const saveFacts = {
    previousSavedContent: previousSavedContent,
    candidateContent: candidateContent,
    versionContentChanged: versionContentChanged,
    suppressVersionCapture: suppressVersionCapture
  };
  note.updated = new Date().toISOString();
  const path = notePath(note);
  const text = serializeNote(note);

  /* v2.22: every queued form of this save (the offline branch
     below and the two queueing catches further down) goes
     through this one builder, which stamps the op with the
     baseline verdict while the baseline still exists:
     contentEqualsBaseline says the content being queued
     equals the baseline this session loaded the note at, so
     the save contributed nothing since loading and its flush
     must never fork a copy for it (see the flush conflict
     branch in flushQueue, where the baseline itself is long
     advanced and only this recorded verdict survives).
     Genuine edits never carry the flag: their content
     differs from baseline by construction. */
  const queueNotePut = function () {
    const op = { kind: "put", path: path, content: text, noteId: note.id };
    if (saveFactsContentEqualsBaseline(saveFacts)) {
      op.contentEqualsBaseline = true;
    }
    queueOp(op);
  };

  if (!state.online) {
    queueNotePut();
    /* v2.8: the matching history entry queues immediately behind
       the note write it belongs to (see flushVersionHistoryOp). A
       first save has no previous state and queues nothing. */
    if (!suppressVersionCapture && previousSavedContent &&
        (versionContentChanged || versionHistoryPruneNeeded.has(note.id))) {
      queueVersionHistoryMaintenance(note.id, path, previousSavedContent,
        candidateContent, { verifyExpected: true });
      versionHistoryPruneNeeded.delete(note.id);
    }
    rememberLastSavedSnapshot(note.id, candidateContent);
    saveCache();
    return { queued: true };
  }

  try {
    let shaToUse = note.sha || null;
    if (shaToUse && !options.skipConflictCheck) {
      const fresh = await storeGetFile(path);
      if (fresh && fresh.token !== shaToUse) {
        /* v2.19: the revision advanced; ask the content
           question before forking anything. Identical
           content is an echo, not a divergence: adopt the
           fresh token and finish silently. Genuinely
           different content keeps the rule below.
           v2.22: the question is now the full mismatch
           decision chain (adoptStoredRevisionOnMismatch):
           the baseline and ancestor tests run ahead of the
           v2.19 content equality step, so a session that
           contributed nothing since loading, or one holding
           only a state this note already held, adopts the
           fresh revision silently instead of forking. */
        const adopted = await adoptStoredRevisionOnMismatch(
          note, path, saveFacts, fresh);
        if (adopted) { return adopted; }
        /* v2.26: the divergence is genuine; invert the fork
           (preserve the stored version as the copy, land this
           save on the original path). A null return means the
           stored version could not be preserved, and the
           pre-v2.26 fork below runs as the fallback. */
        const inverted = await saveLocalOverStoredRevision(
          note, path, text, saveFacts, fresh);
        if (inverted) { return inverted; }
        return await saveConflictCopy(note, path);
      }
      if (!fresh) { shaToUse = null; }
    }
    /* v1.4.4: options.fresh (set only by createNoteInRepo for a brand
       new note) is passed through to the store layer, where the Drive
       driver uses it to skip its existence check listing and create
       the file directly. The driver itself refuses the shortcut
       whenever an expected token is held, so updates always stay on
       the checked path. */
    const newSha = await storePutFile(path, text, shaToUse,
      (shaToUse ? "Update note " : "Create note ") + note.id,
      { fresh: !!options.fresh });
    note.sha = newSha;
    /* v2.8: the note write landed, so its history maintenance
       may run (inside finishLandedNoteSave, the landed tail
       this write and the v2.19 silent adoption share). */
    const versionStatus = await finishLandedNoteSave(note, path,
      saveFacts);
    return { saved: true, versionStatus: versionStatus };
  } catch (err) {
    if (isStoreConflict(err) || err.status === 409 || err.status === 422) {
      /* v2.19: the write raced a change in the gap since the
         pre-write check; ask the content question here too
         before forking. The file may have advanced to
         exactly the content this save carries (another
         session saving the same words), which adopts
         silently like the pre-write echo. A failed fetch or
         genuinely different content falls through to the
         keep both copies rule, unchanged.
         v2.22: the same full decision chain as the pre-write
         point runs here (adoptStoredRevisionOnMismatch):
         baseline test, ancestor test, then content equality. */
      const adopted = await adoptStoredRevisionOnMismatch(
        note, path, saveFacts, null);
      if (adopted) { return adopted; }
      /* v2.26: the same inversion as the pre-write point;
         the helper fetches the current file itself here. A
         null return falls back to the pre-v2.26 fork, exactly
         as at the pre-write point. */
      const inverted = await saveLocalOverStoredRevision(
        note, path, text, saveFacts, null);
      if (inverted) { return inverted; }
      return await saveConflictCopy(note, path);
    }
    if (err.needsGoogleReconnect) {
      /* v1.4: an expired Google sign in must never lose an edit. The
         complete note text joins the same offline queue used for network
         outages, and flushQueue retries it after the next sign in. */
      queueNotePut();
      /* v2.8: the history entry for this queued save queues behind
         it, exactly as in the offline branch below. */
      if (!suppressVersionCapture && previousSavedContent &&
          (versionContentChanged || versionHistoryPruneNeeded.has(note.id))) {
        queueVersionHistoryMaintenance(note.id, path, previousSavedContent,
          candidateContent, { verifyExpected: true });
        versionHistoryPruneNeeded.delete(note.id);
      }
      rememberLastSavedSnapshot(note.id, candidateContent);
      saveCache();
      toast("Your Google sign in expired. This edit was saved in the sync " +
        "queue. Use Refresh connection in Settings to reconnect, " +
        "then use Sync now if it does not sync on its own.", true);
      return { queued: true, googleReconnect: true };
    }
    if (err.offline || !state.online) {
      queueNotePut();
      if (!suppressVersionCapture && previousSavedContent &&
          (versionContentChanged || versionHistoryPruneNeeded.has(note.id))) {
        queueVersionHistoryMaintenance(note.id, path, previousSavedContent,
          candidateContent, { verifyExpected: true });
        versionHistoryPruneNeeded.delete(note.id);
      }
      rememberLastSavedSnapshot(note.id, candidateContent);
      saveCache();
      return { queued: true };
    }
    throw err;
  }
}

/* v2.121: the Doc-backed save, called from
   saveNoteToRepoNow under the per note chain, so it
   inherits the chain's serialization like every save.
   The note's content goes back into its own Google Doc
   (created here first when the note is new and has none
   yet), the Doc's new revision token becomes the note's
   sha, and the note's last saved baseline and the catalog
   pick the landed state up exactly as a file save's tail
   leaves them. There is deliberately no offline queue
   for this shape: a Doc lives behind a live connection,
   so an offline save fails with a plain message and the
   editor keeps the words on screen, where the standing
   dirty state will offer them again. App version history
   is not captured for Doc-backed notes: the Doc keeps
   its own revisions in Google Docs (a named Stage 3
   boundary). A failure of any step (including the Doc
   module's needs-consent state) throws, and the callers
   treat it exactly like a failed file save. */
async function saveDocBackedNote(note, options) {
  if (typeof state !== "undefined" && state.online === false) {
    throw new Error("This note is stored as a Google Doc" +
      " and needs a connection to save. Your words are" +
      " still in the editor.");
  }
  note.updated = new Date().toISOString();
  const candidateContent = noteContentSnapshot(note);
  if (!sanitizeDocId(note.docId)) {
    const created = await docCreateDocument(note);
    note.docId = created.id;
    note.docName = note.title || "";
  }
  const uploadHtml = await docBuildUploadHtml(note);
  const saved = await docSaveDocument(note, uploadHtml, {
    checklist: docUploadChecklistCount(uploadHtml) > 0
  });
  note.sha = saved.token || note.sha;
  /* v2.127: the modified time this body was saved at
     rides beside the token, so the near-live poll does
     not read the app's own save as an outside change. */
  if (saved.modifiedTime) {
    note.docModifiedTime = saved.modifiedTime;
  }
  /* v2.128: the tick memory is recomputed from the body
     this save just wrote and stands on the note, where
     the catalog write this save's saveCache schedules
     picks it up (buildCatalogEntry). A body with no
     checked box clears the record outright, so a note
     whose last tick was unticked in the app does not
     keep a stale memory. */
  note.docTicks = docTicksFromBody(note.body);
  rememberLastSavedSnapshot(note.id, candidateContent);
  saveCache();
  /* v2.123: a Doc note's identity settles inside this
     save: a created note's Doc ID lands above, after
     the editor render that opened it, so the open
     note's near-live poll re-judges here as well as at
     every editor render (refreshDocLivePoll, media.js).
     For a note already polling this is a no-op; for a
     just created one it is the moment polling can
     start. */
  refreshDocLivePoll();
  return { saved: true, doc: true };
}

/* v2.26: the inverted conflict resolution, the PRIMARY flow
   when the decision chain (adoptStoredRevisionOnMismatch)
   has judged a divergence genuine. Through v2.25.1 the
   version being edited was forked as the "(conflict copy)"
   and the note in front of the user was marked diverged and
   paused behind a Reload banner. For a single user whose
   note changed elsewhere while he was typing in it (an
   outside edit landing behind the app, a second device
   signed in but idle), that froze the note he was actively
   working in and moved his work into a copy he then had to
   find and keep using, where the next outside change could
   fork it again (2026-10-26: one checklist note became
   four same title notes in a single morning). The
   inversion keeps both versions with the roles swapped:
   the version already in the store is written out as the
   "(conflict copy)" FIRST, and only once that write has
   landed does the local version take the original path as
   an ordinary landed save, so the editing session never
   stops and never moves. Returns the landed result on
   success, or null when the stored version could not be
   preserved (its fetch or its copy write failed) or the
   local write itself was refused with a store conflict;
   the caller then runs the pre-v2.26 behavior
   (saveConflictCopy: the local version forks, the note is
   marked and paused) rather than ever overwriting a
   version no copy of exists yet. Any other failure of the
   local write throws, into the same handling the write
   itself would have met. */
async function saveLocalOverStoredRevision(note, path, text,
    saveFacts, prefetched) {
  let fresh = prefetched || null;
  if (!fresh) {
    try {
      fresh = await storeGetFile(path);
    } catch (err) {
      return null;
    }
  }
  if (!fresh) { return null; }
  const stored = parseNoteFile(fresh.text, fresh.token, note.id,
    note.trashed, note.archived);
  /* The copy IS the stored version, so its title, tags,
     body, attachment records, and thumbnail come from the
     stored parse: titles can differ when this session
     renamed the note, and the copy must be findable as the
     version that was in the store, under the name that
     version carried. Its placement mirrors the note being
     saved (the same notebook; the same Trash or Archive
     list when the note lives there, through notePath), its
     created stamp is now, and it starts unpinned, exactly
     as the pre-v2.26 conflict copies were stamped. */
  const copy = {
    id: newNoteId(),
    title: (stored.title || "Untitled note") + " (conflict copy)",
    notebook: note.notebook,
    tags: (stored.tags || []).slice(),
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    pinned: false,
    body: stored.body,
    bodyLoaded: true,  /* v2.20: a made note's body is right here */
    previewText: null, /* v2.20: only catalog shells use this field */
    /* The copy references the same attachment records as
       the stored version, so a thumbnail choice carries
       over and still resolves: the same record sharing the
       pre-v2.26 copies used, in the other direction. */
    attachments: sanitizeAttachments(stored.attachments),
    thumbnail: stored.thumbnail || null,
    /* v2.35: the stored version's reminder pair carries
       over with its thumbnail, so the preserved version
       keeps the reminder it had. */
    reminderAt: stored.reminderAt || null,
    reminderDoneAt: stored.reminderDoneAt || null,
    sha: null,
    fileId: null,      /* v2.20: assigned by a later load */
    trashed: !!note.trashed,
    trashedFrom: note.trashedFrom || null,
    archived: !!note.archived,        /* v1.5 */
    archivedFrom: note.archivedFrom || null
  };
  try {
    copy.sha = await storePutFile(notePath(copy), serializeNote(copy),
      null, "Preserve stored version of " + note.id);
  } catch (err) {
    return null;
  }
  /* v2.8: the copy's content is now its last saved state. */
  rememberLastSavedContent(copy);
  if (copy.trashed) { state.trash.push(copy); }
  else if (copy.archived) { state.archive.push(copy); }
  else { state.notes.push(copy); }
  /* The stored version is preserved, so the local save may
     take the original path: adopt the fresh revision (the
     pre-write check's own token at that decision point, a
     token fetched here at the catch point) and write with
     it, on the checked update path as always. */
  note.sha = fresh.token;
  let newSha = null;
  try {
    newSha = await storePutFile(path, text, fresh.token,
      "Update note " + note.id);
  } catch (err) {
    if (isStoreConflict(err) || err.status === 409 ||
        err.status === 422) {
      return null;
    }
    throw err;
  }
  note.sha = newSha;
  const versionStatus = await finishLandedNoteSave(note, path,
    saveFacts);
  /* The stored version also belongs in this note's own
     version history, as the state this save replaced. The
     landed tail above captures only the session baseline
     (saveFacts.previousSavedContent), which is an older
     state than the stored version whenever an outside edit
     is what advanced the file; without this capture the
     history would jump from the baseline straight to the
     local content, and the stored words would survive only
     in the copy. forceSnapshot, because the tail's own
     capture a moment earlier starts the coalescing window
     this one must not be merged into. Fail soft, exactly
     as the tail's own maintenance is: the save stands
     either way. Skipped when the caller suppressed version
     capture (the restore flow preserves its own states). */
  if (!saveFacts.suppressVersionCapture) {
    const storedResult = await maintainVersionHistory(note.id,
      noteContentSnapshot(stored), {
        forceSnapshot: true,
        contentChanged: true,
        notePath: path
      });
    if (storedResult.status === "skipped-load" ||
        storedResult.status === "write-failed" ||
        storedResult.status === "delete-failed" ||
        storedResult.status === "skipped-conflict") {
      console.warn("Version history was not updated with the " +
        "stored version for note " + note.id + " (" +
        storedResult.status + ").");
    }
  }
  saveCache();
  renderAll();
  setSyncPill("ok", "Saved; copy kept");
  toast("This note also changed elsewhere, so that version was " +
    "kept as \"" + copy.title + "\" and your version stayed here.");
  return { saved: true, versionStatus: versionStatus,
    keptStoredCopy: copy };
}

/* The conflict copy path of the rule above, as the FALLBACK
   since v2.26: write the local version as a brand new note
   file with a new id, register it in state, tell the user
   with the banner and a toast, and return a conflict result
   so the editor can show "Conflict saved" in the sync pill.
   This runs only when the stored version could not be
   preserved by saveLocalOverStoredRevision (the primary
   flow, above): a version is never overwritten without a
   copy of it existing first, so when the stored version
   cannot be copied out, the local version forks instead
   and the original is left untouched in the store. */
async function saveConflictCopy(note, originalPath) {
  const copy = {
    id: newNoteId(),
    title: (note.title || "Untitled note") + " (conflict copy)",
    notebook: note.notebook,
    tags: note.tags.slice(),
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    pinned: false,
    body: note.body,
    attachments: sanitizeAttachments(note.attachments),   /* v1.2 */
    /* v2.11: the copy references the same attachment records, so a
       thumbnail choice carries over and still resolves. */
    thumbnail: note.thumbnail || null,
    /* v2.35: the local version's reminder pair carries over
       with its thumbnail, so the forked version loses nothing. */
    reminderAt: note.reminderAt || null,
    reminderDoneAt: note.reminderDoneAt || null,
    sha: null,
    trashed: false,
    trashedFrom: null,
    archived: false,        /* v1.5 */
    archivedFrom: null      /* v1.5 */
  };
  const copyPath = "notebooks/" + copy.notebook + "/" + copy.id + ".md";
  copy.sha = await storePutFile(copyPath, serializeNote(copy), null,
    "Save conflict copy of " + note.id);
  /* v2.8: the copy's content is now its last saved state. The
     original note keeps its own baseline: its stored content was
     not replaced by this save, so no version is captured for it. */
  rememberLastSavedContent(copy);
  state.notes.push(copy);
  saveCache();
  renderAll();
  /* v2.17.1: the copy is written, so the episode is complete;
     mark the original diverged so its later saves pause instead
     of forking a copy per save, and put the persistent banner
     up (the mark owns the banner now, not the twelve second
     timer). The toast and the pill are exactly as before. */
  markNoteDiverged(note.id,
    "This note changed somewhere else before your edit saved, so your version " +
    "was kept as a separate note: \"" + copy.title + "\". Nothing was overwritten. " +
    "Saving of this note is now paused, so no more copies pile up; use Reload " +
    "note to load the current version and keep editing it.");
  setSyncPill("bad", "Conflict saved");
  toast("Conflict: your version was saved as \"" + copy.title + "\".", true);
  return { conflict: true, copy: copy };
}

/* Show the conflict banner. v2.17.1: with a noteId the banner
   is that note's divergence banner: it carries the Reload note
   button and NEVER auto hides while the divergence stands (the
   timer is cleared and none is armed; showConflictBanner._timer
   stays null, which the harness asserts). Without a noteId the
   banner keeps its original behavior, a twelve second showing. */
function showConflictBanner(text, noteId) {
  const banner = document.getElementById("conflictBanner");
  const textEl = banner.querySelector(".conflict-text");
  if (textEl) { textEl.textContent = text; }
  else { banner.textContent = text; }
  const reloadBtn = document.getElementById("conflictReloadBtn");
  if (reloadBtn && !reloadBtn._wired) {
    reloadBtn._wired = true;
    reloadBtn.addEventListener("click", function () {
      if (conflictBannerNoteId) {
        reloadDivergedNote(conflictBannerNoteId);
      }
    });
  }
  clearTimeout(showConflictBanner._timer);
  showConflictBanner._timer = null;
  banner.classList.remove("hidden");
  if (noteId) {
    conflictBannerNoteId = noteId;
    if (reloadBtn) { reloadBtn.classList.remove("hidden"); }
  } else {
    conflictBannerNoteId = null;
    if (reloadBtn) { reloadBtn.classList.add("hidden"); }
    showConflictBanner._timer = setTimeout(function () {
      banner.classList.add("hidden");
    }, 12000);
  }
}

function hideConflictBanner() {
  const banner = document.getElementById("conflictBanner");
  clearTimeout(showConflictBanner._timer);
  showConflictBanner._timer = null;
  banner.classList.add("hidden");
  conflictBannerNoteId = null;
  const reloadBtn = document.getElementById("conflictReloadBtn");
  if (reloadBtn) { reloadBtn.classList.add("hidden"); }
}

/* Flush the offline queue, oldest first. A queued put re-checks the file
   sha at flush time: if the file moved on while we were offline, the
   queued content becomes a conflict copy file instead of overwriting,
   keeping the same never-overwrite rule for offline edits. Failures stop
   the flush and keep the rest of the queue for the next attempt. */
async function flushQueue() {
  let queue = loadQueue();
  if (!queue.length || !state.online) { return; }
  const remaining = [];
  let failed = false;
  for (const op of queue) {
    if (failed) { remaining.push(op); continue; }
    try {
      if (op.kind === "put") {
        /* v2.17.1: a content put for a note already marked
           diverged is held, not flushed: flushing it would
           either fork another copy or overwrite, and Reload
           clears held entries when the divergence resolves.
           The note's trash and archive puts are moves, exempt
           exactly as in the conflict branch below; their
           operations clear the mark before they ever queue. */
        if (op.noteId && isNoteDiverged(op.noteId) &&
            !op.path.startsWith("trash/") &&
            !op.path.startsWith("archive/")) {
          remaining.push(op);
          continue;
        }
        const existing = await storeGetFile(op.path);
        const localNote = findNoteById(op.noteId);
        const loadedSha = localNote ? localNote.sha : null;
        /* v2.19: a queued put whose content the store already
           holds is neither a conflict nor a write: the change
           it carries has landed by another path, or was never
           a change at all (an untouched note saved while
           offline, say). It is consumed quietly and the
           stored revision adopted, where through v2.18 the
           same entry either overwrote the file with identical
           bytes or, when this session's revision had drifted,
           forked a conflict copy for a divergence that never
           happened. The comparison is the save path's content
           equivalence, the queued text against the stored
           text: never against this session's baseline, which
           the queueing save itself already advanced past the
           queued content. Trash and archive puts are moves
           and stay exempt, exactly as in the conflict branch
           below. */
        let putAlreadyLanded = false;
        if (existing && op.noteId &&
            !op.path.startsWith("trash/") &&
            !op.path.startsWith("archive/")) {
          const storedParsed = parseNoteFile(existing.text,
            existing.token, op.noteId, false);
          const queuedParsed = parseNoteFile(op.content, null,
            op.noteId, false);
          if (noteContentEquivalent(storedParsed, queuedParsed)) {
            putAlreadyLanded = true;
            if (localNote && notePath(localNote) === op.path) {
              localNote.sha = existing.token;
            }
          }
        }
        /* v2.22: the no unique work tests, applied at exactly
           the fork branch's own precondition (the store holds
           the file, this session's loaded revision differs
           from the stored one, and the put is a content put,
           not a move). The baseline test reaches flush in its
           queue time form: the save that queued this put
           recorded contentEqualsBaseline on the op when its
           content still equaled the baseline it loaded at,
           because by flush time this session's baseline map
           has long advanced past the queued content and the
           recorded verdict is the only honest witness left.
           Failing that, the ancestor test: queued content
           matching a captured version history entry is a
           state this note genuinely held, so it carries no
           unique work either. A put passing either test is
           consumed exactly like the landed one above (the
           stored revision adopted, nothing written, nothing
           forked, no mark); a put passing neither forks
           below, unchanged, which is what a genuine offline
           edit that collided still earns. Ops queued by
           older builds carry no flag and simply face the
           ancestor test and the old rules. */
        let putMadeNoEdits = false;
        if (!putAlreadyLanded && existing && loadedSha &&
            existing.token !== loadedSha &&
            !op.path.startsWith("trash/") &&
            !op.path.startsWith("archive/")) {
          if (op.contentEqualsBaseline) {
            putMadeNoEdits = true;
          } else {
            const queuedParsed = parseNoteFile(op.content, null,
              op.noteId, false);
            putMadeNoEdits = await noteContentMatchesVersionHistory(
              op.noteId, noteContentSnapshot(queuedParsed));
          }
          if (putMadeNoEdits && localNote &&
              notePath(localNote) === op.path) {
            localNote.sha = existing.token;
          }
        }
        if (putAlreadyLanded || putMadeNoEdits) {
          /* Consumed: nothing written, nothing forked. */
        } else if (existing && loadedSha && existing.token !== loadedSha &&
            !op.path.startsWith("trash/") &&
            !op.path.startsWith("archive/")) {
          /* The repo version changed while offline. Keep both copies.
             v1.5: trash moves and archive moves are exempt, exactly
             alike: a queued move must never spawn a conflict copy,
             because the note now lives at its new path by design.
             v2.26: the flush inverts like the online save. The
             STORED version is preserved as the "(conflict copy)"
             first; only then does the queued put land on its
             original path. If the stored version cannot be
             preserved, the pre-v2.26 queued fork below runs
             unchanged as the fallback. The note's queued version
             history entries (which follow this put in the queue)
             now find their expected content on the original, as
             they were written to expect, instead of skipping
             themselves the way the fork made them. */
          const storedParsed = parseNoteFile(existing.text,
            existing.token, op.noteId, false);
          const keptCopy = {
            id: newNoteId(),
            title: (storedParsed.title || "Untitled note") +
              " (conflict copy)",
            notebook: storedParsed.notebook ||
              (localNote ? localNote.notebook : "personal"),
            tags: (storedParsed.tags || []).slice(),
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            pinned: false,
            body: storedParsed.body,
            bodyLoaded: true,
            previewText: null,
            attachments: sanitizeAttachments(
              storedParsed.attachments),
            thumbnail: storedParsed.thumbnail || null,
            /* v2.35: the stored version's reminder pair
               carries over with its thumbnail. */
            reminderAt: storedParsed.reminderAt || null,
            reminderDoneAt: storedParsed.reminderDoneAt || null,
            sha: null,
            fileId: null,
            trashed: false,
            trashedFrom: null,
            archived: false,
            archivedFrom: null
          };
          let preserved = false;
          try {
            keptCopy.sha = await storePutFile(
              "notebooks/" + keptCopy.notebook + "/" +
                keptCopy.id + ".md",
              serializeNote(keptCopy), null,
              "Preserve stored version of " + op.noteId);
            preserved = true;
          } catch (err) { preserved = false; }
          if (preserved) {
            /* v2.8: the preserved copy is a saved note in its
               own right, so it gets a baseline. */
            rememberLastSavedContent(keptCopy);
            state.notes.push(keptCopy);
            const newSha = await storePutFile(op.path, op.content,
              existing.token, "Sync queued change");
            if (localNote && notePath(localNote) === op.path) {
              localNote.sha = newSha;
            }
            setSyncPill("ok", "Saved; copy kept");
            toast("This note also changed elsewhere, so that " +
              "version was kept as \"" + keptCopy.title + "\" " +
              "and your version stayed here.");
          } else {
            /* The repo version changed while offline. Keep both copies.
               v1.5: trash moves and archive moves are exempt, exactly
               alike: a queued move must never spawn a conflict copy,
               because the note now lives at its new path by design. */
            const parsed = parseNoteFile(op.content, null, op.noteId, false);
            parsed.id = newNoteId();
            parsed.title = (parsed.title || "Untitled note") + " (conflict copy)";
            parsed.sha = await storePutFile(
              "notebooks/" + parsed.notebook + "/" + parsed.id + ".md",
              serializeNote(parsed), null, "Save queued conflict copy");
            /* v2.8: the queued conflict copy is a saved note in its
               own right, so it gets a baseline; the original note's
               version entry in this queue (if any) will find that
               its expected content never landed on the original and
               skip itself. */
            rememberLastSavedContent(parsed);
            state.notes.push(parsed);
            /* v2.17.1: the queued conflict marks the note diverged
               through the same path as an online one, so a later
               flush (or save) can never fork a second copy for
               this episode; the banner is the persistent one. */
            markNoteDiverged(op.noteId, "A note edited offline changed on " +
              storageDisplayName() + " too. Your offline version was kept as \"" +
              parsed.title + "\". Saving of this note is now paused, so no " +
              "more copies pile up; use Reload note to load the current " +
              "version and keep editing it.");
            setSyncPill("bad", "Conflict saved");
          }

        } else {
          const newSha = await storePutFile(op.path, op.content,
            existing ? existing.token : null, "Sync queued change");
          if (localNote && notePath(localNote) === op.path) {
            localNote.sha = newSha;
          }
        }
      } else if (op.kind === "version-history") {
        /* v2.8: a queued history maintenance entry, written right
           behind the note save it belongs to. flushVersionHistoryOp
           decides whether it still applies (its expected content
           check is what keeps a note write that became a conflict
           copy from capturing a version for the original note);
           a clean skip consumes the entry, a store failure throws
           and keeps it, in the usual flush way. */
        await flushVersionHistoryOp(op);
      } else if (op.kind === "delete") {
        const existing = await storeGetFile(op.path);
        if (existing) {
          await storeDeleteFile(op.path, existing.token, "Sync queued delete");
        }
      }
    } catch (err) {
      failed = true;
      remaining.push(op);
    }
  }
  saveQueue(remaining);
  saveCache();
}

/* Look a note up in the live list, the trash list, or the archive
   list (v1.5). A note is in exactly one of the three at any moment. */
function findNoteById(id) {
  return state.notes.find(function (n) { return n.id === id; }) ||
    state.trash.find(function (n) { return n.id === id; }) ||
    state.archive.find(function (n) { return n.id === id; }) || null;
}

