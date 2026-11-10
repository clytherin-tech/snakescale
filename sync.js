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
   8. Sync engine
   -------------------------------------------------------------------------- */

/* ------------------------------------------------------------------------
   index.json writes, coalesced (v1.4.4)

   index.json is a cache of the notebook list, nothing more: the notes
   and folders are the source of truth, and loadAllFromRepo already
   rebuilds the index from folder listings whenever it is missing or
   stale. Before v1.4.4 every saveIndex() call ran its own read plus
   write round trip, so creating a notebook paid for the .gitkeep write
   and then a full second write chain for the index. Now saveIndex()
   only records the newest state and schedules a write:

   - Calls are debounced by INDEX_WRITE_DEBOUNCE_MS, so a burst (three
     notebooks created in a row, a rename storm, seeding) collapses into
     a single write carrying the final state.
   - Writes never overlap. A call that lands while a write is in flight
     marks the state dirty, and exactly one follow up write runs with
     the final state. A burst therefore costs at most one in flight
     write plus one follow up.
   - The final state is always written: the loop only stops once a
     write has started from the newest state and no call arrived after
     it.
   - A failed write shows one toast per burst (from the write attempt
     itself), never one per call, and never throws into callers: the
     index heals on the next load, exactly as before.

   Callers that need the index physically on disk before they proceed
   await flushIndexWrites() instead: first run seeding (so the connect
   flow's immediate sync reads the seeded index) and syncNow (so its
   load never races a pending index write). A short debounce delay is
   otherwise safe precisely because the index is rebuildable.
   ------------------------------------------------------------------------ */
const INDEX_WRITE_DEBOUNCE_MS = 800;
let indexWriteTimer = null;     /* pending debounce timer, or null */
let indexWritePromise = null;   /* the running write loop, or null */
let indexWriteDirty = false;    /* state changed since the last write began */
let indexFlushWaiters = [];     /* flushIndexWrites() resolvers awaiting idle */

function buildIndexObject() {
  return {
    version: 1,
    /* v2.63: the notebook records ride wholesale,
       parent fields included, on the same reasoning as
       the tag map below: this is the only writer's
       shape, so no unrelated save can drop the nesting. */
    notebooks: state.notebooks,
    /* v2.30: the nested tag parent map. It rides every index
       write because buildIndexObject is the only writer's
       shape, so no unrelated save can drop the hierarchy. */
    tagParents: state.tagParents,
    /* v2.31: the shortcuts list, on the same reasoning: it
       rides every index write because this is the only
       writer's shape, so no unrelated save can drop it. */
    shortcuts: state.shortcuts,
    /* v2.32: the saved searches, on the same reasoning
       again: no unrelated save can drop them either. */
    savedSearches: state.savedSearches,
    /* v2.33: the home field, on the same reasoning once
       more: no unrelated save can drop the pinned note,
       the scratch pad, or the widget layout. */
    home: state.home,
    /* v2.38: the custom templates, on the same reasoning
       once more: no unrelated save can drop them either. */
    templates: state.templates,
    /* v2.89: the passage encryption record, on the same
       reasoning once more: no unrelated save can drop
       it, or every encrypted passage in the store
       becomes unreadable. */
    encryption: state.encryption,
    updated: new Date().toISOString()
  };
}

/* Schedule an index write from current state. Synchronous on purpose:
   state.index and the local cache update immediately, and the promise
   returned resolves at once, so existing "await saveIndex()" callers
   keep working at full speed while the storage write happens behind
   the debounce. */
function saveIndex() {
  state.index = buildIndexObject();
  saveCache();
  indexWriteDirty = true;
  /* v2.69: under a bulk operation's store write hold, the
     dirty flag is all that happens here; the hold's release
     arms the debounce (see holdCatalogWrites). */
  if (storeWriteHoldDepth > 0) { return Promise.resolve(); }
  if (indexWritePromise) {
    /* A write is already running. It snapshots state when it starts,
       so this call owes one follow up write; the running loop sees
       the dirty flag and performs it. */
    return Promise.resolve();
  }
  if (indexWriteTimer !== null) {
    /* A write is already scheduled inside the debounce window; it
       snapshots state when it starts, so it will carry this call's
       state too. */
    return Promise.resolve();
  }
  indexWriteTimer = setTimeout(function () {
    indexWriteTimer = null;
    runIndexWriteLoop();
  }, INDEX_WRITE_DEBOUNCE_MS);
  return Promise.resolve();
}

/* One physical index write, from a snapshot of current state. This is
   the same read token, then write sequence saveIndex() always used.
   Errors are reported once here and swallowed, exactly as the old
   saveIndex swallowed them: the index is rebuilt on the next load. */
async function writeIndexOnce() {
  const snapshot = buildIndexObject();
  state.index = snapshot;
  try {
    const existing = await storeGetFile("index.json");
    await storePutFile("index.json", JSON.stringify(snapshot, null, 2),
      existing ? existing.token : null, "Update index");
  } catch (err) {
    toast("Index update failed on " + storageDisplayName() + ": " +
      err.message, true);
  }
  saveCache();
}

/* The write loop: serializes every physical write, and keeps writing
   until a write has gone out with no newer state arriving behind it. */
function runIndexWriteLoop() {
  if (indexWritePromise) { return indexWritePromise; }
  indexWritePromise = (async function () {
    while (indexWriteDirty) {
      indexWriteDirty = false;
      await writeIndexOnce();
    }
  })();
  indexWritePromise.then(function () {
    indexWritePromise = null;
    settleIndexFlushWaiters();
  });
  return indexWritePromise;
}

function settleIndexFlushWaiters() {
  if (indexWriteTimer !== null || indexWritePromise || indexWriteDirty) {
    return;
  }
  const waiters = indexFlushWaiters;
  indexFlushWaiters = [];
  waiters.forEach(function (resolve) { resolve(); });
}

/* Resolve once every index write scheduled so far has landed (or
   failed safely). Forces a debounced write to start immediately
   instead of waiting out the timer. */
function flushIndexWrites() {
  if (indexWriteTimer !== null) {
    clearTimeout(indexWriteTimer);
    indexWriteTimer = null;
    runIndexWriteLoop();
  } else if (!indexWritePromise && indexWriteDirty) {
    runIndexWriteLoop();
  }
  if (!indexWritePromise && !indexWriteDirty && indexWriteTimer === null) {
    return Promise.resolve();
  }
  return new Promise(function (resolve) {
    indexFlushWaiters.push(resolve);
  });
}

/* Rebuild the whole index from folder listings. Used on load when
   index.json is missing, per spec. */
function buildIndexFromFolders(folderSlugs) {
  const known = {};
  state.notebooks.forEach(function (nb) { known[nb.slug] = nb; });
  const rebuilt = folderSlugs.map(function (slug) {
    if (known[slug]) { return known[slug]; }
    return {
      slug: slug,
      name: slug.replace(/-/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); }),
      created: new Date().toISOString()
    };
  });
  /* v2.30: a folder rebuild cannot see the tag hierarchy (it
     lives only in index.json), so the current map is carried
     across untouched; an absent index on a brand new store
     starts from the in-memory map, which is empty until tags
     are nested. */
  /* v2.31: the shortcuts list is carried across the same
     way, for the same reason. */
  /* v2.32: the saved searches are carried across the same
     way again, for the same reason. */
  /* v2.33: the home field is carried across the same way
     too, for the same reason. */
  /* v2.38: the custom templates are carried across the
     same way again, for the same reason. */
  return { version: 1, notebooks: rebuilt, tagParents: state.tagParents, shortcuts: state.shortcuts, savedSearches: state.savedSearches, home: state.home, templates: state.templates, encryption: state.encryption, updated: new Date().toISOString() };
}

/* --------------------------------------------------------------------------
   v2.20: catalog.json, the list cache, and incoming.json, the drop box

   Two small files join index.json at the store root. Both are
   created by the app itself, which is what makes the second one
   work at all: the app's Google permission (drive.file) only ever
   shows it files it created, so a note file an outside tool uploads
   into a notebook folder is invisible to the app, while the
   CONTENT of a file the app created is readable no matter who last
   wrote it. Outside tools therefore never create note files; they
   write note text into the drop box, and the app adopts it.

   catalog.json is a rebuildable cache of everything the notes
   list shows: per note, its title, notebook, collection (notebook,
   trash, or archive), tags, created and updated stamps, pin, the
   card preview text exactly as the card derives it, the card
   thumbnail facts, the Drive file id, and the freshness token (the
   same revision token the save path keeps as note.sha). The note
   .md files remain the only source of truth. A load reads the
   catalog, lists the folders' metadata (names, ids, tokens; no
   body downloads), and reconciles: an entry whose token and file
   id match its listing is trusted, so the list renders with zero
   note body downloads; a mismatch, an unlisted entry, or a listed
   file with no entry is corrected by downloading only that body
   (or dropping the entry). A note loaded from a trusted entry is
   a SHELL (bodyLoaded false, body null, previewText and the card
   attachment riding along) until something needs its body:
   opening it, saving it, or moving it fetches that one file
   through ensureNoteBodyLoaded first. A body this session already
   holds at the listing's token is kept, so in-session syncs lose
   nothing. Fallbacks: a missing, unparseable, or wrong shape
   catalog, a malformed entry, or a duplicate note id in the
   listings all run the classic full load below instead, and the
   catalog is rebuilt from whatever the load produced. The writer
   is saveIndex's twin: debounced, serialized, best effort,
   last writer wins (another device's catalog is just a stale
   cache, and reconciliation corrects it; catalog writes are never
   routed through the conflict rule), and a write never blocks,
   delays, or fails a note operation.

   incoming.json is the drop box: {notes: [one full note file text
   per entry, front matter plus HTML body, exactly as the app
   serializes a .md], rejected: [{entry, error, at}]}. It is
   created at store seeding and lazily by any load that finds it
   missing. After each load, syncNow runs processIncomingBox when
   the file's token moved since the last processed token: valid
   entries become real app created notes through the normal save
   machinery, duplicates (same note id anywhere in the store) are
   skipped, entries naming a missing notebook land in the first
   notebook and are flagged in the report, attachment records are
   stripped (their files live outside the app's visibility) and
   counted, and malformed entries move to rejected with a reason
   and are never retried. Cleanup re-reads the file fresh and
   subtracts exactly the processed entry strings, so an entry an
   outside writer appends mid cleanup survives to the next sync;
   a write back that loses the token race leaves the file alone
   and lets the next sync retry, with the duplicate skip as the
   guard against importing twice. The README documents the format
   for other tools.

   v2.23: an entry may also be an object, {note: "<the same note
   file text>", attachments: [{name, mimeType, dataBase64}]},
   carrying its files with it. The note text runs the identical
   pipeline (its own front matter attachment records are still
   stripped: those files remain outside the app's visibility),
   and each carried attachment is base64 decoded and uploaded
   through the app's own attachment machinery into the store
   attachments folder, becoming an ordinary attachment record on
   the note: images are appended inline at the end of the body,
   other files as attachment blocks there. Caps: 10 MB decoded
   per attachment and 25 MB decoded per entry; an item over a
   cap is skipped and named in the report, an item whose upload
   fails is counted and named, and the note imports either way
   with whatever landed. The duplicate skip runs before any
   upload, so reprocessing an entry never orphans files, and
   cleanup tells entries apart by a type tagged key, so a
   string entry and an object entry holding the same note text
   remain two entries.

   Auto-sync corpus: both files' Drive ids join the known ids on
   every load (the load resolves them, which is what the corpus
   builder reads). A change to catalog.json alone never triggers
   a sync (it is a cache, and reacting to it would loop on the
   app's own writes); a change to incoming.json does, except the
   echo of this device's own cleanup write, whose token is the
   last processed token.
   -------------------------------------------------------------------------- */
const CATALOG_FILE = "catalog.json";
const INCOMING_FILE = "incoming.json";
/* v2.32: shape 2 adds each note's checklist facts and
   attachment MIME types (see buildCatalogEntry), so the
   advanced search operators todo: and resource: can judge
   a catalog shell exactly as they judge a loaded note. A
   shape 1 catalog is simply not read (the classic load
   runs once and the catalog is rebuilt at shape 2).
   v2.35: shape 3 adds each note's reminder pair
   (reminderAt, reminderDoneAt), so the list can show the
   reminder marker, the Reminders view can gather its
   notes, and the reminder search operators can judge a
   shell, all before any note file is fetched. A shape 2
   catalog is not read, by the same rule.
   v2.120: shape 4 adds each note's cardExtImage (the
   address of its first image when that image is an
   external, web hosted one), so a shell's card can show
   the poster thumbnail before any note file is fetched.
   A shape 3 catalog is not read, by the same rule. */
const CATALOG_SHAPE_VERSION = 4;
const CATALOG_WRITE_DEBOUNCE_MS = 800;

let catalogWriteTimer = null;      /* pending debounce timer, or null */
let catalogWritePromise = null;    /* the running write loop, or null */
let catalogWriteDirty = false;     /* state changed since the last write began */
let catalogFlushWaiters = [];      /* flushCatalogWrites() resolvers */
let lastCatalogToken = null;       /* token of the catalog last read or written */
let lastCatalogEntriesText = null; /* its entries, serialized; the change test */
let catalogArmed = false;          /* true once a load completed this session */
let pendingIncoming = null;        /* {token, notes, rejected} from the load */
let incomingProcessedToken = null; /* token of the box last fully processed */
const noteBodyLoads = Object.create(null); /* note id -> in flight body load */

/* The catalog entry for one note, in the collection named. Every
   field comes from the note object; a shell contributes its
   catalog born fields (previewText, shellCardAtt, attachmentCount)
   instead of body derived ones, so a catalog built over shells
   round trips its own facts unchanged. */
function buildCatalogEntry(note, collection) {
  const loaded = note.bodyLoaded !== false;
  const cardAtt = loaded ? cardThumbnailAttachment(note)
    : (note.shellCardAtt || null);
  /* v2.120: the card's external image address, the
     shellCardAtt pattern over cardThumbnailExternalOf:
     a loaded note derives it from its body (a chosen
     thumbnail stands in the way, as it does on the
     card itself); a shell contributes the address its
     own entry carried. */
  const cardExt = loaded
    ? (note.thumbnail ? null : cardThumbnailExternalOf(note))
    : (note.shellCardExtImage || null);
  /* v2.32: the search facts. A loaded note derives them
     from its body and its attachment records; a shell
     contributes the facts its own entry carried, so a
     catalog built over shells round trips them unchanged,
     the shellCardAtt pattern. They exist so the advanced
     search operators todo: and resource: can judge a
     shell without fetching its file. */
  const todoFacts = loaded ? checklistFactsFromHtml(note.body) : null;
  return {
    id: note.id,
    collection: collection,
    title: note.title || "Untitled note",
    notebook: note.notebook || "",
    trashedFrom: note.trashedFrom || null,
    archivedFrom: note.archivedFrom || null,
    tags: (note.tags || []).slice(),
    created: note.created || "",
    updated: note.updated || "",
    pinned: !!note.pinned,
    preview: loaded ? htmlToText(note.body).slice(0, 140)
      : (note.previewText || ""),
    thumbnail: note.thumbnail || null,
    /* v2.35: the reminder pair. It lives directly on the
       note object for shells and loaded notes alike (a
       shell's pair came from its own entry), so one read
       serves both, no shell twin fields needed. */
    reminderAt: note.reminderAt || null,
    reminderDoneAt: note.reminderDoneAt || null,
    cardAttachment: cardAtt
      ? (sanitizeAttachments([cloneVersionValue(cardAtt)])[0] || null)
      : null,
    /* v2.120: the external card image address (see
       cardExt above); a plain string, no record. */
    cardExtImage: cardExt,
    attachmentCount: loaded ? (note.attachments || []).length
      : (note.attachmentCount || 0),
    todoChecked: loaded ? todoFacts.checked
      : !!note.shellTodoChecked,
    todoUnchecked: loaded ? todoFacts.unchecked
      : !!note.shellTodoUnchecked,
    attachmentMimes: loaded
      ? (note.attachments || []).map(function (a) {
          return String((a && a.mime) || "").toLowerCase();
        })
      : (Array.isArray(note.shellAttachmentMimes)
          ? note.shellAttachmentMimes.slice()
          : (cardAtt && cardAtt.mime
              ? [String(cardAtt.mime).toLowerCase()] : [])),
    fileId: note.fileId || driveCache.fileIds[notePath(note)] || null,
    token: note.sha || null
  };
}

function buildCatalogObject() {
  const entries = [];
  state.notes.forEach(function (note) {
    entries.push(buildCatalogEntry(note, "notebook"));
  });
  state.trash.forEach(function (note) {
    entries.push(buildCatalogEntry(note, "trash"));
  });
  state.archive.forEach(function (note) {
    entries.push(buildCatalogEntry(note, "archive"));
  });
  return {
    version: CATALOG_SHAPE_VERSION,
    updated: new Date().toISOString(),
    entries: entries
  };
}

/* Schedule a catalog write from current state. Mirrors saveIndex:
   inert until this session has completed a store load (so a write
   can never be built from pre load cache state and clobber a good
   catalog ahead of the load that would have read it), debounced,
   and serialized behind any write already running. */
function saveCatalog() {
  if (!state.repoExists || !catalogArmed) { return; }
  catalogWriteDirty = true;
  /* v2.69: under a bulk operation's store write hold, the
     dirty flag is all that happens here; the hold's release
     arms the debounce (see holdCatalogWrites). */
  if (storeWriteHoldDepth > 0) { return; }
  if (catalogWritePromise) { return; }
  if (catalogWriteTimer !== null) { return; }
  catalogWriteTimer = setTimeout(function () {
    catalogWriteTimer = null;
    runCatalogWriteLoop();
  }, CATALOG_WRITE_DEBOUNCE_MS);
}

/* One physical catalog write, from a snapshot of current state.
   Unchanged entries write nothing at all. A lost token race is
   retried once over the winner's token (last writer wins; the
   file is a cache, never a conflict copy candidate), and every
   failure is swallowed: the next load reconciles or rebuilds. */
async function writeCatalogOnce() {
  const snapshot = buildCatalogObject();
  const entriesText = JSON.stringify(snapshot.entries);
  if (entriesText === lastCatalogEntriesText) { return; }
  const text = JSON.stringify(snapshot, null, 2);
  try {
    lastCatalogToken = await storePutFile(CATALOG_FILE, text,
      lastCatalogToken, "Update catalog");
    lastCatalogEntriesText = entriesText;
  } catch (err) {
    if (!isStoreConflict(err)) { return; }
    try {
      const fresh = await storeGetFile(CATALOG_FILE);
      lastCatalogToken = await storePutFile(CATALOG_FILE, text,
        fresh ? fresh.token : null, "Update catalog");
      lastCatalogEntriesText = entriesText;
    } catch (err2) { /* swallowed: rebuilt on the next load */ }
  }
}

function runCatalogWriteLoop() {
  if (catalogWritePromise) { return catalogWritePromise; }
  catalogWritePromise = (async function () {
    while (catalogWriteDirty) {
      catalogWriteDirty = false;
      await writeCatalogOnce();
    }
  })();
  catalogWritePromise.then(function () {
    catalogWritePromise = null;
    settleCatalogFlushWaiters();
  });
  return catalogWritePromise;
}

function settleCatalogFlushWaiters() {
  if (catalogWriteTimer !== null || catalogWritePromise ||
      catalogWriteDirty) {
    return;
  }
  const waiters = catalogFlushWaiters;
  catalogFlushWaiters = [];
  waiters.forEach(function (resolve) { resolve(); });
}

/* Resolve once every catalog write scheduled so far has landed
   (or failed safely). syncNow flushes before its load, the same
   discipline flushIndexWrites gives index.json. */
function flushCatalogWrites() {
  if (catalogWriteTimer !== null) {
    clearTimeout(catalogWriteTimer);
    catalogWriteTimer = null;
    runCatalogWriteLoop();
  } else if (!catalogWritePromise && catalogWriteDirty) {
    runCatalogWriteLoop();
  }
  if (!catalogWritePromise && !catalogWriteDirty &&
      catalogWriteTimer === null) {
    return Promise.resolve();
  }
  return new Promise(function (resolve) {
    catalogFlushWaiters.push(resolve);
  });
}

/* --------------------------------------------------------------------------
   v2.69: the bulk operations' store write hold. While a bulk
   operation runs, the per-item saveCache and saveIndex calls
   along its paths still mark their writes dirty, but neither
   scheduler arms its debounce timer; when the last hold
   releases, each scheduler that went dirty arms its usual
   debounce through its own entry point, so the whole
   operation lands exactly one coalesced catalog write (and
   one index write, when the operation changed anything the
   index carries) instead of one write per item plus whatever
   the debounce happened to split a long operation into.
   Taking the first hold also cancels a debounce armed just
   before the operation started, for the same reason: its
   write would otherwise land mid operation. A write loop
   already running is left alone; it snapshots current state
   per write and the dirty flag still owes it a follow up.
   flushCatalogWrites and flushIndexWrites keep their
   contract and ignore the hold: a sync that flushes mid
   operation still writes, exactly as a flush landing mid
   burst could before. The hold is a depth counter, so an
   operation nested inside another's hold (a merge's trash
   phase inside the merge's own hold, say) releases only its
   own level. ------------------------------------------------------------------------ */
let storeWriteHoldDepth = 0;

function holdCatalogWrites() {
  if (storeWriteHoldDepth === 0) {
    if (catalogWriteTimer !== null) {
      clearTimeout(catalogWriteTimer);
      catalogWriteTimer = null;
    }
    if (indexWriteTimer !== null) {
      clearTimeout(indexWriteTimer);
      indexWriteTimer = null;
    }
  }
  storeWriteHoldDepth++;
}

function releaseCatalogWrites() {
  if (storeWriteHoldDepth > 0) { storeWriteHoldDepth--; }
  if (storeWriteHoldDepth > 0) { return; }
  if (catalogWriteDirty) { saveCatalog(); }
  if (indexWriteDirty) { saveIndex(); }
}

