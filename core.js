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

/* ============================================================================
   SnakeScale Notes v2.9.0: application script
   BUILD STAMP: 2026-10-20-SSN-V290

   How this script is organized:
     1. Constants and global state
     2. Small utilities (escaping, base64 with UTF-8 safety, ids, slugs)
     3. The logo (inline SVG, injected into every .logo-slot)
     4. The device key (the local encryption key: WebCrypto AES-GCM)
     5. Settings, local cache, and the offline edit queue (localStorage)
     6. The store dispatch layer over the Google Drive notes driver
        (the driver itself lives with the Google code in section 11)
     7. Note file format: front matter parse and serialize
     8. Sync engine: load everything, save with conflict protection,
        notebooks, trash, and the index.json rebuild
     9. Rendering: sidebar, tags, note list, editor
    10. Editor behavior: toolbar, checklists, autosave, note links,
        export, and import
    11. Attachments: the Google Drive provider, upload flow,
        placeholder hydration, and removal
    12. Screen flow and event wiring, then boot

   Note body storage note (v1.0 decision): the editor is rich text, so the
   body of each .md file is stored as HTML below the front matter block. The
   file is still a plain text .md file in the user's own Google Drive, the
   front matter is plain key and value lines, and the HTML body keeps
   checklists and formatting intact. A future version can add a Markdown
   export without changing the storage layout.
   ========================================================================== */

/* --------------------------------------------------------------------------
   1. Constants and global state
   -------------------------------------------------------------------------- */
/* 2.112.0 (2026-11-04): a sync keeps the
   reader's place (Chris: "When syncing and using
   Sync Now, the whole app refreshes and I end up
   losing my place... the whole app shouldn't
   refresh like I pressed F5."). syncNow never
   reloaded the page; it flushes, loads, and
   renders everything, and the render rebuilt
   every surface. Whether a rebuilt scroller kept
   its offset was the browser's clamp behavior,
   and the notes list lost the place outright when
   the load changed its membership above the
   reader's card: the numeric offset survived
   while the content slid under it. syncNow now
   brackets its render with captureSyncPlace and
   restoreSyncPlace. The list is anchored to the
   card at its viewport's top (falling back to the
   captured number when that card is gone), the
   open note's scroll and caret ride
   restoreEditorViewState under a same-note guard,
   and the Home, Tasks, and Email list scrollers
   keep their numeric offsets; the scroll restore
   runs again on the next frame for surfaces whose
   layout settles late, the caret only in the
   render pass. Nothing else in the sync changes:
   the flush order, the load, the conflict
   decisions, the drop box, and the calendar and
   mail refresh calls stand as they were. */
/* 2.111.0 (2026-11-04): the Tab refinement
   (Chris's correction on v2.110.0, device tested:
   "It should only indent the list line if the
   cursor is at the beginning. Any other time it
   should just function as a tab."). Tab and
   Shift+Tab now belong to a list item only at the
   very beginning of its own text, which is also
   Word's rule: Word demotes only at a paragraph's
   start. A new probe, caretAtListItemTextStart,
   reads the fragment of the item standing before
   the caret: the checklist checkbox, stray source
   whitespace, and the item's sub-lists do not cost
   the caret its beginning; a real character, a
   media element, or a tab character itself does,
   so a caret behind an inserted tab is not at the
   beginning. With the caret anywhere else in the
   item, Tab inserts a tab character through
   insertTabAtRange, the plain paragraph path's
   own mechanism, so a list item's tab is the same
   span.ss-tab a paragraph's is, in the editor and
   in the saved file; Shift+Tab there does nothing
   but keep the key in the note, so focus never
   escapes and no level changes mid line. A
   selection spanning several items still demotes
   and promotes them all, wherever it starts; a
   selection inside one item now takes the single
   block behavior, exactly like a paragraph
   selection. Everything else is unchanged: the
   v2.110.0 demote and promote machinery (the
   level wrapper, the nine level ceiling, the
   marker cycle), Tab in table cells and code
   blocks, and the multi block tab prefix. */
/* 2.110.0 (2026-11-04): lists take Word's Tab
   model (Chris's report: Tab did nothing on the
   first line of a list no matter where the caret
   stood, and an item that headed its own sub-list
   stalled after one press). Tab now demotes the
   caret's item one level with the caret anywhere
   in it, in ordered, unordered, and checklist
   lists alike, and Shift+Tab promotes it, as many
   times as he presses, up to Word's ninth level;
   the depth marker cycle is spelled out to the
   ninth level in the editor and print stylesheets
   alike, and every level takes the same 24 pixel
   step. The first item of a list, and any item
   heading its sub-list, used to have no item
   above it to nest under, so Tab was a swallowed
   no-op there; those items now demote through a
   markerless wrapper (li.ss-level-pad,
   display:contents): an empty host that renders
   no marker, consumes no number in an ordered
   list, and takes no line of its own, holding
   the sub-list the item moves into. Promoting
   back out of it removes the wrapper, so the
   round trip restores the exact structure. A
   selection spanning several items still moves
   them together, and Tab outside lists is
   untouched: table cells still navigate, code
   blocks still indent, plain paragraphs still
   take a tab character. The text and Word
   exporters walk through a wrapper without
   giving it a line or a number of its own. */
/* 2.109.0 (2026-11-04): the Editor takes the
   Testing Checklist bundle, six items. Tab on a
   checklist line now indents by a full list level
   per press, the same 24 pixel step a bullet or
   numbered sublist takes, instead of the 2 pixel
   inset nested checklists had; the box itself
   never toggles from the keyboard, and Shift+Tab
   promotes one level per press. Checking a box no
   longer makes the note jump to wherever the
   caret last stood: the toggle handler's caret
   restore used to refocus the body bare, which
   scrolled the editor to the old selection, so
   it now focuses without scrolling and restores
   the editor's scroll position outright, while
   typing after a click still lands in the item.
   Clear Formatting also takes links now: the
   words stay and the link itself goes, the way
   Word clears them, while app-managed anchors
   (note links, mail and event chips, tag pills)
   are content rather than formatting and stand,
   and a decorated link unwraps to exactly the
   words the author wrote. The editor's right
   click menu gains a Format submenu (Bold,
   Italic, Underline, Strikethrough, and Clear
   Formatting) acting on the preserved selection
   exactly like the toolbar buttons, with the
   formats the selection already carries marked.
   Archived and trashed notes, which are read
   only, no longer render the formatting toolbar,
   and archived notes no longer appear in the @
   link picker. A floating Back to top button
   stands at a long note's lower right once the
   note is scrolled past a screenful,
   semi-transparent until hovered or pressed, and
   returns the reader smoothly to the top. */
/* 2.108.0 (2026-11-04): the save search menu's
   washed out text in light mode is fixed at the
   root. The panel's secondary lines (its head, the
   query under a saved search's name, the empty
   note, and the three dot buttons) name a muted
   text token that, like text-strong in v2.59, was
   referenced but never defined, so they inherited
   the sidebar's pale color on the panel's white
   card. The token is defined now in both themes:
   the ink itself in light mode, per Chris's call
   that the menu's text there is black, and the
   dark muted tone in dark mode. The same two
   definitions also heal the token's other users,
   audited first: the templates gallery's group
   titles, previews, menu buttons, and empty note,
   and the tag parent panel's head, every one on a
   themed surface card like the saved search
   panel's. No rule's text changed. */
/* The Drive folder that holds the complete notes layout: notebook
   folders, trash, archive, index.json, and (since v2.0) the
   attachments subfolder. */

const NOTES_ROOT_NAME = "SnakeScale Notes";
/* v2.0 legacy cleanup: builds before v2.0 kept the GitHub token in an
   app password vault under this localStorage key (and v1.4 wrote a
   fixed marker vault there for Google users). No vault exists in
   v2.0; the key is named only so boot can delete the obsolete
   record. See cleanupLegacyStorage in section 5. */
const LS_LEGACY_VAULT = "snakescale.vault.v1";

/* localStorage keys. */
const LS_CACHE = "snakescale.cache.v1";
const LS_QUEUE = "snakescale.queue.v1";
const LS_SETTINGS = "snakescale.settings.v1";
const LS_EDITOR_VIEW = "snakescale.editorView.v1";   // v2.72: per note editor view states
/* The device key. This random AES-GCM key is kept on this device so
   it can encrypt the Google token store and the local note cache at
   rest across reloads. It is not a credential and it is not a login:
   anyone using the unlocked browser profile can still use the app,
   so the key only scrambles local copies against casual snooping. */
const LS_DEVICE_KEY = "snakescale.deviceKey.v1";
/* Provider OAuth tokens (in v2.0, just the Google token), AES-GCM
   encrypted under the device key (see section 11). Only ciphertext
   lives here. */
const LS_PROVIDERS = "snakescale.providerTokens.v1";
/* v2.79.0: the ssnotes-auth Worker session token, AES-GCM
   encrypted under the same device key and held to the same
   standard as the provider tokens above (see the Worker
   sign in block in section 11). Only ciphertext lives
   here. The session is the app's credential for asking the
   Worker for fresh Google access tokens; it lasts 30 days
   server side, and the client learns it has died only from
   the Worker's 401 answers, never from a local clock. */
const LS_WORKER_SESSION = "snakescale.workerSession.v1";
/* Attachment constants. ATTACH_ROOT_NAME is the pre-v2.0 top level
   attachments folder name. v2.0 creates no such folder; the name is
   kept only so the one time consolidation can find the legacy
   folder and move its files into the notes folder (see
   maybeConsolidateLegacyAttachments in section 11). New attachments
   live in the ATTACH_SUBFOLDER_NAME subfolder of the notes root. */
const ATTACH_ROOT_NAME = "SnakeScale Notes Attachments";
const ATTACH_SUBFOLDER_NAME = "attachments";
const ATTACH_MAX_BYTES = 100 * 1024 * 1024; /* 100 MB per file cap */
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
/* v2.79.0: there is no Google client ID in the app anymore.
   Through v2.78.0 the publisher's public client ID shipped
   here for the browser token flow; that flow is retired.
   Sign in now runs through the ssnotes-auth Cloudflare
   Worker (see the Worker sign in block in section 11),
   whose own Google client and secret never leave it. */

/* The in-memory app state. The Google access token lives ONLY in
   state.providerTokens.google while the app is signed in; signing
   out sets it back to null. There is no app password and no second
   token of any kind. */
const state = {
  sessionKey: null,         // Encryption CryptoKey in memory: the device
                            // key from section 4, loaded or created at
                            // sign in and dropped on sign out
  providerTokens: { google: null }, // plaintext Google token, memory only
  objectUrls: [],           // v1.2: blob URLs created for the open note,
                            // revoked on note switch and sign out
  attach: {                 // v1.2: attachment config, NOT secret, saved
                            // in settings
    defaultProvider: "google", // v2.0: Google is the only provider. The
                            // field remains so older settings load into
                            // a known shape; loadSettings pins any other
                            // stored value back to "google"
    googleClientId: "",
    googleFolderId: null,   // the attachments subfolder of the notes root
    googleExpiresAt: 0,
    googleRenewalFailure: null, // v2.24.6: the last automatic
                            // renewal failure, {type, at} or
                            // null. Written by the renewal
                            // block, cleared by the next
                            // successful connect, shown as one
                            // muted line in the sidebar menu
                            // while it stands.
    legacyConsolidated: false // v2.0: true once the one time move of
                            // pre-v2.0 attachments into the notes folder
                            // has run on this device profile
  },
  repoExists: false,        // true after the Drive store is ready
  notebooks: [],            // [{slug, name, created, stack?, parent?}]
                            // v2.29: the optional stack is the
                            // NAME of the notebook's stack, or
                            // absent when ungrouped; it lives
                            // only in index.json.
                            // v2.63: the optional parent is
                            // the SLUG of the notebook's
                            // parent notebook, or absent at
                            // top level; it lives only in
                            // index.json too (see
                            // sanitizeNotebookParents).
  notes: [],                // note objects, see parseNoteFile for the shape
  trash: [],                // note objects with trashed = true
  archive: [],              // v1.5: note objects with archived = true
  index: null,              // parsed index.json contents, or null
  view: { kind: "all", value: null }, // all | home | tasks | pinned | trash | archive | notebook | tag
  selectedId: null,         // id of the note open in the editor
  search: "",               // current search text, lowercased
  listFilters: {            // v1.8: notes list filters, session only.
    tags: [],                 // tag names a note must ALL carry
    createdFrom: "",          // "YYYY-MM-DD" or "" for open ended
    createdTo: "",
    updatedFrom: "",
    updatedTo: ""
  },
  listSort: {               // v1.8: notes list sort, remembered in settings
    field: "updated",         // title | created | updated
    dir: "desc"               // asc | desc; default matches the pre-v1.8 order
  },
  sidebarRail: false,       // v2.5: the sidebar's icon rail mode,
                            // remembered in settings, default full.
                            // Applied as body.rail; at widths of
                            // 900px and under it has no effect.
  collapsedStacks: [],      // v2.29: the names of the notebook
                            // stacks whose sidebar group is
                            // collapsed, remembered in settings.
                            // A stack that is not named here is
                            // expanded; the list is pruned of
                            // names no stack carries whenever
                            // it is written, so a deleted or
                            // renamed stack leaves nothing
                            // behind.
  collapsedTags: [],        // v2.30: the names of the tags whose
                            // sidebar subtree is collapsed,
                            // remembered in settings like the
                            // stack folds. A tag not named here
                            // is expanded; the list is pruned of
                            // tags that no longer have sub-tags
                            // whenever it is written.
  collapsedSections: [],    // v2.62: the sidebar sections
                            // ("shortcuts", "notebooks",
                            // "tags") whose body is folded
                            // under its header, remembered
                            // in settings like the stack
                            // and tag folds. It lives in
                            // settings, NOT in index.json
                            // (see buildIndexObject), for
                            // the mirror reason the tag
                            // parent map lives there: a
                            // fold is one device's view,
                            // and a section another device
                            // folded must not arrive
                            // folded here. A section not
                            // named here is expanded.
  collapsedNotebooks: [],   // v2.63: the slugs of the notebooks
                            // whose sub-notebook subtree is
                            // folded in the sidebar, remembered
                            // in settings like the stack and
                            // tag folds. A notebook not named
                            // here is expanded; the list is
                            // pruned of notebooks that no
                            // longer have sub-notebooks
                            // whenever it is written.
  tagParents: {},           // v2.30: the nested tag hierarchy as
                            // a map from tag name to parent tag
                            // name. Notes keep flat tag strings;
                            // this map is organization only. It
                            // lives in index.json (see
                            // buildIndexObject), NOT in settings,
                            // because settings are one device's
                            // local storage while index.json is
                            // the Drive synced store, and a
                            // hierarchy only one device could
                            // see would not be a hierarchy. A
                            // tag with no entry here is a top
                            // level tag.
  shortcuts: [],            // v2.31: the sidebar Shortcuts list,
                            // an ordered array of {kind, id}
                            // entries (kind: note, notebook,
                            // stack, tag, or, since v2.32,
                            // search; id: the note id,
                            // the notebook slug, the stack
                            // name, the tag name, or the saved
                            // search's id). It lives
                            // in index.json (see
                            // buildIndexObject), NOT in
                            // settings, for the same reason
                            // the tag parent map does: Evernote
                            // shortcuts sync across devices,
                            // and a list only one device could
                            // see would not be a shortcut list.
                            // Order is the order shortcuts
                            // were added in; labels are never
                            // stored, they are read from the
                            // target at render time.
  savedSearches: [],        // v2.32: the saved searches, an
                            // ordered array of {id, name,
                            // query} entries; the query is
                            // the search text itself, in
                            // the grammar the search box
                            // speaks. It lives in index.json
                            // (see buildIndexObject), NOT in
                            // settings, for the same reason
                            // the shortcuts list does:
                            // Evernote saved searches sync
                            // across devices, and a list
                            // only one device could see
                            // would not be a saved search
                            // list.
  home: {                   // v2.33: the Home dashboard's
                            // facts: the pinned note's id (or
                            // null), the scratch pad's text,
                            // and the widget layout (an
                            // ordered list of widget entries;
                            // a widget absent from the list
                            // is hidden, and the filtered
                            // entry carries the saved search
                            // it is bound to). It lives in
                            // index.json (see
                            // buildIndexObject), NOT in
                            // settings, for the same reason
                            // the saved searches do: Evernote
                            // Home and its customization
                            // sync across devices, and a
                            // dashboard only one device
                            // could see would not be a
                            // dashboard.
    scratch: "",
    emailIntroduced: true,  // v2.86: born with the
                            // Email widget already
                            // introduced (see
                            // sanitizeHome); the
                            // literal's layout below
                            // carries the widget.
    scratchHeight: null,    // v2.60: the scratch pad's
                            // remembered height in whole
                            // pixels (see sanitizeHome);
                            // null is no remembered
                            // height, the default size.
    widgets: [
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
    ]
  },
  templates: [],            // v2.38: the user's own note
                            // templates, an ordered array of
                            // {id, name, title, body,
                            // created, updated} snapshots
                            // saved from notes through Save
                            // as Template. They live in
                            // index.json (see
                            // buildIndexObject), NOT in
                            // settings, for the same reason
                            // the saved searches do:
                            // Evernote's saved templates
                            // sync across devices, and a
                            // template list only one device
                            // could see would not be a
                            // template list. The built in
                            // gallery templates are code,
                            // not data, and never appear
                            // here.
  startView: "home",        // v2.33: where a returning boot
                            // lands: "home" (the Home
                            // dashboard) or "notes" (the
                            // notes list). Evernote's own
                            // start choice (When opening
                            // Evernote) is per device, so
                            // this one is remembered in
                            // settings and edited in the
                            // Settings modal; it is NOT
                            // part of the synced home field.
  defaultNotebook: "",      // v2.72: the default notebook's
                            // slug, or "" for no default.
                            // Creations that name no
                            // notebook file here (see
                            // fallbackNotebookSlug);
                            // Evernote's own default
                            // notebook choice is per
                            // device too, so this one is
                            // remembered in settings and
                            // edited in the Settings
                            // modal, NOT in the synced
                            // index.
  versionsLimit: 10,        // v2.8: how many past versions to keep
                            // per note (0 turns version history
                            // off), remembered in settings and
                            // edited in the Settings modal.
  onboardingSeen: false,    // v2.13: true once the first run
                            // walkthrough has been finished, skipped,
                            // or dismissed on this device. Recorded
                            // for explicitness only: the walkthrough
                            // itself is triggered by a store being
                            // seeded during the boot, never by this
                            // flag being absent, so an existing or
                            // upgraded store can never spring it.
  autoSync: true,           // v2.16: idle auto-sync on Drive
                            // changes, remembered in settings and
                            // edited by the Settings Connection
                            // toggle. On unless a stored settings
                            // record explicitly says false; see
                            // the auto-sync block for the engine.
  defaultPasteMode: "source", // v2.23: which rendering a rich
                            // paste lands in ("source", "merge",
                            // or "text"), remembered in settings
                            // and edited by the Settings Editor
                            // section's Default paste select; see
                            // the paste options block.
  customHighlightColor: "#fff3a3", // v2.24.2: the highlight
                            // palette's remembered Custom color
                            // (the input's shipped default),
                            // remembered in settings, seeded
                            // into the picker when the toolbar
                            // is wired; see the custom color
                            // flow in the colors code.
  customTextColor: "#14532d", // v2.24.2: the text palette's
                            // remembered Custom color, with
                            // the same treatment as above.
  tasks: [],                // v2.24: the task objects from
                            // tasks.json (see the tasks block for
                            // the shape). Loaded with the library
                            // and kept in step by the tasks writer;
                            // never part of the note cache.
  taskReminders: true,      // v2.24: whether the reminder
                            // scheduler may fire notifications,
                            // remembered in settings and edited
                            // by the Settings Notifications
                            // switch. On unless a stored settings
                            // record explicitly says false.
  noteReminders: true,      // v2.35: the same switch's twin
                            // for NOTE reminders (the note
                            // scheduler below), with the same
                            // settings treatment.
  noteReminderFired: {},    // v2.35: the note reminder fired
                            // stamps, note id -> the reminder
                            // moment ISO this device already
                            // fired for. A delivery fact, not
                            // note content: it lives in this
                            // device's settings so firing never
                            // writes a note file (and never
                            // re-stamps a note's updated time
                            // or enters its conflict paths).
  tasksView: {              // v2.24: the Tasks view's controls,
    grouping: "due",        // session only: "due", "notebook",
    filter: "all",          // or "priority"; and "all", "open",
    query: "",              // "flagged", or "completed". v2.24.1:
    collapsed: {},          // the Find tasks text and the set of
    mode: "list",           // collapsed group keys join them,
    calCursor: null,        // still session only, never saved.
    calSelected: null,      // v2.34: the mode ("list" or
    calExpanded: null       // "calendar"; the list stays the
  },                        // default) and the calendar's month
                            // cursor, selected day, and expanded
                            // day join them, session only as well.
  thingsNotebook: null,     // v2.24.3: the slug of the notebook
                            // whose Things to do page is open in
                            // the editor pane, or null. Session
                            // only, like tasksView above: the page
                            // is a view over tasks.json, never a
                            // note, and nothing of it is saved.
  taskLastNotebook: null,   // v2.24: the notebook the last task
                            // was created in, session only; the
                            // quick add and group defaults.
  trashSelection: [],       // v1.8.1: ids of the notes checked in the
                            // Trash view, for Delete Selected
  archiveSelection: [],     // v1.8.1: ids of the notes checked in the
                            // Archive view, for Restore Selected
  listSelection: [],        // v2.39: ids of the notes checked in a
                            // live list view, for Merge Selected
  syncing: false,           // true while a sync or save is in flight
  online: navigator.onLine, // browser online flag, kept current by events
  cacheGeneration: 0,       // v1.4.1: invalidates an in-flight encrypted
                            // cache write when the user signs out
  cacheWritePromise: null   // v1.4.1: latest encrypted cache write
};

/* The note object shape used everywhere in this app:
   {
     id:        string,   timestamp plus random suffix, also the file name
     title:     string,
     notebook:  string,   notebook slug (folder name in the repo)
     tags:      [string],
     created:   ISO string,
     updated:   ISO string,
     pinned:    boolean,
     body:      string,   HTML body (attachment placeholders only, no binaries)
     attachments: [object],  v1.2 metadata: {id, provider, fileId, name,
                    storageName, mime, size, created}; binaries live
                    with the provider, never in the notes store
     sha:       string|null,  storage sync token of the file as last loaded
                    (a Google Drive revision token)
     bodyLoaded: boolean,     (v2.20) false only for a catalog shell:
                    body is null and the body is fetched on first use
     previewText: string|null, (v2.20) a shell's card preview, from the
                    catalog; loaded notes leave it null
     fileId:    string|null,  (v2.20) the Drive file id, when resolved
     backend:   string,       (v2.121) "file" for an ordinary note
                    file, "doc" for a Doc-backed note (Stage 3 of
                    the Google Docs conversion): the note's content
                    lives in an individual Google Doc instead of a
                    note file, and notebooks and tags stay in the
                    catalog. Absent means "file".
     docId:     string|null,  (v2.121) a Doc-backed note's Google
                    Doc file id; null for file notes, and null on a
                    Doc-backed note whose Doc has not been created
                    yet (its first save creates it)
     trashed:   boolean,
     trashedFrom: string|null  notebook slug the note was trashed from
     archived:  boolean,       (v1.5)
     archivedFrom: string|null notebook slug the note was archived from
   }
   A note sits in exactly one of the three lists at a time: state.notes,
   state.trash, or state.archive. The store path is derived, never stored
   on the object:
     live note:  notebooks/<slug>/<id>.md
     trashed:    trash/<id>.md
     archived:   archive/<id>.md   (v1.5)
*/

/* --------------------------------------------------------------------------
   2. Small utilities
   -------------------------------------------------------------------------- */

/* Escape user text before it is placed into any HTML string. List rendering
   mostly builds DOM nodes with textContent, and this helper covers the few
   places where an HTML string is assembled (tag chips inside cards are
   built with DOM APIs too, so this is defense in depth). */
function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* Strip HTML tags to plain text, for snippets and for search. Uses the
   browser parser so entities are decoded correctly. */
function htmlToText(html) {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  return (div.textContent || "").replace(/\s+/g, " ").trim();
}

/* Base64 for raw byte arrays, used for the device key and for the
   encrypted token and cache records (iv and ciphertext). */
function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/* A note id: current time in base 36 plus a short random suffix. Stable,
   sortable enough, and unique enough for a personal notes repo. */
function newNoteId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return Date.now().toString(36) + "-" + rand;
}

/* Turn a notebook display name into a folder safe slug. */
function slugify(name) {
  const slug = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "notebook";
}

/* Make sure a slug is not already used by another notebook. */
function uniqueSlug(base, ignoreSlug) {
  let slug = base;
  let n = 2;
  while (state.notebooks.some(function (nb) { return nb.slug === slug && nb.slug !== ignoreSlug; })) {
    slug = base + "-" + n;
    n++;
  }
  return slug;
}

/* Debounce helper for autosave and search input. */
function debounce(fn, ms) {
  let timer = null;
  return function () {
    const args = arguments;
    const self = this;
    clearTimeout(timer);
    timer = setTimeout(function () { fn.apply(self, args); }, ms);
  };
}

/* Pretty date for note cards: today shows a time, older shows a date. */
function formatDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) { return ""; }
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

/* v2.18: the notes list card's relative updated label, in the
   mockup's words ("18 minutes ago"): "just now" inside the
   first minute, then minutes, hours, and days, each floored,
   and for anything a week old or older the plain date from
   formatDate. A time in the future reads "just now" too. */
function relativeTimeLabel(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) { return ""; }
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 60000) { return "just now"; }
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) {
    return mins + (mins === 1 ? " minute ago" : " minutes ago");
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return hours + (hours === 1 ? " hour ago" : " hours ago");
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return days + (days === 1 ? " day ago" : " days ago");
  }
  return formatDate(iso);
}

/* Toast messages. Every API error ends up here as readable text. */
function toast(message, isError) {
  const box = document.getElementById("toastBox");
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " error" : "");
  el.textContent = message;
  box.appendChild(el);
  setTimeout(function () {
    if (el.parentNode) { el.parentNode.removeChild(el); }
  }, isError ? 7000 : 4200);
}

/* v2.69: a progress toast for work that takes long enough to
   watch: the same element and styling as an ordinary toast
   (so both themes already cover it), but it carries no auto
   dismiss timer; it stays until the returned handle's
   dismiss runs, and the completion or failure toast that
   follows replaces it. The bulk duplicate is the user: even
   running concurrently, copying many notes' files can take
   long enough that a silent wait reads as a hang. */
/* v2.69: a progress toast for work that takes long enough to
   watch: the same element and styling as an ordinary toast
   (so both themes already cover it), but it carries no auto
   dismiss timer; it stays until the returned handle's
   dismiss runs, and the completion or failure toast that
   follows replaces it. The bulk duplicate is the user: even
   running concurrently, copying many notes' files can take
   long enough that a silent wait reads as a hang.
   v2.70: an optional box carries the toast into another
   toast container; the move operations' surface below
   passes the top center box, the duplicate keeps the
   default bottom box.
   v2.71.0: an optional form argument builds the element
   in the shared pill form instead (the .pill-form rules,
   the save pill's own styling source): the move
   operations' progress asks for it, wearing the saving
   tone and its pulsing dot while the work runs. The
   default toast form is unchanged. */
function showProgressToast(message, box, form) {
  const target = box || document.getElementById("toastBox");
  const el = document.createElement("div");
  if (form === "pill") {
    el.className = "pill-form move-progress";
    el.setAttribute("data-state", "saving");
    const dot = document.createElement("span");
    dot.className = "save-pill-dot";
    dot.setAttribute("aria-hidden", "true");
    el.appendChild(dot);
    const label = document.createElement("span");
    label.textContent = message;
    el.appendChild(label);
  } else {
    el.className = "toast progress";
    el.textContent = message;
  }
  target.appendChild(el);
  return {
    dismiss: function () {
      if (el.parentNode) { el.parentNode.removeChild(el); }
    }
  };
}

/* v2.70: a toast in the top center box (see the
   #toastBoxTop rule): the move operations' completion
   lands where their progress ran. Falls back to the
   ordinary toast if the box is somehow absent.
   v2.71.0: the element is built in the shared pill
   form (see showProgressToast's pill form and the
   .pill-form rules), not the .toast form. */
function toastTopCenter(message, isError) {
  const box = document.getElementById("toastBoxTop");
  if (!box) { toast(message, isError); return; }
  const el = document.createElement("div");
  /* v2.71.0: the completion wears the pill form too,
     from the same shared source as the save pill and
     the progress it replaces: the saved tone and its
     green dot when the move lands, the bad tone when
     this surface ever carries an error. */
  el.className = "pill-form move-done";
  el.setAttribute("data-state", isError ? "bad" : "saved");
  const dot = document.createElement("span");
  dot.className = "save-pill-dot";
  dot.setAttribute("aria-hidden", "true");
  el.appendChild(dot);
  const label = document.createElement("span");
  label.textContent = message;
  el.appendChild(label);
  box.appendChild(el);
  setTimeout(function () {
    if (el.parentNode) { el.parentNode.removeChild(el); }
  }, isError ? 7000 : 4200);
}

/* v2.70: the move operations' progress surface. On his
   real Drive, Chris finds archiving and moving to Trash
   still slow enough to watch, so the four moves
   (archive, trash, restore, unarchive; bulk and single
   alike) run behind a progress toast at the top center
   of the screen: "Archiving... N notes" while the work
   runs, replaced there by "Archived N notes" when it
   lands. The surface shows only when there is something
   to watch: at once for two or more notes, and for a
   single note only if the operation is still running
   350 ms in, so a genuinely instant move never flashes
   it. When it never showed, the caller keeps today's
   feedback exactly (the outcome's shown flag says so);
   when it showed, the completion here replaces it and
   the caller stays silent. Failures keep the move
   chain's own error toasts: if any error toast landed
   in the ordinary box while the work ran, no completion
   wording is shown over it. Returns {shown, failed}. */
const MOVE_PROGRESS_DELAY_MS = 350;

async function withMoveProgressToast(present, past, count, work, undoEntry) {
  const noun = count === 1 ? " note" : " notes";
  let progress = null;
  let timer = null;
  let failed = false;
  let shown = false;
  let observer = null;
  const box = document.getElementById("toastBox");
  if (box && typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(function (records) {
      records.forEach(function (rec) {
        rec.addedNodes.forEach(function (node) {
          if (node.classList &&
              node.classList.contains("error")) {
            failed = true;
          }
        });
      });
    });
    observer.observe(box, { childList: true });
  }
  const show = function () {
    if (progress) { return; }
    progress = showProgressToast(present + "... " + count + noun,
      document.getElementById("toastBoxTop"), "pill");
  };
  if (count >= 2) { show(); }
  else { timer = setTimeout(show, MOVE_PROGRESS_DELAY_MS); }
  try {
    await work();
  } finally {
    if (timer) { clearTimeout(timer); timer = null; }
    shown = !!progress;
    /* Let a queued observer record land before the
       failure verdict is read: the chain's error toast
       is appended ahead of the work's own resolution,
       and one macrotask guarantees its delivery. */
    await new Promise(function (res) { setTimeout(res, 0); });
    if (observer) { observer.disconnect(); observer = null; }
    if (progress) { progress.dismiss(); progress = null; }
  }
  if (shown && !failed) {
    /* v2.96: a Trash or Archive move's completion
       carries an Undo, so it stands in the undo
       toast box instead of here (see
       showMoveUndoToast); the progress it replaces
       stood at the same top center seat. */
    if (undoEntry) {
      showMoveUndoToast(past + " " + count + noun, undoEntry);
    } else {
      toastTopCenter(past + " " + count + noun);
    }
  }
  return { shown: shown, failed: failed,
    undoShown: !!(shown && !failed && undoEntry) };
}

/* v2.70: one note's move behind the same surface, for the
   single actions: the note context menu's items, the
   editor footer buttons, and the note drag's two fixed
   destinations, which run these very functions with these
   very toasts. legacyToast is the caller's own completion
   toast, kept for the runs the progress surface never
   showed on; pass null when the caller has none. */
function moveNoteWithProgress(present, past, legacyToast, work, undoEntry) {
  return withMoveProgressToast(present, past, 1, work, undoEntry)
    .then(function (outcome) {
      /* v2.96: with an undo entry and a clean run,
         the undoable completion replaces the legacy
         toast on the runs the progress surface never
         showed; where it showed, the completion
         already stands with its Undo. A failed run
         keeps today's feedback exactly. */
      if (undoEntry && !outcome.failed) {
        if (!outcome.shown) {
          showMoveUndoToast(legacyToast, undoEntry);
        }
      } else if (!outcome.shown && legacyToast) {
        toast(legacyToast);
      }
    });
}

/* v2.96: Undo for the note moves to Trash and
   Archive. A move's completion toast gains an Undo
   button with the standing undo window (five
   seconds, the attachment deletion's
   PENDING_DELETE_MS measure), standing in the undo
   toast box, whose toasts take events (.undo-toast
   wears pointer-events:auto in that box); the move
   completion's own home, the top center box, is
   display only by design and never takes a click,
   which is the defect v2.95.0 fixed on the mail
   triage toast. The entry is captured before the
   move runs and lives in page memory only, exactly
   as long as its toast: the ids of the notes in
   the move, the collection each stood in (live
   notes or the Archive), and its notebook. */
const MOVE_UNDO_MS = 5000;

function moveUndoSnapshot(kind, notes) {
  return {
    kind: kind, toastEl: null, timer: null,
    items: notes.map(function (note) {
      return {
        id: note.id,
        collection: note.archived ? "archive" : "notes",
        notebook: note.notebook || ""
      };
    })
  };
}

function dismissMoveUndoToast(entry) {
  if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
  if (entry.toastEl && entry.toastEl.parentNode) {
    entry.toastEl.parentNode.removeChild(entry.toastEl);
  }
  entry.toastEl = null;
}

function showMoveUndoToast(message, entry) {
  const box = document.getElementById("undoToastBox");
  if (!box) { toast(message); return; }
  const el = document.createElement("div");
  el.className = "pill-form move-done move-undo";
  el.setAttribute("data-state", "saved");
  const dot = document.createElement("span");
  dot.className = "save-pill-dot";
  dot.setAttribute("aria-hidden", "true");
  el.appendChild(dot);
  const label = document.createElement("span");
  label.textContent = message;
  el.appendChild(label);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "move-undo-btn";
  btn.textContent = "Undo";
  btn.addEventListener("click", function () {
    undoNoteMove(entry).catch(function (err) {
      toast("Undo failed: " + err.message, true);
    });
  });
  el.appendChild(btn);
  box.appendChild(el);
  entry.toastEl = el;
  entry.timer = setTimeout(function () {
    dismissMoveUndoToast(entry);
  }, MOVE_UNDO_MS);
}

/* Take a Trash or Archive move back: every note in
   the entry returns through the standing restore
   machinery, the same paths a manual restore runs
   (restoreNote from Trash, unarchiveNote from the
   Archive), so the file moves, the catalog, and
   the index stay consistent by construction. A
   note trashed out of the Archive is restored to
   its notebook and then archived again, landing
   exactly where the move took it from. Each note
   is counted by where it stands when its turn is
   done, so one already restored by hand inside
   the window counts as back, and one deleted
   forever inside the window counts as gone; the
   follow-up toast reports the count plainly
   either way. */
async function undoNoteMove(entry) {
  dismissMoveUndoToast(entry);
  const total = entry.items.length;
  let back = 0;
  for (let i = 0; i < entry.items.length; i++) {
    const item = entry.items[i];
    try {
      if (entry.kind === "trash") {
        const note = state.trash.find(function (n) {
          return n.id === item.id;
        });
        if (note) {
          await restoreNote(note, true);
          if (item.collection === "archive") {
            await archiveNote(note, true);
          }
        }
      } else {
        const note = state.archive.find(function (n) {
          return n.id === item.id;
        });
        if (note) { await unarchiveNote(note, true); }
      }
    } catch (err) {
      /* Counted by where the note stands, below. */
    }
    const live = findNoteById(item.id);
    if (live) {
      if (item.collection === "archive") {
        if (live.archived) { back += 1; }
      } else if (!live.trashed && !live.archived) {
        back += 1;
      }
    }
  }
  renderAll();
  if (back === total) {
    toast("Restored " + total +
      (total === 1 ? " note." : " notes."));
  } else if (back > 0) {
    toast("Restored " + back + " of " + total +
      " notes; the rest could not be brought back.", true);
  } else {
    toast("None of the " + total +
      " moved notes could be brought back.", true);
  }
}

/* The sync status pill in the sidebar footer. Allowed states per spec:
   Synced, Offline, Syncing, Conflict saved, plus a starting state.
   v1.1 presentation: only the label text is replaced, so the status dot
   stays in place. The data-state value lets CSS give Offline an amber dot
   while reserving the red dot for the separate Conflict saved state; both
   callers historically used the same "bad" class. */
function setSyncPill(kind, text) {
  const pill = document.getElementById("syncPill");
  if (!pill) { return; }
  const label = pill.querySelector(".sync-label");
  if (label) { label.textContent = text; } else { pill.textContent = text; }
  pill.dataset.state = text.indexOf("Conflict") === 0 ? "conflict" :
    (kind === "bad" && text.indexOf("Offline") === 0 ? "offline" : (kind || "idle"));
  pill.className = "sync-pill" + (kind ? " " + kind : "");
  /* v2.5: the icon rail has no room for the pill's text, so its
     sync dot mirrors the same state: same data-state value (the
     dot colors key off it identically) and the pill's label as
     the dot's tooltip. */
  const railSync = document.getElementById("railSync");
  if (railSync) {
    railSync.dataset.state = pill.dataset.state;
    railSync.title = text;
  }
}
function refreshSyncPill() {
  const queued = loadQueue().length;
  if (!state.online) {
    setSyncPill("bad", "Offline" + (queued ? " (" + queued + " queued)" : ""));
  } else if (state.syncing) {
    setSyncPill("busy", "Syncing...");
  } else if (queued) {
    setSyncPill("busy", queued + " change(s) queued");
  } else {
    setSyncPill("ok", "Synced");
  }
}

/* --------------------------------------------------------------------------
   3. The logo: inline SVG
   v1.1 rebuilt this mark as a cleaner five column by seven row tile S.
   Each glyph is a rounded square tile with a folded bottom right corner,
   folded like a note page. One linear gradient runs from the top right to
   the bottom left. Its final stop deliberately remains primary green, not
   the darker sidebar green, so the lower curve stays visible on #0B3D2E.
   One <defs> block is injected once; each slot reuses the gradient by id.
   -------------------------------------------------------------------------- */
const LOGO_GRADIENT_DEFS =
  '<svg width="0" height="0" style="position:absolute" aria-hidden="true">' +
  '<defs><linearGradient id="ssGrad" x1="1" y1="0" x2="0" y2="1">' +
  '<stop offset="0" stop-color="#57A773"/>' +
  '<stop offset="0.38" stop-color="#2E7D4F"/>' +
  '<stop offset="0.72" stop-color="#14532D"/>' +
  '<stop offset="1" stop-color="#14532D"/>' +
  '</linearGradient></defs></svg>';

/* One tile: a rounded square path with a folded corner triangle at the
   bottom right. x, y are the tile top left; s is the tile size. */
function logoTile(x, y, s) {
  const r = s * 0.22;        // corner radius
  const f = s * 0.30;        // fold size
  const x2 = x + s, y2 = y + s;
  return '<path fill="url(#ssGrad)" d="M' + (x + r) + ' ' + y +
    ' H' + (x2 - r) + ' Q' + x2 + ' ' + y + ' ' + x2 + ' ' + (y + r) +
    ' V' + (y2 - f) + ' L' + (x2 - f) + ' ' + y2 +
    ' H' + (x + r) + ' Q' + x + ' ' + y2 + ' ' + x + ' ' + (y2 - r) +
    ' V' + (y + r) + ' Q' + x + ' ' + y + ' ' + (x + r) + ' ' + y + ' Z"/>' +
    '<path fill="rgba(255,255,255,0.28)" d="M' + (x2 - f) + ' ' + y2 +
    ' L' + x2 + ' ' + (y2 - f) + ' L' + (x2 - f) + ' ' + (y2 - f) + ' Z"/>';
}

/* The v1.1 S uses twenty tiles on a five column by seven row grid. The
   two left rows form the upper bowl, the shared middle row turns the path,
   and the two right rows plus the bottom row form the lower bowl. Larger
   gate instances are scaled by CSS from this same vector, so every screen
   uses exactly the same mark and gradient. */
function logoSvg(size) {
  const t = 26, gap = 4, step = t + gap;
  const tiles = [
            [1, 0], [2, 0], [3, 0], [4, 0],
    [0, 1], [1, 1],
    [0, 2], [1, 2],
            [1, 3], [2, 3], [3, 3],
                            [3, 4], [4, 4],
                            [3, 5], [4, 5],
    [0, 6], [1, 6], [2, 6], [3, 6]
  ];
  let parts = "";
  tiles.forEach(function (pos) {
    parts += logoTile(pos[0] * step, pos[1] * step, t);
  });
  const w = 5 * step - gap, h = 7 * step - gap;
  return '<svg width="' + size + '" height="' + Math.round(size * h / w) +
    '" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="SnakeScale Notes logo">' +
    parts + '</svg>';
}

function injectLogos() {
  document.body.insertAdjacentHTML("afterbegin", LOGO_GRADIENT_DEFS);
  document.querySelectorAll(".logo-slot").forEach(function (slot) {
    slot.innerHTML = logoSvg(30);
  });
}

/* --------------------------------------------------------------------------
   4. The device key: local encryption with WebCrypto (AES-GCM)
   Before v2.0 this section also held an app password vault (PBKDF2
   plus AES-GCM) that encrypted the GitHub token. The GitHub backend
   and the app password are gone: Sign in with Google is the only
   sign in, the token lives in memory only, and what remains here
   is the random device key that Google users have had since
   v1.4.1. The key encrypts the provider token store (section 11)
   and the local note cache (section 5) at rest on this device. It
   is generated on this device, never typed by the user, and never
   leaves the device. It is NOT a login: anyone using the unlocked
   browser profile can still use the app, so the key only
   scrambles local copies against casual snooping.
   -------------------------------------------------------------------------- */
function deviceKeyExists() {
  return !!localStorage.getItem(LS_DEVICE_KEY);
}

async function createDeviceKey() {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const raw = await crypto.subtle.exportKey("raw", key);
  localStorage.setItem(LS_DEVICE_KEY, bytesToBase64(new Uint8Array(raw)));
  state.sessionKey = key;
  return key;
}

async function loadDeviceKey() {
  const raw = localStorage.getItem(LS_DEVICE_KEY);
  if (!raw) { return false; }
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      base64ToBytes(raw),
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"]
    );
    state.sessionKey = key;
    return true;
  } catch (e) {
    /* A damaged device key cannot decrypt anything written under it.
       Remove it and let the caller create a fresh key; the user will
       simply sign in with Google again. */
    localStorage.removeItem(LS_DEVICE_KEY);
    state.sessionKey = null;
    return false;
  }
}

async function loadOrCreateDeviceKey() {
  if (state.sessionKey) { return state.sessionKey; }
  if (await loadDeviceKey()) { return state.sessionKey; }
  return createDeviceKey();
}

function wipeDeviceKey() {
  localStorage.removeItem(LS_DEVICE_KEY);
}

/* Sign out, the only sign out there is (v2.0). There is no lock to
   fall back to anymore: signing out is the full Google sign out
   Drive users have had since v1.4.1, and it is what the sidebar
   button and the gate button both run. It signs the Worker
   session out at the Worker (best effort), then wipes
   this device's copies: the encrypted provider token store, the
   encrypted note cache, the offline queue, any legacy vault
   record left by an older build, and the device key itself.
   Settings survive, because they hold no secrets: theme, the
   attachment bookkeeping, and the remembered list sort. The notes
   themselves are untouched in Google Drive; signing in again
   reloads them. */
async function signOut() {
  const ok = confirm(
    "Sign out of SnakeScale Notes on this device? Your notes stay safe in " +
    "Google Drive. Local copies on this device will be cleared, including " +
    "any edits still waiting to sync, so sync first if the sync pill is " +
    "not green.");
  if (!ok) { return; }

  /* v1.7: signing out cancels every pending attachment deletion
     WITHOUT deleting anything (see cancelAllPendingAttachmentDeletes
     in section 11). The attachment block is already out of the note
     body, but the record stays in the note and the file stays in
     Drive, so nothing is lost by leaving. */
  cancelAllPendingAttachmentDeletes();

  let googleToken = state.providerTokens.google || null;
  if (!googleToken) {
    try { googleToken = await getProviderToken("google"); }
    catch (e) { googleToken = null; }
  }

  /* Stop any encrypted cache write already in flight from recreating
     the cache after the wipe below. */
  state.cacheGeneration++;
  if (state.cacheWritePromise) {
    try { await state.cacheWritePromise; } catch (e) { /* already handled */ }
    state.cacheWritePromise = null;
  }

  /* v2.79.0: the Worker session is signed out too: its own
     logout, best effort, then the local session store joins
     the wipes below (its memory copy here, its localStorage
     key beside LS_PROVIDERS). Only the session dies; the
     refresh token stays in the Worker, so signing back in
     on this device is quick. */
  /* v2.86: this device's push registration dies with
     the session: the push Worker forgets the
     subscription and the browser unsubscribes it, best
     effort, while the session token still stands to
     make the call. */
  await pushSignOutCleanup();
  await workerLogout();
  clearWorkerSession();
  workerReauthNeeded = false;
  workerAccountEmail = "";

  state.sessionKey = null;
  state.providerTokens = { google: null };
  state.repoExists = false;
  state.notebooks = [];
  state.notes = [];
  state.trash = [];
  state.archive = [];
  state.index = null;
  state.selectedId = null;
  /* v2.8: histories and baselines belong to the signed in account;
     none of them may leak into the next sign in on this device. */
  clearVersionRuntimeState();
  /* v2.20: the catalog and drop box session state goes with them. */
  resetCatalogRuntimeState();
  /* v2.24: tasks session state likewise; the tasks themselves
     stay in Drive, and the editor closes with the session. */
  state.tasks = [];
  resetTasksRuntimeState();
  closeTaskEditor();
  /* v2.15: signing out cancels the pending automatic renewal,
     so no silent ask can resurrect the session just left. */
  clearGoogleRenewalTimer();
  /* v2.24.6: and the renewal recovery state goes with it: no
     ladder, no open episode, and no armed gesture may outlive
     the session they served. */
  resetGoogleRenewalRecovery();
  /* v2.16: and the auto-sync watcher stops with the session. */
  stopAutoSync();
  /* v2.17.1: divergence is session state too; none of it may
     leak into the next sign in on this device. */
  clearAllDivergenceState();
  /* v2.85: the people module's contacts and state
     belong to the signed in account; none of them
     may outlive the session that loaded them. */
  resetPeopleState();
  /* v2.95: the mail module's state likewise,
     the badge's count above all: it must not stand
     over a signed out screen or leak into the next
     sign in on this device. */
  resetMailState();
  state.attach.googleExpiresAt = 0;
  state.attach.googleFolderId = null;
  revokeAttachmentUrls();
  hideLinkBar();

  localStorage.removeItem(LS_PROVIDERS);
  localStorage.removeItem(LS_WORKER_SESSION);
  localStorage.removeItem(LS_CACHE);
  localStorage.removeItem(LS_QUEUE);
  localStorage.removeItem(LS_LEGACY_VAULT);
  wipeDeviceKey();
  saveSettings();
  showGoogleConnectScreen(
    "You are signed out on this device. Sign in with Google to load your " +
    "notes from Google Drive again.");
}


/* --------------------------------------------------------------------------
   5. Settings, local cache, and the offline edit queue
   Settings are not secret (theme, attachment bookkeeping), so they live
   in plain JSON.
   The cache mirrors notebooks, notes, trash, and the archive so the app
   opens and reads fully offline. The queue holds file operations made while offline (or
   while a save failed) and is flushed on reconnect or Sync now.
   -------------------------------------------------------------------------- */
/* Human readable name for the one storage service, used in status
   messages. v2.0 has exactly one store; the helper remains so the
   sync engine's messages keep their established wording. */
function storageDisplayName() {
  return "Google Drive";
}


function loadSettings() {
  const raw = localStorage.getItem(LS_SETTINGS);
  let s = {};
  try {
    if (raw) { s = JSON.parse(raw) || {}; }
  } catch (e) {
    /* A damaged settings record falls back to defaults rather than
       failing the boot. Obsolete fields in any stored record (a
       backend choice, a data repository name, pCloud bookkeeping
       from before v2.0) are simply never read here, and the next
       saveSettings writes the current shape without them. */
    s = {};
  }
  if (s.dark) { document.body.classList.add("dark"); }
  /* Attachment config rides along in the same settings object. None
     of it is secret: the client ID override is a public identifier,
     and folder IDs and expiry times are bookkeeping. Tokens are
     NEVER stored here. Only keys that exist in the current shape
     are copied, so pre-v2.0 pCloud fields drop away on their own. */
  if (s.attach) {
    Object.keys(state.attach).forEach(function (k) {
      if (s.attach[k] !== undefined) { state.attach[k] = s.attach[k]; }
    });
  }
  /* v2.0: Google is the only attachment provider. A stored value
     naming anything else (an old "pcloud" or "none") is pinned
     back to Google. */
  state.attach.defaultProvider = "google";
  /* v1.8: the remembered list sort. Only the shapes the sort menu
     can produce are accepted; anything else leaves the default in
     place (Date Updated, newest first, the pre-v1.8 list order). */
  if (s.listSort) {
    if (["title", "created", "updated"].indexOf(s.listSort.field) >= 0) {
      state.listSort.field = s.listSort.field;
    }
    if (s.listSort.dir === "asc" || s.listSort.dir === "desc") {
      state.listSort.dir = s.listSort.dir;
    }
  }
  /* v2.5: the remembered sidebar form. Only a stored true turns
     the rail on; anything else leaves the full sidebar default.
     The body class is the whole application of the setting: the
     rail CSS hangs off it (inside the desktop media query), and
     renderRailChrome keeps the toggle label and rail active
     states in step from the first render on. */
  if (s.sidebarRail === true) {
    state.sidebarRail = true;
    document.body.classList.add("rail");
  }
  /* v2.29: the collapsed stack names. Only an array of
     strings is honored; anything else (an absent field from
     an older build, a damaged value) leaves every stack
     expanded, so a bad record can never hide a notebook
     behind a fold nobody set. */
  if (Array.isArray(s.collapsedStacks)) {
    state.collapsedStacks = s.collapsedStacks.filter(function (x) {
      return typeof x === "string" && x !== "";
    });
  }
  /* v2.30: the collapsed tag names, sanitized the same way:
     only an array of non-empty strings is honored, so a bad
     record can never hide a sub-tag behind a fold nobody
     set. */
  if (Array.isArray(s.collapsedTags)) {
    state.collapsedTags = s.collapsedTags.filter(function (x) {
      return typeof x === "string" && x !== "";
    });
  }
  /* v2.62: the collapsed sidebar sections, honored only
     as an array naming the sections the sidebar has (the
     fixed vocabulary the section table in the sidebar
     code uses); anything else (an absent field from an
     older build, a damaged value, a name nothing
     carries) is dropped, so a bad record can never hide
     a section behind a fold nobody set. */
  if (Array.isArray(s.collapsedSections)) {
    state.collapsedSections = s.collapsedSections.filter(
      function (x) {
        return ["shortcuts", "notebooks", "tags"].indexOf(x) >= 0;
      });
  }
  /* v2.63: the collapsed notebook subtrees, honored only
     as an array of slug strings; anything else (an absent
     field from an older build, a damaged value) is
     dropped, so a bad record can never hide a subtree
     behind a fold nobody set. */
  if (Array.isArray(s.collapsedNotebooks)) {
    state.collapsedNotebooks = s.collapsedNotebooks.filter(
      function (x) {
        return typeof x === "string" && x.length > 0;
      });
  }
  /* v2.8: the versions per note limit. Only a finite stored number
     is honored, truncated to a whole number and clamped into the
     0 to 100 range the Settings input offers; anything else (an
     absent field from an older build, a damaged value) leaves the
     default of 10 in place, so a bad record can never corrupt the
     setting. */
  if (s.versionsLimit !== undefined && s.versionsLimit !== null &&
      Number.isFinite(Number(s.versionsLimit))) {
    state.versionsLimit = Math.max(0, Math.min(100,
      Math.trunc(Number(s.versionsLimit))));
  }
  /* v2.13: whether the first run walkthrough has been finished on
     this device. Only a stored true is honored; the flag never
     triggers the walkthrough (seeding during the boot does), it
     only records that the tour already happened here. */
  if (s.onboardingSeen === true) { state.onboardingSeen = true; }
  /* v2.16: idle auto-sync. The default is on, so only an
     explicitly stored false turns it off; a record written
     before this setting existed (no autoSync field at all)
     keeps the on default, exactly like a fresh device. */
  if (s.autoSync === false) { state.autoSync = false; }
  /* v2.23: the default paste mode. Only the three values the
     Settings select offers are honored; anything else (an
     absent field from an older build, a damaged value) leaves
     the Keep source formatting default in place. */
  if (["source", "merge", "text"].indexOf(s.defaultPasteMode) >= 0) {
    state.defaultPasteMode = s.defaultPasteMode;
  }
  /* v2.24.2: the palettes' remembered Custom colors. Only a
     full hex value of the shape the color inputs themselves
     produce is honored; anything else (an absent field from
     an older build, a damaged value) leaves the shipped
     defaults in place. */
  if (/^#[0-9a-fA-F]{6}$/.test(s.customHighlightColor || "")) {
    state.customHighlightColor = s.customHighlightColor.toLowerCase();
  }
  if (/^#[0-9a-fA-F]{6}$/.test(s.customTextColor || "")) {
    state.customTextColor = s.customTextColor.toLowerCase();
  }
  /* v2.24: task reminder notifications. The default is on, so
     only an explicitly stored false turns them off, exactly
     like autoSync above. */
  if (s.taskReminders === false) { state.taskReminders = false; }
  /* v2.35: the note reminder switch, with the task switch's
     treatment, and the fired stamps: only a plain object of
     string to string entries is honored, so a damaged record
     degrades to no stamps (a reminder could then fire once
     more on this device, never more than once). */
  if (s.noteReminders === false) { state.noteReminders = false; }
  if (s.noteReminderFired && typeof s.noteReminderFired === "object" &&
      !Array.isArray(s.noteReminderFired)) {
    const fired = {};
    Object.keys(s.noteReminderFired).forEach(function (id) {
      const v = s.noteReminderFired[id];
      if (typeof v === "string" && v) { fired[id] = v; }
    });
    state.noteReminderFired = fired;
  }
  /* v2.33: the When opening choice. Home is the default, so
     only an explicitly stored "notes" moves the landing to
     the notes list; anything else (an absent field from an
     older build, a damaged value) leaves the Home default
     in place. */
  if (s.startView === "notes") { state.startView = "notes"; }
  /* v2.72: the default notebook. Only a stored string is
     honored; whether the slug still names a notebook is
     judged where the setting is used
     (defaultNotebookSlug), because the notebooks load
     after the settings do. Anything else (an absent
     field from an older build, a damaged value) leaves
     the unset default in place. */
  if (typeof s.defaultNotebook === "string") {
    state.defaultNotebook = s.defaultNotebook;
  }
}


function saveSettings() {
  localStorage.setItem(LS_SETTINGS, JSON.stringify({
    dark: document.body.classList.contains("dark"),
    attach: state.attach,
    listSort: state.listSort,   // v1.8: the remembered notes list sort
    sidebarRail: state.sidebarRail,   // v2.5: the icon rail choice
    collapsedStacks: state.collapsedStacks,   // v2.29: stack folds
    collapsedTags: state.collapsedTags,   // v2.30: tag folds
    collapsedSections: state.collapsedSections,   // v2.62: sidebar section folds
    collapsedNotebooks: state.collapsedNotebooks,   // v2.63: notebook subtree folds
    versionsLimit: state.versionsLimit,   // v2.8: versions kept per note
    onboardingSeen: state.onboardingSeen,   // v2.13: the walkthrough record
    autoSync: state.autoSync,   // v2.16: the idle auto-sync choice
    defaultPasteMode: state.defaultPasteMode,   // v2.23: the paste default
    customHighlightColor: state.customHighlightColor,   // v2.24.2: palette memory
    customTextColor: state.customTextColor,   // v2.24.2: palette memory
    taskReminders: state.taskReminders,   // v2.24: reminder notifications
    noteReminders: state.noteReminders,   // v2.35: note reminder notifications
    noteReminderFired: state.noteReminderFired,   // v2.35: the fired stamps
    startView: state.startView,   // v2.33: the When opening choice
    defaultNotebook: state.defaultNotebook   // v2.72: the default notebook
  }));
}

/* v2.0 legacy cleanup, run once by boot before routing. Builds
   before v2.0 could leave three kinds of record behind: the app
   password vault (or the v1.4 marker vault) under LS_LEGACY_VAULT,
   settings naming the GitHub backend, and a plaintext cache
   snapshot naming the GitHub backend. The vault record is deleted
   outright: no vault exists anymore. When either stored record
   names GitHub, the cache and the offline queue are deleted too,
   because they describe a store this build can no longer read.
   Dropping the queue matters most: its path based operations must
   never be flushed into the Google Drive store by a later sync.
   The GitHub era notes themselves are not touched (they live in
   their owner's repository, outside this build's reach).
   A Google user's records fail both backend tests (their cache is
   the encrypted format, which carries no plaintext backend field),
   so their settings, cache, queue, and device key pass through
   completely untouched. Returns true when any legacy artifact was
   found, which boot routing treats as "a returning device". */
function cleanupLegacyStorage() {
  let found = false;
  if (localStorage.getItem(LS_LEGACY_VAULT)) {
    localStorage.removeItem(LS_LEGACY_VAULT);
    found = true;
  }
  let settingsSayGithub = false;
  try {
    const s = JSON.parse(localStorage.getItem(LS_SETTINGS) || "null");
    if (s && s.backend === "github") { settingsSayGithub = true; }
  } catch (e) { /* a damaged record carries no signal */ }
  let cacheSayGithub = false;
  try {
    const c = JSON.parse(localStorage.getItem(LS_CACHE) || "null");
    if (c && !c.encrypted && c.backend === "github") {
      cacheSayGithub = true;
    }
  } catch (e) { /* a damaged record carries no signal */ }
  if (settingsSayGithub || cacheSayGithub) {
    found = true;
    localStorage.removeItem(LS_CACHE);
    localStorage.removeItem(LS_QUEUE);
  }
  return found;
}

/* One cache snapshot shape. The snapshot is encrypted under the
   device key before it reaches localStorage (see storeEncryptedCache
   below); the Drive store is always the source of truth. */

function cacheSnapshot() {
  return {
    notebooks: state.notebooks,
    /* v2.30: the tag parent map rides the snapshot too, so a
       cache first paint shows the same tree the store does. */
    tagParents: state.tagParents,
    /* v2.31: the shortcuts list rides it as well, so a cache
       first paint shows the same Shortcuts section. */
    shortcuts: state.shortcuts,
    /* v2.32: the saved searches ride it too, so a cache
       first paint can surface the same list. */
    savedSearches: state.savedSearches,
    /* v2.33: the home field rides it as well, so a cache
       first paint shows the same dashboard. */
    home: state.home,
    /* v2.38: the custom templates ride it too, so a cache
       first paint can open the same gallery. */
    templates: state.templates,
    /* v2.44: the tasks ride it as well, the field v2.24
       never plumbed in, so a cache first paint shows the
       same Tasks view and Home widgets the store load
       will. Display only until that load lands: the
       writer arms and the reminder catch up runs from
       the real load alone (see the v2.44 gates in the
       tasks section). */
    tasks: state.tasks,
    notes: state.notes,
    trash: state.trash,
    archive: state.archive,
    index: state.index,
    savedAt: new Date().toISOString()
  };
}

function applyCacheSnapshot(c) {
  state.notebooks = c.notebooks || [];
  /* v2.63: the notebook parent fields are sanitized on
     this adoption like every other load path (see
     sanitizeNotebookParents); a snapshot written before
     nesting existed has no parent fields and loads as an
     all top level sidebar, exactly like an index.json
     written before v2.63 does. */
  sanitizeNotebookParents();
  /* v2.30: snapshots written before nested tags existed have
     no map; they load as an all top level hierarchy, exactly
     like an index.json written before v2.30 does. */
  state.tagParents = sanitizeTagParents(c.tagParents);
  /* v2.31: snapshots written before shortcuts existed have
     no list; they load as an empty Shortcuts section,
     exactly like an index.json written before v2.31 does. */
  state.shortcuts = sanitizeShortcuts(c.shortcuts);
  /* v2.32: snapshots written before saved searches existed
     have no list; they load as an empty saved searches
     list, exactly like an index.json written before v2.32
     does. */
  state.savedSearches = sanitizeSavedSearches(c.savedSearches);
  /* v2.33: snapshots written before Home existed have no
     home field; they load as the default dashboard,
     exactly like an index.json written before v2.33 does. */
  state.home = sanitizeHome(c.home);
  /* v2.38: snapshots written before templates existed
     have no list; they load as an empty My templates
     list, exactly like an index.json written before
     v2.38 does. */
  state.templates = sanitizeTemplates(c.templates);
  /* v2.44: snapshots written before tasks rode the cache
     have no list; they load as an empty Tasks view,
     exactly like an index.json written before v2.24
     does. Present entries restore through the load's
     own sanitizer, so a damaged entry is dropped or
     defaulted here the same way it is from Drive. */
  state.tasks = (Array.isArray(c.tasks) ? c.tasks : [])
    .map(function (raw) { return sanitizeTask(raw); })
    .filter(function (task) { return task !== null; });
  state.notes = c.notes || [];
  state.trash = c.trash || [];
  /* v1.5: caches written before archiving existed have no archive
     list; they load as an empty archive, exactly like old note files
     load as unarchived. Snapshots written before v2.0 also carry
     store bookkeeping fields this build no longer keeps; they are
     ignored here. */
  state.archive = c.archive || [];
  state.index = c.index || null;
  /* v2.8: the loaded objects are the last saved state, so they
     seed the version history baseline map (see the version
     history section below). */
  rememberLastSavedContentForAllNotes();
  return true;
}


/* v1.4.1: encrypt one Google cache snapshot with AES-GCM under the device
   key. The generation check is the sign out guard: if the user signs out
   while this asynchronous write is in flight, the write is abandoned
   instead of recreating a cache that sign out just cleared. */
async function storeEncryptedCache(snapshot, key, generation) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    key,
    new TextEncoder().encode(JSON.stringify(snapshot))
  );
  if (generation !== state.cacheGeneration || state.sessionKey !== key) {
    return;
  }
  localStorage.setItem(LS_CACHE, JSON.stringify({
    v: 2,
    encrypted: "AES-GCM",
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(cipher))
  }));
}

/* v2.20: saveCache is the one call every mutation path already
   makes when state changes, so it doubles as the catalog
   maintenance hook: the local cache write runs exactly as
   before, and the catalog writer is scheduled behind it
   (debounced, change tested, and inert until this session's
   first store load has armed it; see the v2.20 section). The
   catalog snapshot is built when the write actually runs, so a
   burst of saves costs at most one catalog write, and a failed
   one is swallowed there, never here. */
function saveCache() {
  writeLocalCache();
  saveCatalog();
}

function writeLocalCache() {
  const snapshot = cacheSnapshot();
  if (state.sessionKey) {
    const key = state.sessionKey;
    const generation = state.cacheGeneration;
    state.cacheWritePromise = storeEncryptedCache(snapshot, key, generation)
      .catch(function (e) {
        /* The Drive store is the source of truth, so a cache failure is
           not fatal; reads still work after the next successful sync. */
      });
    return;
  }
  try {
    localStorage.setItem(LS_CACHE, JSON.stringify(snapshot));
  } catch (e) {
    /* localStorage can fill up with very large note sets. The remote
       store is the source of truth, so a cache failure is not fatal;
       reads still work after the next successful sync. */
  }
}

function loadCache() {
  try {
    const c = JSON.parse(localStorage.getItem(LS_CACHE) || "null");
    if (!c || c.encrypted) { return false; }
    return applyCacheSnapshot(c);
  } catch (e) {
    return false;
  }
}

/* Cache reads are asynchronous because WebCrypto decryption is
   asynchronous. A plaintext cache written by a very old build is
   accepted once through loadCache or the plain branch below and is
   rewritten encrypted on the next save. */
async function loadCacheWithKey() {
  if (!state.sessionKey) {
    return loadCache();
  }
  let c = null;
  try { c = JSON.parse(localStorage.getItem(LS_CACHE) || "null"); }
  catch (e) { return false; }
  if (!c) { return false; }
  if (!c.encrypted) { return applyCacheSnapshot(c); }
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(c.iv) },
      state.sessionKey,
      base64ToBytes(c.data)
    );
    return applyCacheSnapshot(JSON.parse(new TextDecoder().decode(plain)));
  } catch (e) {
    return false;
  }
}

/* Queue entries are complete file operations, so a flush needs no editor
   state: {kind:"put", path, content, noteId} writes a file;
   {kind:"delete", path, noteId} deletes one (its sha is looked up fresh at
   flush time). Note bodies ride along as full file text. */
function loadQueue() {
  try {
    return JSON.parse(localStorage.getItem(LS_QUEUE) || "[]");
  } catch (e) {
    return [];
  }
}
function saveQueue(queue) {
  localStorage.setItem(LS_QUEUE, JSON.stringify(queue));
  refreshSyncPill();
}
function queueOp(op) {
  const queue = loadQueue();
  queue.push(op);
  saveQueue(queue);
}

/* --------------------------------------------------------------------------
   v2.8: note version history

   Storage: one JSON file per note at versions/<noteId>.json in the
   same Drive root as notebooks, trash, archive, and attachments.
   The normal note file format does not change. Each history file
   is {noteId, versions:[...]} with the versions newest first; a
   version entry is {id, createdAt, title, body, tags, attachments}
   and holds the note's previous saved content, attachment RECORDS
   included (the binaries themselves are never copied; a restored
   version points at the same Drive files as before, and a file
   that was permanently deleted stays missing, exactly like any
   other dangling attachment record).

   The folder is created lazily by the first history write (the
   store layer creates parent folders on the way to a file). A
   missing folder or file is an empty history, not an error. The
   index rebuild never sees these files: loadAllFromRepo lists
   only notebooks, trash, and archive, so a top level versions
   folder is structurally ignored, the same way attachments is.

   Capture: saveNoteToRepoNow compares the note against the last
   saved content snapshot kept in lastSavedContentByNoteId (the
   baseline map, populated on every load and after every persisted
   or queued save). Callers mutate the note object before saving,
   so the baseline has to live outside the note; without it there
   would be no reliable "previous saved state" left to snapshot.
   A note's first save has no baseline and creates no version. A
   save whose title, body, and tags all match the baseline creates
   none either, which is why pin, move, archive, trash, and
   restore operations (which save or move the same content) never
   create versions by themselves. When a qualifying save lands,
   the baseline becomes a snapshot, at most one per note per
   VERSION_COALESCE_MS, and the list is pruned to the configured
   limit, oldest dropped first. If the history file cannot be
   loaded safely (damaged JSON, a shape this build cannot trust),
   the note save still proceeds, but version creation, pruning,
   and history deletion for that save are skipped rather than
   risk overwriting or deleting a history that might be intact.

   Offline: when a note save itself is queued, a matching
   {kind:"version-history"} entry is queued right behind it,
   carrying the previous snapshot, the content it expects the
   queued note write to leave behind, the capture time, and the
   limit in force. flushQueue applies those entries in order,
   after the note write they belong to, and an entry whose
   expected content is not what the note write left behind (the
   write became a conflict copy, for example) is skipped. When a
   history write itself fails with an offline or expired sign in
   error after its note save already landed, the same kind of
   entry is queued as a replay, so the update is durable rather
   than silently dropped.
   -------------------------------------------------------------------------- */
const VERSIONS_FOLDER_NAME = "versions";
const VERSION_COALESCE_MS = 10 * 60 * 1000;
const versionHistoryCache = Object.create(null);
const lastSavedContentByNoteId = Object.create(null);
const versionHistoryPruneNeeded = new Set();
let versionHistoryOpenNoteId = null;
let versionHistoryPreviewVersionId = null;

/* The configured versions per note limit, normalized: a whole
   number from 0 to 100, with the default 10 for anything that is
   not a finite number. state.versionsLimit is kept normalized by
   loadSettings and by the Settings input; this helper is the
   belt and suspenders every consumer reads through. */
function currentVersionsLimit() {
  const n = Number(state.versionsLimit);
  if (!Number.isFinite(n)) { return 10; }
  return Math.max(0, Math.min(100, Math.trunc(n)));
}
function versionsLimitValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) { return currentVersionsLimit(); }
  return Math.max(0, Math.min(100, Math.trunc(n)));
}

function versionHistoryPath(noteId) {
  return VERSIONS_FOLDER_NAME + "/" + noteId + ".json";
}

/* Deep clone for the plain JSON shaped values history deals in
   (strings, arrays, and the flat attachment records). */
function cloneVersionValue(value) {
  if (value === undefined) { return undefined; }
  return JSON.parse(JSON.stringify(value));
}

/* The content snapshot of one note: the fields a version
   preserves, plus (v2.19) the pin and the thumbnail. Those
   two are stored note content too, and they change through
   their own paths (the pin through its list menu save, the
   thumbnail through the autosave itself), so the save
   machinery's full content questions, the v2.19 autosave
   gate and the conflict content comparison, need them in
   the snapshot beside title, body, tags, and attachments.
   Version entries keep carrying only their four named
   fields: maintainVersionHistory picks them out of the
   snapshot by name, so the extra fields ride along in
   snapshots and queued history entries without ever
   reaching a stored version. Attachments are sanitized
   and cloned, so a snapshot can never be mutated by later
   work on the note object. */
function noteContentSnapshot(note) {
  if (!note) { return null; }
  return {
    title: String(note.title || ""),
    body: String(note.body || ""),
    tags: (Array.isArray(note.tags) ? note.tags : [])
      .map(function (t) { return String(t); }),
    attachments: sanitizeAttachments(cloneVersionValue(note.attachments || [])),
    pinned: !!note.pinned,
    thumbnail: note.thumbnail || null,
    /* v2.35: the reminder pair rides the snapshot beside the
       pin and the thumbnail, for the same reason: they are
       stored note content that changes through its own path
       (the reminder panel), so the save machinery's full
       content questions need them too. Version entries keep
       carrying only their named fields, so the pair never
       reaches a stored version. */
    reminderAt: note.reminderAt || null,
    reminderDoneAt: note.reminderDoneAt || null
  };
}

function rememberLastSavedContent(note) {
  const snapshot = noteContentSnapshot(note);
  if (snapshot) { lastSavedContentByNoteId[note.id] = snapshot; }
}
function rememberLastSavedSnapshot(noteId, snapshot) {
  if (noteId && snapshot) {
    lastSavedContentByNoteId[noteId] = cloneVersionValue(snapshot);
  }
}
function forgetLastSavedContent(noteId) {
  delete lastSavedContentByNoteId[noteId];
}
/* Rebuild the baseline map from the three note lists. Called
   after every load (cache or store), because the loaded objects
   ARE the last saved state at that moment.
   v2.20: catalog shells are skipped. A shell has no body, so a
   baseline built from it would snapshot an empty body the note
   does not have; ensureNoteBodyLoaded seeds the real baseline
   when the shell's file is fetched. */
function rememberLastSavedContentForAllNotes() {
  Object.keys(lastSavedContentByNoteId).forEach(function (id) {
    delete lastSavedContentByNoteId[id];
  });
  [state.notes, state.trash, state.archive].forEach(function (list) {
    (list || []).forEach(function (note) {
      if (note.bodyLoaded === false) { return; }
      rememberLastSavedContent(note);
    });
  });
}
function clearVersionHistoryCache() {
  Object.keys(versionHistoryCache).forEach(function (id) {
    delete versionHistoryCache[id];
  });
}
/* Sign out drops every in memory history record and baseline, so
   a different Google account on the same browser can never be
   handed the previous account's histories. */
function clearVersionRuntimeState() {
  clearVersionHistoryCache();
  Object.keys(lastSavedContentByNoteId).forEach(function (id) {
    delete lastSavedContentByNoteId[id];
  });
  versionHistoryPruneNeeded.clear();
  versionHistoryOpenNoteId = null;
  versionHistoryPreviewVersionId = null;
}

/* Full snapshot equality (title, body, tags, and the attachment
   records). Restore uses this for its already current test. */
function versionContentEqual(a, b) {
  if (!a || !b) { return false; }
  return a.title === b.title && a.body === b.body &&
    JSON.stringify(a.tags || []) === JSON.stringify(b.tags || []) &&
    JSON.stringify(a.attachments || []) ===
      JSON.stringify(b.attachments || []);
}
/* The capture gate's equality: content means title, body, or
   tags, per the feature's rules. Attachment records travel with
   a snapshot but do not by themselves qualify a save. */
function versionTextContentEqual(a, b) {
  if (!a || !b) { return false; }
  return a.title === b.title && a.body === b.body &&
    JSON.stringify(a.tags || []) === JSON.stringify(b.tags || []);
}

/* v2.19: content equivalence between two note shaped objects
   (a live note and a freshly parsed stored file, or two parsed
   files): the conflict rule's content question. Everything
   that makes the note the note is compared: title, body,
   tags, the pin, the thumbnail, the attachment records, and
   the notebook. The bookkeeping fields are excluded on
   purpose: the id (the same file either way), created and
   updated (every save re-stamps updated before serializing,
   so two saves of the same words never carry the same value;
   it was exactly that re-stamp that made byte comparison
   useless here), the storage revision, and list placement
   (trash and archive files live at their own paths and never
   reach this comparison). */
function noteContentEquivalent(a, b) {
  if (!a || !b) { return false; }
  return String(a.title || "") === String(b.title || "") &&
    String(a.body || "") === String(b.body || "") &&
    JSON.stringify(a.tags || []) === JSON.stringify(b.tags || []) &&
    !!a.pinned === !!b.pinned &&
    (a.thumbnail || null) === (b.thumbnail || null) &&
    /* v2.35: the reminder pair is content for this question
       too, so a save from a session holding a stale reminder
       state can never silently agree with (and overwrite) a
       version whose reminder differs; it takes the ordinary
       divergence path instead, where nothing is lost. */
    (a.reminderAt || null) === (b.reminderAt || null) &&
    (a.reminderDoneAt || null) === (b.reminderDoneAt || null) &&
    String(a.notebook || "") === String(b.notebook || "") &&
    JSON.stringify(sanitizeAttachments(a.attachments || [])) ===
      JSON.stringify(sanitizeAttachments(b.attachments || []));
}

/* v2.19: does this note, exactly as it stands now, match its
   last saved baseline in full? The baseline is the v2.8
   snapshot map, extended in this build with the pin and the
   thumbnail, the two stored fields that travel outside
   title, body, and tags. A note with no baseline was never
   loaded or saved in this session (a first save, above all)
   and is never called unchanged. */
function noteMatchesLastSaved(note) {
  if (!note) { return false; }
  const baseline = lastSavedContentByNoteId[note.id];
  if (!baseline) { return false; }
  const snap = noteContentSnapshot(note);
  return versionContentEqual(snap, baseline) &&
    snap.pinned === baseline.pinned &&
    snap.thumbnail === baseline.thumbnail &&
    /* v2.35: a baseline written before reminders existed has
       no pair on it; undefined reads as null here, so an old
       baseline still matches a reminderless note exactly. */
    snap.reminderAt === (baseline.reminderAt || null) &&
    snap.reminderDoneAt === (baseline.reminderDoneAt || null);
}

function versionHistoryLoadError(message) {
  const err = new Error(message);
  err.code = "VERSION_HISTORY_UNSAFE";
  return err;
}
function isVersionHistoryUnsafeError(err) {
  return !!err && (err.code === "VERSION_HISTORY_UNSAFE" ||
    err instanceof SyntaxError);
}

/* Validate and normalize one stored version entry. Anything this
   build cannot trust makes the whole history unsafe (the caller
   then leaves the stored bytes untouched), rather than silently
   dropping entries the user may still need. */
function normalizeVersionEntry(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw versionHistoryLoadError("A stored version entry is not an object.");
  }
  if (typeof raw.id !== "string" || !raw.id) {
    throw versionHistoryLoadError("A stored version entry has no id.");
  }
  if (typeof raw.createdAt !== "string" ||
      isNaN(new Date(raw.createdAt).getTime())) {
    throw versionHistoryLoadError("A stored version entry has no valid date.");
  }
  if (typeof raw.title !== "string" || typeof raw.body !== "string" ||
      !Array.isArray(raw.tags) || !Array.isArray(raw.attachments)) {
    throw versionHistoryLoadError("A stored version entry is incomplete.");
  }
  return {
    id: raw.id,
    createdAt: raw.createdAt,
    title: raw.title,
    body: raw.body,
    tags: raw.tags.map(function (t) { return String(t); }),
    attachments: sanitizeAttachments(cloneVersionValue(raw.attachments))
  };
}
function normalizeVersionHistoryData(noteId, parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
      parsed.noteId !== noteId || !Array.isArray(parsed.versions)) {
    throw versionHistoryLoadError("The stored version history has an unexpected shape.");
  }
  const versions = parsed.versions.map(function (raw) {
    return normalizeVersionEntry(raw);
  });
  versions.sort(function (a, b) {
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  return { noteId: noteId, versions: versions };
}

/* Load one note's history through the store layer. The result is
   a record: {ok:true, existed, token, data} for a history that is
   safe to use (a missing folder or file is existed:false with an
   empty list), or {ok:false, error} when the stored history
   exists but could not be loaded safely, or the store could not
   be reached. Successful loads and unsafe loads are cached by
   note id; transient store failures are not cached, so a later
   save can try again. */
async function loadVersionHistory(noteId) {
  const cached = versionHistoryCache[noteId];
  if (cached) { return cached; }
  let record;
  try {
    const file = await storeGetFile(versionHistoryPath(noteId));
    if (!file) {
      record = {
        ok: true, existed: false, token: null,
        data: { noteId: noteId, versions: [] }
      };
    } else {
      record = {
        ok: true, existed: true, token: file.token || null,
        data: normalizeVersionHistoryData(noteId, JSON.parse(file.text))
      };
    }
  } catch (err) {
    record = { ok: false, existed: null, token: null, data: null, error: err };
    if (isVersionHistoryUnsafeError(err)) {
      versionHistoryCache[noteId] = record;
    }
    return record;
  }
  versionHistoryCache[noteId] = record;
  return record;
}

/* Queue one history maintenance entry (see the block comment at
   the top of this section for the offline design). */
function queueVersionHistoryMaintenance(noteId, path, previous, expectedContent, options) {
  options = options || {};
  queueOp({
    kind: "version-history",
    noteId: noteId,
    notePath: path || null,
    previous: previous ? cloneVersionValue(previous) : null,
    expectedContent: expectedContent ? cloneVersionValue(expectedContent) : null,
    verifyExpected: !!options.verifyExpected,
    forceSnapshot: !!options.forceSnapshot,
    capturedAt: new Date(options.nowMs || Date.now()).toISOString(),
    limit: versionsLimitValue(options.limit)
  });
}

/* Write one history file and refresh the cache record with the
   token the store returned. */
async function writeVersionHistoryData(noteId, data, expectedToken) {
  const token = await storePutFile(versionHistoryPath(noteId),
    JSON.stringify(data, null, 2), expectedToken || null,
    "Update version history for note " + noteId);
  versionHistoryCache[noteId] = {
    ok: true, existed: true, token: token || null,
    data: cloneVersionValue(data)
  };
  return token;
}

/* Delete the history file a safe load described. Used by the
   limit 0 maintenance path, which has already proven the stored
   history readable. */
async function deleteLoadedVersionHistory(noteId, loaded) {
  if (loaded && loaded.existed) {
    await storeDeleteFile(versionHistoryPath(noteId), loaded.token || null,
      "Remove version history for note " + noteId);
  }
  versionHistoryCache[noteId] = {
    ok: true, existed: false, token: null,
    data: { noteId: noteId, versions: [] }
  };
}

/* Best effort history deletion for Delete Forever. Deliberately
   independent of the load cache: permanent deletion of a note
   always tries to remove its history file, and any failure is
   reported only through the return value, never by blocking the
   note's own deletion. */
async function deleteVersionHistoryBestEffort(noteId) {
  try {
    const file = await storeGetFile(versionHistoryPath(noteId));
    if (file) {
      await storeDeleteFile(versionHistoryPath(noteId), file.token,
        "Delete version history with note " + noteId);
    }
    delete versionHistoryCache[noteId];
    return true;
  } catch (err) {
    return false;
  }
}

/* The one history maintenance pass. Given the previous saved
   snapshot and the facts of the save that just landed (or, from
   the queue, the facts of the save that is being flushed), it:
     - does nothing at all when the stored history cannot be
       loaded safely (status "skipped-load");
     - with a limit of 0, removes the stored history file
       (status "deleted") and offers no snapshots;
     - adds the previous snapshot when the caller says the save
       changed content (or forces it, for a restore), unless the
       newest snapshot is younger than the coalescing window;
     - prunes to the limit in force, dropping the oldest entries,
       which is also how a lowered limit takes effect on the next
       maintenance for a note, even when coalescing prevented a
       new snapshot;
     - writes the file only when something actually changed.
   A write that fails because the sign in expired or the network
   dropped is queued as a replay entry (unless the caller forbids
   deferral, as the queue flush does) and the cache is updated
   optimistically, so the History view shows the state the queue
   will land. A write conflict marks the cached history unsafe,
   so later saves skip rather than overwrite. */
async function maintainVersionHistory(noteId, previous, options) {
  options = options || {};
  if (!previous && !options.pruneOnly) { return { status: "no-previous" }; }
  const limit = versionsLimitValue(options.limit);
  const loaded = await loadVersionHistory(noteId);
  if (!loaded.ok) { return { status: "skipped-load", error: loaded.error }; }
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();

  if (limit === 0) {
    if (!loaded.existed && loaded.data.versions.length === 0) {
      return { status: "empty", data: cloneVersionValue(loaded.data) };
    }
    try {
      await deleteLoadedVersionHistory(noteId, loaded);
      return { status: "deleted" };
    } catch (err) {
      if ((err.offline || err.needsGoogleReconnect) &&
          options.allowDefer !== false) {
        queueVersionHistoryMaintenance(noteId, options.notePath || null,
          null, null, { limit: 0, nowMs: nowMs });
        versionHistoryCache[noteId] = {
          ok: true, existed: false, token: null,
          data: { noteId: noteId, versions: [] }
        };
        return { status: "queued" };
      }
      return { status: "delete-failed", error: err };
    }
  }

  const versions = loaded.data.versions.map(function (entry) {
    return cloneVersionValue(entry);
  });
  let changed = false;
  if ((options.forceSnapshot || options.contentChanged) && previous) {
    const newest = versions[0] || null;
    const newestMs = newest ? new Date(newest.createdAt).getTime() : NaN;
    if (options.forceSnapshot || !newest || isNaN(newestMs) ||
        nowMs - newestMs >= VERSION_COALESCE_MS) {
      versions.unshift({
        id: "v" + nowMs.toString(36) + "-" +
          Math.random().toString(36).slice(2, 8),
        createdAt: new Date(nowMs).toISOString(),
        title: previous.title,
        body: previous.body,
        tags: previous.tags.slice(),
        attachments: cloneVersionValue(previous.attachments)
      });
      changed = true;
    }
  }
  if (versions.length > limit) {
    versions.length = limit;
    changed = true;
  }
  if (!changed) {
    return { status: "unchanged", data: cloneVersionValue(loaded.data) };
  }
  const data = { noteId: noteId, versions: versions };
  try {
    await writeVersionHistoryData(noteId, data, loaded.token);
    return { status: "saved", data: cloneVersionValue(data) };
  } catch (err) {
    if (isStoreConflict(err)) {
      versionHistoryCache[noteId] = {
        ok: false, existed: loaded.existed, token: null, data: null, error: err
      };
      return { status: "skipped-conflict", error: err };
    }
    if ((err.offline || err.needsGoogleReconnect || !state.online) &&
        options.allowDefer !== false) {
      queueVersionHistoryMaintenance(noteId, options.notePath || null,
        previous, null, {
          forceSnapshot: !!options.forceSnapshot,
          limit: limit, nowMs: nowMs
        });
      versionHistoryCache[noteId] = {
        ok: true, existed: loaded.existed, token: null,
        data: cloneVersionValue(data)
      };
      return { status: "queued", data: cloneVersionValue(data) };
    }
    return { status: "write-failed", error: err };
  }
}

/* Apply one queued version-history entry during flushQueue. Runs
   after the note write it belongs to (queue order), verifies the
   note file that write left behind when the entry asks it to,
   and reports through its return value: unsafe stored histories
   and vanished expectations are a clean skip (the entry is
   consumed), while a store failure throws, so flushQueue keeps
   the entry and everything behind it for the next flush. */
async function flushVersionHistoryOp(op) {
  if (!op || !op.noteId) { return { status: "skipped-invalid" }; }
  if (versionsLimitValue(op.limit) !== 0 && !op.previous) {
    return { status: "skipped-invalid" };
  }
  if (op.verifyExpected) {
    if (!op.notePath || !op.expectedContent) {
      return { status: "skipped-unverifiable" };
    }
    const file = await storeGetFile(op.notePath);
    if (!file) { return { status: "skipped-missing-note" }; }
    const parsed = parseNoteFile(file.text, file.token, op.noteId, false);
    if (!versionContentEqual(noteContentSnapshot(parsed), op.expectedContent)) {
      return { status: "skipped-content-moved-on" };
    }
  }
  const result = await maintainVersionHistory(op.noteId, op.previous, {
    contentChanged: true,
    forceSnapshot: !!op.forceSnapshot,
    pruneOnly: !op.previous,
    limit: op.limit,
    nowMs: new Date(op.capturedAt).getTime() || Date.now(),
    notePath: op.notePath,
    allowDefer: false
  });
  if (result.status === "skipped-load") {
    if (isVersionHistoryUnsafeError(result.error)) { return result; }
    throw result.error || versionHistoryLoadError(
      "The version history could not be loaded during sync.");
  }
  if (result.status === "write-failed" || result.status === "delete-failed" ||
      result.status === "skipped-conflict") {
    throw result.error || new Error("The version history update failed during sync.");
  }
  return result;
}

