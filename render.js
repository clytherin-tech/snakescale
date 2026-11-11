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
   9. Rendering
   All user text is placed with textContent or through escapeHtml. Note
   titles, tags, and notebook names are never injected as raw HTML. The one
   intentional exception is the note BODY in the editor: it is the user's
   own rich text HTML, loaded into the contenteditable element by design.
   -------------------------------------------------------------------------- */

/* --------------------------------------------------------------------------
   v2.21: the boot report (Settings' Last load readout)

   One object, filled in as the boot walks its stages and read
   by the readout in the Settings Connection section
   (renderLastLoadReadout below; syncSettingsControls refreshes
   it on every open). Marks are performance.now readings,
   milliseconds since this navigation began, and each is taken
   once: the first writer wins, and finalizeBootReport freezes
   the report when the boot's sync settles, so later syncs in
   the same session can never move the boot's numbers. The
   note body counter rides the same freeze: it counts every
   note file body this boot's load downloaded (the loader's
   own fetches, plus the open note's shell completion in
   syncNow), and stops counting at the freeze.

   The stages, in the order a boot meets them:
     signInReady   the Google sign in checked out live
     cachePainted  the list was painted from the device cache
     catalogRead   this boot's load read catalog.json
     listingsDone  this boot's load gathered the folder listings
     firstPaint    the list was on screen, the overlay down
     tasksReady    the tasks armed from the tasks file
                   (v2.53: lands when the tasks read does,
                   ahead of the full sync, not with it)
     synced        the boot sync settled
   A stage that did not run (no readable cache to paint, an
   offline boot that never synced) stays null and the readout
   says skipped, never a made up number.
   -------------------------------------------------------------------------- */
const bootReport = {
  marks: {
    signInReady: null, cachePainted: null, catalogRead: null,
    listingsDone: null, firstPaint: null, tasksReady: null,
    synced: null
  },
  /* The boot looked for a cache and found none usable, which
     the readout words differently from a stage that simply
     has not happened yet. */
  cacheSkipped: false,
  noteDownloads: 0,
  finalized: false
};

function bootMark(name) {
  if (bootReport.finalized) { return; }
  if (bootReport.marks[name] == null) {
    bootReport.marks[name] = performance.now();
  }
}

function bootCacheSkipped() {
  if (!bootReport.finalized) { bootReport.cacheSkipped = true; }
}

function bootCountNoteDownload() {
  if (!bootReport.finalized) { bootReport.noteDownloads++; }
}

function finalizeBootReport() {
  bootReport.finalized = true;
}

/* A mark, readably: under a second as whole milliseconds,
   above it as seconds with one decimal. A stage that never
   ran reads as skipped. */
function formatBootTime(ms) {
  if (ms == null || !isFinite(ms)) { return "skipped"; }
  if (ms < 1000) { return Math.round(ms) + " ms"; }
  return (ms / 1000).toFixed(1) + " s";
}

/* The browser's own timing for the document itself: when the
   page's response finished arriving, on the same clock as the
   marks. Absent on engines without navigation timing, where
   the readout simply leaves the line out. */
function bootNavigationTiming() {
  try {
    const entries = performance.getEntriesByType("navigation");
    if (entries && entries.length && entries[0].responseEnd) {
      return entries[0].responseEnd;
    }
  } catch (e) { /* no navigation timing: no line */ }
  return null;
}

function renderLastLoadReadout() {
  const el = document.getElementById("settingsLastLoad");
  if (!el) { return; }
  el.textContent = "";
  const m = bootReport.marks;
  const lines = [];
  const navMs = bootNavigationTiming();
  if (navMs != null) {
    lines.push("Page download: " + formatBootTime(navMs));
  }
  lines.push("Sign in ready: " + formatBootTime(m.signInReady));
  lines.push(bootReport.cacheSkipped && m.cachePainted == null
    ? "Painted from this device's cache: skipped (no readable cache)"
    : "Painted from this device's cache: " +
      formatBootTime(m.cachePainted));
  lines.push("Catalog read: " + formatBootTime(m.catalogRead));
  lines.push("Folder listings: " + formatBootTime(m.listingsDone));
  lines.push("Note bodies downloaded: " + bootReport.noteDownloads);
  lines.push("Notes on screen: " + formatBootTime(m.firstPaint));
  /* v2.53: the tasks stage, in the same style, ahead of
     the synced line it used to hide behind. */
  lines.push("Tasks ready: " + formatBootTime(m.tasksReady));
  lines.push("Fully synced: " + formatBootTime(m.synced));
  lines.forEach(function (text) {
    const row = document.createElement("div");
    row.textContent = text;
    el.appendChild(row);
  });
}

/* --------------------------------------------------------------------------
   v1.6 loading overlay and sidebar version label
   The loading overlay is plain HTML at the top of the body, so it is
   already on screen before this script runs; these helpers only steer
   it. showLoading is called when a connect flow starts from a gate
   screen (the Google sign in button, the silent renewal attempt
   inside prepareGoogleGate), and
   setLoadingStatus marks the steps the user cares about. hideLoading
   fades the overlay out once the destination screen is fully
   presented: gate screens hide it as they become interactive, and
   the app screen hides it only after the first full render of loaded
   data. Every error path that lands back on a gate hides it too, so
   the overlay can never strand the user behind an animation with a
   dead screen underneath.
   -------------------------------------------------------------------------- */
let loadingHideTimer = null;

function showLoading(statusText) {
  const overlay = document.getElementById("loadingOverlay");
  if (!overlay) { return; }
  if (loadingHideTimer) {
    clearTimeout(loadingHideTimer);
    loadingHideTimer = null;
  }
  overlay.classList.remove("hidden");
  overlay.classList.remove("hiding");
  if (statusText) { setLoadingStatus(statusText); }
}

function setLoadingStatus(text) {
  const status = document.getElementById("loadingStatus");
  if (status && text) { status.textContent = text; }
}

function hideLoading() {
  const overlay = document.getElementById("loadingOverlay");
  if (!overlay || overlay.classList.contains("hidden")) { return; }
  overlay.classList.add("hiding");
  if (loadingHideTimer) { clearTimeout(loadingHideTimer); }
  loadingHideTimer = setTimeout(function () {
    overlay.classList.add("hidden");
    overlay.classList.remove("hiding");
    loadingHideTimer = null;
  }, 300);
}

/* v1.6: write the running version into the sidebar footer from the
   APP_VERSION constant, so the label can never drift from the build
   that is actually running. Called once from boot.
   v2.50: the same call sets the document title ("SnakeScale
   Notes v" plus the version), the SnakeScale CAD discipline:
   the static title in the markup carries no version string,
   the version lives only in APP_VERSION and APP_BUILD, and
   the title is derived from it here, so the tab and the
   installed app's title bar always name the build that is
   actually running (which is also how Chris can see at a
   glance whether the self update reload has landed). The
   install name does NOT come from here: the manifest
   carries its own name and short_name, untouched. */
function renderAppVersion() {
  const el = document.getElementById("appVersion");
  if (el) { el.textContent = "Version " + APP_VERSION; }
  /* v2.68.0: the same readout inside Settings (the foot of
     the Getting started tab), from the same single source. */
  const settingsEl = document.getElementById("settingsVersion");
  if (settingsEl) {
    settingsEl.textContent = "SnakeScale Notes, version " + APP_VERSION;
  }
  document.title = "SnakeScale Notes v" + APP_VERSION;
}

function showScreen(name) {
  document.getElementById("setupScreen").classList.toggle("hidden", name !== "setup");
  document.getElementById("repoScreen").classList.toggle("hidden", name !== "repo");
  document.getElementById("app").classList.toggle("hidden", name !== "app");
  if (name === "app" && !document.body.classList.contains("view-list") &&
      !document.body.classList.contains("view-nav") &&
      !document.body.classList.contains("view-editor")) {
    document.body.classList.add("view-list");
  }
}


function renderAll() {
  syncTasksPane();
  renderSidebar();
  renderNoteList();
  renderHome();
  renderEditor();
  refreshSyncPill();
}

/* v2.24.1: which panes show follows the view. While the
   Tasks view is active, the tasks pane shows and the list
   and editor panes hide; every other view hides the tasks
   pane and shows both of them again. Nothing is rendered
   or discarded here: the panes only trade the hidden
   class, so the open note and the list survive a trip to
   Tasks and back exactly as they were. Called at the top
   of renderAll and renderNoteList, so no view change can
   leave the panes stale. */
let homeViewWasActive = null;
function syncTasksPane() {
  const tasksActive = state.view.kind === "tasks";
  /* v2.33: Home is a full main area view like Tasks:
     while it is active its pane shows and the list and
     editor panes hide, and the open note survives the
     trip exactly as it does for Tasks. */
  const homeActive = state.view.kind === "home";
  /* v2.82: Email is a full main area view like Home
     and Tasks: its pane shows, the list and editor
     panes hide, and the standing mail renders and
     loads as the pane lands. */
  const mailActive = state.view.kind === "email";
  /* v2.60.1: the moment the view stops being Home,
     bank and settle the Scratch Pad's height, while
     the pane is still laid out (the hidden class
     lands below; after it, the pad has no measurable
     size). This is the capture's leave feeder; see
     captureHomeScratchHeight. */
  if (homeViewWasActive === true && !homeActive) {
    captureHomeScratchHeight("leave");
    settleHomeScratchHeight();
  }
  homeViewWasActive = homeActive;
  document.body.classList.toggle("tasks-view", tasksActive);
  document.body.classList.toggle("home-view", homeActive);
  document.body.classList.toggle("email-view", mailActive);
  const pane = document.getElementById("taskspane");
  if (pane) { pane.classList.toggle("hidden", !tasksActive); }
  const home = document.getElementById("homepane");
  if (home) { home.classList.toggle("hidden", !homeActive); }
  const mail = document.getElementById("mailpane");
  if (mail) { mail.classList.toggle("hidden", !mailActive); }
  /* v2.104.0: the labels dropdown belongs to
     the Email view; leaving the view puts it
     away, so it never stands over another
     view's first paint on the way back. */
  if (!mailActive) { closeMailLabelsMenu(); }
  const list = document.getElementById("listpane");
  if (list) {
    list.classList.toggle("hidden",
      tasksActive || homeActive || mailActive);
  }
  const editor = document.getElementById("editorpane");
  if (editor) {
    editor.classList.toggle("hidden",
      tasksActive || homeActive || mailActive);
  }
  if (mailActive) {
    renderMail();
    ensureMailLoaded();
  }
}

/* Count helpers for the sidebar badges. */
function notebookCount(slug) {
  return state.notes.filter(function (n) { return n.notebook === slug; }).length;
}
function allTagsWithCounts() {
  const map = {};
  state.notes.forEach(function (n) {
    n.tags.forEach(function (t) { map[t] = (map[t] || 0) + 1; });
  });
  return Object.keys(map).sort().map(function (t) { return { tag: t, count: map[t] }; });
}

/* --------------------------------------------------------------------------
   v2.31: the Evernote notebook order.

   Evernote sorts its notebook tree alphabetically, by design:
   the stacks and the notebooks inside them are in alphabetical
   order, and the main tree is one alphabetical sort in which
   stack names and unstacked notebook names are considered
   together (its own forums state the rule, and a notebook
   leaving a stack slots into the main tree by its name). The
   sidebar through v2.30 never sorted: the list rendered in
   notebook storage order, and v2.29's groups took the position
   of their first member. Chris authorized reorganizing the UI
   to match Evernote on 2026-10-28, so the render order is
   Evernote's now. This is a RENDER order only: state.notebooks
   (and with it index.json) keeps its storage order, and every
   consumer below works from the plan, never by sorting the
   stored list itself.

   The comparison is case insensitive, matching the app's own
   case folded name comparison in the mention candidates; names
   that differ only by case fall back to the raw strings, so
   the order is total and stable.
   -------------------------------------------------------------------------- */
function compareSidebarNames(a, b) {
  const la = String(a).toLowerCase();
  const lb = String(b).toLowerCase();
  if (la !== lb) { return la.localeCompare(lb); }
  const sa = String(a), sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/* The sidebar notebook arrangement as a plan: one entry per
   top level row group, {stack: null, nb} for an unstacked
   notebook and {stack: name, members} for a stack, the
   entries sorted by their display name (the stack's name or
   the notebook's) and each stack's members sorted by name. */
function sidebarNotebookPlan() {
  const entries = [];
  const seenStacks = {};
  state.notebooks.forEach(function (nb) {
    /* v2.63: a nested notebook is not a top level entry;
       it renders under its parent (see
       appendNotebookWithSubtree in the sidebar render).
       The existence check keeps a damaged in-memory
       parent (unreachable after the load sanitization)
       from hiding the notebook here. */
    const parent = notebookParentOf(nb);
    if (parent !== null && notebookForSlug(parent)) { return; }
    const stack = notebookStackOf(nb);
    if (!stack) {
      entries.push({ key: nb.name, stack: null, nb: nb, members: null });
      return;
    }
    if (seenStacks[stack]) { return; }
    seenStacks[stack] = true;
    const members = stackMembers(stack).slice().sort(function (x, y) {
      return compareSidebarNames(x.name, y.name);
    });
    entries.push({ key: stack, stack: stack, nb: null, members: members });
  });
  entries.sort(function (x, y) {
    return compareSidebarNames(x.key, y.key);
  });
  return entries;
}

/* Every notebook in the sidebar's arrangement, flattened:
   a stack's members sit together at the stack's place in
   the order. The flat surfaces that list notebooks for
   choosing (the icon rail flyout, the editor's notebook
   menu, the task notebook pickers, the drag target list)
   present this order, the same one the sidebar shows. */
function notebooksInSidebarOrder() {
  const out = [];
  const seen = {};
  /* v2.63: the flattening is depth-first over the tree:
     each notebook is followed by its sub-notebooks,
     recursively, so a picker in this order reads exactly
     like the sidebar. The visited set keeps a damaged
     in-memory cycle from looping. */
  function pushSubtree(nb) {
    if (!nb || seen[nb.slug]) { return; }
    seen[nb.slug] = true;
    out.push(nb);
    notebookChildrenOf(nb.slug).forEach(pushSubtree);
  }
  sidebarNotebookPlan().forEach(function (entry) {
    if (entry.stack) {
      entry.members.forEach(pushSubtree);
    } else {
      pushSubtree(entry.nb);
    }
  });
  /* Insurance: a notebook the plan could not place (only
     a damaged in-memory state could produce one) still
     lists, at the end, rather than vanishing from the
     pickers. */
  state.notebooks.forEach(function (nb) {
    if (!seen[nb.slug]) { pushSubtree(nb); }
  });
  return out;
}

/* v2.29: one sidebar notebook row, shared by the ungrouped list
   and by stack groups so a notebook looks and behaves the same in
   both. inStack only adds the indent class.
   v2.63: depth is the row's tree depth; the indent is the
   stack class's 16px where it applies plus 14px per level,
   the tag tree's step. A notebook with sub-notebooks is
   wrapped in a flex row carrying a fold caret in the tag
   tree's disclosure style; the wrapper takes the whole
   indent and the button's own in-stack class comes off,
   so the caret sits at the indent and the button fills
   the rest of the row. */
function buildNotebookNavRow(nb, inStack, depth) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "nav-item" + (inStack ? " in-stack" : "") +
    ((state.view.kind === "notebook" && state.view.value === nb.slug) ? " active" : "");
  const nameSpan = document.createElement("span");
  nameSpan.textContent = nb.name;
  btn.appendChild(nameSpan);
  const countSpan = document.createElement("span");
  countSpan.className = "count count-pill";
  countSpan.textContent = notebookCount(nb.slug) || "";
  btn.appendChild(countSpan);
  /* v2.4: the slug rides on the row so the drag and drop hit
     test can name the notebook under the pointer. */
  btn.setAttribute("data-nb-slug", nb.slug);
  /* v2.63: the tree depth rides on the row beside the
     slug, so the rendered depth is readable from the row
     itself, like the slug is. */
  btn.setAttribute("data-nb-depth", String(depth || 0));
  btn.addEventListener("click", function () {
    state.view = { kind: "notebook", value: nb.slug };
    renderAll();
    setMobileView("list");
  });
  const kids = notebookChildrenOf(nb.slug);
  const indent = (inStack ? 16 : 0) + (depth || 0) * 14;
  if (!kids.length) {
    /* The stack class already supplies the 16px at depth
       0 in a stack; an inline indent is set only where
       the class does not already say it. */
    if (indent > 0 && !(inStack && !depth)) {
      btn.style.marginLeft = indent + "px";
    }
    return btn;
  }
  btn.classList.remove("in-stack");
  const collapsed = state.collapsedNotebooks.indexOf(nb.slug) >= 0;
  const wrap = document.createElement("div");
  wrap.className = "nav-nb-row" + (collapsed ? " collapsed" : "");
  if (indent > 0) { wrap.style.marginLeft = indent + "px"; }
  const chev = document.createElement("button");
  chev.type = "button";
  chev.className = "nav-nb-chevron";
  chev.innerHTML = STACK_CHEVRON_ICON;
  chev.setAttribute("aria-expanded", collapsed ? "false" : "true");
  chev.setAttribute("aria-label",
    (collapsed ? "Expand" : "Collapse") +
    " sub-notebooks of " + nb.name);
  chev.addEventListener("click", function () {
    toggleNotebookCollapsed(nb.slug);
  });
  wrap.appendChild(chev);
  wrap.appendChild(btn);
  return wrap;
}

/* v2.63: append one notebook row and, unless it is
   folded, its whole subtree after it, depth first: the
   tree the plan's top level entries and stack members
   root. inStack rides down the subtree, so a stacked
   notebook's descendants keep the stack's extra indent
   at every level below it. */
function appendNotebookWithSubtree(nav, nb, inStack, depth) {
  nav.appendChild(buildNotebookNavRow(nb, inStack, depth));
  if (state.collapsedNotebooks.indexOf(nb.slug) >= 0) { return; }
  notebookChildrenOf(nb.slug).forEach(function (kid) {
    appendNotebookWithSubtree(nav, kid, inStack, depth + 1);
  });
}

const STACK_CHEVRON_ICON =
  "<svg viewBox=\"0 0 16 16\" width=\"12\" height=\"12\" aria-hidden=\"true\">" +
  "<path d=\"M6 3l5 5-5 5\" stroke=\"currentColor\" stroke-width=\"1.8\" " +
  "stroke-linecap=\"round\" stroke-linejoin=\"round\" fill=\"none\"/></svg>";

/* One stack header row: the fold toggle (chevron and name) and
   the stack's own menu button. The header carries the stack name
   in a data attribute; the menu machinery below reads it back. */
function buildStackNavHead(name) {
  const collapsed = state.collapsedStacks.indexOf(name) >= 0;
  const head = document.createElement("div");
  head.className = "nav-stack-head" + (collapsed ? " collapsed" : "");
  head.setAttribute("data-stack", name);
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "nav-stack-toggle";
  toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  const chev = document.createElement("span");
  chev.className = "nav-stack-chevron";
  chev.innerHTML = STACK_CHEVRON_ICON;
  toggle.appendChild(chev);
  const nameSpan = document.createElement("span");
  nameSpan.className = "nav-stack-name";
  nameSpan.textContent = name;
  toggle.appendChild(nameSpan);
  const total = stackMembers(name).reduce(function (sum, nb) {
    return sum + notebookCount(nb.slug);
  }, 0);
  const countSpan = document.createElement("span");
  countSpan.className = "count count-pill";
  countSpan.textContent = total || "";
  toggle.appendChild(countSpan);
  toggle.addEventListener("click", function () {
    toggleStackCollapsed(name);
  });
  head.appendChild(toggle);
  const menuBtn = document.createElement("button");
  menuBtn.type = "button";
  menuBtn.className = "nav-stack-menu-btn";
  menuBtn.setAttribute("aria-haspopup", "true");
  menuBtn.setAttribute("aria-label", "Stack actions");
  menuBtn.title = "Stack actions";
  menuBtn.innerHTML = "&#8943;";
  menuBtn.addEventListener("click", function () {
    openStackMenu(name, head);
  });
  head.appendChild(menuBtn);
  return head;
}

/* Fold or unfold one stack group in the sidebar. The fold is
   remembered in settings, like the icon rail choice. */
function toggleStackCollapsed(name) {
  const i = state.collapsedStacks.indexOf(name);
  if (i >= 0) { state.collapsedStacks.splice(i, 1); }
  else { state.collapsedStacks.push(name); }
  saveSettings();
  renderSidebar();
}

/* --------------------------------------------------------------------------
   v2.62: collapsible sidebar sections. Each of the
   Shortcuts, Notebooks, and Tags sections folds under
   its header from a toggle in the label row, in the
   stack and tag rows' disclosure style. The fold is
   per device view state, remembered in settings like
   the stack and tag folds: state.collapsedSections
   names the folded sections, a section not named is
   expanded, and buildIndexObject never carries the
   record, so a fold set on one device never syncs to
   another and never rides the Home layout.
   -------------------------------------------------------------------------- */
const SIDEBAR_SECTIONS = [
  { key: "shortcuts", name: "Shortcuts",
    sectionId: "shortcutSection", bodyId: "shortcutNav",
    toggleId: "shortcutSectionToggle" },
  { key: "notebooks", name: "Notebooks",
    sectionId: "notebookSection", bodyId: "notebookNav",
    toggleId: "notebookSectionToggle" },
  { key: "tags", name: "Tags",
    sectionId: "tagSection", bodyId: "tagNav",
    toggleId: "tagSectionToggle" }
];

function isSidebarSectionCollapsed(key) {
  return state.collapsedSections.indexOf(key) >= 0;
}

/* Fold or unfold one sidebar section. The fold is
   remembered in settings, like the stack folds, and
   only re-renders the sidebar: what lives inside the
   section (shortcut order, notebook selection and
   stack folds, tag folds and counts) renders exactly
   as it did, because the render builds it the same way
   whether the section stands folded or open. */
function toggleSidebarSection(key) {
  const i = state.collapsedSections.indexOf(key);
  if (i >= 0) { state.collapsedSections.splice(i, 1); }
  else { state.collapsedSections.push(key); }
  saveSettings();
  renderSidebar();
}

/* Bring the three section headers in step with the
   remembered folds: the folded class on the section
   (the stylesheet folds the body and turns the
   chevron off it) and the toggle's expanded state and
   name. renderSidebar runs this on every pass, so a
   fold from any route (the toggle, the settings load
   at boot) shows the same way, and the header itself
   is never hidden: only the body folds away. */
function applySidebarSectionFolds() {
  SIDEBAR_SECTIONS.forEach(function (spec) {
    const section = document.getElementById(spec.sectionId);
    if (!section) { return; }
    const collapsed = isSidebarSectionCollapsed(spec.key);
    section.classList.toggle("folded", collapsed);
    const toggle = document.getElementById(spec.toggleId);
    if (toggle) {
      toggle.setAttribute("aria-expanded",
        collapsed ? "false" : "true");
      const verb = collapsed ? "Expand" : "Collapse";
      toggle.setAttribute("aria-label",
        verb + " " + spec.name + " section");
      toggle.title = verb + " section";
    }
  });
}

/* The stack header menu (Rename Stack, Delete Stack). One shared
   element parked in the notebooks section; stackMenuFor names the
   stack it was opened for. Positioned under its header at open
   time from the header's own offsets inside the section. */
let stackMenuFor = null;
function openStackMenu(name, headEl) {
  const menu = document.getElementById("stackMenu");
  if (!menu) { return; }
  if (stackMenuFor === name && !menu.classList.contains("hidden")) {
    closeStackMenu();
    return;
  }
  stackMenuFor = name;
  if (headEl) {
    menu.style.top = (headEl.offsetTop + headEl.offsetHeight + 2) + "px";
  }
  menu.classList.remove("hidden");
}
function closeStackMenu() {
  const menu = document.getElementById("stackMenu");
  if (menu) { menu.classList.add("hidden"); }
  stackMenuFor = null;
}

/* One nested tag row in the sidebar Tags list: the row wrapper
   carries the tag name and its depth for styling (and for any
   future drag gesture), the fold chevron appears only on a tag
   with sub-tags, the tag button is the same .nav-item the flat
   list always rendered (clicking it filters to exactly the
   notes carrying the tag, nesting or not), and the three dot
   button opens the tag menu. */
function buildTagNavRow(row) {
  const wrap = document.createElement("div");
  wrap.className = "nav-tag-row" +
    (state.collapsedTags.indexOf(row.tag) >= 0 ? " collapsed" : "");
  wrap.setAttribute("data-tag", row.tag);
  wrap.setAttribute("data-depth", String(row.depth));
  if (row.depth > 0) {
    wrap.style.marginLeft = (row.depth * 14) + "px";
  }
  if (row.hasChildren) {
    const collapsed = state.collapsedTags.indexOf(row.tag) >= 0;
    const chev = document.createElement("button");
    chev.type = "button";
    chev.className = "nav-tag-chevron";
    chev.setAttribute("aria-expanded", collapsed ? "false" : "true");
    chev.setAttribute("aria-label",
      (collapsed ? "Expand" : "Collapse") + " sub-tags of " + row.tag);
    chev.title = collapsed ? "Expand" : "Collapse";
    chev.innerHTML = STACK_CHEVRON_ICON;
    chev.addEventListener("click", function () {
      toggleTagCollapsed(row.tag);
    });
    wrap.appendChild(chev);
  } else {
    const spacer = document.createElement("span");
    spacer.className = "nav-tag-chevron-spacer";
    wrap.appendChild(spacer);
  }
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "nav-item tag-chip-nav" +
    ((state.view.kind === "tag" && state.view.value === row.tag)
      ? " active" : "");
  const label = document.createElement("span");
  label.textContent = "# " + row.tag;
  btn.appendChild(label);
  const count = document.createElement("span");
  count.className = "count count-pill";
  count.textContent = row.count;
  btn.appendChild(count);
  btn.addEventListener("click", function () {
    /* The flat list's click rule, unchanged: clicking the
       active tag again clears the filter back to all notes. */
    if (state.view.kind === "tag" && state.view.value === row.tag) {
      state.view = { kind: "all", value: null };
    } else {
      state.view = { kind: "tag", value: row.tag };
    }
    renderAll();
    setMobileView("list");
  });
  wrap.appendChild(btn);
  const menuBtn = document.createElement("button");
  menuBtn.type = "button";
  menuBtn.className = "nav-tag-menu-btn";
  menuBtn.setAttribute("aria-haspopup", "true");
  menuBtn.setAttribute("aria-label", "Tag actions");
  menuBtn.title = "Tag actions";
  menuBtn.innerHTML = "&#8943;";
  menuBtn.addEventListener("click", function () {
    openTagMenu(row.tag, wrap);
  });
  wrap.appendChild(menuBtn);
  return wrap;
}

/* The tag row menu (Rename Tag, Move Tag..., Move Tag to Top
   Level, Delete Tag). One shared element parked in the Tags
   section; tagMenuFor names the tag it was opened for.
   Positioned under its row at open time from the row's own
   offsets inside the section. Move Tag to Top Level is an
   item only a nested tag has (the class hides it otherwise),
   matching Evernote, where the action exists only when
   there is a level to move out of. */
let tagMenuFor = null;
function openTagMenu(tag, rowEl) {
  const menu = document.getElementById("tagMenu");
  if (!menu) { return; }
  if (tagMenuFor === tag && !menu.classList.contains("hidden")) {
    closeTagMenu();
    return;
  }
  closeTagParentPanel();
  tagMenuFor = tag;
  /* v2.31: the shortcut item's label follows the tag's
     presence in the Shortcuts list, Evernote's toggle. */
  const tagScBtn = document.getElementById("tagShortcutBtn");
  if (tagScBtn) {
    tagScBtn.textContent = hasShortcut("tag", tag)
      ? "Remove from Shortcuts" : "Add to Shortcuts";
  }
  const topBtn = document.getElementById("tagTopLevelBtn");
  if (topBtn) {
    topBtn.classList.toggle("hidden", !tagParentOf(tag));
  }
  if (rowEl) {
    menu.style.top = (rowEl.offsetTop + rowEl.offsetHeight + 2) + "px";
  }
  menu.classList.remove("hidden");
}
function closeTagMenu() {
  const menu = document.getElementById("tagMenu");
  if (menu) { menu.classList.add("hidden"); }
  tagMenuFor = null;
}

/* The Move Tag panel: one button per candidate parent, which
   is every tag except the tag itself and its own sub-tags
   (moving under either would close a cycle). Entries are
   listed in tree order with a depth marker, so a deep tag is
   recognizable as a home. tagPanelFor names the tag being
   moved; it outlives the menu, which closes when the panel
   opens. */
let tagPanelFor = null;
function openTagParentPanel(tag) {
  const panel = document.getElementById("tagParentPanel");
  if (!panel) { return; }
  tagPanelFor = tag;
  closeTagMenu();
  panel.innerHTML = "";
  const head = document.createElement("div");
  head.className = "tag-parent-head";
  head.textContent = "Move \"" + tag + "\" under";
  panel.appendChild(head);
  const banned = tagDescendantsOf(tag);
  banned.push(tag);
  let offered = 0;
  tagTreeRows(allTagsWithCounts(), false).forEach(function (row) {
    if (banned.indexOf(row.tag) >= 0) { return; }
    if (tagParentOf(tag) === row.tag) { return; }
    const item = document.createElement("button");
    item.type = "button";
    item.setAttribute("data-parent-choice", row.tag);
    if (row.depth > 0) {
      item.style.paddingLeft = (10 + row.depth * 14) + "px";
    }
    item.textContent = "# " + row.tag;
    item.addEventListener("click", function () {
      const name = item.getAttribute("data-parent-choice");
      const moving = tagPanelFor;
      closeTagParentPanel();
      if (moving) { setTagParent(moving, name); }
    });
    panel.appendChild(item);
    offered++;
  });
  if (!offered) {
    const none = document.createElement("button");
    none.type = "button";
    none.disabled = true;
    none.textContent = "No other tags";
    panel.appendChild(none);
  }
  const menu = document.getElementById("tagMenu");
  panel.style.top = menu ? menu.style.top : "";
  panel.classList.remove("hidden");
}
function closeTagParentPanel() {
  const panel = document.getElementById("tagParentPanel");
  if (panel) { panel.classList.add("hidden"); }
  tagPanelFor = null;
}

function renderSidebar() {
  document.getElementById("countAll").textContent = state.notes.length || "";
  /* v2.24: the Tasks entry's pill is the open task count. */
  document.getElementById("countTasks").textContent =
    state.tasks.filter(function (t) { return t.status === "open"; }).length || "";
  document.getElementById("countPinned").textContent =
    state.notes.filter(function (n) { return n.pinned; }).length || "";
  /* v2.35: the Reminders entry's pill is the count of
     reminders not yet marked done (done reminders still
     list in the view, they just do not ask for attention). */
  document.getElementById("countReminders").textContent =
    state.notes.filter(function (n) {
      return n.reminderAt && !n.reminderDoneAt;
    }).length || "";
  document.getElementById("countTrash").textContent = state.trash.length || "";
  document.getElementById("countArchive").textContent = state.archive.length || "";

  /* v2.33: the Home entry sits at the top of the nav,
     where Evernote keeps its own. */
  document.getElementById("navHome").classList.toggle("active",
    state.view.kind === "home");
  /* v2.82: the Email entry's highlight is its own
     view's, and every sidebar render also settles the
     mail badge (the counts move under it). */
  document.getElementById("navEmail").classList.toggle("active",
    state.view.kind === "email");
  updateMailBadge();
  document.getElementById("navAll").classList.toggle("active",
    state.view.kind === "all");
  /* v2.81: the Calendar entry is the Tasks view in its
     calendar mode wearing its own seat: it carries the
     highlight there, and Tasks carries it in list
     mode. */
  document.getElementById("navCalendar").classList.toggle("active",
    state.view.kind === "tasks" &&
      state.tasksView.mode === "calendar");
  document.getElementById("navTasks").classList.toggle("active",
    state.view.kind === "tasks" &&
      state.tasksView.mode !== "calendar");
  document.getElementById("navPinned").classList.toggle("active",
    state.view.kind === "pinned");
  document.getElementById("navReminders").classList.toggle("active",
    state.view.kind === "reminders");
  document.getElementById("navTrash").classList.toggle("active",
    state.view.kind === "trash");
  document.getElementById("navArchive").classList.toggle("active",
    state.view.kind === "archive");

  /* Notebook rows: click to open, with a count pill. Rename and
     delete used to ride along as hover links on each row; v1.8 moved
     both into the notes list toolbar's notebook menu, which runs the
     same prompt and confirm flows against the open notebook.
     v2.29: notebooks in a stack render under that stack's header,
     through the same row builder. v2.31: the arrangement is the
     Evernote order now (see sidebarNotebookPlan): stack names and
     unstacked notebook names sort together alphabetically, members
     sort inside their stack, and only the render order changed;
     the stored notebook list keeps its order underneath. */
  closeStackMenu();
  closeTagMenu();
  closeTagParentPanel();
  closeShortcutMenu();
  /* v2.32: a re-render closes the saved search menu, like
     the other sidebar menus, and refreshes the panel's rows
     when it is open, so a rename or delete shows at once. */
  closeSavedSearchMenu();
  const ssPanel = document.getElementById("savedSearchPanel");
  if (ssPanel && !ssPanel.classList.contains("hidden")) {
    renderSavedSearchPanel();
  }
  /* v2.31: the Shortcuts section, above the notebooks in the
     markup, where Evernote keeps it. Rows render in stored
     order, which is the order the shortcuts were added in.
     An entry whose target exists nowhere renders no row
     here (buildShortcutRow returns null) and is dropped
     from the stored list at the next load by
     pruneShortcuts, so the section never shows a ghost. */
  const scNav = document.getElementById("shortcutNav");
  if (scNav) {
    scNav.innerHTML = "";
    state.shortcuts.forEach(function (entry) {
      const row = buildShortcutRow(entry);
      if (row) { scNav.appendChild(row); }
    });
  }
  const nav = document.getElementById("notebookNav");
  nav.innerHTML = "";
  if (!state.notebooks.length) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.style.padding = "4px 10px";
    empty.textContent = "No notebooks yet. Use + to add one.";
    nav.appendChild(empty);
  }
  sidebarNotebookPlan().forEach(function (entry) {
    if (!entry.stack) {
      appendNotebookWithSubtree(nav, entry.nb, false, 0);
      return;
    }
    nav.appendChild(buildStackNavHead(entry.stack));
    if (state.collapsedStacks.indexOf(entry.stack) < 0) {
      entry.members.forEach(function (member) {
        appendNotebookWithSubtree(nav, member, true, 0);
      });
    }
  });

  /* Tag rows. Clicking toggles the tag filter.
     v2.30: the rows render as the nested tag tree: roots in
     the flat list's alphabetical order, each tag followed by
     its sub-tags indented under it, a collapsed tag's subtree
     omitted. Counts are unchanged (the notes carrying that
     exact tag), and the click rule is unchanged. */
  const tagNav = document.getElementById("tagNav");
  tagNav.innerHTML = "";
  const tags = allTagsWithCounts();
  if (!tags.length) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.style.padding = "4px 10px";
    empty.textContent = "No tags yet. Add tags in the editor.";
    tagNav.appendChild(empty);
  }
  tagTreeRows(tags, true).forEach(function (row) {
    tagNav.appendChild(buildTagNavRow(row));
  });

  /* v2.1.0: the sidebar foot no longer prints the Google Drive
     storage line or the storage description here (the footUser and
     footRepo elements were removed from the markup). The sync pill
     above and the foot buttons below carry the state the user needs,
     and the sidebar header already shows the signed in account. */
  const noNoteStorageLine = document.getElementById("noNoteStorageLine");
  if (noNoteStorageLine) {
    noNoteStorageLine.textContent =
      "Everything you write is saved to the SnakeScale Notes folder in " +
      "your own Google Drive as plain Markdown files, so your notes are " +
      "never locked inside this app.";
  }
  /* v2.7: the theme and sign out controls live in the sidebar
     footer's three dot menu now, not in standalone buttons whose
     labels this function used to maintain. v2.8: Dark mode moved
     on into the Settings modal's segmented control (kept in step
     by syncSettingsThemeControls), and Sign out is a static label
     in the markup. (v2.0's rule stands behind the item: it is Sign
     out for everyone; there is no lock screen and no app
     password anymore.) */
  /* v2.62: the section folds render in step with the
     sidebar, like the rail chrome below. */
  applySidebarSectionFolds();
  /* v2.5: the icon rail's chrome (toggle label, active marks,
     flyout contents) renders in step with the sidebar. */
  renderRailChrome();
}

/* --------------------------------------------------------------------------
   v2.5: the icon rail.
   The rail is the sidebar's collapsed second form, a separate
   strip (#sidebarRail) the CSS swaps in for #sidebar at desktop
   widths when body.rail is set; the setting persists in settings
   (state.sidebarRail). Most leaf buttons own no logic: their
   handlers click the full sidebar's counterparts, so New Note,
   the views, and Sign out each keep exactly one implementation.
   v2.8: the refresh and theme buttons are the exceptions by
   necessity (their counterparts moved into the Settings modal),
   and they call the shared refreshGoogleConnection and
   toggleTheme functions directly instead. v2.18: the expand
   button is a third exception, running setSidebarRail
   directly now that its old counterpart (the footer menu's
   Collapse item) is gone; the expanded sidebar's way in is
   its own footer chevron button. The Notebooks button is the one
   container: it opens the flyout, whose rows are built here in
   the same pass as the sidebar's notebook rows and navigate the
   same way they do. The flyout closes on a grace timer once the
   pointer has left both the button and the panel.
   -------------------------------------------------------------------------- */
let railFlyoutCloseTimer = null;

function renderRailChrome() {
  /* v2.7: the full sidebar's rail toggle button is gone, so
     there is no toggle label left to maintain here. v2.18:
     the way in is the expanded sidebar's footer collapse
     button and the way back is the rail's own chevron expand
     button at its foot; both run setSidebarRail directly. */
  const marks = [
    ["railAllBtn", state.view.kind === "all"],
    /* v2.82: the rail's Email button marks with its view. */
    ["railEmailBtn", state.view.kind === "email"],
    /* v2.81: the rail's Calendar button marks with the
       Tasks view's calendar mode, like its sidebar
       counterpart. */
    ["railCalendarBtn", state.view.kind === "tasks" &&
      state.tasksView.mode === "calendar"],
    ["railPinnedBtn", state.view.kind === "pinned"],
    /* v2.35: the rail's Reminders button marks with its view. */
    ["railRemindersBtn", state.view.kind === "reminders"],
    ["railTrashBtn", state.view.kind === "trash"],
    ["railArchiveBtn", state.view.kind === "archive"],
    ["railNotebooksBtn", state.view.kind === "notebook"]
  ];
  marks.forEach(function (pair) {
    const btn = document.getElementById(pair[0]);
    if (btn) { btn.classList.toggle("active", pair[1]); }
  });
  const railTheme = document.getElementById("railThemeBtn");
  if (railTheme) {
    railTheme.title =
      document.body.classList.contains("dark") ? "Light mode" : "Dark mode";
  }
  renderRailFlyoutList();
}

function renderRailFlyoutList() {
  const list = document.getElementById("railFlyoutList");
  if (!list) { return; }
  list.innerHTML = "";
  if (!state.notebooks.length) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.style.padding = "4px 8px";
    empty.textContent = "No notebooks yet. Use + New Notebook to add one.";
    list.appendChild(empty);
  }
  /* v2.31: the flyout stays a flat list (the v2.29 shape),
     but its rows follow the sidebar's Evernote order,
     flattened from the same plan. */
  notebooksInSidebarOrder().forEach(function (nb) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rail-fly-row" +
      ((state.view.kind === "notebook" && state.view.value === nb.slug) ? " active" : "");
    const nameSpan = document.createElement("span");
    nameSpan.textContent = nb.name;
    btn.appendChild(nameSpan);
    const countSpan = document.createElement("span");
    countSpan.className = "count count-pill";
    countSpan.textContent = notebookCount(nb.slug) || "";
    btn.appendChild(countSpan);
    /* The slug rides on the row so the note drag hit test can
       name the notebook under the pointer, exactly like the
       sidebar's rows. */
    btn.setAttribute("data-nb-slug", nb.slug);
    btn.addEventListener("click", function () {
      closeRailFlyout();
      state.view = { kind: "notebook", value: nb.slug };
      renderAll();
      setMobileView("list");
    });
    list.appendChild(btn);
  });
}

function openRailFlyout() {
  if (railFlyoutCloseTimer) {
    clearTimeout(railFlyoutCloseTimer);
    railFlyoutCloseTimer = null;
  }
  const flyout = document.getElementById("railFlyout");
  if (flyout) { flyout.classList.remove("hidden"); }
  const btn = document.getElementById("railNotebooksBtn");
  if (btn) { btn.setAttribute("aria-expanded", "true"); }
}

function closeRailFlyout() {
  if (railFlyoutCloseTimer) {
    clearTimeout(railFlyoutCloseTimer);
    railFlyoutCloseTimer = null;
  }
  const flyout = document.getElementById("railFlyout");
  if (flyout) { flyout.classList.add("hidden"); }
  const btn = document.getElementById("railNotebooksBtn");
  if (btn) { btn.setAttribute("aria-expanded", "false"); }
}

/* Leaving the button or the panel starts a short grace timer
   instead of closing at once, so crossing the gap between them
   never flickers the panel shut; entering either cancels it. */
function scheduleRailFlyoutClose() {
  if (railFlyoutCloseTimer) { clearTimeout(railFlyoutCloseTimer); }
  railFlyoutCloseTimer = setTimeout(function () {
    railFlyoutCloseTimer = null;
    closeRailFlyout();
  }, 300);
}

function toggleRailFlyout() {
  const flyout = document.getElementById("railFlyout");
  if (!flyout) { return; }
  if (flyout.classList.contains("hidden")) { openRailFlyout(); }
  else { closeRailFlyout(); }
}

function setSidebarRail(on) {
  state.sidebarRail = !!on;
  document.body.classList.toggle("rail", state.sidebarRail);
  if (!state.sidebarRail) { closeRailFlyout(); }
  saveSettings();
  renderRailChrome();
}

/* --------------------------------------------------------------------------
   v2.5: maximize the open note.
   A runtime view state only: body.note-maximized hides the
   sidebar and the notes list (desktop widths only, where the CSS
   rules live) and uncaps the writing column. Nothing is
   persisted. Escape leaves maximize only when nothing more
   specific is open: an active note drag cancels itself (its own
   capture handler), and every menu, panel, popup, and modal has
   its own Escape closer, so this handler defers whenever
   anyOverlayOpen reports one up.
   -------------------------------------------------------------------------- */
let editorMaximized = false;
const MAXIMIZE_ICON_EXPAND =
  "<svg viewBox=\"0 0 16 16\" width=\"13\" height=\"13\" aria-hidden=\"true\">" +
  "<path d=\"M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4\" stroke=\"currentColor\" " +
  "stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" " +
  "fill=\"none\"/></svg>";
const MAXIMIZE_ICON_RESTORE =
  "<svg viewBox=\"0 0 16 16\" width=\"13\" height=\"13\" aria-hidden=\"true\">" +
  "<path d=\"M9.5 6.5L14 2M14 6.5V2H9.5M6.5 9.5L2 14M2 9.5V14h4.5\" " +
  "stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" " +
  "stroke-linejoin=\"round\" fill=\"none\"/></svg>";

function setMaximized(on) {
  editorMaximized = !!on;
  /* v2.7: opening Maximize hides the sidebar; a sidebar footer
     menu left open would be orphaned over the note, so it
     closes as the layout changes. */
  if (editorMaximized) { closeSidebarMenu(); }
  document.body.classList.toggle("note-maximized", editorMaximized);
  const btn = document.getElementById("maximizeBtn");
  if (btn) {
    btn.setAttribute("aria-pressed", editorMaximized ? "true" : "false");
    btn.title = editorMaximized
      ? "Back to the full layout" : "Fill the window with this note";
  }
  const icon = document.getElementById("maximizeIcon");
  if (icon) {
    icon.innerHTML = editorMaximized
      ? MAXIMIZE_ICON_RESTORE : MAXIMIZE_ICON_EXPAND;
  }
  const label = document.getElementById("maximizeLabel");
  if (label) { label.textContent = editorMaximized ? "Restore" : "Maximize"; }
}

/* True while any menu, panel, popup, modal, or note drag is up.
   Consulted by the maximize Escape handler (in wireEvents) so
   Escape always deals with the innermost thing first. */
function anyOverlayOpen() {
  if (noteDrag) { return true; }
  /* v2.14: a block drag in flight counts like a note drag, so an
     Escape that cancels it never also exits Maximize. */
  if (blockDrag) { return true; }
  const ids = ["noteLinkModal", "settingsModal", "versionHistoryModal",
    /* v2.24: the task editor modal joins the set for the same
       reasons as every other dialog. */
    "taskModal",
    "nbDropOverlay", "notebookMenu",
    "railFlyout", "linkBar", "linkViewMenu", "noteLinkCard",
    "tableMenu", "cellMenu", "attMenu",
    /* v2.11: the image alignment submenu, the full screen preview,
       and the image editor overlay join the overlay set, so an
       Escape that closes any of them never also exits Maximize. */
    "attAlignMenu", "imgLightbox", "imgEditorModal",
    /* v2.12: the "@" note popup joins the set for the same reason. */
    "mentionPopup",
    /* v2.23: the Paste options popup joins the set for the same
       reason, and so the auto-sync gate treats an open paste
       popup like every other open overlay. */
    "pastePopup",
    /* v2.13: the first run walkthrough joins the set for the same
       reason: an Escape that dismisses it never exits Maximize. */
    "onboardingModal",
    /* v2.14.1: the audio card menu joins the set for the same
       reason: an Escape that closes it never exits Maximize. */
    "attCardMenu",
    /* v2.17: the tags picker joins the set for the same reason:
       an Escape that closes it never exits Maximize. */
    "tagPicker",
    "exportMenu", "sidebarMenu"];
  for (let i = 0; i < ids.length; i++) {
    const el = document.getElementById(ids[i]);
    if (el && !el.classList.contains("hidden")) { return true; }
  }
  return document.querySelectorAll(
    "#toolbar .tb-menu:not(.hidden), " +
    "#listToolbar .list-panel:not(.hidden)").length > 0;
}


/* --------------------------------------------------------------------------
   v1.8: the notes list toolbar: filters, sorting, panels, and the
   notebook menu flows.

   The toolbar sits in the list header (New Note, Filters, Sort, and
   the notebook menu). Its three panels are plain list pane chrome in
   the static HTML, nowhere near #noteBody, so nothing about them can
   ever be saved into a note.

   Filters live in state.listFilters for the session and are applied
   inside visibleNotes(), so the current view, the search text, and
   the filters always combine (AND). They persist across view and
   notebook switches until cleared. The sort choice lives in
   state.listSort and is remembered in settings between sessions.

   v1.8.1: Trash and Archive multi select. Rows in those two views
   carry a selection checkbox; the checked ids live in
   state.trashSelection and state.archiveSelection, are cleared when
   the view changes or when the set is acted on, and drive the bulk
   items the notebook menu shows in those views (Empty Trash and
   Delete Selected in Trash, Restore Selected in the Archive).
   -------------------------------------------------------------------------- */

/* True when any list filter is set. Drives the Filters button's
   active state and the filtered empty list message. */
function listFiltersActive() {
  const f = state.listFilters;
  return f.tags.length > 0 || !!f.createdFrom || !!f.createdTo ||
    !!f.updatedFrom || !!f.updatedTo;
}

/* Date range math for the filter pickers. A date input speaks in
   plain calendar days ("YYYY-MM-DD"), so a note belongs to a range
   when the local calendar day of its timestamp falls inside it,
   inclusive of both ends. An empty end leaves the range open there. */
function localDayStartMs(dayText) {
  const parts = dayText.split("-");
  return new Date(+parts[0], +parts[1] - 1, +parts[2], 0, 0, 0, 0).getTime();
}
function localDayEndMs(dayText) {
  const parts = dayText.split("-");
  return new Date(+parts[0], +parts[1] - 1, +parts[2], 23, 59, 59, 999).getTime();
}
function timestampInDayRange(iso, fromDay, toDay) {
  const t = new Date(iso).getTime();
  if (isNaN(t)) { return false; }
  if (fromDay && t < localDayStartMs(fromDay)) { return false; }
  if (toDay && t > localDayEndMs(toDay)) { return false; }
  return true;
}

/* One note against the current filters. Tags use ALL semantics: the
   note must carry every checked tag, so each tag added narrows the
   list further. Created and updated ranges are independent. */
function notePassesListFilters(note) {
  const f = state.listFilters;
  for (let i = 0; i < f.tags.length; i++) {
    if (note.tags.indexOf(f.tags[i]) < 0) { return false; }
  }
  if ((f.createdFrom || f.createdTo) &&
      !timestampInDayRange(note.created, f.createdFrom, f.createdTo)) {
    return false;
  }
  if ((f.updatedFrom || f.updatedTo) &&
      !timestampInDayRange(note.updated, f.updatedFrom, f.updatedTo)) {
    return false;
  }
  return true;
}

/* The sort half of the list order, as a comparator. The pinned first
   rule is NOT here: visibleNotes still applies it ahead of this, the
   same as before v1.8, so pinning behavior is unchanged. With the
   default choice (updated, descending) this reproduces the old list
   order exactly. Title compares as text; the dates compare as
   timestamps. Direction "asc" is A to Z for titles and oldest first
   for dates. */
function compareNotesByListSort(a, b) {
  const sort = state.listSort;
  let cmp = 0;
  if (sort.field === "title") {
    cmp = String(a.title || "").localeCompare(String(b.title || ""));
  } else if (sort.field === "created") {
    cmp = new Date(a.created) - new Date(b.created);
  } else {
    cmp = new Date(a.updated) - new Date(b.updated);
  }
  if (isNaN(cmp)) { cmp = 0; }
  return sort.dir === "asc" ? cmp : -cmp;
}

/* Panel handling. Only one of the three panels is ever open; each
   toggle button opens its panel and closes the other two, and
   renderNoteList closes all of them when the view changes. The
   document level outside click and Escape closers are wired with the
   rest of the toolbar events. */
const LIST_PANEL_IDS = ["filterPanel", "sortMenu", "nbActionMenu", "nbStackPanel", "nbParentPanel"];
function closeListPanels() {
  LIST_PANEL_IDS.forEach(function (id) {
    const panel = document.getElementById(id);
    if (panel) { panel.classList.add("hidden"); }
  });
}
function toggleListPanel(panelId) {
  const panel = document.getElementById(panelId);
  if (!panel) { return; }
  const opening = panel.classList.contains("hidden");
  closeListPanels();
  if (opening) {
    if (panelId === "filterPanel") {
      /* Rebuild the tag checkboxes on every open, so tags added or
         removed since the last open are reflected, and re-sync the
         date inputs with the stored filter values. */
      buildFilterTagList();
      syncFilterControls();
    }
    if (panelId === "sortMenu") { renderSortMenu(); }
    /* v1.8.1: the action menu's items, labels, and disabled states
       follow the view and the current multi select sets, so refresh
       them at open time as well as on every list render. */
    if (panelId === "nbActionMenu") { renderListToolbar(); }
    /* v2.29: the stack panel's items depend on which stacks
       exist right now and which one the open notebook is in, so
       the panel is rebuilt at every open, like the filter tag
       list above. */
    if (panelId === "nbStackPanel") { buildStackPanel(); }
    /* v2.63: the parent panel's items depend on the tree
       right now (the eligible parents, the current one),
       so it is rebuilt at every open, like the stack
       panel above. */
    if (panelId === "nbParentPanel") { buildParentPanel(); }
    panel.classList.remove("hidden");
  }
}

/* v2.29: build the Add to Stack panel for the open notebook:
   "New stack..." first (Evernote's order), then one item per
   existing stack in sidebar order, the notebook's current stack
   marked with a check so re-picking it is a visible no-op rather
   than a mystery. Picking an item runs the assignment and the
   shared panel closer dismisses the panel, the same dismissal
   the other panels get from their item handlers. */
function buildStackPanel() {
  const panel = document.getElementById("nbStackPanel");
  if (!panel) { return; }
  panel.innerHTML = "";
  if (state.view.kind !== "notebook") { return; }
  const slug = state.view.value;
  const nb = state.notebooks.find(function (n) { return n.slug === slug; });
  if (!nb) { return; }
  const current = notebookStackOf(nb);
  const newItem = document.createElement("button");
  newItem.type = "button";
  newItem.className = "list-menu-item";
  newItem.setAttribute("role", "menuitem");
  newItem.setAttribute("data-stack-choice", "new");
  newItem.textContent = "New stack...";
  newItem.addEventListener("click", function () {
    closeListPanels();
    promptAddNotebookToNewStack(slug);
  });
  panel.appendChild(newItem);
  /* v2.31: the existing stacks list alphabetically, the
     order the sidebar itself now shows them in. */
  stackNames().slice().sort(compareSidebarNames).forEach(function (name) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "list-menu-item";
    item.setAttribute("role", "menuitem");
    item.setAttribute("data-stack-name", name);
    item.textContent = name + (name === current ? " (current)" : "");
    item.addEventListener("click", function () {
      closeListPanels();
      setNotebookStack(slug, name).catch(function (err) {
        toast("Add to stack failed: " + err.message, true);
      });
    });
    panel.appendChild(item);
  });
}

/* v2.63: build the Move to panel for the open notebook:
   "Top level" first, then every eligible parent in tree
   order (notebooksInSidebarOrder, indented by depth so
   the panel reads like the sidebar), the current parent
   (or Top level) marked "(current)" so re-picking it is
   a visible no-op rather than a mystery. The notebook
   itself and its whole subtree are excluded: neither can
   ever be its parent (setNotebookParent refuses them
   too, so the panel and the write path agree). Picking
   an item runs the move and the shared panel closer
   dismisses the panel. */
function buildParentPanel() {
  const panel = document.getElementById("nbParentPanel");
  if (!panel) { return; }
  panel.innerHTML = "";
  if (state.view.kind !== "notebook") { return; }
  const slug = state.view.value;
  const nb = notebookForSlug(slug);
  if (!nb) { return; }
  const current = notebookParentOf(nb);
  const excluded = {};
  excluded[slug] = true;
  notebookDescendantsOf(slug).forEach(function (s) {
    excluded[s] = true;
  });
  function addItem(value, label, depth) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "list-menu-item";
    item.setAttribute("role", "menuitem");
    item.setAttribute("data-nb-parent", value);
    if (depth > 0) {
      item.style.paddingLeft = (9 + depth * 16) + "px";
    }
    item.textContent = label;
    item.addEventListener("click", function () {
      closeListPanels();
      setNotebookParent(slug, value === "" ? null : value)
        .catch(function (err) {
          toast("Move failed: " + err.message, true);
        });
    });
    panel.appendChild(item);
  }
  addItem("", "Top level" + (current === null ? " (current)" : ""), 0);
  notebooksInSidebarOrder().forEach(function (cand) {
    if (excluded[cand.slug]) { return; }
    addItem(cand.slug,
      cand.name + (cand.slug === current ? " (current)" : ""),
      notebookDepthOf(cand));
  });
}

/* The filter panel's tag checkbox list, derived from the same source
   as the sidebar tag list (allTagsWithCounts over the live notes),
   so the two can never disagree about which tags exist. */
function buildFilterTagList() {
  const box = document.getElementById("filterTagList");
  if (!box) { return; }
  box.innerHTML = "";
  const tags = allTagsWithCounts();
  if (!tags.length) {
    const empty = document.createElement("div");
    empty.className = "filter-empty";
    empty.textContent = "No tags yet.";
    box.appendChild(empty);
    return;
  }
  /* v2.30: the rows follow the tag tree (no folding here:
     every tag stays checkable), each indented by its depth. */
  tagTreeRows(tags, false).forEach(function (entry) {
    const row = document.createElement("label");
    row.className = "filter-tag-row";
    if (entry.depth > 0) {
      row.style.paddingLeft = (entry.depth * 16) + "px";
    }
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = state.listFilters.tags.indexOf(entry.tag) >= 0;
    cb.addEventListener("change", function () {
      const chosen = state.listFilters.tags;
      const at = chosen.indexOf(entry.tag);
      if (cb.checked && at < 0) { chosen.push(entry.tag); }
      if (!cb.checked && at >= 0) { chosen.splice(at, 1); }
      /* Re-render the list at once; the panel itself stays open
         (renderNoteList only closes panels on a view change). */
      renderNoteList();
    });
    row.appendChild(cb);
    const name = document.createElement("span");
    name.textContent = entry.tag;
    row.appendChild(name);
    const count = document.createElement("span");
    count.className = "filter-tag-count";
    count.textContent = entry.count;
    row.appendChild(count);
    box.appendChild(row);
  });
}

/* Push the stored filter values into the panel's date inputs. Called
   when the panel opens and after Clear all, so what the panel shows
   is always the filter that is actually applied. */
function syncFilterControls() {
  const f = state.listFilters;
  const values = {
    filterCreatedFrom: f.createdFrom,
    filterCreatedTo: f.createdTo,
    filterUpdatedFrom: f.updatedFrom,
    filterUpdatedTo: f.updatedTo
  };
  Object.keys(values).forEach(function (id) {
    const input = document.getElementById(id);
    if (input && input.value !== values[id]) { input.value = values[id]; }
  });
}

/* Clear all: every filter control and the state behind it reset, and
   the list re-renders unfiltered. The panel stays open. */
function clearListFilters() {
  state.listFilters = {
    tags: [], createdFrom: "", createdTo: "", updatedFrom: "", updatedTo: ""
  };
  buildFilterTagList();
  syncFilterControls();
  renderNoteList();
}

/* The sort menu's check mark and direction arrow follow the current
   choice, so the menu always shows what is in effect (and the choice
   itself is remembered in settings by chooseListSort). */
function renderSortMenu() {
  document.querySelectorAll("#sortMenu [data-sort]").forEach(function (btn) {
    const isActive = btn.getAttribute("data-sort") === state.listSort.field;
    btn.querySelector(".sort-check").textContent = isActive ? "✓" : "";
    btn.querySelector(".sort-dir").textContent =
      isActive ? (state.listSort.dir === "asc" ? "↑" : "↓") : "";
    btn.classList.toggle("active", isActive);
  });
}

/* One sort menu click. A new field takes its natural default
   direction (Title ascending, dates descending); clicking the field
   already in use flips its direction. Either way the choice is saved
   to settings, the menu closes, and the list re-renders. */
function chooseListSort(field) {
  if (state.listSort.field === field) {
    state.listSort.dir = state.listSort.dir === "asc" ? "desc" : "asc";
  } else {
    state.listSort = { field: field, dir: field === "title" ? "asc" : "desc" };
  }
  saveSettings();
  closeListPanels();
  renderNoteList();
}

/* The toolbar's view dependent states, refreshed on every list
   render and whenever a multi select checkbox changes: New Note is
   disabled in Trash and in the Archive (with a tooltip saying why),
   the Filters button carries its active class while any filter is
   set, and the action menu adapts to the view (v1.8.1). Notebook
   views get Rename Notebook and Delete Notebook, enabled. The
   combined views (All Notes, Pinned, a tag) keep those two items
   visible but disabled, as v1.8 had them, since there is no single
   notebook to act on. Trash swaps them for Empty Trash and Delete
   Selected, the Archive for Restore Selected; the bulk items carry
   the selection count in their label and are disabled when they
   would have nothing to act on. */
function renderListToolbar() {
  const kind = state.view.kind;
  /* v2.24: the notes list toolbar is note furniture; the Tasks
     view carries its own controls, so the toolbar hides there. */
  const toolbarEl = document.getElementById("listToolbar");
  if (toolbarEl) {
    toolbarEl.classList.toggle("hidden", kind === "tasks");
  }
  const newBtn = document.getElementById("listNewNoteBtn");
  if (newBtn) {
    newBtn.disabled = kind === "trash" || kind === "archive";
    newBtn.title = kind === "trash"
      ? "New notes cannot be created in Trash"
      : kind === "archive"
        ? "New notes cannot be created in the Archive"
        : "New note";
  }
  const filterBtn = document.getElementById("listFilterBtn");
  if (filterBtn) {
    filterBtn.classList.toggle("has-filters", listFiltersActive());
  }
  const inNotebook = kind === "notebook";
  const renameBtn = document.getElementById("nbRenameBtn");
  const deleteBtn = document.getElementById("nbDeleteBtn");
  if (renameBtn) {
    renameBtn.classList.toggle("hidden", kind === "trash" || kind === "archive");
    renameBtn.disabled = !inNotebook;
  }
  if (deleteBtn) {
    deleteBtn.classList.toggle("hidden", kind === "trash" || kind === "archive");
    deleteBtn.disabled = !inNotebook;
  }
  /* v2.29: the stack items follow the notebook items' rules.
     Add to Stack shows and enables exactly like Rename; Remove
     from Stack shows only in a notebook view whose notebook is
     actually in a stack (there is nothing to remove otherwise),
     and its label names the stack it would leave, Evernote's
     clarity about what the click does. */
  const addStackBtn = document.getElementById("nbAddToStackBtn");
  if (addStackBtn) {
    addStackBtn.classList.toggle("hidden", kind === "trash" || kind === "archive");
    addStackBtn.disabled = !inNotebook;
  }
  const removeStackBtn = document.getElementById("nbRemoveFromStackBtn");
  if (removeStackBtn) {
    const openNb = inNotebook ? state.notebooks.find(function (n) {
      return n.slug === state.view.value;
    }) : null;
    const openStack = openNb ? notebookStackOf(openNb) : null;
    removeStackBtn.classList.toggle("hidden", !openStack);
    removeStackBtn.disabled = !openStack;
    removeStackBtn.textContent = openStack
      ? "Remove from Stack (" + openStack + ")"
      : "Remove from Stack";
  }
  /* v2.63: Move to... follows Rename's rules exactly
     (hidden in Trash and Archive, enabled only in a
     notebook view); it opens the parent panel below. */
  const moveBtn = document.getElementById("nbMoveBtn");
  if (moveBtn) {
    moveBtn.classList.toggle("hidden",
      kind === "trash" || kind === "archive");
    moveBtn.disabled = !inNotebook;
  }
  /* v2.130: the notebook menu's Doc switch item is
     gone: every notebook stores new notes as Google
     Docs now, so there is no per-notebook choice left
     for the menu to carry (see notebooks.js). */
  /* v2.31: the notebook shortcut item sits with the notebook
     items and follows their rules exactly (shown and enabled
     like Rename). Its label names its target, because this
     menu mixes notebook items with note items, and it flips
     with the open notebook's presence in the Shortcuts
     list. */
  const nbShortcutBtn = document.getElementById("nbShortcutNbBtn");
  if (nbShortcutBtn) {
    nbShortcutBtn.classList.toggle("hidden",
      kind === "trash" || kind === "archive");
    nbShortcutBtn.disabled = !inNotebook;
    nbShortcutBtn.textContent = inNotebook &&
      hasShortcut("notebook", state.view.value)
      ? "Remove Notebook from Shortcuts"
      : "Add Notebook to Shortcuts";
  }
  /* v2.2: the pin item sits with the notebook items. It is part of
     the menu in All Notes, Pinned, tag, and notebook views, and not
     part of it at all in Trash and Archive, where the menu carries
     only the view's bulk actions. Its label follows the selected
     note, and it is enabled only when the selection is a live note
     (present in state.notes, so never a trashed or archived one). */
  const pinBtn = document.getElementById("nbPinBtn");
  if (pinBtn) {
    pinBtn.classList.toggle("hidden", kind === "trash" || kind === "archive");
    const selected = currentNote();
    const liveSelected = selected &&
      state.notes.indexOf(selected) >= 0 ? selected : null;
    pinBtn.disabled = !liveSelected;
    pinBtn.textContent = liveSelected && liveSelected.pinned
      ? "Unpin note" : "Pin note";
  }
  /* v2.31: the note shortcut item sits beside the pin item
     and follows its rules exactly: hidden in Trash and
     Archive, enabled only for a live selected note, and its
     label flips with the note's presence in the Shortcuts
     list. */
  const noteShortcutBtn = document.getElementById("nbShortcutNoteBtn");
  if (noteShortcutBtn) {
    noteShortcutBtn.classList.toggle("hidden",
      kind === "trash" || kind === "archive");
    const selected = currentNote();
    const liveSelected = selected &&
      state.notes.indexOf(selected) >= 0 ? selected : null;
    noteShortcutBtn.disabled = !liveSelected;
    noteShortcutBtn.textContent = liveSelected &&
      hasShortcut("note", liveSelected.id)
      ? "Remove Note from Shortcuts"
      : "Add Note to Shortcuts";
  }
  /* v2.58: the Pin to Home item and its sync are gone
     (the Pinned Notes widget reads the notes' own pins). */
  /* v2.35: the Reminder item follows the same rules again:
     hidden in Trash and Archive, enabled only for a live
     selected note, and its label flips between Add reminder
     and Edit reminder with the note's reminder state. */
  const reminderBtn = document.getElementById("nbReminderBtn");
  if (reminderBtn) {
    reminderBtn.classList.toggle("hidden",
      kind === "trash" || kind === "archive");
    const selected = currentNote();
    const liveSelected = selected &&
      state.notes.indexOf(selected) >= 0 ? selected : null;
    reminderBtn.disabled = !liveSelected;
    reminderBtn.textContent = liveSelected && liveSelected.reminderAt
      ? "Edit reminder"
      : "Add reminder";
  }
  /* v2.38: Save as Template follows the reminder item's
     rule exactly (hidden in Trash and Archive, enabled
     only for a live selected note): a template is saved
     from a live note, never from Trash or the Archive. */
  const saveTemplateBtn = document.getElementById("nbSaveTemplateBtn");
  if (saveTemplateBtn) {
    saveTemplateBtn.classList.toggle("hidden",
      kind === "trash" || kind === "archive");
    const selected = currentNote();
    const liveSelected = selected &&
      state.notes.indexOf(selected) >= 0 ? selected : null;
    saveTemplateBtn.disabled = !liveSelected;
  }
  /* v2.39: Duplicate note follows the template item's rule
     exactly (hidden in Trash and Archive, enabled only for
     a live selected note): a copy is made from a live note,
     never from Trash or the Archive. */
  const duplicateBtn = document.getElementById("nbDuplicateBtn");
  if (duplicateBtn) {
    duplicateBtn.classList.toggle("hidden",
      kind === "trash" || kind === "archive");
    const selected = currentNote();
    const liveSelected = selected &&
      state.notes.indexOf(selected) >= 0 ? selected : null;
    duplicateBtn.disabled = !liveSelected;
  }
  /* v2.39: Merge Selected is the live views' bulk action,
     the mirror of Delete Selected: hidden in Trash and the
     Archive (whose own bulk items are above), enabled once
     two or more live notes are checked, and counting the
     selection in its label. */
  const mergeSelectedBtn = document.getElementById("nbMergeSelectedBtn");
  if (mergeSelectedBtn) {
    mergeSelectedBtn.classList.toggle("hidden",
      kind === "trash" || kind === "archive");
    const count = state.listSelection.length;
    mergeSelectedBtn.disabled = count < 2;
    mergeSelectedBtn.textContent = count >= 2
      ? "Merge Selected (" + count + ")"
      : "Merge Selected";
  }
  /* v2.41: Create Table of Contents Note follows Merge
     Selected's rule: hidden in Trash and the Archive,
     enabled once two or more live notes are checked. Its
     label keeps Evernote's command name at every count,
     where Merge counts the selection in its own. */
  const tocNoteBtn = document.getElementById("nbTocNoteBtn");
  if (tocNoteBtn) {
    tocNoteBtn.classList.toggle("hidden",
      kind === "trash" || kind === "archive");
    tocNoteBtn.disabled = state.listSelection.length < 2;
  }
  const emptyTrashBtn = document.getElementById("nbEmptyTrashBtn");
  if (emptyTrashBtn) {
    emptyTrashBtn.classList.toggle("hidden", kind !== "trash");
    emptyTrashBtn.disabled = state.trash.length === 0;
  }
  const deleteSelectedBtn = document.getElementById("nbDeleteSelectedBtn");
  if (deleteSelectedBtn) {
    deleteSelectedBtn.classList.toggle("hidden", kind !== "trash");
    const count = state.trashSelection.length;
    deleteSelectedBtn.disabled = count === 0;
    deleteSelectedBtn.textContent = count
      ? "Delete Selected (" + count + ")"
      : "Delete Selected";
  }
  const restoreSelectedBtn = document.getElementById("nbRestoreSelectedBtn");
  if (restoreSelectedBtn) {
    restoreSelectedBtn.classList.toggle("hidden", kind !== "archive");
    const count = state.archiveSelection.length;
    restoreSelectedBtn.disabled = count === 0;
    restoreSelectedBtn.textContent = count
      ? "Restore Selected (" + count + ")"
      : "Restore Selected";
  }
  const menuBtn = document.getElementById("listNbMenuBtn");
  if (menuBtn) {
    const label = kind === "trash" ? "Trash options"
      : kind === "archive" ? "Archive options" : "Notebook options";
    menuBtn.title = label;
    menuBtn.setAttribute("aria-label", label);
  }
  renderSortMenu();
}

/* The rename and delete notebook flows, prompt and confirm included.
   Through v1.7.2 these lived on hover links in the sidebar notebook
   rows; v1.8 keeps exactly one home for them, the list toolbar's
   notebook menu, with the wording unchanged. */
function promptRenameNotebook(slug) {
  const nb = state.notebooks.find(function (n) { return n.slug === slug; });
  if (!nb) { return; }
  const next = prompt("Rename notebook", nb.name);
  if (next && next.trim() && next.trim() !== nb.name) {
    renameNotebook(nb.slug, next.trim()).catch(function (err) {
      toast("Rename failed: " + err.message, true);
    });
  }
}
function confirmDeleteNotebook(slug) {
  const nb = state.notebooks.find(function (n) { return n.slug === slug; });
  if (!nb) { return; }
  const count = notebookCount(nb.slug);
  /* v2.63: with sub-notebooks present, the copy says what
     happens to them: they move up a level (to this
     notebook's own parent, or top level) and are NOT
     deleted. Only this notebook's own notes trash. */
  const kids = notebookChildrenOf(nb.slug);
  let msg = "Delete the notebook \"" + nb.name + "\"? Its " +
    count + " note(s) will be moved to Trash, not deleted.";
  if (kids.length) {
    const parentSlug = notebookParentOf(nb);
    const parentNb = parentSlug ? notebookForSlug(parentSlug) : null;
    msg += " Its " + kids.length + " sub-notebook(s) will NOT" +
      " be deleted; they will move up to " +
      (parentNb ? "\"" + parentNb.name + "\"" : "the top level") +
      ".";
  }
  const ok = confirm(msg);
  if (ok) {
    deleteNotebook(nb.slug).catch(function (err) {
      toast("Delete failed: " + err.message, true);
    });
  }
}

/* v2.29: the stack flows, in the same prompt and confirm shapes
   as the notebook flows above (this app's established pattern;
   Evernote offers the same choices from menus). Creating a stack
   whose name is taken is refused with a message, the way Evernote
   treats stack names as one grouping per name. */
function promptAddNotebookToNewStack(slug) {
  const nb = state.notebooks.find(function (n) { return n.slug === slug; });
  if (!nb) { return; }
  const name = prompt("New stack name", "");
  if (name === null) { return; }
  const trimmed = name.trim();
  if (!trimmed) {
    toast("A stack needs a name.", true);
    return;
  }
  if (stackNameTaken(trimmed, null)) {
    toast("A stack named \"" + trimmed + "\" already exists.", true);
    return;
  }
  setNotebookStack(slug, trimmed).catch(function (err) {
    toast("Add to stack failed: " + err.message, true);
  });
}
function promptRenameStack(oldName) {
  const name = prompt("Rename stack", oldName);
  if (name === null) { return; }
  const trimmed = name.trim();
  if (!trimmed || trimmed === oldName) { return; }
  if (stackNameTaken(trimmed, oldName)) {
    toast("A stack named \"" + trimmed + "\" already exists.", true);
    return;
  }
  renameStack(oldName, trimmed).catch(function (err) {
    toast("Rename failed: " + err.message, true);
  });
}
function confirmDeleteStack(name) {
  const count = stackMembers(name).length;
  const ok = confirm("Delete the stack \"" + name + "\"? The " +
    count + " notebook(s) in it will NOT be deleted; they will " +
    "return to the ungrouped notebook list, with all their notes.");
  if (ok) {
    deleteStack(name).catch(function (err) {
      toast("Delete failed: " + err.message, true);
    });
  }
}

/* v2.2: toggle the selected note's pinned flag, from the Pin note /
   Unpin note item in the notes list toolbar menu. The flag lives on
   the note object (collectEditor never reads it from a form control
   anymore), the change persists through the same per note save path
   every other edit uses (saveNoteToRepo, which queues when Google
   cannot be reached), and the list re-renders so the PINNED card
   marker, the Pinned view membership, and the menu label all follow
   at once. */
/* The per-note pin toggle (v2.58: extracted from
   toggleSelectedNotePin, which is now this with the
   selected note). The flag flips on the note object, the
   list re-renders, the change persists through the same
   per note save path every other edit uses, and the
   list re-renders again so the PINNED card marker, the
   Pinned view membership, and every pin label follow at
   once. The context menu's Pin note item and its Pin all
   run this same operation per note. */
async function toggleNotePin(note) {
  if (!note || state.notes.indexOf(note) < 0) { return; }
  note.pinned = !note.pinned;
  renderNoteList();
  try {
    await saveNoteToRepo(note);
  } catch (err) {
    toast("Could not save the pin change: " + err.message, true);
  }
  renderNoteList();
}

async function toggleSelectedNotePin() {
  await toggleNotePin(currentNote());
}

/* --------------------------------------------------------------------------
   v1.8.1: Trash and Archive multi select actions
   The selection sets themselves live in state (trashSelection and
   archiveSelection) and are filled by the row checkboxes that
   renderNoteList draws in those two views. They are cleared when
   the view changes (see renderNoteList) and at the start of the
   action they fed, so a set can never act twice or leak into
   another view.
   v2.39: a third set joins the family, listSelection, filled by
   the same row checkboxes now drawn in every live view too, and
   feeding the one live bulk action, Merge Selected. It follows
   the same clearing rules as the other two.
   v2.58: the checkboxes are gone. The sets are filled by the
   cards' own modifier clicks and by the touch selection mode,
   and read by exactly the same consumers; see the v2.58 section
   below (handleNoteCardClick and friends).
   -------------------------------------------------------------------------- */

/* Empty the selection sets. Called on every view change and after
   a bulk action runs. */
function clearListSelections() {
  state.trashSelection = [];
  state.archiveSelection = [];
  state.listSelection = [];
  /* v2.58: the selection anchor belongs to the sets' view;
     it goes with them. */
  listSelectionAnchor = null;
}

/* One card's membership toggled (v2.58: by a modifier click
   or a selection mode tap, the inputs that replaced the row
   checkbox this function was written for): record it in the
   current view's set, then refresh the toolbar so the menu
   labels and disabled states follow the selection at once. */
function toggleListSelection(noteId, checked) {
  const set = state.view.kind === "trash" ? state.trashSelection
    : state.view.kind === "archive" ? state.archiveSelection
    : state.listSelection;
  const at = set.indexOf(noteId);
  if (checked && at < 0) { set.push(noteId); }
  if (!checked && at >= 0) { set.splice(at, 1); }
  renderListToolbar();
}


/* --------------------------------------------------------------------------
   v2.58: checkbox-free selection and the note context menu

   Through v2.57 every note card carried a selection
   checkbox feeding the three selection sets. The sets
   and their consumers are unchanged (state.listSelection
   for live views, state.trashSelection and
   state.archiveSelection for theirs; Duplicate, Merge
   Selected, Create TOC Note, and the Trash and Archive
   bulk actions read them exactly as before, and the sets
   still clear on every view change). What changed is
   the input and the indicator:

   - A plain click opens the note, as it always has, and
     also makes that note the whole selection and the
     selection anchor (the file manager rule).
   - Ctrl+click (or Cmd+click) toggles the card in the
     selection without opening it, and moves the anchor
     to it.
   - Shift+click selects the contiguous range from the
     anchor to the clicked card in the currently rendered
     order, without opening; with no anchor yet in this
     view the first rendered card is the anchor.
     Ctrl+Shift+click adds the range instead of
     replacing the selection.
   - The indicator is the card's multi-selected treatment
     (the themed selected fill), no checkbox.

   Touch has no modifier keys, so selection there starts
   from the context menu's Select item, which enters a
   selection MODE (noteSelectMode, in memory on this
   device only): the selection bar shows, seeded with
   that note, plain taps toggle cards instead of opening
   them, and the bar's Done control leaves the mode.
   Leaving the mode KEEPS the selection: the selection's
   other exits today (the bulk actions) consume it rather
   than discarding it, and a mode entered by accident
   costs nothing because the next plain tap outside the
   mode collapses the selection anyway. The mode ends
   when the view changes, with the sets.

   The context menu itself (openNoteContextMenu) opens
   on a card's contextmenu event, suppressed so the
   browser's menu never appears, and on touch from a
   long press of about 500 ms that stays within a small
   movement tolerance (a moved press is a scroll and
   opens nothing; the press no longer arms note dragging
   either, see onNoteListPointerDown). The menu mirrors
   the per-note actions that exist for the card's
   collection and calls the same handlers they use; on a
   card that belongs to a selection of two or more it
   targets the whole selection instead. It is a fixed
   panel at the pointer, flipped and clamped into the
   viewport, closing on an outside press, Escape (which
   returns focus to the card), scroll, resize, and any
   item activation, with menu semantics for the keyboard.
   -------------------------------------------------------------------------- */

/* The selection anchor: the card a Shift+click range
   runs from. In memory only; reset whenever the sets
   clear, so an anchor never outlives its view. */
let listSelectionAnchor = null;

/* The touch selection mode (see the section header).
   In memory only, per device, never persisted. */
let noteSelectMode = false;

/* The current view's selection set: the one every
   consumer reads, picked by the view kind exactly the
   way toggleListSelection writes it. */
function currentSelectionSet() {
  return state.view.kind === "trash" ? state.trashSelection
    : state.view.kind === "archive" ? state.archiveSelection
    : state.listSelection;
}

/* The note ids of the rendered cards, in rendered order:
   the order Shift+click ranges run in. Tiles are not
   cards and never appear here. */
function renderedNoteCardIds() {
  const cards = document.querySelectorAll(
    "#noteList .note-card[data-note-id]");
  return Array.prototype.map.call(cards, function (c) {
    return c.getAttribute("data-note-id");
  });
}

/* Repaint after a selection input that does not open a
   note: the list (the card treatments and the mode's
   bar) and the toolbar (the count driven labels). */
function refreshSelectionUI() {
  renderNoteList();
  renderListToolbar();
}

/* One card click, every modifier rule (see the section
   header). Wired in renderNoteList in place of the plain
   openNote call the card's click used to make. */
function handleNoteCardClick(ev, note) {
  const set = currentSelectionSet();
  if (noteSelectMode) {
    toggleListSelection(note.id, set.indexOf(note.id) < 0);
    listSelectionAnchor = note.id;
    refreshSelectionUI();
    return;
  }
  if (ev.shiftKey) {
    const ids = renderedNoteCardIds();
    const to = ids.indexOf(note.id);
    if (to < 0) { return; }
    let from = listSelectionAnchor
      ? ids.indexOf(listSelectionAnchor) : -1;
    if (from < 0) { from = 0; }
    const lo = Math.min(from, to), hi = Math.max(from, to);
    const range = ids.slice(lo, hi + 1);
    if (!(ev.ctrlKey || ev.metaKey)) {
      set.length = 0;
    }
    range.forEach(function (id) {
      if (set.indexOf(id) < 0) { set.push(id); }
    });
    refreshSelectionUI();
    return;
  }
  if (ev.ctrlKey || ev.metaKey) {
    toggleListSelection(note.id, set.indexOf(note.id) < 0);
    listSelectionAnchor = note.id;
    refreshSelectionUI();
    return;
  }
  /* The plain click: collapse to this note, anchor on
     it, and open it, in that order, so the list the open
     re-renders already wears the collapsed selection. */
  set.length = 0;
  set.push(note.id);
  listSelectionAnchor = note.id;
  openNote(note.id);
}

/* The selection bar: visible only in the touch
   selection mode, naming the mode and its count, with
   the Done control that leaves it. Called at the end of
   renderNoteList, so every repaint keeps it true, and
   it also drives the list's select-mode class, the
   cards' hint state while the mode runs. */
function renderListSelectBar() {
  const bar = document.getElementById("listSelectBar");
  if (!bar) { return; }
  const listEl = document.getElementById("noteList");
  if (listEl) {
    listEl.classList.toggle("select-mode", noteSelectMode);
  }
  if (!noteSelectMode) {
    bar.classList.add("hidden");
    return;
  }
  const n = currentSelectionSet().length;
  document.getElementById("listSelectBarText").textContent =
    "Selecting: " + n + (n === 1 ? " note" : " notes") +
    " selected";
  bar.classList.remove("hidden");
}

/* Enter the touch selection mode, seeded with a note
   (the context menu's Select item on a touch opening). */
function enterNoteSelectMode(note) {
  noteSelectMode = true;
  const set = currentSelectionSet();
  if (set.indexOf(note.id) < 0) { set.push(note.id); }
  listSelectionAnchor = note.id;
  refreshSelectionUI();
}

/* Leave the selection mode. The selection is KEPT (see
   the section header for the reasoning). */
function exitNoteSelectMode() {
  if (!noteSelectMode) { return; }
  noteSelectMode = false;
  refreshSelectionUI();
}

/* The open context menu's facts, or null: the note it
   was opened from, the notes it targets (one, or the
   whole selection), whether it is a selection menu, the
   card element (focus returns there on Escape), and the
   pointer kind that opened it (the Select item starts
   the touch selection mode only for a touch opening). */
let noteCtx = null;

/* After a touch long press opens the menu, the press's
   own click is swallowed once, so opening the menu
   never also opens the note. Set by the long press in
   initNoteContextMenu. */
let noteCtxClickBlock = false;

/* Resolve a note across the three collections (the card
   a menu or press event names may sit in any of them). */
function contextMenuNoteById(id) {
  return state.notes.find(function (n) { return n.id === id; }) ||
    state.trash.find(function (n) { return n.id === id; }) ||
    state.archive.find(function (n) { return n.id === id; }) ||
    null;
}

/* Open the context menu for a card's note at a point.
   The target is the current selection when the note
   belongs to one of two or more; otherwise the note
   alone. */
function openNoteContextMenu(note, x, y, pointerType) {
  if (!note) { return; }
  if (noteCtx) { closeNoteContextMenu(false); }
  closeListPanels();
  const set = currentSelectionSet();
  const inSet = set.indexOf(note.id) >= 0;
  const targetIds = (inSet && set.length >= 2)
    ? set.slice() : [note.id];
  noteCtx = {
    noteId: note.id,
    noteIds: targetIds,
    selection: targetIds.length >= 2,
    cardEl: document.querySelector(
      ".note-card[data-note-id=\"" + note.id + "\"]"),
    pointerType: pointerType || "mouse"
  };
  const menu = document.getElementById("noteCtxMenu");
  menu.innerHTML = "";
  buildNoteContextItems(menu, note, targetIds,
    noteCtx.pointerType);
  menu.classList.remove("hidden");
  placeNoteContextMenu(menu, x, y);
  document.addEventListener("pointerdown",
    onNoteCtxDocPointerDown, true);
  document.addEventListener("keydown",
    onNoteCtxDocKeydown, true);
  window.addEventListener("resize", onNoteCtxCloseEvent);
  window.addEventListener("scroll", onNoteCtxScroll, true);
  const first = menu.querySelector(".list-menu-item");
  if (first) { first.focus(); }
}

/* Put the open menu at the pointer, flipped and clamped
   so it stays fully inside the viewport with a small
   margin on every side. */
function placeNoteContextMenu(menu, x, y) {
  menu.style.left = "0px";
  menu.style.top = "0px";
  const rect = menu.getBoundingClientRect();
  const vw = window.innerWidth || 0;
  const vh = window.innerHeight || 0;
  let left = x, top = y;
  if (left + rect.width > vw - 8) {
    left = Math.max(8, vw - rect.width - 8);
  }
  if (top + rect.height > vh - 8) {
    top = Math.max(8, vh - rect.height - 8);
  }
  if (left < 8) { left = 8; }
  if (top < 8) { top = 8; }
  menu.style.left = left + "px";
  menu.style.top = top + "px";
}

function closeNoteContextMenu(returnFocus) {
  if (!noteCtx) { return; }
  const cardEl = noteCtx.cardEl;
  noteCtx = null;
  const menu = document.getElementById("noteCtxMenu");
  if (menu) {
    menu.classList.add("hidden");
    menu.innerHTML = "";
  }
  document.removeEventListener("pointerdown",
    onNoteCtxDocPointerDown, true);
  document.removeEventListener("keydown",
    onNoteCtxDocKeydown, true);
  window.removeEventListener("resize", onNoteCtxCloseEvent);
  window.removeEventListener("scroll", onNoteCtxScroll, true);
  if (returnFocus && cardEl) {
    if (!cardEl.hasAttribute("tabindex")) {
      cardEl.setAttribute("tabindex", "-1");
    }
    cardEl.focus();
  }
}

function onNoteCtxDocPointerDown(ev) {
  const menu = document.getElementById("noteCtxMenu");
  if (menu && ev.target && menu.contains(ev.target)) { return; }
  closeNoteContextMenu(false);
}

function onNoteCtxCloseEvent() { closeNoteContextMenu(false); }

function onNoteCtxScroll(ev) {
  const menu = document.getElementById("noteCtxMenu");
  const t = ev.target;
  if (menu && t && t.nodeType === 1 && menu.contains(t)) {
    return;
  }
  closeNoteContextMenu(false);
}

/* The menu's keyboard: Escape closes and returns focus
   to the card; the arrows, Home, and End move among the
   items (Enter and Space are the buttons' own). */
function onNoteCtxDocKeydown(ev) {
  const menu = document.getElementById("noteCtxMenu");
  if (!menu || menu.classList.contains("hidden")) { return; }
  if (ev.key === "Escape") {
    ev.preventDefault();
    closeNoteContextMenu(true);
    return;
  }
  if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp" &&
      ev.key !== "Home" && ev.key !== "End") { return; }
  const items = Array.prototype.slice.call(
    menu.querySelectorAll(".list-menu-item"));
  if (!items.length) { return; }
  ev.preventDefault();
  const at = items.indexOf(document.activeElement);
  let next = 0;
  if (ev.key === "ArrowDown") {
    next = at < 0 ? 0 : (at + 1) % items.length;
  } else if (ev.key === "ArrowUp") {
    next = at < 0 ? items.length - 1
      : (at - 1 + items.length) % items.length;
  } else if (ev.key === "End") {
    next = items.length - 1;
  }
  items[next].focus();
}

/* One menu item. Activation closes the menu first (the
   standing close rule), then runs the action, so a panel
   or dialog the action opens never fights the menu for
   the screen. Async actions surface their errors the way
   their existing callers surface them: a toast. */
function noteCtxItem(menu, label, action, danger) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "list-menu-item" + (danger ? " danger" : "");
  btn.setAttribute("role", "menuitem");
  btn.textContent = label;
  btn.addEventListener("click", function () {
    closeNoteContextMenu(false);
    const out = action();
    if (out && typeof out.catch === "function") {
      out.catch(function (err) { toast(err.message, true); });
    }
  });
  menu.appendChild(btn);
  return btn;
}

/* v2.115: one group separator in the note context
   menu (Chris's ask: better organize the menu, with
   separators and groups). It reuses the app's one
   separator declaration (.note-ctx-sep shares the
   editor menu's separator rule in styles.css), is a
   plain div with role="separator", and is not a
   .list-menu-item, so the menu keyboard handler's
   item query never lands on it and the arrows walk
   past it unaided. */
function noteCtxSep(menu) {
  const sep = document.createElement("div");
  sep.className = "note-ctx-sep";
  sep.setAttribute("role", "separator");
  menu.appendChild(sep);
  return sep;
}

/* The menu's contents for its target (see the section
   header): the single note's own actions, or the
   selection's, under a count header. Every item calls
   the same handler the existing UI calls for that
   action; the bulk helpers below are thin per-note
   loops over those same handlers, in the selection's
   order, after clearing the set first (the bulk
   actions' standing pattern, so a set can never act
   twice). Merge Selected and Create TOC Note are the
   exceptions: they read the set themselves and are
   called exactly as the list menu calls them. */
function buildNoteContextItems(menu, note, targetIds, pointerType) {
  const kind = state.view.kind;
  if (targetIds.length < 2) {
    buildSingleNoteContextItems(menu, note, kind, pointerType);
    return;
  }
  const targets = selectedNotesInView();
  const head = document.createElement("div");
  head.className = "note-ctx-head";
  head.textContent = targets.length +
    (targets.length === 1 ? " note" : " notes") + " selected";
  menu.appendChild(head);
  if (kind === "trash" || kind === "archive") {
    noteCtxItem(menu, "Restore all", function () {
      return restoreSelectedNotes();
    });
    /* v2.115: the grouped order (see noteCtxSep):
       the restore stands alone above the separator,
       the permanent delete below it, and Clear
       selection in its own group at the foot, the
       live selection menu's own grouping. */
    noteCtxSep(menu);
    noteCtxItem(menu, "Delete Forever", function () {
      return deleteSelectionForever();
    }, true);
  } else {
    const anyUnpinned = targets.some(function (n) {
      return !n.pinned;
    });
    const anyPinned = targets.some(function (n) {
      return n.pinned;
    });
    if (anyUnpinned) {
      noteCtxItem(menu, "Pin all", function () {
        return pinSelectedNotes(true);
      });
    }
    if (anyPinned) {
      noteCtxItem(menu, "Unpin all", function () {
        return pinSelectedNotes(false);
      });
    }
    /* v2.115: the grouped order (see noteCtxSep):
       the pin group, then the make-something group,
       then the filing group, then Clear selection in
       its own group at the foot. No item renamed or
       removed; only the grouping is new. */
    noteCtxSep(menu);
    noteCtxItem(menu, "Duplicate", function () {
      return duplicateSelectedNotes();
    });
    noteCtxItem(menu, "Merge Selected", function () {
      return mergeSelectedNotes();
    });
    noteCtxItem(menu, "Create Table of Contents Note",
      function () {
        return createTableOfContentsNote();
      });
    noteCtxSep(menu);
    noteCtxItem(menu, "Archive all", function () {
      return archiveSelectedNotes();
    });
    noteCtxItem(menu, "Move " + targets.length +
      " notes to Trash", function () {
        return trashSelectedNotes();
      });
  }
  if (targetIds.length >= 2) { noteCtxSep(menu); }
  noteCtxItem(menu, "Clear selection", function () {
    clearListSelections();
    refreshSelectionUI();
  });
}

/* The single note's items, per collection, mirroring
   the actions that exist for it today. In Trash: Restore
   (the editor button's operation) and Delete Forever
   (confirmDeleteNoteForever, the editor button's own
   flow). In the Archive: Unarchive, by its existing
   name; a single archived note has no Delete Forever
   anywhere in the app today, so the menu does not
   invent one (the Archive SELECTION's menu has it, the
   way the brief for this release specifies). Restore
   and Unarchive here run the note operation and its
   toast without the editor button's extra navigation
   into the note: this is a list surface, and the note
   leaving the list is the feedback, as with the bulk
   restores. */
function buildSingleNoteContextItems(menu, note, kind, pointerType) {
  if (kind === "trash") {
    noteCtxItem(menu, "Restore", function () {
      return moveNoteWithProgress("Restoring", "Restored",
        "Note restored.", function () {
          return restoreNote(note);
        });
    });
    /* v2.115: grouped (see noteCtxSep): Restore
       above the separator, Delete Forever below it.
       No Copy link here or in the Archive menu: a
       link to a trashed note is a dead end, and
       archived notes stand outside the @ picker by
       the standing rule. Select keeps its place at
       the foot, as it always has. */
    noteCtxSep(menu);
    noteCtxItem(menu, "Delete Forever", function () {
      return confirmDeleteNoteForever(note);
    }, true);
  } else if (kind === "archive") {
    noteCtxItem(menu, "Unarchive", function () {
      return moveNoteWithProgress("Unarchiving", "Unarchived",
        "Note unarchived.", function () {
          return unarchiveNote(note);
        });
    });
  } else {
    /* v2.115: the grouped order Chris approved: the
       standing group (pin, shortcuts, reminder), then
       the share and make group (Copy link, new in
       this release, Duplicate note, Save as
       Template), then Select in its own group, then
       the filing group (Archive, Move to Trash) at
       the foot. No item renamed or removed. */
    noteCtxItem(menu, note.pinned ? "Unpin note" : "Pin note",
      function () { return toggleNotePin(note); });
    noteCtxItem(menu,
      hasShortcut("note", note.id)
        ? "Remove Note from Shortcuts"
        : "Add Note to Shortcuts",
      function () { toggleShortcut("note", note.id); });
    noteCtxItem(menu,
      note.reminderAt ? "Edit reminder" : "Add reminder",
      function () { openNoteReminderPanel(note.id); });
    noteCtxSep(menu);
    noteCtxItem(menu, "Copy link", function () {
      copyLinkForNote(note);
    });
    noteCtxItem(menu, "Duplicate note", function () {
      return duplicateNote(note);
    });
    noteCtxItem(menu, "Save as Template", function () {
      return promptSaveNoteAsTemplate(note);
    });
    noteCtxSep(menu);
    noteCtxItem(menu, "Select", function () {
      selectNoteFromContextMenu(note, pointerType);
    });
    noteCtxSep(menu);
    noteCtxItem(menu, "Archive", function () {
      return moveNoteWithProgress("Archiving", "Archived",
        "Note archived.", function () {
          return archiveNote(note);
        }, moveUndoSnapshot("archive", [note]));
    });
    noteCtxItem(menu, "Move to Trash", function () {
      return moveNoteWithProgress("Deleting", "Deleted",
        "Moved to Trash.", function () {
          return moveNoteToTrash(note, false);
        }, moveUndoSnapshot("trash", [note]));
    });
    return;
  }
  noteCtxItem(menu, "Select", function () {
    selectNoteFromContextMenu(note, pointerType);
  });
}

/* The menu's Select item: on touch it starts the
   selection mode seeded with this note; on desktop it
   selects the note without opening it, and anchors
   ranges on it. */
function selectNoteFromContextMenu(note, pointerType) {
  if (pointerType === "touch") {
    enterNoteSelectMode(note);
    return;
  }
  const set = currentSelectionSet();
  if (set.indexOf(note.id) < 0) { set.push(note.id); }
  listSelectionAnchor = note.id;
  refreshSelectionUI();
}

/* The selected notes of the current view, in selection
   order, resolved against the view's own collection. */
function selectedNotesInView() {
  const kind = state.view.kind;
  const collection = kind === "trash" ? state.trash
    : kind === "archive" ? state.archive : state.notes;
  return currentSelectionSet().map(function (id) {
    return collection.find(function (n) { return n.id === id; });
  }).filter(Boolean);
}

/* Bulk pin and unpin: the single toggle's own field
   operation (toggleNotePin's core), per note, each
   saved through the same per note save the toggle
   uses. Only notes the change would actually flip are
   written. */
async function pinSelectedNotes(pinned) {
  const targets = selectedNotesInView().filter(function (n) {
    return n.pinned !== pinned;
  });
  clearListSelections();
  for (const note of targets) {
    note.pinned = pinned;
    try {
      await saveNoteToRepo(note);
    } catch (err) {
      toast("Could not save the pin change: " +
        err.message, true);
    }
  }
  renderAll();
}

/* Bulk duplicate. Through v2.68 this ran the single
   duplicate per note in order, each copy opening as it
   was made, so a many note duplicate waited on every
   note's file copies one at a time. v2.69 keeps the end
   state contract (the copies exist in the targets'
   order, the last target's copy left open) and changes
   only the waiting: the copies are BUILT concurrently
   under the bulk pool (body loads and attachment copies
   are the leaves), then placed together in target order,
   each title judged at placement time exactly as the
   serial flow judged it after its own copies landed,
   then saved concurrently under the same pool. A single
   target still delegates to the single duplicate whole,
   its flow and toasts untouched. While two or more
   copies are being made, a progress toast says so
   (Chris's ask: the wait should be visible), and a
   completion toast with the count replaces it. A build
   that stops names itself in the single duplicate's own
   words when the work is done, and a save that fails
   names itself the same way; the copies that succeeded
   stand either way. The catalog hold spans the run, so
   the whole operation lands one coalesced catalog
   write. */
async function duplicateSelectedNotes() {
  const targets = selectedNotesInView();
  const count = targets.length;
  clearListSelections();
  if (!count) { return; }
  if (count === 1) {
    await duplicateNote(targets[0]);
    return;
  }
  const pool = makeBulkPool(BULK_OP_CONCURRENCY);
  holdCatalogWrites();
  const progress = showProgressToast("Duplicating " + count +
    " notes...");
  const failures = [];
  let copies = [];
  try {
    /* Shells complete first, as pooled leaves, so the
       builds below read bodies instead of fetching them
       one at a time. */
    await runPooledOutcomes(pool, targets, function (note) {
      return ensureNoteBodyLoaded(note);
    });
    const built = await Promise.all(targets.map(function (source) {
      return tryBuildDuplicateCopy(source, pool);
    }));
    /* Placement is synchronous and in target order, each
       unshift the serial flow's own, so the copies land
       in state in the same layout the serial flow left,
       and title judging sees exactly the copies placed
       before each one, as it did when each copy was
       judged right after its own build. */
    built.forEach(function (outcome, i) {
      if (outcome.copy) {
        outcome.copy.title = duplicateCopyTitle(targets[i]);
        state.notes.unshift(outcome.copy);
        copies.push(outcome.copy);
      } else {
        failures.push(outcome.error);
      }
    });
    if (copies.length) {
      saveCache();
      renderAll();
      const saves = await runPooledOutcomes(pool, copies,
        function (copy) {
          return saveNoteToRepo(copy,
            { skipConflictCheck: true, fresh: true });
        });
      saves.forEach(function (outcome) {
        if (outcome.status === "rejected") {
          failures.push("Note created locally; save failed: " +
            outcome.reason.message);
        }
      });
      saveCache();
      /* The last copy opens once the saves have landed, not
         before them as the serial flow's per copy open did:
         the end state is the same (the last target's copy
         open), and the editor never sits on a note whose
         first save is still in flight under it. The
         progress toast covers the whole wait. */
      openNote(copies[copies.length - 1].id);
    }
  } finally {
    releaseCatalogWrites();
    progress.dismiss();
  }
  failures.forEach(function (message) { toast(message, true); });
  if (copies.length) {
    toast("Duplicated " + copies.length +
      (copies.length === 1 ? " note." : " notes."));
  }
}

/* Bulk archive: archiveNote per note through the
   settle-first wrapper the single action uses, so an
   open note among the targets is settled first and the
   result matches doing them one at a time. v2.69 runs
   the moves concurrently under the bulk pool (through
   v2.68 they waited on the network one at a time) in
   the wrapper's quiet form, renders once at the end,
   and holds the catalog and index writes across the
   run so the operation lands one coalesced write of
   each. A move that fails on the store still surfaces
   through the move chain's own toast, as it always
   has. One summary toast stands in for the per-note
   ones. v2.70: the run rides the move progress surface
   (see withMoveProgressToast): "Archiving... N notes"
   at the top center while it runs, "Archived N notes"
   there when it lands; the summary toast below is the
   surface's silent case, kept exactly as it was. */
async function archiveSelectedNotes() {
  const targets = selectedNotesInView();
  const count = targets.length;
  clearListSelections();
  if (!count) { return; }
  const pool = makeBulkPool(BULK_OP_CONCURRENCY);
  holdCatalogWrites();
  let outcome = { shown: false };
  /* v2.96: the undo entry is captured before the
     moves run (see moveUndoSnapshot). */
  const undoEntry = moveUndoSnapshot("archive", targets);
  try {
    outcome = await withMoveProgressToast("Archiving", "Archived",
      count, function () {
        return runPooledOutcomes(pool, targets, function (note) {
          return archiveNote(note, true);
        });
      }, undoEntry);
  } finally {
    releaseCatalogWrites();
  }
  renderAll();
  if (!outcome.shown) {
    const summary = "Archived " + count +
      (count === 1 ? " note." : " notes.");
    /* v2.96: the silent case carries the Undo too;
       a failed run keeps the plain summary. */
    if (!outcome.failed) {
      showMoveUndoToast(summary, undoEntry);
    } else { toast(summary); }
  }
}

/* Bulk trash: moveNoteToTrash per note, in its quiet
   (render once at the end) form, through the same
   settle-first wrapper as the single action. v2.69
   runs the moves concurrently under the bulk pool and
   holds the catalog and index writes across the run,
   as in the bulk archive above. v2.70: the run rides
   the move progress surface, in Chris's own wording
   for this one: "Deleting... N notes" while it runs,
   "Deleted N notes" when it lands; the summary toast
   below is the surface's silent case, kept as it was. */
async function trashSelectedNotes() {
  const targets = selectedNotesInView();
  const count = targets.length;
  clearListSelections();
  if (!count) { return; }
  const pool = makeBulkPool(BULK_OP_CONCURRENCY);
  holdCatalogWrites();
  let outcome = { shown: false };
  /* v2.96: the undo entry is captured before the
     moves run (see moveUndoSnapshot). */
  const undoEntry = moveUndoSnapshot("trash", targets);
  try {
    outcome = await withMoveProgressToast("Deleting", "Deleted",
      count, function () {
        return runPooledOutcomes(pool, targets, function (note) {
          return moveNoteToTrash(note, true);
        });
      }, undoEntry);
  } finally {
    releaseCatalogWrites();
  }
  renderAll();
  if (!outcome.shown) {
    const summary = "Moved " + count + " notes to Trash.";
    /* v2.96: the silent case carries the Undo too;
       a failed run keeps the plain summary. */
    if (!outcome.failed) {
      showMoveUndoToast(summary, undoEntry);
    } else { toast(summary); }
  }
}

/* Restore all: Trash restores through restoreNote, the
   Archive through unarchiveNote, per note: the same
   operations their single actions run, and the same
   pair the Archive's Restore Selected item runs.
   v2.69 runs the moves concurrently under the bulk
   pool, in the wrappers' quiet form with one render
   at the end, and holds the catalog and index writes
   across the run, as in the bulk archive above.
   v2.70: the run rides the move progress surface,
   named for its own side: "Restoring" from the Trash,
   "Unarchiving" from the Archive; the summary toast
   below is the surface's silent case, kept as it was. */
async function restoreSelectedNotes() {
  const targets = selectedNotesInView();
  const count = targets.length;
  const fromTrash = state.view.kind === "trash";
  clearListSelections();
  if (!count) { return; }
  const pool = makeBulkPool(BULK_OP_CONCURRENCY);
  holdCatalogWrites();
  let outcome = { shown: false };
  try {
    outcome = await withMoveProgressToast(
      fromTrash ? "Restoring" : "Unarchiving",
      fromTrash ? "Restored" : "Unarchived",
      count, function () {
        return runPooledOutcomes(pool, targets, function (note) {
          return fromTrash ? restoreNote(note, true)
            : unarchiveNote(note, true);
        });
      });
  } finally {
    releaseCatalogWrites();
  }
  renderAll();
  if (!outcome.shown) {
    toast("Restored " + count + " notes.");
  }
}

/* Delete Forever for a Trash or Archive selection: the
   Trash menu's Delete Selected confirmation and flow
   (its wording, its attachment sentence, its warning
   for files that could not be deleted), over the
   current view's selection, through the shared
   deleteNotesForever. */
async function deleteSelectionForever() {
  const chosen = selectedNotesInView();
  if (!chosen.length) { return; }
  let text = "Delete " + chosen.length +
    (chosen.length === 1 ? " note" : " notes") +
    " forever? This cannot be undone. Their note files " +
    "and version history on " + storageDisplayName() +
    " will be deleted.";
  const sentence = bulkAttachmentSentence(chosen);
  if (sentence) { text += " " + sentence; }
  if (!confirm(text)) { return; }
  clearListSelections();
  const result = await deleteNotesForever(chosen);
  toast("Deleted forever.");
  warnUndeletedAttachments(result.failed);
}

/* Wire the context menu's own inputs on the note list:
   the contextmenu event (suppressed; the app's menu
   opens instead) and the touch long press that opens
   the same menu at the press point. Called once from
   wireEvents, beside initNoteDragAndDrop. */
function initNoteContextMenu() {
  const listEl = document.getElementById("noteList");
  if (!listEl) { return; }
  /* v2.68.0: selection never starts inside the note menu.
     The CSS on .note-ctx-menu and .note-card covers the
     rendering side; this is the event half, scoped to the
     menu element alone, so a selection that would begin
     on a menu item is prevented while selection everywhere
     else (the editor body above all) is untouched. */
  const ctxMenuEl = document.getElementById("noteCtxMenu");
  if (ctxMenuEl) {
    ctxMenuEl.addEventListener("selectstart", function (ev) {
      ev.preventDefault();
    });
  }
  listEl.addEventListener("contextmenu", function (ev) {
    const card = ev.target && ev.target.closest
      ? ev.target.closest(".note-card") : null;
    if (!card || !card.getAttribute("data-note-id")) { return; }
    ev.preventDefault();
    const note = contextMenuNoteById(
      card.getAttribute("data-note-id"));
    if (!note) { return; }
    /* A touch long press opens the menu first; the
       browser's own follow-up contextmenu for the same
       press lands here with the menu already open for
       this note, and is simply swallowed. */
    if (noteCtx && noteCtx.noteId === note.id) { return; }
    openNoteContextMenu(note, ev.clientX, ev.clientY,
      ev.pointerType || "mouse");
  });
  /* The long press: a stationary touch press of about
     500 ms. Movement past the slop (the drag section's
     own tolerance), or the press ending first, cancels
     it: a moved press is a scroll and opens nothing.
     The move and end listeners live on the document
     while a press is armed, the drag machinery's own
     pattern for press tracking. */
  let press = null;
  function cancelPress() {
    if (!press) { return; }
    clearTimeout(press.timer);
    press = null;
    document.removeEventListener("pointermove",
      onPressMove, true);
    document.removeEventListener("pointerup",
      onPressEnd, true);
    document.removeEventListener("pointercancel",
      onPressEnd, true);
  }
  function onPressMove(ev) {
    if (!press || ev.pointerId !== press.pointerId) { return; }
    if (Math.hypot(ev.clientX - press.x,
        ev.clientY - press.y) > NOTE_DRAG_TOUCH_SLOP_PX) {
      cancelPress();
    }
  }
  function onPressEnd(ev) {
    if (!press || ev.pointerId !== press.pointerId) { return; }
    cancelPress();
  }
  listEl.addEventListener("pointerdown", function (ev) {
    if (ev.pointerType !== "touch") { return; }
    const card = ev.target && ev.target.closest
      ? ev.target.closest(".note-card") : null;
    if (!card || !card.getAttribute("data-note-id")) { return; }
    const note = contextMenuNoteById(
      card.getAttribute("data-note-id"));
    if (!note) { return; }
    cancelPress();
    press = {
      note: note, x: ev.clientX, y: ev.clientY,
      pointerId: ev.pointerId,
      timer: setTimeout(function () {
        const armed = press;
        cancelPress();
        if (!armed) { return; }
        noteCtxClickBlock = true;
        openNoteContextMenu(armed.note, armed.x, armed.y,
          "touch");
      }, 500)
    };
    document.addEventListener("pointermove",
      onPressMove, true);
    document.addEventListener("pointerup",
      onPressEnd, true);
    document.addEventListener("pointercancel",
      onPressEnd, true);
  });
  document.addEventListener("click", function (ev) {
    if (noteCtxClickBlock) {
      noteCtxClickBlock = false;
      ev.stopPropagation();
      ev.preventDefault();
    }
  }, true);
  /* The selection mode's Done control. */
  const doneBtn = document.getElementById("listSelectDoneBtn");
  if (doneBtn) {
    doneBtn.addEventListener("click", function () {
      exitNoteSelectMode();
    });
  }
}

/* v2.61: the Things to do page's task rows first kept
   the browser's own right click menu out, through a
   guard delegated on that page's container alone.
   v2.61.1 widens the same word to every task row and
   to the whole sidebar, in one delegated listener on
   the document, called once from wireEvents.

   The task branch follows the rows, not a page: the
   shared row builder serves the Things to do page,
   the Tasks view's list, the Home Tasks widget, and
   the Tasks block inside a note, and the calendar
   surfaces build their entries with the same shape
   under their own class; a right click (or the touch
   long press that surfaces as one) on any of them
   opens nothing, at Chris's word, and no app menu
   replaces it. Rows are rebuilt on every render, so
   only delegation survives; keyed on the two row
   classes, the one listener covers surfaces that did
   not exist when it was written, too.

   The sidebar branch is a blanket, and the audit
   behind it is short: besides this one, the app
   registers exactly one other contextmenu listener
   (the note list's, below), and nothing in the
   sidebar answers a right click or a long press with
   a menu of its own. Every sidebar menu (the three
   dot menus for tags, shortcuts, saved searches,
   templates, and the sidebar itself) opens from a
   click, and the sidebar's drag paths (note drops,
   shortcut reorder) run on Pointer Events, which a
   contextmenu preventDefault never touches. So the
   blanket replaces nothing and breaks nothing: the
   full sidebar, its collapsed icon rail form, and
   the rail's notebooks flyout (the rail form's own
   panel) simply never show the browser's menu.

   The listener sits in the bubble phase on purpose.
   The note list's own handler is on the list element,
   so on a note card it runs first, suppresses the
   native menu itself, and opens the app menu; this
   guard then matches neither branch (a card is no
   task row, and the list is not the sidebar) and
   leaves the press alone. A press matching neither
   branch anywhere else (the editor body above all)
   keeps the browser's own behavior, exactly as
   before. Ordinary clicks, the rows' checkbox
   completion through the one completion path, and
   every sidebar button and drag are untouched,
   because the guard only ever answers contextmenu.

   v2.81 widens the word once more, at Chris's
   instruction: the suppression is app wide now. Any
   press that reaches this listener and matches no
   earlier answer is the browser's own menu asking to
   appear somewhere the app shows no menu of its own,
   and it never does, on any surface: Home, the note
   list's furniture, the calendar surfaces, Settings,
   and every dialog included. His correction the same
   day carves the text surfaces back out: text-like
   inputs, text areas, and the contenteditable
   regions (the note body above all, and the task
   description editor) keep the browser's menu with
   its cut, copy, paste, and spellcheck, exactly as
   they always had it. The order inside the listener
   is the whole design: the task rows answer first
   (they are not text surfaces, even when a note's
   Tasks block nests them inside the editor), the
   carve-out answers next, and the blanket closes.
   The sidebar's own blanket from v2.61.1 is subsumed
   by the closing blanket; its one text field, the
   search box, now falls under the carve-out like
   every other text field. The note list's handler
   still runs first on its cards in the bubble and
   opens the app menu; this listener then only
   confirms a prevention already made.

   v2.91.0: Chris directed the note editor onto its
   own custom right click menu (Cut, Copy, Paste,
   Encrypt selected text, Unlock or Lock encrypted
   text), superseding the note editor half of the
   carve out above: a contextmenu inside the note
   body now opens the app's own menu (see
   wireEditorCtxMenu) instead of the browser's. This
   guard's behavior is unchanged: the editor's own
   listener answers first in the bubble, and the
   carve out still stands for the task description
   editor and every other contenteditable region,
   which keep the browser menu exactly as before. */
function initNativeMenuSuppression() {
  document.addEventListener("contextmenu", function (ev) {
    const target = ev.target;
    if (!target || !target.closest) { return; }
    if (target.closest(".task-row, .task-cal-entry")) {
      ev.preventDefault();
      return;
    }
    if (nativeMenuTargetKeepsMenu(target)) { return; }
    ev.preventDefault();
  });
}

/* v2.81: the carve-out's measure. A press keeps the
   browser's own menu when it lands on a text-like
   input (the type list is the text entry family;
   checkboxes, radios, buttons, and selects are not
   text), on a text area, or anywhere inside a
   contenteditable region (contenteditable="true";
   the false islands inside the editor, like its
   attachment cards, are part of the region around
   them, while its task rows were answered before
   this is consulted). */
function nativeMenuTargetKeepsMenu(target) {
  const field = target.closest("input, textarea");
  if (field) {
    if (field.tagName === "TEXTAREA") { return true; }
    const type = (field.getAttribute("type") || "text")
      .toLowerCase();
    return ["text", "search", "email", "url", "tel",
      "password", "number", "date", "time",
      "datetime-local", "month", "week"]
      .indexOf(type) !== -1;
  }
  return !!target.closest('[contenteditable="true"]');
}

/* Permanently delete several trashed notes, one at a time. Each
   note goes through exactly what the editor's Delete Forever
   button does for a single note: a best effort cleanup of its
   cloud attachment files first, then deleteNoteForever (the per
   note operation chain, the store delete, the offline queue when
   disconnected). Files the app cannot reach are collected and
   returned, so the caller can name them in the same warning the
   single delete shows. Sequential, so storage sees the deletes in
   the order the notes were listed. */
async function deleteNotesForever(notes) {
  const failed = [];
  for (const note of notes) {
    const atts = note.attachments || [];
    if (atts.length) {
      if (state.online) {
        const missed = await deleteAttachmentsBestEffort(note);
        missed.forEach(function (name) { failed.push(name); });
      } else {
        atts.forEach(function (a) { failed.push(a.name); });
      }
    }
    await deleteNoteForever(note);
  }
  return failed;
}

/* The storage phrase the permanent delete confirmations use, the
   same one the single Delete Forever built for itself. */
function storageDeletePhrase() {
  return "SnakeScale Notes folder in Google Drive";
}

/* The attachment sentence the permanent delete confirmations add
   when the notes being deleted carry files, worded like the single
   Delete Forever's. */
function bulkAttachmentSentence(attachCount) {
  if (!attachCount) { return ""; }
  return " Their " + attachCount + " attachment file(s) will also be " +
    "deleted from their cloud storage where that provider is signed " +
    "in. Files whose provider is not signed in cannot be deleted by " +
    "the app and will be left behind in that cloud account.";
}

/* Warn about any cloud files a bulk delete could not remove, the
   same warning the single Delete Forever ends with. */
function warnUndeletedAttachments(failed) {
  if (!failed.length) { return; }
  toast("Warning: these cloud files could not be deleted and remain in " +
    "their storage accounts: " + failed.join(", "), true);
}

/* Trash menu: Delete Selected. Confirms with the count, then
   permanently deletes exactly the checked notes. The selection is
   cleared before the work starts, so the re-renders the deletes
   trigger already show the final, unselected state. */
async function deleteSelectedTrashNotes() {
  const chosen = state.trash.filter(function (n) {
    return state.trashSelection.indexOf(n.id) >= 0;
  });
  if (!chosen.length) { return; }
  let attachCount = 0;
  chosen.forEach(function (n) { attachCount += (n.attachments || []).length; });
  const ok = confirm("Delete the " + chosen.length + " selected note" +
    (chosen.length === 1 ? "" : "s") + " forever? This removes their " +
    "files from your " + storageDeletePhrase() +
    " and cannot be undone from inside the app." +
    bulkAttachmentSentence(attachCount));
  if (!ok) { return; }
  state.trashSelection = [];
  const failed = await deleteNotesForever(chosen);
  toast("Deleted " + chosen.length + " note" +
    (chosen.length === 1 ? "" : "s") + " forever.");
  warnUndeletedAttachments(failed);
}

/* Trash menu: Empty Trash. Confirms naming the number of trashed
   notes, then permanently deletes every one of them through the
   same path as Delete Selected. */
async function emptyTrash() {
  const all = state.trash.slice();
  if (!all.length) { return; }
  let attachCount = 0;
  all.forEach(function (n) { attachCount += (n.attachments || []).length; });
  const ok = confirm("Empty the Trash? All " + all.length +
    " trashed note" + (all.length === 1 ? "" : "s") +
    " will be deleted forever. This removes their files from your " +
    storageDeletePhrase() + " and cannot be undone from inside the app." +
    bulkAttachmentSentence(attachCount));
  if (!ok) { return; }
  state.trashSelection = [];
  const failed = await deleteNotesForever(all);
  toast("Trash emptied: " + all.length + " note" +
    (all.length === 1 ? "" : "s") + " deleted forever.");
  warnUndeletedAttachments(failed);
}

/* Archive menu: Restore Selected. Each checked note goes through
   the existing unarchive path, which returns it to the notebook it
   was archived from (with that path's usual fallback when the
   notebook is gone). No confirmation: restoring is reversible by
   archiving again, like the single Unarchive button.
   v2.70: through v2.69 this one still ran the unarchives
   one at a time in their loud form, a full render per
   note (measured in the rig at ten renders for ten
   notes), the one bulk move the v2.69 pooling passed
   by. It now runs the same pooled quiet form as the
   context menu's restore, one render at the end, and
   rides the move progress surface as an unarchive;
   its summary toast below is the silent case, kept. */
async function restoreSelectedArchiveNotes() {
  const chosen = state.archive.filter(function (n) {
    return state.archiveSelection.indexOf(n.id) >= 0;
  });
  if (!chosen.length) { return; }
  state.archiveSelection = [];
  const count = chosen.length;
  const pool = makeBulkPool(BULK_OP_CONCURRENCY);
  holdCatalogWrites();
  let outcome = { shown: false };
  try {
    outcome = await withMoveProgressToast("Unarchiving",
      "Unarchived", count, function () {
        return runPooledOutcomes(pool, chosen, function (note) {
          return unarchiveNote(note, true);
        });
      });
  } finally {
    releaseCatalogWrites();
  }
  renderAll();
  if (!outcome.shown) {
    toast("Restored " + count + " note" +
      (count === 1 ? "" : "s") + " from the Archive.");
  }
}

/* --------------------------------------------------------------------------
   v2.32: advanced search syntax (Evernote parity, phase 1 release 4)

   The search box speaks Evernote's search grammar now, from
   Evernote's own help pages and its developer search grammar
   document. The model in brief: a query is a list of terms,
   ANDed by default; any: unions the terms after it; a
   leading minus negates any term; notebook: is a scope that
   stands outside the union; tag: is a full tag name match
   (a trailing wildcard prefixes the name, tag:* is any tag
   at all, -tag:* is no tags); intitle: searches the title;
   created: and updated: take an absolute YYYYMMDD date
   (an optional THHmmss time, Z for UTC) or a relative day,
   week, month, or year with an optional signed delta, and
   mean on or after that moment (negated: before it);
   todo: reads checkbox state (true is a checked box, false
   an unchecked one, * any box); resource: matches
   attachment MIME types, exactly or by a trailing wildcard;
   stack: scopes to the notebooks in a named stack, the
   operator Evernote's current help table lists and the one
   this app's stacks (v2.29) give data to.

   Two compatibility rules guard the change. First, a query
   carrying NO syntax at all (no operator, no quote, no
   negation, no wildcard) never reaches the parser:
   parseSearchQuery returns null for it and visibleNotes
   runs the matcher the app has always used, so plain
   searches return exactly what they returned before this
   release. Second, nothing in here can throw: an operator
   with a malformed value (a bad date, a bad todo value)
   degrades to a plain word carrying the whole token, and
   an unknown operator is a plain word from the start
   (Evernote leaves unknown labels undefined; degrading
   keeps the query useful and the behavior explainable).

   One named deviation lives here by design: literal terms
   (bare words and quoted phrases) match through
   searchTextMatches, this app's substring matcher over
   title, body text, attachment names, and tags, rather
   than Evernote's whole word token matching. The operator
   grammar is Evernote's; the word predicate stays the
   app's own, so a word means the same thing inside an
   operator query as it means alone, and a catalog shell
   (whose body is not on the device) is judged on the same
   text either way.

   v2.35 addendum: the reminder operators, skipped above
   while notes carried no reminder data, are wired now
   that they do: reminderTime: and reminderDoneTime: take
   the same date thresholds as created: and updated:,
   plus the bare * presence form, and reminderOrder:* is
   the presence of a reminder at all (any other
   reminderOrder: value degrades to a plain word: no order
   stamp exists to threshold against). The reminder pair
   rides the catalog at shape 3, so shells judge exactly
   as loaded notes do. Evernote's active reminders idiom
   (reminderTime:* -reminderDoneTime:*) works as written.
   -------------------------------------------------------------------------- */

/* The one text predicate every search path shares, extracted
   verbatim from the filter visibleNotes has always run: the
   needle (already lowercased by the caller, or lowercased
   here) as a substring of the title, the list text, an
   attachment name, or a tag. */
function searchTextMatches(note, needle) {
  const q = String(needle || "").toLowerCase();
  if (!q) { return false; }
  return note.title.toLowerCase().indexOf(q) >= 0 ||
    /* v2.20: a shell searches its catalog preview (its full
       body is not on this device); a loaded note searches
       its body, as always. */
    noteListText(note).toLowerCase().indexOf(q) >= 0 ||
    /* v1.2: attachment file names are searchable. Placeholder markup
       itself contributes no text, so snippets stay clean. */
    (note.attachments || []).some(function (a) {
      return (a.name || "").toLowerCase().indexOf(q) >= 0;
    }) ||
    note.tags.some(function (t) { return t.toLowerCase().indexOf(q) >= 0; });
}

/* The notebook record for a slug, or null. notebook: and
   stack: read names from the record, never from the slug. */
function notebookForSlug(slug) {
  return state.notebooks.find(function (nb) {
    return nb.slug === slug;
  }) || null;
}

/* One note body's checklist state: does it hold a checked
   box, an unchecked box, or neither? The body is parsed
   (never trusted as text: a note can mention checkboxes
   without having one). A box counts as checked when its
   input is checked or when its list item carries the done
   class the editor keeps in step with the attribute, so
   bodies saved by any build answer the same. */
function checklistFactsFromHtml(html) {
  const facts = { checked: false, unchecked: false };
  if (!html || html.indexOf("checkbox") < 0) { return facts; }
  const div = document.createElement("div");
  div.innerHTML = html;
  const boxes = div.querySelectorAll("input[type=\"checkbox\"]");
  for (let i = 0; i < boxes.length; i++) {
    const li = boxes[i].closest ? boxes[i].closest("li") : null;
    if (boxes[i].checked ||
        (li && li.classList.contains("done"))) {
      facts.checked = true;
    } else {
      facts.unchecked = true;
    }
    if (facts.checked && facts.unchecked) { break; }
  }
  return facts;
}

/* The checklist state todo: judges for one note: derived
   from the body for a loaded note, read from the catalog
   facts (v2.32) for a shell, so both answer alike. */
function noteTodoFacts(note) {
  if (note.bodyLoaded === false) {
    return { checked: !!note.shellTodoChecked,
      unchecked: !!note.shellTodoUnchecked };
  }
  return checklistFactsFromHtml(note.body);
}

/* The attachment MIME types resource: judges for one note:
   the records' own types for a loaded note, the catalog
   facts for a shell. */
function noteAttachmentMimes(note) {
  if (note.bodyLoaded === false) {
    if (Array.isArray(note.shellAttachmentMimes)) {
      return note.shellAttachmentMimes;
    }
    return note.shellCardAtt && note.shellCardAtt.mime
      ? [String(note.shellCardAtt.mime).toLowerCase()] : [];
  }
  return (note.attachments || []).map(function (a) {
    return String((a && a.mime) || "").toLowerCase();
  });
}

/* One created:/updated: value as the millisecond threshold
   it names, or null when the value is not a date the
   grammar knows. Absolute forms: YYYYMMDD, optionally with
   THHmmss, optionally Z for UTC; without Z the moment is
   local, the client's timezone, as Evernote evaluates it.
   Impossible dates (a February 30th) are null, not rolled
   over. Relative forms: day, week, month, or year, with an
   optional signed delta, naming the START of that unit:
   day is today at midnight, week is this week's Sunday,
   month is the first, year is January first, and the delta
   moves whole units (day-1 is yesterday, week-2 is the
   Sunday two weeks back, day+7 is a week from today). */
function searchDateThresholdMs(rawValue) {
  const v = String(rawValue || "").trim().toLowerCase();
  let m = /^(\d{4})(\d{2})(\d{2})(?:t(\d{2})(\d{2})(\d{2})(z)?)?$/.exec(v);
  if (m) {
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) { return null; }
    if (m[4] === undefined) {
      const dt = new Date(y, mo - 1, d);
      if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 ||
          dt.getDate() !== d) { return null; }
      return dt.getTime();
    }
    const hh = +m[4], mi = +m[5], ss = +m[6];
    if (hh > 23 || mi > 59 || ss > 59) { return null; }
    if (m[7]) {
      const dt = new Date(Date.UTC(y, mo - 1, d, hh, mi, ss));
      if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 ||
          dt.getUTCDate() !== d) { return null; }
      return dt.getTime();
    }
    const dt = new Date(y, mo - 1, d, hh, mi, ss);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 ||
        dt.getDate() !== d) { return null; }
    return dt.getTime();
  }
  m = /^(day|week|month|year)([+-]\d+)?$/.exec(v);
  if (m) {
    const delta = m[2] ? parseInt(m[2], 10) : 0;
    const now = new Date();
    if (m[1] === "day") {
      return new Date(now.getFullYear(), now.getMonth(),
        now.getDate() + delta).getTime();
    }
    if (m[1] === "week") {
      const sunday = new Date(now.getFullYear(), now.getMonth(),
        now.getDate());
      sunday.setDate(sunday.getDate() - sunday.getDay() + delta * 7);
      return sunday.getTime();
    }
    if (m[1] === "month") {
      return new Date(now.getFullYear(), now.getMonth() + delta,
        1).getTime();
    }
    return new Date(now.getFullYear() + delta, 0, 1).getTime();
  }
  return null;
}

/* Split a query into raw terms. A term is whitespace
   delimited except inside quotes; it may open with a minus
   (negation), carry a label (letters and digits, then a
   colon), and its value may be quoted, with a backslash
   escaping a quote inside the quotes, per the grammar.
   The output is raw: classification lives in
   parseSearchQuery. */
function tokenizeSearchQuery(q) {
  const terms = [];
  const n = q.length;
  let i = 0;
  function readQuoted() {
    i++;   /* the opening quote */
    let out = "";
    while (i < n) {
      const c = q.charAt(i);
      if (c === "\\" && i + 1 < n && q.charAt(i + 1) === "\"") {
        out += "\"";
        i += 2;
        continue;
      }
      if (c === "\"") { i++; break; }
      out += c;
      i++;
    }
    return out;
  }
  while (i < n) {
    while (i < n && /\s/.test(q.charAt(i))) { i++; }
    if (i >= n) { break; }
    let negated = false;
    if (q.charAt(i) === "-" && i + 1 < n &&
        !/\s/.test(q.charAt(i + 1))) {
      negated = true;
      i++;
    }
    let label = null;
    const lm = /^[A-Za-z][A-Za-z0-9]*:/.exec(q.slice(i));
    if (lm) {
      label = lm[0].slice(0, -1).toLowerCase();
      i += lm[0].length;
    }
    let value = "", quoted = false;
    if (i < n && q.charAt(i) === "\"") {
      value = readQuoted();
      quoted = true;
    } else {
      const start = i;
      while (i < n && !/\s/.test(q.charAt(i))) { i++; }
      value = q.slice(start, i);
    }
    terms.push({ negated: negated, label: label,
      value: value, quoted: quoted });
  }
  return terms;
}

const SEARCH_OPERATOR_LABELS = ["notebook", "stack", "tag",
  "intitle", "created", "updated", "todo", "resource",
  /* v2.35: the reminder operators join the grammar now
     that notes carry reminders (they were the skipped
     family while the data did not exist). */
  "remindertime", "reminderdonetime", "reminderorder"];

/* Parse a query into the predicates that judge it, or
   return null when the query carries no syntax at all
   (the caller then runs the plain matcher, unchanged).
   A predicate is {kind, value, wildcard, negated}; its
   value is prepared for its kind (lowercased text, a
   tag stem, a millisecond threshold). notebook: terms are
   scopes, kept apart from the positive terms because
   Evernote's grammar holds the notebook outside the any:
   union; every other positive term joins the AND (or the
   union, under any:), and negated terms always exclude. */
function parseSearchQuery(rawQuery) {
  const terms = tokenizeSearchQuery(String(rawQuery || ""));
  let syntax = false;
  let anyMode = false;
  const scopes = [], positives = [], negatives = [];
  function pushTerm(pred) {
    if (pred.kind === "notebook") { scopes.push(pred); return; }
    if (pred.negated) { negatives.push(pred); }
    else { positives.push(pred); }
  }
  function pushText(value, negated) {
    if (!value) { return; }
    pushTerm({ kind: "text", value: String(value).toLowerCase(),
      negated: negated });
  }
  terms.forEach(function (t) {
    if (t.label === "any") {
      syntax = true;
      anyMode = true;
      if (t.value) { pushText(t.value, false); }
      return;
    }
    if (t.negated || t.quoted) { syntax = true; }
    if (t.label &&
        SEARCH_OPERATOR_LABELS.indexOf(t.label) >= 0) {
      syntax = true;
      const v = t.value;
      if (t.label === "created" || t.label === "updated") {
        const ms = searchDateThresholdMs(v);
        if (ms === null) {
          /* A malformed date degrades to the plain word
             the user typed, never to an error. */
          pushText(t.label + ":" + v, t.negated);
          return;
        }
        pushTerm({ kind: t.label, value: ms, negated: t.negated });
        return;
      }
      if (t.label === "remindertime" ||
          t.label === "reminderdonetime") {
        /* v2.35: the reminder date operators classify
           exactly like created: and updated: (the same
           threshold reader, the same degrade), plus the
           bare * presence form Evernote's grammar gives
           them: reminderTime:* is every note carrying a
           reminder, reminderDoneTime:* every done one. */
        if (v === "*") {
          pushTerm({ kind: t.label, value: "*",
            negated: t.negated });
          return;
        }
        const ms = searchDateThresholdMs(v);
        if (ms === null) {
          pushText(t.label + ":" + v, t.negated);
          return;
        }
        pushTerm({ kind: t.label, value: ms, negated: t.negated });
        return;
      }
      if (t.label === "reminderorder") {
        /* v2.35: reminderOrder is an operator only in its
           presence form: the note has a reminder (done or
           not), which is what the field means in Evernote's
           model. This build stores no separate order stamp
           to threshold against, so any other value degrades
           to the plain word typed, the grammar's rule for
           values it cannot judge. */
        if (v === "*") {
          pushTerm({ kind: "reminderorder", value: "*",
            negated: t.negated });
          return;
        }
        pushText("reminderorder:" + v, t.negated);
        return;
      }
      if (t.label === "todo") {
        const tv = v.toLowerCase();
        if (tv !== "true" && tv !== "false" && tv !== "*") {
          pushText("todo:" + v, t.negated);
          return;
        }
        pushTerm({ kind: "todo", value: tv, negated: t.negated });
        return;
      }
      if (!v) {
        pushText(t.label + ":", t.negated);
        return;
      }
      if (t.label === "tag") {
        if (v === "*") {
          pushTerm({ kind: "tag", value: "*", negated: t.negated });
          return;
        }
        let tagStem = v, tagWild = false;
        if (tagStem.length > 1 &&
            tagStem.charAt(tagStem.length - 1) === "*") {
          tagWild = true;
          tagStem = tagStem.slice(0, -1);
        }
        pushTerm({ kind: "tag", value: tagStem.toLowerCase(),
          wildcard: tagWild, negated: t.negated });
        return;
      }
      if (t.label === "resource") {
        const rv = v.toLowerCase();
        if (rv === "*" || rv === "*/*") {
          pushTerm({ kind: "resource", value: "*",
            negated: t.negated });
          return;
        }
        let resStem = rv, resWild = false;
        if (resStem.charAt(resStem.length - 1) === "*") {
          resWild = true;
          resStem = resStem.slice(0, -1);
        }
        pushTerm({ kind: "resource", value: resStem,
          wildcard: resWild, negated: t.negated });
        return;
      }
      /* notebook:, stack:, intitle:: a name or title
         match; the first two take a trailing wildcard as
         a prefix, like the grammar's string matching. */
      let stem = v, wild = false;
      if (t.label !== "intitle" && stem.length > 1 &&
          stem.charAt(stem.length - 1) === "*") {
        wild = true;
        stem = stem.slice(0, -1);
      }
      pushTerm({ kind: t.label, value: stem.toLowerCase(),
        wildcard: wild, negated: t.negated });
      return;
    }
    if (t.label) {
      /* An unknown label is not an operator at all: the
         whole token is a plain word. */
      pushText(t.label + ":" + t.value, t.negated);
      return;
    }
    let word = t.value;
    if (word.length > 1 && word.charAt(word.length - 1) === "*") {
      /* A trailing wildcard is syntax (Evernote: match
         the start of a word); under this app's substring
         predicate the bare stem already covers it. */
      syntax = true;
      word = word.slice(0, -1);
    }
    pushText(word, t.negated);
  });
  if (!syntax) { return null; }
  return { anyMode: anyMode, scopes: scopes,
    positives: positives, negatives: negatives };
}

/* One parsed predicate against one note. */
function searchTermMatches(note, pred) {
  if (pred.kind === "text") {
    return searchTextMatches(note, pred.value);
  }
  if (pred.kind === "intitle") {
    return String(note.title || "").toLowerCase()
      .indexOf(pred.value) >= 0;
  }
  if (pred.kind === "tag") {
    const tags = note.tags || [];
    if (pred.value === "*") { return tags.length > 0; }
    for (let i = 0; i < tags.length; i++) {
      const t = String(tags[i]).toLowerCase();
      if (pred.wildcard ? t.indexOf(pred.value) === 0
          : t === pred.value) {
        return true;
      }
    }
    return false;
  }
  if (pred.kind === "notebook") {
    const nb = notebookForSlug(note.notebook);
    if (!nb) { return false; }
    const name = String(nb.name || "").toLowerCase();
    return pred.wildcard ? name.indexOf(pred.value) === 0
      : name === pred.value;
  }
  if (pred.kind === "stack") {
    const nb = notebookForSlug(note.notebook);
    if (!nb || typeof nb.stack !== "string" || !nb.stack) {
      return false;
    }
    const s = nb.stack.toLowerCase();
    return pred.wildcard ? s.indexOf(pred.value) === 0
      : s === pred.value;
  }
  if (pred.kind === "created" || pred.kind === "updated") {
    const t = new Date(pred.kind === "created"
      ? note.created : note.updated).getTime();
    return !isNaN(t) && t >= pred.value;
  }
  if (pred.kind === "remindertime" ||
      pred.kind === "reminderdonetime") {
    /* v2.35: the reminder fields ride on the note object
       for loaded notes and catalog shells alike, so this
       one read judges both. The * form is presence; a
       date value is the created:/updated: threshold on
       the field, and an unset field never matches. */
    const raw = pred.kind === "remindertime"
      ? note.reminderAt : note.reminderDoneAt;
    if (!raw) { return false; }
    if (pred.value === "*") { return true; }
    const t = new Date(raw).getTime();
    return !isNaN(t) && t >= pred.value;
  }
  if (pred.kind === "reminderorder") {
    /* v2.35: presence of a reminder at all, done or not:
       exactly the field's meaning in Evernote's model,
       judged from the same two stamps. */
    return !!(note.reminderAt || note.reminderDoneAt);
  }
  if (pred.kind === "todo") {
    const f = noteTodoFacts(note);
    if (pred.value === "*") { return f.checked || f.unchecked; }
    return pred.value === "true" ? f.checked : f.unchecked;
  }
  if (pred.kind === "resource") {
    const mimes = noteAttachmentMimes(note);
    if (pred.value === "*") { return mimes.length > 0; }
    for (let i = 0; i < mimes.length; i++) {
      if (pred.wildcard ? mimes[i].indexOf(pred.value) === 0
          : mimes[i] === pred.value) {
        return true;
      }
    }
    return false;
  }
  return false;
}

/* One note against a parsed query: every scope must hold
   (a negated scope must not), no negated term may match,
   and the positive terms must all match, or any one of
   them under any:. */
function noteMatchesParsedSearch(note, parsed) {
  for (let i = 0; i < parsed.scopes.length; i++) {
    const s = parsed.scopes[i];
    if (searchTermMatches(note, s) === !!s.negated) {
      return false;
    }
  }
  for (let i = 0; i < parsed.negatives.length; i++) {
    if (searchTermMatches(note, parsed.negatives[i])) {
      return false;
    }
  }
  if (!parsed.positives.length) { return true; }
  if (parsed.anyMode) {
    return parsed.positives.some(function (p) {
      return searchTermMatches(note, p);
    });
  }
  return parsed.positives.every(function (p) {
    return searchTermMatches(note, p);
  });
}

/* The filtered, sorted note set for the middle pane.
   Pipeline: the current view selects the pool, the search text
   narrows it, then the v1.8 list filters narrow it further (all three
   combine with AND). Sort rule: pinned first, then the remembered
   list sort (compareNotesByListSort); the default sort, updated
   newest first, reproduces the pre-v1.8 order exactly. In Trash and
   in the Archive there is no pinning, so it is just the sort. Search
   matches title, body text, and tags, all locally against the cache.
   v2.32: a query carrying search syntax is judged by the
   Evernote grammar above; a plain query runs the matcher the
   app has always used, unchanged. */
/* The plain (no syntax) search predicate: title, body
   text, attachment names, or tags containing the query.
   Through v2.32 this lived inline in visibleNotes;
   v2.33 names it, unchanged, because the Home Filtered
   Notes widget judges a saved search's plain queries by
   the same rule the list does (notesMatchingSearchText). */
function noteMatchesPlainSearch(n, q) {
  return n.title.toLowerCase().indexOf(q) >= 0 ||
    /* v2.20: a shell searches its catalog preview (its full
       body is not on this device); a loaded note searches
       its body, as always. */
    noteListText(n).toLowerCase().indexOf(q) >= 0 ||
    /* v1.2: attachment file names are searchable. Placeholder markup
       itself contributes no text, so snippets stay clean. */
    (n.attachments || []).some(function (a) {
      return (a.name || "").toLowerCase().indexOf(q) >= 0;
    }) ||
    n.tags.some(function (t) { return t.toLowerCase().indexOf(q) >= 0; });
}

function visibleNotes() {
  let list;
  if (state.view.kind === "trash") {
    list = state.trash.slice();
  } else if (state.view.kind === "archive") {
    /* v1.5: the Archive view lists archived notes, mirroring Trash.
       Because every other view reads state.notes, archived notes stay
       out of All Notes, the notebook and tag views, Pinned, and
       search everywhere except inside this view, like trashed notes. */
    list = state.archive.slice();
  } else {
    list = state.notes.slice();
    if (state.view.kind === "pinned") {
      list = list.filter(function (n) { return n.pinned; });
    } else if (state.view.kind === "reminders") {
      /* v2.35: the Reminders view pools every live note
         carrying a reminder, done ones included (Evernote's
         reminders list shows completed reminders as
         completed). Trashed and archived notes never pool
         here: this branch reads state.notes only, like
         every other live view. */
      list = list.filter(function (n) { return !!n.reminderAt; });
    } else if (state.view.kind === "notebook") {
      list = list.filter(function (n) { return n.notebook === state.view.value; });
    } else if (state.view.kind === "tag") {
      list = list.filter(function (n) { return n.tags.indexOf(state.view.value) >= 0; });
    }
  }
  if (state.search) {
    /* v2.32: the grammar path judges a query carrying
       syntax; parseSearchQuery returns null for a plain
       query, and the plain path below is the filter this
       list has always run, byte for byte. */
    const parsed = parseSearchQuery(state.search);
    if (parsed) {
      list = list.filter(function (n) {
        return noteMatchesParsedSearch(n, parsed);
      });
    } else {
      const q = state.search;
      list = list.filter(function (n) {
        return noteMatchesPlainSearch(n, q);
      });
    }
  }
  if (listFiltersActive()) {
    list = list.filter(notePassesListFilters);
  }
  if (state.view.kind === "reminders") {
    /* v2.35: the Reminders view sorts by reminder moment,
       not by the list sort or the pin rule: active
       reminders first, soonest first (overdue naturally
       leads), then done reminders by their moment. This is
       Evernote's reminders list order minus its manual
       drag ordering, which this build does not reproduce. */
    list.sort(compareNotesByReminder);
  } else {
    list.sort(function (a, b) {
      if (!!b.pinned !== !!a.pinned) { return b.pinned ? 1 : -1; }
      return compareNotesByListSort(a, b);
    });
  }
  return list;
}

function viewTitle() {
  if (state.view.kind === "home") { return "Home"; }
  if (state.view.kind === "tasks") { return "Tasks"; }
  if (state.view.kind === "pinned") { return "Pinned"; }
  if (state.view.kind === "reminders") { return "Reminders"; }
  if (state.view.kind === "trash") { return "Trash"; }
  if (state.view.kind === "archive") { return "Archive"; }
  if (state.view.kind === "notebook") {
    const nb = state.notebooks.find(function (n) { return n.slug === state.view.value; });
    return nb ? nb.name : "Notebook";
  }
  if (state.view.kind === "tag") { return "Tag: " + state.view.value; }
  return "All Notes";
}

/* v1.8: the view key of the most recent list render. A change means
   the user switched views or notebooks, which closes any open list
   toolbar panel; filter and sort driven re-renders keep the same
   key, so the filter panel survives its own control changes. */
let lastRenderedListViewKey = null;

/* v2.11: object URLs minted for list card thumbnails, keyed by
   attachment id. The list re-renders wholesale on every change,
   so the whole set is revoked and rebuilt each render, the same
   discipline the editor applies to its own attachment URLs. */
const listThumbUrls = new Map();
function revokeListThumbUrls() {
  listThumbUrls.forEach(function (url) { URL.revokeObjectURL(url); });
  listThumbUrls.clear();
}

/* Load one card thumbnail into its img element, through the
   attachment fetch path. Failures of any kind (signed out,
   offline, a deleted file) simply leave the card without a
   thumbnail: a list decoration must never become an error. */
async function loadListThumb(imgEl, att) {
  try {
    if (listThumbUrls.has(att.id)) {
      imgEl.src = listThumbUrls.get(att.id);
      return;
    }
    const driver = providers[att.provider];
    if (!driver) { return; }
    const status = await driver.getStatus();
    if (!status || !status.connected) { return; }
    const blob = await driver.download(att.fileId);
    const url = URL.createObjectURL(blob);
    listThumbUrls.set(att.id, url);
    if (imgEl.isConnected) { imgEl.src = url; }
  } catch (err) { /* no thumbnail, no error: see the comment above */ }
}

/* v2.18: the attachment a note's card shows in its thumbnail
   box: the note's chosen thumbnail (the v2.11 front matter
   field, an attachment id) when that record is still among
   the note's attachments, and otherwise the note's first
   attachment; null when the note has no attachments at all,
   in which case the card renders no box. */
function cardThumbnailAttachment(note) {
  /* v2.20: a catalog shell carries the record its card shows
     (the chosen thumbnail when set, else the first attachment),
     resolved when the catalog entry was built. */
  if (note.bodyLoaded === false) { return note.shellCardAtt || null; }
  const atts = note.attachments || [];
  if (note.thumbnail) {
    const chosen = atts.find(function (a) {
      return a.id === note.thumbnail;
    });
    if (chosen) { return chosen; }
  }
  return atts.length ? atts[0] : null;
}

/* v2.120: the external image a note's card shows in its
   thumbnail box: the note's FIRST image, when that image
   is an external (web hosted) one. The card loads it
   straight from its address, like the block itself does;
   there is no record and nothing to fetch from the
   store. A note with a chosen thumbnail (the v2.11
   front matter field) keeps the attachment rule above
   untouched: the explicit choice wins, and this returns
   null. A catalog shell carries the answer its catalog
   entry resolved (shellCardExtImage, see
   buildCatalogEntry), so the card paints before the
   note file is ever fetched. */
function cardThumbnailExternal(note) {
  if (!note || note.thumbnail) { return null; }
  if (note.bodyLoaded === false) {
    return note.shellCardExtImage || null;
  }
  return cardThumbnailExternalOf(note);
}

/* The first-image scan over one loaded note's body, in
   document order: an external figure (or a bare web
   image not yet adopted) yields its address; an image
   attachment block ends the scan with no external
   thumbnail (the attachment path governs); file blocks
   are not images and the scan passes them by. */
function cardThumbnailExternalOf(note) {
  if (!note || !note.body) { return null; }
  const holder = document.createElement("div");
  holder.innerHTML = note.body;
  const nodes = holder.querySelectorAll(".ss-attachment, img");
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    if (el.classList.contains("ss-attachment")) {
      if (el.getAttribute("data-attachment-id")) {
        const att = (note.attachments || []).find(function (a) {
          return a.id === el.getAttribute("data-attachment-id");
        });
        if (att && isImageAttachment(att)) { return null; }
        continue;
      }
      if (isExternalImageFigure(el)) {
        return externalImageSrcOf(el);
      }
      continue;
    }
    if (el.closest(".ss-attachment")) { continue; }
    const src = el.getAttribute("src") || "";
    if (!extImageUrlError(src)) { return src; }
  }
  return null;
}

/* v2.18: the type icon a card's thumbnail box shows for a non
   image attachment, drawn in the current color so it takes
   the box's brand tint: a waveform for audio (the mockup's
   example), a play mark for video, a labeled page for PDF,
   and a plain page for everything else. Inline SVG strings,
   the house style for icons; these are card furniture, never
   saved anywhere. */
function attachmentTypeIconSvg(att) {
  const mime = ((att && att.mime) || "").toLowerCase();
  const open = "<svg viewBox=\"0 0 24 24\" width=\"30\" height=\"30\" " +
    "aria-hidden=\"true\" focusable=\"false\">";
  if (mime.indexOf("audio/") === 0) {
    return open +
      "<path d=\"M4 10v4M8 7v10M12 4v16M16 8v8M20 10v4\" " +
      "stroke=\"currentColor\" stroke-width=\"2\" " +
      "stroke-linecap=\"round\" fill=\"none\"/></svg>";
  }
  if (mime.indexOf("video/") === 0) {
    return open +
      "<rect x=\"3\" y=\"5.5\" width=\"18\" height=\"13\" rx=\"2.5\" " +
      "fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\"/>" +
      "<path d=\"M10.5 9.5l5 2.5-5 2.5z\" fill=\"currentColor\"/>" +
      "</svg>";
  }
  if (mime === "application/pdf") {
    return open +
      "<path d=\"M7 3h7l4 4v14H7z\" fill=\"none\" " +
      "stroke=\"currentColor\" stroke-width=\"1.8\" " +
      "stroke-linejoin=\"round\"/>" +
      "<path d=\"M14 3v4h4\" fill=\"none\" stroke=\"currentColor\" " +
      "stroke-width=\"1.8\" stroke-linejoin=\"round\"/>" +
      "<text x=\"12\" y=\"17.5\" text-anchor=\"middle\" " +
      "font-size=\"5\" font-weight=\"700\" " +
      "fill=\"currentColor\">PDF</text></svg>";
  }
  return open +
    "<path d=\"M7 3h7l4 4v14H7z\" fill=\"none\" " +
    "stroke=\"currentColor\" stroke-width=\"1.8\" " +
    "stroke-linejoin=\"round\"/>" +
    "<path d=\"M14 3v4h4\" fill=\"none\" stroke=\"currentColor\" " +
    "stroke-width=\"1.8\" stroke-linejoin=\"round\"/></svg>";
}

function renderNoteList() {
  syncTasksPane();
  const viewKey = state.view.kind + ":" + (state.view.value || "");
  if (lastRenderedListViewKey !== null &&
      lastRenderedListViewKey !== viewKey) {
    closeListPanels();
    /* v1.8.1: leaving a view leaves its multi select set behind. */
    clearListSelections();
    /* v2.58: the touch selection mode ends with the view too. */
    noteSelectMode = false;
  }
  lastRenderedListViewKey = viewKey;
  /* v2.11: the previous render's thumbnail URLs are released
     before the list is rebuilt. */
  revokeListThumbUrls();
  const listEl = document.getElementById("noteList");
  /* v2.24.1: the Tasks view renders into its own pane
     (syncTasksPane, above, has already traded the panes'
     hidden classes). The list pane is left exactly as it
     was, title, toolbar, and rows, for the way back. */
  if (state.view.kind === "tasks") {
    renderTasksView();
    return;
  }
  const list = visibleNotes();
  document.getElementById("listTitle").textContent = viewTitle();
  document.getElementById("listSub").textContent =
    list.length + (list.length === 1 ? " note" : " notes") +
    (state.search ? " matching \"" + state.search + "\"" : "");
  /* v2.32: the Save search button's visibility and label
     follow the search this list is showing. */
  syncSaveSearchButton();
  renderListToolbar();
  listEl.innerHTML = "";

  if (!state.repoExists && !list.length) {
    listEl.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "<div class=\"big\">No storage connected yet</div>" +
      "Finish connecting your " + storageDisplayName() +
      " storage and your notes will appear here.";
    listEl.appendChild(empty);
    return;
  }
  /* v2.24.3: the Things to do tiles for this view (see
     taskTilesForCurrentView): one card per notebook that has
     any tasks, never in Trash, Archive, Pinned, or a tag view,
     and not while a search or the list filters are narrowing
     the notes. A view with tasks but no notes shows its tile
     and a quiet line where the empty state would have been. */
  const tiles = taskTilesForCurrentView();
  if (!list.length && !tiles.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    if (state.view.kind === "trash") {
      empty.innerHTML = "<div class=\"big\">Trash is empty</div>Notes you move to Trash will wait here until you restore them or delete them forever.";
    } else if (state.view.kind === "reminders") {
      empty.innerHTML = "<div class=\"big\">No reminders</div>Set a reminder on a note, from its editor's Reminder button or the list menu, and it will gather here.";
    } else if (state.view.kind === "archive") {
      empty.innerHTML = "<div class=\"big\">Archive is empty</div>Notes you archive will wait here until you unarchive them or move them to Trash.";
    } else if (listFiltersActive()) {
      empty.innerHTML = "<div class=\"big\">No matches</div>No notes match the current filters in this view. Clear the filters to see everything again.";
    } else if (state.search) {
      empty.innerHTML = "<div class=\"big\">No matches</div>No notes match that search in this view.";
    } else {
      empty.innerHTML = "<div class=\"big\">No notes here yet</div>Press New Note to write your first one.";
    }
    listEl.appendChild(empty);
    return;
  }
  /* v1.8.1: the multi select set this view's rows draw from:
     the Trash set in Trash, the Archive set in the Archive,
     and (v2.39) the live set everywhere else, so notes can be
     checked in any live list for Merge Selected. The Tasks
     view returns above, before this point, and never draws
     note rows. */
  const selectSet = state.view.kind === "trash" ? state.trashSelection
    : state.view.kind === "archive" ? state.archiveSelection
    : state.listSelection;

  /* v2.24.3: the tiles and the cards render as one merged
     sequence (see listItemsWithTiles): the tiles interleave
     with the cards under the list's sort, each standing where
     its notebook's latest task activity falls. A tile is not
     a note: it never counts in the "N notes" line above,
     never multi selects, and carries no note id, so the drag
     machinery passes it by. While a Things to do page is
     open, no note card wears the active treatment: the tile
     of the page's notebook wears it instead. */
  listItemsWithTiles(list, tiles).forEach(function (item) {
    if (item.tile) {
      listEl.appendChild(buildTaskTileEl(item.tile));
      return;
    }
    const note = item.note;
    const card = document.createElement("div");
    card.className = "note-card" +
      ((note.id === state.selectedId && !state.thingsNotebook)
        ? " active" : "");
    /* v2.4: the drag and drop pointer handler is delegated on the
       list, so the card itself carries the note id it stands for. */
    card.setAttribute("data-note-id", note.id);
    if (selectSet) {
      /* v2.58: a selected card wears the multi-selected
         treatment, and that IS the indicator now. There
         is no checkbox: selection input is the card's
         own click with its modifiers
         (handleNoteCardClick), or the touch selection
         mode the context menu starts. */
      if (selectSet.indexOf(note.id) >= 0) {
        card.classList.add("multi-selected");
      }
    }
    /* v2.18: the card's text column, in the mockup's order: the
       meta line (notebook name, a dot, relative updated time),
       the bold title, the one line preview, and the tag pills.
       The column is every card's left half now (through v2.17
       it existed only beside a chosen image thumbnail); the
       thumbnail box, when the note has one, is appended to
       the card after the column, which puts it at the right. */
    const main = document.createElement("div");
    main.className = "card-main";
    card.appendChild(main);

    const meta = document.createElement("div");
    meta.className = "card-meta";
    const metaNb = notebookNameForNote(note);
    const metaWhen = relativeTimeLabel(note.updated);
    meta.textContent = metaNb ? metaNb + " · " + metaWhen : metaWhen;
    main.appendChild(meta);

    const titleRow = document.createElement("div");
    titleRow.className = "card-title";
    if (note.pinned && !note.trashed && !note.archived) {
      const pin = document.createElement("span");
      pin.className = "pin-mark";
      pin.textContent = "PINNED";
      titleRow.appendChild(pin);
    }
    const titleText = document.createElement("span");
    titleText.className = "card-title-text";
    titleText.textContent = note.title || "Untitled note";
    titleRow.appendChild(titleText);
    main.appendChild(titleRow);

    /* v2.20: noteListText is the body derived text for a loaded
       note and the catalog preview for a shell; the same 140
       character cap either way. */
    const snippetText = noteListText(note).slice(0, 140);
    if (snippetText) {
      const snip = document.createElement("div");
      snip.className = "card-snippet";
      snip.textContent = snippetText;
      main.appendChild(snip);
    }
    if (note.tags.length) {
      const row = document.createElement("div");
      row.className = "chip-row";
      note.tags.forEach(function (t) {
        const chip = document.createElement("span");
        chip.className = "tag-chip";
        chip.textContent = t;
        row.appendChild(chip);
      });
      main.appendChild(row);
    }
    /* v2.35: the reminder line, under the tag row: the bell
       glyph and the moment in the app's date words
       (noteReminderLabel), wearing .overdue while an
       unfinished reminder's moment has passed and .done
       once it is marked done. The pair rides on the note
       object for shells and loaded notes alike (the
       catalog carries it at shape 3), so the line renders
       before the note is ever opened. */
    if (note.reminderAt) {
      const rem = document.createElement("div");
      rem.className = "card-reminder" +
        (note.reminderDoneAt ? " done"
          : (new Date(note.reminderAt).getTime() <= Date.now()
            ? " overdue" : ""));
      rem.innerHTML = '<svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true" focusable="false"><path d="M10 2.5a5.5 5.5 0 0 0-5.5 5.5c0 4-1.2 5.2-2 6h14c-.8-.8-2-2-2-6A5.5 5.5 0 0 0 10 2.5zM8.4 16.8a1.8 1.8 0 0 0 3.2 0" fill="currentColor" stroke="none"/></svg>';
      const remText = document.createElement("span");
      remText.textContent = noteReminderLabel(note);
      rem.appendChild(remText);
      main.appendChild(rem);
    }

    /* v2.18: the thumbnail box. The attachment it shows is the
       note's chosen thumbnail (the v2.11 front matter field)
       when that record is still on the note, and otherwise
       the note's first attachment; a note with neither renders
       no box at all. An image fills the box through the same
       loadListThumb path the chosen thumbnail always used;
       anything else shows its attachment type icon centered
       (the audio waveform in Chris's mockup). */
    /* v2.120: an external first image fills the same
       box straight from its address (no record, no
       store fetch); the attachment box below is
       otherwise exactly as it stood. */
    const cardExt = cardThumbnailExternal(note);
    const cardAtt = cardThumbnailAttachment(note);
    if (cardExt) {
      const box = document.createElement("div");
      box.className = "card-thumb-box";
      const thumb = document.createElement("img");
      thumb.className = "card-thumb";
      thumb.alt = "";
      thumb.setAttribute("loading", "lazy");
      thumb.src = cardExt;
      box.appendChild(thumb);
      card.appendChild(box);
    } else if (cardAtt) {
      const box = document.createElement("div");
      box.className = "card-thumb-box";
      if (isImageAttachment(cardAtt)) {
        const thumb = document.createElement("img");
        thumb.className = "card-thumb";
        thumb.alt = "";
        box.appendChild(thumb);
        loadListThumb(thumb, cardAtt);
      } else {
        const icon = document.createElement("span");
        icon.className = "card-thumb-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.innerHTML = attachmentTypeIconSvg(cardAtt);
        box.appendChild(icon);
      }
      card.appendChild(box);
    }
    card.addEventListener("click", function (ev) {
      handleNoteCardClick(ev, note);
    });
    listEl.appendChild(card);
  });
  /* v2.24.3: a view with tiles but no notes (a notebook whose
     work is all tasks, so far) keeps the quiet line that sat
     under the old group. */
  if (!list.length) {
    const noNotes = document.createElement("div");
    noNotes.className = "hint";
    noNotes.style.padding = "4px 10px";
    noNotes.textContent =
      "No notes here yet. Press New Note to write your first one.";
    listEl.appendChild(noNotes);
  }
  /* v2.36: nearly every change to the store (a save landing,
     a trash or restore, a rename, a delete) re-renders this
     list, so it is the honest place to keep the open note's
     backlinks bar current with it; the panel refresh is
     signature guarded and leaves a settled bar untouched. */
  refreshBacklinksPanel();
  /* v2.58: the selection bar (the touch selection mode's
     chrome) repaints with the list it belongs to. */
  renderListSelectBar();
}

/* --------------------------------------------------------------------------
   v2.16.1: refreshing the open note when a sync changes it.

   The standing editor rule (in renderEditor below) never
   refills the fields of the note already open, so a re-render
   during typing can neither move the cursor nor clobber input.
   Live testing v2.16.0 showed the rule's blunt edge: when an
   auto-sync landed an outside edit to the very note on screen,
   the list updated around an editor that kept showing the old
   text until the user clicked away and back. This block is
   the refinement, and it is deliberately narrow. syncNow
   snapshots the open note's state before its flush and load,
   arms the snapshot for its renderAll, and renderEditor asks
   syncShouldRefillOpenNote whether this render may refill the
   open note's fields in place. Three facts must all hold:

   - The render belongs to that sync (the snapshot is armed)
     and names the same note that is already open.
   - The load actually changed the note: the freshly loaded
     title, body, or tags differ from the pre-sync content.
     An unchanged note needs no refill (and an auto-sync's
     v2.16 guard has usually already kept its hands off).
   - The editor is clean: what it shows right now, read back
     through the exact canonicalization the save path applies
     (collectEditor's three reads, taken without applying
     them), equals the note's pre-sync last saved content (the
     v2.8 baseline in lastSavedContentByNoteId). Any difference
     at all (typed text, a title edit in flight, a checklist
     toggle the autosave has not landed yet, a tags edit)
     means hands off: the user's in-flight work is never
     overwritten by a sync, and the editor stays exactly as it
     behaves without this block.

   The baseline is the right cleanliness reference because it
   is by construction what the editor was last filled from or
   saved to; a body the runtime decorated on open (link
   faces, hydrated attachment shells, healed checklist boxes)
   canonicalizes back to it through the same funnel every
   save passes through. A note whose saved body would not
   survive that round trip simply never looks clean, the
   refill is skipped, and the old behavior stands: the safe
   direction to fail.

   A refill is the ordinary field fill (the same block a note
   switch runs, hydration included), bracketed by a view
   state capture and restore: the scroll container's
   scrollTop, and the caret as a character offset into the
   body's text, restored clamped to the new body. Trashed and
   archived notes are read only, so nothing in them can be
   unsaved; they refill under the same clean rule, and a sync
   that moves the open note between lists or notebooks (or
   away entirely) reaches the same end states the render
   already produced for those cases, because this decision
   only ever adds a field fill for a note that is still the
   open one, still carrying its id.
   -------------------------------------------------------------------------- */
let syncOpenNoteRefresh = null;

/* v2.132: a refused refill is remembered, and retried.
   Until now, when a fetched body differed and the
   editor comparison below refused the in-place refill
   (the editor held anything the baseline did not: real
   typing, a tags edit in flight, a canonical form that
   does not round trip), the refusal was final for as
   long as the reader stayed on the note. The fetch had
   already landed the fresh body on the note object,
   and both drivers (a sync's load, the poll's tick)
   had already re-remembered the baseline FROM that
   body, so every later judgment compared the fresh
   body against itself and saw nothing to retry with.
   The screen kept the old text until a note switch or
   a restart, silently. The refusal now stashes the
   pre-change context here, by note id, with the
   markers and the content the fetch landed, and the
   retry below re-arms that exact context when a later
   moment (a poll tick, a visibility return, an
   autosave settle, a switch back in) finds the note
   open again. The dirty editor is still never
   overwritten: the retry is the same judgment run
   again, and it lands only when the editor has
   settled back to the stashed baseline. The stash
   clears when the refill lands, when a switch fill
   shows the body, when the note's own save takes
   ownership of the outcome, or when a newer fetch
   replaces the stashed one (a refusal under a newer
   context simply re-stashes). */
const pendingNoteRefills = Object.create(null);

function stashPendingNoteRefill(note, ctx) {
  pendingNoteRefills[note.id] = {
    ctx: ctx,
    sha: note.sha || null,
    docModifiedTime: note.docModifiedTime || null,
    fetched: noteContentSnapshot(note)
  };
}

function clearPendingNoteRefill(id) {
  if (id && pendingNoteRefills[id]) {
    delete pendingNoteRefills[id];
  }
}

/* Re-judge a refused refill for the open note, if one
   stands. The note must still hold the very body the
   stash describes: a save or a newer fetch since the
   refusal has moved its markers or replaced its
   content, and either one owns the outcome, so the
   stash clears instead of judging. A landing clears
   the stash in renderEditor's fill below; a renewed
   refusal re-stashes under the same context. */
function retryPendingNoteRefill() {
  const note = (typeof currentNote === "function")
    ? currentNote() : null;
  if (!note) { return; }
  const stash = pendingNoteRefills[note.id];
  if (!stash) { return; }
  if (renderEditor._forId !== note.id) { return; }
  if ((note.sha || null) !== stash.sha ||
      !versionTextContentEqual(stash.fetched,
        noteContentSnapshot(note))) {
    delete pendingNoteRefills[note.id];
    return;
  }
  syncOpenNoteRefresh = stash.ctx;
  try {
    renderAll();
  } finally {
    syncOpenNoteRefresh = null;
  }
}

/* The autosave settle hook (called from
   runEditorAutosave in editor-tools.js): a pass that
   SAVED the note hands the outcome to the save, so a
   pending refill for it clears; a pass that landed
   nothing (the untouched gate's no-op, a pause, a
   failure) re-judges the pending refill with the
   editor as the pass left it. */
function settlePendingNoteRefill(note, saved) {
  if (!note) { return; }
  if (saved) { clearPendingNoteRefill(note.id); return; }
  if (typeof currentNote === "function" &&
      currentNote() && currentNote().id === note.id) {
    retryPendingNoteRefill();
  }
}

/* The pre-sync snapshot of the open note, taken by syncNow
   before its flush: the note's id, a clone of its last saved
   content baseline (null when the note somehow has none, in
   which case no refill can ever be proven safe), and a
   content snapshot of the note object as the sync found it. */
function captureOpenNoteSyncContext() {
  const open = currentNote();
  if (!open) { return null; }
  const saved = lastSavedContentByNoteId[open.id];
  return {
    id: open.id,
    baseline: saved ? cloneVersionValue(saved) : null,
    before: noteContentSnapshot(open)
  };
}

/* May this render refill the open note's fields with the
   copy the sync just loaded? See the block comment above for
   the three facts that must all hold. */
function syncShouldRefillOpenNote(note) {
  const ctx = syncOpenNoteRefresh;
  if (!ctx || ctx.id !== note.id) { return false; }
  if (renderEditor._forId !== note.id) { return false; }
  if (!ctx.baseline) { return false; }
  if (versionTextContentEqual(ctx.before, noteContentSnapshot(note))) {
    return false;
  }
  const editorNow = {
    title: document.getElementById("noteTitle").value.trim() ||
      "Untitled note",
    body: canonicalizeAttachmentPlaceholders(
      document.getElementById("noteBody").innerHTML),
    tags: document.getElementById("noteTags").value
      .split(",")
      .map(function (t) { return t.trim(); })
      .filter(function (t) { return t.length > 0; })
  };
  if (versionTextContentEqual(editorNow, ctx.baseline)) {
    return true;
  }
  /* v2.132: the content changed and the editor is not
     at the baseline: this refusal is the pending
     refill case (see the stash above). The dirty
     editor is never overwritten, today or on any
     retry; the refusal is simply no longer silent
     and final. */
  stashPendingNoteRefill(note, ctx);
  return false;
}

/* The caret as a character offset into a body's text: the
   lengths of every text node before the anchor, in document
   order, plus the offset inside the anchor node itself.
   Returns -1 when the selection does not sit on a text node
   inside the body, in which case no caret is restored. */
function editorCaretTextOffset(bodyEl) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) { return -1; }
  const anchor = sel.anchorNode;
  if (!anchor || anchor.nodeType !== 3 || !bodyEl.contains(anchor)) {
    return -1;
  }
  let total = 0;
  const walker = document.createTreeWalker(
    bodyEl, NodeFilter.SHOW_TEXT, null);
  let node = walker.nextNode();
  while (node) {
    if (node === anchor) { return total + sel.anchorOffset; }
    total += node.nodeValue.length;
    node = walker.nextNode();
  }
  return -1;
}

function captureEditorViewState() {
  const scroller = document.querySelector(".editor-scroll");
  const bodyEl = document.getElementById("noteBody");
  return {
    scrollTop: scroller ? scroller.scrollTop : 0,
    caret: bodyEl ? editorCaretTextOffset(bodyEl) : -1
  };
}

/* Put the view state back after a refill: the scroll offset
   as it was, and the caret at the saved text offset, clamped
   to whatever text the new body actually has (to its very
   end when the new body is shorter, and nowhere at all when
   it has no text). */
function restoreEditorViewState(view) {
  const scroller = document.querySelector(".editor-scroll");
  if (scroller) { scroller.scrollTop = view.scrollTop; }
  if (view.caret < 0) { return; }
  const bodyEl = document.getElementById("noteBody");
  if (!bodyEl) { return; }
  let remaining = view.caret;
  let target = null;
  let targetOffset = 0;
  let lastText = null;
  const walker = document.createTreeWalker(
    bodyEl, NodeFilter.SHOW_TEXT, null);
  let node = walker.nextNode();
  while (node) {
    lastText = node;
    if (remaining <= node.nodeValue.length) {
      target = node;
      targetOffset = remaining;
      break;
    }
    remaining -= node.nodeValue.length;
    node = walker.nextNode();
  }
  if (!target && lastText) {
    target = lastText;
    targetOffset = lastText.nodeValue.length;
  }
  if (!target) { return; }
  const range = document.createRange();
  range.setStart(target, targetOffset);
  range.collapse(true);
  const sel = window.getSelection();
  if (!sel) { return; }
  sel.removeAllRanges();
  sel.addRange(range);
}

/* --------------------------------------------------------------------------
   v2.112.0: a sync keeps the reader's place

   Chris (2026-11-04): "When syncing and using Sync
   Now, the whole app refreshes and I end up losing
   my place. Can you have it Sync in the background
   without having to refresh the whole app? Unless
   it has to directly refresh what I am working
   on/in, but the whole app shouldn't refresh like
   I pressed F5."

   syncNow never reloads the page. What it does is
   flush, load, and renderAll(), and the render
   rebuilds every surface wholesale. Whether a
   rebuilt surface's scroller kept its offset was
   the browser's clamp behavior, not a promise, and
   one surface lost the place outright in
   measurement: when the load changed the viewed
   list's membership above the reader's card (a note
   arriving from another device sorts in above it;
   notes vanishing do the same from the other side),
   the rebuilt list kept its numeric scroll offset
   while the content slid under it, so the card
   being read moved by the height of whatever came
   or went.

   So syncNow now brackets its render with a place
   capture and restore. The capture is taken with
   the load landed and the render about to run, so
   it reads the place the reader actually holds at
   that moment, typing done through the load
   included. The restore runs on the render's far
   side:

   - The notes list is anchored, not numbered: the
     card standing at the top of the list's viewport
     (the first card whose foot passes the list's
     top edge) and its offset from that edge are
     captured, and the restore scrolls the rebuilt
     list so that same card stands at that same
     offset. When the card itself is gone (the sync
     took it), the captured numeric offset stands
     instead, clamped by the browser to whatever
     the new content allows.
   - The editor, while it stands open on a note
     that is still the selected one, is restored
     through restoreEditorViewState: the scroll
     offset numerically and the caret as a character
     offset, clamped to the body that stands. A
     clean editor the sync refilled has already had
     the same restore from the refill itself; this
     pass is the guarantee for every other path,
     and it never runs for a note the sync moved
     the reader away from.
   - Home, Tasks (the calendar rides in the same
     pane), and the Email list keep their numeric
     scroll offsets.

   Only laid out surfaces are captured or restored:
   a hidden pane has no place to keep, and its own
   return render rebuilds it as it always has. The
   scroll restore is applied once as the render
   lands and once more on the next frame, so a
   surface whose layout settles a frame late (the
   Home grid's pack is the standing example) still
   lands at its offset; the caret is set once, in
   the synchronous pass, so a frame of the reader's
   own typing can never be pulled back. Each
   surface restores inside its own guard, so one
   surface's failure cannot take the others.
   Nothing else in the sync changes: the flush
   order, the load, the conflict decisions, the
   drop box, and the calendar and mail refresh
   calls stand as they were. This is only what the
   render is allowed to do to the reader's place.
   -------------------------------------------------------------------------- */
let syncPlaceGeneration = 0;

/* The reader's place, in restoreSyncPlace's shape.
   list: { top, anchorId, anchorOff } or null when
   the list is not laid out; editor: { id, view }
   or null when no editor stands open; home, tasks,
   and mail: a numeric offset, or null when the
   scroller does not exist. */
function captureSyncPlace() {
  const place = { list: null, editor: null,
    home: null, tasks: null, mail: null };
  try {
    const listEl = document.getElementById("noteList");
    if (listEl && listEl.clientHeight > 0) {
      const entry = { top: listEl.scrollTop,
        anchorId: null, anchorOff: 0 };
      const listRect = listEl.getBoundingClientRect();
      const cards = listEl.querySelectorAll(".note-card");
      for (let i = 0; i < cards.length; i++) {
        const r = cards[i].getBoundingClientRect();
        if (r.bottom > listRect.top + 2) {
          entry.anchorId =
            cards[i].getAttribute("data-note-id");
          entry.anchorOff = r.top - listRect.top;
          break;
        }
      }
      place.list = entry;
    }
  } catch (err) {
    console.warn("Sync place capture (list) failed: " +
      (err && err.message));
  }
  try {
    const scroller = document.querySelector(
      "#editorWrap .editor-scroll");
    const note = currentNote();
    if (scroller && scroller.clientHeight > 0 && note) {
      place.editor = { id: note.id,
        view: captureEditorViewState() };
    }
  } catch (err) {
    console.warn("Sync place capture (editor) failed: " +
      (err && err.message));
  }
  const numeric = function (id) {
    const el = document.getElementById(id);
    return el ? el.scrollTop : null;
  };
  try { place.home = numeric("homeScroll"); }
  catch (err) { place.home = null; }
  try { place.tasks = numeric("tasksScroll"); }
  catch (err) { place.tasks = null; }
  try { place.mail = numeric("mailList"); }
  catch (err) { place.mail = null; }
  return place;
}

/* The scroll half of the restore, shared by the
   synchronous pass and the next frame's: the list
   anchor first (falling back to the captured
   number when the card is gone), then the numeric
   scrollers, each only while it stands laid out. */
function restoreSyncPlaceScrolls(place) {
  if (place.list) {
    try {
      const listEl = document.getElementById("noteList");
      if (listEl && listEl.clientHeight > 0) {
        let anchored = false;
        if (place.list.anchorId) {
          const listRect = listEl.getBoundingClientRect();
          const cards =
            listEl.querySelectorAll(".note-card");
          for (let i = 0; i < cards.length; i++) {
            if (cards[i].getAttribute("data-note-id") ===
                place.list.anchorId) {
              const off = cards[i]
                .getBoundingClientRect().top - listRect.top;
              listEl.scrollTop +=
                off - place.list.anchorOff;
              anchored = true;
              break;
            }
          }
        }
        if (!anchored) {
          listEl.scrollTop = place.list.top;
        }
      }
    } catch (err) {
      console.warn("Sync place restore (list) failed: " +
        (err && err.message));
    }
  }
  const numeric = function (id, value) {
    if (value === null || value === undefined) { return; }
    try {
      const el = document.getElementById(id);
      if (el && el.clientHeight > 0) {
        el.scrollTop = value;
      }
    } catch (err) {
      console.warn("Sync place restore (" + id +
        ") failed: " + (err && err.message));
    }
  };
  numeric("homeScroll", place.home);
  numeric("tasksScroll", place.tasks);
  numeric("mailList", place.mail);
  if (place.editor) {
    try {
      const scroller = document.querySelector(
        "#editorWrap .editor-scroll");
      if (scroller && scroller.clientHeight > 0 &&
          state.selectedId === place.editor.id) {
        scroller.scrollTop = place.editor.view.scrollTop;
      }
    } catch (err) {
      console.warn("Sync place restore (editor " +
        "scroll) failed: " + (err && err.message));
    }
  }
}

/* Put a captured place back after a sync's render:
   the scrolls and, in this pass only, the editor's
   caret; then the scrolls once more on the next
   frame, under a generation token a newer sync
   supersedes. */
function restoreSyncPlace(place) {
  if (!place) { return; }
  restoreSyncPlaceScrolls(place);
  if (place.editor &&
      state.selectedId === place.editor.id) {
    try {
      restoreEditorViewState(place.editor.view);
    } catch (err) {
      console.warn("Sync place restore (editor) " +
        "failed: " + (err && err.message));
    }
  }
  const generation = ++syncPlaceGeneration;
  requestAnimationFrame(function () {
    if (generation !== syncPlaceGeneration) { return; }
    restoreSyncPlaceScrolls(place);
  });
}


/* --------------------------------------------------------------------------
   v2.72: per note editor view memory

   Leaving a note banks where its editor stood (the
   scroll offset and the caret as a text offset, the
   pair captureEditorViewState already takes for the
   sync refill), and opening it again puts them back
   through restoreEditorViewState, with that function's
   own clamping when the body has changed since. The
   bank is this device's: it lives in its own local
   storage record (LS_EDITOR_VIEW), capped at the most
   recent EDITOR_VIEW_BANK_MAX notes, and is written
   only when a note is left, so it costs nothing while
   typing. It survives a reload, the self update's
   reload included, which the local snapshot machinery
   makes cheap: the record is small, separate, and
   sanitized on read.

   The capture point is openNoteNow, the one funnel
   every switch passes through, taken while the
   outgoing note is still the selected one and its
   editor still stands. The restore point is
   renderEditor's switch fill, beside the sync refill's
   own restore (which keeps precedence: a refill is the
   same note staying open, not a return). Two openings
   keep the land at the top behavior they have always
   had, by naming themselves in editorAtTopNoteId
   first: following a note link (followNoteLink) and a
   note reminder's arrival
   (maybeOpenPendingNoteReminder); the fill that opens
   their target zeroes the scroll instead of restoring.
   -------------------------------------------------------------------------- */
const EDITOR_VIEW_BANK_MAX = 100;
let editorViewBank = null;   /* null until first read */
let editorAtTopNoteId = null;

function loadEditorViewStates() {
  if (editorViewBank) { return editorViewBank; }
  editorViewBank = {};
  try {
    const parsed = JSON.parse(
      localStorage.getItem(LS_EDITOR_VIEW) || "null");
    if (parsed && typeof parsed === "object" &&
        !Array.isArray(parsed)) {
      Object.keys(parsed).forEach(function (id) {
        const v = parsed[id];
        if (v && typeof v === "object" &&
            Number.isFinite(v.s) && v.s >= 0 &&
            Number.isFinite(v.c)) {
          editorViewBank[id] = {
            s: Math.floor(v.s), c: Math.floor(v.c)
          };
        }
      });
    }
  } catch (err) { editorViewBank = {}; }
  return editorViewBank;
}

function persistEditorViewStates() {
  try {
    localStorage.setItem(LS_EDITOR_VIEW,
      JSON.stringify(editorViewBank || {}));
  } catch (err) {
    /* A full or refused store keeps the session's bank;
       the memory in editorViewBank still serves this
       session's returns. */
  }
}

/* Bank the open editor's place under the note being
   left. Called from openNoteNow before the selection
   moves, so the caret read is the outgoing note's own. */
function rememberEditorViewState(noteId) {
  if (!noteId) { return; }
  const view = captureEditorViewState();
  const bank = loadEditorViewStates();
  delete bank[noteId];
  bank[noteId] = { s: view.scrollTop, c: view.caret };
  const ids = Object.keys(bank);
  if (ids.length > EDITOR_VIEW_BANK_MAX) {
    ids.slice(0, ids.length - EDITOR_VIEW_BANK_MAX)
      .forEach(function (id) { delete bank[id]; });
  }
  persistEditorViewStates();
}

/* The banked place for a note being opened, in
   restoreEditorViewState's shape, or null when the
   note was never left this side of the bank's cap. */
function recalledEditorViewState(noteId) {
  const bank = loadEditorViewStates();
  const v = bank[noteId];
  if (!v) { return null; }
  return { scrollTop: v.s, caret: v.c };
}

/* --------------------------------------------------------------------------
   task surfaces: the Things to do tiles and page (v2.24.3),
   the Tasks view, the task editor, and reminder notifications

   Rendering mirrors the note list's habits: rows are built
   with DOM APIs and textContent, rebuilt wholesale on every
   and their controls are wired as they are built. The
   checkbox on a row completes (or reopens) without opening;
   the row itself opens the editor. Every mutation re-renders
   through afterTasksChanged, so the sidebar count, the
   tiles, an open Things to do page, and the Tasks view can
   never disagree.
   -------------------------------------------------------------------------- */
const TASK_FLAG_SVG =
  "<svg viewBox=\"0 0 16 16\" width=\"13\" height=\"13\" " +
  "aria-hidden=\"true\" focusable=\"false\">" +
  "<path d=\"M4 14.5v-12\" stroke=\"currentColor\" stroke-width=\"1.7\" " +
  "stroke-linecap=\"round\" fill=\"none\"/>" +
  "<path d=\"M4 2.8c2.2-1.3 4.2 1 6.8 0l1.2-.5v5.4l-1.2.5c-2.6 1-4.6-1.3-6.8 0z\" " +
  "fill=\"currentColor\"/></svg>";

/* The small check inside a progress pill (the tile's and the
   Things page's), in currentColor so it follows the theme. */
const TASK_CHECK_SVG =
  "<svg viewBox=\"0 0 16 16\" width=\"12\" height=\"12\" " +
  "aria-hidden=\"true\" focusable=\"false\">" +
  "<path d=\"M3 8.6l3.1 3L13 4.7\" stroke=\"currentColor\" " +
  "stroke-width=\"2.1\" stroke-linecap=\"round\" " +
  "stroke-linejoin=\"round\" fill=\"none\"/></svg>";

/* One notebook's tasks, every status. */
function tasksForNotebook(slug) {
  return state.tasks.filter(function (t) {
    return t.notebook === slug;
  });
}

/* The Things to do tile for one notebook, or null when the
   notebook has no tasks at all: the notebook's name, its
   activity (the latest updated stamp across its tasks, which
   the list sort places the tile by), and the completed over
   total pair the progress pill reads. */
function taskTileForNotebook(slug) {
  const tasks = tasksForNotebook(slug);
  if (!tasks.length) { return null; }
  let activity = "";
  let completed = 0;
  tasks.forEach(function (t) {
    if (String(t.updated || "") > activity) {
      activity = String(t.updated || "");
    }
    if (t.status === "completed") { completed += 1; }
  });
  return {
    slug: slug,
    name: notebookNameForSlug(slug),
    activity: activity,
    total: tasks.length,
    completed: completed
  };
}

/* The tiles a notebook or All Notes list shows (v2.24.3):
   a notebook view carries at most one, its own notebook's;
   All Notes carries one per notebook that has tasks, in the
   sidebar's notebook order, with a tile for tasks whose
   notebook no longer exists standing under its slug rather
   than vanishing. Empty outside those two views, and while
   a search or the list filters narrow the notes (see
   renderNoteList), the same gates the old Tasks group kept. */
function taskTilesForCurrentView() {
  if (state.view.kind !== "all" && state.view.kind !== "notebook") {
    return [];
  }
  if (state.search || listFiltersActive()) { return []; }
  if (state.view.kind === "notebook") {
    const only = taskTileForNotebook(state.view.value);
    return only ? [only] : [];
  }
  const tiles = [];
  const seen = {};
  state.notebooks.forEach(function (nb) {
    seen[nb.slug] = true;
    const tile = taskTileForNotebook(nb.slug);
    if (tile) { tiles.push(tile); }
  });
  state.tasks.forEach(function (t) {
    if (seen[t.notebook]) { return; }
    seen[t.notebook] = true;
    const tile = taskTileForNotebook(t.notebook);
    if (tile) { tiles.push(tile); }
  });
  return tiles;
}

/* The tile card itself, on the note card system: the meta
   line (notebook name, a dot, the relative activity time),
   the bold "Things to do" title, and the progress pill in the
   card's pill row. A click opens the notebook's Things to do
   page in the editor pane (openThingsToDo). The tile wears
   the card's active treatment while its page is open. */
function buildTaskTileEl(tile) {
  const card = document.createElement("div");
  card.className = "note-card task-tile" +
    (state.thingsNotebook === tile.slug ? " active" : "");
  card.setAttribute("data-task-tile", tile.slug);
  card.title = "Things to do in " + tile.name;
  const main = document.createElement("div");
  main.className = "card-main";
  card.appendChild(main);
  const meta = document.createElement("div");
  meta.className = "card-meta";
  const when = relativeTimeLabel(tile.activity);
  meta.textContent = when ? tile.name + " · " + when : tile.name;
  main.appendChild(meta);
  const titleRow = document.createElement("div");
  titleRow.className = "card-title";
  const titleText = document.createElement("span");
  titleText.className = "card-title-text";
  titleText.textContent = "Things to do";
  titleRow.appendChild(titleText);
  main.appendChild(titleRow);
  /* v2.24.4: a snippet line in the note card's own snippet
     slot, so the tile carries the same three line rhythm as
     a note card (meta, title, one quiet line, pills) instead
     of an empty gap over its pill. Presentation only, from
     the counts the tile already carries; the stylesheet
     shows it at phone widths and keeps the desktop card at
     its v2.24.3 height. */
  const snippet = document.createElement("div");
  snippet.className = "card-snippet task-tile-snippet";
  const openCount = tile.total - tile.completed;
  snippet.textContent = openCount === 0
    ? "All tasks completed"
    : openCount + (openCount === 1 ? " open task" : " open tasks") +
      (tile.completed
        ? " · " + tile.completed + " completed" : "");
  main.appendChild(snippet);
  const row = document.createElement("div");
  row.className = "chip-row";
  const pill = document.createElement("span");
  pill.className = "task-progress-pill";
  pill.innerHTML = TASK_CHECK_SVG;
  const pillText = document.createElement("span");
  pillText.textContent = tile.completed + "/" + tile.total;
  pill.appendChild(pillText);
  row.appendChild(pill);
  main.appendChild(row);
  card.addEventListener("click", function () {
    openThingsToDo(tile.slug);
  });
  return card;
}

/* The merged render sequence for a list: the notes in the
   order visibleNotes gave them and the tiles placed among
   them under the list's own sort rules (pinned notes first,
   then the sort field and direction), a tile comparing by
   its activity time where a note compares by the same date
   field, and by its title where the sort is by title. The
   sort is stable, so the notes keep their given order among
   themselves and the tiles keep theirs. */
function listItemsWithTiles(list, tiles) {
  const items = list.map(function (note) { return { note: note }; });
  if (!tiles.length) { return items; }
  tiles.forEach(function (tile) { items.push({ tile: tile }); });
  function fieldsOf(item) {
    if (item.tile) {
      return {
        pinned: false, title: "Things to do",
        created: item.tile.activity, updated: item.tile.activity
      };
    }
    return item.note;
  }
  items.sort(function (a, b) {
    const fa = fieldsOf(a), fb = fieldsOf(b);
    if (!!fb.pinned !== !!fa.pinned) { return fb.pinned ? 1 : -1; }
    return compareNotesByListSort(fa, fb);
  });
  return items;
}

function buildTaskGroupHeadEl(title, count, opts) {
  opts = opts || {};
  const head = document.createElement("div");
  head.className = "task-group-head";
  /* v2.24.1: in the Tasks view the head is collapsible: a
     chevron button at its left toggles the group's rows
     (the caller owns the collapsed state and the re-render).
     A caller with no head to collapse passes no opts and
     gets the plain head. */
  if (opts.collapsible) {
    const chev = document.createElement("button");
    chev.type = "button";
    chev.className = "task-group-chev" +
      (opts.collapsed ? " collapsed" : "");
    chev.textContent = ">";
    chev.setAttribute("aria-expanded",
      opts.collapsed ? "false" : "true");
    chev.setAttribute("aria-label",
      (opts.collapsed ? "Expand " : "Collapse ") + title + " group");
    chev.addEventListener("click", function () {
      if (opts.onToggle) { opts.onToggle(); }
    });
    head.appendChild(chev);
  }
  const titleEl = document.createElement("span");
  titleEl.className = "task-group-title";
  titleEl.textContent = title;
  head.appendChild(titleEl);
  const countEl = document.createElement("span");
  countEl.className = "task-group-count";
  countEl.textContent = String(count);
  head.appendChild(countEl);
  return head;
}

/* A task row's description preview element, or null
   when the task has no description worth showing (the
   v2.27.0/v2.28.0 excerpt logic, shared verbatim): a
   rich description previews as its sanitized fragment
   with its plain words as the hover text and its note
   links claimed on the preview itself; a plain one
   previews as its full trimmed text. Through v2.57
   this logic lived inline in the Tasks view's column
   form of the row; v2.58 extracts it so the Home Tasks
   widget's rows render the same excerpt the same way,
   under a widget scoped class that clamps it to two
   lines. extraClass may be "" (the column form, whose
   element is byte for byte what it always was). */
function buildTaskDescPreviewEl(task, extraClass) {
  const cls = "task-row-desc" +
    (extraClass ? " " + extraClass : "");
  if (task.descriptionFormat === "html") {
    const clean = sanitizeTaskDescriptionHtml(
      task.description || "");
    const plain = taskDescriptionTextOfHtml(clean).trim();
    if (!plain) { return null; }
    const desc = document.createElement("div");
    desc.className = cls;
    desc.innerHTML = clean;
    desc.title = plain;
    desc.addEventListener("click", function (ev) {
      const t = ev.target;
      const anchor = (t && t.closest) ? t.closest("a") : null;
      const nid = anchor ? noteLinkIdOf(anchor) : null;
      if (!nid) { return; }
      ev.preventDefault();
      ev.stopPropagation();
      followNoteLink(nid);
    });
    return desc;
  }
  const text = typeof task.description === "string"
    ? task.description.trim() : "";
  if (!text) { return null; }
  const desc = document.createElement("div");
  desc.className = cls;
  desc.textContent = text;
  desc.title = text;
  return desc;
}

/* One task row, shared by the Tasks view and the Things to
   do page:
   the completion checkbox, the title (with the notebook named
   under it where the caller asks), and the chips (due, flag,
   priority). Completed rows render struck through with the
   box checked, wherever they appear. */
function buildTaskRowEl(task, opts) {
  opts = opts || {};
  const row = document.createElement("div");
  row.className = "task-row" +
    (task.status === "completed" ? " completed" : "");
  row.setAttribute("data-task-id", task.id);
  const picker = document.createElement("label");
  picker.className = "task-check";
  picker.title = task.status === "completed"
    ? "Reopen task" : "Complete task";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = task.status === "completed";
  /* v2.44: disabled while the tasks are the cache paint's
     display only copy (the pre load gate in
     toggleTaskComplete is the enforcement; this is its
     visible face). The load's renderAll rebuilds the
     rows enabled over the Drive copy. */
  box.disabled = !tasksArmed;
  box.setAttribute("aria-label",
    (task.status === "completed" ? "Reopen task: " : "Complete task: ") +
    task.title);
  /* The picker's click is stopped here, like the note list's
     selection checkboxes, so toggling can never fall through
     to the row's own click and open the editor. */
  picker.addEventListener("click", function (ev) {
    ev.stopPropagation();
  });
  box.addEventListener("change", function () {
    toggleTaskComplete(task.id);
  });
  picker.appendChild(box);

  /* v2.116: a right press on the row opens the task
     row's own menu (Open task, Copy link; see
     openTaskRowMenu in tasks.js), in the calendar
     entries' discipline: the element listener runs
     ahead of the document menu guard, which only ever
     suppressed the browser's menu on these rows, and
     the propagation stop keeps the press the menu's
     alone. One exception, kept standing: a row inside
     the note body (a note's tasks block is built by
     this same builder) opens nothing, because the
     editor surface's rows keep their standing no menu
     rule and the note editor's own menu owns that
     ground; the guard's suppression still answers the
     press there, exactly as before. */
  row.addEventListener("contextmenu", function (ctxEv) {
    if (row.closest("#noteBody")) { return; }
    ctxEv.preventDefault();
    ctxEv.stopPropagation();
    openTaskRowMenu(task, ctxEv.clientX, ctxEv.clientY);
  });

  /* v2.24.1: the Tasks view's column form of the row, under
     the view's one header row: the checkbox and the markers
     (flag, priority) ride in the Title column, the due chip
     (or a dash when there is no due date) sits in the Due
     date column, and the notebook name fills the Notebook
     column. The Things to do page keeps the card form
     below. */
  if (opts.columns) {
    row.classList.add("task-row-cols");
    const titleCell = document.createElement("div");
    titleCell.className = "task-cell-title";
    titleCell.appendChild(picker);
    const colMain = document.createElement("div");
    colMain.className = "task-row-main";
    const colTitle = document.createElement("div");
    colTitle.className = "task-row-title";
    colTitle.textContent = task.title;
    colMain.appendChild(colTitle);
    /* v2.27.0: the description preview under the title,
       in this Tasks view column form only (the card form
       below is untouched). The FULL description goes in
       as the text, trimmed of its outer whitespace for
       display, and the same full text is the preview's
       title attribute, so a hover can show what the
       three line clamp (the .task-row-desc rule) cuts
       off; the text itself is never shortened here. A
       task with no description, or only whitespace,
       gets no preview element at all. */
    const colDesc = buildTaskDescPreviewEl(task, "");
    if (colDesc) { colMain.appendChild(colDesc); }
    titleCell.appendChild(colMain);
    const markers = document.createElement("div");
    markers.className = "task-chips";
    if (task.flagged) {
      const flag = document.createElement("span");
      flag.className = "task-flag";
      flag.title = "Flagged";
      flag.innerHTML = TASK_FLAG_SVG;
      markers.appendChild(flag);
    }
    const colPrio = document.createElement("span");
    colPrio.className = "priority-pill " + task.priority;
    colPrio.textContent = task.priority === "high" ? "High"
      : task.priority === "low" ? "Low" : "Medium";
    markers.appendChild(colPrio);
    titleCell.appendChild(markers);
    row.appendChild(titleCell);

    const dueCell = document.createElement("div");
    dueCell.className = "task-cell-due";
    const colChip = taskDueChip(task);
    if (colChip) {
      const chipEl = document.createElement("span");
      chipEl.className = "due-chip" +
        (colChip.cls ? " " + colChip.cls : "");
      chipEl.textContent = colChip.text;
      dueCell.appendChild(chipEl);
    } else {
      const none = document.createElement("span");
      none.className = "task-due-none";
      none.textContent = "-";
      dueCell.appendChild(none);
    }
    row.appendChild(dueCell);

    const nbCell = document.createElement("div");
    nbCell.className = "task-cell-nb";
    nbCell.textContent = notebookNameForSlug(task.notebook);
    nbCell.title = nbCell.textContent;
    row.appendChild(nbCell);

    row.addEventListener("click", function () {
      openTaskEditor(task.id);
    });
    return row;
  }
  row.appendChild(picker);

  const main = document.createElement("div");
  main.className = "task-row-main";
  const title = document.createElement("div");
  title.className = "task-row-title";
  title.textContent = task.title;
  main.appendChild(title);
  if (opts.showNotebook) {
    const meta = document.createElement("div");
    meta.className = "task-row-meta";
    meta.textContent = notebookNameForSlug(task.notebook);
    main.appendChild(meta);
  }
  if (!opts.home) { row.appendChild(main); }

  const chips = document.createElement("div");
  chips.className = "task-chips";
  /* v2.24.3: the Things to do page passes its own due label
     (the mockup's word phrases: Overdue, Due today,
     Tomorrow), so one row builder serves both wordings. */
  const chip = opts.dueLabel ? opts.dueLabel(task) : taskDueChip(task);
  if (chip) {
    const chipEl = document.createElement("span");
    chipEl.className = "due-chip" + (chip.cls ? " " + chip.cls : "");
    chipEl.textContent = chip.text;
    chips.appendChild(chipEl);
  }
  if (task.flagged) {
    const flag = document.createElement("span");
    flag.className = "task-flag";
    flag.title = "Flagged";
    flag.innerHTML = TASK_FLAG_SVG;
    chips.appendChild(flag);
  }
  const prio = document.createElement("span");
  prio.className = "priority-pill " + task.priority;
  prio.textContent = task.priority === "high" ? "High"
    : task.priority === "low" ? "Low" : "Medium";
  chips.appendChild(prio);
  if (opts.home) {
    /* v2.58: the Home Tasks widget's row form. The title
       takes the full row width: the main column is the
       row's only flex child beside the completion
       checkbox, the description preview sits under the
       title (buildTaskDescPreviewEl, the Tasks view's
       own excerpt, clamped to two lines by the
       home-task-desc rule), and the chips move inside
       the main column under the preview as their own
       line, so a long title is never squeezed into a
       narrow column by its due and priority pills. The
       checkbox still runs the one completion path (the
       shared picker above), and the row's click still
       opens the task editor (below). */
    row.classList.add("task-row-home");
    row.appendChild(main);
    const homeDesc = buildTaskDescPreviewEl(task,
      "home-task-desc");
    if (homeDesc) { main.appendChild(homeDesc); }
    main.appendChild(chips);
  } else {
    row.appendChild(chips);
  }

  row.addEventListener("click", function () {
    openTaskEditor(task.id);
  });
  return row;
}

/* The tasks the Tasks view shows after its filter: All keeps
   both statuses, Open and Completed keep one, Flagged keeps
   the flagged of both. The Find tasks text (v2.24.1) narrows
   further, across whichever grouping and filter are active:
   a task stays when the text appears in its title or in its
   notebook's name. */
function tasksMatchingFilter() {
  const f = state.tasksView.filter;
  const q = (state.tasksView.query || "").trim().toLowerCase();
  return state.tasks.filter(function (t) {
    if (f === "open" && t.status !== "open") { return false; }
    if (f === "completed" && t.status !== "completed") {
      return false;
    }
    if (f === "flagged" && !t.flagged) { return false; }
    if (q) {
      const inTitle = (t.title || "").toLowerCase()
        .indexOf(q) >= 0;
      const inNotebook = notebookNameForSlug(t.notebook)
        .toLowerCase().indexOf(q) >= 0;
      if (!inTitle && !inNotebook) { return false; }
    }
    return true;
  });
}

/* The Tasks view's groups for the current grouping. Due date
   is the default and the Evernote shape: the open work split
   into Overdue, Today, Upcoming, and No due date, with the
   completed set as one trailing group (present whenever the
   filter lets completed tasks through). Notebook groups
   follow the sidebar's notebook order; priority groups run
   High, Medium, Low. Empty groups are omitted. */
function taskGroupsForView() {
  const tasks = tasksMatchingFilter();
  const groups = [];
  /* v2.24.1: every group also carries a stable key, so the
     view can remember which groups are collapsed (session
     only) across re-renders and grouping switches. */
  function pushGroup(key, title, list) {
    if (list.length) {
      groups.push({
        key: key, title: title, tasks: sortTasksForList(list)
      });
    }
  }
  if (state.tasksView.grouping === "notebook") {
    const seen = {};
    state.notebooks.forEach(function (nb) {
      seen[nb.slug] = true;
      pushGroup("nb:" + nb.slug, nb.name, tasks.filter(function (t) {
        return t.notebook === nb.slug;
      }));
    });
    /* Tasks whose notebook no longer exists still show, under
       their slug, rather than vanishing from the view. */
    const orphanSlugs = [];
    tasks.forEach(function (t) {
      if (!seen[t.notebook] &&
          orphanSlugs.indexOf(t.notebook) < 0) {
        orphanSlugs.push(t.notebook);
      }
    });
    orphanSlugs.forEach(function (slug) {
      pushGroup("nb:" + slug, notebookNameForSlug(slug),
        tasks.filter(function (t) {
          return t.notebook === slug;
        }));
    });
    return groups;
  }
  if (state.tasksView.grouping === "priority") {
    pushGroup("prio:high", "High", tasks.filter(function (t) {
      return t.priority === "high";
    }));
    pushGroup("prio:medium", "Medium", tasks.filter(function (t) {
      return t.priority === "medium";
    }));
    pushGroup("prio:low", "Low", tasks.filter(function (t) {
      return t.priority === "low";
    }));
    return groups;
  }
  const open = tasks.filter(function (t) {
    return t.status === "open";
  });
  const done = tasks.filter(function (t) {
    return t.status === "completed";
  });
  pushGroup("due:overdue", "Overdue", open.filter(function (t) {
    const d = taskDayDiff(t);
    return d !== null && d < 0;
  }));
  pushGroup("due:today", "Today", open.filter(function (t) {
    return taskDayDiff(t) === 0;
  }));
  pushGroup("due:upcoming", "Upcoming", open.filter(function (t) {
    const d = taskDayDiff(t);
    return d !== null && d > 0;
  }));
  pushGroup("due:nodate", "No due date", open.filter(function (t) {
    return taskDayDiff(t) === null;
  }));
  pushGroup("due:completed", "Completed", done);
  return groups;
}

/* The Tasks view itself, in its own pane since v2.24.1: the
   head (the title with the open count beside it, and the
   Find tasks search at its right), the quick add row (title
   input, notebook select, and the New Task button that
   opens the full editor), the grouping segmented control
   and the filter chips (both rebuilt with the view, so the
   active choice is always the filled one), then the column
   header row and the groups, which fillTasksBody builds so
   the search can re-render them alone on every keystroke
   without rebuilding (and refocusing) the input itself.
   Enter in the quick add creates the task with defaults in
   the chosen notebook and puts focus back into the fresh
   input for rapid entry. */
function renderTasksView() {
  const inner = document.getElementById("tasksInner");
  if (!inner) { return; }
  inner.innerHTML = "";

  const head = document.createElement("div");
  head.className = "tasks-head";
  const heading = document.createElement("h2");
  heading.textContent = "Tasks ";
  const countEl = document.createElement("span");
  countEl.className = "tasks-count";
  countEl.id = "tasksOpenCount";
  const openCount = state.tasks.filter(function (t) {
    return t.status === "open";
  }).length;
  countEl.textContent = String(openCount);
  heading.appendChild(countEl);
  head.appendChild(heading);
  const searchWrap = document.createElement("div");
  searchWrap.className = "tasks-search";
  const search = document.createElement("input");
  search.type = "search";
  search.id = "tasksSearch";
  search.placeholder = "Find tasks...";
  search.setAttribute("aria-label", "Find tasks");
  search.setAttribute("autocomplete", "off");
  search.value = state.tasksView.query || "";
  /* Typing re-renders only the body (the groups), so the
     input keeps its focus and its caret. */
  search.addEventListener("input", function () {
    state.tasksView.query = search.value;
    fillTasksBody();
  });
  searchWrap.appendChild(search);
  head.appendChild(searchWrap);
  inner.appendChild(head);

  const quick = document.createElement("div");
  quick.className = "tasks-quickadd";
  const input = document.createElement("input");
  input.type = "text";
  input.id = "taskQuickTitle";
  input.placeholder = "Add a task and press Enter";
  input.setAttribute("aria-label", "New task title");
  /* v2.44: disabled until the real load arms the tasks
     (see toggleTaskComplete's pre load gate); the
     load's renderAll rebuilds it enabled. */
  input.disabled = !tasksArmed;
  quick.appendChild(input);
  const select = document.createElement("select");
  select.id = "taskQuickNotebook";
  select.setAttribute("aria-label", "Notebook for the new task");
  /* v2.31: the picker lists notebooks in the sidebar's
     Evernote order, like the other notebook pickers. */
  notebooksInSidebarOrder().forEach(function (nb) {
    const opt = document.createElement("option");
    opt.value = nb.slug;
    opt.textContent = nb.name;
    select.appendChild(opt);
  });
  if (state.notebooks.length) {
    select.value = defaultTaskNotebook();
  }
  select.addEventListener("change", function () {
    state.taskLastNotebook = select.value;
  });
  quick.appendChild(select);
  const newBtn = document.createElement("button");
  newBtn.type = "button";
  newBtn.className = "btn accent";
  newBtn.id = "taskNewBtn";
  newBtn.textContent = "New Task";
  /* v2.44: disabled until the real load arms the tasks,
     like the quick add beside it. */
  newBtn.disabled = !tasksArmed;
  newBtn.addEventListener("click", function () {
    openTaskEditor(null, select.value || defaultTaskNotebook());
  });
  quick.appendChild(newBtn);
  input.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter") { return; }
    ev.preventDefault();
    const title = input.value.trim();
    if (!title) { return; }
    createTask({
      title: title,
      notebook: select.value || defaultTaskNotebook()
    });
    const fresh = document.getElementById("taskQuickTitle");
    if (fresh) { fresh.focus(); }
  });
  inner.appendChild(quick);

  const controls = document.createElement("div");
  controls.className = "tasks-controls-row";
  /* v2.34: the List / Calendar mode toggle, the grouping
     control's segmented twin (the pressed side filled, so
     the active mode is obvious). The list is the default
     and renders exactly as it always has; the calendar
     swaps the body below for the month grid, and the
     grouping control simply has nothing to group there
     (it takes effect again in the list). Session only. */
  const modeSeg = document.createElement("div");
  modeSeg.className = "theme-segmented";
  modeSeg.id = "tasksModeSeg";
  modeSeg.setAttribute("role", "group");
  modeSeg.setAttribute("aria-label", "Tasks view mode");
  [["list", "List"], ["calendar", "Calendar"]].forEach(function (pair) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = pair[1];
    b.setAttribute("data-taskmode", pair[0]);
    b.setAttribute("aria-pressed",
      state.tasksView.mode === pair[0] ? "true" : "false");
    b.addEventListener("click", function () {
      state.tasksView.mode = pair[0];
      renderNoteList();
      /* v2.81: the sidebar's Calendar and Tasks items
         trade the active highlight with this mode, so
         the sidebar re-renders with the switch. */
      renderSidebar();
    });
    modeSeg.appendChild(b);
  });
  controls.appendChild(modeSeg);
  const seg = document.createElement("div");
  seg.className = "theme-segmented";
  seg.setAttribute("role", "group");
  seg.setAttribute("aria-label", "Group tasks by");
  [["due", "Due date"], ["notebook", "Notebook"],
   ["priority", "Priority"]].forEach(function (pair) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = pair[1];
    b.setAttribute("data-grouping", pair[0]);
    b.setAttribute("aria-pressed",
      state.tasksView.grouping === pair[0] ? "true" : "false");
    b.addEventListener("click", function () {
      state.tasksView.grouping = pair[0];
      renderNoteList();
    });
    seg.appendChild(b);
  });
  controls.appendChild(seg);
  const filters = document.createElement("div");
  filters.className = "task-filters";
  filters.setAttribute("role", "group");
  filters.setAttribute("aria-label", "Filter tasks");
  [["all", "All"], ["open", "Open"], ["flagged", "Flagged"],
   ["completed", "Completed"]].forEach(function (pair) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "task-filter-chip" +
      (state.tasksView.filter === pair[0] ? " active" : "");
    b.textContent = pair[1];
    b.setAttribute("data-filter", pair[0]);
    b.setAttribute("aria-pressed",
      state.tasksView.filter === pair[0] ? "true" : "false");
    b.addEventListener("click", function () {
      state.tasksView.filter = pair[0];
      renderNoteList();
    });
    filters.appendChild(b);
  });
  controls.appendChild(filters);
  inner.appendChild(controls);

  const body = document.createElement("div");
  body.id = "tasksBody";
  inner.appendChild(body);
  fillTasksBody();
}

/* The Tasks view's one column header row: Title, Due date,
   Notebook (Evernote's Assigned note column is Notebook
   here, where tasks belong to notebooks; its Assigned to
   column has no counterpart in a single user app). */
function buildTasksColHeadEl() {
  const head = document.createElement("div");
  head.className = "tasks-colhead";
  ["Title", "Due date", "Notebook"].forEach(function (label) {
    const cell = document.createElement("span");
    cell.textContent = label;
    head.appendChild(cell);
  });
  return head;
}

/* The Tasks view's body: the column header row and the
   groups, each with its collapsible head (the chevron
   toggles the group's key in the session's collapsed set
   and the view re-renders). Split from renderTasksView so
   the Find tasks search can rebuild just this part on
   every keystroke. */
function fillTasksBody() {
  const body = document.getElementById("tasksBody");
  if (!body) { return; }
  body.innerHTML = "";
  /* v2.34: in calendar mode the body is the month grid
     instead of the groups. The Find tasks input calls
     this same function on every keystroke, so the grid
     narrows with the search text and the filter exactly
     as the list does. */
  if (state.tasksView.mode === "calendar") {
    fillTasksCalendar(body);
    return;
  }
  const groups = taskGroupsForView();
  if (!groups.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const big = document.createElement("div");
    big.className = "big";
    big.textContent = "No tasks here";
    empty.appendChild(big);
    const query = (state.tasksView.query || "").trim();
    const note = document.createElement("div");
    note.textContent = query
      ? "No tasks match \"" + query +
        "\". Clear the search to see everything again."
      : (state.tasks.length
        ? "No tasks match this filter. Clear it to see everything again."
        : "Add your first task above, or press New Task for the full editor.");
    empty.appendChild(note);
    body.appendChild(empty);
    return;
  }
  body.appendChild(buildTasksColHeadEl());
  groups.forEach(function (g) {
    const group = document.createElement("div");
    group.className = "task-group";
    const collapsed = !!state.tasksView.collapsed[g.key];
    group.appendChild(buildTaskGroupHeadEl(g.title,
      g.tasks.length + (g.tasks.length === 1 ? " task" : " tasks"),
      {
        collapsible: true,
        collapsed: collapsed,
        onToggle: function () {
          if (state.tasksView.collapsed[g.key]) {
            delete state.tasksView.collapsed[g.key];
          } else {
            state.tasksView.collapsed[g.key] = true;
          }
          renderTasksView();
        }
      }));
    if (!collapsed) {
      g.tasks.forEach(function (task) {
        group.appendChild(buildTaskRowEl(task, { columns: true }));
      });
    }
    body.appendChild(group);
  });
}

/* ---------------- v2.34: the calendar view of tasks -----
   Evernote puts tasks on a calendar in its Calendar
   section and in Home's calendar widget: a task appears
   on the day it is due, it can be checked off right
   there, and a new task can be created from a date.
   SnakeScale has no connected calendar account and no
   events layer, so the calendar lives here, in the Tasks
   view beside the list it complements: a month grid
   (Sunday first, like the search grammar's week) of the
   same task state the list reads, filtered by the view's
   own filter and Find tasks text (tasksMatchingFilter),
   ordered within each day the list's way
   (sortTasksForList). Nothing is stored: the displayed
   month, the selected day, and the expanded day are
   session state on state.tasksView, and every task
   change re-renders through renderTasksView, the same
   route the list takes (afterTasksChanged, the editor,
   the Home widget, and sync reloads all land there), so
   the grid is never stale. A task with no due date has
   no day to sit on and stays list only, which the line
   under the grid says. A recurring task shows its one
   current due occurrence, exactly as the list shows it;
   checking it off rolls that occurrence forward through
   toggleTaskComplete, the rows' own completion path. Since v2.80 the grid also carries the user's Google Calendar events from the calendar module, rows standing after each day's tasks (a click on one opens the event editor since v2.81); the module's header carries the connection's rules, and its own section sits above, with the Home calendar code. */

const TASK_CAL_VISIBLE = 3;   /* entries a day shows before
                                 the "+N more" expander */
const TASK_CAL_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed",
  "Thu", "Fri", "Sat"];

/* The month the grid shows: the stored cursor, or the
   current month until the user navigates. m is 1 based,
   the parseTaskDate convention. */
function calendarCursorParts() {
  const c = state.tasksView.calCursor;
  if (c && c.y && c.m) { return { y: c.y, m: c.m }; }
  const t = taskTodayParts();
  return { y: t.y, m: t.m };
}

function shiftCalendarMonth(delta) {
  const c = calendarCursorParts();
  let y = c.y, m = c.m + delta;
  if (m < 1) { m = 12; y -= 1; }
  if (m > 12) { m = 1; y += 1; }
  state.tasksView.calCursor = { y: y, m: m };
  fillTasksBody();
}

/* One task's calendar entry: a head row (the completion
   checkbox, the rows' own picker, so a check runs the
   rows' own toggleTaskComplete and can never fall
   through to the entry's editor opening click; the time
   when the task carries one; and the list's own markers,
   the flag and the High priority pill, the compact
   calendar form of the chips the column rows wear) over
   the title at the card's full width. A completed task
   strikes and checks, the rows' form; an open task whose
   day has passed wears the overdue bar. */
function buildTaskCalEntryEl(task) {
  const el = document.createElement("div");
  el.className = "task-cal-entry" +
    (task.status === "completed" ? " completed" : "");
  el.setAttribute("data-task-id", task.id);
  el.title = task.title;
  const diff = taskDayDiff(task);
  if (task.status === "open" && diff !== null && diff < 0) {
    el.classList.add("overdue");
  }
  const picker = document.createElement("label");
  picker.className = "task-check";
  picker.title = task.status === "completed"
    ? "Reopen task" : "Complete task";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = task.status === "completed";
  /* v2.44: disabled until the real load arms the tasks,
     the rows' own rule (see buildTaskRowEl). */
  box.disabled = !tasksArmed;
  box.setAttribute("aria-label",
    (task.status === "completed" ? "Reopen task: " : "Complete task: ") +
    task.title);
  picker.addEventListener("click", function (ev) {
    ev.stopPropagation();
  });
  box.addEventListener("change", function () {
    toggleTaskComplete(task.id);
  });
  picker.appendChild(box);

  /* v2.70: the entry stacks (see the .task-cal-entry
     rules): a head row carries the header elements
     (the picker, the time, the flag, the priority
     pill), and the title stands under it at the card's
     full width. Through v2.69 the title shared a flex
     row with the flag and the pill on whatever width
     they left it, and overflow-wrap anywhere wrapped
     it a letter per line whenever that width ran
     small: Chris's screenshot of the desktop month
     grid showed a flagged High task at 7:00 AM crushed
     into a 17 line tower, its time broken mid token. */
  const head = document.createElement("span");
  head.className = "task-cal-entry-head";
  head.appendChild(picker);
  if (task.dueTime) {
    const time = document.createElement("span");
    time.className = "task-cal-entry-time";
    time.textContent = taskTimeLabel(task.dueTime);
    head.appendChild(time);
  }
  if (task.flagged || task.priority === "high") {
    /* The markers travel as one group at the head's
       right: in a cell too narrow for the whole head
       on one line, the group wraps under the picker
       and the time whole, never clipped and never
       split (see the head's flex-wrap rule). */
    const marks = document.createElement("span");
    marks.className = "task-cal-entry-marks";
    if (task.flagged) {
      const flag = document.createElement("span");
      flag.className = "task-flag";
      flag.title = "Flagged";
      flag.innerHTML = TASK_FLAG_SVG;
      marks.appendChild(flag);
    }
    if (task.priority === "high") {
      const pill = document.createElement("span");
      pill.className = "priority-pill high";
      pill.textContent = "High";
      marks.appendChild(pill);
    }
    head.appendChild(marks);
  }
  el.appendChild(head);

  const title = document.createElement("span");
  title.className = "task-cal-entry-title";
  title.textContent = task.title;
  el.appendChild(title);
  el.addEventListener("click", function () {
    openTaskEditor(task.id);
  });
  return el;
}

/* The month grid itself, rendered into #tasksBody in
   calendar mode: the head (previous, the month and year,
   next, and Today at the right), the weekday row, the
   weeks (the days of the neighbouring months complete
   the first and last weeks, muted), the selected day's
   strip, and the no due date note. Selecting a day keeps
   the grid and adds the strip under it: the day's full
   date, its due count, and an Add a task button that
   opens the editor in create mode (the New Task button's
   own call, in the quick add's chosen notebook) with
   the due date input preset to the day, Evernote's
   create from a date in this app's furniture. */
function fillTasksCalendar(body) {
  const cursor = calendarCursorParts();
  const y = cursor.y, m = cursor.m;
  const today = taskTodayParts();
  const todayStr = formatTaskDateParts(today.y, today.m, today.d);

  const byDay = {};
  tasksMatchingFilter().forEach(function (t) {
    if (!t.dueDate) { return; }
    (byDay[t.dueDate] = byDay[t.dueDate] || []).push(t);
  });
  Object.keys(byDay).forEach(function (key) {
    byDay[key] = sortTasksForList(byDay[key]);
  });
  /* v2.80: ask the calendar module for this
     month's events (lazy, cached, silent when signed
     out; see the module's header). */
  ensureGcalMonth(y, m);

  const wrap = document.createElement("div");
  wrap.id = "taskCal";
  wrap.className = "task-cal";

  const head = document.createElement("div");
  head.className = "task-cal-head";
  const prev = document.createElement("button");
  prev.type = "button";
  prev.className = "btn small";
  prev.id = "taskCalPrev";
  prev.textContent = "‹";
  prev.setAttribute("aria-label", "Previous month");
  prev.addEventListener("click", function () {
    shiftCalendarMonth(-1);
  });
  head.appendChild(prev);
  const title = document.createElement("div");
  title.className = "task-cal-title";
  title.id = "taskCalTitle";
  title.textContent = new Date(y, m - 1, 1).toLocaleDateString(
    undefined, { month: "long", year: "numeric" });
  head.appendChild(title);
  const next = document.createElement("button");
  next.type = "button";
  next.className = "btn small";
  next.id = "taskCalNext";
  next.textContent = "›";
  next.setAttribute("aria-label", "Next month");
  next.addEventListener("click", function () {
    shiftCalendarMonth(1);
  });
  head.appendChild(next);
  const todayBtn = document.createElement("button");
  todayBtn.type = "button";
  todayBtn.className = "btn small task-cal-today";
  todayBtn.id = "taskCalToday";
  todayBtn.textContent = "Today";
  todayBtn.addEventListener("click", function () {
    state.tasksView.calCursor = null;
    state.tasksView.calSelected = todayStr;
    fillTasksBody();
  });
  head.appendChild(todayBtn);
  wrap.appendChild(head);

  const week = document.createElement("div");
  week.className = "task-cal-week";
  TASK_CAL_WEEKDAYS.forEach(function (name) {
    const wd = document.createElement("div");
    wd.className = "task-cal-wd";
    wd.textContent = name;
    week.appendChild(wd);
  });
  wrap.appendChild(week);

  const grid = document.createElement("div");
  grid.className = "task-cal-grid";
  const firstDow = new Date(y, m - 1, 1).getDay();
  const daysInMonth = new Date(y, m, 0).getDate();
  const cellCount = Math.ceil((firstDow + daysInMonth) / 7) * 7;
  for (let i = 0; i < cellCount; i++) {
    const date = new Date(y, m - 1, 1 - firstDow + i);
    const dateStr = formatTaskDateParts(date.getFullYear(),
      date.getMonth() + 1, date.getDate());
    const cellEl = document.createElement("div");
    cellEl.className = "task-cal-day" +
      (date.getMonth() !== m - 1 ? " outside" : "") +
      (dateStr === todayStr ? " today" : "") +
      (state.tasksView.calSelected === dateStr ? " selected" : "");
    cellEl.setAttribute("data-date", dateStr);
    const num = document.createElement("div");
    num.className = "task-cal-daynum";
    num.textContent = String(date.getDate());
    cellEl.appendChild(num);
    const dayTasks = byDay[dateStr] || [];
    /* v2.80: the day's Google Calendar events stand after
       its tasks, from the calendar module's
       day buckets (rows, see buildGcalEventEl), and
       share the cell's visible
       limit and expander: the tasks keep the first slots
       in their own order and the events fill what
       remains. */
    const dayEvents = gcalEventsForDay(dateStr);
    const expanded = state.tasksView.calExpanded === dateStr;
    const shownTasks = expanded
      ? dayTasks : dayTasks.slice(0, TASK_CAL_VISIBLE);
    shownTasks.forEach(function (task) {
      cellEl.appendChild(buildTaskCalEntryEl(task));
    });
    const shownEvents = expanded
      ? dayEvents
      : dayEvents.slice(0, Math.max(0,
          TASK_CAL_VISIBLE - shownTasks.length));
    shownEvents.forEach(function (ev) {
      cellEl.appendChild(buildGcalEventEl(ev));
    });
    const dayTotal = dayTasks.length + dayEvents.length;
    if (dayTotal > TASK_CAL_VISIBLE) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "task-cal-more";
      more.textContent = expanded ? "Show less"
        : "+" + (dayTotal - TASK_CAL_VISIBLE) + " more";
      more.addEventListener("click", function (ev) {
        ev.stopPropagation();
        state.tasksView.calExpanded = expanded ? null : dateStr;
        fillTasksBody();
      });
      cellEl.appendChild(more);
    }
    cellEl.addEventListener("click", function () {
      state.tasksView.calSelected = dateStr;
      fillTasksBody();
    });
    grid.appendChild(cellEl);
  }
  wrap.appendChild(grid);

  const selParts = parseTaskDate(state.tasksView.calSelected);
  if (selParts) {
    const strip = document.createElement("div");
    strip.className = "task-cal-detail";
    strip.id = "taskCalDetail";
    const label = document.createElement("div");
    label.className = "task-cal-detail-label";
    label.textContent = new Date(selParts.y, selParts.m - 1,
      selParts.d).toLocaleDateString(undefined,
      { weekday: "long", month: "long", day: "numeric" });
    const selTasks = byDay[state.tasksView.calSelected] || [];
    const count = document.createElement("span");
    count.className = "task-cal-detail-count";
    count.textContent = selTasks.length === 0
      ? "No tasks due"
      : selTasks.length +
        (selTasks.length === 1 ? " task due" : " tasks due");
    label.appendChild(count);
    strip.appendChild(label);
    const add = document.createElement("button");
    add.type = "button";
    add.className = "btn accent small";
    add.id = "taskCalAddBtn";
    add.textContent = "Add a task";
    add.addEventListener("click", function () {
      const dateStr = state.tasksView.calSelected;
      const quickSel = document.getElementById("taskQuickNotebook");
      openTaskEditor(null,
        (quickSel && quickSel.value) || defaultTaskNotebook());
      const dateInput = document.getElementById("taskDueDateInput");
      if (dateInput && dateStr) {
        dateInput.value = dateStr;
        syncTaskReminderControls();
        markTaskEditorDirty();
      }
    });
    strip.appendChild(add);
    /* v2.81: the New event button beside Add a task:
       opens the calendar module's event editor for the
       selected day. */
    const newEventBtn = document.createElement("button");
    newEventBtn.type = "button";
    newEventBtn.className = "btn small";
    newEventBtn.id = "taskCalNewEventBtn";
    newEventBtn.textContent = "New event";
    newEventBtn.addEventListener("click", function () {
      openGcalEventEditor(null, state.tasksView.calSelected);
    });
    strip.appendChild(newEventBtn);
    wrap.appendChild(strip);
    /* v2.85: the selected day's tasks, listed in the
       detail under the strip: the byDay bucket in its
       established order, open and completed together,
       each row the shared calendar entry whose real
       checkbox completes through the one path. Through
       v2.84 the detail rendered the count in the strip
       and the events box below, but never the tasks
       themselves as rows: the grid cells' capped chips
       (the visible limit the tasks share with the
       events) were the tasks' only presence, so a
       clicked day showed its events and not its tasks
       (Chris, live, 2026-11-02). The tasks stand
       first, the grid's own order. */
    if (selTasks.length) {
      const taskBox = document.createElement("div");
      taskBox.className = "task-cal-detail-tasks";
      taskBox.id = "taskCalDetailTasks";
      selTasks.forEach(function (task) {
        taskBox.appendChild(buildTaskCalEntryEl(task));
      });
      wrap.appendChild(taskBox);
    }
    /* v2.80: the selected day's Google Calendar events,
       under the strip in the same rows the
       grid cells carry. */
    const selEvents = gcalEventsForDay(
      state.tasksView.calSelected);
    if (selEvents.length) {
      const evBox = document.createElement("div");
      evBox.className = "task-cal-detail-events";
      evBox.id = "taskCalDetailEvents";
      selEvents.forEach(function (ev) {
        evBox.appendChild(buildGcalEventEl(ev));
      });
      wrap.appendChild(evBox);
    }
  }

  const foot = document.createElement("div");
  foot.className = "task-cal-foot";
  foot.textContent =
    "Tasks without a due date appear in the list only.";
  wrap.appendChild(foot);

  /* v2.80: the calendar module's one caption line, when
     its state carries one (see buildGcalStatusEl). */
  const gcalStatusEl = buildGcalStatusEl();
  if (gcalStatusEl) { wrap.appendChild(gcalStatusEl); }

  body.appendChild(wrap);
}

/* ---------------- v2.24.3: the Things to do page ----------
   One notebook's tasks as a page in the editor pane,
   Evernote's shape: a breadcrumb (the notebook, then Things
   to do), the progress chip, the big title, a quick add for
   this notebook, and the tasks as a checklist. Open tasks
   come first in the shared list order (due moment, no date
   last), then the completed set under its own heading, most
   recently completed first, struck through and dimmed. The
   rows are the shared task rows with word due labels, so a
   checkbox completes (a recurring task rolls forward) through
   the same toggle as everywhere, and a row click opens the
   task editor. The page is a pseudo-note: it writes nothing
   to any note file, catalog, or version store, and it is
   rebuilt wholesale by renderThingsView whenever tasks
   change (afterTasksChanged and sync reloads both route
   through renderEditor while the page is open). */

/* The due label the page's rows wear: the mockup's words at
   the right of the row. Overdue wins the red, today reads
   "Due today", tomorrow its word, and anything later the
   same date label the chips use; a task with no due date
   wears no label. */
function thingsDueLabel(task) {
  if (!task || !task.dueDate) { return null; }
  const diff = taskDayDiff(task);
  const time = task.dueTime ? " " + taskTimeLabel(task.dueTime) : "";
  if (diff !== null && diff < 0) {
    return { text: "Overdue", cls: "overdue" };
  }
  if (diff === 0) { return { text: "Due today" + time, cls: "today" }; }
  if (diff === 1) { return { text: "Tomorrow" + time, cls: "" }; }
  return { text: taskDateLabel(task.dueDate) + time, cls: "" };
}

/* Open one notebook's Things to do page in the editor pane.
   On mobile this also switches the visible pane to the
   editor, exactly as openNote does. */
function openThingsToDo(slug) {
  state.thingsNotebook = slug;
  /* v2.24.5: the Things page replaces the editor, panel and all. */
  closeTbPanel();
  renderNoteList();
  renderEditor();
  setMobileView("editor");
}

function renderThingsView() {
  const wrap = document.getElementById("thingsWrap");
  const inner = document.getElementById("thingsInner");
  if (!wrap || !inner) { return; }
  const slug = state.thingsNotebook;
  if (!slug) { wrap.classList.add("hidden"); return; }
  wrap.classList.remove("hidden");
  inner.innerHTML = "";
  const name = notebookNameForSlug(slug);
  const tasks = tasksForNotebook(slug);
  const completed = tasks.filter(function (t) {
    return t.status === "completed";
  }).length;

  const crumb = document.createElement("div");
  crumb.className = "things-crumb";
  const crumbNb = document.createElement("span");
  crumbNb.textContent = name;
  crumb.appendChild(crumbNb);
  const crumbSep = document.createElement("span");
  crumbSep.setAttribute("aria-hidden", "true");
  crumbSep.textContent = ">";
  crumb.appendChild(crumbSep);
  const crumbHere = document.createElement("span");
  crumbHere.className = "things-crumb-here";
  crumbHere.textContent = "Things to do";
  crumb.appendChild(crumbHere);
  inner.appendChild(crumb);

  const head = document.createElement("div");
  head.className = "things-head";
  const title = document.createElement("div");
  title.className = "things-title";
  title.textContent = "Things to do";
  head.appendChild(title);
  const chip = document.createElement("span");
  chip.className = "task-progress-pill things-chip";
  chip.innerHTML = TASK_CHECK_SVG;
  const chipText = document.createElement("span");
  chipText.textContent = completed + "/" + tasks.length;
  chip.appendChild(chipText);
  head.appendChild(chip);
  inner.appendChild(head);

  /* The quick add: Enter creates the task in this notebook
     through the shared create path, and focus returns to
     the fresh input, the Tasks view's rapid entry habit. */
  const quick = document.createElement("div");
  quick.className = "tasks-quickadd things-quickadd";
  const input = document.createElement("input");
  input.type = "text";
  input.id = "thingsQuickTitle";
  input.placeholder = "Add a task and press Enter";
  /* v2.44: disabled until the real load arms the tasks,
     the Tasks view quick add's own rule. */
  input.disabled = !tasksArmed;
  input.setAttribute("aria-label",
    "New task title for " + name);
  quick.appendChild(input);
  input.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter") { return; }
    ev.preventDefault();
    const value = input.value.trim();
    if (!value) { return; }
    createTask({ title: value, notebook: slug });
    const fresh = document.getElementById("thingsQuickTitle");
    if (fresh) { fresh.focus(); }
  });
  inner.appendChild(quick);

  if (!tasks.length) {
    /* The notebook's last task going away (a delete in the
       editor, a sync) leaves the page standing on its empty
       state with the quick add, never a bounce out. */
    const empty = document.createElement("div");
    empty.className = "things-empty";
    const big = document.createElement("div");
    big.className = "big";
    big.textContent = "No tasks yet";
    empty.appendChild(big);
    const line = document.createElement("div");
    line.textContent = "Tasks you add to " + name +
      " will live here. Add the first one above.";
    empty.appendChild(line);
    inner.appendChild(empty);
    return;
  }
  const rows = document.createElement("div");
  rows.className = "things-rows";
  let doneHeadShown = false;
  sortTasksForList(tasks).forEach(function (task) {
    if (task.status === "completed" && !doneHeadShown) {
      doneHeadShown = true;
      const sub = document.createElement("div");
      sub.className = "things-subhead";
      sub.textContent = "Completed";
      rows.appendChild(sub);
    }
    rows.appendChild(buildTaskRowEl(task, {
      dueLabel: thingsDueLabel
    }));
  });
  inner.appendChild(rows);
}

/* ---------------- the task editor ----------------
   One modal, two births: a null id (a fresh task, seeded with
   the caller's notebook) or an existing task's id. The editor
   tracks its own dirtiness: a sync that reloads tasks while
   the editor is open refills it only when nothing has been
   typed into it (see onTasksLoaded), the same care standard
   the open note gets. Saving writes through the tasks writer
   like every mutation; deleting removes the task outright
   (tasks have no trash in this version). */
let taskEditorState = null;   /* {id: string|null, dirty: boolean} */

function fillTaskNotebookSelect(selected) {
  const select = document.getElementById("taskNotebookSelect");
  if (!select) { return; }
  select.innerHTML = "";
  /* v2.31: the picker lists notebooks in the sidebar's
     Evernote order, like the other notebook pickers. */
  notebooksInSidebarOrder().forEach(function (nb) {
    const opt = document.createElement("option");
    opt.value = nb.slug;
    opt.textContent = nb.name;
    select.appendChild(opt);
  });
  if (selected) { select.value = selected; }
}

/* v2.49.0: the Note picker in the task editor: None,
   then the live notes by title (the link is the id, so a
   label is just the note's current title, and a rename
   can never strand it). A task whose note sits in Trash
   or Archive keeps an entry for it, labeled with where
   it lives, and a noteId naming no note at all keeps a
   placeholder entry, so opening the editor and saving an
   unrelated change never silently drops a link this
   picker cannot otherwise show. The picker's value is
   the noteId itself; the empty value is None. */
function fillTaskNoteSelect(selectedNoteId) {
  const select = document.getElementById("taskNoteSelect");
  if (!select) { return; }
  select.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "None";
  select.appendChild(none);
  const live = state.notes.slice().sort(function (a, b) {
    return String(a.title || "").localeCompare(
      String(b.title || ""));
  });
  let found = false;
  live.forEach(function (n) {
    const opt = document.createElement("option");
    opt.value = n.id;
    opt.textContent = n.title || "Untitled note";
    select.appendChild(opt);
    if (n.id === selectedNoteId) { found = true; }
  });
  if (selectedNoteId && !found) {
    const elsewhere = findNoteById(selectedNoteId);
    const opt = document.createElement("option");
    opt.value = selectedNoteId;
    opt.textContent = elsewhere
      ? (elsewhere.title || "Untitled note") +
        (elsewhere.trashed ? " (in Trash)"
          : elsewhere.archived ? " (in Archive)" : "")
      : "Unavailable note";
    select.appendChild(opt);
  }
  select.value = selectedNoteId || "";
}

function openTaskEditor(taskId, presetNotebook, presetNoteId, presetDueDate) {
  const modal = document.getElementById("taskModal");
  if (!modal) { return; }
  /* v2.44: the pre load gate (see toggleTaskComplete).
     An existing task's open waits the way a notification
     click's open already waits: queued here, and
     onTasksLoaded opens it over the Drive copy when the
     load lands. A create simply waits unopened; the
     surfaces' New Task controls render disabled for the
     same span. */
  if (!tasksArmed) {
    if (taskId) { queueTaskOpen(taskId); }
    return;
  }
  const task = taskId ? findTaskById(taskId) : null;
  taskEditorState = { id: task ? task.id : null, dirty: false,
    presetNoteId: task ? null : (presetNoteId || null) };
  /* v2.28.0: a fresh editor starts with the @ popup
     closed, whichever host it was serving. */
  closeMentionPopup();
  document.getElementById("taskModalTitle").textContent =
    task ? "Edit task" : "New task";
  fillTaskNotebookSelect(task ? task.notebook
    : (presetNotebook || defaultTaskNotebook()));
  if (task) {
    fillTaskEditor(task);
  } else {
    document.getElementById("taskTitleInput").value = "";
    fillTaskNoteSelect(presetNoteId || "");
    document.getElementById("taskDescInput").innerHTML = "";
    /* v2.82: a create may arrive with its due date
       preset (the calendar day menu's New task passes
       the clicked day); without one the field starts
       empty, exactly as before. */
    document.getElementById("taskDueDateInput").value =
      presetDueDate || "";
    document.getElementById("taskDueTimeInput").value = "";
    document.getElementById("taskRecurrenceSelect").value = "none";
    document.getElementById("taskPrioritySelect").value = "medium";
    document.getElementById("taskReminderSelect").value = "";
    document.getElementById("taskFlaggedInput").checked = false;
    document.getElementById("taskStampsLine").textContent = "";
    document.getElementById("taskDeleteBtn")
      .classList.add("hidden");
    syncTaskReminderControls();
  }
  /* v2.28.0: while the task modal is open, the editing
     commands run with styleWithCSS off, so the
     description editor's bold, italic, and underline
     land as semantic elements rather than styled spans
     (the sanitizer converts spans too, for pastes and
     foreign content). closeTaskEditor restores the app
     wide on setting the note editor relies on. */
  try { document.execCommand("styleWithCSS", false, false); }
  catch (err) { /* an engine without the command */ }
  modal.classList.remove("hidden");
  const titleInput = document.getElementById("taskTitleInput");
  if (titleInput) { titleInput.focus(); }
}

/* Push one task's facts into the editor's fields. Also the
   sync refill path, so it ends by clearing the dirty flag it
   is allowed to clear: a refill only ever runs on an untouched
   editor (see onTasksLoaded). */
function fillTaskEditor(task) {
  document.getElementById("taskTitleInput").value = task.title || "";
  writeTaskDescriptionEditor(task);
  fillTaskNotebookSelect(task.notebook);
  fillTaskNoteSelect(task.noteId || "");
  document.getElementById("taskDueDateInput").value =
    task.dueDate || "";
  document.getElementById("taskDueTimeInput").value =
    task.dueTime || "";
  document.getElementById("taskRecurrenceSelect").value =
    task.recurrence;
  document.getElementById("taskPrioritySelect").value =
    task.priority;
  document.getElementById("taskReminderSelect").value =
    task.reminderOffsetMin == null
      ? "" : String(task.reminderOffsetMin);
  document.getElementById("taskFlaggedInput").checked =
    !!task.flagged;
  document.getElementById("taskStampsLine").textContent =
    "Created " + formatDate(task.created) +
    " · Updated " + formatDate(task.updated);
  document.getElementById("taskDeleteBtn")
    .classList.remove("hidden");
  if (taskEditorState && taskEditorState.id === task.id) {
    taskEditorState.dirty = false;
  }
  syncTaskReminderControls();
}

function markTaskEditorDirty() {
  if (taskEditorState) { taskEditorState.dirty = true; }
}

/* The reminder row's live state: the select is disabled until
   a due date exists, the hint says what will happen with the
   current choices on this device, and the Enable notifications
   button appears exactly when a reminder is chosen but this
   browser has not granted permission yet (the ask then runs
   from the click, as permission requests must). */
function syncTaskReminderControls() {
  const dateInput = document.getElementById("taskDueDateInput");
  const select = document.getElementById("taskReminderSelect");
  const hint = document.getElementById("taskReminderHint");
  const enableBtn = document.getElementById("taskNotifEnableBtn");
  if (!select || !hint || !enableBtn) { return; }
  const hasDate = !!(dateInput && dateInput.value);
  select.disabled = !hasDate;
  const reminderChosen = select.value !== "";
  const perm = notificationPermission();
  if (!hasDate) {
    hint.textContent = "Set a due date to add a reminder.";
    enableBtn.classList.add("hidden");
  } else if (!reminderChosen) {
    hint.textContent = "No reminder set for this task.";
    enableBtn.classList.add("hidden");
  } else if (perm === "granted") {
    hint.textContent = "This device shows the reminder while " +
      "the app is open, and on next open if its time has passed.";
    enableBtn.classList.add("hidden");
  } else if (perm === "denied") {
    hint.textContent = "Notifications are blocked for this site " +
      "in your browser settings, so this reminder cannot appear " +
      "until that changes.";
    enableBtn.classList.add("hidden");
  } else if (perm === "unsupported") {
    hint.textContent = "This browser does not support " +
      "notifications, so this reminder cannot appear here.";
    enableBtn.classList.add("hidden");
  } else {
    hint.textContent =
      "Notifications are not enabled on this device yet.";
    enableBtn.classList.remove("hidden");
  }
}

function saveTaskEditor() {
  if (!taskEditorState) { return; }
  const reminderRaw =
    document.getElementById("taskReminderSelect").value;
  /* v2.28.0: the description is read out of the rich
     editor through its sanitizer; an emptied fragment
     collapses back to the plain empty form. */
  const descRead = readTaskDescriptionEditor();
  const fields = {
    title: document.getElementById("taskTitleInput").value.trim()
      || "Untitled task",
    description: descRead.description,
    descriptionFormat: descRead.descriptionFormat,
    notebook: document.getElementById("taskNotebookSelect").value
      || defaultTaskNotebook(),
    noteId: document.getElementById("taskNoteSelect").value || null,
    dueDate: document.getElementById("taskDueDateInput").value
      || null,
    dueTime: document.getElementById("taskDueTimeInput").value
      || null,
    recurrence: document.getElementById("taskRecurrenceSelect")
      .value,
    priority: document.getElementById("taskPrioritySelect").value,
    reminderOffsetMin: reminderRaw === "" ? null
      : Number(reminderRaw),
    flagged: document.getElementById("taskFlaggedInput").checked
  };
  /* No due date, no due time and no reminder: the select is
     disabled in that state, but its stale value must not leak
     into the saved task. */
  if (!fields.dueDate) {
    fields.dueTime = null;
    fields.reminderOffsetMin = null;
  }
  if (taskEditorState.id) {
    updateTask(taskEditorState.id, fields);
  } else {
    createTask(fields);
  }
  closeTaskEditor();
}

function deleteTaskFromEditor() {
  if (!taskEditorState || !taskEditorState.id) { return; }
  const task = findTaskById(taskEditorState.id);
  const ok = confirm("Delete the task \"" +
    (task ? task.title : "") +
    "\"? This cannot be undone; tasks have no trash.");
  if (!ok) { return; }
  const id = taskEditorState.id;
  closeTaskEditor();
  deleteTask(id);
}

function closeTaskEditor() {
  const modal = document.getElementById("taskModal");
  if (modal) { modal.classList.add("hidden"); }
  taskEditorState = null;
  /* v2.50: the task editor closing is one of the landing
     moments for a waiting self update reload (its dirty
     flag is part of the unsaved work the reload waits
     for; see updateReloadBlocked). */
  maybeReloadForUpdate();
  /* v2.28.0: the @ popup's second host dies with the
     modal, and the note editor's styleWithCSS setting
     (on, app wide) is restored. */
  closeMentionPopup();
  try { document.execCommand("styleWithCSS", false, true); }
  catch (err) { /* an engine without the command */ }
}

/* v2.28.0: run one description toolbar command. The
   marks and lists are the browser's own editing
   commands, aimed at the description editor's live
   selection (with styleWithCSS off while the modal is
   open, they land as semantic elements). Clear
   formatting runs removeFormat and then unwraps the
   inline formatting elements some engines leave
   standing, inside the description editor only. */
function runTaskDescCommand(cmd) {
  const el = document.getElementById("taskDescInput");
  if (!el) { return; }
  el.focus();
  const map = {
    bold: "bold", italic: "italic", underline: "underline",
    strike: "strikeThrough",
    ul: "insertUnorderedList", ol: "insertOrderedList"
  };
  try {
    if (cmd === "clear") {
      document.execCommand("removeFormat", false, null);
      ["strong", "b", "em", "i", "u", "s", "strike",
       "span", "font"].forEach(function (tag) {
        Array.prototype.slice.call(
          el.querySelectorAll(tag))
          .forEach(unwrapTaskDescElement);
      });
    } else if (map[cmd]) {
      document.execCommand(map[cmd], false, null);
    }
  } catch (err) { /* an engine without the command */ }
  markTaskEditorDirty();
}

/* Insert a fragment at the caret inside rootEl, as
   nodes rather than as an execCommand string, so the
   paste path behaves the same in every engine.
   Returns false when there is no usable caret inside
   rootEl, leaving the caller to its fallback. */
function insertHtmlFragmentAtCaret(rootEl, html) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) { return false; }
  const range = sel.getRangeAt(0);
  if (!rootEl.contains(range.commonAncestorContainer)) {
    return false;
  }
  const holder = document.createElement("div");
  holder.innerHTML = html;
  const frag = document.createDocumentFragment();
  let last = null;
  while (holder.firstChild) {
    last = frag.appendChild(holder.firstChild);
  }
  range.deleteContents();
  range.insertNode(frag);
  if (last) {
    range.setStartAfter(last);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  return true;
}

/* The plain text twin of the fragment inserter, the
   paste path's fallback when the clipboard carries no
   HTML. */
function insertTextAtCaret(rootEl, text) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) { return false; }
  const range = sel.getRangeAt(0);
  if (!rootEl.contains(range.commonAncestorContainer)) {
    return false;
  }
  const node = document.createTextNode(text);
  range.deleteContents();
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

/* ---------------- reminder notifications ----------------
   Delivery prefers the service worker registration's
   showNotification (it is what an installed PWA expects, and
   its clicks route through the worker's notificationclick
   handler in sw.js); the Notification constructor is the
   fallback when there is no registration. There is no push
   server, so a notification can only be raised while the app
   runs on the device, in a tab or as an installed app; the
   scheduler's catch up on open covers the closed hours. */
function notificationsSupported() {
  return typeof window.Notification === "function";
}

function notificationPermission() {
  if (!notificationsSupported()) { return "unsupported"; }
  return window.Notification.permission || "default";
}

/* The Settings Notifications section, pushed to the state it
   describes on every Settings open and after every permission
   change: the status line names the permission in a state
   colored line, the Enable button shows only while permission
   has not been asked, and the switch shows the saved choice. */
function renderNotificationSettings() {
  const toggle =
    document.getElementById("settingsTaskRemindersToggle");
  if (toggle) { toggle.checked = state.taskReminders !== false; }
  /* v2.35: the note switch shows its saved choice beside
     the task switch. */
  const noteToggle =
    document.getElementById("settingsNoteRemindersToggle");
  if (noteToggle) { noteToggle.checked = state.noteReminders !== false; }
  const status = document.getElementById("settingsNotifStatus");
  const enableBtn =
    document.getElementById("settingsNotifEnableBtn");
  if (!status) { return; }
  const perm = notificationPermission();
  status.setAttribute("data-state", perm);
  if (perm === "granted") {
    status.textContent = "Notifications are on for this " +
      "browser. Task reminders will appear on this device.";
  } else if (perm === "denied") {
    status.textContent = "Notifications are blocked for this " +
      "site in your browser settings. Allow them there to use " +
      "task reminders on this device.";
  } else if (perm === "unsupported") {
    status.textContent = "This browser does not support " +
      "notifications, so task reminders cannot appear here.";
  } else {
    status.textContent = "Notifications are not enabled yet " +
      "on this device.";
  }
  if (enableBtn) {
    enableBtn.classList.toggle("hidden", perm !== "default");
  }
}

/* Ask for notification permission. Only ever called from a
   click (the Settings button or the task editor's inline one),
   because a permission request needs a user gesture; the
   result re-renders both surfaces and gives the scheduler a
   look, since a grant can make a waiting reminder due. */
async function requestNotificationPermission() {
  if (!notificationsSupported()) { return "unsupported"; }
  let result = notificationPermission();
  if (result === "default") {
    try {
      const pending = window.Notification.requestPermission(
        function (res) { result = res; });
      if (pending && typeof pending.then === "function") {
        result = await pending;
      }
    } catch (err) { /* the surfaces below report the state as it stands */ }
  }
  renderNotificationSettings();
  if (taskEditorState) { syncTaskReminderControls(); }
  checkTaskReminders();
  /* v2.35: a fresh grant can make a waiting note reminder
     due too, so the note scheduler takes the same look. */
  checkNoteReminders();
  return result;
}

/* The Settings task reminders switch. Off silences the
   scheduler completely (the tasks still show everywhere);
   on gives it an immediate look. */
function applyTaskRemindersFromToggle() {
  const toggle =
    document.getElementById("settingsTaskRemindersToggle");
  if (!toggle) { return; }
  state.taskReminders = !!toggle.checked;
  saveSettings();
  if (state.taskReminders) { checkTaskReminders(); }
}

/* The Settings note reminders switch, the task switch's
   twin: off silences the note scheduler completely (the
   reminders still show everywhere); on gives it an
   immediate look. */
function applyNoteRemindersFromToggle() {
  const toggle =
    document.getElementById("settingsNoteRemindersToggle");
  if (!toggle) { return; }
  state.noteReminders = !!toggle.checked;
  saveSettings();
  if (state.noteReminders) { checkNoteReminders(); }
}

let swRegistrationPromise = null;
function getSwRegistration() {
  if (!("serviceWorker" in navigator)) {
    return Promise.resolve(null);
  }
  if (!swRegistrationPromise) {
    try {
      swRegistrationPromise = navigator.serviceWorker
        .getRegistration()
        .then(function (reg) { return reg || null; })
        .catch(function () { return null; });
    } catch (err) {
      swRegistrationPromise = Promise.resolve(null);
    }
  }
  return swRegistrationPromise;
}

/* Raise one task's notification. Title is the task; the body
   names the notebook and the due moment ("JHA · Due today
   3:00 PM", "Personal · Due Oct 24"). The tag is the task id,
   so a repeat for the same task replaces rather than stacks,
   and the task id rides in the data for the click routing. */
async function deliverTaskNotification(task) {
  const title = task.title || "Untitled task";
  const nbName = notebookNameForSlug(task.notebook);
  const options = {
    body: (nbName ? nbName + " · " : "") +
      "Due " + taskDuePhrase(task),
    tag: task.id,
    icon: "icon-192.png",
    data: { taskId: task.id }
  };
  try {
    const reg = await getSwRegistration();
    if (reg && typeof reg.showNotification === "function") {
      await reg.showNotification(title, options);
      return;
    }
  } catch (err) { /* fall through to the constructor */ }
  if (!notificationsSupported()) { return; }
  try {
    const note = new window.Notification(title, options);
    note.onclick = function () {
      try { window.focus(); } catch (err) { /* best effort */ }
      queueTaskOpen(task.id);
      if (typeof note.close === "function") { note.close(); }
    };
  } catch (err) { /* a refused constructor leaves the lists to speak */ }
}

/* The scheduler. A 30 second timer owned by boot, independent
   of the Drive auto-sync setting, with extra looks on boot
   (inside onTasksLoaded below), on becoming visible, and after
   every task write or sync reload (afterTasksChanged and
   onTasksLoaded both call in). A task is due to notify when it
   is open, has a reminder and a due date, the setting is on,
   permission is granted, now has reached the due moment minus
   the offset, and the reminder has not already fired for this
   due moment. The fired keys live in memory so a session can
   never double fire while its lastReminderFor write is still
   landing; the stamp on the task makes the once only rule
   survive restarts, which is also what makes the boot catch
   up fire exactly once for a moment that passed while the app
   was closed. */
const TASK_REMINDER_TICK_MS = 30000;
const taskReminderFiredKeys = new Set();
let taskReminderTimer = null;
let pendingTaskOpenId = null;

function startTaskReminderScheduler() {
  if (taskReminderTimer !== null) { return; }
  taskReminderTimer = setInterval(checkTaskReminders,
    TASK_REMINDER_TICK_MS);
}

/* ==========================================================================
   v2.35: NOTE REMINDERS (Evernote parity, phase 2 release 3).

   Evernote's model, from its help pages: a note carries one
   reminder (a date and time set from the note's own reminder
   control or its menu, with quick choices beside a custom
   date); the reminder shows on the note wherever it lists,
   and every reminder gathers in a reminders list sorted by
   its moment; when the moment arrives the app notifies; and
   the reminder is then marked done (which records a done
   stamp and leaves the note itself untouched) or cleared
   entirely.

   Here the reminder lives on the note as two ISO stamps,
   reminderAt and reminderDoneAt, written into the note
   file's front matter only while set (see serializeNote),
   carried by the catalog at shape 3, and set through one
   panel (openNoteReminderPanel) from both surfaces
   Evernote offers: the note's own footer (the editor's
   Reminder button, at the foot of the note where Evernote
   keeps its reminder control) and the notes list menu's
   Reminder item. The panel offers Evernote's quick choices
   (Tomorrow, In a week) beside a date and an optional time;
   an empty time means 09:00 local, the hour tasks use.

   Firing mirrors the task machinery above it, with the
   same named deviation tasks carry: there is no server to
   push with, so a reminder fires while the app is open on
   a device (and once on the next open for a moment missed
   while it was closed). One deliberate difference from
   tasks: the fired stamp is NOT written onto the note (a
   task stamps its own record because tasks.json is a data
   file; a note file write would re-stamp the note's
   updated time, float it up every Updated-sorted list, and
   add save and conflict surface to a timer path, all for
   a delivery fact Evernote itself never writes into the
   note: only the reader's own mark-done writes there). The
   stamps live in this device's settings instead
   (state.noteReminderFired: note id -> the reminderAt
   fired for), which also matches how Evernote delivers,
   once per device. Trashed and archived notes never fire:
   the scheduler reads state.notes only, the task precedent
   (a completed task never fires) applied to collections.
   ========================================================================== */

/* The reminder moment's date and time as the panel's two
   input values (local), or empty strings when the note
   carries no reminder. */
function noteReminderInputParts(note) {
  const d = new Date(note && note.reminderAt || "");
  if (isNaN(d.getTime())) { return { date: "", time: "" }; }
  function p2(n) { return (n < 10 ? "0" : "") + n; }
  return {
    date: d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" +
      p2(d.getDate()),
    time: p2(d.getHours()) + ":" + p2(d.getMinutes())
  };
}

/* The reminder moment in the app's date words, the task due
   phrase's shape: "today 10:30 AM", "tomorrow 9:00 AM",
   "Oct 30, 9:00 AM". Empty for a reminderless note. */
function noteReminderDuePhrase(note) {
  if (!note || !note.reminderAt) { return ""; }
  const parts = noteReminderInputParts(note);
  if (!parts.date) { return ""; }
  const diff = taskDayDiff({ dueDate: parts.date });
  const time = taskTimeLabel(parts.time);
  if (diff === 0) { return "today " + time; }
  if (diff === 1) { return "tomorrow " + time; }
  if (diff !== null && diff < 0) {
    return taskDateLabel(parts.date) + ", " + time;
  }
  return taskDateLabel(parts.date) + ", " + time;
}

/* The reminder's one line of words, shared by the card
   marker and the editor footer button: a set reminder reads
   "Reminder · Tomorrow, 10:30 AM" (the day capitalized, the
   way the card meta speaks), a done one "Reminder done ·
   Oct 26". Empty for a reminderless note. */
function noteReminderLabel(note) {
  if (!note || !note.reminderAt) { return ""; }
  if (note.reminderDoneAt) {
    const doneParts = noteReminderInputParts(note);
    return "Reminder done · " + taskDateLabel(doneParts.date);
  }
  const phrase = noteReminderDuePhrase(note);
  const capped = phrase
    ? phrase.charAt(0).toUpperCase() + phrase.slice(1) : "";
  return "Reminder · " + capped;
}

/* The reminder panel's session state: the id of the note
   the panel is editing, or null while it is closed. The
   note is re-read from state at every action, so a sync
   landing while the panel is open is honored. */
let reminderPanelNoteId = null;

function reminderPanelNote() {
  if (!reminderPanelNoteId) { return null; }
  return state.notes.find(function (n) {
    return n.id === reminderPanelNoteId;
  }) || null;
}

/* Open the reminder panel for a note: the list menu's
   Reminder item and the editor footer's Reminder button
   both land here. The fields start from the note's current
   reminder (blank when none), the quick choices sit above
   them, and Mark as done and Remove reminder show only
   while a reminder exists to act on. */
function openNoteReminderPanel(noteId) {
  const note = state.notes.find(function (n) {
    return n.id === noteId;
  });
  if (!note) { return; }
  reminderPanelNoteId = note.id;
  document.getElementById("reminderModalTitle").textContent =
    note.reminderAt ? "Edit reminder" : "Add reminder";
  document.getElementById("reminderModalNote").textContent =
    note.title || "Untitled note";
  const status = document.getElementById("reminderModalStatus");
  if (note.reminderDoneAt) {
    status.textContent = "This reminder was marked done. " +
      "Saving a new date sets a fresh reminder.";
  } else if (note.reminderAt) {
    status.textContent = "Reminder set for " +
      noteReminderDuePhrase(note) + ".";
  } else {
    status.textContent = "No reminder is set on this note.";
  }
  const parts = noteReminderInputParts(note);
  document.getElementById("reminderDateInput").value = parts.date;
  document.getElementById("reminderTimeInput").value = parts.time;
  document.getElementById("reminderDoneBtn").classList.toggle(
    "hidden", !(note.reminderAt && !note.reminderDoneAt));
  document.getElementById("reminderRemoveBtn").classList.toggle(
    "hidden", !note.reminderAt);
  document.getElementById("reminderModal").classList.remove("hidden");
}

function closeNoteReminderPanel() {
  reminderPanelNoteId = null;
  document.getElementById("reminderModal").classList.add("hidden");
}

/* The quick choices (Tomorrow, In a week) fill the fields
   at 09:00, the hour an empty time means, and leave the
   save to the Save button, so a quick pick can still be
   adjusted before it lands. */
function fillReminderQuickChoice(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  function p2(n) { return (n < 10 ? "0" : "") + n; }
  document.getElementById("reminderDateInput").value =
    d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" +
    p2(d.getDate());
  document.getElementById("reminderTimeInput").value = "09:00";
}

/* Persist a reminder change through the ordinary save:
   the reminder pair is note content (see
   noteContentSnapshot), so the pin toggle's deliberate
   save path is the right one, updated re-stamp and all.
   The lists, the sidebar counts, and the editor (footer
   button included) re-render from the mutated note. */
function persistNoteReminder(note, toastText) {
  saveNoteToRepo(note);
  renderAll();
  toast(toastText);
}

/* Save: the date is required (a dateless reminder is the
   one Evernote shape this build does not carry; see the
   revision entry). An empty time means 09:00 local. A
   fresh save clears any done stamp and re-arms the fired
   stamp, so a reminder set again for a new moment can
   fire for it. */
function saveNoteReminderFromPanel() {
  const note = reminderPanelNote();
  if (!note) { closeNoteReminderPanel(); return; }
  const dateStr = document.getElementById("reminderDateInput").value;
  const timeStr = document.getElementById("reminderTimeInput").value;
  if (!dateStr) {
    toast("Pick a date for the reminder.", true);
    return;
  }
  const dp = parseTaskDate(dateStr);
  if (!dp) {
    toast("That date does not parse.", true);
    return;
  }
  let hh = 9, mm = 0;
  if (timeStr && /^\d{2}:\d{2}$/.test(timeStr)) {
    hh = Number(timeStr.slice(0, 2));
    mm = Number(timeStr.slice(3, 5));
  }
  note.reminderAt = new Date(dp.y, dp.m - 1, dp.d, hh, mm, 0, 0)
    .toISOString();
  note.reminderDoneAt = null;
  delete state.noteReminderFired[note.id];
  saveSettings();
  closeNoteReminderPanel();
  persistNoteReminder(note, "Reminder set for " +
    noteReminderDuePhrase(note) + ".");
}

/* Mark as done: the done stamp lands, the moment stays
   (the Reminders view and the card both show the reminder
   as done, the way Evernote keeps a completed reminder
   visible), and a done reminder never fires. */
function markNoteReminderDoneFromPanel() {
  const note = reminderPanelNote();
  if (!note) { closeNoteReminderPanel(); return; }
  note.reminderDoneAt = new Date().toISOString();
  closeNoteReminderPanel();
  persistNoteReminder(note, "Reminder marked done.");
}

/* Remove: both stamps clear, and the note's file returns
   to the exact shape it had before any reminder existed. */
function removeNoteReminderFromPanel() {
  const note = reminderPanelNote();
  if (!note) { closeNoteReminderPanel(); return; }
  note.reminderAt = null;
  note.reminderDoneAt = null;
  delete state.noteReminderFired[note.id];
  saveSettings();
  closeNoteReminderPanel();
  persistNoteReminder(note, "Reminder removed.");
}

/* v2.35: the note reminder scheduler, the task scheduler's
   twin. Same cadence and gates (its own Settings switch,
   the notification permission), plus the note conditions:
   the note is live, carries a reminder, is not done, the
   moment has arrived, and this device has not already
   fired for this exact moment. */
const NOTE_REMINDER_TICK_MS = 30000;
let noteReminderTimer = null;
/* The session's own fired set, the task set's twin: it
   covers the moment between stamping and the stamp's
   settings write landing, and a second check in the same
   session can never double fire. */
const noteReminderFiredKeys = new Set();

function noteReminderFireKey(note) {
  return String(note.id) + "|" + String(note.reminderAt || "");
}

function startNoteReminderScheduler() {
  if (noteReminderTimer !== null) { return; }
  noteReminderTimer = setInterval(checkNoteReminders,
    NOTE_REMINDER_TICK_MS);
}

function checkNoteReminders() {
  if (!state.noteReminders) { return; }
  if (notificationPermission() !== "granted") { return; }
  const now = Date.now();
  /* Stale stamps are pruned as the check passes: a stamp
     whose note is gone, whose reminder moved or cleared,
     or whose reminder is done can never be consulted
     again, and dropping it here keeps the settings record
     the size of the live reminder set. */
  let stampsChanged = false;
  const liveById = {};
  state.notes.forEach(function (n) { liveById[n.id] = n; });
  Object.keys(state.noteReminderFired).forEach(function (id) {
    const n = liveById[id];
    if (!n || !n.reminderAt || n.reminderDoneAt ||
        state.noteReminderFired[id] !== n.reminderAt) {
      delete state.noteReminderFired[id];
      stampsChanged = true;
    }
  });
  state.notes.forEach(function (note) {
    if (!note.reminderAt || note.reminderDoneAt) { return; }
    const at = new Date(note.reminderAt).getTime();
    if (isNaN(at) || at > now) { return; }
    if (state.noteReminderFired[note.id] === note.reminderAt) {
      return;
    }
    const key = noteReminderFireKey(note);
    if (noteReminderFiredKeys.has(key)) { return; }
    noteReminderFiredKeys.add(key);
    state.noteReminderFired[note.id] = note.reminderAt;
    stampsChanged = true;
    deliverNoteReminderNotification(note);
  });
  /* The stamps ride one settings write per check that
     changed any, the task stamp discipline's shape (there
     the stamp lands inside the tasks write). */
  if (stampsChanged) { saveSettings(); }
}

/* Deliver one note reminder notification, the task
   delivery's twin: the service worker's showNotification
   preferred (its click handler routes back through
   sw.js), the Notification constructor as the fallback.
   The title is the note's title; the body names its
   notebook and the moment, in the task notification's
   voice. */
async function deliverNoteReminderNotification(note) {
  const title = note.title || "Untitled note";
  const nbName = notebookNameForSlug(note.notebook);
  const body = (nbName ? nbName + " · " : "") + "Reminder " +
    noteReminderDuePhrase(note);
  try {
    const reg = await getSwRegistration();
    if (reg && typeof reg.showNotification === "function") {
      await reg.showNotification(title, {
        body: body,
        icon: "icon-192.png",
        tag: "note-reminder-" + note.id,
        data: { noteReminderId: note.id }
      });
      return;
    }
  } catch (err) { /* fall through to the constructor */ }
  try {
    const n = new Notification(title, {
      body: body, tag: "note-reminder-" + note.id });
    n.onclick = function () {
      try { window.focus(); } catch (e) { /* best effort */ }
      queueNoteReminderOpen(note.id);
    };
  } catch (err) { /* no path left to try */ }
}

/* Notification clicks for note reminders, the task click
   routing's twin: sw.js posts the click (or lands the page
   on ?noteReminder=), the id waits here until the library
   has loaded, and the note then opens from All Notes. A
   target in Trash or the Archive answers with the message
   note links give and never opens, and a gone target is
   dropped quietly. */
let pendingNoteReminderOpenId = null;

function queueNoteReminderOpen(id) {
  if (!id) { return; }
  pendingNoteReminderOpenId = String(id);
  maybeOpenPendingNoteReminder();
}

function maybeOpenPendingNoteReminder() {
  if (!pendingNoteReminderOpenId) { return; }
  if (!state.repoExists) { return; }
  const id = pendingNoteReminderOpenId;
  const note = state.notes.find(function (n) {
    return n.id === id;
  });
  if (note) {
    pendingNoteReminderOpenId = null;
    state.view = { kind: "all", value: null };
    renderAll();
    /* v2.72: a reminder arrival lands at the top, as it
       always has (see the view memory section). */
    editorAtTopNoteId = id;
    openNote(id);
    setMobileView("editor");
    return;
  }
  if (state.trash.some(function (n) { return n.id === id; })) {
    pendingNoteReminderOpenId = null;
    toast("That note is in Trash.");
    return;
  }
  if (state.archive.some(function (n) { return n.id === id; })) {
    pendingNoteReminderOpenId = null;
    toast("That note is in the Archive.");
  }
}

function readNoteReminderParamFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("noteReminder");
    if (id) { pendingNoteReminderOpenId = id; }
  } catch (err) { /* no parameter, no pending open */ }
}

function checkTaskReminders() {
  /* v2.44: never before this session's real load has
     armed the tasks. Until then state.tasks can hold
     the cache paint's display only copy, and firing
     from it could notify for a task another device has
     since completed or re stamp a moment the store has
     already moved past. The gate costs nothing today:
     before the cache carried tasks the list was simply
     empty until this same moment. The boot catch up
     still runs, from onTasksLoaded, after the load. */
  if (!tasksArmed) { return; }
  if (!state.taskReminders) { return; }
  if (notificationPermission() !== "granted") { return; }
  const now = Date.now();
  state.tasks.forEach(function (task) {
    if (task.status !== "open") { return; }
    if (task.reminderOffsetMin == null) { return; }
    const moment = taskDueMoment(task);
    if (!moment) { return; }
    const momentIso = moment.toISOString();
    if (task.lastReminderFor === momentIso) { return; }
    const key = task.id + "|" + momentIso;
    if (taskReminderFiredKeys.has(key)) { return; }
    if (now < moment.getTime() -
        task.reminderOffsetMin * 60000) { return; }
    taskReminderFiredKeys.add(key);
    task.lastReminderFor = momentIso;
    saveTasks();
    deliverTaskNotification(task);
  });
}

/* Notification click routing, the page side. The service
   worker's handler focuses a running client and posts it a
   message, or opens the app URL with a task parameter when no
   client is running; the constructor fallback's own click
   handler calls queueTaskOpen directly. Either way the ask
   waits here until tasks have loaded, then opens the Tasks
   view with that task's editor up. */
function queueTaskOpen(taskId) {
  if (!taskId) { return; }
  pendingTaskOpenId = taskId;
  maybeOpenPendingTask();
}

function maybeOpenPendingTask() {
  if (!pendingTaskOpenId) { return; }
  if (!tasksArmed) { return; }
  const task = findTaskById(pendingTaskOpenId);
  pendingTaskOpenId = null;
  if (!task) { return; }
  state.view = { kind: "tasks", value: null };
  renderAll();
  setMobileView("list");
  openTaskEditor(task.id);
}

function readTaskOpenParamFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("task");
    if (id) { pendingTaskOpenId = id; }
  } catch (err) { /* no parameter, no pending open */ }
}

/* The post load pass for tasks, called by loadAllFromRepo
   whenever the tasks read landed. Three jobs: refresh the
   open task editor under the untouched rule (a remote change
   refills an untouched editor with the new facts, and closes
   it when its task is gone; a dirty editor is left exactly
   alone, the care standard the open note gets), run the
   reminder check (the boot catch up lives here), and open
   any task a notification click is waiting on. */
function onTasksLoaded(prevTaskUpdatedById) {
  if (taskEditorState && taskEditorState.id &&
      prevTaskUpdatedById) {
    const task = findTaskById(taskEditorState.id);
    if (!task) {
      if (!taskEditorState.dirty) { closeTaskEditor(); }
    } else if (prevTaskUpdatedById[task.id] !== undefined &&
        prevTaskUpdatedById[task.id] !== task.updated &&
        !taskEditorState.dirty) {
      document.getElementById("taskModalTitle").textContent =
        "Edit task";
      fillTaskEditor(task);
    }
  }
  /* v2.49.0: the landed task state is the truth the open
     note's tasks blocks show, so they repaint here too. A
     note opened mid load painted its blocks from the
     cache copy, and the editor's render does not refill a
     note that is already open (its body did not change),
     so without this the window would keep showing the
     cached tasks beside the landed reminder pass. The
     Things page owns the editor pane while it is open and
     is left alone, the same guard afterTasksChanged
     keeps. */
  if (!state.thingsNotebook) { refreshOpenNoteTaskBlocks(); }
  checkTaskReminders();
  maybeOpenPendingTask();
}

/* v2.51: the navigation epoch. Every openNote call bumps
   it, and a switch deferred behind a settle (below)
   compares its captured value before completing: a newer
   openNote call supersedes the deferred switch, so the
   LAST navigation asked for is the one that stands,
   exactly as it was when every switch was instant. Without
   this, a deferred switch could land after a later
   navigation (even a re-open of the note already showing)
   and yank the editor to a note the user has already
   clicked away from. */
let openNoteEpoch = 0;

/* Open one note in the editor. On mobile this also switches the visible
   pane to the editor.
   v2.51: this is the one funnel every note opening runs
   through (the notes list, search results, backlinks, note
   links, Home, Shortcuts, the Reminders view, notification
   arrivals, restores), so the note switch settle lives
   here: when a DIFFERENT note is open with unsettled
   edits, the outgoing note settles first and the switch
   happens only when the settle resolves. A clean switch,
   and re-opening the note already open, run the old body
   (openNoteNow, below) synchronously and unchanged. On a
   hard settle failure the switch is aborted outright:
   the outgoing note stays open with its text on screen,
   because replacing the editor would discard edits that
   exist nowhere else (see settleOpenNoteEdits). */
function openNote(id) {
  const epoch = ++openNoteEpoch;
  const outgoing = currentNote();
  if (outgoing && outgoing.id !== id && !outgoing.trashed &&
      !outgoing.archived && swEditorUnsettled()) {
    settleOpenNoteEdits().then(function (ok) {
      if (!ok) {
        toast("Your last edit could not be saved, so the " +
          "note was left open.", true);
        return;
      }
      /* A newer openNote call superseded this switch
         while the settle ran: drop the navigation (the
         settle itself still saved the outgoing note). */
      if (epoch !== openNoteEpoch) { return; }
      openNoteNow(id);
    });
    return;
  }
  openNoteNow(id);
}

/* The switch itself, exactly as openNote ran it through
   v2.50. Kept separate so the settle gate above can defer
   it without duplicating it. */
function openNoteNow(id) {
  /* v2.72: leaving a note banks its editor place first
     (see the view memory section); the capture reads
     the outgoing note's standing editor, so it runs
     before the selection moves. Only a note the editor
     actually filled has a place to bank. */
  const outgoingNote = currentNote();
  if (outgoingNote && outgoingNote.id !== id &&
      renderEditor._forId === outgoingNote.id) {
    rememberEditorViewState(outgoingNote.id);
  }
  /* v2.68.0: a note opening leaves the Home and Tasks
     full area views first. While either is active,
     syncTasksPane holds the editor pane under the
     hidden class (display none !important), so a note
     created or opened from there rendered into a pane
     nothing could show: on the phone every pane ended
     up display none under the mobile bar, a blank white
     screen, which is what Chris hit with New Note from
     Home (reproduced in the real Chromium rig at a
     phone viewport: body view-editor, the editor pane
     still hidden). This is openNoteFromHome's own rule
     (the note opens in the All Notes view) generalized
     to the one switch point every open passes through;
     the list and notebook views do not hide the editor
     and are untouched. */
  if (state.view.kind === "home" || state.view.kind === "tasks") {
    state.view = { kind: "all", value: null };
  }
  state.selectedId = id;
  /* v2.24.3: a note opening replaces any Things to do page. */
  state.thingsNotebook = null;
  /* v2.24.5: a note switch closes the phone toolbar panel. */
  closeTbPanel();
  renderNoteList();
  renderEditor();
  setMobileView("editor");
  /* v2.73: a switch leaves the outgoing note closed, so a
     transcription that was parked on its unsaved edits
     can land in its stored body now (the settle has
     already collected and saved those edits by the time
     a switch reaches this point). */
  void drainParkedTranscripts();
}

function currentNote() {
  if (!state.selectedId) { return null; }
  return findNoteById(state.selectedId);
}

/* v2.133: the could not load face's memory: the id and
   message of the load error the editor pane is already
   showing, so a failure that keeps failing renders its
   face once instead of circling render, attempt,
   render. It is set where the face renders (the shell
   branch below) and cleared whenever the pane shows
   anything else. */
let loadErrorFaceKey = "";

function renderEditor() {
  /* v2.123: the open Doc-backed note's near-live poll
     follows the open note (see refreshDocLivePoll in
     media.js): every editor render re-judges whether
     the poll should run, and for which note. */
  refreshDocLivePoll();
  const note = currentNote();
  const noNote = document.getElementById("noNote");
  const wrap = document.getElementById("editorWrap");
  /* v2.23: the paste popup belongs to the note and body it was
     raised over; any render replaces both, so it closes here,
     on every path below. */
  closePastePopup();
  /* v2.24.3: while a Things to do page is open it owns the
     editor pane outright: the empty pane and the note editor
     hide, the page renders, and nothing here touches the
     note's fields, so the open note's editor state (and any
     pending autosave, which reads those same untouched
     fields) is exactly as it was when the user comes back.
     Note popups close like they do on the no note path. */
  const thingsWrap = document.getElementById("thingsWrap");
  if (state.thingsNotebook) {
    noNote.classList.add("hidden");
    wrap.classList.add("hidden");
    /* v2.124: the Doc type dress belongs to an open note;
       the Things page owns the pane, so it comes off. */
    document.getElementById("noteBody").classList.remove(
      "ss-doc-body");
    hideLinkBar();
    hideTableMenu();
    hideCellMenu();
    clearCellSelection();
    closeNotebookMenu();
    renderThingsView();
    return;
  }
  if (thingsWrap) { thingsWrap.classList.add("hidden"); }
  if (!note) {
    /* v2.133: no note on screen means the standing
       pane, never a could not load face left standing
       by the note that was open before. */
    noNote.classList.remove("load-error");
    loadErrorFaceKey = "";
    noNote.classList.remove("hidden");
    wrap.classList.add("hidden");
    /* v2.124: no note on screen, so no Doc type dress
       stands on the hidden editor either. */
    document.getElementById("noteBody").classList.remove(
      "ss-doc-body");
    /* v1.3.1: no note on screen, so no link popup either.
       v2.9: the popup's successor, the link bar, same rule. */
    hideLinkBar();
    /* v2.2: and no table menu either. */
    hideTableMenu();
    /* v2.3: and no cell menu, chip, or cell selection. */
    hideCellMenu();
    clearCellSelection();
    /* v2.5: and no notebook menu. */
    closeNotebookMenu();
    /* v2.50: no note on screen is one of the clean states
       a waiting self update reload waits for; retry it
       here, where the editor's closing lands. */
    maybeReloadForUpdate();
    return;
  }
  /* v2.20: a catalog shell has no body on this device yet, so
     there is nothing honest to fill the editor with. Fetch the
     one file now and render again when it lands (if the note is
     still the selected one); until then the editor shows the
     same empty pane as no selection, and no field is ever filled
     from a shell, so nothing can autosave an empty body over
     the real one. */
  if (note.bodyLoaded === false) {
    ensureNoteBodyLoaded(note).then(function () {
      if (state.selectedId !== note.id) { return; }
      if (note.bodyLoaded !== false) {
        renderEditor();
        return;
      }
      /* v2.133: the load failed and its error stands
         recorded on the note (ensureNoteBodyLoaded
         keeps it as bodyLoadError). Render once more so
         the could not load face below replaces the
         standing pane and names the failure. The render
         is keyed by the error itself: the face's own
         render fires one more attempt, and when that
         attempt fails with the same message the key
         already stands, so nothing renders in a
         circle. A different error renders fresh, and
         so does the same note reached again after
         another note, or no note, held the pane (both
         clear the key). */
      if (note.bodyLoadError) {
        const key = note.id + "|" + note.bodyLoadError.message;
        if (key !== loadErrorFaceKey) {
          loadErrorFaceKey = key;
          renderEditor();
        }
      }
    });
    /* v2.133: a shell carrying a recorded load error
       shows the could not load face (the #noNoteError
       block inside #noNote, switched by the load-error
       class in styles.css): it names the failure in
       the error's own words, with its HTTP status when
       it carries one, states that the note itself is
       safe and nothing was changed, and offers Retry.
       The button is wired here, at render time, the
       way the conflict banner's button is wired: its
       handler loads the note again and then renders
       what settled, so a retry works as many times as
       it is pressed, and a load that lands clears the
       error on the note and the face with it. A shell
       with no recorded error (its load never ran, or
       is still in flight) keeps the standing pane
       exactly as it stood. */
    const loadErr = note.bodyLoadError || null;
    noNote.classList.toggle("load-error", !!loadErr);
    if (loadErr) {
      loadErrorFaceKey = note.id + "|" + loadErr.message;
      const errText = document.getElementById("noNoteErrorText");
      if (errText) {
        errText.textContent = loadErr.message +
          (loadErr.docHttpStatus ?
            " (HTTP status " + loadErr.docHttpStatus + ")" : "");
      }
      const retryBtn = document.getElementById("noNoteRetryBtn");
      if (retryBtn) {
        retryBtn.onclick = function () {
          ensureNoteBodyLoaded(note).then(function () {
            renderEditor();
          });
        };
      }
    } else {
      loadErrorFaceKey = "";
    }
    noNote.classList.remove("hidden");
    wrap.classList.add("hidden");
    hideLinkBar();
    hideTableMenu();
    clearCellSelection();
    closeNotebookMenu();
    return;
  }
  /* v2.133: a loaded note is on screen, so no could
     not load face stands and its key is forgotten. */
  noNote.classList.add("hidden");
  noNote.classList.remove("load-error");
  loadErrorFaceKey = "";
  wrap.classList.remove("hidden");

  /* v2.124: a Doc-backed note's page wears Google Docs
     type (the ss-doc-body rules in styles.css); a file
     note's page keeps the app's own type. The class is
     judged here, on every render that shows a note, so
     a note switch can never leave the wrong dress
     standing, and it is cleared on the paths above
     where the editor hides. */
  document.getElementById("noteBody").classList.toggle(
    "ss-doc-body", isDocBackedNote(note));

  /* v2.16: the auto-sync editor guard. runAutoSync arms it with
     the open note's id and storage revision before its sync;
     when the reload brings that same note back at that same
     revision, nothing the editor shows can have changed, so
     the render stops here: no field refill, no chrome churn,
     and the DOM and the user's selection stay exactly as they
     stood. A note that did change elsewhere carries a new
     revision, the guard misses, and the normal render below
     runs. Manual syncs never arm the guard. */
  if (autoSyncEditorGuard && autoSyncEditorGuard.id === note.id &&
      note.sha && autoSyncEditorGuard.sha === note.sha) {
    return;
  }

  /* Only refill the fields when a different note is being opened, so a
     re-render during typing never moves the cursor or clobbers input.
     v2.16.1: one narrow exception. When this render is a sync's
     and the sync changed the note already open, a clean editor
     (nothing unsaved; see syncShouldRefillOpenNote) is refilled
     in place, so an outside edit shows up without clicking away
     and back. The view state is captured before the fill and
     restored after it, so the reader keeps their place. */
  const syncRefill = renderEditor._forId === note.id &&
    syncShouldRefillOpenNote(note);
  let refillView = null;
  /* v2.72: on a switch fill (not a sync refill), the
     note's banked place, recalled here for the restore
     at the foot of the fill; an opening that named
     itself at the top (editorAtTopNoteId) restores
     nothing and zeroes the scroll instead. The naming
     is spent by the first fill that reads it, whichever
     note that fill is for. */
  let returnView = null;
  let returnAtTop = false;
  if (renderEditor._forId !== note.id || syncRefill) {
    /* v2.132: a fill, whether a note switch's or a
       sync refill's landing, shows the note object's
       body, so any pending refill for this note has
       landed by being shown: its stash clears. */
    clearPendingNoteRefill(note.id);
    if (syncRefill) { refillView = captureEditorViewState(); }
    else {
      returnView = recalledEditorViewState(note.id);
      if (editorAtTopNoteId === note.id) {
        returnView = null;
        returnAtTop = true;
      }
      editorAtTopNoteId = null;
    }
    renderEditor._forId = note.id;
    /* v1.3.1: switching notes closes any open link popup, since it
       refers to a link in the previous note. v2.9: same for the
       link bar that replaced the popup. */
    hideLinkBar();
    /* v1.6: an image selection (and its resize handle) belongs to the
       previous note's DOM, which is about to be replaced. v1.7: the
       image menu closes with it (deselectAttachment closes it), and
       the attachment body guard goes up so the keyboard deletion
       reconciliation can never mistake a note swap for a mass
       deletion while the new body is being built. */
    deselectAttachment();
    /* v2.14.1: an open audio card menu belongs to the previous
       note's card in the same way; it closes with the swap. */
    closeAttCardMenu();
    /* v2.2: the floating Table button and menu belong to the previous
       note's tables; they close with the note swap, exactly like the
       link popup above. */
    hideTableMenu();
    /* v2.3: the cell button, its menu, the filter chip, and any
       multi-cell selection belong to the previous note too. */
    hideCellMenu();
    clearCellSelection();
    /* v2.5: the notebook menu belongs to the previous note too. */
    closeNotebookMenu();
    /* v2.11: the image lightbox and the image editor belong to the
       previous note too. (The alignment submenu closes with the
       image menu, in deselectAttachment above.) */
    closeImageLightbox();
    closeImageEditor();
    /* v2.12: the "@" note popup belongs to the previous note too. */
    closeMentionPopup();
    /* v2.17: the tags picker belongs to the previous note too. */
    closeTagPicker();
    attachBodyGuard = true;
    /* v1.2: the previous note's image blob URLs are released before the
       editor switches, so long sessions do not accumulate them. */
    revokeAttachmentUrls();
    document.getElementById("noteTitle").value = note.title || "";
    document.getElementById("noteTags").value = note.tags.join(", ");
    /* v2.2: no pin control is filled here anymore. The note object's
       pinned value is authoritative and is changed only by the Pin
       note / Unpin note item in the notes list toolbar menu. */
    document.getElementById("noteBody").innerHTML = note.body || "";
    /* v2.120: bare web images in the stored body take
       their external figure form before the decoration
       pass below, so they open as blocks (and save in
       the canonical shell form) however they arrived. */
    adoptBareExternalImages(document.getElementById("noteBody"));
    /* v1.6: tag checklists saved before the ss-checklist class
       existed, so they get the bullet free styling and Enter
       behavior of new ones. */
    normalizeChecklists(document.getElementById("noteBody"));
    /* v2.7: restore every checklist box from its item's saved
       done class (and heal the checked attribute in the same
       pass), so a checked item reopens checked; see
       syncChecklistBoxes. */
    syncChecklistBoxes(document.getElementById("noteBody"));
    /* v2.117: a done item's own content takes its
       struck and muted wrap (see syncDoneItemWrap),
       so the finished look paints on the item's own
       text only and never on a list nested under
       it. */
    decorateDoneItems(document.getElementById("noteBody"));
    /* v1.7: freshly rendered placeholders get the shared decoration
       (the inline image class, the draggable flag) immediately, not
       only when hydration reaches them one by one. */
    document.getElementById("noteBody")
      .querySelectorAll(".ss-attachment").forEach(function (el) {
        const att = (note.attachments || []).find(function (a) {
          return a.id === el.getAttribute("data-attachment-id");
        });
        decorateAttachmentPlaceholder(note, el, att || null);
      });
    /* v2.3: reapply any saved table filters, so rows a filter
       hides start hidden when the note opens. (Typing inside cells
       does not re-run filters; only setting or clearing one, and
       this render, reapplies row visibility.) */
    applyAllTableFilters(document.getElementById("noteBody"));
    /* v2.6.0: link tooltips are resolved fresh on every render, with
       the rest of the body decorations: a note link shows its
       target's CURRENT title, so a rename is reflected the next time
       this note opens, without the link itself being edited. */
    decorateLinkTooltips(document.getElementById("noteBody"));
    /* v2.9: link view faces (Mention chips, Preview cards) are
       rebuilt beside the tooltips, from the mode and Microlink
       info attributes the saved body carries. */
    decorateLinkViews(document.getElementById("noteBody"));
    /* v2.28.0: task links take their labels from the
       tasks' current titles on the same render. */
    decorateTaskLinks(document.getElementById("noteBody"));
    /* v2.37.0: a table of contents block re derives its
       entries (and its headings' anchor ids) from the body
       just filled, so a note reopened anywhere, including
       one whose stored snapshot went stale, shows correct
       entries before anything is touched. */
    refreshTocBlocks(document.getElementById("noteBody"));
    /* v2.49.0: the note's tasks blocks paint from the
       task state as it stands at this render, the cache
       paint's copy included: the block is a window, and
       a cold window shows the cached tasks (their rows'
       controls disabled until the load arms the tasks,
       the rule buildTaskRowEl already keeps) until the
       landed load's own render replaces them. */
    refreshNoteTaskBlocks(document.getElementById("noteBody"), note);
    /* v2.89: the note's encrypted passages take their
       standing form for this session: while the vault
       is unlocked they decrypt in place; while locked
       the stored blocks already show their faces. */
      /* v2.99.0: the body just filled takes its code
       blocks' caret furniture (see decorateCode
       CaretBrs), so a block whose stored text ends
       in a newline stands at full height, its empty
       last line boxed, before anything is touched. */
    decorateCodeCaretBrs(document.getElementById("noteBody"));
    setSaveState(note.trashed ? "In Trash" :
      (note.archived ? "Archived" : "Saved"));
    /* v1.2: fill the attachment placeholders from the providers. This is
       async and fire and forget: text renders immediately, images and
       file cards pop in as each download lands. v1.7: the same pass
       then restores any undo stashed blocks and takes the body
       snapshot the deletion reconciliation compares against. */
    finishNoteOpenAttachments(note).catch(function (err) {
      console.warn("Attachment hydration failed:", err);
    });
    /* v2.119: the body just filled is the baseline
       for the editor's own undo history: the stack
       the previous note (or this note's previous
       stored state) had is gone, and changes from
       here settle as steps of their own. */
    editorHistoryReset(note);
  }
  /* v2.16.1: a sync refill hands the reader their place back
     (scroll, and the caret by its text offset) once the new
     fields and decorations are in. */
  if (refillView) { restoreEditorViewState(refillView); }
  /* v2.72: a return from another note puts the banked
     place back; an at the top opening zeroes the scroll
     it would otherwise inherit from the note just left. */
  else if (returnView) { restoreEditorViewState(returnView); }
  else if (returnAtTop) {
    const scroller = document.querySelector(".editor-scroll");
    if (scroller) { scroller.scrollTop = 0; }
  }

  /* v2.5: the notebook link follows the note. A trashed or
     archived note shows the notebook it came from, since that is
     where Restore or Unarchive will put it back; the link is
     inert on those locked notes. See refreshNotebookLink. */
  refreshNotebookLink(note);
  /* v2.56: the breadcrumb follows the note on the same
     render, beside the notebook link it echoes: its
     notebook segment names the same notebook (the live
     one here, since a locked note's crumb names its
     collection instead), and its title segment reads
     the title field as it stands. */
  renderBreadcrumb(note);

  /* Trash mode swaps the action buttons and locks editing. Archive
     mode (v1.5) does the same, with its own pair: Unarchive and Move
     to Trash are shown, Restore and Delete Forever stay hidden, and
     the Archive button only appears for a normal live note. */
  const inTrash = !!note.trashed;
  const inArchive = !!note.archived;
  const locked = inTrash || inArchive;
  document.getElementById("trashBtn").classList.toggle("hidden", inTrash);
  document.getElementById("archiveBtn").classList.toggle("hidden", locked);
  document.getElementById("restoreBtn").classList.toggle("hidden", !inTrash);
  document.getElementById("unarchiveBtn").classList.toggle("hidden", !inArchive);
  document.getElementById("deleteForeverBtn").classList.toggle("hidden", !inTrash);
  document.getElementById("noteBody").contentEditable = locked ? "false" : "true";
  document.getElementById("noteTitle").disabled = locked;
  document.getElementById("noteTags").disabled = locked;
  /* v2.35: the footer Reminder button locks with the other
     editing controls, and its label carries the note's
     reminder state (the moment in words, a done wording, or
     the plain word when none is set). */
  document.getElementById("noteReminderBtn").disabled = locked;
  document.getElementById("noteReminderBtnLabel").textContent =
    note.reminderAt ? noteReminderLabel(note) : "Reminder";
  /* v2.109.0: a locked note (Trash or Archive) shows no
     formatting toolbar: the note is read only because of
     the collection it sits in, so the editing bar has
     nothing to offer it (Chris's checklist item). The
     toggle rides the same locked state as every control
     above, so the bar follows the note on every render:
     hidden while locked, standing again the moment the
     note is restored or unarchived. */
  document.getElementById("toolbar").classList.toggle(
    "hidden", locked);
  /* v2.2: a locked note (Trash or Archive) never shows the floating
     Table button or menu; updateTableMenu would hide them on the
     next caret move anyway, but locking closes them immediately. */
  if (locked) { hideTableMenu(); }
  /* v2.3: the same for the cell furniture and any cell selection. */
  if (locked) { hideCellMenu(); clearCellSelection(); }
  /* v2.9: and the link bar closes the moment a note locks, since
     its actions all edit the note. */
  if (locked) { hideLinkBar(); }
  /* v2.12: a locked note never carries the "@" popup either. */
  if (locked) { closeMentionPopup(); }
  /* v2.5: the notebook link's locked state was set by
     refreshNotebookLink above (it replaced the old picker's
     disabled line here). */
  /* v2.36: the backlinks bar follows the open note. It
     renders from the link graph on every editor render of a
     loaded note, and its own background fills (shell body
     loads landing) re-render it when its entries change;
     see the v2.36 section. The early returns above (no note,
     Things page, shell) hide #editorWrap, and the bar with
     it. */
  renderBacklinks();
  /* v2.50: a render that lands with the editor clean (a
     note switch above all) is a landing moment for a
     waiting self update reload; the check itself judges
     the open note's baseline, so a dirty editor simply
     declines here, on every render, until it is clean. */
  maybeReloadForUpdate();
}
renderEditor._forId = null;

/* --------------------------------------------------------------------------
   v2.56: the editor breadcrumb.

   The owner's report: on the phone there was no way
   back to the open note's notebook. The editor's Back
   to list button only flips the pane to the notes list
   in whatever view happens to be current, and a note
   opened from Home, search, a shortcut, a note link,
   or a notification often has some other view standing
   behind it, so reaching the notebook meant opening
   the Notebooks section, tapping the notebook, and
   then finding the note again. The breadcrumb is the
   direct path: a slim trail at the top of the editor,
   Notebooks, then the notebook, then the note, each
   step but the last a link.

   Segments, by where the note lives:
     live note:    "Notebooks" (link), the owning
                   notebook's current display name
                   (link), the note's current title
                   (plain text, aria-current="page").
     Trash note:   "Trash" (link), the title.
     Archive note: "Archive" (link), the title.
   A locked note shows no notebook segment: its
   collection is the place it can be navigated back
   to, and the notebook it came from stays the meta
   row link's business, exactly as before.

   The taps navigate views and panes only. The notebook
   segment performs the sidebar notebook row's own
   state change (state.view to that notebook, renderAll,
   the phone pane flip to the list), with one addition:
   the list is scrolled so the note he came from, which
   stays selected throughout, is on screen. The
   "Notebooks" segment lands on All Notes, and the
   Trash and Archive segments land on their views, the
   sidebar rows' same one line pattern. NOTHING here
   opens, closes, or switches the open note: the note
   stays open in the editor behind the list, so the
   v2.51 note switch settle has nothing to settle, and
   no path through the bar can mark the note dirty or
   write anything. On desktop the panes are all visible
   already, so the same taps simply change the view in
   place (setMobileView is the app's own no-op there).

   The bar is rebuilt on every editor render beside
   refreshNotebookLink, so the notebook segment follows
   renames and notebook moves, and the title segment
   follows the title field: it reads the field itself,
   not the note object, so a render landing mid typing
   still shows what is typed, and an input listener
   (wired with the editor's buttons) keeps it live
   between renders, worded "Untitled note" when the
   field is blank, the app's universal fallback. The
   bar lives inside .editor-inner, in the title's own
   scroll flow, and nowhere near collectEditor's field
   list, so it can never be serialized into a note.
   -------------------------------------------------------------------------- */
function breadcrumbTitleText() {
  const input = document.getElementById("noteTitle");
  const typed = input ? input.value.trim() : "";
  return typed || "Untitled note";
}

function renderBreadcrumb(note) {
  const list = document.getElementById("crumbList");
  if (!list || !note) { return; }
  list.innerHTML = "";
  function addSeparator() {
    const li = document.createElement("li");
    li.className = "crumb-item";
    const sep = document.createElement("span");
    sep.className = "crumb-sep";
    sep.setAttribute("aria-hidden", "true");
    sep.textContent = "\u203A";
    li.appendChild(sep);
    list.appendChild(li);
  }
  function addLink(label, nav, slug) {
    if (list.children.length) { addSeparator(); }
    const li = document.createElement("li");
    li.className = "crumb-item";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "crumb-link";
    btn.textContent = label;
    btn.setAttribute("data-crumb-nav", nav);
    if (slug) { btn.setAttribute("data-crumb-slug", slug); }
    li.appendChild(btn);
    list.appendChild(li);
  }
  function addCurrent(text) {
    if (list.children.length) { addSeparator(); }
    const li = document.createElement("li");
    li.className = "crumb-item crumb-item-current";
    const span = document.createElement("span");
    span.className = "crumb-current";
    span.id = "crumbCurrent";
    span.setAttribute("aria-current", "page");
    span.textContent = text;
    li.appendChild(span);
    list.appendChild(li);
  }
  if (note.trashed) {
    addLink("Trash", "trash", null);
  } else if (note.archived) {
    addLink("Archive", "archive", null);
  } else {
    addLink("Notebooks", "notebooks", null);
    const nb = state.notebooks.find(function (n) {
      return n.slug === note.notebook;
    });
    addLink(nb ? nb.name : (note.notebook || ""), "notebook",
      note.notebook);
  }
  addCurrent(breadcrumbTitleText());
}

/* One breadcrumb tap: set the view the segment names,
   render, flip the phone to the list, and land the
   list's scroll on the open note's card. The sidebar
   rows' pattern verbatim, plus the scroll; the open
   note itself is never touched. */
function handleBreadcrumbNav(nav, slug) {
  if (nav === "notebook") {
    if (!slug) { return; }
    state.view = { kind: "notebook", value: slug };
  } else if (nav === "trash") {
    state.view = { kind: "trash", value: null };
  } else if (nav === "archive") {
    state.view = { kind: "archive", value: null };
  } else {
    state.view = { kind: "all", value: null };
  }
  renderAll();
  setMobileView("list");
  scrollSelectedNoteCardIntoView();
}

/* The list a breadcrumb tap lands on shows the open
   note selected (state.selectedId never changed), but
   a long list may hold its card below the fold; bring
   it into view, nearest edge, so the note he came
   from is the one under his eye. Guarded the way the
   app guards its other scrollIntoView call: a host
   without the method simply skips the scroll. */
function scrollSelectedNoteCardIntoView() {
  if (!state.selectedId) { return; }
  const cards = document.querySelectorAll(
    "#noteList .note-card");
  for (let i = 0; i < cards.length; i++) {
    if (cards[i].getAttribute("data-note-id") ===
        state.selectedId) {
      if (typeof cards[i].scrollIntoView === "function") {
        cards[i].scrollIntoView({ block: "nearest" });
      }
      return;
    }
  }
}

/* --------------------------------------------------------------------------
   v2.5: the notebook link and its menu.
   The link shows the open note's effective notebook: for a live
   note, the notebook it lives in; for a trashed or archived note,
   the notebook it came from (where Restore or Unarchive returns
   it), rendered as plain text because a locked note cannot move.
   The menu is rebuilt on every open from state.notebooks, the
   note's own notebook marked, and picking another runs the shared
   moveNoteToNotebook path from section 10, the same one drag and
   drop lands on, so there is still exactly one move
   implementation. The notebook itself is never a form value
   anymore: collectEditor reads it from the note object, which
   only the move paths change.
   -------------------------------------------------------------------------- */
function refreshNotebookLink(note) {
  const link = document.getElementById("notebookLink");
  if (!link || !note) { return; }
  const wanted = note.trashed ? (note.trashedFrom || note.notebook) :
    (note.archived ? (note.archivedFrom || note.notebook) : note.notebook);
  const nb = state.notebooks.find(function (n) { return n.slug === wanted; });
  document.getElementById("notebookLinkName").textContent =
    nb ? nb.name : (wanted || "");
  link.dataset.slug = wanted || "";
  const locked = !!note.trashed || !!note.archived;
  link.disabled = locked;
  link.classList.toggle("locked", locked);
  if (locked) { closeNotebookMenu(); }
}

function closeNotebookMenu() {
  const menu = document.getElementById("notebookMenu");
  if (menu) { menu.classList.add("hidden"); }
  const link = document.getElementById("notebookLink");
  if (link) { link.setAttribute("aria-expanded", "false"); }
}

function openNotebookMenu() {
  const note = currentNote();
  const menu = document.getElementById("notebookMenu");
  const link = document.getElementById("notebookLink");
  if (!note || !menu || !link || link.disabled) { return; }
  menu.innerHTML = "";
  /* v2.31: the move menu lists notebooks in the sidebar's
     Evernote order, like the other notebook pickers. */
  notebooksInSidebarOrder().forEach(function (nb) {
    const item = document.createElement("button");
    item.type = "button";
    item.setAttribute("role", "menuitem");
    const isCurrent = nb.slug === note.notebook;
    if (isCurrent) { item.classList.add("current"); }
    const check = document.createElement("span");
    check.className = "nb-check";
    check.setAttribute("aria-hidden", "true");
    check.textContent = isCurrent ? "✓" : "";
    item.appendChild(check);
    const label = document.createElement("span");
    label.textContent = nb.name;
    item.appendChild(label);
    item.addEventListener("click", function () {
      closeNotebookMenu();
      if (!isCurrent) { moveNoteToNotebook(note, nb.slug); }
    });
    menu.appendChild(item);
  });
  menu.classList.remove("hidden");
  link.setAttribute("aria-expanded", "true");
}

function toggleNotebookMenu() {
  const menu = document.getElementById("notebookMenu");
  if (!menu) { return; }
  if (menu.classList.contains("hidden")) { openNotebookMenu(); }
  else { closeNotebookMenu(); }
}

/* --------------------------------------------------------------------------
   v2.7: the sidebar footer's three dot menu.
   Chris's layout: the Synced pill row carries one menu button at
   its right end, the save status sits on its own line under the
   row, and the actions that were standalone footer buttons
   through v2.6.0 live in this menu. The menu opens upward from
   the button and follows the notebook menu's patterns: the
   button toggles it, clicks inside it do not propagate, a
   document click outside the footer closes it, Escape closes
   it, and choosing an item closes it (each item's own handler,
   wired in wireEvents and in the PWA block, does the closing).
   v2.8: Refresh connection and Dark mode left this menu for the
   Settings modal (see the v2.8 block below). v2.17: Refresh
   connection is back in this menu, under Sync now (Dark mode
   stays in Settings); the menu then held Sync now, Refresh
   connection, Install app, Settings, Collapse sidebar, and
   Sign out. v2.18: Collapse sidebar leaves the menu for the
   footer's chevron button, so the menu now holds Sync now,
   Refresh connection, Install app, Settings, and Sign out.
   -------------------------------------------------------------------------- */
function openSidebarMenu() {
  const menu = document.getElementById("sidebarMenu");
  const btn = document.getElementById("sidebarMenuBtn");
  if (!menu) { return; }
  menu.classList.remove("hidden");
  if (btn) { btn.setAttribute("aria-expanded", "true"); }
}

function closeSidebarMenu() {
  const menu = document.getElementById("sidebarMenu");
  const btn = document.getElementById("sidebarMenuBtn");
  if (menu) { menu.classList.add("hidden"); }
  if (btn) { btn.setAttribute("aria-expanded", "false"); }
}

function toggleSidebarMenu() {
  const menu = document.getElementById("sidebarMenu");
  if (!menu) { return; }
  if (menu.classList.contains("hidden")) { openSidebarMenu(); }
  else { closeSidebarMenu(); }
}

/* --------------------------------------------------------------------------
   v2.8: the Settings modal and the shared theme control

   The modal (settingsModal in the markup) is organized as headed
   sections so future settings can be added as another section
   without redesigning it. v2.8 ships three: Appearance (the
   Light and Dark segmented control), Connection (Refresh
   connection), and Note history (the versions per note limit).

   Theme has exactly one writer, setTheme, and every surface
   goes through it: the Settings segmented control sets a side,
   the icon rail's theme button toggles through toggleTheme, and
   the choice persists through saveSettings like it always has.
   (Through v2.7 the sidebar menu's Dark mode item toggled the
   body class inline; that item is gone, and this shared pair is
   what replaced it, which is also what lets the rail keep a
   direct theme button now that there is no menu item for it to
   click through to.) The segmented control's selected side is
   refreshed from the body class on every sync, so the active
   choice is always the visibly filled, aria-pressed side.

   v2.54: the modal's sections are tab panels under a tab
   strip; the tab machinery (selectSettingsTab and the
   session's remembered tab) sits directly below this
   comment, ahead of the theme pair.
   -------------------------------------------------------------------------- */
/* --------------------------------------------------------------------------
   v2.54: the Settings tabs

   One writer owns which section shows: selectSettingsTab
   sets the panels' hidden classes and the tabs'
   aria-selected and roving tabindex together, so the strip
   and the panels can never disagree. The hidden panels
   stay in the DOM with every control live: syncSettingsControls
   and the sections' own render flows (the Last load readout,
   the notification status, the Web clipper fill) write to
   them exactly as they did when the sections were stacked,
   so a value that lands while its tab is hidden reads
   correctly the moment the tab is shown.

   The remembered tab is session state in memory only: it
   is not a setting, it is never written to localStorage or
   the synced store, and a fresh page load starts on
   Appearance. An unknown remembered value falls back to
   Appearance at selection time, so the modal can never
   open on no section at all.
   -------------------------------------------------------------------------- */
const SETTINGS_TAB_KEYS = ["appearance", "connection",
  "notifications", "editor", "history", "webclip", "start"];
let settingsActiveTab = "appearance";

function settingsTabButton(key) {
  return document.querySelector(
    '#settingsTabs [data-settings-tab="' + key + '"]');
}
function settingsTabPanel(key) {
  return document.querySelector(
    '#settingsModal [data-settings-panel="' + key + '"]');
}

/* Show one tab's panel and mark its tab selected. Selection
   is instant and records the tab as the session's
   remembered one. */
function selectSettingsTab(key) {
  if (SETTINGS_TAB_KEYS.indexOf(key) < 0) { key = "appearance"; }
  settingsActiveTab = key;
  SETTINGS_TAB_KEYS.forEach(function (k) {
    const active = k === key;
    const btn = settingsTabButton(k);
    if (btn) {
      btn.setAttribute("aria-selected", active ? "true" : "false");
      btn.tabIndex = active ? 0 : -1;
    }
    const panelEl = settingsTabPanel(k);
    if (panelEl) { panelEl.classList.toggle("hidden", !active); }
  });
}

function syncSettingsThemeControls() {
  const dark = document.body.classList.contains("dark");
  const lightBtn = document.getElementById("settingsThemeLightBtn");
  const darkBtn = document.getElementById("settingsThemeDarkBtn");
  if (lightBtn) { lightBtn.setAttribute("aria-pressed", dark ? "false" : "true"); }
  if (darkBtn) { darkBtn.setAttribute("aria-pressed", dark ? "true" : "false"); }
}

function setTheme(dark) {
  document.body.classList.toggle("dark", !!dark);
  saveSettings();
  syncSettingsThemeControls();
  /* renderSidebar ends in renderRailChrome, which keeps the rail
     theme button's tooltip (Dark mode or Light mode) in step. */
  renderSidebar();
}

function toggleTheme() {
  setTheme(!document.body.classList.contains("dark"));
}

/* The saved feedback line under the versions input. One writer,
   used when the modal opens (where it reports the setting in
   force) and whenever the input is applied (where it confirms
   the save, or explains a rejected value). */
function setVersionsFeedback(text) {
  const el = document.getElementById("settingsVersionsFeedback");
  if (el) { el.textContent = text; }
}
function versionsLimitFeedback(limit) {
  if (limit === 0) { return "Version history is off."; }
  return "SnakeScale Notes keeps up to " + limit + " version" +
    (limit === 1 ? "" : "s") + " per note.";
}

/* Push every control in the modal to the state it controls.
   Called on every open, so the modal never shows a stale theme
   or a stale limit. */
function syncSettingsControls() {
  syncSettingsThemeControls();
  const input = document.getElementById("settingsVersionsInput");
  if (input) { input.value = String(currentVersionsLimit()); }
  setVersionsFeedback(versionsLimitFeedback(currentVersionsLimit()));
  /* v2.16: the auto-sync checkbox shows the saved choice. */
  const autoSyncToggle = document.getElementById("settingsAutoSyncToggle");
  if (autoSyncToggle) { autoSyncToggle.checked = state.autoSync !== false; }
  /* v2.23: the Default paste select shows the saved mode. */
  const pasteSelect = document.getElementById("settingsDefaultPasteSelect");
  if (pasteSelect) {
    pasteSelect.value = ["source", "merge", "text"]
      .indexOf(state.defaultPasteMode) >= 0
      ? state.defaultPasteMode : "source";
  }
  /* v2.33: the When opening select shows the saved
     choice (Home unless this device chose the list). */
  const startSelect = document.getElementById("settingsStartViewSelect");
  if (startSelect) {
    startSelect.value = state.startView === "notes"
      ? "notes" : "home";
  }
  /* v2.72: the Default notebook select shows the saved
     choice, its options rebuilt from the notebooks that
     stand (see renderDefaultNotebookSelect). */
  renderDefaultNotebookSelect();
  /* v2.24: the Notifications section shows the live
     permission and the saved reminders switch. */
  renderNotificationSettings();
  /* v2.79: the account line shows the signed in account. */
  renderWorkerAccountLine();
  /* v2.80: the Google Calendar row shows the
     connection's state, and opening Settings asks for the
     current month like any calendar surface. */
  renderGcalSettingsRow();
  /* v2.82: the Email row likewise, and opening
     Settings asks for the mail like any mail surface. */
  renderMailSettingsRow();
  ensureMailLoaded();
  /* v2.85: the Contacts row likewise, and opening
     Settings asks for the contacts while signed in,
     so the row can say which state stands (a
     forbidden answer is the row's Not connected,
     with its Connect button the cure). */
  renderPeopleSettingsRow();
  if (mailSignedInAble()) { ensurePeopleContacts(); }
  /* v2.86: the Push notifications row likewise, and
     opening Settings gives the registration its look,
     like the contacts ask above it. */
  renderPushSettingsRow();
  if (mailSignedInAble()) { ensurePushRegistration(); }
  const gcalNowParts = taskTodayParts();
  ensureGcalMonth(gcalNowParts.y, gcalNowParts.m);
  /* v2.21: the Last load readout shows this session's boot. */
  renderLastLoadReadout();
  /* v2.47: the Web clipper section shows this build's
     bookmarklet for this app's own address. */
  renderWebClipSettings();
  /* v2.72: the orphan scan section shows the session's
     kept scan (its results, its error, or its running
     state); opening Settings never clears it and never
     starts a scan. */
  renderOrphanScanSection();
}

function openSettingsModal() {
  closeSidebarMenu();
  /* v2.9: a modal opening puts the link bar away, like every
     other overlay in the app. */
  hideLinkBar();
  syncSettingsControls();
  /* v2.54: reopen on the session's remembered tab,
     Appearance on a fresh load; selectSettingsTab
     validates the value, so a stale one lands there too. */
  selectSettingsTab(settingsActiveTab);
  const modal = document.getElementById("settingsModal");
  if (modal) { modal.classList.remove("hidden"); }
  const closeBtn = document.getElementById("settingsCloseBtn");
  if (closeBtn) { closeBtn.focus(); }
}

/* v2.23: the paste popup's Set default paste row lands here:
   the same modal, opened the same way, with the Default paste
   select scrolled into view and focused so the choice it
   names is the one on screen. The popup closes first (its own
   dismissal), so the two never stack. */
function openSettingsAtDefaultPaste() {
  closePastePopup();
  openSettingsModal();
  /* v2.54: the select lives on the Editor tab now, so land
     there: the choice the popup names is the one on
     screen, as it was when the sections were stacked. */
  selectSettingsTab("editor");
  const select = document.getElementById("settingsDefaultPasteSelect");
  if (select) {
    if (typeof select.scrollIntoView === "function") {
      select.scrollIntoView({ block: "center" });
    }
    select.focus();
  }
}

/* v2.23: the Default paste select's change handler. The choice
   persists at once, like every Settings control, and takes
   effect on the next paste; a paste already on screen keeps
   the mode it landed in. */
function applyDefaultPasteFromSelect() {
  const select = document.getElementById("settingsDefaultPasteSelect");
  if (!select) { return; }
  if (["source", "merge", "text"].indexOf(select.value) >= 0) {
    state.defaultPasteMode = select.value;
  } else {
    state.defaultPasteMode = "source";
    select.value = "source";
  }
  saveSettings();
}

/* v2.33: the When opening select's change handler. The
   choice persists at once, like every Settings control,
   on this device only, and takes effect on the next
   boot; the current session's view does not move. */
/* v2.72: the Default notebook select's options.
   Notebooks come and go, so the list is rebuilt on
   every Settings open: the unset choice first (its
   label states today's rule, the first notebook), then
   one option per notebook. The shown value is the
   saved slug while it still names a notebook, and the
   unset choice when it does not, so a deleted default
   shows as unset here while creations fall back the
   same way (fallbackNotebookSlug). */
function renderDefaultNotebookSelect() {
  const select = document.getElementById(
    "settingsDefaultNotebookSelect");
  if (!select) { return; }
  select.innerHTML = "";
  const unset = document.createElement("option");
  unset.value = "";
  unset.textContent = "No default (first notebook)";
  select.appendChild(unset);
  state.notebooks.forEach(function (nb) {
    const opt = document.createElement("option");
    opt.value = nb.slug;
    opt.textContent = nb.name;
    select.appendChild(opt);
  });
  select.value = defaultNotebookSlug() || "";
}

/* v2.72: the Default notebook select's change handler.
   The choice persists at once, like every Settings
   control, on this device only, and governs the next
   creation that names no notebook. A value naming no
   standing notebook is stored as unset rather than
   kept as a pointer at nothing. */
function applyDefaultNotebookFromSelect() {
  const select = document.getElementById(
    "settingsDefaultNotebookSelect");
  if (!select) { return; }
  const value = select.value;
  if (value === "" || state.notebooks.some(function (nb) {
    return nb.slug === value;
  })) {
    state.defaultNotebook = value;
  } else {
    state.defaultNotebook = "";
    select.value = "";
  }
  saveSettings();
}

function applyStartViewFromSelect() {
  const select = document.getElementById("settingsStartViewSelect");
  if (!select) { return; }
  if (select.value === "notes" || select.value === "home") {
    state.startView = select.value;
  } else {
    state.startView = "home";
    select.value = "home";
  }
  saveSettings();
}

function closeSettingsModal() {
  /* v2.72: closing Settings no longer clears the orphan
     scan: a scan in flight keeps running behind the
     closed modal, and a finished scan's results stand
     for the next visit (see renderOrphanScanSection). */
  const modal = document.getElementById("settingsModal");
  if (modal) { modal.classList.add("hidden"); }
}

/* --------------------------------------------------------------------------
   v2.65: the orphaned attachments scan (Settings, Connection)

   Chris's ask (2026-10-29): removing an image from a note can
   leave its file behind in the attachments folder, and he
   wants a check that finds those files and lets him decide,
   one by one, what to keep. The scan is a button in Settings
   Connection and it is on demand only: nothing in this section
   runs at startup, on a timer, or inside a sync. It runs when
   the button is pressed.

   v2.72 (Chris's follow-up ask, 2026-10-30): the scan runs
   in the background. Starting it and closing Settings does
   not cancel it; its results persist in the module state
   below for the rest of the session (a page reload is their
   only expiry), so reopening Settings shows them standing.
   Completion raises a persistent toast (it stays until
   dismissed), and a Review Orphaned Files button stands
   beside the Scan button here and inside that toast, each
   only while orphaned files stand in the results. Nothing
   about a scan is written to the index, the catalog, or
   settings.

   What counts as a reference: the union of attachment record
   fileIds from every note in every collection (live, Trash,
   and Archive alike; restoring a note must find its files
   exactly where they were), every attachment record carried
   by a saved version (a version snapshot holds the note's
   records from its moment, and restoring it points at the
   same files), and the card attachment on any catalog shell.
   A loaded note answers from its records in memory. A
   shell's records live only in its file's front matter, so
   the scan parses that file's text; parsing never loads a
   body into state, so no note object is touched, nothing
   renders differently, and the editor never hears about it.
   A note file that cannot be read stops the scan with an
   error rather than letting its files look orphaned.

   A file in the attachments folder whose Drive id is in no
   reference is an orphan. The id is the identity: it is the
   value every attachment read and delete in this app
   resolves by, so a file that merely shares a referenced
   file's name is still a stranger. The scan covers the
   store's current attachments subfolder only. The legacy
   pre-v2.0 top level folder ("SnakeScale Notes
   Attachments") is deliberately not scanned: its files keep
   working by id wherever they sit, and the one time
   consolidation moves them into the current folder, after
   which this scan sees them like any other file.

   Delete runs through the attachment provider's trash
   (providers.google.trash, the same call the attachment
   Remove flow fires when its undo window closes), so an
   orphan leaves exactly the way an attachment leaves:
   into Drive trash, recoverable by the owner. v2.66
   routed every attachment deletion this way; before
   it, these same calls deleted permanently.
   -------------------------------------------------------------------------- */
let orphanScanRunning = false;
let orphanDeleteAllRunning = false;
/* The last scan's shape: {filesChecked, references,
   foundCount, orphans: [{fileId, name, mime, size,
   modifiedTime, error, deleting}]}. Memory only, and
   (v2.72) kept for the whole session: closing Settings
   no longer clears it. */
let orphanScanState = null;
/* v2.72: the last scan's failure, kept beside its
   results so a reopened Settings shows the error the
   aborted scan left, never a clean list in its place. */
let orphanScanError = null;
const orphanThumbUrls = {};   /* fileId -> preview object URL */

/* Empty the section: results, status, preview URLs, the
   remembered scan and its error, and any standing
   completion toast. Called when a new scan starts
   (runOrphanAttachmentScan): the one moment old results
   give way. v2.72: Settings opening and closing no
   longer call it; the session keeps a scan's outcome. */
function clearOrphanScanResults() {
  orphanScanState = null;
  orphanScanError = null;
  dismissOrphanScanDoneToast();
  Object.keys(orphanThumbUrls).forEach(function (id) {
    try { URL.revokeObjectURL(orphanThumbUrls[id]); } catch (e) {}
    delete orphanThumbUrls[id];
  });
  const results = document.getElementById("settingsOrphanResults");
  if (results) { results.innerHTML = ""; }
  const status = document.getElementById("settingsOrphanStatus");
  if (status) { status.textContent = ""; }
  syncOrphanReviewButton();
}

/* v2.72: what the Connection section shows for the
   orphan scan when Settings opens: the running state
   while a scan is in flight (the button busy and
   labelled, as the scan itself keeps it), the kept
   results when a scan stands, the kept error when the
   last scan aborted, and an empty section when no scan
   has run this session. Opening Settings never starts
   a scan and never clears one. */
function renderOrphanScanSection() {
  const btn = document.getElementById("settingsOrphanScanBtn");
  const label = document.getElementById("settingsOrphanScanLabel");
  const status = document.getElementById("settingsOrphanStatus");
  const results = document.getElementById("settingsOrphanResults");
  if (orphanScanRunning) {
    if (btn) { btn.disabled = true; }
    if (label) { label.textContent = "Scanning..."; }
    if (status) {
      status.textContent = "Scanning the attachments folder...";
    }
    if (results) { results.innerHTML = ""; }
  } else {
    if (btn) { btn.disabled = false; }
    if (label) { label.textContent = "Scan for orphaned attachments"; }
    if (status) { status.textContent = ""; }
    if (orphanScanState) {
      renderOrphanScanResults();
    } else if (orphanScanError) {
      renderOrphanScanError(orphanScanError);
    } else if (results) {
      results.innerHTML = "";
    }
  }
  syncOrphanReviewButton();
}

/* v2.72: the Review Orphaned Files button in Settings
   stands only while the kept scan still holds orphans:
   it appears when a scan lands with files to review
   and goes away as Keep and Delete work the list down
   to none (renderOrphanScanResults syncs it). */
function syncOrphanReviewButton() {
  const btn = document.getElementById("settingsOrphanReviewBtn");
  if (!btn) { return; }
  const show = !!orphanScanState && orphanScanState.orphans.length > 0;
  btn.classList.toggle("hidden", !show);
}

/* v2.72: the scan's completion toast. Unlike the
   ordinary toast it carries no dismissal timer: it
   stands until its own dismiss button, its Review
   button, or a new scan closes it, so a scan that
   finishes behind other work is still announced when
   the user comes back. Its Review button rides inside
   only while orphans stand. */
let orphanScanDoneToastEl = null;

function dismissOrphanScanDoneToast() {
  if (orphanScanDoneToastEl && orphanScanDoneToastEl.parentNode) {
    orphanScanDoneToastEl.parentNode.removeChild(orphanScanDoneToastEl);
  }
  orphanScanDoneToastEl = null;
}

function showOrphanScanDoneToast() {
  dismissOrphanScanDoneToast();
  const box = document.getElementById("toastBox");
  if (!box || !orphanScanState) { return; }
  const count = orphanScanState.orphans.length;
  const el = document.createElement("div");
  el.className = "toast orphan-done-toast";
  const msg = document.createElement("span");
  msg.className = "orphan-done-msg";
  msg.textContent = count
    ? "Orphan scan finished: " + count + " orphaned attachment" +
      (count === 1 ? "" : "s") + " found."
    : "Orphan scan finished: no orphaned attachments found.";
  el.appendChild(msg);
  if (count) {
    const review = document.createElement("button");
    review.type = "button";
    review.className = "toast-action orphan-review-btn";
    review.textContent = "Review Orphaned Files";
    review.addEventListener("click", function () {
      openOrphanReview();
    });
    el.appendChild(review);
  }
  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast-close";
  close.setAttribute("aria-label", "Dismiss");
  close.textContent = "\u00D7";
  close.addEventListener("click", function () {
    dismissOrphanScanDoneToast();
  });
  el.appendChild(close);
  box.appendChild(el);
  orphanScanDoneToastEl = el;
}

/* v2.72: Review, from either of its two homes (the
   button beside Scan in Settings, and the completion
   toast's button): the scan's existing results surface
   on the Connection tab, scrolled into view. From the
   toast it also spends the toast: the review it asked
   for now stands in its place. */
function openOrphanReview() {
  dismissOrphanScanDoneToast();
  openSettingsModal();
  selectSettingsTab("connection");
  renderOrphanScanSection();
  const btn = document.getElementById("settingsOrphanScanBtn");
  if (btn && typeof btn.scrollIntoView === "function") {
    btn.scrollIntoView({ block: "center" });
  }
}

/* The reference union, as the section comment lays out.
   Throws on any store read failure: a partial union would
   call live files orphaned, so the scan fails closed. */
async function collectOrphanReferences() {
  const refs = new Set();
  function addRecords(records) {
    (records || []).forEach(function (a) {
      if (a && a.fileId) { refs.add(String(a.fileId)); }
    });
  }
  const lists = [state.notes, state.trash, state.archive];
  for (const list of lists) {
    for (const note of (list || [])) {
      addRecords(note.attachments);
      if (note.shellCardAtt && note.shellCardAtt.fileId) {
        refs.add(String(note.shellCardAtt.fileId));
      }
      if (note.bodyLoaded === false) {
        const file = await storeGetFile(notePath(note));
        if (!file) {
          throw new Error("A note file could not be read (" +
            notePath(note) + "), so the scan stopped rather " +
            "than guess at its attachments.");
        }
        const parsed = parseNoteFile(file.text, file.token, note.id,
          note.trashed, note.archived);
        addRecords(parsed.attachments);
      }
    }
  }
  const ventries = (await storeListDir(VERSIONS_FOLDER_NAME)) || [];
  for (const entry of ventries) {
    if (entry.isDir || !/\.json$/i.test(entry.name)) { continue; }
    const vpath = VERSIONS_FOLDER_NAME + "/" + entry.name;
    const file = await storeGetFile(vpath);
    if (!file) {
      throw new Error("A saved versions file could not be read (" +
        vpath + "), so the scan stopped rather than guess at " +
        "its attachments.");
    }
    let data = null;
    try { data = JSON.parse(file.text); } catch (err) {
      throw new Error("A saved versions file could not be " +
        "understood (" + vpath + "), so the scan stopped " +
        "rather than guess at its attachments.");
    }
    ((data && data.versions) || []).forEach(function (v) {
      addRecords(v && v.attachments);
    });
  }
  return refs;
}

/* The attachments folder's files, folders themselves aside:
   the store's one read only folder resolution
   (create = false, so a missing folder reads as an empty
   one and the scan never makes a folder by looking), then
   the shared children listing, which carries each file's
   size and modified time. */
async function listOrphanCandidates() {
  const folderId = await driveResolveFolder(ATTACH_SUBFOLDER_NAME,
    false);
  if (!folderId) { return []; }
  const children = await driveListChildren(folderId);
  return children.filter(function (c) {
    return c.mimeType !== DRIVE_FOLDER_MIME;
  });
}

/* The button's one job. The running flag and the disabled
   button are the same guard twice (a caller that invokes
   the function directly meets the flag), the label says
   Scanning while the work is in flight, and the finally
   restores both whatever the outcome was. */
async function runOrphanAttachmentScan() {
  if (orphanScanRunning) { return; }
  const btn = document.getElementById("settingsOrphanScanBtn");
  const label = document.getElementById("settingsOrphanScanLabel");
  const status = document.getElementById("settingsOrphanStatus");
  orphanScanRunning = true;
  if (btn) { btn.disabled = true; }
  if (label) { label.textContent = "Scanning..."; }
  clearOrphanScanResults();
  if (status) { status.textContent = "Scanning the attachments folder..."; }
  try {
    if (!state.repoExists) {
      throw new Error("The notes store is not connected on " +
        "this device yet. Connect to Google Drive, then run " +
        "the scan.");
    }
    const refs = await collectOrphanReferences();
    const files = await listOrphanCandidates();
    const orphans = files.filter(function (f) {
      return !refs.has(String(f.id));
    }).map(function (f) {
      return {
        fileId: String(f.id),
        name: f.name || "Untitled file",
        mime: f.mimeType || "",
        size: Number(f.size) || 0,
        modifiedTime: f.modifiedTime || "",
        error: "",
        deleting: false
      };
    });
    orphanScanState = {
      filesChecked: files.length,
      references: refs.size,
      foundCount: orphans.length,
      orphans: orphans
    };
    if (status) { status.textContent = ""; }
    renderOrphanScanResults();
    /* v2.72: completion is announced wherever Settings
       stands, open or closed, by the persistent toast. */
    showOrphanScanDoneToast();
  } catch (err) {
    /* v2.72: an aborted scan keeps its error behavior
       (the error surface in this section, kept for the
       next visit) and raises no toast and no Review
       button: orphanScanState stays null, which is what
       keeps both away. */
    orphanScanState = null;
    orphanScanError = err;
    if (status) { status.textContent = ""; }
    renderOrphanScanError(err);
  } finally {
    orphanScanRunning = false;
    if (btn) { btn.disabled = false; }
    if (label) { label.textContent = "Scan for orphaned attachments"; }
  }
}

/* The honest failure shape: an error in the results area, in
   place of any list, saying the store could not be read and
   that nothing was changed. It never wears the zero result's
   wording, so a broken scan can never pass for a clean one. */
function renderOrphanScanError(err) {
  const host = document.getElementById("settingsOrphanResults");
  if (!host) { return; }
  host.innerHTML = "";
  const div = document.createElement("div");
  div.className = "orphan-error orphan-scan-error";
  div.textContent = "The scan could not read your store: " +
    (err && err.message ? err.message : String(err)) +
    " Nothing was changed. Check the connection and try again.";
  host.appendChild(div);
}

/* Render the remembered scan. The summary always carries
   the counts (files checked, references counted), so a
   working scan is distinguishable from a broken one even
   when it finds nothing; the found-nothing wording is
   reserved for a scan that found nothing, with a separate
   wording once every found orphan has been kept or
   deleted from the list. */
function renderOrphanScanResults() {
  const host = document.getElementById("settingsOrphanResults");
  if (!host) { return; }
  syncOrphanReviewButton();
  host.innerHTML = "";
  const scan = orphanScanState;
  if (!scan) { return; }
  const summary = document.createElement("div");
  summary.className = "orphan-summary";
  const msg = document.createElement("span");
  if (!scan.orphans.length) {
    msg.textContent = scan.foundCount > 0
      ? "Nothing is left in this scan: every orphaned " +
        "attachment it found was kept or deleted (" +
        scan.foundCount + " found, of " + scan.filesChecked +
        " files checked against " + scan.references +
        " attachment references)."
      : "No orphaned attachments. Checked " + scan.filesChecked +
        " file" + (scan.filesChecked === 1 ? "" : "s") +
        " in the attachments folder against " + scan.references +
        " attachment reference" + (scan.references === 1 ? "" : "s") +
        " from your notes and their saved versions.";
    summary.appendChild(msg);
    host.appendChild(summary);
    return;
  }
  const total = scan.orphans.reduce(function (sum, o) {
    return sum + (o.size || 0);
  }, 0);
  msg.textContent = scan.orphans.length + " orphaned attachment" +
    (scan.orphans.length === 1 ? "" : "s") + ", " +
    humanSize(total) + " total, of " + scan.filesChecked +
    " files checked against " + scan.references +
    " attachment references.";
  summary.appendChild(msg);
  const delAll = document.createElement("button");
  delAll.className = "btn small danger";
  delAll.type = "button";
  delAll.textContent = "Delete all";
  delAll.disabled = orphanDeleteAllRunning;
  delAll.addEventListener("click", function () {
    deleteAllOrphans().catch(function () {});
  });
  summary.appendChild(delAll);
  host.appendChild(summary);
  const list = document.createElement("div");
  list.className = "orphan-list";
  scan.orphans.forEach(function (orphan) {
    list.appendChild(buildOrphanRow(orphan));
  });
  host.appendChild(list);
}

/* One orphan's row: the preview square for an image, the
   name, the size and date line, any delete failure riding
   the row itself, and the Keep and Delete buttons. */
function buildOrphanRow(orphan) {
  const row = document.createElement("div");
  row.className = "orphan-row";
  row.setAttribute("data-orphan-id", orphan.fileId);
  if (orphan.mime.indexOf("image/") === 0) {
    const img = document.createElement("img");
    img.className = "orphan-thumb";
    img.alt = "";
    row.appendChild(img);
    loadOrphanThumb(orphan, img);
  }
  const main = document.createElement("div");
  main.className = "orphan-main";
  const name = document.createElement("div");
  name.className = "orphan-name";
  name.textContent = orphan.name;
  name.title = orphan.name;
  main.appendChild(name);
  const meta = document.createElement("div");
  meta.className = "orphan-meta";
  meta.textContent = humanSize(orphan.size) +
    (orphan.modifiedTime
      ? " - " + formatDate(orphan.modifiedTime) : "");
  main.appendChild(meta);
  if (orphan.error) {
    const err = document.createElement("div");
    err.className = "orphan-error";
    err.textContent = orphan.error;
    main.appendChild(err);
  }
  row.appendChild(main);
  const actions = document.createElement("div");
  actions.className = "orphan-actions";
  const busy = orphan.deleting || orphanDeleteAllRunning;
  const keep = document.createElement("button");
  keep.className = "btn small";
  keep.type = "button";
  keep.textContent = "Keep";
  keep.disabled = busy;
  keep.addEventListener("click", function () {
    keepOrphan(orphan.fileId);
  });
  actions.appendChild(keep);
  const del = document.createElement("button");
  del.className = "btn small danger";
  del.type = "button";
  del.textContent = "Delete";
  del.disabled = busy;
  del.addEventListener("click", function () {
    deleteOrphan(orphan.fileId).catch(function () {});
  });
  actions.appendChild(del);
  row.appendChild(actions);
  return row;
}

/* The preview: the file's bytes through the attachment
   provider's own download, the same read hydration uses,
   held as an object URL until the results clear. Any
   failure (offline, a file that will not decode) removes
   the square and leaves the name to speak for the file,
   per the section's degrade rule. A download that lands
   after its row was kept, deleted, or cleared revokes its
   URL instead of pinning it. */
async function loadOrphanThumb(orphan, img) {
  try {
    let url = orphanThumbUrls[orphan.fileId];
    if (!url) {
      const driver = providers.google;
      if (!driver || !driver.download) { img.remove(); return; }
      const blob = await driver.download(orphan.fileId);
      url = URL.createObjectURL(blob);
      if (!orphanScanState ||
          orphanScanState.orphans.indexOf(orphan) < 0) {
        try { URL.revokeObjectURL(url); } catch (e) {}
        return;
      }
      orphanThumbUrls[orphan.fileId] = url;
    }
    img.src = url;
  } catch (err) {
    img.remove();
  }
}

/* Keep: the row leaves this scan's results and that is
   all. The file is untouched, and nothing is remembered:
   a fresh scan lists the file again, which is what makes
   Keep a dismissal rather than a pardon. */
function keepOrphan(fileId) {
  const scan = orphanScanState;
  if (!scan) { return; }
  scan.orphans = scan.orphans.filter(function (o) {
    return o.fileId !== fileId;
  });
  renderOrphanScanResults();
}

/* One delete, confirmed first, through the provider's own
   trash (v2.66: the file moves to Drive trash and stays
   recoverable). The row stays while the call is in flight; a
   success drops it, and a failure keeps it with the reason
   written on the row, so one bad file never stops the
   rest of the list from being worked through. */
async function deleteOrphan(fileId) {
  const scan = orphanScanState;
  if (!scan) { return; }
  const orphan = scan.orphans.find(function (o) {
    return o.fileId === fileId;
  });
  if (!orphan || orphan.deleting) { return; }
  const ok = confirm("Delete \"" + orphan.name + "\" (" +
    humanSize(orphan.size) + ") from the attachments folder? " +
    "No note and no saved version uses this file.");
  if (!ok) { return; }
  orphan.error = "";
  orphan.deleting = true;
  renderOrphanScanResults();
  try {
    const driver = providers.google;
    if (!driver || !driver.trash) {
      throw new Error("Google Drive is not available.");
    }
    await driver.trash(fileId);
    scan.orphans = scan.orphans.filter(function (o) {
      return o.fileId !== fileId;
    });
    if (orphanThumbUrls[fileId]) {
      try { URL.revokeObjectURL(orphanThumbUrls[fileId]); } catch (e) {}
      delete orphanThumbUrls[fileId];
    }
  } catch (err) {
    orphan.error = "Delete failed: " +
      (err && err.message ? err.message : String(err));
  }
  orphan.deleting = false;
  renderOrphanScanResults();
}

/* Delete All: ONE confirmation naming the count and the
   total size, then the same provider trash per file in
   turn (v2.66: Drive trash, recoverable, like every
   attachment removal). Successes drop as they land;
   each failure keeps
   its row and its reason, so the list that remains is
   exactly the work that is left. */
async function deleteAllOrphans() {
  const scan = orphanScanState;
  if (!scan || !scan.orphans.length || orphanDeleteAllRunning) {
    return;
  }
  const total = scan.orphans.reduce(function (sum, o) {
    return sum + (o.size || 0);
  }, 0);
  const ok = confirm("Delete all " + scan.orphans.length +
    " orphaned attachment" + (scan.orphans.length === 1 ? "" : "s") +
    " (" + humanSize(total) + " total)? No note and no saved " +
    "version uses these files.");
  if (!ok) { return; }
  const driver = providers.google;
  if (!driver || !driver.trash) {
    toast("Google Drive is not available.", true);
    return;
  }
  orphanDeleteAllRunning = true;
  renderOrphanScanResults();
  const snapshot = scan.orphans.slice();
  for (const orphan of snapshot) {
    try {
      await driver.trash(orphan.fileId);
      scan.orphans = scan.orphans.filter(function (o) {
        return o.fileId !== orphan.fileId;
      });
      if (orphanThumbUrls[orphan.fileId]) {
        try { URL.revokeObjectURL(orphanThumbUrls[orphan.fileId]); }
        catch (e) {}
        delete orphanThumbUrls[orphan.fileId];
      }
    } catch (err) {
      orphan.error = "Delete failed: " +
        (err && err.message ? err.message : String(err));
    }
  }
  orphanDeleteAllRunning = false;
  renderOrphanScanResults();
}

/* v2.16: the auto-sync checkbox's change handler. The choice
   persists at once, like every Settings control, and takes
   effect live: on re-baselines the change token and starts
   the poller, off stops it and forgets the token and any
   pending change, so a later on starts from that moment
   rather than replaying everything missed while it was off. */
function applyAutoSyncFromToggle() {
  const toggle = document.getElementById("settingsAutoSyncToggle");
  if (!toggle) { return; }
  state.autoSync = !!toggle.checked;
  saveSettings();
  if (state.autoSync) { startAutoSync(); }
  else { stopAutoSync(); }
}

/* The versions input's change handler. A valid value is a whole
   number, truncated and clamped into 0 to 100 (so 150 saves as
   100 and a negative saves as 0), persisted at once, and
   confirmed in the feedback line. A blank or non numeric value
   never reaches the settings: the input is restored to the
   saved value and the feedback says why. Lowering the limit
   registers every loaded note for pruning at its next history
   maintenance (see versionHistoryPruneNeeded in the version
   history section); nothing crawls Drive from here. */
function applyVersionsLimitFromInput() {
  const input = document.getElementById("settingsVersionsInput");
  if (!input) { return; }
  const raw = String(input.value || "").trim();
  const parsed = raw === "" ? NaN : Number(raw);
  if (!Number.isFinite(parsed)) {
    input.value = String(currentVersionsLimit());
    setVersionsFeedback("That was not a whole number from 0 to 100, " +
      "so the saved setting was restored.");
    return;
  }
  const previousLimit = currentVersionsLimit();
  const nextLimit = Math.max(0, Math.min(100, Math.trunc(parsed)));
  state.versionsLimit = nextLimit;
  input.value = String(nextLimit);
  saveSettings();
  if (nextLimit < previousLimit) {
    [state.notes, state.trash, state.archive].forEach(function (list) {
      (list || []).forEach(function (note) {
        versionHistoryPruneNeeded.add(note.id);
      });
    });
  }
  setVersionsFeedback("Saved. " + versionsLimitFeedback(nextLimit));
}

/* --------------------------------------------------------------------------
   v2.13: the first run walkthrough, and the Settings Getting
   started actions

   The walkthrough is a five step tour in the onboarding modal.
   It opens on its own in exactly one situation: connectAndLoad
   calls openOnboarding when the store was seeded during that
   boot, which is to say for a brand new user. Nothing else opens
   it uninvited: not a missing or false onboardingSeen flag (an
   upgraded store has exactly that, and must never be surprised),
   and not a returning boot over a seeded store. Finishing,
   skipping, or dismissing the tour records the flag through
   saveSettings, so the state is explicit.

   The Settings Getting started section replays the tour on any
   store (in replay the last step's button reads Done and simply
   closes), and adds the starter note on any store: when a live
   note already carries the starter title it is opened instead of
   duplicated ("live" means in the notes list; a copy resting in
   Trash or the Archive does not count, which is what makes the
   button useful after the note was thrown away).
   -------------------------------------------------------------------------- */
const ONBOARDING_STEPS = [
  {
    title: "Welcome to SnakeScale Notes",
    lines: [
      "Your notes live in your own Google Drive, in a folder the app " +
        "creates for you. They are never stored on a SnakeScale Notes server.",
      "The developer cannot see your notes, and your Google sign in is " +
        "the only account you need."
    ]
  },
  {
    title: "Notebooks and notes",
    lines: [
      "Organize with notebooks in the sidebar, and create a note with " +
        "the New Note button.",
      "Drag notes between notebooks to reorganize, and pin the " +
        "important ones so they stay at the top."
    ]
  },
  {
    title: "Write and format",
    lines: [
      "The toolbar gives you headings, lists and checklists, tables, " +
        "and attachments.",
      "Images get their own three dot menu inside a note: edit and " +
        "annotate them, add captions, or transcribe the words in a " +
        "picture."
    ]
  },
  {
    title: "Connect your notes",
    lines: [
      "Link notes together with Insert, then Link to Note, or just " +
        "type @ as you write and pick a note.",
      "Web links can become rich Mention and Preview cards that show " +
        "the page's real title and picture."
    ]
  },
  {
    title: "Your data, your history",
    lines: [
      "The app works offline and syncs when you are back. Nothing is " +
        "lost if your connection drops.",
      "Settings holds appearance, a connection refresh, and how many " +
        "past versions of each note to keep. The History button on a " +
        "note previews and restores those versions."
    ]
  }
];
let onboardingStepIndex = 0;
let onboardingReplayMode = false;
let onboardingStarterId = null;

/* Push the current step into the modal: its title, its lines as
   plain paragraphs (text only, so tour copy can never become
   markup), the position dots with the current one filled, and the
   foot buttons for this step (Back hidden on the first step, Skip
   hidden on the last, and the primary button's label). */
function renderOnboardingStep() {
  const step = ONBOARDING_STEPS[onboardingStepIndex];
  const title = document.getElementById("onboardingTitle");
  if (title) { title.textContent = step.title; }
  const body = document.getElementById("onboardingBody");
  if (body) {
    body.innerHTML = "";
    step.lines.forEach(function (line) {
      const p = document.createElement("p");
      p.textContent = line;
      body.appendChild(p);
    });
  }
  const dots = document.getElementById("onboardingDots");
  if (dots) {
    dots.innerHTML = "";
    ONBOARDING_STEPS.forEach(function (s, i) {
      const d = document.createElement("span");
      if (i === onboardingStepIndex) { d.className = "current"; }
      dots.appendChild(d);
    });
  }
  const last = onboardingStepIndex === ONBOARDING_STEPS.length - 1;
  const back = document.getElementById("onboardingBackBtn");
  if (back) { back.classList.toggle("hidden", onboardingStepIndex === 0); }
  const skip = document.getElementById("onboardingSkipBtn");
  if (skip) { skip.classList.toggle("hidden", last); }
  const next = document.getElementById("onboardingNextBtn");
  if (next) {
    next.textContent = last
      ? (onboardingReplayMode ? "Done" : "Open your starter note")
      : "Next";
  }
}

function openOnboarding(replay, starterId) {
  onboardingReplayMode = !!replay;
  onboardingStarterId = starterId || null;
  onboardingStepIndex = 0;
  /* A modal opening puts the link bar away, like every other
     overlay in the app. */
  hideLinkBar();
  renderOnboardingStep();
  const modal = document.getElementById("onboardingModal");
  if (modal) { modal.classList.remove("hidden"); }
  const next = document.getElementById("onboardingNextBtn");
  if (next) { next.focus(); }
}

function closeOnboarding() {
  const modal = document.getElementById("onboardingModal");
  if (modal) { modal.classList.add("hidden"); }
}

/* Every way out of the tour (the final button, Skip, Escape, a
   backdrop click) lands here: the seen flag is recorded, so the
   state is explicit, and the modal closes. */
function finishOnboarding() {
  state.onboardingSeen = true;
  saveSettings();
  closeOnboarding();
}

function onboardingNext() {
  if (onboardingStepIndex < ONBOARDING_STEPS.length - 1) {
    onboardingStepIndex += 1;
    renderOnboardingStep();
    return;
  }
  const starterId = onboardingStarterId;
  const replay = onboardingReplayMode;
  finishOnboarding();
  /* First run only: the tour ends by opening the starter note it
     has been describing (it is already the open note underneath;
     this keeps the promise of the button explicit). A replay
     simply ends. */
  if (!replay && starterId) { openNote(starterId); }
}

function onboardingBack() {
  if (onboardingStepIndex > 0) {
    onboardingStepIndex -= 1;
    renderOnboardingStep();
  }
}

/* The Settings Getting started section's second button. Follows
   createNoteInRepo's instant pattern exactly (state and cache
   first, render and open at once, the Drive write in the
   background with the same failure toast), carrying the shared
   starter content instead of a blank note. */
async function addStarterNoteFromSettings() {
  closeSettingsModal();
  const existing = state.notes.find(function (n) {
    return n.title === STARTER_NOTE_TITLE;
  });
  if (existing) {
    openNote(existing.id);
    toast("The starter note is already in your notes.");
    return existing;
  }
  if (!state.notebooks.length) {
    await createNotebook("Personal");
  }
  const slug = state.notebooks.some(function (nb) {
    return nb.slug === "personal";
  }) ? "personal" : state.notebooks[0].slug;
  const note = makeStarterNote(slug);
  /* v2.130: a newborn note, Doc-backed like every
     newborn note (markNoteDocBacked in store.js). The
     store seeder's starter note is the one exception:
     seeding writes through the neutral store layer
     before any Doc machinery can run, so the seeded
     starter keeps the file form it is written with. */
  markNoteDocBacked(note);
  state.notes.unshift(note);
  saveCache();
  renderAll();
  openNote(note.id);
  saveNoteToRepo(note, { skipConflictCheck: true, fresh: true })
    .then(function () {
      /* Persist the storage token the background write assigned,
         as createNoteInRepo does for its notes. */
      saveCache();
    })
    .catch(function (err) {
      toast("Starter note created locally; save failed: " + err.message, true);
    });
  return note;
}

/* --------------------------------------------------------------------------
   v2.8: the note History modal

   versionHistoryOpenNoteId names the note the modal is showing;
   it is captured at open time, so a background render can never
   quietly retarget the list at another note. The list renders
   from loadVersionHistory (the same safe load the save path
   uses): a damaged history shows an explanation and is left
   untouched, and with the setting at 0 the modal says history
   is off and offers no Restore (a restore preserves the current
   note as a version first, which a limit of 0 forbids).
   -------------------------------------------------------------------------- */
function versionHistoryNote() {
  if (!versionHistoryOpenNoteId) { return null; }
  return findNoteById(versionHistoryOpenNoteId);
}

function versionDateLabel(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) { return String(iso || "Unknown date"); }
  return d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function versionExcerpt(entry) {
  const text = htmlToText(entry.body || "");
  if (!text) { return "No body text."; }
  return text.length > 140 ? text.slice(0, 137) + "..." : text;
}

/* The content the editor currently shows for one note, read
   without mutating the note object. Restore compares it against
   the note object to learn whether there are unsaved edits to
   establish first; it mirrors collectEditor field for field. */
function editorContentSnapshot(note) {
  return {
    title: document.getElementById("noteTitle").value.trim() || "Untitled note",
    tags: document.getElementById("noteTags").value
      .split(",")
      .map(function (t) { return t.trim(); })
      .filter(function (t) { return t.length > 0; }),
    body: canonicalizeAttachmentPlaceholders(
      document.getElementById("noteBody").innerHTML),
    attachments: sanitizeAttachments(cloneVersionValue(note.attachments || []))
  };
}

async function openVersionHistory() {
  const note = currentNote();
  if (!note) {
    toast("Open a note first to see its history.", true);
    return;
  }
  const exportMenu = document.getElementById("exportMenu");
  if (exportMenu) { exportMenu.classList.add("hidden"); }
  /* v2.9: the History modal is an overlay like the export menu it
     already closes: the link bar goes away as it opens. */
  hideLinkBar();
  versionHistoryOpenNoteId = note.id;
  versionHistoryPreviewVersionId = null;
  const preview = document.getElementById("versionHistoryPreview");
  if (preview) { preview.innerHTML = ""; preview.classList.add("hidden"); }
  const list = document.getElementById("versionHistoryList");
  if (list) {
    list.innerHTML = "";
    const loading = document.createElement("div");
    loading.className = "version-empty";
    loading.textContent = "Loading history...";
    list.appendChild(loading);
  }
  const modal = document.getElementById("versionHistoryModal");
  if (modal) { modal.classList.remove("hidden"); }
  const closeBtn = document.getElementById("versionHistoryCloseBtn");
  if (closeBtn) { closeBtn.focus(); }
  await renderVersionHistory();
}

function closeVersionHistory() {
  const modal = document.getElementById("versionHistoryModal");
  if (modal) { modal.classList.add("hidden"); }
  versionHistoryOpenNoteId = null;
  versionHistoryPreviewVersionId = null;
  const preview = document.getElementById("versionHistoryPreview");
  if (preview) { preview.innerHTML = ""; preview.classList.add("hidden"); }
}

function versionHistoryEmpty(list, text) {
  const empty = document.createElement("div");
  empty.className = "version-empty";
  empty.textContent = text;
  list.appendChild(empty);
}

async function renderVersionHistory() {
  const note = versionHistoryNote();
  const list = document.getElementById("versionHistoryList");
  if (!note || !list) { return; }
  list.innerHTML = "";
  if (currentVersionsLimit() === 0) {
    versionHistoryEmpty(list,
      "Version history is off in Settings. Choose how many versions " +
      "to keep per note there to turn it back on.");
    return;
  }
  const loaded = await loadVersionHistory(note.id);
  if (!loaded.ok) {
    versionHistoryEmpty(list,
      "This note's version history could not be loaded safely, so it " +
      "was left unchanged. Saving the note still works; history " +
      "updates for it are paused until the history loads cleanly.");
    return;
  }
  if (!loaded.data.versions.length) {
    versionHistoryEmpty(list,
      "No versions yet. Versions appear after a previously saved note " +
      "is changed and saved again.");
    return;
  }
  loaded.data.versions.forEach(function (entry) {
    list.appendChild(buildVersionHistoryRow(note, entry));
  });
}

/* One history row: the snapshot date, its title, and a plain text
   excerpt, with Preview and Restore controls. On a locked note
   (Trash or Archive) Restore is disabled and the row says what
   to do first. */
function buildVersionHistoryRow(note, entry) {
  const row = document.createElement("div");
  row.className = "version-row";
  row.setAttribute("data-version-id", entry.id);

  const main = document.createElement("div");
  main.className = "version-row-main";
  const date = document.createElement("div");
  date.className = "version-date";
  date.textContent = versionDateLabel(entry.createdAt);
  main.appendChild(date);
  const title = document.createElement("div");
  title.className = "version-title";
  title.textContent = entry.title || "Untitled";
  main.appendChild(title);
  const excerpt = document.createElement("div");
  excerpt.className = "version-excerpt";
  excerpt.textContent = versionExcerpt(entry);
  main.appendChild(excerpt);
  if (note.trashed || note.archived) {
    const noteLine = document.createElement("div");
    noteLine.className = "version-restore-note";
    noteLine.textContent = note.trashed
      ? "Restore this note from Trash before restoring a version."
      : "Unarchive this note before restoring a version.";
    main.appendChild(noteLine);
  }
  row.appendChild(main);

  const actions = document.createElement("div");
  actions.className = "version-actions";
  const previewBtn = document.createElement("button");
  previewBtn.type = "button";
  previewBtn.className = "btn small";
  previewBtn.textContent = "Preview";
  previewBtn.addEventListener("click", function () {
    renderVersionPreview(entry);
  });
  actions.appendChild(previewBtn);
  const restoreBtn = document.createElement("button");
  restoreBtn.type = "button";
  restoreBtn.className = "btn small";
  restoreBtn.textContent = "Restore";
  restoreBtn.disabled = !!note.trashed || !!note.archived;
  if (restoreBtn.disabled) {
    restoreBtn.title = note.trashed
      ? "Restore this note from Trash first"
      : "Unarchive this note first";
  }
  restoreBtn.addEventListener("click", function () {
    restoreVersionFromHistory(entry.id).catch(function (err) {
      toast("Restore failed: " + err.message, true);
    });
  });
  actions.appendChild(restoreBtn);
  row.appendChild(actions);
  return row;
}

/* Render one version read only into the preview pane. The body
   is decorated from the VERSION's attachment records, never
   hydrated against the open note: placeholders become labeled
   cards (see decorateVersionPreviewBody), links lose their
   hrefs, form controls are disabled, and the pane's CSS turns
   pointer interaction off entirely, so previewing cannot
   navigate, mutate the note, create object URLs, or mark it
   dirty. */
function renderVersionPreview(entry) {
  const preview = document.getElementById("versionHistoryPreview");
  if (!preview) { return; }
  versionHistoryPreviewVersionId = entry.id;
  preview.innerHTML = "";
  const heading = document.createElement("h3");
  heading.textContent = entry.title || "Untitled";
  preview.appendChild(heading);
  const meta = document.createElement("div");
  meta.className = "version-preview-meta";
  meta.textContent = versionDateLabel(entry.createdAt) +
    (entry.tags && entry.tags.length
      ? "  Tags: " + entry.tags.join(", ") : "");
  preview.appendChild(meta);
  const body = document.createElement("div");
  body.className = "version-preview-body";
  body.innerHTML = entry.body || "";
  decorateVersionPreviewBody(body, entry);
  preview.appendChild(body);
  preview.classList.remove("hidden");
}

function decorateVersionPreviewBody(bodyEl, entry) {
  bodyEl.querySelectorAll("*").forEach(function (el) {
    el.removeAttribute("contenteditable");
    if (el.tagName === "A") {
      el.removeAttribute("href");
      el.setAttribute("aria-disabled", "true");
    }
    if (el.tagName === "INPUT" || el.tagName === "BUTTON" ||
        el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
      el.disabled = true;
    }
    if (el.tagName === "INPUT" && el.type === "checkbox") {
      const li = el.closest("li");
      el.checked = !!(li && li.classList.contains("done"));
    }
  });
  bodyEl.querySelectorAll(".ss-attachment").forEach(function (el) {
    const attId = el.getAttribute("data-attachment-id");
    const att = (entry.attachments || []).find(function (a) {
      return a.id === attId;
    });
    el.innerHTML = "";
    el.removeAttribute("style");
    el.setAttribute("class", "ss-attachment version-att-card");
    el.setAttribute("contenteditable", "false");
    const name = document.createElement("div");
    name.className = "version-att-name";
    name.textContent = att ? att.name
      : "Attachment details are missing from this version.";
    el.appendChild(name);
    const meta = document.createElement("div");
    meta.className = "version-att-meta";
    meta.textContent = att
      ? (isImageAttachment(att) ? "Image: " : "File: ") +
        (att.mime || "unknown type") + ", " + humanSize(att.size)
      : "The referenced file is not listed in this version.";
    el.appendChild(meta);
  });
}

/* Restore one version, serialized through the note's operation
   chain like every other storage operation on the note. The
   worker (restoreVersionNow) does the steps in order; this
   wrapper owns the confirmation, whose text states the promise
   the flow keeps: the current note is preserved as a new
   version first. */
async function restoreVersionFromHistory(versionId) {
  const note = versionHistoryNote();
  if (!note) { return; }
  if (note.trashed || note.archived) {
    toast(note.trashed
      ? "Restore this note from Trash before restoring a version."
      : "Unarchive this note before restoring a version.", true);
    return;
  }
  if (currentVersionsLimit() === 0) {
    toast("Version history is off in Settings, so versions cannot " +
      "be restored.", true);
    return;
  }
  const ok = confirm("Restore this version of \"" +
    (note.title || "Untitled note") + "\"? Your current note will be " +
    "preserved as a new version first, so this restore can itself " +
    "be undone from History.");
  if (!ok) { return; }
  await chainNoteOp(note, function () {
    return restoreVersionNow(note, versionId);
  });
}

async function restoreVersionNow(note, versionId) {
  /* Step 1: establish "current". If the editor shows unsaved
     edits for this note, collect and persist them through the
     normal save worker first (this call is already inside the
     note's chain, so it calls the worker, not the chaining
     wrapper). A conflict here stops the restore: the user's
     current text was kept as a conflict copy, and guessing which
     text to preserve would risk losing some of it. */
  let preSaveResult = null;
  if (renderEditor._forId === note.id && !note.trashed && !note.archived) {
    const editorContent = editorContentSnapshot(note);
    if (!versionContentEqual(editorContent, noteContentSnapshot(note))) {
      collectEditor(note);
      preSaveResult = await saveNoteToRepoNow(note);
      if (preSaveResult && preSaveResult.conflict) {
        toast("Your current edits were saved as a conflict copy, so " +
          "the restore was stopped and nothing was replaced.", true);
        return;
      }
      if (preSaveResult && preSaveResult.paused) {
        /* v2.17.1: the note is diverged and its saves are
           paused, so "current" cannot be established; stop the
           same way a conflict stops it. */
        toast("This note changed elsewhere and its saving is paused, " +
          "so the restore was stopped. Reload the note, then restore.", true);
        return;
      }
    }
  }
  /* Step 2: load the history safely, and find the version. */
  const loaded = await loadVersionHistory(note.id);
  if (!loaded.ok) {
    toast("This note's version history could not be loaded safely, " +
      "so nothing was restored.", true);
    return;
  }
  const entry = loaded.data.versions.find(function (v) {
    return v.id === versionId;
  });
  if (!entry) {
    toast("That version is no longer available.", true);
    return;
  }
  const selected = {
    title: entry.title,
    body: entry.body,
    tags: entry.tags.slice(),
    attachments: cloneVersionValue(entry.attachments)
  };
  const currentSaved = lastSavedContentByNoteId[note.id]
    ? cloneVersionValue(lastSavedContentByNoteId[note.id])
    : noteContentSnapshot(note);
  /* Already current is a clean no op: no snapshot, no save, no
     timestamp churn. */
  if (versionContentEqual(currentSaved, selected)) {
    toast("That version already matches the current note.");
    return;
  }
  /* Step 3: preserve the current saved state as a forced newest
     snapshot, bypassing the coalescing window. If it cannot be
     preserved, the restore stops rather than replacing text the
     user could not get back. */
  const forced = await maintainVersionHistory(note.id, currentSaved, {
    forceSnapshot: true,
    contentChanged: true,
    notePath: notePath(note)
  });
  if (forced.status === "skipped-load" || forced.status === "skipped-conflict" ||
      forced.status === "write-failed" || forced.status === "delete-failed") {
    toast("The current note could not be preserved as a version, so " +
      "nothing was restored.", true);
    return;
  }
  versionHistoryPruneNeeded.delete(note.id);
  /* Steps 4 and 5: apply the version and save it through the
     normal worker, with ordinary version capture suppressed so
     the save does not snapshot the pre restore state a second
     time (step 3 already did, deliberately). The worker updates
     the note's updated timestamp and its baseline. */
  note.title = selected.title;
  note.body = selected.body;
  note.tags = selected.tags.slice();
  note.attachments = cloneVersionValue(selected.attachments);
  let result;
  try {
    result = await saveNoteToRepoNow(note, { suppressVersionCapture: true });
  } catch (err) {
    toast("Restore failed: " + err.message, true);
    renderAll();
    return;
  }
  if (result && result.conflict) {
    toast("The restore ran into a storage conflict, so it was saved " +
      "as a conflict copy instead of replacing the note.", true);
    renderAll();
    return;
  }
  if (result && result.paused) {
    /* v2.17.1: a diverged note's save pauses, so the version was
       not applied to the store; say so rather than claiming a
       restore that never landed. */
    toast("This note changed elsewhere and its saving is paused, " +
      "so nothing was restored. Reload the note, then restore.", true);
    renderAll();
    return;
  }
  /* Step 6: refresh everything the restore touched. Clearing the
     render marker makes renderEditor refill the editor from the
     restored note, and its normal open pass rehydrates the
     restored attachment records. */
  saveCache();
  renderEditor._forId = null;
  renderAll();
  closeVersionHistory();
  toast(result && result.queued
    ? "Version restored. It will sync when the connection returns."
    : "Version restored.");
}

function setSaveState(text) {
  document.getElementById("saveState").textContent = text;
  /* v2.5: the same text is mirrored into the rail flyout's status
     line, the save status's visible home while the sidebar is
     collapsed to the icon rail. One writer, two homes. */
  const railSave = document.getElementById("railSaveState");
  if (railSave) { railSave.textContent = text; }
  /* v2.57: the same wording also drives the floating save
     pill (renderSavePill, next below). The span the first
     line writes lives inside the pill now, so this stays
     the one writer for every home the status has, and the
     pill can never read anything the machinery did not
     say. */
  renderSavePill(text);
}

/* ------------------------------------------------------------------
   v2.57: the save pill. Through v2.56.0 the save status's
   visible home was a line in the sidebar footer, and
   Chris's report was that he could not see when the app
   was saving without scrolling the sidebar to find it
   (in the icon rail layout it is not on screen at all).
   The status therefore also renders as a floating pill
   (the save pill markup inside #app, styled beside the
   toast box), visible from every view and gone at rest.

   setSaveState stays the one writer: it writes the
   wording into the pill's own span and the rail mirror
   exactly as before, and renderSavePill decides what
   the pill does with the wording. The classification
   keys off the wording itself, so every caller, present
   and future, inherits it:

     saving: "Unsaved changes..." and "Saving...". The
       edits exist or the write is in flight. The pill
       shows while either is the latest wording; only a
       later wording supersedes it, never a timer.
     saved: "Saved" and "Saved <time>". The machinery
       settled. The pill shows for a short linger, so a
       save Chris was watching visibly completes, and
       then fades out. A new wording during the linger
       cancels the fade, which is what makes a burst of
       saves one continuous pill with no flicker.
     warn and bad (the sticky tones): "Offline: changes
       queued", "Saving paused: this note changed
       elsewhere", and "Conflict saved as a copy" (warn,
       amber), and "Save failed" (bad, red). A standing
       problem is not a flash: the pill stays until a
       later wording supersedes it or Chris taps it
       away, and a dismissed wording stays dismissed
       until the wording changes. The conflict wording
       is normally superseded within the same pass by
       the preserved copy's own opening "Saved", exactly
       as the footer behaved; it is classified sticky
       because, if it ever stood alone, it must not fade.
     rest: everything else, today "No changes", "In
       Trash", and "Archived". Those wordings say where
       a note lives or that nothing has happened yet,
       not that a save is running or stuck; the
       breadcrumb and the locked editor already name a
       locked note's home. The pill renders nothing,
       and the rail mirror still carries the wording,
       as it always has.

   The pill is deliberately not a live region. The
   footer line was plain text, and the pill keeps that
   exact presence (its span is the same save status
   text) instead of announcing every autosave.
   ------------------------------------------------------------------ */
const SAVE_PILL_LINGER_MS = 1500;
const SAVE_PILL_FADE_MS = 280;
let savePillLingerTimer = null;
let savePillFadeTimer = null;
let savePillWording = "";
let savePillDismissedWording = null;

/* The tone a save state wording belongs to (see the
   v2.57 block above). Exact wordings first: "Saving
   paused..." must never fall into the saved prefix
   test, and the saved test itself is the app's own
   "Saved" plus the timestamped form the autosave
   writes. */
function saveStateTone(text) {
  if (text === "Saving..." || text === "Unsaved changes...") {
    return "saving";
  }
  if (text === "Save failed") { return "bad"; }
  if (text === "Offline: changes queued" ||
      text === "Saving paused: this note changed elsewhere" ||
      text === "Conflict saved as a copy") {
    return "warn";
  }
  if (text === "Saved" || text.indexOf("Saved ") === 0) {
    return "saved";
  }
  return "rest";
}

function renderSavePill(text) {
  const pill = document.getElementById("savePill");
  if (!pill) { return; }
  /* Every wording restarts the pill's clocks: a fade
     scheduled by an earlier Saved must never hide a
     state that has already moved on. */
  if (savePillLingerTimer !== null) {
    clearTimeout(savePillLingerTimer);
    savePillLingerTimer = null;
  }
  if (savePillFadeTimer !== null) {
    clearTimeout(savePillFadeTimer);
    savePillFadeTimer = null;
  }
  /* A dismissal belongs to its wording: any different
     wording clears it, so the next problem always
     shows. */
  if (text !== savePillWording) { savePillDismissedWording = null; }
  savePillWording = text;
  const tone = saveStateTone(text);
  if (tone === "rest" || text === savePillDismissedWording) {
    pill.classList.remove("fading");
    pill.classList.add("hidden");
    pill.setAttribute("data-state", "off");
    pill.removeAttribute("title");
    return;
  }
  pill.setAttribute("data-state", tone);
  pill.classList.remove("fading");
  pill.classList.remove("hidden");
  if (tone === "warn" || tone === "bad") {
    pill.title = "Dismiss";
  } else {
    pill.removeAttribute("title");
  }
  if (tone === "saved") {
    savePillLingerTimer = setTimeout(function () {
      savePillLingerTimer = null;
      /* Fade first, hide after: the fade is opacity
         only, and the hide lands at its end. A wording
         arriving mid fade cleared this timer on its way
         in, so the pill can never pop out from under a
         newer state. */
      pill.classList.add("fading");
      savePillFadeTimer = setTimeout(function () {
        savePillFadeTimer = null;
        pill.classList.add("hidden");
        pill.classList.remove("fading");
        pill.setAttribute("data-state", "off");
      }, SAVE_PILL_FADE_MS);
    }, SAVE_PILL_LINGER_MS);
  }
}

/* A tap dismisses a sticky pill's wording until the
   wording changes (see renderSavePill). The transient
   tones take no pointer events, so a click can only
   ever arrive from a sticky pill; the tone test is the
   second lock. */
function dismissSavePill() {
  const pill = document.getElementById("savePill");
  if (!pill) { return; }
  const tone = pill.getAttribute("data-state");
  if (tone !== "warn" && tone !== "bad") { return; }
  savePillDismissedWording = savePillWording;
  pill.classList.add("hidden");
  pill.setAttribute("data-state", "off");
  pill.removeAttribute("title");
}

/* Mobile pane switching. Desktop CSS ignores these classes. */
function setMobileView(which) {
  if (window.innerWidth > 900) { return; }
  document.body.classList.remove("view-nav", "view-list", "view-editor");
  document.body.classList.add("view-" + which);
  /* v2.68.0: showing the list side is also the moment the
     Home pane becomes displayed on the phone (its own
     render packed too early, while the pane was still
     display none under the editor's body class, and no
     size observer is armed before the first successful
     pack). Queue the pack for the next frame, when the
     pane has its real width: it places the widgets and,
     on the first run, releases the Home hold. */
  if (which === "list" && state.view && state.view.kind === "home") {
    queueHomePack();
  }
}

