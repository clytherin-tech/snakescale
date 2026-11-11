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
   10. Editor behavior
   The editor reads and writes the note object through collectEditor(),
   which pulls title, tags, and body HTML out of the form.
   (Through v2.1 it also pulled the Pinned checkbox; v2.2 removed that
   control, so collectEditor no longer touches note.pinned at all and
   the flag is changed only from the notes list toolbar menu. v2.5
   removed the notebook dropdown the same way: collectEditor no longer
   touches note.notebook, which changes only through the move paths.)
   Autosave is debounced at about 800 ms after the last edit. If the note
   moved notebooks, the file is written to the new folder and the old file
   is removed. Save results update the saved state text and, for lists,
   only the sidebar and list panes re-render, never the editor itself, so
   typing is never interrupted.
   -------------------------------------------------------------------------- */
/* v1.2: canonicalize attachment placeholders before a body is saved.
   While a note is open, hydration fills each .ss-attachment placeholder
   with live DOM: an <img> with a blob URL, file name text, buttons, and
   possibly an error message. NONE of that may be persisted. This walks
   the HTML and replaces every placeholder with a clean empty shell that
   carries only the tag kind (figure for images, div for files), the
   class, the attachment id, and contenteditable=false. It is called from
   collectEditor, which is the single funnel every save passes through,
   so autosave, trash moves, restores, and notebook moves all store the
   same canonical form.
   v1.6 additions, same rule: an expanded PDF preview (an iframe with a
   blob URL inside a .ss-att-preview box) is editor only furniture, so
   it vanishes with the rest of the hydrated content, and no blob URL
   ever reaches the saved file. The ONE piece of live state that does
   persist is a resized image's width (see savedImageWidthOf): it is
   carried onto the shell as its style, so the saved placeholder itself
   remembers how wide its image should render.
   v1.7.2: that width is read from the placeholder (the block) itself,
   never from the <img>: since v1.7.2 the block carries the size and
   the image merely fills it, so there is exactly one place the size
   can live in the live DOM, and this shell copy is it. (Notes saved
   by v1.6 or v1.7 carried the width on the block's style in the file
   too; only their live DOM put it on the image, and the decoration
   pass migrates that form the next time such a note is edited.) */
/* v2.11: the image presentation state that DOES persist, as plain
   attributes on the figure itself: data-ss-align (the alignment
   chosen in the image menu's submenu) and data-ss-view ("title"
   collapses the image to a name bar; absent means the image
   itself, the Preview mode). Absence of data-ss-align is the
   original rendering and reads as Left align in the submenu (see
   imageAlignOf). Anything outside these value sets is not a state
   this app writes and is dropped at save time, like an unknown
   width form. */
const IMAGE_ALIGN_VALUES = ["left", "center", "right", "fill",
  "wrap-left", "wrap-right", "free"];
function imageAlignOf(el) {
  const v = el ? el.getAttribute("data-ss-align") : null;
  return IMAGE_ALIGN_VALUES.indexOf(v) >= 0 ? v : "left";
}
function imageViewOf(el) {
  return el && el.getAttribute("data-ss-view") === "title"
    ? "title" : "preview";
}

function canonicalizeAttachmentPlaceholders(html) {
  const holder = document.createElement("div");
  holder.innerHTML = html || "";
  /* v2.120: a bare <img> with an http(s) source (a
     paste, a web clip, a hand written note file) is
     adopted into an external image figure before the
     shell rebuild below, so it saves in the one
     canonical form and renders as a block everywhere
     (see adoptBareExternalImages in media.js). */
  adoptBareExternalImages(holder);
  holder.querySelectorAll(".ss-attachment").forEach(function (el) {
    /* v2.120: an external image shell rebuilds from
       its own attributes alone: the kind mark, the
       source (validated by the one scheme gate: a
       source that fails it drops the block, because
       it can never render and no scriptable scheme
       is ever a saved form), the alt text, the chosen
       width, and the alignment, each carried in the
       attachment shell's own forms. Nothing is ever
       downloaded and no attachment record is ever
       made for it. (Through v2.119.0 this rebuild,
       knowing only records, silently discarded the
       source: a catalog note lost every poster URL
       on its first ordinary edit and save.) */
    if (el.getAttribute("data-ss-ext") === "1" ||
        el.hasAttribute("data-ss-ext-src")) {
      const extSrc = el.getAttribute("data-ss-ext-src") || "";
      if (extImageUrlError(extSrc)) { el.remove(); return; }
      const cleanExt = document.createElement("figure");
      cleanExt.setAttribute("class", "ss-attachment");
      cleanExt.setAttribute("data-ss-ext", "1");
      cleanExt.setAttribute("data-ss-ext-src", extSrc);
      const extAlt = el.getAttribute("data-ss-ext-alt");
      if (extAlt) {
        cleanExt.setAttribute("data-ss-ext-alt", extAlt);
      }
      cleanExt.setAttribute("contenteditable", "false");
      const extWidth = savedImageWidthOf(el);
      if (extWidth) {
        cleanExt.setAttribute("style", "width:" + extWidth);
      }
      const extAlign = el.getAttribute("data-ss-align");
      if (extAlign &&
          IMAGE_ALIGN_VALUES.indexOf(extAlign) >= 0) {
        cleanExt.setAttribute("data-ss-align", extAlign);
      }
      el.replaceWith(cleanExt);
      return;
    }
    const id = el.getAttribute("data-attachment-id");
    const clean = document.createElement(el.tagName === "FIGURE" ? "figure" : "div");
    clean.setAttribute("class", "ss-attachment");
    if (id) { clean.setAttribute("data-attachment-id", id); }
    clean.setAttribute("contenteditable", "false");
    const width = savedImageWidthOf(el);
    if (width) { clean.setAttribute("style", "width:" + width); }
    /* v2.11: the alignment and view mode attributes are saved
       state and ride onto the clean shell; the runtime Title face
       inside the figure does not (it is rebuilt by decoration on
       every render, like the link faces stripped below). */
    const align = el.getAttribute("data-ss-align");
    if (align && IMAGE_ALIGN_VALUES.indexOf(align) >= 0) {
      clean.setAttribute("data-ss-align", align);
    }
    if (el.getAttribute("data-ss-view") === "title") {
      clean.setAttribute("data-ss-view", "title");
    }
    /* v2.46: a sketch's placeholder marking rides the shell
       the same way, so the saved body and the attachment
       record agree about which images are sketches. */
    if (el.getAttribute("data-ss-sketch") === "1") {
      clean.setAttribute("data-ss-sketch", "1");
    }
    /* v2.11: a caption is real note content, the one figure child
       that is not editor furniture: its element and its text carry
       onto the shell, rebuilt from the text alone so no runtime
       markup can ride along inside it. */
    if (el.getAttribute("data-ss-caption") === "1") {
      clean.setAttribute("data-ss-caption", "1");
      const cap = el.querySelector("figcaption.ss-caption");
      const capOut = document.createElement("figcaption");
      capOut.setAttribute("class", "ss-caption");
      capOut.textContent = cap ? cap.textContent : "";
      clean.appendChild(capOut);
    }
    el.replaceWith(clean);
  });
  /* v2.3: the multi-cell selection highlight (ss-cell-selected) is
     runtime only editor state and must never be saved, even when a
     save happens mid-selection, so it is stripped here, in the one
     funnel every saved body passes through. The contrast is
     deliberate: ss-filtered-out on table rows is a SAVED view
     setting (the table filter) and passes through untouched. */
  holder.querySelectorAll(".ss-cell-selected").forEach(function (el) {
    el.classList.remove("ss-cell-selected");
    if (!el.classList.length) { el.removeAttribute("class"); }
  });
  /* v2.99.0: a code block's caret furniture (the
     trailing br.ss-code-caret-br that gives an
     empty last line its box, see syncCodeCaretBr)
     is editor only, like the cell selection above:
     the block's trailing newline lives in its own
     text, so a saved body carries the block exactly
     as it did before the furniture existed. */
  holder.querySelectorAll("br.ss-code-caret-br")
    .forEach(function (el) { el.remove(); });
  /* v2.117: a done item's own content wrap (the
     span.ss-done-own that carries its struck and
     muted look, see syncDoneItemWrap) is editor
     furniture in the same pattern: the saved body
     carries the item's done class and its content
     exactly as before, and the span is rebuilt by
     decoration on the next render. */
  holder.querySelectorAll("span.ss-done-own")
    .forEach(function (el) {
      while (el.firstChild) {
        el.parentNode.insertBefore(el.firstChild, el);
      }
      el.remove();
    });
  /* v2.37.0: a table of contents block canonicalizes the
     same way an attachment does: the stored element is
     rebuilt from scratch (class and contenteditable only)
     and its entries are regenerated from the holder's own
     headings, after the heading ids are ensured, so the
     saved snapshot can never drift from the saved headings
     and a stale one self corrects on the next save. Notes
     without a TOC block skip the pass entirely, and their
     headings keep no ids: byte identical to before. */
  /* v2.48.0: the fold chrome canonicalizes like the link
     faces above. The toggle buttons are editor furniture
     and never reach the file; the ss-fold-hidden class is
     a runtime view state rederived from the attributes on
     every render, so it is stripped here too (the contrast
     with ss-filtered-out above is deliberate: that class
     is a saved table setting, this one is not). What DOES
     pass through is the saved state itself,
     data-ss-folded="1" on an H1 to H3 heading, untouched
     exactly as the heading's other attributes are; the
     attribute on anything else, or with any other value,
     is damage and is stripped, so a fold can only ever be
     a heading's. */
  holder.querySelectorAll(".ss-fold-toggle").forEach(function (el) {
    el.remove();
  });
  holder.querySelectorAll(".ss-fold-hidden").forEach(function (el) {
    el.classList.remove("ss-fold-hidden");
    if (!el.classList.length) { el.removeAttribute("class"); }
  });
  holder.querySelectorAll("[data-ss-folded]").forEach(function (el) {
    if (!/^(H1|H2|H3)$/.test(el.tagName) ||
        el.getAttribute("data-ss-folded") !== "1") {
      el.removeAttribute("data-ss-folded");
    }
  });
  /* v2.49.0: a note tasks block canonicalizes harder
     than an attachment or a table of contents: the
     stored element is the BARE MARKER (class and
     contenteditable only, no children, no other
     attributes), because the block holds no task data
     at all. Whatever a live render painted into it, and
     whatever a hand edit or a damaged paste left inside
     it, is dropped here, so a saved body can never carry
     a stale task title, state, or count. A note with no
     block skips the pass, and a note whose block already
     is the marker round trips byte identically. */
  holder.querySelectorAll(".ss-note-tasks").forEach(function (el) {
    const clean = document.createElement("div");
    clean.setAttribute("class", "ss-note-tasks");
    clean.setAttribute("contenteditable", "false");
    el.replaceWith(clean);
  });
  /* v2.101.0: a numbered list level's chosen style
     (see the Numbering style menu in the editor
     context menu block) rides its ol as exactly one
     ss-num-* class and nothing else. A second style
     class standing beside the first, or a
     list-style-type left in an inline style by a
     paste, is folded into the one class here, in
     the funnel every saved body passes through, so
     the saved note, the editor stylesheet, and the
     print stylesheet all read the level's style the
     same way. Classes that are not style classes,
     and levels with no choice standing, pass
     through exactly as they were. */
  holder.querySelectorAll("ol").forEach(function (ol) {
    const known = ["ss-num-decimal", "ss-num-upper-alpha",
      "ss-num-lower-alpha", "ss-num-upper-roman",
      "ss-num-lower-roman"];
    const byValue = { "decimal": "ss-num-decimal",
      "upper-alpha": "ss-num-upper-alpha",
      "lower-alpha": "ss-num-lower-alpha",
      "upper-roman": "ss-num-upper-roman",
      "lower-roman": "ss-num-lower-roman" };
    let chosen = null;
    const styleAttr = ol.getAttribute("style");
    if (styleAttr) {
      const m = /list-style-type\s*:\s*([a-z-]+)/i
        .exec(styleAttr);
      if (m && byValue[String(m[1]).toLowerCase()]) {
        chosen = byValue[String(m[1]).toLowerCase()];
        ol.style.removeProperty("list-style-type");
        if (!ol.getAttribute("style")) {
          ol.removeAttribute("style");
        }
      }
    }
    const kept = [];
    (ol.getAttribute("class") || "").split(/\s+/)
      .forEach(function (tok) {
        if (!tok) { return; }
        if (tok.indexOf("ss-num-") === 0) {
          if (!chosen && known.indexOf(tok) !== -1) {
            chosen = tok;
          }
          return;
        }
        kept.push(tok);
      });
    if (chosen) { kept.push(chosen); }
    if (kept.length) {
      ol.setAttribute("class", kept.join(" "));
    } else if (ol.hasAttribute("class")) {
      ol.removeAttribute("class");
    }
  });
  if (holder.querySelector(".ss-toc")) {
    tocEnsureHeadingIds(holder);
    const tocEntries = tocEntriesFrom(holder);
    holder.querySelectorAll(".ss-toc").forEach(function (el) {
      const clean = document.createElement("div");
      clean.setAttribute("class", "ss-toc");
      clean.setAttribute("contenteditable", "false");
      tocRenderBlockContent(clean, tocEntries);
      el.replaceWith(clean);
    });
  }
  /* v2.9: link view faces are runtime only presentation, exactly
     like the cell selection above: a Mention or Preview anchor in
     the live body holds a .ss-link-face node and its original
     children wrapped in .ss-link-original, and neither may reach
     the saved file. The anchor itself, its data-ss-link-view mode,
     and its data-ss-link-* info attributes pass through untouched;
     they ARE the saved form of the feature. */
  stripLinkFaces(holder);
  return holder.innerHTML;
}

/* --------------------------------------------------------------------------
   v2.119: the note editor's own undo and redo history.

   Through v2.118.0 the editor leaned on the browser's
   native undo stack. Typing and the execCommand
   formatting commands fed that stack, but the app's
   many hand built operations never landed on it, or
   landed only in part: list conversions and swaps,
   Tab demote and promote (called out since v2.110.0
   as not a native undo step), checkbox toggles, the
   hand list creation fallback, table work, and the
   encryption flows' DOM surgery. Ctrl+Z after such a
   change reverted some older native step instead, or
   did nothing, so undo could not be trusted across
   the changes a note actually goes through (Chris's
   report: "Undo (Ctrl+Z) needs to fully work across
   ALL changes in notes").

   This module owns the history instead. A step is a
   snapshot: the SERIALIZED body, exactly what the
   save funnel stores (see collectEditor: the
   canonicalized form, attachment references rather
   than blob URLs, encrypted passages as ciphertext),
   the title field's raw value, and a caret bookmark
   (the selection's anchor and focus as character
   offsets into the body's text, the same measure
   captureEditorViewState uses). Because a snapshot
   is the serialized form, the editor's decoration
   passes (link faces, checklist box sync, the done
   items' own content wrap, attachment hydration,
   fold and TOC furniture) can churn the live DOM
   without ever reading as a change: their output
   serializes away.

   Capture signals: a MutationObserver over the body
   sees every DOM change however it was made; the
   body's input events classify the change (plain
   text typing, backward or forward deletion, or a
   discrete operation), and the title field's input
   events classify as title typing. Changes coalesce
   on a quiet window: a burst of one classification
   (typing at word pace, a run of Backspaces) settles
   as ONE step when the window lapses, a change of
   classification settles the open burst first and
   starts its own step, a mousedown anywhere settles
   an open burst before the click's own operation
   begins, and every discrete operation settles as
   exactly one step. A restore puts the snapshot back
   through the same decoration sequence a note open
   runs (editorHistoryFillBody mirrors the fill block
   in renderEditor), restores the title and the
   caret, and marks the note dirty so the restored
   state autosaves like any other edit.

   Bounds: at most EDITOR_HISTORY_MAX_STEPS undo
   steps, and at most EDITOR_HISTORY_MAX_CHARS of
   serialized body text across the whole history;
   the oldest steps fall off first and undo simply
   stops at the bottom. Undo at the bottom and redo
   at the top are silent no-ops. A new change after
   an undo clears the redo stack. The stack belongs
   to the open note: renderEditor's fill (a note
   switch, a sync or self update refill) resets it
   through editorHistoryReset, and a restore never
   goes through that fill, so undoing cannot reset
   the very stack it is walking.

   Scope: the note editor only, the body and the
   title field. The Home scratch pad and the task
   description editor keep the behavior they had.
   -------------------------------------------------------------------------- */
const EDITOR_HISTORY_MAX_STEPS = 100;
const EDITOR_HISTORY_MAX_CHARS = 4000000;
const EDITOR_HISTORY_TYPE_IDLE_MS = 450;
const EDITOR_HISTORY_OP_IDLE_MS = 150;
let editorHistory = null;
let editorHistoryObserver = null;

/* The serialized body a snapshot carries: the save
   funnel's own read of the live body, so a snapshot
   and a save of the same state are the same string. */
function editorHistorySerializedBody() {
  const bodyEl = document.getElementById("noteBody");
  return canonicalizeAttachmentPlaceholders(
    bodyEl ? bodyEl.innerHTML : "");
}

/* A position as a character offset into the body's
   text: the length of the text a range from the
   body's start to the position covers. Minus one
   when the position is not inside the body. */
function editorHistoryTextOffset(node, offset) {
  const bodyEl = document.getElementById("noteBody");
  if (!node || !bodyEl || !bodyEl.contains(node)) {
    return -1;
  }
  const range = document.createRange();
  range.setStart(bodyEl, 0);
  try { range.setEnd(node, offset); }
  catch (err) { return -1; }
  return range.toString().length;
}

/* Reconcile the current snapshot with the stored
   note once saves settle. Some app writes land
   asynchronously after the change that caused them
   (an encrypted passage's re-encryption chain above
   all): a settle can capture the serialized body a
   beat before the last attribute lands, and the
   autosave that follows stores the final form. If
   the stored body and the live serialized body
   agree with each other but not with the current
   snapshot, the snapshot adopts the stored form,
   so a later undo or redo restores exactly what
   the file holds. The live body must agree with
   the stored one first: while they differ, the
   difference is an unsaved edit in flight, not a
   late landing, and nothing is adopted. */
function editorHistoryReconcileNow() {
  const h = editorHistory;
  if (!h || h.applying || h.suspended || h.unsettled) {
    return;
  }
  const note = currentNote();
  if (!note || note.id !== h.noteId) { return; }
  const stored = note.body || "";
  if (stored === h.cur.body) { return; }
  if (editorHistorySerializedBody() !== stored) {
    return;
  }
  h.cur = { body: stored, title: h.cur.title,
    caret: h.cur.caret };
  const titleEl = document.getElementById("noteTitle");
  if (titleEl && typeof note.title === "string" &&
      titleEl.value === note.title) {
    h.cur.title = note.title;
  }
}

function editorHistoryArmReconcile() {
  const h = editorHistory;
  if (!h) { return; }
  if (h.reconcileTimer) { clearTimeout(h.reconcileTimer); }
  h.reconcileTimer = setTimeout(function () {
    if (editorHistory !== h) { return; }
    h.reconcileTimer = null;
    editorHistoryReconcileNow();
  }, 1400);
}

/* The caret bookmark for a snapshot: which field
   holds the selection, and the anchor and focus
   offsets in that field's own measure (the title
   input's selection offsets, or body text offsets). */
function editorHistoryCaret() {
  const titleEl = document.getElementById("noteTitle");
  if (titleEl && document.activeElement === titleEl) {
    return { field: "title",
      a: titleEl.selectionStart, f: titleEl.selectionEnd };
  }
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) {
    return { field: "body", a: -1, f: -1 };
  }
  return { field: "body",
    a: editorHistoryTextOffset(sel.anchorNode,
      sel.anchorOffset),
    f: editorHistoryTextOffset(sel.focusNode,
      sel.focusOffset) };
}

/* One snapshot of the editor as it stands. */
function editorHistoryCapture() {
  const titleEl = document.getElementById("noteTitle");
  return {
    body: editorHistorySerializedBody(),
    title: titleEl ? titleEl.value : "",
    caret: editorHistoryCaret()
  };
}

/* The note the history may act on: the open note,
   not locked, and the one the stack belongs to. */
function editorHistoryLive() {
  const h = editorHistory;
  if (!h) { return null; }
  const note = currentNote();
  if (!note || note.id !== h.noteId ||
      note.trashed || note.archived) {
    return null;
  }
  return h;
}

/* Keep the stacks inside their bounds: the oldest
   undo steps fall off first, then the oldest redo
   steps, until the step count and the serialized
   size both fit. */
function editorHistoryTrim() {
  const h = editorHistory;
  if (!h) { return; }
  const totalChars = function () {
    let n = h.cur ? h.cur.body.length : 0;
    h.undo.forEach(function (s) { n += s.body.length; });
    h.redo.forEach(function (s) { n += s.body.length; });
    return n;
  };
  while (h.undo.length > EDITOR_HISTORY_MAX_STEPS) {
    h.undo.shift();
  }
  while (totalChars() > EDITOR_HISTORY_MAX_CHARS &&
      h.undo.length) {
    h.undo.shift();
  }
  while (totalChars() > EDITOR_HISTORY_MAX_CHARS &&
      h.redo.length) {
    h.redo.shift();
  }
}

/* Fill the body from a serialized snapshot through
   the same decoration sequence renderEditor's fill
   runs, in the same order, so a restored body is
   decorated exactly as an opened one. The note's
   own object is not touched here; the caller's
   markDirty and the autosave's collect read the
   filled fields, as they do after any edit. */
function editorHistoryFillBody(note, bodyHtml) {
  const bodyEl = document.getElementById("noteBody");
  if (!bodyEl || !note) { return; }
  deselectAttachment();
  revokeAttachmentUrls();
  attachBodyGuard = true;
  bodyEl.innerHTML = bodyHtml || "";
  /* v2.120: bare web images take their block form
     before the decoration pass, as on every fill. */
  adoptBareExternalImages(bodyEl);
  normalizeChecklists(bodyEl);
  syncChecklistBoxes(bodyEl);
  decorateDoneItems(bodyEl);
  bodyEl.querySelectorAll(".ss-attachment")
    .forEach(function (el) {
      const att = (note.attachments || []).find(
        function (a) {
          return a.id === el.getAttribute(
            "data-attachment-id");
        });
      decorateAttachmentPlaceholder(note, el, att || null);
    });
  applyAllTableFilters(bodyEl);
  decorateLinkTooltips(bodyEl);
  decorateLinkViews(bodyEl);
  decorateTaskLinks(bodyEl);
  refreshTocBlocks(bodyEl);
  decorateSectionFolds(bodyEl);
  refreshNoteTaskBlocks(bodyEl, note);
  decorateCodeCaretBrs(bodyEl);
  finishNoteOpenAttachments(note).catch(function (err) {
    console.warn("Attachment hydration failed:", err);
  });
}

/* Put a snapshot's caret back: the title field's
   selection when the bookmark is the title's, else
   the body selection rebuilt from its two text
   offsets (each clamped to the text the restored
   body actually has), direction preserved through
   setBaseAndExtent where the platform offers it. */
function editorHistoryRestoreCaret(caret) {
  if (!caret) { return; }
  if (caret.field === "title") {
    const titleEl = document.getElementById("noteTitle");
    if (!titleEl) { return; }
    titleEl.focus();
    try {
      titleEl.setSelectionRange(caret.a, caret.f);
    } catch (err) { /* the field keeps its own caret */ }
    return;
  }
  if (caret.a < 0) { return; }
  const bodyEl = document.getElementById("noteBody");
  if (!bodyEl) { return; }
  const pointAt = function (wanted) {
    let remaining = wanted;
    let lastText = null;
    const walker = document.createTreeWalker(
      bodyEl, NodeFilter.SHOW_TEXT, null);
    let node = walker.nextNode();
    while (node) {
      lastText = node;
      if (remaining <= node.nodeValue.length) {
        return { node: node, offset: remaining };
      }
      remaining -= node.nodeValue.length;
      node = walker.nextNode();
    }
    return lastText ? { node: lastText,
      offset: lastText.nodeValue.length } : null;
  };
  const a = pointAt(caret.a);
  if (!a) { return; }
  const f = caret.f >= 0 ? pointAt(caret.f) : a;
  bodyEl.focus({ preventScroll: true });
  const sel = window.getSelection();
  if (!sel) { return; }
  try {
    if (f && sel.setBaseAndExtent) {
      sel.setBaseAndExtent(a.node, a.offset,
        f.node, f.offset);
    } else {
      const range = document.createRange();
      range.setStart(a.node, a.offset);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  } catch (err) { /* the body keeps its own caret */ }
}

/* Start the stack over for a note: renderEditor's
   fill calls this once the new body stands filled
   and decorated, so the baseline snapshot is the
   note as opened. The observer is created on first
   use and watches the body element, which outlives
   every note it serves. */
function editorHistoryReset(note) {
  if (!note) { return; }
  if (editorHistory && editorHistory.timer) {
    clearTimeout(editorHistory.timer);
  }
  if (editorHistory && editorHistory.reconcileTimer) {
    clearTimeout(editorHistory.reconcileTimer);
  }
  editorHistory = {
    noteId: note.id, undo: [], redo: [],
    cur: null, burst: null, unsettled: false,
    pendingPush: false, amendNext: false,
    suspended: false, applying: false, timer: null,
    reconcileTimer: null, lastTrack: 0,
    inputStamp: 0, observerQueued: false,
    justRestored: false, restoredStamp: 0
  };
  editorHistory.cur = editorHistoryCapture();
  if (!editorHistoryObserver) {
    const bodyEl = document.getElementById("noteBody");
    if (bodyEl) {
      editorHistoryObserver = new MutationObserver(
        function () {
          /* The observer's callback can run ahead of
             the input event that classifies the same
             change (a keystroke's text insertion is
             mutated, observed, and only then reported
             as an input event), so an immediate signal
             here would land unclassified and split the
             burst the input event was about to name.
             Defer one turn: when a classified input
             signal has arrived in the meantime (the
             stamp moved), it owns the change and this
             batch stands down; when none has, the
             change was a hand built operation with no
             input event, and it signals as one. */
          const h = editorHistory;
          if (!h || h.observerQueued) { return; }
          h.observerQueued = true;
          const stamp = h.inputStamp;
          setTimeout(function () {
            if (editorHistory !== h) { return; }
            h.observerQueued = false;
            if (h.inputStamp !== stamp) { return; }
            editorHistorySignal("op");
          }, 0);
        });
      editorHistoryObserver.observe(bodyEl, {
        childList: true, subtree: true,
        characterData: true, attributes: true });
    }
  }
}

/* Arm the quiet window at whose lapse the open
   changes settle into a step. */
function editorHistoryArmTimer(ms) {
  const h = editorHistory;
  if (!h) { return; }
  if (h.timer) { clearTimeout(h.timer); }
  h.timer = setTimeout(function () {
    if (editorHistory === h) { editorHistorySettle(); }
  }, ms);
}

/* Settle the open changes: compare the editor as it
   stands against the current snapshot, and when the
   serialized state moved, adopt the new snapshot,
   pushing the old one as an undo step first unless
   the change was declared an amendment of the
   standing step (see editorHistoryAmendStep). A
   settle that finds no serialized change (decoration
   churn, a caret move) refreshes only the caret. */
function editorHistorySettle() {
  const h = editorHistory;
  if (!h) { return; }
  if (h.timer) { clearTimeout(h.timer); h.timer = null; }
  if (!h.unsettled) { h.burst = null; return; }
  h.unsettled = false;
  h.burst = null;
  if (!editorHistoryLive()) { h.pendingPush = false; return; }
  const snap = editorHistoryCapture();
  if (snap.body === h.cur.body &&
      snap.title === h.cur.title) {
    h.cur.caret = snap.caret;
    h.pendingPush = false;
    editorHistoryArmReconcile();
    return;
  }
  /* A restore can be followed by the app's own late
     landings: an open encrypted passage re-encrypts
     on the restore's autosave with a fresh IV, so
     the live body churns bytes without any edit.
     When no user input has landed since the
     restore and the capture is exactly the stored
     body, the churn adopts into the current
     snapshot instead of pushing a step (a push
     would also clear the redo stack and strand
     the state the user just undid). */
  if (h.justRestored &&
      h.inputStamp === h.restoredStamp &&
      snap.body === (currentNote().body || "")) {
    h.cur = { body: snap.body, title: snap.title,
      caret: snap.caret };
    h.amendNext = false;
    h.pendingPush = false;
    editorHistoryArmReconcile();
    return;
  }
  h.justRestored = false;
  if (h.pendingPush && !h.amendNext) {
    h.undo.push(h.cur);
    h.redo.length = 0;
    editorHistoryTrim();
  }
  h.amendNext = false;
  h.pendingPush = false;
  h.cur = snap;
  editorHistoryArmReconcile();
}

/* A classified signal arriving from an input
   event: it stamps the state first, so a mutation
   batch the observer is still holding for the same
   change stands down when its deferred turn comes
   (see the observer in editorHistoryReset). */
function editorHistoryInputSignal(kind) {
  const h = editorHistory;
  if (h) { h.inputStamp++; h.justRestored = false; }
  editorHistorySignal(kind);
}

/* One classified change signal. kind is "text" for
   plain typing, "delback" or "delfwd" for deletion
   runs, "title" for title typing, and "op" for every
   discrete operation (a toolbar command, a checkbox
   toggle, a paste, a conversion, any DOM change the
   observer sees without an input classification).
   A signal whose classification differs from the
   open burst's settles the burst first, so a
   discrete operation never merges into the typing
   burst in front of it. */
function editorHistorySignal(kind) {
  const h = editorHistory;
  if (!h || h.applying || h.suspended) { return; }
  if (!editorHistoryLive()) { return; }
  const burstable = kind !== "op";
  if (!h.unsettled) {
    h.pendingPush = true;
    h.burst = burstable ? kind : null;
  } else if (h.burst !== null && kind !== h.burst) {
    editorHistorySettle();
    if (!editorHistoryLive()) { return; }
    h.pendingPush = true;
    h.burst = burstable ? kind : null;
  } else if (h.burst === null && burstable) {
    h.burst = kind;
  }
  h.unsettled = true;
  editorHistoryArmTimer(burstable &&
    kind === h.burst ? EDITOR_HISTORY_TYPE_IDLE_MS
    : EDITOR_HISTORY_OP_IDLE_MS);
}

/* Close any open burst without waiting for its
   window: a mousedown or a caret moving key lands
   here, so the burst stands as its own step before
   whatever the press or the key goes on to do. */
function editorHistoryCloseBurst() {
  const h = editorHistory;
  if (h && h.unsettled && h.burst !== null) {
    editorHistorySettle();
  }
}

/* Declare that the next settled change amends the
   standing step instead of adding one: the paste
   mode switch uses it, because a switch re-lands
   the paste the last step already holds, so undoing
   after a switch must reach the state before the
   paste, not the paste's first rendering. When the
   paste itself has not settled yet, its own settle
   already makes the combined landing one step and
   there is nothing to amend. */
function editorHistoryAmendStep() {
  const h = editorHistory;
  if (!h || h.applying) { return; }
  if (!h.unsettled) { h.amendNext = true; }
}

/* Suspend capture around a drag whose geometry
   writes land continuously (the table and image
   resize drags): the drag settles whatever stands
   open, its own writes are ignored, and the caller
   resumes with a single signal for the net change
   when the drag commits, or none when it cancels. */
function editorHistorySuspend() {
  const h = editorHistory;
  if (!h) { return; }
  editorHistorySettle();
  h.suspended = true;
}

function editorHistoryResume(changed) {
  const h = editorHistory;
  if (!h) { return; }
  h.suspended = false;
  if (changed) { editorHistorySignal("op"); }
}

/* Restore one snapshot: the title field, the body
   through the open fill's decoration sequence, the
   caret, and the dirty mark that autosaves the
   restored state. The applying flag stands only
   for the duration of the call: the fill's own
   mutation records are drained out of the observer
   before the flag drops (takeRecords), so the
   restore never reads as a new change however the
   platform schedules observer callbacks, and the
   flag is down before the caller returns, so a
   fast second Ctrl+Z is never swallowed. Later
   asynchronous decoration from the fill (attachment
   hydration) still reaches the observer, but it
   serializes away at the next settle, like all
   decoration churn. */
function editorHistoryRestore(snap) {
  const h = editorHistory;
  const note = currentNote();
  if (!h || !note) { return; }
  h.applying = true;
  try {
    const titleEl = document.getElementById("noteTitle");
    if (titleEl) { titleEl.value = snap.title; }
    editorHistoryFillBody(note, snap.body);
    h.cur = snap;
    editorHistoryRestoreCaret(snap.caret);
  } finally {
    if (editorHistoryObserver) {
      editorHistoryObserver.takeRecords();
    }
    h.applying = false;
  }
  h.justRestored = true;
  h.restoredStamp = h.inputStamp;
  markDirty();
}

function editorHistoryUndo() {
  const h = editorHistoryLive();
  if (!h || h.applying) { return; }
  editorHistorySettle();
  /* Adopt the stored form before the current
     snapshot crosses to the redo stack: a fast
     undo can beat the reconcile timer, and the
     redo entry must hold the final bytes, not a
     capture taken a beat before a late landing. */
  editorHistoryReconcileNow();
  if (!h.undo.length) { return; }
  const target = h.undo.pop();
  h.redo.push(h.cur);
  editorHistoryRestore(target);
  editorHistoryTrim();
}

function editorHistoryRedo() {
  const h = editorHistoryLive();
  if (!h || h.applying) { return; }
  editorHistorySettle();
  editorHistoryReconcileNow();
  if (!h.redo.length) { return; }
  const target = h.redo.pop();
  h.undo.push(h.cur);
  editorHistoryRestore(target);
  editorHistoryTrim();
}

/* Follow a settled caret between changes, so the
   snapshot a step pushes carries the selection as
   it stood when the step began (the selection a
   Bold press acts on above all). Throttled: the
   offsets cost a walk of the body's text, and a
   drag selection fires this many times a second. */
function editorHistoryTrackCaret() {
  const h = editorHistoryLive();
  if (!h || h.unsettled || h.applying) { return; }
  const now = Date.now();
  if (now - h.lastTrack < 120) { return; }
  h.lastTrack = now;
  h.cur.caret = editorHistoryCaret();
}

/* v2.9: remove every link view face under rootEl and unwrap every
   wrapped original, restoring each decorated anchor to exactly
   the children it was saved with. Shared by the save funnel
   above and the print builder (which works from a clone of the
   live, decorated body), so both see the same plain anchors the
   text and Word exporters read from the saved body. Idempotent:
   a body with no faces passes through unchanged. */
function stripLinkFaces(rootEl) {
  if (!rootEl || !rootEl.querySelectorAll) { return; }
  rootEl.querySelectorAll(".ss-link-face").forEach(function (el) {
    el.remove();
  });
  rootEl.querySelectorAll(".ss-link-original").forEach(function (el) {
    const parent = el.parentNode;
    if (!parent) { return; }
    while (el.firstChild) { parent.insertBefore(el.firstChild, el); }
    el.remove();
  });
}

/* v2.11: the image Title view face is runtime only presentation in
   exactly the link faces' sense: the bar that stands in for the
   image while data-ss-view="title" is set. The save funnel's shell
   rebuild already drops it (it lives inside the figure), and the
   print builder strips it explicitly here because it works from a
   clone of the live body: on paper a Title mode image prints as
   the image itself, exactly like Preview. Idempotent. */
function stripImageTitleFaces(rootEl) {
  if (!rootEl || !rootEl.querySelectorAll) { return; }
  rootEl.querySelectorAll(".ss-att-title-face").forEach(function (el) {
    el.remove();
  });
}

/* v1.6, reworked in v1.7.2: the width a resized image should keep,
   read from the placeholder block's own style. Since v1.7.2 the
   block carries the chosen size and the <img> inside it is always
   width:100% of the block, so the block's style is the one and
   only place a size can live; any width found on an <img> is a
   leftover of the v1.6/v1.7 live DOM and is deliberately NOT read
   here (the decoration pass migrates it onto the block before a
   save can happen, and canonicalization rebuilds the shell from
   scratch, so an image width could never be carried even if one
   survived). Only a plain pixel width is honored; anything else
   is dropped rather than persisted. */
function savedImageWidthOf(el) {
  const raw = el.style ? el.style.width : "";
  return /^\d+(\.\d+)?px$/.test(raw || "") ? raw : "";
}

function collectEditor(note) {
  note.title = document.getElementById("noteTitle").value.trim() || "Untitled note";
  /* v2.5: note.notebook is deliberately NOT read from a form
     control anymore. The dropdown is gone; the notebook lives on
     the note object and changes only through the move paths
     (moveNoteToNotebook, used by the notebook link menu and by
     drag and drop; trash, restore, archive, and unarchive set
     their own fields), so a save can never silently reassign the
     notebook from a stale widget. */
  note.tags = document.getElementById("noteTags").value
    .split(",")
    .map(function (t) { return t.trim(); })
    .filter(function (t) { return t.length > 0; });
  /* v2.2: note.pinned is deliberately NOT read here. The Pinned
     checkbox that used to feed this line is gone, so the value stays
     exactly as it sits on the note object (set by the Pin note /
     Unpin note item in the notes list toolbar menu), and editing a
     pinned note through any save path can never unpin it. */
  /* v1.2: the stored body always carries canonical placeholders.
     v2.89: the read goes through the encrypted text
     serializer, which substitutes every decrypted
     region with its locked block, so a collect can
     never fold a decrypted passage into the note. */
  note.body = canonicalizeAttachmentPlaceholders(
    document.getElementById("noteBody").innerHTML);
  /* v1.2: attachment metadata is edited through the attachment actions,
     not the form fields, but re-sanitize here so the saved note always
     carries a clean array on the object. */
  note.attachments = sanitizeAttachments(note.attachments);
  return note;
}

/* --------------------------------------------------------------------------
   Opening and editing links from inside a note (v1.3.1, v1.3.2, v2.9)
   The note body is contenteditable, so the browser treats a plain click
   on a link as "place the caret for editing" and never follows it. This
   block gives links real behavior without disturbing editing:
     - Ctrl+click (Cmd+click on a Mac) opens the link in a new tab.
     - A plain click still places the caret exactly as before, and ALSO
       summons the link bar, which is how touch screens, with no Ctrl
       key, open and edit links.
   v2.9 replaced the v1.3 floating popup with ONE dark link bar
   (linkBar in the HTML): it also appears when the mouse rests on a
   link, shows the address as a clickable link (clicking it opens the
   page through the same checked path as Ctrl+click), and carries icon
   buttons: edit (the v1.3.2 inline form, rehosted as the bar's edit
   state, semantics unchanged), copy the address, remove the link
   keeping its text, and a three dot menu (linkViewMenu) that switches
   the link's display mode between Text, Mention, and Preview, copies
   the address, or deletes the link and its text together. The display
   modes and the Microlink info behind them live further down in this
   block.
   v2.10: note links (ssnote:) join the bar. Through v2.9 they never
   showed it; now the same bar serves them, with a page icon and the
   target note's current title for a label, an edit state that edits
   the text and can retarget the link through the note picker, a copy
   that copies the note link itself, and a fourth display mode,
   Title, in their menu. Their click behavior does not change at
   all: a plain click on a note link still opens the target note
   immediately, in every mode, and the bar is a hover rest surface
   for them. A note link shown as a Mention does not even do that:
   hovering it shows a floating preview card of the target note
   instead of the bar (see the card block below the bar's).
   Safety: only http, https, and mailto links may open, and the same
   rule validates a saved edit. Anything else (javascript:, data:, a
   malformed string) is refused with a toast. The bar element lives
   outside #noteBody, and collectEditor only reads #noteBody's
   innerHTML, so the bar can never be saved into a note, and using it
   never marks the note dirty; only a successful link edit Save, a
   mode switch, an unlink, a delete, or a landed info fetch does.
   -------------------------------------------------------------------------- */

/* Pure protocol check, kept separate and side effect free so it can be
   unit tested on its own: returns the normalized URL to open, or null
   when the link must not be opened. Callers pass the anchor's resolved
   href property (always absolute), never the raw attribute, so this
   function only ever judges complete URLs. */
function linkOpenTarget(rawUrl) {
  if (!rawUrl) { return null; }
  let parsed;
  try {
    parsed = new URL(String(rawUrl).trim());
  } catch (err) {
    return null;
  }
  if (parsed.protocol === "http:" ||
      parsed.protocol === "https:" ||
      parsed.protocol === "mailto:") {
    return parsed.href;
  }
  return null;
}

/* Open a note link in a new tab, or explain why it cannot be opened.
   noopener keeps the opened page from reaching back into this window. */
function openNoteLink(rawUrl) {
  const target = linkOpenTarget(rawUrl);
  if (!target) {
    toast("That link cannot be opened. Only web (http or https) and email (mailto) links are allowed.", true);
    return;
  }
  window.open(target, "_blank", "noopener");
}

/* The href of the link the bar currently refers to. Kept in a variable
   rather than read back from the DOM so the bar's clickable address
   always opens the exact href of the link that summoned it. */
let linkBarHref = "";

/* The anchor element the bar currently refers to. The edit form and
   the menu actions need the element itself (to read and rewrite its
   text, href, and mode in place), not just the address string.
   Cleared whenever the bar hides, so a stale element can never be
   edited by accident. */
let linkBarAnchor = null;

/* v2.9 hover bookkeeping: the anchor the pointer is resting on (or
   last rested on), and the two timers that give the bar its show
   delay and its hide grace period. The editing flag freezes the
   hover timers while the edit form is up: a user typing an address
   must never have the bar vanish because the mouse drifted away. */
let linkBarHoverAnchor = null;
let linkBarShowTimer = null;
let linkBarHideTimer = null;
let linkBarShowAnchor = null;
let linkBarEditing = false;

/* True while the bar is on screen (in either of its states). */
function linkBarVisible() {
  const bar = document.getElementById("linkBar");
  return !!bar && !bar.classList.contains("hidden");
}

/* True while the View Link As menu is open under the bar. */
function linkViewMenuOpen() {
  const menu = document.getElementById("linkViewMenu");
  return !!menu && !menu.classList.contains("hidden");
}

function hideLinkBar() {
  const bar = document.getElementById("linkBar");
  if (bar) { bar.classList.add("hidden"); }
  closeLinkViewMenu();
  /* v2.10: the Mention hover card is the same UI wearing another
     face, so the one hide closes it too. Every app level hide
     (note switch, lock, scroll, Escape, another overlay) therefore
     puts the card away without a second rule anywhere. */
  hideNoteLinkCard();
  linkBarHref = "";
  linkBarAnchor = null;
  linkBarHoverAnchor = null;
  linkBarShowAnchor = null;
  if (linkBarShowTimer) { clearTimeout(linkBarShowTimer); linkBarShowTimer = null; }
  if (linkBarHideTimer) { clearTimeout(linkBarHideTimer); linkBarHideTimer = null; }
  /* v1.3.2 (carried into the bar): the bar always reopens in its
     normal view, never in the middle of an edit, so hiding always
     resets the mode too. */
  setLinkBarMode(false);
}

/* v1.3.2, rehosted in v2.9: switch the bar between its normal view
   (globe, clickable address, icon buttons) and its edit form (text
   field, address field, Save, Cancel). Exactly one of the two is
   visible at a time, and entering the edit state closes the view
   menu: the form is the whole bar while it is up. */
function setLinkBarMode(editing) {
  linkBarEditing = !!editing;
  if (editing) { closeLinkViewMenu(); }
  const view = document.getElementById("linkBarView");
  const form = document.getElementById("linkEditForm");
  if (view) { view.classList.toggle("hidden", editing); }
  if (form) { form.classList.toggle("hidden", !editing); }
}

/* Position the bar just ABOVE the given link (below it when there is
   no room above), clamped so it always stays inside the viewport.
   The caller unhides the bar and sets its mode first, so the size
   measured here is the size of what is actually on screen. Used
   both when the bar opens and when it swaps between view and edit,
   since the edit form is taller and wider than the normal view. */
function positionLinkBar(anchor) {
  const bar = document.getElementById("linkBar");
  if (!bar || !anchor) { return; }
  const rect = anchor.getBoundingClientRect();
  const width = bar.offsetWidth;
  const height = bar.offsetHeight;
  let left = Math.min(rect.left, window.innerWidth - width - 8);
  left = Math.max(8, left);
  let top = rect.top - height - 6;
  if (top < 8) {
    top = Math.min(rect.bottom + 6, window.innerHeight - height - 8);
    top = Math.max(8, top);
  }
  bar.style.left = left + "px";
  bar.style.top = top + "px";
}

/* v2.9: is this anchor one the link bar serves? External anchors
   (http, https, mailto, the same set linkOpenTarget judges):
   anchors inside attachment placeholders are attachment
   furniture rather than text links, anchors in a locked (Trash
   or Archive) note get no bar because every bar action edits
   the note, and the History preview is not #noteBody at all,
   so its links are already out of reach here.
   v2.10: note links are served too, under the same lock and
   furniture rules. The bar is only ever a hover surface for
   them (their click still opens the target, handled before
   this is consulted in the click listener), and one of their
   modes, Mention, swaps the bar for its hover card at schedule
   time instead; this function only answers "is the link UI
   allowed here at all". */
function linkBarAnchorFor(anchor) {
  if (!anchor || !anchor.getAttribute) { return null; }
  const bodyEl = document.getElementById("noteBody");
  if (!bodyEl || !bodyEl.contains(anchor)) { return null; }
  if (anchor.closest && anchor.closest(".ss-attachment")) { return null; }
  /* v2.37.0: table of contents entries get no bar either:
     their click is a jump inside the note, handled by the
     body's click route, never by the link machinery. */
  if (anchor.closest && anchor.closest(".ss-toc")) { return null; }
  /* v2.49.0: a note tasks block holds no anchors of its
     own, but an anchor a damaged body parked inside one
     gets no bar either, on the same rule. */
  if (anchor.closest && anchor.closest(".ss-note-tasks")) { return null; }
  /* v2.28.0: task links get no bar, and through this
     same gate no Mention hover card either: their click
     opens the task, and that is their whole link UI. */
  if (taskLinkIdOf(anchor)) { return null; }
  const note = currentNote();
  if (!note || note.trashed || note.archived) { return null; }
  if (noteLinkIdOf(anchor)) { return anchor; }
  const href = anchor.href || anchor.getAttribute("href") || "";
  if (!linkOpenTarget(href)) { return null; }
  return anchor;
}

/* v2.10: the bar's face for the link it refers to: which icon
   leads it, what its main label says, and what the copy button
   calls itself. A web link leads with the globe and shows its
   resolved address (the displayed address is a real link
   element whose href mirrors the address; its click is
   intercepted and routed through openNoteLink, so the protocol
   safety check always applies and the app window itself never
   navigates). A note link leads with a page icon and shows the
   target note's CURRENT title, resolved live the same way the
   tooltips resolve it (live notes, Trash, and Archive),
   falling back to the link's own text when the target is gone;
   the bar wears the note-mode class then, so the label reads
   as a title rather than an address. */
let linkBarGlobeMarkup = null;
const LINK_BAR_PAGE_ICON =
  "<svg viewBox=\"0 0 24 24\" width=\"16\" height=\"16\" fill=\"none\" " +
  "stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" " +
  "stroke-linejoin=\"round\"><path d=\"M7 3h7l4 4v14H7z\"/>" +
  "<path d=\"M14 3v4h4\"/><path d=\"M9.5 12h5\"/>" +
  "<path d=\"M9.5 15.5h5\"/></svg>";

function refreshLinkBarFace() {
  const anchor = linkBarAnchor;
  const bar = document.getElementById("linkBar");
  const iconEl = document.getElementById("linkBarGlobe");
  const urlEl = document.getElementById("linkBarUrl");
  const copyBtn = document.getElementById("linkBarCopyBtn");
  if (!anchor || !urlEl) { return; }
  if (linkBarGlobeMarkup === null && iconEl) {
    linkBarGlobeMarkup = iconEl.innerHTML;
  }
  const noteId = noteLinkIdOf(anchor);
  if (noteId) {
    const target = findNoteById(noteId);
    const label = target ? (target.title || "Untitled note") :
      linkOriginalText(anchor);
    if (iconEl) { iconEl.innerHTML = LINK_BAR_PAGE_ICON; }
    urlEl.textContent = label;
    urlEl.setAttribute("title", label);
    urlEl.setAttribute("href", "#");
    if (bar) { bar.classList.add("note-mode"); }
    if (copyBtn) {
      copyBtn.setAttribute("title", "Copy link");
      copyBtn.setAttribute("aria-label", "Copy link to this note");
    }
    return;
  }
  if (iconEl && linkBarGlobeMarkup !== null) {
    iconEl.innerHTML = linkBarGlobeMarkup;
  }
  urlEl.textContent = linkBarHref;
  urlEl.setAttribute("title", linkBarHref);
  urlEl.setAttribute("href", linkBarHref);
  if (bar) { bar.classList.remove("note-mode"); }
  if (copyBtn) {
    copyBtn.setAttribute("title", "Copy URL");
    copyBtn.setAttribute("aria-label", "Copy link address");
  }
}

/* Show the bar for a link, always in its normal view. */
function showLinkBar(anchor) {
  const bar = document.getElementById("linkBar");
  if (!bar || !anchor) { return; }
  if (linkBarShowTimer) { clearTimeout(linkBarShowTimer); linkBarShowTimer = null; }
  linkBarShowAnchor = null;
  if (linkBarHideTimer) { clearTimeout(linkBarHideTimer); linkBarHideTimer = null; }
  /* v2.10: the bar and the Mention hover card are two faces of
     the one link UI; showing one puts the other away. */
  hideNoteLinkCard();
  linkBarAnchor = anchor;
  /* anchor.href is the browser resolved absolute URL for a web
     link, which is both what the bar should display and what
     clicking it will open. A note link has no meaningful
     resolved URL: its raw ssnote: attribute is its identity,
     so that is what is kept for it. */
  linkBarHref = noteLinkIdOf(anchor) ?
    (anchor.getAttribute("href") || "") :
    (anchor.href || anchor.getAttribute("href") || "");
  refreshLinkBarFace();
  setLinkBarMode(false);
  closeLinkViewMenu();
  bar.classList.remove("hidden");
  positionLinkBar(anchor);
}

/* v2.9 hover timing, the numbers Chris's pattern implies: a short
   rest (350 ms) before the bar appears, so skimming across a link
   on the way somewhere else never summons it, and a short grace
   period (250 ms) after the pointer leaves both the link and the
   bar, so crossing the gap between them never flickers it shut. */
const LINK_BAR_HOVER_MS = 350;
const LINK_BAR_GRACE_MS = 250;

/* The pointer came to rest on an anchor: show its bar after the
   hover delay (immediately when the bar is already up for another
   link, so sliding along a row of links feels continuous). */
function scheduleLinkBarShow(anchor) {
  linkBarHoverAnchor = anchor;
  if (linkBarHideTimer) { clearTimeout(linkBarHideTimer); linkBarHideTimer = null; }
  /* v2.10: sliding directly from a Mention's hover card onto a
     bar link swaps the surface at once, the same continuity
     rule as sliding between two bar links below. */
  if (noteLinkCardVisible()) {
    hideNoteLinkCard();
    showLinkBar(anchor);
    return;
  }
  if (linkBarVisible() && !linkBarEditing) {
    if (linkBarAnchor !== anchor) { showLinkBar(anchor); }
    return;
  }
  /* mouseover bubbles again for every child boundary crossed
     inside the same link; a delay already running for THIS link
     is left alone, so small movements inside a long link do not
     keep postponing the bar. */
  if (linkBarShowTimer && linkBarShowAnchor === anchor) { return; }
  if (linkBarShowTimer) { clearTimeout(linkBarShowTimer); }
  linkBarShowAnchor = anchor;
  linkBarShowTimer = setTimeout(function () {
    linkBarShowTimer = null;
    linkBarShowAnchor = null;
    if (linkBarHoverAnchor === anchor && anchor.isConnected) {
      showLinkBar(anchor);
    }
  }, LINK_BAR_HOVER_MS);
}

/* The pointer left the anchor and the bar: hide after the grace
   period, unless it comes back first (either side cancels this
   timer when it is re-entered). The edit form freezes the grace
   rule entirely; it closes only through its own buttons, Escape,
   or the app level hides. */
function scheduleLinkBarHide() {
  if (linkBarEditing) { return; }
  if (linkBarShowTimer) { clearTimeout(linkBarShowTimer); linkBarShowTimer = null; }
  linkBarShowAnchor = null;
  if (linkBarHideTimer) { clearTimeout(linkBarHideTimer); }
  linkBarHideTimer = setTimeout(function () {
    linkBarHideTimer = null;
    hideLinkBar();
  }, LINK_BAR_GRACE_MS);
}

/* Cancel a pending hide because the pointer entered the bar (or
   came back to the anchor). */
function cancelLinkBarHide() {
  if (linkBarHideTimer) { clearTimeout(linkBarHideTimer); linkBarHideTimer = null; }
}

/* ----- v2.10: the note link Mention hover card --------------------------
   Resting the mouse on a note link shown as a Mention does NOT
   summon the bar above. It shows this card instead, under the
   mention (above it when there is no room): the target note's
   notebook at the top left, a Copy Link button and a three dot
   More options button at the top right, then the target's
   title, a plain text excerpt of its body, and its updated
   time at the bottom, exactly the layout of Chris's screenshot.
   Everything on it is resolved live from the target note at
   show time (the findNoteById lookup the tooltips use: live
   notes, Trash, and Archive), so it can never go stale, and
   nothing on it is ever saved anywhere.
   The card is the bar's sibling in every rule that matters:
   the same hover rest before it appears, the same grace
   period after the pointer leaves both the mention and the
   card, Escape closes any menu it spawned before it, and
   hideLinkBar (which every note switch, lock, scroll, and
   overlay opening funnels through) closes it. While the card
   is up, the mention IS the link UI's current link
   (linkBarAnchor and linkBarHref point at it), so the shared
   View Link As menu, copy, unlink, and delete run against it
   with no second implementation. A Mention whose target no
   longer exists has no face (decoration falls back to Text),
   and hovering it summons the bar instead, never this card. */

let noteLinkCardAnchor = null;
let noteLinkCardHoverAnchor = null;
let noteLinkCardShowTimer = null;

/* True while the Mention hover card is on screen. */
function noteLinkCardVisible() {
  const card = document.getElementById("noteLinkCard");
  return !!card && !card.classList.contains("hidden");
}

/* Put the card away and forget which mention it belonged to.
   Called from hideLinkBar (the one central hide) and from
   showLinkBar (the two surfaces never coexist). */
function hideNoteLinkCard() {
  const card = document.getElementById("noteLinkCard");
  if (card) { card.classList.add("hidden"); }
  noteLinkCardAnchor = null;
  noteLinkCardHoverAnchor = null;
  if (noteLinkCardShowTimer) {
    clearTimeout(noteLinkCardShowTimer);
    noteLinkCardShowTimer = null;
  }
}

/* The notebook name a note is shown with: a trashed or
   archived note shows the notebook it came from, where Restore
   or Unarchive will return it, the same effective notebook
   refreshNotebookLink computes for the open note. */
function notebookNameForNote(note) {
  if (!note) { return ""; }
  const slug = note.trashed ? (note.trashedFrom || note.notebook) :
    (note.archived ? (note.archivedFrom || note.notebook) :
      note.notebook);
  const nb = state.notebooks.find(function (n) {
    return n.slug === slug;
  });
  return nb ? nb.name : (slug || "");
}

/* The updated time the note link cards show, in the relative
   day style Chris's screenshot uses: the locale time plus
   "Today" ("1:11 PM Today"), the same plus "Yesterday" for
   yesterday, and for anything older the date from formatDate
   (the notes list formatter) plus the time. */
function noteLinkTimeLabel(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) { return ""; }
  const time = d.toLocaleTimeString([], {
    hour: "numeric", minute: "2-digit"
  });
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return time + " Today";
  }
  const yesterday = new Date(now.getTime());
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return time + " Yesterday";
  }
  return formatDate(iso) + ", " + time;
}

/* A card excerpt of a note's body: htmlToText (the plain text
   helper the notes list snippets and the version history
   excerpts share), capped at 160 characters with an ellipsis
   when cut. An empty body yields an empty string, and the
   card simply shows a blank excerpt line. */
function noteLinkExcerpt(note) {
  /* v2.20: a shell target excerpts its catalog preview; its body
     is not on this device. */
  const text = note && note.bodyLoaded === false
    ? (note.previewText || "")
    : htmlToText((note && note.body) || "");
  if (!text) { return ""; }
  return text.length > 160 ? text.slice(0, 157) + "..." : text;
}

/* Show the hover card for a Mention. The caller has already
   resolved that this anchor is a Mention with a living target;
   the resolution is repeated here so the card can never show
   stale or missing data, and a target that vanished in the
   meantime falls back to the bar, the Text mode surface. */
function showNoteLinkCard(anchor) {
  const card = document.getElementById("noteLinkCard");
  const noteId = anchor ? noteLinkIdOf(anchor) : null;
  const target = noteId ? findNoteById(noteId) : null;
  if (!card || !anchor || !target) {
    if (anchor) { showLinkBar(anchor); }
    return;
  }
  if (noteLinkCardShowTimer) {
    clearTimeout(noteLinkCardShowTimer);
    noteLinkCardShowTimer = null;
  }
  if (linkBarHideTimer) { clearTimeout(linkBarHideTimer); linkBarHideTimer = null; }
  /* The bar steps aside (the menu closes with it): the two
     surfaces never coexist. */
  const bar = document.getElementById("linkBar");
  if (bar) { bar.classList.add("hidden"); }
  closeLinkViewMenu();
  /* The mention becomes the link UI's current link, so the
     card's menu and every shared action run against it. */
  linkBarAnchor = anchor;
  linkBarHref = anchor.getAttribute("href") || "";
  noteLinkCardAnchor = anchor;
  document.getElementById("noteLinkCardNotebook").textContent =
    notebookNameForNote(target);
  document.getElementById("noteLinkCardTitle").textContent =
    target.title || "Untitled note";
  document.getElementById("noteLinkCardExcerpt").textContent =
    noteLinkExcerpt(target);
  document.getElementById("noteLinkCardTime").textContent =
    noteLinkTimeLabel(target.updated);
  card.classList.remove("hidden");
  positionNoteLinkCard(anchor);
}

/* Position the card just BELOW the mention (above it when
   there is no room below), clamped into the viewport, the
   mirror of positionLinkBar. */
function positionNoteLinkCard(anchor) {
  const card = document.getElementById("noteLinkCard");
  if (!card || !anchor) { return; }
  const rect = anchor.getBoundingClientRect();
  const width = card.offsetWidth;
  const height = card.offsetHeight;
  let left = Math.min(rect.left, window.innerWidth - width - 8);
  left = Math.max(8, left);
  let top = rect.bottom + 6;
  if (top + height > window.innerHeight - 8) {
    top = Math.max(8, rect.top - height - 6);
  }
  card.style.left = left + "px";
  card.style.top = top + "px";
}

/* The pointer came to rest on a Mention: show its card after
   the same hover rest the bar uses (and at once when sliding
   directly from the bar, the bar's own continuity rule). The
   edit form freezes the card exactly as it freezes the bar:
   a user mid edit never has UI swapped under them. */
function scheduleNoteLinkCardShow(anchor) {
  noteLinkCardHoverAnchor = anchor;
  cancelLinkBarHide();
  if (noteLinkCardVisible() && noteLinkCardAnchor === anchor) {
    return;
  }
  if (linkBarVisible() && !linkBarEditing) {
    hideLinkBar();
    showNoteLinkCard(anchor);
    return;
  }
  if (noteLinkCardShowTimer) {
    clearTimeout(noteLinkCardShowTimer);
  }
  noteLinkCardShowTimer = setTimeout(function () {
    noteLinkCardShowTimer = null;
    if (linkBarEditing) { return; }
    if (noteLinkCardHoverAnchor === anchor && anchor.isConnected) {
      showNoteLinkCard(anchor);
    }
  }, LINK_BAR_HOVER_MS);
}

/* v1.3.2: complete an address typed into the link edit form. A value
   that already carries a scheme (https:, mailto:, but also anything
   else with a scheme, valid or not) is left exactly as typed, so the
   validator below judges what the user actually meant. A bare domain
   or path with no scheme (example.com, www.example.com/page) gets
   https:// in front. Anything else (spaces, a single word) is returned
   unchanged and will fail validation, which is the honest outcome.
   Kept pure and side effect free so it can be unit tested on its own,
   together with linkOpenTarget. */
function normalizeLinkInput(rawUrl) {
  const value = String(rawUrl == null ? "" : rawUrl).trim();
  if (!value) { return ""; }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) { return value; }
  if (!/\s/.test(value) && value.indexOf(".") !== -1) {
    return "https://" + value;
  }
  return value;
}

/* v1.3.2, rehosted in v2.9: switch the bar to its edit form for the
   link it refers to. Both fields are prefilled from the link: the
   visible text (its ORIGINAL text: while a Mention or Preview face
   is shown, the anchor's textContent also counts the face's label,
   so the original is read through linkOriginalText), and the
   current address. The form opening never marks the note dirty;
   only a successful Save does.
   v2.10: a note link's edit state is different in kind, not just
   in data: there is no address to type, so the address row is
   swapped for the note row (the target's current title and a
   Change note button that reopens the picker as a retarget
   picker; see the note link block below), and focus goes to
   the text field. Exactly one of the two rows is ever visible,
   decided here, every time the form opens. */
function startLinkEdit() {
  if (!linkBarAnchor) { return; }
  const isNoteLink = !!noteLinkIdOf(linkBarAnchor);
  document.getElementById("linkEditText").value =
    linkOriginalText(linkBarAnchor);
  document.getElementById("linkEditUrl").value = linkBarHref;
  const urlRow = document.getElementById("linkEditUrl")
    .closest(".link-edit-field");
  if (urlRow) { urlRow.classList.toggle("hidden", isNoteLink); }
  const noteRow = document.getElementById("linkEditNoteRow");
  if (noteRow) { noteRow.classList.toggle("hidden", !isNoteLink); }
  if (isNoteLink) {
    const noteId = noteLinkIdOf(linkBarAnchor);
    const target = noteId ? findNoteById(noteId) : null;
    document.getElementById("linkEditNoteName").textContent =
      target ? (target.title || "Untitled note") :
        "That note no longer exists";
  }
  setLinkBarMode(true);
  positionLinkBar(linkBarAnchor);
  (isNoteLink ? document.getElementById("linkEditText") :
    document.getElementById("linkEditUrl")).focus();
}

/* v1.3.2: apply the edit form to the clicked link. The typed address is
   normalized (a bare domain gains https://) and then judged by the SAME
   protocol rule as link opening. An invalid address keeps the form open
   with the typed text untouched, so nothing the user typed is lost.
   On a valid save the anchor's href is rewritten; its text is replaced
   only when the field actually differs, so an address only edit leaves
   any nested formatting inside the link exactly as it was. */
function saveLinkEdit() {
  const anchor = linkBarAnchor;
  if (!anchor) { hideLinkBar(); return; }
  /* v2.10: a note link's Save applies the text field only. There
     is no address to normalize or validate (retargeting is the
     Change note button's job, and it applies immediately when a
     note is picked). The text lands in the same place the web
     path puts it: the original wrapper while a face is shown,
     the anchor itself in Text mode, and only when it actually
     differs, so a no change Save neither dirties nor rewrites. */
  if (noteLinkIdOf(anchor)) {
    const newText = document.getElementById("linkEditText").value;
    const changed = newText !== linkOriginalText(anchor);
    if (changed) {
      const wrap = anchor.querySelector(":scope > .ss-link-original");
      if (wrap) { wrap.textContent = newText; }
      else { anchor.textContent = newText; }
      /* The text changed, so its Mention derivation verdict is
         refreshed with it: text that now just repeats the
         target's title is title derived, anything else is the
         user's own (see captureNoteLinkDerivation). */
      const editTarget = findNoteById(noteLinkIdOf(anchor));
      anchor.__ssNoteDerivedText = newText;
      anchor.__ssNoteTitleDerived = newText.trim() === "" ||
        (!!editTarget &&
          newText === (editTarget.title || "Untitled note"));
      decorateLinkView(anchor);
      markDirty();
    }
    hideLinkBar();
    if (changed) { toast("Link updated."); }
    return;
  }
  const normalized =
    normalizeLinkInput(document.getElementById("linkEditUrl").value);
  if (!linkOpenTarget(normalized)) {
    toast("That is not a valid web or email link.", true);
    return;
  }
  const oldHref = anchor.getAttribute("href") || "";
  const hrefChanged = normalized !== oldHref;
  anchor.setAttribute("href", normalized);
  /* v2.6.0: keep the hover tooltip in step with the new address. */
  anchor.setAttribute("title", normalized);
  const newText = document.getElementById("linkEditText").value;
  /* v2.9: the text being compared and replaced is the link's
     ORIGINAL text. While a face is shown that text lives in the
     .ss-link-original wrapper; replacing the wrapper's contents
     keeps the face node itself intact, and the face is rebuilt
     right after, so a Mention label derived from the text (when
     no fetched title is stored) follows the edit. In Text mode
     there is no wrapper and this is exactly the v1.3.2 behavior:
     the text is replaced only when the field actually differs,
     so an address only edit leaves any nested formatting inside
     the link exactly as it was. */
  if (newText !== linkOriginalText(anchor)) {
    const wrap = anchor.querySelector(":scope > .ss-link-original");
    if (wrap) { wrap.textContent = newText; }
    else { anchor.textContent = newText; }
  }
  /* v2.9: fetched Microlink info describes the OLD address. When
     the address changed, the stored info is cleared in the same
     breath, and a link shown as Mention or Preview fetches fresh
     info for the new address under the mode switch rules. A text
     only edit never refetches: the info describes the address,
     not the label. */
  if (hrefChanged && hasStoredLinkInfo(anchor)) {
    clearStoredLinkInfo(anchor);
  }
  decorateLinkView(anchor);
  markDirty();
  hideLinkBar();
  toast("Link updated.");
  if (hrefChanged) { maybeFetchLinkInfo(anchor); }
}

/* ----- v2.9: the View Link As menu --------------------------------------
   The bar's three dot button opens a small menu under the bar:
   a VIEW LINK AS header, the three display modes with a dot on
   the current one, then Copy URL and Delete. The mode lives on
   the anchor as data-ss-link-view ("mention" or "preview"; Text
   is the attribute's absence), so it is part of the saved note
   and round trips through collectEditor untouched. Everything
   the modes SHOW is runtime only (see the faces block below). */

function openLinkViewMenu() {
  const menu = document.getElementById("linkViewMenu");
  const btn = document.getElementById("linkBarMenuBtn");
  if (!menu || !linkBarAnchor) { return; }
  refreshLinkViewMenuDots();
  /* v2.10: Title is a note link only mode. The row is in the
     shared markup, so it is hidden whenever the menu serves a
     web link, every time the menu opens (the menu's link can
     change between openings without the menu closing). */
  const titleItem = menu.querySelector("[data-link-view=\"title\"]");
  if (titleItem) {
    titleItem.classList.toggle("hidden",
      !noteLinkIdOf(linkBarAnchor));
  }
  menu.classList.remove("hidden");
  if (btn) { btn.setAttribute("aria-expanded", "true"); }
  const cardBtn = document.getElementById("noteLinkCardMenuBtn");
  if (cardBtn) { cardBtn.setAttribute("aria-expanded", "true"); }
  positionLinkViewMenu();
}

/* v2.10: place the menu under the surface that summoned it:
   the bar, or the Mention hover card when the card is the
   visible surface (the bar is hidden then). The menu is fixed
   positioned and right aligned to its host, clamped into the
   viewport, and flips above the host when there is no room
   below, the same clamping the bar itself uses. */
function positionLinkViewMenu() {
  const menu = document.getElementById("linkViewMenu");
  if (!menu || menu.classList.contains("hidden")) { return; }
  const card = document.getElementById("noteLinkCard");
  const host = (card && !card.classList.contains("hidden")) ?
    card : document.getElementById("linkBar");
  if (!host) { return; }
  const rect = host.getBoundingClientRect();
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

function closeLinkViewMenu() {
  const menu = document.getElementById("linkViewMenu");
  const btn = document.getElementById("linkBarMenuBtn");
  if (menu) { menu.classList.add("hidden"); }
  if (btn) { btn.setAttribute("aria-expanded", "false"); }
  const cardBtn = document.getElementById("noteLinkCardMenuBtn");
  if (cardBtn) { cardBtn.setAttribute("aria-expanded", "false"); }
}

function toggleLinkViewMenu() {
  if (linkViewMenuOpen()) { closeLinkViewMenu(); }
  else { openLinkViewMenu(); }
}

/* Mark the menu row for the bar link's current mode: the row
   gets the active class, which fills its dot and bolds its name,
   the visual marker in Chris's screenshot. */
function refreshLinkViewMenuDots() {
  const menu = document.getElementById("linkViewMenu");
  if (!menu || !linkBarAnchor) { return; }
  const mode = linkViewModeOf(linkBarAnchor);
  menu.querySelectorAll("[data-link-view]").forEach(function (item) {
    item.classList.toggle("active",
      item.getAttribute("data-link-view") === mode);
  });
}

/* Switch the bar link's display mode. Text removes the mode
   attribute outright, so a Text link is byte for byte the anchor
   every earlier version saved. The face is rebuilt in place, the
   note saves through the normal path, and choosing any mode
   closes the menu and the bar. Switching INTO Mention or Preview
   is also the one moment link info is fetched (see the Microlink
   block below): lazily, and only when none is stored yet.
   v2.10: Title is a fourth saved value, valid only on a note
   link (the menu never offers it to a web link, and a stray
   request here is refused the same way, degrading to Text).
   Note links never fetch: maybeFetchLinkInfo judges the
   ssnote: scheme out before any network call, and their faces
   render from the target note instead. */
function setLinkViewMode(mode) {
  const anchor = linkBarAnchor;
  if (!anchor) { hideLinkBar(); return; }
  if (mode === "mention" || mode === "preview" ||
      (mode === "title" && noteLinkIdOf(anchor))) {
    anchor.setAttribute("data-ss-link-view", mode);
  } else {
    anchor.removeAttribute("data-ss-link-view");
    mode = "text";
  }
  decorateLinkView(anchor);
  markDirty();
  hideLinkBar();
  if (mode !== "text") { maybeFetchLinkInfo(anchor); }
}

/* Copy the bar link's address. The async clipboard API is the
   first path; a temporary textarea with execCommand("copy") is
   the fallback for contexts where it is missing or refuses (an
   unfocused document, an older browser). Only a copy that
   actually happened earns the success toast; a total failure
   says so instead. */
function copyLinkBarUrl() {
  const href = linkBarHref;
  if (!href) { return; }
  const done = function () {
    hideLinkBar();
    toast("Link copied.");
  };
  const failed = function () {
    toast("The link could not be copied.", true);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(href).then(done, function () {
      if (!copyLinkUrlFallback(href)) { failed(); return; }
      done();
    });
    return;
  }
  if (copyLinkUrlFallback(href)) { done(); }
  else { failed(); }
}

/* The textarea fallback for copyLinkBarUrl, kept separate so the
   promise path above can share it. Returns whether the copy
   command reported success. The textarea is invisible, never
   focused visibly, and always removed. */
function copyLinkUrlFallback(text) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return !!ok;
  } catch (err) {
    return false;
  }
}

/* v2.10: the one copy action behind the bar's copy button and
   the menu's Copy URL: a web link copies its address (above);
   a note link copies the link itself (below). */
function copyLinkBarLink() {
  if (linkBarAnchor && noteLinkIdOf(linkBarAnchor)) {
    copyNoteLink(linkBarAnchor);
    return;
  }
  copyLinkBarUrl();
}

/* v2.10: copy a note link. A note link has no URL to copy, so
   what is copied is the link itself: a rich text HTML payload
   holding an anchor with the same ssnote: href, its class, and
   its own text, with the target note's title (or the link's
   text when the target is gone) as the plain text fallback.
   Pasted into another SnakeScale note, the HTML recreates a
   working note link; pasted anywhere else, the title is what
   lands. The fallback chain mirrors the address copy: the
   rich clipboard write first, then a plain writeText, then
   the textarea fallback, and the success toast only ever
   follows a write that actually happened. */
function copyNoteLink(anchor) {
  if (!anchor) { return; }
  const noteId = noteLinkIdOf(anchor);
  const target = noteId ? findNoteById(noteId) : null;
  const linkText = linkOriginalText(anchor);
  const plain = target ? (target.title || "Untitled note") :
    linkText;
  const html = "<a href=\"" + SSNOTE_HREF_PREFIX + noteId +
    "\" class=\"ss-note-link\">" +
    escapeHtml(linkText || plain) + "</a>";
  const done = function () {
    hideLinkBar();
    toast("Link copied.");
  };
  const failed = function () {
    toast("The link could not be copied.", true);
  };
  const plainFallback = function () {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(plain).then(done, function () {
        if (copyLinkUrlFallback(plain)) { done(); }
        else { failed(); }
      });
      return;
    }
    if (copyLinkUrlFallback(plain)) { done(); }
    else { failed(); }
  };
  if (navigator.clipboard && navigator.clipboard.write &&
      typeof ClipboardItem !== "undefined") {
    try {
      const item = new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" })
      });
      navigator.clipboard.write([item]).then(done, plainFallback);
    } catch (err) {
      plainFallback();
    }
    return;
  }
  plainFallback();
}

/* v2.115: the shared copy behind the context menus'
   Copy link items (a note, an email, an event; a task
   joined in v2.116). The
   payload is the chip the matching mention picker
   inserts, carried as text/html beside the item's
   title as text/plain, so a paste into a note or the
   scratch pad lands the same pill the @, @@, and ^
   menus plant, and a paste anywhere else lands the
   title. The fallback chain is copyNoteLink's own
   (the rich write, then a plain writeText, then the
   textarea fallback), with one honesty difference the
   menus' brief requires: when only the plain title
   could be copied, the toast says exactly that,
   rather than claiming the link was copied. */
function copyChipLink(html, plain) {
  const done = function () { toast("Link copied."); };
  const failed = function () {
    toast("The link could not be copied.", true);
  };
  const plainOnly = function () {
    toast("Only the title was copied; the link " +
      "itself was refused.");
  };
  const plainFallback = function () {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(plain).then(plainOnly,
        function () {
          if (copyLinkUrlFallback(plain)) { plainOnly(); }
          else { failed(); }
        });
      return;
    }
    if (copyLinkUrlFallback(plain)) { plainOnly(); }
    else { failed(); }
  };
  if (navigator.clipboard && navigator.clipboard.write &&
      typeof ClipboardItem !== "undefined") {
    try {
      const item = new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" })
      });
      navigator.clipboard.write([item]).then(done, plainFallback);
    } catch (err) {
      plainFallback();
    }
    return;
  }
  plainFallback();
}

/* The chip HTML the @ mention inserter produces for a
   note: the anchor exactly as insertMentionNoteLink and
   pickNoteLinkTarget build one, attribute for attribute
   (the ssnote: href, the ss-note-link class, the title
   tooltip, and the Mention view mode every new note link
   is born with since v2.12), its text the note's title,
   escaped the way copyNoteLink escapes its link text.
   v2.116: through v2.115 this string carried only the
   href, the class, and the text: a paste of it landed a
   plain Text mode anchor, no Mention face, no page icon,
   the caret free to wander into its text and the link
   bar serving it on hover, where the picker planted
   link is an atomic pill the caret steps around (the
   diagnosis is in the v2.116 build report). The payload
   was half of that fault; the paste path's missing
   decoration pass was the other half. */
function noteLinkChipHtml(note) {
  const title = escapeHtml(note.title || "Untitled note");
  return "<a href=\"" + SSNOTE_HREF_PREFIX + note.id +
    "\" class=\"ss-note-link\" title=\"" + title +
    "\" data-ss-link-view=\"mention\">" + title + "</a>";
}

/* Copy link for one note (the note list context
   menu's item). */
function copyLinkForNote(note) {
  if (!note) { return; }
  copyChipLink(noteLinkChipHtml(note),
    note.title || "Untitled note");
}

/* Unlink: replace the anchor with its own original contents, so
   the text and any inline formatting inside it stay in the note
   and only the link goes away. While a face is shown, the
   original contents are the wrapper's children; the face node is
   the anchor's own child and is deliberately left behind with
   the anchor, never moved into the text. */
function unlinkLinkBarAnchor() {
  const anchor = linkBarAnchor;
  if (!anchor || !anchor.parentNode) { hideLinkBar(); return; }
  const wrap = anchor.querySelector(":scope > .ss-link-original");
  const source = wrap || anchor;
  const parent = anchor.parentNode;
  while (source.firstChild) {
    parent.insertBefore(source.firstChild, anchor);
  }
  anchor.remove();
  markDirty();
  hideLinkBar();
}

/* Delete (the menu's, deliberately unlike Unlink): remove the
   anchor and ALL of its contents, text included. What remains is
   whatever surrounded the link. */
function deleteLinkBarAnchor() {
  const anchor = linkBarAnchor;
  if (anchor) { anchor.remove(); }
  markDirty();
  hideLinkBar();
}

/* ----- v2.9: link view faces ---------------------------------------------
   A Mention or Preview anchor displays a FACE: a runtime only
   node (span.ss-link-face, contenteditable false) built by
   decoration from the anchor's saved mode and Microlink info
   attributes. While a face is shown, the anchor's original
   children live in a sibling wrapper (span.ss-link-original,
   display none by CSS): hidden, never removed, so the underlying
   link, its text, and its formatting are exactly what was saved,
   and switching back to Text restores them byte for byte. The
   save funnel strips faces and unwraps originals (stripLinkFaces
   beside canonicalizeAttachmentPlaceholders), so save, reload,
   and decorate cycles are idempotent and byte stable, and the
   exporters, which all read the anchor's own text and address,
   treat a faced link exactly like a Text link. Fetched strings
   only ever enter a face through textContent, never innerHTML,
   so a hostile page title renders as literal characters. */

/* The link's current display mode: "mention", "preview", or
   "text" (the saved attribute's absence, and the fallback for
   any value this version does not know). v2.10 adds "title",
   a note link only mode: the value on a web link is not a
   mode this app offers there and degrades to "text", the same
   unknown value rule. */
function linkViewModeOf(anchor) {
  const mode = anchor ? anchor.getAttribute("data-ss-link-view") : null;
  if (mode === "mention" || mode === "preview") { return mode; }
  if (mode === "title" && noteLinkIdOf(anchor)) { return "title"; }
  return "text";
}

/* The link's original text: the wrapper's text while a face is
   shown, the anchor's own text otherwise. */
function linkOriginalText(anchor) {
  if (!anchor) { return ""; }
  const wrap = anchor.querySelector(":scope > .ss-link-original");
  return (wrap ? wrap.textContent : anchor.textContent) || "";
}

/* The label a Mention face shows, in precedence order: the
   fetched title, then the link's own text, then the hostname
   when the text is just the raw address (or empty). */
function linkMentionLabel(anchor) {
  const title = anchor.getAttribute("data-ss-link-title");
  if (title) { return title; }
  const href = anchor.getAttribute("href") || "";
  const text = linkOriginalText(anchor).trim();
  if (text && text !== href && text !== href.replace(/\/$/, "")) {
    return text;
  }
  return linkHostnameOf(href) || text || href;
}

/* The hostname of a URL, or "" when it does not parse (a mailto
   address has no hostname; callers fall back to the address). */
function linkHostnameOf(href) {
  try {
    return new URL(href).hostname || "";
  } catch (err) {
    return "";
  }
}

/* A small globe icon node for faces, the same drawing the link
   bar leads with. Built as an element (never an HTML string fed
   to innerHTML), so face construction has exactly one string
   free path. */
function linkGlobeIcon(size) {
  const span = document.createElement("span");
  span.className = "ss-link-face-globe";
  span.setAttribute("aria-hidden", "true");
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const circle = document.createElementNS(NS, "circle");
  circle.setAttribute("cx", "12");
  circle.setAttribute("cy", "12");
  circle.setAttribute("r", "9");
  const equator = document.createElementNS(NS, "path");
  equator.setAttribute("d", "M3 12h18");
  const meridian = document.createElementNS(NS, "path");
  meridian.setAttribute("d",
    "M12 3c2.5 2.6 3.9 5.7 3.9 9s-1.4 6.4-3.9 9c-2.5-2.6-3.9-5.7-3.9-9S9.5 5.6 12 3z");
  svg.appendChild(circle);
  svg.appendChild(equator);
  svg.appendChild(meridian);
  span.appendChild(svg);
  return span;
}

/* An image for a face (a Mention's site logo, a Preview's cover).
   The src is set as a property, and a load error hides the image
   rather than leaving a broken picture in the note: a stale or
   blocked image URL degrades to the text face, nothing more. */
function linkFaceImage(src, className, alt) {
  const img = document.createElement("img");
  img.className = className;
  img.alt = alt || "";
  img.addEventListener("error", function () {
    img.style.display = "none";
  });
  img.src = src;
  return img;
}

/* Build the Mention face for an anchor: the site's stored logo
   when there is one, else a globe, then the label. */
function buildMentionFace(anchor) {
  const face = document.createElement("span");
  face.className = "ss-link-face ss-link-face-mention";
  face.setAttribute("data-ss-runtime", "face");
  face.setAttribute("contenteditable", "false");
  const logo = anchor.getAttribute("data-ss-link-logo");
  if (logo) { face.appendChild(linkFaceImage(logo, "ss-link-face-logo", "")); }
  else { face.appendChild(linkGlobeIcon(14)); }
  const label = document.createElement("span");
  label.className = "ss-link-face-label";
  label.textContent = linkMentionLabel(anchor);
  face.appendChild(label);
  return face;
}

/* Build the Preview face for an anchor: a card with the stored
   cover image when there is one, the title (the fetched title,
   else the link's own text, else the address), the description
   when one is stored, and the address as the footer line. Every
   piece is optional but the title line, so a link with no fetched
   info still renders a clean card from what the note knows. */
function buildPreviewFace(anchor) {
  const face = document.createElement("span");
  face.className = "ss-link-face ss-link-face-preview";
  face.setAttribute("data-ss-runtime", "face");
  face.setAttribute("contenteditable", "false");
  const href = anchor.getAttribute("href") || "";
  const image = anchor.getAttribute("data-ss-link-image");
  if (image) {
    face.appendChild(linkFaceImage(image, "ss-link-face-cover", ""));
  }
  const main = document.createElement("span");
  main.className = "ss-link-face-main";
  const title = document.createElement("span");
  title.className = "ss-link-face-title";
  title.textContent = anchor.getAttribute("data-ss-link-title") ||
    linkOriginalText(anchor).trim() || href;
  main.appendChild(title);
  const desc = anchor.getAttribute("data-ss-link-desc");
  if (desc) {
    const descEl = document.createElement("span");
    descEl.className = "ss-link-face-desc";
    descEl.textContent = desc;
    main.appendChild(descEl);
  }
  const urlLine = document.createElement("span");
  urlLine.className = "ss-link-face-url";
  urlLine.textContent = href;
  main.appendChild(urlLine);
  face.appendChild(main);
  return face;
}

/* ----- v2.10: note link faces ------------------------------------
   A note link's faces are built from the TARGET NOTE, resolved
   live at decoration time through findNoteById (live notes,
   Trash, and Archive, the lookup the tooltips use), so a
   renamed or moved target shows its new title and notebook the
   next time the containing note renders, without the link
   itself being touched. The faces are the same runtime only
   .ss-link-face nodes the web faces are (same wrapper, same
   save funnel stripping), and every string enters through
   textContent. A target that no longer exists in any list
   gives no face at all: every mode falls back to the plain
   Text rendering, the mirror of the tooltip fallback. */

/* A small page icon node for note faces, the same drawing the
   link bar leads with for a note link, built as elements like
   linkGlobeIcon so face construction stays string free. */
function linkPageIcon(size) {
  const span = document.createElement("span");
  span.className = "ss-link-face-page";
  span.setAttribute("aria-hidden", "true");
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const outline = document.createElementNS(NS, "path");
  outline.setAttribute("d", "M7 3h7l4 4v14H7z");
  const fold = document.createElementNS(NS, "path");
  fold.setAttribute("d", "M14 3v4h4");
  const line1 = document.createElementNS(NS, "path");
  line1.setAttribute("d", "M9.5 12h5");
  const line2 = document.createElementNS(NS, "path");
  line2.setAttribute("d", "M9.5 15.5h5");
  svg.appendChild(outline);
  svg.appendChild(fold);
  svg.appendChild(line1);
  svg.appendChild(line2);
  span.appendChild(svg);
  return span;
}

/* Whether a note link's text is TITLE DERIVED (it just repeats
   the target's title, so a Mention label follows the target
   live) or the user's own custom text (the label is the text,
   and a rename never moves it). The evidence is the saved
   anchor: the picker and the retarget flow set the text and
   the title attribute to the same title, and a bar text edit
   changes only the text, so while the saved title attribute
   survives, text === title attribute means derived. The
   tooltip pass (decorateLinkTooltips) overwrites that
   attribute with the LIVE title on every render, so the
   verdict is captured here, before the overwrite, onto the
   anchor as runtime only properties (never saved): the
   verdict, and the exact text it was computed from. A later
   capture for the SAME text is skipped (the attribute has
   been rewritten since; the first verdict stands), and the
   edit and retarget flows refresh the verdict themselves when
   they change the text. A link carrying no title attribute at
   all (hand written or imported) is judged against the live
   title, the best evidence available for it. */
function captureNoteLinkDerivation(anchor) {
  const raw = linkOriginalText(anchor);
  if (anchor.__ssNoteDerivedText === raw) { return; }
  const savedTitle = anchor.getAttribute("title");
  let derived;
  if (raw.trim() === "") {
    derived = true;
  } else if (savedTitle !== null) {
    derived = raw === savedTitle;
  } else {
    const noteId = noteLinkIdOf(anchor);
    const target = noteId ? findNoteById(noteId) : null;
    derived = !!target && raw === (target.title || "Untitled note");
  }
  anchor.__ssNoteDerivedText = raw;
  anchor.__ssNoteTitleDerived = derived;
}

/* The label a note Mention shows: the target's live title for
   a title derived link (the picker born label, and any text
   the retarget flow followed), so a rename shows through on
   the next render; the link's own custom text otherwise. With
   no captured verdict (a face built before any tooltip pass),
   the literal comparison against the live title decides. */
function noteMentionLabel(anchor, target) {
  const raw = linkOriginalText(anchor);
  const text = raw.trim();
  const title = target.title || "Untitled note";
  if (!text) { return title; }
  if (anchor.__ssNoteDerivedText === raw) {
    return anchor.__ssNoteTitleDerived ? title : text;
  }
  return text === title ? title : text;
}

/* Build the note Mention face: a page icon and the label. */
function buildNoteMentionFace(anchor, target) {
  const face = document.createElement("span");
  face.className = "ss-link-face ss-link-face-note-mention";
  face.setAttribute("data-ss-runtime", "face");
  face.setAttribute("contenteditable", "false");
  face.appendChild(linkPageIcon(14));
  const label = document.createElement("span");
  label.className = "ss-link-face-label";
  label.textContent = noteMentionLabel(anchor, target);
  face.appendChild(label);
  return face;
}

/* Build the note Title face: a full width bar with a page
   icon, the target's title in bold, and its notebook name
   muted beside it, per Chris's Title card screenshot. */
function buildNoteTitleFace(target) {
  const face = document.createElement("span");
  face.className = "ss-link-face ss-link-face-note-title";
  face.setAttribute("data-ss-runtime", "face");
  face.setAttribute("contenteditable", "false");
  face.appendChild(linkPageIcon(16));
  const title = document.createElement("span");
  title.className = "nl-face-title";
  title.textContent = target.title || "Untitled note";
  face.appendChild(title);
  const nb = document.createElement("span");
  nb.className = "nl-face-notebook";
  nb.textContent = notebookNameForNote(target);
  face.appendChild(nb);
  return face;
}

/* Build the note Preview face: a card with the target's title
   and its updated time on the head row, an excerpt of its
   body under them, and a notebook row (icon and name) at the
   bottom, per Chris's first screenshot. */
function buildNotePreviewFace(target) {
  const face = document.createElement("span");
  face.className = "ss-link-face ss-link-face-note-preview";
  face.setAttribute("data-ss-runtime", "face");
  face.setAttribute("contenteditable", "false");
  const head = document.createElement("span");
  head.className = "nl-face-head";
  const title = document.createElement("span");
  title.className = "nl-face-title";
  title.textContent = target.title || "Untitled note";
  head.appendChild(title);
  const time = document.createElement("span");
  time.className = "nl-face-time";
  time.textContent = noteLinkTimeLabel(target.updated);
  head.appendChild(time);
  face.appendChild(head);
  const excerpt = document.createElement("span");
  excerpt.className = "nl-face-excerpt";
  excerpt.textContent = noteLinkExcerpt(target);
  face.appendChild(excerpt);
  const foot = document.createElement("span");
  foot.className = "nl-face-foot";
  foot.appendChild(linkPageIcon(13));
  const nbName = document.createElement("span");
  nbName.textContent = notebookNameForNote(target);
  foot.appendChild(nbName);
  face.appendChild(foot);
  return face;
}

/* Decorate one note link: Text (and every mode whose target
   is gone) unwraps to the plain link; Mention, Title, and
   Preview wrap the originals and build the mode's face from
   the target's live data. */
function decorateNoteLinkView(anchor, noteId) {
  const mode = linkViewModeOf(anchor);
  const target = mode === "text" ? null : findNoteById(noteId);
  if (mode === "text" || !target) {
    const wrap = anchor.querySelector(":scope > .ss-link-original");
    if (wrap) {
      while (wrap.firstChild) {
        anchor.insertBefore(wrap.firstChild, wrap);
      }
      wrap.remove();
    }
    return;
  }
  let wrap = anchor.querySelector(":scope > .ss-link-original");
  if (!wrap) {
    wrap = document.createElement("span");
    wrap.className = "ss-link-original";
    wrap.setAttribute("data-ss-runtime", "original");
    while (anchor.firstChild) { wrap.appendChild(anchor.firstChild); }
    anchor.appendChild(wrap);
  }
  if (mode === "mention") {
    anchor.appendChild(buildNoteMentionFace(anchor, target));
  } else if (mode === "title") {
    anchor.appendChild(buildNoteTitleFace(target));
  } else {
    anchor.appendChild(buildNotePreviewFace(target));
  }
}

/* Bring one anchor's face in line with its saved mode: Text
   unwraps and defaces it (the plain editable link again), while
   Mention and Preview wrap the original children if they are
   not wrapped yet and (re)build the face. Idempotent by
   construction: the face is rebuilt from the attributes every
   time, and the wrapper is created only when missing.
   v2.10: note links branch to their own decoration above;
   the old face comes off first either way, here, so a mode
   switch never stacks faces. */
function decorateLinkView(anchor) {
  if (!anchor || !anchor.getAttribute) { return; }
  /* v2.28.0: task links are never faced (and never
     fetched): they stay the plain anchor they were
     saved as, in every mode. */
  if (taskLinkIdOf(anchor)) { return; }
  const oldFace = anchor.querySelector(":scope > .ss-link-face");
  if (oldFace) { oldFace.remove(); }
  const noteId = noteLinkIdOf(anchor);
  if (noteId) {
    decorateNoteLinkView(anchor, noteId);
    return;
  }
  const mode = linkViewModeOf(anchor);
  if (mode === "text") {
    const wrap = anchor.querySelector(":scope > .ss-link-original");
    if (wrap) {
      while (wrap.firstChild) {
        anchor.insertBefore(wrap.firstChild, wrap);
      }
      wrap.remove();
    }
    return;
  }
  let wrap = anchor.querySelector(":scope > .ss-link-original");
  if (!wrap) {
    wrap = document.createElement("span");
    wrap.className = "ss-link-original";
    wrap.setAttribute("data-ss-runtime", "original");
    while (anchor.firstChild) { wrap.appendChild(anchor.firstChild); }
    anchor.appendChild(wrap);
  }
  anchor.appendChild(mode === "mention" ?
    buildMentionFace(anchor) : buildPreviewFace(anchor));
}

/* Decorate every link under rootEl, the face companion to
   decorateLinkTooltips, run wherever that step runs. Anchors
   inside attachment placeholders are skipped: they are
   attachment furniture, not text links. Note links are
   decorated here since v2.10 (Text, Mention, Title, Preview);
   through v2.9 they were skipped as modeless. */
function decorateLinkViews(rootEl) {
  if (!rootEl || !rootEl.querySelectorAll) { return; }
  rootEl.querySelectorAll("a[href]").forEach(function (anchor) {
    if (anchor.closest && anchor.closest(".ss-attachment")) { return; }
    /* v2.37.0: table of contents entries are plain anchors
       by construction and stay that way: no view modes, no
       faces, nothing the canonical rebuild would strip. */
    if (anchor.closest && anchor.closest(".ss-toc")) { return; }
    /* v2.49.0: anchors inside a note tasks block stay
       plain too, on the same rule. */
    if (anchor.closest && anchor.closest(".ss-note-tasks")) { return; }
    decorateLinkView(anchor);
  });
}

/* ----- v2.9: Microlink link info -----------------------------------------
   Mention and Preview look real with real data: the page's own
   title, description, cover image, and site logo. Browsers
   cannot fetch that from the page directly (most sites refuse
   cross origin reads), so the app asks the Microlink metadata
   API, which exists for exactly this and needs no key: GET
   https://api.microlink.io?url=<the address>, answered with
   JSON whose data object carries title, description, image.url,
   logo.url, and publisher. Only the link address is ever sent;
   no note text, no Drive data.
   The fetch is LAZY and ONE TIME per link: it runs when a link
   is switched to Mention or Preview with no info stored yet, and
   after an edit changes the address of a faced link (its stored
   info was cleared with the old address). It never runs for
   Text links, mailto links, note renders, or note opens. What
   comes back is stored on the anchor itself (data-ss-link-title,
   desc, image, logo), so it is part of the saved note, travels
   with sync, and renders offline forever after. A failure of any
   kind (network, non 200, a 429 rate limit, bad JSON, the 8
   second timeout) stores nothing, shows nothing, and retries
   never: the face simply renders from the link's own text, and a
   later mode switch may try again. */

const MICROLINK_API_URL = "https://api.microlink.io?url=";

/* How long a link info fetch may take before it is given up on.
   A mutable binding rather than a constant so the behavior can
   be tuned in one place (and exercised quickly in tests). */
let linkInfoTimeoutMs = 8000;

/* Anchors with an info fetch in flight right now. A WeakSet: the
   membership IS the guard (exactly one fetch per anchor at a
   time), and anchors the editor has discarded take their entry
   with them. */
const linkInfoInFlight = new WeakSet();

/* Whether the anchor carries any stored link info. Partial info
   counts: a page that offered only a title has been fetched, and
   the stored title is its info; it is not refetched. */
function hasStoredLinkInfo(anchor) {
  return !!(anchor.getAttribute("data-ss-link-title") ||
    anchor.getAttribute("data-ss-link-desc") ||
    anchor.getAttribute("data-ss-link-image") ||
    anchor.getAttribute("data-ss-link-logo"));
}

/* Drop every stored info attribute (an address change makes them
   describe a page the link no longer points at). */
function clearStoredLinkInfo(anchor) {
  anchor.removeAttribute("data-ss-link-title");
  anchor.removeAttribute("data-ss-link-desc");
  anchor.removeAttribute("data-ss-link-image");
  anchor.removeAttribute("data-ss-link-logo");
}

/* Store one fetched field when the response actually provided a
   non empty value; absent fields stay absent, so partial info is
   kept exactly as partial. */
function storeLinkInfoField(anchor, attr, value) {
  if (typeof value === "string" && value.trim()) {
    anchor.setAttribute(attr, value);
  }
}

/* Fetch the anchor's link info from Microlink, when the rules
   above call for it, and apply what returns. Fire and forget:
   every outcome lands in the guards below or in the silent catch,
   never in a toast. */
function maybeFetchLinkInfo(anchor) {
  if (!anchor || !anchor.isConnected) { return; }
  const mode = linkViewModeOf(anchor);
  if (mode !== "mention" && mode !== "preview") { return; }
  if (hasStoredLinkInfo(anchor)) { return; }
  const href = anchor.getAttribute("href") || "";
  let parsed;
  try {
    parsed = new URL(href);
  } catch (err) {
    return;
  }
  /* http and https only: mailto links have no page to describe,
     and note links, which carry modes since v2.10, are judged
     out by their ssnote: scheme here: no note link ever
     fetches, in any mode, ever. */
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return;
  }
  if (linkInfoInFlight.has(anchor)) { return; }
  linkInfoInFlight.add(anchor);
  /* What the result must still match when it lands: the note that
     was open, the very same anchor element, and the same address.
     A note switch, an unlink, or a retarget in the meantime makes
     the result stale, and it is dropped silently. */
  const noteId = state.selectedId;
  const controller = (typeof AbortController !== "undefined") ?
    new AbortController() : null;
  const timer = controller ?
    setTimeout(function () { controller.abort(); }, linkInfoTimeoutMs) :
    null;
  fetch(MICROLINK_API_URL + encodeURIComponent(href), controller ?
    { signal: controller.signal } : undefined
  ).then(function (resp) {
    if (!resp || !resp.ok) {
      throw new Error("Link info request failed: " +
        (resp ? resp.status : "no response"));
    }
    return resp.json();
  }).then(function (json) {
    const data = json && json.data;
    if (!data) { return; }
    if (state.selectedId !== noteId) { return; }
    if (!anchor.isConnected) { return; }
    if (anchor.getAttribute("href") !== href) { return; }
    storeLinkInfoField(anchor, "data-ss-link-title", data.title);
    storeLinkInfoField(anchor, "data-ss-link-desc", data.description);
    storeLinkInfoField(anchor, "data-ss-link-image",
      data.image && data.image.url);
    storeLinkInfoField(anchor, "data-ss-link-logo",
      data.logo && data.logo.url);
    /* Nothing usable came back: leave the fallback face as it
       is, store nothing, save nothing. */
    if (!hasStoredLinkInfo(anchor)) { return; }
    decorateLinkView(anchor);
    markDirty();
  }).catch(function () {
    /* Silent by design: the fallback face is already on screen. */
  }).then(function () {
    if (timer) { clearTimeout(timer); }
    linkInfoInFlight.delete(anchor);
  });
}


/* ----- v2.1.0: note links (Insert, Link to Note) -------------------------
   A note link is an ordinary anchor whose href is "ssnote:<noteId>" and
   whose class is ss-note-link. It is inserted at the caret the user had
   BEFORE the picker modal opened: runInsertAction restores the saved
   formatting selection, openNoteLinkPicker reads it (for the label) and
   captures it with captureCaret(), the same caret memory the attachment
   flows use, and picking a note restores that range and inserts the
   anchor into it. Clicking a note link never shows the web link popup:
   the note body's link click listener resolves ssnote: hrefs FIRST (see
   wireEvents), ahead of both the Ctrl+click path and the popup path.
   (v2.10: the popup's successor, the link bar, DOES serve note
   links on hover rest; the click rule above is untouched, and
   the picker gained the retarget job described below.) */

const SSNOTE_HREF_PREFIX = "ssnote:";

/* The note id a note link points at, or null when the anchor is not a
   note link. Reads the RAW href attribute on purpose: the resolved
   anchor.href property would rewrite "ssnote:abc" into an absolute URL
   string and hide the scheme this check depends on. */
function noteLinkIdOf(anchor) {
  if (!anchor || !anchor.getAttribute) { return null; }
  const href = anchor.getAttribute("href") || "";
  if (href.indexOf(SSNOTE_HREF_PREFIX) !== 0) { return null; }
  const id = href.slice(SSNOTE_HREF_PREFIX.length).trim();
  return id ? id : null;
}

/* While the picker is open: the caret range to insert at, and the label
   decided at open time (the selected text, or empty when the caret was
   collapsed, in which case the target note's title becomes the label). */
let noteLinkPending = null;

/* v2.10: the picker's second job. The link bar's note link edit
   state reopens this same picker to RETARGET an existing link:
   while this holds the anchor being retargeted, picking a row
   rewrites that anchor instead of inserting a new one (see
   pickNoteLinkTarget). It is cleared by closeNoteLinkPicker,
   so a cancelled retarget can never leak into a later insert. */
let noteLinkRetargetAnchor = null;

function openNoteLinkPicker() {
  const host = currentNote();
  if (!host) {
    toast("Open a note first, then insert a link to another note.", true);
    return;
  }
  if (host.trashed || host.archived) {
    toast("Links cannot be inserted while a note is in Trash or the Archive.", true);
    return;
  }
  noteLinkRetargetAnchor = null;
  const bodyEl = document.getElementById("noteBody");
  /* runInsertAction has just restored the saved selection, so the live
     selection IS the user's caret. Read the label from it first, then
     capture it with the attachment caret memory before the modal takes
     focus away from the editor. */
  const sel = window.getSelection();
  let label = "";
  if (sel && sel.rangeCount) {
    const range = sel.getRangeAt(0);
    if (!range.collapsed && bodyEl.contains(range.commonAncestorContainer)) {
      label = range.toString().trim();
    }
  }
  captureCaret();
  noteLinkPending = { range: savedCaretRange, label: label };
  const search = document.getElementById("noteLinkSearch");
  search.value = "";
  renderNoteLinkResults("");
  document.getElementById("noteLinkModal").classList.remove("hidden");
  search.focus();
}

function closeNoteLinkPicker() {
  document.getElementById("noteLinkModal").classList.add("hidden");
  noteLinkPending = null;
  noteLinkRetargetAnchor = null;
  /* v2.83: a closed picker holds no event link mode
     either, whatever way it closed. */
  gcalNoteLinkCtx = null;
}

/* v2.10: open the picker to retarget the link bar's note link
   (the Change note button in its edit state). No caret is
   captured and no label is read: the results list is the same
   one the insert flow shows (the open note itself excluded),
   and picking a row applies the retarget at once. The bar
   stays open in its edit state behind the modal, and the
   retarget lands back on it (see applyNoteLinkRetarget); a
   cancelled picker simply leaves the edit state untouched. */
function openNoteLinkRetargetPicker() {
  if (!linkBarAnchor || !noteLinkIdOf(linkBarAnchor)) { return; }
  noteLinkPending = null;
  noteLinkRetargetAnchor = linkBarAnchor;
  const search = document.getElementById("noteLinkSearch");
  search.value = "";
  renderNoteLinkResults("");
  document.getElementById("noteLinkModal").classList.remove("hidden");
  search.focus();
}

/* v2.10: apply a retarget pick: the anchor's href moves to the
   chosen note, its tooltip follows (renders re-resolve it
   anyway), and its face is rebuilt for the new target. The
   text rule: text that just repeated the OLD target's title
   was never really the user's own words, so it follows to
   the new target's title; any other text is the user's and
   is left exactly as it was. The bar is then shown afresh for
   the link (its label is the new title by construction), in
   its normal view, and the change saves like any link edit. */
function applyNoteLinkRetarget(target) {
  const anchor = noteLinkRetargetAnchor;
  closeNoteLinkPicker();
  if (!anchor || !anchor.isConnected) { return; }
  const oldId = noteLinkIdOf(anchor);
  const oldTarget = oldId ? findNoteById(oldId) : null;
  const oldTitle = oldTarget ?
    (oldTarget.title || "Untitled note") : null;
  const currentText = linkOriginalText(anchor);
  anchor.setAttribute("href", SSNOTE_HREF_PREFIX + target.id);
  anchor.setAttribute("title", target.title || "Untitled note");
  if (oldTitle !== null && currentText === oldTitle) {
    const newTitle = target.title || "Untitled note";
    const wrap = anchor.querySelector(":scope > .ss-link-original");
    if (wrap) { wrap.textContent = newTitle; }
    else { anchor.textContent = newTitle; }
  }
  /* Refresh the Mention derivation verdict for the retargeted
     link: text that followed (or already matched) the new
     target's title is title derived; kept custom text is not. */
  const finalText = linkOriginalText(anchor);
  anchor.__ssNoteDerivedText = finalText;
  anchor.__ssNoteTitleDerived = finalText.trim() === "" ||
    finalText === (target.title || "Untitled note");
  decorateLinkView(anchor);
  markDirty();
  showLinkBar(anchor);
  toast("Link updated.");
}

/* The picker's results: live notes only (state.notes never holds Trash
   or Archive notes), minus the note being edited, most recently
   updated first, filtered by the search text against the title. Each
   row shows the title, its notebook's name, and its updated date. */
function renderNoteLinkResults(filterText) {
  const box = document.getElementById("noteLinkResults");
  box.innerHTML = "";
  const host = currentNote();
  const needle = (filterText || "").trim().toLowerCase();
  const matches = state.notes.filter(function (note) {
    /* v2.83: in the event link mode the picker serves
       an event, not the open note, so the host note is
       a fair target like any other. */
    if (!gcalNoteLinkCtx && host && note.id === host.id) {
      return false;
    }
    if (!needle) { return true; }
    return (note.title || "").toLowerCase().indexOf(needle) >= 0;
  }).slice().sort(function (a, b) {
    return String(b.updated || "").localeCompare(String(a.updated || ""));
  });
  if (!matches.length) {
    const empty = document.createElement("p");
    empty.className = "note-link-empty";
    empty.textContent = needle
      ? "No notes match that search."
      : "There are no other notes to link to yet.";
    box.appendChild(empty);
    return;
  }
  matches.forEach(function (note) {
    const nb = state.notebooks.find(function (b) {
      return b.slug === note.notebook;
    });
    const row = document.createElement("button");
    row.type = "button";
    row.className = "note-link-row";
    const titleEl = document.createElement("span");
    titleEl.className = "nl-title";
    titleEl.textContent = note.title || "Untitled note";
    const metaEl = document.createElement("span");
    metaEl.className = "nl-meta";
    metaEl.textContent = (nb ? nb.name : "Notebook") + ", updated " +
      formatDate(note.updated);
    row.appendChild(titleEl);
    row.appendChild(metaEl);
    row.addEventListener("click", function () { pickNoteLinkTarget(note); });
    box.appendChild(row);
  });
}

/* Insert the chosen link at the caret captured when the picker opened,
   then close the picker. The label is the text that was selected when
   the picker opened, or the target note's title when nothing was
   selected. Falls back to appending at the end of the body when the
   captured range is no longer usable, the same fallback the
   attachment placeholder inserter uses. */
function pickNoteLinkTarget(target) {
  /* v2.83: in the event link mode the pick serves the
     event surface that opened the picker; its handler
     closes the picker itself. */
  if (gcalNoteLinkCtx) {
    gcalPickEventNote(target);
    return;
  }
  /* v2.10: a retarget pick rewrites the existing link instead
     of inserting a new one; applyNoteLinkRetarget closes the
     picker itself. */
  if (noteLinkRetargetAnchor) {
    applyNoteLinkRetarget(target);
    return;
  }
  const pending = noteLinkPending;
  closeNoteLinkPicker();
  const bodyEl = document.getElementById("noteBody");
  bodyEl.focus();
  const anchor = document.createElement("a");
  anchor.setAttribute("href", SSNOTE_HREF_PREFIX + target.id);
  anchor.setAttribute("class", "ss-note-link");
  /* v2.6.0: the tooltip is correct from birth: the target's title.
     Later renders re-resolve it (decorateLinkTooltips), so a rename
     still shows through without this anchor being touched again. */
  anchor.setAttribute("title", target.title || "Untitled note");
  /* v2.12: new note links are born in Mention view (Chris's
     direction), here and in the "@" popup alike. Links saved by
     earlier versions keep the mode they carry; nothing rewrites
     them, and the View Link As menu still switches any link. */
  anchor.setAttribute("data-ss-link-view", "mention");
  anchor.textContent = (pending && pending.label) ||
    target.title || "Untitled note";
  let placed = false;
  const range = pending && pending.range;
  if (range && bodyEl.contains(range.startContainer)) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const live = sel.getRangeAt(0);
    live.deleteContents();
    live.insertNode(anchor);
    live.setStartAfter(anchor);
    live.collapse(true);
    sel.removeAllRanges();
    sel.addRange(live);
    placed = true;
  }
  if (!placed) { bodyEl.appendChild(anchor); }
  markDirty();
}

/* Does the current list view contain this live note? Mirrors the view
   kinds visibleNotes() understands. A note link click switches the
   list to All Notes when the answer is no, so the user sees where
   they landed; openNote then re-renders the list in that view. */
function listViewContainsNote(note) {
  const view = state.view;
  if (!view || view.kind === "all") { return true; }
  if (view.kind === "pinned") { return !!note.pinned; }
  if (view.kind === "notebook") { return note.notebook === view.value; }
  if (view.kind === "tag") {
    return (note.tags || []).indexOf(view.value) >= 0;
  }
  return false;
}

/* Follow a note link: open the target when it is a live note, and say
   plainly what happened when it is not. Trash and Archive are checked
   in their own state lists; anything else no longer exists. */
function followNoteLink(noteId) {
  const live = state.notes.find(function (n) { return n.id === noteId; });
  if (live) {
    if (!listViewContainsNote(live)) {
      state.view = { kind: "all", value: null };
    }
    /* v2.72: a link jump lands at the top, as it always
       has; it does not restore the target's banked
       place (see the view memory section). */
    editorAtTopNoteId = noteId;
    openNote(noteId);
    return;
  }
  if (state.trash.some(function (n) { return n.id === noteId; })) {
    toast("That note is in Trash.");
    return;
  }
  if (state.archive.some(function (n) { return n.id === noteId; })) {
    toast("That note is in the Archive.");
    return;
  }
  toast("That note no longer exists.", true);
}

/* ----- v2.36.0: backlinks ------------------------------------
   Evernote's model: a backlink is created automatically
   whenever a note contains an internal link to another note.
   The target note shows a Backlinks button at the top of the
   note with the count of the notes linking to it; opening it
   lists those notes, and clicking one opens it. (In Evernote
   this is a paid tier feature; SnakeScale has no tiers, so it
   is simply here.) The count counts source NOTES, not links:
   a note linking twice still appears once.

   Here the graph is derived from the bodies themselves. A
   note link is an ssnote: anchor in a saved body, so a note's
   outgoing edges are extracted from its body string
   (extractNoteLinks) and cached per source note
   (backlinkGraphBySource), each scan stamped with the exact
   body string it read (backlinkScannedBody). Any path that
   changes a body (an edit's save, a sync arrival, a conflict
   adoption) replaces the note object's body, so the next
   sweep sees the stamp mismatch and rescans just that note;
   no save or sync hook has to know the graph exists. Sources
   are judged live at read time (backlinkEntriesFor reads
   state.notes only), so trashing, restoring, archiving, or
   deleting a source is correct on the next render with no
   graph surgery, and a self link never lists its own note.

   Catalog shells carry no body, so a fresh session cannot
   know a shell's edges. While a note is open,
   refreshBacklinkGraph kicks the existing per note load
   (ensureNoteBodyLoaded) for every live shell once, and
   each landing rescans that note and
   re-renders the open note's bar if its entries changed, so
   the panel fills in behind the open note and never blocks
   it. The graph is memory only: nothing about backlinks is
   written to Drive, because it can always be rebuilt from
   the bodies that are already there.

   Two deliberate choices, stated plainly. Sources are NOTES
   only: task descriptions can carry ssnote: anchors (v2.28),
   but Evernote's backlinks are notes linking to notes (its
   tasks live inside notes and have no separate link class),
   so a task description link creates no backlink here.
   And each entry shows, under the source's title, a short
   snippet of the text around the link: Evernote's own list
   shows titles only, and the snippet is SnakeScale's one
   addition, kept because a bare title cannot say why the
   note links here. */

const backlinkGraphBySource = new Map();
const backlinkScannedBody = new Map();
const backlinkLoadKicked = new Set();
let backlinksOpen = false;
let backlinksForId = null;
let backlinksRenderedSig = "";

/* One body's outgoing note links: [{ targetId, snippet }],
   unique per target, the FIRST link to a target supplying
   the snippet. The parse is the app's own detached div
   pattern (htmlToText); a body with no ssnote: text at all
   costs one indexOf and no parse. */
function extractNoteLinks(bodyHtml) {
  const out = [];
  if (!bodyHtml || bodyHtml.indexOf(SSNOTE_HREF_PREFIX) < 0) {
    return out;
  }
  const host = document.createElement("div");
  host.innerHTML = bodyHtml;
  const seen = new Set();
  host.querySelectorAll("a").forEach(function (anchor) {
    /* v2.40.0: an anchor inside a code block (any pre) is
       code text that happens to be an element, not a link
       the note makes, so it creates no backlink. Through
       this release such an anchor (one pasted into a pre,
       or made by linking selected code text) WAS counted;
       the fix is deliberate. */
    if (anchor.closest && anchor.closest("pre")) { return; }
    const targetId = noteLinkIdOf(anchor);
    if (!targetId || seen.has(targetId)) { return; }
    seen.add(targetId);
    out.push({ targetId: targetId,
      snippet: backlinkSnippetAround(anchor) });
  });
  return out;
}

/* The text around one link, from its block: up to about 45
   characters on each side of the link's own words, cut with
   a plain "..." where the block runs longer. Whitespace is
   collapsed the way htmlToText collapses it, so the snippet
   reads as the sentence it was cut from. When the link's
   words cannot be found in the block text (a face whose
   label differs from its anchor text), the block's opening
   stands in. */
function backlinkSnippetAround(anchor) {
  const blockTags = { P: 1, DIV: 1, LI: 1, BLOCKQUOTE: 1,
    H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, TD: 1, PRE: 1 };
  let block = anchor;
  while (block.parentElement && !blockTags[block.tagName]) {
    block = block.parentElement;
  }
  const text = (block.textContent || "")
    .replace(/\s+/g, " ").trim();
  const words = (anchor.textContent || "")
    .replace(/\s+/g, " ").trim();
  if (!text) { return ""; }
  const at = words ? text.indexOf(words) : -1;
  if (at < 0) {
    return text.length > 90 ? text.slice(0, 90) + "..." : text;
  }
  const from = Math.max(0, at - 45);
  const to = Math.min(text.length, at + words.length + 45);
  return (from > 0 ? "..." : "") + text.slice(from, to) +
    (to < text.length ? "..." : "");
}

/* Fold one note's current body into the graph, unless the
   stamp says this exact body was already folded. Shells are
   skipped: there is no body to read until the load lands. */
function scanNoteIntoLinkGraph(note) {
  if (!note || note.bodyLoaded === false) { return; }
  const body = note.body || "";
  if (backlinkScannedBody.get(note.id) === body) { return; }
  backlinkScannedBody.set(note.id, body);
  const targets = new Map();
  extractNoteLinks(body).forEach(function (link) {
    targets.set(link.targetId, link.snippet);
  });
  backlinkGraphBySource.set(note.id, targets);
}

/* Bring the graph up to date with the live notes as they
   stand: rescan every loaded note whose body moved since
   its scan, and start the body load of every live shell
   that has not been started for the graph yet. Each load
   that lands rescans its note (re-read from state by id,
   since a load can replace the note object) and re-renders
   the open note's bar when its entries changed. */
function refreshBacklinkGraph() {
  /* The background loads are gated on a note being open.
     The backlinks bar only exists in the editor, and the
     catalog fast path (v2.20) promises that opening the
     app downloads no note bodies at all: a boot, and any
     list browsing with nothing open, scans the bodies
     already in memory and loads nothing. Opening a note
     lifts the gate, so the open note's panel fills in
     behind it while the library's other bodies load once,
     in the background; a landed body stays loaded for the
     session, and the fingerprint scan keeps later sweeps
     free. */
  const gateOpen = !!(state.selectedId && state.notes.some(
    function (n) { return n.id === state.selectedId; }));
  state.notes.forEach(function (note) {
    if (note.bodyLoaded === false) {
      if (!gateOpen) { return; }
      if (backlinkLoadKicked.has(note.id)) { return; }
      backlinkLoadKicked.add(note.id);
      const kickedId = note.id;
      ensureNoteBodyLoaded(note).then(function () {
        backlinkLoadKicked.delete(kickedId);
        const fresh = state.notes.find(function (n) {
          return n.id === kickedId;
        });
        if (!fresh || fresh.bodyLoaded === false) { return; }
        scanNoteIntoLinkGraph(fresh);
        refreshBacklinksPanel();
      });
      return;
    }
    scanNoteIntoLinkGraph(note);
  });
}

/* The open note's backlinks as the panel shows them: one
   entry per LIVE source note linking to it, the note itself
   excluded, sorted by the source's current title (a rename
   is just the note object's title, read fresh here, so
   entries always speak in current names). */
function backlinkEntriesFor(noteId) {
  const entries = [];
  if (!noteId) { return entries; }
  state.notes.forEach(function (src) {
    if (src.id === noteId) { return; }
    const targets = backlinkGraphBySource.get(src.id);
    if (targets && targets.has(noteId)) {
      entries.push({ sourceId: src.id,
        title: src.title || "Untitled note",
        snippet: targets.get(noteId) || "" });
    }
  });
  entries.sort(function (a, b) {
    const fa = a.title.toLowerCase(), fb = b.title.toLowerCase();
    if (fa !== fb) { return fa < fb ? -1 : 1; }
    if (a.title !== b.title) { return a.title < b.title ? -1 : 1; }
    return a.sourceId < b.sourceId ? -1 :
      (a.sourceId > b.sourceId ? 1 : 0);
  });
  return entries;
}

/* What the bar would show for a note, as one string: the
   refresh paths compare it against what is on screen and
   leave the DOM alone when nothing moved. */
function backlinkPanelSignature(note) {
  if (!note) { return ""; }
  return note.id + "|" + backlinkEntriesFor(note.id)
    .map(function (e) { return e.sourceId + ":" + e.title; })
    .join(",");
}

/* Render the open note's backlinks bar (the #backlinksBar
   furniture in .editor-inner). Called at the end of every
   editor render of a loaded note; the graph sweep runs
   first, so a body that changed since its last scan is
   folded in before entries are read. The bar hides entirely
   when the count is zero, like Evernote's button, which
   only exists on a note something links to. */
function renderBacklinks() {
  const bar = document.getElementById("backlinksBar");
  if (!bar) { return; }
  refreshBacklinkGraph();
  const note = currentNote();
  if (!note) {
    bar.classList.add("hidden");
    backlinksForId = null;
    backlinksRenderedSig = "";
    return;
  }
  if (backlinksForId !== note.id) {
    backlinksForId = note.id;
    backlinksOpen = false;
  }
  const entries = backlinkEntriesFor(note.id);
  backlinksRenderedSig = backlinkPanelSignature(note);
  if (!entries.length) {
    bar.classList.add("hidden");
    return;
  }
  bar.classList.remove("hidden");
  document.getElementById("backlinksCount").textContent =
    String(entries.length);
  const toggle = document.getElementById("backlinksToggle");
  toggle.setAttribute("aria-expanded",
    backlinksOpen ? "true" : "false");
  const list = document.getElementById("backlinksList");
  list.classList.toggle("hidden", !backlinksOpen);
  list.innerHTML = "";
  entries.forEach(function (entry) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "backlink-entry";
    item.setAttribute("role", "listitem");
    item.setAttribute("data-source-id", entry.sourceId);
    const title = document.createElement("span");
    title.className = "backlink-entry-title";
    title.textContent = entry.title;
    item.appendChild(title);
    if (entry.snippet) {
      const snip = document.createElement("span");
      snip.className = "backlink-entry-snippet";
      snip.textContent = entry.snippet;
      item.appendChild(snip);
    }
    item.addEventListener("click", function () {
      followNoteLink(entry.sourceId);
    });
    list.appendChild(item);
  });
}

/* The refresh other renders call (the list render, a sync's
   tail): sweep the graph, then re-render the bar only when
   what it would show actually changed, so a keystroke of
   list churn never rebuilds a settled bar. */
function refreshBacklinksPanel() {
  refreshBacklinkGraph();
  if (backlinkPanelSignature(currentNote()) !==
      backlinksRenderedSig) {
    renderBacklinks();
  }
}

/* ----- v2.28.0: task links (sstask:) ------------------------------
   A task link is an ordinary anchor whose href is
   "sstask:<taskId>" and whose class is ss-task-link. It is
   inserted by the note host's "@" popup (insertMentionTaskLink)
   and by hand in any imported body. It is decoration free by
   design: no link face, no link bar, no hover card, and no
   Microlink fetch ever (see the guards in decorateLinkViews'
   companion pass, decorateLinkTooltips, and linkBarAnchorFor);
   its whole link UI is its click, which opens the task's
   editor over the note. This pass, run beside the link
   decoration passes on every render, keeps its label honest:
   the title attribute always names the task's current title,
   and anchor text that merely repeats the title it was saved
   with (a title derived label, judged the way the note link
   faces judge theirs) follows a rename; words the user chose
   stay theirs. A link whose task is gone is retitled and
   muted by the ss-task-link-missing class. */
const SSTASK_HREF_PREFIX = "sstask:";

/* The task id a task link points at, or null when the anchor
   is not a task link. Reads the RAW href attribute, like
   noteLinkIdOf, for the same reason. */
function taskLinkIdOf(anchor) {
  if (!anchor || !anchor.getAttribute) { return null; }
  const href = anchor.getAttribute("href") || "";
  if (href.indexOf(SSTASK_HREF_PREFIX) !== 0) { return null; }
  const id = href.slice(SSTASK_HREF_PREFIX.length).trim();
  return id ? id : null;
}

/* Follow a task link: the task's editor opens over the note
   in front of the user. The view and the open note are
   untouched, so closing the editor returns to both; a task
   that no longer exists says so plainly. */
function followTaskLink(taskId) {
  const task = findTaskById(taskId);
  if (!task) {
    toast("That task no longer exists.", true);
    return;
  }
  openTaskEditor(task.id);
}

function decorateTaskLinks(rootEl) {
  if (!rootEl || !rootEl.querySelectorAll) { return; }
  rootEl.querySelectorAll("a[href^=\"sstask:\"]")
    .forEach(function (anchor) {
      const task = findTaskById(taskLinkIdOf(anchor) || "");
      if (!task) {
        anchor.setAttribute("title", "Task no longer exists");
        anchor.classList.add("ss-task-link-missing");
        return;
      }
      anchor.classList.remove("ss-task-link-missing");
      const current = task.title || "Untitled task";
      const saved = anchor.getAttribute("title");
      if (saved !== null && anchor.textContent === saved) {
        anchor.textContent = current;
      }
      anchor.setAttribute("title", current);
    });
}

/* v2.116: the chip HTML the mention inserter produces
   for a task (insertMentionTaskLink): the anchor exactly
   as the inserter builds one, attribute for attribute
   (the sstask: href, the ss-task-link class, the title
   tooltip), its text the task's title. Task links are
   born plain and are never faced (see decorateLinkView),
   so this bare anchor IS the chip's whole shape, and a
   paste of it is indistinguishable from the picker's
   plant once the paste path's decoration runs
   decorateTaskLinks over it like the inserter does. */
function taskLinkChipHtml(task) {
  const title = escapeHtml(task.title || "Untitled task");
  return "<a href=\"" + SSTASK_HREF_PREFIX + task.id +
    "\" class=\"ss-task-link\" title=\"" + title +
    "\">" + title + "</a>";
}

/* v2.116: Copy link for one task (the task row menu's
   item, the menu itself new in this release: task rows
   had no menu of their own before it). The clipboard
   carries the task chip beside the task's title as
   plain text, through the one honest fallback helper
   every Copy link item shares. */
function copyLinkForTask(task) {
  if (!task) { return; }
  copyChipLink(taskLinkChipHtml(task),
    task.title || "Untitled task");
}

/* ----- v2.17: the Tags field picker ---------------------------------
   Focusing (or clicking into) the editor footer's Tags field
   opens a dropdown of the tags already in use across the live
   notes, so an existing tag can be picked instead of retyped
   (and mistyped). The field keeps its plain text behavior:
   typing still works exactly as before, and typing filters the
   list by the token under way (the text after the last comma).
   Tags already complete in the field are not offered again. A
   pick replaces the token with the tag plus the standard ", "
   separator and marks the note dirty through the field's normal
   save path; the dropdown stays open after a pick, its list
   refreshed, and it closes on Escape, on a mousedown anywhere
   outside it and the field, and when nothing is left to offer.
   Read only notes never see it: their field is disabled, and a
   disabled field never opens the picker. The element lives in
   the editor footer, outside #noteBody, so nothing of it can be
   saved into a note. */

function tagPickerOpen() {
  const picker = document.getElementById("tagPicker");
  return !!picker && !picker.classList.contains("hidden");
}

function closeTagPicker() {
  const picker = document.getElementById("tagPicker");
  if (picker) { picker.classList.add("hidden"); }
}

/* Every tag in use on a live note, deduplicated case insensitively
   (the first spelling seen wins) and sorted alphabetically. */
function knownTags() {
  const seen = new Map();
  (state.notes || []).forEach(function (note) {
    (note.tags || []).forEach(function (tag) {
      const key = String(tag).toLowerCase();
      if (!seen.has(key)) { seen.set(key, String(tag)); }
    });
  });
  return Array.from(seen.values()).sort(function (a, b) {
    return a.toLowerCase().localeCompare(b.toLowerCase());
  });
}

/* The field split at its last comma: the tags already complete
   (everything before the last comma) and the token being typed
   (everything after it). */
function tagFieldParts() {
  const input = document.getElementById("noteTags");
  const value = input ? input.value : "";
  const cut = value.lastIndexOf(",");
  const head = cut >= 0 ? value.slice(0, cut) : "";
  const token = (cut >= 0 ? value.slice(cut + 1) : value).trim();
  const complete = head.split(",").map(function (t) { return t.trim(); })
    .filter(function (t) { return t.length > 0; });
  return { complete: complete, token: token };
}

/* The tags on offer right now: the known tags, minus the ones
   already complete in the field, filtered by the token (a
   case insensitive substring match, like the mention popup's). */
function tagSuggestions() {
  const parts = tagFieldParts();
  const done = parts.complete.map(function (t) { return t.toLowerCase(); });
  const needle = parts.token.toLowerCase();
  return knownTags().filter(function (tag) {
    if (done.indexOf(tag.toLowerCase()) >= 0) { return false; }
    if (needle && tag.toLowerCase().indexOf(needle) < 0) { return false; }
    return true;
  });
}

function renderTagPicker() {
  const picker = document.getElementById("tagPicker");
  const input = document.getElementById("noteTags");
  if (!picker || !input) { return; }
  if (input.disabled) { closeTagPicker(); return; }
  let suggestions = tagSuggestions();
  if (!suggestions.length) { closeTagPicker(); return; }
  /* v2.30: with an empty token the picker offers the tags in
     tree order, each row indented by its depth, the way
     Evernote's tag chooser shows the hierarchy it nests.
     While a token is being typed the list stays the flat
     filtered list it has always been: a partial name is a
     search, not a browse. */
  const showTree = !tagFieldParts().token;
  const depthOf = {};
  if (showTree) {
    const known = knownTags();
    const entries = known.map(function (t) {
      return { tag: t, count: 1 };
    });
    const order = {};
    tagTreeRows(entries, false).forEach(function (row, i) {
      order[row.tag] = i;
      depthOf[row.tag] = row.depth;
    });
    suggestions = suggestions.slice().sort(function (a, b) {
      const oa = (a in order) ? order[a] : 9999;
      const ob = (b in order) ? order[b] : 9999;
      return oa - ob;
    });
  }
  picker.innerHTML = "";
  suggestions.forEach(function (tag) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "tag-picker-row";
    row.setAttribute("role", "option");
    row.setAttribute("data-tag", tag);
    if (showTree) {
      row.style.paddingLeft = (10 + (depthOf[tag] || 0) * 16) + "px";
    }
    row.textContent = tag;
    picker.appendChild(row);
  });
  picker.classList.remove("hidden");
}

function openTagPicker() {
  const input = document.getElementById("noteTags");
  if (!input || input.disabled) { return; }
  renderTagPicker();
}

/* A pick: the token in the field is replaced by the chosen tag,
   followed by the standard separator, so the next token starts
   empty and the picker can immediately offer what remains. The
   caret lands after the separator, focus stays in the field,
   and the note is marked dirty so the change saves. */
function pickTag(tag) {
  const input = document.getElementById("noteTags");
  if (!input) { return; }
  const parts = tagFieldParts();
  const head = parts.complete.length ? parts.complete.join(", ") + ", " : "";
  input.value = head + tag + ", ";
  const end = input.value.length;
  try { input.setSelectionRange(end, end); } catch (err) { /* older engines */ }
  input.focus();
  markDirty();
  renderTagPicker();
}

/* ----- v2.12: the "@" note popup ---------------------------------------
   Typing "@" in a note opens a Results card under the caret, the
   interaction in Chris's screenshot: a Create new note row
   carrying the typed text, then the notes whose titles match what
   follows the "@", most recently updated first. Enter, Tab, or a
   click replaces the "@query" with a note link (born in Mention
   view, like every new note link since this version) and a
   trailing space; Create new note makes the note first, in the
   notebook of the note being edited, without leaving it.

   The token rule: the "@" starts a token when it is the first
   character of its text node or follows whitespace, and the query
   is the run of non-whitespace characters between it and the
   caret (possibly empty). The popup never opens with the caret in
   a code block (a pre element), in an attachment placeholder, in
   an existing link, or in a locked (Trash or Archive) note, and it
   closes when the pattern breaks: a space after the "@", the "@"
   deleted, or the caret moved out of the token.

   The card itself is #mentionPopup. It is written beside
   #noteBody in the markup, but wireEvents moves it to the top
   level of the page at startup, so no pane state (a hidden
   #editorWrap in the Tasks view, above all) can hide it; it is
   position fixed, and nothing of it can ever be saved into a
   note. v2.17: a search
   box (#mentionSearch) sits pinned at the card's top: the typed
   query mirrors into it, and typing in the box filters the same
   list (the box then drives until a fresh "@" token takes over
   again); the chrome is built once and only the rows rebuild,
   so the box keeps focus across re-renders, and Escape returns
   focus and caret to the editor. Its keys are taken
   in a capture phase document listener (see wireEvents), so while
   it is open, Enter and Tab belong to it and never reach the
   editor's own Enter and Tab handling (checklist Enter, table and
   list Tab) underneath. */

let mentionTrigger = null;
let mentionRows = [];
let mentionHighlight = 0;
let mentionLastQuery = null;
let mentionLastNode = null;
/* v2.17: the popup's search box state. mentionBoxQuery is null
   while the editor token drives the filter, and the box's own
   text once the user types in the box; mentionListEl is the
   popup's persistent list container (the chrome, search box
   included, is built once and only the rows are rebuilt, so
   the box never loses focus to a re-render); mentionLastRange
   remembers the caret range the popup was positioned from. */
let mentionBoxQuery = null;
let mentionListEl = null;
let mentionLastRange = null;
/* v2.28.0: the popup's host: "note" (the note body) or
   "task" (the task editor's description field). The
   tracker sets it from the editor the caret is in on
   every run; the trigger also records it, so a pick
   lands in the editor the user was typing in.
   v2.105.0: a third host, "scratch" (the Home Scratch
   Pad): notes and mail both serve it, tasks never
   (they are the note host's alone, as the description
   host taught), and its picks persist the pad instead
   of marking a note dirty. */
let mentionHost = "note";
/* v2.84: the popup's mode, "notes" as it has
   always been, or "email" while a "@@" token
   drives it (Part 8). The mail search is
   debounced like the event picker's, and its
   run counter keeps a stale answer from
   overwriting a newer ask. */
let mentionMode = "notes";
let mentionMailTimer = null;
let mentionMailRun = 0;
const MENTION_MAIL_ICON =
  "<svg viewBox=\"0 0 24 24\" width=\"16\" height=\"16\" fill=\"none\" " +
  "stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" " +
  "stroke-linejoin=\"round\"><rect x=\"3\" y=\"5\" width=\"18\" " +
  "height=\"14\" rx=\"2\"/><path d=\"M3.5 7l8.5 6 8.5-6\"/></svg>";

/* Ask the mail search for the standing query and
   paint what comes back, unless a newer ask has
   superseded this one, the popup has closed, or
   it has flipped back to notes. The standing
   states paint as one quiet row the picker cannot
   pick: the search running, the consent word, an
   empty answer, a failed ask. */
function scheduleMentionMailSearch() {
  if (mentionMailTimer) {
    clearTimeout(mentionMailTimer);
  }
  mentionMailTimer = setTimeout(function () {
    mentionMailTimer = null;
    runMentionMailSearch();
  }, 200);
}

function runMentionMailSearch() {
  const query = mentionEffectiveQuery();
  const run = ++mentionMailRun;
  /* The ask starts before the loading row
     paints, so a paint that cannot complete
     (a range with no geometry, in a harness or
     an odd browser) can never strand the search
     it announces. */
  const asked = mentionMailSearch(query);
  mentionRows = [{ kind: "mailstatus",
    text: "Loading..." }];
  mentionHighlight = 0;
  renderMentionPopup(null);
  asked.then(function (out) {
    if (run !== mentionMailRun ||
        !mentionPopupOpen() ||
        mentionMode !== "email") { return; }
    if (out.outcome === "consent") {
      mentionRows = [{ kind: "mailstatus",
        text: "Gmail is not connected" }];
    } else if (out.outcome === "ok") {
      mentionRows = out.rows.map(function (rec) {
        return { kind: "mailmsg", rec: rec };
      });
      if (!mentionRows.length) {
        mentionRows = [{ kind: "mailstatus",
          text: "No matching mail" }];
      }
    } else {
      mentionRows = [{ kind: "mailstatus",
        text: "Could not search mail" }];
    }
    mentionHighlight = 0;
    renderMentionPopup(null);
  });
}

const MENTION_NOTE_ICON =
  "<svg viewBox=\"0 0 24 24\" width=\"16\" height=\"16\" fill=\"none\" " +
  "stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" " +
  "stroke-linejoin=\"round\"><path d=\"M7 3h7l4 4v13a1 1 0 0 1-1 1H7" +
  "a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z\"/><path d=\"M14 3v4h4\"/></svg>";
const MENTION_CREATE_ICON =
  "<svg viewBox=\"0 0 24 24\" width=\"16\" height=\"16\" fill=\"none\" " +
  "stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" " +
  "stroke-linejoin=\"round\"><path d=\"M7 3h7l4 4v13a1 1 0 0 1-1 1H7" +
  "a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z\"/><path d=\"M14 3v4h4\"/>" +
  "<path d=\"M12 12v6M9 15h6\"/></svg>";
const MENTION_ENTER_ICON =
  "<svg viewBox=\"0 0 24 24\" width=\"14\" height=\"14\" fill=\"none\" " +
  "stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" " +
  "stroke-linejoin=\"round\"><path d=\"M9 10l-5 5 5 5\"/>" +
  "<path d=\"M4 15h11a5 5 0 0 0 5-5V4\"/></svg>";
/* v2.28.0: a task row's icon in the popup: the checkbox
   square, drawn the way the task link's own ::before
   square reads in the note body. */
const MENTION_TASK_ICON =
  "<svg viewBox=\"0 0 24 24\" width=\"16\" height=\"16\" fill=\"none\" " +
  "stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" " +
  "stroke-linejoin=\"round\"><rect x=\"4\" y=\"4\" width=\"16\" " +
  "height=\"16\" rx=\"3\"/><path d=\"M8.5 12.5l2.5 2.5 4.5-5.5\"/></svg>";

function mentionPopupOpen() {
  const popup = document.getElementById("mentionPopup");
  return !!popup && !popup.classList.contains("hidden");
}

function closeMentionPopup() {
  const popup = document.getElementById("mentionPopup");
  if (popup) {
    popup.classList.add("hidden");
    /* v2.28.1: the task host's raised dress comes off
       with the close, so a later note host open can
       never inherit it. */
    popup.classList.remove("mention-in-task");
  }
  mentionTrigger = null;
  mentionRows = [];
  mentionHighlight = 0;
  mentionLastQuery = null;
  mentionLastNode = null;
  mentionBoxQuery = null;
  mentionLastRange = null;
  mentionMode = "notes";
  mentionMailRun++;
  if (mentionMailTimer) {
    clearTimeout(mentionMailTimer);
    mentionMailTimer = null;
  }
  const searchEl = mentionSearchEl();
  if (searchEl) { searchEl.value = ""; }
}

function mentionSearchEl() {
  return document.getElementById("mentionSearch");
}

/* The query the list is filtered by: the search box's own text
   once the user has typed in it, otherwise the "@" token's. */
function mentionEffectiveQuery() {
  if (mentionBoxQuery !== null) { return mentionBoxQuery; }
  return mentionTrigger ? mentionTrigger.query : "";
}

function resetMentionHighlight() {
  mentionHighlight = mentionRows.findIndex(function (row) {
    return row.kind === "note" ||
      row.kind === "mailmsg";
  });
  if (mentionHighlight < 0) { mentionHighlight = 0; }
}

/* The popup's fixed chrome, built once: the search box pinned at
   the top (v2.17), the Results header, and the list container.
   Only the rows are rebuilt per render, so the search box is
   never recreated under the user's fingers. */
function ensureMentionChrome(popup) {
  if (mentionListEl && popup.contains(mentionListEl)) { return; }
  popup.innerHTML = "";
  const searchWrap = document.createElement("div");
  searchWrap.className = "mention-search";
  const input = document.createElement("input");
  input.type = "text";
  input.id = "mentionSearch";
  input.placeholder = "Search notes";
  input.setAttribute("aria-label", "Search notes");
  input.setAttribute("autocomplete", "off");
  input.addEventListener("input", onMentionSearchInput);
  searchWrap.appendChild(input);
  popup.appendChild(searchWrap);
  const head = document.createElement("div");
  head.className = "mention-head";
  head.id = "mentionHead";
  head.textContent = "Results";
  popup.appendChild(head);
  mentionListEl = document.createElement("div");
  mentionListEl.className = "mention-list";
  popup.appendChild(mentionListEl);
}

/* Typing in the popup's search box filters the same candidate
   list the "@" token filters; the editor token (and so the
   insertion point) is untouched, and the highlight restarts on
   the first note row, exactly as a changed token query does. */
function onMentionSearchInput() {
  const input = mentionSearchEl();
  if (!input) { return; }
  mentionBoxQuery = input.value;
  if (mentionMode === "email") {
    scheduleMentionMailSearch();
    return;
  }
  mentionRows = mentionCandidates(mentionBoxQuery);
  resetMentionHighlight();
  renderMentionPopup(null);
}

/* The rows for one query: the Create row first (only while a query
   is typed), then up to eight matching notes. A note matches when
   its title, lowercased, contains the query, lowercased; an
   untitled note's title is empty, and an empty string contains
   only the empty query, so untitled notes surface only while
   nothing has been typed past the "@" and never flood filtered
   results. Trashed notes never match. v2.109.0: archived
   notes no longer match either (Chris's instruction): the
   picker offers live notes only, in every host it serves.
   v2.28.0: in the note host, up to eight matching tasks follow
   the notes (the same title match, most recently updated
   first), and the renderer splits the two kinds with group
   labels when both are present. v2.28.2: completed tasks are
   excluded from those matches, on Chris's instruction; task
   links already saved in notes are unaffected. The task
   description host never lists tasks: a description links to
   notes, and notes are where task links live. */
function mentionCandidates(query) {
  const needle = String(query || "").toLowerCase();
  const matches = state.notes.filter(function (note) {
    if (note.trashed || note.archived) { return false; }
    return (note.title || "").toLowerCase().indexOf(needle) >= 0;
  }).slice().sort(function (a, b) {
    return String(b.updated || "").localeCompare(String(a.updated || ""));
  }).slice(0, 8);
  const rows = [];
  if (query) { rows.push({ kind: "create" }); }
  matches.forEach(function (note) {
    rows.push({ kind: "note", note: note });
  });
  if (mentionHost === "note") {
    const taskMatches = state.tasks.filter(function (task) {
      /* v2.28.2: completed tasks are never offered, on
         Chris's instruction: the list is for linking work
         still in play. Links to a completed task already
         saved in a note are untouched by this: they still
         decorate, follow renames, and open the task. */
      if (task.status === "completed") { return false; }
      return (task.title || "").toLowerCase().indexOf(needle) >= 0;
    }).slice().sort(function (a, b) {
      return String(b.updated || "").localeCompare(String(a.updated || ""));
    }).slice(0, 8);
    taskMatches.forEach(function (task) {
      rows.push({ kind: "task", task: task });
    });
  }
  return rows;
}

/* The tracker: run on the body's input events and on document
   selection changes, so typing, deleting, and caret moves all
   re-evaluate the token under the caret. Anything that is not a
   live "@" token closes the popup. */
function updateMentionPopup() {
  const popup = document.getElementById("mentionPopup");
  if (!popup) { return; }
  /* v2.17: while the popup's search box holds focus, the box
     drives the list through its own input listener and this
     tracker stands down: the document selection no longer
     describes the editor caret, and judging the token by it
     would close the popup out from under the search. */
  const searchEl = mentionSearchEl();
  if (mentionPopupOpen() && searchEl && document.activeElement === searchEl) {
    return;
  }
  const bodyEl = document.getElementById("noteBody");
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) { closeMentionPopup(); return; }
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  /* v2.28.0: the host is the editor the caret is actually
     in. The task description host is live only while its
     modal is open (and the popup can never outlive the
     modal: closeTaskEditor closes it too); the note host
     keeps every guard it has always had, a live unlocked
     note and the caret inside its body. */
  const descEl = document.getElementById("taskDescInput");
  const taskModalEl = document.getElementById("taskModal");
  let hostEl = null;
  if (descEl && taskModalEl && taskEditorState &&
      !taskModalEl.classList.contains("hidden") &&
      node && descEl.contains(node)) {
    mentionHost = "task";
    hostEl = descEl;
  } else if (node && scratchPadEl() &&
      scratchPadEl().contains(node)) {
    /* v2.105.0: the Scratch Pad host: the caret stands
       in the pad, and no note need stand behind it. */
    mentionHost = "scratch";
    hostEl = scratchPadEl();
  } else {
    const note = currentNote();
    if (!note || note.trashed || note.archived || !bodyEl ||
        bodyEl.contentEditable === "false") {
      closeMentionPopup();
      return;
    }
    mentionHost = "note";
    hostEl = bodyEl;
  }
  if (!range.collapsed || !node || node.nodeType !== 3 ||
      !hostEl.contains(node)) {
    closeMentionPopup();
    return;
  }
  const host = node.parentElement;
  if (!host || (host.closest &&
      host.closest("pre, a, .ss-attachment"))) {
    closeMentionPopup();
    return;
  }
  const before = node.nodeValue.slice(0, range.startOffset);
  const at = before.lastIndexOf("@");
  if (at < 0) { closeMentionPopup(); return; }
  /* v2.84: a doubled "@@" in the note host is the
     email token (Part 8): the pair starts a token
     when what stands before the pair is the start
     of the node or whitespace, the single "@" rule
     read off the pair, and the trigger records
     where the PAIR starts so a pick replaces both
     characters. Backspacing back to one "@"
     flips the same popup back to notes. */
  let tokStart = at;
  let tokMode = "notes";
  if (mentionHost !== "task" && at > 0 &&
      before.charAt(at - 1) === "@") {
    const pairStart = at - 1;
    if (pairStart === 0 ||
        /\s/.test(before.charAt(pairStart - 1))) {
      tokStart = pairStart;
      tokMode = "email";
    }
  }
  if (tokMode === "notes" && at > 0 &&
      !/\s/.test(before.charAt(at - 1))) {
    closeMentionPopup();
    return;
  }
  const query = before.slice(at + 1);
  if (/\s/.test(query)) { closeMentionPopup(); return; }
  mentionTrigger = {
    node: node, atOffset: tokStart,
    caretOffset: range.startOffset,
    query: query, host: mentionHost
  };
  /* v2.84: the mode the token stood in before this
     pass: a flip into Email mode must search even
     when the query text is unchanged (typing the
     second "@" leaves the query empty, exactly
     what the single "@" had already recorded, and
     judging the flip by the query alone would
     leave the notes rows standing under an Email
     head, unsearched). */
  const prevMentionMode = mentionMode;
  mentionMode = tokMode;
  if (tokMode === "email") {
    if (query !== mentionLastQuery ||
        node !== mentionLastNode ||
        prevMentionMode !== "email") {
      mentionLastQuery = query;
      mentionLastNode = node;
      mentionBoxQuery = null;
      mentionHighlight = 0;
      scheduleMentionMailSearch();
    }
    renderMentionPopup(range);
    return;
  }
  mentionRows = mentionCandidates(query);
  if (!mentionRows.length) { closeMentionPopup(); return; }
  if (query !== mentionLastQuery || node !== mentionLastNode) {
    mentionLastQuery = query;
    mentionLastNode = node;
    /* A fresh token query hands the filter back to the editor:
       any text the search box was driving with is superseded,
       and the box mirrors the token again. */
    mentionBoxQuery = null;
    /* The highlight starts on the first matching note, the row the
       screenshot shows carrying "enter to add"; with no match it
       starts on the Create row, the only row there is. It resets
       when the query changes or the token under the caret is a new
       one (a different text node), never while the same token
       stands still. */
    resetMentionHighlight();
  }
  renderMentionPopup(range);
}

function renderMentionPopup(range) {
  const popup = document.getElementById("mentionPopup");
  if (!popup) { return; }
  ensureMentionChrome(popup);
  if (range) { mentionLastRange = range; }
  /* The search box mirrors the effective query, except while it
     itself holds focus (its own text is then the query, and
     rewriting it mid typing would fight the user's caret). */
  const searchEl = mentionSearchEl();
  if (searchEl && document.activeElement !== searchEl) {
    searchEl.value = mentionEffectiveQuery();
  }
  const list = mentionListEl;
  list.innerHTML = "";
  /* v2.28.0: the search box names what this host finds:
     notes alone in the description editor, notes and
     tasks in a note. */
  if (searchEl) {
    searchEl.placeholder = mentionMode === "email"
      ? "Search mail"
      : mentionHost === "note"
      ? "Search notes and tasks" : "Search notes";
    searchEl.setAttribute("aria-label", searchEl.placeholder);
  }
  /* v2.84: the card's head names its mode (Email
     while a "@@" token drives it). */
  const headEl = document.getElementById("mentionHead");
  if (headEl) {
    headEl.textContent = mentionMode === "email"
      ? "Email" : "Results";
  }
  /* v2.28.0: when the rows carry both kinds, a quiet group
     label splits them. Labels are not rows (no data-mi),
     so the highlight, the keyboard walk, and the click
     routing only ever see selectable rows. */
  const hasNotes = mentionRows.some(function (r) {
    return r.kind === "note";
  });
  const hasTasks = mentionRows.some(function (r) {
    return r.kind === "task";
  });
  let noteLabelShown = false, taskLabelShown = false;
  function groupLabel(txt) {
    const el = document.createElement("div");
    el.className = "mention-group-label";
    el.textContent = txt;
    list.appendChild(el);
  }
  mentionRows.forEach(function (row, i) {
    if (hasNotes && hasTasks && row.kind === "note" &&
        !noteLabelShown) {
      groupLabel("Notes");
      noteLabelShown = true;
    }
    if (hasNotes && hasTasks && row.kind === "task" &&
        !taskLabelShown) {
      groupLabel("Tasks");
      taskLabelShown = true;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mention-row" +
      (row.kind === "create" ? " mention-create" : "");
    btn.setAttribute("data-mi", String(i));
    btn.setAttribute("role", "option");
    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = row.kind === "create" ?
      MENTION_CREATE_ICON : row.kind === "task" ?
      MENTION_TASK_ICON : row.kind === "mailmsg" ?
      MENTION_MAIL_ICON : MENTION_NOTE_ICON;
    btn.appendChild(icon);
    const texts = document.createElement("span");
    texts.className = "mention-texts";
    const line1 = document.createElement("span");
    line1.className = "mention-title";
    const line2 = document.createElement("span");
    if (row.kind === "mailstatus") {
      line1.textContent = row.text;
      line2.className = "mention-nb";
      line2.textContent = "";
    } else if (row.kind === "mailmsg") {
      line1.textContent = row.rec.subject ||
        "(No subject)";
      line2.className = "mention-nb";
      /* v2.105.0: the row's second line carries where
         the message stands and what it wears, after
         the sender: the location (Inbox when it
         carries INBOX, All Mail otherwise) and the
         user labels' names, read off the record's
         standing label ids through the label list. */
      const mailBits = [];
      const mailSender = row.rec.fromName ||
        row.rec.fromAddress || "";
      if (mailSender) { mailBits.push(mailSender); }
      mailBits.push(row.rec.labelIds &&
        row.rec.labelIds.indexOf("INBOX") !== -1
        ? "Inbox" : "All Mail");
      const mailNames = mailRowLabelNames(row.rec);
      if (mailNames.length) {
        mailBits.push(mailNames.join(", "));
      }
      line2.textContent = mailBits.join(" \u00b7 ");
    } else if (row.kind === "create") {
      line1.textContent = mentionEffectiveQuery();
      line2.className = "mention-create-sub";
      line2.textContent = "Create new note";
    } else if (row.kind === "task") {
      line1.textContent = row.task.title || "Untitled task";
      line2.className = "mention-nb";
      let sub = "Task · " +
        notebookNameForSlug(row.task.notebook);
      if (row.task.status === "completed") {
        sub += " · Completed";
      } else {
        const chip = taskDueChip(row.task);
        if (chip) { sub += " · " + chip.text; }
      }
      line2.textContent = sub;
    } else {
      line1.textContent = row.note.title || "Untitled note";
      line2.className = "mention-nb";
      line2.textContent = notebookNameForNote(row.note);
    }
    texts.appendChild(line1);
    texts.appendChild(line2);
    btn.appendChild(texts);
    list.appendChild(btn);
  });
  /* v2.28.1: in the task description host the card must
     paint above the task modal (see the stylesheet's
     mention-in-task rule); in the note host it keeps
     its base layer. The toggle runs on every render,
     so the dress always matches the serving host. */
  popup.classList.toggle("mention-in-task",
    mentionHost === "task");
  popup.classList.remove("hidden");
  setMentionHighlight(mentionHighlight);
  positionMentionPopup(range || mentionLastRange);
}

/* Park the card under the caret's line, flipped above it when the
   line sits too near the window's bottom, the way the app's other
   fixed cards clamp into the viewport. */
function positionMentionPopup(range) {
  const popup = document.getElementById("mentionPopup");
  /* v2.84: the link popup positioner's guard, here
     too: a range with no geometry (a harness's, or
     an odd browser's) parks nothing instead of
     throwing through the render it closes. */
  if (!popup || !range ||
      typeof range.getBoundingClientRect !==
        "function") { return; }
  const rect = range.getBoundingClientRect();
  const width = popup.offsetWidth;
  const height = popup.offsetHeight;
  let left = Math.min(rect.left, window.innerWidth - width - 8);
  left = Math.max(8, left);
  let top = rect.bottom + 6;
  if (top + height > window.innerHeight - 8) {
    top = Math.max(8, rect.top - height - 6);
  }
  popup.style.left = left + "px";
  popup.style.top = top + "px";
}

function setMentionHighlight(i) {
  const popup = document.getElementById("mentionPopup");
  if (!popup || !mentionRows.length) { return; }
  mentionHighlight = ((i % mentionRows.length) + mentionRows.length) %
    mentionRows.length;
  popup.querySelectorAll(".mention-row").forEach(function (rowEl) {
    const mine = Number(rowEl.getAttribute("data-mi")) === mentionHighlight;
    rowEl.classList.toggle("current", mine);
    const old = rowEl.querySelector(".mention-hint");
    if (old) { old.remove(); }
    if (mine && mentionRows[mentionHighlight] &&
        mentionRows[mentionHighlight].kind !==
          "mailstatus") {
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

/* Replace the tracked "@query" with a note link to the target and
   a trailing space, the caret landing after the space. The link is
   built exactly as the Link to Note picker builds one, plus the
   Mention mode every new note link is born with since v2.12, and
   the render decoration passes run over the body so the Mention
   face shows at once rather than on the next open. */
function insertMentionNoteLink(target) {
  const trig = mentionTrigger;
  /* v2.28.0: the anchor lands in the host the token was
     tracked in: the note body, or the task description
     editor while its modal is open. v2.105.0: or the
     Scratch Pad, whose aftercare is the pad persist
     below instead of a note's dirty flag. */
  const bodyEl = trig && trig.host === "task"
    ? document.getElementById("taskDescInput")
    : trig && trig.host === "scratch"
    ? scratchPadEl()
    : document.getElementById("noteBody");
  closeMentionPopup();
  if (!trig || !bodyEl || !bodyEl.contains(trig.node)) { return; }
  const anchor = document.createElement("a");
  anchor.setAttribute("href", SSNOTE_HREF_PREFIX + target.id);
  anchor.setAttribute("class", "ss-note-link");
  anchor.setAttribute("title", target.title || "Untitled note");
  anchor.setAttribute("data-ss-link-view", "mention");
  anchor.textContent = target.title || "Untitled note";
  const end = Math.min(trig.caretOffset,
    trig.node.nodeValue ? trig.node.nodeValue.length : 0);
  const range = document.createRange();
  range.setStart(trig.node, trig.atOffset);
  range.setEnd(trig.node, end);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  range.deleteContents();
  range.insertNode(anchor);
  const space = document.createTextNode(" ");
  anchor.after(space);
  placeCaretIn(space, 1);
  if (trig.host === "task") {
    /* The description editor holds its anchors plain
       (no link faces live in a task), and the task
       editor's own dirty flag is the one that moved. */
    markTaskEditorDirty();
  } else if (trig.host === "scratch") {
    decorateLinkTooltips(bodyEl);
    decorateLinkViews(bodyEl);
    persistScratchPadFromDom();
  } else {
    decorateLinkTooltips(bodyEl);
    decorateLinkViews(bodyEl);
    markDirty();
  }
}

/* Create the note the Create row promises: the query as its title,
   in the notebook of the note being edited (the first notebook
   when that somehow resolves to nothing). The instant create
   pattern of createNoteInRepo, minus the navigation: the note is
   in state and cache at once, the list re-renders, and the
   storage write runs in the background with the same failure
   wording. The note being edited stays open throughout. */
/* v2.28.0: replace the tracked "@query" with a task link
   to the target, the note host's second kind of pick.
   The anchor is born plain (class ss-task-link, its text
   and its title the task's current title), and
   decorateTaskLinks runs over the body at once so the
   link shows in its final form rather than on the next
   open. */
function insertMentionTaskLink(target) {
  const trig = mentionTrigger;
  const bodyEl = document.getElementById("noteBody");
  closeMentionPopup();
  if (!trig || !bodyEl || !bodyEl.contains(trig.node)) { return; }
  const anchor = document.createElement("a");
  anchor.setAttribute("href", SSTASK_HREF_PREFIX + target.id);
  anchor.setAttribute("class", "ss-task-link");
  anchor.setAttribute("title", target.title || "Untitled task");
  anchor.textContent = target.title || "Untitled task";
  const end = Math.min(trig.caretOffset,
    trig.node.nodeValue ? trig.node.nodeValue.length : 0);
  const range = document.createRange();
  range.setStart(trig.node, trig.atOffset);
  range.setEnd(trig.node, end);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  range.deleteContents();
  range.insertNode(anchor);
  const space = document.createTextNode(" ");
  anchor.after(space);
  placeCaretIn(space, 1);
  decorateTaskLinks(bodyEl);
  markDirty();
}

function createMentionTargetNote(title) {
  if (!state.notebooks.length) { createNotebook("Personal"); }
  /* v2.28.0: in the description host, the new note files
     into the notebook the task editor has selected; in
     the note host, it files beside the note being
     edited, as it always has. v2.105.0: in the Scratch
     Pad host it takes the default notebook, the rule
     every scratch creation follows. */
  let slug = null;
  if (mentionTrigger && mentionTrigger.host === "task") {
    const nbSel = document.getElementById("taskNotebookSelect");
    slug = nbSel ? nbSel.value : null;
  } else if (mentionTrigger &&
      mentionTrigger.host === "scratch") {
    slug = fallbackNotebookSlug();
  } else {
    const host = currentNote();
    slug = host ? host.notebook : null;
  }
  const known = state.notebooks.some(function (b) {
    return b.slug === slug;
  });
  if (!slug || !known) { slug = state.notebooks[0].slug; }
  const note = makeNote(slug, title);
  state.notes.unshift(note);
  saveCache();
  renderNoteList();
  saveNoteToRepo(note, { skipConflictCheck: true, fresh: true })
    .then(function () { saveCache(); })
    .catch(function (err) {
      toast("Note created locally; save failed: " + err.message, true);
    });
  return note;
}

function pickMentionRow(i) {
  const row = mentionRows[i];
  if (!row) { return; }
  if (row.kind === "mailstatus") { return; }
  if (row.kind === "mailmsg") {
    insertMentionMailChip(row.rec);
    return;
  }
  if (row.kind === "note") {
    insertMentionNoteLink(row.note);
    return;
  }
  if (row.kind === "task") {
    insertMentionTaskLink(row.task);
    return;
  }
  let created = null;
  try {
    created = createMentionTargetNote(mentionEffectiveQuery());
  } catch (err) {
    toast("Could not create that note: " + err.message, true);
  }
  if (!created) { closeMentionPopup(); return; }
  insertMentionNoteLink(created);
}

/* The popup's keys, taken on the capture phase at the document
   (see the wiring in wireEvents), so while the popup is open the
   editor's own keydown handlers (checklist Enter, the Tab
   handler) never see Enter, Tab, or the arrows at all. Escape is
   the popup's wherever it lands; the Maximize capture snapshot
   counts the popup as an open overlay, so that Escape never also
   exits Maximize. */
function onMentionPopupKeydown(ev) {
  if (!mentionPopupOpen()) { return; }
  if (ev.key === "Escape") {
    const trig = mentionTrigger;
    closeMentionPopup();
    /* (the focus hand back below reads the trigger's
       host, v2.28.0) */
    /* v2.17: Escape hands focus and the caret back to the editor,
       which is what makes closing from the popup's search box
       land the user where they were typing. With the caret
       already in the editor this simply re-places it on the same
       spot. */
    /* v2.28.0: the editor handed back to is the
       trigger's host: the note body, or the task
       description editor while its modal is open.
       v2.105.0: or the Scratch Pad. */
    const bodyEl0 = trig && trig.host === "task"
      ? document.getElementById("taskDescInput")
      : trig && trig.host === "scratch"
      ? scratchPadEl()
      : document.getElementById("noteBody");
    if (trig && bodyEl0 && bodyEl0.contains(trig.node)) {
      bodyEl0.focus();
      placeCaretIn(trig.node, Math.min(trig.caretOffset,
        trig.node.nodeValue ? trig.node.nodeValue.length : 0));
    }
    ev.preventDefault();
    ev.stopPropagation();
    return;
  }
  if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp" &&
      ev.key !== "Enter" && ev.key !== "Tab") { return; }
  const bodyEl = document.getElementById("noteBody");
  /* v2.17: the arrows and Enter also work from the popup's search
     box (Tab stays the editor's alone there, so keyboard users
     can still tab away from the box). v2.28.0: the
     keys belong to the popup while the description
     editor holds the caret too, the trigger's second
     host. */
  const descElK = document.getElementById("taskDescInput");
  const padElK = scratchPadEl();
  const searchEl = mentionSearchEl();
  const fromSearch = !!searchEl && ev.target === searchEl;
  if (fromSearch && ev.key === "Tab") { return; }
  if (!bodyEl || !ev.target ||
      (!bodyEl.contains(ev.target) &&
       !(descElK && descElK.contains(ev.target)) &&
       !(padElK && padElK.contains(ev.target)) &&
       !fromSearch)) { return; }
  ev.preventDefault();
  ev.stopPropagation();
  if (ev.key === "ArrowDown") {
    setMentionHighlight(mentionHighlight + 1);
  } else if (ev.key === "ArrowUp") {
    setMentionHighlight(mentionHighlight - 1);
  } else {
    pickMentionRow(mentionHighlight);
  }
}

/* ----- v2.1.0: Insert menu block items (table, code block) ---------------
   insertBlockAtCaret follows the same restore, delete, insert pattern
   as insertPlaceholderAtCaret: runInsertAction already restored the
   saved selection, so this reads the LIVE range, deletes what it
   covers, and inserts the block there (appending to the body when
   there is no usable caret). A following empty paragraph is inserted
   after the block so typing can continue past it. */
function insertBlockAtCaret(block, followingEl) {
  const bodyEl = document.getElementById("noteBody");
  bodyEl.focus();
  const sel = window.getSelection();
  let placed = false;
  if (sel && sel.rangeCount) {
    const range = sel.getRangeAt(0);
    if (bodyEl.contains(range.commonAncestorContainer)) {
      range.deleteContents();
      range.insertNode(block);
      placed = true;
    }
  }
  if (!placed) { bodyEl.appendChild(block); }
  if (followingEl) { block.after(followingEl); }
  return block;
}

function emptyFollowParagraph() {
  const p = document.createElement("p");
  p.appendChild(document.createElement("br"));
  return p;
}

/* Put the caret at a child offset inside an element or text node. */
function placeCaretIn(node, offset) {
  const sel = window.getSelection();
  const range = document.createRange();
  range.setStart(node, offset || 0);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

/* Insert, Table: a starter table (class ss-table) with a header row of
   three header cells and two body rows of three cells each, an empty
   paragraph after it, and the caret in the first header cell. The
   cells carry a <br> so they are clickable and typeable while empty. */
function insertStarterTable() {
  function cell(tag) {
    const c = document.createElement(tag);
    c.appendChild(document.createElement("br"));
    return c;
  }
  const table = document.createElement("table");
  table.setAttribute("class", "ss-table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (let i = 0; i < 3; i++) { headRow.appendChild(cell("th")); }
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  for (let r = 0; r < 2; r++) {
    const row = document.createElement("tr");
    for (let c = 0; c < 3; c++) { row.appendChild(cell("td")); }
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  insertBlockAtCaret(table, emptyFollowParagraph());
  const firstCell = table.querySelector("th");
  if (firstCell) { placeCaretIn(firstCell, 0); }
}

/* ----- v2.2: table editing ------------------------------------------------
   The tables Insert > Table creates (table.ss-table) can be edited in
   place. While the caret or selection sits inside a table in an
   editable note, a small floating Table button (#tableMenuBtn) parks
   at the top right corner of that table, positioned from the table's
   own rectangle the way the link bar is positioned from its anchor.
   The button opens #tableMenu with seven actions: Add row above, Add
   row below, Add column left, Add column right, Delete row, Delete
   column, Delete table.
   Both elements live OUTSIDE #noteBody (siblings of #linkBar and
   #attMenu inside .editor-inner), and collectEditor reads only
   #noteBody, so the furniture can never be saved into a note; the
   actions below edit only real table markup (table, thead, tbody,
   tr, th, td), which canonicalization passes through untouched, so a
   table survives a save and reload round trip exactly.
   The helpers work from the caret's cell: its row within the table
   and its cell index within the row decide where rows and columns
   are added or removed. New cells are empty (a single <br>, exactly
   like the starter table's cells) and take th in the header section,
   td in body rows. Guards: Delete row is disabled (and refuses to
   run) when the caret is in the header row or the row is the table's
   only row; Delete column is disabled at one column; Delete table
   removes the table and leaves an empty paragraph in its place.
   After every action the caret lands in a sensible neighboring cell
   and markDirty runs, so autosave picks the change up like any edit.
   The button and menu hide whenever the caret leaves the table, the
   note switches, or the editor locks (renderEditor calls
   hideTableMenu in all three cases). */
let tableMenuCell = null;        /* the td or th the caret is in */
let tableMenuTable = null;       /* that cell's table */
let tableMenuActionCell = null;  /* the cell captured when the menu opened */
let tableMenuActionTable = null; /* and its table */

/* The table cell (td or th) containing a DOM node, or null when the
   node is not inside a cell of a table that lives in #noteBody. */
function tableCellFromNode(node) {
  const bodyEl = document.getElementById("noteBody");
  if (!node || !bodyEl) { return null; }
  let el = node.nodeType === 1 ? node : node.parentElement;
  if (!el || !bodyEl.contains(el)) { return null; }
  const cell = el.closest ? el.closest("td, th") : null;
  if (!cell || !bodyEl.contains(cell)) { return null; }
  return cell;
}

/* Caret watcher: show the Table button (parked on the caret's table)
   when the selection is inside a table in an editable note, and hide
   the button and menu in every other case. Wired to body clicks and
   keyups plus document selectionchange in wireEvents, and called
   directly after each table action. Focus sitting on the table
   furniture itself (the button or the open menu) is not a caret move,
   so it leaves the tracked state alone. */
function updateTableMenu() {
  const bodyEl = document.getElementById("noteBody");
  const btn = document.getElementById("tableMenuBtn");
  if (!bodyEl || !btn) { return; }
  const sel = window.getSelection();
  const anchor = sel && sel.rangeCount ? sel.anchorNode : null;
  const anchorEl = !anchor ? null
    : anchor.nodeType === 1 ? anchor : anchor.parentElement;
  if (anchorEl && anchorEl.closest &&
      (anchorEl.closest("#tableMenuBtn") || anchorEl.closest("#tableMenu"))) {
    return;
  }
  const note = currentNote();
  const editable = !!note && !note.trashed && !note.archived &&
    bodyEl.contentEditable !== "false";
  const cell = editable ? tableCellFromNode(anchor) : null;
  if (!cell) { hideTableMenu(); return; }
  tableMenuCell = cell;
  tableMenuTable = cell.closest("table");
  if (!tableMenuTable) { hideTableMenu(); return; }
  btn.classList.remove("hidden");
  positionTableMenuBtn();
  const menu = document.getElementById("tableMenu");
  if (menu && !menu.classList.contains("hidden")) { syncTableMenuGuards(); }
}

/* Park the Table button at the table's top right corner, clamped
   into the viewport with the same 8px margin the link popup uses.
   A table touching the top of the viewport has no room above it, so
   the button then sits just below the table instead. */
function positionTableMenuBtn() {
  const btn = document.getElementById("tableMenuBtn");
  if (!btn || !tableMenuTable) { return; }
  const rect = tableMenuTable.getBoundingClientRect();
  const width = btn.offsetWidth || 76;
  const height = btn.offsetHeight || 26;
  let left = rect.right - width;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  let top = rect.top - height - 6;
  if (top < 8) { top = rect.bottom + 6; }
  btn.style.left = left + "px";
  btn.style.top = top + "px";
}

/* Close just the menu popup (the button stays while the caret is in
   the table), mirroring how the image menu closes on its own. */
function closeTableMenu() {
  const menu = document.getElementById("tableMenu");
  if (menu) { menu.classList.add("hidden"); }
  const btn = document.getElementById("tableMenuBtn");
  if (btn) { btn.setAttribute("aria-expanded", "false"); }
  tableMenuActionCell = null;
  tableMenuActionTable = null;
}

/* Hide the whole table control set and forget the tracked cell.
   Called when the caret leaves the table, when the note switches,
   and when the editor locks. */
function hideTableMenu() {
  tableMenuCell = null;
  tableMenuTable = null;
  closeTableMenu();
  const btn = document.getElementById("tableMenuBtn");
  if (btn) { btn.classList.add("hidden"); }
}

/* Refresh the Delete guards from the cell the menu will act on:
   Delete row is disabled in the header row and when the table has a
   single row; Delete column is disabled when the table has a single
   column. runTableAction enforces the same guards again, so a stale
   menu can never delete what it should not. */
function syncTableMenuGuards() {
  const menu = document.getElementById("tableMenu");
  const cell = tableMenuActionCell || tableMenuCell;
  if (!menu || !cell) { return; }
  const row = cell.parentElement;
  const table = cell.closest("table");
  if (!row || !table) { return; }
  const inHeader = row.parentElement &&
    row.parentElement.tagName === "THEAD";
  const delRow = menu.querySelector('[data-table-action="deleteRow"]');
  const delCol = menu.querySelector('[data-table-action="deleteCol"]');
  if (delRow) { delRow.disabled = !!inHeader || table.rows.length <= 1; }
  if (delCol) { delCol.disabled = row.cells.length <= 1; }
}

/* Open the menu under the Table button. The acting cell and table
   are captured now: clicking menu items moves focus out of the
   editor, and the actions must still hit the cell the user meant. */
function openTableMenu() {
  if (!tableMenuCell || !tableMenuTable) { return; }
  /* v2.3: the cell menu and the table menu are never open at once. */
  closeCellMenu();
  tableMenuActionCell = tableMenuCell;
  tableMenuActionTable = tableMenuTable;
  syncTableMenuGuards();
  const menu = document.getElementById("tableMenu");
  const btn = document.getElementById("tableMenuBtn");
  menu.classList.remove("hidden");
  btn.setAttribute("aria-expanded", "true");
  const btnRect = btn.getBoundingClientRect();
  const width = menu.offsetWidth || 190;
  const height = menu.offsetHeight || 320;
  let left = Math.max(8, Math.min(btnRect.left, window.innerWidth - width - 8));
  let top = btnRect.bottom + 4;
  if (top + height > window.innerHeight - 8) {
    top = Math.max(8, btnRect.top - height - 4);
  }
  menu.style.left = left + "px";
  menu.style.top = top + "px";
}

/* One empty cell of the given kind, matching the starter table's
   shape: the tag and a single <br> so the cell is clickable and
   typeable while it holds nothing. */
function emptyTableCell(tag) {
  const c = document.createElement(tag);
  c.appendChild(document.createElement("br"));
  return c;
}

/* The tag a new cell in this row should take: th for any row in the
   header section; in body rows, the tag the row already uses at the
   reference index (td for the app's own tables), falling back to td. */
function tableCellTagFor(row, refIndex) {
  if (row.parentElement && row.parentElement.tagName === "THEAD") {
    return "th";
  }
  const ref = row.cells[Math.min(refIndex, row.cells.length - 1)];
  return ref && ref.tagName === "TH" ? "th" : "td";
}

/* Run one menu action against the captured cell. Adding a row clones
   the reference row's structure with empty cells and lands in the
   same section (so a row added next to the header row stays a header
   row). Adding a column inserts a cell at the same index in every
   row of the table. Deleting a column removes that index everywhere.
   After the structure changes, the caret moves to a neighboring cell
   and the edit goes through markDirty like any typed change. */
function runTableAction(action) {
  const cell = tableMenuActionCell;
  const table = tableMenuActionTable;
  closeTableMenu();
  /* v2.3: a structural table operation shifts row and column
     indexes, so any multi-cell selection is cleared first (its
     highlight is runtime only and would point at the wrong cells
     afterwards), and the cell menu closes with the table menu. */
  closeCellMenu();
  clearCellSelection();
  if (!cell || !table || !document.body.contains(table)) {
    hideTableMenu();
    return;
  }
  const row = cell.parentElement;
  if (!row || !row.parentElement) { return; }
  const rows = Array.prototype.slice.call(table.rows);
  const rowIdx = rows.indexOf(row);
  const cellIdx = Array.prototype.indexOf.call(row.cells, cell);
  if (rowIdx < 0 || cellIdx < 0) { return; }
  const inHeader = row.parentElement.tagName === "THEAD";
  let caretCell = null;

  if (action === "rowAbove" || action === "rowBelow") {
    const newRow = document.createElement("tr");
    for (let i = 0; i < row.cells.length; i++) {
      newRow.appendChild(emptyTableCell(tableCellTagFor(row, i)));
    }
    if (action === "rowAbove") {
      row.parentElement.insertBefore(newRow, row);
    } else {
      row.parentElement.insertBefore(newRow, row.nextSibling);
    }
    caretCell = newRow.cells[cellIdx] || null;
  } else if (action === "colLeft" || action === "colRight") {
    const at = action === "colLeft" ? cellIdx : cellIdx + 1;
    rows.forEach(function (r) {
      const fresh = emptyTableCell(tableCellTagFor(r, cellIdx));
      if (at >= r.cells.length) { r.appendChild(fresh); }
      else { r.insertBefore(fresh, r.cells[at]); }
    });
    caretCell = row.cells[at] || row.cells[row.cells.length - 1] || null;
  } else if (action === "deleteRow") {
    if (inHeader || rows.length <= 1) { updateTableMenu(); return; }
    const neighbor = rows[rowIdx + 1] || rows[rowIdx - 1] || null;
    row.parentElement.removeChild(row);
    if (neighbor) {
      caretCell = neighbor.cells[Math.min(cellIdx, neighbor.cells.length - 1)] || null;
    }
  } else if (action === "deleteCol") {
    if (row.cells.length <= 1) { updateTableMenu(); return; }
    rows.forEach(function (r) {
      if (r.cells[cellIdx]) { r.removeChild(r.cells[cellIdx]); }
    });
    caretCell = row.cells[Math.min(cellIdx, row.cells.length - 1)] || null;
  } else if (action === "deleteTable") {
    const p = emptyFollowParagraph();
    table.parentElement.replaceChild(p, table);
    placeCaretIn(p, 0);
    markDirty();
    hideTableMenu();
    return;
  } else {
    return;
  }
  if (caretCell) { placeCaretIn(caretCell, 0); }
  markDirty();
  updateTableMenu();
}

/* ----- v2.3: per-cell table menu and multi-cell selection -----------------
   The per-cell companion to the v2.2 table editing above, modeled on
   the reference menu Chris provided. A small three dot button
   (#cellMenuBtn) parks inset in the upper right corner of one cell
   of a table (inset, so it never collides with the v2.2 Table
   button, which parks above the table's outer top right) and opens
   #cellMenu: Sort column, Filter column, a Header row toggle, Cell
   background, Border style, Border width, Reset style, Align
   content, Set table width, and Copy cell. A third piece of
   furniture, #tableFilterChip, parks above the table's top left
   while that table has an active filter and clears all of its
   filters when clicked. All three live OUTSIDE #noteBody, like the
   rest of the table furniture, so they can never be saved.
   The button follows the cell most recently hovered with the mouse,
   or the caret's cell when the keyboard is being used. The acting
   cell (and, with a range selected, the whole captured range) is
   settled before the menu opens, and the menu acts only on that
   capture, so clicks inside the menu can never retarget it.
   State lives on the note's own markup, so it survives the collect,
   save, reload round trip untouched: the sort state as data-ss-sort
   ("<col>:asc" or "<col>:desc") and the filters as data-ss-filters
   (a JSON object mapping column index to filter text) on the table,
   filtered out rows carrying the class ss-filtered-out (reapplied
   by applyAllTableFilters whenever a note renders), and cell
   background, border style and width, vertical alignment, and
   column width as inline styles on the cells. The ONE class in
   this section that must NOT survive is ss-cell-selected, the
   multi-cell highlight: it is runtime only, and
   canonicalizeAttachmentPlaceholders strips it on every save
   (see the comment there for the deliberate contrast).
   Multi-cell selection: dragging the mouse from one cell into a
   different cell selects the rectangle between them (dragging
   inside a single cell keeps the normal text selection; range mode
   starts only once the pointer enters another cell of the same
   table), and Shift+click extends a rectangle from the anchored
   cell to the clicked one. The formatting actions (background,
   border style and width, alignment, reset, column width) apply to
   every cell in the captured range, and Copy cell copies the
   rectangle; sort, filter, and the header toggle stay anchored to
   the one cell the menu was opened from. Applying a format keeps
   the selection, so several formats can be applied in a row;
   structural changes (sort, filter changes, the header toggle, and
   the v2.2 row and column operations) clear it, as do note
   switches, editor locks, clicks outside the table, and Escape. */
let cellMenuCell = null;      /* the cell the three dot button sits on */
let cellMenuTable = null;     /* that cell's table */
let cellHoverCell = null;     /* the cell the pointer last hovered */
let cellActionCell = null;    /* the cell the open menu acts from */
let cellActionTable = null;   /* its table */
let cellActionCells = [];     /* every cell the open menu acts on */
/* Multi-cell selection state: the anchor and focus cells of the
   rectangle (the resolved cells come from cellRangeCells). */
let cellSelAnchor = null;
let cellSelFocus = null;
/* A potential drag selection: set on mousedown in a cell, active
   once the pointer has entered a different cell. */
let cellDragState = null;
/* Set by mouseup after a real drag selection, so the click event
   that follows it does not reset the anchor it just built. */
let cellSuppressNextClick = false;

const CELL_SUB_IDS = ["cellSortSub", "cellFilterSub", "cellBgSub",
  "cellBorderStyleSub", "cellBorderWidthSub", "cellAlignSub",
  "cellWidthSub"];

/* Whether the editor currently shows an editable note: the same
   rule updateTableMenu applies (a live note, body editable). */
function cellEditorEditable() {
  const bodyEl = document.getElementById("noteBody");
  const note = currentNote();
  return !!note && !note.trashed && !note.archived && !!bodyEl &&
    bodyEl.contentEditable !== "false";
}

/* The column index of a cell within its row, or -1 when detached. */
function cellIndexOf(cell) {
  if (!cell || !cell.parentElement) { return -1; }
  return Array.prototype.indexOf.call(cell.parentElement.cells, cell);
}

/* ----- sort and filter state on the table element ----- */

/* The recorded sort state: { col, dir } or null. */
function tableSortState(table) {
  const raw = table.getAttribute("data-ss-sort") || "";
  const m = raw.match(/^(\d+):(asc|desc)$/);
  return m ? { col: Number(m[1]), dir: m[2] } : null;
}

/* The recorded column filters as an object mapping column index
   (as a string) to filter text. Malformed state reads as none. */
function tableFilters(table) {
  let parsed = null;
  try {
    parsed = JSON.parse(table.getAttribute("data-ss-filters") || "{}");
  } catch (err) {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const out = {};
  Object.keys(parsed).forEach(function (k) {
    const v = String(parsed[k] || "").trim();
    if (v) { out[k] = v; }
  });
  return out;
}

/* Record the filters (dropping empty ones, and the attribute
   itself when none remain) and reapply row visibility. */
function setTableFilters(table, filters) {
  const clean = {};
  Object.keys(filters || {}).forEach(function (k) {
    const v = String(filters[k] || "").trim();
    if (v) { clean[k] = v; }
  });
  if (Object.keys(clean).length) {
    table.setAttribute("data-ss-filters", JSON.stringify(clean));
  } else {
    table.removeAttribute("data-ss-filters");
  }
  applyTableFilters(table);
}

/* Show or hide the table's body rows from its recorded filters: a
   row stays visible only when EVERY filtered column's cell
   contains its filter text (case insensitive). Header rows never
   hide. This runs when a filter is set or cleared and when a note
   renders; typing inside cells does not re-run it. */
function applyTableFilters(table) {
  const filters = tableFilters(table);
  const cols = Object.keys(filters);
  Array.prototype.forEach.call(table.rows, function (row) {
    const section = row.parentElement;
    if (section && section.tagName === "THEAD") {
      row.classList.remove("ss-filtered-out");
      return;
    }
    let show = true;
    cols.forEach(function (k) {
      const cell = row.cells[Number(k)];
      const text = cell ? (cell.textContent || "") : "";
      if (text.toLowerCase().indexOf(filters[k].toLowerCase()) < 0) {
        show = false;
      }
    });
    row.classList.toggle("ss-filtered-out", !show);
  });
}

/* Reapply every table's filters under a root (the note body on
   render). */
function applyAllTableFilters(rootEl) {
  if (!rootEl) { return; }
  rootEl.querySelectorAll("table[data-ss-filters]").forEach(
    function (table) { applyTableFilters(table); });
}

/* Numeric aware cell text comparison: when both trimmed texts are
   plain numbers they compare numerically (so 2 sorts before 10);
   otherwise they compare case insensitively. Returns -1, 0, or 1. */
function cellTextCompare(aText, bText) {
  const a = String(aText || "").trim();
  const b = String(bText || "").trim();
  const numRe = /^[+-]?(\d+\.?\d*|\.\d+)$/;
  if (numRe.test(a) && numRe.test(b)) {
    const d = parseFloat(a) - parseFloat(b);
    if (d !== 0) { return d < 0 ? -1 : 1; }
    return 0;
  }
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la < lb) { return -1; }
  if (la > lb) { return 1; }
  return 0;
}

/* Sort the table's BODY rows by one column. The sort is stable
   (equal keys keep their current order) and physically reorders
   the rows; filtered out rows move with their row elements and
   keep their hidden class. The header section never moves. The
   state is recorded on the table so it survives and displays
   after reload; there is no unsort (None is simply the state
   before any sort). */
function sortTableByColumn(table, colIdx, dir) {
  const sections = [];
  Array.prototype.forEach.call(table.children, function (child) {
    if (child.tagName === "TBODY") { sections.push(child); }
  });
  /* Tables whose rows sit directly under the table element (no
     section wrappers) sort those rows in place. */
  if (!sections.length) { sections.push(table); }
  sections.forEach(function (section) {
    let rows;
    if (section === table) {
      rows = Array.prototype.filter.call(table.rows, function (row) {
        return row.parentElement === table;
      });
    } else {
      rows = Array.prototype.slice.call(section.rows);
    }
    const decorated = rows.map(function (row, i) {
      return { row: row, i: i };
    });
    decorated.sort(function (x, y) {
      const cx = x.row.cells[colIdx];
      const cy = y.row.cells[colIdx];
      const cmp = cellTextCompare(cx ? cx.textContent : "",
        cy ? cy.textContent : "");
      if (cmp !== 0) { return dir === "desc" ? -cmp : cmp; }
      return x.i - y.i;
    });
    decorated.forEach(function (d) { section.appendChild(d.row); });
  });
  table.setAttribute("data-ss-sort", colIdx + ":" + dir);
}

/* ----- header row toggle ----- */

function tableHasHeaderRow(table) {
  return !!(table.tHead && table.tHead.rows.length);
}

/* When a cell element is replaced by a converted one (see
   convertRowCells), every tracked or captured reference to the old
   element follows to the new one. */
function fixCellReferences(oldCell, newCell) {
  if (cellMenuCell === oldCell) { cellMenuCell = newCell; }
  if (cellActionCell === oldCell) { cellActionCell = newCell; }
  if (cellHoverCell === oldCell) { cellHoverCell = newCell; }
  if (cellSelAnchor === oldCell) { cellSelAnchor = newCell; }
  if (cellSelFocus === oldCell) { cellSelFocus = newCell; }
  cellActionCells = cellActionCells.map(function (c) {
    return c === oldCell ? newCell : c;
  });
}

/* Rebuild each cell of a row as the given tag, carrying its
   attributes (style, class) and children across, so converting a
   row between header and body never loses cell formatting. */
function convertRowCells(row, tag) {
  Array.prototype.slice.call(row.cells).forEach(function (cell) {
    if (cell.tagName.toLowerCase() === tag) { return; }
    const fresh = document.createElement(tag);
    Array.prototype.slice.call(cell.attributes).forEach(function (attr) {
      fresh.setAttribute(attr.name, attr.value);
    });
    while (cell.firstChild) { fresh.appendChild(cell.firstChild); }
    cell.replaceWith(fresh);
    fixCellReferences(cell, fresh);
  });
}

/* Turn the header row on or off. On: the first body row moves into
   a thead, its cells converted to th. Off: the header row(s) move
   back to the top of the tbody as td cells and the thead is
   removed, so the v2.2 operations see exactly the same two shapes
   they already handle (their guards key off the THEAD parent, and
   column adds give th only to rows inside a thead). */
function setTableHeaderRow(table, on) {
  if (on === tableHasHeaderRow(table)) { return; }
  if (on) {
    const tbody = table.tBodies[0];
    if (!tbody || !tbody.rows.length) { return; }
    const row = tbody.rows[0];
    convertRowCells(row, "th");
    let thead = table.tHead;
    if (!thead) {
      thead = document.createElement("thead");
      table.insertBefore(thead, table.firstChild);
    }
    thead.appendChild(row);
  } else {
    const thead = table.tHead;
    if (!thead) { return; }
    let tbody = table.tBodies[0];
    if (!tbody) {
      tbody = document.createElement("tbody");
      table.appendChild(tbody);
    }
    const headRows = Array.prototype.slice.call(thead.rows);
    headRows.forEach(function (row) { convertRowCells(row, "td"); });
    const ref = tbody.rows[0] || null;
    headRows.forEach(function (row) {
      tbody.insertBefore(row, ref);
    });
    thead.parentElement.removeChild(thead);
  }
}

/* ----- column helpers ----- */

/* Every cell in one column of a table, header and body. */
function tableColumnCells(table, colIdx) {
  const out = [];
  Array.prototype.forEach.call(table.rows, function (row) {
    if (row.cells[colIdx]) { out.push(row.cells[colIdx]); }
  });
  return out;
}

/* Set (or clear, with "") the inline width of a whole column: the
   width lives on every cell of the column, header and body, the
   way the base table CSS distributes it. */
function setTableColumnWidth(table, colIdx, width) {
  tableColumnCells(table, colIdx).forEach(function (cell) {
    if (width) { cell.style.width = width; }
    else { cell.style.removeProperty("width"); }
  });
}

/* ----- multi-cell selection ----- */

/* The rectangle of cells between an anchor and a focus cell of one
   table, in row major order. A focus outside the anchor's table
   collapses the range to the anchor alone. */
function cellRangeCells(anchor, focus) {
  if (!anchor) { return []; }
  if (!focus || focus === anchor) { return [anchor]; }
  const table = anchor.closest("table");
  if (!table || focus.closest("table") !== table) { return [anchor]; }
  const rows = Array.prototype.slice.call(table.rows);
  const aRow = anchor.parentElement;
  const fRow = focus.parentElement;
  const r1 = rows.indexOf(aRow);
  const r2 = rows.indexOf(fRow);
  const c1 = Array.prototype.indexOf.call(aRow.cells, anchor);
  const c2 = Array.prototype.indexOf.call(fRow.cells, focus);
  if (r1 < 0 || r2 < 0 || c1 < 0 || c2 < 0) { return [anchor]; }
  const out = [];
  const rMin = Math.min(r1, r2);
  const rMax = Math.max(r1, r2);
  const cMin = Math.min(c1, c2);
  const cMax = Math.max(c1, c2);
  for (let r = rMin; r <= rMax; r++) {
    for (let c = cMin; c <= cMax; c++) {
      if (rows[r].cells[c]) { out.push(rows[r].cells[c]); }
    }
  }
  return out;
}

/* The current selection as a cell list when it spans more than one
   cell, else null (the degenerate single cell case, which the menu
   treats exactly like the plain captured cell). */
function currentRangeCells() {
  if (!cellSelAnchor || !document.body.contains(cellSelAnchor)) {
    return null;
  }
  const cells = cellRangeCells(cellSelAnchor,
    cellSelFocus || cellSelAnchor);
  return cells.length > 1 ? cells : null;
}

/* Repaint the range highlight from the anchor and focus cells.
   The class is applied only to multi-cell ranges; a single cell is
   already marked by the caret and the three dot button. */
function paintCellSelection() {
  document.querySelectorAll("#noteBody .ss-cell-selected")
    .forEach(function (el) { el.classList.remove("ss-cell-selected"); });
  if (!cellSelAnchor || !cellSelFocus) { return; }
  const cells = cellRangeCells(cellSelAnchor, cellSelFocus);
  if (cells.length > 1) {
    cells.forEach(function (cell) {
      cell.classList.add("ss-cell-selected");
    });
  }
}

/* Forget the selection entirely: state and highlight. Called on
   note switches, editor locks, clicks outside the table, Escape,
   and after every structural operation, since row and column
   indexes shift under it. Applying a format does NOT call this. */
function clearCellSelection() {
  cellSelAnchor = null;
  cellSelFocus = null;
  cellDragState = null;
  document.querySelectorAll("#noteBody .ss-cell-selected")
    .forEach(function (el) { el.classList.remove("ss-cell-selected"); });
}

/* Anchor a fresh single cell selection (a plain click or a caret
   placement): any previous range is dropped. */
function setCellAnchor(cell) {
  cellSelAnchor = cell;
  cellSelFocus = cell;
  paintCellSelection();
}

/* ----- the three dot button, the chip, and the menu ----- */

/* Park the three dot button inset in the upper right corner of
   its cell, clamped into the viewport. */
function positionCellMenuBtn() {
  const btn = document.getElementById("cellMenuBtn");
  if (!btn || !cellMenuCell) { return; }
  const rect = cellMenuCell.getBoundingClientRect();
  const width = btn.offsetWidth || 24;
  const height = btn.offsetHeight || 22;
  let left = rect.right - width - 4;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  let top = rect.top + 4;
  top = Math.max(8, Math.min(top, window.innerHeight - height - 8));
  btn.style.left = left + "px";
  btn.style.top = top + "px";
}

/* Park the filter chip above the table's top left (the Table
   button owns the top right), flipping below the table when it
   touches the top of the viewport, like the Table button. */
function positionFilterChip() {
  const chip = document.getElementById("tableFilterChip");
  if (!chip || !cellMenuTable) { return; }
  const rect = cellMenuTable.getBoundingClientRect();
  const width = chip.offsetWidth || 110;
  const height = chip.offsetHeight || 26;
  let left = Math.max(8, Math.min(rect.left,
    window.innerWidth - width - 8));
  let top = rect.top - height - 6;
  if (top < 8) { top = rect.bottom + 6; }
  chip.style.left = left + "px";
  chip.style.top = top + "px";
}

/* The chip shows exactly while the tracked table has at least one
   active filter; it is re-evaluated whenever the furniture moves. */
function updateFilterChip() {
  const chip = document.getElementById("tableFilterChip");
  if (!chip) { return; }
  const active = !!cellMenuTable &&
    Object.keys(tableFilters(cellMenuTable)).length > 0;
  if (!active) { chip.classList.add("hidden"); return; }
  chip.classList.remove("hidden");
  positionFilterChip();
}

/* Furniture watcher: park the three dot button on the hovered
   cell, or on the caret's cell when the pointer is not over the
   body, and hide everything when neither is inside a table of an
   editable note. Wired to document mouseover (which keeps the
   hover cell current), body clicks and keyups, and document
   selectionchange. While the menu itself is open it stands still:
   the menu acts on its capture, not on live tracking. */
function updateCellMenu() {
  const btn = document.getElementById("cellMenuBtn");
  if (!btn) { return; }
  const appEl = document.getElementById("app");
  if (!appEl || appEl.classList.contains("hidden")) {
    hideCellMenu();
    return;
  }
  if (!cellEditorEditable()) { hideCellMenu(); return; }
  const menu = document.getElementById("cellMenu");
  if (menu && !menu.classList.contains("hidden")) { return; }
  if (cellDragState && cellDragState.active) { return; }
  const bodyEl = document.getElementById("noteBody");
  let cell = null;
  if (cellHoverCell && bodyEl.contains(cellHoverCell)) {
    cell = cellHoverCell;
  }
  if (!cell) {
    const sel = window.getSelection();
    const anchor = sel && sel.rangeCount ? sel.anchorNode : null;
    cell = tableCellFromNode(anchor);
  }
  if (!cell) { hideCellMenu(); return; }
  cellMenuCell = cell;
  cellMenuTable = cell.closest("table");
  if (!cellMenuTable) { hideCellMenu(); return; }
  btn.classList.remove("hidden");
  positionCellMenuBtn();
  updateFilterChip();
}

/* Close just the menu popup (the button and chip stay). */
function closeCellMenu() {
  const menu = document.getElementById("cellMenu");
  if (menu) { menu.classList.add("hidden"); }
  const btn = document.getElementById("cellMenuBtn");
  if (btn) { btn.setAttribute("aria-expanded", "false"); }
  cellActionCell = null;
  cellActionTable = null;
  cellActionCells = [];
}

/* Hide the whole cell control set and forget the tracked cell.
   Called when the pointer and caret have left the table, when the
   note switches, and when the editor locks. */
function hideCellMenu() {
  closeCellMenu();
  cellMenuCell = null;
  cellMenuTable = null;
  cellHoverCell = null;
  const btn = document.getElementById("cellMenuBtn");
  if (btn) { btn.classList.add("hidden"); }
  const chip = document.getElementById("tableFilterChip");
  if (chip) { chip.classList.add("hidden"); }
  /* v2.92.0: the resize furniture follows the same hides
     (note switches and editor locks land here). */
  hideTableResizeFurniture();
}

/* Fill the menu's current values from the captured cell and table
   and start with every sub panel closed. */
function syncCellMenuState() {
  const cell = cellActionCell;
  const table = cellActionTable;
  if (!cell || !table) { return; }
  const colIdx = cellIndexOf(cell);
  const sortState = tableSortState(table);
  document.getElementById("cellMenuSortValue").textContent =
    sortState && sortState.col === colIdx
      ? (sortState.dir === "asc" ? "Ascending" : "Descending")
      : "None";
  const filters = tableFilters(table);
  const filterValue = filters[String(colIdx)] || "";
  document.getElementById("cellMenuFilterValue").textContent =
    filterValue || "None";
  document.getElementById("cellFilterInput").value = filterValue;
  document.getElementById("cellHeaderToggle").setAttribute(
    "aria-checked", tableHasHeaderRow(table) ? "true" : "false");
  const bs = cell.style.borderStyle || "";
  document.getElementById("cellMenuBorderStyleValue").textContent =
    bs ? bs.charAt(0).toUpperCase() + bs.slice(1) : "";
  const bw = cell.style.borderWidth || "";
  document.getElementById("cellMenuBorderWidthValue").textContent =
    bw === "1px" ? "Thin" : bw === "2px" ? "Medium"
      : bw === "4px" ? "Thick" : bw;
  const va = cell.style.verticalAlign || "";
  document.getElementById("cellMenuAlignValue").textContent =
    va === "middle" ? "Middle" : va === "bottom" ? "Bottom" : "Top";
  document.getElementById("cellMenuWidthValue").textContent =
    cell.style.width || "Auto";
  CELL_SUB_IDS.forEach(function (id) {
    document.getElementById(id).classList.add("hidden");
  });
}

/* Position the open menu under its button, right edges aligned,
   flipping above the button when it would spill off the bottom. */
function positionCellMenu() {
  const menu = document.getElementById("cellMenu");
  const btn = document.getElementById("cellMenuBtn");
  if (!menu || !btn) { return; }
  const btnRect = btn.getBoundingClientRect();
  const width = menu.offsetWidth || 240;
  const height = menu.offsetHeight || 420;
  let left = Math.max(8, Math.min(btnRect.right - width,
    window.innerWidth - width - 8));
  let top = btnRect.bottom + 4;
  if (top + height > window.innerHeight - 8) {
    top = Math.max(8, btnRect.top - height - 4);
  }
  menu.style.left = left + "px";
  menu.style.top = top + "px";
}

/* Open the menu from the three dot button. The acting cells are
   captured now: the multi-cell range when one is selected in this
   table, otherwise the button's cell alone. Sort, filter, and the
   header toggle anchor to the button's cell either way. Opening
   the cell menu closes the v2.2 table menu, and vice versa. */
function openCellMenu() {
  if (!cellMenuCell || !cellMenuTable) { return; }
  closeTableMenu();
  const range = currentRangeCells();
  cellActionCell = cellMenuCell;
  cellActionTable = cellMenuTable;
  cellActionCells = (range &&
    range[0].closest("table") === cellMenuTable)
    ? range.slice() : [cellMenuCell];
  syncCellMenuState();
  const menu = document.getElementById("cellMenu");
  const btn = document.getElementById("cellMenuBtn");
  menu.classList.remove("hidden");
  btn.setAttribute("aria-expanded", "true");
  positionCellMenu();
}

/* Show one sub panel and close the others, then reposition: the
   menu's height changed under its button. */
function toggleCellSub(subId) {
  CELL_SUB_IDS.forEach(function (id) {
    if (id !== subId) {
      document.getElementById(id).classList.add("hidden");
    }
  });
  const sub = document.getElementById(subId);
  const willShow = sub.classList.contains("hidden");
  sub.classList.toggle("hidden", !willShow);
  positionCellMenu();
  if (willShow && subId === "cellFilterSub") {
    const input = document.getElementById("cellFilterInput");
    input.focus();
    input.select();
  }
}

/* ----- the menu's actions ----- */

/* Shared tail for the formatting actions: the change saves like
   any edit, the menu closes, and the cell selection deliberately
   survives, so several formats can be applied in a row. */
function finishCellFormat() {
  markDirty();
  closeCellMenu();
}

function applyCellBackground(value) {
  if (!cellActionCells.length) { closeCellMenu(); return; }
  cellActionCells.forEach(function (cell) {
    if (value) { cell.style.backgroundColor = value; }
    else { cell.style.removeProperty("background-color"); }
  });
  finishCellFormat();
}

function applyCellBorderStyle(value) {
  if (!cellActionCells.length) { closeCellMenu(); return; }
  cellActionCells.forEach(function (cell) {
    cell.style.borderStyle = value;
  });
  finishCellFormat();
}

function applyCellBorderWidth(value) {
  if (!cellActionCells.length) { closeCellMenu(); return; }
  cellActionCells.forEach(function (cell) {
    cell.style.borderWidth = value;
  });
  finishCellFormat();
}

function applyCellAlign(value) {
  if (!cellActionCells.length) { closeCellMenu(); return; }
  cellActionCells.forEach(function (cell) {
    cell.style.verticalAlign = value;
  });
  finishCellFormat();
}

/* Set table width sets the width of every column the captured
   cells touch: one column for a single cell, several for a range. */
function applyCellColumnWidth(width) {
  const table = cellActionTable;
  if (!table || !cellActionCells.length) { closeCellMenu(); return; }
  const cols = [];
  cellActionCells.forEach(function (cell) {
    const idx = cellIndexOf(cell);
    if (idx >= 0 && cols.indexOf(idx) < 0) { cols.push(idx); }
  });
  cols.forEach(function (idx) {
    setTableColumnWidth(table, idx, width);
  });
  finishCellFormat();
}

/* Reset style removes exactly the properties this menu manages
   (background, border style and width, vertical alignment) from
   every captured cell, and clears the width of every column the
   selection touches. Anything else on a cell (a font span inside
   it, other inline styles) is not this menu's to remove. */
function resetCellStyles() {
  const table = cellActionTable;
  if (!cellActionCells.length) { closeCellMenu(); return; }
  const cols = [];
  cellActionCells.forEach(function (cell) {
    cell.style.removeProperty("background-color");
    cell.style.removeProperty("border-style");
    cell.style.removeProperty("border-width");
    cell.style.removeProperty("vertical-align");
    const idx = cellIndexOf(cell);
    if (idx >= 0 && cols.indexOf(idx) < 0) { cols.push(idx); }
  });
  if (table) {
    cols.forEach(function (idx) {
      setTableColumnWidth(table, idx, "");
    });
  }
  finishCellFormat();
}

/* Sort is structural (rows move), so it clears the cell selection
   like the other structural operations. */
function doCellSort(dir) {
  const table = cellActionTable;
  const cell = cellActionCell;
  if (!table || !cell || !document.body.contains(table)) {
    closeCellMenu();
    return;
  }
  const colIdx = cellIndexOf(cell);
  if (colIdx < 0) { closeCellMenu(); return; }
  sortTableByColumn(table, colIdx, dir);
  markDirty();
  closeCellMenu();
  clearCellSelection();
  updateTableMenu();
  updateCellMenu();
}

/* Apply the filter form to the captured cell's column: the typed
   text becomes that column's filter (empty text clears it). A
   filter change is structural for selection purposes, so the cell
   selection clears. */
function applyCellFilterFromForm() {
  const table = cellActionTable;
  const cell = cellActionCell;
  if (!table || !cell) { closeCellMenu(); return; }
  const colIdx = cellIndexOf(cell);
  if (colIdx < 0) { closeCellMenu(); return; }
  const value = document.getElementById("cellFilterInput").value.trim();
  const filters = tableFilters(table);
  if (value) { filters[String(colIdx)] = value; }
  else { delete filters[String(colIdx)]; }
  setTableFilters(table, filters);
  markDirty();
  closeCellMenu();
  clearCellSelection();
  updateCellMenu();
}

/* Clear just the captured column's filter. */
function clearCellFilter() {
  const table = cellActionTable;
  const cell = cellActionCell;
  if (!table || !cell) { closeCellMenu(); return; }
  const colIdx = cellIndexOf(cell);
  if (colIdx < 0) { closeCellMenu(); return; }
  const filters = tableFilters(table);
  delete filters[String(colIdx)];
  setTableFilters(table, filters);
  markDirty();
  closeCellMenu();
  clearCellSelection();
  updateCellMenu();
}

/* The header toggle is structural (a row changes sections and its
   cells change tag), so it clears the cell selection too. */
function toggleCellHeaderRow() {
  const table = cellActionTable;
  if (!table || !document.body.contains(table)) {
    closeCellMenu();
    return;
  }
  setTableHeaderRow(table, !tableHasHeaderRow(table));
  markDirty();
  closeCellMenu();
  clearCellSelection();
  updateTableMenu();
  updateCellMenu();
}

/* The given cells grouped into rows, in order, for range copy.
   The caller passes its captured list explicitly: the menu's
   capture globals are cleared when the menu closes, which happens
   before the copy reads them. */
function actionCellRows(cells) {
  const rows = [];
  let lastRowEl = null;
  cells.forEach(function (cell) {
    if (cell.parentElement !== lastRowEl) {
      rows.push([]);
      lastRowEl = cell.parentElement;
    }
    rows[rows.length - 1].push(cell);
  });
  return rows;
}

/* Copy cell: a single cell copies its content (rich HTML plus
   plain text). A range copies the rectangle: the rich payload is
   a small table fragment holding the selected cells, and the
   plain payload is tab separated values with one line per row,
   so it pastes cleanly into spreadsheets and other editors. Rich
   copy is attempted first (ClipboardItem), with a plain text
   fallback, and the result is reported honestly by toast. */
function copyCellSelection() {
  const cells = cellActionCells.length ? cellActionCells
    : (cellActionCell ? [cellActionCell] : []);
  closeCellMenu();
  if (!cells.length) { return; }
  let html;
  let text;
  if (cells.length === 1) {
    html = cells[0].innerHTML;
    text = cells[0].textContent || "";
  } else {
    const rowsHtml = [];
    const rowsText = [];
    actionCellRows(cells).forEach(function (rowCells) {
      const tds = rowCells.map(function (cell) {
        const tag = cell.tagName.toLowerCase();
        return "<" + tag + ">" + cell.innerHTML + "</" + tag + ">";
      });
      rowsHtml.push("<tr>" + tds.join("") + "</tr>");
      rowsText.push(rowCells.map(function (cell) {
        return (cell.textContent || "").replace(/\s+/g, " ").trim();
      }).join("\t"));
    });
    html = "<table><tbody>" + rowsHtml.join("") + "</tbody></table>";
    text = rowsText.join("\n");
  }
  function done() { toast("Cell copied."); }
  function fail() {
    toast("Copy failed: the browser refused clipboard access.", true);
  }
  if (navigator.clipboard &&
      typeof navigator.clipboard.write === "function" &&
      typeof ClipboardItem !== "undefined") {
    try {
      const item = new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" })
      });
      navigator.clipboard.write([item]).then(done, function () {
        if (navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, fail);
        } else { fail(); }
      });
    } catch (err) {
      if (navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, fail);
      } else { fail(); }
    }
  } else if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, fail);
  } else {
    fail();
  }
}

/* ----- v2.3 wiring --------------------------------------------------------
   Called once from wireEvents, beside the v2.2 table wiring. Hover
   tracking is a document level mouseover: it keeps the hovered cell
   current wherever the pointer goes (and clears it when the
   pointer leaves the body), while the cell furniture itself is
   left out of tracking. The drag selection rides mousedown on the
   body plus document mousemove and mouseup: nothing is prevented
   or suppressed until the pointer has entered a different cell of
   the same table, so selecting text inside one cell works exactly
   as it always has. */
function wireCellMenu() {
  const bodyEl = document.getElementById("noteBody");

  /* Cell background swatches, built from the same TB_COLORS palette
     as the toolbar's highlight popup. */
  buildSwatches("cellBgSwatches", function (value) {
    applyCellBackground(value);
  });
  document.getElementById("cellBgNone").addEventListener("click",
    function () { applyCellBackground(""); });

  /* Hover tracking plus the furniture watchers. */
  document.addEventListener("mouseover", function (ev) {
    const target = ev.target;
    if (!target || !target.closest) { return; }
    if (target.closest("#cellMenu") || target.closest("#cellMenuBtn") ||
        target.closest("#tableFilterChip")) { return; }
    /* v2.92.0: the resize furniture is table furniture
       too: resting on a strip or the handle is not
       leaving the table, so the hover cell stands (and
       the furniture with it) while the pointer travels
       onto a border to drag it. */
    if (target.closest("#tableResizeStrips") ||
        target.closest("#tableResizeHandle")) { return; }
    const appEl = document.getElementById("app");
    if (!appEl || appEl.classList.contains("hidden")) { return; }
    cellHoverCell = bodyEl.contains(target)
      ? tableCellFromNode(target) : null;
    updateCellMenu();
  });
  bodyEl.addEventListener("click", updateCellMenu);
  bodyEl.addEventListener("keyup", updateCellMenu);
  document.addEventListener("selectionchange", updateCellMenu);

  /* Anchor tracking: a caret inside the body but outside any cell
     ends a selection; a caret in a different cell starts a fresh
     single cell anchor. Selections outside the body (focus sitting
     in a menu) are left alone, so applying a format from the menu
     never disturbs the range it was captured from. */
  document.addEventListener("selectionchange", function () {
    if (cellDragState) { return; }
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) { return; }
    if (!bodyEl.contains(sel.anchorNode)) { return; }
    const cell = tableCellFromNode(sel.anchorNode);
    if (!cell) {
      if (cellSelAnchor) { clearCellSelection(); }
      return;
    }
    if (cell !== cellSelAnchor) { setCellAnchor(cell); }
  });

  /* Plain clicks anchor a fresh single cell; Shift+click extends
     the rectangle from the anchor; clicks outside any cell clear
     the selection. */
  bodyEl.addEventListener("click", function (ev) {
    if (cellSuppressNextClick) {
      cellSuppressNextClick = false;
      return;
    }
    const cell = tableCellFromNode(ev.target);
    if (!cell) { clearCellSelection(); return; }
    if (ev.shiftKey && cellSelAnchor &&
        cellSelAnchor.closest("table") === cell.closest("table")) {
      cellSelFocus = cell;
      const sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); }
      paintCellSelection();
    } else {
      setCellAnchor(cell);
    }
  });

  /* Drag selection: mousedown in a cell arms a potential range
     (attachment placeholders are excluded; their own dragging
     keeps working). Only when the pointer enters a DIFFERENT cell
     of the same table does range mode begin: the native text
     selection is dropped and suppressed from there on, and the
     rectangle paints until mouseup. */
  bodyEl.addEventListener("mousedown", function (ev) {
    /* A fresh press ends the previous drag's tail: the click that
       belongs to a finished drag arrives with no press of its own
       (see cellSuppressNextClick), so any mousedown is a new
       gesture and the suppression lapses here, before the click
       that follows it is judged. */
    cellSuppressNextClick = false;
    if (ev.button !== 0) { cellDragState = null; return; }
    if (ev.target && ev.target.closest &&
        ev.target.closest(".ss-attachment")) {
      cellDragState = null;
      return;
    }
    const cell = tableCellFromNode(ev.target);
    cellDragState = cell ? { anchor: cell, active: false } : null;
  });
  document.addEventListener("mousemove", function (ev) {
    if (!cellDragState || !(ev.buttons & 1)) { return; }
    if (ev.target && ev.target.closest &&
        (ev.target.closest("#cellMenu") ||
         ev.target.closest("#cellMenuBtn") ||
         ev.target.closest("#tableFilterChip"))) { return; }
    if (!bodyEl.contains(ev.target)) { return; }
    const cell = tableCellFromNode(ev.target);
    if (!cell) { return; }
    if (cell.closest("table") !==
        cellDragState.anchor.closest("table")) { return; }
    if (cell === cellDragState.anchor && !cellDragState.active) {
      return;
    }
    if (!cellDragState.active) {
      cellDragState.active = true;
      cellSelAnchor = cellDragState.anchor;
    }
    cellSelFocus = cell;
    const sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); }
    paintCellSelection();
    ev.preventDefault();
  });
  document.addEventListener("mouseup", function () {
    if (cellDragState && cellDragState.active) {
      cellSuppressNextClick = true;
      updateCellMenu();
    }
    cellDragState = null;
  });

  /* The three dot button toggles the menu. mousedown is prevented
     so clicking it never moves the editor selection or the hover
     tracking away from the cell it sits on; the menu then acts on
     the cells captured when it opened. */
  const cellBtn = document.getElementById("cellMenuBtn");
  cellBtn.addEventListener("mousedown", function (ev) {
    ev.preventDefault();
  });
  cellBtn.addEventListener("click", function () {
    const menu = document.getElementById("cellMenu");
    if (menu.classList.contains("hidden")) { openCellMenu(); }
    else { closeCellMenu(); }
  });

  /* The chip clears every filter on its table at once. */
  document.getElementById("tableFilterChip").addEventListener("click",
    function () {
      const table = cellMenuTable;
      if (!table) { return; }
      setTableFilters(table, {});
      markDirty();
      clearCellSelection();
      updateCellMenu();
    });

  /* One delegated listener for the menu's rows and choices. */
  document.getElementById("cellMenu").addEventListener("click",
    function (ev) {
      const target = ev.target;
      if (!target || !target.closest) { return; }
      let el = target.closest("[data-cell-sort]");
      if (el) { doCellSort(el.getAttribute("data-cell-sort")); return; }
      el = target.closest("[data-cell-border-style]");
      if (el) {
        applyCellBorderStyle(el.getAttribute("data-cell-border-style"));
        return;
      }
      el = target.closest("[data-cell-border-width]");
      if (el) {
        applyCellBorderWidth(el.getAttribute("data-cell-border-width"));
        return;
      }
      el = target.closest("[data-cell-align]");
      if (el) {
        applyCellAlign(el.getAttribute("data-cell-align"));
        return;
      }
      el = target.closest("[data-cell-width]");
      if (el) {
        applyCellColumnWidth(el.getAttribute("data-cell-width"));
        return;
      }
      if (target.closest("#cellFilterClear")) {
        clearCellFilter();
        return;
      }
      if (target.closest("#cellHeaderToggle")) {
        toggleCellHeaderRow();
        return;
      }
      if (target.closest("#cellResetBtn")) { resetCellStyles(); return; }
      if (target.closest("#cellCopyBtn")) { copyCellSelection(); return; }
      el = target.closest("[data-cell-menu]");
      if (el) {
        const subs = {
          sort: "cellSortSub", filter: "cellFilterSub",
          background: "cellBgSub", borderStyle: "cellBorderStyleSub",
          borderWidth: "cellBorderWidthSub", align: "cellAlignSub",
          width: "cellWidthSub"
        };
        const subId = subs[el.getAttribute("data-cell-menu")];
        if (subId) { toggleCellSub(subId); }
      }
    });
  document.getElementById("cellFilterForm").addEventListener("submit",
    function (ev) {
      ev.preventDefault();
      applyCellFilterFromForm();
    });

  /* Clicking anywhere else closes the menu; a click outside the
     note body also ends any cell selection. The table furniture
     (both menus, both buttons, the chip) is exempt: those clicks
     belong to the table flows, which manage selection themselves. */
  document.addEventListener("click", function (ev) {
    const target = ev.target;
    if (!target || !target.closest) { return; }
    if (target.closest("#cellMenu") || target.closest("#cellMenuBtn") ||
        target.closest("#tableFilterChip") ||
        target.closest("#tableMenu") ||
        target.closest("#tableMenuBtn")) { return; }
    closeCellMenu();
    if (!bodyEl.contains(target)) { clearCellSelection(); }
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") {
      closeCellMenu();
      clearCellSelection();
    }
  });
  /* Scrolling the editor moves the table under its parked
     furniture: the menu closes and the button and chip re-park,
     mirroring the v2.2 table menu's scroll rule. */
  document.querySelector(".editor-scroll").addEventListener("scroll",
    function () {
      closeCellMenu();
      if (cellMenuTable &&
          !document.getElementById("cellMenuBtn").classList
            .contains("hidden")) {
        positionCellMenuBtn();
        positionFilterChip();
      }
    });
}

/* ----- v2.92.0: table resizing ------------------------------------------------
   Tables in the note editor resize by dragging, the way Chris
   asked on 2026-11-02: column borders, row borders, and the
   table as a whole.

   The furniture is editor chrome in the standing pattern: a
   layer of thin drag strips (#tableResizeStrips) parked over
   the active table's borders and a small square handle
   (#tableResizeHandle) parked on its bottom right corner, all
   of it OUTSIDE #noteBody (siblings of #tableMenu inside
   .editor-inner), so none of it can ever be saved into a note.
   The active table is the one the pointer is over, or the one
   holding the caret when the pointer is elsewhere, the same
   rule the cell menu's watcher applies; the furniture hides
   when neither is in a table, when the note is read only,
   and while either table menu is open. A parked position is
   re-read from live geometry on every watcher pass and on
   editor scroll, mirroring how the Table button re-parks.

   The sizes themselves are note content and save into the
   note's own HTML: column widths on a colgroup (one col per
   column, pixel widths), the table's total width as its own
   inline width, and row heights as inline heights on the
   rows. A table that has been sized carries the class
   ss-sized, whose one rule (table-layout:fixed, in the editor
   stylesheet and in the print stylesheet) makes the saved
   widths the rendered widths instead of hints; a table that
   has never been resized keeps the standing automatic layout
   untouched. The first drag on any table normalizes it:
   unset columns seed from their rendered widths, the total
   seeds from the rendered total, and unset rows seed their
   rendered heights, so a table pasted or imported with
   widths of its own keeps them and a plain table keeps the
   exact shape it had. Column widths live on the colgroup,
   so a cell spanning columns simply spans their sum, and a
   row drag on a row a cell spans downward still writes that
   row's own height.

   Drag rules:
     - an interior column border trades width between the
       two columns it separates; the total never moves;
     - the table's right border moves the last column and
       the total together;
     - the corner handle scales every column in proportion
       to the new total (height is never scaled);
     - a row border writes that row's height. The written
       form is the height property on the row, which the
       table layout treats as a floor, not a ceiling: a row
       whose content needs more room still grows, in both
       the automatic and the fixed layout, and nothing in
       the table CSS clips cell content, so a set height
       can never cut text off.
   Columns stop at TABLE_RESIZE_MIN_COL_PX and rows at
   TABLE_RESIZE_MIN_ROW_PX, so a drag can never collapse a
   column or a row to nothing.

   Drag mechanics follow the image grips' pattern: pointer
   events only (one path serves mouse, pen, and touch; the
   strips and the handle carry touch-action:none, so a touch
   drag on them is never stolen as a scroll), a pointerdown
   on a strip or the handle is prevented, so a drag never
   starts a text selection, the geometry writes live during
   the drag, and the release commits. The commit is ONE step
   on the editor's own undo history (v2.119): capture
   suspends for the whole drag, so the live geometry
   writes never settle as steps, and the finish resumes
   capture with a single signal for the net change, so
   one Ctrl+Z restores the exact pre-drag sizes and Redo
   reapplies the resize. A drag that ends where it
   started, an Escape mid-drag, and a pointercancel all
   restore the pre-drag table exactly and mark nothing.
   Only a committed resize calls markDirty, once, on
   release, which is what autosaves the note. */

const TABLE_RESIZE_MIN_COL_PX = 40;
const TABLE_RESIZE_MIN_ROW_PX = 24;
/* A border's hit strip is 9px wide, centered on the border. */
const TABLE_RESIZE_STRIP_HALF = 4;

let tableResizeTable = null;  /* the table the furniture serves */
let tableResizeSig = "";      /* its structure signature */
let tableResizeDrag = null;   /* the in-flight drag, or null */

/* The table's column count on the grid: the widest row's
   colspan sum. A table with no cells has none. */
function tableResizeGridColumns(table) {
  let cols = 0;
  Array.prototype.forEach.call(table.rows, function (row) {
    let n = 0;
    Array.prototype.forEach.call(row.cells, function (cell) {
      n += Math.max(1, cell.colSpan || 1);
    });
    if (n > cols) { cols = n; }
  });
  return cols;
}

/* The table's first colgroup, or null. With create, one is
   built as the table's first child when it has none. */
function tableResizeColgroup(table, create) {
  let group = null;
  Array.prototype.forEach.call(table.children, function (el) {
    if (!group && el.tagName === "COLGROUP") { group = el; }
  });
  if (!group && create) {
    group = document.createElement("colgroup");
    table.insertBefore(group, table.firstChild);
  }
  return group;
}

/* The x coordinate of every column boundary, read from the
   rendered cells (a spanning cell contributes the two
   boundaries it spans, so merged cells need no special
   case). A boundary no cell edge lands on, possible when
   every row spans across it, is interpolated between its
   known neighbors. */
function tableResizeColumnBounds(table, cols) {
  const bounds = new Array(cols + 1).fill(null);
  Array.prototype.forEach.call(table.rows, function (row) {
    let ci = 0;
    Array.prototype.forEach.call(row.cells, function (cell) {
      const span = Math.max(1, cell.colSpan || 1);
      const rect = cell.getBoundingClientRect();
      if (rect.width > 0) {
        if (bounds[ci] === null) { bounds[ci] = rect.left; }
        if (bounds[ci + span] === null) {
          bounds[ci + span] = rect.right;
        }
      }
      ci += span;
    });
  });
  const trect = table.getBoundingClientRect();
  if (bounds[0] === null) { bounds[0] = trect.left; }
  if (bounds[cols] === null) { bounds[cols] = trect.right; }
  let last = 0;
  for (let i = 1; i <= cols; i++) {
    if (bounds[i] !== null) {
      const gap = i - last;
      for (let k = 1; k < gap; k++) {
        bounds[last + k] = bounds[last] +
          (bounds[i] - bounds[last]) * k / gap;
      }
      last = i;
    }
  }
  return bounds;
}

/* The rendered column widths, integers summing to the
   rendered table width (the last column absorbs the
   rounding residue, so the saved structure is always
   self consistent). */
function tableResizeRenderedWidths(table, cols) {
  const bounds = tableResizeColumnBounds(table, cols);
  const widths = [];
  let sum = 0;
  for (let i = 0; i < cols; i++) {
    const w = Math.max(1, Math.round(bounds[i + 1] - bounds[i]));
    widths.push(w);
    sum += w;
  }
  const total = Math.round(table.getBoundingClientRect().width);
  if (total > 0 && widths.length) {
    widths[widths.length - 1] += total - sum;
    if (widths[widths.length - 1] < 1) {
      widths[widths.length - 1] = 1;
    }
  }
  return widths;
}

/* Write a full width set: every col, and the table's own
   width as their sum. */
function tableResizeApplyWidths(table, widths) {
  const group = tableResizeColgroup(table, false);
  if (!group) { return; }
  let total = 0;
  widths.forEach(function (w, i) {
    total += w;
    const col = group.children[i];
    if (col) { col.style.width = w + "px"; }
  });
  table.style.width = total + "px";
}

/* Normalize a table for its first drag: colgroup present
   and matching the grid, every column width explicit
   (seeded from the rendered widths, so existing widths
   from a paste or import are kept as they render), the
   table width explicit, the ss-sized class on, and every
   row without a height given its rendered height. Returns
   the width set now in force, or null when the table has
   no columns to size. */
function tableResizeNormalize(table) {
  const cols = tableResizeGridColumns(table);
  if (!cols) { return null; }
  const widths = tableResizeRenderedWidths(table, cols);
  const group = tableResizeColgroup(table, true);
  while (group.children.length < cols) {
    group.appendChild(document.createElement("col"));
  }
  while (group.children.length > cols) {
    group.removeChild(group.lastChild);
  }
  table.classList.add("ss-sized");
  tableResizeApplyWidths(table, widths);
  Array.prototype.forEach.call(table.rows, function (row) {
    if (!row.style.height) {
      const h = Math.round(row.getBoundingClientRect().height);
      if (h > 0) { row.style.height = h + "px"; }
    }
  });
  return widths;
}

/* A DOM node as a child index path from #noteBody, and back.
   The commit replaces the table element, so the selection
   is carried across it as paths (which the replacement
   cannot disturb: the new table stands exactly where the
   old one did, with the same child counts around it). */
function tableResizeNodePath(node) {
  const bodyEl = document.getElementById("noteBody");
  if (!node || !bodyEl) { return null; }
  const path = [];
  let n = node;
  while (n && n !== bodyEl) {
    const parent = n.parentNode;
    if (!parent) { return null; }
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, n));
    n = parent;
  }
  return n === bodyEl ? path : null;
}

function tableResizeNodeAtPath(path) {
  const bodyEl = document.getElementById("noteBody");
  if (!bodyEl || !path) { return null; }
  let n = bodyEl;
  for (let i = 0; i < path.length; i++) {
    if (!n.childNodes || path[i] >= n.childNodes.length) {
      return null;
    }
    n = n.childNodes[path[i]];
  }
  return n;
}

function tableResizeSelectionSnapshot() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) { return null; }
  const anchorPath = tableResizeNodePath(sel.anchorNode);
  const focusPath = tableResizeNodePath(sel.focusNode);
  if (!anchorPath || !focusPath) { return null; }
  return {
    anchorPath: anchorPath, anchorOff: sel.anchorOffset,
    focusPath: focusPath, focusOff: sel.focusOffset
  };
}

function tableResizeRestoreSelection(snap) {
  if (!snap) { return; }
  try {
    const a = tableResizeNodeAtPath(snap.anchorPath);
    const f = tableResizeNodeAtPath(snap.focusPath);
    if (!a || !f) { return; }
    const range = document.createRange();
    const aMax = a.nodeType === 3 ? a.nodeValue.length
      : a.childNodes.length;
    const fMax = f.nodeType === 3 ? f.nodeValue.length
      : f.childNodes.length;
    range.setStart(a, Math.min(snap.anchorOff, aMax));
    range.setEnd(f, Math.min(snap.focusOff, fMax));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } catch (err) { /* the caret lands where the insert left it */ }
}

/* The table the furniture should serve right now: the
   hovered cell's table, or the caret cell's table when the
   pointer is not over a cell. Mirrors updateCellMenu. */
function tableResizeActiveTable() {
  const bodyEl = document.getElementById("noteBody");
  if (!bodyEl) { return null; }
  if (cellHoverCell && bodyEl.contains(cellHoverCell)) {
    return cellHoverCell.closest("table");
  }
  const sel = window.getSelection();
  const anchor = sel && sel.rangeCount ? sel.anchorNode : null;
  const cell = tableCellFromNode(anchor);
  return cell ? cell.closest("table") : null;
}

function hideTableResizeFurniture() {
  tableResizeTable = null;
  tableResizeSig = "";
  const layer = document.getElementById("tableResizeStrips");
  if (layer) { layer.innerHTML = ""; }
  const handle = document.getElementById("tableResizeHandle");
  if (handle) { handle.classList.add("hidden"); }
}

/* Build the strip set for the tracked table: one strip per
   interior column border plus one on the right edge (each
   knows the boundary it drags), and one strip per visible
   row on its bottom border (each knows its row). Zero
   height rows (a filter hides them) get no strip: they have
   no border on screen to drag. */
function tableResizeBuildStrips(table) {
  const layer = document.getElementById("tableResizeStrips");
  if (!layer) { return; }
  layer.innerHTML = "";
  const cols = tableResizeGridColumns(table);
  function addStrip(kind, spec) {
    const el = document.createElement("div");
    el.className = "ss-tresize-strip";
    el.setAttribute("data-kind", kind);
    spec.kind = kind;
    spec.table = table;
    spec.stripEl = el;
    el._ssResizeSpec = spec;
    layer.appendChild(el);
  }
  for (let b = 1; b < cols; b++) {
    addStrip("col", { boundary: b });
  }
  if (cols > 0) { addStrip("right", { boundary: cols }); }
  Array.prototype.forEach.call(table.rows, function (row) {
    if (row.getBoundingClientRect().height > 0) {
      addStrip("row", { rowEl: row });
    }
  });
}

/* (Re)park the strips and the handle on the tracked table
   from its live geometry. */
function positionTableResizeFurniture() {
  const table = tableResizeTable;
  const layer = document.getElementById("tableResizeStrips");
  const handle = document.getElementById("tableResizeHandle");
  if (!table || !layer || !handle) { return; }
  if (!table.isConnected) { hideTableResizeFurniture(); return; }
  const rect = table.getBoundingClientRect();
  if (!rect.width || !rect.height) { return; }
  const cols = tableResizeGridColumns(table);
  const bounds = cols ? tableResizeColumnBounds(table, cols)
    : null;
  Array.prototype.forEach.call(layer.children, function (el) {
    const spec = el._ssResizeSpec;
    if (!spec) { return; }
    if (spec.kind === "col" || spec.kind === "right") {
      const x = bounds ? bounds[spec.boundary] : rect.right;
      el.style.left = (x - TABLE_RESIZE_STRIP_HALF) + "px";
      el.style.top = rect.top + "px";
      el.style.width = (TABLE_RESIZE_STRIP_HALF * 2 + 1) + "px";
      el.style.height = rect.height + "px";
    } else if (spec.kind === "row" && spec.rowEl) {
      const r = spec.rowEl.getBoundingClientRect();
      el.style.left = rect.left + "px";
      el.style.top = (r.bottom - TABLE_RESIZE_STRIP_HALF) + "px";
      el.style.width = rect.width + "px";
      el.style.height = (TABLE_RESIZE_STRIP_HALF * 2 + 1) + "px";
    }
  });
  handle.style.left = (rect.right - 7) + "px";
  handle.style.top = (rect.bottom - 7) + "px";
}

/* The furniture watcher: serve the active table of an
   editable note, and nothing in every other case. While
   either table menu stands open the furniture hides (the
   menus act on their own captures and close on the next
   outside press, whose watchers park everything again). */
function updateTableResizeFurniture() {
  if (tableResizeDrag) { return; }
  const layer = document.getElementById("tableResizeStrips");
  const handle = document.getElementById("tableResizeHandle");
  if (!layer || !handle) { return; }
  const cellMenu = document.getElementById("cellMenu");
  const tableMenu = document.getElementById("tableMenu");
  const menuOpen =
    (cellMenu && !cellMenu.classList.contains("hidden")) ||
    (tableMenu && !tableMenu.classList.contains("hidden"));
  if (!cellEditorEditable() || menuOpen) {
    hideTableResizeFurniture();
    return;
  }
  const table = tableResizeActiveTable();
  if (!table) { hideTableResizeFurniture(); return; }
  const rect = table.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    hideTableResizeFurniture();
    return;
  }
  const sig = tableResizeGridColumns(table) + "/" +
    table.rows.length;
  if (table !== tableResizeTable || sig !== tableResizeSig) {
    tableResizeTable = table;
    tableResizeSig = sig;
    tableResizeBuildStrips(table);
  }
  handle.classList.remove("hidden");
  positionTableResizeFurniture();
}

/* Begin a drag from a strip's or the handle's pointerdown.
   The pre-drag table is snapshotted whole (its outerHTML)
   before anything mutates: the commit and the cancel both
   work from that one snapshot, so what one undo restores
   and what a cancelled drag restores are byte for byte the
   table the user started with. */
function startTableResizeDrag(ev, spec) {
  const table = spec.table;
  if (!table || !table.isConnected) { return; }
  if (!cellEditorEditable()) { return; }
  /* v2.119: the history suspends BEFORE the drag's
     first mutation (the drag start normalization
     below), so the whole drag, normalization
     included, lands as exactly one step at the
     finish; a settle taken after the normalization
     would adopt the normalized table as the
     pre-drag state and strand it under the undo. */
  editorHistorySuspend();
  ev.preventDefault();
  ev.stopPropagation();
  closeTableMenu();
  closeCellMenu();
  clearCellSelection();
  const bodyEl = document.getElementById("noteBody");
  const tables = Array.prototype.slice.call(
    bodyEl.querySelectorAll("table"));
  const drag = {
    table: table,
    kind: spec.kind,
    boundary: spec.boundary || 0,
    rowEl: spec.rowEl || null,
    stripEl: spec.stripEl || null,
    startX: ev.clientX,
    startY: ev.clientY,
    beforeHTML: table.outerHTML,
    tableIndex: tables.indexOf(table),
    selSnapshot: tableResizeSelectionSnapshot(),
    widths: null,
    total: 0,
    rowStart: 0,
    changed: false
  };
  const widths = tableResizeNormalize(table);
  if (spec.kind === "row") {
    if (!widths || !drag.rowEl) { return; }
    drag.rowStart = parseFloat(drag.rowEl.style.height) || 0;
    if (!drag.rowStart) { return; }
  } else {
    if (!widths) { return; }
  }
  drag.widths = widths;
  drag.total = widths.reduce(function (a, b) { return a + b; }, 0);
  tableResizeDrag = drag;
  if (drag.stripEl) { drag.stripEl.classList.add("ss-active"); }
  document.addEventListener("pointermove", onTableResizeDragMove);
  document.addEventListener("pointerup", onTableResizeDragUp);
  document.addEventListener("pointercancel",
    onTableResizeDragCancel);
  document.addEventListener("keydown", onTableResizeDragKey, true);
}

/* One pointermove of a drag: the geometry writes live, and
   the changed flag records whether the drag has actually
   moved any size off its start (a drag that ends unchanged
   restores and marks nothing). */
function onTableResizeDragMove(ev) {
  const drag = tableResizeDrag;
  if (!drag) { return; }
  const dx = ev.clientX - drag.startX;
  const dy = ev.clientY - drag.startY;
  if (drag.kind === "col") {
    const b = drag.boundary;
    const pair = drag.widths[b - 1] + drag.widths[b];
    let d = dx;
    d = Math.max(TABLE_RESIZE_MIN_COL_PX - drag.widths[b - 1], d);
    d = Math.min(drag.widths[b] - TABLE_RESIZE_MIN_COL_PX, d);
    const wl = Math.round(drag.widths[b - 1] + d);
    if (wl !== drag.widths[b - 1]) {
      const next = drag.widths.slice();
      next[b - 1] = wl;
      next[b] = pair - wl;
      tableResizeApplyWidths(drag.table, next);
      drag.changed = true;
    }
  } else if (drag.kind === "right") {
    const last = drag.widths.length - 1;
    const w = Math.max(TABLE_RESIZE_MIN_COL_PX,
      Math.round(drag.widths[last] + dx));
    if (w !== drag.widths[last]) {
      const next = drag.widths.slice();
      next[last] = w;
      tableResizeApplyWidths(drag.table, next);
      drag.changed = true;
    }
  } else if (drag.kind === "corner") {
    const cols = drag.widths.length;
    let newTotal = Math.max(TABLE_RESIZE_MIN_COL_PX * cols,
      Math.round(drag.total + dx));
    const scale = newTotal / drag.total;
    const next = drag.widths.map(function (w) {
      return Math.max(TABLE_RESIZE_MIN_COL_PX,
        Math.round(w * scale));
    });
    if (next.join(",") !== drag.widths.join(",")) {
      tableResizeApplyWidths(drag.table, next);
      drag.changed = true;
    }
  } else if (drag.kind === "row") {
    const h = Math.max(TABLE_RESIZE_MIN_ROW_PX,
      Math.round(drag.rowStart + dy));
    if (h !== drag.rowStart) {
      drag.rowEl.style.height = h + "px";
      drag.changed = true;
    }
  }
}

/* End a drag: detach the drag listeners, then commit or
   restore. */
function finishTableResizeDrag(commit) {
  const drag = tableResizeDrag;
  tableResizeDrag = null;
  document.removeEventListener("pointermove",
    onTableResizeDragMove);
  document.removeEventListener("pointerup", onTableResizeDragUp);
  document.removeEventListener("pointercancel",
    onTableResizeDragCancel);
  document.removeEventListener("keydown", onTableResizeDragKey,
    true);
  if (!drag) { return; }
  if (drag.stripEl) { drag.stripEl.classList.remove("ss-active"); }
  if (commit && drag.changed) {
    tableResizeCommit(drag);
    editorHistoryResume(true);
  } else {
    tableResizeRestore(drag);
    editorHistoryResume(false);
  }
}

function onTableResizeDragUp() { finishTableResizeDrag(true); }
function onTableResizeDragCancel() {
  finishTableResizeDrag(false);
}
function onTableResizeDragKey(ev) {
  if (ev.key === "Escape") { finishTableResizeDrag(false); }
}

/* Parse a serialized table back into a live element. */
function tableResizeParse(html) {
  const holder = document.createElement("div");
  holder.innerHTML = html;
  return holder.firstElementChild;
}

/* The shared tail of commit and restore: the selection goes
   back where the snapshot had it, and every piece of table
   furniture re-derives from the table now standing in the
   body (the commit and the restore both replace the
   element, so tracked references to the old one are
   stale by construction). */
function tableResizeAfterReplace(drag) {
  tableResizeRestoreSelection(drag.selSnapshot);
  tableResizeTable = null;
  tableResizeSig = "";
  updateTableMenu();
  updateCellMenu();
  updateTableResizeFurniture();
}

/* Cancel, Escape, pointercancel, and the no-change release:
   the pre-drag table stands again, exactly, and nothing is
   marked. */
function tableResizeRestore(drag) {
  const before = tableResizeParse(drag.beforeHTML);
  if (before && drag.table.parentNode) {
    drag.table.replaceWith(before);
  }
  tableResizeAfterReplace(drag);
}

/* The commit. The live table holds the final sizes;
   the final table is swapped in as a fresh element
   (the furniture rebuild in tableResizeAfterReplace
   wants a new element either way), and markDirty
   runs once, so the note autosaves on release
   exactly like a typed edit. The swap is one step
   on the editor's own undo history (v2.119):
   capture stood suspended for the whole drag and
   the finish resumes it with one signal for the
   net change. Through v2.118.0 the commit composed
   a step on the browser's native stack instead
   (the document was first put back to the pre-drag
   table and the final table inserted over it with
   one insertHTML); that stack is no longer the
   editor's, so the composition is gone. */
function tableResizeCommit(drag) {
  const finalHTML = drag.table.outerHTML;
  const after = tableResizeParse(finalHTML);
  if (!after || !drag.table.parentNode) { return; }
  drag.table.replaceWith(after);
  tableResizeAfterReplace(drag);
  markDirty();
}

/* Wiring: the strips take their drags through one delegated
   pointerdown on the layer; the handle takes its own. The
   watchers mirror the cell menu's (document mouseover, body
   clicks and keyups, document selectionchange), a scroll of
   the editor re-parks (the table moved under its strips,
   the way the Table button re-parks), and a window resize
   re-parks too. Called once from wireEvents, beside
   wireCellMenu. */
function wireTableResize() {
  const layer = document.getElementById("tableResizeStrips");
  const handle = document.getElementById("tableResizeHandle");
  const bodyEl = document.getElementById("noteBody");
  if (!layer || !handle || !bodyEl) { return; }
  layer.addEventListener("pointerdown", function (ev) {
    const spec = ev.target && ev.target._ssResizeSpec;
    if (spec) { startTableResizeDrag(ev, spec); }
  });
  handle.addEventListener("pointerdown", function (ev) {
    if (!tableResizeTable) { return; }
    startTableResizeDrag(ev, {
      kind: "corner", table: tableResizeTable
    });
  });
  document.addEventListener("mouseover", function (ev) {
    const target = ev.target;
    if (!target || !target.closest) { return; }
    if (target.closest("#cellMenu") ||
        target.closest("#tableMenu") ||
        target.closest("#tableResizeStrips") ||
        target.closest("#tableResizeHandle")) { return; }
    updateTableResizeFurniture();
  });
  bodyEl.addEventListener("click", updateTableResizeFurniture);
  bodyEl.addEventListener("keyup", updateTableResizeFurniture);
  document.addEventListener("selectionchange",
    updateTableResizeFurniture);
  const scroller = document.querySelector(".editor-scroll");
  if (scroller) {
    scroller.addEventListener("scroll", function () {
      if (tableResizeTable) { positionTableResizeFurniture(); }
    });
  }
  window.addEventListener("resize", function () {
    if (tableResizeTable) { positionTableResizeFurniture(); }
  });
}

/* Insert, Code Block: a pre.ss-code-block holding a code element, an
   empty paragraph after it, and the caret inside the code. Text that
   was selected becomes the code content. The styling is shared with
   the bare pre the Aa style menu makes (see the #noteBody pre rule),
   so the two code block routes look identical. */
function insertCodeBlock() {
  const bodyEl = document.getElementById("noteBody");
  const sel = window.getSelection();
  let selectedText = "";
  if (sel && sel.rangeCount) {
    const range = sel.getRangeAt(0);
    if (!range.collapsed &&
        bodyEl.contains(range.commonAncestorContainer)) {
      selectedText = range.toString();
    }
  }
  const pre = document.createElement("pre");
  pre.setAttribute("class", "ss-code-block");
  const code = document.createElement("code");
  code.textContent = selectedText;
  pre.appendChild(code);
  insertBlockAtCaret(pre, emptyFollowParagraph());
  if (selectedText && code.firstChild) {
    placeCaretIn(code.firstChild, code.firstChild.length);
  } else {
    placeCaretIn(code, 0);
  }
  /* v2.99.0: a block born holding text that ends in
     a newline takes its caret furniture at once. */
  syncCodeCaretBr(pre);
}

/* Insert, Inline Code: wrap the selection in code.ss-inline-code,
   using the extract and reinsert approach (extractContents pulls the
   selected fragment out, the code element wraps it, and it goes back
   in at the same spot), the same trick the selection wrappers use.
   With no selection, an empty code element is inserted holding a
   zero width space (written as an escape below) so the caret has a
   text node to sit in; the space renders as nothing if it survives. */
function insertInlineCode() {
  const bodyEl = document.getElementById("noteBody");
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) { return; }
  const range = sel.getRangeAt(0);
  if (!bodyEl.contains(range.commonAncestorContainer)) { return; }
  const code = document.createElement("code");
  code.setAttribute("class", "ss-inline-code");
  if (range.collapsed) {
    code.appendChild(document.createTextNode("\u200B"));
    range.insertNode(code);
    placeCaretIn(code.firstChild, 1);
  } else {
    const frag = range.extractContents();
    code.appendChild(frag);
    range.insertNode(code);
    const after = document.createRange();
    after.setStartAfter(code);
    after.collapse(true);
    sel.removeAllRanges();
    sel.addRange(after);
  }
}

/* ----- v2.40.0: code block editing (Enter, Tab, paste) --------------------
   Code block polish, phase 3 release 5 of the Evernote parity
   program, modeled on Evernote's code block: a dedicated block
   (Insert menu here; Evernote also offers its Insert menu, a
   keyboard shortcut, and typing three backticks) holding plain
   monospace text on a shaded, bordered surface. Evernote's
   block has NO syntax highlighting (its users have asked for
   years; it has never shipped), and this release adds none
   either, deliberately: highlighted spans would be saved
   markup fighting the save funnel, for a feature the model
   product does not have.

   A code block here is any pre in the body. The Insert menu's
   pre.ss-code-block (its text riding in a code element) and
   the Aa style menu's bare pre are the app's two doors to the
   same block (their styling has been one shared rule since
   v2.1.0), so the keys below treat every pre identically, and
   a note saved by any earlier build edits exactly like a new
   one. Nothing here rewrites a stored body on its own: the
   polish is behavior, applied when a key is pressed in the
   block, so old notes keep their bytes until they are edited.

   The text model: the line operations count the text the pre
   displays (text nodes contribute their characters, a br
   contributes the line break it renders), and the first edit
   in a block flattens it to that one plain text (see
   flattenCodePre). Code is plain text by definition, so the
   flatten loses nothing a code block can mean; it exists so
   Enter, Tab, and paste produce the same stored shape on
   every browser instead of each engine's own contenteditable
   markup (one engine's br lines, another's split pres). */

/* The code block (pre) a node sits in, or null. A pre inside
   a table cell or an attachment placeholder is not the
   block: table Tab stays navigation and placeholders are
   not editable text, the same exclusions the tab machinery
   has always made. A pre holding an attachment or TOC block
   (a shape only damaged markup takes) is not treated as
   code either; its furniture is never flattened away. */
function codeBlockOfNode(node) {
  const bodyEl = document.getElementById("noteBody");
  let el = node && node.nodeType === 1 ? node
    : node && node.parentElement;
  if (!el || !el.closest) { return null; }
  const pre = el.closest("pre");
  if (!pre || !bodyEl || !bodyEl.contains(pre)) { return null; }
  if (pre.closest("table") || pre.closest(".ss-attachment")) {
    return null;
  }
  if (pre.querySelector &&
      pre.querySelector(".ss-attachment, .ss-toc, .ss-note-tasks")) {
    return null;
  }
  return pre;
}

/* The code block at the current selection, or null: both
   ends of the selection inside the one block. The paste
   route's entry point. */
function codeBlockAtSelection() {
  const bodyEl = document.getElementById("noteBody");
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !bodyEl) { return null; }
  const range = sel.getRangeAt(0);
  if (!bodyEl.contains(range.startContainer)) { return null; }
  const pre = codeBlockOfNode(range.startContainer);
  if (!pre || !pre.contains(range.endContainer)) { return null; }
  return pre;
}

/* ----- v2.99.0: the code block caret furniture ------------------------------
   A code block whose text ends in a newline has an
   empty last line, and Chromium gives that line no
   box of its own: the block renders one line short,
   and a caret placed after the trailing newline
   paints at the end of the line above instead of
   on the new line (Chris, on v2.97.0: "when I hit
   enter... it doesn't go down to the next line
   until I actually start typing again"; the
   geometry is measured in this build's rig probes:
   the collapsed caret range returns no client rect
   at all there, and the painted caret bar stands
   on the line above). The furniture is a single
   trailing break, classed so every reader can tell
   it apart from content: while it stands as the
   text host's last child, the empty last line has
   a real line box and the caret placed before the
   break paints on that line the moment it is
   placed. The break is pure furniture: the text
   model below never counts it (the newline it
   serves already stands in the text), the save
   funnel strips it (canonicalizeAttachmentPlace
   holders), and syncCodeCaretBr re-derives it from
   the block's text alone after every change that
   can move the trailing newline: the app's Enter,
   Tab, and paste routes, the body's input events
   (which is where native edits land), and the
   render pass that fills the body. The one shape
   sync will not touch is a trailing newline
   carried by a PLAIN break: that break is content
   (it is itself the last line's box, the form
   pastes and imports can leave behind), so it is
   left exactly as it stands. A plain break left
   trailing a text newline by the browser's own
   editing (its line holder after a native
   Backspace on the empty last line) is adopted
   instead (classed, never stacked), which matches
   how the platform itself uses that shape. */
const CODE_CARET_BR_CLASS = "ss-code-caret-br";

function isCodeCaretBr(node) {
  return !!node && node.nodeType === 1 &&
    node.tagName === "BR" && !!node.classList &&
    node.classList.contains(CODE_CARET_BR_CLASS);
}

/* The element a code block's text lives in: the
   code element when the block is the Insert menu's
   shape (the code element as the pre's only child),
   otherwise the pre itself. The one host choice
   flattenCodePre and setCodePreText have always
   made, named once here. */
function codeTextHost(pre) {
  if (pre.childNodes.length === 1 &&
      pre.firstChild.nodeType === 1 &&
      pre.firstChild.tagName === "CODE") {
    return pre.firstChild;
  }
  return pre;
}

/* Bring one code block's caret furniture in line
   with its text (see the section head above):
   exactly one classed trailing break in the text
   host while the block's text, read from its text
   nodes alone, ends in a newline; none otherwise.
   Idempotent, and safe to call on any pre the
   block routes accept. */
function syncCodeCaretBr(pre) {
  if (!pre) { return; }
  const host = codeTextHost(pre);
  if (!host || !host.querySelectorAll) { return; }
  host.querySelectorAll("br." + CODE_CARET_BR_CLASS)
    .forEach(function (el) { el.remove(); });
  let plain = "";
  (function walk(node) {
    const kids = node.childNodes;
    for (let i = 0; i < kids.length; i++) {
      const n = kids[i];
      if (n.nodeType === 3) { plain += n.data; }
      else if (n.nodeType === 1 && n.tagName !== "BR") {
        walk(n);
      }
    }
  })(host);
  if (!plain || plain.charAt(plain.length - 1) !== "\n") {
    return;
  }
  const last = host.lastChild;
  if (last && last.nodeType === 1 &&
      last.tagName === "BR") {
    last.classList.add(CODE_CARET_BR_CLASS);
    return;
  }
  const br = document.createElement("br");
  br.setAttribute("class", CODE_CARET_BR_CLASS);
  host.appendChild(br);
}

/* The render pass's sweep (called from renderEditor
   beside the other body decorations): every code
   block in the body just filled takes the furniture
   its stored text calls for, so a reopened block
   whose text ends in a newline stands at full
   height before anything is touched. */
function decorateCodeCaretBrs(rootEl) {
  if (!rootEl || !rootEl.querySelectorAll) { return; }
  rootEl.querySelectorAll("pre").forEach(function (pre) {
    if (codeBlockOfNode(pre)) { syncCodeCaretBr(pre); }
  });
}

/* The text a pre displays, in the line operations' measure:
   text nodes contribute their characters and a br
   contributes the line break it renders. Other elements
   contribute what they hold. The one exception is
   the caret furniture break (see the section
   above): it contributes nothing, because the
   newline it serves already stands in the text. */
function codePreText(el) {
  let out = "";
  const kids = el.childNodes;
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n.nodeType === 3) { out += n.data; }
    else if (n.nodeType === 1) {
      if (n.tagName === "BR") {
        if (!isCodeCaretBr(n)) { out += "\n"; }
      }
      else { out += codePreText(n); }
    }
  }
  return out;
}

/* The displayed-text length of one node (see codePreText). */
function codeTextLength(node) {
  if (!node) { return 0; }
  if (node.nodeType === 3) { return node.data.length; }
  if (node.nodeType !== 1) { return 0; }
  if (node.tagName === "BR") {
    return isCodeCaretBr(node) ? 0 : 1;
  }
  let total = 0;
  node.childNodes.forEach(function (c) {
    total += codeTextLength(c);
  });
  return total;
}

/* The offset of a caret point inside a pre, in the pre's
   displayed text: how many displayed characters stand
   before it. Element points count the children before the
   child index; text points count into the text. A point
   outside the pre measures the whole block (callers only
   pass points inside it). */
function codeOffsetInPre(pre, container, offset) {
  let acc = 0;
  let found = false;
  function walk(node) {
    if (found) { return; }
    if (node === container) {
      if (node.nodeType === 3) {
        acc += Math.min(offset, node.data.length);
      } else if (node.nodeType === 1) {
        const kids = node.childNodes;
        for (let i = 0; i < offset && i < kids.length; i++) {
          acc += codeTextLength(kids[i]);
        }
      }
      found = true;
      return;
    }
    if (node.nodeType === 3) { acc += node.data.length; return; }
    if (node.nodeType === 1) {
      if (node.tagName === "BR") { acc += 1; return; }
      const kids = node.childNodes;
      for (let i = 0; i < kids.length; i++) {
        walk(kids[i]);
        if (found) { return; }
      }
    }
  }
  walk(pre);
  return acc;
}

/* Flatten a code block to the plain text it displays and
   return the single text node then holding it (null when
   the block is empty). The text lands where the block's
   text already lives: inside the code element when the
   block is the Insert menu's shape (the code element as
   the pre's only child), otherwise directly in the pre.
   For the blocks the app itself makes the flatten is a
   no-op (already one text node carrying exactly the
   displayed text); it only rewrites a block whose content
   arrived with inline markup or br line breaks, the shapes
   pastes and imports can leave behind. */
function flattenCodePre(pre) {
  const text = codePreText(pre);
  const host = codeTextHost(pre);
  if (host.childNodes.length === 1 &&
      host.firstChild.nodeType === 3 &&
      host.firstChild.data === text) {
    return host.firstChild;
  }
  host.textContent = text;
  return host.firstChild;
}

/* Set a code block's text through the node flattenCodePre
   returned, keeping that node (and so the caret mapping
   below) stable; an empty block grows its text node in the
   same host the flatten would have chosen. Returns the
   text node now holding the text. */
function setCodePreText(pre, textNode, text) {
  if (textNode) {
    textNode.data = text;
    return textNode;
  }
  const host = codeTextHost(pre);
  const node = document.createTextNode(text);
  host.appendChild(node);
  return node;
}

/* Park the selection at displayed-text offsets inside a
   code block's one text node. */
function setCodeCaret(textNode, startOff, endOff) {
  const sel = window.getSelection();
  const range = document.createRange();
  const len = textNode.data.length;
  range.setStart(textNode, Math.max(0, Math.min(startOff, len)));
  range.setEnd(textNode, Math.max(0, Math.min(endOff, len)));
  sel.removeAllRanges();
  sel.addRange(range);
}

/* Enter with the caret in a code block; returns true when
   the key was the block's. The ordinary case is a plain
   newline at the caret (a selection is replaced by it),
   inserted by the app rather than left to the browser,
   whose contenteditable Enter inside a pre varies by
   engine and would vary the stored form with it. The exit
   is Enter pressed at the very end of the block on an
   empty last line: a block with content keeps it, minus
   the trailing newline the exit consumes, and the caret
   lands in the paragraph after the block (created when
   the block ends the note, the paragraph the Insert route
   has always placed after a fresh block); a wholly empty
   block is removed outright and a paragraph stands in its
   place, the checklist exit's shape (an empty checklist
   item's Enter leaves the list the same way). Modified
   Enter chords are never the block's. */
function handleCodeBlockEnter() {
  const note = currentNote();
  if (!note || note.trashed || note.archived) { return false; }
  const bodyEl = document.getElementById("noteBody");
  if (!bodyEl || bodyEl.contentEditable === "false") {
    return false;
  }
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) { return false; }
  const range = sel.getRangeAt(0);
  const pre = codeBlockOfNode(range.startContainer);
  if (!pre || !pre.contains(range.endContainer)) { return false; }
  let start = codeOffsetInPre(pre, range.startContainer,
    range.startOffset);
  let end = codeOffsetInPre(pre, range.endContainer,
    range.endOffset);
  if (end < start) {
    const swap = start; start = end; end = swap;
  }
  const textNode0 = flattenCodePre(pre);
  const text = textNode0 ? textNode0.data : "";
  start = Math.min(start, text.length);
  end = Math.min(end, text.length);
  if (range.collapsed && start === text.length &&
      (text === "" || text.charAt(text.length - 1) === "\n")) {
    if (text === "") {
      const p = emptyFollowParagraph();
      pre.replaceWith(p);
      placeCaretIn(p, 0);
    } else {
      setCodePreText(pre, textNode0, text.slice(0, -1));
      syncCodeCaretBr(pre);
      let next = pre.nextElementSibling;
      if (!next) {
        next = emptyFollowParagraph();
        pre.after(next);
      }
      placeCaretIn(next, 0);
    }
    markDirty();
    return true;
  }
  const node = setCodePreText(pre, textNode0,
    text.slice(0, start) + "\n" + text.slice(end));
  setCodeCaret(node, start + 1, start + 1);
  /* v2.99.0: the new last line takes its caret
     furniture in the same edit, so the caret the
     line above parks after the newline paints on
     the new line at once (see syncCodeCaretBr). */
  syncCodeCaretBr(pre);
  markDirty();
  return true;
}

/* Tab and Shift+Tab with the caret in a code block (called
   from handleBodyTabKey): indent and outdent the text
   lines the selection touches, in place. The indent unit
   is one tab character, the app's tab currency since v2.4;
   a pre preserves it natively, so no span is needed here.
   Outdent removes one leading tab, or up to two leading
   spaces where a line arrived space indented (a pasted
   snippet's usual shape). A selection ending exactly at a
   line's start does not touch that line, the code editor
   convention. The caret and selection follow their text
   through the edit. Returns whether anything changed. */
function codeIndentLines(pre, range, outdent) {
  let start = codeOffsetInPre(pre, range.startContainer,
    range.startOffset);
  let end = codeOffsetInPre(pre, range.endContainer,
    range.endOffset);
  if (end < start) {
    const swap = start; start = end; end = swap;
  }
  const textNode0 = flattenCodePre(pre);
  const text = textNode0 ? textNode0.data : "";
  start = Math.min(start, text.length);
  end = Math.min(end, text.length);
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charAt(i) === "\n") { starts.push(i + 1); }
  }
  function lineOf(off) {
    let line = 0;
    for (let i = 0; i < starts.length; i++) {
      if (starts[i] <= off) { line = i; } else { break; }
    }
    return line;
  }
  const firstLine = lineOf(start);
  let lastLine = lineOf(end);
  if (end > start && end === starts[lastLine]) { lastLine--; }
  let newText = text;
  let newStart = start;
  let newEnd = end;
  let changed = false;
  if (!outdent) {
    const points = [];
    for (let l = firstLine; l <= lastLine; l++) {
      points.push(starts[l]);
    }
    /* Insert last line first, so the earlier offsets stay
       valid while the new text is built. */
    for (let i = points.length - 1; i >= 0; i--) {
      newText = newText.slice(0, points[i]) + "\t" +
        newText.slice(points[i]);
    }
    newStart = start + points.filter(function (p) {
      return p <= start;
    }).length;
    newEnd = end + points.filter(function (p) {
      return p < end || (p === end && end === start);
    }).length;
    changed = true;
  } else {
    const removals = [];
    for (let l = firstLine; l <= lastLine; l++) {
      const at = starts[l];
      let count = 0;
      if (text.charAt(at) === "\t") { count = 1; }
      else {
        while (count < 2 && text.charAt(at + count) === " ") {
          count++;
        }
      }
      removals.push({ at: at, count: count });
    }
    let built = "";
    let cursor = 0;
    removals.forEach(function (rm) {
      built += text.slice(cursor, rm.at);
      cursor = rm.at + rm.count;
    });
    built += text.slice(cursor);
    newText = built;
    function shifted(off) {
      let delta = 0;
      removals.forEach(function (rm) {
        if (off > rm.at) {
          delta += Math.min(rm.count, off - rm.at);
        }
      });
      return off - delta;
    }
    newStart = shifted(start);
    newEnd = shifted(end);
    changed = removals.some(function (rm) {
      return rm.count > 0;
    });
  }
  const node = setCodePreText(pre, textNode0, newText);
  setCodeCaret(node, newStart, newEnd);
  syncCodeCaretBr(pre);
  if (changed) { markDirty(); }
  return changed;
}

/* Insert plain text into a code block at the selection,
   replacing it, and leave the caret after the text: the
   paste route for a caret inside a pre (Evernote's code
   blocks hold plain text only, so the clipboard's rich
   payload has nothing to offer the block). Line endings
   are normalized to the block's own newline. Returns
   whether the text landed. */
function insertPlainTextIntoCode(pre, text) {
  const note = currentNote();
  if (!note || note.trashed || note.archived) { return false; }
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) { return false; }
  const range = sel.getRangeAt(0);
  if (!pre.contains(range.startContainer) ||
      !pre.contains(range.endContainer)) {
    return false;
  }
  let start = codeOffsetInPre(pre, range.startContainer,
    range.startOffset);
  let end = codeOffsetInPre(pre, range.endContainer,
    range.endOffset);
  if (end < start) {
    const swap = start; start = end; end = swap;
  }
  const textNode0 = flattenCodePre(pre);
  const cur = textNode0 ? textNode0.data : "";
  start = Math.min(start, cur.length);
  end = Math.min(end, cur.length);
  const clean = String(text || "").replace(/\r\n?/g, "\n");
  const node = setCodePreText(pre, textNode0,
    cur.slice(0, start) + clean + cur.slice(end));
  setCodeCaret(node, start + clean.length, start + clean.length);
  syncCodeCaretBr(pre);
  markDirty();
  return true;
}


/* v2.97.0 shipped a beforeinput guard claiming
   insertText and both delete gestures at the caret
   a code block Enter leaves after a trailing
   newline, because Chromium honored no editing
   position there: the empty last line had no line
   box, so the position remapped to the end of the
   line above and typed characters piled onto it.
   v2.99.0 gives that line its box (the caret
   furniture: syncCodeCaretBr in the code block
   section), and the gestures were re-derived
   against the new DOM shape in a real browser
   (this build's rig probes, on file): with the
   furniture break standing and the caret before
   it, typing lands natively after the newline, on
   the new line (the engine consumes the furniture
   as the line fills, and the body's input wiring
   re-derives what remains), and Backspace on the
   empty last line deletes natively exactly the
   trailing newline and nothing of the line above
   (the engine leaves its own plain break behind
   as the line holder, which the input wiring then
   adopts as the furniture). Forward Delete is
   still destructive at that caret: left to the
   engine it eats through the break and pulls the
   block after the pre into the pre. So the guard
   survives narrowed to that one gesture at that
   one caret position, and performs its shipped
   meaning through the block's own text model:
   drop the trailing newline, and the caret lands
   at the end of the text that remains. Composition
   input is never claimed (an IME session owns its
   gestures), a selection is never claimed, and
   every other gesture, position, and block keeps
   the browser's own editing exactly as before.
   Returns true when the gesture was the app's. */
function handleCodeBlockBeforeInput(ev) {
  if (!ev || ev.isComposing) { return false; }
  if (ev.inputType !== "deleteContentForward") {
    return false;
  }
  const pre = codeBlockAtSelection();
  if (!pre) { return false; }
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) { return false; }
  const range = sel.getRangeAt(0);
  if (!range.collapsed) { return false; }
  const text = codePreText(pre);
  if (!text || text.charAt(text.length - 1) !== "\n") {
    return false;
  }
  const off = codeOffsetInPre(pre, range.startContainer,
    range.startOffset);
  if (off !== text.length) { return false; }
  const note = currentNote();
  if (!note || note.trashed || note.archived) {
    return false;
  }
  const bodyEl = document.getElementById("noteBody");
  if (!bodyEl || bodyEl.contentEditable === "false") {
    return false;
  }
  const textNode0 = flattenCodePre(pre);
  const node = setCodePreText(pre, textNode0,
    text.slice(0, -1));
  setCodeCaret(node, node.data.length, node.data.length);
  syncCodeCaretBr(pre);
  markDirty();
  return true;
}
/* ----- v2.37.0: the table of contents block --------------------------------
   Evernote parity (phase 3, release 2), modeled on Evernote's
   automatic table of contents (its help page "How to create a
   link to a section of a note and use a table of contents"):
   the Insert menu's Table of contents item places a generated
   block at the caret; the block lists the note's own headings
   (H1, H2, and H3, the levels Evernote's TOC draws from and
   the only levels this editor makes) as clickable entries,
   nested by level, and it updates automatically as headings
   are edited. Clicking an entry jumps to that heading inside
   the same note.

   The block is a div.ss-toc, contenteditable false as a whole
   like an attachment block, so its contents are never typed
   in; they are a pure derivation of the note's headings:
     - tocEnsureHeadingIds gives every heading the block
       needs a persistent anchor id (ss-h-<n>) in the saved
       body, unique within the note. Ids are assigned only
       while a TOC block is present in the body, so a note
       without one serializes exactly as it always has.
     - tocEntriesFrom reads the headings in document order.
     - tocRenderBlockContent paints one block from entries.
   Refresh runs where the body changes are already seen: at
   render (renderEditor, beside the other decorations), on
   the body's input events (debounced, like the attachment
   body's check), and inside the save funnel's canonical
   pass (canonicalizeAttachmentPlaceholders), so the STORED
   snapshot is regenerated from the stored headings on every
   save and a stale one self corrects on the next open or
   save without the user touching anything. The live refresh
   compares the freshly derived entries against the ones the
   block already shows (kept in a WeakMap, never in the
   saved markup) and leaves the DOM alone when they agree,
   so steady typing never rebuilds the block under a reader
   who is about to click it. */

const TOC_HEADING_TAGS = { H1: 1, H2: 2, H3: 3 };

/* The last entries each live TOC block was painted with,
   keyed by the block element itself. Runtime only: the
   canonical pass rebuilds blocks from scratch, so nothing
   here can reach a saved file. */
const tocBlockSignatures = new WeakMap();

/* The headings a TOC draws from, under a root (the live
   body or a detached canonical holder): H1 to H3 in
   document order, never a heading inside a TOC block
   itself (a generated block holds none, but a hand damaged
   body is not trusted to agree). */
function tocHeadingsUnder(rootEl) {
  const out = [];
  if (!rootEl || !rootEl.querySelectorAll) { return out; }
  rootEl.querySelectorAll("h1, h2, h3").forEach(function (h) {
    if (h.closest && h.closest(".ss-toc")) { return; }
    /* v2.40.0: a heading nested inside a code block (any
       pre) is code text, not a section of the note: a
       damaged paste can leave one nested there and the
       parser keeps it, so without this guard it would be
       listed and given an anchor id like a real heading. */
    if (h.closest && h.closest("pre")) { return; }
    out.push(h);
  });
  return out;
}

/* Give each of the root's TOC headings a persistent anchor
   id, and return the headings. An existing id is kept
   unless another element under the root already carries it
   (the first carrier wins, so a pasted duplicate or an undo
   tangle heals by reassigning the later one). Fresh ids are
   ss-h-<n> with the smallest free n, skipping every id the
   root already uses on any element, so a TOC id can never
   collide with an id the user or another feature chose.
   Only called while a TOC block is present in the body. */
function tocEnsureHeadingIds(rootEl) {
  const headings = tocHeadingsUnder(rootEl);
  const used = new Set();
  rootEl.querySelectorAll("[id]").forEach(function (el) {
    used.add(el.getAttribute("id"));
  });
  const claimed = new Set();
  let next = 1;
  headings.forEach(function (h) {
    const id = h.getAttribute("id");
    if (id && !claimed.has(id)) {
      claimed.add(id);
      return;
    }
    while (used.has("ss-h-" + next) || claimed.has("ss-h-" + next)) {
      next++;
    }
    const fresh = "ss-h-" + next;
    h.setAttribute("id", fresh);
    claimed.add(fresh);
    used.add(fresh);
  });
  return headings;
}

/* The entries a TOC shows: one per heading, in document
   order, carrying the heading's id, its level, and its
   text exactly as written. Callers run tocEnsureHeadingIds
   first, so every entry has an id to point at. */
function tocEntriesFrom(rootEl) {
  return tocHeadingsUnder(rootEl).map(function (h) {
    return {
      id: h.getAttribute("id") || "",
      level: TOC_HEADING_TAGS[h.tagName] || 1,
      text: h.textContent || ""
    };
  }).filter(function (e) { return !!e.id; });
}

/* Paint one TOC block from entries: the title line, then
   either the entry list (one anchor per entry, the anchor
   carrying its target id and level as data, its list item
   carrying the level class the indentation hangs from) or,
   with no headings to list, the empty state line. */
function tocRenderBlockContent(blockEl, entries) {
  blockEl.innerHTML = "";
  const title = document.createElement("div");
  title.setAttribute("class", "ss-toc-title");
  title.textContent = "Table of Contents";
  blockEl.appendChild(title);
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.setAttribute("class", "ss-toc-empty");
    empty.textContent =
      "No headings yet. Headings you add will appear here.";
    blockEl.appendChild(empty);
    return;
  }
  const list = document.createElement("ul");
  list.setAttribute("class", "ss-toc-list");
  entries.forEach(function (e) {
    const li = document.createElement("li");
    li.setAttribute("class", "ss-toc-item ss-toc-l" + e.level);
    const a = document.createElement("a");
    a.setAttribute("class", "ss-toc-link");
    a.setAttribute("href", "#" + e.id);
    a.setAttribute("data-ss-toc-target", e.id);
    a.setAttribute("data-ss-toc-level", String(e.level));
    a.textContent = e.text;
    li.appendChild(a);
    list.appendChild(li);
  });
  blockEl.appendChild(list);
}

/* Re-derive every TOC block under the body from the body's
   current headings. Returns true when the body holds a TOC
   block at all. A block whose entries already match is left
   byte for byte alone (see the section header). */
function refreshTocBlocks(bodyEl) {
  if (!bodyEl || !bodyEl.querySelectorAll) { return false; }
  const blocks = bodyEl.querySelectorAll(".ss-toc");
  if (!blocks.length) { return false; }
  tocEnsureHeadingIds(bodyEl);
  const entries = tocEntriesFrom(bodyEl);
  const sig = JSON.stringify(entries);
  blocks.forEach(function (block) {
    if (tocBlockSignatures.get(block) === sig) { return; }
    tocRenderBlockContent(block, entries);
    tocBlockSignatures.set(block, sig);
  });
  return true;
}

/* The debounced refresh the body's input events feed,
   mirroring queueAttachmentBodyCheck: heading edits made by
   typing, paste, the style dropdown, undo, or redo all
   arrive as input events, and 150 ms after they settle the
   blocks repaint if (and only if) the headings changed. */
const queueTocRefresh = debounce(function () {
  const bodyEl = document.getElementById("noteBody");
  if (bodyEl) { refreshTocBlocks(bodyEl); }
}, 150);

/* Jump to the heading a TOC entry points at. The scroll is
   the whole behavior: no link machinery runs, the note is
   not dirtied, and the caret is not moved by the jump (the
   press that clicked the non editable block settles the
   caret beside the block, exactly as with an attachment
   block). */
function scrollToTocHeading(id) {
  const bodyEl = document.getElementById("noteBody");
  if (!bodyEl || !id) { return; }
  const headings = bodyEl.querySelectorAll("h1, h2, h3");
  for (let i = 0; i < headings.length; i++) {
    if (headings[i].getAttribute("id") === id) {
      /* v2.48.0: a target sitting inside a folded section
         is hidden, and a jump to a hidden heading lands
         nowhere the reader can see, so the sections
         hiding it unfold first. That unfold edits the
         saved fold state, so it marks the note dirty like
         the toggle itself does. A visible target (a
         folded heading itself included: the heading
         always stands) jumps exactly as before. */
      if (headings[i].classList.contains("ss-fold-hidden")) {
        if (unfoldHeadingsHiding(bodyEl, headings[i])) {
          markDirty();
        }
      }
      headings[i].scrollIntoView({ block: "start" });
      return;
    }
  }
}

/* Insert, Table of contents: a fresh generated block at the
   caret, built by insertBlockAtCaret like the table and the
   code block. insertBlockAtCaret lands the block INSIDE the
   caret's paragraph when the caret sits in one (its insert
   splits the text node, not the block), so a block that did
   not land as a direct child of the body is hoisted out to
   just after the top level block that held the caret, with
   its following paragraph behind it: a TOC is always its
   own top level block, never a paragraph's passenger. The
   refresh then assigns the heading ids and paints the
   entries, and the caret lands in the following paragraph. */
function insertTocBlock() {
  const bodyEl = document.getElementById("noteBody");
  const block = document.createElement("div");
  block.setAttribute("class", "ss-toc");
  block.setAttribute("contenteditable", "false");
  const follow = emptyFollowParagraph();
  insertBlockAtCaret(block, follow);
  if (block.parentNode !== bodyEl) {
    let host = block;
    while (host.parentNode && host.parentNode !== bodyEl) {
      host = host.parentNode;
    }
    if (host.parentNode === bodyEl) {
      host.after(block);
      block.after(follow);
    }
  }
  refreshTocBlocks(bodyEl);
  placeCaretIn(follow, 0);
}

/* ----- v2.49.0: tasks inside notes, the reference model ----------------
   Phase 5 item 1 of the Evernote parity program, approved
   by Chris on its own on 2026-10-29. Evernote's visible
   shape, from its help (the note editor overview's
   "Insert task" checkmark, and its Tasks guidance): a
   task created in a note appears inline in the note body,
   checkable in place, and also lives in the Tasks view;
   the task editor carries a picker for the note the task
   belongs to; checking the task on either surface checks
   the one task; and a completed task stays visible in
   its note as a record.

   THE SANCTIONED DEVIATION, named first: Evernote stores
   the task inside the note's own data. This app stores
   only a REFERENCE, the model chosen on 2026-10-28
   precisely because task data living in the body would
   endanger the note save and conflict surface. The task
   lives in tasks.json like every task, owned by the task
   system, and gains one optional field, noteId: the id
   of its note. The note body holds ONE generated block,
   div.ss-note-tasks, carrying NO task data at all: it is
   only the marker that this note shows its linked tasks.
   The save funnel reduces any stored copy of the block
   to that bare marker (see canonicalizeAttachmentPlaceholders),
   so a saved body can never contain a stale task title,
   state, or count, and task state can never be a party
   to a note conflict, because it is never in the body.

   Everything the reader sees is painted live from
   state.tasks at render: this note's linked tasks, open
   first then completed (sortTasksForList's order), each
   row the real task row (buildTaskRowEl), so its
   checkbox runs the one completion path
   (toggleTaskComplete, recurrence rolls and reminder
   bookkeeping included) and a row click opens the real
   task editor. An Add task button at the block's foot
   opens that editor in create mode with the note link
   and the note's notebook preset; saving files the task
   through the normal funnel, and it appears in the block
   on the next render and in the Tasks view like any
   task. An empty state line shows when no task is
   linked. Refresh runs where task and body changes are
   already seen: at render (renderEditor, beside the
   other decorations), on every task change
   (afterTasksChanged), and on the body's input events
   (debounced, for the undo, redo, and paste landings).
   A block whose derived signature already matches is
   left byte for byte alone, so steady state never
   rebuilds it under a reader about to click it.

   The block is a window, not a container: adding,
   completing, editing, or deleting a task changes
   tasks.json only, never the note. Its controls
   therefore keep their events to themselves (the guard
   in renderNoteTasksBlockContent): a checkbox's input
   or change event must never reach the body's listeners
   and mark the note dirty, or completing a task would
   rewrite the note file and move its updated stamp for
   a note whose bytes never changed.

   The link's lifecycle: an id, so renaming the note
   never breaks it. Trash and Archive keep it (a restored
   note gets its tasks back, the way note links behave);
   Delete Forever clears it at the one site every
   forever path runs through (deleteNoteForever, via
   clearTaskNoteLinks), so nothing dangles. A task whose
   noteId names a note that exists nowhere shows in no
   block and loses nothing. */

/* The tasks one note shows in its block: every task
   whose noteId is the note, in the order every task
   surface lists (open first by due moment, completed
   after, newest completion first). A fresh array;
   state.tasks is never sorted in place. */
function tasksLinkedToNote(noteId) {
  if (!noteId) { return []; }
  return sortTasksForList(state.tasks.filter(function (t) {
    return t.noteId === noteId;
  }));
}

/* The signature each live block was last painted with,
   keyed by the block element itself: the linked tasks'
   ids and every fact a row shows. Runtime only, like
   tocBlockSignatures: the canonical pass rebuilds the
   block from the bare marker, so nothing here can reach
   a saved file. */
const noteTaskBlockSignatures = new WeakMap();

/* Blocks whose event guard is already wired (see
   renderNoteTasksBlockContent). Runtime only. */
const noteTaskBlockWired = new WeakSet();

/* One plain line for a linked task, the form print and
   the exports generate from live task state at that
   moment: a ballot glyph for the status (the U+2610 and
   U+2611 pair the plain text export already uses for
   checklists), the title, and, when the task has a due
   date, its due phrase in the app's own words. */
function noteTaskPlainLine(task) {
  let line = (task.status === "completed" ? "\u2611 " : "\u2610 ") +
    (task.title || "Untitled task");
  if (task.dueDate) {
    line += " (due " + taskDuePhrase(task) + ")";
  }
  return line;
}

/* The generated lines for one note's block, from live
   task state: empty when no task is linked, so a block
   with no tasks prints and exports as nothing at all.
   An unused window leaves no trace on paper. */
function noteTaskPlainLines(noteId) {
  return tasksLinkedToNote(noteId).map(noteTaskPlainLine);
}

/* Paint one block for its note: the title line, then
   either the linked tasks as real task rows or the
   empty state line, then, on a live note, the Add task
   foot. Nothing painted here is ever saved: the funnel
   reduces the block to its bare marker. */
function renderNoteTasksBlockContent(blockEl, note) {
  /* The event guard, wired once per block element: the
     block's own controls (its checkboxes above all)
     fire input and change events that would otherwise
     bubble to the note body's listeners and mark the
     NOTE dirty for a task side act, autosaving a file
     whose bytes never changed and moving its updated
     stamp. The rows' own handlers sit on the controls
     themselves, inside the block, so they run first;
     this guard stops the bubble on its way out of the
     block. Click is deliberately NOT stopped: the body's
     click routes are written to ignore what is not
     theirs, exactly as they treat a TOC block. */
  if (!noteTaskBlockWired.has(blockEl)) {
    noteTaskBlockWired.add(blockEl);
    ["input", "change"].forEach(function (type) {
      blockEl.addEventListener(type, function (ev) {
        ev.stopPropagation();
      });
    });
  }
  blockEl.innerHTML = "";
  const title = document.createElement("div");
  title.setAttribute("class", "ss-note-tasks-title");
  title.textContent = "Tasks";
  blockEl.appendChild(title);
  const tasks = tasksLinkedToNote(note.id);
  if (!tasks.length) {
    const empty = document.createElement("div");
    empty.setAttribute("class", "ss-note-tasks-empty");
    empty.textContent = "No tasks linked to this note yet.";
    blockEl.appendChild(empty);
  } else {
    const rows = document.createElement("div");
    rows.setAttribute("class", "ss-note-tasks-rows");
    tasks.forEach(function (task) {
      rows.appendChild(buildTaskRowEl(task));
    });
    blockEl.appendChild(rows);
  }
  /* A locked note (Trash, Archive) is read only: its
     block still shows the note's tasks, since the link
     survives there, but it offers no creation into a
     note that is not live. */
  if (!note.trashed && !note.archived) {
    const foot = document.createElement("div");
    foot.setAttribute("class", "ss-note-tasks-foot");
    const add = document.createElement("button");
    add.setAttribute("type", "button");
    add.setAttribute("class", "btn small ss-note-tasks-add");
    add.textContent = "Add task";
    add.addEventListener("click", function () {
      const current = currentNote();
      if (!current) { return; }
      openTaskEditor(null, current.notebook, current.id);
    });
    foot.appendChild(add);
    blockEl.appendChild(foot);
  }
}

/* Repaint every tasks block under the body from the
   note's currently linked tasks. Returns true when the
   body holds a block at all. The marker carries no note
   id (it carries nothing), so the caller supplies the
   note the body belongs to. */
function refreshNoteTaskBlocks(bodyEl, note) {
  if (!bodyEl || !bodyEl.querySelectorAll || !note) { return false; }
  const blocks = bodyEl.querySelectorAll(".ss-note-tasks");
  if (!blocks.length) { return false; }
  const linked = tasksLinkedToNote(note.id);
  const sig = JSON.stringify(linked.map(function (t) {
    return [t.id, t.title, t.status, t.dueDate, t.dueTime,
      t.flagged, t.priority];
  }));
  blocks.forEach(function (block) {
    if (noteTaskBlockSignatures.get(block) === sig) { return; }
    renderNoteTasksBlockContent(block, note);
    noteTaskBlockSignatures.set(block, sig);
  });
  return true;
}

/* The afterTasksChanged half of the refresh: the open
   editor's blocks, when a note is what the editor
   holds. With no note open the body holds nothing a
   refresh could mean anything to, and it costs nothing. */
function refreshOpenNoteTaskBlocks() {
  const note = currentNote();
  if (!note) { return; }
  refreshNoteTaskBlocks(document.getElementById("noteBody"), note);
}

/* The debounced refresh the body's input events feed,
   mirroring queueTocRefresh: an undo or redo that
   restores a block, or a paste that lands a copied one,
   arrives as input events, and once they settle the
   blocks repaint if the task state moved under them.
   The block's own control events never reach this
   listener: the guard in renderNoteTasksBlockContent
   stops them at the block. */
const queueNoteTasksRefresh = debounce(function () {
  refreshOpenNoteTaskBlocks();
}, 150);

/* Insert, Tasks: a fresh generated block at the caret,
   built by insertBlockAtCaret like the table of
   contents block, with the same hoist: a block that
   landed inside the caret's paragraph is lifted out to
   just after the top level block that held the caret,
   with its following paragraph behind it, so a tasks
   block is always its own top level block. The refresh
   paints the note's current tasks (or the empty line),
   and the caret lands in the following paragraph. */
function insertNoteTasksBlock() {
  const bodyEl = document.getElementById("noteBody");
  const note = currentNote();
  const block = document.createElement("div");
  block.setAttribute("class", "ss-note-tasks");
  block.setAttribute("contenteditable", "false");
  const follow = emptyFollowParagraph();
  insertBlockAtCaret(block, follow);
  if (block.parentNode !== bodyEl) {
    let host = block;
    while (host.parentNode && host.parentNode !== bodyEl) {
      host = host.parentNode;
    }
    if (host.parentNode === bodyEl) {
      host.after(block);
      block.after(follow);
    }
  }
  if (note) { refreshNoteTaskBlocks(bodyEl, note); }
  placeCaretIn(follow, 0);
}

/* ----- v2.48.0: collapsible sections -----------------------------------
   Phase 4 release 4 of the Evernote parity program, built to
   Evernote's collapsible sections (its help article "Toggle
   lists, toggle blocks, and collapsible sections"): apply a
   header style and an arrow appears at the start of the
   line; tap the arrow to expand or collapse the section and
   show or hide its contents; text, images, and other
   elements can live inside or outside header sections; the
   fold follows the note. Here the arrow is a themed button
   (class ss-fold-toggle) rendered as the first child of
   every top level H1, H2, and H3, the levels the table of
   contents block already draws from. (Evernote also offers
   an Extra small header level, standalone toggle blocks,
   toggle lists, and dragging a collapsed section as one
   block; none of those are this release, and the header
   levels are this editor's own three.)

   THE FOLD STATE IS SAVED STATE, carried on the heading
   element itself as data-ss-folded="1", the one shape that
   follows the note the way Evernote's does: it is in the
   saved body, so it syncs, reloads, duplicates, merges,
   templates, and restores exactly like the heading's other
   attributes, and a note that never folds serializes byte
   identically to v2.47.0 (the attribute exists only on a
   heading the user actually folded, and removing it is
   exactly the pre fold byte form). The save funnel
   (canonicalizeAttachmentPlaceholders) passes the
   attribute through on H1 to H3 headings and strips it
   anywhere else; it strips the toggle buttons and the
   runtime hidden class outright, in the same spirit as the
   link faces and the cell selection: chrome and view state
   never reach the file, the attribute does.

   HIDING IS A CLASS, NEVER A REMOVAL. applySectionFolds
   walks the body's top level children once, tracking the
   level of the folded heading whose section is currently
   open ended: every block after a folded heading, up to
   the next heading of the same or higher level, carries
   ss-fold-hidden and is display none on screen. The blocks
   stay in the DOM the whole time, so saving while folded
   saves the hidden content too (the funnel strips only the
   class), search and the catalog read the saved body and
   see folded words like any others, backlink scanning is
   untouched, and undo works on ordinary content. Nesting
   is level correct by construction: folding an H1 hides
   its H2 subsections whole, and unfolding it recomputes
   from the attributes, so a subsection the user folded
   earlier is still folded (its attribute never moved).

   EDITING AT A FOLD BOUNDARY IS GUARDED, because a hidden
   block the caret cannot see must never be edited blind:
     - Enter or forward Delete inside a folded heading
       unfolds that heading first, then the key does its
       ordinary work in the open. (Evernote instead puts a
       new line outside the section on Enter at the end of
       a collapsed header; unfolding was chosen here
       because it keeps every keystroke's result visible,
       which is the safer property in this editor, and the
       difference is named in the release notes.)
     - Backspace at the very start of a block whose
       previous sibling is fold hidden unfolds the sections
       hiding that sibling first, so the merge the key is
       about to make happens between two visible blocks.
     - Deleting a folded heading cannot swallow its
       section: the hidden blocks are siblings, not
       children, and once the heading is gone the input
       driven refresh recomputes the folds and they stand
       visible as ordinary content.
   The print builder strips the hidden class and the
   toggles, so a folded section prints expanded, and the
   exports read the canonical saved body, which never
   carries the class at all: a fold is a screen state for
   reading, never a way to leave content out of a copy. */

/* The heading level (1 to 3) of an element, or 0 when it
   is not one of the section headings. The TOC's own level
   table is the single source, so the fold and the table
   of contents can never disagree about which headings
   are sections. */
function foldHeadingLevel(el) {
  if (!el || !el.tagName) { return 0; }
  return TOC_HEADING_TAGS[el.tagName] || 0;
}

/* Whether a heading element currently carries the saved
   folded state. The attribute is the whole record: no
   side table, no per device state. */
function isFoldedHeading(el) {
  return foldHeadingLevel(el) > 0 &&
    !!el && el.getAttribute("data-ss-folded") === "1";
}

/* The toggle button a heading wears, or null. Toggles are
   direct children of their heading, so a shallow look is
   the whole search. */
function foldToggleOf(heading) {
  if (!heading || !heading.querySelector) { return null; }
  const found = heading.querySelectorAll(".ss-fold-toggle");
  return found.length ? found[0] : null;
}

/* Bring one heading's toggle in line with its fold state:
   the closed class (which rotates the triangle to point
   right), the expanded state for assistive tools, and a
   label naming the action and the section. The label
   reads the heading's text, which the toggle itself never
   pollutes: its triangle is pure CSS and it holds no text
   nodes at all. */
function syncFoldToggle(heading) {
  const btn = foldToggleOf(heading);
  if (!btn) { return; }
  const folded = isFoldedHeading(heading);
  btn.classList.toggle("ss-fold-closed", folded);
  btn.setAttribute("aria-expanded", folded ? "false" : "true");
  const label = (folded ? "Expand section: " : "Collapse section: ") +
    (heading.textContent || "").trim();
  btn.setAttribute("aria-label", label);
  btn.title = label;
}

/* Give a top level heading its toggle when it lacks one
   (a fresh heading, a heading whose contents were just
   retyped wholesale, an undone edit), drop any duplicates
   a paste or an undo tangle left behind, and sync the
   survivor. The button is contenteditable false, so the
   caret can never enter it and text editing flows around
   it exactly as around an attachment block. */
function ensureFoldToggle(heading) {
  const found = heading.querySelectorAll(".ss-fold-toggle");
  for (let i = 1; i < found.length; i++) { found[i].remove(); }
  if (!found.length) {
    const btn = document.createElement("button");
    btn.setAttribute("type", "button");
    btn.setAttribute("class", "ss-fold-toggle");
    btn.setAttribute("contenteditable", "false");
    const chevron = document.createElement("span");
    chevron.setAttribute("class", "ss-fold-chevron");
    chevron.setAttribute("aria-hidden", "true");
    btn.appendChild(chevron);
    heading.insertBefore(btn, heading.firstChild);
  }
  syncFoldToggle(heading);
}

/* Recompute which top level blocks a body's folds hide.
   One pass in document order: foldLevel is the level of
   the folded heading whose section is currently running
   (0 when none). A heading at the running level or higher
   ends the section and stands visible itself; a deeper
   heading is inside it and hides with its own section;
   any other block hides exactly while a section runs.
   Purely derived from the headings' saved attributes, so
   it is idempotent and safe to run after any edit. The
   class is touched only when a block's state actually
   changes, and an emptied class attribute is removed
   with it: a classList toggle on a block that was never
   hidden would otherwise leave a class="" residue in the
   live DOM for the save funnel to carry, and a block that
   was never folded must serialize exactly as it did
   before this release. */
function applySectionFolds(bodyEl) {
  if (!bodyEl || !bodyEl.children) { return; }
  let foldLevel = 0;
  Array.prototype.forEach.call(bodyEl.children, function (child) {
    const level = foldHeadingLevel(child);
    let hidden = false;
    if (level) {
      if (foldLevel && level > foldLevel) {
        hidden = true;
      } else {
        foldLevel = 0;
        if (isFoldedHeading(child)) { foldLevel = level; }
      }
    } else {
      hidden = !!foldLevel;
    }
    const has = child.classList.contains("ss-fold-hidden");
    if (hidden && !has) {
      child.classList.add("ss-fold-hidden");
    } else if (!hidden && has) {
      child.classList.remove("ss-fold-hidden");
      if (!child.classList.length) { child.removeAttribute("class"); }
    }
  });
}

/* The full editor decoration for folds: every top level
   heading wears exactly one synced toggle, stray toggles
   anywhere else (a pasted copy nested in a list, a toggle
   whose heading was demoted to a paragraph) are removed,
   and the hidden classes are recomputed. Runs at render,
   beside the TOC refresh, and (debounced) after body
   input, so headings created, demoted, deleted, undone,
   or redone by any path settle to the same state. */
function decorateSectionFolds(bodyEl) {
  if (!bodyEl || !bodyEl.querySelectorAll) { return; }
  bodyEl.querySelectorAll(".ss-fold-toggle").forEach(function (btn) {
    const host = btn.parentNode;
    if (!host || host.parentNode !== bodyEl ||
        !foldHeadingLevel(host)) {
      btn.remove();
    }
  });
  Array.prototype.forEach.call(bodyEl.children, function (child) {
    if (foldHeadingLevel(child)) { ensureFoldToggle(child); }
  });
  applySectionFolds(bodyEl);
}

/* Set or clear one heading's saved fold state and settle
   the editor around it: the toggle's face and every
   hidden class the change implies. */
function setHeadingFolded(heading, folded) {
  if (!heading || !foldHeadingLevel(heading)) { return; }
  if (folded) { heading.setAttribute("data-ss-folded", "1"); }
  else { heading.removeAttribute("data-ss-folded"); }
  syncFoldToggle(heading);
  if (heading.parentNode) { applySectionFolds(heading.parentNode); }
}

/* The arrow's own behavior, from the body's click wiring:
   fold or unfold the heading's section and mark the note
   dirty, so the state the user sees is the state that
   saves. A locked note (Trash or Archive, where the body
   is not editable) never folds: the arrow is reading
   chrome there and the saved state is not this view's to
   change. */
function toggleSectionFold(heading) {
  const bodyEl = document.getElementById("noteBody");
  if (!bodyEl || !heading || heading.parentNode !== bodyEl) { return; }
  if (bodyEl.contentEditable !== "true") { return; }
  setHeadingFolded(heading, !isFoldedHeading(heading));
  markDirty();
}

/* Unfold every folded heading whose section hides the
   given top level block, and return how many unfolded.
   The pass replays applySectionFolds' walk up to the
   block, keeping the stack of folded headings still in
   force there (a heading ends the folds at its own level
   or higher before its own state is counted); the block,
   if it is itself a heading, is hidden only by folds
   strictly above its level, which the final filter keeps.
   Used by the table of contents jump (a folded target
   must be reachable) and by the Backspace boundary guard. */
function unfoldHeadingsHiding(bodyEl, target) {
  if (!bodyEl || !target || target.parentNode !== bodyEl) { return 0; }
  const active = [];
  const children = Array.prototype.slice.call(bodyEl.children);
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child === target) { break; }
    const level = foldHeadingLevel(child);
    if (!level) { continue; }
    for (let j = active.length - 1; j >= 0; j--) {
      if (active[j].level >= level) { active.splice(j, 1); }
    }
    if (isFoldedHeading(child)) {
      active.push({ el: child, level: level });
    }
  }
  const targetLevel = foldHeadingLevel(target);
  const hiding = active.filter(function (entry) {
    return !targetLevel || entry.level < targetLevel;
  });
  hiding.forEach(function (entry) {
    entry.el.removeAttribute("data-ss-folded");
    syncFoldToggle(entry.el);
  });
  if (hiding.length) { applySectionFolds(bodyEl); }
  return hiding.length;
}

/* The debounced refresh the body's input events feed,
   mirroring queueTocRefresh: typing, paste, the style
   dropdown, block drags, undo, and redo all arrive as
   input events, and once they settle the toggles and the
   hidden classes are rederived, so a heading deleted
   while folded gives its section back as visible content
   and a heading created anywhere gains its arrow. */
const queueSectionFoldRefresh = debounce(function () {
  const bodyEl = document.getElementById("noteBody");
  if (bodyEl) { decorateSectionFolds(bodyEl); }
}, 150);

/* Whether the caret sits at the very start (or very end)
   of a top level block: the text of the block before (or
   after) the caret is empty. The toggle contributes no
   text, so a caret before the heading's first letter is
   the start even though the button precedes it in the
   DOM. Shared by the boundary guards below. */
function caretAtBlockEdge(block, atStart) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) { return false; }
  const range = sel.getRangeAt(0);
  if (!range.collapsed || !block.contains(range.startContainer)) {
    return false;
  }
  const probe = document.createRange();
  probe.selectNodeContents(block);
  if (atStart) { probe.setEnd(range.startContainer, range.startOffset); }
  else { probe.setStart(range.endContainer, range.endOffset); }
  return probe.toString() === "";
}

/* The top level block the caret sits in, or null when the
   selection is not a collapsed caret inside the body. */
function caretTopBlock(bodyEl) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) { return null; }
  const range = sel.getRangeAt(0);
  if (!range.collapsed) { return null; }
  let node = range.startContainer;
  if (!bodyEl.contains(node)) { return null; }
  while (node && node.parentNode !== bodyEl) { node = node.parentNode; }
  return node || null;
}

/* The boundary guards described in the section header,
   bound to the body's keydown beside the other body
   wirings. The handler only ever UNFOLDS and then steps
   aside: it never prevents a key, never moves the caret,
   and never touches content, so every key keeps the exact
   behavior it had before this release, with the single
   difference that the blocks it is about to act on are
   visible when it acts. */
function onSectionFoldKeydown(ev) {
  if (!ev || ev.ctrlKey || ev.metaKey || ev.altKey) { return; }
  if (ev.key !== "Enter" && ev.key !== "Backspace" &&
      ev.key !== "Delete") {
    return;
  }
  const bodyEl = document.getElementById("noteBody");
  if (!bodyEl || bodyEl.contentEditable !== "true") { return; }
  const block = caretTopBlock(bodyEl);
  if (!block) { return; }
  if (ev.key === "Enter" || ev.key === "Delete") {
    /* Inside a folded heading, Enter (any position) and a
       forward Delete at the heading's end would act on or
       past content the reader cannot see; unfold first. */
    if (isFoldedHeading(block) &&
        (ev.key === "Enter" || caretAtBlockEdge(block, false))) {
      setHeadingFolded(block, false);
      markDirty();
    }
    return;
  }
  /* Backspace at the start of a block whose previous
     sibling is fold hidden would merge this block into a
     hidden one; unfold whatever hides that sibling, so
     the merge joins two visible blocks. */
  const prev = block.previousElementSibling;
  if (prev && prev.classList.contains("ss-fold-hidden") &&
      caretAtBlockEdge(block, true)) {
    if (unfoldHeadingsHiding(bodyEl, prev)) { markDirty(); }
  }
}

