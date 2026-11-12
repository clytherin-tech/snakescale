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
   v2.33: Home, the dashboard (Evernote parity, phase 2 release 1)

   Evernote opens on Home: a greeting header (Good morning /
   afternoon / evening, over the full date) above a grid of
   widgets, customized from a Customize control on the page
   itself (widgets added, removed, and rearranged there),
   with the customization syncing across the user's devices.
   This section is that dashboard. Its facts (the pinned
   note, the scratch pad's text, and the widget layout) live
   in the home field of index.json (see buildIndexObject),
   so they sync like everything else in the index; the one
   Home choice that does NOT sync is where a boot lands,
   because Evernote's own When opening choice is per device:
   it is state.startView, remembered in settings.

   The widgets, each reading live state and navigating like
   the thing it mirrors: Pinned Notes (v2.58: every live note whose own
   pin is set, most recently updated first, as rows
   in the Recent Notes row language, each opening
   its note; through v2.57 this was Pinned Note,
   one note chosen by a Pin to Home item that no
   longer exists), Recent Notes (by updated, with a Recently created
   tab where Evernote's second tab is its server's
   Suggested), Tasks (open tasks in the Tasks view's own
   due order, rows built by the shared task row builder, so
   the completion checkbox runs the real completion path
   and a recurring task rolls forward), Scratch Pad (plain
   text, saved through the index writer like every other
   index fact; it is not a note and never appears in
   search; v2.60: the pad's resized height is remembered
   beside the text, as home.scratchHeight), Filtered
   Notes (bound to one saved search,
   showing its first matches; the widget's title runs the
   full search), Tags (the tag tree's order, labels flat,
   counts exact, navigating like the sidebar rows), and
   Notebooks (the sidebar's Evernote order, navigating like
   the sidebar rows). v2.43 adds the last two: Calendar
   (the widget this section once said could not exist:
   Evernote's renders a connected calendar account's
   events and this app has no calendar account, so this
   one is a calendar over the app's own dated items
   instead, tasks with due dates and notes with
   unfinished reminders, never presented as an events
   calendar; see buildHomeCalendarWidget) and Shortcuts
   (the sidebar's shortcut rows on Home, in stored order
   and under the sidebar's rules; see
   buildHomeShortcutsWidget).
   -------------------------------------------------------------------------- */

const HOME_WIDGET_TYPES = ["pinned", "recent", "shortcuts",
  "tasks", "calendar", "scratch", "filtered", "tags",
  "notebooks", "email"];
const HOME_WIDGET_LABELS = {
  pinned: "Pinned Notes", recent: "Recent Notes",
  shortcuts: "Shortcuts", tasks: "Tasks",
  calendar: "Calendar", scratch: "Scratch Pad",
  filtered: "Filtered Notes", tags: "Tags",
  notebooks: "Notebooks", email: "Email"
};

/* The default layout: every widget, in the order a fresh
   dashboard shows them (v2.43: Shortcuts after Recent
   Notes, Calendar after Tasks, the places the Home
   upgrade's approval named; v2.86: Email after
   Calendar). Built fresh on every call,
   so a caller can hold the result without sharing it. */
function defaultHomeWidgets() {
  return [
    { type: "pinned" },
    { type: "recent" },
    { type: "shortcuts" },
    { type: "tasks" },
    { type: "calendar" },
    { type: "email" },
    { type: "scratch" },
    { type: "filtered", searchId: null },
    { type: "tags" },
    { type: "notebooks" }
  ];
}

/* v2.60: the Scratch Pad's remembered height. The pad's
   text area carries the browser's native vertical resize
   grip; through v2.59 the grip set an inline height that
   vanished on the next render, so the pad always came
   back at its default size. The chosen height is now a
   home field beside the text (scratchHeight, whole
   pixels), judged by the one clamp both its paths share:
   a finite number is rounded and clamped into the range
   the grip itself can produce (the floor is the text
   area's own 64px minimum height; the ceiling, 1200px,
   is generous headroom over any screen the dashboard
   runs on), and anything else (absent, null, a string, a
   non-finite number) is null, which renders the pad at
   its default height exactly as before. The read path
   (sanitizeHome) and the capture path
   (captureHomeScratchHeight) both judge through this
   clamp, so a value is treated the same way wherever it
   arrives from. */
const HOME_SCRATCH_MIN_HEIGHT = 64;
const HOME_SCRATCH_MAX_HEIGHT = 1200;
/* How long a resize must sit still before it is saved:
   long enough that a drag's intermediate sizes never
   reach the index, short enough that the size feels
   remembered the moment the grip is let go. The save
   itself rides persistHome into the index writer's own
   800 ms coalescing, like a scratch keystroke. */
const HOME_SCRATCH_RESIZE_DEBOUNCE_MS = 650;

function clampHomeScratchHeight(value) {
  if (typeof value !== "number" || !isFinite(value)) {
    return null;
  }
  const rounded = Math.round(value);
  if (rounded < HOME_SCRATCH_MIN_HEIGHT) {
    return HOME_SCRATCH_MIN_HEIGHT;
  }
  if (rounded > HOME_SCRATCH_MAX_HEIGHT) {
    return HOME_SCRATCH_MAX_HEIGHT;
  }
  return rounded;
}

/* Read a stored home field into a safe one, the way the
   tag parent map (v2.30), the shortcuts list (v2.31), and
   the saved searches (v2.32) are read: a non-string
   scratch pad falls back, an unknown widget kind drops,
   a kind appears once (first occurrence wins), a
   filtered entry's binding survives only as a string,
   and an explicitly stored layout is honored even when
   it is empty (the user hid every widget). A missing or
   damaged field is the default dashboard.
   v2.58: the home field no longer carries a pin choice
   at all. The Pinned Notes widget lists the notes whose
   own pinned flag is set, so a stored pinnedNoteId from
   an older build is simply not read: it is shed here,
   and the next index write stores a home without it.
   v2.60: the scratch pad's remembered height rides the
   same read, judged by clampHomeScratchHeight; a home
   stored before it existed has no such key and reads as
   null, the default size.
   v2.86: the home field also records the Email
   widget's one time introduction (emailIntroduced),
   judged in the widget branch below; a home stored
   before it existed has no such key and reads as not
   yet introduced. */
function sanitizeHome(raw) {
  const out = { scratch: "", scratchHeight: null,
    widgets: defaultHomeWidgets(),
    emailIntroduced: true };
  if (!raw || typeof raw !== "object") { return out; }
  if (typeof raw.scratch === "string") {
    out.scratch = raw.scratch;
  }
  out.scratchHeight = clampHomeScratchHeight(
    raw.scratchHeight);
  if (Array.isArray(raw.widgets)) {
    const seen = {};
    const list = [];
    raw.widgets.forEach(function (e) {
      if (!e || typeof e !== "object") { return; }
      if (HOME_WIDGET_TYPES.indexOf(e.type) < 0) { return; }
      if (seen[e.type]) { return; }
      seen[e.type] = true;
      if (e.type === "filtered") {
        list.push({ type: "filtered",
          searchId: typeof e.searchId === "string" &&
            e.searchId.trim() ? e.searchId : null });
      } else {
        list.push({ type: e.type });
      }
    });
    /* v2.43: a layout stored before the Calendar and
       Shortcuts widgets existed gains both at the end,
       visible, its own order untouched, so the upgrade
       is discoverable without disturbing the arrangement
       the user made. No build before v2.43 could store
       either new type, so a non empty stored layout
       carrying NEITHER is a pre-upgrade one; a layout
       carrying either is a current one and is left
       exactly as stored (which is what makes hiding one
       of the two stick). The one seam: a layout whose
       owner hid BOTH new widgets reads as pre-upgrade
       and regains them on the next load; the field's
       shape carries no marker to tell the two apart,
       and the shape does not change. An explicitly
       empty layout (the user hid every widget) is
       honored as always and gains nothing. */
    const hasNew = list.some(function (e) {
      return e.type === "calendar" || e.type === "shortcuts";
    });
    if (!hasNew && list.length) {
      list.push({ type: "calendar" });
      list.push({ type: "shortcuts" });
    }
    /* v2.86: the Email widget's one time introduction.
       A stored layout with no Email widget gains one,
       set after the Calendar widget when the layout
       has one and at the end otherwise, and the home
       field records the introduction as
       emailIntroduced, so the gain happens exactly
       once: a layout that already carries the widget,
       and any layout whose home already records the
       introduction, are left exactly as stored, which
       is what makes removing the widget afterwards
       stick. An explicitly empty layout is honored the
       way the v2.43 append above honors it and gains
       nothing, and its record stays unset. */
    const hasEmail = list.some(function (e) {
      return e.type === "email";
    });
    if (hasEmail || raw.emailIntroduced === true) {
      out.emailIntroduced = true;
    } else if (list.length) {
      let emailAt = list.length;
      for (let ei = 0; ei < list.length; ei++) {
        if (list[ei].type === "calendar") {
          emailAt = ei + 1; break;
        }
      }
      list.splice(emailAt, 0, { type: "email" });
      out.emailIntroduced = true;
    } else {
      out.emailIntroduced = false;
    }
    out.widgets = list;
  }
  return out;
}

/* The home field is index data, so its saves take the
   shape every other index fact takes (the persist twins
   of v2.30 to v2.32): the index write behind the caller's
   back, guarded to a live store, and the cache with it. */
function persistHome() {
  if (state.online && state.repoExists) { saveIndex(); }
  saveCache();
}

/* Where a returning boot lands, from the device's When
   opening choice: Home, or the notes list. Applied once
   per boot (connectAndLoad), before the first paint, and
   never on a first run, whose seeded starter note still
   opens the way it always has. */
function applyStartView() {
  state.view = state.startView === "notes"
    ? { kind: "all", value: null }
    : { kind: "home", value: null };
}

/* v2.55: the layout list every Home surface reads and
   every layout edit mutates. While a customize session
   is open that is the session's working copy; the rest
   of the time it is the stored layout itself. */
function homeActiveWidgets() {
  return homeCustomSession ? homeCustomSession.work
    : state.home.widgets;
}

function homeSetActiveWidgets(list) {
  if (homeCustomSession) {
    homeCustomSession.work = list;
  } else {
    state.home.widgets = list;
  }
}

/* A layout edit landed. Outside a session the stored
   fact changed: persist and re-render, as it always
   has. Inside a session only the working copy changed:
   Home re-renders from it and NOTHING reaches the
   persist path (the session section below holds that
   line); the one write of a session happens at Done,
   in exitHomeCustomize. */
function homeLayoutTouched() {
  if (homeCustomSession) { renderHome(); return; }
  persistHome();
  renderAll();
}

function homeWidgetEntry(type) {
  return homeActiveWidgets().find(function (e) {
    return e.type === type;
  }) || null;
}

/* v2.58: Pin to Home is gone. The Pinned Notes widget
   lists the notes whose own pinned flag is set (see
   buildHomePinnedWidget), so there is no Home level pin
   choice left to set: setHomePinnedNote and
   toggleSelectedNoteHomePin were removed with the
   #nbHomePinBtn item that called the toggle. */

/* Bind the Filtered Notes widget to a saved search (or
   clear the binding, with null). The binding is the
   search's id; its name and query are read at render, so
   a rename follows and a deleted search unbinds the
   widget back to its hint. */
function setHomeFilteredSearch(id) {
  const entry = homeWidgetEntry("filtered");
  if (!entry) { return; }
  entry.searchId = id || null;
  homeLayoutTouched();
}

/* The Customize operations. Each mutates the layout
   in play (the session's working copy while a session
   is open, the stored layout otherwise) through the
   active list and lands in homeLayoutTouched, so the
   popover, the per-widget buttons, and the grid can
   never disagree, and nothing persists mid session. */
function homeAddWidget(type) {
  if (HOME_WIDGET_TYPES.indexOf(type) < 0) { return; }
  if (homeWidgetEntry(type)) { return; }
  homeActiveWidgets().push(type === "filtered"
    ? { type: "filtered", searchId: null } : { type: type });
  homeLayoutTouched();
}

function homeRemoveWidget(type) {
  homeSetActiveWidgets(homeActiveWidgets().filter(
    function (e) { return e.type !== type; }));
  homeLayoutTouched();
}

function homeMoveWidget(type, dir) {
  const list = homeActiveWidgets();
  const at = list.findIndex(function (e) {
    return e.type === type;
  });
  const to = at + dir;
  if (at < 0 || to < 0 || to >= list.length) {
    return;
  }
  const entry = list[at];
  list[at] = list[to];
  list[to] = entry;
  homeLayoutTouched();
}

/* v2.42: the Home surface's drag order owner. A widget
   drag on the Home page commits the grid's type order
   here; the layout entries themselves (the Filtered
   Notes widget's search binding above all) are carried
   across by identity, and the write is the same home
   layout write the Move buttons make, so dragging and
   the buttons can never disagree. Returns true when
   the order changed. */
function applyHomeWidgetDragOrder(types) {
  const current = homeActiveWidgets();
  if (types.length !== current.length) { return false; }
  const byType = {};
  current.forEach(function (e) { byType[e.type] = e; });
  const seq = types.map(function (t) { return byType[t]; });
  if (seq.some(function (e) { return !e; })) {
    return false;
  }
  if (seq.every(function (e, i) {
      return e === current[i];
    })) {
    return false;
  }
  homeSetActiveWidgets(seq);
  homeLayoutTouched();
  return true;
}

/* ------------------------------------------------------------------
   v2.52: Home packing and the live widget drag (Chris's
   direction, confirmed 2026-10-29: "when dragging the
   widgets, I want to see them as I move them, and I
   want them to be freely moved and stack right up
   against the others without any of the large empty
   areas. The widgets should shrink and grow as needed
   while the others around adjust as needed.")

   The layout half replaces the v2.33 grid rows. Under
   grid rows a widget's row was as tall as its tallest
   member, so a short widget left a large empty area
   under it beside a taller neighbor. The packing here
   is a pure function of two inputs: the stored order
   (state.home.widgets, whose shape does not change)
   and the widgets' measured heights. Widgets are
   consumed in order and each one fills the currently
   shortest column (ties go to the leftmost column),
   taking exactly the height its content needs, so the
   page stacks tightly at any width and the same order
   packs to the same arrangement on every device, with
   no per device layout state anywhere. The column
   count follows the width the old grid used: as many
   330px columns as fit, one on a phone.

   The drag half is Home's own (the shared
   attachReorderDrag still serves Shortcuts and the
   merge dialog, untouched). Pressing a widget's grip
   and moving past the shared 4px threshold lifts the
   widget itself: the real element goes fixed and
   follows the pointer, slightly raised, while a
   dashed placeholder takes its candidate slot among
   the others and the packing pass re-places the
   others around it, so the landing arrangement is
   visible before the drop. The candidate slot is the
   standing widget nearest the pointer, read by
   homePackDropIndex (through v2.71 off the dragged
   widget's own hypothetical slot, which let size
   hijack the position; v2.72 reads it off the
   standing widgets alone, see that function's note),
   and the
   drop commits the resulting ORDER through
   applyHomeWidgetDragOrder, never coordinates: the
   preview, the drop, and a later reload all pack from
   that one order, so what is dropped is what renders.
   The model's one limitation, named: because packing
   is order driven, a drop aimed across columns can
   occasionally land in the neighbouring column when
   the column heights dictate the packed slot nearest
   the pointer sits there.

   Touch: the grip already carries touch-action none
   (the shared .ss-drag-handle rule), so a touch drag
   starting on a grip never becomes a page scroll;
   while a drag is engaged the move handler prevents
   the default, and the Home scroll area edge scrolls
   the way the shared helper's does, so a widget can
   still be carried past the fold. Scrolling the page
   with a finger anywhere off a grip is untouched.

   v2.55: the drag's two device faults, diagnosed in
   this code at the owner's report (very slow, and
   the widget flies in from off the page at the
   lift). The fly-in: the slide rule above
   (.ss-home-dragging .home-widget) transitioned top
   and left on EVERY widget, the lifted one included;
   at the lift its left and top changed from the
   packed grid space values to fixed viewport values
   in the same style write, so the browser animated
   the difference over 180ms and the widget arrived
   from wherever the grid numbers pointed on screen,
   then chased every later move a transition behind.
   The slowness: the move handler ran the packing
   pass synchronously on every pointermove event,
   and the pass wrote every widget's width and then
   read every widget's offsetHeight, a forced reflow
   per widget per event, at event rate rather than
   frame rate. The fixes: the lifted widget travels
   by transform and the stylesheet takes its
   transition off entirely (the one excepted rule in
   the CSS); it is placed from the engaging event's
   own coordinates in that event, before any frame;
   moves only record the latest point and batch the
   packing to one update per animation frame; and
   while a drag is engaged the packing pass reads
   the heights cached at the lift and writes no
   widths, so a frame costs arithmetic, not layout.
   ------------------------------------------------------------------ */

const HOME_PACK_GAP = 16;
const HOME_PACK_MIN_COL = 330;

/* Pack heights (in order) into columns across a
   container of the given width. Returns the column
   count and width, one placement (column, left, top)
   per input height, and the total packed height.
   Pure: no DOM, no state, so the harness can prove
   the rule with fixture heights and the renderer can
   trust that an order always packs the same way. */
function homePackCompute(heights, width) {
  const gap = HOME_PACK_GAP;
  const w = (typeof width === "number" && isFinite(width)
    && width > 0) ? width : 0;
  let cols = Math.floor((w + gap) / (HOME_PACK_MIN_COL + gap));
  if (!isFinite(cols) || cols < 1) { cols = 1; }
  const colWidth = cols > 0 ? (w - (cols - 1) * gap) / cols : 0;
  const colHeights = [];
  for (let c = 0; c < cols; c++) { colHeights.push(0); }
  const placements = heights.map(function (h) {
    const height = (typeof h === "number" && isFinite(h)
      && h > 0) ? h : 0;
    let col = 0;
    for (let c = 1; c < cols; c++) {
      if (colHeights[c] < colHeights[col]) { col = c; }
    }
    const top = colHeights[col];
    colHeights[col] = top + height + gap;
    return { col: col, left: col * (colWidth + gap), top: top };
  });
  let height = 0;
  colHeights.forEach(function (h) {
    if (h - gap > height) { height = h - gap; }
  });
  return { cols: cols, colWidth: colWidth, gap: gap,
    placements: placements, height: Math.max(0, height) };
}

/* The candidate order position for a drag.

   v2.72 (Chris's Testing Checklist finding, 2026-10-30):
   the position is read off the widgets that stay
   behind, never off the dragged widget's own size. The
   rule through v2.71 packed the dragged height at
   every candidate position and kept the position whose
   packed slot FOR THE DRAGGED WIDGET lay nearest the
   pointer. A large widget's slot spans a tall stretch
   wherever the packing puts it, and the packing moves
   that slot between columns as the candidate changes,
   so dragging a large widget at a small one could not
   take the small one's place: some other position
   measured nearer and the order went there instead,
   shoving neighbours aside. The rule now packs the
   standing widgets alone, finds the one whose packed
   slot lies nearest the pointer (distance from the
   point to the slot's rectangle, zero inside it), and
   inserts before it when the pointer is in that slot's
   top half, after it in the bottom half. dragHeight
   stays in the signature for its callers and no longer
   enters the choice at all, so any size can take any
   position: the drop position in the order is what is
   chosen, and the packing then packs around that order
   like it packs every order. Deterministic; distance
   ties keep the earliest widget. otherHeights are the
   heights of the widgets that stay behind, in their
   order. */
function homePackDropIndex(otherHeights, dragHeight, width, x, y) {
  const pack = homePackCompute(otherHeights, width);
  function standingHeight(i) {
    const h = otherHeights[i];
    return (typeof h === "number" && isFinite(h) && h > 0)
      ? h : 0;
  }
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < otherHeights.length; i++) {
    const p = pack.placements[i];
    const left = p.left;
    const top = p.top;
    const right = left + pack.colWidth;
    const bottom = top + standingHeight(i);
    const dx = x < left ? left - x : (x > right ? x - right : 0);
    const dy = y < top ? top - y : (y > bottom ? y - bottom : 0);
    const d = dx * dx + dy * dy;
    if (d < bestDist) { bestDist = d; best = i; }
  }
  if (best < 0) { return 0; }
  const midY = pack.placements[best].top +
    standingHeight(best) / 2;
  return y <= midY ? best : best + 1;
}

/* Place the Home grid's widgets by the packing rule.
   Runs at the end of every Home render, on window
   resize, when a widget's own size changes (the
   ResizeObserver below: a calendar month change, a
   scratch pad the user stretched), and through the
   drag. The grid's children in DOM order are the
   packing sequence (during a drag the placeholder
   stands in the sequence and the floating widget is
   skipped). Widths are set first so each widget's
   measured height is its height at the column width;
   then positions and the container height land. A
   grid with no measurable width (a hidden pane, the
   harness) is left alone: DOM order still reads
   correctly there, and the next visible render packs
   for real. */
let homePackObserver = null;
let homePackQueued = false;

/* v2.68.0: the Home hold latch (see the #homepane.home-hold
   style). renderHome arms the hold on the pane until the
   first packed layout has actually been applied;
   releaseHomeHold runs inside the first layoutHomeWidgets
   pass that places items (or settles the zero widget
   case), and the latch then stays off for the session, so
   Customize passes and every later pack paint exactly as
   they always have. */
let homeHoldReleased = false;
function releaseHomeHold() {
  if (homeHoldReleased) { return; }
  homeHoldReleased = true;
  const pane = document.getElementById("homepane");
  if (pane) { pane.classList.remove("home-hold"); }
}

function layoutHomeWidgets() {
  const grid = document.getElementById("homeGrid");
  if (!grid) { return; }
  const width = grid.clientWidth;
  if (!width) { return; }
  const items = Array.prototype.filter.call(grid.children,
    function (el) {
      return el.classList.contains("home-widget-placeholder") ||
        (el.classList.contains("home-widget") &&
          !el.classList.contains("home-widget-floating"));
    });
  if (!items.length) {
    grid.style.height = "";
    /* v2.68.0: no widgets is a settled layout too; the
       pane's own chrome (greeting, Customize) must show. */
    releaseHomeHold();
    return;
  }
  /* v2.55: while a widget drag is engaged, the pass
     packs from the heights the lift measured (the drag
     session's cache): no width writes (a slide cannot
     change a column's width) and no offsetHeight reads
     (the per move reflow that made the drag slow), and
     the size observer sits the drag out. */
  const drag = (typeof ssHomeDrag !== "undefined" &&
    ssHomeDrag && ssHomeDrag.engaged && ssHomeDrag.heights)
    ? ssHomeDrag : null;
  const probe = homePackCompute(
    items.map(function () { return 0; }), width);
  if (!drag) {
    items.forEach(function (el) {
      el.style.width = probe.colWidth + "px";
    });
  }
  const heights = items.map(function (el) {
    if (el.classList.contains("home-widget-placeholder")) {
      return parseFloat(el.getAttribute("data-pack-height")) || 0;
    }
    if (drag) {
      return drag.heights[
        el.getAttribute("data-widget-type")] || 0;
    }
    return el.offsetHeight;
  });
  const pack = homePackCompute(heights, width);
  items.forEach(function (el, i) {
    el.style.left = pack.placements[i].left + "px";
    el.style.top = pack.placements[i].top + "px";
  });
  grid.style.height = pack.height + "px";
  if (!drag) { watchHomeWidgetSizes(grid); }
  /* v2.68.0: the pack has been applied; reveal Home. */
  releaseHomeHold();
}

/* Repack on the next frame, coalesced: the observer
   and the resize listener can both fire in bursts,
   and a pack that changes nothing settles at once
   (it writes the same widths and positions, which
   fire no further size changes). */
function queueHomePack() {
  if (homePackQueued) { return; }
  homePackQueued = true;
  const run = function () {
    homePackQueued = false;
    layoutHomeWidgets();
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(run);
  } else {
    setTimeout(run, 50);
  }
}

function watchHomeWidgetSizes(grid) {
  if (typeof ResizeObserver === "undefined") { return; }
  if (!homePackObserver) {
    homePackObserver = new ResizeObserver(function () {
      queueHomePack();
    });
  }
  homePackObserver.disconnect();
  Array.prototype.forEach.call(
    grid.querySelectorAll(".home-widget"), function (el) {
      homePackObserver.observe(el);
    });
  /* v2.60: the scratch height capture follows the pad's
     live element the same way (a render that kept the
     focused pad lifts the same element into the new
     grid, and the capture must keep watching it). */
  watchHomeScratchSize(grid.querySelector(
    "#homeScratchText"));
}

if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("resize", queueHomePack);
  /* v2.72: the Widgets popover re-anchors to its button
     when the window changes under it. Split seam:
     the function stands in mail.js, a later file, so
     the handler resolves it when a resize fires
     rather than when this registration runs; in the
     single file its declaration was hoisted here. */
  window.addEventListener("resize", function () {
    positionHomeWidgetsPopover();
  });
}

/* The Home widget drag session, the counterpart of
   the shared helper's ssReorderDrag for this surface
   alone. */
let ssHomeDrag = null;

function attachHomeWidgetDrag(handle, widget) {
  if (!handle || !widget) { return; }
  if (handle.getAttribute("data-ss-home-drag-bound") === "1") {
    return;
  }
  handle.setAttribute("data-ss-home-drag-bound", "1");
  handle.addEventListener("pointerdown", function (ev) {
    startHomeWidgetDrag(ev, handle, widget);
  });
}

function homeDragWidgetEls(grid) {
  return Array.prototype.slice.call(
    grid.querySelectorAll(".home-widget"));
}

function startHomeWidgetDrag(ev, handle, widget) {
  if (ssHomeDrag) { return; }
  if (ev.pointerType === "mouse" && ev.button !== 0) {
    return;
  }
  const grid = document.getElementById("homeGrid");
  if (!grid || widget.parentElement !== grid) { return; }
  const items = homeDragWidgetEls(grid);
  if (items.length < 2 || items.indexOf(widget) < 0) {
    return;
  }
  ssHomeDrag = {
    pointerId: ev.pointerId,
    startX: ev.clientX, startY: ev.clientY,
    engaged: false,
    handle: handle, widget: widget, grid: grid,
    items0: items,
    keys0: items.map(function (el) {
      return el.getAttribute("data-widget-type");
    }),
    heights: null, grabDX: 0, grabDY: 0,
    placeholder: null, slot: -1,
    /* v2.55: the latest pointer point (the frame and
       the drop read it) and the armed frame's id, 0
       when no frame is pending. */
    lastX: ev.clientX, lastY: ev.clientY, frameId: 0
  };
  if (handle.setPointerCapture &&
      ev.pointerId !== undefined) {
    try { handle.setPointerCapture(ev.pointerId); }
    catch (e) { /* capture is a nicety, not the drag */ }
  }
  window.addEventListener("pointermove", onHomeDragMove);
  window.addEventListener("pointerup", onHomeDragUp);
  window.addEventListener("pointercancel", onHomeDragCancel);
  document.addEventListener("keydown", onHomeDragKeydown, true);
}

/* Lift the widget: measure every widget's height
   ONCE (the packing inputs for the whole drag, taken
   while the arrangement still stands), put the
   placeholder in the widget's slot at its height, and
   send the real widget fixed. Its left and top zero
   here; the caller in the move handler sets its
   transform from the engaging event's own coordinates
   in the same event, so the widget is under the
   pointer in the lift frame itself and no transition
   or stale coordinate can fly it in (v2.55). */
function engageHomeDrag(s) {
  const rect = s.widget.getBoundingClientRect();
  s.heights = {};
  s.items0.forEach(function (el) {
    s.heights[el.getAttribute("data-widget-type")] =
      el.getBoundingClientRect().height;
  });
  s.grabDX = s.startX - rect.left;
  s.grabDY = s.startY - rect.top;
  const ph = document.createElement("div");
  ph.className = "home-widget-placeholder";
  ph.setAttribute("data-pack-height", String(rect.height));
  ph.setAttribute("aria-hidden", "true");
  ph.style.height = rect.height + "px";
  s.grid.insertBefore(ph, s.widget);
  s.placeholder = ph;
  s.slot = s.items0.indexOf(s.widget);
  s.widget.classList.add("home-widget-floating");
  s.widget.style.width = rect.width + "px";
  s.widget.style.left = "0px";
  s.widget.style.top = "0px";
  s.grid.classList.add("ss-home-dragging");
  document.body.classList.add("ss-home-dragging");
  s.engaged = true;
}

function onHomeDragMove(ev) {
  const s = ssHomeDrag;
  if (!s || ev.pointerId !== s.pointerId) { return; }
  if (!s.engaged) {
    if (Math.hypot(ev.clientX - s.startX,
        ev.clientY - s.startY) < SS_REORDER_DRAG_PX) {
      return;
    }
    engageHomeDrag(s);
    /* The widget lands under the pointer in this same
       event, from this event's own coordinates: no
       frame and no transition sits between the lift
       and its first true position. */
    s.lastX = ev.clientX;
    s.lastY = ev.clientY;
    moveHomeDragWidget(s);
  }
  ev.preventDefault();
  /* v2.55: a move records the latest point and arms
     the frame; the packing itself runs once per
     frame in stepHomeDrag, however many events
     arrived inside it. */
  s.lastX = ev.clientX;
  s.lastY = ev.clientY;
  scheduleHomeDragFrame(s);
}

/* The lifted widget's travel: a transform, never its
   left and top, so a move costs the compositor a
   translation instead of the layout a reposition,
   and the stylesheet's transition can never apply
   to it (the floating rule takes it off entirely). */
function moveHomeDragWidget(s) {
  s.widget.style.transform = "translate(" +
    (s.lastX - s.grabDX) + "px," +
    (s.lastY - s.grabDY) + "px)";
}

/* Arm the one batched frame. A frame already pending
   absorbs the move; the frame reads the latest
   recorded point when it runs. */
function scheduleHomeDragFrame(s) {
  if (s.frameId) { return; }
  const run = function () {
    s.frameId = 0;
    if (ssHomeDrag !== s || !s.engaged) { return; }
    stepHomeDrag(s);
  };
  if (typeof requestAnimationFrame === "function") {
    s.frameId = requestAnimationFrame(run);
  } else {
    s.frameId = setTimeout(run, 16);
  }
}

/* Run a pending batched frame now (the drop path):
   disarmed first, so it can never run twice. */
function flushHomeDragFrame(s) {
  if (!s.frameId) { return; }
  if (typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(s.frameId);
  } else { clearTimeout(s.frameId); }
  s.frameId = 0;
  if (ssHomeDrag === s && s.engaged) { stepHomeDrag(s); }
}

/* One batched drag step: the widget to the recorded
   point, the candidate slot recomputed from the
   heights measured at the lift (the standing widget
   nearest the pointer, v2.72), the placeholder to the slot
   when it changed, and the packing pass, which reads
   the same cached heights while a drag is engaged
   and slides the others to their new spots. */
function stepHomeDrag(s) {
  moveHomeDragWidget(s);
  const gridRect = s.grid.getBoundingClientRect();
  const x = s.lastX - gridRect.left;
  const y = s.lastY - gridRect.top;
  const others = s.items0.filter(function (el) {
    return el !== s.widget;
  });
  const otherHeights = others.map(function (el) {
    return s.heights[el.getAttribute("data-widget-type")] || 0;
  });
  const dragH = s.heights[
    s.widget.getAttribute("data-widget-type")] || 0;
  const width = s.grid.clientWidth || gridRect.width || 0;
  const k = homePackDropIndex(otherHeights, dragH, width, x, y);
  if (k !== s.slot) {
    s.slot = k;
    if (k < others.length) {
      s.grid.insertBefore(s.placeholder, others[k]);
    } else {
      s.grid.appendChild(s.placeholder);
    }
  }
  layoutHomeWidgets();
  /* Edge auto scroll, the shared helper's rule, so a
     drag can carry a widget past the fold. */
  const sc = s.grid.closest(".home-scroll");
  if (sc) {
    const r = sc.getBoundingClientRect();
    if (s.lastY < r.top + 40 && sc.scrollTop > 0) {
      sc.scrollTop -= 12;
    } else if (s.lastY > r.bottom - 40 &&
        sc.scrollTop < sc.scrollHeight - sc.clientHeight) {
      sc.scrollTop += 12;
    }
  }
}

function finishHomeDrag(commit) {
  const s = ssHomeDrag;
  if (!s) { return; }
  ssHomeDrag = null;
  /* A batched frame still pending dies with the drag.
     The drop path flushed its own before calling
     this, so a frame here belongs to a cancel or an
     Escape, whose restore does not need it. */
  if (s.frameId) {
    if (typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(s.frameId);
    } else { clearTimeout(s.frameId); }
    s.frameId = 0;
  }
  window.removeEventListener("pointermove", onHomeDragMove);
  window.removeEventListener("pointerup", onHomeDragUp);
  window.removeEventListener("pointercancel", onHomeDragCancel);
  document.removeEventListener("keydown", onHomeDragKeydown,
    true);
  if (!s.engaged) { return; }
  const widget = s.widget;
  if (commit) {
    /* The widget takes the placeholder's slot in the
       DOM; the stored order follows the DOM. */
    s.grid.insertBefore(widget, s.placeholder);
  } else {
    /* Restore the order the drag started from. */
    s.items0.forEach(function (el) {
      s.grid.appendChild(el);
    });
  }
  s.placeholder.remove();
  widget.classList.remove("home-widget-floating");
  widget.style.width = "";
  widget.style.left = "";
  widget.style.top = "";
  widget.style.transform = "";
  s.grid.classList.remove("ss-home-dragging");
  document.body.classList.remove("ss-home-dragging");
  layoutHomeWidgets();
  if (!commit) { return; }
  const keys = homeDragWidgetEls(s.grid).map(function (el) {
    return el.getAttribute("data-widget-type");
  });
  const changed = keys.length !== s.keys0.length ||
    keys.some(function (k, i) { return k !== s.keys0[i]; });
  if (changed) { applyHomeWidgetDragOrder(keys); }
}

function onHomeDragUp(ev) {
  if (!ssHomeDrag || ev.pointerId !== ssHomeDrag.pointerId) {
    return;
  }
  /* The drop judges the pointer's final position even
     when its last move's frame never ran: take the up
     event's own coordinates and run the pending frame
     work synchronously before anything commits. */
  ssHomeDrag.lastX = ev.clientX;
  ssHomeDrag.lastY = ev.clientY;
  flushHomeDragFrame(ssHomeDrag);
  finishHomeDrag(true);
}

function onHomeDragCancel(ev) {
  if (!ssHomeDrag || ev.pointerId !== ssHomeDrag.pointerId) {
    return;
  }
  finishHomeDrag(false);
}

function onHomeDragKeydown(ev) {
  if (ev.key === "Escape" && ssHomeDrag) {
    ev.preventDefault();
    finishHomeDrag(false);
  }
}

/* v2.42: while Customize is open, every widget on the
   Home page carries a drag handle in its header, and
   dragging it reorders the widgets on the page itself
   (Chris's own ask for this release). Outside Customize
   there are no handles and nothing on the page is
   draggable, so using the Tasks widget or the Scratch
   Pad can never start a drag. renderHome calls this
   after the grid is built; a widget the render reused
   (the focused Scratch Pad) keeps its handle and its
   one binding. */
function syncHomeWidgetDragHandles() {
  const grid = document.getElementById("homeGrid");
  if (!grid) { return; }
  Array.prototype.forEach.call(
    grid.querySelectorAll(".home-widget"), function (widget) {
      let handle = widget.querySelector(".home-widget-drag");
      if (!homeCustomizeOpen) {
        if (handle) { handle.remove(); }
        const hideOff = widget.querySelector(".home-widget-hide");
        if (hideOff) { hideOff.remove(); }
        return;
      }
      const head = widget.querySelector(".home-widget-head");
      if (!head) { return; }
      if (!handle) {
        handle = document.createElement("button");
        handle.type = "button";
        handle.className = "home-widget-drag ss-drag-handle";
        const type = widget.getAttribute("data-widget-type");
        handle.setAttribute("aria-label",
          "Drag to reorder " +
            (HOME_WIDGET_LABELS[type] || "widget"));
        handle.title = "Drag to reorder";
        handle.innerHTML = SS_DRAG_GRIP_ICON;
        head.insertBefore(handle, head.firstChild);
      }
      /* v2.52: Home's drag is its own now (the live
         lift and packed slide above); the commit still
         lands in applyHomeWidgetDragOrder. */
      attachHomeWidgetDrag(handle, widget);
      /* v2.55: a session also gives every widget a
         hide button on its header (the owner's ask:
         hiding must not need the widget list). It
         stages like every layout edit, into the
         working copy; the popover re-shows the
         widget. The render reused element (the
         focused Scratch Pad) keeps its one button,
         like its handle. */
      let hide = widget.querySelector(".home-widget-hide");
      if (!hide) {
        hide = document.createElement("button");
        hide.type = "button";
        hide.className = "home-widget-hide";
        const htype = widget.getAttribute("data-widget-type");
        hide.setAttribute("aria-label",
          "Hide " + (HOME_WIDGET_LABELS[htype] || "widget"));
        hide.title = "Hide widget";
        hide.innerHTML = HOME_HIDE_ICON;
        hide.addEventListener("click", function () {
          homeRemoveWidget(htype);
        });
        head.appendChild(hide);
      }
    });
}

/* Session only Home view state: the customize session
   (v2.55: null while no session is open; while one is,
   it carries the snapshot taken at entry and the
   working copy every layout edit stages into),
   whether the widget popover is open, and which of
   the Recent widget's two lists is showing. None is
   a stored fact. homeCustomizeOpen mirrors the
   session for the surfaces that only ask whether
   customizing is live (the drag handles above all). */
let homeCustomSession = null;
let homeCustomizeOpen = false;
let homeWidgetsPopoverOpen = false;
let homeRecentTab = "updated";

/* Evernote greets by the time of day. */
function homeGreetingText(now) {
  const h = now.getHours();
  if (h < 12) { return "Good morning"; }
  if (h < 18) { return "Good afternoon"; }
  return "Good evening";
}

/* Opening a note from Home: the note opens in the notes
   view (All Notes), the way following a note link from
   anywhere outside the list lands, so the editor and
   the list are both there when the user comes back. */
function openNoteFromHome(id) {
  state.view = { kind: "all", value: null };
  openNote(id);
}

/* A tag widget row navigates like the sidebar tag row
   it mirrors, the click again to clear rule included. */
function homeOpenTag(tag) {
  if (state.view.kind === "tag" && state.view.value === tag) {
    state.view = { kind: "all", value: null };
  } else {
    state.view = { kind: "tag", value: tag };
  }
  renderAll();
  setMobileView("list");
}

/* The notes a search text matches, judged exactly the
   way the notes list judges the same text (the grammar
   path for a query carrying syntax, the plain predicate
   otherwise), in the list's own order. The Filtered
   Notes widget renders from this; the list itself keeps
   its own path through visibleNotes. */
function notesMatchingSearchText(rawQuery) {
  const q = normalizeSearchText(rawQuery);
  let list = state.notes.slice();
  if (q) {
    const parsed = parseSearchQuery(q);
    if (parsed) {
      list = list.filter(function (n) {
        return noteMatchesParsedSearch(n, parsed);
      });
    } else {
      list = list.filter(function (n) {
        return noteMatchesPlainSearch(n, q);
      });
    }
  }
  list.sort(function (a, b) {
    if (!!b.pinned !== !!a.pinned) { return b.pinned ? 1 : -1; }
    return compareNotesByListSort(a, b);
  });
  return list;
}

/* v2.35: the Reminders view's order: reminders still asking
   for attention first (soonest moment first, so overdue
   leads), done reminders after (also by moment). Ties fall
   back to the title so the order is stable and readable. */
function compareNotesByReminder(a, b) {
  const aDone = a.reminderDoneAt ? 1 : 0;
  const bDone = b.reminderDoneAt ? 1 : 0;
  if (aDone !== bDone) { return aDone - bDone; }
  const aT = new Date(a.reminderAt || "").getTime();
  const bT = new Date(b.reminderAt || "").getTime();
  const aMs = isNaN(aT) ? 0 : aT;
  const bMs = isNaN(bT) ? 0 : bT;
  if (aMs !== bMs) { return aMs - bMs; }
  return String(a.title || "").localeCompare(String(b.title || ""));
}

/* One widget's shell: the card, its header (the title,
   plus whatever controls the builder adds), and its
   body. Every widget is built through here, so the
   grid's cards share one shape. */
function homeWidgetShell(type, titleText) {
  const widget = document.createElement("section");
  widget.className = "home-widget";
  widget.setAttribute("data-widget-type", type);
  const head = document.createElement("div");
  head.className = "home-widget-head";
  /* v2.137: the Calendar and Email widgets' titles
     are links (Chris's call: they replace the
     sidebar entries those views lost): a button
     wearing the title's dress, wired by the widget
     builders to the views' own openers. Every other
     widget's title stays a plain heading. */
  const title = document.createElement(
    (type === "calendar" || type === "email")
      ? "button" : "h3");
  if (title.tagName === "BUTTON") { title.type = "button"; }
  title.className = "home-widget-title";
  title.textContent = titleText;
  head.appendChild(title);
  widget.appendChild(head);
  const body = document.createElement("div");
  body.className = "home-widget-body";
  widget.appendChild(body);
  return { widget: widget, head: head, body: body,
    title: title };
}

/* A note row, shared by the Recent and Filtered Notes
   widgets: the title, the date the caller is ordering
   by, and a click that opens the note. */
function homeNoteRow(note, field) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "home-note-row";
  row.setAttribute("data-note-id", note.id);
  const title = document.createElement("span");
  title.className = "home-note-row-title";
  title.textContent = note.title;
  row.appendChild(title);
  const stamp = note[field || "updated"];
  if (stamp) {
    const meta = document.createElement("span");
    meta.className = "home-note-row-meta";
    meta.textContent = new Date(stamp).toLocaleDateString();
    row.appendChild(meta);
  }
  row.addEventListener("click", function () {
    openNoteFromHome(note.id);
  });
  return row;
}

function homeHint(text) {
  const hint = document.createElement("div");
  hint.className = "home-hint";
  hint.textContent = text;
  return hint;
}

/* The Pinned Notes widget. Through v2.57 this was the
   Pinned Note widget: one note, chosen from the note's
   own menu (Pin to Home, in the notes list menu) or from
   the widget's own picker, shown as a read only preview.
   v2.58 makes it a list instead: every LIVE note whose
   own pinned flag is set, most recently updated first,
   rendered as rows in the Recent Notes widget's row
   language (homeNoteRow), each row opening its note
   through openNoteFromHome like every other Home note
   row. The pin itself is the note's own (the notes list
   menu's Pin note item, or a card's context menu), so
   the widget follows it with no Home level choice to
   keep in sync. A note that leaves the notebooks leaves
   the list (the trash move clears its pin, and Trash
   and the Archive are never listed here), a note
   restored and re-pinned returns, and with nothing
   pinned the widget shows one quiet line. The layout
   entry keeps its "pinned" type id, so saved layouts
   carry over untouched. */
function buildHomePinnedWidget() {
  const parts = homeWidgetShell("pinned", "Pinned Notes");
  const pinned = state.notes.filter(function (n) {
    return n.pinned;
  }).sort(function (a, b) {
    return String(b.updated || "")
      .localeCompare(String(a.updated || ""));
  });
  if (!pinned.length) {
    parts.body.appendChild(homeHint("No pinned notes yet."));
    return parts.widget;
  }
  pinned.forEach(function (n) {
    parts.body.appendChild(homeNoteRow(n, "updated"));
  });
  return parts.widget;
}

/* The Recent Notes widget: the most recently updated
   notes, with the Recently created list one tab away.
   (Evernote's second tab is Suggested, its server's
   picks; this app has no server to suggest from, so the
   second list is the created order instead.) */
function buildHomeRecentWidget() {
  const parts = homeWidgetShell("recent", "Recent Notes");
  const tabs = document.createElement("div");
  tabs.className = "home-recent-tabs";
  [["updated", "Recent"], ["created", "Created"]]
    .forEach(function (pair) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "home-recent-tab" +
        (homeRecentTab === pair[0] ? " active" : "");
      btn.setAttribute("data-tab", pair[0]);
      btn.setAttribute("aria-selected",
        homeRecentTab === pair[0] ? "true" : "false");
      btn.textContent = pair[1];
      btn.addEventListener("click", function () {
        homeRecentTab = pair[0];
        renderHome();
      });
      tabs.appendChild(btn);
    });
  parts.head.appendChild(tabs);
  const field = homeRecentTab === "created"
    ? "created" : "updated";
  const notes = state.notes.slice().sort(function (a, b) {
    return String(b[field] || "")
      .localeCompare(String(a[field] || ""));
  }).slice(0, 8);
  if (!notes.length) {
    parts.body.appendChild(homeHint("No notes yet."));
  }
  notes.forEach(function (n) {
    parts.body.appendChild(homeNoteRow(n, field));
  });
  return parts.widget;
}

/* The Tasks widget: open tasks in the Tasks view's own
   order (sortTasksForList: open first, by due moment,
   no date last), each row the shared task row, so its
   checkbox completes through the real path (a recurring
   task rolls forward) and its click opens the task
   editor, exactly as in the Tasks view and the Things
   to do page. */
function buildHomeTasksWidget() {
  const parts = homeWidgetShell("tasks", "Tasks");
  const open = sortTasksForList(state.tasks.filter(
    function (t) { return t.status === "open"; })).slice(0, 8);
  if (!open.length) {
    parts.body.appendChild(homeHint("No open tasks."));
  }
  open.forEach(function (task) {
    parts.body.appendChild(buildTaskRowEl(task, { home: true }));
  });
  return parts.widget;
}

/* v2.60: capturing the pad's height. The native
   resize grip fires no events, so the v2.60 capture
   listened to a ResizeObserver on the text area and,
   when its debounce landed, measured the pad again
   and saved what it found. On Chris's real devices
   that chain never saved a dragged size at all: in
   three real Chrome sessions (the installed app
   twice, a signed-in desktop browser once) the stored
   height stayed untouched through waits, view
   switches, and full reloads, and after a reload the
   pad was already at its old size in the first Home
   view, so the dragged value never reached even the
   local cache. The harness could not see any of it:
   it fakes the two surfaces the chain stands on
   (element heights, and the observer itself, which
   the scenarios install and fire by hand). Which link
   failed out there never showed itself, so v2.60.1
   removes the dependence instead of guessing at it.
   v2.60.1: one funnel, several feeders, and a bank.
   Every feeder ends at captureHomeScratchHeight,
   which reads the live pad's height at the moment it
   is called, clamps it, and banks it as the pending
   height; the settle then persists the BANKED value,
   never a fresh measurement, so nothing downstream
   (a rebuilt element, a hidden pane, a sync landing)
   can substitute another size for the one the user
   made. The feeders:
   - The observer, as before, rerouted through the
     funnel: one net among several now.
   - Pointer release on the Home grid (pointerup and
     pointercancel, registered once by renderHome
     through ensureHomeScratchFeeders): a grip drag
     always ends in one of these, and neither depends
     on observer delivery.
   - Leaving: syncTasksPane banks and settles the
     moment the view stops being Home, while the pane
     is still laid out, and a visibilitychange to
     hidden does the same; both skip the debounce, so
     leaving fast or closing the app cannot lose the
     size.
   - A widget rebuild: buildHomeScratchWidget settles
     any banked height before it resets the baseline,
     so a drag banked inside its debounce window
     survives a rebuild landing there.
   The guards that keep the capture honest:
   - The baseline. The first size seen for a freshly
     rendered pad only seeds the baseline (that size
     is the render's own: the stored height applied,
     or the default), and a render that applies a
     stored height seeds the baseline with it
     directly, so applying a remembered size can
     never trigger a save of itself.
   - The comparisons. A size equal to the baseline,
     or to the height already stored, banks nothing:
     opening Home is write free in this field, and
     re-renders and packing passes that leave the
     pad's height alone stay silent. A height banked
     mid-drag that the pad has since come back from
     (to the stored size, or to the baseline size) is
     dropped, not saved.
   - The debounce. A banked size arms the settle
     timer; the save lands after the size settles
     (see HOME_SCRATCH_RESIZE_DEBOUNCE_MS), so a drag
     writes once, at the banked size it ended at.
     The leave and hide flushes skip the wait by
     settling at once.
   The height is content, like the pad's text, not
   layout: the save goes through persistHome directly
   (never homeLayoutTouched), so inside a customize
   session it persists at once, piggybacked on the
   pre-session layout exactly as a scratch keystroke
   does (the v2.55 CU13 pattern), and no session
   outcome, Done or Cancel, can revert or clobber it;
   a session's working copy governs the widget entries
   alone. */
let homeScratchObserver = null;
let homeScratchSaveTimer = null;
let homeScratchBaselineHeight = null;
let homeScratchPendingHeight = null;
let homeScratchFeedersReady = false;

function watchHomeScratchSize(area) {
  if (typeof ResizeObserver === "undefined") { return; }
  if (!area) { return; }
  if (!homeScratchObserver) {
    homeScratchObserver = new ResizeObserver(function () {
      captureHomeScratchHeight("observer");
    });
  }
  homeScratchObserver.disconnect();
  homeScratchObserver.observe(area);
}

/* The capture funnel: every feeder ends here. Reads
   the pad's height NOW, from the live element while
   it is laid out, and banks a genuine change as the
   pending height, arming the settle timer. The
   source names which feeder called (kept for the
   call sites' clarity); the guards make any number
   of feeders firing for one drag harmless. A pad
   with no measurable height (a hidden pane) banks
   nothing, and the first sight of a fresh render
   only seeds the baseline (see the header above). */
function captureHomeScratchHeight(source) {
  const area = document.getElementById("homeScratchText");
  if (!area) { return; }
  const raw = area.offsetHeight;
  if (!raw) { return; }
  if (homeScratchBaselineHeight === null) {
    homeScratchBaselineHeight = raw;
    return;
  }
  const measured = clampHomeScratchHeight(raw);
  if (measured === null) { return; }
  const stored = (typeof state.home.scratchHeight ===
    "number") ? state.home.scratchHeight : null;
  if (measured === stored ||
      measured === homeScratchBaselineHeight) {
    /* The pad stands at a size already accounted
       for: the stored height itself, or the size
       this render settled at. There is nothing new
       to remember, and a height banked mid-drag that
       the pad has come back from is dropped here,
       not saved. */
    if (homeScratchPendingHeight !== null) {
      homeScratchPendingHeight = null;
      if (homeScratchSaveTimer !== null) {
        clearTimeout(homeScratchSaveTimer);
        homeScratchSaveTimer = null;
      }
    }
    if (measured === stored) {
      homeScratchBaselineHeight = measured;
    }
    return;
  }
  if (homeScratchPendingHeight === measured) {
    return; /* this size is already the banked one */
  }
  homeScratchPendingHeight = measured;
  if (homeScratchSaveTimer !== null) {
    clearTimeout(homeScratchSaveTimer);
  }
  homeScratchSaveTimer = setTimeout(
    settleHomeScratchHeight, HOME_SCRATCH_RESIZE_DEBOUNCE_MS);
}

/* The save itself: persists the BANKED height, never
   a fresh measurement. The bank was clamped when it
   was taken, from the live pad, at the moment a
   feeder saw the size; what the element measures now
   (rebuilt, hidden, mid-drag) cannot substitute for
   it. Called by the settle timer, by the leave and
   hide flushes, and by buildHomeScratchWidget before
   a rebuild resets the baseline. With no bank there
   is nothing to save, and a bank that already equals
   the stored height writes nothing. */
function settleHomeScratchHeight() {
  /* v2.140: the persist below carries the pad's
     stored text with the height; land any coalesced
     typing persist first, so it never carries a
     stale pad. */
  flushScratchPadPersist();
  if (homeScratchSaveTimer !== null) {
    clearTimeout(homeScratchSaveTimer);
    homeScratchSaveTimer = null;
  }
  const banked = homeScratchPendingHeight;
  homeScratchPendingHeight = null;
  if (banked === null) { return; }
  homeScratchBaselineHeight = banked;
  if (typeof state.home.scratchHeight === "number" &&
      banked === state.home.scratchHeight) { return; }
  state.home.scratchHeight = banked;
  persistHome();
}

/* v2.60.1: the pointer and hide feeders, registered
   once (renderHome calls this with the grid it is
   about to fill). The pointer listeners sit on the
   Home grid itself, so they cannot leak into other
   views: the grid hides with its pane, and the
   funnel reads a hidden pad as no size at all
   besides. The hide listener is the document
   visibilitychange the app already uses elsewhere,
   narrowed to the hidden direction: bank and settle
   at once, while the pad is still laid out. */
function ensureHomeScratchFeeders(grid) {
  if (homeScratchFeedersReady) { return; }
  homeScratchFeedersReady = true;
  if (grid) {
    grid.addEventListener("pointerup", function () {
      captureHomeScratchHeight("pointer");
    });
    grid.addEventListener("pointercancel", function () {
      captureHomeScratchHeight("pointer");
    });
  }
  document.addEventListener("visibilitychange",
    function () {
      if (document.visibilityState === "hidden") {
        captureHomeScratchHeight("hide");
        settleHomeScratchHeight();
      }
    });
}

/* v2.105.0: what the store holds for the pad, and
   what the pad shows, are both HTML now. A stored
   value carrying no markup is a pre-v2.105 plain
   text value: it converts through the standing
   plain text converter (textToNoteBodyHtml, the
   file import's own), so its words and line breaks
   land exactly as they read. A value with markup
   stands as it is. The detector asks only whether a
   real tag stands in the string (a tag name right
   after the bracket), so plain words that merely
   mention a bracket are never mistaken for markup.
   sanitizeHome is untouched: it still carries the
   string verbatim, and the conversion lives here,
   at the pad's own boundary (the render, the empty
   test, and Create Note all read through these). */
function scratchLooksLikeHtml(s) {
  return /<\/?(p|div|br|b|strong|i|em|u|s|a|span|ul|ol|li|h[1-6]|blockquote|pre|table|figure|hr|code|mark|sub|sup)[\s>\/]/i
    .test(s) || /<br\s*\/?>/i.test(s);
}

function scratchHtmlForPad(stored) {
  const s = String(stored || "");
  if (!s.trim()) { return ""; }
  if (scratchLooksLikeHtml(s)) { return s; }
  return textToNoteBodyHtml(s);
}

/* The plain words of the stored pad, whichever form
   it stands in: what emptiness is judged on, so a
   pad holding only an empty paragraph reads empty
   exactly as a pad holding only spaces always has. */
function scratchPlainTextOf(stored) {
  const s = String(stored || "");
  if (!s) { return ""; }
  if (!scratchLooksLikeHtml(s)) { return s; }
  const holder = document.createElement("div");
  holder.innerHTML = s;
  return holder.textContent || "";
}

/* The pad's element, by its standing id (the height
   capture, the feeders, and the popups all address it
   the same way). */
function scratchPadEl() {
  return document.getElementById("homeScratchText");
}

/* Read the live pad into the store: its HTML through
   the one funnel every saved note body passes
   (canonicalizeAttachmentPlaceholders, which is also
   what strips the link faces decoration paints, so
   the store never carries runtime faces), then the
   standing persist, and the Create Note button's
   word on what stands.
   v2.140: this immediate persist is no longer what
   a keystroke runs. The build's benchmark on the
   v2.139.0 tree measured the old shape plainly: 102
   keystrokes at a steady cadence ran 102 full
   persists (about 7 ms of handler work per key) and
   211 cache snapshots, two per keystroke, because
   persistHome calls saveCache and saveIndex calls it
   again, while canonicalizeAttachmentPlaceholders
   and scratchPlainTextOf together cost under 0.2 ms
   per key. Typing now arms the coalesced persist
   below and updates the Create Note button from the
   live DOM; this function remains the immediate
   persist every deliberate pad mutation lands
   through (a toolbar command, a popup pick, the
   paste decoration pass), and it is also the flush:
   it clears any armed idle timer, so a flush and a
   scheduled persist can never both run for one
   burst. */
function persistScratchPadFromDom() {
  if (scratchPersistTimer !== null) {
    clearTimeout(scratchPersistTimer);
    scratchPersistTimer = null;
  }
  scratchPersistPending = false;
  persistScratchPadNow();
}

/* The one full persist itself, unchanged from what
   every keystroke used to run: canonicalize the
   pad's HTML into the store, persist the home field
   (the index write rides its own 800 ms debounce,
   as always), and settle the Create Note button. */
function persistScratchPadNow() {
  const area = document.getElementById("homeScratchText");
  if (!area) { return; }
  state.home.scratch =
    canonicalizeAttachmentPlaceholders(area.innerHTML);
  persistHome();
  syncScratchCreateButton();
}

/* v2.140: the coalesced typing persist. A keystroke
   mirrors the pad's HTML into the in-memory home
   field (so the state every synchronous reader sees
   is never stale) and (re)arms one idle timer,
   SCRATCH_PERSIST_IDLE_MS after the last keystroke;
   when it lands, the flush runs the full persist
   above, canonicalizing the mirror into the store,
   so a burst of typing costs one snapshot chain
   instead of two per key. Until the flush, an
   unrelated persistHome can carry the mirror as it
   stands; the flush rewrites it in canonical form
   moments later, and the stored form once the flush
   lands is byte-identical to what the old per-key
   chain stored. The flush also runs at once, ahead
   of anything that reads the pad: the pad's blur,
   Create Note, a toolbar command, the height settle
   (persistHome carries the pad's stored text with
   it), and leaving Home (syncTasksPane). A flush
   with nothing pending is a no-op, so no reader can
   ever see a stale pad and no standing caller
   changes its behavior. */
const SCRATCH_PERSIST_IDLE_MS = 400;
let scratchPersistTimer = null;
let scratchPersistPending = false;

function scheduleScratchPadPersist() {
  scratchPersistPending = true;
  if (scratchPersistTimer !== null) {
    clearTimeout(scratchPersistTimer);
  }
  scratchPersistTimer = setTimeout(function () {
    scratchPersistTimer = null;
    flushScratchPadPersist();
  }, SCRATCH_PERSIST_IDLE_MS);
}

function flushScratchPadPersist() {
  if (scratchPersistTimer !== null) {
    clearTimeout(scratchPersistTimer);
    scratchPersistTimer = null;
  }
  if (!scratchPersistPending) { return; }
  scratchPersistPending = false;
  persistScratchPadNow();
}

/* The pad's selection, saved the note toolbar's way:
   the bar's buttons take focus when pressed, so the
   range the command must act on is banked on the
   bar's mousedown and on every selection change that
   stands inside the pad, and restored before a
   command runs. */
let scratchSelRange = null;

function saveScratchSelection() {
  const area = document.getElementById("homeScratchText");
  if (!area) { return; }
  const sel = window.getSelection();
  if (sel && sel.rangeCount && area.contains(sel.anchorNode)) {
    scratchSelRange = sel.getRangeAt(0).cloneRange();
  }
}

function restoreScratchSelection() {
  const area = document.getElementById("homeScratchText");
  if (!area) { return false; }
  area.focus();
  if (scratchSelRange &&
      area.contains(scratchSelRange.startContainer) &&
      area.contains(scratchSelRange.endContainer)) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(scratchSelRange.cloneRange());
    return true;
  }
  return false;
}

/* The bar's active faces: the three marks wear the
   active dress while the caret stands inside them,
   read from the engine's own command state, and only
   while the selection stands in the pad at all. */
function syncScratchToolbar() {
  const bar = document.getElementById("homeScratchToolbar");
  const area = document.getElementById("homeScratchText");
  if (!bar || !area) { return; }
  const sel = window.getSelection();
  const inPad = !!(sel && sel.rangeCount &&
    area.contains(sel.anchorNode));
  ["bold", "italic", "underline"].forEach(function (cmd) {
    const btn = bar.querySelector(
      "[data-scratch-cmd=\"" + cmd + "\"]");
    if (!btn) { return; }
    let on = false;
    if (inPad) {
      try {
        on = !!document.queryCommandState(cmd);
      } catch (err) { on = false; }
    }
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

/* Run one bar command against the pad's selection.
   Bold, Italic, and Underline are the note editor's
   own commands (runToolbarCommand's three marks,
   aimed at the pad instead of the body); Link is the
   note editor's standing link flow (Insert, Link)
   with the pad standing where the body stands in it:
   a selection is required, the address is asked for,
   the saved range is restored, and the link is
   created. The pad's HTML is read into the store
   afterwards, like any pad edit. */
function runScratchCommand(cmd) {
  const area = document.getElementById("homeScratchText");
  if (!area) { return; }
  /* v2.140: land any coalesced typing persist
     before the command reads or changes the pad. */
  flushScratchPadPersist();
  if (cmd === "link") {
    restoreScratchSelection();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount ||
        sel.getRangeAt(0).collapsed) {
      toast("Select the text to turn into a link first.",
        true);
      return;
    }
    const url = prompt("Link address (https://...)");
    if (!url) { return; }
    restoreScratchSelection();
    try {
      document.execCommand("createLink", false, url.trim());
    } catch (err) { /* an engine without the command */ }
    decorateLinkTooltips(area);
    decorateLinkViews(area);
    persistScratchPadFromDom();
    return;
  }
  restoreScratchSelection();
  if (cmd === "bold" || cmd === "italic" ||
      cmd === "underline") {
    try {
      document.execCommand(cmd, false, null);
    } catch (err) { /* an engine without the command */ }
  }
  persistScratchPadFromDom();
  syncScratchToolbar();
}

/* A click inside the pad: the chips and links the
   popups plant are live here exactly as they are in
   a note body (the note body's own click branches,
   on the pad's element). An event chip travels to
   its event, an email chip to its message, a note
   link to its note, and a tag pill runs the tag's
   search (the tag view the sidebar's rows open).
   Any other anchor keeps the editing rule: a plain
   click only places the caret, Ctrl or Cmd click
   opens it through the checked path. */
function onScratchPadClick(ev) {
  const target = ev.target;
  if (!target || !target.closest) { return; }
  const evChip = target.closest(".ss-event-chip");
  if (evChip) {
    ev.preventDefault();
    followEventChip(evChip);
    return;
  }
  const tagPill = target.closest(".ss-tag-pill");
  if (tagPill) {
    ev.preventDefault();
    openTagFilter(tagPill.getAttribute("data-ss-tag") || "");
    return;
  }
  const mailChip = target.closest(".ss-mail-chip");
  if (mailChip) {
    ev.preventDefault();
    followMailChip(mailChip);
    return;
  }
  const anchor = target.closest("a");
  if (!anchor) { return; }
  const ssNoteId = noteLinkIdOf(anchor);
  if (ssNoteId) {
    ev.preventDefault();
    followNoteLink(ssNoteId);
    return;
  }
  if (ev.ctrlKey || ev.metaKey) {
    ev.preventDefault();
    openNoteLink(anchor.href ||
      anchor.getAttribute("href") || "");
  } else {
    /* A plain click on a web link in an editable
       surface must never navigate the app away. */
    ev.preventDefault();
  }
}

/* The Scratch Pad widget: a rich surface whose every
   input writes state and persists through the index
   writer, whose own coalescing (saveIndex's debounce)
   is the batching. It is not a note: it is never
   searched, listed, or versioned. While the pad holds
   the focus, renderHome keeps its live element (see
   there), so a sync landing mid sentence can never eat
   the sentence. v2.60: the pad's remembered height is
   applied as part of the render (see below), so the
   packing pass that follows measures the widget at the
   chosen size and the grid arranges around it from the
   first paint. v2.105.0: the surface is contenteditable
   with a formatting bar above it, and the editor
   popups (@, @@, #, ^) serve it as a third host beside
   the note body and the task description (see the
   popup sections); the chips they plant are live (see
   onScratchPadClick). */
function buildHomeScratchWidget() {
  /* v2.60.1: a height banked inside its debounce
     window belongs to the pad this build replaces;
     settle it (persist included) before the baseline
     resets below, so the rebuild cannot strand it. */
  settleHomeScratchHeight();
  const parts = homeWidgetShell("scratch", "Scratch Pad");
  parts.widget.id = "homeScratchWidget";
  /* v2.105.0: the formatting bar, at the top of the
     widget above the surface: Bold, Italic,
     Underline, and Link, in the note toolbar's own
     button shapes. The bar's mousedown banks the
     pad's selection before the press can move it. */
  const bar = document.createElement("div");
  bar.className = "home-scratch-toolbar";
  bar.id = "homeScratchToolbar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Scratch pad formatting");
  bar.addEventListener("mousedown", saveScratchSelection);
  [["bold", "Bold", "<b>B</b>"],
   ["italic", "Italic", "<i>I</i>"],
   ["underline", "Underline", "<u>U</u>"]].forEach(
    function (spec) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("data-scratch-cmd", spec[0]);
      btn.title = spec[1];
      btn.setAttribute("aria-pressed", "false");
      btn.innerHTML = spec[2];
      btn.addEventListener("click", function () {
        runScratchCommand(spec[0]);
      });
      bar.appendChild(btn);
    });
  const linkBtn = document.createElement("button");
  linkBtn.type = "button";
  linkBtn.setAttribute("data-scratch-cmd", "link");
  linkBtn.title = "Link";
  linkBtn.textContent = "Link";
  linkBtn.addEventListener("click", function () {
    runScratchCommand("link");
  });
  bar.appendChild(linkBtn);
  parts.body.appendChild(bar);
  const area = document.createElement("div");
  area.id = "homeScratchText";
  area.className = "home-scratch home-scratch-body";
  area.setAttribute("contenteditable", "true");
  area.setAttribute("data-placeholder", "Jot something down...");
  area.setAttribute("aria-label", "Scratch pad");
  area.innerHTML = scratchHtmlForPad(state.home.scratch);
  /* v2.60: a remembered height becomes the text area's
     inline height as the widget is built, before the
     packing pass measures anything; the same value
     seeds the capture baseline, so the render's own
     size is never mistaken for a resize. With no
     remembered height the baseline starts empty and
     the observer's first sight of the default size
     seeds it (see captureHomeScratchHeight). */
  homeScratchBaselineHeight = null;
  if (typeof state.home.scratchHeight === "number") {
    area.style.height = state.home.scratchHeight + "px";
    homeScratchBaselineHeight = state.home.scratchHeight;
  }
  /* v2.140: typing mirrors the pad's HTML into the
     in-memory home field (a plain read and assign,
     the cheap part of the old chain), arms the
     coalesced persist, and settles the Create Note
     button from the live DOM; the full persist lands
     on the idle timer or on the flush (see
     scheduleScratchPadPersist). */
  area.addEventListener("input", function () {
    state.home.scratch = area.innerHTML;
    scheduleScratchPadPersist();
    syncScratchCreateButton();
  });
  area.addEventListener("blur", function () {
    flushScratchPadPersist();
  });
  /* v2.116: a paste into the pad is the browser's own
     (the pad has never intercepted one), and through
     v2.115 what it landed stood undecorated until the
     next Home render: a pasted note link sat as a plain
     anchor while a picker planted one wore its Mention
     face at once. The paste is still not intercepted
     (the browser's insert and its undo step stay the
     browser's); this listener only decorates what
     landed, on the tick after the insert, with the
     same passes the pickers run over the pad, and the
     persist that follows stores the decorated pass's
     clean saved form through the one funnel, exactly
     as a picker plant's persist does. */
  area.addEventListener("paste", function () {
    setTimeout(function () {
      if (!area.isConnected) { return; }
      /* v2.116: a native paste stamps the browser's own
         font inherit style onto the pasted roots; the
         picker plants carry no such style, so a pasted
         chip would stand apart from a planted one.
         Drop the inherit declarations from chip roots
         (any other declaration stands). */
      const chipRoots = area.querySelectorAll(
        ".ss-note-link, .ss-task-link, .ss-mail-chip," +
        " .ss-event-chip");
      for (let ci = 0; ci < chipRoots.length; ci++) {
        const chipEl = chipRoots[ci];
        const styleText = chipEl.getAttribute("style");
        if (!styleText) { continue; }
        const keptDecls = [];
        const decls = styleText.split(";");
        for (let di = 0; di < decls.length; di++) {
          const decl = decls[di].trim();
          if (!decl) { continue; }
          const colonAt = decl.indexOf(":");
          if (colonAt > 0 &&
            decl.slice(colonAt + 1).trim() ===
              "inherit") {
            continue;
          }
          keptDecls.push(decl);
        }
        if (keptDecls.length) {
          chipEl.setAttribute("style",
            keptDecls.join("; ") + ";");
        } else {
          chipEl.removeAttribute("style");
        }
      }
      decorateLinkTooltips(area);
      decorateLinkViews(area);
      decorateTaskLinks(area);
      persistScratchPadFromDom();
    }, 0);
  });
  /* v2.105.0: the editor popups track the pad on its
     input events too, the note body's own wiring
     (their document selectionchange tracking stands
     over every host already). */
  area.addEventListener("input", updateMentionPopup);
  area.addEventListener("input", updateEventLinkPopup);
  area.addEventListener("input", updateTagLinkPopup);
  area.addEventListener("click", onScratchPadClick);
  parts.body.appendChild(area);
  /* v2.105.0: the note link faces resolve over the pad
     at render, as they do over a note body when a note
     opens, so a stored Mention link shows its face. */
  decorateLinkTooltips(area);
  decorateLinkViews(area);
  /* v2.72: the Create Note button: it files the pad's
     text as a note (createNoteFromScratchPad), clears
     the pad, and opens the note. It starts disabled
     while the pad is empty, so the control itself
     says when there is nothing to file.
     v2.140: the button stands in the formatting
     toolbar row, at its right end behind a spacer,
     instead of in its own actions row under the pad
     (Chris's ask, November 12, 2026); the click lands
     any coalesced typing persist first, so the note
     is filed from the pad exactly as it stands. */
  const scratchSpacer = document.createElement("span");
  scratchSpacer.className = "home-scratch-spacer";
  bar.appendChild(scratchSpacer);
  const scratchCreateBtn = document.createElement("button");
  scratchCreateBtn.type = "button";
  scratchCreateBtn.id = "homeScratchCreateBtn";
  scratchCreateBtn.className = "btn small home-scratch-create";
  scratchCreateBtn.textContent = "Create Note";
  scratchCreateBtn.disabled =
    !scratchPlainTextOf(state.home.scratch).trim();
  scratchCreateBtn.addEventListener("click", function () {
    flushScratchPadPersist();
    createNoteFromScratchPad().catch(function (err) {
      toast("Could not create the note: " + err.message, true);
    });
  });
  bar.appendChild(scratchCreateBtn);
  watchHomeScratchSize(area);
  return parts.widget;
}

/* v2.72: the Create Note button's disabled state is the
   pad's emptiness, judged on the trimmed text: a pad
   holding only spaces has nothing to file. Synced when
   the widget is built and on every keystroke.
   v2.105.0: the judgment reads the pad's words through
   its HTML (scratchPlainTextOf), so a pad holding only
   an empty paragraph is just as empty. */
function syncScratchCreateButton() {
  const btn = document.getElementById("homeScratchCreateBtn");
  if (!btn) { return; }
  /* v2.140: while the pad stands, its emptiness is
     judged on the live DOM's words, never on a
     re-parse of serialized HTML, so the per-keystroke
     sync costs a text read and nothing more. When no
     pad stands (a create that just cleared it, a
     caller off Home), the stored text judges, as
     before. */
  const area = document.getElementById("homeScratchText");
  if (area) {
    btn.disabled = !(area.textContent || "").trim();
    return;
  }
  btn.disabled = !scratchPlainTextOf(state.home.scratch).trim();
}

/* The title a Scratch Pad note wears, in the confirmed
   format: YYYY-MM-DD HH-NN-SS Scratch Pad Note, in
   local time, where NN is the minutes. */
function scratchPadNoteTitle(when) {
  function p2(n) { return (n < 10 ? "0" : "") + n; }
  return when.getFullYear() + "-" + p2(when.getMonth() + 1) + "-" +
    p2(when.getDate()) + " " + p2(when.getHours()) + "-" +
    p2(when.getMinutes()) + "-" + p2(when.getSeconds()) +
    " Scratch Pad Note";
}

/* Create Note from the Scratch Pad: the pad becomes
   a note in the default notebook (the first notebook
   while none is set), the pad clears, and the note
   opens, through createNoteInRepo's instant create
   pattern. An empty pad creates nothing and returns
   null.
   v2.105.0: the body is the pad's own HTML (through
   the one funnel every saved note body passes), so
   its formatting and its chips land intact; a legacy
   plain text pad converts on the way in, through
   scratchHtmlForPad, exactly as it renders. The
   pad's tag pills become the note's tags (the pill's
   data-ss-tag is their record, read off the body
   being filed), and each event chip registers its
   note to event link the way a chip placed in a note
   does (gcalAddNoteLinkToEvent), once per event,
   after the note stands: the event is fetched by the
   chip's own ids, and a chip whose event cannot be
   read or cannot carry the property passes quietly,
   the way the picker's own backlink treats a skipped
   write its note's chip still stands. */
async function createNoteFromScratchPad() {
  /* v2.140: the note is filed from the stored pad;
     land any coalesced typing persist first, so the
     full typed text is what gets filed. */
  flushScratchPadPersist();
  if (!scratchPlainTextOf(state.home.scratch).trim()) {
    return null;
  }
  if (!state.notebooks.length) {
    await createNotebook("Personal");
  }
  const body = canonicalizeAttachmentPlaceholders(
    scratchHtmlForPad(state.home.scratch));
  const note = makeNote(fallbackNotebookSlug(),
    scratchPadNoteTitle(new Date()), body);
  /* v2.130: a newborn note, Doc-backed like every
     newborn note (markNoteDocBacked in store.js). */
  markNoteDocBacked(note);
  const holder = document.createElement("div");
  holder.innerHTML = body;
  const tags = [];
  holder.querySelectorAll(".ss-tag-pill")
    .forEach(function (el) {
      const name = el.getAttribute("data-ss-tag") || "";
      if (name && !tags.some(function (t) {
        return t.toLowerCase() === name.toLowerCase();
      })) {
        tags.push(name);
      }
    });
  note.tags = tags;
  const chipRefs = [];
  holder.querySelectorAll(".ss-event-chip")
    .forEach(function (el) {
      const calId = el.getAttribute("data-ss-event-cal") || "";
      const evId = el.getAttribute("data-ss-event-id") || "";
      if (!calId || !evId) { return; }
      const key = calId + "|" + evId;
      if (chipRefs.some(function (r) { return r.key === key; })) {
        return;
      }
      chipRefs.push({ key: key, calId: calId, evId: evId });
    });
  state.notes.unshift(note);
  state.home.scratch = "";
  persistHome();
  const area = document.getElementById("homeScratchText");
  if (area) { area.innerHTML = ""; }
  syncScratchCreateButton();
  saveCache();
  renderAll();
  openNote(note.id);
  saveNoteToRepo(note, { skipConflictCheck: true, fresh: true })
    .then(function () { saveCache(); })
    .catch(function (err) {
      toast("Note created locally; save failed: " + err.message, true);
    });
  for (const ref of chipRefs) {
    try {
      const got = await gcalFetchEventById(ref.calId, ref.evId);
      if (got.outcome === "ok" && got.ev) {
        await gcalAddNoteLinkToEvent(got.ev, note.id);
      }
    } catch (err) { /* a backlink never breaks the create */ }
  }
  return note;
}

/* The Filtered Notes widget, bound to one saved search:
   its title is the search's name and runs the search,
   its body is the search's first matches. Unbound, it
   says what would bind it, in the state's own terms. */
function buildHomeFilteredWidget() {
  const entry = homeWidgetEntry("filtered");
  const search = entry && entry.searchId
    ? savedSearchById(entry.searchId) : null;
  const parts = homeWidgetShell("filtered", "Filtered Notes");
  if (search) {
    const titleEl = parts.head.querySelector(".home-widget-title");
    const run = document.createElement("button");
    run.type = "button";
    run.className = "home-widget-title home-filtered-run";
    run.textContent = search.name;
    run.title = "Run this search";
    run.addEventListener("click", function () {
      runSavedSearch(search);
    });
    titleEl.parentNode.replaceChild(run, titleEl);
  }
  const choose = document.createElement("button");
  choose.type = "button";
  choose.className = "home-widget-action home-filtered-choose";
  choose.textContent = search ? "Change search" : "Choose search";
  choose.addEventListener("click", function () {
    toggleHomeFilteredPicker(parts.widget);
  });
  parts.head.appendChild(choose);
  if (!state.savedSearches.length) {
    const hint = homeHint("No saved searches yet. Run a " +
      "search and choose Save search to create one.");
    hint.classList.add("home-filtered-hint");
    parts.body.appendChild(hint);
  } else if (!search) {
    const hint = homeHint("Choose a saved search to show " +
      "its notes here.");
    hint.classList.add("home-filtered-hint");
    parts.body.appendChild(hint);
  } else {
    const matches = notesMatchingSearchText(search.query)
      .slice(0, 6);
    if (!matches.length) {
      parts.body.appendChild(
        homeHint("No notes match this search."));
    }
    matches.forEach(function (n) {
      parts.body.appendChild(homeNoteRow(n, "updated"));
    });
  }
  const picker = document.createElement("div");
  picker.className = "home-filtered-picker hidden";
  parts.body.appendChild(picker);
  return parts.widget;
}

function toggleHomeFilteredPicker(widget) {
  const picker = widget.querySelector(".home-filtered-picker");
  if (!picker) { return; }
  if (!picker.classList.contains("hidden")) {
    picker.classList.add("hidden");
    return;
  }
  picker.innerHTML = "";
  const entry = homeWidgetEntry("filtered");
  if (entry && entry.searchId) {
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "home-filtered-row home-filtered-clear";
    clear.textContent = "No search";
    clear.addEventListener("click", function () {
      setHomeFilteredSearch(null);
    });
    picker.appendChild(clear);
  }
  state.savedSearches.forEach(function (s) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "home-filtered-row";
    row.setAttribute("data-search-id", s.id);
    row.textContent = s.name;
    row.addEventListener("click", function () {
      setHomeFilteredSearch(s.id);
    });
    picker.appendChild(row);
  });
  if (!state.savedSearches.length) {
    picker.appendChild(homeHint("No saved searches yet."));
  }
  picker.classList.remove("hidden");
}

/* The Tags widget: through v2.114.0 the widget borrowed
   only the sidebar tree's order and rendered the tags
   flat. v2.115 (Chris's ask): the widget renders the
   sidebar's tree itself, the same tagTreeRows the
   sidebar renders, with collapse on: each row indents
   by its depth in the sidebar's measure (14px a
   level), a tag with sub-tags carries the fold caret,
   and the caret toggles the very state.collapsedTags
   the sidebar reads, so a fold made on either surface
   shows on both (the toggle re-renders the sidebar;
   the caret here re-renders Home as well). The row
   body keeps the widget's own dress and its click
   still opens the tag the way it always has. */
function buildHomeTagsWidget() {
  const parts = homeWidgetShell("tags", "Tags");
  const tags = allTagsWithCounts();
  if (!tags.length) {
    parts.body.appendChild(homeHint("No tags yet."));
  }
  tagTreeRows(tags, true).forEach(function (row) {
    parts.body.appendChild(buildHomeTagRow(row));
  });
  return parts.widget;
}

/* One Tags widget row: the sidebar row's shape (a flex
   wrapper carrying the depth indent, a caret or the
   alignment spacer, then the row itself) in the
   widget's own row dress. */
function buildHomeTagRow(row) {
  const collapsed = state.collapsedTags.indexOf(row.tag) >= 0;
  const wrap = document.createElement("div");
  wrap.className = "home-tree-row" +
    (collapsed ? " collapsed" : "");
  wrap.setAttribute("data-tag", row.tag);
  wrap.setAttribute("data-depth", String(row.depth));
  if (row.depth > 0) {
    wrap.style.marginLeft = (row.depth * 14) + "px";
  }
  if (row.hasChildren) {
    const chev = document.createElement("button");
    chev.type = "button";
    chev.className = "home-tree-chevron";
    chev.setAttribute("aria-expanded",
      collapsed ? "false" : "true");
    chev.setAttribute("aria-label",
      (collapsed ? "Expand" : "Collapse") +
      " sub-tags of " + row.tag);
    chev.title = collapsed ? "Expand" : "Collapse";
    chev.innerHTML = STACK_CHEVRON_ICON;
    chev.addEventListener("click", function () {
      toggleTagCollapsed(row.tag);
      renderHome();
    });
    wrap.appendChild(chev);
  } else {
    const spacer = document.createElement("span");
    spacer.className = "home-tree-chevron-spacer";
    wrap.appendChild(spacer);
  }
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "home-tag-row";
  btn.setAttribute("data-tag", row.tag);
  const label = document.createElement("span");
  label.className = "home-tag-label";
  label.textContent = row.tag;
  btn.appendChild(label);
  const count = document.createElement("span");
  count.className = "home-tag-count";
  count.textContent = String(row.count);
  btn.appendChild(count);
  btn.addEventListener("click", function () {
    homeOpenTag(row.tag);
  });
  wrap.appendChild(btn);
  return wrap;
}

/* The Notebooks widget: through v2.114.0 the widget
   listed notebooksInSidebarOrder() flat. v2.115
   (Chris's ask): the widget renders the sidebar's own
   shape, walked from the sidebar's own row model
   (sidebarNotebookPlan, the same plan the sidebar
   renders): stack group headers that fold on the same
   state.collapsedStacks, notebooks nested and
   indented under their parent notebook on the same
   state.collapsedNotebooks, unstacked notebooks at
   the top level in sidebar order. The sidebar's row
   builders themselves emit sidebar chrome (the
   .nav-item dress, the stack actions menu), so the
   widget mirrors the plan in its own row dress
   instead of reusing the builders; the model, the
   indent math (a stack's 16px plus 14px a level), the
   fold state, the counts, and the click navigation
   are the sidebar's exactly (v2.137: the stack
   step is the one 14px tree step, as there). */
function buildHomeNotebooksWidget() {
  const parts = homeWidgetShell("notebooks", "Notebooks");
  if (!state.notebooks.length) {
    parts.body.appendChild(homeHint("No notebooks yet."));
  }
  sidebarNotebookPlan().forEach(function (entry) {
    if (entry.stack) {
      parts.body.appendChild(
        buildHomeStackHead(entry.stack));
      if (state.collapsedStacks.indexOf(entry.stack) < 0) {
        entry.members.forEach(function (nb) {
          homeAppendNotebookWithSubtree(
            parts.body, nb, true, 0);
        });
      }
    } else {
      homeAppendNotebookWithSubtree(
        parts.body, entry.nb, false, 0);
    }
  });
  return parts.widget;
}

/* One stack group header in the Notebooks widget: the
   sidebar head's fold toggle (chevron, name, the
   members' total count) without its actions menu,
   which is a sidebar management gesture, not a
   navigation one. The toggle runs the sidebar's own
   fold, then re-renders Home from the same state. */
function buildHomeStackHead(name) {
  const collapsed = state.collapsedStacks.indexOf(name) >= 0;
  const head = document.createElement("button");
  head.type = "button";
  head.className = "home-stack-head" +
    (collapsed ? " collapsed" : "");
  head.setAttribute("data-stack", name);
  head.setAttribute("aria-expanded",
    collapsed ? "false" : "true");
  const chev = document.createElement("span");
  chev.className = "home-stack-chevron";
  chev.setAttribute("aria-hidden", "true");
  chev.innerHTML = STACK_CHEVRON_ICON;
  head.appendChild(chev);
  const nameSpan = document.createElement("span");
  nameSpan.className = "home-stack-name";
  nameSpan.textContent = name;
  head.appendChild(nameSpan);
  const total = stackMembers(name).reduce(function (sum, nb) {
    return sum + notebookCount(nb.slug);
  }, 0);
  const count = document.createElement("span");
  count.className = "home-nb-count";
  count.textContent = String(total);
  head.appendChild(count);
  head.addEventListener("click", function () {
    toggleStackCollapsed(name);
    renderHome();
  });
  return head;
}

/* The sidebar's subtree walk (appendNotebookWithSubtree)
   mirrored for the widget: one notebook row, then,
   unless it stands folded, its whole subtree after
   it, depth first, the in-stack mark riding down. */
function homeAppendNotebookWithSubtree(body, nb, inStack, depth) {
  body.appendChild(buildHomeNotebookRow(nb, inStack, depth));
  if (state.collapsedNotebooks.indexOf(nb.slug) >= 0) {
    return;
  }
  notebookChildrenOf(nb.slug).forEach(function (kid) {
    homeAppendNotebookWithSubtree(body, kid, inStack, depth + 1);
  });
}

/* One Notebooks widget row: the widget's row dress on
   the sidebar row's geometry. A notebook with
   sub-notebooks is wrapped with the fold caret at its
   indent, exactly the sidebar's arrangement; a leaf
   row takes the indent itself. */
function buildHomeNotebookRow(nb, inStack, depth) {
  const indent = (inStack ? 14 : 0) + (depth || 0) * 14;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "home-nb-row";
  btn.setAttribute("data-slug", nb.slug);
  btn.setAttribute("data-nb-depth", String(depth || 0));
  const label = document.createElement("span");
  label.className = "home-nb-label";
  label.textContent = nb.name;
  btn.appendChild(label);
  const count = document.createElement("span");
  count.className = "home-nb-count";
  count.textContent = String(notebookCount(nb.slug));
  btn.appendChild(count);
  btn.addEventListener("click", function () {
    state.view = { kind: "notebook", value: nb.slug };
    renderAll();
    setMobileView("list");
  });
  const kids = notebookChildrenOf(nb.slug);
  if (!kids.length) {
    if (indent > 0) { btn.style.marginLeft = indent + "px"; }
    return btn;
  }
  const collapsed =
    state.collapsedNotebooks.indexOf(nb.slug) >= 0;
  const wrap = document.createElement("div");
  wrap.className = "home-tree-row" +
    (collapsed ? " collapsed" : "");
  if (indent > 0) { wrap.style.marginLeft = indent + "px"; }
  const chev = document.createElement("button");
  chev.type = "button";
  chev.className = "home-tree-chevron";
  chev.setAttribute("aria-expanded",
    collapsed ? "false" : "true");
  chev.setAttribute("aria-label",
    (collapsed ? "Expand" : "Collapse") +
    " sub-notebooks of " + nb.name);
  chev.title = collapsed ? "Expand" : "Collapse";
  chev.innerHTML = STACK_CHEVRON_ICON;
  chev.addEventListener("click", function () {
    toggleNotebookCollapsed(nb.slug);
    renderHome();
  });
  wrap.appendChild(chev);
  wrap.appendChild(btn);
  return wrap;
}

