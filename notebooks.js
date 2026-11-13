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
   Notebook operations
   A notebook exists as soon as a file sits under notebooks/<slug>/.
   Creating a notebook writes a .gitkeep file and updates index.json.
   Renaming moves every note file to the new folder.
   Deleting a notebook moves its notes to Trash (never destroys them),
   after a confirm in the UI layer.
   -------------------------------------------------------------------------- */
async function createNotebook(name) {
  const slug = uniqueSlug(slugify(name), null);
  const nb = { slug: slug, name: String(name).trim(), created: new Date().toISOString() };
  state.notebooks.push(nb);
  /* v1.4.4: the notebook appears immediately. Before this change the
     list only re-rendered after the .gitkeep write AND the index write
     had both completed, which on Google Drive took a few seconds of
     staring at an unchanged sidebar. The state change is the truth the
     user acts on, and it is already cached locally below, so the
     storage writes now run in the background instead. */
  saveCache();
  renderAll();
  if (state.online && state.repoExists) {
    /* Background writes, in the same order as before (folder marker,
       then index). The .gitkeep put is flagged fresh: the slug was
       just made unique, so the file cannot exist yet and the Drive
       driver may skip its existence check listing. Failure handling is
       unchanged from the blocking version: the same toast wording, and
       the notebook itself is already safe in local state and cache,
       the same protection the old try/catch relied on. */
    storePutFile("notebooks/" + slug + "/.gitkeep", "", null,
      "Create notebook " + slug, { fresh: true })
      .then(function () { saveIndex(); })
      .catch(function (err) {
        toast("Notebook saved locally; " + storageDisplayName() +
          " write failed: " + err.message, true);
      });
  } else {
    queueOp({ kind: "put", path: "notebooks/" + slug + "/.gitkeep", content: "", noteId: null });
  }
  return nb;
}

/* v2.147: create a sub notebook under an existing
   notebook, from the notebook menu's Create
   Sub-notebook item. The record is createNotebook's
   shape plus the parent field the tree reads, and the
   persistence is createNotebook's shape too: the state
   change and the render land at once, and the folder
   marker and index writes run behind them. The parent
   is expanded first, so the new sub notebook is
   visible where it lands (the stack assignment's
   standing rule for a filed notebook). */
async function createSubNotebook(parentSlug, name) {
  const parent = state.notebooks.find(function (n) {
    return n.slug === parentSlug;
  });
  if (!parent) { return null; }
  const slug = uniqueSlug(slugify(name), null);
  const nb = { slug: slug, name: String(name).trim(),
    created: new Date().toISOString(), parent: parentSlug };
  state.notebooks.push(nb);
  const ci = state.collapsedNotebooks.indexOf(parentSlug);
  if (ci >= 0) {
    state.collapsedNotebooks.splice(ci, 1);
    saveSettings();
  }
  saveCache();
  renderAll();
  if (state.online && state.repoExists) {
    storePutFile("notebooks/" + slug + "/.gitkeep", "", null,
      "Create notebook " + slug, { fresh: true })
      .then(function () { saveIndex(); })
      .catch(function (err) {
        toast("Notebook saved locally; " + storageDisplayName() +
          " write failed: " + err.message, true);
      });
  } else {
    queueOp({ kind: "put", path: "notebooks/" + slug + "/.gitkeep", content: "", noteId: null });
  }
  return nb;
}

async function renameNotebook(slug, newName) {
  const nb = state.notebooks.find(function (n) { return n.slug === slug; });
  if (!nb) { return; }
  const newSlug = uniqueSlug(slugify(newName), slug);
  nb.name = String(newName).trim();
  if (newSlug === slug) {
    if (state.online && state.repoExists) { await saveIndex(); }
    saveCache();
    renderAll();
    return;
  }
  /* Move every note file to the new folder, then remove the old files. */
  const moving = state.notes.filter(function (n) { return n.notebook === slug; });
  for (const note of moving) {
    const oldPath = notePath(note);
    /* v2.20: the move rewrites the note's file text, so a catalog
       shell is completed at its CURRENT path first (before the
       notebook flip below changes where its file is looked for). */
    if (note.bodyLoaded === false) {
      await ensureNoteBodyLoaded(note);
      if (note.bodyLoaded === false) {
        toast("Rename partly failed for one note: its content is " +
          "not loaded on this device yet.", true);
        continue;
      }
    }
    note.notebook = newSlug;
    if (state.online && state.repoExists) {
      try {
        note.sha = await storePutFile(notePath(note), serializeNote(note), null,
          "Move note to renamed notebook");
        const oldFile = await storeGetFile(oldPath);
        if (oldFile) { await storeDeleteFile(oldPath, oldFile.token, "Remove old note location"); }
      } catch (err) {
        toast("Rename partly failed for one note: " + err.message, true);
      }
    } else {
      queueOp({ kind: "put", path: notePath(note), content: serializeNote(note), noteId: note.id });
      queueOp({ kind: "delete", path: oldPath, noteId: note.id });
      note.sha = null;
    }
  }
  /* Move the folder marker too. A notebook created in the app carries a
     .gitkeep; leaving it behind would keep the old folder alive in store
     listings (a real folder on Drive) and the
     old notebook would reappear on the next load. The new marker also
     materializes the renamed folder when the notebook has no notes. */
  if (state.online && state.repoExists) {
    try {
      await storePutFile("notebooks/" + newSlug + "/.gitkeep", "", null,
        "Create renamed notebook folder");
      const oldKeep = await storeGetFile("notebooks/" + slug + "/.gitkeep");
      if (oldKeep) {
        await storeDeleteFile("notebooks/" + slug + "/.gitkeep", oldKeep.token,
          "Remove old notebook folder marker");
      }
    } catch (err) {
      toast("Rename partly failed for the notebook folder marker: " + err.message, true);
    }
  } else {
    queueOp({ kind: "put", path: "notebooks/" + newSlug + "/.gitkeep", content: "", noteId: null });
    queueOp({ kind: "delete", path: "notebooks/" + slug + "/.gitkeep", noteId: null });
  }
  nb.slug = newSlug;
  /* v2.31: a notebook shortcut names its notebook by slug,
     so it follows the rename to the new slug here, before
     the save below writes the index that carries both. */
  shortcutsFollowRename("notebook", slug, newSlug);
  /* v2.63: sub-notebooks name their parent by slug, so
     they follow the rename like the shortcut above, and
     the fold record (per-device settings) follows too,
     both before the save below writes the index. */
  state.notebooks.forEach(function (kid) {
    if (notebookParentOf(kid) === slug) { kid.parent = newSlug; }
  });
  const nci = state.collapsedNotebooks.indexOf(slug);
  if (nci >= 0) {
    state.collapsedNotebooks[nci] = newSlug;
    saveSettings();
  }
  if (state.view.kind === "notebook" && state.view.value === slug) {
    state.view.value = newSlug;
  }
  if (state.online && state.repoExists) { await saveIndex(); }
  saveCache();
  renderAll();
}

/* v2.147: Chris's delete rule replaces the v2.63
   promotion. Deleting a notebook deletes everything
   inside it: every note in the notebook and in its
   whole subtree moves to Trash through the standard
   note deletion path (moveNoteToTrash, the same path
   deleting a note by hand takes, so the notes land
   where that path lands them), every sub notebook is
   removed with it, and then the notebook itself is
   removed. The UI layer's warning (render.js) states
   the rule and the counts before this runs.
   Persistence keeps the standing shape, widened to
   the subtree: every removed notebook's shortcut
   drops (its notes' shortcuts stay: those notes are
   in Trash now, where a shortcut renders as
   unavailable), the fold records prune, each removed
   notebook's folder marker is deleted, and the index
   save carries the new tree. A failed cleanup step
   is named in a toast, never silent, and the local
   removal stands either way (the v2.143 honesty
   rule); a load that later rebuilds the index from
   folders settles any marker a failed step left. */
async function deleteNotebook(slug) {
  const subtree = [slug].concat(notebookDescendantsOf(slug));
  const doomed = state.notes.filter(function (n) {
    return subtree.indexOf(n.notebook) >= 0;
  });
  for (const note of doomed) {
    await moveNoteToTrash(note, true);
  }
  subtree.forEach(function (s) { shortcutsDrop("notebook", s); });
  state.notebooks = state.notebooks.filter(function (n) {
    return subtree.indexOf(n.slug) < 0;
  });
  pruneCollapsedNotebooks();
  saveSettings();
  if (state.online && state.repoExists) {
    try {
      for (const s of subtree) {
        const keep = await storeGetFile("notebooks/" + s + "/.gitkeep");
        if (keep) {
          await storeDeleteFile("notebooks/" + s + "/.gitkeep", keep.token,
            "Delete notebook " + s);
        }
      }
      await saveIndex();
    } catch (err) {
      toast("Notebook removed locally; a " + storageDisplayName() +
        " cleanup step failed: " + err.message, true);
    }
  }
  if (state.view.kind === "notebook" &&
      subtree.indexOf(state.view.value) >= 0) {
    state.view = { kind: "all", value: null };
  }
  saveCache();
  renderAll();
}

/* --------------------------------------------------------------------------
   v2.29: notebook stacks (Evernote parity phase 1)

   A stack is a named group of notebooks, Evernote's one level of
   hierarchy above notebooks: a notebook belongs to at most one
   stack, stacks do not nest, and a stack is only a grouping, never
   a container (deleting one deletes nothing but the grouping).
   The grouping lives entirely in index.json: each notebook entry
   gains an optional "stack" field holding the stack's NAME, absent
   for an ungrouped notebook. No note file changes.

   Plumbing, verified rather than assumed: buildIndexObject writes
   state.notebooks wholesale and loadAllFromRepo reads index.json's
   notebooks wholesale (there is no per notebook sanitize step to
   extend), the local cache snapshot carries the same objects, and
   buildIndexFromFolders returns known notebook objects whole, so
   the field survives save, load, cache, and folder rebuild paths
   untouched. renameNotebook mutates the notebook object in place,
   so membership rides a rename without any work here. A hand
   edited index.json is still safe: notebookStackOf treats a
   non string or blank stack as no stack at all.
   -------------------------------------------------------------------------- */

/* The stack a notebook belongs to, or null. The one read of the
   raw field, so every consumer gets the normalized answer. */
function notebookStackOf(nb) {
  if (!nb || typeof nb.stack !== "string") { return null; }
  return nb.stack.trim() ? nb.stack : null;
}

/* The names of every stack that exists, in the order the stacks
   first appear in the notebook list. A stack exists exactly while
   at least one notebook carries its name (Evernote: a stack
   disappears when its last notebook leaves). */
function stackNames() {
  const names = [];
  state.notebooks.forEach(function (nb) {
    const s = notebookStackOf(nb);
    if (s && names.indexOf(s) < 0) { names.push(s); }
  });
  return names;
}

/* Whether a stack name is taken, compared the way a person means
   it (case insensitively; "Work" and "work" are one grouping).
   exceptName names the stack being renamed, which may keep or
   re-case its own name. */
function stackNameTaken(name, exceptName) {
  const wanted = String(name || "").toLowerCase();
  return stackNames().some(function (s) {
    return s.toLowerCase() === wanted && s !== exceptName;
  });
}

/* The member notebooks of a stack, in notebook list order. */
function stackMembers(name) {
  return state.notebooks.filter(function (nb) {
    return notebookStackOf(nb) === name;
  });
}

/* Drop stack fold records for stacks that no longer exist, so a
   rename or delete leaves settings clean. Called before every
   settings write of the fold list from this section. */
function pruneCollapsedStacks() {
  const live = stackNames();
  state.collapsedStacks = state.collapsedStacks.filter(function (n) {
    return live.indexOf(n) >= 0;
  });
}

/* Put a notebook into a stack (a name), or take it out (null).
   State first and re-render at once, with the index write behind
   it, exactly the shape createNotebook established. Assigning
   also expands the target stack: the notebook the user just
   filed must be visible where it landed. */
async function setNotebookStack(slug, stackName) {
  const nb = state.notebooks.find(function (n) { return n.slug === slug; });
  if (!nb) { return; }
  if (stackName) {
    /* v2.63: stacks group top level notebooks, so joining
       a stack lifts a nested notebook back to top level;
       its own sub-notebooks stay nested under it. */
    if ("parent" in nb) { delete nb.parent; }
    nb.stack = stackName;
    const ci = state.collapsedStacks.indexOf(stackName);
    if (ci >= 0) { state.collapsedStacks.splice(ci, 1); }
  } else {
    delete nb.stack;
  }
  pruneCollapsedStacks();
  saveSettings();
  if (state.online && state.repoExists) { await saveIndex(); }
  saveCache();
  renderAll();
}

/* v2.130: the per-notebook Doc switch (v2.121) is
   gone. Through v2.129 a notebook record could carry a
   docStore field routing its new notes to Google Docs;
   the library conversion finished on November 11,
   2026, and every notebook now stores new notes as
   Google Docs (markNoteDocBacked in store.js), so
   there is nothing left for a switch to decide. A
   stored field, where an index still carries one, is
   ignored everywhere: the index writer drops it
   (buildIndexObject in sync.js), and the index
   adoption strips it from the records it takes in
   (loadAllFromRepo in tasks.js), so no session carries
   it forward. */

/* Rename a stack: the field on every member notebook changes,
   nothing else about any notebook does. The fold record follows
   the name. Callers validate the new name first (see
   promptRenameStack). */
async function renameStack(oldName, newName) {
  if (oldName === newName) { return; }
  state.notebooks.forEach(function (nb) {
    if (notebookStackOf(nb) === oldName) { nb.stack = newName; }
  });
  /* v2.31: a stack shortcut names the stack, so it follows
     the rename like the members do. */
  shortcutsFollowRename("stack", oldName, newName);
  const ci = state.collapsedStacks.indexOf(oldName);
  if (ci >= 0) {
    state.collapsedStacks[ci] = newName;
    saveSettings();
  }
  if (state.online && state.repoExists) { await saveIndex(); }
  saveCache();
  renderAll();
}

/* Delete a stack: the grouping only. Every member notebook keeps
   its notes and returns to the ungrouped list, which is the whole
   of the operation (there is nothing stored anywhere else to
   remove, and the stack ceases to exist the moment no notebook
   carries its name). */
async function deleteStack(name) {
  state.notebooks.forEach(function (nb) {
    if (notebookStackOf(nb) === name) { delete nb.stack; }
  });
  /* v2.31: the stack's shortcut goes with the grouping;
     the notebooks it pointed at keep theirs. */
  shortcutsDrop("stack", name);
  const ci = state.collapsedStacks.indexOf(name);
  if (ci >= 0) {
    state.collapsedStacks.splice(ci, 1);
    saveSettings();
  }
  if (state.online && state.repoExists) { await saveIndex(); }
  saveCache();
  renderAll();
}

/* --------------------------------------------------------------------------
   v2.63: nested notebooks

   Evernote's model: notebooks nest inside notebooks, any
   depth, shown as a tree in the sidebar; a notebook's
   notes belong to the notebook itself, wherever it sits.
   Here the nesting is one optional field on the flat
   notebook record that has always lived in index.json:
   parent, the SLUG of the parent notebook, absent (or
   null) at top level. The Drive folders stay flat per
   slug and a note's notebook field never changes when
   its notebook is nested or moved; this is organization
   only, like the tag parent map.

   The field is plumbed and sanitized like tagParents:
   buildIndexObject writes the records wholesale, and
   sanitizeNotebookParents runs on every adoption of a
   notebooks array (the cache snapshot and both store
   load branches): a parent naming a missing notebook,
   the notebook itself, or a cycle degrades to top level
   on load, never a crash or a vanished notebook, and an
   index written before nesting existed loads unchanged.

   Stacks interplay, the conservative rule: stacks group
   top level notebooks. Nesting a stacked notebook
   removes it from its stack (the stack keeps the rest),
   a nested notebook appears in no stack listing, and
   unnesting does not restore any old membership. The
   mirror also holds, in setNotebookStack: joining a
   stack lifts a nested notebook back to top level, its
   own sub-notebooks still nested under it.

   The sidebar renders the tree depth-first, alphabetical
   within each level, each row keeping its own note
   count. A notebook with children carries a fold caret
   in the tag tree's disclosure style; folds are the
   per-device settings list collapsedNotebooks, default
   expanded. Notebooks nest by dragging a row onto
   another (mouse or pen by movement, touch by long
   press; in rail mode the flyout's rows and head run
   the same drag, v2.67) and unnest by dragging onto
   the Notebooks section header; the notebook menu's
   Move to panel offers the same moves without a drag. Deleting a notebook
   deletes the notes inside it and removes its
   sub-notebooks with it (v2.147, Chris's rule, stated
   by the menu's warning before it runs).
   -------------------------------------------------------------------------- */

/* The normalized parent slug of a notebook record: the
   stored string, trimmed, or null when the field is
   absent, blank, not a string, or names the notebook
   itself. Existence is the sanitizer's concern, not this
   reader's; every render and write path below works
   through this one normalization, so a damaged value is
   read as top level everywhere consistently. */
function notebookParentOf(nb) {
  if (!nb || typeof nb.parent !== "string") { return null; }
  const p = nb.parent.trim();
  if (!p || p === nb.slug) { return null; }
  return p;
}

/* A notebook's direct sub-notebooks, in the sidebar's
   alphabetical order (compareSidebarNames), the order
   every level of the tree renders in. */
function notebookChildrenOf(slug) {
  return state.notebooks.filter(function (nb) {
    return notebookParentOf(nb) === slug;
  }).sort(function (x, y) {
    return compareSidebarNames(x.name, y.name);
  });
}

/* Every notebook below a slug in its subtree, breadth
   first and cycle safe (the visited set does the safety,
   the same shape as tagDescendantsOf): the set a move
   must never target and a delete promotes as a group. */
function notebookDescendantsOf(slug) {
  const out = [];
  const seen = {};
  seen[slug] = true;
  const queue = [slug];
  while (queue.length) {
    const cur = queue.shift();
    notebookChildrenOf(cur).forEach(function (kid) {
      if (seen[kid.slug]) { return; }
      seen[kid.slug] = true;
      out.push(kid.slug);
      queue.push(kid.slug);
    });
  }
  return out;
}

/* A notebook's depth in the tree (0 at top level), by
   walking its parents; the visited set and the missing
   parent break keep a damaged chain from looping or
   inflating the count. The Move to panel indents by it. */
function notebookDepthOf(nb) {
  let depth = 0;
  const seen = {};
  let cur = nb;
  while (cur && notebookParentOf(cur) !== null) {
    const p = notebookParentOf(cur);
    if (seen[p]) { break; }
    seen[p] = true;
    const parent = notebookForSlug(p);
    if (!parent) { break; }
    depth += 1;
    cur = parent;
  }
  return depth;
}

/* Bring the parent fields on state.notebooks to a safe
   shape, in place, on every load path (the tag parent
   sanitizer's discipline): a parent that is not a string,
   is blank, names the notebook itself, or names a
   notebook that does not exist is dropped, so the
   notebook sits at top level; a parent and a stack
   cannot both stand (stacks group top level notebooks),
   and the parent wins because it is the field this pass
   is responsible for; where parents form a cycle, every
   notebook in the loop drops its parent and goes to top
   level. Nothing is ever removed from the array: a
   damaged parent costs a notebook its nesting, never
   the notebook. */
function sanitizeNotebookParents() {
  const bySlug = {};
  state.notebooks.forEach(function (nb) {
    if (nb && typeof nb.slug === "string") { bySlug[nb.slug] = nb; }
  });
  state.notebooks.forEach(function (nb) {
    if (!nb) { return; }
    if (typeof nb.parent !== "string" || !nb.parent.trim() ||
        nb.parent.trim() === nb.slug || !bySlug[nb.parent.trim()]) {
      if ("parent" in nb) { delete nb.parent; }
    } else if (nb.parent !== nb.parent.trim()) {
      nb.parent = nb.parent.trim();
    }
  });
  state.notebooks.forEach(function (nb) {
    if (nb && notebookParentOf(nb) !== null && notebookStackOf(nb)) {
      delete nb.stack;
    }
  });
  state.notebooks.forEach(function (nb) {
    if (!nb || notebookParentOf(nb) === null) { return; }
    const chain = [];
    let cur = nb;
    while (cur && notebookParentOf(cur) !== null) {
      const pSlug = notebookParentOf(cur);
      const at = chain.indexOf(pSlug);
      if (at >= 0) {
        const loop = chain.slice(at);
        if (loop.indexOf(cur.slug) < 0) { loop.push(cur.slug); }
        loop.forEach(function (s) {
          const member = bySlug[s];
          if (member) { delete member.parent; }
        });
        break;
      }
      chain.push(cur.slug);
      cur = bySlug[pSlug] || null;
    }
  });
}

/* Drop fold records for notebooks that no longer have
   sub-notebooks (or no longer exist), the stack and tag
   prunes' rule, run before the settings record is
   written from a flow that changed the tree. */
function pruneCollapsedNotebooks() {
  state.collapsedNotebooks = state.collapsedNotebooks.filter(
    function (slug) {
      const nb = notebookForSlug(slug);
      return !!nb && notebookChildrenOf(slug).length > 0;
    });
}

/* Fold or unfold one notebook's subtree in the sidebar.
   The fold is per-device view state, so it saves
   settings and re-renders the sidebar only, the tag
   fold's exact shape. */
function toggleNotebookCollapsed(slug) {
  const i = state.collapsedNotebooks.indexOf(slug);
  if (i >= 0) { state.collapsedNotebooks.splice(i, 1); }
  else { state.collapsedNotebooks.push(slug); }
  saveSettings();
  renderSidebar();
}

/* The one write path for nesting, shared by the drag and
   the Move to panel: nest slug under parentSlug, or move
   it to top level when parentSlug is null. Refusals are
   plain toasts and a false return (a notebook inside
   itself, inside one of its own sub-notebooks, or under
   a notebook that is gone); a move to the parent it
   already has is a no-op false, so callers never write
   the index for nothing. Nesting clears any stack
   membership (stacks group top level notebooks) and
   expands the new parent, so the moved notebook lands
   visible. Persistence is the notebook operations'
   standing shape: prune the folds, save settings, save
   the index, save the cache, re-render. */
async function setNotebookParent(slug, parentSlug) {
  const nb = notebookForSlug(slug);
  if (!nb) { return false; }
  const target = (typeof parentSlug === "string" && parentSlug.trim())
    ? parentSlug.trim() : null;
  if (target !== null) {
    if (target === slug) {
      toast("A notebook cannot be nested inside itself.", true);
      return false;
    }
    if (!notebookForSlug(target)) {
      toast("That notebook no longer exists.", true);
      return false;
    }
    if (notebookDescendantsOf(slug).indexOf(target) >= 0) {
      toast("A notebook cannot be nested inside one of its " +
        "own sub-notebooks.", true);
      return false;
    }
  }
  if (notebookParentOf(nb) === target) { return false; }
  if (target === null) {
    delete nb.parent;
  } else {
    nb.parent = target;
    delete nb.stack;
    const ci = state.collapsedNotebooks.indexOf(target);
    if (ci >= 0) { state.collapsedNotebooks.splice(ci, 1); }
  }
  pruneCollapsedNotebooks();
  saveSettings();
  if (state.online && state.repoExists) { await saveIndex(); }
  saveCache();
  renderAll();
  return true;
}

/* Notebook nest drag (Pointer Events, the app's drag
   idiom from the note drag), as widened by v2.67. What
   v2.67 fixed: as shipped in v2.63 the drag was bound
   only to the sidebar's #notebookNav and scanned only
   its rows, and its press guard admitted only the
   mouse. In the icon rail the notebooks live in the
   rail flyout (#railFlyoutList) while #notebookNav
   sits inside the hidden sidebar, so a press on a
   flyout row never armed anything (proven in a real
   Chromium rig on the v2.66.0 build: trusted presses
   on flyout rows produced no drag state, no target
   scan, and no write, and the gesture ended as a
   plain click), and pen and touch presses were
   refused before they could arm. The drag now binds
   and scans both notebook surfaces, admits the pen on
   the mouse's terms, and arms for touch on a long
   press (below).

   A press on a notebook row (either surface) arms a
   potential drag. For mouse and pen, movement past
   the threshold engages it (the row dims, the section
   header shows its armed outline as the top level
   drop zone, and so does the flyout's head on that
   surface); moving over another row highlights it as
   the nest target in the note drag's drop-hover
   style, and moving over the section header (or the
   flyout's head) highlights that as the move to top
   level. Self drops, descendant drops, and drops on
   the current parent are never offered (no highlight,
   and the target scan returns nothing there), so a
   release on them simply ends the drag. The finished
   drag swallows its tail click exactly like the note
   drag, so the drop's own release cannot also
   navigate.

   Touch (v2.67): a press on a row starts a hold
   timer. A release before the timer is a plain tap:
   nothing is blocked and the row's click navigates as
   always. Movement past the slop before the timer
   cancels the candidate, so a scroll that starts on a
   row still scrolls. When the timer fires, the drag
   engages where the finger rests; from then on the
   move handler prevents the default, so the sidebar
   cannot scroll under the drag, and the release
   commits or cancels exactly as a mouse drop does,
   tail click swallowed included. The native context
   menu a long press would summon stays suppressed
   across the sidebar (v2.61.1). */
const NB_NEST_DRAG_PX = 6;   /* movement before a press is a drag */
const NB_NEST_HOLD_MS = 400; /* v2.67: the touch long press that arms */
const NB_NEST_SLOP_PX = 10;  /* v2.67: a held touch may wander this far */
let nbNestDrag = null;       /* {slug, pointerId, pointerType,
                                startX, startY, lastX, lastY,
                                engaged, target, rowEl,
                                holdTimer} or null; target is
                                {kind:"row", slug},
                                {kind:"top"}, or null */
let nbNestDragClickBlock = false;

function nbNestTargetOk(dragSlug, targetSlug) {
  if (!targetSlug || targetSlug === dragSlug) { return false; }
  const dragNb = notebookForSlug(dragSlug);
  const target = notebookForSlug(targetSlug);
  if (!dragNb || !target) { return false; }
  if (notebookParentOf(dragNb) === targetSlug) { return false; }
  return notebookDescendantsOf(dragSlug).indexOf(targetSlug) < 0;
}

/* v2.67: the two top level drop zones, the Notebooks
   section label in the sidebar and the flyout's head
   in rail mode. A hidden surface's label has a zero
   rect, and the containment tests skip zero rects, so
   only the surface on screen can offer the zone. */
function nbNestTopLabels() {
  const out = [];
  const section = document.getElementById("notebookSection");
  const label = section
    ? section.querySelector(".nav-label") : null;
  if (label) { out.push(label); }
  const flyout = document.getElementById("railFlyout");
  const head = flyout
    ? flyout.querySelector(".rail-fly-head") : null;
  if (head) { out.push(head); }
  return out;
}

function nbNestTargetAt(x, y) {
  if (!nbNestDrag) { return null; }
  const rows = document.querySelectorAll(
    "#notebookNav [data-nb-slug], " +
    "#railFlyoutList [data-nb-slug]");
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect();
    if (r.width > 0 && r.height > 0 &&
        x >= r.left && x <= r.right &&
        y >= r.top && y <= r.bottom) {
      const slug = rows[i].getAttribute("data-nb-slug");
      return nbNestTargetOk(nbNestDrag.slug, slug)
        ? { kind: "row", slug: slug } : null;
    }
  }
  const dragNb = notebookForSlug(nbNestDrag.slug);
  if (dragNb && notebookParentOf(dragNb) !== null) {
    const labels = nbNestTopLabels();
    for (let i = 0; i < labels.length; i++) {
      const lr = labels[i].getBoundingClientRect();
      if (lr.width > 0 && lr.height > 0 &&
          x >= lr.left && x <= lr.right &&
          y >= lr.top && y <= lr.bottom) {
        return { kind: "top" };
      }
    }
  }
  return null;
}

function clearNbNestTarget() {
  document.querySelectorAll(
    "#notebookNav .drop-hover, #railFlyoutList .drop-hover")
    .forEach(function (el) { el.classList.remove("drop-hover"); });
  nbNestTopLabels().forEach(function (el) {
    el.classList.remove("nb-top-drop-hover");
  });
}

function updateNbNestTarget(x, y) {
  const next = nbNestTargetAt(x, y);
  const prev = nbNestDrag.target;
  const same = (!next && !prev) ||
    (!!next && !!prev && next.kind === prev.kind &&
      next.slug === prev.slug);
  if (same) { return; }
  clearNbNestTarget();
  nbNestDrag.target = next;
  if (!next) { return; }
  if (next.kind === "row") {
    const rows = document.querySelectorAll(
      "#notebookNav [data-nb-slug], " +
      "#railFlyoutList [data-nb-slug]");
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute("data-nb-slug") === next.slug) {
        rows[i].classList.add("drop-hover");
      }
    }
  } else {
    nbNestTopLabels().forEach(function (el) {
      const lr = el.getBoundingClientRect();
      if (lr.width > 0 && lr.height > 0 &&
          x >= lr.left && x <= lr.right &&
          y >= lr.top && y <= lr.bottom) {
        el.classList.add("nb-top-drop-hover");
      }
    });
  }
}

/* One edge auto scroll step for the sidebar while a nest
   drag is held at its edge, with the note drag's own
   edge band and step (the sidebar is the scroll
   container here; the drop overlay path of the note
   drag does not exist for this drag). */
function nbNestAutoScroll(clientY) {
  const container = document.getElementById("sidebar");
  if (!container) { return; }
  const rect = container.getBoundingClientRect();
  if (clientY < rect.top + NOTE_DRAG_EDGE_PX &&
      container.scrollTop > 0) {
    container.scrollTop -= NOTE_DRAG_EDGE_STEP_PX;
  } else if (clientY > rect.bottom - NOTE_DRAG_EDGE_PX &&
      container.scrollTop <
        container.scrollHeight - container.clientHeight) {
    container.scrollTop += NOTE_DRAG_EDGE_STEP_PX;
  }
}

/* v2.67: while either nest drag is engaged for a
   touch pointer, the gesture's touch moves are
   defaulted at the window, so the browser cannot
   turn the drag into a scroll of the sidebar (a
   takeover would end the drag with a pointercancel
   before the drop). Each drag registers this guard
   with its own listeners and removes it with them;
   it acts only while a touch drag is engaged, so
   ordinary touch scrolling is untouched. It has to
   be a touchmove listener: a real browser samples
   a gesture's touch action before a press handler's
   changes can apply, so claiming touch-action at
   press time cannot hold a scroll off, but a
   still finger starts no scroll during the hold,
   and once the drag is engaged this guard covers
   every move that follows. */
function onNestTouchMoveGuard(ev) {
  if (nbNestDrag && nbNestDrag.engaged &&
      nbNestDrag.pointerType === "touch") {
    ev.preventDefault();
    return;
  }
  if (tagNestDrag && tagNestDrag.engaged &&
      tagNestDrag.pointerType === "touch") {
    ev.preventDefault();
  }
}

/* v2.70: the nest drags' ghost (Chris, device testing
   v2.67.0: "I want to see the item I am dragging. Right
   now I just see the pointer cursor."). Modeled on the
   note drag's ghost (see positionNoteDragGhost): a
   clone of the dragged row or chip, following the
   pointer until the drag ends. Sidebar rows differ
   from note cards in one way that matters here: they
   are transparent backed with light text, styled to
   sit on the sidebar's green, so the clone wears the
   .nest-drag-ghost backdrop to stay visible over the
   list pane and the editor. The ghost is a plain clone
   on the body with its data attributes stripped, so
   the drags' coordinate target scans never see it,
   and it never takes events (pointer-events none in
   its rule). For mouse and pen it rides at the same
   grab point the source row was taken by, like the
   note ghost; for touch it rides centered above the
   fingertip, so the finger itself never hides the
   item being carried. */
function showNestDragGhost(drag, sourceEl) {
  hideNestDragGhost(drag);
  if (!drag || !sourceEl) { return; }
  const rect = sourceEl.getBoundingClientRect();
  if (!rect.width || !rect.height) { return; }
  const ghost = sourceEl.cloneNode(true);
  ghost.removeAttribute("id");
  ghost.removeAttribute("data-nb-slug");
  ghost.removeAttribute("data-tag");
  ghost.classList.remove("drop-hover");
  ghost.classList.remove("active");
  ghost.classList.add("nest-drag-ghost");
  ghost.style.width = rect.width + "px";
  ghost.setAttribute("aria-hidden", "true");
  document.body.appendChild(ghost);
  drag.ghost = ghost;
  drag.ghostOffX = drag.startX - rect.left;
  drag.ghostOffY = drag.startY - rect.top;
  positionNestDragGhost(drag, drag.lastX, drag.lastY);
}

function positionNestDragGhost(drag, x, y) {
  const ghost = drag && drag.ghost;
  if (!ghost || !ghost.isConnected) { return; }
  const w = ghost.offsetWidth;
  const h = ghost.offsetHeight;
  let left;
  let top;
  if (drag.pointerType === "touch") {
    left = x - w / 2;
    top = y - h - 18;
  } else {
    left = x - drag.ghostOffX;
    top = y - drag.ghostOffY;
  }
  left = Math.max(4, Math.min(left,
    window.innerWidth - w - 4));
  top = Math.max(4, Math.min(top,
    window.innerHeight - h - 4));
  ghost.style.left = left + "px";
  ghost.style.top = top + "px";
}

function hideNestDragGhost(drag) {
  if (drag && drag.ghost) {
    drag.ghost.remove();
    drag.ghost = null;
  }
}

function engageNbNestDrag() {
  nbNestDrag.engaged = true;
  if (nbNestDrag.rowEl) {
    nbNestDrag.rowEl.classList.add("nb-nest-source");
  }
  document.body.classList.add("nb-nest-dragging");
  const section = document.getElementById("notebookSection");
  if (section) { section.classList.add("nb-nest-armed"); }
  const flyout = document.getElementById("railFlyout");
  if (flyout) { flyout.classList.add("nb-nest-armed"); }
  /* v2.70: the dragged row's ghost joins the drag. */
  showNestDragGhost(nbNestDrag, nbNestDrag.rowEl);
}

function endNbNestDrag(commit) {
  if (!nbNestDrag) { return; }
  const drag = nbNestDrag;
  nbNestDrag = null;
  if (drag.holdTimer) { clearTimeout(drag.holdTimer); }
  window.removeEventListener("pointermove",
    onNbNestPointerMove, true);
  window.removeEventListener("touchmove",
    onNestTouchMoveGuard, true);
  window.removeEventListener("pointerup",
    onNbNestPointerUp, true);
  window.removeEventListener("pointercancel",
    onNbNestPointerCancel, true);
  window.removeEventListener("keydown", onNbNestKeydown, true);
  clearNbNestTarget();
  hideNestDragGhost(drag);
  if (drag.rowEl) { drag.rowEl.classList.remove("nb-nest-source"); }
  document.body.classList.remove("nb-nest-dragging");
  const section = document.getElementById("notebookSection");
  if (section) { section.classList.remove("nb-nest-armed"); }
  const flyout = document.getElementById("railFlyout");
  if (flyout) { flyout.classList.remove("nb-nest-armed"); }
  if (!drag.engaged) { return; }
  /* An engaged drag, landed or cancelled, swallows the
     click its release would otherwise deliver to the
     row, the note drag's standing rule. A press that
     never engaged (a plain tap, a touch scroll) reaches
     the early return above and blocks nothing. */
  nbNestDragClickBlock = true;
  if (commit && drag.target) {
    setNotebookParent(drag.slug,
      drag.target.kind === "top" ? null : drag.target.slug)
      .catch(function (err) {
        toast("Move failed: " + err.message, true);
      });
  }
}

function onNbNestPointerMove(ev) {
  if (!nbNestDrag || ev.pointerId !== nbNestDrag.pointerId) {
    return;
  }
  nbNestDrag.lastX = ev.clientX;
  nbNestDrag.lastY = ev.clientY;
  if (!nbNestDrag.engaged) {
    const moved = Math.max(
      Math.abs(ev.clientX - nbNestDrag.startX),
      Math.abs(ev.clientY - nbNestDrag.startY));
    if (nbNestDrag.pointerType === "touch") {
      /* v2.67: a held touch that wanders past the slop
         before the hold fires was a scroll starting,
         not a drag: the candidate dies quietly and the
         gesture belongs to the scroller from here. */
      if (moved > NB_NEST_SLOP_PX) { endNbNestDrag(false); }
      return;
    }
    if (moved > NB_NEST_DRAG_PX) { engageNbNestDrag(); }
    else { return; }
  }
  /* v2.67: an engaged touch drag owns its moves, so the
     sidebar cannot scroll underneath it. Mouse and pen
     moves are never defaulted, exactly as before. */
  if (nbNestDrag.pointerType === "touch") {
    ev.preventDefault();
  }
  updateNbNestTarget(ev.clientX, ev.clientY);
  nbNestAutoScroll(ev.clientY);
  positionNestDragGhost(nbNestDrag, ev.clientX, ev.clientY);
}

function onNbNestPointerUp(ev) {
  if (!nbNestDrag || ev.pointerId !== nbNestDrag.pointerId) {
    return;
  }
  endNbNestDrag(true);
}

function onNbNestPointerCancel(ev) {
  if (!nbNestDrag || ev.pointerId !== nbNestDrag.pointerId) {
    return;
  }
  endNbNestDrag(false);
}

function onNbNestKeydown(ev) {
  if (ev.key === "Escape") { endNbNestDrag(false); }
}

function onNbNavPointerDown(ev) {
  /* Mouse and pen arm on movement past the threshold,
     as the mouse always has. Touch arms on the long
     press instead (see the section comment): a touch
     press that lifts early stays a tap, and one that
     moves early stays a scroll. */
  const pt = ev.pointerType || "mouse";
  if (pt === "touch") {
    if (ev.button !== undefined && ev.button > 0) { return; }
  } else if (ev.button !== undefined && ev.button !== 0) {
    return;
  }
  if (nbNestDrag) { return; }
  const row = (ev.target && ev.target.closest)
    ? ev.target.closest("[data-nb-slug]") : null;
  if (!row) { return; }
  const drag = {
    slug: row.getAttribute("data-nb-slug"),
    pointerId: ev.pointerId,
    pointerType: pt,
    startX: ev.clientX,
    startY: ev.clientY,
    lastX: ev.clientX,
    lastY: ev.clientY,
    engaged: false,
    target: null,
    rowEl: row,
    holdTimer: null
  };
  nbNestDrag = drag;
  if (pt === "touch") {
    /* The hold timer engages the drag where the finger
       rests if the press is still down by then; the
       engaged drag's moves are covered by the
       touchmove guard (onNestTouchMoveGuard). */
    drag.holdTimer = setTimeout(function () {
      if (nbNestDrag !== drag || drag.engaged) { return; }
      engageNbNestDrag();
      updateNbNestTarget(drag.lastX, drag.lastY);
    }, NB_NEST_HOLD_MS);
  }
  window.addEventListener("pointermove",
    onNbNestPointerMove, { capture: true, passive: false });
  window.addEventListener("touchmove",
    onNestTouchMoveGuard, { capture: true, passive: false });
  window.addEventListener("pointerup",
    onNbNestPointerUp, true);
  window.addEventListener("pointercancel",
    onNbNestPointerCancel, true);
  window.addEventListener("keydown", onNbNestKeydown, true);
}

function initNbNestDrag() {
  const nav = document.getElementById("notebookNav");
  if (nav) {
    nav.addEventListener("pointerdown", onNbNavPointerDown);
  }
  /* v2.67: the rail flyout renders the same rows on the
     rail surface, so the same press arms there too. */
  const flyoutList = document.getElementById("railFlyoutList");
  if (flyoutList) {
    flyoutList.addEventListener("pointerdown",
      onNbNavPointerDown);
  }
  /* The finished drag click suppression, in the note
     drag's exact shape: the block lapses on the next
     press, and one capture click is swallowed while it
     stands. */
  document.addEventListener("pointerdown", function () {
    if (!nbNestDrag) { nbNestDragClickBlock = false; }
  }, true);
  document.addEventListener("click", function (ev) {
    if (nbNestDragClickBlock) {
      nbNestDragClickBlock = false;
      ev.stopPropagation();
      ev.preventDefault();
    }
  }, true);
}

/* --------------------------------------------------------------------------
   v2.64: tag drag nesting

   The drag the v2.30 section below shipped without
   ("there is no drag and drop nesting this release"),
   built on the notebook nest drag's idiom, which is
   the app's drag idiom throughout: a press on a tag
   row's chip arms a potential drag, movement past the
   threshold engages it (the row dims, the Tags section
   header shows its armed outline as the top level drop
   zone), moving over another row highlights its chip as
   the nest target in the shared drop-hover style, and
   moving over the section header highlights that as the
   move to top level. The drop runs setTagParent, the
   one write path the Move Tag panel already uses, so
   persistence is the existing index save, the target
   expands the way a menu move expands it, and the
   subtree rides along because sub-tags point at their
   parent by name. Self drops, descendant drops, and
   drops on the current parent are never offered (no
   highlight, and the target scan returns nothing
   there), so a release on them simply ends the drag.
   The finished drag swallows its tail click exactly
   like the notebook drag, so the drop's own release
   cannot also toggle the tag filter.

   v2.67: the press guard admits the pen on the mouse's
   terms now, and touch arms on the same long press as
   the notebook drag: a touch press on the chip starts
   the hold timer; a release before the timer is a plain tap
   (the filter toggles as always), movement past the
   slop before the timer cancels the candidate so a
   scroll still scrolls, and once the hold engages the
   drag, its moves prevent the default so the sidebar
   cannot scroll under it. */
const TAG_NEST_DRAG_PX = 6;  /* movement before a press is a drag */
const TAG_NEST_HOLD_MS = 400; /* v2.67: the touch long press that arms */
const TAG_NEST_SLOP_PX = 10;  /* v2.67: a held touch may wander this far */
let tagNestDrag = null;      /* {tag, pointerId, pointerType,
                                startX, startY, lastX, lastY,
                                engaged, target, rowEl,
                                holdTimer} or null; target is
                                {kind:"row", tag},
                                {kind:"top"}, or null */
let tagNestDragClickBlock = false;

function tagNestTargetOk(dragTag, targetTag) {
  if (!targetTag || targetTag === dragTag) { return false; }
  if (!tagExists(dragTag) || !tagExists(targetTag)) {
    return false;
  }
  if (tagParentOf(dragTag) === targetTag) { return false; }
  return tagDescendantsOf(dragTag).indexOf(targetTag) < 0;
}

function tagNestTargetAt(x, y) {
  if (!tagNestDrag) { return null; }
  const rows = document.querySelectorAll("#tagNav [data-tag]");
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect();
    if (r.width > 0 && r.height > 0 &&
        x >= r.left && x <= r.right &&
        y >= r.top && y <= r.bottom) {
      const tag = rows[i].getAttribute("data-tag");
      return tagNestTargetOk(tagNestDrag.tag, tag)
        ? { kind: "row", tag: tag } : null;
    }
  }
  if (tagParentOf(tagNestDrag.tag) !== null) {
    const section = document.getElementById("tagSection");
    const label = section
      ? section.querySelector(".nav-label") : null;
    if (label) {
      const lr = label.getBoundingClientRect();
      if (lr.width > 0 && lr.height > 0 &&
          x >= lr.left && x <= lr.right &&
          y >= lr.top && y <= lr.bottom) {
        return { kind: "top" };
      }
    }
  }
  return null;
}

function clearTagNestTarget() {
  document.querySelectorAll("#tagNav .drop-hover")
    .forEach(function (el) { el.classList.remove("drop-hover"); });
  const section = document.getElementById("tagSection");
  const label = section
    ? section.querySelector(".nav-label") : null;
  if (label) { label.classList.remove("tag-top-drop-hover"); }
}

function updateTagNestTarget(x, y) {
  const next = tagNestTargetAt(x, y);
  const prev = tagNestDrag.target;
  const same = (!next && !prev) ||
    (!!next && !!prev && next.kind === prev.kind &&
      next.tag === prev.tag);
  if (same) { return; }
  clearTagNestTarget();
  tagNestDrag.target = next;
  if (!next) { return; }
  if (next.kind === "row") {
    const rows = document.querySelectorAll("#tagNav [data-tag]");
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute("data-tag") === next.tag) {
        const chip = rows[i].querySelector(".tag-chip-nav");
        if (chip) { chip.classList.add("drop-hover"); }
      }
    }
  } else {
    const section = document.getElementById("tagSection");
    const label = section
      ? section.querySelector(".nav-label") : null;
    if (label) { label.classList.add("tag-top-drop-hover"); }
  }
}

/* One edge auto scroll step for the sidebar while a
   tag nest drag is held at its edge, with the same
   edge band and step the notebook nest drag uses. */
function tagNestAutoScroll(clientY) {
  const container = document.getElementById("sidebar");
  if (!container) { return; }
  const rect = container.getBoundingClientRect();
  if (clientY < rect.top + NOTE_DRAG_EDGE_PX &&
      container.scrollTop > 0) {
    container.scrollTop -= NOTE_DRAG_EDGE_STEP_PX;
  } else if (clientY > rect.bottom - NOTE_DRAG_EDGE_PX &&
      container.scrollTop <
        container.scrollHeight - container.clientHeight) {
    container.scrollTop += NOTE_DRAG_EDGE_STEP_PX;
  }
}

function engageTagNestDrag() {
  tagNestDrag.engaged = true;
  if (tagNestDrag.rowEl) {
    tagNestDrag.rowEl.classList.add("tag-nest-source");
  }
  document.body.classList.add("tag-nest-dragging");
  const section = document.getElementById("tagSection");
  if (section) { section.classList.add("tag-nest-armed"); }
  /* v2.70: the dragged chip's ghost joins the drag: the
     chip, not its row wrapper, is the item in the hand. */
  const chip = tagNestDrag.rowEl
    ? tagNestDrag.rowEl.querySelector(".tag-chip-nav")
    : null;
  showNestDragGhost(tagNestDrag, chip || tagNestDrag.rowEl);
}

function endTagNestDrag(commit) {
  if (!tagNestDrag) { return; }
  const drag = tagNestDrag;
  tagNestDrag = null;
  if (drag.holdTimer) { clearTimeout(drag.holdTimer); }
  window.removeEventListener("pointermove",
    onTagNestPointerMove, true);
  window.removeEventListener("touchmove",
    onNestTouchMoveGuard, true);
  window.removeEventListener("pointerup",
    onTagNestPointerUp, true);
  window.removeEventListener("pointercancel",
    onTagNestPointerCancel, true);
  window.removeEventListener("keydown", onTagNestKeydown, true);
  clearTagNestTarget();
  hideNestDragGhost(drag);
  if (drag.rowEl) { drag.rowEl.classList.remove("tag-nest-source"); }
  document.body.classList.remove("tag-nest-dragging");
  const section = document.getElementById("tagSection");
  if (section) { section.classList.remove("tag-nest-armed"); }
  if (!drag.engaged) { return; }
  /* An engaged drag, landed or cancelled, swallows the
     click its release would otherwise deliver to the
     row, the notebook drag's standing rule. A press
     that never engaged (a plain tap, a touch scroll)
     reaches the early return above and blocks nothing. */
  tagNestDragClickBlock = true;
  if (commit && drag.target) {
    setTagParent(drag.tag,
      drag.target.kind === "top" ? null : drag.target.tag)
      .catch(function (err) {
        toast("Move failed: " + err.message, true);
      });
  }
}

function onTagNestPointerMove(ev) {
  if (!tagNestDrag || ev.pointerId !== tagNestDrag.pointerId) {
    return;
  }
  tagNestDrag.lastX = ev.clientX;
  tagNestDrag.lastY = ev.clientY;
  if (!tagNestDrag.engaged) {
    const moved = Math.max(
      Math.abs(ev.clientX - tagNestDrag.startX),
      Math.abs(ev.clientY - tagNestDrag.startY));
    if (tagNestDrag.pointerType === "touch") {
      /* v2.67: a held touch that wanders past the slop
         before the hold fires was a scroll starting,
         not a drag: the candidate dies quietly and the
         gesture belongs to the scroller from here. */
      if (moved > TAG_NEST_SLOP_PX) { endTagNestDrag(false); }
      return;
    }
    if (moved > TAG_NEST_DRAG_PX) { engageTagNestDrag(); }
    else { return; }
  }
  /* v2.67: an engaged touch drag owns its moves, so the
     sidebar cannot scroll underneath it. Mouse and pen
     moves are never defaulted, exactly as before. */
  if (tagNestDrag.pointerType === "touch") {
    ev.preventDefault();
  }
  updateTagNestTarget(ev.clientX, ev.clientY);
  tagNestAutoScroll(ev.clientY);
  positionNestDragGhost(tagNestDrag, ev.clientX, ev.clientY);
}

function onTagNestPointerUp(ev) {
  if (!tagNestDrag || ev.pointerId !== tagNestDrag.pointerId) {
    return;
  }
  endTagNestDrag(true);
}

function onTagNestPointerCancel(ev) {
  if (!tagNestDrag || ev.pointerId !== tagNestDrag.pointerId) {
    return;
  }
  endTagNestDrag(false);
}

function onTagNestKeydown(ev) {
  if (ev.key === "Escape") { endTagNestDrag(false); }
}

function onTagNavPointerDown(ev) {
  /* Mouse and pen arm on movement past the threshold,
     as the mouse always has. Touch arms on the long
     press instead: a touch press that lifts early
     stays a tap, and one that moves early stays a
     scroll. */
  const pt = ev.pointerType || "mouse";
  if (pt === "touch") {
    if (ev.button !== undefined && ev.button > 0) { return; }
  } else if (ev.button !== undefined && ev.button !== 0) {
    return;
  }
  if (tagNestDrag) { return; }
  /* The press arms from the row's chip, the tag row's
     main element, the way the notebook press arms from
     its row button: the fold caret and the three dot
     menu button sit outside the chip and never arm. */
  const chip = (ev.target && ev.target.closest)
    ? ev.target.closest("#tagNav .tag-chip-nav") : null;
  if (!chip) { return; }
  const row = chip.closest("[data-tag]");
  if (!row) { return; }
  const drag = {
    tag: row.getAttribute("data-tag"),
    pointerId: ev.pointerId,
    pointerType: pt,
    startX: ev.clientX,
    startY: ev.clientY,
    lastX: ev.clientX,
    lastY: ev.clientY,
    engaged: false,
    target: null,
    rowEl: row,
    holdTimer: null
  };
  tagNestDrag = drag;
  if (pt === "touch") {
    /* The hold timer engages the drag where the finger
       rests if the press is still down by then; the
       engaged drag's moves are covered by the
       touchmove guard (onNestTouchMoveGuard). */
    drag.holdTimer = setTimeout(function () {
      if (tagNestDrag !== drag || drag.engaged) { return; }
      engageTagNestDrag();
      updateTagNestTarget(drag.lastX, drag.lastY);
    }, TAG_NEST_HOLD_MS);
  }
  window.addEventListener("pointermove",
    onTagNestPointerMove, { capture: true, passive: false });
  window.addEventListener("touchmove",
    onNestTouchMoveGuard, { capture: true, passive: false });
  window.addEventListener("pointerup",
    onTagNestPointerUp, true);
  window.addEventListener("pointercancel",
    onTagNestPointerCancel, true);
  window.addEventListener("keydown", onTagNestKeydown, true);
}

function initTagNestDrag() {
  const nav = document.getElementById("tagNav");
  if (nav) {
    nav.addEventListener("pointerdown", onTagNavPointerDown);
  }
  /* The finished drag click suppression, in the notebook
     drag's exact shape: the block lapses on the next
     press, and one capture click is swallowed while it
     stands. */
  document.addEventListener("pointerdown", function () {
    if (!tagNestDrag) { tagNestDragClickBlock = false; }
  }, true);
  document.addEventListener("click", function (ev) {
    if (tagNestDragClickBlock) {
      tagNestDragClickBlock = false;
      ev.stopPropagation();
      ev.preventDefault();
    }
  }, true);
}


/* --------------------------------------------------------------------------
   v2.30: nested tags (Evernote parity, phase 1 release 2)

   Evernote's model, from its own help pages (the "Nested tags"
   and "Tags overview" articles): notes carry plain tag names,
   and separately a tag can sit under one parent tag, forming a
   tree the sidebar Tags list renders with sub-tags indented
   under their parent. The hierarchy is organization only; it
   changes no note. SnakeScale keeps the same split: note files
   keep their flat tag strings untouched, and the parent map
   (tag name to parent tag name) lives in index.json, beside
   the notebooks.

   Why index.json and not settings: settings are written to one
   device's local storage and never sync (see loadSettings),
   while index.json is the Drive store's own index, read and
   written by the app on every device. A hierarchy kept in
   settings would exist on one device only. The map rides
   every index write because buildIndexObject is the single
   shape every index save serializes, it loads in both
   loadAllFromRepo branches, and it rides the local cache
   snapshot so a cache first paint shows the same tree.

   A tag that exists on notes but has no map entry is a top
   level tag. Evernote shapes the operations too: a tag is
   nested from its menu (Move tag... and a chosen parent, or
   Move tag to top level), renaming a tag renames it on every
   note and its sub-tags follow, and deleting a tag removes it
   from its notes while its sub-tags are promoted to the top
   level, never deleted with it. Two named deviations: there
   is no drag and drop nesting this release (the menu path is
   complete), and no Create sub-tag menu item, because a
   SnakeScale tag exists only by being on a note; a sub-tag is
   made by tagging a note and moving the tag under its parent.
   Counts stay the exact-tag counts the flat list always
   showed, and clicking a tag filters to exactly its notes,
   exactly as before.
   -------------------------------------------------------------------------- */

/* Read a stored parent map into a safe one: only string to
   string entries with non-blank names survive, a tag is never
   its own parent, and a cycle (reachable only through a hand
   edited or damaged index.json) is broken by dropping the
   entry the walk started from, so every stored map renders. */
function sanitizeTagParents(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return out;
  }
  Object.keys(raw).sort().forEach(function (k) {
    const p = raw[k];
    if (typeof k !== "string" || !k.trim()) { return; }
    if (typeof p !== "string" || !p.trim()) { return; }
    if (p === k) { return; }
    out[k] = p;
  });
  Object.keys(out).forEach(function (k) {
    const seen = {};
    let cur = k;
    while (cur && out[cur]) {
      if (seen[cur]) { delete out[k]; return; }
      seen[cur] = true;
      cur = out[cur];
    }
  });
  return out;
}

/* The parent of one tag, or null for a top level tag. A tag
   absent from the map has no parent by definition. */
function tagParentOf(tag) {
  const p = state.tagParents ? state.tagParents[tag] : null;
  return (typeof p === "string" && p && p !== tag) ? p : null;
}

/* Does this tag name exist anywhere the app can see: on a
   note, or in the hierarchy as a child or a parent? */
function tagExists(tag) {
  if (typeof state.tagParents[tag] === "string") { return true; }
  const keys = Object.keys(state.tagParents);
  for (let i = 0; i < keys.length; i++) {
    if (state.tagParents[keys[i]] === tag) { return true; }
  }
  return allTagsWithCounts().some(function (e) {
    return e.tag === tag;
  });
}

/* Every descendant of a tag in the stored map, breadth first,
   cycle safe. The map is the input (not the rendered tree),
   so a collapsed subtree still counts: a tag may not be
   moved under anything inside its own subtree, folded or
   not. */
function tagDescendantsOf(tag) {
  const out = [];
  const seen = {};
  seen[tag] = true;
  let frontier = [tag];
  while (frontier.length) {
    const next = [];
    Object.keys(state.tagParents).forEach(function (child) {
      if (frontier.indexOf(state.tagParents[child]) >= 0 &&
          !seen[child]) {
        seen[child] = true;
        out.push(child);
        next.push(child);
      }
    });
    frontier = next;
  }
  return out;
}

/* Flatten tag entries ([{tag, count}], in the caller's order)
   into tree order: roots in entry order, each tag followed by
   its sub-tags, depth recorded. With useCollapse, a collapsed
   tag's subtree is omitted from the rows (its members are
   still marked seen, so nothing renders twice). A tag whose
   chain cannot reach a root (a cycle a damaged map smuggled
   past the sanitizer) is appended at the top level rather
   than vanishing from the list. */
function tagTreeRows(entries, useCollapse) {
  const inSet = {};
  const counts = {};
  entries.forEach(function (e) {
    inSet[e.tag] = true;
    counts[e.tag] = e.count;
  });
  const children = {};
  entries.forEach(function (e) {
    const p = tagParentOf(e.tag);
    if (p && inSet[p]) {
      if (!children[p]) { children[p] = []; }
      children[p].push(e.tag);
    }
  });
  const out = [];
  const seen = {};
  function markSubtree(tag) {
    (children[tag] || []).forEach(function (k) {
      if (!seen[k]) { seen[k] = true; markSubtree(k); }
    });
  }
  function walk(tag, depth) {
    seen[tag] = true;
    const kids = children[tag] || [];
    out.push({ tag: tag, count: counts[tag], depth: depth,
      hasChildren: kids.length > 0 });
    if (useCollapse && state.collapsedTags.indexOf(tag) >= 0) {
      markSubtree(tag);
      return;
    }
    kids.forEach(function (k) {
      if (!seen[k]) { walk(k, depth + 1); }
    });
  }
  entries.forEach(function (e) {
    const p = tagParentOf(e.tag);
    if (!(p && inSet[p]) && !seen[e.tag]) { walk(e.tag, 0); }
  });
  entries.forEach(function (e) {
    if (!seen[e.tag]) {
      out.push({ tag: e.tag, count: counts[e.tag], depth: 0,
        hasChildren: (children[e.tag] || []).length > 0 });
      seen[e.tag] = true;
    }
  });
  return out;
}

/* The depth of one tag within a given name set (its ancestor
   chain restricted to names in the set), cycle safe. Used by
   choosers that list tags from a different source than the
   sidebar counts (the editor's picker works from knownTags),
   so each surface indents by the same hierarchy. */
function tagDepthWithin(tag, nameSet) {
  let depth = 0;
  const seen = {};
  seen[tag] = true;
  let cur = tagParentOf(tag);
  while (cur && nameSet[cur] && !seen[cur]) {
    seen[cur] = true;
    depth++;
    cur = tagParentOf(cur);
  }
  return depth;
}

/* Drop fold records for tags that no longer have sub-tags,
   so settings never accumulate folds for parents that are
   parents no longer. Mirrors the stack fold pruning. */
function pruneCollapsedTags() {
  const withChildren = {};
  Object.keys(state.tagParents).forEach(function (child) {
    const p = state.tagParents[child];
    if (p) { withChildren[p] = true; }
  });
  state.collapsedTags = state.collapsedTags.filter(function (n) {
    return !!withChildren[n];
  });
}

/* Set (or clear, with null) a tag's parent. Refusals are
   plain and change nothing: under itself, under one of its
   own sub-tags (which would close a cycle and orphan the
   chain), or under a tag that no longer exists. Moving a
   parent needs no entry changes for its sub-tags: they
   point at the parent by name, so the whole subtree rides
   along. Assigning a parent expands it, like assigning a
   stack expands the group, so the moved tag is visible in
   its new home. Returns true when the move was made. */
async function setTagParent(tag, parentName) {
  if (parentName) {
    if (parentName === tag) {
      toast("A tag cannot be moved under itself.", true);
      return false;
    }
    if (tagDescendantsOf(tag).indexOf(parentName) >= 0) {
      toast("\"" + tag + "\" cannot be moved under one of " +
        "its own sub-tags.", true);
      return false;
    }
    if (!tagExists(parentName)) {
      toast("The tag \"" + parentName + "\" no longer exists.",
        true);
      return false;
    }
    state.tagParents[tag] = parentName;
    const ci = state.collapsedTags.indexOf(parentName);
    if (ci >= 0) { state.collapsedTags.splice(ci, 1); }
  } else {
    delete state.tagParents[tag];
  }
  pruneCollapsedTags();
  saveSettings();
  if (state.online && state.repoExists) { await saveIndex(); }
  saveCache();
  renderAll();
  return true;
}

/* Fold or unfold one tag's subtree in the sidebar. The fold
   is remembered in settings, like the stack folds, and only
   re-renders the sidebar. */
function toggleTagCollapsed(tag) {
  const ci = state.collapsedTags.indexOf(tag);
  if (ci >= 0) { state.collapsedTags.splice(ci, 1); }
  else { state.collapsedTags.push(tag); }
  saveSettings();
  renderSidebar();
}

/* Rename a tag everywhere, the way Evernote's rename works:
   the tag string is rewritten on every note that carries it
   (Notes, Trash, and Archive, so a restored or unarchived
   note never resurrects the old name), its sub-tags keep
   pointing at it under the new name, its own parent entry
   follows, and the fold record, the open tag view, and the
   list filters follow. Renaming onto a name another tag
   already carries is refused rather than merged, since a
   silent merge would rewrite two tags' notes into one.
   Each affected note saves through the per note operation
   chain, which loads a catalog shell's body before writing,
   so only the tag line of each file changes. */
async function renameTag(oldName, newName) {
  newName = String(newName == null ? "" : newName).trim();
  if (!newName || newName === oldName) { return; }
  if (tagExists(newName)) {
    toast("A tag named \"" + newName + "\" already exists.",
      true);
    return;
  }
  const affected = [];
  [state.notes, state.trash, state.archive].forEach(function (coll) {
    coll.forEach(function (note) {
      if (note.tags && note.tags.indexOf(oldName) >= 0) {
        const next = [];
        note.tags.forEach(function (t) {
          const v = (t === oldName) ? newName : t;
          if (next.indexOf(v) < 0) { next.push(v); }
        });
        note.tags = next;
        affected.push(note);
      }
    });
  });
  if (state.tagParents[oldName]) {
    state.tagParents[newName] = state.tagParents[oldName];
    delete state.tagParents[oldName];
  }
  /* v2.31: a tag shortcut names the tag, so it follows the
     rename like the hierarchy entries do. */
  shortcutsFollowRename("tag", oldName, newName);
  Object.keys(state.tagParents).forEach(function (child) {
    if (state.tagParents[child] === oldName) {
      state.tagParents[child] = newName;
    }
  });
  const ci = state.collapsedTags.indexOf(oldName);
  if (ci >= 0) {
    state.collapsedTags[ci] = newName;
    saveSettings();
  }
  if (state.view.kind === "tag" && state.view.value === oldName) {
    state.view = { kind: "tag", value: newName };
  }
  state.listFilters.tags = state.listFilters.tags.map(function (t) {
    return t === oldName ? newName : t;
  });
  let failed = 0;
  for (let i = 0; i < affected.length; i++) {
    try { await saveNoteToRepo(affected[i]); }
    catch (err) { failed++; }
  }
  if (state.online && state.repoExists) { await saveIndex(); }
  saveCache();
  renderAll();
  if (failed) {
    toast("The tag was renamed, but " + failed +
      " note(s) could not be saved.", true);
  } else {
    toast("Tag renamed to \"" + newName + "\".");
  }
}

/* Delete a tag, Evernote's semantics: the tag is removed
   from every note that carries it (Notes, Trash, and
   Archive), the notes themselves are untouched, and its
   sub-tags are promoted to the top level, never deleted
   with it. The tag's own hierarchy entries and fold record
   go with it, and a view or filter naming the tag is
   cleared so nothing filters by a tag that is gone. */
async function deleteTag(tag) {
  const affected = [];
  [state.notes, state.trash, state.archive].forEach(function (coll) {
    coll.forEach(function (note) {
      if (note.tags && note.tags.indexOf(tag) >= 0) {
        note.tags = note.tags.filter(function (t) {
          return t !== tag;
        });
        affected.push(note);
      }
    });
  });
  Object.keys(state.tagParents).forEach(function (child) {
    if (state.tagParents[child] === tag) {
      delete state.tagParents[child];
    }
  });
  delete state.tagParents[tag];
  /* v2.31: the deleted tag's shortcut goes with it; the
     tag no longer exists anywhere once it leaves its
     notes. */
  shortcutsDrop("tag", tag);
  const ci = state.collapsedTags.indexOf(tag);
  if (ci >= 0) {
    state.collapsedTags.splice(ci, 1);
    saveSettings();
  }
  if (state.view.kind === "tag" && state.view.value === tag) {
    state.view = { kind: "all", value: null };
  }
  state.listFilters.tags = state.listFilters.tags.filter(function (t) {
    return t !== tag;
  });
  let failed = 0;
  for (let i = 0; i < affected.length; i++) {
    try { await saveNoteToRepo(affected[i]); }
    catch (err) { failed++; }
  }
  if (state.online && state.repoExists) { await saveIndex(); }
  saveCache();
  renderAll();
  if (failed) {
    toast("The tag was deleted, but " + failed +
      " note(s) could not be saved.", true);
  } else {
    toast("Tag \"" + tag + "\" deleted.");
  }
}

/* The tag menu's Rename Tag: prompt for the new name (the
   native prompt pairs with the stack rename's, as recorded
   in the v2.29 deviations), then renameTag validates and
   does the work. */
function promptRenameTag(tag) {
  const next = prompt("Rename tag", tag);
  if (next === null) { return; }
  const name = String(next).trim();
  if (!name || name === tag) { return; }
  renameTag(tag, name);
}

/* The tag menu's Delete Tag: the confirm states the two
   promises the operation keeps, in Evernote's own terms:
   the notes are not deleted, and sub-tags move to the top
   level rather than being deleted. */
function confirmDeleteTag(tag) {
  const count = state.notes.filter(function (n) {
    return n.tags && n.tags.indexOf(tag) >= 0;
  }).length;
  const kids = Object.keys(state.tagParents).filter(function (c) {
    return state.tagParents[c] === tag;
  }).length;
  const msg = "Delete the tag \"" + tag + "\"?\n\n" +
    "It will be removed from " + count + " note" +
    (count === 1 ? "" : "s") + " in Notes, and from any copies " +
    "in Trash and Archive. The notes themselves will NOT be " +
    "deleted." +
    (kids ? "\n\nIts " + kids + " sub-tag" +
      (kids === 1 ? "" : "s") + " will move to the top level, " +
      "not be deleted." : "");
  if (!confirm(msg)) { return; }
  deleteTag(tag);
}

/* --------------------------------------------------------------------------
   v2.42: drag reorder (post phase 3 release 1, approved by
   Chris on 2026-10-28). One shared pointer drag helper
   serves the three surfaces Chris approved: the sidebar
   Shortcuts list, the Home widgets (dragged by a handle
   on the widget itself while Customize is open), and the
   merge order dialog's rows. Sidebar drag for stacks and
   tag nesting stays out, deliberately, as does drag
   ordering of the Reminders list and any widget resizing
   or free placement.

   The helper's shape follows the app's own drag
   precedents (the note list drag of v2.4 and the editor's
   block grip): Pointer Events only, never HTML5 drag and
   drop, so mouse and touch run the one path. A press on a
   surface's drag handle arms a candidate; movement past
   a small threshold engages it. While engaged the item
   itself moves among its siblings in the DOM, the row it
   will land beside carries the drop indicator (an accent
   bar on the landing edge), and the dragged item dims
   under an accent outline. A drop commits the DOM's new
   key order through the surface's own order owner (the
   shortcuts index save, the home layout save, the merge
   dialog's input order); a drag that ends where it
   started commits nothing and writes nothing; Escape
   and pointercancel restore the original DOM order and
   commit nothing. The non-drag paths remain complete
   alternatives everywhere: a shortcut can still be
   removed and re-added, Home keeps its Move up and Move
   down buttons, and the merge dialog opens in list
   order, which Merge simply accepts.
   -------------------------------------------------------------------------- */

/* The grip every drag handle wears: six dots in two
   columns, drawn in the handle's own color. */
const SS_DRAG_GRIP_ICON = "<svg viewBox=\"0 0 12 20\" " +
  "width=\"12\" height=\"18\" aria-hidden=\"true\" " +
  "focusable=\"false\"><circle cx=\"3.5\" cy=\"4\" r=\"1.6\" " +
  "fill=\"currentColor\"/><circle cx=\"8.5\" cy=\"4\" " +
  "r=\"1.6\" fill=\"currentColor\"/><circle cx=\"3.5\" " +
  "cy=\"10\" r=\"1.6\" fill=\"currentColor\"/><circle " +
  "cx=\"8.5\" cy=\"10\" r=\"1.6\" fill=\"currentColor\"/>" +
  "<circle cx=\"3.5\" cy=\"16\" r=\"1.6\" " +
  "fill=\"currentColor\"/><circle cx=\"8.5\" cy=\"16\" " +
  "r=\"1.6\" fill=\"currentColor\"/></svg>";

/* The eye off a widget's hide button wears (v2.55),
   in the app icons' stroke voice: an eye under a
   slash. Drawn at the size the header buttons use. */
const HOME_HIDE_ICON = "<svg viewBox=\"0 0 24 24\" " +
  "width=\"15\" height=\"15\" fill=\"none\" " +
  "stroke=\"currentColor\" stroke-width=\"1.8\" " +
  "stroke-linecap=\"round\" stroke-linejoin=\"round\" " +
  "aria-hidden=\"true\" focusable=\"false\">" +
  "<path d=\"M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8" +
  "a18.5 18.5 0 0 1-2.16 3.19\"/>" +
  "<path d=\"M6.61 6.61A13.53 13.53 0 0 0 1 12s4 8 11 8" +
  "a18.5 18.5 0 0 0 2.16-3.19\"/>" +
  "<path d=\"M9.88 9.88a3 3 0 1 0 4.24 4.24\"/>" +
  "<line x1=\"1\" y1=\"1\" x2=\"23\" y2=\"23\"/></svg>";

const SS_REORDER_DRAG_PX = 4;
let ssReorderDrag = null;   /* the armed or engaged drag */

function ssReorderItems(container, selector) {
  return Array.prototype.slice.call(
    container.querySelectorAll(selector));
}

/* Arm one item's drag handle. options: itemSelector (the
   siblings the item reorders among, inside its parent),
   keyOf(el) (the item's order key), onCommit(keys) (the
   surface's order owner, called only when the order
   changed), axis ("list" or "grid"), and scrollEl (the
   scrolling ancestor to edge scroll, or a function
   returning it). Binding is once per handle element, so
   a re-render that reuses an element never double arms
   it. */
function attachReorderDrag(handle, item, options) {
  if (!handle || !item) { return; }
  if (handle.getAttribute("data-ss-drag-bound") === "1") {
    return;
  }
  handle.setAttribute("data-ss-drag-bound", "1");
  handle.addEventListener("pointerdown", function (ev) {
    startReorderDrag(ev, handle, item, options);
  });
}

function startReorderDrag(ev, handle, item, options) {
  if (ssReorderDrag) { return; }
  if (ev.pointerType === "mouse" && ev.button !== 0) {
    return;
  }
  const container = item.parentElement;
  if (!container) { return; }
  const items = ssReorderItems(container,
    options.itemSelector);
  if (items.length < 2 || items.indexOf(item) < 0) {
    return;
  }
  ssReorderDrag = {
    pointerId: ev.pointerId,
    startX: ev.clientX, startY: ev.clientY,
    engaged: false,
    handle: handle, item: item, container: container,
    selector: options.itemSelector,
    keyOf: options.keyOf, onCommit: options.onCommit,
    axis: options.axis || "list",
    scrollEl: options.scrollEl || null,
    items0: items,
    keys0: items.map(options.keyOf),
    indicator: null
  };
  if (handle.setPointerCapture &&
      ev.pointerId !== undefined) {
    try { handle.setPointerCapture(ev.pointerId); }
    catch (e) { /* capture is a nicety, not the drag */ }
  }
  window.addEventListener("pointermove", onReorderDragMove);
  window.addEventListener("pointerup", onReorderDragUp);
  window.addEventListener("pointercancel",
    onReorderDragCancel);
  document.addEventListener("keydown",
    onReorderDragKeydown, true);
}

/* Where the dragged item lands among the others for a
   pointer at (x, y): the first other item the pointer
   has reached. A list reads by vertical midpoint; the
   Home grid reads in reading order (a row's top first,
   then the midpoint across the row). */
function reorderDragIndex(others, x, y, axis) {
  for (let i = 0; i < others.length; i++) {
    const r = others[i].getBoundingClientRect();
    if (axis === "grid") {
      if (y < r.top) { return i; }
      if (y <= r.bottom) {
        return x < (r.left + r.right) / 2 ? i : i + 1;
      }
    } else if (y < (r.top + r.bottom) / 2) {
      return i;
    }
  }
  return others.length;
}

function clearReorderIndicators(session) {
  if (session.indicator) {
    session.indicator.classList.remove("ss-drop-before");
    session.indicator.classList.remove("ss-drop-after");
    session.indicator = null;
  }
}

function onReorderDragMove(ev) {
  const s = ssReorderDrag;
  if (!s || ev.pointerId !== s.pointerId) { return; }
  if (!s.engaged) {
    if (Math.hypot(ev.clientX - s.startX,
        ev.clientY - s.startY) < SS_REORDER_DRAG_PX) {
      return;
    }
    s.engaged = true;
    s.item.classList.add("ss-drag-item");
    document.body.classList.add("ss-reorder-dragging");
  }
  ev.preventDefault();
  const items = ssReorderItems(s.container, s.selector);
  const others = items.filter(function (el) {
    return el !== s.item;
  });
  if (!others.length) { return; }
  const idx = reorderDragIndex(others, ev.clientX,
    ev.clientY, s.axis);
  clearReorderIndicators(s);
  if (idx >= others.length) {
    const last = others[others.length - 1];
    if (s.container.lastElementChild !== s.item) {
      s.container.appendChild(s.item);
    }
    last.classList.add("ss-drop-after");
    s.indicator = last;
  } else {
    const ref = others[idx];
    if (ref.previousElementSibling !== s.item) {
      s.container.insertBefore(s.item, ref);
    }
    ref.classList.add("ss-drop-before");
    s.indicator = ref;
  }
  const sc = typeof s.scrollEl === "function"
    ? s.scrollEl() : s.scrollEl;
  if (sc) {
    const r = sc.getBoundingClientRect();
    if (ev.clientY < r.top + 40 && sc.scrollTop > 0) {
      sc.scrollTop -= 12;
    } else if (ev.clientY > r.bottom - 40 &&
        sc.scrollTop <
          sc.scrollHeight - sc.clientHeight) {
      sc.scrollTop += 12;
    }
  }
}

function finishReorderDrag(commit) {
  const s = ssReorderDrag;
  if (!s) { return; }
  ssReorderDrag = null;
  window.removeEventListener("pointermove",
    onReorderDragMove);
  window.removeEventListener("pointerup", onReorderDragUp);
  window.removeEventListener("pointercancel",
    onReorderDragCancel);
  document.removeEventListener("keydown",
    onReorderDragKeydown, true);
  clearReorderIndicators(s);
  s.item.classList.remove("ss-drag-item");
  document.body.classList.remove("ss-reorder-dragging");
  if (!s.engaged) { return; }
  if (!commit) {
    /* Restore the order the drag started from. */
    s.items0.forEach(function (el) {
      s.container.appendChild(el);
    });
    return;
  }
  const keys = ssReorderItems(s.container, s.selector)
    .map(s.keyOf);
  const changed = keys.length !== s.keys0.length ||
    keys.some(function (k, i) { return k !== s.keys0[i]; });
  if (changed) { s.onCommit(keys); }
}

function onReorderDragUp(ev) {
  if (!ssReorderDrag ||
      ev.pointerId !== ssReorderDrag.pointerId) {
    return;
  }
  finishReorderDrag(true);
}

function onReorderDragCancel(ev) {
  if (!ssReorderDrag ||
      ev.pointerId !== ssReorderDrag.pointerId) {
    return;
  }
  finishReorderDrag(false);
}

function onReorderDragKeydown(ev) {
  if (ev.key === "Escape" && ssReorderDrag) {
    ev.preventDefault();
    finishReorderDrag(false);
  }
}

/* The Shortcuts surface's order owner: write a dragged
   order (the rendered rows' kind and target keys) into
   state.shortcuts and persist it through the shortcuts
   save. Entries whose targets exist nowhere render no
   row and so cannot be dragged; they keep their slots,
   and the dragged sequence fills the rendered entries'
   slots in order, so a ghost entry can never be moved
   or lost by a drag it was not part of. Returns true
   when the order changed. */
function reorderShortcutsTo(keys) {
  const rendered = state.shortcuts.filter(function (e) {
    return shortcutTarget(e).state !== "missing";
  });
  const byKey = {};
  rendered.forEach(function (e) {
    byKey[e.kind + "\n" + e.id] = e;
  });
  const seq = keys.map(function (k) { return byKey[k]; });
  if (seq.length !== rendered.length ||
      seq.some(function (e) { return !e; })) {
    return false;
  }
  if (seq.every(function (e, i) {
      return e === rendered[i];
    })) {
    return false;
  }
  let at = 0;
  state.shortcuts = state.shortcuts.map(function (e) {
    return shortcutTarget(e).state === "missing"
      ? e : seq[at++];
  });
  persistShortcuts();
  renderAll();
  return true;
}

/* --------------------------------------------------------------------------
   v2.31: shortcuts (Evernote parity, phase 1 release 3)

   Evernote's model, from its own help pages and guides:
   Shortcuts is a section in the sidebar holding quick links
   to the things a person goes back to: notes, notebooks,
   notebook stacks, tags, and saved searches. An item is
   added from its own menu ("Add to Shortcuts"), the list
   keeps the order the items were added in, a click jumps
   straight to the target, and a shortcut is removed from
   the shortcut's own menu, never touching the target.
   Shortcuts sync across devices. SnakeScale covers notes,
   notebooks, stacks, and tags here; saved searches are
   phase 1 release 4 and do not exist yet, so search
   shortcuts arrive with them (a named deviation).

   v2.32 addendum: saved searches arrived in phase 1
   release 4, and with them the fifth shortcut kind,
   "search", closing the deviation named above. A search
   entry's label is the search's current name, read at
   render time like every other kind, and following it
   runs the search. Evernote offers the shortcut from the
   save naming pop-up's checkbox; here each saved
   search's own menu in the search panel carries the
   toggle, the dialog deviation family again.

   The list lives in index.json as an ordered array of
   {kind, id} entries (see the state field for why index.json
   and not settings). An entry stores IDENTITY only, never a
   label: a note by its id, a notebook by its slug, a stack
   or a tag by its name. Labels are read from the target at
   render time, so a renamed note or notebook shows its new
   name on its shortcut by itself; the renames that change
   identity itself (renameNotebook moves the slug,
   renameTag rewrites the string, renameStack renames the
   grouping) rewrite the entries through
   shortcutsFollowRename, and the deletes that end a
   target's existence drop the entry through shortcutsDrop
   or the load time prune below.

   Dead entries: a shortcut whose note sits in Trash or
   Archive is kept, rendered muted with the place named in
   its label, and a click answers with the message the note
   links give ("That note is in Trash." and its Archive
   twin), never opening the note. A shortcut whose target
   exists nowhere renders no row at all, and pruneShortcuts
   drops it from the stored list at the next load; the
   in-session deletes drop theirs at once.
   -------------------------------------------------------------------------- */

const SHORTCUT_KINDS = ["note", "notebook", "stack", "tag",
  "search"];

/* Read a stored list into a safe one: only entries with a
   known kind and a non-blank string target survive, and a
   target appears once (first occurrence wins), so a hand
   edited or damaged index.json can never duplicate a row
   or point one at nothing the model knows. */
function sanitizeShortcuts(raw) {
  const out = [];
  if (!Array.isArray(raw)) { return out; }
  raw.forEach(function (e) {
    if (!e || typeof e !== "object") { return; }
    if (SHORTCUT_KINDS.indexOf(e.kind) < 0) { return; }
    if (typeof e.id !== "string" || !e.id.trim()) { return; }
    const dupe = out.some(function (x) {
      return x.kind === e.kind && x.id === e.id;
    });
    if (dupe) { return; }
    out.push({ kind: e.kind, id: e.id });
  });
  return out;
}

function hasShortcut(kind, id) {
  return state.shortcuts.some(function (sc) {
    return sc.kind === kind && sc.id === id;
  });
}

/* The shortcuts list is index data, so its saves take the
   shape every other index fact takes: the index write
   behind the caller's back (guarded to a live store), and
   the cache with it. */
function persistShortcuts() {
  if (state.online && state.repoExists) { saveIndex(); }
  saveCache();
}

/* Add a shortcut, appended at the end of the list, the
   place Evernote puts a new one. Adding what is already
   there is refused with a quiet message and changes
   nothing. Returns true when the entry was added. */
function addShortcut(kind, id) {
  if (SHORTCUT_KINDS.indexOf(kind) < 0 ||
      typeof id !== "string" || !id) {
    return false;
  }
  if (hasShortcut(kind, id)) {
    toast("That is already in Shortcuts.");
    return false;
  }
  state.shortcuts.push({ kind: kind, id: id });
  persistShortcuts();
  renderAll();
  return true;
}

/* Remove a shortcut. Only the entry goes; the target is
   never touched, which is the whole of the operation.
   Returns true when an entry was removed. */
function removeShortcut(kind, id) {
  if (!hasShortcut(kind, id)) { return false; }
  state.shortcuts = state.shortcuts.filter(function (sc) {
    return !(sc.kind === kind && sc.id === id);
  });
  persistShortcuts();
  renderAll();
  return true;
}

function toggleShortcut(kind, id) {
  if (hasShortcut(kind, id)) { return removeShortcut(kind, id); }
  return addShortcut(kind, id);
}

/* Where one entry's target stands: "live" (present and
   openable), "trash" or "archive" (a note parked in one of
   the two collections), or "missing" (exists nowhere).
   The label is the target's CURRENT name, read here at
   render time; a missing target has no label because it
   renders no row. */
function shortcutTarget(entry) {
  if (entry.kind === "note") {
    const live = state.notes.find(function (n) {
      return n.id === entry.id;
    });
    if (live) {
      return { state: "live", label: live.title || "Untitled note", note: live };
    }
    const trashed = state.trash.find(function (n) {
      return n.id === entry.id;
    });
    if (trashed) {
      return { state: "trash", label: trashed.title || "Untitled note", note: trashed };
    }
    const archived = state.archive.find(function (n) {
      return n.id === entry.id;
    });
    if (archived) {
      return { state: "archive", label: archived.title || "Untitled note", note: archived };
    }
    return { state: "missing", label: "" };
  }
  if (entry.kind === "notebook") {
    const nb = state.notebooks.find(function (n) {
      return n.slug === entry.id;
    });
    return nb
      ? { state: "live", label: nb.name, notebook: nb }
      : { state: "missing", label: "" };
  }
  if (entry.kind === "stack") {
    return stackNames().indexOf(entry.id) >= 0
      ? { state: "live", label: entry.id }
      : { state: "missing", label: "" };
  }
  if (entry.kind === "search") {
    /* v2.32: the search's current name is the label, so a
       rename follows on its own, like every other kind. */
    const found = savedSearchById(entry.id);
    return found
      ? { state: "live", label: found.name }
      : { state: "missing", label: "" };
  }
  return tagExists(entry.id)
    ? { state: "live", label: entry.id }
    : { state: "missing", label: "" };
}

/* Drop stored entries whose targets exist nowhere. Runs at
   the end of every store load, when the whole library is
   in memory to judge against; Trash and Archive entries
   are kept, since those notes exist. A changed list is
   written back through the ordinary index save. */
function pruneShortcuts() {
  if (!state.shortcuts.length) { return; }
  const kept = state.shortcuts.filter(function (entry) {
    return shortcutTarget(entry).state !== "missing";
  });
  if (kept.length === state.shortcuts.length) { return; }
  state.shortcuts = kept;
  persistShortcuts();
}

/* Rename plumbing: the renames that change an identity
   (a notebook's slug, a tag's string, a stack's name)
   rewrite their entries here, before the rename's own
   index save writes the list back out. */
function shortcutsFollowRename(kind, oldId, newId) {
  state.shortcuts.forEach(function (sc) {
    if (sc.kind === kind && sc.id === oldId) { sc.id = newId; }
  });
}

/* Delete plumbing: drop every entry naming one target.
   Returns true when the list changed, so a caller whose
   own flow writes no index can persist the drop itself. */
function shortcutsDrop(kind, id) {
  const before = state.shortcuts.length;
  state.shortcuts = state.shortcuts.filter(function (sc) {
    return !(sc.kind === kind && sc.id === id);
  });
  return state.shortcuts.length !== before;
}

/* One icon per kind, in the rail's stroke voice: a page
   for a note, the rail's own book for a notebook, stacked
   layers for a stack, a luggage tag for a tag, and (v2.32)
   a magnifier for a saved search. */
const SHORTCUT_ICONS = {
  note: "<svg viewBox=\"0 0 20 20\" width=\"15\" height=\"15\" aria-hidden=\"true\" focusable=\"false\"><path d=\"M6 2.5h5.5L15 6v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-13A1 1 0 0 1 6 2.5zM11 2.5V6h4\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linejoin=\"round\" fill=\"none\"/></svg>",
  notebook: "<svg viewBox=\"0 0 20 20\" width=\"15\" height=\"15\" aria-hidden=\"true\" focusable=\"false\"><path d=\"M4 3.5C4 2.7 4.7 2 5.5 2H10v16H5.5C4.7 18 4 17.3 4 16.5zM16 3.5C16 2.7 15.3 2 14.5 2H10v16h4.5c.8 0 1.5-.7 1.5-1.5z\" fill=\"currentColor\" stroke=\"none\"/></svg>",
  stack: "<svg viewBox=\"0 0 20 20\" width=\"15\" height=\"15\" aria-hidden=\"true\" focusable=\"false\"><path d=\"M10 3l8 4-8 4-8-4zM3.5 12.5L10 16l6.5-3.5\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linejoin=\"round\" fill=\"none\"/></svg>",
  tag: "<svg viewBox=\"0 0 20 20\" width=\"15\" height=\"15\" aria-hidden=\"true\" focusable=\"false\"><path d=\"M3.5 3.5H10L16.5 10 10 16.5 3.5 10z\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linejoin=\"round\" fill=\"none\"/><circle cx=\"7.2\" cy=\"7.2\" r=\"1.3\" fill=\"currentColor\" stroke=\"none\"/></svg>",
  search: "<svg viewBox=\"0 0 20 20\" width=\"15\" height=\"15\" aria-hidden=\"true\" focusable=\"false\"><circle cx=\"9\" cy=\"9\" r=\"5.5\" stroke=\"currentColor\" stroke-width=\"1.5\" fill=\"none\"/><path d=\"M13.5 13.5L17 17\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" fill=\"none\"/></svg>"
};

/* One shortcut row in the sidebar Shortcuts section: the
   main button (kind icon plus the target's current label)
   and the three dot button that opens the row's menu,
   the tag row's shape. The row carries the entry's kind
   and target in data attributes. A missing target builds
   no row (null); a Trash or Archive note builds a muted
   row whose label names the place. The active treatment
   follows the same facts the real rows use: the open
   note, the open notebook view, the active tag filter. */
function buildShortcutRow(entry) {
  const target = shortcutTarget(entry);
  if (target.state === "missing") { return null; }
  const wrap = document.createElement("div");
  wrap.className = "nav-shortcut-row" +
    (target.state === "live" ? "" : " dead");
  wrap.setAttribute("data-kind", entry.kind);
  wrap.setAttribute("data-target", entry.id);
  const btn = document.createElement("button");
  btn.type = "button";
  let active = false;
  if (entry.kind === "note") {
    active = target.state === "live" && state.selectedId === entry.id;
  } else if (entry.kind === "notebook") {
    active = state.view.kind === "notebook" &&
      state.view.value === entry.id;
  } else if (entry.kind === "tag") {
    active = state.view.kind === "tag" &&
      state.view.value === entry.id;
  } else if (entry.kind === "search") {
    /* v2.32: active while the running search is this
       entry's stored query, both sides read the way the
       search box normalizes (trimmed, lowercased). */
    const se = savedSearchById(entry.id);
    active = !!se && state.search ===
      String(se.query || "").trim().toLowerCase();
  }
  btn.className = "nav-item nav-shortcut-main" + (active ? " active" : "");
  const icon = document.createElement("span");
  icon.className = "nav-shortcut-icon";
  icon.innerHTML = SHORTCUT_ICONS[entry.kind] || "";
  btn.appendChild(icon);
  const label = document.createElement("span");
  label.className = "nav-shortcut-label";
  label.textContent = (entry.kind === "tag" ? "# " : "") + target.label;
  if (target.state === "trash" || target.state === "archive") {
    const where = document.createElement("span");
    where.className = "nav-shortcut-where";
    where.textContent = target.state === "trash"
      ? " (in Trash)" : " (in Archive)";
    label.appendChild(where);
  }
  btn.appendChild(label);
  btn.addEventListener("click", function () {
    followShortcut(entry);
  });
  /* v2.42: the row's drag handle, ahead of the main
     button. Dragging it reorders the Shortcuts list
     through the shared helper and reorderShortcutsTo;
     the main button's click and the menu button are
     separate elements, so neither can start or be
     mistaken for a drag. */
  const dragBtn = document.createElement("button");
  dragBtn.type = "button";
  dragBtn.className = "nav-shortcut-drag ss-drag-handle";
  dragBtn.setAttribute("aria-label",
    "Drag to reorder shortcut " + target.label);
  dragBtn.title = "Drag to reorder";
  dragBtn.innerHTML = SS_DRAG_GRIP_ICON;
  wrap.appendChild(dragBtn);
  attachReorderDrag(dragBtn, wrap, {
    itemSelector: ".nav-shortcut-row",
    keyOf: function (el) {
      return el.getAttribute("data-kind") + "\n" +
        el.getAttribute("data-target");
    },
    scrollEl: function () {
      return document.getElementById("sidebar");
    },
    onCommit: function (keys) { reorderShortcutsTo(keys); }
  });
  wrap.appendChild(btn);
  const menuBtn = document.createElement("button");
  menuBtn.type = "button";
  menuBtn.className = "nav-shortcut-menu-btn";
  menuBtn.setAttribute("aria-haspopup", "true");
  menuBtn.setAttribute("aria-label", "Shortcut actions");
  menuBtn.title = "Shortcut actions";
  menuBtn.innerHTML = "&#8943;";
  menuBtn.addEventListener("click", function () {
    openShortcutMenu(entry, wrap);
  });
  wrap.appendChild(menuBtn);
  return wrap;
}

/* Jump to one shortcut's target, the way clicking the real
   item jumps: a notebook opens its note list, a tag applies
   its filter (with the tag rows' click again to clear
   rule), a note opens in the editor (through the note
   links' own rule, switching to All Notes first when the
   current list does not hold it). A note in Trash or
   Archive answers with the note links' message instead.
   A stack has no view of its own to open, so its click
   unfolds the stack group in the sidebar: the notebooks
   behind the shortcut become visible where they live (a
   named deviation from Evernote, whose stack shortcut
   opens the stack). */
function followShortcut(entry) {
  const target = shortcutTarget(entry);
  if (target.state === "missing") { return; }
  if (entry.kind === "note") {
    if (target.state === "trash") {
      toast("That note is in Trash.");
      return;
    }
    if (target.state === "archive") {
      toast("That note is in the Archive.");
      return;
    }
    if (!listViewContainsNote(target.note)) {
      state.view = { kind: "all", value: null };
    }
    openNote(entry.id);
    return;
  }
  if (entry.kind === "notebook") {
    state.view = { kind: "notebook", value: entry.id };
    renderAll();
    setMobileView("list");
    return;
  }
  if (entry.kind === "tag") {
    if (state.view.kind === "tag" && state.view.value === entry.id) {
      state.view = { kind: "all", value: null };
    } else {
      state.view = { kind: "tag", value: entry.id };
    }
    renderAll();
    setMobileView("list");
    return;
  }
  if (entry.kind === "search") {
    /* v2.32: following a search shortcut runs the search,
       exactly as clicking the saved search itself does. */
    const se = savedSearchById(entry.id);
    if (se) { runSavedSearch(se); }
    return;
  }
  const ci = state.collapsedStacks.indexOf(entry.id);
  if (ci >= 0) {
    state.collapsedStacks.splice(ci, 1);
    saveSettings();
    renderSidebar();
  }
}

/* The shortcut row menu (Remove from Shortcuts). One
   shared element parked in the Shortcuts section;
   shortcutMenuFor holds the entry it was opened for (a
   copy, so a render cannot change what it names).
   Positioned under its row at open time from the row's
   own offsets inside the section, like the tag menu. */
let shortcutMenuFor = null;
function openShortcutMenu(entry, rowEl) {
  const menu = document.getElementById("shortcutMenu");
  if (!menu) { return; }
  if (shortcutMenuFor && shortcutMenuFor.kind === entry.kind &&
      shortcutMenuFor.id === entry.id &&
      !menu.classList.contains("hidden")) {
    closeShortcutMenu();
    return;
  }
  shortcutMenuFor = { kind: entry.kind, id: entry.id };
  if (rowEl) {
    menu.style.top = (rowEl.offsetTop + rowEl.offsetHeight + 2) + "px";
  }
  menu.classList.remove("hidden");
}
function closeShortcutMenu() {
  const menu = document.getElementById("shortcutMenu");
  if (menu) { menu.classList.add("hidden"); }
  shortcutMenuFor = null;
}

/* --------------------------------------------------------------------------
   v2.32: saved searches (Evernote parity, phase 1 release 4)

   Evernote's model, from its own help pages: a saved search
   stores the search itself, the query text in the search
   grammar, under a name; it syncs across devices; running
   one puts its query back in the search bar and re-runs
   it; and it is managed where it was made, from the search
   surface (in current Evernote, the search modal lists the
   saved searches beside the recent ones, the save step is
   "Save search" at the top of the results, and editing or
   deleting happens by running the search and opening its
   menu there). Closest equivalents here: Save search sits
   at the top of the note list while a search is active and
   becomes Edit saved search while the active search is a
   saved one; the list lives in the panel that opens under
   the search box on focus; each entry's own menu renames
   it, deletes it (a delete never touches a note), or adds
   it to Shortcuts (the toggle Evernote puts in its save
   pop-up's checkbox; see the shortcuts section).

   The list lives in index.json as an ordered array of
   {id, name, query} entries (see the state field for why
   index.json and not settings), plumbed through every
   index write, load, cache, and folder rebuild path
   exactly as the tag parent map (v2.30) and the shortcuts
   list (v2.31) are, and sanitized on every read.
   -------------------------------------------------------------------------- */

/* Read a stored list into a safe one: only entries with a
   non-blank id, name, and query survive, and an id appears
   once (first occurrence wins), so a hand edited or
   damaged index.json can never produce a dead row. */
function sanitizeSavedSearches(raw) {
  const out = [];
  if (!Array.isArray(raw)) { return out; }
  raw.forEach(function (e) {
    if (!e || typeof e !== "object") { return; }
    if (typeof e.id !== "string" || !e.id.trim()) { return; }
    if (typeof e.name !== "string" || !e.name.trim()) { return; }
    if (typeof e.query !== "string" || !e.query.trim()) { return; }
    const dupe = out.some(function (x) { return x.id === e.id; });
    if (dupe) { return; }
    out.push({ id: e.id, name: e.name, query: e.query });
  });
  return out;
}

function savedSearchById(id) {
  return state.savedSearches.find(function (e) {
    return e.id === id;
  }) || null;
}

/* Query text is compared the way the search box normalizes
   what is typed (trimmed, lowercased): two queries that
   differ only in case or edge spaces are the same search
   for the Edit saved search label and the duplicate name
   flows below. */
function normalizeSearchText(q) {
  return String(q || "").trim().toLowerCase();
}

function savedSearchForQuery(q) {
  const nq = normalizeSearchText(q);
  if (!nq) { return null; }
  return state.savedSearches.find(function (e) {
    return normalizeSearchText(e.query) === nq;
  }) || null;
}

function savedSearchNameTaken(name, exceptId) {
  const nn = String(name || "").trim().toLowerCase();
  return state.savedSearches.some(function (e) {
    return e.id !== exceptId &&
      e.name.trim().toLowerCase() === nn;
  });
}

/* The saved searches list is index data, so its saves take
   the shape every other index fact takes (the persist
   twins above): the index write behind the caller's back,
   guarded to a live store, and the cache with it. */
function persistSavedSearches() {
  if (state.online && state.repoExists) { saveIndex(); }
  saveCache();
}

/* Save a search under a name. A name already taken (in any
   case) is refused with a message, the rule the stacks
   and tags keep; a blank name or query saves nothing.
   Returns the new entry, or null when refused. */
function createSavedSearch(name, query) {
  const nm = String(name || "").trim();
  const q = String(query || "").trim();
  if (!nm || !q) { return null; }
  if (savedSearchNameTaken(nm, null)) {
    toast("A saved search named \"" + nm + "\" already exists.", true);
    return null;
  }
  const entry = { id: newNoteId(), name: nm, query: q };
  state.savedSearches.push(entry);
  persistSavedSearches();
  renderAll();
  return entry;
}

/* Rename a saved search. The entry keeps its id, so its
   shortcut entries keep pointing at it and show the new
   name by themselves. Returns false when refused. */
function renameSavedSearch(id, name) {
  const entry = savedSearchById(id);
  const nm = String(name || "").trim();
  if (!entry || !nm) { return false; }
  if (nm === entry.name) { return true; }
  if (savedSearchNameTaken(nm, id)) {
    toast("A saved search named \"" + nm + "\" already exists.", true);
    return false;
  }
  entry.name = nm;
  persistSavedSearches();
  renderAll();
  return true;
}

/* Delete a saved search. Only the entry and its shortcut
   entries go; no note is ever touched. */
function deleteSavedSearch(id) {
  const entry = savedSearchById(id);
  if (!entry) { return false; }
  state.savedSearches = state.savedSearches.filter(function (e) {
    return e.id !== id;
  });
  shortcutsDrop("search", id);
  persistSavedSearches();
  renderAll();
  return true;
}

/* Run a saved search: its query goes back into the search
   box (the text Evernote restores) and the list re-runs,
   in the current view, exactly as if it had been typed.
   The stored query is the search grammar itself, so a
   saved search using operators re-runs identically. */
function runSavedSearch(entry) {
  const input = document.getElementById("searchInput");
  if (input) { input.value = entry.query; }
  state.search = normalizeSearchText(entry.query);
  closeSavedSearchPanel();
  /* v2.33: run from Home (the Filtered Notes widget's
     title, or a search shortcut clicked while Home is
     showing), the results are the destination: land on
     All Notes with them, the way Evernote leaves Home
     for a search. From any other view nothing changes. */
  if (state.view.kind === "home") {
    state.view = { kind: "all", value: null };
    renderAll();
  } else {
    renderNoteList();
  }
  setMobileView("list");
}

/* The Save search button at the top of the results: shown
   only while a search is active (Evernote offers the save
   from the results), and labeled Edit saved search while
   the active search is one of the saved ones, the state
   Evernote's edit flow keys on. Called from renderNoteList
   so the label always matches the list on screen. */
function syncSaveSearchButton() {
  const btn = document.getElementById("saveSearchBtn");
  if (!btn) { return; }
  if (!state.search) {
    btn.classList.add("hidden");
    return;
  }
  btn.classList.remove("hidden");
  btn.textContent = savedSearchForQuery(state.search)
    ? "Edit saved search" : "Save search";
}

/* The saved searches panel under the search box. It opens
   on focus or click while at least one saved search
   exists, and its rows filter by what is typed, matching
   the name or the query; the entry menu is shared and
   positioned under its row at open time, like the other
   sidebar menus. */
let savedSearchMenuFor = null;

/* v2.72: the saved search panel's save row. Chris could
   not create a saved search at all: the one door was
   the results head's quiet text link (now a real
   button), and the panel itself would not even open
   while no saved search existed. So the panel the
   search box opens carries the same door at its top:
   while a phrase stands in the box, the row offers
   Save search (or Edit saved search while the phrase
   is a saved one, the results button's own two
   labels) and runs the same promptSaveSearch flow.
   With no phrase the slot is empty and the panel is
   the list it has always been. */
function renderSavedSearchSaveRow() {
  const slot = document.getElementById("savedSearchSaveSlot");
  if (!slot) { return; }
  slot.innerHTML = "";
  const input = document.getElementById("searchInput");
  const raw = input ? input.value.trim() : "";
  if (!raw) { return; }
  const row = document.createElement("button");
  row.type = "button";
  row.id = "savedSearchSaveRow";
  row.className = "saved-search-save-row";
  row.textContent = savedSearchForQuery(state.search)
    ? "Edit saved search" : "Save search";
  row.addEventListener("click", function () {
    promptSaveSearch();
    renderSavedSearchPanel();
  });
  slot.appendChild(row);
}

function renderSavedSearchPanel() {
  const list = document.getElementById("savedSearchList");
  if (!list) { return; }
  renderSavedSearchSaveRow();
  const input = document.getElementById("searchInput");
  const needle = normalizeSearchText(input ? input.value : "");
  list.innerHTML = "";
  const shown = state.savedSearches.filter(function (e) {
    return !needle ||
      e.name.toLowerCase().indexOf(needle) >= 0 ||
      e.query.toLowerCase().indexOf(needle) >= 0;
  });
  if (!shown.length) {
    const empty = document.createElement("div");
    empty.className = "saved-search-empty";
    empty.textContent = state.savedSearches.length
      ? "No saved searches match."
      : "No saved searches yet.";
    list.appendChild(empty);
    return;
  }
  shown.forEach(function (entry) {
    const row = document.createElement("div");
    row.className = "saved-search-row";
    row.setAttribute("data-id", entry.id);
    const main = document.createElement("button");
    main.type = "button";
    main.className = "saved-search-main";
    const nm = document.createElement("span");
    nm.className = "saved-search-name";
    nm.textContent = entry.name;
    main.appendChild(nm);
    const q = document.createElement("span");
    q.className = "saved-search-query";
    q.textContent = entry.query;
    main.appendChild(q);
    main.addEventListener("click", function () {
      runSavedSearch(entry);
    });
    row.appendChild(main);
    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "saved-search-menu-btn";
    menuBtn.setAttribute("aria-haspopup", "true");
    menuBtn.setAttribute("aria-label", "Saved search actions");
    menuBtn.title = "Saved search actions";
    menuBtn.innerHTML = "&#8943;";
    menuBtn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      openSavedSearchMenu(entry, row);
    });
    row.appendChild(menuBtn);
    list.appendChild(row);
  });
}

function openSavedSearchPanel() {
  const panel = document.getElementById("savedSearchPanel");
  if (!panel) { return; }
  /* v2.72: the panel also opens with no saved searches
     while a phrase stands in the box, because its save
     row is the creation door; with neither a search nor
     a phrase it stays closed, as it always has. */
  const input = document.getElementById("searchInput");
  const hasPhrase = !!(input && input.value.trim());
  if (!state.savedSearches.length && !hasPhrase) { return; }
  renderSavedSearchPanel();
  panel.classList.remove("hidden");
}

function closeSavedSearchPanel() {
  closeSavedSearchMenu();
  const panel = document.getElementById("savedSearchPanel");
  if (panel) { panel.classList.add("hidden"); }
}

/* The saved search entry menu: Rename, the Shortcuts
   toggle (its label is set at open time, the v2.30/2.31
   toggle pattern), and Delete. savedSearchMenuFor holds
   the entry's id (a string, so a render cannot change
   what the menu names). */
function openSavedSearchMenu(entry, rowEl) {
  const menu = document.getElementById("savedSearchMenu");
  if (!menu) { return; }
  if (savedSearchMenuFor === entry.id &&
      !menu.classList.contains("hidden")) {
    closeSavedSearchMenu();
    return;
  }
  savedSearchMenuFor = entry.id;
  const scBtn = document.getElementById("savedSearchShortcutBtn");
  if (scBtn) {
    scBtn.textContent = hasShortcut("search", entry.id)
      ? "Remove from Shortcuts" : "Add to Shortcuts";
  }
  if (rowEl) {
    menu.style.top = (rowEl.offsetTop + rowEl.offsetHeight + 2) + "px";
  }
  menu.classList.remove("hidden");
}

function closeSavedSearchMenu() {
  const menu = document.getElementById("savedSearchMenu");
  if (menu) { menu.classList.add("hidden"); }
  savedSearchMenuFor = null;
}

/* The Save search button's flow: with no saved search
   matching the active query it prompts for a name (the
   typed search is the offered default) and saves; with a
   match it edits that search, Evernote's "Edit saved
   search", renaming in place. The prompts are the app's
   native prompt flow, the dialog deviation the stacks
   and tags releases already carry. */
function promptSaveSearch() {
  const input = document.getElementById("searchInput");
  const raw = input ? input.value.trim() : "";
  if (!raw) { return; }
  const existing = savedSearchForQuery(state.search);
  if (existing) {
    const next = prompt("Rename saved search", existing.name);
    if (next === null) { return; }
    renameSavedSearch(existing.id, next);
    return;
  }
  const name = prompt("Name this search", raw);
  if (name === null) { return; }
  if (createSavedSearch(name, raw)) {
    toast("Search \"" + String(name).trim() + "\" saved.");
  }
}

function promptRenameSavedSearch(entry) {
  const next = prompt("Rename saved search", entry.name);
  if (next === null) { return; }
  renameSavedSearch(entry.id, next);
}

function confirmDeleteSavedSearch(entry) {
  const msg = "Delete the saved search \"" + entry.name + "\"?\n\n" +
    "Only the saved search is deleted. Your notes are not touched.";
  if (!confirm(msg)) { return; }
  deleteSavedSearch(entry.id);
  toast("Saved search \"" + entry.name + "\" deleted.");
}

